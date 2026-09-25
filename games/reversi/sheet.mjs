// REVERSI (OTHELLO) — the flagship quilt-arcade game.
//
// 64 value cells ARE the board. Pushing one value (move.request) drives the
// whole cascade: listener -> dispatch -> arbiter -> rule cells -> flip cells.
//
// Architecture (copy of the tictactoe template, scaled):
//   rules.book      the complete ruleset in precise numbered language
//   rule.N.law      the clause as written
//   rule.N.check    the machine port — a PURE program cell: (input) -> verdict
//   rule.N.verdict  the last evaluation (rule-bubble UI reads this)
//   move.arbiter    the referee: sequences rule cells, applies effects, ledger
//   legal.moves     the R1+R2+R3 scan every consumer shares
//   ai.*            feature scorer + choose (weights from a cell => learnable)
//   learn.*         perceptron update + fnv1a64 witness chain of generations
//   match.step      one AI ply (driver loops it for computer-vs-computer)
//
// The arbiter re-derives every flip through the rule cells; the AI's own
// scanner is independent code — the harness cross-checks the two (referee as
// ground truth). See play.mjs.

import { v, law, prog, formula, listenerCell, SNIPPETS } from '../../shared/kit.mjs';

const COLS = 'ABCDEFGH';
export const sqName = (r, c) => COLS[c] + (r + 1);

// ── shared inline helpers (interpolated into every program cell that needs
//    them — program cells run in a new-Function scope, helpers must be
//    inlined; interpolating at build time keeps a single source of truth) ────
const RV = `
const COLS = 'ABCDEFGH';
const sq = (r, c) => COLS[c] + (r + 1);
const opp = (p) => p === 'B' ? 'W' : 'B';
const DIRS = [[-1,0,'N'],[-1,1,'NE'],[0,1,'E'],[1,1,'SE'],[1,0,'S'],[1,-1,'SW'],[0,-1,'W'],[-1,-1,'NW']];
// full legal scan: every square R1+R2+R3 would accept, with its flips
const legalScan = (grid, player) => {
  const o = opp(player), out = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    if (grid[r][c] !== '') continue;
    let n_total = 0; const rays = [];
    for (const d of DIRS) {
      let n = 0, rr = r + d[0], cc = c + d[1];
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && grid[rr][cc] === o) { n++; rr += d[0]; cc += d[1]; }
      if (n && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && grid[rr][cc] === player) { n_total += n; rays.push(d[2]); }
    }
    if (n_total) out.push({ r, c, sq: sq(r, c), flips: n_total, rays });
  }
  return out;
};
// exact flip list for one placement (the R3 port, shared by checker + AI sims)
const flipsAt = (grid, r, c, player) => {
  const o = opp(player), flips = [];
  for (const d of DIRS) {
    const line = [];
    let rr = r + d[0], cc = c + d[1];
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && grid[rr][cc] === o) { line.push([rr, cc]); rr += d[0]; cc += d[1]; }
    if (line.length && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && grid[rr][cc] === player)
      for (const [a, b] of line) flips.push({ r: a, c: b, sq: sq(a, b), from: o, to: player, ray: d[2] });
  }
  return flips;
};`;

// ── rules.book ────────────────────────────────────────────────────────────────
const BOOK = `REVERSI — RULEBOOK v1

R1 (bounds)       A disc is placed by naming a square (rows 1-8, columns A-H).
                  Squares outside the 8x8 grid do not exist; naming one is
                  not a move. The board is unchanged.

R2 (empty)        A disc may only be placed on an EMPTY square. An occupied
                  square is closed for the rest of the game.

R3 (sandwich)     The placed disc must bracket one or more straight,
                  unbroken lines of enemy discs between itself and another
                  disc of the placer's own colour: own ... enemy(enemy)* own.
                  EVERY enemy disc on every bracketed line converts to the
                  placer's colour in the same move — this is the flip. If no
                  line is bracketed in any of the 8 directions (N,NE,E,SE,S,
                  SW,W,NW), the placement is illegal and the board is
                  unchanged. Flipped discs may themselves be flipped back
                  later; the board never remembers.

R4 (pass)         If the player to move has NO legal placement (no square
                  satisfies R1+R2+R3), the turn is a PASS: it is announced,
                  nothing is placed, and the opponent moves again.

R5 (end)          The game ends when the board is full, or when NEITHER
                  player has a legal placement (passes in succession). A
                  closed board refuses every move and changes nothing.

R6 (score)        When the board closes, each side scores one point per own
                  disc. Higher score wins; equal scores draw. The score cells
                  recompute live after every accepted move.

TURN (derived)    Black moves first. After every accepted placement (with its
                  flips) the turn passes to the other colour, unless R4 makes
                  it stay. Refused moves never pass the turn.`;

