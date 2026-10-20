// Renders store/promo-tile.html to store/promo-tile-440x280.png (the Chrome Web
// Store "small promo tile") in a headless Chromium-based browser with a
// throwaway profile. Needs Node 22+ (built-in WebSocket).
// Usage: node scripts/make-promo-tile.js [browser-binary]
'use strict';

const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'store', 'promo-tile.html');
const OUT = path.join(ROOT, 'store', 'promo-tile-440x280.png');
const WIDTH = 440;
const HEIGHT = 280;
const CANDIDATES = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'brave', 'brave-browser', 'microsoft-edge-stable'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  if (process.argv[2]) return process.argv[2];
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

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'captiondock-promo-'));
  const browser = spawn(
    findBrowser(),
    ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: true }
  );
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
    await sleep(1000);
    const targets = await (await fetch(`http://127.0.0.1:${new URL(wsUrl).port}/json/list`)).json();
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let nextId = 1;
    const pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
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

    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: 'file://' + SOURCE });
    await sleep(1500);
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 } });
    ws.close();
    fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
    console.log('wrote', path.relative(ROOT, OUT));
  } finally {
    try {
      process.kill(-browser.pid, 'SIGTERM');
    } catch {
      // already gone
    }
    await sleep(1000);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
