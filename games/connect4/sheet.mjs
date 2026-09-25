// CONNECT FOUR — gravity as a rule cell, threats as a bubble, learnable policy.
//
// Same architecture as reversi (see ../reversi/sheet.mjs and ../../PATTERNS.md):
// rules.book -> rule.N.law/.check/.verdict -> move.arbiter (pure sequencer) ->
// push listener -> cascade. Learning: averaged perceptron on cell-held theta,
// witness receipt per game.

import { v, law, prog, formula, listenerCell, SNIPPETS } from '../../shared/kit.mjs';

const COLS = 'ABCDEFG';
export const sqName = (r, c) => COLS[c] + (r + 1);
const AXES = [[0, 1], [1, 0], [1, 1], [1, -1]];

const C4 = `
const COLS = 'ABCDEFG';
const ROWS = 6, NCOLS = 7;
const sq = (r, c) => COLS[c] + (r + 1);
const opp = (p) => p === 'B' ? 'W' : 'B';
const AXES = ${JSON.stringify(AXES)};
// R3 port: the lowest empty row of a column (-1 = full)
const dropRow = (grid, c) => { for (let r = ROWS - 1; r >= 0; r--) if (grid[r][c] === '') return r; return -1; };
// R4 port: the contiguous own run through (r,c) if it reaches 4 — returns the squares
const winLine = (grid, r, c, p) => {
  for (const d of AXES) {
    const cells = [[r, c]];
    for (const s of [1, -1]) {
      let rr = r + s * d[0], cc = c + s * d[1];
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < NCOLS && grid[rr][cc] === p) { cells.push([rr, cc]); rr += s * d[0]; cc += s * d[1]; }
    }
    if (cells.length >= 4)
      return cells.map(([a, b]) => ({ r: a, c: b, sq: sq(a, b) }))
        .sort((x, y) => (x.r - y.r) || (x.c - y.c));
  }
  return null;
};
// every 4-window through (r,c): [own, enemy, empty] counts after a sim drop
const windowsThrough = (grid, r, c, p) => {
  const out = [];
  for (const d of AXES) for (let s = -3; s <= 0; s++) {
    const w = [];
    for (let i = 0; i < 4; i++) {
      const rr = r + (s + i) * d[0], cc = c + (s + i) * d[1];
      if (rr < 0 || rr >= ROWS || cc < 0 || cc >= NCOLS) { w.push('X'); continue; }
      w.push(grid[rr][cc]);
    }
    if (!w.includes('X')) out.push(w);
  }
  return out;
};`;

// ── rules.book ────────────────────────────────────────────────────────────────
const BOOK = `CONNECT FOUR — RULEBOOK v1

R1 (column)      A disc is played by naming a COLUMN (A-G). A drop that does
                 not name an existing column is not a move; the board is
                 unchanged.

R2 (full)        A column holding 6 discs is FULL and accepts no further
                 disc. Playing a full column is refused and the board is
                 unchanged.

R3 (gravity)     A played disc FALLS to the lowest empty square of its
                 column (row 6 first). The disc never stops mid-column and
                 never moves sideways. Every accepted play names its landing
                 square.

R4 (connect)     If after landing the mover owns FOUR (or more) discs in a
                 straight line — horizontal, vertical, or either diagonal —
                 the mover wins and the board is closed. The rule names the
                 exact squares of the line.

R5 (draw)        If all 42 squares hold discs and no line was completed, the
                 game is a draw and the board is closed. A closed board
                 refuses every move.

R6 (threat)      ADVISORY: after every accepted play the sheet reports, for
                 the side to move, every column that would win the game
                 immediately (WIN NOW), and every column the OPPONENT would
                 win immediately if given the turn (MUST BLOCK). Threats do
                 not change the game; they are announced.

TURN (derived)   Black moves first; turns alternate strictly. Refused moves
                 never consume the turn.`;

const CHK_R1 = `
${C4}
const c = input?.c;
const fired = !(Number.isInteger(c) && c >= 0 && c < NCOLS);
return { fired, why: fired
  ? 'Column ' + JSON.stringify(input?.c) + ' does not exist — play names a column A-G.'
  : 'Column ' + COLS[c] + ' exists and accepts a disc.' };`;

