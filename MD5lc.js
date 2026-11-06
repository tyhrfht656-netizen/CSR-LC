/* ╔══════════════════════════════════════════════════════════════════╗
   ║  LC79 · UPIS API — Unified Pattern Intelligence System          ║
   ║  Port 100% từ md5lc.html → Node.js API Server                  ║
   ║  6 module nhận thức + 1 Meta-Reasoner                           ║
   ╚══════════════════════════════════════════════════════════════════╝ */

'use strict';

const express = require('express');
const axios = require('axios');

/* ─────────── CONFIG ─────────── */
const API_URL = 'https://wtxmd52.tele68.com/v1/txmd5/lite-sessions?cp=R&cl=R&pf=web&at=3959701241b686f12e01bfe9c3a319b8';
const PROXY_URL = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(API_URL);
const POLL_INTERVAL = 2000;
const PORT = process.env.PORT || 3000;
const ADMIN_HANDLE = '@DENIUS09';
const MAX_SESSIONS = 500;
const MIN_HISTORY = 8;

/* ═══════════════════════════════════════════════════════════════════
 * STATISTICAL PRIMITIVES
 * ═══════════════════════════════════════════════════════════════════ */
const S = {
  mean: a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0,
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  log2: x => Math.log(x) / Math.LN2,
};

/* ═══════════════════════════════════════════════════════════════════
 * MODULE 1: LZ-PARSER
 * ═══════════════════════════════════════════════════════════════════ */
class LZParser {
  static parse(seq) {
    const dict = new Map();
    const phrases = [];
    let i = 0;
    while (i < seq.length) {
      let match = '';
      let j = i;
      while (j < seq.length && dict.has(match + seq[j])) {
        match += seq[j];
        j++;
      }
      if (j < seq.length) {
        const phrase = match + seq[j];
        phrases.push({ phrase, start: i, end: j, isLast: false });
        dict.set(phrase, dict.size);
        i = j + 1;
      } else {
        phrases.push({ phrase: match || seq[i], start: i, end: seq.length - 1, isLast: true, incomplete: true });
        i = seq.length;
      }
    }
    return { phrases, dict };
  }

