// server.js — 面板的 HTTP 数据面（/api/bailian-studio/*）。
//
// 只做三件事：探活、触发 bl 生成、回放已落盘的图片/视频。
// 生成动作只经 cli.js → bl 子进程；本文件没有任何 DashScope REST 调用。
//
// 安全口径（与 dsh-xuanji 同款，只对浏览器威胁模型成立）：
//   · Host / Origin 本机白名单（挡 DNS rebinding 与跨站 fetch）；
//   · 写操作要求 fence header（普通跨站页面带不上自定义头）；
//   · /file 只回放 outputDir 之内、白名单扩展名的文件（供 <img>/<video> 直接引用，
//     这两个标签无法附加自定义头，因此该端点用「路径包含校验」而不是 fence）。

import { createReadStream, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { API_PREFIX, FENCE_HEADER, describeCliRoute, describeOutputFile, listRecentOutputs, probeCli, resolveOutputDir } from './cli.js';
import { cancelJob, getJob, submitJob } from './jobs.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']);
const MAX_BODY_BYTES = 64 * 1024;
const MAX_UPLOAD_BYTES = 48 * 1024 * 1024;
const OPENABLE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.mp4', '.mov', '.webm', '.mkv', '.m4v']);
const UPLOAD_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.mp4', '.mov', '.webm', '.mkv', '.m4v']);
const MIME_EXT = new Map([
    ['image/png', '.png'],
    ['image/jpeg', '.jpg'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
    ['image/bmp', '.bmp'],
    ['video/mp4', '.mp4'],
    ['video/quicktime', '.mov'],
    ['video/webm', '.webm'],
    ['video/x-matroska', '.mkv'],
    ['video/x-m4v', '.m4v'],
]);

function writeJson(res, status, value) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(value));
}

function fail(res, status, code, message, extra = {}) {
    writeJson(res, status, { ok: false, error: { code, message: String(message ?? ''), ...extra } });
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        let data = '';
        let size = 0;
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
                req.destroy();
                reject(new Error(`请求体超过 ${Math.round(maxBytes / 1024)}KB 上限`));
                return;
            }
            data += String(chunk);
        });
        req.on('end', () => {
            if (data.trim() === '') {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(data));
            } catch {
                reject(new Error('请求体不是合法 JSON'));
            }
        });
        req.on('error', reject);
    });
}

function hostOf(value) {
    try {
        return new URL(`http://${value}`).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    } catch {
        return '';
    }
}

/** Host / Origin 本机校验（返回错误信息或 null）。 */
function checkLocal(req) {
    const host = hostOf(String(req.headers.host ?? ''));
    if (!LOCAL_HOSTS.has(host)) return `只允许本机访问（Host「${host}」不在白名单）`;

    const origin = req.headers.origin;
    if (origin !== undefined) {
        try {
            const originHost = new URL(String(origin)).hostname.toLowerCase().replace(/^\[|\]$/g, '');
            if (!LOCAL_HOSTS.has(originHost)) return 'Origin 非本机，已拒绝';
        } catch {
            return 'Origin 畸形，已拒绝';
        }
    }
    return null;
}

/** 把查询参数 p 解析成 outputDir 内的真实文件路径；越界返回 null。 */
function resolveServedFile(configuredOutputDir, rawPath) {
    if (typeof rawPath !== 'string' || rawPath.trim() === '') return null;
    const root = path.resolve(resolveOutputDir(configuredOutputDir));
    const target = path.resolve(rawPath);
    const relative = path.relative(root, target);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    try {
        if (!statSync(target).isFile()) return null;
    } catch {
        return null;
    }
    return target;
}

function contentTypeFor(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const table = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.svg': 'image/svg+xml',
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska',
        '.m4v': 'video/mp4',
    };
    return table[ext] ?? 'application/octet-stream';
}

/** 把路径限制在 outputDir 内，返回文件/目录信息；越界或不存在返回 null。 */
function resolveInsideRoot(configuredOutputDir, rawPath, allowDir) {
    if (typeof rawPath !== 'string' || rawPath.trim() === '') return null;
    const root = path.resolve(resolveOutputDir(configuredOutputDir));
    const target = path.resolve(rawPath);
    const relative = path.relative(root, target);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    try {
        const info = statSync(target);
        if (info.isFile()) return { path: target, isDir: false };
        if (allowDir && info.isDirectory()) return { path: target, isDir: true };
    } catch {
        return null;
    }
    return null;
}