const CHK_R2 = `
${C4}
const c = input?.c, grid = input?.grid;
const row = dropRow(grid, c);
const fired = row === -1;
return { fired, row, why: fired
  ? 'Column ' + COLS[c] + ' is FULL (6 discs) — it accepts no further disc.'
  : 'Column ' + COLS[c] + ' has room; the disc lands at ' + sq(row, c) + '.' };`;

const CHK_R3 = `
${C4}
// gravity is not a prohibition but the EFFECT of acceptance — this checker
// names the landing square the arbiter must use.
const c = input?.c, grid = input?.grid;
const row = dropRow(grid, c);
return { fired: true, row,
  why: row >= 0 ? 'The disc falls to ' + sq(row, c) + ' (lowest empty square of column ' + COLS[c] + ').'
                : 'No landing square — the column is full.' };`;

const CHK_R4 = `
${C4}
const grid = input?.grid, r = input?.r, c = input?.c, player = input?.player;
const line = winLine(grid, r, c, player);
if (!line) return { fired: false, line: null, why: 'No four-in-line through ' + sq(r, c) + ' yet.' };
return { fired: true, line: line.map(x => x.sq),
  why: (player === 'B' ? 'BLACK' : 'WHITE') + ' owns four in a line: ' + line.map(x => x.sq).join(' - ') + '. Game over.' };`;

const CHK_R5 = `
${C4}
const grid = input?.grid;
let n = 0;
for (const row of grid) for (const x of row) if (x !== '') n++;
const fired = n === ROWS * NCOLS;
return { fired, n,
  why: fired ? 'All 42 squares hold discs and no line was completed — the game is a draw.'
             : 'Board holds ' + n + '/42 discs.' };`;

const CHK_R6 = `
${C4}
// ADVISORY: scan all columns for immediate wins for either side.
const grid = input?.grid, mover = input?.player;
const winNow = [], mustBlock = [];
for (let c = 0; c < NCOLS; c++) {
  const row = dropRow(grid, c);
  if (row < 0) continue;
  const g2 = grid.map(x => x.slice());
  g2[row][c] = mover;
  if (winLine(g2, row, c, mover)) winNow.push(COLS[c]);
  const g3 = grid.map(x => x.slice());
  g3[row][c] = opp(mover);
  if (winLine(g3, row, c, opp(mover))) mustBlock.push(COLS[c]);
}
const parts = [];
if (winNow.length) parts.push('WIN NOW at column ' + winNow.join(',') + ' — take it.');
if (mustBlock.length) parts.push('MUST BLOCK column ' + mustBlock.join(',') + ' — the opponent wins there next turn.');
return { fired: parts.length > 0, winNow, mustBlock,
  why: parts.length ? parts.join(' ') : 'No immediate threats on the board.' };`;

