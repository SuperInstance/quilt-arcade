// TIC-TAC-TOE — the smallest complete quilt-arcade game.
//
// This sheet is the TEMPLATE for the arcade's architecture:
//
//   rules.book        one value cell holding the complete ruleset in precise,
//                     numbered natural language (the "game-mechanics cell")
//   rule.N.law        the quoted clause — the rule as written
//   rule.N.check      a first-class program cell: the machine port of that
//                     clause. Pure: (input) -> {fired, why, squares?}
//   rule.N.verdict    the record of the clause's last evaluation (bubbles read this)
//   move.arbiter      the referee — it does NOT know any rules itself; it only
//                     SEQUENCES the rule cells and applies their effects
//   move.push         listener: a push of one value (move.request) drives it
//   match.step        one AI ply (so a driver can "press play")
//
// If you are porting a new game (checkers, go, chess), copy this shape.
// See ../../PATTERNS.md.

import { v, law, prog, formula, listenerCell } from '../../shared/kit.mjs';

const COLS = 'ABC';
export const sqName = (r, c) => COLS[c] + (r + 1);

// ── rules.book: the game-mechanics cell ──────────────────────────────────────
const BOOK = `TIC-TAC-TOE — RULEBOOK v1

R1 (bounds)      A mark is placed by naming a square (row 1-3, column A-C).
                 A square outside the 3x3 grid does not exist; naming one is
                 not a move. The board is unchanged.

R2 (empty)       A mark may only be placed on an EMPTY square. A square that
                 already holds X or O is closed to both players for the rest
                 of the game.

R3 (three-in-row) If after placing a mark the player owns three squares in a
                 straight line (row, column, or diagonal), the player wins and
                 the board is closed. The winning line is exactly the three
                 squares named by the rule check.

R4 (draw/closure) If every square holds a mark and no player owns a line, the
                 game is a draw and the board is closed. A closed board
                 accepts no further moves; any attempted move is refused and
                 changes nothing.

TURN (derived)   X moves first. After every accepted move, the turn passes to
                 the other player. Refused moves do not pass the turn.`;

// lines through the board, as [r,c] triplets
const LINES = [
  [[0,0],[0,1],[0,2]], [[1,0],[1,1],[1,2]], [[2,0],[2,1],[2,2]],
  [[0,0],[1,0],[2,0]], [[0,1],[1,1],[2,1]], [[0,2],[1,2],[2,2]],
  [[0,0],[1,1],[2,2]], [[0,2],[1,1],[2,0]],
];

// checker code fragments (each checker is PURE — arbiter records its verdicts)
const CHK_R1 = `
const r = input?.r, c = input?.c;
const fired = !(Number.isInteger(r) && r >= 0 && r < 3 && Number.isInteger(c) && c >= 0 && c < 3);
return { fired, why: fired
  ? 'Square ' + String(r) + ',' + String(c) + ' is outside the 3x3 grid — naming it is not a move (row 1-3, column A-C only).'
  : 'Square ' + 'ABC'[c] + (r+1) + ' exists.' };`;

const CHK_R2 = `
const r = input?.r, c = input?.c, grid = input?.grid;
const holder = (grid && r >= 0 && r < 3 && c >= 0 && c < 3) ? grid[r][c] : null;
const fired = !!holder;
return { fired, why: fired
  ? 'Square ' + 'ABC'[c] + (r+1) + ' already holds ' + holder + ' — a mark may only be placed on an empty square.'
  : 'Square ' + (r != null ? 'ABC'[c] + (r+1) : '?') + ' is empty.' };`;

const CHK_R3 = `
const grid = input?.grid, r = input?.r, c = input?.c, player = input?.player;
const LINES = ${JSON.stringify(LINES)};
const sq = ([a,b]) => 'ABC'[b] + (a+1);
for (const line of LINES) {
  if (!line.some(([a,b]) => a === r && b === c)) continue;
  if (line.every(([a,b]) => grid[a][b] === player)) {
    return { fired: true, line: line.map(sq),
      why: player + ' owns three in a row: ' + line.map(sq).join(' - ') + '. ' + player + ' wins and the board is closed.' };
  }
}
return { fired: false, why: 'No completed line passes through ' + 'ABC'[c] + (r+1) + '.' };`;

