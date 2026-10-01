// PREDICTIVE PADDLE — Pattern 6: estimation loops as cells.
// A fruitfly-CX ring attractor (ported 1:1 from SuperInstance/chiaroscuro PR #6,
// tools/fly_cx.py, model flycx-v2-certainty-gated) estimates the ball's arrival-y
// at the left paddle face from SPARSE EVENTS ONLY (serve/wall/return), per
// experiments/predictive_paddle.PREREG.md (sealed BEFORE this runner ran, R1).
//
//   node experiments/predictive_paddle.mjs
//
// The pong plugin is untouched: sense.* cells are registered dynamically on the
// booted sheet; the M2 advisory A/B swaps ai.track for a sense-aware variant in
// the harness-built sheet copy only. Receipt chain re-derived from GENESIS.
//
// EVENT DETECTION (documented): rules.fired is a CUMULATIVE per-match ledger
// (W2 reads it as history to award points once per contact), so it cannot
// detect per-tick wall hits. A wall event = pure reflection: vy flipped sign
// with |vy| preserved (W3 paddle returns change |vy| to 0.12*offset, so they
// never collide with this test). Serves/returns ride the game audit log.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { QuiltEngine } from '../engine/index.js';
import { harness, GENESIS_PREV, verifyChain } from '../shared/kit.mjs';
import { buildSheet } from '../games/pong/sheet.mjs';

const H = harness('predictive-paddle');
const HERE = dirname(fileURLToPath(import.meta.url));
const SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);
const N = 32, H_FIELD = 60, DEADZONE = 1.5;
// ported constants (chiaroscuro flycx v2 — see PREREG table)
const A0 = 0.5, COMMIT_GAIN = 0.15, REJECT_SHRINK = 0.7, EVENT_DECAY = 0.85, CERT_DECAY = 0.98;

// ── the sense layer (registered on the booted sheet; the sheet did the work) ──
const SENSE_PROJECT = `
// arrival-y of the ball at the LEFT face (x=2) by exact wall folding.
// Pure: ({x,y,vx,vy}) -> {y_at}. Walls at y=1/y=59 -> corridor [1,59], L=58.
// Ball not approaching (vx >= -1e-6) -> y_at=null (no defined left arrival).
const x = input?.x, y = input?.y, vx = input?.vx ?? 0, vy = input?.vy ?? 0;
if (typeof x !== 'number' || typeof y !== 'number') return { y_at: null, why: 'no ball state' };
if (vx >= -1e-6) return { y_at: null, why: 'ball not approaching left face (vx=' + vx + ')' };
const t = (x - 2) / Math.abs(vx);
const L = 58, raw = (y - 1) + vy * t;
const k = Math.floor(raw / L), frac = raw - k * L;
const parity = ((k % 2) + 2) % 2;
const yAt = 1 + (parity === 0 ? frac : L - frac);
return { y_at: Math.max(1, Math.min(59, yAt)), t, why: 'arrival y=' + yAt.toFixed(3) + ' in ' + t.toFixed(1) + ' ticks' };`;

const WITNESS = `
// fnv1a-64 (witness snippet from shared/kit.mjs — in-cell per Pattern 4)
function fnv1a64(str) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) { h ^= BigInt(str.charCodeAt(i) & 0xff); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
  return h.toString(16).padStart(16, '0');
}`;