const ARBITER = `
// THE REFEREE — sequences rule cells, applies gravity, keeps the ledger.
${C4}
const seq = input?.seq ?? 0;
const c = input?.c, player = input?.player;
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
  const r5 = (await runtime.call('rule.R5.check', { grid, seq })).data;
  await runtime.set('rule.R5.verdict', { ...r5, ts: Date.now() });
  await runtime.set('rules.fired', ['R5']);
  return done({ ok: false, rule: 'R5', text: 'Move refused — ' + r5.why });
}

const r1 = (await runtime.call('rule.R1.check', { c, seq })).data;
await runtime.set('rule.R1.verdict', { ...r1, ts: Date.now() });
fired.push('R1');
if (r1.fired) { await runtime.set('rules.fired', fired); return done({ ok: false, rule: 'R1', text: r1.why }); }

const r2 = (await runtime.call('rule.R2.check', { c, grid, seq })).data;
await runtime.set('rule.R2.verdict', { ...r2, ts: Date.now() });
fired.push('R2');
if (r2.fired) { await runtime.set('rules.fired', fired); return done({ ok: false, rule: 'R2', text: r2.why }); }

// ACCEPTED — R3 gravity names the landing square; the arbiter applies it.
const r3 = (await runtime.call('rule.R3.check', { c, grid, seq })).data;
await runtime.set('rule.R3.verdict', { ...r3, ts: Date.now() });
fired.push('R3');
const row = r3.row;
const trace = [{ sq: sq(row, c), from: '', to: player, ray: 'drop', r: row, c }];
await runtime.set('board.r' + (row + 1) + 'c' + (c + 1), player);
grid[row][c] = player;
await runtime.set('board.grid', grid);
await runtime.set('flip.trace', trace);

// R4 connect-four
const r4 = (await runtime.call('rule.R4.check', { grid, r: row, c, player, seq })).data;
await runtime.set('rule.R4.verdict', { ...r4, ts: Date.now() });
if (r4.fired) {
  fired.push('R4');
  await runtime.set('rules.fired', fired);
  await runtime.set('phase.current', 'over');
  await runtime.set('winner.current', player);
  await runtime.set('winner.line', r4.line);
  await runtime.set('match.seq', seq);
  return done({ ok: true, rule: 'R4', text: r4.why, fired, trace, line: r4.line });
}

// R5 draw
const r5 = (await runtime.call('rule.R5.check', { grid, seq })).data;
await runtime.set('rule.R5.verdict', { ...r5, ts: Date.now() });
if (r5.fired) {
  fired.push('R5');
  await runtime.set('rules.fired', fired);
  await runtime.set('phase.current', 'over');
  await runtime.set('winner.current', 'draw');
  await runtime.set('match.seq', seq);
  return done({ ok: true, rule: 'R5', text: r5.why, fired, trace });
}

// R6 advisory threat scan (for the bubble, never blocking)
const r6 = (await runtime.call('rule.R6.check', { grid, player: opp(player), seq })).data;
await runtime.set('rule.R6.verdict', { ...r6, ts: Date.now() });
if (r6.fired) fired.push('R6');

// TURN alternates strictly
await runtime.set('turn.current', opp(player));
await runtime.set('match.seq', seq);
await runtime.set('rules.fired', fired);
const tail = r6.fired ? ' ' + r6.why : '';
return done({ ok: true, rule: 'R3', text: (player === 'B' ? 'BLACK' : 'WHITE') + ' drops ' + COLS[c] + ' -> ' + sq(row, c) + '.' + tail, fired, trace });`;

const DISPATCH = `
const ev = input ?? {};
let req = null;
if (ev.c != null && ev.r == null) req = ev;
else if (ev.value?.c != null) req = ev.value;
else if (caller?.metadata?.current?.c != null) req = caller.metadata.current;
else req = (await runtime.get('move.request')).data;
if (!req || req.c == null) return { skipped: true };
return (await runtime.call('move.arbiter', req)).data;`;

const FEATURES = `
${C4}
// features of dropping in column c (scaled ~[-2, 2])
const grid = input?.grid, c = input?.c, player = input?.player;
const row = dropRow(grid, c);
if (row < 0) return null;
const g2 = grid.map(x => x.slice());
g2[row][c] = player;
const win = winLine(g2, row, c, player) ? 1 : 0;
let mine3 = 0, mine2 = 0;
for (const w of windowsThrough(g2, row, c, player)) {
  const mine = w.filter(x => x === player).length, empty = w.filter(x => x === '').length;
  if (mine === 3 && empty === 1) mine3++;
  if (mine === 2 && empty === 2) mine2++;
}
// opponent threats that remain after my move (anywhere on the board, their turn next)
let theirs3 = 0;
for (let cc = 0; cc < NCOLS; cc++) {
  const rr = dropRow(g2, cc);
  if (rr < 0) continue;
  const g3 = g2.map(x => x.slice());
  g3[rr][cc] = opp(player);
  if (winLine(g3, rr, cc, opp(player))) theirs3++;
}
const giveAway = theirs3 > 0 ? 1 : 0;
const center = (3 - Math.abs(c - 3)) / 3;
return { f: { win, mine3: mine3 / 2, theirs3: theirs3 / 2, center, giveAway }, row };`;