const CHK_R4 = `
const grid = input?.grid;
const full = grid.every(row => row.every(x => x !== ''));
const played = input?.played ?? false;
const fired = played && full;
return { fired, why: full
  ? (fired ? 'Every square holds a mark and no line was completed — the game is a draw and the board is closed.'
           : 'Board is full and closed.')
  : 'Board is still open.' };`;

// ── the arbiter: sequences rule cells, applies effects, keeps the ledger ────
const ARBITER = `
// THE REFEREE — knows no rules itself; it runs the rule cells in clause order.
// Every checker is invoked through runtime.call so the rules stay first-class,
// inspectable cells (try engine.call('rule.R2.check', {r,c,grid,seq}) yourself).
const seq = input?.seq ?? 0;
const r = input?.r, c = input?.c, player = input?.player;
const done = input?.done ?? (async (verdict) => {
  const log = (await runtime.get('log.events')).data;
  await runtime.set('log.events', [...log.slice(-199), {
    ts: Date.now(), kind: verdict.ok ? 'apply' : 'refuse', rule: verdict.rule ?? null,
    seq, text: verdict.text }]);
  await runtime.set('rules.verdict', { ...verdict, seq, ts: Date.now() });
  return verdict;
});
const last = (await runtime.get('match.seq')).data;
if (seq <= last) return { ok: false, rule: 'DUP', text: 'stale request (seq ' + seq + ' <= ' + last + ') — nothing happened.' };
const grid = (await runtime.get('board.grid')).data.map(row => row.slice());
const phase = (await runtime.get('phase.current')).data;
const fired = [];

if (phase !== 'play') {
  const r4 = (await runtime.call('rule.R4.check', { grid, played: true, seq })).data;
  await runtime.set('rule.R4.verdict', { ...r4, ts: Date.now() });
  fired.push('R4');
  await runtime.set('rules.fired', fired);
  return done({ ok: false, rule: 'R4', text: 'Move refused — ' + r4.why });
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

// R2 accepted -> apply the placement (cells cascade: this cell, the mirror, scores)
await runtime.set('board.r' + (r+1) + 'c' + (c+1), player);
grid[r][c] = player;
await runtime.set('board.grid', grid);

// R3 three-in-row
const r3 = (await runtime.call('rule.R3.check', { grid, r, c, player, seq })).data;
await runtime.set('rule.R3.verdict', { ...r3, ts: Date.now() });
if (r3.fired) {
  fired.push('R3');
  await runtime.set('rules.fired', fired);
  await runtime.set('phase.current', 'over');
  await runtime.set('winner.current', player);
  await runtime.set('winner.line', r3.line);
  await runtime.set('match.seq', seq);
  return done({ ok: true, rule: 'R3', text: r3.why, fired, line: r3.line });
}

// R4 draw
const r4 = (await runtime.call('rule.R4.check', { grid, played: true, seq })).data;
await runtime.set('rule.R4.verdict', { ...r4, ts: Date.now() });
if (r4.fired) {
  fired.push('R4');
  await runtime.set('rules.fired', fired);
  await runtime.set('phase.current', 'over');
  await runtime.set('winner.current', 'draw');
  await runtime.set('match.seq', seq);
  return done({ ok: true, rule: 'R4', text: r4.why, fired });
}

// TURN passes
await runtime.set('turn.current', player === 'X' ? 'O' : 'X');
await runtime.set('match.seq', seq);
await runtime.set('rules.fired', fired);
return done({ ok: true, rule: 'TURN', text: player + ' placed ' + 'ABC'[c] + (r+1) + '. ' + (player === 'X' ? 'O' : 'X') + ' to move.', fired });`;

