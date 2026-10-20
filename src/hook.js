// CaptionDock network hook.
//
// Runs in the page's own JavaScript world ("MAIN") at document_start, before
// any YouTube script. It wraps window.fetch and XMLHttpRequest so we can read
// the caption files that YouTube's player downloads for itself (those requests
// carry the PO token that a direct fetch would lack). The raw response text is
// handed to content.js with window.postMessage; all parsing happens there.
//
// This file shares globals with YouTube and cannot use chrome.* APIs, so keep
// it small and defensive. It also cannot import youtube-adapter.js, which is
// why the few YouTube-specific names it needs are repeated below.
(() => {
  'use strict';

  const FLAG = '__captionDockHookInstalled';
  if (window[FLAG]) return;
  Object.defineProperty(window, FLAG, { value: true });

  // Message types. Must match MSG in config.js.
  const MSG_TIMEDTEXT = 'captiondock:timedtext';
  const MSG_HELLO = 'captiondock:hello';
  const MSG_HOOK_READY = 'captiondock:hook-ready';
  const MSG_INFO_REQUEST = 'captiondock:player-info-request';
  const MSG_INFO = 'captiondock:player-info';

  // YouTube specifics (mirrors youtube-adapter.js).
  const TIMEDTEXT_PATH = '/api/timedtext';
  const PLAYER_ID = 'movie_player';

  // Captions can arrive before content.js (document_idle) is listening, so
  // keep the last few payloads and replay them when it says hello.
  const BUFFER_SIZE = 6;
  const buffer = [];
  const origin = window.location.origin;

  function absoluteUrl(url) {
    try {
      return new URL(String(url), window.location.href).href;
    } catch {
      return String(url);
    }
  }

  function isTimedText(url) {
    return typeof url === 'string' && url.indexOf(TIMEDTEXT_PATH) !== -1;
  }

  function emit(url, status, body, via) {
    const msg = { type: MSG_TIMEDTEXT, url: absoluteUrl(url), status, body: body || '', via, at: Date.now() };
    if (msg.body) {
      buffer.push(msg);
      if (buffer.length > BUFFER_SIZE) buffer.shift();
    }
    window.postMessage(msg, origin);
  }

  // fetch
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function fetch(input) {
      const promise = nativeFetch.apply(this, arguments);
      let url = '';
      try {
        if (typeof input === 'string') url = input;
        else if (input instanceof URL) url = input.href;
        else if (input && typeof input.url === 'string') url = input.url;
      } catch {
        url = '';
      }
      if (isTimedText(url)) {
        promise.then(
          (res) => {
            if (!res || !res.ok) {
              emit(url, res ? res.status : 0, '', 'fetch');
              return;
            }
            res
              .clone()
              .text()
              .then((text) => emit(res.url || url, res.status, text, 'fetch'), () => {});
          },
          () => {}
        );
      }
      return promise;
    };
  }

  // XMLHttpRequest
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const urls = new WeakMap();
    const nativeOpen = XHR.prototype.open;
    const nativeSend = XHR.prototype.send;

    XHR.prototype.open = function open(method, url) {
      try {
        urls.set(this, url instanceof URL ? url.href : String(url));
      } catch {
        // Ignore: we just will not watch this request.
      }
      return nativeOpen.apply(this, arguments);
    };

    XHR.prototype.send = function send() {
      const url = urls.get(this);
      if (url && isTimedText(url)) {
        this.addEventListener('load', () => {
          try {
            const ok = this.status >= 200 && this.status < 300;
            const finalUrl = this.responseURL || url;
            if (!ok) {
              emit(finalUrl, this.status, '', 'xhr');
              return;
            }
            const type = this.responseType;
            if (type === '' || type === 'text') {
              emit(finalUrl, this.status, this.responseText, 'xhr');
            } else if (type === 'json') {
              emit(finalUrl, this.status, this.response == null ? '' : JSON.stringify(this.response), 'xhr');
            } else if (type === 'arraybuffer' && this.response) {
              emit(finalUrl, this.status, new TextDecoder().decode(this.response), 'xhr');
            } else if (type === 'blob' && this.response) {
              this.response.text().then((text) => emit(finalUrl, this.status, text, 'xhr'), () => {});
            }
          } catch {
            // Never break YouTube because of us.
          }
        });
      }
      return nativeSend.apply(this, arguments);
    };
  }

  // Player info: content.js cannot call the player's JavaScript methods from
  // its isolated world, so it asks us.
  function readPlayerInfo() {
    const info = {
      videoId: null,
      apiAvailable: false,
      hasCaptions: null,
      trackCount: null,
      isLive: false,
      isUpcoming: false,
    };
    try {
      const player = document.getElementById(PLAYER_ID);
      if (!player) return info;
      if (typeof player.getPlayerResponse === 'function') {
        const resp = player.getPlayerResponse();
        info.apiAvailable = true;
        if (resp) {
          const details = resp.videoDetails || {};
          const tracks =
            resp.captions &&
            resp.captions.playerCaptionsTracklistRenderer &&
            resp.captions.playerCaptionsTracklistRenderer.captionTracks;
          info.videoId = details.videoId || null;
          info.trackCount = Array.isArray(tracks) ? tracks.length : 0;
          info.hasCaptions = info.trackCount > 0;
          info.isLive = !!details.isLive;
          info.isUpcoming = !!details.isUpcoming;
        }
      }
      if (!info.videoId && typeof player.getVideoData === 'function') {
        const data = player.getVideoData();
        if (data && data.video_id) info.videoId = data.video_id;
      }
    } catch {
      // Player API changed; content.js falls back to timeouts.
    }
    return info;
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || typeof data.type !== 'string') return;
    if (data.type === MSG_HELLO) {
      window.postMessage({ type: MSG_HOOK_READY, buffered: buffer.length }, origin);
      for (const msg of buffer) window.postMessage(msg, origin);
    } else if (data.type === MSG_INFO_REQUEST) {
      window.postMessage({ type: MSG_INFO, id: data.id, info: readPlayerInfo() }, origin);
    }
  });
})();
