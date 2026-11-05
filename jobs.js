// jobs.js — 后台任务队列与 worker。
//
// 设计（对应面板的异步需求）：
//   · 提交：视频用 `bl video ... --async --output json` 拿 task_id 后立即返回；
//     图片没有任务查询命令，改为后台跑一次同步生成，同样立即返回 jobId。
//   · 轮询：单个 setInterval，每 15 秒查一次所有在跑的视频任务（`bl video task get`）。
//   · 超时：由 worker 按 deadline 判断，不依赖 CLI 的阻塞等待。
//   · 结果：视频 SUCCEEDED 后 `bl video download` 落盘；失败把 code/message 存进 job.error。

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
    buildMediaArgs,
    cleanLog,
    describeOutputFile,
    listFilesRecursive,
    makeJobId,
    resolveOutputDir,
    runBl,
    tail,
} from './cli.js';

const POLL_MS = 15000;
const jobs = new Map();
let timer = null;

function deepFind(value, keys, depth = 0) {
    if (value === null || typeof value !== 'object' || depth > 6) return null;
    for (const key of keys) {
        if (typeof value[key] === 'string' && value[key] !== '') return value[key];
    }
    for (const child of Object.values(value)) {
        const found = deepFind(child, keys, depth + 1);
        if (found !== null) return found;
    }
    return null;
}

function tryJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

function parseTaskId(text) {
    const json = tryJson(text);
    if (json) {
        const value = deepFind(json, ['task_id', 'taskId', 'taskID']);
        if (value !== null) return value;
    }
    const match = /"task_id"\s*:\s*"([^"]+)"/.exec(text) || /task[_-]?id["'\s:=]+([0-9a-zA-Z-]{8,})/i.exec(text);
    return match ? match[1] : null;
}

const STATUS_KEYS = ['task_status', 'taskStatus', 'status', 'state'];

function parseTaskStatus(text) {
    const json = tryJson(text);
    if (json) {
        const value = deepFind(json, STATUS_KEYS);
        if (value !== null) return value.toUpperCase();
    }
    const match = /"?(?:task_status|taskStatus|status)"?\s*[:=]\s*"([A-Za-z_]+)"/.exec(text);
    return match ? match[1].toUpperCase() : '';
}

function parseTaskError(text) {
    const json = tryJson(text);
    let code = '';
    let message = '';
    if (json) {
        const output = json.output && typeof json.output === 'object' ? json.output : null;
        code = (output && (output.code || output.error_code)) || json.code || '';
        message = (output && (output.message || output.msg)) || json.message || '';
    }
    if (message === '') message = tail(text, 500);
    return {
        code: String(code || 'TASK_FAILED'),
        message: String(message || '任务失败（云端未返回原因）'),
    };
}

/** 把 CLI 的 JSON 错误抽成一句人话。 */
function friendlyError(text) {
    if (/Local-file temporary upload is supported only|Token Plan.{0,40}not supported/i.test(text)) {
        return '当前 Profile（Token Plan）不支持本地素材上传；参考视频请用「+ 视频链接」，参考图片需要普通 API Key 的 Profile。';
    }
    const json = tryJson(text);
    if (json) {
        if (json.error && typeof json.error.message === 'string' && json.error.message !== '') return json.error.message;
        if (typeof json.message === 'string' && json.message !== '') return json.message;
    }
    return tail(text, 500) || '未知错误';
}

function snapshot(job) {
    return {
        jobId: job.id,
        kind: job.kind,
        status: job.status,
        taskId: job.taskId,
        jobDir: job.jobDir,
        files: job.files,
        error: job.error,
        elapsedMs: job.elapsedMs || Math.max(0, Date.now() - job.createdAt),
        command: job.command,
        log: job.log ? tail(job.log, 1500) : '',
    };
}

function ensureWorker() {
    if (timer !== null) return;
    timer = setInterval(() => {
        tick().catch(() => { /* 单次失败不影响下一轮 */ });
    }, POLL_MS);
    if (typeof timer.unref === 'function') timer.unref();
}

async function downloadVideo(job) {
    const outPath = path.join(job.jobDir, 'video.mp4');
    const result = await runBl(['video', 'download', '--task-id', job.taskId, '--out', outPath], {
        timeoutMs: 300000,
        entry: job.blEntry,
    });
    if (result.code === 0 && existsSync(outPath)) {
        const info = describeOutputFile(outPath);
        job.status = 'done';
        job.files = info ? [info] : [];
        job.elapsedMs = Date.now() - job.createdAt;
        job.log = tail(cleanLog(result.stdout, result.stderr), 1500);
        return;
    }
    job.status = 'error';
    job.error = {
        code: 'DOWNLOAD_FAILED',
        message: '任务已完成但下载失败：' + (tail(cleanLog(result.stdout, result.stderr), 400) || '无输出'),
    };
}

