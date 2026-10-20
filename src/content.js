// CaptionDock controller (isolated world, document_idle).
//
// - Adds the "Open caption window" button to the YouTube player.
// - Receives caption files captured by hook.js and keeps them per video.
// - Opens the floating Document Picture-in-Picture window and keeps it in
//   sync across video changes, ads and the DOM fallback mode.
(function () {
  'use strict';

  const CD = globalThis.CaptionDock;
  if (!CD || CD.contentStarted) return;
  CD.contentStarted = true;

  const { config, youtube: yt, transcript: T, settings } = CD;
  const { MSG } = config;
  const log = CD.log;

  const RELOADED_NOTICE = 'CaptionDock was reloaded or updated. Refresh this YouTube tab to reconnect it.';
  const VIEWS = {
    idle: {
      emptyTitle: 'No video playing',
      emptyBody: 'Open a YouTube video in this tab and its captions will show up here.',
    },
    waiting: {
      emptyTitle: 'Waiting for captions...',
      emptyBody: 'CaptionDock turns on CC in the player and reads the captions YouTube loads. This takes a moment.',
    },
    upcoming: {
      emptyTitle: 'Not started yet',
      emptyBody: 'This premiere or live stream has not started. Captions will appear once it does.',
    },
    live: {
      emptyTitle: 'Captions are empty',
      emptyBody: 'YouTube sent a caption track with no text in it. Try another caption language.',
    },
    fallback: {
      notice: 'Fallback mode: reading captions from the player as they appear. Earlier lines are missing and timing is approximate.',
      emptyTitle: 'Listening for captions...',
      emptyBody: 'Lines appear here as YouTube shows them on the video. Keep CC turned on in the player.',
    },
    fallbackLive: {
      notice: 'Live stream: reading captions from the player as they appear.',
      emptyTitle: 'Listening for captions...',
      emptyBody: 'Lines appear here as YouTube shows them. Not every live stream has captions.',
    },
    none: {
      emptyTitle: 'No captions for this video',
      emptyBody: 'This video has no captions or auto-generated captions, so there is nothing to show. Try another video.',
    },
  };

  const store = new T.TranscriptStore(config.MAX_STORED_VIDEOS);
  const state = {
    pip: null,
    ui: null,
    videoId: null,
    mode: null,
    playerInfo: null,
    fallback: null, // { videoId, rolling, observer, pending, capture }
    waitingSince: 0,
    navigatedAt: 0,
    player: null,
    video: null,
    ccHandledFor: null,
    ccOff: false,
    contextValid: true,
    hookReady: false,
    lastHref: location.href,
  };

  let playerButton = null;
  let fallbackButton = null;
  let anchorMisses = 0;
  let toastTimer = 0;
  let infoRequestId = 0;

  // ------------------------------------------------------------ helpers

  function post(message) {
    window.postMessage(message, location.origin);
  }

  function getPlayer() {
    if (!state.player || !state.player.isConnected) state.player = yt.getPlayer();
    return state.player;
  }

  // YouTube can swap the <video> element, so re-find it when it goes away.
  function getVideo() {
    if (!state.video || !state.video.isConnected) state.video = yt.getVideo();
    return state.video;
  }

  function currentVideoId() {
    const fromUrl = yt.getVideoIdFromUrl(location.href);
    if (fromUrl) return fromUrl;
    // On the home page with the miniplayer open, the same video keeps playing.
    if (yt.isMiniplayerActive()) return state.videoId;
    return null;
  }

  function infoFor(videoId) {
    const info = state.playerInfo;
    return info && videoId && info.videoId === videoId ? info : null;
  }

  function requestPlayerInfo() {
    post({ type: MSG.PLAYER_INFO_REQUEST, id: ++infoRequestId });
  }

  function toast(message) {
    let el = document.querySelector('.captiondock-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'captiondock-toast';
      el.setAttribute('role', 'alert');
      document.body.append(el);
    }
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 7000);
  }

  // ----------------------------------------------- messages from hook.js

  function onMessage(event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
    if (data.type === MSG.TIMEDTEXT) onTimedText(data);
    else if (data.type === MSG.PLAYER_INFO) onPlayerInfo(data);
    else if (data.type === MSG.HOOK_READY) {
      state.hookReady = true;
      log('hook: active, replaying', data.buffered, 'buffered caption response(s)');
    }
  }

  function onTimedText(data) {
    if (typeof data.url !== 'string' || typeof data.body !== 'string') return;
    const info = yt.parseTimedTextUrl(data.url);
    if (!data.body.trim()) {
      log('hook: empty timedtext response', { via: data.via, status: data.status, url: data.url });
      return;
    }
    // A caption request without a video id during an ad belongs to the ad.
    if (!info.videoId && yt.isAdShowing(getPlayer())) return;
    const videoId = info.videoId || state.videoId;

    const parsed = yt.parseCaptionPayload(data.body);
    const segments = T.cleanSegments(parsed.segments);
    log('hook: timedtext via ' + data.via, {
      videoId,
      lang: info.lang,
      kind: info.kind || 'standard',
      tlang: info.tlang,
      format: parsed.format,
      bytes: data.body.length,
      parsed: parsed.segments.length,
      cleaned: segments.length,
      error: parsed.error,
      current: videoId === state.videoId,
    });
    if (!videoId || !segments.length) return;

    // Newest track wins, so switching caption language replaces the text.
    store.put(videoId, {
      key: yt.trackKey({ ...info, videoId }),
      label: yt.describeTrack(info),
      segments,
      receivedAt: Date.now(),
    });
    if (videoId === state.videoId) refresh();
  }

  function onPlayerInfo(data) {
    if (!data.info) return;
    const prev = state.playerInfo;
    state.playerInfo = data.info;
    const changed =
      !prev ||
      prev.videoId !== data.info.videoId ||
      prev.hasCaptions !== data.info.hasCaptions ||
      prev.isLive !== data.info.isLive ||
      prev.isUpcoming !== data.info.isUpcoming;
    if (changed) log('player info', data.info);
    if (changed && infoFor(state.videoId)) refresh();
  }

  // ------------------------------------------------------- mode / view

  // Decides what the window should show for the current video.
  function refresh() {
    if (!state.ui) return;
    const videoId = state.videoId;
    if (!videoId) return show('idle', [], VIEWS.idle);

    const entry = store.get(videoId);
    if (entry) {
      stopFallback();
      return show('live', entry.segments, { ...VIEWS.live, detail: entry.label });
    }

    const info = infoFor(videoId);
    if (state.fallback) {
      return show('fallback', state.fallback.rolling.segments, info && info.isLive ? VIEWS.fallbackLive : VIEWS.fallback);
    }
    if (info && info.isUpcoming) return show('waiting', [], VIEWS.upcoming);
    if (info && info.hasCaptions === false && !info.isLive) return show('none', [], VIEWS.none);
    return show('waiting', [], VIEWS.waiting);
  }

  function show(mode, segments, view) {
    if (mode !== state.mode) {
      log('mode:', state.mode || '(none)', '->', mode, 'for video', state.videoId);
      if (mode === 'waiting') state.waitingSince = Date.now();
      state.mode = mode;
    }
    let notice = view.notice || '';
    if (mode === 'fallback' && state.ccOff) {
      notice = 'Turn on CC in the YouTube player. Fallback mode can only read captions that YouTube is showing.';
    }
    if (!state.contextValid) notice = RELOADED_NOTICE;
    state.ui.setStatus(mode, { ...view, notice });
    state.ui.setTranscript(segments);
  }

  // ------------------------------------------------------ DOM fallback

  function startFallback() {
    if (state.fallback && state.fallback.videoId === state.videoId) return;
    stopFallback();
    const player = getPlayer();
    if (!player) return;

    const fb = { videoId: state.videoId, rolling: new T.RollingTranscript(), observer: null, pending: false };
    fb.capture = () => {
      fb.pending = false;
      if (state.fallback !== fb || yt.isAdShowing(player)) return;
      const video = getVideo();
      if (!video) return;
      const lines = yt.readVisibleCaptionLines();
      if (lines.length && fb.rolling.observe(lines, video.currentTime) && state.ui && state.mode === 'fallback') {
        state.ui.setTranscript(fb.rolling.segments);
      }
    };
    fb.observer = new MutationObserver(() => {
      if (!fb.pending) {
        fb.pending = true;
        queueMicrotask(fb.capture);
      }
    });
    fb.observer.observe(player, { childList: true, subtree: true, characterData: true });
    state.fallback = fb;
    log('fallback: DOM observer started for', state.videoId);
    fb.capture();
  }

  function stopFallback() {
    if (!state.fallback) return;
    state.fallback.observer.disconnect();
    log('fallback: DOM observer stopped for', state.fallback.videoId);
    state.fallback = null;
  }

  // ------------------------------------------------------------- CC

  // Captions are only downloaded while CC is on, so turn it on once per video
  // while the window is open. Never turns CC off.
  function ensureCaptionsOn() {
    if (!state.ui || !state.videoId || state.ccHandledFor === state.videoId) return;
    if (Date.now() - state.navigatedAt < config.CC_SETTLE_MS) return;
    if (yt.isAdShowing(getPlayer())) return;
    const cc = yt.getCaptionsState();
    if (cc === 'off') {
      yt.turnCaptionsOn();
      log('CC was off, turned it on');
      state.ccHandledFor = state.videoId;
    } else if (cc === 'on' || cc === 'unavailable') {
      state.ccHandledFor = state.videoId;
    }
  }

  function applyHideNative() {
    document.documentElement.classList.toggle('captiondock-hide-native', !!state.pip && settings.get().hideNative);
  }

  // --------------------------------------------------------- navigation

  function onNavigate(reason) {
    state.lastHref = location.href;
    ensureButton();
    const id = currentVideoId();
    if (id === state.videoId) return;
    log('navigation (' + reason + '):', state.videoId, '->', id);
    state.videoId = id;
    state.navigatedAt = Date.now();
    state.video = null;
    state.player = null;
    state.ccHandledFor = null;
    state.mode = null; // restarts the fallback timer for the new video
    stopFallback();
    if (state.ui) {
      requestPlayerInfo();
      refresh();
    }
  }

  // ------------------------------------------------------------ window

  function getPlayback() {
    const video = getVideo();
    return { time: video ? video.currentTime : null, ad: yt.isAdShowing(getPlayer()) };
  }

  function seekTo(seconds) {
    const video = getVideo();
    if (!video || yt.isAdShowing(getPlayer())) return;
    video.currentTime = Math.max(0, seconds);
    log('seek to', seconds.toFixed(2));
  }

  async function toggleWindow() {
    // A second click closes the window (only one can exist anyway).
    if (state.pip) {
      state.pip.close();
      return;
    }
    if (!('documentPictureInPicture' in window)) {
      toast('CaptionDock needs Chrome, Edge or Brave version 116 or newer (the Document Picture-in-Picture feature is missing in this browser).');
      return;
    }

    const options = { width: config.WINDOW.width, height: config.WINDOW.height };
    if (config.PREFER_INITIAL_WINDOW_PLACEMENT) options.preferInitialWindowPlacement = true;

    let pip;
    try {
      // Must run right inside the click handler (user gesture), so nothing is
      // awaited before this call.
      pip = await window.documentPictureInPicture.requestWindow(options);
    } catch (err) {
      CD.warn('Could not open the caption window.', err);
      toast('Could not open the caption window: ' + ((err && err.message) || err));
      return;
    }

    state.pip = pip;
    state.mode = null;
    state.ui = CD.createPipUI(pip, {
      settings: settings.get(),
      getPlayback,
      onSeek: seekTo,
      onSettingsChange: (patch) => settings.update(patch),
    });
    pip.addEventListener('pagehide', onWindowClosed, { once: true });

    state.videoId = currentVideoId();
    state.ccHandledFor = null;
    state.navigatedAt = 0;
    updateButtons();
    applyHideNative();
    requestPlayerInfo();
    ensureCaptionsOn();
    refresh();
    log('window opened for video', state.videoId);
  }

  function onWindowClosed() {
    log('window closed');
    if (state.ui) state.ui.destroy();
    state.ui = null;
    state.pip = null;
    state.mode = null;
    stopFallback();
    updateButtons();
    applyHideNative();
  }

  // ------------------------------------------------------------ buttons

  function createIcon() {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 36 36');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.setAttribute('aria-hidden', 'true');
    const add = (tag, attrs) => {
      const node = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      svg.append(node);
    };
    add('rect', { x: 8, y: 10, width: 20, height: 16, rx: 2.5, fill: 'none', stroke: '#fff', 'stroke-width': 2 });
    add('rect', { x: 11.5, y: 16.6, width: 13, height: 2.4, rx: 1.2, fill: '#fff' });
    add('rect', { class: 'captiondock-icon-accent', x: 11.5, y: 20.8, width: 8.5, height: 2.4, rx: 1.2, fill: '#fff' });
    return svg;
  }

  function onButtonClick(event) {
    event.preventDefault();
    event.stopPropagation();
    toggleWindow();
  }

  function createPlayerButton() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ytp-button captiondock-player-btn';
    btn.append(createIcon());
    btn.addEventListener('click', onButtonClick);
    return btn;
  }

  function updateButtons() {
    const open = !!state.pip;
    const label = open ? 'Close caption window (CaptionDock)' : 'Open caption window (CaptionDock)';
    for (const btn of [playerButton, fallbackButton]) {
      if (!btn) continue;
      btn.setAttribute('aria-pressed', String(open));
      btn.setAttribute('aria-label', label);
      btn.title = label;
    }
  }

  // Puts our button next to the CC button. YouTube sometimes rebuilds the
  // control bar, so this runs on every tick and after navigation.
  function ensureButton() {
    const anchor = yt.findButtonAnchor();
    if (anchor) {
      anchorMisses = 0;
      if (!playerButton) {
        playerButton = createPlayerButton();
        updateButtons();
      }
      if (playerButton.parentElement !== anchor.parent) {
        anchor.parent.insertBefore(playerButton, anchor.before);
        log('player button inserted');
      }
      setFallbackButton(false);
      return;
    }
    anchorMisses++;
    setFallbackButton(yt.isWatchPage(location.href) && anchorMisses >= config.ANCHOR_MISSES_BEFORE_FALLBACK_BUTTON);
  }

  // Small floating button for when the player's control bar cannot be found.
  function setFallbackButton(visible) {
    if (visible && !fallbackButton) {
      fallbackButton = document.createElement('button');
      fallbackButton.type = 'button';
      fallbackButton.className = 'captiondock-fallback-btn';
      fallbackButton.textContent = 'Caption window';
      fallbackButton.addEventListener('click', onButtonClick);
      document.body.append(fallbackButton);
      updateButtons();
      log('control bar not found, showing the floating fallback button');
    } else if (!visible && fallbackButton) {
      fallbackButton.remove();
      fallbackButton = null;
    }
  }

  // ---------------------------------------------------------- main loop

  function tick() {
    if (location.href !== state.lastHref) onNavigate('url-change');
    ensureButton();
    if (!state.ui) return;

    const contextValid = settings.isContextValid();
    if (contextValid !== state.contextValid) {
      state.contextValid = contextValid;
      refresh();
    }

    if (state.videoId && !infoFor(state.videoId)) requestPlayerInfo();
    ensureCaptionsOn();

    const ccOff = yt.getCaptionsState() === 'off';
    if (ccOff !== state.ccOff) {
      state.ccOff = ccOff;
      if (state.mode === 'fallback') refresh();
    }

    const ad = yt.isAdShowing(getPlayer());
    if (state.mode === 'waiting') {
      const info = infoFor(state.videoId);
      if (ad) {
        state.waitingSince = Date.now(); // do not time out during an ad
      } else if ((info && info.isLive) || Date.now() - state.waitingSince > config.FALLBACK_TIMEOUT_MS) {
        log('no caption download for', state.videoId, 'so switching to fallback');
        startFallback();
        refresh();
      }
    } else if (state.mode === 'fallback' && state.fallback) {
      state.fallback.capture(); // keeps line end times fresh while text sits still
    }
  }

  // Handy from the DevTools console (pick the "CaptionDock" context first):
  //   CaptionDock.debugInfo()
  CD.debugInfo = () => ({
    videoId: state.videoId,
    windowOpen: !!state.pip,
    mode: state.mode,
    hookReady: state.hookReady,
    playerInfo: state.playerInfo,
    captions: yt.getCaptionsState(),
    stored: store.summary(),
    fallbackLines: state.fallback ? state.fallback.rolling.segments.length : null,
    settings: settings.get(),
    debug: CD.isDebug(),
  });

  // ------------------------------------------------------------ startup

  window.addEventListener('message', onMessage);
  document.addEventListener(yt.NAVIGATE_EVENT, () => onNavigate(yt.NAVIGATE_EVENT));
  settings.onChange((s) => {
    if (state.ui) state.ui.applySettings(s);
    applyHideNative();
  });

  state.videoId = currentVideoId();
  ensureButton();
  setInterval(tick, config.TICK_MS);

  settings.load().finally(() => {
    log('content script ready on', location.href, 'settings', settings.get());
    // Ask hook.js to confirm it is running and replay captions it caught
    // before we were listening.
    post({ type: MSG.HELLO });
    setTimeout(() => {
      if (!state.hookReady) CD.warn('Network hook did not answer. Refresh this tab; if it persists, see README troubleshooting.');
    }, 3000);
  });
})();
