// Everything YouTube specific lives here: CSS selectors, URL patterns and
// caption parsers. YouTube changes these without notice, so when something
// breaks, this is the first file to look at. (hook.js repeats the timedtext
// path and player id because it runs in a different JavaScript world.)
//
// The parsers are plain string code (no DOMParser) so they run the same in the
// browser and in the Node unit tests.
(function (root) {
  'use strict';

  const SELECTORS = {
    player: '#movie_player',
    video: '#movie_player video.html5-main-video, #movie_player video',
    ccButton: '#movie_player .ytp-subtitles-button',
    rightControls: '#movie_player .ytp-right-controls',
    captionContainer: '#movie_player .ytp-caption-window-container',
    captionLine: '.caption-visual-line',
    captionSegment: '.ytp-caption-segment',
    miniplayerActive: 'ytd-app[miniplayer-is-active]',
  };

  // Classes YouTube puts on #movie_player while an ad plays.
  const AD_CLASSES = ['ad-showing', 'ad-interrupting'];

  const TIMEDTEXT_PATH = '/api/timedtext';
  const NAVIGATE_EVENT = 'yt-navigate-finish';

  // ---------------------------------------------------------------- URLs

  function getVideoIdFromUrl(href) {
    try {
      const url = new URL(href, 'https://www.youtube.com');
      if (url.pathname === '/watch') return url.searchParams.get('v') || null;
      const m = url.pathname.match(/^\/live\/([\w-]{6,})/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  function isWatchPage(href) {
    return getVideoIdFromUrl(href) !== null;
  }

  function isTimedTextUrl(url) {
    return typeof url === 'string' && url.includes(TIMEDTEXT_PATH);
  }

  function parseTimedTextUrl(href) {
    const info = { videoId: null, lang: '', kind: '', tlang: '', fmt: '', name: '' };
    try {
      const p = new URL(href, 'https://www.youtube.com').searchParams;
      info.videoId = p.get('v') || null;
      info.lang = p.get('lang') || '';
      info.kind = p.get('kind') || '';
      info.tlang = p.get('tlang') || '';
      info.fmt = p.get('fmt') || '';
      info.name = p.get('name') || '';
    } catch {
      // Keep the empty defaults.
    }
    return info;
  }

  // One key per video + track, for example "abc123|en|asr|to-fr".
  function trackKey(info) {
    return [info.videoId || '?', info.lang || '?', info.kind || 'standard', info.tlang ? 'to-' + info.tlang : '']
      .join('|')
      .replace(/\|$/, '');
  }

  function languageName(code) {
    if (!code) return '';
    try {
      const locale = (root.navigator && root.navigator.language) || 'en';
      return new Intl.DisplayNames([locale], { type: 'language' }).of(code) || code;
    } catch {
      return code;
    }
  }

  function describeTrack(info) {
    let label = languageName(info.lang) || 'Unknown language';
    if (info.kind === 'asr') label += ' (auto-generated)';
    if (info.tlang) label += ', translated to ' + languageName(info.tlang);
    return label;
  }

  // ------------------------------------------------------------- parsers

  const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };

  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
      if (body[0] === '#') {
        const hex = body[1] === 'x' || body[1] === 'X';
        const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
      }
      const named = NAMED_ENTITIES[body.toLowerCase()];
      return named === undefined ? match : named;
    });
  }

  function stripTags(s) {
    return String(s)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, '');
  }

  // Collapse whitespace (including newlines) and drop invisible characters.
  function cleanText(s) {
    return String(s)
      .replace(/[\u200b\u200e\u200f\ufeff]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function stripXssiPrefix(s) {
    return String(s).replace(/^\)\]\}'\s*/, '');
  }

  function readAttrs(s) {
    const attrs = {};
    String(s).replace(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, key, dq, sq) => {
      attrs[key] = dq !== undefined ? dq : sq;
      return '';
    });
    return attrs;
  }

  function seg(start, end, text) {
    return { start, end: Number.isFinite(end) && end > start ? end : start, text };
  }

  // fmt=json3: { events: [{ tStartMs, dDurationMs, segs: [{ utf8 }] }] }
  function parseJson3(body) {
    const data = typeof body === 'string' ? JSON.parse(stripXssiPrefix(body)) : body;
    const events = data && Array.isArray(data.events) ? data.events : [];
    const out = [];
    for (const ev of events) {
      // Events without segs only define caption windows; "\n" events with
      // aAppend just add a line break to a rolling ASR window.
      if (!ev || !Array.isArray(ev.segs)) continue;
      const text = cleanText(ev.segs.map((s) => (s && typeof s.utf8 === 'string' ? s.utf8 : '')).join(''));
      if (!text) continue;
      const start = Number(ev.tStartMs) / 1000;
      if (!Number.isFinite(start)) continue;
      out.push(seg(start, start + Number(ev.dDurationMs) / 1000, text));
    }
    return out;
  }

  // XML formats:
  //   srv3:      <timedtext format="3"><body><p t="ms" d="ms">text<s>word</s></p>
  //   srv1/srv2: <transcript><text start="s" dur="s">  or  <text t="ms" d="ms">
  // srv1 text is escaped twice (for example "I&amp;#39;m"), so decode twice.
  function parseXml(body) {
    const xml = String(body)
      .replace(/<p\b[^>]*\/>/g, '')
      .replace(/<text\b[^>]*\/>/g, '');
    const out = [];
    let m;

    const pRe = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
    while ((m = pRe.exec(xml))) {
      const a = readAttrs(m[1]);
      const start = Number(a.t) / 1000;
      const text = cleanText(decodeEntities(stripTags(m[2])));
      if (!text || !Number.isFinite(start)) continue;
      out.push(seg(start, start + Number(a.d) / 1000, text));
    }

    const tRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
    while ((m = tRe.exec(xml))) {
      const a = readAttrs(m[1]);
      let start;
      let end;
      if (a.start !== undefined) {
        start = Number(a.start);
        end = start + Number(a.dur);
      } else {
        start = Number(a.t) / 1000;
        end = start + Number(a.d) / 1000;
      }
      const text = cleanText(stripTags(decodeEntities(decodeEntities(m[2]))));
      if (!text || !Number.isFinite(start)) continue;
      out.push(seg(start, end, text));
    }
    return out;
  }

  function parseVttTime(s) {
    const parts = String(s).trim().split(':').map(Number);
    if (!parts.length || parts.some((n) => !Number.isFinite(n))) return NaN;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }

  // fmt=vtt (not what the player normally asks for, but cheap to support).
  function parseVtt(body) {
    const out = [];
    const blocks = String(body).replace(/\r/g, '').split(/\n{2,}/);
    for (const block of blocks) {
      const lines = block.split('\n');
      const idx = lines.findIndex((l) => l.includes('-->'));
      if (idx < 0) continue;
      const [from, rest] = lines[idx].split('-->');
      const start = parseVttTime(from);
      const end = parseVttTime(rest.trim().split(/\s+/)[0]);
      const text = cleanText(decodeEntities(stripTags(lines.slice(idx + 1).join(' '))));
      if (!text || !Number.isFinite(start)) continue;
      out.push(seg(start, end, text));
    }
    return out;
  }

  function detectFormat(body) {
    const s = stripXssiPrefix(String(body || ''))
      .replace(/^\ufeff/, '')
      .trimStart();
    if (!s) return 'empty';
    if (s[0] === '{') return 'json3';
    if (s.startsWith('WEBVTT')) return 'vtt';
    if (s[0] === '<') return 'xml';
    return 'unknown';
  }

  // Returns { format, segments: [{ start, end, text }], error? }. Segments are
  // normalized but not yet deduped; see transcript-store.js cleanSegments().
  function parseCaptionPayload(body) {
    const format = detectFormat(body);
    try {
      if (format === 'json3') return { format, segments: parseJson3(body) };
      if (format === 'xml') return { format, segments: parseXml(body) };
      if (format === 'vtt') return { format, segments: parseVtt(body) };
      return { format, segments: [] };
    } catch (err) {
      return { format, segments: [], error: String((err && err.message) || err) };
    }
  }

  // ----------------------------------------------------------------- DOM

  function getPlayer(doc = root.document) {
    return doc.querySelector(SELECTORS.player);
  }

  function getVideo(doc = root.document) {
    return doc.querySelector(SELECTORS.video);
  }

  function isAdShowing(player) {
    return !!player && AD_CLASSES.some((c) => player.classList.contains(c));
  }

  function isMiniplayerActive(doc = root.document) {
    return !!doc.querySelector(SELECTORS.miniplayerActive);
  }

  function getCaptionsButton(doc = root.document) {
    return doc.querySelector(SELECTORS.ccButton);
  }

  // 'on' | 'off' | 'unavailable' | 'missing'
  function getCaptionsState(doc = root.document) {
    const btn = getCaptionsButton(doc);
    if (!btn) return 'missing';
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true' || btn.style.display === 'none') {
      return 'unavailable';
    }
    const pressed = btn.getAttribute('aria-pressed');
    if (pressed === 'true') return 'on';
    if (pressed === 'false') return 'off';
    return 'unavailable';
  }

  // Clicks CC only when it is clearly off, so we never turn it off by mistake.
  function turnCaptionsOn(doc = root.document) {
    const btn = getCaptionsButton(doc);
    if (btn && getCaptionsState(doc) === 'off') {
      btn.click();
      return true;
    }
    return false;
  }

  // Where to put our player button: right before the CC button if we can,
  // otherwise at the start of the right-hand controls.
  function findButtonAnchor(doc = root.document) {
    const cc = getCaptionsButton(doc);
    if (cc && cc.parentElement) return { parent: cc.parentElement, before: cc };
    const right = doc.querySelector(SELECTORS.rightControls);
    if (right) return { parent: right, before: right.firstChild };
    return null;
  }

  // Text of the caption lines YouTube is currently drawing over the video.
  function readVisibleCaptionLines(doc = root.document) {
    const container = doc.querySelector(SELECTORS.captionContainer);
    if (!container) return [];
    const join = (nodes) => cleanText(Array.from(nodes, (n) => n.textContent || '').join(' '));
    const lines = container.querySelectorAll(SELECTORS.captionLine);
    const out = [];
    if (lines.length) {
      for (const line of lines) {
        const text = join(line.querySelectorAll(SELECTORS.captionSegment));
        if (text) out.push(text);
      }
    } else {
      for (const segment of container.querySelectorAll(SELECTORS.captionSegment)) {
        const text = cleanText(segment.textContent || '');
        if (text) out.push(text);
      }
    }
    return out;
  }

  const adapter = {
    SELECTORS,
    TIMEDTEXT_PATH,
    NAVIGATE_EVENT,
    getVideoIdFromUrl,
    isWatchPage,
    isTimedTextUrl,
    parseTimedTextUrl,
    trackKey,
    describeTrack,
    decodeEntities,
    cleanText,
    detectFormat,
    parseJson3,
    parseXml,
    parseVtt,
    parseCaptionPayload,
    getPlayer,
    getVideo,
    isAdShowing,
    isMiniplayerActive,
    getCaptionsState,
    turnCaptionsOn,
    findButtonAnchor,
    readVisibleCaptionLines,
  };

  (root.CaptionDock = root.CaptionDock || {}).youtube = adapter;
  if (typeof module === 'object' && module.exports) module.exports = adapter;
})(globalThis);
