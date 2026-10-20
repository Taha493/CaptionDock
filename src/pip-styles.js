// Styles for the floating window.
//
// This is CSS kept in a JS string on purpose. The floating window is a blank
// page that inherits YouTube's security rules, so it cannot load a .css file
// from the extension without making that file readable by youtube.com.
// pip-ui.js installs this text as a constructed stylesheet instead.
(function (root) {
  'use strict';

  (root.CaptionDock = root.CaptionDock || {}).pipStyles = `
:root {
  --cd-font-size: 18px;
  --cd-bg-alpha: 0.85;
  --cd-text: #ffffff;
  --cd-muted: rgba(255, 255, 255, 0.62);
  --cd-border: rgba(255, 255, 255, 0.1);
  --cd-accent: #3ea6ff;
  color-scheme: dark;
}

* { box-sizing: border-box; }

[hidden] { display: none !important; }

/* The window itself is opaque; the slider blends from gray to near black. */
html { height: 100%; background: #3a3a3a; }

body {
  margin: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(8, 8, 8, var(--cd-bg-alpha));
  color: var(--cd-text);
  font-family: Roboto, "YouTube Noto", Arial, Helvetica, sans-serif;
  -webkit-font-smoothing: antialiased;
}

.cd-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 4px 8px 4px 10px;
  border-bottom: 1px solid var(--cd-border);
  font-size: 12px;
  user-select: none;
}

.cd-status {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--cd-muted);
  white-space: nowrap;
}

.cd-status-text { overflow: hidden; text-overflow: ellipsis; }

.cd-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #8a8a8a;
}
.cd-status[data-tone="ok"] .cd-dot { background: #2ecc71; box-shadow: 0 0 6px rgba(46, 204, 113, 0.7); }
.cd-status[data-tone="warn"] .cd-dot { background: #f5a623; }
.cd-status[data-tone="off"] .cd-dot { background: #ff4e45; }
.cd-status[data-tone="pending"] .cd-dot { background: var(--cd-accent); animation: cd-pulse 1.4s ease-in-out infinite; }

.cd-controls { flex: none; display: flex; align-items: center; gap: 4px; }

.cd-btn {
  appearance: none;
  height: 22px;
  min-width: 26px;
  padding: 0 7px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.cd-btn:hover { background: rgba(255, 255, 255, 0.14); }
.cd-btn:focus-visible, .cd-range:focus-visible, .cd-jump:focus-visible { outline: 2px solid var(--cd-accent); outline-offset: 1px; }
.cd-btn[aria-pressed="true"] {
  background: rgba(62, 166, 255, 0.22);
  border-color: rgba(62, 166, 255, 0.6);
  color: #d3ebff;
}

.cd-range { width: 64px; height: 14px; margin: 0 2px; accent-color: var(--cd-accent); cursor: pointer; }

.cd-notice {
  flex: none;
  padding: 4px 10px;
  border-bottom: 1px solid rgba(245, 166, 35, 0.25);
  background: rgba(245, 166, 35, 0.14);
  color: #ffd89a;
  font-size: 12px;
  line-height: 1.4;
}

.cd-main { position: relative; flex: 1; min-height: 0; }

.cd-list {
  position: absolute;
  inset: 0;
  overflow-y: auto;
  padding: 10px 12px 45%;
  outline: none;
}
.cd-list::-webkit-scrollbar { width: 8px; }
.cd-list::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.18); border-radius: 4px; }
.cd-list::-webkit-scrollbar-track { background: transparent; }

.cd-line {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 3px 6px;
  border-radius: 6px;
  font-size: var(--cd-font-size);
  line-height: 1.45;
  opacity: 0.38;
  cursor: pointer;
  transition: opacity 0.2s ease, background-color 0.2s ease;
}
.cd-line.is-past { opacity: 0.62; }
.cd-line.is-active {
  opacity: 1;
  font-size: calc(var(--cd-font-size) * 1.12);
  background: rgba(255, 255, 255, 0.06);
}
.cd-line:hover { opacity: 0.9; background: rgba(255, 255, 255, 0.08); }

.cd-time {
  flex: none;
  min-width: 36px;
  color: var(--cd-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.cd-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }

.cd-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px 24px;
  text-align: center;
}
.cd-empty-title { font-size: 16px; font-weight: 500; }
.cd-empty-body { max-width: 36em; color: var(--cd-muted); font-size: 13px; line-height: 1.45; }

.cd-jump {
  position: absolute;
  right: 14px;
  bottom: 12px;
  height: 26px;
  padding: 0 12px;
  border: 0;
  border-radius: 13px;
  background: var(--cd-accent);
  color: #0b1a26;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
}

@keyframes cd-pulse { 50% { opacity: 0.35; } }

@media (max-width: 400px) {
  .cd-status-text { display: none; }
  .cd-range { width: 44px; }
}

@media (prefers-reduced-motion: reduce) {
  .cd-status[data-tone="pending"] .cd-dot { animation: none; }
  .cd-line { transition: none; }
}
`;
})(globalThis);
