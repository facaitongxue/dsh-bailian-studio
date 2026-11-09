// client.js — 右侧栏「百炼创作台」客户端模块（经典脚本，由 dsh client-modules 作为 CJS factory 执行）。
//
// 只做 UI 与 fetch：
//   · 生成请求发往宿主插件注册的 /api/bailian-studio/*；
//   · 真正的 bl 调用在宿主侧（server.js → cli.js），浏览器不碰任何 DashScope 凭证；
//   · 视频预览走 /open，由宿主调用本机默认播放器。

window.__ModuleLoader__.load({
  id: 'dsh-bailian-studio',
  factory(require) {
    const React = require('react');
    const e = React.createElement;

    const API = '/api/bailian-studio';
    const FENCE = 'x-dsh-bailian-studio';
    const TAB_ID = 'dsh-bailian-studio';
    const TAB_KIND = 'bailian-studio';
    const RECORD_KEY = 'dsh-bailian-studio.records.v1';
    const LEGACY_HISTORY_KEY = 'dsh-bailian-studio.history.v1';
    const FORM_KEY = 'dsh-bailian-studio.form.v1';
    const SIDEBAR_KEY = 'dsh-bailian-studio.sidebar.v1';
    const RECORD_MAX = 60;
    const PROMPT_MAX_HEIGHT = 300;

    function loadFormSettings() {
      try {
        const value = JSON.parse(window.localStorage.getItem(FORM_KEY));
        return value && typeof value === 'object' ? value : {};
      } catch (error) {
        return {};
      }
    }

    function readSidebarVisible() {
      try {
        return window.localStorage.getItem(SIDEBAR_KEY) !== '0';
      } catch (error) {
        return true;
      }
    }

    const IMAGE_MODELS = [
      { value: '', label: '跟随 Profile 默认' },
      { value: 'wan2.7-image', label: 'wan2.7-image' },
      { value: 'qwen-image-3.0', label: 'qwen-image-3.0' },
      { value: 'wan2.6-t2i', label: 'wan2.6-t2i' },
    ];
    const VIDEO_MODELS = [
      { value: '', label: '跟随 Profile 默认' },
      { value: 'happyhorse-1.1-t2v', label: 'happyhorse-1.1-t2v' },
      { value: 'wan3.0-video', label: 'wan3.0-video' },
      { value: 'wan2.6-t2v', label: 'wan2.6-t2v' },
    ];

    const CSS = `
[data-dsh-bailian-studio] {
  --bs-surface: color-mix(in srgb, currentColor 6%, transparent);
  --bs-surface-2: color-mix(in srgb, currentColor 10%, transparent);
  --bs-border: color-mix(in srgb, currentColor 14%, transparent);
  --bs-border-strong: color-mix(in srgb, currentColor 24%, transparent);
  --bs-muted: color-mix(in srgb, currentColor 62%, transparent);
  --bs-faint: color-mix(in srgb, currentColor 42%, transparent);
  --bs-accent: #ff7a45;
  --bs-accent-2: #e04e12;
  --bs-ok: #3fb950;
  --bs-warn: #d29922;
  --bs-danger: #e5484d;
  --bs-r: 10px;
  color: inherit;
  font: 13px/1.55 "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", sans-serif;
}
[data-dsh-bailian-studio] * { box-sizing: border-box; }
[data-dsh-bailian-studio] .bs-root {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  overflow: auto;
  padding: 12px 12px 22px;
}
[data-dsh-bailian-studio] .bs-head { display: flex; align-items: center; gap: 8px; min-height: 24px; }
[data-dsh-bailian-studio] .bs-title { font-weight: 650; font-size: 14px; letter-spacing: .2px; }
[data-dsh-bailian-studio] .bs-status { margin-left: auto; display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--bs-muted); white-space: nowrap; }
[data-dsh-bailian-studio] .bs-dot { width: 7px; height: 7px; border-radius: 999px; background: var(--bs-faint); flex: none; }
[data-dsh-bailian-studio] .bs-dot.ok { background: var(--bs-ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--bs-ok) 22%, transparent); }
[data-dsh-bailian-studio] .bs-dot.bad { background: var(--bs-warn); box-shadow: 0 0 0 3px color-mix(in srgb, var(--bs-warn) 20%, transparent); }
[data-dsh-bailian-studio] .bs-iconbtn {
  appearance: none; border: 0; background: transparent; color: var(--bs-muted);
  width: 24px; height: 24px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; padding: 0;
}
[data-dsh-bailian-studio] .bs-iconbtn:hover { background: var(--bs-surface-2); color: inherit; }
[data-dsh-bailian-studio] .bs-seg {
  display: grid; grid-template-columns: 1fr 1fr; gap: 3px; padding: 3px;
  background: var(--bs-surface); border: 1px solid var(--bs-border); border-radius: 999px;
}
[data-dsh-bailian-studio] .bs-seg.three { grid-template-columns: 1fr 1fr 1fr; }
[data-dsh-bailian-studio] .bs-seg button {
  appearance: none; border: 0; background: transparent; color: var(--bs-muted); cursor: pointer;
  padding: 5px 8px; border-radius: 999px; font: inherit; font-size: 12px; transition: background .16s, color .16s;
}
[data-dsh-bailian-studio] .bs-seg button.on { background: var(--bs-accent); color: #fff; font-weight: 600; }
[data-dsh-bailian-studio] .bs-seg button:disabled { cursor: default; opacity: .55; }
[data-dsh-bailian-studio] .bs-form { display: flex; flex-direction: column; gap: 12px; }
[data-dsh-bailian-studio] .bs-field { display: flex; flex-direction: column; gap: 6px; }
[data-dsh-bailian-studio] .bs-label { font-size: 11px; color: var(--bs-muted); display: flex; align-items: center; gap: 6px; }
[data-dsh-bailian-studio] .bs-label b { font-weight: 500; color: var(--bs-faint); }
[data-dsh-bailian-studio] textarea.bs-prompt {
  width: 100%; min-height: 64px; max-height: 300px; resize: none; overflow-y: auto;
  border: 1px solid var(--bs-border); background: var(--bs-surface); color: inherit;
  border-radius: var(--bs-r); padding: 9px 10px; font: inherit; line-height: 1.55; outline: none;
}
[data-dsh-bailian-studio] textarea.bs-prompt:focus { border-color: var(--bs-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--bs-accent) 18%, transparent); }
[data-dsh-bailian-studio] .bs-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
[data-dsh-bailian-studio] .bs-row.three { grid-template-columns: 1fr 1fr 1fr; }
[data-dsh-bailian-studio] .bs-select, [data-dsh-bailian-studio] .bs-input {
  width: 100%; min-width: 0; border: 1px solid var(--bs-border); background: var(--bs-surface); color: inherit;
  border-radius: 8px; padding: 6px 8px; font: inherit; font-size: 12px; outline: none;
}
[data-dsh-bailian-studio] .bs-select:focus, [data-dsh-bailian-studio] .bs-input:focus { border-color: var(--bs-accent); }
[data-dsh-bailian-studio] .bs-check { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--bs-muted); cursor: pointer; user-select: none; }
[data-dsh-bailian-studio] .bs-check input { accent-color: var(--bs-accent); }
[data-dsh-bailian-studio] .bs-btn {
  appearance: none; border: 1px solid transparent; border-radius: 9px; cursor: pointer;
  padding: 9px 12px; font: inherit; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; gap: 7px;
  transition: filter .16s, background .16s, opacity .16s;
}
[data-dsh-bailian-studio] .bs-btn.primary { background: linear-gradient(135deg, var(--bs-accent), var(--bs-accent-2)); color: #fff; width: 100%; }
[data-dsh-bailian-studio] .bs-btn.primary:hover:not(:disabled) { filter: brightness(1.05); }
[data-dsh-bailian-studio] .bs-btn.primary:disabled { opacity: .5; cursor: not-allowed; }
[data-dsh-bailian-studio] .bs-btn.ghost { background: transparent; border-color: var(--bs-border); color: var(--bs-muted); font-weight: 500; font-size: 12px; padding: 5px 9px; }
[data-dsh-bailian-studio] .bs-btn.ghost:hover { background: var(--bs-surface); color: inherit; }
[data-dsh-bailian-studio] .bs-progress { display: flex; align-items: center; gap: 9px; font-size: 12px; color: var(--bs-muted); }
[data-dsh-bailian-studio] .bs-bar { flex: 1; height: 3px; border-radius: 999px; overflow: hidden; background: var(--bs-surface-2); position: relative; }
[data-dsh-bailian-studio] .bs-bar::after {
  content: ""; position: absolute; inset: 0; width: 38%; border-radius: 999px;
  background: linear-gradient(90deg, transparent, var(--bs-accent), transparent);
  animation: bs-slide 1.35s ease-in-out infinite;
}
@keyframes bs-slide { 0% { transform: translateX(-110%); } 100% { transform: translateX(320%); } }
[data-dsh-bailian-studio] .bs-note { font-size: 11px; color: var(--bs-faint); line-height: 1.5; }
[data-dsh-bailian-studio] .bs-toast {
  border: 1px solid color-mix(in srgb, var(--bs-warn) 45%, transparent);
  background: color-mix(in srgb, var(--bs-warn) 12%, transparent);
  border-radius: 9px; padding: 7px 9px; font-size: 11px; color: inherit;
}
[data-dsh-bailian-studio] .bs-error {
  border: 1px solid color-mix(in srgb, var(--bs-danger) 45%, transparent);
  background: color-mix(in srgb, var(--bs-danger) 10%, transparent);
  border-radius: var(--bs-r); padding: 9px 10px; font-size: 12px; color: inherit;
}
[data-dsh-bailian-studio] .bs-error pre {
  margin: 7px 0 0; max-height: 160px; overflow: auto; white-space: pre-wrap; word-break: break-word;
  font: 11px/1.5 ui-monospace, "Cascadia Mono", Consolas, monospace; color: var(--bs-muted);
}
[data-dsh-bailian-studio] .bs-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 8px; }
[data-dsh-bailian-studio] .bs-thumb {
  appearance: none; border: 1px solid var(--bs-border); background: var(--bs-surface); border-radius: 9px; padding: 0;
  overflow: hidden; cursor: zoom-in; aspect-ratio: 1; display: block;
}
[data-dsh-bailian-studio] .bs-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
[data-dsh-bailian-studio] .bs-video { width: 100%; border-radius: 9px; background: #000; display: block; }
[data-dsh-bailian-studio] .bs-video-card {
  position: relative; border: 1px solid var(--bs-border); border-radius: 10px; overflow: hidden; cursor: pointer; background: #000;
}
[data-dsh-bailian-studio] .bs-video-thumb { width: 100%; max-height: 220px; display: block; object-fit: cover; opacity: .82; }
[data-dsh-bailian-studio] .bs-video-overlay {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; gap: 6px;
  color: #fff; font-size: 11px; background: linear-gradient(180deg, transparent 30%, rgba(0,0,0,.55));
  text-shadow: 0 1px 2px rgba(0,0,0,.5);
}
[data-dsh-bailian-studio] .bs-play {
  width: 30px; height: 30px; border-radius: 50%; background: rgba(0,0,0,.55);
  border: 1px solid rgba(255,255,255,.5); display: flex; align-items: center; justify-content: center; font-size: 12px; padding-left: 2px;
}
[data-dsh-bailian-studio] .bs-video-meta {
  display: flex; align-items: center; gap: 8px; justify-content: space-between;
  padding: 6px 8px; background: var(--bs-surface); font-size: 10px; color: var(--bs-muted);
}
[data-dsh-bailian-studio] .bs-video-meta > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-dsh-bailian-studio] .bs-filemeta { display: flex; align-items: center; gap: 8px; font-size: 11px; color: var(--bs-muted); flex-wrap: wrap; }
[data-dsh-bailian-studio] .bs-filemeta a { color: var(--bs-accent); text-decoration: none; }
[data-dsh-bailian-studio] .bs-filemeta a:hover { text-decoration: underline; }
[data-dsh-bailian-studio] .bs-records { display: flex; flex-direction: column; gap: 8px; }
[data-dsh-bailian-studio] .bs-records-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 11px; color: var(--bs-muted); }
[data-dsh-bailian-studio] .bs-table-wrap { overflow: hidden; border: 1px solid var(--bs-border); border-radius: 9px; }
[data-dsh-bailian-studio] .bs-table-head, [data-dsh-bailian-studio] .bs-table-row {
  display: flex; align-items: center; gap: 6px; padding: 6px 7px; font-size: 11px; width: 100%; min-width: 0;
}
[data-dsh-bailian-studio] .bs-table-head {
  color: var(--bs-faint); font-size: 10px; background: var(--bs-surface); border-bottom: 1px solid var(--bs-border);
}
[data-dsh-bailian-studio] .bs-table-row {
  appearance: none; border: 0; border-bottom: 1px solid var(--bs-border); background: transparent;
  color: inherit; font: inherit; text-align: left; cursor: pointer;
}
[data-dsh-bailian-studio] .bs-table-row:last-child { border-bottom: 0; }
[data-dsh-bailian-studio] .bs-table-row:hover { background: var(--bs-surface); }
[data-dsh-bailian-studio] .bs-table-head .c-time, [data-dsh-bailian-studio] .bs-table-head .c-kind,
[data-dsh-bailian-studio] .bs-table-head .c-status, [data-dsh-bailian-studio] .bs-table-head .prompt-cell,
[data-dsh-bailian-studio] .bs-table-row .c-time, [data-dsh-bailian-studio] .bs-table-row .c-kind,
[data-dsh-bailian-studio] .bs-table-row .c-status, [data-dsh-bailian-studio] .bs-table-row .prompt-cell {
  flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
[data-dsh-bailian-studio] .bs-table-row .c-time { color: var(--bs-muted); font-size: 9px; }
[data-dsh-bailian-studio] .bs-table-head .c-files, [data-dsh-bailian-studio] .bs-table-row .c-files { flex: none; width: 38px; text-align: right; color: var(--bs-muted); }
[data-dsh-bailian-studio] .bs-file-btn {
  appearance: none; border: 0; background: transparent; color: var(--bs-accent);
  font: inherit; font-size: 10px; padding: 1px 2px; cursor: pointer; white-space: nowrap;
}
[data-dsh-bailian-studio] .bs-file-btn:hover { text-decoration: underline; }
[data-dsh-bailian-studio] .bs-more-btn { font-size: 14px; line-height: 1; padding: 0 4px; color: var(--bs-muted); }
[data-dsh-bailian-studio] .bs-more-btn:hover { color: var(--bs-accent); text-decoration: none; }
[data-dsh-bailian-studio] .bs-action-backdrop { position: fixed; inset: 0; z-index: 9998; background: transparent; }
[data-dsh-bailian-studio] .bs-action-menu {
  position: fixed; width: 168px; padding: 4px; border-radius: 9px;
  background: color-mix(in srgb, Canvas 94%, currentColor); color: CanvasText;
  border: 1px solid var(--bs-border-strong); box-shadow: 0 14px 40px rgba(0,0,0,.3);
  display: flex; flex-direction: column; gap: 2px; z-index: 9999;
}
[data-dsh-bailian-studio] .bs-action-item {
  appearance: none; border: 0; background: transparent; color: inherit; text-align: left;
  padding: 6px 8px; border-radius: 6px; font: inherit; font-size: 12px; cursor: pointer;
}
[data-dsh-bailian-studio] .bs-action-item:hover { background: var(--bs-surface-2); }
[data-dsh-bailian-studio] .bs-action-item.danger { color: var(--bs-danger); }
[data-dsh-bailian-studio] .bs-detail-box { display: flex; flex-direction: column; gap: 6px; padding: 8px 6px 0; font-size: 11px; }
[data-dsh-bailian-studio] .bs-detail-line { color: var(--bs-muted); display: flex; gap: 4px; flex-wrap: wrap; }
[data-dsh-bailian-studio] .bs-detail-line b { font-weight: 500; color: var(--bs-faint); flex: none; }
[data-dsh-bailian-studio] .bs-filelist { display: flex; flex-direction: column; gap: 5px; }
[data-dsh-bailian-studio] .bs-file-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
[data-dsh-bailian-studio] .bs-file-row .ftype { color: var(--bs-faint); }
[data-dsh-bailian-studio] .bs-file-row .fname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 130px; }
[data-dsh-bailian-studio] .bs-file-row .fsize { color: var(--bs-faint); font-size: 10px; }
[data-dsh-bailian-studio] .bs-path { font: 10px/1.45 ui-monospace, Consolas, monospace; color: var(--bs-faint); word-break: break-all; }
[data-dsh-bailian-studio] .bs-log {
  max-height: 140px; overflow: auto; white-space: pre-wrap; word-break: break-word; margin: 0;
  font: 10px/1.5 ui-monospace, Consolas, monospace; color: var(--bs-muted);
}
[data-dsh-bailian-studio] .bs-mini {
  appearance: none; border: 1px solid var(--bs-border); background: transparent; color: var(--bs-muted);
  border-radius: 6px; padding: 2px 6px; font: inherit; font-size: 10px; cursor: pointer; flex: none;
}
[data-dsh-bailian-studio] .bs-mini:hover { background: var(--bs-surface-2); color: inherit; }
[data-dsh-bailian-studio] .bs-pill { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: var(--bs-muted); white-space: nowrap; }
[data-dsh-bailian-studio] .bs-pill i { width: 6px; height: 6px; border-radius: 50%; background: var(--bs-faint); }
[data-dsh-bailian-studio] .bs-pill.done i { background: var(--bs-ok); }
[data-dsh-bailian-studio] .bs-pill.running i { background: var(--bs-warn); animation: bs-pulse 1s ease-in-out infinite; }
[data-dsh-bailian-studio] .bs-pill.error i { background: var(--bs-danger); }
@keyframes bs-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
[data-dsh-bailian-studio] .bs-empty { font-size: 12px; color: var(--bs-faint); padding: 8px 0; }
[data-dsh-bailian-studio] .bs-prompt-wrap { position: relative; }
[data-dsh-bailian-studio] .bs-at-menu {
  position: absolute; left: 0; right: 0; top: 100%; margin-top: 4px; z-index: 30;
  background: color-mix(in srgb, Canvas 94%, currentColor 6%); color: CanvasText;
  border: 1px solid var(--bs-border-strong); border-radius: 8px; overflow: auto; max-height: 168px;
  box-shadow: 0 10px 30px rgba(0,0,0,.28); padding: 3px;
}
[data-dsh-bailian-studio] .bs-at-item {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  background: transparent; border: 0; color: inherit; padding: 6px 8px; border-radius: 6px; cursor: pointer; font: inherit; font-size: 12px;
}
[data-dsh-bailian-studio] .bs-at-item:hover { background: var(--bs-surface-2); }
[data-dsh-bailian-studio] .bs-at-label { font-weight: 600; color: var(--bs-accent); flex: none; }
[data-dsh-bailian-studio] .bs-at-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--bs-muted); font-size: 10px; }
[data-dsh-bailian-studio] .bs-at-empty { padding: 8px; font-size: 11px; color: var(--bs-faint); }
[data-dsh-bailian-studio] .bs-refs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
[data-dsh-bailian-studio] .bs-ref {
  position: relative; width: 64px; height: 64px; border-radius: 8px; overflow: hidden;
  border: 1px solid var(--bs-border); background: var(--bs-surface);
}
[data-dsh-bailian-studio] .bs-ref img { width: 100%; height: 100%; object-fit: cover; display: block; }
[data-dsh-bailian-studio] .bs-ref.video { display: flex; align-items: center; justify-content: center; color: var(--bs-muted); font-size: 22px; }
[data-dsh-bailian-studio] .bs-ref.url { display: flex; align-items: center; justify-content: center; font-size: 22px; color: var(--bs-muted); }
[data-dsh-bailian-studio] .bs-link-row { display: flex; gap: 6px; align-items: center; margin-top: 2px; }
[data-dsh-bailian-studio] .bs-ref-label {
  position: absolute; left: 3px; bottom: 3px; font-size: 9px; line-height: 14px; padding: 0 4px;
  background: rgba(0,0,0,.62); color: #fff; border-radius: 4px;
}
[data-dsh-bailian-studio] .bs-ref-del {
  position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; border-radius: 50%; border: 0;
  background: rgba(0,0,0,.62); color: #fff; cursor: pointer; font-size: 11px; line-height: 16px; padding: 0;
}
[data-dsh-bailian-studio] .bs-ref-add {
  width: 64px; height: 64px; border-radius: 8px; border: 1px dashed var(--bs-border-strong);
  background: transparent; color: var(--bs-muted); cursor: pointer; font: inherit; font-size: 11px; line-height: 1.4;
}
[data-dsh-bailian-studio] .bs-ref-add:hover { background: var(--bs-surface); color: inherit; }
[data-dsh-bailian-studio] .bs-ref-add:disabled { opacity: .45; cursor: not-allowed; }
[data-dsh-bailian-studio] .bs-upload-note { font-size: 10px; color: var(--bs-faint); }
[data-dsh-bailian-studio] .bs-table-row .prompt-cell { cursor: pointer; }
[data-dsh-bailian-studio] .bs-table-row .prompt-cell:hover { color: var(--bs-accent); }
[data-dsh-bailian-studio] .bs-modal {
  position: fixed; inset: 0; z-index: 9999; background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center; padding: 16px;
}
[data-dsh-bailian-studio] .bs-modal-card {
  width: 100%; max-width: 560px; max-height: 82vh; overflow: auto;
  background: color-mix(in srgb, Canvas 94%, currentColor); color: CanvasText;
  border: 1px solid var(--bs-border-strong); border-radius: 12px; padding: 12px;
  display: flex; flex-direction: column; gap: 10px; box-shadow: 0 24px 70px rgba(0,0,0,.35);
}
[data-dsh-bailian-studio] .bs-modal-head { display: flex; align-items: center; justify-content: space-between; font-weight: 600; font-size: 13px; }
[data-dsh-bailian-studio] .bs-image-card {
  max-width: 94vw; max-height: 90vh; display: flex; flex-direction: column; gap: 8px; padding: 10px;
  border-radius: 12px; background: color-mix(in srgb, Canvas 94%, currentColor); color: CanvasText;
  border: 1px solid var(--bs-border-strong); box-shadow: 0 24px 70px rgba(0,0,0,.35);
}
[data-dsh-bailian-studio] .bs-image-card img {
  max-width: 100%; max-height: 78vh; object-fit: contain; border-radius: 8px; background: #000; display: block; margin: 0 auto;
}
[data-dsh-bailian-studio] .bs-modal-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 11px; color: var(--bs-muted); }
[data-dsh-bailian-studio] .bs-prompt-box { display: flex; flex-direction: column; gap: 5px; }
[data-dsh-bailian-studio] .bs-prompt-head { display: flex; align-items: center; justify-content: space-between; font-size: 11px; color: var(--bs-muted); }
[data-dsh-bailian-studio] .bs-prompt-full {
  margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.6;
  background: var(--bs-surface); border: 1px solid var(--bs-border); border-radius: 8px;
  padding: 8px; max-height: 180px; overflow: auto;
}
/* ── 白色卡片主题（对齐「声音复刻」） ───────────────────────── */
[data-dsh-bailian-studio] {
  --bs-bg: #f6f7fb;
  --bs-surface: #ffffff;
  --bs-surface-2: #f3f5fa;
  --bs-border: rgba(17,24,39,.10);
  --bs-border-strong: rgba(17,24,39,.18);
  --bs-muted: #6b7280;
  --bs-faint: #9aa1ad;
  --bs-accent: #3b82f6;
  --bs-accent-2: #8b5cf6;
  color: #1f2430;
}
[data-dsh-bailian-studio] .bs-root { padding: 10px; gap: 10px; background: radial-gradient(900px 380px at 8% -10%, rgba(59,130,246,.07), transparent 62%), radial-gradient(760px 360px at 96% -8%, rgba(139,92,246,.07), transparent 60%), var(--bs-bg); }
[data-dsh-bailian-studio] .bs-topbar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: #fff; border: 1px solid var(--bs-border); border-radius: 12px; }
[data-dsh-bailian-studio] .bs-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
[data-dsh-bailian-studio] .bs-brand > div { display: flex; flex-direction: column; min-width: 0; }
[data-dsh-bailian-studio] .bs-brand strong { font-size: 15px; letter-spacing: .2px; }
[data-dsh-bailian-studio] .bs-brand .bs-muted { font-size: 11px; color: var(--bs-muted); }
[data-dsh-bailian-studio] .bs-logo { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, #3b82f6, #8b5cf6); box-shadow: 0 6px 16px rgba(99,102,241,.28); flex: none; }
[data-dsh-bailian-studio] .bs-tabs { display: flex; gap: 2px; padding: 4px; background: #fff; border: 1px solid var(--bs-border); border-radius: 12px; justify-content: flex-start; overflow-x: auto; }
[data-dsh-bailian-studio] .bs-tab { flex: none; width: 96px; appearance: none; border: 0; background: transparent; color: var(--bs-muted); padding: 7px 6px; border-radius: 8px; cursor: pointer; font: inherit; font-size: 12px; text-align: center; }
[data-dsh-bailian-studio] .bs-tab:hover { background: var(--bs-surface-2); }
[data-dsh-bailian-studio] .bs-tab.on { background: rgba(59,130,246,.10); color: #2563eb; font-weight: 600; }
[data-dsh-bailian-studio] .bs-params { display: flex; flex-direction: row; align-items: flex-end; gap: 8px; overflow-x: auto; padding-bottom: 2px; }
[data-dsh-bailian-studio] .bs-params .bs-field { flex: 0 0 auto; gap: 4px; width: 104px; }
[data-dsh-bailian-studio] .bs-params .bs-field:first-child { width: 200px; }
[data-dsh-bailian-studio] .bs-params .bs-field:last-child { width: auto; }
[data-dsh-bailian-studio] .bs-params .bs-select { width: 100%; max-width: 100%; }
[data-dsh-bailian-studio] .bs-params .bs-check { white-space: nowrap; }
[data-dsh-bailian-studio] .bs-btn.primary.bs-generate { width: 160px; flex: none; }
[data-dsh-bailian-studio] .bs-form .bs-select { max-width: 220px; }
[data-dsh-bailian-studio] .bs-form .bs-input { max-width: 240px; }
[data-dsh-bailian-studio] .bs-setting-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
[data-dsh-bailian-studio] .bs-provider-list { display: flex; flex-direction: column; gap: 8px; }
[data-dsh-bailian-studio] .bs-provider-row { display: flex; align-items: center; gap: 8px; border: 1px solid var(--bs-border); border-radius: 10px; padding: 8px 10px; background: #fff; }
[data-dsh-bailian-studio] .bs-provider-row.active { border-color: #93c5fd; background: rgba(59,130,246,.06); }
[data-dsh-bailian-studio] .bs-provider-main { min-width: 0; flex: 1; }
[data-dsh-bailian-studio] .bs-provider-name { font-size: 13px; font-weight: 600; display: flex; gap: 6px; align-items: center; }
[data-dsh-bailian-studio] .bs-provider-meta { font-size: 11px; color: var(--bs-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-dsh-bailian-studio] .bs-provider-actions { display: flex; gap: 5px; flex: none; }
[data-dsh-bailian-studio] .bs-badge { font-size: 10px; color: #2563eb; background: rgba(59,130,246,.12); border-radius: 999px; padding: 1px 6px; }
[data-dsh-bailian-studio] .bs-mini.danger { color: #dc2626; border-color: rgba(220,38,38,.35); }
[data-dsh-bailian-studio] .bs-mode-seg { display: flex; gap: 4px; }
[data-dsh-bailian-studio] .bs-mode-seg button { width: 84px; flex: none; border: 1px solid var(--bs-border); background: #fff; border-radius: 8px; padding: 6px 0; cursor: pointer; color: var(--bs-muted); font: inherit; font-size: 12px; }
[data-dsh-bailian-studio] .bs-mode-seg button.on { background: rgba(59,130,246,.1); color: #2563eb; border-color: #93c5fd; font-weight: 600; }
[data-dsh-bailian-studio] .bs-btn.primary.bs-save-btn { width: 120px; flex: none; }
[data-dsh-bailian-studio] .bs-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
[data-dsh-bailian-studio] .bs-provider-modal .bs-input { max-width: 100%; }

[data-dsh-bailian-studio] .bs-open-btn, .bs-open-btn {
[data-dsh-bailian-studio] .bs-form, [data-dsh-bailian-studio] .bs-records, [data-dsh-bailian-studio] .bs-settings { background: #fff; border: 1px solid var(--bs-border); border-radius: 14px; padding: 12px; }
[data-dsh-bailian-studio] .bs-input, [data-dsh-bailian-studio] .bs-select, [data-dsh-bailian-studio] textarea.bs-prompt { background: #f6f7fb; }
[data-dsh-bailian-studio] .bs-setting-card { background: #fff; border: 1px solid var(--bs-border); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
[data-dsh-bailian-studio] .bs-setting-title { font-size: 13px; font-weight: 600; }
[data-dsh-bailian-studio] .bs-model-chips { display: flex; flex-wrap: wrap; gap: 5px; max-height: 150px; overflow: auto; }
[data-dsh-bailian-studio] .bs-chip { font-size: 10px; color: var(--bs-muted); border: 1px solid var(--bs-border); border-radius: 999px; padding: 2px 7px; background: var(--bs-surface-2); }

[data-dsh-bailian-studio] .bs-open-btn, .bs-open-btn {
  appearance: none; border: 0; background: transparent; color: inherit; cursor: pointer;
  width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
}
[data-dsh-bailian-studio] .bs-open-btn:hover, .bs-open-btn:hover { background: color-mix(in srgb, currentColor 9%, transparent); }
`;

    function SparkleIcon(props) {
      const size = props && props.size ? props.size : 16;
      return e('svg', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true },
        e('path', {
          d: 'M12 2.6c.7 4.8 2.6 6.7 7.4 7.4-4.8.7-6.7 2.6-7.4 7.4-.7-4.8-2.6-6.7-7.4-7.4C9.4 9.3 11.3 7.4 12 2.6Z',
          fill: 'currentColor',
        }),
        e('path', {
          d: 'M18.4 15.2c.35 2.4 1.3 3.35 3.7 3.7-2.4.35-3.35 1.3-3.7 3.7-.35-2.4-1.3-3.35-3.7-3.7 2.4-.35 3.35-1.3 3.7-3.7Z',
          fill: 'currentColor', opacity: 0.7,
        }));
    }

    function RefreshIcon() {
      return e('svg', { width: 14, height: 14, viewBox: '0 0 24 24', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' },
        e('path', { d: 'M20 11a8 8 0 1 0-2.3 6' }), e('path', { d: 'M20 5v6h-6' }));
    }

    async function api(path, init) {
      const options = Object.assign({}, init || {});
      options.headers = Object.assign({ 'content-type': 'application/json', [FENCE]: '1' }, options.headers || {});
      let response;
      try {
        response = await fetch(API + path, options);
      } catch (error) {
        throw new Error('网络错误：' + String(error && error.message ? error.message : error));
      }
      let payload = null;
      try { payload = await response.json(); } catch (error) { /* 下面统一报错 */ }
      if (payload === null) throw new Error('响应不是 JSON（HTTP ' + response.status + '）——宿主可能刚重启，请稍后重试');
      if (!payload.ok) {
        const err = new Error(payload.error && payload.error.message ? payload.error.message : 'HTTP ' + response.status);
        err.code = payload.error && payload.error.code ? payload.error.code : '';
        err.log = payload.error && payload.error.log ? payload.error.log : '';
        err.status = response.status;
        throw err;
      }
      return payload.value;
    }

    function uid() {
      return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    function normalizeRecord(record) {
      if (!record || typeof record !== 'object') return null;
      const status = record.status === 'running' || record.status === 'error' ? record.status : 'done';
      return Object.assign({ files: [], prompt: '', kind: 'image', at: Date.now() }, record, { status });
    }

    function loadRecords() {
      let list = null;
      try {
        const raw = window.localStorage.getItem(RECORD_KEY);
        if (raw) list = JSON.parse(raw);
      } catch (error) { list = null; }
      if (!Array.isArray(list) || list.length === 0) {
        try {
          const legacy = window.localStorage.getItem(LEGACY_HISTORY_KEY);
          const old = legacy ? JSON.parse(legacy) : null;
          if (Array.isArray(old)) {
            list = old.map((item, index) => ({
              id: 'legacy-' + index,
              at: item.at || Date.now(),
              kind: item.kind === 'video' ? 'video' : 'image',
              prompt: item.prompt || '',
              status: 'done',
              files: item.files || [],
            }));
          }
        } catch (error) { /* 忽略旧数据 */ }
      }
      if (!Array.isArray(list)) list = [];
      return list
        .map(normalizeRecord)
        .filter(Boolean)
        .slice(0, RECORD_MAX)
        .map((record) => {
          if (record.status !== 'running') return record;
          // 面板重启/刷新后不可能还有本实例在跑的任务：如实标成中断，不假装成功。
          return Object.assign({}, record, {
            status: 'error',
            error: { code: 'INTERRUPTED', message: '面板关闭或刷新，未拿到结果（可到输出目录查看）' },
          });
        });
    }

    function saveRecords(list) {
      try {
        window.localStorage.setItem(RECORD_KEY, JSON.stringify(list.slice(0, RECORD_MAX)));
      } catch (error) { /* 配额错误忽略 */ }
    }

    function formatWhen(ms) {
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, '0');
      return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '';
      if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    }

    function statusDetail(status) {
      const value = status && status.error;
      if (!value) return '';
      if (typeof value === 'string') return value;
      return value.message || value.code || '';
    }

    function copyText(text) {
      const value = String(text ?? '');
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(value);
          return true;
        }
      } catch (error) { /* 走下面的兜底 */ }
      try {
        const area = document.createElement('textarea');
        area.value = value;
        area.setAttribute('readonly', 'readonly');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      } catch (error) {
        return false;
      }
    }

    /**
     * 把生成的文件放进系统剪贴板。
     * 浏览器只允许少数 MIME（Chrome 主要是 text/html/png），视频多会失败；
     * 失败时退回复制文件绝对路径，至少能粘贴到资源管理器/聊天框。
     */
    async function copyFileToClipboard(file) {
      try {
        const response = await fetch(file.url);
        if (!response.ok) throw new Error('读取文件失败（HTTP ' + response.status + '）');
        const blob = await response.blob();
        if (navigator.clipboard && typeof window.ClipboardItem === 'function') {
          const type = blob.type || file.mime || 'application/octet-stream';
          await navigator.clipboard.write([new window.ClipboardItem({ [type]: blob })]);
          return { ok: true };
        }
        throw new Error('当前浏览器不支持文件剪贴板');
      } catch (error) {
        if (copyText(file.path)) return { ok: false, fallback: true, error };
        return { ok: false, fallback: false, error };
      }
    }

    function readFileAsDataURL(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
        reader.readAsDataURL(file);
      });
    }

    /** 用宿主调用本机播放器；宿主没有 /open（未重启）时退回浏览器打开。 */
    async function openLocalPlayer(file) {
      try {
        await api('/open', { method: 'POST', body: JSON.stringify({ path: file.path }) });
        return { ok: true };
      } catch (error) {
        if (error.status === 404 || error.code === 'NOT_FOUND') {
          try { window.open(file.url, '_blank', 'noopener'); } catch (inner) { /* 忽略 */ }
          return { ok: false, fallback: true, error };
        }
        return { ok: false, error };
      }
    }

    function Field(props) {
      return e('label', { className: 'bs-field' },
        e('span', { className: 'bs-label' }, props.label, props.hint ? e('b', null, props.hint) : null),
        props.children);
    }

    function StatusLine(props) {
      const status = props.status;
      let tone = '';
      let text = '检查中…';
      if (!status.loading) {
        if (status.error) { tone = 'bad'; text = '宿主未就绪'; }
        else if (status.available) { tone = status.authed ? 'ok' : 'bad'; text = 'bl ' + (status.version || '') + (status.authed ? ' 已登录' : ' 未登录'); }
        else { tone = 'bad'; text = 'bl 不可用'; }
      }
      return e('div', { className: 'bs-status', title: statusDetail(status) || status.authMessage || '' },
        e('span', { className: 'bs-dot ' + tone }),
        e('span', null, text),
        e('button', {
          type: 'button', className: 'bs-iconbtn', title: '重新检查 bl',
          onClick: props.onRefresh, 'aria-label': '重新检查 bl',
        }, e(RefreshIcon)));
    }

    function StatusPill(props) {
      const key = props.status === 'running' ? 'running' : props.status === 'error' ? 'error' : 'done';
      const label = key === 'running' ? '生成中' : key === 'error' ? '失败' : '完成';
      return e('span', { className: 'bs-pill ' + key }, e('i'), label);
    }

    function VideoCard(props) {
      const file = props.file;
      const [inline, setInline] = React.useState(false);
      if (inline) {
        return e('div', { className: 'bs-field' },
          e('video', { className: 'bs-video', controls: true, autoPlay: true, src: file.url }),
          e('div', { className: 'bs-filemeta' },
            e('button', { type: 'button', className: 'bs-mini', onClick: () => setInline(false) }, '收起播放器'),
            e('button', { type: 'button', className: 'bs-mini', onClick: () => props.onOpenLocal(file) }, '用本机播放器打开'),
            e('a', { href: file.url, download: file.name }, '下载')));
      }
      return e('div', {
        className: 'bs-video-card',
        role: 'button',
        tabIndex: 0,
        title: '点击用本机播放器打开',
        onClick: () => props.onOpenLocal(file),
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            props.onOpenLocal(file);
          }
        },
      },
        e('video', { className: 'bs-video-thumb', src: file.url, muted: true, preload: 'metadata', playsInline: true }),
        e('span', { className: 'bs-video-overlay' },
          e('span', { className: 'bs-play' }, '▶'),
          e('span', null, '用本机播放器打开')),
        e('div', { className: 'bs-video-meta' },
          e('span', null, file.name + (file.bytes ? ' · ' + formatBytes(file.bytes) : '')),
          e('button', {
            type: 'button', className: 'bs-mini',
            onClick: (event) => { event.stopPropagation(); setInline(true); },
          }, '在面板内播放')));
    }

    function ResultBlock(props) {
      const result = props.result;
      if (!result) return null;
      const files = Array.isArray(result.files) ? result.files : [];
      const images = files.filter((file) => file.kind === 'image');
      const videos = files.filter((file) => file.kind === 'video');
      const onOpenLocal = props.onOpenLocal || (() => {});
      return e('div', { className: 'bs-field' },
        videos.map((file, index) => e(VideoCard, { key: 'v' + index, file, onOpenLocal })),
        images.length > 0
          ? e('div', { className: 'bs-gallery' },
              images.map((file, index) => e('a', {
                key: 'i' + index, className: 'bs-thumb', href: file.url, target: '_blank', rel: 'noreferrer',
                title: file.name + '（点击查看原图）',
              }, e('img', { src: file.url, alt: file.name, loading: 'lazy' }))))
          : null,
        e('div', { className: 'bs-filemeta' },
          e('span', null, files.length + ' 个文件 · ' + Math.round((result.elapsedMs || 0) / 1000) + ' 秒'),
          files[0] ? e('a', { href: files[0].url, download: files[0].name }, '下载第一个') : null));
    }

    function RefChip(props) {
      const item = props.item;
      return e('div', { className: 'bs-ref' + (item.isUrl ? ' url' : item.kind === 'video' ? ' video' : '') },
        item.isUrl ? e('span', null, '🔗') : item.kind === 'video' ? e('span', null, '▶') : e('img', { src: item.url, alt: item.name }),
        e('span', { className: 'bs-ref-label' }, props.label),
        e('button', {
          type: 'button', className: 'bs-ref-del', title: '移除素材',
          onClick: props.onRemove, 'aria-label': '移除素材',
        }, '×'));
    }

    function RecordModal(props) {
      const record = props.record;
      React.useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') props.onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
      }, [props.onClose]);
      if (!record) return null;
      const files = Array.isArray(record.files) ? record.files : [];
      const status = record.status || 'done';
      return e('div', { className: 'bs-modal', onClick: props.onClose },
        e('div', { className: 'bs-modal-card', onClick: (event) => event.stopPropagation() },
          e('div', { className: 'bs-modal-head' },
            e('span', null, '生成详情'),
            e('button', { type: 'button', className: 'bs-iconbtn', onClick: props.onClose, 'aria-label': '关闭' }, '✕')),
          e('div', { className: 'bs-modal-meta' },
            e(StatusPill, { status }),
            e('span', null, formatWhen(record.at)),
            e('span', null, record.kind === 'video' ? '视频' : '图片'),
            status === 'done' ? e('span', null, Math.round((record.elapsedMs || 0) / 1000) + ' 秒') : null),
          record.taskId
            ? e('div', { className: 'bs-detail-line' },
                e('b', null, '任务 ID'),
                e('span', { className: 'bs-path' }, record.taskId),
                e('button', {
                  type: 'button', className: 'bs-mini',
                  onClick: () => { if (copyText(record.taskId)) props.onNotify('已复制任务 ID'); },
                }, '复制'))
            : null,
          e('div', { className: 'bs-prompt-box' },
            e('div', { className: 'bs-prompt-head' },
              e('span', null, '提示词'),
              e('button', {
                type: 'button', className: 'bs-mini',
                onClick: () => {
                  if (copyText(record.prompt)) props.onNotify('已复制提示词');
                  else props.onNotify('复制失败，请手动选择文本');
                },
              }, '复制')),
            e('pre', { className: 'bs-prompt-full' }, record.prompt || '—')),
          status === 'error'
            ? e('div', { className: 'bs-error' },
                (record.error && record.error.code ? '[' + record.error.code + '] ' : '') + ((record.error && record.error.message) || '未知错误'),
                record.error && record.error.log ? e('pre', null, record.error.log) : null)
            : null,
          e('div', { className: 'bs-detail-line' }, e('b', null, '文件位置')),
          files.length > 0
            ? e('div', { className: 'bs-filelist' }, files.map((file, index) => e('div', { className: 'bs-file-row', key: 'f' + index },
                e('span', { className: 'ftype' }, file.kind === 'video' ? '▶' : '▧'),
                e('span', { className: 'fname', title: file.path || file.name }, file.name),
                e('span', { className: 'fsize' }, formatBytes(file.bytes)),
                e('button', {
                  type: 'button', className: 'bs-mini',
                  onClick: () => { if (file.kind === 'video') props.onOpenLocal(file); else props.onPreview(file); },
                }, file.kind === 'video' ? '本机播放' : '查看'),
                e('button', {
                  type: 'button', className: 'bs-mini',
                  onClick: () => { if (copyText(file.path)) props.onNotify('已复制文件路径'); },
                }, '复制路径'))))
            : e('div', { className: 'bs-note' }, status === 'running' ? '等待生成…' : '没有文件'),
          record.jobDir ? e('div', { className: 'bs-path', title: record.jobDir }, record.jobDir) : null));
    }

    function RecordsTable(props) {
      const records = props.records || [];
      if (records.length === 0) {
        return e('div', { className: 'bs-empty' }, '还没有生成记录。在「图片 / 视频」页生成一次，这里会按时间列出状态、提示词与文件位置。');
      }
      return e('div', { className: 'bs-records' },
        e('div', { className: 'bs-records-head' },
          e('span', null, '共 ' + records.length + ' 条 · 点一行看详情'),
          e('button', { type: 'button', className: 'bs-btn ghost', onClick: props.onClear }, '清空记录')),
        e('div', { className: 'bs-table-wrap' },
          e('div', { className: 'bs-table-head' },
            e('span', { className: 'c-time' }, '时间'),
            e('span', { className: 'c-kind' }, '类型'),
            e('span', { className: 'c-status' }, '状态'),
            e('span', { className: 'prompt-cell' }, '提示词'),
            e('span', { className: 'c-files' }, '操作')),
          records.map((record) => {
            const status = record.status || 'done';
            const files = Array.isArray(record.files) ? record.files : [];
            return e('div', {
              key: record.id,
              className: 'bs-table-row',
              role: 'button',
              tabIndex: 0,
              onClick: () => props.onOpen(record),
              onKeyDown: (event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  props.onOpen(record);
                }
              },
            },
              e('span', { className: 'c-time', title: new Date(record.at).toLocaleString() }, formatWhen(record.at)),
              e('span', { className: 'c-kind' }, record.kind === 'video' ? '视频' : '图片'),
              e('span', {
                className: 'c-status',
                title: status === 'error' ? ((record.error && record.error.message) || '失败') : undefined,
              }, e(StatusPill, { status })),
              e('span', { className: 'prompt-cell', title: '点击查看完整提示词' }, record.prompt || '—'),
              e('span', { className: 'c-files' },
                status === 'running'
                  ? '…'
                  : e('button', {
                      type: 'button',
                      className: 'bs-file-btn bs-more-btn',
                      title: '操作',
                      onClick: (event) => {
                        event.stopPropagation();
                        props.onActions(record, event);
                      },
                    }, '⋯')));
          })));
    }

    function SettingsView(props) {
      const view = props.providers;
      const list = view && Array.isArray(view.providers) ? view.providers : [];
      return e('div', { className: 'bs-settings' },
        e('div', { className: 'bs-setting-card' },
          e('div', { className: 'bs-setting-head' },
            e('span', { className: 'bs-setting-title' }, '服务商'),
            e('button', { type: 'button', className: 'bs-btn ghost', onClick: props.onAdd }, '新增服务商')),
          e('div', { className: 'bs-note' },
            view
              ? '当前生效：' + (view.effective === 'api' ? '服务商 API' : '百炼 CLI')
                + (view.bl && view.bl.entry ? '（' + view.bl.entry + '）' : '（未检测到 bl）')
              : '读取中…'),
          list.length === 0
            ? e('div', { className: 'bs-note' }, '还没有服务商，点「新增服务商」创建。')
            : e('div', { className: 'bs-provider-list' },
                list.map((provider) => e('div', {
                  key: provider.id,
                  className: 'bs-provider-row' + (provider.id === view.activeId ? ' active' : ''),
                },
                  e('div', { className: 'bs-provider-main' },
                    e('div', { className: 'bs-provider-name' },
                      provider.name,
                      provider.id === view.activeId ? e('span', { className: 'bs-badge' }, '使用中') : null),
                    e('div', { className: 'bs-provider-meta' },
                      (provider.mode === 'auto' ? '自动' : provider.mode === 'bailian' ? '百炼 CLI' : '服务商 API')
                      + (provider.apiBaseUrl ? ' · ' + provider.apiBaseUrl : '')
                      + (provider.hasApiKey ? ' · ' + provider.apiKeyMasked : ''))),
                  e('div', { className: 'bs-provider-actions' },
                    e('button', {
                      type: 'button', className: 'bs-mini',
                      disabled: provider.id === view.activeId,
                      onClick: () => props.onUse(provider.id),
                    }, provider.id === view.activeId ? '使用中' : '使用'),
                    e('button', { type: 'button', className: 'bs-mini', onClick: () => props.onEdit(provider) }, '编辑'),
                    e('button', { type: 'button', className: 'bs-mini danger', onClick: () => props.onDelete(provider.id) }, '删除')))))),
        e('div', { className: 'bs-setting-card' },
          e('div', { className: 'bs-setting-title' }, '分辨率规则'),
          e('div', { className: 'bs-note' }, '百炼：720 / 1280；服务商 API：480 / 720 / 1280。切换服务商后视频页的分辨率选项会跟着变。')),
        e('div', { className: 'bs-setting-card' },
          e('div', { className: 'bs-setting-title' }, '界面'),
          e('label', { className: 'bs-check' },
            e('input', {
              type: 'checkbox',
              checked: props.sidebarVisible,
              onChange: (event) => props.onSidebarToggle(event.target.checked),
            }),
            '在左侧边栏显示「百炼创作台」入口'),
          e('div', { className: 'bs-note' }, '切换后立即注册/移除左侧入口（整页宽度）；右侧栏和会话头部入口不受影响。')));
    }

    function ProviderEditModal(props) {
      const draft = props.draft;
      const setDraft = props.setDraft;
      const field = (label, key, options = {}) => e('label', { className: 'bs-field' },
        e('span', { className: 'bs-label' }, label),
        e('input', {
          className: 'bs-input',
          type: options.type || 'text',
          value: draft[key] || '',
          placeholder: options.placeholder || '',
          onChange: (event) => setDraft(Object.assign({}, draft, { [key]: event.target.value })),
        }));
      return e('div', { className: 'bs-modal', onClick: props.onClose },
        e('div', { className: 'bs-modal-card bs-provider-modal', onClick: (event) => event.stopPropagation() },
          e('div', { className: 'bs-modal-head' },
            e('span', null, draft.id ? '编辑服务商' : '新增服务商'),
            e('button', { type: 'button', className: 'bs-iconbtn', onClick: props.onClose, 'aria-label': '关闭' }, '✕')),
          field('名称', 'name', { placeholder: '例如：百炼官方 / 我的中转' }),
          e('div', { className: 'bs-field' },
            e('span', { className: 'bs-label' }, '模式'),
            e('div', { className: 'bs-mode-seg' },
              ['auto', 'bailian', 'api'].map((mode) => e('button', {
                key: mode,
                type: 'button',
                className: draft.mode === mode ? 'on' : '',
                onClick: () => setDraft(Object.assign({}, draft, { mode })),
              }, mode === 'auto' ? '自动' : mode === 'bailian' ? '百炼' : '服务商')))),
          field('API Base URL', 'apiBaseUrl', { placeholder: 'https://dashscope.aliyuncs.com' }),
          field('API Key', 'apiKey', {
            type: 'password',
            placeholder: draft.hasApiKey ? '留空不修改（已保存 ' + draft.apiKeyMasked + '）' : 'sk-...',
          }),
          e('div', { className: 'bs-row' },
            field('图片模型', 'imageModel', { placeholder: 'qwen-image-3.0' }),
            field('视频模型', 'videoModel', { placeholder: 'wan3.0-video' })),
          e('div', { className: 'bs-modal-actions' },
            e('button', { type: 'button', className: 'bs-btn primary bs-save-btn', disabled: props.saving, onClick: props.onSave },
              props.saving ? '保存中…' : '保存'),
            e('button', { type: 'button', className: 'bs-btn ghost', onClick: props.onClose }, '取消'))));
    }

    function StudioPanel() {
      const [initialForm] = React.useState(loadFormSettings);
      const [status, setStatus] = React.useState({ loading: true });
      const [view, setView] = React.useState(initialForm.view === 'image' ? 'image' : 'video');
      const [lastFormView, setLastFormView] = React.useState(initialForm.view === 'image' ? 'image' : 'video');
      const [prompt, setPrompt] = React.useState('');
      const [modelChoices, setModelChoices] = React.useState({
        image: typeof initialForm.models?.image === 'string' ? initialForm.models.image : (typeof initialForm.model === 'string' ? initialForm.model : ''),
        video: typeof initialForm.models?.video === 'string' ? initialForm.models.video : '',
      });
      const [size, setSize] = React.useState(typeof initialForm.size === 'string' ? initialForm.size : '1:1');
      const [count, setCount] = React.useState(Number.isInteger(initialForm.count) ? initialForm.count : 1);
      const [duration, setDuration] = React.useState(typeof initialForm.duration === 'number' ? initialForm.duration : 5);
      const [resolution, setResolution] = React.useState(typeof initialForm.resolution === 'string' ? initialForm.resolution : '1080P');
      const [ratio, setRatio] = React.useState(typeof initialForm.ratio === 'string' ? initialForm.ratio : '16:9');
      const [watermark, setWatermark] = React.useState(initialForm.watermark === true);
      const [sidebarVisible, setSidebarVisibleState] = React.useState(readSidebarVisible);
      const [previewFile, setPreviewFile] = React.useState(null);
      const [result, setResult] = React.useState(null);
      const [error, setError] = React.useState(null);
      const [notice, setNotice] = React.useState('');
      const [records, setRecords] = React.useState(loadRecords);
      const [detailId, setDetailId] = React.useState(null);
      const [actionMenu, setActionMenu] = React.useState(null);
      const [refImages, setRefImages] = React.useState([]);
      const [refVideos, setRefVideos] = React.useState([]);
      const [uploading, setUploading] = React.useState(false);
      const [linkOpen, setLinkOpen] = React.useState(false);
      const [linkValue, setLinkValue] = React.useState('');
      const [atState, setAtState] = React.useState(null);
      const [providers, setProviders] = React.useState(null);
      const [editingProvider, setEditingProvider] = React.useState(null);
      const [savingProvider, setSavingProvider] = React.useState(false);
      const [modelCatalog, setModelCatalog] = React.useState({ image: [], video: [] });
      const promptRef = React.useRef(null);
      const imageInputRef = React.useRef(null);
      const videoInputRef = React.useRef(null);

      const modelKind = view === 'video' ? 'video' : 'image';
      const model = modelChoices[modelKind] || '';
      const setModel = (value) => setModelChoices((prev) => ({ ...prev, [modelKind]: value }));

      // 记住上一次的表单参数（按图片/视频分别存模型，以及尺寸/时长/比例/水印/最近 tab）。
      React.useEffect(() => {
        try {
          window.localStorage.setItem(FORM_KEY, JSON.stringify({
            view: lastFormView,
            models: modelChoices,
            size,
            count,
            duration,
            resolution,
            ratio,
            watermark,
          }));
        } catch (error) { /* 忽略 */ }
      }, [lastFormView, modelChoices, size, count, duration, resolution, ratio, watermark]);

      const refreshStatus = React.useCallback(() => {
        setStatus({ loading: true });
        api('/health').then((value) => {
          setStatus(Object.assign({ loading: false }, value));
        }).catch((err) => {
          setStatus({ loading: false, error: String(err.message || err), available: false });
        });
      }, []);

      React.useEffect(() => { refreshStatus(); }, [refreshStatus]);

      const loadProviders = React.useCallback(() => {
        api('/providers').then((value) => setProviders(value)).catch(() => setProviders(null));
      }, []);

      React.useEffect(() => { loadProviders(); }, [loadProviders]);

      const loadModels = React.useCallback((kind) => {
        api('/models?kind=' + kind).then((value) => {
          setModelCatalog((prev) => ({ ...prev, [kind]: Array.isArray(value.models) ? value.models : [] }));
        }).catch(() => { /* 目录拉不到就退回内置列表 */ });
      }, []);

      React.useEffect(() => { loadModels('image'); loadModels('video'); }, [loadModels]);

      const openProviderEditor = React.useCallback((provider) => {
        setEditingProvider(provider
          ? {
              id: provider.id,
              name: provider.name,
              mode: provider.mode,
              apiBaseUrl: provider.apiBaseUrl || '',
              apiKey: '',
              imageModel: provider.imageModel || '',
              videoModel: provider.videoModel || '',
              hasApiKey: provider.hasApiKey,
              apiKeyMasked: provider.apiKeyMasked,
            }
          : {
              id: '',
              name: '新服务商',
              mode: 'auto',
              apiBaseUrl: '',
              apiKey: '',
              imageModel: '',
              videoModel: '',
            });
      }, []);

      const saveProvider = React.useCallback(() => {
        if (!editingProvider) return;
        setSavingProvider(true);
        api('/providers', { method: 'POST', body: JSON.stringify(editingProvider) }).then((value) => {
          setProviders(value);
          setEditingProvider(null);
          setNotice('服务商已保存');
          loadModels('image');
          loadModels('video');
        }).catch((err) => setNotice('保存失败：' + String(err.message || err))).finally(() => setSavingProvider(false));
      }, [editingProvider, loadModels]);

      const useProviderById = React.useCallback((id) => {
        api('/providers/use', { method: 'POST', body: JSON.stringify({ id }) })
          .then((value) => { setProviders(value); setNotice('已切换服务商'); })
          .catch((err) => setNotice('切换失败：' + String(err.message || err)));
      }, []);

      const deleteProviderById = React.useCallback((id) => {
        let confirmed = false;
        try {
          confirmed = window.confirm('删除这个服务商？');
        } catch (error) {
          confirmed = false;
        }
        if (!confirmed) return;
        api('/providers/delete', { method: 'POST', body: JSON.stringify({ id }) })
          .then((value) => { setProviders(value); setNotice('已删除服务商'); })
          .catch((err) => setNotice('删除失败：' + String(err.message || err)));
      }, []);

      React.useEffect(() => {
        if (!notice) return undefined;
        const id = window.setTimeout(() => setNotice(''), 6000);
        return () => window.clearTimeout(id);
      }, [notice]);

      // 提示词输入框：默认小，内容多了跟着长，到上限后内部滚动。
      React.useEffect(() => {
        const element = promptRef.current;
        if (!element) return;
        element.style.height = 'auto';
        element.style.height = Math.min(element.scrollHeight, PROMPT_MAX_HEIGHT) + 'px';
      }, [prompt, view]);

      const updateRecord = React.useCallback((id, patch) => {
        setRecords((prev) => {
          const next = prev.map((record) => (record.id === id ? Object.assign({}, record, patch) : record));
          saveRecords(next);
          return next;
        });
      }, []);

      // 后台任务的轮询：页面每 5 秒问一次宿主的 /job（本地请求，很轻）。
      const runningRecords = records.filter((record) => record.status === 'running' && record.jobId);
      const runningSig = runningRecords.map((record) => record.id + ':' + record.jobId).join(',');

      React.useEffect(() => {
        if (runningRecords.length === 0) return undefined;
        let cancelled = false;
        const poll = async () => {
          for (const record of runningRecords) {
            if (cancelled) return;
            try {
              const job = await api('/job?id=' + encodeURIComponent(record.jobId));
              if (cancelled) return;
              if (job.status === 'done') {
                updateRecord(record.id, {
                  status: 'done',
                  files: job.files || [],
                  elapsedMs: job.elapsedMs || 0,
                  jobDir: job.jobDir || record.jobDir || '',
                  command: job.command || record.command || '',
                  taskId: job.taskId || record.taskId || '',
                  error: null,
                });
                setResult({ kind: job.kind || record.kind, files: job.files || [], elapsedMs: job.elapsedMs || 0 });
              } else if (job.status === 'error') {
                const reason = (job.error && job.error.message) || '任务失败';
                updateRecord(record.id, {
                  status: 'error',
                  error: job.error || { code: 'TASK_FAILED', message: reason },
                  taskId: job.taskId || record.taskId || '',
                });
                setNotice('生成失败：' + reason);
              }
            } catch (error) {
              if (cancelled) return;
              if (error && error.status === 404) {
                updateRecord(record.id, {
                  status: 'error',
                  error: { code: 'LOST', message: '宿主重启后任务状态丢失（输出目录里可能已有文件）' },
                });
              }
            }
          }
        };
        const timer = window.setInterval(poll, 5000);
        poll();
        return () => {
          cancelled = true;
          window.clearInterval(timer);
        };
      }, [runningSig, updateRecord]);

      const openLocal = React.useCallback((file) => {
        openLocalPlayer(file).then((res) => {
          if (res.ok) {
            setNotice('已用本机播放器打开：' + file.name);
          } else if (res.fallback) {
            setNotice('宿主还没加载 /open（需要重启 DSH），已改用浏览器播放');
          } else {
            setNotice('调用本机播放器失败：' + ((res.error && res.error.message) || '未知错误'));
          }
        });
      }, []);

      const revealRecord = React.useCallback((record) => {
        setActionMenu(null);
        const target = record.jobDir || (record.files && record.files[0] && record.files[0].path) || '';
        if (!target) {
          setNotice('这条记录没有可打开的文件');
          return;
        }
        api('/reveal', { method: 'POST', body: JSON.stringify({ path: target }) })
          .then(() => setNotice('已在资源管理器打开（窗口可能在任务栏，没跳前台就点一下任务栏）'))
          .catch((err) => setNotice('打开文件夹失败：' + String(err.message || err)));
      }, []);

      const removeRecord = React.useCallback((record) => {
        setActionMenu(null);
        let confirmed = false;
        try {
          confirmed = window.confirm('删除这条记录及其生成文件？此操作不可恢复。');
        } catch (error) {
          confirmed = false;
        }
        if (!confirmed) {
          setNotice('已取消删除');
          return;
        }
        api('/delete', {
          method: 'POST',
          body: JSON.stringify({
            jobDir: record.jobDir || '',
            files: (record.files || []).map((file) => file.path),
          }),
        }).then(() => {
          setRecords((prev) => {
            const next = prev.filter((item) => item.id !== record.id);
            saveRecords(next);
            return next;
          });
          setDetailId((current) => (current === record.id ? null : current));
          setNotice('已删除记录和文件');
        }).catch((err) => setNotice('删除失败：' + String(err.message || err)));
      }, []);

      const addRefs = React.useCallback(async (files, kind) => {
        const list = Array.from(files || []);
        if (list.length === 0 || uploading) return;
        const max = kind === 'image' ? 3 : 2;
        const currentCount = kind === 'image' ? refImages.length : refVideos.length;
        let remaining = max - currentCount;
        if (remaining <= 0) {
          setNotice(kind === 'image' ? '参考图最多 3 张' : '参考视频最多 2 个');
          return;
        }
        setUploading(true);
        try {
          for (const file of list) {
            if (remaining <= 0) {
              setNotice(kind === 'image' ? '参考图最多 3 张' : '参考视频最多 2 个');
              break;
            }
            const prefix = kind === 'image' ? 'image/' : 'video/';
            if (!String(file.type || '').startsWith(prefix)) {
              setNotice('文件类型不匹配：' + file.name);
              continue;
            }
            if (file.size > 30 * 1024 * 1024) {
              setNotice('素材不能超过 30MB：' + file.name);
              continue;
            }
            const dataUrl = await readFileAsDataURL(file);
            const asset = await api('/upload', { method: 'POST', body: JSON.stringify({ name: file.name, mime: file.type, dataUrl }) });
            const item = {
              id: asset.path + '-' + Math.random().toString(36).slice(2, 5),
              name: asset.originalName || asset.name,
              path: asset.path,
              url: asset.url,
              kind: asset.kind,
              mime: asset.mime,
              bytes: asset.bytes,
            };
            if (kind === 'image') setRefImages((prev) => prev.concat(item));
            else setRefVideos((prev) => prev.concat(item));
            remaining -= 1;
          }
        } catch (err) {
          setNotice('素材上传失败：' + String(err.message || err));
        } finally {
          setUploading(false);
        }
      }, [refImages.length, refVideos.length, uploading]);

      const removeRef = (kind, index) => {
        if (kind === 'image') setRefImages((prev) => prev.filter((item, at) => at !== index));
        else setRefVideos((prev) => prev.filter((item, at) => at !== index));
      };

      const addLink = () => {
        const url = linkValue.trim();
        if (!/^https?:\/\//i.test(url)) {
          setNotice('请填写 http(s) 视频链接');
          return;
        }
        if (refVideos.length >= 2) {
          setNotice('参考视频最多 2 个');
          return;
        }
        let name = url;
        try {
          const parsed = new URL(url);
          name = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname);
        } catch (error) { /* 保持原链接 */ }
        const item = {
          id: url + '#' + Math.random().toString(36).slice(2, 5),
          name,
          path: url,
          url,
          kind: 'video',
          mime: '',
          bytes: 0,
          isUrl: true,
        };
        setRefVideos((prev) => prev.concat(item));
        setLinkValue('');
        setLinkOpen(false);
      };

      const updateAtState = (value, caret) => {
        const before = value.slice(0, caret);
        const match = /@([^\s@]*)$/.exec(before);
        if (match === null) {
          setAtState(null);
          return;
        }
        setAtState({ query: match[1], start: caret - match[0].length, end: caret });
      };

      const insertRefToken = (label) => {
        if (!atState) return;
        const element = promptRef.current;
        const value = element ? element.value : prompt;
        const start = atState.start;
        const end = atState.end;
        const next = value.slice(0, start) + label + ' ' + value.slice(end);
        setPrompt(next);
        setAtState(null);
        window.requestAnimationFrame(() => {
          if (!element) return;
          element.focus();
          const pos = start + label.length + 1;
          try { element.setSelectionRange(pos, pos); } catch (err) { /* 忽略 */ }
        });
      };

      const submit = React.useCallback(() => {
        const text = prompt.trim();
        if (text === '' || view === 'records') return;
        const kind = view === 'video' ? 'video' : 'image';
        const id = uid();
        const record = {
          id,
          at: Date.now(),
          kind,
          prompt: text,
          model,
          status: 'running',
          elapsedMs: 0,
          files: [],
          jobId: '',
          taskId: '',
        };
        setRecords((prev) => {
          const next = [record].concat(prev).slice(0, RECORD_MAX);
          saveRecords(next);
          return next;
        });
        setError(null);
        setResult(null);

        const body = { kind, prompt: text, model, watermark };
        if (kind === 'image') {
          body.size = size;
          body.n = count;
          if (refImages.length > 0) body.refImages = refImages.map((item) => item.path);
        } else {
          body.duration = duration;
          body.resolution = resolution;
          body.ratio = ratio;
          if (refImages.length > 0) body.refImages = refImages.map((item) => item.path);
          if (refVideos.length > 0) body.refVideos = refVideos.map((item) => item.path);
        }

        api('/generate', { method: 'POST', body: JSON.stringify(body) }).then((value) => {
          updateRecord(id, {
            jobId: value.jobId || '',
            taskId: value.taskId || '',
            status: value.status === 'error' ? 'error' : 'running',
            error: value.error || null,
            files: value.files || [],
            jobDir: value.jobDir || '',
            command: value.command || '',
            kind: value.kind || kind,
          });
          if (value.status === 'error') {
            setNotice('提交失败：' + ((value.error && value.error.message) || '未知原因'));
          } else {
            setNotice('已提交任务：' + (kind === 'video' ? '视频' : '图片') + '后台生成中，状态约 15 秒刷新一次');
          }
        }).catch((err) => {
          const message = String(err.message || err);
          updateRecord(id, {
            status: 'error',
            error: { code: err.code || '', message, log: err.log || '' },
          });
          setError({ message, code: err.code || '', log: err.log || '' });
          setNotice('提交失败：' + message);
        });
      }, [prompt, view, model, watermark, size, count, duration, resolution, ratio, refImages, refVideos, updateRecord]);

      const allRefItems = refImages
        .map((item, index) => ({ key: 'img-' + index, label: '图' + (index + 1), name: item.name }))
        .concat(refVideos.map((item, index) => ({ key: 'vid-' + index, label: '视频' + (index + 1), name: item.name })));
      const atQuery = atState ? atState.query.toLowerCase() : '';
      const atItems = atState
        ? allRefItems.filter((item) => atQuery === '' || item.label.toLowerCase().includes(atQuery) || item.name.toLowerCase().includes(atQuery))
        : [];

      const onKeyDown = (event) => {
        if (atState) {
          if (event.key === 'Escape') {
            event.preventDefault();
            setAtState(null);
            return;
          }
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (atItems.length > 0) insertRefToken(atItems[0].label);
            return;
          }
        }
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          submit();
        }
      };

      // 粘贴图片：直接进参考素材（本地图片；Token Plan 账号仍需改用链接）。
      const onPaste = (event) => {
        const items = event.clipboardData && event.clipboardData.items;
        if (!items || items.length === 0) return;
        const files = [];
        for (const item of items) {
          if (item.kind === 'file' && String(item.type || '').startsWith('image/')) {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        }
        if (files.length === 0) return;
        event.preventDefault();
        addRefs(files, 'image');
      };

      const switchView = (next) => {
        setView(next);
        if (next === 'image' || next === 'video') setLastFormView(next);
        if (next === 'records' || next === 'settings') return;
        setResult(null);
        setError(null);
      };

      const toggleSidebarEntry = (next) => {
        setSidebarVisibleState(next);
        try {
          window.localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
        } catch (error) { /* 忽略 */ }
        if (window.__dshBailianStudio && typeof window.__dshBailianStudio.setSidebarVisible === 'function') {
          window.__dshBailianStudio.setSidebarVisible(next);
        }
      };

      const effectiveMode = providers && providers.effective ? providers.effective : 'bailian';
      const kindKey = view === 'video' ? 'video' : 'image';
      const fetchedModels = modelCatalog[kindKey] || [];
      const baseModelList = (view === 'video' ? VIDEO_MODELS : IMAGE_MODELS).map((item) => ({ id: item.value, name: item.label }));
      const modelOptions = [{ id: '', name: '跟随 Profile 默认' }].concat(
        (fetchedModels.length > 0 ? fetchedModels : baseModelList).map((item) => ({ id: item.id, name: item.name || item.id })),
      );
      if (model !== '' && !modelOptions.some((item) => item.id === model)) {
        modelOptions.push({ id: model, name: model });
      }
      const resolutionChoices = effectiveMode === 'api'
        ? [{ value: '480P', label: '480' }, { value: '720P', label: '720' }, { value: '1080P', label: '1280' }]
        : [{ value: '720P', label: '720' }, { value: '1080P', label: '1280' }];

      React.useEffect(() => {
        if (effectiveMode !== 'api' && resolution === '480P') setResolution('720P');
      }, [effectiveMode, resolution]);

      const runningCount = records.filter((record) => record.status === 'running').length;
      const disabled = prompt.trim() === '';
      const tokenPlan = /token-plan/i.test(String(status.authMessage || ''));

      return e('div', { className: 'bs-root', 'data-dsh-bailian-studio': '' },
        e('div', { className: 'bs-topbar' },
          e('div', { className: 'bs-brand' },
            e('span', { className: 'bs-logo' }, e(SparkleIcon, { size: 16 })),
            e('div', null,
              e('strong', null, '百炼创作台'),
              e('span', { className: 'bs-muted' }, '视频 / 图片生成 · 百炼 CLI'))),
          e(StatusLine, { status, onRefresh: refreshStatus })),

        status && !status.loading && status.available === false
          ? e('div', { className: 'bs-note' }, '宿主侧 bl 不可用：' + (statusDetail(status) || '请检查 bailian CLI 是否安装/登录'))
          : null,

        e('div', { className: 'bs-tabs' },
          [['video', '视频生成'], ['image', '图片生成'], ['records', '历史记录'], ['settings', '服务商设置']].map(([id, label]) =>
            e('button', {
              key: id,
              type: 'button',
              className: 'bs-tab' + (view === id ? ' on' : ''),
              onClick: () => switchView(id),
            }, label))),

        notice ? e('div', { className: 'bs-toast' }, notice) : null,

        runningCount > 0
          ? e('div', { className: 'bs-progress' },
              e('span', null, runningCount + ' 个任务进行中（可继续编辑并生成）'),
              e('span', { className: 'bs-bar' }))
          : null,

        view === 'settings'
          ? e(SettingsView, {
              providers,
              sidebarVisible,
              onSidebarToggle: toggleSidebarEntry,
              onAdd: () => openProviderEditor(null),
              onEdit: (provider) => openProviderEditor(provider),
              onUse: useProviderById,
              onDelete: deleteProviderById,
            })
          : view === 'records'
          ? e(RecordsTable, {
              records,
              onOpen: (record) => setDetailId(record.id),
              onActions: (record, event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                const width = 168;
                const left = Math.min(Math.max(8, rect.right - width), Math.max(8, window.innerWidth - width - 8));
                const top = Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - 190));
                setActionMenu({ recordId: record.id, left, top });
              },
              onOpenFile: (file) => { setPreviewFile(file); },
              onOpenLocal: openLocal,
              onNotify: setNotice,
              onClear: () => {
                setRecords([]);
                saveRecords([]);
                setDetailId(null);
                setActionMenu(null);
                setNotice('已清空记录（输出文件没有删除）');
              },
            })
          : e('div', { className: 'bs-form' },
              e(Field, { label: '提示词', hint: '输入 @ 引用素材' },
                e('div', { className: 'bs-prompt-wrap' },
                  e('textarea', {
                    ref: promptRef,
                    className: 'bs-prompt',
                    placeholder: view === 'image'
                      ? '描述你想要的画面；输入 @ 可引用素材，例如：把图1 的人物放进图2 的场景'
                      : '描述镜头与动作；输入 @ 可引用素材，例如：图1 中的人在走路，镜头缓慢推近',
                    value: prompt,
                    maxLength: 3000,
                    onChange: (event) => {
                      const value = event.target.value;
                      setPrompt(value);
                      updateAtState(value, event.target.selectionStart ?? value.length);
                    },
                    onKeyDown,
                    onPaste,
                    onBlur: () => { window.setTimeout(() => setAtState(null), 120); },
                  }),
                  atState
                    ? e('div', { className: 'bs-at-menu' },
                        atItems.length > 0
                          ? atItems.map((item) => e('button', {
                              key: item.key,
                              type: 'button',
                              className: 'bs-at-item',
                              onMouseDown: (event) => { event.preventDefault(); insertRefToken(item.label); },
                            },
                              e('span', { className: 'bs-at-label' }, item.label),
                              e('span', { className: 'bs-at-name' }, item.name)))
                          : e('div', { className: 'bs-at-empty' },
                              allRefItems.length === 0 ? '先添加参考图片/视频，再输入 @ 引用' : '没有匹配的素材'))
                    : null)),

              e('div', { className: 'bs-field' },
                e('span', { className: 'bs-label' }, '参考素材', e('b', null, '在提示词里输入 @ 引用')),
                e('div', { className: 'bs-refs' },
                  refImages.map((item, index) => e(RefChip, {
                    key: item.id, item, label: '图' + (index + 1),
                    onRemove: () => removeRef('image', index),
                  })),
                  refVideos.map((item, index) => e(RefChip, {
                    key: item.id, item, label: '视频' + (index + 1),
                    onRemove: () => removeRef('video', index),
                  })),
                  e('button', {
                    type: 'button', className: 'bs-ref-add',
                    disabled: uploading || refImages.length >= 3,
                    title: '添加参考图片（最多 3 张）',
                    onClick: () => { if (imageInputRef.current) imageInputRef.current.click(); },
                  }, '+ 图片'),
                  view === 'video'
                    ? e('button', {
                        type: 'button', className: 'bs-ref-add',
                        disabled: uploading || refVideos.length >= 2,
                        title: '添加参考视频（最多 2 个）',
                        onClick: () => { if (videoInputRef.current) videoInputRef.current.click(); },
                      }, '+ 视频')
                    : null,
                  e('button', {
                    type: 'button', className: 'bs-ref-add',
                    title: '添加公网视频链接（Token Plan 只能用链接）',
                    onClick: () => setLinkOpen((open) => !open),
                  }, '+ 视频链接'),
                  uploading ? e('span', { className: 'bs-upload-note' }, '上传中…') : null),
                linkOpen
                  ? e('div', { className: 'bs-link-row' },
                      e('input', {
                        className: 'bs-input', style: { flex: '1', minWidth: '0' },
                        placeholder: 'https://…（公网视频链接）',
                        value: linkValue,
                        onChange: (event) => setLinkValue(event.target.value),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            addLink();
                          }
                        },
                      }),
                      e('button', { type: 'button', className: 'bs-mini', onClick: addLink }, '添加'),
                      e('button', { type: 'button', className: 'bs-mini', onClick: () => setLinkOpen(false) }, '取消'))
                  : null,
                tokenPlan
                  ? e('div', { className: 'bs-toast' },
                      '当前 Profile 是 Token Plan：百炼不支持本地素材上传，参考视频请用「+ 视频链接」填公网 https 地址。')
                  : null,
                e('div', { className: 'bs-note' },
                  view === 'image'
                    ? '有参考图时走 bl image edit（多图可合并）；提示词里的 图1/图2 会映射成 image1/image2。'
                    : '参考图用于主体/首帧，参考视频用于参考生视频；提示词里的 图1、视频1 会映射成 image1、video1。'),
                e('input', {
                  ref: imageInputRef, type: 'file', accept: 'image/*', multiple: true,
                  style: { display: 'none' },
                  onChange: (event) => { addRefs(event.target.files, 'image'); event.target.value = ''; },
                }),
                e('input', {
                  ref: videoInputRef, type: 'file', accept: 'video/*', multiple: true,
                  style: { display: 'none' },
                  onChange: (event) => { addRefs(event.target.files, 'video'); event.target.value = ''; },
                })),

              e('div', { className: 'bs-params' },
                e(Field, { label: '模型' },
                  e('select', {
                    className: 'bs-select', value: model,
                    onChange: (event) => setModel(event.target.value),
                  }, modelOptions.map((item) => e('option', { key: item.id || 'default', value: item.id }, item.name)))),
                view === 'image'
                  ? e(Field, { label: '尺寸 / 比例' },
                      e('select', {
                        className: 'bs-select', value: size,
                        onChange: (event) => setSize(event.target.value),
                      }, ['1:1', '3:4', '4:3', '16:9', '9:16', '1024*1024', '1280*720'].map((value) => e('option', { key: value, value }, value))))
                  : e(Field, { label: '分辨率' },
                      e('select', {
                        className: 'bs-select', value: resolution,
                        onChange: (event) => setResolution(event.target.value),
                      }, resolutionChoices.map((item) => e('option', { key: item.value, value: item.value }, item.label)))),
                view === 'image'
                  ? e(Field, { label: '张数' },
                      e('select', {
                        className: 'bs-select', value: count,
                        onChange: (event) => setCount(Number(event.target.value)),
                      }, [1, 2, 3, 4, 5, 6].map((value) => e('option', { key: value, value }, String(value) + ' 张'))))
                  : e(Field, { label: '时长' },
                      e('select', {
                        className: 'bs-select', value: duration,
                        onChange: (event) => setDuration(Number(event.target.value)),
                      }, [
                        { value: -1, label: '自动（按口播）' },
                        3, 5, 8, 10,
                      ].map((item) => {
                        const value = typeof item === 'object' ? item.value : item;
                        const label = typeof item === 'object' ? item.label : String(item) + ' 秒';
                        return e('option', { key: String(value), value }, label);
                      }))),
                view === 'image'
                  ? e(Field, { label: '水印' },
                      e('label', { className: 'bs-check' },
                        e('input', { type: 'checkbox', checked: watermark, onChange: (event) => setWatermark(event.target.checked) }),
                        '添加百炼水印'))
                  : e(Field, { label: '画面比例' },
                      e('select', {
                        className: 'bs-select', value: ratio,
                        onChange: (event) => setRatio(event.target.value),
                      }, ['16:9', '9:16', '1:1', '4:3'].map((value) => e('option', { key: value, value }, value)))),
                view === 'image'
                  ? null
                  : e(Field, { label: '水印' },
                      e('label', { className: 'bs-check' },
                        e('input', { type: 'checkbox', checked: watermark, onChange: (event) => setWatermark(event.target.checked) }),
                        '添加'))),

              e('button', { type: 'button', className: 'bs-btn primary bs-generate', disabled, onClick: submit },
                e(SparkleIcon, { size: 15 }),
                view === 'image' ? '生成图片' : '生成视频'),

              e('div', { className: 'bs-note' },
                '由本机 bailian CLI 执行，按百炼实际用量计费；图片/视频会保存到本机输出目录，生成后可在「记录」页查看。'),

              error
                ? e('div', { className: 'bs-error' },
                    e('div', null, (error.code ? '[' + error.code + '] ' : '') + error.message),
                    error.log ? e('pre', null, error.log) : null)
                : null,

              result ? e(ResultBlock, { result, onOpenLocal: openLocal }) : null),

        editingProvider
          ? e(ProviderEditModal, {
              draft: editingProvider,
              setDraft: setEditingProvider,
              saving: savingProvider,
              onSave: saveProvider,
              onClose: () => setEditingProvider(null),
            })
          : null,

        detailId
          ? e(RecordModal, {
              record: records.find((record) => record.id === detailId) || null,
              onClose: () => setDetailId(null),
              onPreview: (file) => { setPreviewFile(file); },
              onOpenLocal: openLocal,
              onNotify: setNotice,
            })
          : null,

        actionMenu ? (() => {
          const record = records.find((item) => item.id === actionMenu.recordId);
          if (!record) return null;
          const first = Array.isArray(record.files) ? record.files[0] : null;
          return e('div', { className: 'bs-action-backdrop', onClick: () => setActionMenu(null) },
            e('div', {
              className: 'bs-action-menu',
              style: { left: actionMenu.left, top: actionMenu.top },
              onClick: (event) => event.stopPropagation(),
            },
              e('button', {
                type: 'button', className: 'bs-action-item',
                onClick: () => {
                  setActionMenu(null);
                  if (!first) {
                    setNotice('这条记录还没有文件');
                    return;
                  }
                  if (first.kind === 'video') openLocal(first);
                  else setPreviewFile(first);
                },
              }, first && first.kind === 'video' ? '播放' : '查看'),
              e('button', {
                type: 'button', className: 'bs-action-item',
                onClick: () => {
                  setActionMenu(null);
                  if (!first) {
                    setNotice('这条记录还没有文件');
                    return;
                  }
                  copyFileToClipboard(first).then((result) => {
                    const label = first.kind === 'video' ? '视频' : '图片';
                    if (result.ok) setNotice('已复制' + label + '到剪贴板');
                    else if (result.fallback) setNotice('浏览器不支持复制' + label + '文件，已复制文件路径');
                    else setNotice('复制失败：' + ((result.error && result.error.message) || '未知错误'));
                  });
                },
              }, first && first.kind === 'video' ? '复制视频' : '复制图片'),
              e('button', {
                type: 'button', className: 'bs-action-item',
                onClick: () => revealRecord(record),
              }, '打开文件夹'),
              e('button', {
                type: 'button', className: 'bs-action-item danger',
                onClick: () => removeRecord(record),
              }, '删除')));
        })() : null,

        previewFile
          ? e('div', { className: 'bs-modal', style: { zIndex: 10000 }, onClick: () => setPreviewFile(null) },
              e('div', { className: 'bs-image-card', onClick: (event) => event.stopPropagation() },
                e('img', { src: previewFile.url, alt: previewFile.name }),
                e('div', { className: 'bs-filemeta' },
                  e('span', null, previewFile.name + (previewFile.bytes ? ' · ' + formatBytes(previewFile.bytes) : '')),
                  e('a', { href: previewFile.url, target: '_blank', rel: 'noreferrer' }, '新标签打开'),
                  e('a', { href: previewFile.url, download: previewFile.name }, '下载'),
                  e('button', { type: 'button', className: 'bs-mini', onClick: () => setPreviewFile(null) }, '关闭'))))
          : null,

        e('div', { className: 'bs-note', style: { marginTop: '2px' } },
          status && status.outputDir ? '输出目录：' + status.outputDir : null));
    }

    function makeOpenButton(ctx) {
      function OpenBailianButton() {
        return e('button', {
          type: 'button',
          className: 'bs-open-btn',
          title: '百炼创作台（右侧栏）',
          'aria-label': '打开百炼创作台',
          onClick: () => {
            try {
              ctx.sidebarRight.openTab(TAB_KIND);
            } catch (error) {
              console.warn('[dsh-bailian-studio] 打开右侧栏失败', error);
            }
          },
        }, e(SparkleIcon, { size: 16 }));
      }
      return OpenBailianButton;
    }

    function PanelIcon(props) {
      const size = props && props.size ? props.size : 16;
      return e('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        'aria-hidden': true,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }, e('path', { d: 'M4 12h2l2-5 3 10 3-13 2 8h4' }));
    }

    function installStyles() {
      const element = document.createElement('style');
      element.setAttribute('data-dsh-bailian-studio-styles', '1');
      element.textContent = CSS;
      document.head.appendChild(element);
      return () => {
        try { element.remove(); } catch (error) { /* 已移除 */ }
      };
    }

    const definition = {
      id: TAB_ID,
      kind: TAB_KIND,
      priority: 'extension',
      title: () => '百炼创作台',
      guide: [{
        order: 92,
        title: () => '百炼创作台',
        description: () => '用 bailian CLI 生成图片与视频',
      }],
    };

    const inject = ['slots', 'sidebarRightTabs', 'sidebarRight'];

    function apply(ctx) {
      try {
        ctx.effect(() => installStyles(), 'dsh-bailian-studio: styles');
      } catch (error) {
        console.warn('[dsh-bailian-studio] 样式注入失败', error);
      }

      try {
        ctx.effect(() => ctx.sidebarRightTabs.register(definition), 'dsh-bailian-studio: 右侧栏 tab 类型');
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
        }, StudioPanel)), 'dsh-bailian-studio: 右侧栏 tab 内容');
      } catch (error) {
        console.error('[dsh-bailian-studio] 右侧栏注册失败', error);
      }

      try {
        const OpenButton = makeOpenButton(ctx);
        ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'bailian-studio-open',
          order: 4,
        }, OpenButton)), 'dsh-bailian-studio: 会话头部入口');
      } catch (error) {
        console.warn('[dsh-bailian-studio] 会话头部入口注册失败（仍可从右侧栏 guide 进入）', error);
      }

      // 左侧边栏入口 + 整页面板：默认开启，可在「服务商设置 → 界面」里关闭。
      const PANEL_ID = 'dsh-bailian-studio';
      let sidebarDisposers = null;
      const setSidebarVisible = (visible) => {
        if (visible && sidebarDisposers === null) {
          const disposeList = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 22,
            label: '百炼创作台',
          }, PanelIcon));
          const disposeMain = ctx.slots.inject('main', () => ctx.slots.register({
            name: 'main',
            key: PANEL_ID,
          }, StudioPanel));
          sidebarDisposers = [disposeList, disposeMain];
        } else if (!visible && sidebarDisposers !== null) {
          for (const dispose of sidebarDisposers) {
            try { dispose(); } catch (error) { /* 忽略 */ }
          }
          sidebarDisposers = null;
        }
      };
      try {
        setSidebarVisible(readSidebarVisible());
      } catch (error) {
        console.warn('[dsh-bailian-studio] 左侧栏入口注册失败', error);
      }
      if (typeof window !== 'undefined') {
        window.__dshBailianStudio = { setSidebarVisible };
      }
    }

    return { inject, apply };
  },
});
