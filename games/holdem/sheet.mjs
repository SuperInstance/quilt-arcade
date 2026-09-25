// TEXAS HOLD'EM — the non-grid quilt-arcade game (hidden information + ML).
//
// 3 seats. One value push (action.request) drives the whole cascade:
// listener -> dispatch -> arbiter -> rule cells -> chip/card cells.
//
// Architecture (the arcade template, generalized off the grid):
//   rules.book      the complete ruleset in precise numbered language (C1..C10)
//   rule.Cn.law     the clause as written
//   rule.Cn.check   the machine port — a PURE program cell: (input) -> verdict
//   rule.Cn.verdict the last evaluation (rule-bubble UI reads this)
//   action.arbiter  the referee: sequences rule cells, moves chips/cards, ledger
//   deal.hand       C9 rebuy -> C1 shuffle -> C2 blinds -> C3 holes -> preflop
//   ai.decide       equity rollout x W.p<seat>.* weight cells x opponent model
//   fish.decide     the control group: a frozen call-station that never learns
//   learn.update    per-hand nudges on separate weight cells + fnv1a64 receipts
//   proj.pN         hole-card PROJECTION cells: ?? ?? until view/reveal (C10)
//   match.step      one AI action (driver loops it for computer-vs-computer)
//
// PRIVACY MODEL (the hold'em twist): hole.pN cells are the agent's own view —
// each seat's cells link to the cards that are theirs. proj.pN is what the
// shared screen renders: masked unless C10 says the seat is yours or the show
// has been called. The referee never needs a private channel: hiding is a
// FORMULA over cells, not absence of data.
//
// The harness (play.mjs) carries an INDEPENDENT evaluator + betting invariants
// and cross-checks every hand. See PATTERNS.md pattern 6.

import { v, law, prog, formula, listenerCell, SNIPPETS } from '../../shared/kit.mjs';
import { HE, DECIDER, FISH, LEARNER, makeProj } from './cards.mjs';

// ── rules.book ────────────────────────────────────────────────────────────────
const BOOK = `TEXAS HOLD'EM — RULEBOOK v1 (3-max, 2 chip blind, 100 chip stacks)

C1 (deck)         The game uses ONE deck of 52 distinct cards (ranks 2..A in
                  four suits shdc). Before each hand the deck is shuffled; a
                  card that has entered play never re-enters the deck. A deck
                  that is not 52 distinct valid cards cannot start a hand.

C2 (seats+blinds) Three seats play. The button rotates one seat per hand. The
                  seat left of the button posts the SMALL blind (1 chip), the
                  seat left of that posts the BIG blind (2 chips). Blinds are
                  live bets on the first street.

C3 (holes)        Each seat is dealt TWO private cards. Every card is distinct;
                  six cards leave the deck. A seat's hole cards belong to that
                  seat's own cells — other views may not render them (C10).

C4 (streets)      Betting runs on four streets: preflop (0 community cards),
                  flop (3 dealt at once), turn (1), river (1). A street's
                  community cards are dealt only when the previous street's
                  betting has closed. No burn cards (house simplification).

C5 (betting)      On your turn you may FOLD, CHECK (only when facing no bet),
                  CALL (match the current bet, all-in for less if short), or
                  RAISE to a total at least the current bet plus the last
                  raise size (opens the betting again for everyone else). An
                  all-in below min-raise is a CALL: it does not re-open. When
                  only one seat remains it wins the pot without showing.

C6 (table stakes) A seat never risks chips it does not own, and a RAISE never
                  goes beyond the smallest starting stack of the hand (the
                  cap). A called all-in may take a seat's whole stack.
                  Contributions are LEVELLED at showdown: chips put in beyond
                  the smallest contributing active stack are returned. There
                  are no side pots (house simplification, kept honest by the
                  conservation audit).

C7 (showdown)     When river betting closes, every live seat SHOWS its hole
                  cards (the reveal flips every projection cell). The best
                  five-card hand from each seat's seven cards wins the pot;
                  equal best hands split it.

C8 (ranking)      Hands rank: straight flush > quads > full house > flush >
                  straight > trips > two pair > pair > high card, with the
                  standard kicker orders and the wheel (A2345) as the lowest
                  straight. rule.C8.check ports this table 1:1 and is directly
                  probe-able with any seven cards.

C9 (rebuy)        A seat with fewer than 10 big blinds when a hand starts
                  tops up to 100 chips (casino rebuy). The button still
                  rotates; learning ledgers are never reset by a rebuy.

C10 (projection)  A seat's hole cards render as ?? ?? on every view that is
                  not that seat's own, until the SHOW: the showdown reveal or
                  an explicit call to show. Folded hands stay hidden even at
                  showdown. From an agent's view, the cells link to the cards
                  that are theirs; the shared screen sees only projections.

TURN (derived)    Preflop the button acts first, then small blind, then big
                  blind. Postflop the small blind acts first. A raise re-opens
                  the action on everyone who has not matched it. Refused
                  requests change nothing and keep the turn.`;

// ── rule checkers (PURE: everything arrives in input; no state reads) ────────
const CHK_C1 = `
const deck = input?.deck ?? [];
const valid = deck.every(c => typeof c === 'string' && c.length === 2 && '23456789TJQKA'.includes(c[0]) && 'shdc'.includes(c[1]));
const uniq = new Set(deck).size === deck.length;
const fired = deck.length !== 52 || !valid || !uniq;
return { fired, why: !fired ? 'deck sealed: 52 distinct cards (C1).'
  : 'deck invalid — ' + deck.length + ' cards, valid=' + valid + ', unique=' + uniq + ' — the hand cannot start (C1).' };`;

const CHK_C2 = `
const { button, sb, bbSeat, bb, sbAmt } = input ?? {};
const ok = [button, sb, bbSeat].every(Number.isInteger) && new Set([button, sb, bbSeat]).size === 3
  && button === (sb + 2) % 3 && sb === (bbSeat + 2) % 3;
return { fired: !ok, why: ok
  ? 'button P' + button + '; SB P' + sb + ' posts ' + sbAmt + ', BB P' + bbSeat + ' posts ' + bb + ' (C2).'
  : 'seating is not a legal 3-max rotation (C2: SB left of button, BB left of SB).' };`;

