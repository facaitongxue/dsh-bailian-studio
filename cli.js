// cli.js — 本机 bailian CLI（bl）调用层。
//
// 设计原则（用户要求：不直接走 API、走 bailian cli）：
//   · 本模块只负责「找到 bl 并用子进程跑它」，不拼 DashScope HTTP 请求；
//   · 输出一律落盘到 outputDir，再由面板的 /file 路由回放，避免二次网络下载；
//   · 子进程继承宿主环境；API Key 由 bl 自己的 Profile（~/.bailian/config.json）管理，
//     本插件不读取、不落盘、不回显任何凭证。

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

/** 与已安装的 bailian skill 家族版本对齐（call attribution 用）。 */
export const BAILIAN_SKILL_VERSION = '2.7.2';
export const API_PREFIX = '/api/bailian-studio';
export const FENCE_HEADER = 'x-dsh-bailian-studio';

const LOG_LIMIT = 12000;

const IMAGE_EXT = new Map([
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.webp', 'image/webp'],
    ['.gif', 'image/gif'],
    ['.bmp', 'image/bmp'],
    ['.svg', 'image/svg+xml'],
]);
const VIDEO_EXT = new Map([
    ['.mp4', 'video/mp4'],
    ['.mov', 'video/quicktime'],
    ['.webm', 'video/webm'],
    ['.mkv', 'video/x-matroska'],
    ['.m4v', 'video/mp4'],
]);

/** 读安装方式文件（npm / binary）。 */
function readInstallMethod() {
    try {
        return readFileSync(path.join(homedir(), '.bailian', 'install-method'), 'utf8').trim().toLowerCase();
    } catch {
        return '';
    }
}

/** Windows 上只认可直接执行的 .exe/.com；POSIX 上只要存在就算。 */
function isExecutableFile(file) {
    if (!existsSync(file)) return false;
    if (process.platform !== 'win32') return true;
    const ext = path.extname(file).toLowerCase();
    return ext === '.exe' || ext === '.com';
}

/** npm 全局安装：bailian-cli/dist/bailian.mjs。 */
function npmEntryCandidates() {
    const list = [];
    const pushFor = (binDir) => list.push(path.join(binDir, 'node_modules', 'bailian-cli', 'dist', 'bailian.mjs'));

    const appData = process.env.APPDATA;
    if (appData) pushFor(path.join(appData, 'npm'));

    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
        if (dir === '') continue;
        if (existsSync(path.join(dir, 'bl.cmd')) || existsSync(path.join(dir, 'bl'))) pushFor(dir);
    }

    const home = homedir();
    list.push(path.join(home, '.npm-global', 'lib', 'node_modules', 'bailian-cli', 'dist', 'bailian.mjs'));
    list.push('/usr/local/lib/node_modules/bailian-cli/dist/bailian.mjs');
    list.push('/opt/homebrew/lib/node_modules/bailian-cli/dist/bailian.mjs');
    return list;
}

/** 官方二进制安装：bl.exe / bin/bl（install-method=binary 时优先）。 */
function binaryCandidates() {
    const list = [];
    const home = homedir();

    if (process.platform === 'win32') {
        const local = process.env.LOCALAPPDATA;
        const roaming = process.env.APPDATA;
        const programFiles = process.env.ProgramFiles;
        const programFiles86 = process.env['ProgramFiles(x86)'];

        if (local) {
            list.push(path.join(local, 'bailian-cli', 'bin', 'bl.exe'));
            list.push(path.join(local, 'Programs', 'bailian-cli', 'bin', 'bl.exe'));
            list.push(path.join(local, 'Programs', 'bailian', 'bin', 'bl.exe'));
        }
        if (roaming) list.push(path.join(roaming, 'bailian-cli', 'bin', 'bl.exe'));
        if (programFiles) list.push(path.join(programFiles, 'bailian-cli', 'bin', 'bl.exe'));
        if (programFiles86) list.push(path.join(programFiles86, 'bailian-cli', 'bin', 'bl.exe'));
        list.push(path.join(home, '.bailian', 'bin', 'bl.exe'));
        list.push(path.join(home, 'bin', 'bl.exe'));

        for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
            if (dir !== '') list.push(path.join(dir, 'bl.exe'));
        }
    } else {
        list.push(path.join(home, '.local', 'bin', 'bl'));
        list.push(path.join(home, '.bailian', 'bin', 'bl'));
        list.push(path.join(home, '.local', 'share', 'bailian-cli', 'bin', 'bl'));
        list.push('/usr/local/bin/bl');
        list.push('/opt/homebrew/bin/bl');
        list.push(path.join(home, 'bin', 'bl'));

        for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
            if (dir !== '') list.push(path.join(dir, 'bl'));
        }
    }
    return list;
}

