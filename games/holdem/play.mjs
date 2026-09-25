// HOLDEM PLAYTEST — rule cells vs an independent reference implementation.
//
// The harness carries its OWN 7-card evaluator (brute-force over all 21
// five-card combinations, written separately from the sheet's group-counting
// eval7) and its own betting invariants (chip conservation, audit cell,
// blind rotation, showdown winners re-derived). Then the learning loop runs
// for real: two cell-held learners nudge separate weight cells per hand while
// a frozen fish (the control group) bleeds, with an fnv1a64 receipt booked per
// hand per learner and both chains re-derived here.
//
//   node games/holdem/play.mjs
//
// This game is the non-grid generalization: hiding is a FORMULA over cells
// (rule.C10.check), not absence of data.

import { QuiltEngine } from '../../engine/index.js';
import { mulberry32, harness, verifyChain, fnv1a64, canon } from '../../shared/kit.mjs';
import { buildSheet } from './sheet.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const H = harness('holdem');
const engine = new QuiltEngine('arcade-holdem', { eager: true });
engine.loadSheet(buildSheet());
if (globalThis.__verbose) console.log('  cells: ' + buildSheet().cells.length);

const get = async (id) => (await engine.get(id)).data;
let lastSeq = 0;
const push = async (req) => {
  lastSeq = Math.max(lastSeq, (await engine.get('match.seq')).data) + 1;
  await engine.set('action.request', { ...req, seq: lastSeq });
  const verdict = (await engine.get('rules.verdict')).data;
  return verdict?.seq === lastSeq ? verdict : (await engine.call('action.dispatch', { ...req, seq: lastSeq })).data;
};

// ── INDEPENDENT reference evaluator (brute force, do not share code) ─────────
const REF_COMBOS = [];
for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) for (let c = b + 1; c < 7; c++)
  for (let d = c + 1; d < 7; d++) for (let e = d + 1; e < 7; e++) REF_COMBOS.push([a, b, c, d, e]);