// ── rule checkers (PURE: grid passed in, no runtime reads) ───────────────────
const CHK_R1 = `
${RV}
const r = input?.r, c = input?.c;
const fired = !(Number.isInteger(r) && r >= 0 && r < 8 && Number.isInteger(c) && c >= 0 && c < 8);
return { fired, why: fired
  ? 'Square ' + JSON.stringify(input?.r) + ',' + JSON.stringify(input?.c) + ' is outside the 8x8 grid — naming it is not a move (rows 1-8, columns A-H).'
  : 'Square ' + sq(r, c) + ' exists.' };`;

const CHK_R2 = `
${RV}
const r = input?.r, c = input?.c, grid = input?.grid;
const holder = (grid && r >= 0 && r < 8 && c >= 0 && c < 8) ? grid[r][c] : null;
const fired = !!holder;
return { fired, why: fired
  ? 'Square ' + sq(r, c) + ' already holds a ' + (holder === 'B' ? 'BLACK' : 'WHITE') + ' disc — a disc may only be placed on an empty square.'
  : 'Square ' + (r != null ? sq(r, c) : '?') + ' is empty.' };`;

const CHK_R3 = `
${RV}
const grid = input?.grid, r = input?.r, c = input?.c, player = input?.player;
const flips = flipsAt(grid, r, c, player);
if (!flips.length) return { fired: true, flips: [], rays: [],
  why: 'Placing at ' + sq(r, c) + ' brackets no enemy line in any of the 8 directions (R3 needs own...enemy...own with no gaps), so the placement is illegal.' };
const rays = [...new Set(flips.map(f => f.ray))];
return { fired: false, flips, rays,
  why: sq(r, c) + ' brackets ' + flips.length + ' enemy disc' + (flips.length > 1 ? 's' : '') + ' along ' + rays.join('+') + ' — all convert to ' + (player === 'B' ? 'BLACK' : 'WHITE') + '.' };`;

const CHK_R4 = `
${RV}
const grid = input?.grid, player = input?.player;
const n = legalScan(grid, player).length;
return { fired: n === 0, n,
  why: n === 0
    ? (player === 'B' ? 'BLACK' : 'WHITE') + ' has NO legal placement (no square brackets an enemy line) — the turn is a pass; the opponent moves again.'
    : (player === 'B' ? 'BLACK' : 'WHITE') + ' has ' + n + ' legal placement(s) — no pass.' };`;

const CHK_R5 = `
${RV}
const grid = input?.grid, passStreak = input?.passStreak ?? 0;
const full = grid.every(row => row.every(x => x !== ''));
const none = legalScan(grid, 'B').length === 0 && legalScan(grid, 'W').length === 0;
const fired = full || none || passStreak >= 2;
return { fired, full, none,
  why: !fired ? 'The game is still open.'
    : full ? 'The board is FULL (64 discs) — the game ends.'
    : passStreak >= 2 ? 'Two passes in succession — neither side can move — the game ends.'
    : 'Neither side has a legal placement — the game ends.' };`;

const CHK_R6 = `
const grid = input?.grid;
let b = 0, w = 0;
for (const row of grid) for (const x of row) { if (x === 'B') b++; else if (x === 'W') w++; }
const verdict = b === w ? 'draw' : (b > w ? 'B' : 'W');
return { fired: true, b, w, verdict,
  why: 'Final tally: BLACK ' + b + ' - WHITE ' + w + ' — ' + (verdict === 'draw' ? 'a draw.' : (verdict === 'B' ? 'BLACK' : 'WHITE') + ' wins.') };`;

