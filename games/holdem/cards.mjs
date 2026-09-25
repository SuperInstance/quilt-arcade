// HOLDEM cards.mjs — inline code templates for the hold'em sheet.
//
// Program cells run in a new-Function scope: helpers must be inlined (the E8
// lesson). These templates are interpolated into program cells at SHEET BUILD
// TIME so there is a single source of truth. No backticks inside the code
// strings — everything is string concatenation.

import { SNIPPETS } from '../../shared/kit.mjs';

// ── the hand evaluator (single source: C7, C8, ai.equity all interpolate it) ─
export const HE = `
const RANK_CH = '23456789TJQKA';
const RANK_NAME = {2:'deuce',3:'trey',4:'four',5:'five',6:'six',7:'seven',8:'eight',9:'nine',10:'ten',11:'jack',12:'queen',13:'king',14:'ace'};
const rnk = (c) => RANK_CH.indexOf(c[0]) + 2;
const straightHigh = (list) => {
  const uq = [...new Set(list)].sort((a, b) => b - a);
  if (uq.includes(14)) uq.push(1);
  let run = 1;
  for (let i = 1; i < uq.length; i++) {
    run = (uq[i] === uq[i - 1] - 1) ? run + 1 : 1;
    if (run === 5) return uq[i] + 4;
  }
  return 0;
};
const eval7 = (cards) => {
  const vals = cards.map(c => rnk(c));
  const cnt = {}; for (const v of vals) cnt[v] = (cnt[v] || 0) + 1;
  const groups = Object.keys(cnt).map(Number).sort((a, b) => cnt[b] - cnt[a] || b - a);
  const suitCnt = {}; for (const c of cards) suitCnt[c[1]] = (suitCnt[c[1]] || 0) + 1;
  const fs = Object.keys(suitCnt).find(s => suitCnt[s] >= 5);
  if (fs) {
    const fv = cards.filter(c => c[1] === fs).map(c => rnk(c));
    const sh = straightHigh(fv);
    if (sh) return { cat: 8, tie: [sh], name: (sh === 14 ? 'ROYAL FLUSH' : 'straight flush, ' + RANK_NAME[sh] + ' high') };
  }
  if (cnt[groups[0]] === 4) return { cat: 7, tie: [groups[0], groups[1]], name: 'quad ' + RANK_NAME[groups[0]] + 's' };
  if (cnt[groups[0]] === 3 && cnt[groups[1]] >= 2)
    return { cat: 6, tie: [groups[0], groups[1]], name: 'full house, ' + RANK_NAME[groups[0]] + 's over ' + RANK_NAME[groups[1]] + 's' };
  if (fs) {
    const fv = cards.filter(c => c[1] === fs).map(c => rnk(c)).sort((a, b) => b - a).slice(0, 5);
    return { cat: 5, tie: fv, name: 'flush, ' + RANK_NAME[fv[0]] + ' high' };
  }
  const sh = straightHigh(vals);
  if (sh) return { cat: 4, tie: [sh], name: 'straight, ' + RANK_NAME[sh] + ' high' };
  if (cnt[groups[0]] === 3) return { cat: 3, tie: [groups[0], groups[1], groups[2]], name: 'trip ' + RANK_NAME[groups[0]] + 's' };
  if (cnt[groups[0]] === 2 && cnt[groups[1]] === 2) {
    // three-pair boards: play the two highest pairs; kicker = best remaining rank
    const p1 = groups[0], p2 = groups[1];
    const kick = Math.max(...Object.keys(cnt).map(Number).filter(r => r !== p1 && r !== p2));
    return { cat: 2, tie: [p1, p2, kick], name: 'two pair, ' + RANK_NAME[p1] + 's and ' + RANK_NAME[p2] + 's' };
  }
  if (cnt[groups[0]] === 2)
    return { cat: 1, tie: [groups[0], groups[1], groups[2], groups[3]], name: 'pair of ' + RANK_NAME[groups[0]] + 's' };
  const hi = [...new Set(vals)].sort((a, b) => b - a).slice(0, 5);
  return { cat: 0, tie: hi, name: 'high card ' + RANK_NAME[hi[0]] };
};
const cmpHands = (a, b) => {
  if (a.cat !== b.cat) return a.cat - b.cat;
  for (let i = 0; i < Math.max(a.tie.length, b.tie.length); i++) {
    const x = a.tie[i] ?? 0, y = b.tie[i] ?? 0;
    if (x !== y) return x - y;
  }
  return 0;
};`;

