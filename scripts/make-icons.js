// Generates the icons in icons/ (16, 48 and 128 px PNGs), plus the Chrome Web
// Store listing icon in store/ (128 px with the 16 px transparent padding the
// store asks for). No dependencies: shapes are drawn with 4x4 supersampling and written as PNG
// using Node's zlib. Run with: node scripts/make-icons.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.resolve(__dirname, '..', 'icons');
const STORE_OUT = path.resolve(__dirname, '..', 'store');
const SIZES = [16, 48, 128];
const SAMPLES = 4;

// Design on a 128 x 128 grid: dark rounded tile, a white "floating window"
// outline and two caption bars (the second one blue).
const BG = [24, 28, 36];
const WHITE = [255, 255, 255];
const BLUE = [62, 166, 255];

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function sample(x, y) {
  if (!inRoundRect(x, y, 0, 0, 128, 128, 28)) return null;
  const outer = inRoundRect(x, y, 18, 26, 110, 102, 12);
  const inner = inRoundRect(x, y, 26, 34, 102, 94, 6);
  if (outer && !inner) return WHITE;
  if (inRoundRect(x, y, 36, 56, 92, 67, 5.5)) return WHITE;
  if (inRoundRect(x, y, 36, 74, 74, 85, 5.5)) return BLUE;
  return BG;
}

// `pad` is the transparent border, as a fraction of the size.
function render(size, pad = 0) {
  const px = Buffer.alloc(size * size * 4);
  const offset = size * pad;
  const scale = 128 / (size - 2 * offset);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const c = sample((x + (sx + 0.5) / SAMPLES - offset) * scale, (y + (sy + 0.5) / SAMPLES - offset) * scale);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a++;
        }
      }
      const i = (y * size + x) * 4;
      if (a) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
      }
      px[i + 3] = Math.round((a / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(size, render(size)));
  console.log('wrote', path.relative(process.cwd(), file));
}

fs.mkdirSync(STORE_OUT, { recursive: true });
const storeIcon = path.join(STORE_OUT, 'store-icon-128.png');
fs.writeFileSync(storeIcon, encodePng(128, render(128, 16 / 128)));
console.log('wrote', path.relative(process.cwd(), storeIcon));