// ── the arbiter ───────────────────────────────────────────────────────────────
const ARBITER = `
// THE REFEREE — knows no rules; it sequences the rule cells and applies
// their effects. Every verdict you see was produced by a rule cell.
${RV}
const seq = input?.seq ?? 0;
const r = input?.r, c = input?.c, player = input?.player;
const last = (await runtime.get('match.seq')).data;
if (seq <= last) return { ok: false, rule: 'DUP', text: 'stale request (seq ' + seq + ' <= ' + last + ') — nothing happened.' };
const done = async (verdict) => {
  const log = (await runtime.get('log.events')).data;
  await runtime.set('log.events', [...log.slice(-199), {
    ts: Date.now(), kind: verdict.ok ? 'apply' : 'refuse', rule: verdict.rule ?? null, seq, text: verdict.text }]);
  await runtime.set('rules.verdict', { ...verdict, seq, ts: Date.now() });
  return verdict;
};

let grid = (await runtime.get('board.grid')).data.map(row => row.slice());
const phase = (await runtime.get('phase.current')).data;
const fired = [];

if (phase !== 'play') {
  const r5 = (await runtime.call('rule.R5.check', { grid, passStreak: 2, seq })).data;
  await runtime.set('rule.R5.verdict', { ...r5, ts: Date.now() });
  await runtime.set('rules.fired', ['R5']);
  return done({ ok: false, rule: 'R5', text: 'Move refused — ' + r5.why });
}

// R1 bounds
const r1 = (await runtime.call('rule.R1.check', { r, c, seq })).data;
await runtime.set('rule.R1.verdict', { ...r1, ts: Date.now() });
fired.push('R1');
if (r1.fired) { await runtime.set('rules.fired', fired); return done({ ok: false, rule: 'R1', text: r1.why }); }

// R2 empty
const r2 = (await runtime.call('rule.R2.check', { r, c, grid, seq })).data;
await runtime.set('rule.R2.verdict', { ...r2, ts: Date.now() });
fired.push('R2');
if (r2.fired) { await runtime.set('rules.fired', fired); return done({ ok: false, rule: 'R2', text: r2.why }); }

// R3 sandwich
const r3 = (await runtime.call('rule.R3.check', { grid, r, c, player, seq })).data;
await runtime.set('rule.R3.verdict', { ...r3, ts: Date.now() });
fired.push('R3');
if (r3.fired) { await runtime.set('rules.fired', fired); return done({ ok: false, rule: 'R3', text: r3.why }); }

// ACCEPTED — apply: placement first, then the flip cascade, ray by ray.
const trace = [{ sq: sq(r, c), from: '', to: player, ray: 'place' }];
await runtime.set('board.r' + (r + 1) + 'c' + (c + 1), player);
grid[r][c] = player;
for (const f of r3.flips) {
  await runtime.set('board.r' + (f.r + 1) + 'c' + (f.c + 1), player);
  grid[f.r][f.c] = player;
  trace.push(f);
}
await runtime.set('board.grid', grid);
await runtime.set('flip.trace', trace);

// TURN + R4 pass + R5 end
const next = opp(player);
let streak = (await runtime.get('pass.streak')).data;
const nextLegal = legalScan(grid, next);
if (nextLegal.length) {
  streak = 0;
  await runtime.set('turn.current', next);
  await runtime.set('rule.R4.verdict', { fired: false, n: nextLegal.length, why: nextLegal.length + ' legal placements for ' + (next === 'B' ? 'BLACK' : 'WHITE') + '.', ts: Date.now() });
} else {
  const curLegal = legalScan(grid, player);
  const r4 = (await runtime.call('rule.R4.check', { grid, player: next, seq })).data;
  await runtime.set('rule.R4.verdict', { ...r4, ts: Date.now() });
  fired.push('R4');
  if (curLegal.length) {
    streak = streak + 1;
    await runtime.set('pass.note', (next === 'B' ? 'BLACK' : 'WHITE') + ' passes — ' + (player === 'B' ? 'BLACK' : 'WHITE') + ' moves again.');
  } else {
    // R5: neither side can move
    const r5 = (await runtime.call('rule.R5.check', { grid, passStreak: streak + 2, seq })).data;
    await runtime.set('rule.R5.verdict', { ...r5, ts: Date.now() });
    fired.push('R5');
    const r6 = (await runtime.call('rule.R6.check', { grid, seq })).data;
    await runtime.set('rule.R6.verdict', { ...r6, ts: Date.now() });
    fired.push('R6');
    await runtime.set('rules.fired', fired);
    await runtime.set('phase.current', 'over');
    await runtime.set('winner.current', r6.verdict);
    await runtime.set('pass.streak', 0);
    await runtime.set('match.seq', seq);
    return done({ ok: true, rule: 'R5', text: r5.why + ' ' + r6.why, fired, trace });
  }
}

// R5 after every move: board full?
const r5b = (await runtime.call('rule.R5.check', { grid, passStreak: streak, seq })).data;
await runtime.set('rule.R5.verdict', { ...r5b, ts: Date.now() });
if (r5b.fired) {
  fired.push('R5');
  const r6 = (await runtime.call('rule.R6.check', { grid, seq })).data;
  await runtime.set('rule.R6.verdict', { ...r6, ts: Date.now() });
  fired.push('R6');
  await runtime.set('rules.fired', fired);
  await runtime.set('phase.current', 'over');
  await runtime.set('winner.current', r6.verdict);
  await runtime.set('pass.streak', 0);
  await runtime.set('match.seq', seq);
  return done({ ok: true, rule: 'R5', text: r5b.why + ' ' + r6.why, fired, trace });
}

await runtime.set('pass.streak', streak);
await runtime.set('match.seq', seq);
await runtime.set('rules.fired', fired);
return done({ ok: true, rule: 'R3', text: r3.why + ' ' + (nextLegal.length ? 'Turn: ' + (next === 'B' ? 'BLACK' : 'WHITE') + '.' : ''), fired, trace });`;