// ── the learner policy (one cell serves any seat: weights come from cells) ───
export const DECIDER = `
// LEARNER POLICY — equity rollout x weight cells x opponent model.
// input {seat, seed, frozen?, log?}. Weights W.p<seat>.* are separate value
// cells: the learning loop nudges them, and you can watch them drift.
const g = async (id) => (await runtime.get(id)).data;
const f2 = (x) => Number(x).toFixed(2);
const seat = input?.seat;
if (seat == null) return { skip: true, why: 'ai.decide needs input.seat' };
const phase = await g('hand.phase');
if (phase !== 'play') return { skip: true, why: 'no live hand' };
if ((await g('to.act')) !== seat) return { skip: true, why: 'not my turn (to.act = P' + (await g('to.act')) + ')' };
const bb = await g('bb.size');
const bets = [await g('bets.p0'), await g('bets.p1'), await g('bets.p2')];
const stacks = [await g('stacks.p0'), await g('stacks.p1'), await g('stacks.p2')];
const pot = await g('pot.total');
const maxBet = Math.max(...bets);
const toCall = maxBet - bets[seat];
const stack = stacks[seat];
const street = await g('street.current');
const streetIdx = ({ preflop: 0, flop: 1, turn: 2, river: 3 })[street] ?? 0;
const eqOut = (await runtime.call('ai.equity', { seat, trials: 60, seed: (input?.seed ?? 1) * 31 + streetIdx })).data;
const equity = eqOut.equity;
const frozen = input?.frozen ? (await g('W.p' + seat + '.frozen')) : null;
const pick = async (k) => frozen ? (frozen[k] ?? 0) : (await g('W.p' + seat + '.' + k));
const aggro = await pick('aggro');
const tight = await pick('tight');
const bluff = await pick('bluff');
const sticky = await pick('sticky');
const adapt = await pick('adapt');
const om = await g('om.p' + seat);
const oppAggro = om?.opp_aggro ?? 0.7, oppSticky = om?.opp_sticky ?? 0.7;
${SNIPPETS.rng}
const handNo = await g('hand.no');
const rnd = rng((((input?.seed ?? 1) * 7919 + handNo * 104729 + streetIdx * 7) >>> 0));
let action = 'check', amount = 0, why = '';
if (toCall <= 0) {
  const valThresh = 0.5 + tight * 0.06 - aggro * 0.02;
  let pBet = equity > valThresh ? (0.22 + aggro * 0.2) : (streetIdx > 0 ? bluff * 0.16 : 0.03);
  if (oppSticky > 1.1) pBet *= (equity > 0.62 ? 1.25 : 0.5);   // exploit a station: value more, bluff less
  if (oppSticky < 0.55) pBet *= 1.3;                            // exploit a folder: fire more
  const r = rnd();
  if (r < pBet) {
    const size = Math.max(bb, Math.round(pot * (0.45 + 0.2 * Math.min(aggro, 1.5))));
    action = 'raise'; amount = maxBet + size;
    why = 'eq ' + f2(equity) + ' vs value line ' + f2(valThresh) + ' -> bet ' + size + ' (aggro ' + f2(aggro) + ', roll ' + f2(r) + ' < ' + f2(pBet) + ')' + (frozen ? ' [frozen]' : '');
  } else {
    why = 'eq ' + f2(equity) + ', checks (roll ' + f2(r) + ' >= p(bet) ' + f2(pBet) + ')' + (frozen ? ' [frozen]' : '');
  }
} else {
  const req = toCall / (pot + toCall);
  const callLine = req * (1 + sticky * 0.3) - adapt * 0.02 * Math.min(oppAggro, 2);
  const raiseLine = 0.66 - aggro * 0.05;
  const r = rnd();
  const lastRaise = await g('last.raise');
  if (equity > raiseLine && stack > toCall) {
    const size = Math.max(lastRaise, Math.round(pot * 0.7));
    action = 'raise'; amount = maxBet + size;
    why = 'eq ' + f2(equity) + ' > raise line ' + f2(raiseLine) + ' -> raise to ' + amount;
  } else if (equity >= callLine) {
    action = 'call';
    why = 'eq ' + f2(equity) + ' >= needed ' + f2(callLine) + ' (pot odds ' + f2(req) + ', sticky ' + f2(sticky) + ') -> call ' + toCall;
  } else if (streetIdx >= 2 && oppSticky < 0.9 && r < bluff * 0.12 && stack > toCall) {
    const size = Math.max(lastRaise, Math.round(pot * 0.8));
    action = 'raise'; amount = maxBet + size;
    why = 'eq ' + f2(equity) + ' weak, but opp folds (om.sticky ' + f2(oppSticky) + ') -> bluff-raise to ' + amount + ' (roll ' + f2(r) + ')';
  } else {
    action = 'fold';
    why = 'eq ' + f2(equity) + ' < needed ' + f2(callLine) + ' -> fold ' + toCall;
  }
}
if (input?.log !== false && !frozen) {
  const hlog = await g('hand.log.p' + seat);
  await runtime.set('hand.log.p' + seat, [...hlog, { street, equity, action, toCall, pot }]);
  const th = await g('ai.thoughts.p' + seat);
  await runtime.set('ai.thoughts.p' + seat, [...th.slice(-59), {
    hand: handNo, street, seat,
    text: 'P' + seat + ' [' + street + '] eq ' + f2(equity) + ', pot ' + pot + (toCall > 0 ? ', facing ' + toCall : '') + ' -> ' + action.toUpperCase() + (amount ? ' ' + amount : '') + ' | ' + why }]);
}
const seq = (await g('match.seq')) + 1;
return (await runtime.call('action.arbiter', { seat, action, amount, seq, thought: why })).data;`;