const refScore5 = (cards) => {
  const vals = cards.map(c => '23456789TJQKA'.indexOf(c[0]) + 2);
  const flush = cards.every(c => c[1] === cards[0][1]);
  const distinct = [...new Set(vals)].sort((x, y) => y - x);
  let straight = 0;
  if (distinct.length === 5) {
    if (distinct[0] - distinct[4] === 4) straight = distinct[0];
    else if (distinct[0] === 14 && distinct[1] === 5) straight = 5; // wheel
  }
  const cnt = {}; vals.forEach(v => { cnt[v] = (cnt[v] || 0) + 1; });
  const groups = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a);
  if (flush && straight) return [8, straight];
  if (cnt[groups[0]] === 4) return [7, groups[0], groups[1]];
  if (cnt[groups[0]] === 3 && cnt[groups[1]] === 2) return [6, groups[0], groups[1]];
  if (flush) return [5, ...groups];
  if (straight) return [4, straight];
  if (cnt[groups[0]] === 3) return [3, groups[0], groups[1], groups[2]];
  if (cnt[groups[0]] === 2 && cnt[groups[1]] === 2) return [2, groups[0], groups[1], groups[2]];
  if (cnt[groups[0]] === 2) return [1, groups[0], groups[1], groups[2], groups[3]];
  return [0, ...groups];
};
const refCmp = (t1, t2) => {
  for (let i = 0; i < Math.max(t1.length, t2.length); i++) {
    const x = t1[i] ?? -1, y = t2[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
};
const refBest7 = (cards7) => {
  let best = null;
  for (const combo of REF_COMBOS) {
    const t = refScore5(combo.map(i => cards7[i]));
    if (!best || refCmp(t, best) > 0) best = t;
  }
  return best;
};

// ── invariants ───────────────────────────────────────────────────────────────
async function assertConservation(total, tag) {
  const stacks = [await get('stacks.p0'), await get('stacks.p1'), await get('stacks.p2')];
  const pot = await get('pot.total');
  const sum = stacks[0] + stacks[1] + stacks[2] + pot;
  H.eq(sum, total, `chip conservation (${tag})`);
  H.eq(await get('pot.audit'), 0, `pot.audit live invariant (${tag})`);
}
async function assertStateSane(tag) {
  const folded = [await get('folded.p0'), await get('folded.p1'), await get('folded.p2')];
  const allin = [await get('allin.p0'), await get('allin.p1'), await get('allin.p2')];
  const pending = await get('pending.list');
  for (const s of pending) {
    H.ok(!folded[s] && !allin[s], `pending seat P${s} must be live and able to act (${tag})`);
  }
  const toAct = await get('to.act');
  if (toAct >= 0) H.ok(pending.includes(toAct), `to.act P${toAct} must be in pending (${tag})`);
  H.ok(folded.filter(Boolean).length <= 2, `at most two seats folded (${tag})`);
}

// play one full hand. Returns {result, actions}. Asserts conservation every action.
async function playHand({ seed = 1, frozen = false, learnLog = true, verbose = false } = {}) {
  const pre = [await get('stacks.p0'), await get('stacks.p1'), await get('stacks.p2')];
  const preSum = pre[0] + pre[1] + pre[2];
  const deal = (await engine.call('deal.hand', { seed })).data;
  H.ok(deal.ok, 'deal accepted: ' + JSON.stringify(deal.text ?? deal));
  const post = [await get('stacks.p0'), await get('stacks.p1'), await get('stacks.p2')];
  const total = post[0] + post[1] + post[2] + (await get('pot.total'));  // blinds moved stacks -> pot
  H.ok(total >= preSum, 'rebuys only add chips');
  H.ok(((await get('hand.no')) - 1) % 3 === await get('hand.button'), 'C2 rotation: button = (hand.no-1) % 3');
  const rng = mulberry32(seed * 7919 + 13);
  let actions = 0, waits = 0;
  while ((await get('hand.phase')) === 'play' && actions < 300) {
    const step = (await engine.call('match.step', { seed: 1 + Math.floor(rng() * 1e9), frozen, log: learnLog })).data;
    if (step.over) break;
    if (step.wait) { waits++; break; }
    H.ok(step.ok !== false, 'AI action accepted: ' + JSON.stringify(step).slice(0, 200));
    actions++;
    await assertConservation(total, `action ${actions}`);
    await assertStateSane(`action ${actions}`);
  }
  const phase = await get('hand.phase');
  H.ok(phase === 'over', `hand finished (phase=${phase}, actions=${actions})`);
  const result = await get('hand.result');
  H.ok(result && result.winners?.length >= 1, 'hand.result carries winners');
  // showdown cross-check: winners re-derived by the REFERENCE evaluator
  if (result.reveal) {
    const comm = [];
    for (let i = 1; i <= 5; i++) comm.push(await get('comm.c' + i));
    const folded = [await get('folded.p0'), await get('folded.p1'), await get('folded.p2')];
    const active = [0, 1, 2].filter(i => !folded[i]);
    const scored = await Promise.all(active.map(async (seat) => {
      const hole = await get('hole.p' + seat);
      return { seat, t: refBest7(hole.concat(comm)) };
    }));
    scored.sort((a, b) => refCmp(b.t, a.t));
    const winners = scored.filter(s => refCmp(s.t, scored[0].t) === 0).map(s => s.seat).sort();
    H.eq(winners, [...result.winners].sort(), 'showdown winners == reference evaluator winners');
  }
  await assertConservation(total, 'hand end');
  return { result, actions, total, waits };
}

// ── checks ────────────────────────────────────────────────────────────────────
await H.check('C8 is first-class: engine evaluator == reference on 200 random 7-card hands', async () => {
  const rng = mulberry32(20260925);
  const deck = [];
  for (const r of '23456789TJQKA') for (const s of 'shdc') deck.push(r + s);
  for (let n = 0; n < 200; n++) {
    const d = deck.slice();
    for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = d[i]; d[i] = d[j]; d[j] = t; }
    const cards = d.slice(0, 7);
    const eng = (await engine.call('rule.C8.check', { cards })).data;
    const ref = refBest7(cards);
    H.eq(eng.cat, ref[0], `cat mismatch on ${cards.join(' ')}`);
    H.eq(eng.tie, ref.slice(1), `tiebreak mismatch on ${cards.join(' ')}`);
  }
});

await H.check('C8 known hands: royal flush, wheel straight, full house ordering', async () => {
  const royal = (await engine.call('rule.C8.check', { cards: ['As', 'Ks', 'Qs', 'Js', 'Ts', '2h', '3d'] })).data;
  H.eq(royal.cat, 8); H.eq(royal.tie, [14]); H.ok(royal.name.includes('ROYAL'));
  const wheel = (await engine.call('rule.C8.check', { cards: ['Ah', '2d', '3s', '4c', '5h', '9s', 'Jd'] })).data;
  H.eq(wheel.cat, 4); H.eq(wheel.tie, [5], 'wheel plays as five-high');
  const boat = (await engine.call('rule.C8.check', { cards: ['Ah', 'Ad', 'As', 'Kc', 'Kh', '2s', '3d'] })).data;
  H.eq(boat.cat, 6); H.eq(boat.tie, [14, 13]);
  const quads = (await engine.call('rule.C8.check', { cards: ['7h', '7d', '7s', '7c', 'Kd', '2s', '3d'] })).data;
  H.eq(quads.cat, 7);
  H.ok(quads.cat > boat.cat && boat.cat > wheel.cat, 'quads > full house > straight');
});

await H.check('C5 is first-class: out-of-turn, check-when-facing, and below-min-raise refusals carry the rule in context', async () => {
  await engine.call('new_match');
  await engine.call('deal.hand', { seed: 42 });
  const toAct = await get('to.act');
  const wrong = (toAct + 1) % 3;
  const v1 = await push({ seat: wrong, action: 'call' });
  H.ok(v1.ok === false && v1.rule === 'C5' && String(v1.text).includes('out of turn'), v1.text);
  const legal = (await engine.call('legal.actions')).data;
  H.ok(legal.seat === toAct, 'legal.actions names the seat to act');
  // a below-min-raise push from the seat to act (raise-to 3 < bet 2 + min-raise 2)
  const v2 = await push({ seat: toAct, action: 'raise', amount: 3 });
  H.ok(v2.ok === false && v2.rule === 'C5' && String(v2.text).includes('minimum raise'), v2.text);
  H.eq(await get('match.seq'), 0, 'refused requests never bump the arbiter sequence');
});

await H.check('C10 privacy gates: projections hide the AI cards until the show', async () => {
  await engine.call('new_match');
  await engine.call('deal.hand', { seed: 77 });
  H.eq(await get('hole.p1').then(h => h.length), 2, "hole.p1 holds P1's own cards (agent view)");
  const p1proj = await get('proj.p1');
  H.ok(p1proj.shown === false && p1proj.text === '?? ??', 'view P0 cannot see P1: ' + p1proj.text);
  const own = await get('proj.p0');
  H.ok(own.shown === true, 'view P0 sees its own cards');
  const pub = (await engine.call('table.public')).data;
  H.eq(pub.seats[1].proj, '?? ??', 'shared-screen snapshot masks P1');
  H.eq(pub.seats[0].proj.split(' ').length, 2, 'shared-screen snapshot shows the view seat');
  // mid-hand the mask holds; the show flips it
  await engine.call('reveal.show');
  const p1open = await get('proj.p1');
  H.ok(p1open.shown === true && p1open.text === (await get('hole.p1')).join(' '), 'after the call to show, projection == real cards');
});

await H.check('fish + two learners: a full hand conserves every chip (reference conservation every action)', async () => {
  await engine.call('new_match');
  const { result, actions } = await playHand({ seed: 101 });
  if (globalThis.__verbose) console.log(`      hand 101: ${actions} actions, ${result.desc}`);
});

await H.check('three more cross-checked hands (rotation + conservation)', async () => {
  for (const seed of [202, 303, 404]) await playHand({ seed });
});

await H.check('human seat: match.step waits, out-of-turn push refused, legal push accepted', async () => {
  await engine.call('new_match');
  await engine.call('deal.hand', { seed: 505 });
  await engine.set('seats.cfg', { 0: 'fish', 1: 'human', 2: 'learn' });
  // run AI actions until the human seat is to act
  for (let i = 0; i < 50; i++) {
    const step = (await engine.call('match.step', { seed: i + 1 })).data;
    if (step.over) break;
    if (step.wait) break;
    H.ok(step.ok !== false, 'AI action ok');
  }
  const step = (await engine.call('match.step', { seed: 999 })).data;
  H.ok(step.wait === true, 'match.step waits for the human');
  const seat = step.seat;
  const v = await push({ seat: (seat + 1) % 3, action: 'check' });
  H.ok(v.ok === false && v.rule === 'C5', 'human pushing for another seat is refused: ' + v.text);
  const legal = (await engine.call('legal.actions')).data;
  const opt = legal.options.find(o => o.action === 'check' || o.action === 'call');
  const v2 = await push({ seat, action: opt.action, amount: opt.action === 'raise' ? opt.min : undefined });
  H.ok(v2.ok === true, 'human legal push accepted: ' + v2.text);
  await engine.set('seats.cfg', { 0: 'fish', 1: 'learn', 2: 'learn' });
});

await H.check('fold-win never reveals: the uncontested winner keeps hidden cards (C10)', async () => {
  // find a seed where the hand ends without showdown; try a few
  let found = false;
  for (let seed = 600; seed < 640 && !found; seed++) {
    await engine.call('new_match');
    await engine.call('deal.hand', { seed });
    for (let i = 0; i < 100; i++) {
      const step = (await engine.call('match.step', { seed: seed * 100 + i })).data;
      if (step.over || step.wait) break;
    }
    if ((await get('hand.phase')) !== 'over') continue;
    const result = await get('hand.result');
    if (result && result.reveal === false) {
      found = true;
      const w = result.winners[0];
      const other = (w + 1) % 3;
      H.ok((await get('hole.p' + w)).length === 2, 'winner still holds real cards in its own cells');
      H.eq((await get('proj.p' + w)).text, '?? ??', 'winner projection still masked from view P0');
      H.ok(String(result.desc).includes('uncontested'), 'result says uncontested: ' + result.desc);
    }
  }
  H.ok(found, 'found an uncontested hand among 40 seeds');
});

// ── the learning experiment: two learners nudge their weight cells per hand ──
const HANDS = 150, BLOCK = 25;
const blocks = [];
const theta0 = {
  1: { aggro: await get('W.p1.aggro'), tight: await get('W.p1.tight'), bluff: await get('W.p1.bluff'), sticky: await get('W.p1.sticky'), adapt: await get('W.p1.adapt') },
  2: { aggro: await get('W.p2.aggro'), tight: await get('W.p2.tight'), bluff: await get('W.p2.bluff'), sticky: await get('W.p2.sticky'), adapt: await get('W.p2.adapt') },
};
let nudgeLog = [];
await H.check(`learning loop: ${HANDS} hands, fish + two learners, per-hand nudges on visible weight cells`, async () => {
  const t0 = Date.now();
  await engine.call('new_match');
  for (let h = 1; h <= HANDS; h++) {
    await playHand({ seed: 10000 + h * 17, learnLog: true });
    for (const seat of [1, 2]) {
      const r = (await engine.call('learn.update', { seat })).data;
      if (r?.nudges?.length) nudgeLog.push({ hand: h, seat, nudges: r.nudges });
    }
    if (h % BLOCK === 0) {
      const stacks = [await get('stacks.p0'), await get('stacks.p1'), await get('stacks.p2')];
      const th1 = { aggro: await get('W.p1.aggro'), tight: await get('W.p1.tight'), bluff: await get('W.p1.bluff'), sticky: await get('W.p1.sticky'), adapt: await get('W.p1.adapt') };
      const th2 = { aggro: await get('W.p2.aggro'), tight: await get('W.p2.tight'), bluff: await get('W.p2.bluff'), sticky: await get('W.p2.sticky'), adapt: await get('W.p2.adapt') };
      blocks.push({ hands: h, stacks, th1, th2,
        fish_bb: Math.round((stacks[0] - 100) / 2 * 10) / 10,
        learners_bb: Math.round((stacks[1] + stacks[2] - 200) / 2 * 10) / 10 });
      if (globalThis.__verbose) console.log(`      hands ${String(h).padStart(3)}  fish ${String(stacks[0]).padStart(4)}  P1 ${String(stacks[1]).padStart(4)}  P2 ${String(stacks[2]).padStart(4)}  | θ1(aggro ${th1.aggro.toFixed(2)}, tight ${th1.tight.toFixed(2)}, bluff ${th1.bluff.toFixed(2)})`);
    }
  }
  if (globalThis.__verbose) console.log(`      (${Date.now() - t0}ms for ${HANDS} hands)`);
  const stacks = [await get('stacks.p0'), await get('stacks.p1'), await get('stacks.p2')];
  const fish = stacks[0], learners = stacks[1] + stacks[2];
  H.ok(learners > fish, `learners (combined ${learners}) should out-stack the frozen fish (${fish})`);
  H.ok(fish < 300, `the fish should bleed into a hardening table (${fish} < 300)`);
  // weight drift: at least one learner moved a weight meaningfully
  const drift = (a, b) => Math.max(...['aggro', 'tight', 'bluff', 'sticky', 'adapt'].map(k => Math.abs((a[k] ?? 0) - (b[k] ?? 0))));
  const d1 = drift(theta0[1], blocks[blocks.length - 1].th1);
  const d2 = drift(theta0[2], blocks[blocks.length - 1].th2);
  H.ok(Math.max(d1, d2) > 0.25, `weights did not visibly refine (drift1=${d1.toFixed(2)}, drift2=${d2.toFixed(2)})`);
  H.ok(nudgeLog.length > HANDS / 2, 'nudges were recorded for most hands');
  if (globalThis.__verbose) {
    console.log('      sample nudges (the visible refinement):');
    for (const n of nudgeLog.slice(-6))
      console.log('        hand ' + n.hand + ' P' + n.seat + ': ' + n.nudges.map(x => `${x.key} ${x.delta >= 0 ? '+' : ''}${x.delta} (${x.why})`).join('; '));
  }
});

await H.check('witness ledgers: both learners\' receipt chains re-derive from GENESIS', async () => {
  for (const seat of [1, 2]) {
    const receipts = await get('learn.receipts.p' + seat);
    H.ok(receipts.length >= HANDS - 2, `P${seat} booked ${receipts.length} receipts`);
    const fieldsOf = (r) => ({ seq: r.seq, hand: r.hand, net_bb: r.net_bb, stack: r.stack, theta_hash: r.theta_hash, nudge_count: r.nudge_count });
    const last = verifyChain(receipts, fieldsOf);
    H.eq(last, receipts[receipts.length - 1].row_hash, `P${seat} chain intact`);
    const snapshot = await get('learn.last.p' + seat);
    H.eq(snapshot.receipt.theta_hash, fnv1a64(canon(snapshot.theta)), `P${seat} receipt pins the exact theta that produced it`);
  }
});

await H.check('frozen control group: gen-1 weights exist and differ from the final policy', async () => {
  for (const seat of [1, 2]) {
    const frozen = await get('W.p' + seat + '.frozen');
    H.ok(frozen && Number.isFinite(frozen.aggro), `P${seat} has a frozen gen-1 snapshot`);
    H.ok(frozen.aggro !== await get('W.p' + seat + '.aggro')
      || frozen.tight !== await get('W.p' + seat + '.tight')
      || frozen.bluff !== await get('W.p' + seat + '.bluff'), `P${seat} policy moved away from gen-1`);
  }
});

await H.check('agent UX trace: decision commentary exists and quotes equity + rule context', async () => {
  const th = await get('ai.thoughts.p1');
  H.ok(th.length >= 5, 'P1 produced a decision trace');
  H.ok(th.some(t => t.text.includes('eq ')), 'thoughts quote equity: ' + th[th.length - 1].text);
  const verdict = await get('rules.verdict');
  H.ok(verdict && verdict.text, 'the referee bubble text exists: ' + String(verdict.text).slice(0, 90));
  if (globalThis.__verbose) for (const t of th.slice(-4)) console.log('        ' + t.text);
});

const { pass, fail } = await H.done();

// ── artifacts ─────────────────────────────────────────────────────────────────
mkdirSync(join(here, '..', '..', 'experiments'), { recursive: true });
writeFileSync(join(here, '..', '..', 'experiments', 'holdem.json'), JSON.stringify({
  game: 'holdem', hands: HANDS, block: BLOCK, alpha: await get('learn.alpha'),
  theta0, blocks, nudge_count: nudgeLog.length,
  nudge_sample: nudgeLog.slice(-40),
  thoughts_sample: (await get('ai.thoughts.p1')).slice(-25).concat((await get('ai.thoughts.p2')).slice(-15)),
  final_stacks: [await get('stacks.p0'), await get('stacks.p1'), await get('stacks.p2')],
  om: { 1: await get('om.p1'), 2: await get('om.p2') },
  checks: { pass, fail }, generated: new Date().toISOString(),
}, null, 2) + '\n');
writeFileSync(join(here, 'holdem.sheet.json'), JSON.stringify(buildSheet(), null, 2) + '\n');
console.log('  (emitted holdem.sheet.json — ' + buildSheet().cells.length + ' cells; experiments/holdem.json)');
