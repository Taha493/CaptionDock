// User settings, saved with chrome.storage.local so they survive restarts.
(function (root) {
  'use strict';

  const CaptionDock = root.CaptionDock;
  const KEY = 'settings';
  const DEBUG_KEY = 'debug';

  const DEFAULTS = Object.freeze({
    fontSize: 18,
    bgOpacity: 0.85,
    autoScroll: true,
    hideNative: false,
  });
  const LIMITS = { fontSize: [12, 40], bgOpacity: [0.3, 1] };

  let current = { ...DEFAULTS };
  const listeners = new Set();

  function clamp(value, [min, max], fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function sanitize(s) {
    return {
      fontSize: Math.round(clamp(s.fontSize, LIMITS.fontSize, DEFAULTS.fontSize)),
      bgOpacity: Math.round(clamp(s.bgOpacity, LIMITS.bgOpacity, DEFAULTS.bgOpacity) * 100) / 100,
      autoScroll: typeof s.autoScroll === 'boolean' ? s.autoScroll : DEFAULTS.autoScroll,
      hideNative: typeof s.hideNative === 'boolean' ? s.hideNative : DEFAULTS.hideNative,
    };
  }

  // False after the extension was reloaded or updated while this tab stayed
  // open. chrome.* calls then throw "Extension context invalidated".
  function isContextValid() {
    try {
      return !!(root.chrome && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  function storage() {
    return isContextValid() && chrome.storage ? chrome.storage.local : null;
  }

  function notify() {
    for (const fn of listeners) {
      try {
        fn(current);
      } catch (err) {
        CaptionDock.warn('settings listener failed', err);
      }
    }
  }

  async function load() {
    const area = storage();
    if (!area) return current;
    try {
      const stored = await area.get([KEY, DEBUG_KEY]);
      CaptionDock.setDebug(stored[DEBUG_KEY] === true);
      current = sanitize({ ...DEFAULTS, ...(stored[KEY] || {}) });
      notify();
    } catch (err) {
      CaptionDock.warn('Could not load settings, using defaults.', err);
    }
    return current;
  }

  function get() {
    return current;
  }

  function update(patch) {
    const next = sanitize({ ...current, ...patch });
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    current = next;
    notify();
    const area = storage();
    if (!area) return;
    try {
      area.set({ [KEY]: current }).catch((err) => CaptionDock.warn('Could not save settings.', err));
    } catch (err) {
      CaptionDock.warn('Could not save settings.', err);
    }
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // Keep other YouTube tabs in sync, and let the debug flag flip live.
  try {
    if (isContextValid()) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (changes[DEBUG_KEY]) {
          CaptionDock.setDebug(changes[DEBUG_KEY].newValue === true);
          console.info('[CaptionDock] debug mode', CaptionDock.isDebug() ? 'on' : 'off');
        }
        if (changes[KEY]) {
          const next = sanitize({ ...DEFAULTS, ...(changes[KEY].newValue || {}) });
          if (JSON.stringify(next) === JSON.stringify(current)) return;
          current = next;
          notify();
        }
      });
    }
  } catch {
    // Context already invalid; nothing to sync.
  }

  CaptionDock.settings = { DEFAULTS, LIMITS, load, get, update, onChange, isContextValid };
})(globalThis);
