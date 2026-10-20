// Browser smoke tests in a headless Chromium-based browser with a throwaway
// profile. Needs Node 22+ (built-in WebSocket) and python3.
//
//   node tests/smoke/run.js [browser]
//     Page test: loads the scripts into tests/smoke/index.html (a fake YouTube
//     player with a fake PiP window) and runs the flows in smoke.js.
//
//   node tests/smoke/run.js --extension [browser]
//     Extension test: loads the real unpacked extension, serves a fake watch
//     page as https://www.youtube.com/watch (resolved to localhost with a
//     throwaway self-signed certificate), clicks the button with a real mouse
//     event and checks the real Document PiP window. Also needs openssl.
'use strict';

const { spawn, execSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const HTTP_PORT = 8765;
const HTTPS_PORT = 8443;
const CANDIDATES = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'brave', 'brave-browser', 'microsoft-edge-stable'];

const args = process.argv.slice(2);
const EXTENSION_MODE = args.includes('--extension');
const browserArg = args.find((a) => !a.startsWith('--'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  if (browserArg) return browserArg;
  for (const name of CANDIDATES) {
    try {
      execSync(`command -v ${name}`, { stdio: 'ignore' });
      return name;
    } catch {
      // try the next one
    }
  }
  throw new Error('No Chromium-based browser found. Pass one as an argument.');
}

// Minimal Chrome DevTools Protocol client for one page.
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 1;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      logs.push('exception: ' + ((d.exception && d.exception.description) || d.text));
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type !== 'log') {
      logs.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value || a.description || '').join(' '));
    }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res.result && res.result.result ? res.result.result.value : undefined;
  };
  await send('Runtime.enable');
  return { send, evaluate, logs, close: () => ws.close() };
}

async function pageTest(page) {
  await page.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/tests/smoke/index.html` });
  const deadline = Date.now() + 60000;
  let text = '';
  while (Date.now() < deadline) {
    await sleep(500);
    text = (await page.evaluate("(document.getElementById('result') || {}).textContent || ''")) || '';
    if (text.includes('DONE')) break;
  }
  return text;
}

async function extensionTest(page) {
  const out = [];
  const check = (name, cond, extra) => out.push((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  [' + extra + ']' : ''));
  const waitFor = async (expression, ms = 8000) => {
    const end = Date.now() + ms;
    let value;
    while (Date.now() < end) {
      value = await page.evaluate(expression);
      if (value) return value;
      await sleep(250);
    }
    return value;
  };

  await page.send('Page.navigate', { url: 'https://www.youtube.com/watch?v=VIDEO00001' });
  check('hook.js installed in the page (MAIN world)', await waitFor('window.__captionDockHookInstalled === true'));
  check('content script inserted the player button', await waitFor("!!document.querySelector('.captiondock-player-btn')"));

  const rect = await page.evaluate(
    "(() => { const r = document.querySelector('.captiondock-player-btn').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; })()"
  );
  check('button has a size', rect && rect.w > 0, rect && rect.w);

  // A real mouse click, so the page gets genuine user activation.
  for (const type of ['mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
  }

  check('Document PiP window opened from the content script', await waitFor('!!(window.documentPictureInPicture && documentPictureInPicture.window)'));
  check('button shows pressed', await waitFor("document.querySelector('.captiondock-player-btn').getAttribute('aria-pressed') === 'true'"));
  check('CC turned on automatically', await waitFor("document.querySelector('.ytp-subtitles-button').getAttribute('aria-pressed') === 'true'"));

  const pipDoc = 'documentPictureInPicture.window.document';
  const status = await waitFor(`(() => { const s = ${pipDoc}.querySelector('.cd-status-text'); return s && s.textContent.startsWith('Live') ? s.textContent : ''; })()`);
  check('captions captured across worlds, status Live', !!status, status);
  const lines = await page.evaluate(`${pipDoc}.querySelectorAll('.cd-line').length`);
  check('transcript rendered in the PiP window', lines === 4, lines);
  const styled = await page.evaluate(`getComputedStyle(${pipDoc}.body).backgroundColor`);
  check('PiP window styles applied', /rgba\(8, 8, 8/.test(styled || ''), styled);

  await page.evaluate("document.querySelector('video').currentTime = 3");
  const active = await waitFor(`(() => { const a = ${pipDoc}.querySelector('.cd-line.is-active .cd-text'); return a ? a.textContent : ''; })()`);
  check('active line follows the video', active === 'about how podcasts work', active);

  await page.evaluate('documentPictureInPicture.window.close()');
  check('closing the window resets the button', await waitFor("document.querySelector('.captiondock-player-btn').getAttribute('aria-pressed') === 'false'"));

  return out.join('\n') + '\nDONE';
}

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'captiondock-smoke-'));
  const children = [];
  const browserArgs = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, '--remote-debugging-port=0'];

  if (EXTENSION_MODE) {
    const cert = path.join(profile, 'cert.pem');
    const key = path.join(profile, 'key.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=www.youtube.com', '-addext', 'subjectAltName=DNS:www.youtube.com'], { stdio: 'ignore' });
    children.push(spawn('python3', [path.join(__dirname, 'server.py'), String(HTTPS_PORT), cert, key], { stdio: 'ignore', detached: true }));
    browserArgs.push(
      `--load-extension=${ROOT}`,
      `--disable-extensions-except=${ROOT}`,
      `--host-resolver-rules=MAP www.youtube.com 127.0.0.1:${HTTPS_PORT}`,
      '--ignore-certificate-errors'
    );
  } else {
    children.push(spawn('python3', [path.join(__dirname, 'server.py'), String(HTTP_PORT)], { stdio: 'ignore', detached: true }));
  }
  browserArgs.push('about:blank');
  const browser = spawn(findBrowser(), browserArgs, { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  children.push(browser);

  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('browser did not start')), 15000);
      browser.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
    });
    await sleep(1500);
    const targets = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/list`)).json();
    const page = await connect(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);

    const text = EXTENSION_MODE ? await extensionTest(page) : await pageTest(page);
    page.close();

    console.log(text || '(no result)');
    const failed = !text.includes('DONE') || /^FAIL /m.test(text);
    if (failed && page.logs.length) console.log('\nPage console:\n' + page.logs.join('\n'));
    console.log(failed ? '\nSmoke test FAILED' : '\nSmoke test passed');
    return failed ? 1 : 0;
  } finally {
    for (const child of children) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    }
    await sleep(1000); // let the browser finish writing its profile
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