const DISPATCH = `
// push trampoline: listener passes {changed, value}; driver may pass the
// request directly. Both converge on the same arbitration.
const ev = input ?? {};
let req = null;
if (ev.r != null) req = ev;
else if (ev.value?.r != null) req = ev.value;
else if (caller?.metadata?.current?.r != null) req = caller.metadata.current;
else req = (await runtime.get('move.request')).data;
if (!req || req.r == null) return { skipped: true };
return (await runtime.call('move.arbiter', req)).data;`;

// ── legal moves / scoring ─────────────────────────────────────────────────────
const LEGAL = `
${RV}
const grid = (await runtime.get('board.grid')).data;
const phase = (await runtime.get('phase.current')).data;
const player = input?.player ?? (await runtime.get('turn.current')).data;
if (phase !== 'play') return [];
return legalScan(grid, player);`;

// ── AI: features + choose (weights come from a cell => learnable) ────────────
const FEATURES = `
${RV}
// feature vector of a CANDIDATE move, evaluated on the position AFTER playing
// it. Scaled to roughly [-2, 2] so one learning rate fits all.
const grid = input?.grid, r = input?.r, c = input?.c, player = input?.player;
const g2 = grid.map(row => row.slice());
for (const f of flipsAt(g2, r, c, player)) g2[f.r][f.c] = player;
g2[r][c] = player;
const corners = [[0,0],[0,7],[7,0],[7,7]];
const isCorner = corners.some(([a, b]) => a === r && b === c) ? 1 : 0;
const isX = corners.some(([a, b]) => Math.abs(a - r) === 1 && Math.abs(b - c) === 1) ? 1 : 0;
const isEdge = (r === 0 || r === 7 || c === 0 || c === 7) && !isCorner ? 1 : 0;
const mobility = legalScan(g2, opp(player)).length / 10;      // enemy options after my move (lower is better -> weight goes negative)
let frontier = 0;
for (let rr = 0; rr < 8; rr++) for (let cc = 0; cc < 8; cc++) {
  if (g2[rr][cc] !== player) continue;
  for (const d of DIRS) { const a = rr + d[0], b = cc + d[1];
    if (a >= 0 && a < 8 && b >= 0 && b < 8 && g2[a][b] === '') { frontier++; break; } }
}
const f = { corner: isCorner, x: isX, edge: isEdge, mobility: mobility, frontier: frontier / 10 };
return { f, gridAfter: g2 };`;