const CHK_C3 = `
const holes = input?.holes ?? [];
const flat = holes.flat();
const valid = flat.every(c => typeof c === 'string' && c.length === 2 && '23456789TJQKA'.includes(c[0]) && 'shdc'.includes(c[1]));
const two = holes.every(h => h.length === 2);
const uniq = new Set(flat).size === 6;
const fired = !(valid && two && uniq);
return { fired, why: !fired
  ? 'hole cards dealt: ' + holes.map((h, i) => 'P' + i + ' ' + h.join('')).join(', ') + ' — six distinct cards (C3).'
  : 'deal invalid (two per seat=' + two + ', distinct=' + uniq + ', valid=' + valid + ') — C3 refuses.' };`;

const CHK_C4 = `
const { street_before, street_after, comm_count_after, dealt } = input ?? {};
const need = { flop: 3, turn: 1, river: 1 };
const expCount = { flop: 3, turn: 4, river: 5 };
const transition = ({ preflop: 'flop', flop: 'turn', turn: 'river' })[street_before];
const ok = transition === street_after && need[street_after] === (dealt ?? []).length
  && expCount[street_after] === comm_count_after;
return { fired: !ok, dealt, why: ok
  ? street_after + ' deals ' + (dealt ?? []).join(' ') + ' — ' + comm_count_after + ' community cards (C4).'
  : 'street transition ' + street_before + ' -> ' + street_after + ' does not match the C4 dealing table.' };`;

const CHK_C5 = `
// C5 port: action legality + normalization. Returns norm = the referee's
// marching orders: {kind, pay, raise_to?, reopen?}.
const { seat, action, amount, to_act, to_call, max_bet, min_raise, stack, own, cap, phase } = input ?? {};
if (phase !== 'play') return { fired: true, why: 'C5 needs a live hand — deal first.' };
if (seat !== to_act) return { fired: true, why: 'P' + seat + ' acted out of turn — the action is on P' + to_act + ' (C5).' };
if (!['fold', 'check', 'call', 'raise'].includes(action))
  return { fired: true, why: 'unknown action ' + JSON.stringify(action) + ' — C5 allows fold / check / call / raise only.' };
if (action === 'fold') return { fired: false, why: 'P' + seat + ' folds.', norm: { kind: 'fold', pay: 0, reopen: false } };
if (action === 'check') {
  if (to_call > 0) return { fired: true, why: 'P' + seat + ' cannot check — facing a bet of ' + to_call + ' (C5: check only when nothing to call).' };
  return { fired: false, why: 'P' + seat + ' checks.', norm: { kind: 'check', pay: 0, reopen: false } };
}
if (action === 'call') {
  if (to_call <= 0) return { fired: true, why: 'nothing to call — P' + seat + ' should check (C5).' };
  const pay = Math.min(to_call, stack);
  const short = pay < to_call;
  return { fired: false, why: 'P' + seat + ' calls ' + pay + (short ? ' — ALL-IN for the last ' + stack + ' chips; does not re-open the betting (C5).' : '.'), norm: { kind: short ? 'allin-call' : 'call', pay, reopen: false } };
}
// raise (or opening bet)
if (to_call >= stack) return { fired: true, why: 'P' + seat + ' cannot raise — calling ' + to_call + ' would take the whole stack of ' + stack + '; C5 gives an all-in call, not a raise.' };
let target = (Number.isFinite(amount) && amount) ? amount : (max_bet + min_raise);
const maxTarget = own + stack;
if (target > maxTarget) target = maxTarget;   // a shove normalizes to the stack
const minT = max_bet + min_raise;
if (target < minT) {
  if (target === maxTarget && maxTarget < minT)
    return { fired: false, why: 'P' + seat + ' shoves ' + target + ' — below a min-raise, so it is a CALL for ' + to_call + '; the rest of the shove is declined (C5: a short shove does not re-open the betting).', norm: { kind: 'call', pay: to_call, raise_to: own + to_call, reopen: false } };
  return { fired: true, why: 'P' + seat + ' raise to ' + target + ' is below the minimum raise to ' + minT + ' (C5: raise >= current bet ' + max_bet + ' + last raise size ' + min_raise + ').' };
}
let cappedByTable = false;
if (target > cap) { target = cap; cappedByTable = true; }
return { fired: false, why: 'P' + seat + ' raises to ' + target + (cappedByTable ? ' — capped by the table stakes (C6).' : '.'),
  norm: { kind: 'raise', pay: target - own, raise_to: target, reopen: true, capped: cappedByTable } };`;

const CHK_C6 = `
const { kind, pay, stack, raise_to, cap } = input ?? {};
const overStack = (pay ?? 0) > stack;
// the cap constrains RAISE SIZING; a called all-in may take a seat's whole stack
const overCap = kind === 'raise' && (raise_to ?? 0) > cap;
return { fired: overStack || overCap, why: !overStack && !overCap
  ? 'chips are inside the table stakes (C6): pay ' + pay + ' <= stack ' + stack + (kind === 'raise' ? ', raise_to ' + (raise_to ?? 0) + ' <= cap ' + cap + '.' : '.')
  : overStack
    ? 'P would pay ' + pay + ' but owns only ' + stack + ' chips (C6: a seat never risks chips it does not have).'
    : 'raise to ' + raise_to + ' exceeds the table-stakes cap of ' + cap + ' — the smallest starting stack this hand (C6).' };`;

