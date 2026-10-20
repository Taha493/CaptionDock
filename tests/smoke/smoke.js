// Drives the fake YouTube page through the main flows and writes PASS/FAIL
// lines into #result. Run by tests/smoke/run.sh in a headless browser.
(async () => {
  const out = [];
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

  const check = (name, cond, extra) => {
    out.push((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : ''));
    document.getElementById('result').textContent = out.join('\n'); // progress, in case a step hangs
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const $ = (sel) => document.querySelector(sel);
  const pipDoc = () => document.getElementById('fakepip').contentDocument;
  const pip$ = (sel) => pipDoc().querySelector(sel);
  const pip$$ = (sel) => Array.from(pipDoc().querySelectorAll(sel));
  const statusText = () => (pip$('.cd-status-text') || {}).textContent || '';
  const video = $('video');
  const player = $('#movie_player');
  const cc = $('.ytp-subtitles-button');

  try {
    await sleep(400);
    const btn = $('.captiondock-player-btn');
    check('player button inserted next to CC', btn && btn.nextElementSibling === cc);

    btn.click();
    await sleep(600);
    check('window UI built', !!pip$('.cd-bar') && !!pip$('.cd-list'));
    check('styles installed', pipDoc().adoptedStyleSheets.length === 1 || !!pip$('style'));
    check('CC turned on automatically', cc.getAttribute('aria-pressed') === 'true');
    check('button shows pressed', btn.getAttribute('aria-pressed') === 'true');

    await sleep(600);
    check('ASR transcript rendered (4 lines)', pip$$('.cd-line').length === 4, pip$$('.cd-line').length);
    check('status says Live captions', statusText().startsWith('Live captions'), statusText());

    video.currentTime = 3;
    await sleep(300);
    const active = pip$('.cd-line.is-active .cd-text');
    check('active line follows video time', active && active.textContent === 'about how podcasts work', active && active.textContent);
    check('earlier line marked past', pip$$('.cd-line')[0].classList.contains('is-past'));

    video.currentTime = 0.5; // seek backward
    await sleep(300);
    const back = pip$('.cd-line.is-active .cd-text');
    check('seek backward moves highlight', back && back.textContent.startsWith('so today'), back && back.textContent);

    pip$$('.cd-line')[3].click();
    await sleep(100);
    check('clicking a line seeks the video', Math.abs(video.currentTime - 8) < 0.01, video.currentTime);

    const before = getComputedStyle(pip$('.cd-line')).fontSize;
    pip$$('.cd-btn')[1].click(); // A+
    await sleep(100);
    const after = getComputedStyle(pip$('.cd-line')).fontSize;
    check('A+ increases font size', parseFloat(after) > parseFloat(before), before + ' -> ' + after);

    pip$$('.cd-btn').find((b) => b.textContent === 'Hide YT').click();
    await sleep(100);
    check('Hide YT hides native captions', document.documentElement.classList.contains('captiondock-hide-native'));

    player.classList.add('ad-showing');
    await sleep(300);
    check('ad shows ad status', statusText().startsWith('Ad playing'), statusText());
    player.classList.remove('ad-showing');
    await sleep(300);
    check('status restored after ad', statusText().startsWith('Live captions'), statusText());

    // Language switch: the player fetches another track (srv3 via fetch).
    await fetch('/api/timedtext?v=VIDEO00001&lang=fr&fmt=srv3');
    await sleep(500);
    check('new track replaces transcript (srv3, 4 lines)', pip$$('.cd-line').length === 4 && pip$('.cd-line .cd-text').textContent === 'Welcome back to the show.');
    check('status names the new language', /French|fran/i.test(statusText()), statusText());

    // Ad captions for a different video id must be ignored.
    await fetch('/api/timedtext?v=ADVIDEO0001&lang=en&fmt=json3');
    await sleep(300);
    check('captions for another video id ignored', pip$('.cd-line .cd-text').textContent === 'Welcome back to the show.');

    // SPA navigation to a video whose captions never arrive.
    history.pushState({}, '', '/watch?v=VIDEO00002');
    document.dispatchEvent(new Event('yt-navigate-finish'));
    await sleep(300);
    check('navigation resets to waiting', statusText().startsWith('Waiting'), statusText());
    check('empty state shown while waiting', !pip$('.cd-empty').hidden);

    await sleep(6500);
    check('falls back to DOM mode after timeout', statusText().startsWith('Fallback'), statusText());
    check('fallback notice shown', !pip$('.cd-notice').hidden);

    const container = $('.ytp-caption-window-container');
    const showCaption = (text) => {
      container.textContent = '';
      const line = document.createElement('span');
      line.className = 'caption-visual-line';
      const seg = document.createElement('span');
      seg.className = 'ytp-caption-segment';
      seg.textContent = text;
      line.append(seg);
      container.append(line);
    };
    video.currentTime = 20;
    showCaption('hello from');
    await sleep(100);
    showCaption('hello from the fallback');
    await sleep(100);
    video.currentTime = 23;
    showCaption('second line');
    await sleep(300);
    const fbLines = pip$$('.cd-line .cd-text').map((n) => n.textContent);
    check('fallback builds rolling transcript', fbLines.join('|') === 'hello from the fallback|second line', fbLines.join('|'));

    // Closing the window resets the page.
    btn.click();
    await sleep(200);
    check('second click closes window', btn.getAttribute('aria-pressed') === 'false');
    check('native captions visible again', !document.documentElement.classList.contains('captiondock-hide-native'));

    const info = window.CaptionDock.debugInfo();
    check('hook answered hello', info.hookReady === true);
  } catch (err) {
    errors.push('smoke crashed: ' + (err && err.stack ? err.stack : err));
  }

  check('no page errors', errors.length === 0, errors.join(' || '));
  $('#result').textContent = out.join('\n') + '\nDONE';
})();