const CHOOSE = `
${RV}
${SNIPPETS.rng}
// score every legal move: dot(weights, features); epsilon among top-3.
const grid = (await runtime.get('board.grid')).data;
const player = input?.player ?? (await runtime.get('turn.current')).data;
const weights = input?.weights ?? (await runtime.get('ai.weights')).data;
const seed = input?.seed ?? 1;
const phase = (await runtime.get('phase.current')).data;
if (phase !== 'play') return null;
const legal = legalScan(grid, player);
if (!legal.length) return { pass: true, player };
const scored = [];
for (const m of legal) {
  const { f } = (await runtime.call('ai.features', { grid, r: m.r, c: m.c, player, seq: seed + ':' + m.sq })).data;
  let s = 0; for (const k of Object.keys(weights)) s += (weights[k] ?? 0) * (f[k] ?? 0);
  scored.push({ ...m, score: Math.round(s * 1000) / 1000, f });
}
scored.sort((a, b) => b.score - a.score);
const rnd = rng(seed * 7919 + r2s(grid));
const top = scored.slice(0, Math.min(3, scored.length));
const pick = rnd() < 0.75 ? top[0] : top[Math.floor(rnd() * top.length)];
return { ...pick, player, considered: scored.length,
  why: player + ' plays ' + pick.sq + ' (score ' + pick.score + ', weights ' + JSON.stringify(weights) + ')' };
function r2s(g) { let h = 0; for (const row of g) for (const x of row) h = (h * 31 + (x === 'B' ? 1 : x === 'W' ? 2 : 0)) | 0; return h >>> 0; }`;

// ── learning loop: averaged perceptron + witness receipts ────────────────────
const LEARN = `
${SNIPPETS.witness}
// learn.update input {side} — the learner's colour for the finished game.
// Averaged perceptron: theta_i += alpha * result * f_i for each logged move.
const side = input?.side ?? 'B';
const winner = (await runtime.get('winner.current')).data;
const s = winner === 'draw' ? 0 : (winner === side ? 1 : -1);
const alpha = (await runtime.get('learn.alpha')).data;
const moves = (await runtime.get('ai.move_log')).data;
const theta = { ...(await runtime.get('ai.weights')).data };
for (const f of moves) for (const k of Object.keys(theta))
  theta[k] = Math.max(-6, Math.min(6, theta[k] + alpha * s * (f[k] ?? 0)));
const gen = (await runtime.get('learn.gen')).data + 1;
await runtime.set('ai.weights', theta);
await runtime.set('learn.gen', gen);
// win rate over the last 10 receipts where the learner played this side
const receipts = (await runtime.get('learn.receipts')).data;
const hist = receipts.filter(x => x.side === side).slice(0, 9);
const wins = (s > 0 ? 1 : 0) + hist.filter(x => x.result === 'W').length;
const rate = Math.round(((wins / (hist.length + 1)) * 100));
const prev = receipts.length ? receipts[receipts.length - 1].row_hash : GENESIS_PREV;
const fields = { seq: gen, side, result: s > 0 ? 'W' : s < 0 ? 'L' : 'D',
  score_b: (await runtime.get('score.b')).data, score_w: (await runtime.get('score.w')).data,
  theta_hash: fnv1a64(canon(theta)), win_rate10: rate };
const row = { ...fields, prev_hash: prev, row_hash: fnv1a64(canon({ ...fields, prev_hash: prev })) };
await runtime.set('learn.receipts', [...receipts, row]);
await runtime.set('ai.move_log', []);
await runtime.set('learn.last', { gen, theta, receipt: row });
return { gen, theta, result: row.result, win_rate10: rate, receipt: row };`;