const CHK_C7 = `
${HE}
const comm = input?.comm ?? [], holes = input?.holes ?? {}, active = input?.active ?? [];
if (comm.length !== 5) return { fired: true, why: 'showdown needs 5 community cards; found ' + comm.length + ' (C7).' };
const ranks = [];
for (const seat of active) {
  const hole = holes[seat] ?? [];
  const best = eval7(hole.concat(comm));
  ranks.push({ seat, cat: best.cat, tie: best.tie, name: best.name, hole: hole.join(' ') });
}
ranks.sort((a, b) => cmpHands(b, a));
const top = ranks[0];
const winners = ranks.filter(r => cmpHands(r, top) === 0).map(r => r.seat);
const parts = ranks.map(r => 'P' + r.seat + ' shows ' + r.hole + ' — ' + r.name);
const why = parts.join('; ') + '. ' + (winners.length > 1
  ? 'Split pot: P' + winners.join(' and P') + ' tie with ' + top.name + '.'
  : 'P' + winners[0] + ' wins the pot with ' + top.name + '.');
return { fired: true, winners, ranks, why };`;

const CHK_C8 = `
${HE}
const cards = input?.cards ?? [];
if (cards.length !== 7) return { fired: true, why: 'C8 evaluates exactly seven cards; got ' + cards.length + '.' };
const best = eval7(cards);
return { fired: true, cat: best.cat, tie: best.tie, name: best.name,
  why: 'best five of seven: ' + best.name + ' (category ' + best.cat + ').' };`;

const CHK_C9 = `
const { stacks, bb, min_bb } = input ?? {};
const rebuy = [];
for (let i = 0; i < (stacks ?? []).length; i++) if (stacks[i] < bb * min_bb) rebuy.push(i);
return { fired: rebuy.length > 0, rebuy, why: rebuy.length
  ? 'P' + rebuy.join(' and P') + ' below ' + (bb * min_bb) + ' chips — house rule C9 tops them up to 100.'
  : 'all seats above the rebuy line (' + bb * min_bb + ' chips) — no rebuy (C9).' };`;

const CHK_C10 = `
const { view_seat, reveal, seat, folded } = input ?? {};
const show = seat === view_seat || (!!reveal && !folded);
return { fired: !show, show, why: show
  ? "P" + seat + "'s cards render from view P" + view_seat + (reveal && !folded ? ' — the show has been called (C10).' : " — that view IS seat P" + seat + ".")
  : "P" + seat + "'s cards are hidden from view P" + view_seat + " — projection stays ?? ?? until the show (C10)." };`;

// ── deal.hand — C9 rebuy -> C1 shuffle -> C2 blinds -> C3 holes -> preflop ───
const DEAL = `
// DEAL NEW HAND — the card placements ARE the cascade (trace = animation).
const g = async (id) => (await runtime.get(id)).data;
const s = (id, val) => runtime.set(id, val);
${SNIPPETS.rng}
const logEv = async (e) => { const lg = await g('log.events'); await s('log.events', [...lg.slice(-299), { ts: Date.now(), ...e }]); };
const phase = await g('hand.phase');
if (phase === 'play') return { ok: false, rule: 'C4', text: 'a hand is already live — finish it first.' };
const bb = await g('bb.size');
const handNo = await g('hand.no');
const fired = [];
// C9 rebuy
let stacks = [await g('stacks.p0'), await g('stacks.p1'), await g('stacks.p2')];
const c9 = (await runtime.call('rule.C9.check', { stacks, bb, min_bb: 10 })).data;
await s('rule.C9.verdict', { ...c9, ts: Date.now() });
fired.push('C9');
for (const i of (c9.rebuy ?? [])) { stacks[i] = 100; await s('stacks.p' + i, 100); }
// C1 deck
let deck = [];
for (const r of '23456789TJQKA') for (const su of 'shdc') deck.push(r + su);
const rnd = rng((((input?.seed ?? 1) * 2654435761) >>> 0));
for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = deck[i]; deck[i] = deck[j]; deck[j] = t; }
const c1 = (await runtime.call('rule.C1.check', { deck, seq: input?.seed ?? 1 })).data;
await s('rule.C1.verdict', { ...c1, ts: Date.now() });
fired.push('C1');
if (c1.fired) return { ok: false, rule: 'C1', text: c1.why };
// C2 seats + blinds
const button = handNo % 3;
const sbSeat = (button + 1) % 3, bbSeat = (button + 2) % 3;
const c2 = (await runtime.call('rule.C2.check', { button, sb: sbSeat, bbSeat, bb, sbAmt: bb / 2 })).data;
await s('rule.C2.verdict', { ...c2, ts: Date.now() });
fired.push('C2');
if (c2.fired) return { ok: false, rule: 'C2', text: c2.why };
// C3 holes
const hole = [[deck[0], deck[3]], [deck[1], deck[4]], [deck[2], deck[5]]];
const c3 = (await runtime.call('rule.C3.check', { holes: hole, deck })).data;
await s('rule.C3.verdict', { ...c3, ts: Date.now() });
fired.push('C3');
if (c3.fired) return { ok: false, rule: 'C3', text: c3.why };
// effects: reset per-hand state, place the cards
for (let i = 0; i < 3; i++) {
  await s('folded.p' + i, false); await s('allin.p' + i, false);
  await s('bets.p' + i, 0); await s('contrib.p' + i, 0);
  await s('hole.p' + i, hole[i]);
  await s('hand.log.p' + i, []);
}
for (let i = 1; i <= 5; i++) await s('comm.c' + i, '');
const trace = [];
for (let i = 0; i < 3; i++) { trace.push({ card: hole[i][0], to: 'hole.p' + i }); trace.push({ card: hole[i][1], to: 'hole.p' + i }); }
// blinds (chips move from stacks into this street's bets)
const payBlind = async (i, amt) => {
  const pay = Math.min(amt, stacks[i]);
  stacks[i] -= pay;
  await s('stacks.p' + i, stacks[i]);
  await s('bets.p' + i, pay);
  await s('contrib.p' + i, pay);
  return pay;
};
const sbPaid = await payBlind(sbSeat, bb / 2);
const bbPaid = await payBlind(bbSeat, bb);
// state
await s('deck.state', deck.slice(6));
await s('deck.seed', input?.seed ?? 1);
await s('pot.total', sbPaid + bbPaid);
await s('pot.collected', 0);
await s('hand.no', handNo + 1);
await s('hand.button', button);
await s('hand.phase', 'play');
await s('street.current', 'preflop');
await s('reveal.state', false);
await s('hand.result', null);
await s('allin.cap', Math.min(...[0, 1, 2].map(i => stacks[i] + (i === sbSeat ? sbPaid : i === bbSeat ? bbPaid : 0))));
const pending = [button, sbSeat, bbSeat];
await s('pending.list', pending);
await s('to.act', button);
await s('last.aggressor', -1);
await s('last.raise', bb);
await s('rules.fired', fired);
await s('rules.verdict', { ok: true, rule: 'C3', seq: 0, ts: Date.now(), text: c3.why + ' ' + c2.why, trace });
await logEv({ kind: 'deal', hand: handNo + 1, text: 'hand #' + (handNo + 1) + ' — button P' + button + ', blinds P' + sbSeat + ':' + sbPaid + ' P' + bbSeat + ':' + bbPaid + (c9.rebuy?.length ? ' (rebuy: P' + c9.rebuy.join(', P') + ')' : '') });
return { ok: true, hand: handNo + 1, button, trace, text: 'hand #' + (handNo + 1) + ' dealt — P' + button + ' acts first (preflop).' };`;