  static currentPhrase(seq, maxLen = 8) {
    for (let len = Math.min(maxLen, seq.length - 1); len >= 2; len--) {
      const tail = seq.slice(-len).join('');
      const head = seq.slice(0, seq.length - 1).join('');
      const occurrences = [];
      let idx = 0;
      while ((idx = head.indexOf(tail, idx)) !== -1) {
        occurrences.push(idx);
        idx++;
      }
      if (occurrences.length > 0) return { phrase: tail, length: len, occurrences };
    }
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * MODULE 2: PHRASE-FOLLOW
 * ═══════════════════════════════════════════════════════════════════ */
class PhraseFollow {
  static analyze(seq) {
    const { phrases } = LZParser.parse(seq);
    const transitions = new Map();
    for (let i = 0; i < phrases.length - 1; i++) {
      const p = phrases[i].phrase;
      const nxt = phrases[i + 1].phrase;
      const firstChar = nxt[0];
      if (!transitions.has(p)) transitions.set(p, { Tài: [], Xỉu: [] });
      const rec = transitions.get(p);
      if (firstChar === 'T') rec.Tài.push(i);
      else rec.Xỉu.push(i);
    }

    const current = phrases[phrases.length - 1];
    const curPhrase = current.phrase;
    const curIncomplete = current.incomplete;
    const followers = transitions.get(curPhrase);

    if (!followers) {
      return { phrase: curPhrase, incomplete: curIncomplete, sampleSize: 0, pTai: 0.5, pXiu: 0.5 };
    }

    const N = phrases.length;
    let wTai = 1, wXiu = 1;
    for (const idx of followers.Tài) wTai += Math.exp(-(N - idx) / 30);
    for (const idx of followers.Xỉu) wXiu += Math.exp(-(N - idx) / 30);
    const total = wTai + wXiu;
    const pTai = wTai / total;
    const pXiu = wXiu / total;
    const sampleSize = followers.Tài.length + followers.Xỉu.length;
    const imbalance = Math.abs(pTai - pXiu);
    const sampleFactor = Math.min(1, sampleSize / 8);
    const confidence = imbalance * sampleFactor;

    return {
      phrase: curPhrase,
      incomplete: curIncomplete,
      sampleSize,
      pTai, pXiu,
      prediction: pTai > pXiu ? 'Tài' : 'Xỉu',
      confidence,
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * MODULE 3: CONTEXT SEARCH
 * ═══════════════════════════════════════════════════════════════════ */
class ContextSearch {
  static analyze(seq, maxK = 12) {
    const seqStr = seq.join('');
    const results = [];
    for (let K = Math.min(maxK, seq.length - 2); K >= 2; K--) {
      const ctx = seq.slice(-K).join('');
      const matches = [];
      let idx = 0;
      const searchEnd = seqStr.length - K;
      while (idx <= searchEnd) {
        const found = seqStr.indexOf(ctx, idx);
        if (found === -1 || found + K > searchEnd) break;
        matches.push(found);
        idx = found + 1;
      }
      if (matches.length === 0) continue;
      let tCount = 0, xCount = 0;
      const ages = [];
      for (const m of matches) {
        const nxt = seq[m + K];
        if (nxt === 'T') tCount++;
        else if (nxt === 'X') xCount++;
        ages.push(seq.length - (m + K));
      }
      let wT = 1, wX = 1;
      for (let i = 0; i < matches.length; i++) {
        const w = Math.exp(-ages[i] / 40);
        const nxt = seq[matches[i] + K];
        if (nxt === 'T') wT += w;
        else if (nxt === 'X') wX += w;
      }
      const pT = wT / (wT + wX);
      results.push({
        K, matches: matches.length,
        pTai: pT, pXiu: 1 - pT,
        specificity: K * Math.log2(1 + matches.length),
      });
    }
    if (!results.length) return null;
    let wT = 1, wX = 1, totalSpec = 0;
    for (const r of results) {
      const w = r.specificity;
      wT += r.pTai * w;
      wX += r.pXiu * w;
      totalSpec += w;
    }
    const pTai = wT / (wT + wX);
    const topResult = results[0];
    return {
      pTai, pXiu: 1 - pTai,
      prediction: pTai > 0.5 ? 'Tài' : 'Xỉu',
      bestContext: topResult.K,
      bestMatches: topResult.matches,
      totalContexts: results.length,
      confidence: Math.abs(pTai - 0.5) * 2 * Math.min(1, topResult.matches / 6),
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * MODULE 4: RQA
 * ═══════════════════════════════════════════════════════════════════ */
class RQA {
  static analyze(seq, window = 3) {
    const n = seq.length;
    if (n < window * 2) return { regime: 'unknown', score: 0.5, rr: 0, det: 0, lam: 0 };
    const start = Math.max(0, n - 100);
    const sub = seq.slice(start);
    const m = sub.length;
    const R = Array.from({ length: m }, () => new Uint8Array(m));
    let recCount = 0;
    for (let i = 0; i < m - window; i++) {
      for (let j = i + 1; j < m - window; j++) {
        let match = true;
        for (let k = 0; k < window; k++) {
          if (sub[i + k] !== sub[j + k]) { match = false; break; }
        }
        if (match) { R[i][j] = 1; R[j][i] = 1; recCount += 2; }
      }
    }
    const rr = recCount / (m * m);

    let diagLinePoints = 0, totalRec = recCount;
    for (let i = 0; i < m - 1; i++) {
      let lineLen = 0;
      for (let j = 0; j < m - 1; j++) {
        if (R[j][i] && R[j + 1][i + 1]) {
          lineLen++;
          diagLinePoints += 2;
        } else if (lineLen >= 2) {
          lineLen = 0;
        } else {
          lineLen = 0;
        }
      }
    }
    const det = totalRec > 0 ? diagLinePoints / totalRec : 0;

    let vertLinePoints = 0;
    for (let j = 0; j < m; j++) {
      let lineLen = 0;
      for (let i = 0; i < m; i++) {
        if (R[i][j] && i < m - 1 && R[i + 1][j]) {
          lineLen++;
          vertLinePoints += 2;
        } else if (lineLen >= 2) {
          lineLen = 0;
        } else {
          lineLen = 0;
        }
      }
    }
    const lam = totalRec > 0 ? vertLinePoints / totalRec : 0;
    const structureScore = S.clamp((det * 0.6 + lam * 0.4) * 1.8, 0, 1);
    let regime;
    if (structureScore > 0.65) regime = 'ordered';
    else if (structureScore < 0.25) regime = 'chaotic';
    else regime = 'semi';

    return {
      regime, score: structureScore,
      rr, det, lam,
      trappingTime: 1 / (1 - lam + 0.001),
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * MODULE 5: WAVELET
 * ═══════════════════════════════════════════════════════════════════ */
class WaveletAnalyzer {
  static analyze(seq) {
    const sig = seq.map(c => c === 'T' ? 1 : -1);
    const n = sig.length;
    if (n < 8) return { dominantScale: 0, energies: [], interpretation: '—', score: 0 };

    const energies = [];
    let cur = sig.slice();
    for (let level = 1; level <= 4; level++) {
      if (cur.length < 4) break;
      const approx = [];
      const detail = [];
      for (let i = 0; i + 1 < cur.length; i += 2) {
        approx.push((cur[i] + cur[i + 1]) / Math.sqrt(2));
        detail.push((cur[i] - cur[i + 1]) / Math.sqrt(2));
      }
      const E = detail.reduce((s, v) => s + v * v, 0) / detail.length;
      energies.push(E);
      cur = approx;
    }
    if (!energies.length) return { dominantScale: 0, energies: [], interpretation: '—', score: 0 };

    const dominantScale = energies.indexOf(Math.max(...energies));
    const totalE = energies.reduce((s, v) => s + v, 0) || 1;
    const normalizedEnergies = energies.map(e => e / totalE);

    return {
      dominantScale: dominantScale + 1,
      energies, normalizedEnergies,
      interpretation: dominantScale <= 1 ? 'nhanh (1-1)' :
                     dominantScale === 2 ? 'trung (2-2/1-2)' :
                     dominantScale === 3 ? 'chậm (3-3)' : 'rất chậm (bệt)',
      score: Math.max(...normalizedEnergies),
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * MODULE 6: PATTERN LIBRARY — 67 mẫu
 * ═══════════════════════════════════════════════════════════════════ */
const PatternLibrary = (() => {
  const patterns = [];

  const A = [
    { blocks: [1, 1], name: 'Xen kẽ 1-1' },
    { blocks: [2, 2], name: 'Xen kẽ 2-2' },
    { blocks: [1, 2], name: 'Xen kẽ 1-2' },
    { blocks: [2, 1], name: 'Xen kẽ 2-1' },
    { blocks: [1, 2, 1], name: 'Xen kẽ 1-2-1' },
    { blocks: [2, 1, 2], name: 'Xen kẽ 2-1-2' },
  ];
  A.forEach(p => patterns.push({ ...p, family: 'Xen kẽ' }));

  const B = [
    { type: 'streak', length: 3, name: 'Bệt 3' },
    { type: 'streak', length: 4, name: 'Bệt 4' },
    { type: 'streak', length: 5, name: 'Bệt 5' },
    { type: 'streak', length: 6, name: 'Bệt 6+' },
    { type: 'streak_min', length: 3, name: 'Bệt ngắn ≥3' },
    { type: 'streak_min', length: 5, name: 'Bệt dài ≥5' },
    { type: 'streak_min', length: 7, name: 'Bệt cực ≥7' },
    { type: 'streak_sym', name: 'Bệt đối xứng (3-3)' },
  ];
  B.forEach(p => patterns.push({ ...p, family: 'Bệt' }));

  const C_combos = [
    [1, 3], [3, 1], [1, 4], [4, 1], [2, 3], [3, 2],
    [2, 4], [4, 2], [3, 3], [3, 4], [4, 3], [4, 4],
    [1, 5], [5, 1], [2, 5], [5, 2], [3, 5], [5, 3],
    [4, 5], [5, 4],
  ];
  C_combos.forEach(([a, b]) => patterns.push({
    blocks: [a, b], name: `Nhịp ${a}-${b}`, family: 'Nhịp đôi',
  }));

  const D_combos = [
    [1, 1, 2], [2, 1, 1], [1, 2, 2], [2, 2, 1],
    [1, 3, 1], [3, 1, 1], [1, 1, 3], [3, 1, 2],
    [2, 3, 1], [1, 3, 2], [2, 1, 3], [3, 2, 1],
    [1, 2, 3], [2, 2, 2], [3, 3, 3],
  ];
  D_combos.forEach(([a, b, c]) => patterns.push({
    blocks: [a, b, c], name: `Nhịp 3: ${a}-${b}-${c}`, family: 'Nhịp ba',
  }));

  const E = [
    { type: 'kep', name: 'Kẹp 1-2-2-1', family: 'Kẹp' },
    { type: 'kep', name: 'Kẹp 1-3-3-1', family: 'Kẹp' },
    { type: 'kep', name: 'Kẹp 2-3-3-2', family: 'Kẹp' },
    { type: 'palindrome', name: 'Palindrome 3', family: 'Palindrome' },
    { type: 'palindrome', name: 'Palindrome 4', family: 'Palindrome' },
    { type: 'palindrome', name: 'Palindrome 5', family: 'Palindrome' },
    { type: 'mirror', name: 'Phản chiếu AB-AB', family: 'Phản chiếu' },
    { type: 'mirror', name: 'Phản chiếu ABC-ABC', family: 'Phản chiếu' },
  ];
  E.forEach(p => patterns.push(p));

  const F = [
    { blocks: [1, 2, 3], name: 'Tăng dần 1-2-3', family: 'Tăng/Giảm' },
    { blocks: [2, 3, 4], name: 'Tăng dần 2-3-4', family: 'Tăng/Giảm' },
    { blocks: [3, 2, 1], name: 'Giảm dần 3-2-1', family: 'Tăng/Giảm' },
    { blocks: [4, 3, 2], name: 'Giảm dần 4-3-2', family: 'Tăng/Giảm' },
    { blocks: [1, 1, 2, 3], name: 'Fibonacci-like', family: 'Tăng/Giảm' },
    { blocks: [2, 2, 4], name: 'Gấp đôi 2-2-4', family: 'Tăng/Giảm' },
  ];
  F.forEach(p => patterns.push(p));

  const G = [
    { type: 'chaos', name: 'Hỗn loạn hoàn toàn', family: 'Hiếm' },
    { type: 'rare', name: 'Mẫu hiếm gặp', family: 'Hiếm' },
    { type: 'noise', name: 'Nhiễu đột ngột', family: 'Hiếm' },
    { type: 'silence', name: 'Im lặng dài (bệt 8+)', family: 'Hiếm' },
  ];
  G.forEach(p => patterns.push(p));

  return patterns;
})();

/* ═══════════════════════════════════════════════════════════════════
 * MATCHER
 * ═══════════════════════════════════════════════════════════════════ */
class PatternMatcher {
  static matchAll(seq) {
    const results = [];
    for (const p of PatternLibrary) {
      const m = this.matchOne(p, seq);
      if (m) results.push(m);
    }
    results.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const unique = [];
    for (const r of results) {
      if (seen.has(r.name)) continue;
      seen.add(r.name);
      unique.push(r);
    }
    return unique;
  }

  static matchOne(p, seq) {
    if (p.blocks) return this.matchBlocks(p, seq);
    if (p.type === 'streak') return this.matchStreak(p, seq, false);
    if (p.type === 'streak_min') return this.matchStreak(p, seq, true);
    if (p.type === 'streak_sym') return this.matchStreakSym(p, seq);
    if (p.type === 'kep') return this.matchKep(p, seq);
    if (p.type === 'palindrome') return this.matchPalindrome(p, seq);
    if (p.type === 'mirror') return this.matchMirror(p, seq);
    if (p.type === 'chaos') return this.matchChaos(p, seq);
    if (p.type === 'rare') return this.matchRare(p, seq);
    if (p.type === 'noise') return this.matchNoise(p, seq);
    if (p.type === 'silence') return this.matchStreak({ ...p, length: 8, blocks: null }, seq, true);
    return null;
  }

  static matchBlocks(p, seq) {
    const blocks = p.blocks;
    const cycLen = blocks.reduce((a, b) => a + b, 0);
    const minMatch = Math.max(cycLen + 2, Math.ceil(cycLen * 1.7));
    if (seq.length < minMatch) return null;

    let best = null;
    const startLimit = Math.max(0, seq.length - 60);
    for (let S = startLimit; S <= seq.length - minMatch; S++) {
      const startResult = seq[S];
      let matched = 0, ok = true;
      for (let i = S; i < seq.length; i++) {
        const pos = (i - S) % cycLen;
        let cum = 0, bIdx = 0;
        for (let b = 0; b < blocks.length; b++) {
          if (pos < cum + blocks[b]) { bIdx = b; break; }
          cum += blocks[b];
        }
        const expected = (bIdx % 2 === 0) ? startResult : (startResult === 'T' ? 'X' : 'T');
        if (seq[i] !== expected) { ok = false; break; }
        matched++;
      }
      if (!ok) continue;
      const cyclesF = matched / cycLen;
      if (cyclesF < 1.7) continue;

      const nextPos = matched % cycLen;
      let cum = 0, bIdx = 0;
      for (let b = 0; b < blocks.length; b++) {
        if (nextPos < cum + blocks[b]) { bIdx = b; break; }
        cum += blocks[b];
      }
      const predictedNext = (bIdx % 2 === 0) ? startResult : (startResult === 'T' ? 'X' : 'T');

      const score = matched * 100 + cycLen * 40 + S;
      if (!best || score > best.score) {
        best = {
          ...p, type: 'block', matched, cycLen,
          startIdx: S, cyclesF,
          prediction: predictedNext === 'T' ? 'Tài' : 'Xỉu',
          score,
          confidence: S.clamp(0.55 + (cyclesF - 1.7) * 0.12 + (cycLen >= 3 ? 0.08 : 0), 0, 0.96),
          remaining: cycLen - nextPos,
          cycles: Math.floor(cyclesF),
          blocks,
        };
      }
    }
    return best;
  }

  static matchStreak(p, seq, isMin) {
    if (seq.length < p.length) return null;
    const last = seq[seq.length - 1];
    let count = 1;
    for (let i = seq.length - 2; i >= 0; i--) {
      if (seq[i] === last) count++;
      else break;
    }
    const need = isMin ? (count >= p.length) : (count === p.length);
    if (!need) return null;
    return {
      ...p, type: 'streak', count,
      prediction: null,
      score: count * 200 + (isMin ? 50 : 0),
      confidence: 0.5,
      streakResult: last === 'T' ? 'Tài' : 'Xỉu',
      remaining: 0,
    };
  }

  static matchStreakSym(p, seq) {
    if (seq.length < 8) return null;
    const tail8 = seq.slice(-8);
    const first4Same = tail8.slice(0, 4).every(c => c === tail8[0]);
    const last4Same = tail8.slice(4).every(c => c === tail8[4]);
    if (first4Same && last4Same && tail8[0] !== tail8[4]) {
      return { ...p, type: 'streak_sym', matched: 8, prediction: null, score: 800, confidence: 0.55, remaining: 0 };
    }
    return null;
  }

  static matchKep(p, seq) {
    if (seq.length < 4) return null;
    const n = seq.length;
    const a = seq[n - 4], b = seq[n - 3], c = seq[n - 2], d = seq[n - 1];
    if (a === d && b === c && a !== b) {
      return {
        ...p, type: 'kep', matched: 4,
        prediction: d === 'T' ? 'Xỉu' : 'Tài',
        score: 600, confidence: 0.72, remaining: 0,
      };
    }
    return null;
  }

  static matchPalindrome(p, seq) {
    const sizes = { 'Palindrome 3': 3, 'Palindrome 4': 4, 'Palindrome 5': 5 };
    const size = sizes[p.name];
    if (seq.length < size) return null;
    const tail = seq.slice(-size);
    for (let i = 0; i < Math.floor(size / 2); i++) {
      if (tail[i] !== tail[size - 1 - i]) return null;
    }
    return { ...p, type: 'palindrome', matched: size, prediction: null, score: size * 100 + 200, confidence: 0.6, remaining: 0 };
  }

  static matchMirror(p, seq) {
    const size = p.name.includes('AB-AB') ? 2 : 3;
    if (seq.length < size * 2) return null;
    const first = seq.slice(-size * 2, -size).join('');
    const second = seq.slice(-size).join('');
    if (first === second) {
      return { ...p, type: 'mirror', matched: size * 2, prediction: null, score: size * 150 + 250, confidence: 0.58, remaining: 0 };
    }
    return null;
  }

  static matchChaos(p, seq) {
    if (seq.length < 12) return null;
    const tail = seq.slice(-12);
    let switches = 0;
    for (let i = 1; i < tail.length; i++) if (tail[i] !== tail[i - 1]) switches++;
    if (switches >= 9) {
      return { ...p, type: 'chaos', matched: 12, prediction: null, score: 400, confidence: 0.4, remaining: 0 };
    }
    return null;
  }

  static matchRare(p, seq) {
    if (seq.length < 8) return null;
    const tail6 = seq.slice(-6).join('');
    const head = seq.slice(0, seq.length - 6).join('');
    const occurrences = head.split(tail6).length - 1;
    if (occurrences === 0) {
      return { ...p, type: 'rare', matched: 6, prediction: null, score: 350, confidence: 0.4, remaining: 0 };
    }
    return null;
  }

  static matchNoise(p, seq) {
    if (seq.length < 6) return null;
    const prev4 = seq.slice(-6, -2);
    const last2 = seq.slice(-2);
    const prevSwitch = prev4.slice(1).reduce((c, v, i) => c + (v !== prev4[i] ? 1 : 0), 0);
    const lastDiff = last2[0] !== last2[1];
    if (prevSwitch <= 1 && lastDiff) {
      return { ...p, type: 'noise', matched: 6, prediction: null, score: 400, confidence: 0.4, remaining: 0 };
    }
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * MODULE 7: DYNAMIC HAZARD
 * ═══════════════════════════════════════════════════════════════════ */
class DynamicHazard {
  static streakHazard(seq) {
    const last = seq[seq.length - 1];
    let count = 1;
    for (let i = seq.length - 2; i >= 0; i--) {
      if (seq[i] === last) count++;
      else break;
    }
    const broken = [], continued = [];
    let run = 1;
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] === seq[i - 1]) {
        run++;
        if (run === count && i + 1 < seq.length) {
          if (seq[i + 1] === last) continued.push(i);
          else broken.push(i);
        }
      } else {
        run = 1;
      }
    }
    const N = seq.length;
    let wB = 1, wC = 1;
    for (const i of broken) wB += Math.exp(-(N - i) / 40);
    for (const i of continued) wC += Math.exp(-(N - i) / 40);
    const pBreak = wB / (wB + wC);
    const sample = broken.length + continued.length;
    return {
      hazard: pBreak,
      sample,
      brokenCount: broken.length,
      continuedCount: continued.length,
      streakLength: count,
      confidence: Math.min(1, sample / 6),
    };
  }

  static cycleHazard(seq, activePattern) {
    if (!activePattern || !activePattern.blocks) {
      return { hazard: 0, sample: 0, confidence: 0 };
    }
    const cycles = activePattern.cycles || 1;
    const avgPatternLen = 4;
    const L = Math.max(2, avgPatternLen);
    const hazard = 1 - Math.exp(-cycles / L);
    return {
      hazard: S.clamp(hazard, 0.02, 0.95),
      sample: cycles,
      confidence: Math.min(1, cycles / 4),
    };
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * META-REASONER
 * ═══════════════════════════════════════════════════════════════════ */
const MetaReasoner = {
  logit(p) { p = S.clamp(p, 0.01, 0.99); return Math.log(p / (1 - p)); },

  predict(history) {
    if (!history || history.length < MIN_HISTORY) return this.fallback();

    const seq = history.map(h => h.result === 'Tài' ? 'T' : 'X');

    const lzResult = PhraseFollow.analyze(seq);
    const ctxResult = ContextSearch.analyze(seq);
    const rqa = RQA.analyze(seq);
    const wavelet = WaveletAnalyzer.analyze(seq);
    const patterns = PatternMatcher.matchAll(seq);
    const streakH = DynamicHazard.streakHazard(seq);

    let totalLogit = 0;
    const contributions = [];

    const add = (name, p, weight, meta = {}) => {
      const l = this.logit(p);
      totalLogit += l * weight;
      contributions.push({ name, p, weight, logit: l, weighted: l * weight, ...meta });
    };

    const rqaWeight = rqa.regime === 'ordered' ? 1.2 : rqa.regime === 'chaotic' ? 0.6 : 0.9;

    if (lzResult.sampleSize >= 1) {
      add('LZ-Phrase', lzResult.pTai, 1.6 * rqaWeight, { sample: lzResult.sampleSize });
    }

    if (ctxResult) {
      add('Context-Search', ctxResult.pTai, 1.4 * rqaWeight, { K: ctxResult.bestContext, matches: ctxResult.bestMatches });
    }

    const usable = patterns.filter(p => p.prediction && p.confidence > 0.5).slice(0, 3);
    for (const p of usable) {
      const pT = p.prediction === 'Tài' ? 0.5 + p.confidence * 0.5 : 0.5 - p.confidence * 0.5;
      add(`Pattern:${p.name}`, pT, 1.8 * rqaWeight, { patternName: p.name, family: p.family, confidence: p.confidence });
    }

    if (streakH.streakLength >= 3) {
      const lastChar = seq[seq.length - 1];
      const pContinue = 1 - streakH.hazard;
      const pT = lastChar === 'T' ? pContinue : streakH.hazard;
      const w = 1.5 * streakH.confidence * rqaWeight;
      add('Streak-Hazard', pT, w, { streak: streakH.streakLength, hazard: streakH.hazard });
    }

    const pFinal = 1 / (1 + Math.exp(-totalLogit));
    const prediction = pFinal >= 0.5 ? 'Tài' : 'Xỉu';
    const confidence = Math.abs(pFinal - 0.5) * 2;

    let finalConf = confidence;
    if (rqa.regime === 'chaotic') finalConf *= 0.7;
    if (rqa.regime === 'ordered') finalConf = Math.min(0.98, finalConf * 1.1);
    const topPattern = patterns[0];
    if (!topPattern || (topPattern.confidence || 0) < 0.6) finalConf *= 0.85;

    let breakRisk = 0;
    if (streakH.streakLength >= 3) {
      breakRisk = streakH.hazard * (0.5 + 0.5 * streakH.confidence);
    }

    const reasons = [];
    reasons.push(`RQA:${rqa.regime}(${(rqa.score * 100).toFixed(0)}%)`);
    reasons.push(`Wave:${wavelet.interpretation}`);
    if (lzResult.sampleSize > 0) reasons.push(`LZ:${lzResult.phrase}×${lzResult.sampleSize}`);
    if (topPattern) reasons.push(`${topPattern.name}(${(topPattern.confidence * 100).toFixed(0)}%)`);
    if (streakH.streakLength >= 3) reasons.push(`Bệt${streakH.streakLength}:hazard${(streakH.hazard * 100).toFixed(0)}%`);

    return {
      prediction, confidence: finalConf, pFinal,
      contributions,
      patterns: patterns.slice(0, 5),
      topPattern,
      lz: lzResult,
      ctx: ctxResult,
      rqa,
      wavelet,
      streakHazard: streakH,
      breakRisk,
      reason: reasons.join(' • '),
      features: {
        seqLength: seq.length,
        regime: rqa.regime,
        structureScore: rqa.score,
        dominantScale: wavelet.dominantScale,
        scaleLabel: wavelet.interpretation,
      },
    };
  },

  fallback() {
    const r = Math.random() < 0.5 ? 'Tài' : 'Xỉu';
    return {
      prediction: r, confidence: 0.5, pFinal: 0.5,
      contributions: [],
      patterns: [], topPattern: null,
      lz: { phrase: '—', sampleSize: 0 },
      ctx: null,
      rqa: { regime: 'unknown', score: 0.5 },
      wavelet: { dominantScale: 0, interpretation: '—', score: 0 },
      streakHazard: { streakLength: 0, hazard: 0 },
      breakRisk: 0,
      reason: 'Đang thu thập dữ liệu...',
      features: { seqLength: 0, regime: 'unknown', structureScore: 0, dominantScale: 0, scaleLabel: '—' },
    };
  },
};

/* ═══════════════════════════════════════════════════════════════════
 * STATE + FETCH + POLLING
 * ═══════════════════════════════════════════════════════════════════ */
const state = {
  sessions: [],           // raw sessions (descending by id)
  predictions: [],        // history of predictions in required format
  pendingPrediction: null,
  lastTopId: 0,
  lastUpdate: null,
  pollCount: 0,
  errorCount: 0,
};

async function fetchAPI() {
  try {
    const r = await axios.get(API_URL, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 LC79-UPIS-API' },
      validateStatus: s => s === 200,
    });
    return r.data;
  } catch (e) {
    const r2 = await axios.get(PROXY_URL, { timeout: 10000 });
    return r2.data;
  }
}

function processData(data) {
  if (!data || !Array.isArray(data.list) || !data.list.length) return;
  const topId = data.list[0].id;

  const sessions = data.list.map(s => ({
    id: s.id,
    result: s.resultTruyenThong === 'TAI' ? 'Tài' : 'Xỉu',
    point: s.point,
    dices: s.dices || [],
  }));

  const existing = new Set(state.sessions.map(s => s.id));
  for (const s of sessions) if (!existing.has(s.id)) state.sessions.push(s);
  state.sessions.sort((a, b) => b.id - a.id);
  if (state.sessions.length > MAX_SESSIONS) state.sessions = state.sessions.slice(0, MAX_SESSIONS);

  /* ── Đối chiếu pending prediction với kết quả thực ── */
  if (state.pendingPrediction) {
    const target = state.sessions.find(s => s.id === state.pendingPrediction.forId);
    if (target) {
      target.ourPrediction = state.pendingPrediction.prediction;
      target.correct = (target.result === state.pendingPrediction.prediction);
      target.predConfidence = state.pendingPrediction.confidence;

      /* Update record in predictions array */
      const rec = state.predictions.find(p => p.Phien === target.id);
      if (rec) {
        rec.KetQua = target.correct ? '✅ ĐÚNG' : '❌ SAI';
        rec._resolvedAt = new Date().toISOString();
        rec._actualResult = target.result;
      }
      state.pendingPrediction = null;
    } else if (state.pendingPrediction.forId < topId) {
      /* Missed */
      const rec = state.predictions.find(p => p.Phien === state.pendingPrediction.forId);
      if (rec) {
        rec.KetQua = '⚠️ BỎ QUA';
        rec._resolvedAt = new Date().toISOString();
      }
      state.pendingPrediction = null;
    }
  }

  /* ── Tạo dự đoán mới khi có phiên mới ── */
  if (state.lastTopId !== topId) {
    state.lastTopId = topId;

    const hist = [...state.sessions]
      .filter(s => s.result === 'Tài' || s.result === 'Xỉu')
      .sort((a, b) => a.id - b.id)
      .map(s => ({ result: s.result, totalScore: s.point, session: s.id }));

    const nextId = topId + 1;
    let pred;

    if (hist.length >= MIN_HISTORY) {
      pred = MetaReasoner.predict(hist);
    } else {
      pred = {
        prediction: null,
        confidence: 0,
        reason: `Đang thu thập dữ liệu (cần ≥${MIN_HISTORY} phiên)...`,
        rqa: { regime: 'unknown', score: 0.5 },
        wavelet: { dominantScale: 0, interpretation: '—' },
        topPattern: null,
        patterns: [],
        lz: { phrase: '—', sampleSize: 0 },
        ctx: null,
        streakHazard: { streakLength: 0, hazard: 0 },
        breakRisk: 0,
        features: { seqLength: 0, regime: 'unknown', structureScore: 0, dominantScale: 0, scaleLabel: '—' },
        contributions: [],
      };
    }

    /* Build public prediction record */
    const record = {
      Phien: nextId,
      Du_doan: pred.prediction || 'Chờ',
      Do_tin_cay: pred.prediction ? `${(pred.confidence * 100).toFixed(0)}%` : '0%',
      ADMIN: ADMIN_HANDLE,
      _createdAt: new Date().toISOString(),
    };

    /* Attach internal metadata (prefix _ so we can filter later) */
    Object.assign(record, {
      _internal: {
        pFinal: pred.pFinal,
        reason: pred.reason,
        topPattern: pred.topPattern ? {
          name: pred.topPattern.name,
          family: pred.topPattern.family,
          type: pred.topPattern.type,
          prediction: pred.topPattern.prediction,
          confidence: pred.topPattern.confidence,
          matched: pred.topPattern.matched,
          cycles: pred.topPattern.cycles,
        } : null,
        patterns: (pred.patterns || []).slice(0, 5).map(p => ({
          name: p.name,
          family: p.family,
          type: p.type,
          prediction: p.prediction,
          confidence: p.confidence,
        })),
        lz: pred.lz,
        ctx: pred.ctx,
        rqa: pred.rqa,
        wavelet: pred.wavelet,
        streakHazard: pred.streakHazard,
        breakRisk: pred.breakRisk,
        features: pred.features,
        contributions: pred.contributions,
      },
    });

    state.predictions.unshift(record);
    if (state.predictions.length > 300) state.predictions = state.predictions.slice(0, 300);

    if (pred.prediction) {
      state.pendingPrediction = {
        forId: nextId,
        prediction: pred.prediction,
        confidence: pred.confidence,
      };
      console.log(`[UPIS] #${nextId} → ${pred.prediction} (${(pred.confidence * 100).toFixed(1)}%) | ${pred.reason}`);
    } else {
      console.log(`[UPIS] #${nextId} → thu thập dữ liệu...`);
    }
  }

  state.lastUpdate = new Date().toISOString();
}

async function poll() {
  try {
    const data = await fetchAPI();
    state.pollCount++;
    state.errorCount = 0;
    processData(data);
  } catch (err) {
    state.errorCount++;
    console.error('[POLL ERR]', err.message);
  }
}

/* ═══════════════════════════════════════════════════════════════════
 * EXPRESS SERVER + ENDPOINTS
 * ═══════════════════════════════════════════════════════════════════ */
const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

/* Helper: strip internal fields for public API */
function publicRecord(r) {
  const { _internal, _createdAt, _resolvedAt, _actualResult, ...pub } = r;
  return pub;
}

/* GET / — main prediction feed (newest first) */
app.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 300);
  const includeInternal = req.query.debug === '1';
  const data = state.predictions.slice(0, limit).map(r => includeInternal ? r : publicRecord(r));
  res.json({
    success: true,
    total: state.predictions.length,
    returned: data.length,
    admin: ADMIN_HANDLE,
    updated_at: state.lastUpdate,
    data,
  });
});

/* GET /current — current pending prediction */
app.get('/current', (req, res) => {
  const rec = state.predictions[0] || null;
  res.json({
    success: !!rec,
    admin: ADMIN_HANDLE,
    data: rec ? publicRecord(rec) : null,
  });
});

/* GET /history — full prediction history */
app.get('/history', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 200, 300);
  const onlyResolved = req.query.resolved === '1';
  let data = state.predictions;
  if (onlyResolved) data = data.filter(p => p.KetQua);
  data = data.slice(0, limit).map(publicRecord);
  res.json({
    success: true,
    total: state.predictions.length,
    returned: data.length,
    admin: ADMIN_HANDLE,
    data,
  });
});

/* GET /stats — accuracy stats */
app.get('/stats', (req, res) => {
  const resolved = state.predictions.filter(p => p.KetQua);
  const correct = resolved.filter(p => p.KetQua.includes('ĐÚNG')).length;
  const wrong = resolved.filter(p => p.KetQua.includes('SAI')).length;
  const accuracy = resolved.length ? (correct / resolved.length) * 100 : 0;
  res.json({
    success: true,
    admin: ADMIN_HANDLE,
    total_predictions: state.predictions.length,
    resolved: resolved.length,
    correct, wrong,
    skipped: state.predictions.filter(p => p.KetQua === '⚠️ BỎ QUA').length,
    accuracy: accuracy.toFixed(2) + '%',
    updated_at: state.lastUpdate,
    engine: {
      poll_count: state.pollCount,
      error_count: state.errorCount,
      sessions_loaded: state.sessions.length,
      current_top: state.lastTopId,
    },
  });
});

/* GET /sessions — raw sessions from source */
app.get('/sessions', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 300);
  res.json({
    success: true,
    total: state.sessions.length,
    data: state.sessions.slice(0, limit),
  });
});

/* GET /latest — alias of /current */
app.get('/latest', (req, res) => res.redirect('/current'));

/* GET /health */
app.get('/health', (req, res) => {
  const age = state.lastUpdate ? Date.now() - new Date(state.lastUpdate).getTime() : null;
  res.json({
    status: age !== null && age < 15000 ? 'healthy' : 'stale',
    last_update: state.lastUpdate,
    age_ms: age,
    admin: ADMIN_HANDLE,
    engine: 'LC79 · UPIS v1.0',
  });
});

/* 404 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not found',
    endpoints: ['/', '/current', '/history', '/stats', '/sessions', '/health'],
    admin: ADMIN_HANDLE,
  });
});

/* ═══════════════════════════════════════════════════════════════════
 * BOOT
 * ═══════════════════════════════════════════════════════════════════ */
async function boot() {
  console.log('%c[LC79 · UPIS API] Unified Pattern Intelligence System',
    'color:#FFB800;font-weight:900;font-size:14px');
  console.log('🧬 LZ-Parser · 🔍 Context-Search · 📊 RQA · 〰️ Wavelet · 📚 67 Patterns · 🎯 Meta-Reasoner');
  console.log(`🌐 Listening on port ${PORT}`);

  await poll();
  setInterval(poll, POLL_INTERVAL);

  app.listen(PORT, () => {
    console.log(`✅ API ready: http://localhost:${PORT}/`);
  });
}

process.on('uncaughtException', e => console.error('[UNCAUGHT]', e.message));
process.on('unhandledRejection', e => console.error('[UNHANDLED]', e && e.message));

boot();