const SENSE_UPDATE = `
// event-gated plasticity. input: {kind, side}. Ternary psi, flycx v2 semantics:
//   abstain (0): no defined left-face arrival (away/vertical) — nothing written
//   reject (-1): strong cue (err>45deg) conflicts with a CERTAIN bump — anti-thrash
//   commit (+1): ring decay, cos^2 bump injection at projected phi, certainty rise
${WITNESS}
const N = ${N}, H = ${H_FIELD};
const A0 = ${A0}, GAIN = ${COMMIT_GAIN}, SHRINK = ${REJECT_SHRINK}, DECAY = ${EVENT_DECAY};
const ring = ((await runtime.get('sense.ring')).data ?? new Array(N).fill(0)).slice();
const st = (await runtime.get('sense.state')).data;
const tick = (await runtime.get('tick.count')).data;
const ball = {
  x: (await runtime.get('ball.x')).data, y: (await runtime.get('ball.y')).data,
  vx: (await runtime.get('ball.vx')).data, vy: (await runtime.get('ball.vy')).data,
};
// pre-update readout (for err vs the incoming cue)
let sx = 0, sy = 0, mass = 0;
for (let i = 0; i < N; i++) { const phi = i / N * 2 * Math.PI; sx += ring[i] * Math.cos(phi); sy += ring[i] * Math.sin(phi); mass += ring[i]; }
const readY = mass > 1e-9 ? (((Math.atan2(sy, sx) / (2 * Math.PI)) * H) + H) % H : null;
const A_eff = st.A * Math.pow(${CERT_DECAY}, tick - st.lastTick);
const proj = (await runtime.call('sense.project', ball)).data;
let psi, why;
if (proj.y_at === null) {
  psi = 0; why = 'abstain: ' + proj.why;
} else {
  let errDeg = null;
  if (readY !== null) { const d = Math.abs(proj.y_at - readY); errDeg = Math.min(d, H - d) / H * 360; }
  if (errDeg !== null && errDeg > 45 && A_eff > A0) {
    psi = -1; why = 'reject: cue ' + proj.y_at.toFixed(1) + ' conflicts ' + errDeg.toFixed(0) + 'deg with certain bump (A=' + A_eff.toFixed(2) + ')';
    for (let i = 0; i < N; i++) ring[i] *= SHRINK;
    st.A = A_eff * 0.5;
  } else {
    psi = 1; why = 'commit: ' + proj.why + (errDeg !== null ? ' (err ' + errDeg.toFixed(1) + 'deg)' : '');
    const target = proj.y_at / H * 2 * Math.PI;
    for (let i = 0; i < N; i++) {
      let d = Math.abs(i / N * 2 * Math.PI - target); if (d > Math.PI) d = 2 * Math.PI - d;
      const taper = d < Math.PI / 2 ? Math.cos(d / 2) * Math.cos(d / 2) : 0;
      ring[i] = ring[i] * DECAY + GAIN * taper;
    }
    st.A = Math.min(1, A_eff + (1 - A_eff) * GAIN);
  }
}
st.lastTick = tick;
st.counts[psi === 1 ? 'commit' : psi === -1 ? 'reject' : 'abstain']++;
await runtime.set('sense.ring', ring);
await runtime.set('sense.state', st);
// chained receipt row (fnv1a-64, canonical: prev_hash sorted INTO the JSON — kit canon)
const row = { seq: (await runtime.get('sense.receipts')).data.length, tick, kind: input?.kind ?? '?', side: input?.side ?? null, psi, err_deg: null, y_at: proj.y_at, mass: +(mass.toFixed(4)), A: +st.A.toFixed(4) };
if (proj.y_at !== null && readY !== null) { const d = Math.abs(proj.y_at - readY); row.err_deg = +(Math.min(d, H - d) / H * 360).toFixed(2); }
const prev = (await runtime.get('sense.receipts')).data;
const prevHash = prev.length ? prev[prev.length - 1].row_hash : '${GENESIS_PREV}';
const cs = { ...row, prev_hash: prevHash };
const c2 = {}; for (const k of Object.keys(cs).sort()) c2[k] = cs[k];
row.row_hash = fnv1a64(JSON.stringify(c2));
row.prev_hash = prevHash;
row.why = why;
await runtime.set('sense.receipts', [...prev, row]);
return { psi, why, y_at: proj.y_at, A: st.A, mass };`;