const CHOOSE = `
${C4}
${SNIPPETS.rng}
const grid = (await runtime.get('board.grid')).data;
const player = input?.player ?? (await runtime.get('turn.current')).data;
const weights = input?.weights ?? (await runtime.get('ai.weights')).data;
const seed = input?.seed ?? 1;
const phase = (await runtime.get('phase.current')).data;
if (phase !== 'play') return null;
const scored = [];
for (let c = 0; c < NCOLS; c++) {
  const out = (await runtime.call('ai.features', { grid, c, player, seq: seed + ':' + c })).data;
  if (!out) continue;
  let s = 0; for (const k of Object.keys(weights)) s += (weights[k] ?? 0) * (out.f[k] ?? 0);
  scored.push({ c, col: COLS[c], score: Math.round(s * 1000) / 1000, f: out.f, row: out.row });
}
if (!scored.length) return { pass: true, player };
scored.sort((a, b) => b.score - a.score);
const rnd = rng(seed * 7919 + r2s(grid));
const top = scored.slice(0, Math.min(3, scored.length));
const pick = rnd() < 0.85 ? top[0] : top[Math.floor(rnd() * top.length)];
return { ...pick, player, considered: scored.length,
  why: player + ' drops ' + pick.col + ' (score ' + pick.score + ')' };
function r2s(g) { let h = 0; for (const row of g) for (const x of row) h = (h * 31 + (x === 'B' ? 1 : x === 'W' ? 2 : 0)) | 0; return h >>> 0; }`;

const LEARN = `
${SNIPPETS.witness}
// learn.update input {side} — averaged perceptron + witness receipt.
const side = input?.side ?? 'B';
const winner = (await runtime.get('winner.current')).data;
const s = winner === 'draw' ? 0 : (winner === side ? 1 : -1);
const alpha = (await runtime.get('learn.alpha')).data;
const moves = (await runtime.get('ai.move_log')).data;
const theta = { ...(await runtime.get('ai.weights')).data };
for (const f of moves) for (const k of Object.keys(theta))
  theta[k] = Math.max(-8, Math.min(8, theta[k] + alpha * s * (f[k] ?? 0)));
const gen = (await runtime.get('learn.gen')).data + 1;
await runtime.set('ai.weights', theta);
await runtime.set('learn.gen', gen);
const receipts = (await runtime.get('learn.receipts')).data;
const hist = receipts.filter(x => x.side === side).slice(0, 9);
const wins = (s > 0 ? 1 : 0) + hist.filter(x => x.result === 'W').length;
const rate = Math.round((100 * wins) / (hist.length + 1));
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
// one AI ply; input {weights?, seed?, log?}. match.seq is owned by the arbiter.
const phase = (await runtime.get('phase.current')).data;
if (phase !== 'play') return { over: true };
const player = (await runtime.get('turn.current')).data;
const choice = (await runtime.call('ai.choose', { player, weights: input?.weights, seed: input?.seed ?? 1 })).data;
if (!choice || choice.pass) return { pass: true, player };
if (input?.log) {
  const log = (await runtime.get('ai.move_log')).data;
  await runtime.set('ai.move_log', [...log, choice.f]);
}
return (await runtime.call('move.arbiter', { c: choice.c, player, seq: (await runtime.get('match.seq')).data + 1 })).data;`;