/**
 * 解析 bl 的启动方式，兼容三种安装：
 *   · 官方二进制（bl.exe / bin/bl，install-method=binary）
 *   · npm 全局（node_modules/bailian-cli/dist/bailian.mjs）
 *   · 只能从 PATH 找 bl（最后兜底）
 * 返回 { mode: 'node'|'exec'|'shim'|'path', target }。
 * 不缓存：用户在 DSH 启动后新装 bl 时，「重新检查」能立刻发现。
 * @param {string} [configured] - 配置里的 blEntry。
 */
export function resolveCliLaunch(configured) {
    if (typeof configured === 'string' && configured.trim() !== '') {
        const resolved = path.resolve(configured);
        if (existsSync(resolved)) {
            const lower = resolved.toLowerCase();
            if (lower.endsWith('.mjs') || lower.endsWith('.js')) return { mode: 'node', target: resolved };
            if (process.platform === 'win32' && (lower.endsWith('.cmd') || lower.endsWith('.bat'))) {
                return { mode: 'shim', target: resolved };
            }
            return { mode: 'exec', target: resolved };
        }
    }

    const method = readInstallMethod();
    const binary = binaryCandidates().find(isExecutableFile) ?? null;
    const npmEntry = npmEntryCandidates().find((file) => existsSync(file)) ?? null;
    const preferBinary = method.startsWith('binary');

    if (preferBinary) {
        if (binary) return { mode: 'exec', target: binary };
        if (npmEntry) return { mode: 'node', target: npmEntry };
    } else {
        if (npmEntry) return { mode: 'node', target: npmEntry };
        if (binary) return { mode: 'exec', target: binary };
    }
    return { mode: 'path', target: 'bl' };
}

/** 供 /health 与工具共用的可用性探测（只读，不触发生成）。 */
export function describeCliRoute(configured) {
    const launch = resolveCliLaunch(configured);
    if (launch.mode === 'node') return { mode: 'node', entry: launch.target };
    if (launch.mode === 'exec') return { mode: 'binary', entry: launch.target };
    if (launch.mode === 'shim') return { mode: 'shim', entry: launch.target };
    return { mode: 'path', entry: null };
}