const SENSE_PREDICT = `
// readout: circular mean -> arrival-y estimate + aged certainty. Pure read.
const N = ${N}, H = ${H_FIELD};
const ring = (await runtime.get('sense.ring')).data;
const st = (await runtime.get('sense.state')).data;
const tick = (await runtime.get('tick.count')).data;
let sx = 0, sy = 0, mass = 0;
for (let i = 0; i < N; i++) { const phi = i / N * 2 * Math.PI; sx += ring[i] * Math.cos(phi); sy += ring[i] * Math.sin(phi); mass += ring[i]; }
const y = mass > 1e-9 ? (((Math.atan2(sy, sx) / (2 * Math.PI)) * H) + H) % H : null;
const A_eff = st.A * Math.pow(${CERT_DECAY}, tick - st.lastTick);
return { y, mass: +mass.toFixed(4), A_eff: +A_eff.toFixed(4), certain: A_eff >= ${A0} && mass >= 0.5, lastTick: st.lastTick };`;

// M2 advisory: original TRACK for right; left uses the attractor when certain+approaching
const TRACK_ADVISORY = `
// sense-aware left paddle: attractor readout when certain AND ball approaching;
// honest fallback = the derived law verbatim. Mode rides the return value.
const side = input?.side;
const track = async (target, mode) => {
  const paddle = (await runtime.get('paddle.' + side)).data;
  const speed = side === 'left' ? 0.85 : 0.70;
  const dead = 1.5;
  let y = paddle;
  if (Math.abs(target - y) > dead) y += Math.sign(target - y) * Math.min(speed, Math.abs(target - y) - dead);
  y = Math.max(6, Math.min(54, y));
  await runtime.set('paddle.' + side, y);
  return { side, y, target, mode };
};
if (side === 'left') {
  const p = (await runtime.call('sense.predict')).data;
  const vx = (await runtime.get('ball.vx')).data;
  if (p.certain && vx < 0 && p.y !== null) return track(p.y, 'attractor');
  return track((await runtime.get('ball.y')).data, 'reactive-fallback');
}
return track((await runtime.get('ball.y')).data, 'reactive-law');`;

const get = async (e, id) => (await e.get(id)).data;

function bootSense({ advisory = false } = {}) {
  const engine = new QuiltEngine('arcade-pong-sense', { eager: true });
  const sheet = buildSheet();
  if (advisory) {
    for (const c of sheet.cells) if (c.id === 'ai.track') c.code = TRACK_ADVISORY;
  }
  engine.loadSheet(sheet);
  engine.register({ id: 'sense.ring', kind: 'value', value: new Array(N).fill(0), description: 'CX attractor: 32 activity cells over arrival-y (Pattern 6)' });
  engine.register({ id: 'sense.state', kind: 'value', value: { A: 0, lastTick: 0, counts: { commit: 0, reject: 0, abstain: 0 } }, description: 'certainty A, last event tick, psi census' });
  engine.register({ id: 'sense.receipts', kind: 'value', value: [], description: 'fnv1a-64 chained rows: one per event, re-derived from GENESIS' });
  engine.register({ id: 'sense.project', kind: 'program', code: SENSE_PROJECT, description: 'pure: arrival-y at left face by wall folding' });
  engine.register({ id: 'sense.update', kind: 'program', code: SENSE_UPDATE, description: 'event-gated plasticity, ternary psi (flycx v2 port)' });
  engine.register({ id: 'sense.predict', kind: 'program', code: SENSE_PREDICT, description: 'readout: circular mean + aged certainty' });
  return engine;
}

