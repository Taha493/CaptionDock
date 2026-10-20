// Shared constants and logging for the isolated-world scripts.
// Loaded first, so every other file can use globalThis.CaptionDock.
(function (root) {
  'use strict';

  const CaptionDock = (root.CaptionDock = root.CaptionDock || {});

  CaptionDock.config = {
    // Debug logging. Either set this to true, or turn it on at runtime with
    // chrome.storage.local.set({ debug: true }) (see README, "Debug mode").
    DEBUG: false,

    // window.postMessage types shared with hook.js. Keep both files in sync.
    MSG: {
      TIMEDTEXT: 'captiondock:timedtext',
      HELLO: 'captiondock:hello',
      HOOK_READY: 'captiondock:hook-ready',
      PLAYER_INFO_REQUEST: 'captiondock:player-info-request',
      PLAYER_INFO: 'captiondock:player-info',
    },

    WINDOW: { width: 480, height: 260 },

    // When true, Chrome 130+ opens the window at its default spot and size
    // every time instead of where you last left it. Off, because remembering
    // your placement is nicer. Older browsers ignore the option either way.
    PREFER_INITIAL_WINDOW_PLACEMENT: false,

    // How long to wait for the player's caption download before switching to
    // the DOM fallback.
    FALLBACK_TIMEOUT_MS: 5000,

    // After a video change, give YouTube this long to restore its own CC
    // setting before we click the CC button ourselves.
    CC_SETTLE_MS: 1500,

    // Housekeeping loop in the YouTube page (button, navigation, mode).
    TICK_MS: 1000,

    // Show the floating fallback button after this many ticks without
    // finding the player's control bar on a watch page.
    ANCHOR_MISSES_BEFORE_FALLBACK_BUTTON: 4,

    MAX_STORED_VIDEOS: 10,
  };

  let debugEnabled = CaptionDock.config.DEBUG;

  CaptionDock.setDebug = function (on) {
    debugEnabled = CaptionDock.config.DEBUG || on === true;
  };

  CaptionDock.isDebug = function () {
    return debugEnabled;
  };

  CaptionDock.log = function (...args) {
    if (debugEnabled) console.log('%c[CaptionDock]', 'color:#3ea6ff;font-weight:bold', ...args);
  };

  CaptionDock.warn = function (...args) {
    console.warn('[CaptionDock]', ...args);
  };
})(globalThis);