/** Windows cmd.exe 参数引用（仅在找不到 Node 入口时兜底走 shell）。 */
function quoteForCmd(arg) {
    const text = String(arg);
    if (text !== '' && !/[\s"&|<>^%()!]/.test(text)) return text;
    return `"${text.replaceAll('"', '""')}"`;
}

function clampLog(text) {
    if (text.length <= LOG_LIMIT) return text;
    return `…（前段省略）\n${text.slice(text.length - LOG_LIMIT)}`;
}

/** 子进程输出按需解码：cmd 兜底时 Windows 控制台常是 GBK。 */
function decodeChunks(chunks, preferGbk) {
    if (chunks.length === 0) return '';
    const buffer = Buffer.concat(chunks);
    if (preferGbk) {
        try {
            const text = new TextDecoder('gbk').decode(buffer);
            if (text !== '' && !text.includes('\uFFFD')) return text;
        } catch {
            /* 运行时没有 gbk 解码器时退回 utf8 */
        }
    }
    return buffer.toString('utf8');
}

/**
 * 运行一次 bl 命令。
 * @param {string[]} args - 不含 bl 本身的参数。
 * @param {{ timeoutMs?: number, entry?: string, cwd?: string, extraEnv?: Record<string,string> }} options
 * @returns {Promise<{ code:number|null, signal:string|null, stdout:string, stderr:string, timedOut:boolean, elapsedMs:number, route:string, command:string }>}
 */
export function runBl(args, options = {}) {
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 120000;
    const launch = resolveCliLaunch(options.entry);
    const startedAt = Date.now();

    const env = {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        BAILIAN_CALLER_TYPE: 'agent',
        BAILIAN_CALLER_NAME: 'deepseek-harness',
        BAILIAN_SKILL_NAME: 'bailian-gen',
        BAILIAN_SKILL_VERSION,
        ...(options.extraEnv ?? {}),
    };

    let command;
    let argv;
    let route;

    if (launch.mode === 'node') {
        command = process.execPath;
        argv = [launch.target, ...args];
        route = `node ${launch.target}`;
        if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
    } else if (launch.mode === 'exec') {
        command = launch.target;
        argv = args;
        route = launch.target;
    } else if (launch.mode === 'shim') {
        command = process.env.ComSpec || 'cmd.exe';
        argv = ['/d', '/s', '/c', [launch.target, ...args].map(quoteForCmd).join(' ')];
        route = `cmd ${launch.target}`;
    } else if (process.platform === 'win32') {
        command = process.env.ComSpec || 'cmd.exe';
        argv = ['/d', '/s', '/c', ['bl', ...args].map(quoteForCmd).join(' ')];
        route = 'cmd /c bl';
    } else {
        command = 'bl';
        argv = args;
        route = 'bl';
    }

    return new Promise((resolve) => {
        let settled = false;
        let timedOut = false;
        const outChunks = [];
        const errChunks = [];
        let outBytes = 0;
        let errBytes = 0;
        let child;
        let timer;

        const finish = (code, signal) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const preferGbk = process.platform === 'win32' && route.startsWith('cmd ');
            resolve({
                code,
                signal,
                stdout: clampLog(decodeChunks(outChunks, preferGbk)),
                stderr: clampLog(decodeChunks(errChunks, preferGbk)),
                timedOut,
                elapsedMs: Date.now() - startedAt,
                route,
                command: `${command} ${argv.join(' ')}`.slice(0, 400),
            });
        };

        try {
            child = spawn(command, argv, {
                cwd: options.cwd || process.cwd(),
                env,
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (error) {
            errChunks.push(Buffer.from(`无法启动 bl：${error?.message ?? error}`));
            finish(-1, null);
            return;
        }

        timer = setTimeout(() => {
            timedOut = true;
            try { child.kill('SIGTERM'); } catch { /* 已退出 */ }
            setTimeout(() => {
                try { child.kill('SIGKILL'); } catch { /* 已退出 */ }
            }, 2500);
        }, timeoutMs);

        child.stdout?.on('data', (chunk) => {
            if (outBytes < LOG_LIMIT * 3) {
                outChunks.push(chunk);
                outBytes += chunk.length;
            }
        });
        child.stderr?.on('data', (chunk) => {
            if (errBytes < LOG_LIMIT * 3) {
                errChunks.push(chunk);
                errBytes += chunk.length;
            }
        });
        child.on('error', (error) => {
            errChunks.push(Buffer.from(`\n无法启动 bl：${error?.message ?? error}`));
            finish(-1, null);
        });
        child.on('close', (code, signal) => finish(code, signal));
    });
}

/** 递归列出目录下的常规文件（跳过隐藏目录）。 */
export function listFilesRecursive(dir, depth = 0) {
    if (depth > 6) return [];
    const out = [];
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.startsWith('.')) continue;
            out.push(...listFilesRecursive(full, depth + 1));
        } else if (entry.isFile()) {
            out.push(full);
        }
    }
    return out;
}

/** 文件 → 面板可用的元信息；不在白名单的扩展名返回 null。 */
export function describeOutputFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mime = IMAGE_EXT.get(ext) ?? VIDEO_EXT.get(ext);
    if (mime === undefined) return null;
    let bytes = 0;
    try { bytes = statSync(filePath).size; } catch { /* 忽略 */ }
    return {
        name: path.basename(filePath),
        path: filePath,
        mime,
        kind: mime.startsWith('video/') ? 'video' : 'image',
        bytes,
        url: `${API_PREFIX}/file?p=${encodeURIComponent(filePath)}`,
    };
}

/** 默认输出目录：~/.dsh/bailian-studio/outputs（可被配置覆盖）。 */
export function resolveOutputDir(configured) {
    if (typeof configured === 'string' && configured.trim() !== '') return path.resolve(configured);
    return path.join(homedir(), '.dsh', 'bailian-studio', 'outputs');
}