// one match with per-event sensing + per-tick estimator telemetry
async function senseMatch(engine, seed, { probeModes = false, trace = false, maxTicks = 20000 } = {}) {
  await engine.call('new_game', { seed });
  await engine.call('sense.update', { kind: 'serve' });
  const e = { serves: [], leftReturns: [], betweenErrs: [], modes: { attractor: 0, 'reactive-fallback': 0, 'reactive-law': 0 }, trace: [] };
  let lastLog = (await get(engine, 'log.events')).length;
  let prevVy = await get(engine, 'ball.vy');
  let serveProbe = null;   // {tick0, convergedAt, dir}
  let lrProbe = null;      // {events, done}
  let last = null, events = 0, psiStart = { ...(await get(engine, 'sense.state')).counts };
  for (let i = 0; i < maxTicks; i++) {
    last = (await engine.call('match.step')).data;
    const tick = await get(engine, 'tick.count');
    const ball = { x: await get(engine, 'ball.x'), y: await get(engine, 'ball.y'), vx: await get(engine, 'ball.vx'), vy: await get(engine, 'ball.vy') };
    const feeds = [];
    if (ball.vy !== 0 && prevVy !== 0 && Math.sign(ball.vy) !== Math.sign(prevVy)
        && Math.abs(Math.abs(ball.vy) - Math.abs(prevVy)) < 1e-9) feeds.push({ kind: 'wall' });
    prevVy = ball.vy;
    const log = await get(engine, 'log.events');
    for (const row of log.slice(lastLog)) {
      if (row.kind === 'hit') feeds.push({ kind: 'return', side: row.side });
      if (row.kind === 'serve') feeds.push({ kind: 'serve' });
    }
    lastLog = log.length;
    const pred = (await engine.call('sense.predict')).data;
    const oracle = (await engine.call('sense.project', ball)).data;
    const err = oracle.y_at !== null && pred.y !== null ? Math.abs(oracle.y_at - pred.y) : null;
    if (serveProbe && serveProbe.convergedAt === null && err !== null && err <= DEADZONE) serveProbe.convergedAt = tick - serveProbe.tick0;
    if (!feeds.length && err !== null && (tick % 7 === 0)) e.betweenErrs.push(err);
    for (const f of feeds) {
      events++;
      if (f.kind === 'serve') {
        if (serveProbe) e.serves.push(serveProbe);
        serveProbe = { tick0: tick, convergedAt: null, dir: Math.sign(ball.vx) };
      }
      if (f.kind === 'return' && f.side === 'left') lrProbe = { events: 0, done: false };
      const r = (await engine.call('sense.update', f)).data;
      const p2 = (await engine.call('sense.predict')).data;
      const o2 = (await engine.call('sense.project', ball)).data;
      const err2 = o2.y_at !== null && p2.y !== null ? Math.abs(o2.y_at - p2.y) : null;
      if (trace) e.trace.push({ tick, feed: f, psi: r.psi, y_at: r.y_at, readout: p2.y === null ? null : +p2.y.toFixed(2), oracle: o2.y_at === null ? null : +o2.y_at.toFixed(2), err2: err2 === null ? null : +err2.toFixed(2), vx: ball.vx, vy: ball.vy, x: +ball.x.toFixed(1), y: +ball.y.toFixed(1), mass: p2.mass, A: p2.A_eff });
      if (serveProbe && serveProbe.convergedAt === null && err2 !== null && err2 <= DEADZONE) serveProbe.convergedAt = tick - serveProbe.tick0;
      if (lrProbe && f.kind !== 'return') {
        lrProbe.events++;
        if (err2 !== null && err2 <= DEADZONE) { lrProbe.done = true; e.leftReturns.push(lrProbe); lrProbe = null; }
        else if (lrProbe.events >= 3) { e.leftReturns.push(lrProbe); lrProbe = null; }
      }
    }
    if (probeModes) {
      const tr = (await engine.call('ai.track', { side: 'left' })).data;
      e.modes[tr.mode] = (e.modes[tr.mode] ?? 0) + 1;
    }
    if (last.over) break;
  }
  if (serveProbe) e.serves.push(serveProbe);
  const scores = last?.score ?? { left: await get(engine, 'score.left'), right: await get(engine, 'score.right') };
  const counts = (await get(engine, 'sense.state')).counts;
  e.psi = { commit: counts.commit - psiStart.commit, reject: counts.reject - psiStart.reject, abstain: counts.abstain - psiStart.abstain };
  e.events = events;
  e.over = !!last?.over;
  e.winner = e.over ? (scores.left > scores.right ? 'left' : 'right') : null;
  e.ticks = await get(engine, 'tick.count');
  return e;
}

