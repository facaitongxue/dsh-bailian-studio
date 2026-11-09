// models.js — 模型目录：百炼走 `bl model list`（IG/VG 过滤），API 走 /models。
//
// 说明：市场目录里给的是「模型族」名称；生成时常用具体版本 ID，所以下拉里
// 把常用可用 ID 放在前面，目录族名作为补充展示（两者都可选）。

import { runBl } from './cli.js';

export const CURATED = {
    image: [
        { id: 'qwen-image-3.0', name: 'Qwen-Image-3.0' },
        { id: 'wan2.7-image', name: 'Wan2.7-Image' },
        { id: 'wan2.6-t2i', name: 'Wan2.6-T2I' },
        { id: 'wan2.6-image', name: 'Wan2.6-Image' },
        { id: 'z-image-turbo', name: 'Z-Image-Turbo' },
        { id: 'wanx2.1-t2i-turbo', name: 'Wanx2.1-T2I-Turbo' },
    ],
    video: [
        { id: 'wan3.0-video', name: 'Wan3.0-Video' },
        { id: 'happyhorse-1.1-t2v', name: 'HappyHorse-1.1-T2V' },
        { id: 'wan2.6-t2v', name: 'Wan2.6-T2V' },
        { id: 'wan2.6-i2v', name: 'Wan2.6-I2V' },
        { id: 'wan2.5-i2v-preview', name: 'Wan2.5-I2V' },
        { id: 'wan2.1-t2v-plus', name: 'Wan2.1-T2V-Plus' },
    ],
};

const CACHE_MS = 5 * 60 * 1000;
let blCache = null; // { at, catalog: {image:[], video:[]} }
let apiCache = null; // { at, key, catalog }

function parseJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/** 拉 3 页市场目录，按 IG/VG 过滤。 */
async function fetchBlCatalog(entry) {
    if (blCache && Date.now() - blCache.at < CACHE_MS) return blCache.catalog;
    const catalog = { image: [], video: [] };
    const seen = new Set();
    for (let page = 1; page <= 3; page += 1) {
        const result = await runBl(
            ['model', 'list', '--page', String(page), '--page-size', '50', '--output', 'json'],
            { timeoutMs: 45000, entry, fullOutput: true },
        );
        if (result.code !== 0) continue;
        const data = parseJson(result.stdout);
        const items = Array.isArray(data?.items) ? data.items : [];
        if (items.length === 0) break;
        for (const item of items) {
            const caps = Array.isArray(item?.capabilities) ? item.capabilities : [];
            const kind = caps.includes('VG') ? 'video' : caps.includes('IG') ? 'image' : '';
            if (kind === '' || !item?.model || seen.has(kind + ':' + item.model)) continue;
            seen.add(kind + ':' + item.model);
            catalog[kind].push({ id: item.model, name: (item.name || item.model) + '（目录）', family: true });
        }
    }
    blCache = { at: Date.now(), catalog };
    return catalog;
}

/** OpenAI 兼容 /models；失败返回空。 */
async function fetchApiCatalog(settings) {
    const key = settings.apiBaseUrl + '|' + settings.apiKey;
    if (apiCache && apiCache.key === key && Date.now() - apiCache.at < CACHE_MS) return apiCache.catalog;
    const catalog = { image: [], video: [] };
    try {
        const base = settings.apiBaseUrl.replace(/\/+$/, '');
        const response = await fetch(`${base}/models`, {
            headers: { authorization: `Bearer ${settings.apiKey}` },
            signal: AbortSignal.timeout(15000),
        });
        if (response.ok) {
            const data = await response.json();
            const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.models) ? data.models : [];
            for (const item of list) {
                const id = typeof item === 'string' ? item : item?.id || item?.model;
                if (!id) continue;
                const kind = /video|t2v|i2v|r2v/i.test(id) ? 'video' : /image|t2i|i2i|img/i.test(id) ? 'image' : '';
                if (kind !== '') catalog[kind].push({ id, name: item?.name || id, family: false });
            }
        }
    } catch {
        /* 网络不可用：回退到配置模型 */
    }
    apiCache = { at: Date.now(), key, catalog };
    return catalog;
}

function dedupe(list) {
    const seen = new Set();
    const out = [];
    for (const item of list) {
        if (!item?.id || seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
    }
    return out;
}

/**
 * @param {'image'|'video'} kind
 * @param {{ mode:'bailian'|'api', settings:object, blEntry?:string }} context
 */
export async function listModels(kind, context) {
    const base = CURATED[kind] || [];
    if (context.mode === 'api') {
        const catalog = await fetchApiCatalog(context.settings);
        const configured = kind === 'image' ? context.settings.imageModel : context.settings.videoModel;
        const configuredItem = configured ? [{ id: configured, name: configured + '（已配置）' }] : [];
        return {
            source: 'api',
            models: dedupe([...configuredItem, ...catalog[kind], ...base]),
        };
    }
    const catalog = await fetchBlCatalog(context.blEntry);
    return {
        source: 'bl',
        models: dedupe([...base, ...catalog[kind]]),
    };
}