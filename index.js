// index.js — dsh-bailian-studio 宿主入口（cordis 插件）。
//
// 装载做两件事：
//   ① 注册 bailian_studio 工具（与面板共用同一条 bl 子进程链路）；
//   ② 注册面板 REST 数据面 /api/bailian-studio/*（宿主没有 webServer 时静默 pending）。
//
// 不注册系统提示：工具描述已经说明「何时用、会计费」，避免重复占用上下文。

import { registerServerApi } from './server.js';
import { defineBailianTool } from './tool.js';

/** Cordis 插件名——必须与 cordis.patch.yml 的行 id、package.json 的 name 一致。 */
export const name = 'dsh-bailian-studio';

/** 依赖的宿主服务：工具注册表。 */
export const inject = ['tools'];

const DEFAULTS = {
    blEntry: '',
    outputDir: '',
    imageTimeoutSec: 300,
    videoTimeoutSec: 1200,
};

function normalizeConfig(raw) {
    const config = { ...DEFAULTS, ...(raw ?? {}) };
    config.blEntry = typeof config.blEntry === 'string' ? config.blEntry.trim() : '';
    config.outputDir = typeof config.outputDir === 'string' ? config.outputDir.trim() : '';
    const image = Number(config.imageTimeoutSec);
    const video = Number(config.videoTimeoutSec);
    config.imageTimeoutSec = Number.isFinite(image) ? Math.min(1800, Math.max(30, image)) : DEFAULTS.imageTimeoutSec;
    config.videoTimeoutSec = Number.isFinite(video) ? Math.min(3600, Math.max(60, video)) : DEFAULTS.videoTimeoutSec;
    return config;
}

export function apply(ctx, rawConfig) {
    const config = normalizeConfig(rawConfig);

    process.stderr.write(
        `[dsh-bailian-studio] 已装载：右侧栏面板 + bailian_studio 工具，生成走本机 bl CLI（不直连 REST API）。\n`,
    );

    ctx.tools.register(defineBailianTool(ctx, config));

    try {
        registerServerApi(ctx, config);
    } catch (error) {
        process.stderr.write(`[dsh-bailian-studio] 面板数据面注册失败（工具不受影响）：${error?.message ?? error}\n`);
    }
}
