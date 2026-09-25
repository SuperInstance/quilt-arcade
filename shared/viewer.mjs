// quilt-arcade viewer — one UI framework, four games.
//
// mountGame(rootEl, driver) renders:
//   - the board as a spreadsheet grid (column letters, row numbers)
//   - the RULEBOOK panel with per-clause law text; clauses FLASH when they fire
//   - the RULE BUBBLE: the referee's contextual verdict for the last action
//     (green = accepted+effects, red = refused with the reason)
//   - the CELL LEDGER: the sheet's append-only log.events stream
//   - the LEARNING STRIP: generation, rolling win rate, and the live theta
//     weights as signed bars — the part you watch drift while CVC self-play runs
//   - flip/placement CASCADE animation driven by the arbiter's trace
//
// Modes: Human vs Human · Human vs AI · AI vs AI (with per-game learning).
// The driver (see shared/driver.mjs) owns the engine; the viewer owns pixels.

import { mountReceipts } from './receipts.mjs';

export function mountGame(root, driver, extras = {}) {
  root.classList.add('qa-root');
  root.innerHTML = `
    <style>${CSS}</style>
    <header class="qa-head">
      <div class="qa-brand">
        <span class="qa-logo">⬢</span>
        <div>
          <div class="qa-title">${driver.title}</div>
          <div class="qa-tag">${driver.tagline ?? ''}</div>
        </div>
      </div>
      <div class="qa-controls">
        <div class="qa-modes" role="tablist">
          <button data-mode="hvh" class="qa-btn">Human ↔ Human</button>
          <button data-mode="hvae" class="qa-btn">Human ↔ AI</button>
          <button data-mode="cvc" class="qa-btn">AI ↔ AI</button>
        </div>
        <label class="qa-learn ${driver.hasLearning ? '' : 'qa-hide'}">
          <input type="checkbox" id="qa-learn-cb" checked> learning
        </label>
        <select id="qa-speed" class="qa-btn qa-speed" title="animation speed">
          <option value="700">slow</option>
          <option value="300" selected>normal</option>
          <option value="90">fast</option>
          <option value="0">instant</option>
        </select>
        <button id="qa-step" class="qa-btn">step ▸</button>
        <button id="qa-new" class="qa-btn qa-primary">new game</button>
        <button id="qa-playpause" class="qa-btn qa-hide">⏸ pause</button>
      </div>
    </header>
    <div class="qa-grid-wrap">
      <div class="qa-board-col">
        <div class="qa-scorebar" id="qa-scores"></div>
        <div class="qa-board-outer"><div id="qa-board"></div></div>
        <div class="qa-bubble ${'qa-bubble-idle'}" id="qa-bubble">
          <span class="qa-bubble-chip" id="qa-bubble-chip">referee</span>
          <span class="qa-bubble-text" id="qa-bubble-text">push a value — click any cell.</span>
        </div>
        <div class="qa-learn-strip" id="qa-learnstrip"></div>
      </div>
      <div class="qa-side-col">
        <section class="qa-panel">
          <h2>rulebook <span class="qa-hint">clauses flash when they fire</span></h2>
          <div id="qa-book"></div>
        </section>
        <section class="qa-panel qa-grow">
          <h2>cell ledger <span class="qa-hint">log.events — the sheet's audit trail</span></h2>
          <div id="qa-log"></div>
        </section>
      </div>
    </div>`;

  const $ = (id) => root.querySelector('#' + id);

  // receipts surface — the shared renderer every plugin mounts (optional,
  // off by default so plain embeds are unchanged).
  let receiptsApi = null;
  if (extras.receipts && extras.engine) {
    receiptsApi = mountReceipts(root.querySelector('.qa-side-col'), extras.engine, extras.receipts);
  }
  const boardEl = $('qa-board'), bookEl = $('qa-book'), logEl = $('qa-log');
  const bubbleEl = $('qa-bubble'), chipEl = $('qa-bubble-chip'), textEl = $('qa-bubble-text');
  const scoresEl = $('qa-scores'), learnEl = $('qa-learnstrip');

  let mode = 'hvae';
  let speed = 300;
  let playing = false, tickBusy = false, playTimer = null;
  let prevFaces = null;
  let rngState = 987654321;

  const rnd = () => {
    rngState |= 0; rngState = (rngState + 0x6D2B79F5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ── board construction ───────────────────────────────────────────────────────
  function buildBoard() {
    boardEl.innerHTML = '';
    const { rows, cols, colLabels, rowLabels } = driver;
    boardEl.style.gridTemplateColumns = `2ch repeat(${cols}, var(--cell))`;
    boardEl.style.setProperty('--cell', (driver.cellSize ?? 52) + 'px');
    const corner = document.createElement('div');
    corner.className = 'qa-corner';
    boardEl.appendChild(corner);
    for (let c = 0; c < cols; c++) {
      const el = document.createElement('div');
      el.className = 'qa-collabel' + (driver.columnClickable ? ' qa-colclick' : '');
      el.textContent = colLabels[c];
      if (driver.columnClickable) {
        el.onclick = () => humanMove(0, c, el);
      }
      boardEl.appendChild(el);
    }
    for (let r = 0; r < rows; r++) {
      const rl = document.createElement('div');
      rl.className = 'qa-rowlabel';
      rl.textContent = rowLabels ? rowLabels[r] : (r + 1);
      boardEl.appendChild(rl);
      for (let c = 0; c < cols; c++) {
        const cell = document.createElement('div');
        cell.className = 'qa-cell';
        cell.dataset.r = r; cell.dataset.c = c;
        cell.onclick = () => humanMove(r, c, cell);
        boardEl.appendChild(cell);
      }
    }
  }

  function cellEl(r, c) {
    return boardEl.querySelector(`.qa-cell[data-r="${r}"][data-c="${c}"]`);
  }

  function renderCellFace(r, c, face, animate) {
    const el = cellEl(r, c);
    if (!el) return;
    el.className = 'qa-cell' + (face.cls ? ' qa-' + face.cls : '') + (animate ? ' qa-pop' : '');
    el.innerHTML = face.glyph ? `<span>${face.glyph}</span>` : '';
    if (face.title) el.title = face.title;
  }

  // ── rendering ────────────────────────────────────────────────────────────────
  function renderBook(snap) {
    bookEl.innerHTML = '';
    for (const clause of snap.rules) {
      const el = document.createElement('div');
      el.className = 'qa-clause' + (clause.fired ? (clause.ok === false ? ' qa-clause-bad' : ' qa-clause-fired') : '');
      el.innerHTML = `<b>${clause.id}</b> ${escapeHtml(clause.law)}`;
      if (clause.fired && clause.why) el.title = clause.why;
      bookEl.appendChild(el);
    }
    bookEl.parentElement.querySelector('h2').classList.remove('qa-flash');
  }

  function renderLog(snap) {
    logEl.innerHTML = '';
    for (const ev of snap.events.slice(-14).reverse()) {
      const el = document.createElement('div');
      el.className = 'qa-logline' + (ev.kind === 'refuse' ? ' qa-log-refuse' : ev.kind === 'apply' ? ' qa-log-apply' : '');
      el.textContent = ev.text ?? JSON.stringify(ev).slice(0, 90);
      logEl.appendChild(el);
    }
  }

  function renderScores(snap) {
    scoresEl.innerHTML = '';
    for (const s of snap.scores ?? []) {
      const el = document.createElement('div');
      el.className = 'qa-score' + (s.emph ? ' qa-score-emph' : '');
      el.innerHTML = `<span class="qa-score-label">${escapeHtml(s.label)}</span><span class="qa-score-value">${escapeHtml(String(s.value))}</span>`;
      scoresEl.appendChild(el);
    }
    const turn = document.createElement('div');
    turn.className = 'qa-score qa-turn';
    turn.innerHTML = snap.phase === 'over'
      ? `<span class="qa-score-label">game over</span><span class="qa-score-value">${escapeHtml(String(snap.winner ?? ''))}</span>`
      : `<span class="qa-score-label">to move</span><span class="qa-score-value">${escapeHtml(String(snap.turn ?? ''))}</span>`;
    scoresEl.appendChild(turn);
  }

  function renderLearnStrip(snap) {
    if (!snap.theta) { learnEl.classList.add('qa-hide'); return; }
    learnEl.classList.remove('qa-hide');
    const max = Math.max(1, ...snap.theta.map(t => Math.abs(t.value)));
    const bars = snap.theta.map(t => {
      const pct = Math.round((Math.abs(t.value) / max) * 50);
      const neg = t.value < 0;
      return `<div class="qa-theta-row" title="${escapeHtml(t.key)} = ${t.value.toFixed(2)}">
        <span class="qa-theta-key">${escapeHtml(t.key)}</span>
        <div class="qa-theta-bar"><div class="qa-theta-fill ${neg ? 'qa-neg' : 'qa-pos'}" style="${neg ? 'right:50%' : 'left:50%'};width:${pct}%"></div><div class="qa-theta-mid"></div></div>
        <span class="qa-theta-val">${t.value >= 0 ? '+' : ''}${t.value.toFixed(1)}</span>
      </div>`;
    }).join('');
    learnEl.innerHTML = `<div class="qa-learn-head"><span>generation <b>${snap.gen ?? 0}</b></span>
      <span>win rate (10) <b>${snap.winRate ?? '–'}%</b></span><span class="qa-hint">policy weights θ — live</span></div>${bars}`;
  }

  function renderBubble(snap) {
    const v = snap.bubble;
    if (!v) return;
    bubbleEl.className = 'qa-bubble ' + (v.ok ? 'qa-bubble-ok' : 'qa-bubble-refuse');
    chipEl.textContent = v.rule ?? 'referee';
    textEl.textContent = v.text ?? '';
    bubbleEl.classList.remove('qa-flash');
    void bubbleEl.offsetWidth;
    bubbleEl.classList.add('qa-flash');
  }

  // ── the cascade: apply trace in order, animating each flip ───────────────────
  function applyCascade(snap) {
    const faces = snap.cells;
    const trace = snap.lastTrace ?? [];
    if (!prevFaces || !trace.length || speed === 0) {
      for (let r = 0; r < driver.rows; r++)
        for (let c = 0; c < driver.cols; c++) renderCellFace(r, c, faces[r][c], false);
      prevFaces = faces.map(row => row.map(f => f.glyph + '|' + f.cls));
      return;
    }
    // paint untouched cells immediately; animate trace cells in arbiter order
    const traceKeys = new Set(trace.map(t => t.r + ':' + t.c));
    for (let r = 0; r < driver.rows; r++)
      for (let c = 0; c < driver.cols; c++)
        if (!traceKeys.has(r + ':' + c)) renderCellFace(r, c, faces[r][c], false);
    const step = Math.max(30, Math.min(220, speed));
    trace.forEach((t, i) => {
      setTimeout(() => {
        renderCellFace(t.r, t.c, faces[t.r][t.c], true);
        prevFaces = null;
      }, i * step);
    });
  }

  let lastSeqRendered = null;

  async function refresh(animate = true) {
    const snap = await driver.snapshot();
    if (snap.seq === lastSeqRendered) return;
    const first = lastSeqRendered === null;
    lastSeqRendered = snap.seq;
    renderScores(snap);
    renderBook(snap);
    renderLog(snap);
    renderLearnStrip(snap);
    renderBubble(snap);
    if (animate && !first) applyCascade(snap);
    else {
      for (let r = 0; r < driver.rows; r++)
        for (let c = 0; c < driver.cols; c++) renderCellFace(r, c, snap.cells[r][c], false);
      prevFaces = snap.cells.map(row => row.map(f => f.glyph + '|' + f.cls));
    }
    // winner line highlight
    if (snap.line) for (const sq of snap.line) {
      const el = cellElBySq(sq);
      if (el) el.classList.add('qa-winline');
    }
    // hints
    if (snap.legal && mode !== 'cvc') {
      for (const sq of snap.legal) {
        const el = cellElBySq(sq);
        if (el) el.classList.add('qa-hint');
      }
    }
    return snap;
  }

  function cellElBySq(sq) {
    const m = /^([A-Z]+)([0-9]+)$/.exec(sq);
    if (!m) return null;
    const c = driver.colLabels.indexOf(m[1]);
    const r = Number(m[2]) - 1;
    return cellEl(r, c);
  }

  // ── interaction ──────────────────────────────────────────────────────────────
  async function humanMove(r, c, el) {
    try {
      if (mode === 'cvc' || tickBusy) return;
      const snap = await driver.snapshot();
      if (snap.phase !== 'play') { await driver.newGame(); await refresh(); return; }
      if (mode === 'hvae' && snap.turn !== driver.humanColor) return;
      const res = await driver.click(r, c);
      await refresh();
      if (res && res.refused && el) {
        el.classList.add('qa-shake');
        setTimeout(() => el.classList.remove('qa-shake'), 500);
      }
      await maybeAIReply();
    } catch (err) { console.error('humanMove failed:', err); }
  }

  async function maybeAIReply() {
    if (mode !== 'hvae') return;
    const snap = await driver.snapshot();
    if (snap.phase !== 'play') return;
    if (snap.turn === driver.humanColor) return;
    tickBusy = true;
    setTimeout(async () => {
      try { await driver.step(rnd); await refresh(); }
      finally { tickBusy = false; }
    }, Math.max(120, speed));
  }

  async function cvcTick() {
    if (tickBusy) return;
    tickBusy = true;
    try {
      const snap = driver.snapshot();
      if (snap.phase !== 'play') {
        const learnOn = root.querySelector('#qa-learn-cb')?.checked ?? false;
        if (learnOn && driver.hasLearning) await driver.learn(rnd);
        driver.newGame();
        lastSeqRendered = null;
        await refresh();
        return;
      }
      await driver.step(rnd);
      await refresh();
    } finally { tickBusy = false; }
  }

  function setPlaying(on) {
    playing = on;
    const pp = root.querySelector('#qa-playpause');
    if (on) {
      pp.classList.remove('qa-hide');
      pp.textContent = '⏸ pause';
      const period = Math.max(90, speed * 2 + 120);
      playTimer = setInterval(cvcTick, period);
    } else {
      if (playTimer) clearInterval(playTimer);
      playTimer = null;
      pp.textContent = '▶ resume';
    }
  }

  root.querySelectorAll('[data-mode]').forEach(btn => {
    btn.onclick = async () => {
      mode = btn.dataset.mode;
      root.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('qa-active', b === btn));
      if (playing) setPlaying(false);
      driver.setMode(mode);
      await driver.newGame();
      lastSeqRendered = null;
      await refresh();
      if (mode === 'cvc') setPlaying(true);
    };
  });
  root.querySelector('#qa-speed').onchange = (e) => {
    speed = Number(e.target.value);
    if (playing) { setPlaying(false); setPlaying(true); }
  };
  root.querySelector('#qa-new').onclick = async () => { await driver.newGame(); lastSeqRendered = null; await refresh(); };
  root.querySelector('#qa-step').onclick = async () => {
    if (mode !== 'cvc') { await maybeAIReply(); return; }
    await cvcTick(); await refresh();
  };
  root.querySelector('#qa-playpause').onclick = () => setPlaying(!playing);

  buildBoard();
  root.querySelector('[data-mode="hvae"]').classList.add('qa-active');
  driver.setMode('hvae');
  (async () => { await refresh(); })();

  return { refresh, receipts: receiptsApi };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

const CSS = `
.qa-root { --cell: 52px; --ink: #16130e; --paper: #f6f2ea; --panel: #fffdf8; --line: #d8d0c0;
  --accent: #b3541e; --good: #1e7d4f; --bad: #b3361e; --dark: #1c1913;
  font-family: 'Avenir Next', 'Segoe UI', system-ui, sans-serif; color: var(--ink);
  background: var(--paper); border: 1px solid var(--line); border-radius: 14px; overflow: hidden;
  box-shadow: 0 10px 40px rgba(28,25,19,.12); }
.qa-head { display: flex; flex-wrap: wrap; gap: 10px; justify-content: space-between; align-items: center;
  padding: 14px 18px; background: var(--dark); color: #f3ead9; }
.qa-brand { display: flex; gap: 12px; align-items: center; }
.qa-logo { font-size: 26px; color: #e8a13c; }
.qa-title { font-weight: 800; letter-spacing: .02em; font-size: 17px; }
.qa-tag { font-size: 11.5px; opacity: .72; font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
.qa-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.qa-btn { border: 1px solid #4a443a; background: #262219; color: #e8ddc8; padding: 6px 10px;
  border-radius: 8px; font-size: 12px; cursor: pointer; font-family: inherit; }
.qa-btn:hover { background: #332d22; }
.qa-btn.qa-active { background: var(--accent); border-color: var(--accent); color: #fff; }
.qa-btn.qa-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.qa-learn { font-size: 12px; display: flex; gap: 5px; align-items: center; color: #d8cdb4; }
.qa-hide { display: none !important; }
.qa-grid-wrap { display: grid; grid-template-columns: minmax(0, auto) minmax(300px, 1fr); gap: 16px; padding: 16px 18px 20px; }
@media (max-width: 980px) { .qa-grid-wrap { grid-template-columns: 1fr; } }
.qa-board-col { display: flex; flex-direction: column; gap: 10px; }
.qa-scorebar { display: flex; gap: 10px; flex-wrap: wrap; }
.qa-score { background: var(--panel); border: 1px solid var(--line); border-radius: 9px;
  padding: 6px 12px; display: flex; gap: 8px; align-items: baseline; }
.qa-score-label { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #7a705d; }
.qa-score-value { font-weight: 800; font-size: 15px; font-variant-numeric: tabular-nums; }
.qa-turn { border-color: var(--accent); }
.qa-board-outer { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 10px; }
#qa-board { display: grid; gap: 2px; width: max-content; }
.qa-corner { }
.qa-collabel, .qa-rowlabel { display: flex; align-items: center; justify-content: center;
  font-size: 11px; color: #8a7f6a; font-family: ui-monospace, Menlo, monospace; font-weight: 700; }
.qa-colclick { cursor: pointer; border-radius: 4px; }
.qa-colclick:hover { background: #efe6d4; color: var(--accent); }
.qa-cell { width: var(--cell); height: var(--cell); background: #efe9db; border: 1px solid #ddd3bf;
  display: flex; align-items: center; justify-content: center; font-size: calc(var(--cell) * .52);
  cursor: pointer; user-select: none; border-radius: 4px; transition: background .15s; position: relative; }
.qa-cell:hover { background: #e4dbc6; }
.qa-cell span { line-height: 1; }
.qa-b { background: #2a2620; color: #f6f2ea; }
.qa-b:hover { background: #2a2620; }
.qa-w { background: #fffdf8; color: #1c1913; box-shadow: inset 0 0 0 2px #cfc5ae; }
.qa-empty-x { color: #b9ad93; font-size: calc(var(--cell) * .4); }
.qa-pop { animation: qa-pop .3s ease; }
@keyframes qa-pop { 0% { transform: scale(.55) rotate(-6deg); } 70% { transform: scale(1.12); } 100% { transform: scale(1); } }
.qa-shake { animation: qa-shake .4s; }
@keyframes qa-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
.qa-winline { outline: 3px solid var(--accent); outline-offset: -3px; z-index: 2; }
.qa-hintcell::after { content: ''; position: absolute; width: 22%; height: 22%; border-radius: 50%;
  background: rgba(179,84,30,.4); }
.qa-bubble { border: 1px solid var(--line); border-left: 5px solid #b9ad93; background: var(--panel);
  border-radius: 10px; padding: 10px 14px; font-size: 13.5px; display: flex; gap: 10px; align-items: baseline; }
.qa-bubble-ok { border-left-color: var(--good); }
.qa-bubble-refuse { border-left-color: var(--bad); background: #fdf3ef; }
.qa-bubble-chip { font-family: ui-monospace, Menlo, monospace; font-weight: 800; font-size: 11px;
  background: #efe6d4; padding: 2px 7px; border-radius: 6px; white-space: nowrap; }
.qa-bubble-refuse .qa-bubble-chip { background: #f5d5c9; color: var(--bad); }
.qa-bubble-ok .qa-bubble-chip { background: #cfe7db; color: var(--good); }
.qa-bubble-text { line-height: 1.45; }
.qa-flash { animation: qa-flash .55s ease; }
@keyframes qa-flash { 0% { background-color: #fff3d6; } 100% { background-color: inherit; } }
.qa-learn-strip { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; }
.qa-learn-head { display: flex; gap: 16px; font-size: 12px; color: #7a705d; margin-bottom: 6px; align-items: baseline; }
.qa-learn-head b { font-size: 14px; color: var(--ink); font-variant-numeric: tabular-nums; }
.qa-theta-row { display: grid; grid-template-columns: 9ch 1fr 5ch; gap: 8px; align-items: center; margin: 2px 0; }
.qa-theta-key { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #6d6350; }
.qa-theta-bar { position: relative; height: 9px; background: #efe9db; border-radius: 4px; overflow: hidden; }
.qa-theta-mid { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: #cfc5ae; }
.qa-theta-fill { position: absolute; top: 0; bottom: 0; border-radius: 3px; }
.qa-pos { background: var(--good); }
.qa-neg { background: var(--bad); }
.qa-theta-val { font-family: ui-monospace, Menlo, monospace; font-size: 11px; text-align: right; }
.qa-side-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.qa-panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.qa-panel h2 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #7a705d;
  display: flex; justify-content: space-between; align-items: baseline; }
.qa-hint { font-size: 10.5px; text-transform: none; letter-spacing: 0; color: #a79a80; font-weight: 400; }
.qa-clause { font-size: 12.5px; padding: 5px 8px; border-radius: 6px; margin: 2px 0; line-height: 1.4; }
.qa-clause b { font-family: ui-monospace, Menlo, monospace; color: var(--accent); margin-right: 4px; }
.qa-clause-fired { background: #e3f1e9; outline: 1px solid #9ed0b8; }
.qa-clause-bad { background: #f9e4dc; outline: 1px solid #e0a894; }
.qa-log { font-family: ui-monospace, Menlo, monospace; font-size: 11px; line-height: 1.55;
  max-height: 300px; overflow-y: auto; }
.qa-logline { padding: 2px 6px; border-left: 2px solid #ddd3bf; margin: 1px 0; color: #55503f;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qa-log-refuse { border-left-color: var(--bad); color: var(--bad); }
.qa-log-apply { border-left-color: var(--good); }
.qa-grow { flex: 1; min-height: 160px; }
`;