/** 启动一个不阻塞的 GUI 程序；失败返回 false，并吞掉 error 事件避免宿主进程崩溃。 */
function spawnDetached(command, args) {
    try {
        const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
        child.on('error', () => { /* 由调用方/日志承担 */ });
        child.unref();
        return true;
    } catch {
        return false;
    }
}

/** 打开文件夹（文件则选中它）。 */
function openFolder(info) {
    if (process.platform === 'win32') {
        // 目录直接传路径（/e,"dir" 在 spawn 下会失败，反而打开「文档」）；
        // 文件用 /select 选中，引号支持空格路径。
        const target = info.isDir ? info.path : `/select,"${info.path}"`;
        if (!spawnDetached('explorer.exe', [target])) throw new Error('无法启动 explorer.exe');
        return;
    }
    if (process.platform === 'darwin') {
        const args = info.isDir ? [info.path] : ['-R', info.path];
        if (!spawnDetached('open', args)) throw new Error('无法启动 open');
        return;
    }
    if (!spawnDetached('xdg-open', [info.isDir ? info.path : path.dirname(info.path)])) {
        throw new Error('无法启动 xdg-open');
    }
}

/** 用系统默认程序打开一个本地媒体文件（视频交给本机播放器）。 */
function openWithSystemPlayer(filePath) {
    if (process.platform === 'win32') {
        // explorer.exe 走 ShellExecute，按文件关联启动默认程序。
        if (!spawnDetached('explorer.exe', [filePath])) throw new Error('无法启动 explorer.exe');
        return;
    }
    const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
    if (!spawnDetached(command, [filePath])) throw new Error(`无法启动 ${command}`);
}

/** 回放文件；支持 Range（视频拖动进度条需要 206）。 */
function serveFile(req, res, filePath) {
    const stat = statSync(filePath);
    const type = contentTypeFor(filePath);
    const range = req.headers.range;

    if (typeof range === 'string') {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (match !== null) {
            const start = match[1] === '' ? null : Number(match[1]);
            const end = match[2] === '' ? null : Number(match[2]);
            let from = start ?? 0;
            let to = end ?? stat.size - 1;
            if (start === null && end !== null) {
                from = Math.max(0, stat.size - end);
                to = stat.size - 1;
            }
            if (Number.isFinite(from) && Number.isFinite(to) && from <= to && from < stat.size) {
                to = Math.min(to, stat.size - 1);
                res.writeHead(206, {
                    'content-type': type,
                    'content-length': to - from + 1,
                    'content-range': `bytes ${from}-${to}/${stat.size}`,
                    'accept-ranges': 'bytes',
                    'cache-control': 'private, max-age=300',
                });
                createReadStream(filePath, { start: from, end: to }).pipe(res);
                return;
            }
        }
    }

    res.writeHead(200, {
        'content-type': type,
        'content-length': stat.size,
        'accept-ranges': 'bytes',
        'cache-control': 'private, max-age=300',
    });
    createReadStream(filePath).pipe(res);
}

