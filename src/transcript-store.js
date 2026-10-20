// Transcript data: cleaning parsed caption lines, finding the line for a
// given time, and keeping transcripts per video. No DOM or YouTube code here.
(function (root) {
  'use strict';

  const MERGE_GAP = 1.0; // seconds between two lines that may be one rolling line
  const MIN_OVERLAP_WORDS = 3; // shortest word overlap we treat as a repeat
  const SAME_START = 0.01; // seconds; lines starting together are shown together
  const DEFAULT_LINE_SECONDS = 3; // duration for lines that have none

  // Fallback (DOM) mode tuning.
  const ROLL_MATCH_WINDOW = 3;
  const ROLL_LOOKBACK = 30;
  const MAX_ROLLING_LINES = 5000;

  function normalize(text) {
    return String(text).replace(/\s+/g, ' ').trim();
  }

  // True when `needle` appears as a contiguous run inside `hay`.
  function containsRun(hay, needle) {
    outer: for (let i = 0; i + needle.length <= hay.length; i++) {
      for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
      return true;
    }
    return false;
  }

  // Largest k where the last k words of `a` equal the first k words of `b`.
  function overlapLength(a, b) {
    for (let k = Math.min(a.length, b.length); k > 0; k--) {
      let same = true;
      for (let j = 0; j < k && same; j++) same = a[a.length - k + j] === b[j];
      if (same) return k;
    }
    return 0;
  }

  // Sort, drop empties, and collapse rolling or repeated lines so each line
  // of speech appears once. Ends are clipped so lines never overlap.
  function cleanSegments(raw) {
    const input = [];
    for (const s of raw || []) {
      if (!s || typeof s.text !== 'string') continue;
      const text = normalize(s.text);
      const start = Number(s.start);
      if (!text || !Number.isFinite(start)) continue;
      const end = Number(s.end);
      input.push({ start: Math.max(0, start), end: Number.isFinite(end) ? end : start, text });
    }
    input.sort((a, b) => a.start - b.start || a.end - b.end);

    const out = [];
    for (const seg of input) {
      const prev = out[out.length - 1];
      if (!prev) {
        out.push(seg);
        continue;
      }
      const p = prev.text.toLowerCase();
      const n = seg.text.toLowerCase();
      const near = seg.start <= prev.end + MERGE_GAP;

      // Same line again (duplicate cue, or a line re-sent while still shown).
      if (near && n === p) {
        prev.end = Math.max(prev.end, seg.end);
        continue;
      }
      // Rolling growth: "so today" then "so today we talk".
      if (near && n.startsWith(p + ' ')) {
        prev.text = seg.text;
        prev.end = Math.max(prev.end, seg.end);
        continue;
      }
      if (seg.start < prev.end) {
        const pw = p.split(' ');
        const nw = n.split(' ');
        // The new line only repeats words that are already on screen.
        if (nw.length >= MIN_OVERLAP_WORDS && containsRun(pw, nw)) {
          prev.end = Math.max(prev.end, seg.end);
          continue;
        }
        // Rolling window: "a b c d" then "c d e f" becomes "a b c d" + "e f".
        const k = overlapLength(pw, nw);
        if (k >= MIN_OVERLAP_WORDS) {
          seg.text = seg.text.split(' ').slice(k).join(' ');
          if (!seg.text) {
            prev.end = Math.max(prev.end, seg.end);
            continue;
          }
        }
      }
      // Two cues that start at the same moment (for example two speakers).
      if (Math.abs(seg.start - prev.start) < SAME_START) {
        prev.text += ' ' + seg.text;
        prev.end = Math.max(prev.end, seg.end);
        continue;
      }
      out.push(seg);
    }

    for (let i = 0; i < out.length; i++) {
      const s = out[i];
      const next = out[i + 1];
      if (next && s.end > next.start) s.end = next.start;
      if (!(s.end > s.start)) s.end = Math.min(next ? next.start : Infinity, s.start + DEFAULT_LINE_SECONDS);
    }
    return out;
  }

  // Binary search: index of the last segment that started at or before `t`,
  // or -1 if none has started yet. Segments must be sorted by start.
  function findIndexAtTime(segments, t) {
    let lo = 0;
    let hi = segments.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].start <= t) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  }

  // Index of the line being spoken at `t`, or -1 during a gap. `hold` keeps a
  // line highlighted for a little while after it ends.
  function findActiveIndex(segments, t, hold = 0) {
    const i = findIndexAtTime(segments, t);
    if (i < 0) return -1;
    return t < segments[i].end + hold ? i : -1;
  }

  // Latest transcript per video, least recently updated dropped first.
  class TranscriptStore {
    constructor(limit = 10) {
      this.limit = limit;
      this.entries = new Map();
    }

    put(videoId, entry) {
      if (!videoId) return;
      this.entries.delete(videoId);
      this.entries.set(videoId, entry);
      while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
    }

    get(videoId) {
      return (videoId && this.entries.get(videoId)) || null;
    }

    summary() {
      return Array.from(this.entries, ([videoId, e]) => ({ videoId, track: e.key, lines: e.segments.length }));
    }
  }

  // Builds a transcript from caption text as it appears on screen (fallback
  // mode). Each call passes the lines visible right now and the video time.
  // Segments are mutated in place and kept sorted by start.
  class RollingTranscript {
    constructor() {
      this.segments = [];
    }

    // Returns true when the list of lines or a line's text changed.
    observe(lines, time) {
      if (!Number.isFinite(time) || !Array.isArray(lines)) return false;
      let changed = false;
      for (const line of lines) {
        const text = normalize(line);
        if (text && this._absorb(text, time)) changed = true;
      }
      return changed;
    }

    _absorb(text, time) {
      const segs = this.segments;
      const lower = text.toLowerCase();
      for (let i = findIndexAtTime(segs, time + ROLL_MATCH_WINDOW); i >= 0; i--) {
        const seg = segs[i];
        if (seg.start < time - ROLL_LOOKBACK) break;
        if (time < seg.start - ROLL_MATCH_WINDOW || time > seg.end + ROLL_MATCH_WINDOW) continue;
        const current = seg.text.toLowerCase();
        // Already have it (or a longer version of it): just extend its time.
        if (current === lower || current.startsWith(lower + ' ')) {
          if (time > seg.end) seg.end = time;
          return false;
        }
        // The line grew word by word (auto-generated captions).
        if (lower.startsWith(current + ' ')) {
          seg.text = text;
          if (time > seg.end) seg.end = time;
          return true;
        }
      }
      segs.splice(findIndexAtTime(segs, time) + 1, 0, { start: time, end: time, text });
      if (segs.length > MAX_ROLLING_LINES) segs.splice(0, segs.length - MAX_ROLLING_LINES);
      return true;
    }
  }

  const api = { cleanSegments, findIndexAtTime, findActiveIndex, TranscriptStore, RollingTranscript };

  (root.CaptionDock = root.CaptionDock || {}).transcript = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(globalThis);