// ── M1: estimation quality (reactive game, estimator fed from the side) ──
const M1 = async (seeds) => {
  const engine = bootSense();
  const serves = [], leftReturns = [], between = [];
  const psi = { commit: 0, reject: 0, abstain: 0 };
  const eventsPerMatch = [];
  for (const s of seeds) {
    const m = await senseMatch(engine, s);
    serves.push(...m.serves); leftReturns.push(...m.leftReturns); between.push(...m.betweenErrs);
    eventsPerMatch.push(m.events);
    for (const k of Object.keys(psi)) psi[k] += m.psi[k];
  }
  const receipts = await get(engine, 'sense.receipts');
  const head = verifyChain(receipts, (r) => { const { why, row_hash, ...f } = r; return f; });
  // H1: left-bound serves (right-bound serves are abstain events by design — PREREG erratum)
  const lb = serves.filter((x) => x.dir < 0);
  const h1Rate = lb.length ? lb.filter((x) => x.convergedAt !== null && x.convergedAt <= 12).length / lb.length : 0;
  // H1-all reported for transparency (no goalpost): any serve converged within 12 ticks of ANY commit
  const h1All = serves.length ? serves.filter((x) => x.convergedAt !== null && x.convergedAt <= 12).length / serves.length : 0;
  const lrOk = leftReturns.filter((x) => x.done && x.events <= 2);
  const h2Rate = leftReturns.length ? lrOk.length / leftReturns.length : 1;
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const max = (a) => a.reduce((x, y) => (y > x ? y : x), 0);
  return {
    serves: serves.length, leftBoundServes: lb.length, h1: { rate: +h1Rate.toFixed(4), pass: h1Rate >= 0.9, n: lb.length },
    h1_all_serves: +h1All.toFixed(4),
    leftReturns: leftReturns.length, h2: { rate: +h2Rate.toFixed(4), pass: h2Rate === 1, n: leftReturns.length },
    between: { mean_err: +mean(between).toFixed(3), max_err: +max(between).toFixed(3), n: between.length },
    psi, eventsPerMatch: { min: Math.min(...eventsPerMatch), med: eventsPerMatch.sort((a, b) => a - b)[eventsPerMatch.length >> 1], max: Math.max(...eventsPerMatch) },
    rows: receipts.length, head,
  };
};

// ── M2: value A/B (advisory left via sheet-copy ai.track; control = both reactive) ──
const M2 = async (seeds) => {
  const adv = bootSense({ advisory: true });
  let aLeft = 0;
  const modes = { attractor: 0, 'reactive-fallback': 0, 'reactive-law': 0 };
  for (const s of seeds) {
    const m = await senseMatch(adv, s, { probeModes: true });
    if (m.winner === 'left') aLeft++;
    for (const k of Object.keys(modes)) modes[k] += m.modes[k];
  }
  const total = Object.values(modes).reduce((a, b) => a + b, 0);
  return {
    advisory_wr: +(aLeft / seeds.length).toFixed(4), modes,
    advisory_share: total ? +(modes.attractor / total).toFixed(4) : 0,
    fallback_share: total ? +(modes['reactive-fallback'] / total).toFixed(4) : 0,
  };
};

// ── pins (unit-level; a RED here localizes the layer, never silently absorbed) ──
await H.check('sense cells boot and answer (readout null at genesis)', async () => {
  const e = bootSense();
  await e.call('new_game', { seed: 1 });
  const p = (await e.call('sense.predict')).data;
  H.eq(p.y, null);
  H.ok(p.mass === 0, 'ring must start empty');
});

await H.check('sense.project: wall folding is exact (steep-down folds off the floor)', async () => {
  const e = bootSense();
  const r = (await e.call('sense.project', { x: 50, y: 30, vx: -1, vy: -1 })).data;
  // t=48; ball travels 30 -> 1 (29 ticks), folds up 19 more -> y=20.
  // (sheet law: y<1 reflects to 1+(1-y); corridor [1,59], L=58)
  H.eq(r.y_at, 20);
  const away = (await e.call('sense.project', { x: 50, y: 30, vx: 1, vy: 0 })).data;
  H.eq(away.y_at, null);
});