/** 把面板上传的 dataUrl 存成 outputDir/uploads/ 下的素材文件。 */
function saveUploadedAsset(config, body) {
    const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl : '';
    const match = /^data:([^;,]+)?;base64,([\s\S]+)$/.exec(dataUrl);
    if (match === null) throw Object.assign(new Error('dataUrl 格式不正确'), { code: 'BAD_DATA_URL' });
    const mime = String(match[1] || body?.mime || '').toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0) throw Object.assign(new Error('素材内容为空'), { code: 'EMPTY_FILE' });
    if (buffer.length > 36 * 1024 * 1024) {
        throw Object.assign(new Error('单个素材不能超过 36MB'), { code: 'TOO_LARGE' });
    }
    const kind = mime.startsWith('video/') ? 'video' : mime.startsWith('image/') ? 'image' : '';
    if (kind === '') throw Object.assign(new Error('只支持图片或视频素材'), { code: 'BAD_MIME' });

    const rawName = typeof body?.name === 'string' ? body.name : '';
    let ext = path.extname(rawName).toLowerCase();
    if (!UPLOAD_EXT.has(ext)) ext = MIME_EXT.get(mime) ?? '';
    if (ext === '') throw Object.assign(new Error('无法识别素材扩展名'), { code: 'BAD_EXT' });

    const base = path.basename(rawName, path.extname(rawName)).replace(/[^\w\u4e00-\u9fa5.-]+/g, '_').slice(0, 40) || 'asset';
    const dir = path.join(resolveOutputDir(config.outputDir), 'uploads');
    mkdirSync(dir, { recursive: true });
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${base}${ext}`;
    const filePath = path.join(dir, fileName);
    writeFileSync(filePath, buffer);
    const info = describeOutputFile(filePath);
    if (info === null) throw Object.assign(new Error('素材落盘失败'), { code: 'STORE_FAILED' });
    return Object.assign(info, { originalName: rawName || fileName });
}

/**
 * 注册 REST 数据面。宿主没有 webServer 服务时这条 fiber 静默 pending，不影响工具。
 * @param {object} ctx - cordis 上下文
 * @param {{ blEntry?:string, outputDir?:string, imageTimeoutSec?:number, videoTimeoutSec?:number }} config
 */
export function registerServerApi(ctx, config) {
    if (typeof ctx.inject !== 'function') return;
    ctx.inject(['webServer'], (wctx) => {
        wctx.effect(() => wctx.webServer.register({
            kind: 'prefix',
            path: API_PREFIX,
            handler: async (req, res) => {
                const localFailure = checkLocal(req);
                if (localFailure !== null) {
                    fail(res, 403, 'FORBIDDEN_HOST', localFailure);
                    return;
                }

                let url;
                try {
                    url = new URL(req.url ?? '/', 'http://127.0.0.1');
                } catch {
                    fail(res, 400, 'BAD_URL', '无法解析请求地址');
                    return;
                }
                const subPath = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, '') || '/';

                if (req.method === 'GET' && subPath === '/health') {
                    try {
                        const probe = await probeCli({ blEntry: config.blEntry, outputDir: config.outputDir });
                        if (!probe.ok) {
                            writeJson(res, 200, { ok: true, value: { available: false, error: probe.error, route: describeCliRoute(config.blEntry) } });
                            return;
                        }
                        writeJson(res, 200, {
                            ok: true,
                            value: {
                                available: true,
                                ...probe.value,
                                outputDir: resolveOutputDir(config.outputDir),
                            },
                        });
                    } catch (error) {
                        fail(res, 500, 'PROBE_FAILED', error?.message ?? String(error));
                    }
                    return;
                }

                if (req.method === 'GET' && subPath === '/recent') {
                    try {
                        writeJson(res, 200, { ok: true, value: { files: listRecentOutputs(config, 24) } });
                    } catch (error) {
                        fail(res, 500, 'RECENT_FAILED', error?.message ?? String(error));
                    }
                    return;
                }

                if (req.method === 'GET' && subPath === '/file') {
                    const filePath = resolveServedFile(config.outputDir, url.searchParams.get('p'));
                    if (filePath === null) {
                        fail(res, 404, 'NOT_FOUND', '文件不在可回放目录内，或不是常规文件');
                        return;
                    }
                    try {
                        serveFile(req, res, filePath);
                    } catch (error) {
                        fail(res, 500, 'READ_FAILED', error?.message ?? String(error));
                    }
                    return;
                }

                if (req.method === 'POST' && subPath === '/open') {
                    if (req.headers[FENCE_HEADER] !== '1') {
                        fail(res, 403, 'FORBIDDEN', `缺少 fence header（${FENCE_HEADER}: 1）`);
                        return;
                    }
                    let body;
                    try {
                        body = await readJsonBody(req);
                    } catch (error) {
                        fail(res, 400, 'BAD_BODY', error?.message ?? String(error));
                        return;
                    }
                    const filePath = resolveServedFile(config.outputDir, body?.path);
                    if (filePath === null) {
                        fail(res, 404, 'NOT_FOUND', '文件不在可回放目录内，或不是常规文件');
                        return;
                    }
                    if (!OPENABLE_EXT.has(path.extname(filePath).toLowerCase())) {
                        fail(res, 400, 'UNSUPPORTED', '只允许用本机播放器打开图片/视频文件');
                        return;
                    }
                    try {
                        openWithSystemPlayer(filePath);
                        writeJson(res, 200, { ok: true, value: { opened: true, path: filePath } });
                    } catch (error) {
                        fail(res, 500, 'OPEN_FAILED', `调用本机播放器失败：${error?.message ?? error}`);
                    }
                    return;
                }

                if (req.method === 'POST' && subPath === '/upload') {
                    if (req.headers[FENCE_HEADER] !== '1') {
                        fail(res, 403, 'FORBIDDEN', `缺少 fence header（${FENCE_HEADER}: 1）`);
                        return;
                    }
                    let body;
                    try {
                        body = await readJsonBody(req, MAX_UPLOAD_BYTES);
                    } catch (error) {
                        fail(res, 413, 'TOO_LARGE', error?.message ?? String(error));
                        return;
                    }
                    try {
                        const asset = saveUploadedAsset(config, body);
                        writeJson(res, 200, { ok: true, value: asset });
                    } catch (error) {
                        fail(res, 400, error?.code ?? 'UPLOAD_FAILED', error?.message ?? String(error));
                    }
                    return;
                }

                if (req.method === 'POST' && subPath === '/reveal') {
                    if (req.headers[FENCE_HEADER] !== '1') {
                        fail(res, 403, 'FORBIDDEN', `缺少 fence header（${FENCE_HEADER}: 1）`);
                        return;
                    }
                    let body;
                    try {
                        body = await readJsonBody(req);
                    } catch (error) {
                        fail(res, 400, 'BAD_BODY', error?.message ?? String(error));
                        return;
                    }
                    const info = resolveInsideRoot(config.outputDir, body?.path, true);
                    if (info === null) {
                        fail(res, 404, 'NOT_FOUND', '路径不在输出目录内，或不存在');
                        return;
                    }
                    try {
                        openFolder(info);
                        writeJson(res, 200, { ok: true, value: { path: info.path } });
                    } catch (error) {
                        fail(res, 500, 'REVEAL_FAILED', `打开文件夹失败：${error?.message ?? error}`);
                    }
                    return;
                }

                if (req.method === 'POST' && subPath === '/delete') {
                    if (req.headers[FENCE_HEADER] !== '1') {
                        fail(res, 403, 'FORBIDDEN', `缺少 fence header（${FENCE_HEADER}: 1）`);
                        return;
                    }
                    let body;
                    try {
                        body = await readJsonBody(req);
                    } catch (error) {
                        fail(res, 400, 'BAD_BODY', error?.message ?? String(error));
                        return;
                    }
                    const root = path.resolve(resolveOutputDir(config.outputDir));
                    if (typeof body?.jobId === 'string' && body.jobId !== '') cancelJob(body.jobId);
                    const uploadsDir = path.join(root, 'uploads');
                    const removed = [];
                    const jobInfo = body?.jobDir ? resolveInsideRoot(config.outputDir, body.jobDir, true) : null;
                    if (jobInfo !== null && path.resolve(jobInfo.path) !== uploadsDir) {
                        rmSync(jobInfo.path, { recursive: true, force: true });
                        removed.push(jobInfo.path);
                    } else {
                        const files = Array.isArray(body?.files) ? body.files : [];
                        for (const file of files) {
                            const info = resolveInsideRoot(config.outputDir, file, false);
                            if (info === null) continue;
                            rmSync(info.path, { force: true });
                            removed.push(info.path);
                        }
                    }
                    if (removed.length === 0) {
                        fail(res, 404, 'NOT_FOUND', '没有可删除的文件');
                        return;
                    }
                    writeJson(res, 200, { ok: true, value: { removed } });
                    return;
                }

                if (req.method === 'GET' && subPath === '/job') {
                    const id = url.searchParams.get('id') || '';
                    const job = getJob(id);
                    if (job === null) {
                        fail(res, 404, 'NOT_FOUND', '任务不存在，或宿主重启后内存任务已丢失');
                        return;
                    }
                    writeJson(res, 200, { ok: true, value: job });
                    return;
                }

                if (req.method === 'POST' && subPath === '/generate') {
                    if (req.headers[FENCE_HEADER] !== '1') {
                        fail(res, 403, 'FORBIDDEN', `缺少 fence header（${FENCE_HEADER}: 1）`);
                        return;
                    }
                    let body;
                    try {
                        body = await readJsonBody(req);
                    } catch (error) {
                        fail(res, 400, 'BAD_BODY', error?.message ?? String(error));
                        return;
                    }
                    try {
                        const result = await submitJob(config, body);
                        if (result.ok) writeJson(res, 200, result);
                        else writeJson(res, 400, result);
                    } catch (error) {
                        fail(res, 500, 'SUBMIT_FAILED', error?.message ?? String(error));
                    }
                    return;
                }

                fail(res, 404, 'NOT_FOUND', `未知端点 ${req.method} ${subPath}`);
            },
        }), 'dsh-bailian-studio: http-api');
    });
}
