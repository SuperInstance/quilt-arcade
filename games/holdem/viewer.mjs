// HOLDEM VIEWER — the shared screen. Hole cards render through proj.pN
// (rule.C10.check): AI cards are ?? ?? until the show. From the human seat's
// view the cells link to the cards that are theirs; everyone else sees masks.
//
// Reuses the arcade's qa-* visual language (rulebook clause flash, referee
// bubble, cell ledger, theta bars) on a poker table instead of a grid.

import { QuiltEngine } from '../../engine/index.js';
import { buildSheet } from './sheet.mjs';

const engine = new QuiltEngine('view-holdem', { eager: true });
engine.loadSheet(buildSheet());
window.__engine = engine;

const get = async (id) => {
  try { return (await engine.get(id)).data; } catch { return undefined; }
};
const WEIGHTS = ['aggro', 'tight', 'bluff', 'sticky', 'adapt'];

let mode = 'hvae'; // 'hvae' (human seat 1) | 'cvc'
let playing = false, tickBusy = false, playTimer = null, learnOn = true;
let rngState = 424242;
const rnd = () => { rngState |= 0; rngState = (rngState + 0x6D2B79F5) | 0; let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const NAMES = ['P0 · fish (control)', 'P1 · learner', 'P2 · learner'];
const SUIT_GLYPH = { s: '♠', h: '♥', d: '♦', c: '♣' };
const cardHtml = (c) => {
  if (!c || c === '—' || c === '') return '<span class="qa-cardback">▓</span>';
  if (c.includes('?')) return '<span class="qa-cardback">▓▓</span>';
  const r = c[0] === 'T' ? '10' : c[0];
  const s = SUIT_GLYPH[c[1]] ?? c[1];
  const red = c[1] === 'h' || c[1] === 'd';
  return `<span class="qa-card ${red ? 'qa-red' : ''}">${r}${s}</span>`;
};

async function pushAction(req) {
  const seq = ((await get('match.seq')) ?? 0) + 1;
  await engine.set('action.request', { ...req, seq });
  let verdict = await get('rules.verdict');
  if (verdict?.seq !== seq) verdict = (await engine.call('action.dispatch', { ...req, seq })).data;
  return verdict ?? { ok: false, rule: 'ERR', text: 'no verdict' };
}

const driver = {
  async snapshot() {
    const pub = (await engine.call('table.public')).data;
    const legal = (await engine.call('legal.actions')).data;
    const fired = (await get('rules.fired')) ?? [];
    const verdict = await get('rules.verdict');
    const events = (await get('log.events')) ?? [];
    const rules = [];
    for (const id of ['C1','C2','C3','C4','C5','C6','C7','C8','C9','C10']) {
      rules.push({ id, law: (await get(`rule.${id}.law`)) ?? '', fired: fired.includes(id),
        ok: verdict ? !!verdict.ok : true, why: (await get(`rule.${id}.verdict`))?.why ?? '' });
    }
    const learners = [];
    for (const seat of [1, 2]) {
      learners.push({
        seat,
        weights: await Promise.all(WEIGHTS.map(async (k) => ({ key: k, value: Number((await get(`W.p${seat}.${k}`)) ?? 0) }))),
        gen: await get(`learn.gen.p${seat}`),
        receipts: ((await get(`learn.receipts.p${seat}`)) ?? []).length,
        nudges: (await get(`learn.last.p${seat}`))?.nudges ?? [],
        om: await get(`om.p${seat}`),
      });
    }
    const thoughts = {};
    for (const seat of [0, 1, 2]) thoughts[seat] = ((await get(`ai.thoughts.p${seat}`)) ?? []).slice(-8);
    return { pub, legal, rules, verdict, events, learners, thoughts,
      seq: String(pub.phase) + ':' + String(pub.pot) + ':' + String(events.length) + ':' + String(learners.map(l => l.gen)) };
  },
  act: (action, amount) => pushAction({ seat: mode === 'hvae' ? 1 : (action.seat ?? 0), action, amount }),
  async step() {
    const seed = 1 + Math.floor(rnd() * 1e9);
    const step = (await engine.call('match.step', { seed, log: true })).data;
    if (step?.wait) return { wait: true, seat: step.seat };
    return step;
  },
  deal: () => engine.call('deal.hand', { seed: 1 + Math.floor(rnd() * 1e9) }),
  async learn() {
    if (!learnOn) return;
    for (const seat of [1, 2]) await engine.call('learn.update', { seat });
  },
  show: () => engine.call('reveal.show'),
  newMatch: () => engine.call('new_match'),
  async setMode(m) {
    mode = m;
    await engine.call('new_match');
    await engine.set('seats.cfg', m === 'hvae' ? { 0: 'fish', 1: 'human', 2: 'learn' } : { 0: 'fish', 1: 'learn', 2: 'learn' });
    if (m === 'hvae') await engine.set('view.seat', 1); else await engine.set('view.seat', 0);
  },
};

// ── render ────────────────────────────────────────────────────────────────────
function mountHoldem(root) {
  root.classList.add('qa-root');
  root.innerHTML = `
    <style>${CSS}</style>
    <header class="qa-head">
      <div class="qa-brand">
        <span class="qa-logo">⬢</span>
        <div>
          <div class="qa-title">Quilt Arcade — Texas Hold'em</div>
          <div class="qa-tag">hidden info as cells · projections via rule.C10 · weights W.p1.*/W.p2.* refine in the open</div>
        </div>
      </div>
      <div class="qa-controls">
        <div class="qa-modes">
          <button data-mode="hvae" class="qa-btn">You ↔ AI</button>
          <button data-mode="cvc" class="qa-btn">AI ↔ AI (watch them harden)</button>
        </div>
        <label class="qa-learn"><input type="checkbox" id="hh-learn" checked> learning</label>
        <button id="hh-show" class="qa-btn" title="the call to show — flips every projection open (C10)">show ▤</button>
        <button id="hh-step" class="qa-btn">step ▸</button>
        <button id="hh-deal" class="qa-btn qa-primary">deal hand</button>
        <button id="hh-playpause" class="qa-btn qa-hide">⏸ pause</button>
      </div>
    </header>
    <div class="qa-grid-wrap">
      <div class="qa-board-col">
        <div class="qa-table">
          <div id="hh-seats"></div>
          <div class="hh-board">
            <div id="hh-comm"></div>
            <div class="hh-pot">pot <b id="hh-pot">0</b></div>
          </div>
        </div>
        <div class="qa-bubble" id="qa-bubble"><span class="qa-bubble-chip" id="qa-bubble-chip">referee</span>
          <span class="qa-bubble-text" id="qa-bubble-text">deal a hand — every verdict comes from a rule cell.</span></div>
        <div class="qa-actions" id="hh-actions"></div>
        <div id="hh-learnstrip"></div>
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
        <section class="qa-panel">
          <h2>agent thoughts <span class="qa-hint">ai.thoughts.pN — the agents narrate their own play</span></h2>
          <div id="qa-thoughts"></div>
        </section>
      </div>
    </div>`;

  const $ = (id) => root.querySelector('#' + id);
  const seatsEl = $('hh-seats'), commEl = $('hh-comm'), potEl = $('hh-pot');
  const bookEl = $('qa-book'), logEl = $('qa-log'), thoughtsEl = $('qa-thoughts');
  const bubbleEl = $('qa-bubble'), chipEl = $('qa-bubble-chip'), textEl = $('qa-bubble-text');
  const actionsEl = $('hh-actions'), learnEl = $('hh-learnstrip');
  let lastSeq = null;

  async function refresh() {
    const snap = await driver.snapshot();
    if (snap.seq === lastSeq) return;
    lastSeq = snap.seq;
    const { pub, legal } = snap;
    // seats
    seatsEl.innerHTML = pub.seats.map((s, i) => `
      <div class="hh-seat ${pub.button === i ? 'hh-btn' : ''} ${s.folded ? 'hh-folded' : ''} ${pub.to_act === i ? 'hh-acting' : ''}">
        <div class="hh-seat-head"><b>${NAMES[i]}</b>${pub.button === i ? '<span class="hh-dealer">D</span>' : ''}
          ${s.folded ? '<span class="hh-flag">FOLDED</span>' : ''}${s.allin ? '<span class="hh-flag qa-flag-allin">ALL-IN</span>' : ''}</div>
        <div class="hh-cards">${(s.proj === '—' ? ['—'] : s.proj.split(' ')).map(cardHtml).join('')}</div>
        <div class="hh-stack">stack <b>${s.stack}</b>${s.bet ? ` · bet <b>${s.bet}</b>` : ''}</div>
      </div>`).join('');
    // community + pot
    commEl.innerHTML = pub.comm.map((c) => c ? cardHtml(c) : '<span class="qa-cardback hh-empty">·</span>').join('');
    potEl.textContent = pub.pot;
    // rulebook + bubble + ledger + thoughts
    bookEl.innerHTML = '';
    for (const cl of snap.rules) {
      const el = document.createElement('div');
      el.className = 'qa-clause' + (cl.fired ? (cl.ok === false ? ' qa-clause-bad' : ' qa-clause-fired') : '');
      el.innerHTML = `<b>${cl.id}</b> ${escapeHtml(cl.law)}`;
      if (cl.fired && cl.why) el.title = cl.why;
      bookEl.appendChild(el);
    }
    if (snap.verdict) {
      bubbleEl.className = 'qa-bubble ' + (snap.verdict.ok ? 'qa-bubble-ok' : 'qa-bubble-refuse');
      chipEl.textContent = snap.verdict.rule ?? 'referee';
      textEl.textContent = snap.verdict.text ?? '';
      bubbleEl.classList.remove('qa-flash'); void bubbleEl.offsetWidth; bubbleEl.classList.add('qa-flash');
    }
    logEl.innerHTML = snap.events.slice(-14).reverse().map((ev) =>
      `<div class="qa-logline ${ev.kind === 'refuse' ? 'qa-log-refuse' : ev.kind === 'apply' ? 'qa-log-apply' : ''}">${escapeHtml(ev.text ?? '')}</div>`).join('');
    const allThoughts = [1, 2, 0].flatMap((s) => (snap.thoughts[s] ?? []).slice(-3).map((t) => `<div class="qa-logline ${s === 0 ? 'hh-fish' : ''}">${escapeHtml(t.text)}</div>`));
    thoughtsEl.innerHTML = allThoughts.slice(-9).reverse().join('');
    // learning strip
    learnEl.innerHTML = `<div class="qa-learn-head"><span>generation <b>${snap.learners[0].gen}/${snap.learners[1].gen}</b></span>
      <span>receipts <b>${snap.learners[0].receipts}/${snap.learners[1].receipts}</b></span>
      <span class="qa-hint">strategy weights θ — separate cells, nudged after every hand</span></div>` +
      snap.learners.map((l) => `<div class="hh-learner"><div class="hh-learner-name">P${l.seat} · om(aggro ${fmt(l.om?.opp_aggro)}, sticky ${fmt(l.om?.opp_sticky)})</div>` +
        l.weights.map((t) => {
          const max = 2.5, pct = Math.round((Math.abs(t.value) / max) * 50), neg = t.value < 0;
          return `<div class="qa-theta-row" title="W.p${l.seat}.${t.key} = ${t.value.toFixed(2)}">
            <span class="qa-theta-key">${t.key}</span>
            <div class="qa-theta-bar"><div class="qa-theta-fill ${neg ? 'qa-neg' : 'qa-pos'}" style="${neg ? 'right:50%' : 'left:50%'};width:${pct}%"></div><div class="qa-theta-mid"></div></div>
            <span class="qa-theta-val">${t.value >= 0 ? '+' : ''}${t.value.toFixed(2)}</span></div>`;
        }).join('') +
        (l.nudges.length ? `<div class="hh-nudges">${l.nudges.slice(-3).map((n) => `<div>${n.key} ${n.delta >= 0 ? '+' : ''}${n.delta} — ${escapeHtml(n.why)}</div>`).join('')}</div>` : '') +
        `</div>`).join('');
    // action bar (human seat, when it is their turn)
    actionsEl.innerHTML = '';
    const humanSeat = 1;
    if (mode === 'hvae' && pub.phase === 'play' && pub.to_act === humanSeat && legal?.seat === humanSeat) {
      for (const opt of legal.options) {
        const b = document.createElement('button');
        b.className = 'qa-btn qa-act';
        b.textContent = opt.label;
        b.onclick = () => doHuman(opt.action, opt.action === 'raise' ? opt.min : undefined);
        actionsEl.appendChild(b);
      }
      const mk = (label, mult) => {
        const b = document.createElement('button');
        b.className = 'qa-btn qa-act';
        b.textContent = label;
        b.onclick = () => doHuman('raise', Math.min(Math.max(legal.options.find(o => o.action === 'raise')?.min ?? 0, Math.round((pub.pot || 4) * mult)), legal.options.find(o => o.action === 'raise')?.max ?? 0));
        actionsEl.appendChild(b);
      };
      mk('raise ½ pot', 0.5); mk('raise pot', 1);
      const allinOpt = legal.options.find(o => o.action === 'raise')?.max;
      if (allinOpt) { const b = document.createElement('button'); b.className = 'qa-btn qa-act qa-act-allin'; b.textContent = 'all-in ' + allinOpt; b.onclick = () => doHuman('raise', allinOpt); actionsEl.appendChild(b); }
    } else if (mode === 'hvae' && pub.phase === 'play') {
      actionsEl.innerHTML = '<span class="qa-hint">the agents are acting…</span>';
    } else if (pub.phase !== 'play') {
      actionsEl.innerHTML = '<span class="qa-hint">hand over — deal the next one (learning nudges apply between hands).</span>';
    }
    return snap;
  }

  async function doHuman(action, amount) {
    const v = await driver.act(action, amount);
    await refresh();
    if (v && v.ok === false) { bubbleEl.classList.add('qa-shake'); setTimeout(() => bubbleEl.classList.remove('qa-shake'), 500); }
    // let the agents respond
    for (let i = 0; i < 40; i++) {
      const snap = await driver.snapshot();
      if (snap.pub.phase !== 'play') break;
      if (snap.pub.to_act === 1) break;
      await driver.step();
      await refresh();
    }
  }

  async function cvcTick() {
    if (tickBusy) return;
    tickBusy = true;
    try {
      const snap = await driver.snapshot();
      if (snap.pub.phase !== 'play') {
        await driver.learn();
        await driver.deal();
        lastSeq = null;
        await refresh();
        return;
      }
      await driver.step();
      await refresh();
    } finally { tickBusy = false; }
  }

  function setPlaying(on) {
    playing = on;
    const pp = $('hh-playpause');
    if (on) { pp.classList.remove('qa-hide'); pp.textContent = '⏸ pause'; playTimer = setInterval(cvcTick, 500); }
    else { if (playTimer) clearInterval(playTimer); playTimer = null; pp.textContent = '▶ resume'; }
  }

  root.querySelectorAll('[data-mode]').forEach((btn) => {
    btn.onclick = async () => {
      mode = btn.dataset.mode;
      root.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('qa-active', b === btn));
      if (playing) setPlaying(false);
      await driver.setMode(mode);
      lastSeq = null;
      await refresh();
      if (mode === 'cvc') setPlaying(true);
    };
  });
  $('hh-learn').onchange = (e) => { learnOn = e.target.checked; };
  $('hh-deal').onclick = async () => { await driver.deal(); lastSeq = null; await refresh(); };
  $('hh-step').onclick = async () => { if (mode === 'cvc') { await cvcTick(); } else { await doHumanStep(); } await refresh(); };
  $('hh-show').onclick = async () => { await driver.show(); lastSeq = null; await refresh(); };
  $('hh-playpause').onclick = () => setPlaying(!playing);
  async function doHumanStep() {
    const snap = await driver.snapshot();
    if (snap.pub.phase !== 'play') return;
    if (snap.pub.to_act === 1 && mode === 'hvae') return; // your move — use the buttons
    await driver.step();
  }

  root.querySelector('[data-mode="hvae"]').classList.add('qa-active');
  (async () => { await driver.setMode('hvae'); await refresh(); })();
  return { refresh };
}