// ── action.arbiter — THE REFEREE ──────────────────────────────────────────────
const ARBITER = `
// THE REFEREE — knows no rules; sequences the rule cells and applies the
// effects they computed. Every verdict you see was produced by a rule cell.
const g = async (id) => (await runtime.get(id)).data;
const s = (id, val) => runtime.set(id, val);
const logEv = async (e) => { const lg = await g('log.events'); await s('log.events', [...lg.slice(-299), { ts: Date.now(), ...e }]); };
const seq = input?.seq ?? 0;
const lastSeq = await g('match.seq');
if (seq <= lastSeq) return { ok: false, rule: 'DUP', text: 'stale request (seq ' + seq + ' <= ' + lastSeq + ') — nothing happened.' };
const phase = await g('hand.phase');
if (phase !== 'play') return { ok: false, rule: 'C5', text: 'no live hand — deal first (C5 needs a live hand).' };
const seat = input?.seat;
const bb = await g('bb.size');
const street = await g('street.current');
const handNo = await g('hand.no');
const bets = [await g('bets.p0'), await g('bets.p1'), await g('bets.p2')];
const stacks = [await g('stacks.p0'), await g('stacks.p1'), await g('stacks.p2')];
const folded = [await g('folded.p0'), await g('folded.p1'), await g('folded.p2')];
const allin = [await g('allin.p0'), await g('allin.p1'), await g('allin.p2')];
const pot = await g('pot.total');
const maxBet = Math.max(...bets);
const toCall = maxBet - bets[seat];
const pending = await g('pending.list');
const toAct = await g('to.act');
const lastRaise = await g('last.raise');
const cap = await g('allin.cap');
const fired = [];
const done = async (verdict) => {
  await logEv({ kind: verdict.ok ? 'apply' : 'refuse', hand: handNo, seat, street, action: input?.action ?? null, rule: verdict.rule ?? null, seq, text: verdict.text });
  await s('rules.verdict', { ...verdict, seq, ts: Date.now() });
  return verdict;
};
// C5 legality + normalization (pure checker)
const c5 = (await runtime.call('rule.C5.check', {
  seat, action: input?.action, amount: input?.amount, street, to_act: toAct,
  to_call: toCall, max_bet: maxBet, min_raise: lastRaise, stack: stacks[seat],
  own: bets[seat], pot, cap, phase })).data;
await s('rule.C5.verdict', { ...c5, ts: Date.now() });
fired.push('C5');
if (c5.fired) { await s('rules.fired', fired); return done({ ok: false, rule: 'C5', text: c5.why }); }
const norm = c5.norm;
const actText = c5.why;
// C6 table stakes
const c6 = (await runtime.call('rule.C6.check', { kind: norm.kind, pay: norm.pay, stack: stacks[seat], raise_to: norm.raise_to ?? 0, cap })).data;
await s('rule.C6.verdict', { ...c6, ts: Date.now() });
fired.push('C6');
if (c6.fired) { await s('rules.fired', fired); return done({ ok: false, rule: 'C6', text: c6.why }); }
// ── apply the effects ──
if (norm.kind === 'fold') {
  folded[seat] = true;
  await s('folded.p' + seat, true);
} else if (norm.pay > 0) {
  stacks[seat] -= norm.pay; bets[seat] += norm.pay;
  await s('stacks.p' + seat, stacks[seat]);
  await s('bets.p' + seat, bets[seat]);
  await s('contrib.p' + seat, (await g('contrib.p' + seat)) + norm.pay);
  await s('pot.total', pot + norm.pay);
  if (stacks[seat] === 0) { allin[seat] = true; await s('allin.p' + seat, true); }
}
const active = [0, 1, 2].filter(i => !folded[i]);
const canAct = (excl) => active.filter(i => !allin[i] && i !== excl);
let pending2;
if (norm.kind === 'raise' && norm.reopen) {
  await s('last.aggressor', seat);
  await s('last.raise', Math.max(lastRaise, (norm.raise_to ?? 0) - maxBet));
  pending2 = canAct(seat);
} else {
  pending2 = pending.filter(i => i !== seat && !folded[i] && !allin[i]);
}
// NOTE: no "lone player" shortcut here — every seat in pending2 OWES an action
// (the BB option, or a re-opened bet). The betting-closed shortcut lives only
// in the street-advance code below, where everyone has already acted.
await s('pending.list', pending2);
await s('to.act', pending2.length ? pending2[0] : -1);
// fold-win: one seat left — no reveal, cards stay hidden (C10)
if (active.length === 1) {
  const w = active[0];
  const contribs = [await g('contrib.p0'), await g('contrib.p1'), await g('contrib.p2')];
  const othersMax = Math.max(...contribs.filter((_, i) => i !== w));
  const refund = Math.max(0, contribs[w] - othersMax);
  let potNow = (await g('pot.total')) - refund;
  if (refund > 0) { await s('stacks.p' + w, (await g('stacks.p' + w)) + refund); await s('pot.total', potNow); }
  await s('stacks.p' + w, (await g('stacks.p' + w)) + potNow);
  await s('pot.total', 0); await s('pot.collected', 0);
  for (let i = 0; i < 3; i++) await s('bets.p' + i, 0);
  const desc = 'P' + w + ' wins ' + potNow + ' uncontested — hole cards stay hidden (C10).';
  await s('hand.phase', 'over');
  await s('hand.result', { no: handNo, winners: [w], pot: potNow, reveal: false, desc });
  await s('match.seq', seq);
  await s('rules.fired', fired);
  return done({ ok: true, rule: 'C5', text: actText + ' ' + desc, fired, trace: [] });
}
// street run-out (the while loop IS the community-card cascade)
let cur = street;
let trace = [];
const countComm = { preflop: 0, flop: 3, turn: 4, river: 5 };
while ((await g('pending.list')).length === 0 && cur !== 'river') {
  const next = ({ preflop: 'flop', flop: 'turn', turn: 'river' })[cur];
  const need = ({ flop: 3, turn: 1, river: 1 })[next];
  const deck = await g('deck.state');
  const dealt = deck.slice(0, need);
  await s('deck.state', deck.slice(need));
  const b2 = [await g('bets.p0'), await g('bets.p1'), await g('bets.p2')];
  await s('pot.collected', (await g('pot.collected')) + b2[0] + b2[1] + b2[2]);
  for (let i = 0; i < 3; i++) await s('bets.p' + i, 0);
  const c4 = (await runtime.call('rule.C4.check', { street_before: cur, street_after: next, comm_count_after: countComm[next], dealt })).data;
  await s('rule.C4.verdict', { ...c4, ts: Date.now() });
  fired.push('C4');
  if (c4.fired) { await s('rules.fired', fired); return done({ ok: false, rule: 'C4', text: c4.why }); }
  const startIdx = countComm[cur] + 1;
  dealt.forEach((card, k) => trace.push({ card, to: 'comm.c' + (startIdx + k) }));
  for (let k = 0; k < dealt.length; k++) await s('comm.c' + (startIdx + k), dealt[k]);
  await s('street.current', next);
  cur = next;
  await s('last.raise', bb);
  await s('last.aggressor', -1);
  const act2 = [0, 1, 2].filter(i => !folded[i]);
  const canAct2 = act2.filter(i => !allin[i]);
  const btn = await g('hand.button');
  const order = [(btn + 1) % 3, (btn + 2) % 3, btn];
  let pend2 = order.filter(i => canAct2.includes(i));
  if (pend2.length === 1) {
    const betsNow = [await g('bets.p0'), await g('bets.p1'), await g('bets.p2')];
    if (betsNow[pend2[0]] >= Math.max(...betsNow)) pend2 = [];
  }
  await s('pending.list', pend2);
  await s('to.act', pend2.length ? pend2[0] : -1);
  await s('rules.fired', fired);
}
// showdown — THE SHOW: C7 flips every live projection via reveal.state
if (cur === 'river' && (await g('pending.list')).length === 0 && (await g('hand.phase')) === 'play') {
  const comm = [];
  for (let i = 1; i <= 5; i++) comm.push(await g('comm.c' + i));
  const act3 = [0, 1, 2].filter(i => !folded[i]);
  const holes = {};
  for (const i of act3) holes[i] = await g('hole.p' + i);
  const potNow = await g('pot.total');
  const c7 = (await runtime.call('rule.C7.check', { comm, holes, active: act3, pot: potNow })).data;
  await s('rule.C7.verdict', { ...c7, ts: Date.now() });
  fired.push('C7', 'C8', 'C10');
  await s('reveal.state', true);
  // level contributions (C6 simplification: no side pots)
  const contribs = [await g('contrib.p0'), await g('contrib.p1'), await g('contrib.p2')];
  const level = Math.min(...act3.map(i => contribs[i]));
  let pot2 = potNow;
  for (const i of act3) {
    const refund = contribs[i] - level;
    if (refund > 0) { await s('stacks.p' + i, (await g('stacks.p' + i)) + refund); pot2 -= refund; }
  }
  await s('pot.total', pot2);
  // award (split; odd chip to the first live seat left of the button)
  const btn = await g('hand.button');
  const pfOrder = [(btn + 1) % 3, (btn + 2) % 3, btn];
  const winnersOrdered = pfOrder.filter(i => c7.winners.includes(i));
  const share = Math.floor(pot2 / winnersOrdered.length);
  let rem = pot2 - share * winnersOrdered.length;
  for (const w of winnersOrdered) {
    let amt = share;
    if (rem > 0) { amt += 1; rem -= 1; }
    await s('stacks.p' + w, (await g('stacks.p' + w)) + amt);
  }
  await s('pot.total', 0); await s('pot.collected', 0);
  for (let i = 0; i < 3; i++) await s('bets.p' + i, 0);
  await s('hand.phase', 'over');
  await s('hand.result', { no: handNo, winners: winnersOrdered, pot: pot2, reveal: true, desc: c7.why });
  await s('match.seq', seq);
  await s('rules.fired', fired);
  return done({ ok: true, rule: 'C7', text: actText + ' ' + c7.why, fired, trace });
}
await s('match.seq', seq);
await s('rules.fired', fired);
return done({ ok: true, rule: 'C5', text: actText, fired, trace });`;