await H.check('commit: fresh-bump readout within discretization bound (half-bin 0.9375)', async () => {
  const e = bootSense();
  await e.call('new_game', { seed: 7 });
  await e.set('ball.x', 60); await e.set('ball.y', 42); await e.set('ball.vx', -0.9); await e.set('ball.vy', 0.3);
  const r = (await e.call('sense.update', { kind: 'wall' })).data;
  H.eq(r.psi, 1);
  const p = (await e.call('sense.predict')).data;
  const o = (await e.call('sense.project', { x: 60, y: 42, vx: -0.9, vy: 0.3 })).data;
  // N=32 bins over a 60-unit field -> bin width 1.875; a single injected bump's
  // circular mean can land at most half a bin from the true target. This pin
  // bounds DISCRETIZATION, not model convergence (that is what H1/H2 measure).
  H.ok(Math.abs(p.y - o.y_at) < 0.94, `readout ${p.y} vs oracle ${o.y_at}`);
});

await H.check('abstain: away ball writes nothing (ring + A unchanged)', async () => {
  const e = bootSense();
  await e.call('new_game', { seed: 7 });
  await e.call('sense.update', { kind: 'wall' });   // commit something first
  const before = await get(e, 'sense.ring');
  const A = (await get(e, 'sense.state')).A;
  await e.set('ball.vx', 0.9);
  const r = (await e.call('sense.update', { kind: 'wall' })).data;
  H.eq(r.psi, 0);
  H.eq(await get(e, 'sense.ring'), before);
});

const t0 = Date.now();

if (process.argv.includes('--diag')) {
  const e = bootSense();
  const m = await senseMatch(e, 1, { trace: true });
  console.log(`seed1: ${m.ticks} ticks, winner=${m.winner}, ${m.trace.length} feeds`);
  for (const t of m.trace.slice(0, 40)) console.log(JSON.stringify(t));
  const serves = m.trace.filter((t) => t.feed.kind === 'serve');
  const walls = m.trace.filter((t) => t.feed.kind === 'wall');
  const lb = serves.filter((t) => t.vx < 0);
  console.log(`serves=${serves.length} leftBound=${lb.length} walls=${walls.length}`);
  console.log('left-bound serve rows:', JSON.stringify(lb.slice(0, 6), null, 1));
  process.exit(0);
}

console.log('\nM1: estimation quality over 50 seeded matches (reactive control game)…');
const m1 = await M1(SEEDS);
console.log(`  H1 capture ${(m1.h1.rate * 100).toFixed(1)}% of ${m1.leftBoundServes} left-bound serves (${m1.serves} serves total, all-serve rate ${(m1.h1_all_serves * 100).toFixed(1)}%), H2 re-capture ${(m1.h2.rate * 100).toFixed(1)}% (${m1.leftReturns} own-returns), between-event mean err ${m1.between.mean_err} (max ${m1.between.max_err}, n ${m1.between.n}), psi ${JSON.stringify(m1.psi)}, events/match ${JSON.stringify(m1.eventsPerMatch)}, ${m1.rows} receipt rows`);

console.log('M2 control (both reactive) over 50 seeds…');
const control = bootSense();
let cLeft = 0;
for (const s of SEEDS) { const m = await senseMatch(control, s); if (m.winner === 'left') cLeft++; }
const control_wr = +(cLeft / SEEDS.length).toFixed(4);
console.log(`  control left win-rate ${(control_wr * 100).toFixed(1)}%`);

console.log('M2 advisory (attractor left, honest fallback) over 50 seeds…');
const m2 = await M2(SEEDS);
console.log(`  advisory left win-rate ${(m2.advisory_wr * 100).toFixed(1)}%, advisory mode share ${(m2.advisory_share * 100).toFixed(1)}%`);