const MATCH_STEP = `
// one AI ply for whoever is to move. input {weights?, seed?, log?}
// log=true appends the chosen move's features to ai.move_log (the learner).
// Passes never reach here in a normal loop: the arbiter's R4 keeps the turn
// with the mover after a pass, and R5 closes the game when both are stuck.
const phase = (await runtime.get('phase.current')).data;
if (phase !== 'play') return { over: true };
const player = (await runtime.get('turn.current')).data;
const choice = (await runtime.call('ai.choose', { player, weights: input?.weights, seed: input?.seed ?? 1 })).data;
if (!choice || choice.pass) {
  // In a normal loop this is unreachable: the arbiter's R4 keeps the turn with
  // the mover after a pass, and R5 closes the game when both sides are stuck.
  // Returned defensively if a driver ever calls match.step on a stuck side.
  return { pass: true, player };
}
if (input?.log) {
  const log = (await runtime.get('ai.move_log')).data;
  await runtime.set('ai.move_log', [...log, choice.f]);
}
// NOTE: match.seq is owned by the arbiter (it bumps it on acceptance and its
// DUP guard compares against it) — match.step must NOT pre-increment it.
return (await runtime.call('move.arbiter', { r: choice.r, c: choice.c, player, seq: (await runtime.get('match.seq')).data + 1 })).data;`;

const NEW_GAME = `
for (let r = 1; r <= 8; r++) for (let c = 1; c <= 8; c++)
  await runtime.set('board.r' + r + 'c' + c, '');
const g = [];
for (let r = 0; r < 8; r++) { const row = []; for (let c = 0; c < 8; c++) row.push(''); g.push(row); }
g[3][3] = 'W'; g[4][4] = 'W'; g[3][4] = 'B'; g[4][3] = 'B';
for (const [rr, cc, p] of [[3,3,'W'],[4,4,'W'],[3,4,'B'],[4,3,'B']])
  await runtime.set('board.r' + (rr + 1) + 'c' + (cc + 1), p);
await runtime.set('board.grid', g);
await runtime.set('turn.current', 'B');
await runtime.set('phase.current', 'play');
await runtime.set('winner.current', null);
await runtime.set('pass.streak', 0);
await runtime.set('pass.note', '');
await runtime.set('flip.trace', []);
for (const n of ['R1','R2','R3','R4','R5','R6']) await runtime.set('rule.' + n + '.verdict', null);
await runtime.set('rules.fired', []);
await runtime.set('rules.verdict', null);
await runtime.set('match.seq', 0);
await runtime.set('move.request', null);
await runtime.set('ai.move_log', []);
const log = (await runtime.get('log.events')).data;
await runtime.set('log.events', [...log.slice(-199), { ts: Date.now(), kind: 'new_game', text: 'board reset — BLACK to move' }]);
return { ok: true };`;

export const INITIAL_LEGAL = ['D3', 'C4', 'F5', 'E6'];