const DISPATCH = `
// push trampoline: listener passes {changed, value}; driver may pass the
// request directly. Both converge on the same arbitration.
const ev = input ?? {};
let req = null;
if (ev.seat != null) req = ev;
else if (ev.value?.seat != null) req = ev.value;
else if (caller?.metadata?.current?.seat != null) req = caller.metadata.current;
else req = (await runtime.get('action.request')).data;
if (!req || req.seat == null) return { skipped: true };
return (await runtime.call('action.arbiter', req)).data;`;

// ── equity rollout (the learner's nose) ───────────────────────────────────────
const EQUITY = `
${HE}
${SNIPPETS.rng}
// MONTE-CARLO EQUITY for a seat: roll the remaining board + opponent holes from
// deck.state. Folded dead cards are NOT re-added (a small, honest bias — the
// description cell says so).
const g = async (id) => (await runtime.get(id)).data;
const seat = input?.seat;
const hole = await g('hole.p' + seat);
if (!hole || hole.length < 2) return { equity: 0.5, trials: 0, why: 'no hole cards' };
const comm = [];
for (const id2 of ['comm.c1', 'comm.c2', 'comm.c3', 'comm.c4', 'comm.c5']) { const x = await g(id2); if (x) comm.push(x); }
const folded = [await g('folded.p0'), await g('folded.p1'), await g('folded.p2')];
const opps = [0, 1, 2].filter(i => i !== seat && !folded[i]);
const deck = (await g('deck.state')).slice();
const trials = input?.trials ?? 60;
if (deck.length < opps.length * 2 + (5 - comm.length)) return { equity: 0.5, trials: 0, why: 'deck too small' };
const rnd = rng((((input?.seed ?? 1) * 9176) + trials) >>> 0);
let score = 0;
for (let t = 0; t < trials; t++) {
  const d = deck.slice();
  const drawn = [];
  const need = opps.length * 2 + (5 - comm.length);
  for (let k = 0; k < need; k++) {
    const j = Math.floor(rnd() * (d.length - k));
    const last = d.length - 1 - k;
    const tmp = d[j]; d[j] = d[last]; d[last] = tmp;
    drawn.push(d[last]);
  }
  const board = comm.concat(drawn.slice(opps.length * 2));
  const mine = eval7(hole.concat(board));
  let best = 1;
  for (let o = 0; o < opps.length; o++) {
    const oh = eval7([drawn[o * 2], drawn[o * 2 + 1]].concat(board));
    const c = cmpHands(mine, oh);
    if (c < 0) { best = 0; break; }
    if (c === 0) best = 0.5;
  }
  score += best;
}
return { equity: score / trials, trials, opps: opps.length, comm: comm.length };`;