function makeJobId() {
    const d = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    return `${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

function cleanLog(stdout, stderr) {
    const merged = [stdout, stderr].filter((part) => part.trim() !== '').join('\n').trim();
    // CLI 会把生成的云端临时链接打出来（带签名）。本地文件已经落盘，链接没有保留价值，
    // 统一抹掉，避免把带签名的 OSS URL 泄进模型上下文/面板历史。
    return merged
        .replace(/https?:\/\/[^\s"'<>]*aliyuncs\.com[^\s"'<>]*/g, '[云端临时链接已省略]')
        .replace(/https?:\/\/[^\s"'<>]*\.oss[^\s"'<>]*/g, '[云端临时链接已省略]');
}

function tail(text, max = 1200) {
    if (text.length <= max) return text;
    return `…\n${text.slice(text.length - max)}`;
}

function failure(code, message, extra = {}) {
    return { ok: false, error: { code, message: String(message ?? ''), ...extra } };
}

/**
 * 生成图片或视频（图片/视频都经 bl CLI，落盘到 outputDir 下的独立任务目录）。
 * @param {{ outputDir?:string, blEntry?:string, imageTimeoutSec?:number, videoTimeoutSec?:number }} options
 * @param {{ kind:'image'|'video', prompt:string, model?:string, size?:string, n?:number, duration?:number,
 *           resolution?:string, ratio?:string, watermark?:boolean, negativePrompt?:string,
 *           image?:string, refImages?:string[], refVideos?:string[], seed?:number }} input
 */
export async function generateMedia(options, input) {
    const kind = input?.kind === 'video' ? 'video' : 'image';
    const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
    if (prompt.length === 0) return failure('BAD_PROMPT', '提示词不能为空');
    if (prompt.length > 3000) return failure('BAD_PROMPT', '提示词过长（上限 3000 字符）');

    const outputRoot = resolveOutputDir(options.outputDir);
    const jobId = makeJobId();
    const jobDir = path.join(outputRoot, jobId);
    try {
        await mkdir(jobDir, { recursive: true });
    } catch (error) {
        return failure('OUTPUT_DIR', `无法创建输出目录：${error?.message ?? error}`);
    }

    const watermark = input?.watermark === true;
    const refImages = Array.isArray(input?.refImages)
        ? input.refImages.filter((file) => typeof file === 'string' && file.trim() !== '').map((file) => file.trim())
        : [];
    const refVideos = Array.isArray(input?.refVideos)
        ? input.refVideos.filter((file) => typeof file === 'string' && file.trim() !== '').map((file) => file.trim())
        : [];
    const legacyImage = typeof input?.image === 'string' && input.image.trim() !== '' ? input.image.trim() : '';
    if (kind === 'video' && legacyImage !== '' && refImages.length === 0) refImages.push(legacyImage);

    // 面板里用 @图1 / @视频1 指代素材；CLI 的参考标记是 image1 / video1。
    const hasRefs = refImages.length + refVideos.length > 0;
    const finalPrompt = hasRefs
        ? prompt
            .replace(/@?\s*(?:图片|图)\s*(\d+)/g, 'image$1')
            .replace(/@?\s*视频\s*(\d+)/g, 'video$1')
        : prompt;

    let command;
    let args;
    let timeoutMs;

    if (kind === 'image') {
        command = refImages.length > 0 ? 'edit' : 'generate';
        args = ['image', command, '--prompt', finalPrompt];
        for (const file of refImages) args.push('--image', file);
        args.push('--watermark', watermark ? 'true' : 'false');
        if (typeof input?.model === 'string' && input.model.trim() !== '') args.push('--model', input.model.trim());
        if (typeof input?.negativePrompt === 'string' && input.negativePrompt.trim() !== '') {
            args.push('--negative-prompt', input.negativePrompt.trim());
        }
        if (Number.isInteger(input?.seed)) args.push('--seed', String(input.seed));
        if (typeof input?.size === 'string' && input.size.trim() !== '') args.push('--size', input.size.trim());
        if (Number.isInteger(input?.n) && input.n >= 1 && input.n <= 6) args.push('--n', String(input.n));
        args.push('--out-dir', jobDir, '--out-prefix', 'image');
        timeoutMs = (options.imageTimeoutSec ?? 300) * 1000;
    } else {
        const useRef = refVideos.length > 0 || refImages.length > 1;
        command = useRef ? 'ref' : 'generate';
        args = ['video', command, '--prompt', finalPrompt];
        if (useRef) {
            for (const file of refImages) args.push('--image', file);
            for (const file of refVideos) args.push('--ref-video', file);
        } else if (refImages.length === 1) {
            args.push('--image', refImages[0]);
        }
        args.push('--watermark', watermark ? 'true' : 'false');
        if (typeof input?.model === 'string' && input.model.trim() !== '') args.push('--model', input.model.trim());
        if (typeof input?.negativePrompt === 'string' && input.negativePrompt.trim() !== '') {
            args.push('--negative-prompt', input.negativePrompt.trim());
        }
        if (Number.isInteger(input?.seed)) args.push('--seed', String(input.seed));
        if (typeof input?.resolution === 'string' && input.resolution.trim() !== '') {
            args.push('--resolution', input.resolution.trim());
        }
        if (typeof input?.ratio === 'string' && input.ratio.trim() !== '') args.push('--ratio', input.ratio.trim());
        if (Number.isInteger(input?.duration) && (input.duration === -1 || (input.duration >= 2 && input.duration <= 15))) {
            args.push('--duration', String(input.duration));
        }
        args.push('--download', path.join(jobDir, 'video.mp4'));
        timeoutMs = (options.videoTimeoutSec ?? 1200) * 1000;
    }

    const result = await runBl(args, { timeoutMs, entry: options.blEntry });
    const log = cleanLog(result.stdout, result.stderr);

    if (result.timedOut) {
        return failure('TIMEOUT', `bl ${kind} ${command} 超时（${Math.round(timeoutMs / 1000)} 秒），已终止。任务目录：${jobDir}`, {
            log: tail(log),
            route: result.route,
        });
    }
    if (result.code !== 0) {
        const localUploadBlocked = /Local-file temporary upload is supported only|Token Plan.{0,40}not supported/i.test(log);
        const message = localUploadBlocked
            ? '当前 bailian Profile（Token Plan）不支持把本地文件上传到百炼；参考视频请用「+ 视频链接」填公网 HTTPS 地址，参考图片请改用普通 API Key 的 Profile。'
            : `bl 退出码 ${result.code ?? 'null'}：${tail(log, 600) || '无输出'}`;
        return failure('CLI_FAILED', message, {
            log: tail(log),
            route: result.route,
            jobId,
        });
    }

    const files = listFilesRecursive(jobDir)
        .map(describeOutputFile)
        .filter((file) => file !== null);

    if (files.length === 0) {
        return failure('NO_OUTPUT', 'bl 执行成功，但任务目录里没有可展示的图片/视频文件。', {
            log: tail(log),
            jobId,
            route: result.route,
        });
    }

    return {
        ok: true,
        value: {
            kind,
            command: `${kind} ${command}`,
            jobId,
            jobDir,
            elapsedMs: result.elapsedMs,
            files,
            log: tail(log, 4000),
            route: result.route,
        },
    };
}

/** 只读探活：版本 + 登录态（不读取、不回显任何凭证内容）。 */
export async function probeCli(options = {}) {
    const version = await runBl(['--version'], { timeoutMs: 20000, entry: options.blEntry });
    const versionText = (version.stdout || version.stderr).trim().split(/\r?\n/).pop() ?? '';
    if (version.code !== 0) {
        const pathFallback = version.route === 'cmd /c bl' || version.route === 'bl';
        const hint = pathFallback
            ? '。找不到 bl：DSH 进程的 PATH 可能早于安装（重启 DSH 即可），或在插件配置里把 blEntry 指向 bl.exe / bailian.mjs 的绝对路径'
            : '';
        return failure('CLI_UNAVAILABLE', `bailian CLI 不可用（退出码 ${version.code ?? 'null'}）：${tail(versionText, 300)}${hint}`, {
            route: version.route,
        });
    }

    const auth = await runBl(['auth', 'status'], { timeoutMs: 20000, entry: options.blEntry });
    const authText = cleanLog(auth.stdout, auth.stderr).replace(/\bsk-[A-Za-z0-9._-]{4,}/g, 'sk-***');
    const authed = auth.code === 0 && !/not\s+log(ged)?\s*in|未登录/i.test(authText);

    return {
        ok: true,
        value: {
            version: versionText.replace(/^v/i, ''),
            route: version.route,
            authed,
            authMessage: tail(authText, 600),
            outputDir: resolveOutputDir(options.outputDir),
        },
    };
}

/** 读取输出目录里最近的结果（面板重开后可恢复历史）。 */
export function listRecentOutputs(options = {}, limit = 24) {
    const root = resolveOutputDir(options.outputDir);
    if (!existsSync(root)) return [];
    const uploadRoot = path.join(root, 'uploads');
    const files = listFilesRecursive(root)
        .filter((file) => !path.resolve(file).startsWith(uploadRoot + path.sep))
        .map((file) => {
            const info = describeOutputFile(file);
            if (info === null) return null;
            try {
                info.mtime = statSync(file).mtimeMs;
            } catch {
                info.mtime = 0;
            }
            return info;
        })
        .filter(Boolean)
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, limit);
    return files;
}
