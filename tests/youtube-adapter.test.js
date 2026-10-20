// Unit tests for the caption parsers and URL helpers in src/youtube-adapter.js.
// Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const yt = require('../src/youtube-adapter.js');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('detectFormat recognizes json3, xml, vtt and empty bodies', () => {
  assert.equal(yt.detectFormat(fixture('json3-manual.json')), 'json3');
  assert.equal(yt.detectFormat(fixture('srv3.xml')), 'xml');
  assert.equal(yt.detectFormat(fixture('srv1.xml')), 'xml');
  assert.equal(yt.detectFormat(fixture('sample.vtt')), 'vtt');
  assert.equal(yt.detectFormat(''), 'empty');
  assert.equal(yt.detectFormat('   \n'), 'empty');
  assert.equal(yt.detectFormat(")]}'\n{\"events\":[]}"), 'json3');
  assert.equal(yt.detectFormat('hello'), 'unknown');
});

test('parseJson3 reads manual captions, joins segs and strips newlines', () => {
  const segs = yt.parseJson3(fixture('json3-manual.json'));
  assert.deepEqual(
    segs.map((s) => s.text),
    [
      'Welcome back to the show.',
      "Today we're talking about how podcasts get made.",
      "Today we're talking about how podcasts get made.",
      "It's a long story.",
      'No duration on this one.',
    ]
  );
  close(segs[0].start, 1.2);
  close(segs[0].end, 3.7);
  // Missing dDurationMs gives a zero-length line for the store to fix.
  close(segs[4].start, 12);
  close(segs[4].end, 12);
});

test('parseJson3 handles auto-generated (ASR) captions', () => {
  const segs = yt.parseJson3(fixture('json3-asr.json'));
  assert.deepEqual(
    segs.map((s) => s.text),
    ["so today we're talking", 'about how podcasts work', '[Music]', 'and why people love them']
  );
  close(segs[0].start, 0.16);
  close(segs[1].start, 2.4);
});

test('parseXml reads srv3 (milliseconds, <s> word tags, entities, <br/>)', () => {
  const segs = yt.parseXml(fixture('srv3.xml'));
  assert.deepEqual(
    segs.map((s) => s.text),
    ['Welcome back to the show.', 'Today\'s guest is "Ada" & friends.', 'auto words here', 'Line one line two']
  );
  close(segs[0].start, 1.2);
  close(segs[0].end, 3.7);
  close(segs[3].start, 10);
  close(segs[3].end, 12);
});

test('parseXml reads srv1 (seconds, double-escaped entities)', () => {
  const segs = yt.parseXml(fixture('srv1.xml'));
  assert.deepEqual(
    segs.map((s) => s.text),
    ['Hello & welcome', "I'm here with you", 'whispers']
  );
  close(segs[0].start, 0.5);
  close(segs[0].end, 2.6);
});

test('parseVtt reads cues and both timestamp forms', () => {
  const segs = yt.parseVtt(fixture('sample.vtt'));
  assert.deepEqual(
    segs.map((s) => s.text),
    ['Hello there', 'Second line continues here', 'Short timestamp form']
  );
  close(segs[0].start, 1);
  close(segs[0].end, 3.5);
  close(segs[2].start, 62);
  close(segs[2].end, 64.25);
});

test('parseCaptionPayload never throws on broken input', () => {
  const broken = yt.parseCaptionPayload('{"events": [');
  assert.equal(broken.format, 'json3');
  assert.deepEqual(broken.segments, []);
  assert.ok(broken.error);

  assert.deepEqual(yt.parseCaptionPayload('').segments, []);
  assert.deepEqual(yt.parseCaptionPayload('{"foo":1}').segments, []);
  assert.equal(yt.parseCaptionPayload(fixture('srv3.xml')).segments.length, 4);
});

test('decodeEntities handles named, decimal and hex entities', () => {
  assert.equal(yt.decodeEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#x27; &nbsp;'), 'a & b <c> "d" \'e\' \u00a0');
  assert.equal(yt.decodeEntities('&unknown; &#0;'), '&unknown; &#0;');
});

test('parseTimedTextUrl and trackKey', () => {
  const info = yt.parseTimedTextUrl(
    'https://www.youtube.com/api/timedtext?v=abc123XYZ_-&ei=x&caps=asr&lang=en&kind=asr&fmt=json3&tlang=fr&pot=TOKEN'
  );
  assert.equal(info.videoId, 'abc123XYZ_-');
  assert.equal(info.lang, 'en');
  assert.equal(info.kind, 'asr');
  assert.equal(info.tlang, 'fr');
  assert.equal(info.fmt, 'json3');
  assert.equal(yt.trackKey(info), 'abc123XYZ_-|en|asr|to-fr');
  assert.equal(yt.trackKey({ videoId: 'v1', lang: 'de' }), 'v1|de|standard');
  assert.equal(yt.parseTimedTextUrl('/api/timedtext?v=rel&lang=en').videoId, 'rel');
  assert.ok(yt.isTimedTextUrl('/api/timedtext?v=1'));
  assert.ok(!yt.isTimedTextUrl('/api/stats/watchtime'));
});

test('describeTrack builds a readable label', () => {
  const label = yt.describeTrack({ lang: 'en', kind: 'asr', tlang: '' });
  assert.match(label, /auto-generated/);
  assert.match(yt.describeTrack({ lang: 'en', kind: '', tlang: 'fr' }), /translated to/);
  assert.equal(yt.describeTrack({ lang: '', kind: '' }), 'Unknown language');
});

test('getVideoIdFromUrl', () => {
  assert.equal(yt.getVideoIdFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'), 'dQw4w9WgXcQ');
  assert.equal(yt.getVideoIdFromUrl('https://www.youtube.com/live/AbCdEfGhIjK?si=1'), 'AbCdEfGhIjK');
  assert.equal(yt.getVideoIdFromUrl('https://www.youtube.com/'), null);
  assert.equal(yt.getVideoIdFromUrl('https://www.youtube.com/results?search_query=x'), null);
  assert.equal(yt.getVideoIdFromUrl('https://www.youtube.com/shorts/AbCdEfGhIjK'), null);
  assert.equal(yt.isWatchPage('https://www.youtube.com/watch?v=x1'), true);
});