// ── legal actions / public table / reveal / match loop / new match ───────────
const LEGAL = `
// what the seat to act may legally do right now (viewer buttons + harness)
const g = async (id) => (await runtime.get(id)).data;
const phase = await g('hand.phase');
if (phase !== 'play') return { seat: null, options: [] };
const seat = await g('to.act');
if (seat == null || seat < 0) return { seat: null, options: [] };
const bets = [await g('bets.p0'), await g('bets.p1'), await g('bets.p2')];
const stacks = [await g('stacks.p0'), await g('stacks.p1'), await g('stacks.p2')];
const maxBet = Math.max(...bets);
const toCall = maxBet - bets[seat];
const lastRaise = await g('last.raise');
const cap = await g('allin.cap');
const own = bets[seat], stack = stacks[seat];
const options = [{ action: 'fold', label: 'Fold' }];
if (toCall <= 0) options.push({ action: 'check', label: 'Check' });
else options.push({ action: 'call', label: 'Call ' + Math.min(toCall, stack), to_call: Math.min(toCall, stack) });
if (toCall < stack) {
  const min = Math.min(maxBet + lastRaise, own + stack);
  options.push({ action: 'raise', label: 'Raise to ' + min, min, max: Math.min(own + stack, cap) });
}
return { seat, to_call: toCall, options };`;

const PUBLIC = `
// the SHARED-SCREEN snapshot: every hole card goes through rule.C10.check,
// so what leaves this cell is exactly what a shared screen may render.
const g = async (id) => (await runtime.get(id)).data;
const view = await g('view.seat');
const reveal = await g('reveal.state');
const seats = [];
for (let i = 0; i < 3; i++) {
  const hole = (await g('hole.p' + i)) ?? [];
  const folded = await g('folded.p' + i);
  const c10 = (await runtime.call('rule.C10.check', { view_seat: view, reveal, seat: i, folded })).data;
  seats.push({
    stack: await g('stacks.p' + i), bet: await g('bets.p' + i),
    folded, allin: await g('allin.p' + i),
    proj: hole.length ? (c10.show ? hole.join(' ') : '?? ??') : '—',
  });
}
const comm = [];
for (let i = 1; i <= 5; i++) comm.push(await g('comm.c' + i));
return { view_seat: view, reveal, street: await g('street.current'), phase: await g('hand.phase'),
  pot: await g('pot.total'), to_act: await g('to.act'), button: await g('hand.button'),
  result: await g('hand.result'), comm, seats };`;

const SHOW = `
// the explicit "call to show" — flips every projection cell open (C10)
const g = async (id) => (await runtime.get(id)).data;
await runtime.set('reveal.state', true);
const lg = await g('log.events');
await runtime.set('log.events', [...lg.slice(-299), { ts: Date.now(), kind: 'show', text: 'SHOW called — hole cards revealed (C10 projections open).' }]);
return { ok: true, text: 'cards shown.' };`;

const MATCH_STEP = `
// one AI action for whoever is to act. input {seed?, frozen?, log?}
// Routes through seats.cfg: 'fish' | 'learn' | 'human'. The arbiter owns
// match.seq — this cell must NOT pre-increment it.
const g = async (id) => (await runtime.get(id)).data;
const phase = await g('hand.phase');
if (phase !== 'play') return { over: true };
const seat = await g('to.act');
if (seat == null || seat < 0) return { over: true, why: 'no actor' };
const cfg = await g('seats.cfg');
const kind = cfg[String(seat)] ?? 'fish';
const seed = input?.seed ?? 1;
if (kind === 'human') return { wait: true, seat };
if (kind === 'learn') return (await runtime.call('ai.decide', { seat, seed, frozen: input?.frozen ?? false, log: input?.log ?? true })).data;
return (await runtime.call('fish.decide', { seat, seed })).data;`;