// ── the fish (control group): fixed call-station, never learns, never raises ─
export const FISH = `
// FISH POLICY (control group) — calls small bets, folds big ones, never raises.
// No equity rollout, no weights: deliberately beatable and frozen forever.
const g = async (id) => (await runtime.get(id)).data;
const seat = input?.seat;
if (seat == null) return { skip: true, why: 'fish.decide needs input.seat' };
const phase = await g('hand.phase');
if (phase !== 'play') return { skip: true, why: 'no live hand' };
if ((await g('to.act')) !== seat) return { skip: true, why: 'not my turn (to.act = P' + (await g('to.act')) + ')' };
const bb = await g('bb.size');
const bets = [await g('bets.p0'), await g('bets.p1'), await g('bets.p2')];
const maxBet = Math.max(...bets);
const toCall = maxBet - bets[seat];
let action, amount = 0, why;
if (toCall <= 0) { action = 'check'; why = 'fish checks (free card)'; }
else if (toCall <= bb * 2) { action = 'call'; why = 'fish calls ' + toCall + ' (small bet, always curious)'; }
else { action = 'fold'; why = 'fish folds to ' + toCall + ' (too rich for the station)'; }
const th = await g('ai.thoughts.p' + seat);
await runtime.set('ai.thoughts.p' + seat, [...th.slice(-59), {
  hand: await g('hand.no'), street: await g('street.current'), seat,
  text: 'P' + seat + ' [fish] -> ' + action.toUpperCase() + ' | ' + why }]);
const seq = (await g('match.seq')) + 1;
return (await runtime.call('action.arbiter', { seat, action, amount, seq, thought: why })).data;`;