const verdicts = {
  H1: { ...m1.h1, all_serves_rate: m1.h1_all_serves, detail: 'left-bound serves, err<=1.5 within <=12 ticks of the serve; right-bound serves are away-abstains by design (PREREG erratum, FINDINGS)' },
  H2: { ...m1.h2, detail: 're-capture within <=2 events after own-return abstain' },
  H3: { pass: m2.advisory_wr >= control_wr, control_wr, advisory_wr: m2.advisory_wr, detail: 'advisory >= reactive control (non-inferiority)' },
  H4: { pass: m2.advisory_wr >= 0.55, advisory_wr: m2.advisory_wr, detail: 'advisory >= 55%' },
  H5: { pass: m2.advisory_share >= 0.01, advisory_share: m2.advisory_share, fallback_share: m2.fallback_share, detail: 'per-tick mode census via side-effect-inert probe (write overwritten by next arbiter track); game audit log stays pristine' },
};
const allPass = Object.values(verdicts).every((v) => v.pass);

console.log('determinism pin: M1 seeds 1..3 twice…');
const d1 = await M1([1, 2, 3]);
const d2 = await M1([1, 2, 3]);
const determinism = { pass: d1.head === d2.head && JSON.stringify(d1.h1) === JSON.stringify(d2.h1), head3: d1.head };
verdicts.determinism = { pass: determinism.pass, detail: 'M1 seeds 1..3 run twice, chain head + H1 byte-equal' };

const receipt = {
  schema: 'predictive_paddle/v1',
  prereg: 'experiments/predictive_paddle.PREREG.md (commit c3deef2, sealed before run)',
  model: { name: 'flycx-v2-certainty-gated', ported_from: 'SuperInstance/chiaroscuro PR #6 (tools/fly_cx.py)', constants: { bins: N, A0, commit_gain: COMMIT_GAIN, reject_shrink: REJECT_SHRINK, event_decay: EVENT_DECAY, cert_decay: CERT_DECAY } },
  seed: 20261001, matches_per_arm: 50,
  m1: { h1: m1.h1, h1_all_serves: m1.h1_all_serves, h2: m1.h2, between: m1.between, psi: m1.psi, serves: m1.serves, leftBoundServes: m1.leftBoundServes, leftReturns: m1.leftReturns, eventsPerMatch: m1.eventsPerMatch },
  m1_chain: { rows: m1.rows, head: m1.head, verified: true },
  m2: { control_wr, advisory_wr: m2.advisory_wr, modes: m2.modes, advisory_share: m2.advisory_share, fallback_share: m2.fallback_share },
  verdicts,
  overall: allPass ? 'PASS' : 'FAIL',
  wall_ms: Date.now() - t0,
};
writeFileSync(join(HERE, 'predictive_paddle_receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(`\nreceipt: experiments/predictive_paddle_receipt.json — overall ${receipt.overall} (${receipt.wall_ms}ms)`);
console.log(`chain head ${m1.head} (${m1.rows} rows, re-derived from GENESIS)`);

await H.check('H1 capture >= 90% of left-bound serves within <=12 ticks', async () => H.ok(verdicts.H1.pass, JSON.stringify(verdicts.H1)));
await H.check('H2 re-capture within <=2 events after every own-return', async () => H.ok(verdicts.H2.pass, JSON.stringify(verdicts.H2)));
await H.check('H3 advisory >= reactive control (non-inferiority)', async () => H.ok(verdicts.H3.pass, JSON.stringify(verdicts.H3)));
await H.check('H4 advisory win-rate >= 55%', async () => H.ok(verdicts.H4.pass, JSON.stringify(verdicts.H4)));
await H.check('H5 honesty: advisory fired >=1% of ticks, census complete', async () => H.ok(verdicts.H5.pass, JSON.stringify(verdicts.H5)));
await H.check('determinism: M1 seeds 1..3 twice -> identical chain head', async () => H.ok(determinism.pass, JSON.stringify(determinism)));

await H.done();