const DISPATCH = `
// trampoline: the push of one value lands here; stale/empty pushes are ignored.
// The listener passes {changed, value} as input; a driver may pass the request
// itself. Both converge on the same arbitration.
const ev = input ?? {};
let req = null;
if (ev.r != null) req = ev;
else if (ev.value?.r != null) req = ev.value;
else if (caller?.metadata?.current?.r != null) req = caller.metadata.current;
else req = (await runtime.get('move.request')).data;
if (!req || req.r == null) return { skipped: true };
return (await runtime.call('move.arbiter', req)).data;`;

const NEW_GAME = `
for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++)
  await runtime.set('board.r' + r + 'c' + c, '');
await runtime.set('board.grid', [['','',''],['','',''],['','','']]);
await runtime.set('turn.current', 'X');
await runtime.set('phase.current', 'play');
await runtime.set('winner.current', null);
await runtime.set('winner.line', null);
for (const n of ['R1','R2','R3','R4']) await runtime.set('rule.' + n + '.verdict', null);
await runtime.set('rules.fired', []);
await runtime.set('rules.verdict', null);
await runtime.set('match.seq', 0);
await runtime.set('move.request', null);
const log = (await runtime.get('log.events')).data;
await runtime.set('log.events', [...log.slice(-199), { ts: Date.now(), kind: 'new_game', text: 'board reset — X to move' }]);
return { ok: true };`;

const MINIMAX = `
// PERFECT PLAY — full minimax over the 3x3 tree (memoized). Cannot lose.
const me = input?.player ?? (await runtime.get('turn.current')).data;
const grid = (await runtime.get('board.grid')).data.map(row => row.slice());
const LINES = ${JSON.stringify(LINES)};
const winnerOf = (g) => { for (const l of LINES) { const w = g[l[0][0]][l[0][1]];
  if (w && w === g[l[1][0]][l[1][1]] && w === g[l[2][0]][l[2][1]]) return w; } return null; };
const empties = (g) => { const out = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (!g[r][c]) out.push([r, c]); return out; };
const memo = new Map();
function best(g, turn) {
  const w = winnerOf(g);
  if (w) return { score: w === me ? 1 : -1 };
  const em = empties(g);
  if (!em.length) return { score: 0 };
  const k = g.flat().map(x => x || '.').join('') + turn;  // '.' guards empties: join('') would make distinct positions collide
  if (memo.has(k)) return memo.get(k);
  let bv = turn === me ? -2 : 2, bm = null;
  for (const [r, c] of em) {
    g[r][c] = turn;
    const s = best(g, turn === 'X' ? 'O' : 'X').score;
    g[r][c] = '';
    if (turn === me ? s > bv : s < bv) { bv = s; bm = [r, c]; }
  }
  const out = { score: bv, r: bm ? bm[0] : null, c: bm ? bm[1] : null };
  memo.set(k, out); return out;
}
const b = best(grid, me);
return { r: b.r, c: b.c, score: b.score, player: me,
  reason: 'minimax: perfect play (score ' + b.score + ' from ' + me + ') — 1 win / 0 draw / -1 loss' };`;

const MATCH_STEP = `
// one AI ply — a driver calling this repeatedly plays a full game
const phase = (await runtime.get('phase.current')).data;
if (phase !== 'play') return { over: true };
const player = (await runtime.get('turn.current')).data;
const best = (await runtime.call('ai.minimax', { player })).data;
if (best.r == null) return { over: true };
// NOTE: match.seq is owned by the arbiter (DUP guard + acceptance bump).
return (await runtime.call('move.arbiter', { r: best.r, c: best.c, player, seq: (await runtime.get('match.seq')).data + 1 })).data;`;

const LEGAL = `
// legal squares (R1+R2 applied): for hints and for drivers that sample moves
const grid = (await runtime.get('board.grid')).data;
const phase = (await runtime.get('phase.current')).data;
if (phase !== 'play') return [];
const out = [];
for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (!grid[r][c]) out.push({ r, c, sq: 'ABC'[c] + (r+1) });
return out;`;