async function tick() {
    const now = Date.now();
    for (const job of jobs.values()) {
        if (job.status !== 'running') continue;
        if (now > job.deadline) {
            job.status = 'error';
            job.error = {
                code: 'TIMEOUT',
                message: `任务超时（${Math.round((job.deadline - job.createdAt) / 1000)} 秒），worker 已停止轮询；云端任务可能仍在执行`,
            };
            continue;
        }
        if (job.kind !== 'video' || !job.taskId) continue;

        const result = await runBl(['video', 'task', 'get', '--task-id', job.taskId, '--output', 'json'], {
            timeoutMs: 60000,
            entry: job.blEntry,
        });
        const text = cleanLog(result.stdout, result.stderr);
        if (result.code !== 0) continue; // 网络抖动：保留任务，下一轮再查

        const status = parseTaskStatus(text);
        if (status === 'SUCCEEDED') {
            await downloadVideo(job);
        } else if (status === 'FAILED' || status === 'CANCELED' || status === 'CANCELLED') {
            job.status = 'error';
            job.error = parseTaskError(text);
        }
    }
}

/**
 * 提交一个任务并立即返回（视频等 task_id，图片起后台线程）。
 * @returns {Promise<{ ok:boolean, value?:object, error?:{code:string,message:string} }>}
 */
export async function submitJob(options, input) {
    const kind = input?.kind === 'video' ? 'video' : 'image';
    const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
    if (prompt === '') return { ok: false, error: { code: 'BAD_PROMPT', message: '提示词不能为空' } };
    if (prompt.length > 3000) return { ok: false, error: { code: 'BAD_PROMPT', message: '提示词过长（上限 3000 字符）' } };

    const outputRoot = resolveOutputDir(options.outputDir);
    const jobId = makeJobId();
    const jobDir = path.join(outputRoot, jobId);
    try {
        await mkdir(jobDir, { recursive: true });
    } catch (error) {
        return { ok: false, error: { code: 'OUTPUT_DIR', message: `无法创建输出目录：${error?.message ?? error}` } };
    }

    const timeoutSec = kind === 'video' ? (options.videoTimeoutSec ?? 1200) : (options.imageTimeoutSec ?? 300);
    const job = {
        id: jobId,
        kind,
        jobDir,
        status: 'running',
        taskId: null,
        createdAt: Date.now(),
        deadline: Date.now() + timeoutSec * 1000,
        files: [],
        error: null,
        log: '',
        command: '',
        elapsedMs: 0,
        blEntry: options.blEntry,
    };
    jobs.set(jobId, job);
    ensureWorker();

    if (kind === 'video') {
        const built = buildMediaArgs(kind, input, jobDir, options, { async: true });
        job.command = `video ${built.command}`;
        const result = await runBl(built.args, { timeoutMs: 180000, entry: options.blEntry });
        const log = cleanLog(result.stdout, result.stderr);
        job.log = tail(log, 3000);
        if (result.code !== 0) {
            job.status = 'error';
            job.error = { code: 'SUBMIT_FAILED', message: friendlyError(log) };
            return { ok: true, value: snapshot(job) };
        }
        const taskId = parseTaskId(log);
        if (taskId === null) {
            job.status = 'error';
            job.error = { code: 'NO_TASK_ID', message: '提交成功但没拿到 task_id：' + (tail(log, 400) || '无输出') };
            return { ok: true, value: snapshot(job) };
        }
        job.taskId = taskId;
        return { ok: true, value: snapshot(job) };
    }

    // 图片：后台跑一次同步生成，立刻把 job 交回去。
    const built = buildMediaArgs(kind, input, jobDir, options, { async: false });
    job.command = `image ${built.command}`;
    runBl(built.args, { timeoutMs: built.timeoutMs, entry: options.blEntry }).then((result) => {
        const log = cleanLog(result.stdout, result.stderr);
        job.log = tail(log, 4000);
        if (result.timedOut) {
            job.status = 'error';
            job.error = { code: 'TIMEOUT', message: `生成超时（${Math.round(built.timeoutMs / 1000)} 秒）` };
            return;
        }
        if (result.code !== 0) {
            job.status = 'error';
            job.error = { code: 'CLI_FAILED', message: friendlyError(log) };
            return;
        }
        const files = listFilesRecursive(jobDir).map(describeOutputFile).filter(Boolean);
        if (files.length === 0) {
            job.status = 'error';
            job.error = { code: 'NO_OUTPUT', message: 'CLI 执行成功，但任务目录里没有产出文件' };
            return;
        }
        job.status = 'done';
        job.files = files;
        job.elapsedMs = Date.now() - job.createdAt;
    }).catch((error) => {
        job.status = 'error';
        job.error = { code: 'INTERNAL', message: String(error?.message ?? error) };
    });

    return { ok: true, value: snapshot(job) };
}

/** 查询任务快照；未知 jobId 返回 null。 */
export function getJob(id) {
    const job = jobs.get(id);
    return job ? snapshot(job) : null;
}

/** 删除任务（不动磁盘；磁盘清理由 /delete 负责）。 */
export function cancelJob(id) {
    jobs.delete(id);
}

/** 测试/诊断用：当前在跑的任务数。 */
export function pendingJobCount() {
    let count = 0;
    for (const job of jobs.values()) if (job.status === 'running') count += 1;
    return count;
}