const NEW_MATCH = `
// reset the table (stacks, weights, opponent models) — receipts are KEPT:
// the learning history is the artifact, not the chips.
const s = (id, val) => runtime.set(id, val);
for (let i = 0; i < 3; i++) {
  await s('stacks.p' + i, 100);
  await s('bets.p' + i, 0);
  await s('contrib.p' + i, 0);
  await s('folded.p' + i, false);
  await s('allin.p' + i, false);
  await s('hole.p' + i, []);
  await s('hand.log.p' + i, []);
  await s('ai.thoughts.p' + i, []);
  await s('learn.last_stack.p' + i, null);
}
for (const seat of [1, 2]) {
  await s('learn.gen.p' + seat, 0);
  await s('W.p' + seat + '.frozen', null);
  await s('om.p' + seat, { opp_aggro: 0.7, opp_sticky: 0.7, samples: 0 });
  for (const k of ['aggro', 'tight', 'bluff', 'sticky', 'adapt'])
    await s('W.p' + seat + '.' + k, { aggro: 0.6, tight: 0, bluff: 0.3, sticky: 0.2, adapt: 0.2 }[k]);
}
await s('hand.no', 0);
await s('hand.phase', 'idle');
await s('street.current', 'none');
await s('pot.total', 0);
await s('pot.collected', 0);
for (let i = 1; i <= 5; i++) await s('comm.c' + i, '');
await s('hand.result', null);
await s('reveal.state', false);
await s('to.act', -1);
await s('pending.list', []);
await s('match.seq', 0);
const lg = (await runtime.get('log.events')).data;
await s('log.events', [...lg.slice(-199), { ts: Date.now(), kind: 'new_match', text: 'table reset — stacks 100, weights re-initialized (receipt chains preserved)' }]);
return { ok: true };`;

