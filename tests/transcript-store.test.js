// Unit tests for src/transcript-store.js: cleaning, dedupe, binary search,
// the per-video store and the fallback rolling transcript.
// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const yt = require('../src/youtube-adapter.js');
const T = require('../src/transcript-store.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const texts = (segs) => segs.map((s) => s.text);

test('cleanSegments on manual json3: duplicate removed, ends clipped, missing duration filled', () => {
  const segs = T.cleanSegments(yt.parseJson3(fixture('json3-manual.json')));
  assert.deepEqual(texts(segs), [
    'Welcome back to the show.',
    "Today we're talking about how podcasts get made.",
    "It's a long story.",
    'No duration on this one.',
  ]);
  close(segs[3].start, 12);
  close(segs[3].end, 15); // DEFAULT_LINE_SECONDS
});

test('cleanSegments on ASR json3: overlapping events clipped so lines never overlap', () => {
  const segs = T.cleanSegments(yt.parseJson3(fixture('json3-asr.json')));
  assert.equal(segs.length, 4);
  close(segs[0].end, 2.4);
  close(segs[1].end, 4.4);
  close(segs[2].end, 8.0);
  close(segs[3].end, 13.0);
  for (let i = 1; i < segs.length; i++) assert.ok(segs[i - 1].end <= segs[i].start);
});

test('cleanSegments sorts and drops empty or invalid entries', () => {
  const segs = T.cleanSegments([
    { start: 5, end: 6, text: 'b' },
    { start: 1, end: 2, text: '  a\n ' },
    { start: 3, end: 4, text: '   ' },
    { start: NaN, end: 4, text: 'bad' },
    null,
    { start: 2, end: 3 },
  ]);
  assert.deepEqual(texts(segs), ['a', 'b']);
});

test('cleanSegments merges rolling growth into one line', () => {
  const segs = T.cleanSegments([
    { start: 1, end: 2, text: 'so today' },
    { start: 1.5, end: 3, text: 'so today we talk' },
    { start: 2.5, end: 4, text: 'so today we talk about it' },
    { start: 6, end: 8, text: 'next line' },
  ]);
  assert.deepEqual(texts(segs), ['so today we talk about it', 'next line']);
  close(segs[0].start, 1);
  close(segs[0].end, 4);
});

test('cleanSegments strips words repeated by a rolling window', () => {
  const segs = T.cleanSegments([
    { start: 0, end: 4, text: 'we are going to the market' },
    { start: 3, end: 7, text: 'going to the market today to buy bread' },
  ]);
  assert.deepEqual(texts(segs), ['we are going to the market', 'today to buy bread']);
});

test('cleanSegments drops a line that only repeats words already on screen', () => {
  const segs = T.cleanSegments([
    { start: 0, end: 5, text: 'this is the first line of text' },
    { start: 2, end: 4, text: 'the first line' },
  ]);
  assert.deepEqual(texts(segs), ['this is the first line of text']);
});

test('cleanSegments keeps short legit lines and does not merge "the" into "there"', () => {
  const segs = T.cleanSegments([
    { start: 0, end: 1, text: 'the' },
    { start: 1, end: 2, text: 'there was a cat' },
    { start: 2, end: 3, text: 'yeah' },
    { start: 3, end: 4, text: 'yeah' }, // within the merge gap: same line again
    { start: 20, end: 21, text: 'yeah' }, // much later: a new line
  ]);
  assert.deepEqual(texts(segs), ['the', 'there was a cat', 'yeah', 'yeah']);
});

test('cleanSegments joins cues that start at the same moment', () => {
  const segs = T.cleanSegments([
    { start: 1, end: 3, text: '- Hi.' },
    { start: 1, end: 3, text: '- Hello.' },
  ]);
  assert.deepEqual(texts(segs), ['- Hi. - Hello.']);
});

test('findIndexAtTime: edges and gaps', () => {
  const segs = [
    { start: 1, end: 2, text: 'a' },
    { start: 3, end: 4, text: 'b' },
    { start: 5, end: 6, text: 'c' },
  ];
  assert.equal(T.findIndexAtTime([], 10), -1);
  assert.equal(T.findIndexAtTime(segs, 0), -1);
  assert.equal(T.findIndexAtTime(segs, 1), 0);
  assert.equal(T.findIndexAtTime(segs, 2.5), 0);
  assert.equal(T.findIndexAtTime(segs, 3), 1);
  assert.equal(T.findIndexAtTime(segs, 5.5), 2);
  assert.equal(T.findIndexAtTime(segs, 999), 2);
});

test('findActiveIndex respects end times and the hold window', () => {
  const segs = [
    { start: 1, end: 2, text: 'a' },
    { start: 5, end: 6, text: 'b' },
  ];
  assert.equal(T.findActiveIndex(segs, 1.5), 0);
  assert.equal(T.findActiveIndex(segs, 3), -1);
  assert.equal(T.findActiveIndex(segs, 3, 2), 0);
  assert.equal(T.findActiveIndex(segs, 4.5, 2), -1);
  assert.equal(T.findActiveIndex(segs, 5), 1);
});

test('findIndexAtTime matches a linear scan on random data', () => {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let round = 0; round < 50; round++) {
    const starts = Array.from({ length: Math.floor(rand() * 200) }, () => rand() * 1000).sort((a, b) => a - b);
    const segs = starts.map((s) => ({ start: s, end: s + 1, text: 'x' }));
    for (let k = 0; k < 50; k++) {
      const t = rand() * 1100 - 50;
      let expected = -1;
      for (let i = 0; i < segs.length; i++) if (segs[i].start <= t) expected = i;
      assert.equal(T.findIndexAtTime(segs, t), expected);
    }
  }
});