const fmt = (x) => (x == null ? '–' : Number(x).toFixed(2));
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

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
.qa-grid-wrap { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(300px, 1fr); gap: 16px; padding: 16px 18px 20px; }
@media (max-width: 980px) { .qa-grid-wrap { grid-template-columns: 1fr; } }
.qa-board-col { display: flex; flex-direction: column; gap: 10px; }
.qa-table { background: #1e5c40; border: 1px solid #14472f; border-radius: 16px; padding: 14px;
  box-shadow: inset 0 0 60px rgba(0,0,0,.25); display: flex; flex-direction: column; gap: 12px; }
#hh-seats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.hh-seat { background: rgba(255,253,248,.94); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; position: relative; }
.hh-seat.hh-acting { outline: 3px solid #e8a13c; }
.hh-seat.hh-folded { opacity: .45; }
.hh-seat.hh-btn::after { content: ''; }
.hh-seat-head { display: flex; gap: 6px; align-items: center; font-size: 12px; justify-content: space-between; }
.hh-dealer { background: #fff; border: 1px solid #999; border-radius: 50%; width: 16px; height: 16px; display: inline-flex;
  align-items: center; justify-content: center; font-size: 10px; font-weight: 800; }
.hh-flag { color: var(--bad); font-weight: 800; font-size: 10px; }
.qa-flag-allin { color: #7a5b00; }
.hh-cards { display: flex; gap: 5px; margin: 7px 0; min-height: 40px; }
.qa-card { background: #fff; border: 1px solid #b9ad93; border-radius: 5px; padding: 4px 7px; font-weight: 800;
  font-size: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.25); font-variant-numeric: tabular-nums; }
.qa-red { color: #b3361e; }
.qa-cardback { background: #2a2620; color: #6d6350; border-radius: 5px; padding: 4px 7px; font-size: 13px; border: 1px solid #4a443a; }
.hh-empty { opacity: .3; }
.hh-stack { font-size: 11.5px; color: #55503f; font-variant-numeric: tabular-nums; }
.hh-board { display: flex; align-items: center; gap: 14px; justify-content: center; }
#hh-comm { display: flex; gap: 6px; min-height: 34px; align-items: center; }
.hh-pot { color: #f3ead9; font-size: 13px; } .hh-pot b { font-size: 17px; font-variant-numeric: tabular-nums; }
.qa-actions { display: flex; gap: 6px; flex-wrap: wrap; min-height: 30px; align-items: center; }
.qa-act { background: #efe6d4; border-color: #b9ad93; color: var(--ink); font-weight: 700; }
.qa-act-allin { background: var(--accent); color: #fff; border-color: var(--accent); }
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
.qa-shake { animation: qa-shake .4s; }
@keyframes qa-shake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
#hh-learnstrip { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 10px 14px; }
.qa-learn-head { display: flex; gap: 16px; font-size: 12px; color: #7a705d; margin-bottom: 6px; align-items: baseline; flex-wrap: wrap; }
.qa-learn-head b { font-size: 14px; color: var(--ink); font-variant-numeric: tabular-nums; }
.hh-learner { margin: 4px 0 10px; }
.hh-learner-name { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #6d6350; margin: 2px 0; }
.qa-theta-row { display: grid; grid-template-columns: 9ch 1fr 5ch; gap: 8px; align-items: center; margin: 2px 0; }
.qa-theta-key { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: #6d6350; }
.qa-theta-bar { position: relative; height: 9px; background: #efe9db; border-radius: 4px; overflow: hidden; }
.qa-theta-mid { position: absolute; left: 50%; top: 0; bottom: 0; width: 1px; background: #cfc5ae; }
.qa-theta-fill { position: absolute; top: 0; bottom: 0; border-radius: 3px; }
.qa-pos { background: var(--good); }
.qa-neg { background: var(--bad); }
.qa-theta-val { font-family: ui-monospace, Menlo, monospace; font-size: 11px; text-align: right; }
.hh-nudges { font-size: 10.5px; color: #7a705d; font-family: ui-monospace, Menlo, monospace; margin-top: 3px; line-height: 1.5; }
.qa-side-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.qa-panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; }
.qa-panel h2 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #7a705d;
  display: flex; justify-content: space-between; align-items: baseline; }
.qa-hint { font-size: 10.5px; text-transform: none; letter-spacing: 0; color: #a79a80; font-weight: 400; }
.qa-clause { font-size: 12.5px; padding: 5px 8px; border-radius: 6px; margin: 2px 0; line-height: 1.4; }
.qa-clause b { font-family: ui-monospace, Menlo, monospace; color: var(--accent); margin-right: 4px; }
.qa-clause-fired { background: #e3f1e9; outline: 1px solid #9ed0b8; }
.qa-clause-bad { background: #f9e4dc; outline: 1px solid #e0a894; }
.qa-log { font-family: ui-monospace, Menlo, monospace; font-size: 11px; line-height: 1.55; max-height: 200px; overflow-y: auto; }
.qa-logline { padding: 2px 6px; border-left: 2px solid #ddd3bf; margin: 1px 0; color: #55503f;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.qa-log-refuse { border-left-color: var(--bad); color: var(--bad); }
.qa-log-apply { border-left-color: var(--good); }
.hh-fish { color: #8a7f6a; font-style: italic; }
.qa-grow { flex: 1; min-height: 120px; }
`;

mountHoldem(document.getElementById('app'));