const NEW_GAME = `
for (let r = 1; r <= 6; r++) for (let c = 1; c <= 7; c++)
  await runtime.set('board.r' + r + 'c' + c, '');
const g = [];
for (let r = 0; r < 6; r++) { const row = []; for (let c = 0; c < 7; c++) row.push(''); g.push(row); }
await runtime.set('board.grid', g);
await runtime.set('turn.current', 'B');
await runtime.set('phase.current', 'play');
await runtime.set('winner.current', null);
await runtime.set('winner.line', null);
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

export function buildSheet() {
  const cells = [];
  cells.push(v('rules.book', BOOK, 'the complete ruleset; every clause is ported 1:1 to a rule.N.check cell'));
  for (const [n, clause] of [
    ['R1', 'R1 (column): a play names a column A-G; anything else is not a move.'],
    ['R2', 'R2 (full): a column of 6 discs accepts no further disc.'],
    ['R3', 'R3 (gravity): the disc falls to the lowest empty square of its column.'],
    ['R4', 'R4 (connect): four own discs in a straight line win; the rule names the squares.'],
    ['R5', 'R5 (draw): 42 discs with no line is a draw; closed boards refuse everything.'],
    ['R6', 'R6 (threat): advisory scan — WIN NOW and MUST BLOCK columns for the side to move.'],
  ]) {
    cells.push(law(`rule.${n}.law`, clause, `clause ${n} quoted from rules.book`));
    cells.push(v(`rule.${n}.verdict`, null, `last evaluation of clause ${n} (bubble UI reads this)`));
  }
  cells.push(v('rules.fired', [], 'clauses that came into play for the last action'));
  cells.push(v('rules.verdict', null, 'master verdict of the last pushed move'));

  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++)
    cells.push(v(`board.r${r + 1}c${c + 1}`, '', `square ${sqName(r, c)}: '' | B | W`));
  cells.push(v('board.grid', Array.from({ length: 6 }, () => Array(7).fill('')), 'mirror of the 42 board cells'));
  cells.push(v('flip.trace', [], 'the drop trace of the last accepted move (animation reads this)'));

  cells.push(v('turn.current', 'B', 'B | W'));
  cells.push(v('phase.current', 'play', 'play | over'));
  cells.push(v('winner.current', null, 'B | W | draw | null'));
  cells.push(v('winner.line', null, 'winning squares (R4) for highlighting'));
  cells.push(v('match.seq', 0, 'monotonic request sequence'));
  cells.push(formula('score.b', `board.grid.flat().filter(x => x === 'B').length`, 'BLACK discs on the board'));
  cells.push(formula('score.w', `board.grid.flat().filter(x => x === 'W').length`, 'WHITE discs on the board'));

  cells.push(prog('rule.R1.check', CHK_R1, 'R1 port: column exists', []));
  cells.push(prog('rule.R2.check', CHK_R2, 'R2 port: column not full', []));
  cells.push(prog('rule.R3.check', CHK_R3, 'R3 port: gravity names the landing square', []));
  cells.push(prog('rule.R4.check', CHK_R4, 'R4 port: connect-four line through the landing square', []));
  cells.push(prog('rule.R5.check', CHK_R5, 'R5 port: full board draw', []));
  cells.push(prog('rule.R6.check', CHK_R6, 'R6 port: WIN NOW / MUST BLOCK advisory scan', []));

  cells.push(prog('move.arbiter', ARBITER, 'THE REFEREE — sequences rule cells, applies gravity, keeps the ledger', ['move.request']));
  cells.push(prog('move.dispatch', DISPATCH, 'push trampoline: move.request -> move.arbiter', ['move.request']));
  cells.push(listenerCell('move.push', ['move.request'], 'move.dispatch', null, 'push of one value drives the cascade'));
  cells.push(v('move.request', null, 'UI writes {c,player,seq} here — the entire input surface'));

  cells.push(v('ai.weights', { win: 6, mine3: 0, theirs3: 0, center: 0.4, giveAway: 0 },
    'learner policy weights (theta) — updated by learn.update'));
  cells.push(v('ai.fixed_weights', { win: 6, mine3: 0, theirs3: 0, center: 0.4, giveAway: 0 },
    'frozen baseline opponent weights (never learns — the control group)'));
  cells.push(v('ai.move_log', [], "feature vectors of the learner's moves this game"));
  cells.push(prog('ai.features', FEATURES, 'features of a candidate column drop (pure)', []));
  cells.push(prog('ai.choose', CHOOSE, 'score columns by dot(theta, features); seeded tie-break', ['board.grid', 'turn.current', 'phase.current', 'ai.weights']));

  cells.push(v('learn.alpha', 0.1, 'perceptron learning rate'));
  cells.push(v('learn.gen', 0, 'generations learned so far'));
  cells.push(v('learn.receipts', [], 'fnv1a64 hash-chained witness receipts: one per game'));
  cells.push(v('learn.last', null, 'snapshot of the latest update'));
  cells.push(prog('learn.update', LEARN, 'perceptron update + witness receipt (call once per finished game)', ['winner.current', 'score.b', 'score.w', 'ai.move_log', 'ai.weights']));

  cells.push(prog('match.step', MATCH_STEP, 'one AI ply (input {weights?, seed?, log?})', ['phase.current', 'turn.current', 'ai.weights']));
  cells.push(prog('new_game', NEW_GAME, 'reset the board, keep the learning ledger', ['board.grid']));
  cells.push(v('log.events', [], 'append-only audit (cap 200)'));
  return { id: 'connect4', title: 'Quilt Arcade — Connect Four (gravity + threats as cells)', cells };
}