export function buildSheet() {
  const cells = [];
  cells.push(v('rules.book', BOOK, 'the complete ruleset; every clause is ported 1:1 to a rule.N.check cell'));
  for (const [n, clause] of [
    ['R1', 'R1 (bounds): squares outside the 8x8 grid do not exist; naming one is not a move.'],
    ['R2', 'R2 (empty): a disc may only be placed on an empty square.'],
    ['R3', 'R3 (sandwich): own...enemy*...own with no gaps converts every bracketed enemy disc; no bracket = illegal.'],
    ['R4', 'R4 (pass): a player with no legal placement passes; the opponent moves again.'],
    ['R5', 'R5 (end): full board or neither side able to move closes the game.'],
    ['R6', 'R6 (score): one point per own disc; higher wins, equal draws.'],
  ]) {
    cells.push(law(`rule.${n}.law`, clause, `clause ${n} quoted from rules.book`));
    cells.push(v(`rule.${n}.verdict`, null, `last evaluation of clause ${n} (rule-bubble UI reads this)`));
  }
  cells.push(v('rules.fired', [], 'clauses that came into play for the last action'));
  cells.push(v('rules.verdict', null, 'master verdict of the last pushed move'));

  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
    cells.push(v(`board.r${r + 1}c${c + 1}`, '', `square ${sqName(r, c)}: '' | B | W`));
  const g0 = [];
  for (let r = 0; r < 8; r++) { const row = []; for (let c = 0; c < 8; c++) row.push(''); g0.push(row); }
  g0[3][3] = 'W'; g0[4][4] = 'W'; g0[3][4] = 'B'; g0[4][3] = 'B';
  cells.push(v('board.grid', g0, 'mirror of the 64 board cells (set by the arbiter in the same pass)'));
  cells.push(v('flip.trace', [], 'the exact placement+flip sequence of the last accepted move (cascade animation reads this)'));
  cells.push(prog('legal.moves', LEGAL, 'R1+R2+R3 scan for the side to move (hints, AI, R4/R5)', ['board.grid', 'turn.current', 'phase.current']));

  cells.push(v('turn.current', 'B', 'B | W'));
  cells.push(v('phase.current', 'play', 'play | over'));
  cells.push(v('winner.current', null, 'B | W | draw | null'));
  cells.push(v('pass.streak', 0, 'consecutive passes (R5 uses >= 2)'));
  cells.push(v('pass.note', '', 'latest pass announcement (R4)'));
  cells.push(v('match.seq', 0, 'monotonic request sequence'));
  cells.push(formula('score.b', `board.grid.flat().filter(x => x === 'B').length`, 'BLACK discs — live'));
  cells.push(formula('score.w', `board.grid.flat().filter(x => x === 'W').length`, 'WHITE discs — live'));

  cells.push(prog('rule.R1.check', CHK_R1, 'R1 port: bounds', []));
  cells.push(prog('rule.R2.check', CHK_R2, 'R2 port: empty square', []));
  cells.push(prog('rule.R3.check', CHK_R3, 'R3 port: sandwich + exact flip list', []));
  cells.push(prog('rule.R4.check', CHK_R4, 'R4 port: no legal placement = pass', []));
  cells.push(prog('rule.R5.check', CHK_R5, 'R5 port: full board / neither can move', []));
  cells.push(prog('rule.R6.check', CHK_R6, 'R6 port: tally + verdict', []));

  cells.push(prog('move.arbiter', ARBITER, 'THE REFEREE — sequences rule cells, applies the flip cascade, keeps the ledger', ['move.request']));
  cells.push(prog('move.dispatch', DISPATCH, 'push trampoline: move.request -> move.arbiter', ['move.request']));
  cells.push(listenerCell('move.push', ['move.request'], 'move.dispatch', null,
    'push of one value drives the whole cascade'));
  cells.push(v('move.request', null, 'UI writes {r,c,player,seq} here — the entire input surface'));

  cells.push(v('ai.weights', { corner: 0, x: 0, edge: 0, mobility: -1, frontier: 0 },
    'learner policy weights (theta) — updated by learn.update, displayed as a bar strip'));
  cells.push(v('ai.fixed_weights', { corner: 3, x: -1, edge: 1, mobility: -0.5, frontier: -0.2 },
    'frozen baseline opponent weights (never learns — the control group)'));
  cells.push(v('ai.move_log', [], "feature vectors of the learner's moves this game (consumed by learn.update)"));
  cells.push(prog('ai.features', FEATURES, 'feature vector of a candidate move (pure)', []));
  cells.push(prog('ai.choose', CHOOSE, 'score legal moves by dot(theta, features); seeded tie-break', ['board.grid', 'turn.current', 'phase.current', 'ai.weights']));

  cells.push(v('learn.alpha', 0.04, 'perceptron learning rate'));
  cells.push(v('learn.gen', 0, 'generations learned so far'));
  cells.push(v('learn.receipts', [], 'fnv1a64 hash-chained witness receipts: one per generation'));
  cells.push(v('learn.last', null, 'snapshot of the latest update'));
  cells.push(prog('learn.update', LEARN, 'perceptron update + witness receipt (call once per finished game)', ['winner.current', 'score.b', 'score.w', 'ai.move_log', 'ai.weights']));

  cells.push(prog('match.step', MATCH_STEP, 'one AI ply (input {weights?, seed?, log?}); loop it for computer-vs-computer', ['phase.current', 'turn.current', 'ai.weights']));
  cells.push(prog('new_game', NEW_GAME, 'reset the board, keep the learning ledger', ['board.grid']));

  cells.push(v('log.events', [], 'append-only audit: pushes, refusals, flips, passes, resets (cap 200)'));
  return { id: 'reversi', title: 'Quilt Arcade — Reversi (rules-as-cells + learning loop)', cells };
}
