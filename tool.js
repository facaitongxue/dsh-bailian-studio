// tool.js — 模型可调用的 bailian_studio 工具（与面板共用 cli.js 的同一条 bl 链路）。
//
// 工具存在的意义：
//   ① 让 Agent 也能「按用户要求生成一张图 / 一段视频」并拿到本地文件路径；
//   ② 给面板之外的调用方（含自检）一条不依赖浏览器的入口；
//   ③ 两条路径共用 generateMedia，避免 UI 与工具各写一套命令。

import { defineTool as hostDefineTool } from '@deepseek-ai/dsh-tools';
import { BAILIAN_SKILL_VERSION, API_PREFIX, generateMedia, probeCli, resolveOutputDir } from './cli.js';

/** 兼容垫片：宿主只读 output.render；参数表非空时拒绝未知字段。 */
function defineTool(options) {
    const { render, presentationMeta, ...rest } = options;
    if (rest.output !== undefined) {
        const out = { ...rest.output };
        if (render !== undefined && out.render === undefined) out.render = render;
        if (presentationMeta !== undefined && out.presentationMeta === undefined) out.presentationMeta = presentationMeta;
        rest.output = out;
    }
    if (typeof rest.execute === 'function' && rest.parameters && Object.keys(rest.parameters).length > 0) {
        const allowed = new Set(Object.keys(rest.parameters));
        const userExecute = rest.execute;
        rest.execute = (args, exec) => {
            const unknown = Object.keys(args ?? {}).filter((key) => !allowed.has(key));
            if (unknown.length > 0) {
                throw new Error(`无效参数（未知字段）：${unknown.join('、')}；可用参数：${[...allowed].join('、')}`);
            }
            return userExecute(args, exec);
        };
    }
    return typeof hostDefineTool === 'function' ? hostDefineTool(rest) : rest;
}

function textBlock(text) {
    return [{ type: 'text', text }];
}

function formatFiles(files) {
    return files.map((file) => `· ${file.name}（${Math.round(file.bytes / 1024)} KB）→ ${file.path}`).join('\n');
}

/**
 * @param {object} ctx - cordis 上下文（保留给未来按会话取 cwd）
 * @param {{ blEntry?:string, outputDir?:string, imageTimeoutSec?:number, videoTimeoutSec?:number }} config
 */
export function defineBailianTool(ctx, config) {
    return defineTool({
        name: 'bailian_studio',
        description: [
            '通过本机 bailian CLI（`bl`）生成图片或视频，并把结果落盘到本机（不直接调用 DashScope REST API）。',
            'action=status：检查 bl 是否可用、是否已登录（只读，不产生费用）。',
            'action=image：文生图（默认模型跟随 bl 的 Profile；可指定 size/n/model）。',
            'action=video：文生视频或图生视频（可指定 image 本地路径/URL、duration/resolution/ratio）。',
            '生成会按百炼实际用量计费；用户明确要求生成时再调用，不要为「试试」而调用。',
            '返回 JSON 里 files[].path 是本地绝对路径，files[].url 是面板可回放的地址。',
        ].join(''),
        parameters: {
            action: {
                type: 'string',
                enum: ['status', 'image', 'video'],
                description: 'status=探活；image=文生图；video=文/图生视频。',
            },
            prompt: { type: 'string', description: '生成内容描述（action=image/video 必填）。' },
            model: { type: 'string', description: '模型 ID；留空跟随 bl Profile 的默认模型。' },
            size: { type: 'string', description: '图片尺寸/比例，如 1:1、16:9、1024*1024。' },
            n: { type: 'number', description: '图片张数（1–6，默认 1）。' },
            duration: { type: 'number', description: '视频秒数（2–15），或 -1 表示由模型按提示词里的口播长度决定。' },
            resolution: { type: 'string', enum: ['720P', '1080P'], description: '视频分辨率。' },
            ratio: { type: 'string', description: '视频比例，如 16:9、9:16、1:1。' },
            watermark: { type: 'boolean', description: '是否加水印；默认 false。' },
            negativePrompt: { type: 'string', description: '反向提示词。' },
            image: { type: 'string', description: '图生视频的输入图（本地路径或公网 URL）。' },
            refImages: { type: 'array', items: { type: 'string' }, description: '参考图片本地路径/URL（可多张；图片编辑或视频主体参考）。' },
            refVideos: { type: 'array', items: { type: 'string' }, description: '参考视频本地路径/URL（参考生视频）。' },
            seed: { type: 'number', description: '随机种子（可选）。' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: true,
                properties: {
                    ok: { type: 'boolean' },
                    value: { type: 'object', additionalProperties: true },
                    error: { type: 'object', additionalProperties: true },
                },
            },
        },
        isConcurrencySafe: false,
        async execute(args) {
            const action = args?.action ?? 'status';
            if (action === 'status') {
                const result = await probeCli(config);
                return result.ok ? { ok: true, value: { ...result.value, skillVersion: BAILIAN_SKILL_VERSION } } : result;
            }
            if (action !== 'image' && action !== 'video') {
                return { ok: false, error: { code: 'BAD_ACTION', message: `未知 action：${action}` } };
            }
            if (typeof args?.prompt !== 'string' || args.prompt.trim() === '') {
                return { ok: false, error: { code: 'BAD_PROMPT', message: '缺少 prompt：请先向用户确认要生成什么，不要自行编造。' } };
            }
            return generateMedia(config, {
                kind: action,
                prompt: args.prompt,
                model: args.model,
                size: args.size,
                n: args.n,
                duration: args.duration,
                resolution: args.resolution,
                ratio: args.ratio,
                watermark: args.watermark,
                negativePrompt: args.negativePrompt,
                image: args.image,
                refImages: args.refImages,
                refVideos: args.refVideos,
                seed: args.seed,
            });
        },
        render: (_args, value) => {
            if (value?.ok === true && value.value?.files) {
                const v = value.value;
                const lines = [
                    `【百炼创作台】${v.kind === 'video' ? '视频' : '图片'}生成完成（${Math.round(v.elapsedMs / 1000)} 秒）`,
                    formatFiles(v.files),
                    `输出目录：${v.jobDir}`,
                    `回放入口：${API_PREFIX}/file?p=<文件路径>` ,
                    v.log ? `\n— bl 日志 —\n${v.log}` : '',
                ];
                return textBlock(lines.filter(Boolean).join('\n'));
            }
            if (value?.ok === true && value.value?.version) {
                const v = value.value;
                return textBlock([
                    '【百炼创作台】bl 探活',
                    `版本：${v.version}`,
                    `登录态：${v.authed ? '已登录' : '未登录或登录态不明'}`,
                    v.authMessage ? `auth status：${v.authMessage}` : '',
                    `输出目录：${resolveOutputDir(config.outputDir)}`,
                ].filter(Boolean).join('\n'));
            }
            const error = value?.error ?? { code: 'UNKNOWN', message: '未知失败' };
            return textBlock(`【百炼创作台】失败（${error.code}）：${error.message}${error.log ? `\n\n— bl 日志 —\n${error.log}` : ''}`);
        },
    });
}