test('TranscriptStore keeps the newest track per video and evicts old videos', () => {
  const store = new T.TranscriptStore(2);
  store.put('v1', { key: 'v1|en', segments: [1] });
  store.put('v1', { key: 'v1|fr', segments: [2] });
  assert.equal(store.get('v1').key, 'v1|fr');
  store.put('v2', { key: 'v2|en', segments: [] });
  store.put('v3', { key: 'v3|en', segments: [] });
  assert.equal(store.get('v1'), null);
  assert.ok(store.get('v2'));
  assert.ok(store.get('v3'));
  assert.equal(store.get(null), null);
  assert.deepEqual(store.summary().map((e) => e.videoId), ['v2', 'v3']);
});

test('RollingTranscript: growing ASR line becomes one line, repeats extend it', () => {
  const r = new T.RollingTranscript();
  assert.equal(r.observe(['so'], 10), true);
  assert.equal(r.observe(['so today'], 10.4), true);
  assert.equal(r.observe(['so today we talk'], 10.9), true);
  assert.equal(r.observe(['so today we talk'], 11.5), false);
  assert.equal(r.observe(['so today we talk', 'about podcasts'], 12), true);
  assert.deepEqual(texts(r.segments), ['so today we talk', 'about podcasts']);
  close(r.segments[0].start, 10);
  close(r.segments[0].end, 12);
});

test('RollingTranscript: seeking back does not duplicate lines, and keeps order', () => {
  const r = new T.RollingTranscript();
  r.observe(['line at fifty'], 50);
  r.observe(['line at sixty'], 60);
  r.observe(['line at fifty'], 50.3); // user seeked back
  assert.deepEqual(texts(r.segments), ['line at fifty', 'line at sixty']);
  r.observe(['line at twenty'], 20); // seeked further back to an unseen part
  assert.deepEqual(texts(r.segments), ['line at twenty', 'line at fifty', 'line at sixty']);
});

test('RollingTranscript: same words much later are a new line; bad input ignored', () => {
  const r = new T.RollingTranscript();
  r.observe(['yeah'], 5);
  r.observe(['yeah'], 40);
  assert.equal(r.segments.length, 2);
  assert.equal(r.observe(['x'], NaN), false);
  assert.equal(r.observe(null, 1), false);
  assert.equal(r.observe(['   '], 1), false);
});
