// settings.js — 服务商列表（多服务商，可切换/编辑/删除）。
//
// 每条服务商：{ id, name, mode(auto|bailian|api), apiBaseUrl, apiKey, imageModel, videoModel }
// 只有 activeId 指向的那条参与生成；Key 只落本机 settings.json，接口回显掩码。

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export function settingsFile() {
    return path.join(homedir(), '.dsh', 'bailian-studio', 'settings.json');
}

let cache = null;

function makeId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function normalizeProvider(raw) {
    return {
        id: typeof raw?.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : makeId(),
        name: typeof raw?.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : '未命名服务商',
        mode: raw?.mode === 'api' || raw?.mode === 'bailian' ? raw.mode : 'auto',
        apiBaseUrl: typeof raw?.apiBaseUrl === 'string' ? raw.apiBaseUrl.trim().replace(/\/+$/, '') : '',
        apiKey: typeof raw?.apiKey === 'string' ? raw.apiKey.trim() : '',
        imageModel: typeof raw?.imageModel === 'string' ? raw.imageModel.trim() : '',
        videoModel: typeof raw?.videoModel === 'string' ? raw.videoModel.trim() : '',
    };
}

function normalize(raw) {
    let providers = Array.isArray(raw?.providers) ? raw.providers.map(normalizeProvider) : [];
    if (providers.length === 0 && (raw?.apiKey || raw?.apiBaseUrl || raw?.imageModel || raw?.videoModel)) {
        providers = [normalizeProvider({
            id: 'p-default',
            name: '默认服务商',
            mode: raw?.mode,
            apiBaseUrl: raw?.apiBaseUrl,
            apiKey: raw?.apiKey,
            imageModel: raw?.imageModel,
            videoModel: raw?.videoModel,
        })];
    }
    if (providers.length === 0) {
        providers = [normalizeProvider({ id: 'p-default', name: '默认服务商', mode: 'auto' })];
    }
    const activeId = providers.some((provider) => provider.id === raw?.activeId) ? raw.activeId : providers[0].id;
    return { activeId, providers };
}

export async function loadSettings() {
    if (cache) return cache;
    try {
        cache = normalize(JSON.parse(await readFile(settingsFile(), 'utf8')));
    } catch {
        cache = normalize({});
    }
    return cache;
}

async function persist(next) {
    await mkdir(path.dirname(settingsFile()), { recursive: true });
    await writeFile(settingsFile(), JSON.stringify(next, null, 2), 'utf8');
    cache = next;
    return next;
}

export function activeProvider(settings) {
    return settings.providers.find((provider) => provider.id === settings.activeId) || settings.providers[0] || null;
}

export function maskKey(key) {
    const value = String(key ?? '');
    if (value === '') return '';
    if (value.length <= 8) return value[0] + '****';
    return value.slice(0, 4) + '****' + value.slice(-4);
}

export function publicProvider(provider) {
    return {
        id: provider.id,
        name: provider.name,
        mode: provider.mode,
        apiBaseUrl: provider.apiBaseUrl,
        hasApiKey: provider.apiKey !== '',
        apiKeyMasked: maskKey(provider.apiKey),
        imageModel: provider.imageModel,
        videoModel: provider.videoModel,
    };
}

export function publicSettings(settings) {
    return {
        activeId: settings.activeId,
        providers: settings.providers.map(publicProvider),
    };
}

export async function saveProvider(patch) {
    const settings = await loadSettings();
    const id = typeof patch?.id === 'string' && patch.id !== '' ? patch.id : '';
    const index = settings.providers.findIndex((provider) => provider.id === id);
    const current = index >= 0 ? settings.providers[index] : null;
    const merged = normalizeProvider({
        ...(current ?? {}),
        ...patch,
        id: current ? current.id : (id || makeId()),
        apiKey: typeof patch?.apiKey === 'string' && patch.apiKey.trim() !== ''
            ? patch.apiKey.trim()
            : (patch?.clearApiKey === true ? '' : (current?.apiKey ?? '')),
    });
    if (current) settings.providers[index] = merged;
    else {
        settings.providers.push(merged);
        if (settings.activeId === '' || settings.providers.length === 1) settings.activeId = merged.id;
    }
    return persist(settings);
}

export async function useProvider(id) {
    const settings = await loadSettings();
    if (settings.providers.some((provider) => provider.id === id)) settings.activeId = id;
    return persist(settings);
}

export async function deleteProvider(id) {
    const settings = await loadSettings();
    settings.providers = settings.providers.filter((provider) => provider.id !== id);
    if (settings.providers.length === 0) {
        settings.providers = [normalizeProvider({ id: 'p-default', name: '默认服务商', mode: 'auto' })];
    }
    if (!settings.providers.some((provider) => provider.id === settings.activeId)) {
        settings.activeId = settings.providers[0].id;
    }
    return persist(settings);
}