// ── buildSheet ────────────────────────────────────────────────────────────────
export function buildSheet() {
  const cells = [];
  cells.push(v('rules.book', BOOK, 'the complete ruleset; every clause is ported 1:1 to a rule.Cn.check cell'));
  for (const [n, clause] of [
    ['C1', 'C1 (deck): one 52-card deck, shuffled per hand; a played card never re-enters.'],
    ['C2', 'C2 (seats+blinds): 3-max; button rotates; SB 1 chip, BB 2 chips, live preflop.'],
    ['C3', 'C3 (holes): two private cards per seat, six distinct cards leave the deck.'],
    ['C4', 'C4 (streets): preflop/flop 3/turn 1/river 1 — dealt only when prior betting closed.'],
    ['C5', 'C5 (betting): fold / check / call / raise >= bet + last raise; short all-in calls do not re-open.'],
    ['C6', 'C6 (table stakes): never risk chips you do not own; raises capped at the smallest starting stack; contributions levelled, no side pots.'],
    ['C7', 'C7 (showdown): live seats show; best five of seven wins; ties split.'],
    ['C8', 'C8 (ranking): straight flush > quads > full house > flush > straight > trips > two pair > pair > high card; wheel lowest.'],
    ['C9', 'C9 (rebuy): under 10bb at hand start tops up to 100 chips.'],
    ['C10', 'C10 (projection): hole cards render ?? ?? to any non-own view until the show; folded hands never show.'],
  ]) {
    cells.push(law(`rule.${n}.law`, clause, `clause ${n} quoted from rules.book`));
    cells.push(v(`rule.${n}.verdict`, null, `last evaluation of clause ${n} (rule-bubble UI reads this)`));
  }
  cells.push(v('rules.fired', [], 'clauses that came into play for the last action'));
  cells.push(v('rules.verdict', null, 'master verdict of the last pushed action'));

  // deck + holes + projections (the privacy layer)
  cells.push(v('deck.state', [], 'remaining deck after the deal (46 cards)'));
  cells.push(v('deck.seed', 0, 'seed of the last shuffle'));
  for (let i = 0; i < 3; i++) {
    cells.push(v(`hole.p${i}`, [], `seat ${i}'s hole cards — the agent's own view (C3/C10)`));
    cells.push(prog(`proj.p${i}`, makeProj(i), `seat ${i}'s PROJECTION: ?? ?? until view/reveal says otherwise (C10)`, ['view.seat', 'reveal.state']));
  }
  cells.push(v('view.seat', 0, 'which seat the UI renders from (turn off projections of the others)'));
  cells.push(v('reveal.state', false, 'the SHOW flag: flipped by showdown or reveal.show'));
  for (let i = 1; i <= 5; i++)
    cells.push(v(`comm.c${i}`, '', `community card ${i}: '' until dealt (C4)`));

  // hand state
  cells.push(v('hand.no', 0, 'hands dealt so far (button = hand.no % 3)'));
  cells.push(v('hand.button', -1, 'button seat of the live/last hand'));
  cells.push(v('hand.phase', 'idle', 'idle | play | over'));
  cells.push(v('street.current', 'none', 'none | preflop | flop | turn | river'));
  cells.push(v('hand.result', null, 'winners + description of the last finished hand'));
  cells.push(v('bb.size', 2, 'big blind (small blind = 1)'));
  cells.push(v('pot.total', 0, 'chips in the middle right now'));
  cells.push(v('pot.collected', 0, 'chips collected from closed streets'));
  cells.push(formula('pot.audit', 'bets.p0 + bets.p1 + bets.p2 + pot.collected - pot.total',
    'live conservation invariant: must be 0 (PATTERNS pattern 6)'));
  for (let i = 0; i < 3; i++) {
    cells.push(v(`stacks.p${i}`, 100, `seat ${i} chips behind`));
    cells.push(v(`bets.p${i}`, 0, `seat ${i} chips committed this street`));
    cells.push(v(`contrib.p${i}`, 0, `seat ${i} total contribution this hand (levelling, C6)`));
    cells.push(v(`folded.p${i}`, false, `seat ${i} folded?`));
    cells.push(v(`allin.p${i}`, false, `seat ${i} all-in?`));
  }
  cells.push(v('to.act', -1, 'seat whose turn it is'));
  cells.push(v('pending.list', [], 'seats still to act this street'));
  cells.push(v('last.aggressor', -1, 'last raise seat'));
  cells.push(v('last.raise', 2, 'current min-raise increment (C5)'));
  cells.push(v('allin.cap', 100, 'table-stakes cap: smallest starting stack this hand (C6)'));
  cells.push(v('match.seq', 0, 'monotonic action-request sequence (arbiter-owned)'));
  cells.push(v('seats.cfg', { 0: 'fish', 1: 'learn', 2: 'learn' }, 'per-seat brain: fish | learn | human (CVC ships fish+2 learners)'));

  // rule checkers
  cells.push(prog('rule.C1.check', CHK_C1, 'C1 port: deck integrity', []));
  cells.push(prog('rule.C2.check', CHK_C2, 'C2 port: 3-max rotation + blinds', []));
  cells.push(prog('rule.C3.check', CHK_C3, 'C3 port: two distinct hole cards per seat', []));
  cells.push(prog('rule.C4.check', CHK_C4, 'C4 port: street dealing table', []));
  cells.push(prog('rule.C5.check', CHK_C5, 'C5 port: action legality + normalization', []));
  cells.push(prog('rule.C6.check', CHK_C6, 'C6 port: table stakes / cap', []));
  cells.push(prog('rule.C7.check', CHK_C7, 'C7 port: showdown ranking + winners', []));
  cells.push(prog('rule.C8.check', CHK_C8, 'C8 port: the hand-ranking table (probe-able)', []));
  cells.push(prog('rule.C9.check', CHK_C9, 'C9 port: rebuy line', []));
  cells.push(prog('rule.C10.check', CHK_C10, 'C10 port: the projection/privacy policy', []));

  // arbiters + input surface
  cells.push(prog('deal.hand', DEAL, 'C9 -> C1 -> C2 -> C3 -> preflop; trace = card cascade', ['hand.phase']));
  cells.push(prog('action.arbiter', ARBITER, 'THE REFEREE — sequences rule cells, moves chips/cards, keeps the ledger', ['action.request']));
  cells.push(prog('action.dispatch', DISPATCH, 'push trampoline: action.request -> action.arbiter', ['action.request']));
  cells.push(listenerCell('action.push', ['action.request'], 'action.dispatch', null,
    'push of one value drives the whole cascade'));
  cells.push(v('action.request', null, 'UI writes {seat, action, amount, seq} here — the human input surface'));

  // brains
  cells.push(prog('ai.equity', EQUITY, 'Monte-Carlo equity vs live opponents (rollout from deck.state)', []));
  cells.push(prog('ai.decide', DECIDER, 'learner policy: equity x W.p<seat>.* x opponent model -> action.arbiter', ['to.act', 'hand.phase']));
  cells.push(prog('fish.decide', FISH, 'control group: frozen call-station policy', ['to.act', 'hand.phase']));
  // seat 0 (the fish) still needs its own trace/log cells — deal + reset touch them
  cells.push(v('ai.thoughts.p0', [], "P0's decision commentary (fish: short)"));
  cells.push(v('hand.log.p0', [], "P0's decisions this hand (unused by the fish brain, kept uniform)"));
  cells.push(v('learn.last_stack.p0', null, 'P0 stack marker (unused by the fish brain, kept uniform)'));
  for (const seat of [1, 2]) {
    for (const [k, d] of [['aggro', 'raise/bet propensity scale'], ['tight', 'value threshold offset'], ['bluff', 'bluff frequency'], ['sticky', 'call-down propensity'], ['adapt', 'opponent-model gain']])
      cells.push(v(`W.p${seat}.${k}`, { aggro: 0.6, tight: 0, bluff: 0.3, sticky: 0.2, adapt: 0.2 }[k], `P${seat} strategy weight: ${d} — nudge loop refines this cell; watch it drift`));
    cells.push(v(`W.p${seat}.frozen`, null, `P${seat}'s frozen gen-1 weights (the control group for held-out eval)`));
    cells.push(v(`om.p${seat}`, { opp_aggro: 0.7, opp_sticky: 0.7, samples: 0 }, `P${seat}'s opponent model (EMA over the ledger)`));
    cells.push(v(`ai.thoughts.p${seat}`, [], `P${seat}'s decision commentary — the agent UX trace (cap 60)`));
    cells.push(v(`hand.log.p${seat}`, [], `P${seat}'s decisions this hand (consumed by learn.update)`));
    cells.push(v(`learn.gen.p${seat}`, 0, `P${seat} generations learned`));
    cells.push(v(`learn.last_stack.p${seat}`, null, `P${seat} stack at the previous learn.update (net = outcome signal)`));
    cells.push(v(`learn.receipts.p${seat}`, [], `P${seat} fnv1a64 witness chain: one receipt per hand learned`));
    cells.push(v(`learn.last.p${seat}`, null, `snapshot of P${seat}'s latest update`));
  }
  cells.push(v('learn.alpha', 0.12, 'nudge learning rate'));
  cells.push(prog('learn.update', LEARNER, 'per-hand credit nudges on separate weight cells + witness receipt (input {seat})', ['hand.phase']));

  // table services
  cells.push(prog('legal.actions', LEGAL, 'what the seat to act may legally do (viewer buttons + harness)', ['to.act', 'hand.phase']));
  cells.push(prog('table.public', PUBLIC, 'the shared-screen snapshot: every card goes through rule.C10.check', ['reveal.state', 'view.seat']));
  cells.push(prog('reveal.show', SHOW, 'the explicit CALL TO SHOW — flips every projection open (C10)', []));
  cells.push(prog('match.step', MATCH_STEP, 'one AI action (input {seed?, frozen?, log?}); loop it for computer-vs-computer', ['hand.phase', 'to.act']));
  cells.push(prog('new_match', NEW_MATCH, 'reset table + weights; receipt chains preserved', ['hand.phase']));

  cells.push(v('log.events', [], 'append-only audit: deals, actions, refusals, shows, resets (cap 300)'));
  return { id: 'holdem', title: "Quilt Arcade — Texas Hold'em (hidden info + ML strategy cells)", cells };
}