// ── the learning loop: per-hand nudges + witness receipts ────────────────────
export const LEARNER = `
// LEARN.UPDATE — hand-level credit nudges on separate weight cells.
// input {seat}. Net chips since the last call = the outcome signal; every
// nudge carries a human-readable reason (the visible refinement).
const g = async (id) => (await runtime.get(id)).data;
${SNIPPETS.witness}
const f2 = (x) => Number(x).toFixed(2);
const seat = input?.seat;
if (seat == null) return { skip: true, why: 'learn.update needs input.seat' };
const bb = await g('bb.size');
const alpha = await g('learn.alpha');
const stack = await g('stacks.p' + seat);
const lastStack = await g('learn.last_stack.p' + seat);
if (lastStack == null) {
  await runtime.set('learn.last_stack.p' + seat, stack);
  return { baseline: true, seat, stack };
}
const net = stack - lastStack;
const netBB = Math.round((net / bb) * 10) / 10;
const s = Math.max(-1, Math.min(1, net / (bb * 10)));
const keys = ['aggro', 'tight', 'bluff', 'sticky', 'adapt'];
const theta = {};
for (const k of keys) theta[k] = await g('W.p' + seat + '.' + k);
const frozen = await g('W.p' + seat + '.frozen');
if (!frozen || !frozen.aggro) await runtime.set('W.p' + seat + '.frozen', { ...theta });  // gen-1 snapshot
const decisions = await g('hand.log.p' + seat);
const nudges = [];
const bump = (k, d, why) => { theta[k] = theta[k] + d; nudges.push({ key: k, delta: Math.round(d * 1000) / 1000, why }); };
for (const d of decisions) {
  if (d.action === 'raise' && s > 0) bump('aggro', alpha * s * 0.6, d.street + ' raise paid off (hand net ' + netBB + 'bb)');
  if (d.action === 'raise' && s < 0 && d.equity < 0.45) bump('tight', alpha * Math.abs(s) * 0.3, d.street + ' aggression unpaid (hand net ' + netBB + 'bb) -> value tighter');
  if (d.action === 'call' && s < 0 && d.equity < 0.4) {
    bump('sticky', -alpha * Math.abs(s) * 0.4, d.street + ' chase lost -> call less');
    bump('tight', alpha * Math.abs(s) * 0.2, 'loose call taxed');
  }
  if (d.action === 'fold' && d.equity > 0.62) bump('tight', -alpha * (d.equity - 0.6), 'folded ' + f2(d.equity) + ' equity — hindsight says too tight');
  if (d.action === 'call' && s > 0 && d.equity > 0.6) bump('sticky', alpha * 0.25, 'big hand paid off calling down');
}
const CLAMP = { aggro: [0.15, 2.5], tight: [-1, 1.5], bluff: [0, 1.2], sticky: [-1, 1.5], adapt: [0, 1.5] };
for (const k of keys) theta[k] = Math.max(CLAMP[k][0], Math.min(CLAMP[k][1], Math.round(theta[k] * 1000) / 1000));
for (const k of keys) await runtime.set('W.p' + seat + '.' + k, theta[k]);
// opponent model: this hand's ledger, EMA'd
const handNo = await g('hand.no');
const events = await g('log.events');
const acts = events.filter(e => e.kind === 'act' && e.hand === handNo && e.seat !== seat);
const oppRaises = acts.filter(e => e.action === 'raise').length;
const oppCalls = acts.filter(e => e.action === 'call').length;
const streetsSeen = new Set(acts.map(e => e.street)).size || 1;
const om = await g('om.p' + seat);
const om2 = {
  opp_aggro: Math.round((om.opp_aggro * 0.8 + 0.2 * Math.min(2, oppRaises / streetsSeen)) * 1000) / 1000,
  opp_sticky: Math.round((om.opp_sticky * 0.8 + 0.2 * Math.min(2, oppCalls / streetsSeen)) * 1000) / 1000,
  samples: (om?.samples ?? 0) + 1,
};
await runtime.set('om.p' + seat, om2);
await runtime.set('learn.last_stack.p' + seat, stack);
const gen = (await g('learn.gen.p' + seat)) + 1;
await runtime.set('learn.gen.p' + seat, gen);
const receipts = await g('learn.receipts.p' + seat);
const prev = receipts.length ? receipts[receipts.length - 1].row_hash : GENESIS_PREV;
const fields = { seq: gen, hand: handNo, net_bb: netBB, stack,
  theta_hash: fnv1a64(canon(theta)), nudge_count: nudges.length };
const row = { ...fields, prev_hash: prev, row_hash: fnv1a64(canon({ ...fields, prev_hash: prev })) };
await runtime.set('learn.receipts.p' + seat, [...receipts, row]);
await runtime.set('hand.log.p' + seat, []);
await runtime.set('learn.last.p' + seat, { gen, theta, nudges, om: om2, receipt: row });
return { gen, seat, net_bb: netBB, nudges, theta, om: om2, receipt: row };`;

// ── hole-card projection: "the UI turns off the projection of the AI cards ───
//    until a call to show at the end of the round; from the agent's view the
//    cells link to the cards that are theirs."
export const makeProj = (seat) => `
// PROJECTION for seat ${seat} — the privacy policy is rule.C10.check, shared.
const hole = (await runtime.get('hole.p${seat}')).data ?? [];
const view = (await runtime.get('view.seat')).data;
const reveal = (await runtime.get('reveal.state')).data;
const folded = (await runtime.get('folded.p${seat}')).data;
const c10 = (await runtime.call('rule.C10.check', { view_seat: view, reveal, seat: ${seat}, folded })).data;
const txt = hole.length ? hole.join(' ') : '—';
return { seat: ${seat}, shown: !!c10.show, text: c10.show ? txt : '?? ??', why: c10.why };`;
