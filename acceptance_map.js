(() => {
  "use strict";

  // -----------------------------
  // Charset (template from map.js)
  // -----------------------------
  const charsetConfigLite = [
    { name: 'Basic Latin', range: [0x0020, 0x007F] },
    { name: 'Latin-1 Supplement', range: [0x0080, 0x00FF] },
    { name: 'Additional Punctuation', range: [0x2000, 0x206F] },
    { name: 'Currency Symbols', range: [0x20A0, 0x20CF] },
    { name: 'Mathematical Operators', range: [0x2200, 0x22FF] },
    { name: 'Miscellaneous Symbols and Arrows', range: [0x2190, 0x21FF] },
  ];

  const charsetConfigFull = [
    { name: 'Basic Latin', range: [0x0020, 0x007F] },
    { name: 'Latin-1 Supplement', range: [0x0080, 0x00FF] },
    { name: 'Latin Extended-A', range: [0x0100, 0x017F] },
    { name: 'Latin Extended-B', range: [0x0180, 0x024F] },
    { name: 'Greek and Coptic', range: [0x0370, 0x03FF] },
    { name: 'Cyrillic', range: [0x0400, 0x04FF] },
    { name: 'Arabic', range: [0x0600, 0x06FF] },
    { name: 'Hebrew', range: [0x0590, 0x05FF] },
    { name: 'Devanagari', range: [0x0900, 0x097F] },
    { name: 'Mathematical Operators', range: [0x2200, 0x22FF] },
    { name: 'Supplemental Mathematical Operators', range: [0x2A00, 0x2AFF] },
    { name: 'Miscellaneous Technical', range: [0x2300, 0x23FF] },
    { name: 'Miscellaneous Symbols and Arrows', range: [0x2190, 0x21FF] },
    { name: 'CJK Unified Ideographs', range: [0x4E00, 0x9FFF] },
    { name: 'Hangul Syllables', range: [0xAC00, 0xD7AF] },
    { name: 'Hiragana', range: [0x3040, 0x309F] },
    { name: 'Katakana', range: [0x30A0, 0x30FF] },
    { name: 'Bopomofo', range: [0x3100, 0x312F] },
    { name: 'Currency Symbols', range: [0x20A0, 0x20CF] },
    { name: 'Additional Punctuation', range: [0x2000, 0x206F] },
  ];

  function generateCharsetFromConfig(config) {
    const charset = new Set();
    for (const block of config) {
      for (let cp = block.range[0]; cp <= block.range[1]; cp++) {
        try {
          charset.add(String.fromCharCode(cp));
        } catch {
          // ignore
        }
      }
    }
    charset.add('\n');
    charset.add('\t');
    return Array.from(charset);
  }

  function buildCharIndexMap(charsetArr) {
    const m = new Map();
    for (let i = 0; i < charsetArr.length; i++) {
      m.set(charsetArr[i], i);
    }
    return m;
  }

  // -----------------------------
  // Acceptance pipeline (i) - (v)
  // -----------------------------
  const MAX_COLOR_INDEX = 16 ** 6; // 16777216

  function isPerfectSquare(n) {
    if (!Number.isFinite(n) || n <= 0) return false;
    const r = Math.floor(Math.sqrt(n));
    return r * r === n;
  }

  function tokenizeDecimal7(decimalString) {
    const indexes = [];
    const segmentLength = 7;
    for (let i = 0; i < decimalString.length; i += segmentLength) {
      const seg = decimalString.slice(i, i + segmentLength);
      const v = parseInt(seg, 10);
      if (!Number.isNaN(v)) indexes.push(v);
    }
    return indexes;
  }

  function areValidColorIndexes(indexes) {
    // indexes are integers representing 1..16^6 inclusive
    const bad = [];
    for (let i = 0; i < indexes.length; i++) {
      const v = indexes[i];
      if (!(Number.isInteger(v) && v >= 1 && v <= MAX_COLOR_INDEX)) {
        bad.push({ i, v });
      }
    }
    return { ok: bad.length === 0, bad };
  }

  function colorIndexToHex(idx) {
    // idx: 1..16^6 inclusive
    const v = idx - 1; // 0..16^6-1
    return "#" + v.toString(16).padStart(6, "0");
  }

  function buildHexSequence(indexes) {
    return indexes.map(colorIndexToHex);
  }

  function adjacencyConflicts(indexes, wrap) {
    // returns list of cells involved in any conflict
    const n = indexes.length;
    if (!isPerfectSquare(n)) return { ok: false, m: 0, conflicts: [], reason: 'Tile count is not a perfect square.' };

    const m = Math.floor(Math.sqrt(n));
    const conflicts = new Set();

    const at = (r, c) => indexes[r * m + c];
    const add = (r, c) => conflicts.add(r * m + c);

    for (let r = 0; r < m; r++) {
      for (let c = 0; c < m; c++) {
        const cur = at(r, c);

        // right neighbor
        if (c + 1 < m) {
          if (cur === at(r, c + 1)) { add(r, c); add(r, c + 1); }
        } else if (wrap && m > 1) {
          if (cur === at(r, 0)) { add(r, c); add(r, 0); }
        }

        // down neighbor
        if (r + 1 < m) {
          if (cur === at(r + 1, c)) { add(r, c); add(r + 1, c); }
        } else if (wrap && m > 1) {
          if (cur === at(0, c)) { add(r, c); add(0, c); }
        }
      }
    }

    return {
      ok: conflicts.size === 0,
      m,
      conflicts: Array.from(conflicts).sort((a, b) => a - b),
      reason: conflicts.size === 0 ? 'No adjacency conflicts.' : `Found ${conflicts.size} conflict cell(s).`,
    };
  }

  // -----------------------------
  // Encoding state → base10 integer
  // -----------------------------
  function parseDecimalBigInt(s) {
    const t = (s ?? "").trim();
    if (!/^[0-9]+$/.test(t)) throw new Error('Decimal input must contain only digits 0-9.');
    return BigInt(t);
  }

  function parseBinaryToBigInt(s) {
    const t = (s ?? "").trim();
    if (!/^[01]+$/.test(t)) throw new Error('Binary input must contain only 0 and 1.');
    return BigInt('0b' + t);
  }

  function encodeStringClassic(str, charsetArr, charToIdx) {
    if (!str || str.trim() === '') throw new Error('String input cannot be empty.');
    const k = BigInt(charsetArr.length);
    let id = 0n;
    for (const ch of str) {
      const idx = charToIdx.get(ch);
      if (idx === undefined) throw new Error(`Character not in charset: ${JSON.stringify(ch)}`);
      id = id * k + BigInt(idx);
    }
    return id;
  }

  // Bijective base-k encoding (digits 1..k), avoids leading-zero collisions.
  function encodeStringBijective(str, charsetArr, charToIdx) {
    if (!str || str.trim() === '') throw new Error('String input cannot be empty.');
    const k = BigInt(charsetArr.length);
    let id = 0n;
    for (const ch of str) {
      const idx0 = charToIdx.get(ch);
      if (idx0 === undefined) throw new Error(`Character not in charset: ${JSON.stringify(ch)}`);
      const digit = BigInt(idx0) + 1n; // 1..k
      id = id * k + digit;
    }
    return id;
  }

  // -----------------------------
  // UI wiring
  // -----------------------------
  const $ = (id) => document.getElementById(id);

  const state = {
    inputMode: 'decimal',
    charsetProfile: 'lite',
    encodingMode: 'classic',
    charsetArr: null,
    charToIdx: null,
    lastReport: '',
  };

  function setView(viewId) {
    for (const el of document.querySelectorAll('.view')) {
      el.classList.toggle('is-hidden', el.id !== viewId);
    }
    for (const btn of document.querySelectorAll('.nav__btn')) {
      btn.classList.toggle('is-active', btn.dataset.view === viewId);
    }
  }

  function setInputMode(mode) {
    state.inputMode = mode;

    for (const b of document.querySelectorAll('.seg__btn')) {
      b.classList.toggle('is-active', b.dataset.inputmode === mode);
    }

    $('input-decimal').classList.toggle('is-hidden', mode !== 'decimal');
    $('input-binary').classList.toggle('is-hidden', mode !== 'binary');
    $('input-string').classList.toggle('is-hidden', mode !== 'string');
  }

  function setRuleDot(dotEl, status) {
    dotEl.classList.remove('is-good', 'is-bad', 'is-warn');
    if (status === 'good') dotEl.classList.add('is-good');
    else if (status === 'bad') dotEl.classList.add('is-bad');
    else if (status === 'warn') dotEl.classList.add('is-warn');
  }

  function setAcceptPill(kind, text, reason) {
    const pill = $('accept-pill');
    pill.classList.remove('is-good', 'is-bad', 'is-warn');
    if (kind === 'good') pill.classList.add('is-good');
    if (kind === 'bad') pill.classList.add('is-bad');
    if (kind === 'warn') pill.classList.add('is-warn');
    pill.textContent = text;
    $('accept-reason').textContent = reason;
  }

  function ensureCharsetReady() {
    const profile = $('charset-profile').value;
    state.charsetProfile = profile;

    const cfg = profile === 'full' ? charsetConfigFull : charsetConfigLite;
    state.charsetArr = generateCharsetFromConfig(cfg);
    state.charToIdx = buildCharIndexMap(state.charsetArr);
  }

  function evaluate() {
    try {
      // (i) state → base10 integer
      let N;
      if (state.inputMode === 'decimal') {
        N = parseDecimalBigInt($('decimal-input').value);
      } else if (state.inputMode === 'binary') {
        N = parseBinaryToBigInt($('binary-input').value);
      } else {
        ensureCharsetReady();
        const encMode = $('encoding-mode').value;
        state.encodingMode = encMode;
        const s = $('string-input').value;
        N = encMode === 'bijective'
          ? encodeStringBijective(s, state.charsetArr, state.charToIdx)
          : encodeStringClassic(s, state.charsetArr, state.charToIdx);
      }

      const base10 = N.toString(10);

      // (ii) 7-token hash (7-digit chunking)
      const tokens = tokenizeDecimal7(base10);

      // (iii) tokens → hex (with index range check)
      const range = areValidColorIndexes(tokens);
      const hex = range.ok ? buildHexSequence(tokens) : tokens.map(() => '—');

      // (iv) perfect square
      const squareOk = isPerfectSquare(tokens.length);
      const m = squareOk ? Math.floor(Math.sqrt(tokens.length)) : 0;

      // (v) adjacency
      const wrap = $('toggle-wrap').checked;
      const adj = (squareOk && range.ok) ? adjacencyConflicts(tokens, wrap) : { ok: false, m, conflicts: [], reason: 'Not evaluated (failed earlier rule).' };

      // Update rule UI
      $('rule-square').textContent = squareOk
        ? `OK: ${tokens.length} = ${m}×${m}`
        : `FAIL: token count ${tokens.length} is not a perfect square`;
      setRuleDot($('dot-square'), squareOk ? 'good' : 'bad');

      $('rule-range').textContent = range.ok
        ? 'OK: all tokens in range'
        : `FAIL: ${range.bad.length} out-of-range token(s) (e.g. i=${range.bad[0].i}, v=${range.bad[0].v})`;
      setRuleDot($('dot-range'), range.ok ? 'good' : 'bad');

      $('rule-adj').textContent = (squareOk && range.ok)
        ? (adj.ok ? 'OK: no adjacent duplicates' : `FAIL: ${adj.conflicts.length} conflict cell(s)`) 
        : '—';
      setRuleDot($('dot-adj'), (squareOk && range.ok) ? (adj.ok ? 'good' : 'bad') : 'warn');

      const accepted = squareOk && range.ok && adj.ok;
      if (accepted) setAcceptPill('good', 'ACCEPT', 'All rules satisfied');
      else {
        const reason = !squareOk ? 'Not a perfect square tile count'
          : !range.ok ? 'One or more tokens out of range'
          : 'Adjacent tile conflict(s)';
        setAcceptPill('bad', 'REJECT', reason);
      }

      // Flow outputs
      $('out-base10').textContent = base10;
      $('out-tokens').textContent = tokens.length ? tokens.map((t, i) => `${String(i).padStart(2,'0')}: ${t}`).join('\n') : '—';
      $('out-hex').textContent = (range.ok && tokens.length)
        ? hex.map((h, i) => `${String(i).padStart(2,'0')}: ${h}`).join('\n')
        : '—';
      $('out-grid').textContent = squareOk ? `${tokens.length} tiles → ${m}×${m}` : '—';
      $('out-adj').textContent = (squareOk && range.ok) ? adj.reason : '—';

      // Render grid
      renderGrid({ tokens, hex, m, squareOk, rangeOk: range.ok, conflicts: new Set(adj.conflicts) });

      // Report
      const report = buildReport({
        inputMode: state.inputMode,
        base10,
        tokenCount: tokens.length,
        tokens,
        range,
        squareOk,
        m,
        wrap,
        adjacency: adj,
        accepted,
      });
      $('report').textContent = report;
      state.lastReport = report;

    } catch (err) {
      setAcceptPill('warn', 'Error', String(err?.message ?? err));
      $('report').textContent = String(err?.message ?? err);
      state.lastReport = $('report').textContent;
      // reset dots
      setRuleDot($('dot-square'), 'warn');
      setRuleDot($('dot-range'), 'warn');
      setRuleDot($('dot-adj'), 'warn');
      $('rule-square').textContent = '—';
      $('rule-range').textContent = '—';
      $('rule-adj').textContent = '—';
      renderGrid({ tokens: [], hex: [], m: 0, squareOk: false, rangeOk: false, conflicts: new Set() });
    }
  }

  function buildReport(x) {
    const lines = [];
    lines.push('ACCEPTANCE MAP REPORT');
    lines.push('---------------------');
    lines.push(`Input mode: ${x.inputMode}`);
    lines.push(`Base10 integer (i): ${x.base10}`);
    lines.push('');
    lines.push(`Tokenization (ii): 7-digit decimal chunks`);
    lines.push(`Token count: ${x.tokenCount}`);
    lines.push('');
    lines.push(`Range check (iii): ${x.range.ok ? 'OK' : 'FAIL'}`);
    if (!x.range.ok) {
      lines.push(`Bad tokens: ${x.range.bad.slice(0, 10).map(b => `[i=${b.i}, v=${b.v}]`).join(' ')}`);
      if (x.range.bad.length > 10) lines.push(`... (+${x.range.bad.length - 10} more)`);
    }
    lines.push(`Perfect square (iv): ${x.squareOk ? `OK (${x.m}x${x.m})` : 'FAIL'}`);
    lines.push(`Adjacency (v): ${(x.squareOk && x.range.ok) ? (x.adjacency.ok ? 'OK' : 'FAIL') : 'N/A'}`);
    lines.push(`Adjacency wrap-around: ${x.wrap ? 'ON' : 'OFF'}`);
    lines.push('');
    lines.push(`FINAL: ${x.accepted ? 'ACCEPT' : 'REJECT'}`);
    lines.push('');

    if (x.tokens && x.tokens.length) {
      lines.push('TOKENS');
      lines.push('------');
      for (let i = 0; i < x.tokens.length; i++) {
        lines.push(`${String(i).padStart(2,'0')}: ${x.tokens[i]}`);
      }
    }

    return lines.join('\n');
  }

  function renderGrid({ tokens, hex, m, squareOk, rangeOk, conflicts }) {
    const gridEl = $('tile-grid');
    const hintEl = $('grid-hint');

    gridEl.innerHTML = '';

    if (!squareOk || !rangeOk || m === 0) {
      gridEl.style.gridTemplateColumns = 'repeat(1, 54px)';
      hintEl.textContent = !tokens.length
        ? 'Evaluate to render a grid.'
        : (!squareOk ? 'Cannot render: token count is not a perfect square.'
          : !rangeOk ? 'Cannot render: token(s) out of range.'
          : 'Cannot render.');
      return;
    }

    hintEl.textContent = `${tokens.length} tiles (${m}×${m}).`;
    gridEl.style.gridTemplateColumns = `repeat(${m}, 54px)`;

    const showLabels = $('toggle-labels').checked;
    const highlight = $('toggle-highlight').checked;

    for (let i = 0; i < tokens.length; i++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.style.backgroundColor = hex[i];

      if (highlight && conflicts.has(i)) {
        tile.classList.add('is-conflict');
      }

      if (showLabels) {
        const r = Math.floor(i / m);
        const c = i % m;
        const lab = document.createElement('div');
        lab.className = 'tile__label';
        lab.textContent = `${r},${c} ${hex[i]}`;
        tile.appendChild(lab);
      }

      gridEl.appendChild(tile);
    }
  }

  function copyReport() {
    const text = state.lastReport || $('report').textContent || '';
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      const prev = $('accept-reason').textContent;
      $('accept-reason').textContent = 'Report copied to clipboard.';
      setTimeout(() => { $('accept-reason').textContent = prev; }, 1200);
    }).catch(() => {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  }

  // -----------------------------
  // Boot
  // -----------------------------
  document.addEventListener('DOMContentLoaded', () => {
    // nav
    for (const btn of document.querySelectorAll('.nav__btn')) {
      btn.addEventListener('click', () => setView(btn.dataset.view));
    }

    // input mode
    for (const b of document.querySelectorAll('.seg__btn')) {
      b.addEventListener('click', () => setInputMode(b.dataset.inputmode));
    }

    // evaluate
    $('btn-evaluate').addEventListener('click', evaluate);

    // quick evaluate on enter for inputs
    $('decimal-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') evaluate(); });
    $('binary-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') evaluate(); });

    // toggles rerender
    $('toggle-labels').addEventListener('change', evaluate);
    $('toggle-highlight').addEventListener('change', evaluate);
    $('toggle-wrap').addEventListener('change', evaluate);

    // string settings
    $('charset-profile').addEventListener('change', () => { state.charsetArr = null; state.charToIdx = null; });

    // copy
    $('btn-copy').addEventListener('click', copyReport);

    // initial
    setView('view-input');
    setInputMode('decimal');
    setAcceptPill('warn', 'Not evaluated', 'Enter a state and click Evaluate.');
  });
})();
