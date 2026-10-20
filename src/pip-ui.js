// The floating window's UI: top bar, caption history, empty state and the
// render loop. content.js creates it after opening the Document
// Picture-in-Picture window and feeds it transcripts and status updates.
//
// The UI is built with createElement and textContent only. YouTube enforces
// Trusted Types, and the floating window inherits that, so innerHTML is out.
(function (root) {
  'use strict';

  const CaptionDock = (root.CaptionDock = root.CaptionDock || {});

  const HOLD_SECONDS = 2; // keep a line highlighted this long after it ends
  const FONT_STEP = 2;
  const SCROLL_ANCHOR = 0.55; // active line sits a bit below the middle
  const SCROLL_GUARD_MS = 700;
  const HEARTBEAT_MS = 500;

  const STATUS = {
    idle: { label: 'No video', tone: 'muted' },
    waiting: { label: 'Waiting for captions', tone: 'pending' },
    live: { label: 'Live captions', tone: 'ok' },
    fallback: { label: 'Fallback mode', tone: 'warn' },
    none: { label: 'No captions found', tone: 'off' },
    ad: { label: 'Ad playing, captions resume after it', tone: 'pending' },
  };

  function formatTime(sec) {
    const total = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
    const s = String(total % 60).padStart(2, '0');
    const m = Math.floor(total / 60) % 60;
    const h = Math.floor(total / 3600);
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function installStyles(pip, doc, cssText) {
    // A constructed stylesheet is not affected by the page's CSP.
    try {
      const sheet = new pip.CSSStyleSheet();
      sheet.replaceSync(cssText);
      doc.adoptedStyleSheets = [sheet];
      return;
    } catch (err) {
      CaptionDock.log('Constructed stylesheet failed, using <style>.', err);
    }
    const style = doc.createElement('style');
    style.textContent = cssText;
    doc.head.append(style);
  }

  // opts: {
  //   settings,                         current settings object
  //   getPlayback() -> { time, ad },    read from the YouTube <video>
  //   onSeek(seconds),
  //   onSettingsChange(patch),
  // }
  function createPipUI(pip, opts) {
    const doc = pip.document;
    const { findIndexAtTime } = CaptionDock.transcript;

    const make = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text != null) node.textContent = text;
      return node;
    };
    const makeButton = (label, title, toggle) => {
      const b = make('button', 'cd-btn', label);
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', title);
      if (toggle) b.setAttribute('aria-pressed', 'false');
      return b;
    };

    doc.title = 'CaptionDock';
    doc.documentElement.lang = 'en';
    installStyles(pip, doc, CaptionDock.pipStyles || '');

    // Layout
    const bar = make('header', 'cd-bar');
    const status = make('div', 'cd-status');
    const statusText = make('span', 'cd-status-text');
    status.append(make('span', 'cd-dot'), statusText);

    const controls = make('div', 'cd-controls');
    const fontDown = makeButton('A-', 'Smaller text');
    const fontUp = makeButton('A+', 'Larger text');
    const range = make('input', 'cd-range');
    range.type = 'range';
    range.min = '30';
    range.max = '100';
    range.step = '5';
    range.title = 'Background opacity';
    range.setAttribute('aria-label', 'Background opacity');
    const autoBtn = makeButton('Auto', 'Auto-scroll to the current line', true);
    const hideBtn = makeButton('Hide YT', "Hide YouTube's own captions on the video while this window is open", true);
    controls.append(fontDown, fontUp, range, autoBtn, hideBtn);
    bar.append(status, controls);

    const notice = make('div', 'cd-notice');
    notice.hidden = true;
    notice.setAttribute('role', 'status');

    const main = make('main', 'cd-main');
    const list = make('div', 'cd-list');
    list.tabIndex = 0;
    list.setAttribute('aria-label', 'Caption history');
    const empty = make('div', 'cd-empty');
    const emptyTitle = make('div', 'cd-empty-title');
    const emptyBody = make('div', 'cd-empty-body');
    empty.append(emptyTitle, emptyBody);
    const jump = make('button', 'cd-jump', 'Jump to live');
    jump.type = 'button';
    jump.hidden = true;
    main.append(list, empty, jump);

    doc.body.append(bar, notice, main);

    // State
    let settings = { ...opts.settings };
    let segments = [];
    let rendered = []; // segment objects currently drawn, by index
    let lineNodes = [];
    let lastStarted = -1;
    let lastActive = -1;
    let lastScrolled = -1;
    let userPaused = false;
    let programmaticUntil = 0;
    let view = { mode: 'waiting' };
    let inAd = false;
    let destroyed = false;
    let lastFrameAt = 0;

    // ------------------------------------------------------- transcript

    function makeLine(seg, index) {
      const node = make('div', 'cd-line');
      node.dataset.index = String(index);
      node.append(make('span', 'cd-time', formatTime(seg.start)), make('span', 'cd-text', seg.text));
      return node;
    }

    // Accepts a new or updated segment list. If the existing lines are still
    // the same objects (fallback mode appends and edits in place), only the
    // changes are drawn; otherwise the list is rebuilt.
    function setTranscript(next) {
      next = Array.isArray(next) ? next : [];
      let incremental = next.length >= rendered.length;
      for (let i = 0; incremental && i < rendered.length; i++) incremental = next[i] === rendered[i];

      if (incremental) {
        for (let i = 0; i < rendered.length; i++) {
          const textNode = lineNodes[i].lastChild;
          if (textNode.textContent !== next[i].text) textNode.textContent = next[i].text;
        }
      } else {
        list.textContent = '';
        lineNodes = [];
        rendered = [];
        lastStarted = lastActive = lastScrolled = -1;
      }

      if (next.length > rendered.length) {
        const frag = doc.createDocumentFragment();
        for (let i = rendered.length; i < next.length; i++) {
          const node = makeLine(next[i], i);
          if (i <= lastStarted) node.classList.add('is-past');
          lineNodes.push(node);
          frag.append(node);
        }
        list.append(frag);
      }

      segments = next;
      rendered = next.slice();
      updateEmpty();
      tick(true);
    }

    function setLineState(i, active, started) {
      const node = lineNodes[i];
      if (!node) return;
      node.classList.toggle('is-active', i === active);
      node.classList.toggle('is-past', i !== active && i <= started);
    }

    // Only touches the lines whose state can have changed.
    function updateLineStates(started, active) {
      const lo = Math.max(0, Math.min(started, lastStarted));
      const hi = Math.min(lineNodes.length - 1, Math.max(started, lastStarted));
      for (let i = lo; i <= hi; i++) setLineState(i, active, started);
      if (lastActive >= 0) setLineState(lastActive, active, started);
      if (active >= 0) setLineState(active, active, started);
      lastStarted = started;
      lastActive = active;
      updateJump();
    }

    // ------------------------------------------------------------ scroll

    function autoScrollOn() {
      return settings.autoScroll && !userPaused;
    }

    function scrollToLine(i, smooth = true) {
      const node = lineNodes[i];
      if (!node) return;
      lastScrolled = i;
      const top = Math.max(0, node.offsetTop - list.clientHeight * SCROLL_ANCHOR + node.offsetHeight / 2);
      const distance = Math.abs(list.scrollTop - top);
      if (distance < 2) return;
      programmaticUntil = Date.now() + SCROLL_GUARD_MS;
      const far = distance > list.clientHeight * 1.5;
      list.scrollTo({ top, behavior: smooth && !far ? 'smooth' : 'auto' });
    }

    function isLineVisible(i) {
      const node = lineNodes[i];
      if (!node) return true;
      return node.offsetTop >= list.scrollTop && node.offsetTop + node.offsetHeight <= list.scrollTop + list.clientHeight;
    }

    function updateJump() {
      const show = segments.length > 0 && lastStarted >= 0 && (userPaused || !settings.autoScroll) && !isLineVisible(lastStarted);
      if (jump.hidden === show) jump.hidden = !show;
    }

    function pauseAutoScroll() {
      if (userPaused || !settings.autoScroll) return;
      userPaused = true;
      updateJump();
    }

    list.addEventListener('wheel', pauseAutoScroll, { passive: true });
    list.addEventListener('touchmove', pauseAutoScroll, { passive: true });
    list.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) pauseAutoScroll();
    });
    // Dragging the scrollbar: the pointer lands on the list itself, right of
    // its content box.
    list.addEventListener('pointerdown', (e) => {
      if (e.target === list && e.offsetX > list.clientWidth) pauseAutoScroll();
    });
    list.addEventListener('scroll', () => {
      if (Date.now() > programmaticUntil) updateJump();
    }, { passive: true });

    jump.addEventListener('click', () => {
      userPaused = false;
      if (lastStarted >= 0) scrollToLine(lastStarted, true);
      jump.hidden = true;
    });

    // Click a line to seek the video there (unless the user is selecting text).
    list.addEventListener('click', (e) => {
      const selection = pip.getSelection && pip.getSelection();
      if (selection && String(selection).trim()) return;
      const line = e.target && e.target.closest ? e.target.closest('.cd-line') : null;
      if (!line) return;
      const seg = segments[Number(line.dataset.index)];
      if (!seg) return;
      userPaused = false;
      lastScrolled = -1;
      opts.onSeek(seg.start);
    });

    pip.addEventListener('resize', () => {
      lastScrolled = -1;
    });

    // ---------------------------------------------------- status / empty

    function renderStatus() {
      const s = STATUS[inAd ? 'ad' : view.mode] || STATUS.waiting;
      const label = !inAd && view.detail ? `${s.label} \u00b7 ${view.detail}` : s.label;
      status.dataset.tone = s.tone;
      statusText.textContent = label;
      status.title = label;
      const noticeText = inAd ? '' : view.notice || '';
      if (notice.textContent !== noticeText) notice.textContent = noticeText;
      notice.hidden = !noticeText;
    }

    function updateEmpty() {
      const show = segments.length === 0;
      empty.hidden = !show;
      if (show) {
        emptyTitle.textContent = view.emptyTitle || '';
        emptyBody.textContent = view.emptyBody || '';
      }
    }

    // view: { detail, notice, emptyTitle, emptyBody }
    function setStatus(mode, nextView) {
      view = { mode, ...(nextView || {}) };
      renderStatus();
      updateEmpty();
    }

    // ---------------------------------------------------------- settings

    function applySettings(next) {
      const turnedOnAutoScroll = next.autoScroll && !settings.autoScroll;
      settings = { ...next };
      const rootEl = doc.documentElement;
      rootEl.style.setProperty('--cd-font-size', settings.fontSize + 'px');
      rootEl.style.setProperty('--cd-bg-alpha', String(settings.bgOpacity));
      range.value = String(Math.round(settings.bgOpacity * 100));
      autoBtn.setAttribute('aria-pressed', String(settings.autoScroll));
      hideBtn.setAttribute('aria-pressed', String(settings.hideNative));
      if (turnedOnAutoScroll) userPaused = false;
      lastScrolled = -1; // line heights may have changed
      updateJump();
    }

    const change = (patch) => opts.onSettingsChange(patch);
    fontDown.addEventListener('click', () => change({ fontSize: settings.fontSize - FONT_STEP }));
    fontUp.addEventListener('click', () => change({ fontSize: settings.fontSize + FONT_STEP }));
    range.addEventListener('input', () => change({ bgOpacity: Number(range.value) / 100 }));
    autoBtn.addEventListener('click', () => change({ autoScroll: !settings.autoScroll }));
    hideBtn.addEventListener('click', () => change({ hideNative: !settings.hideNative }));

    // ------------------------------------------------------- render loop

    // Reads the YouTube video's clock and moves the highlight. Runs on the
    // floating window's animation frames, which keep firing while the
    // YouTube tab is in the background because this window is visible.
    function tick(force) {
      if (destroyed) return;
      let pb;
      try {
        pb = opts.getPlayback();
      } catch {
        pb = { time: null, ad: false };
      }
      if (!!pb.ad !== inAd) {
        inAd = !!pb.ad;
        renderStatus();
      }
      if (inAd || pb.time == null || !segments.length) return;

      const started = findIndexAtTime(segments, pb.time);
      const active = started >= 0 && pb.time < segments[started].end + HOLD_SECONDS ? started : -1;
      if (force || started !== lastStarted || active !== lastActive) updateLineStates(started, active);
      if (started >= 0 && autoScrollOn() && started !== lastScrolled) scrollToLine(started);
    }

    function frame() {
      if (destroyed) return;
      lastFrameAt = Date.now();
      tick(false);
      pip.requestAnimationFrame(frame);
    }
    pip.requestAnimationFrame(frame);

    // Backup clock in case the OS stops painting the window (for example when
    // another window fully covers it and the compositor pauses frames).
    const heartbeat = pip.setInterval(() => {
      if (Date.now() - lastFrameAt > HEARTBEAT_MS - 100) tick(false);
    }, HEARTBEAT_MS);

    function destroy() {
      destroyed = true;
      try {
        pip.clearInterval(heartbeat);
      } catch {
        // Window already gone.
      }
    }

    applySettings(settings);
    setStatus('waiting');

    return { setTranscript, setStatus, applySettings, destroy };
  }

  CaptionDock.createPipUI = createPipUI;
  CaptionDock.formatTime = formatTime;
})(globalThis);