export function buildSheet() {
  const cells = [];

  // rules.book — the game-mechanics cell
  cells.push(v('rules.book', BOOK, 'the complete ruleset in precise language; every clause is ported 1:1 to a rule.N.check cell'));
  for (const [n, clause] of [
    ['R1', 'R1 (bounds): a square outside the 3x3 grid does not exist; naming one is not a move.'],
    ['R2', 'R2 (empty): a mark may only be placed on an empty square.'],
    ['R3', 'R3 (three-in-row): three own squares in a straight line wins and closes the board.'],
    ['R4', 'R4 (draw/closure): full board with no line is a draw; closed boards refuse all moves.'],
  ]) {
    cells.push(law(`rule.${n}.law`, clause, `clause ${n} as written (quoted from rules.book)`));
    cells.push(v(`rule.${n}.verdict`, null, `last evaluation of clause ${n} — bubbles/flash UI reads this`));
  }
  cells.push(v('rules.fired', [], 'clauses that came into play for the last action'));
  cells.push(v('rules.verdict', null, 'master verdict of the last pushed move'));

  // board
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    cells.push(v(`board.r${r + 1}c${c + 1}`, '', `square ${sqName(r, c)}: '' | X | O`));
  cells.push(v('board.grid', [['','',''],['','',''],['','','']], 'mirror of the 9 board cells (set by the arbiter in the same pass)'));
  cells.push(prog('legal.moves', LEGAL, 'squares R1+R2 currently allow', ['board.grid', 'phase.current']));

  // turn / phase / scoring
  cells.push(v('turn.current', 'X', 'whose turn'));
  cells.push(v('phase.current', 'play', 'play | over'));
  cells.push(v('winner.current', null, 'X | O | draw | null'));
  cells.push(v('winner.line', null, 'winning squares (R3) for highlighting'));
  cells.push(v('match.seq', 0, 'monotonic move sequence — makes every arbiter call a distinct capability'));
  cells.push(formula('score.x', `board.grid.flat().filter(x => x === 'X').length`, 'X marks on the board'));
  cells.push(formula('score.o', `board.grid.flat().filter(x => x === 'O').length`, 'O marks on the board'));

  // rule checkers — the machine ports
  cells.push(prog('rule.R1.check', CHK_R1, 'R1 port: bounds', []));
  cells.push(prog('rule.R2.check', CHK_R2, 'R2 port: empty square', []));
  cells.push(prog('rule.R3.check', CHK_R3, 'R3 port: three-in-row through the placed square', []));
  cells.push(prog('rule.R4.check', CHK_R4, 'R4 port: draw / closure', []));

  // referee + push wiring
  cells.push(prog('move.arbiter', ARBITER, 'THE REFEREE — sequences rule cells, applies effects, keeps the ledger', ['move.request']));
  cells.push(prog('move.dispatch', DISPATCH, 'push trampoline: move.request -> move.arbiter (idempotent per seq)', ['move.request']));
  cells.push(listenerCell('move.push', ['move.request'], 'move.dispatch', null,
    'the push of one value: watching move.request drives the whole cascade'));
  cells.push(v('move.request', null, 'UI writes {r,c,player,seq} here — that push is the entire input surface'));

  // AI + match driver
  cells.push(prog('ai.minimax', MINIMAX, 'perfect play (memoized minimax)', ['board.grid', 'turn.current', 'phase.current']));
  cells.push(prog('match.step', MATCH_STEP, 'one AI ply; a driver calls this until it returns {over:true}', ['phase.current', 'turn.current']));
  cells.push(prog('new_game', NEW_GAME, 'reset the board (logs the reset)', ['board.grid']));

  // ledger
  cells.push(v('log.events', [], 'append-only audit: every push, refusal, win, reset (cap 200)'));

  return { id: 'tictactoe', title: 'Quilt Arcade — TicTacToe (the template game)', cells };
}
