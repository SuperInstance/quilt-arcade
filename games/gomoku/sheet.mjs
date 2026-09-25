// GOMOKU (freestyle five-in-row, 9x9) — pattern threats as rule cells.
// Same architecture as reversi/connect4: rules.book -> rule cells -> arbiter
// -> push listener -> cascade; perceptron learning on cell-held theta.

import { v, law, prog, formula, listenerCell, SNIPPETS } from '../../shared/kit.mjs';

const COLS = 'ABCDEFGHI';
export const sqName = (r, c) => COLS[c] + (r + 1);
const N = 9;
const AXES = [[0, 1], [1, 0], [1, 1], [1, -1]];

const GK = `
const COLS = 'ABCDEFGHI';
const N = 9;
const sq = (r, c) => COLS[c] + (r + 1);
const opp = (p) => p === 'B' ? 'W' : 'B';
const AXES = ${JSON.stringify(AXES)};
// the contiguous own run through (r,c) along one axis: [run, end1, end2]
// end cells are '', 'B', 'W' or 'X' (off board)
const runAt = (grid, r, c, p, d) => {
  let n = 0;
  const ends = [];
  for (const s of [1, -1]) {
    let rr = r + s * d[0], cc = c + s * d[1];
    while (rr >= 0 && rr < N && cc >= 0 && cc < N && grid[rr][cc] === p) { n++; rr += s * d[0]; cc += s * d[1]; }
    ends.push(rr < 0 || rr >= N || cc < 0 || cc >= N ? 'X' : grid[rr][cc]);
  }
  return { n, e1: ends[0], e2: ends[1] };
};
// pattern value of the square (r,c) for player p on grid (pre-move): the best
// shape the player would create here, across the 4 axes. five > open4 > four > open3.
const patternAt = (grid, r, c, p) => {
  let five = 0, open4 = 0, four = 0, open3 = 0;
  for (const d of AXES) {
    const { n, e1, e2 } = runAt(grid, r, c, p, d);
    const withMe = n + 1;
    const open = (x) => x === '';
    if (withMe >= 5) { five++; continue; }
    if (withMe === 4) { if (open(e1) && open(e2)) open4++; else if (open(e1) || open(e2)) four++; continue; }
    if (withMe === 3) { if (open(e1) && open(e2)) open3++; continue; }
  }
  return { five, open4, four, open3 };
};
// candidates: empty squares within Chebyshev distance 2 of any stone
const candidates = (grid) => {
  const near = (r, c) => {
    for (let rr = Math.max(0, r - 2); rr <= Math.min(N - 1, r + 2); rr++)
      for (let cc = Math.max(0, c - 2); cc <= Math.min(N - 1, c + 2); cc++)
        if (grid[rr][cc] !== '') return true;
    return false;
  };
  const out = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
    if (grid[r][c] === '' && near(r, c)) out.push({ r, c, sq: sq(r, c) });
  if (!out.length && grid[4][4] === '') out.push({ r: 4, c: 4, sq: sq(4, 4) }); // opening move
  return out;
};`;

// ── rules.book ────────────────────────────────────────────────────────────────
const BOOK = `GOMOKU (freestyle, 9x9) — RULEBOOK v1

R1 (bounds)      A stone is placed by naming a square (rows 1-9, columns
                 A-I). Squares outside the 9x9 grid do not exist; naming one
                 is not a move.

R2 (empty)       A stone may only be placed on an EMPTY square. Stones never
                 move and are never captured.

R3 (five)        If after placement a player owns FIVE OR MORE stones in an
                 unbroken straight line — horizontal, vertical, or either
                 diagonal — the player wins and the board is closed. The
                 rule names the exact squares of the winning line.

R4 (draw)        If all 81 squares hold stones and no line was completed,
                 the game is a draw and the board is closed.

R5 (threat)      ADVISORY: after every accepted placement the sheet reports
                 the strongest shape still available on the board — an open
                 four (unstoppable next turn), a simple four, or an open
                 three — for the side to move to address.

TURN (derived)   Black moves first; turns alternate strictly. Refused moves
                 never consume the turn.`;

const CHK_R1 = `
${GK}
const r = input?.r, c = input?.c;
const fired = !(Number.isInteger(r) && r >= 0 && r < N && Number.isInteger(c) && c >= 0 && c < N);
return { fired, why: fired
  ? 'Square ' + JSON.stringify(input?.r) + ',' + JSON.stringify(input?.c) + ' is outside the 9x9 grid — naming it is not a move.'
  : 'Square ' + sq(r, c) + ' exists.' };`;

const CHK_R2 = `
${GK}
const r = input?.r, c = input?.c, grid = input?.grid;
const holder = (grid && r >= 0 && r < N && c >= 0 && c < N) ? grid[r][c] : null;
const fired = !!holder;
return { fired, why: fired
  ? 'Square ' + sq(r, c) + ' already holds a ' + (holder === 'B' ? 'BLACK' : 'WHITE') + ' stone — stones never move and are never captured.'
  : 'Square ' + (r != null ? sq(r, c) : '?') + ' is empty.' };`;

const CHK_R3 = `
${GK}
const grid = input?.grid, r = input?.r, c = input?.c, player = input?.player;
for (const d of AXES) {
  const { n } = runAt(grid, r, c, player, d);
  if (n + 1 >= 5) {
    const cells = [[r, c]];
    for (const s of [1, -1]) {
      let rr = r + s * d[0], cc = c + s * d[1];
      while (rr >= 0 && rr < N && cc >= 0 && cc < N && grid[rr][cc] === player) { cells.push([rr, cc]); rr += s * d[0]; cc += s * d[1]; }
    }
    const line = cells.map(([a, b]) => ({ r: a, c: b, sq: sq(a, b) })).sort((x, y) => (x.r - y.r) || (x.c - y.c));
    return { fired: true, line: line.map(x => x.sq),
      why: (player === 'B' ? 'BLACK' : 'WHITE') + ' owns ' + line.length + ' in a line: ' + line.map(x => x.sq).join(' - ') + '. Game over.' };
  }
}
return { fired: false, line: null, why: 'No five-in-line through ' + sq(r, c) + '.' };`;

const CHK_R4 = `
${GK}
const grid = input?.grid;
let n = 0;
for (const row of grid) for (const x of row) if (x !== '') n++;
const fired = n === N * N;
return { fired, n,
  why: fired ? 'All 81 squares hold stones and no five was completed — the game is a draw.'
             : 'Board holds ' + n + '/81 stones.' };`;

const CHK_R5 = `
${GK}
// ADVISORY: strongest live shape for the side to move and for the opponent.
const grid = input?.grid, mover = input?.player;
const scan = (p) => {
  const best = { five: 0, open4: 0, four: 0, open3: 0 };
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c] !== p) continue;
    for (const d of AXES) {
      const { n, e1, e2 } = runAt(grid, r, c, p, d);
      const open = (x) => x === '';
      // n counts the run EXCLUDING the stone at (r,c); the run length is n+1
      if (n + 1 >= 4) best.five++;
      else if (n + 1 === 3 && open(e1) && open(e2)) best.open4++;
      else if (n + 1 === 3) best.four++;
      else if (n + 1 === 2 && open(e1) && open(e2)) best.open3++;
    }
  }
  return best;
};
const mine = scan(mover), theirs = scan(opp(mover));
const parts = [];
if (theirs.five) parts.push('DANGER: the opponent has four in a line — they complete five next turn unless answered.');
else if (theirs.open4) parts.push('DANGER: the opponent has an open three — it becomes an open four next turn.');
else if (mine.five) parts.push('You hold four in a line — complete the five to win.');
else if (mine.open4) parts.push('You hold an open three — a threat worth building on.');
else if (theirs.four) parts.push('The opponent has a split three — watch for a four.');
else if (mine.open3) parts.push('You hold a developing open shape.');
return { fired: parts.length > 0, mine, theirs, why: parts.length ? parts.join(' ') : 'No decisive shapes on the board.' };`;

const ARBITER = `
// THE REFEREE — sequences rule cells, applies the placement, keeps the ledger.
${GK}
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
  await runtime.set('rules.fired', ['R4']);
  return done({ ok: false, rule: 'R4', text: 'The board is closed — no further moves are accepted.' });
}

const r1 = (await runtime.call('rule.R1.check', { r, c, seq })).data;
await runtime.set('rule.R1.verdict', { ...r1, ts: Date.now() });
fired.push('R1');
if (r1.fired) { await runtime.set('rules.fired', fired); return done({ ok: false, rule: 'R1', text: r1.why }); }

const r2 = (await runtime.call('rule.R2.check', { r, c, grid, seq })).data;
await runtime.set('rule.R2.verdict', { ...r2, ts: Date.now() });
fired.push('R2');
if (r2.fired) { await runtime.set('rules.fired', fired); return done({ ok: false, rule: 'R2', text: r2.why }); }

// ACCEPTED — place the stone
const trace = [{ sq: sq(r, c), from: '', to: player, ray: 'place' }];
await runtime.set('board.r' + (r + 1) + 'c' + (c + 1), player);
grid[r][c] = player;
await runtime.set('board.grid', grid);
await runtime.set('flip.trace', trace);

// R3 five-in-line
const r3 = (await runtime.call('rule.R3.check', { grid, r, c, player, seq })).data;
await runtime.set('rule.R3.verdict', { ...r3, ts: Date.now() });
if (r3.fired) {
  fired.push('R3');
  await runtime.set('rules.fired', fired);
  await runtime.set('phase.current', 'over');
  await runtime.set('winner.current', player);
  await runtime.set('winner.line', r3.line);
  await runtime.set('match.seq', seq);
  return done({ ok: true, rule: 'R3', text: r3.why, fired, trace, line: r3.line });
}

// R4 draw
const r4 = (await runtime.call('rule.R4.check', { grid, seq })).data;
await runtime.set('rule.R4.verdict', { ...r4, ts: Date.now() });
if (r4.fired) {
  fired.push('R4');
  await runtime.set('rules.fired', fired);
  await runtime.set('phase.current', 'over');
  await runtime.set('winner.current', 'draw');
  await runtime.set('match.seq', seq);
  return done({ ok: true, rule: 'R4', text: r4.why, fired, trace });
}

// R5 advisory threat scan for the side to move
const r5 = (await runtime.call('rule.R5.check', { grid, player: opp(player), seq })).data;
await runtime.set('rule.R5.verdict', { ...r5, ts: Date.now() });
if (r5.fired) fired.push('R5');

await runtime.set('turn.current', opp(player));
await runtime.set('match.seq', seq);
await runtime.set('rules.fired', fired);
const tail = r5.fired ? ' ' + r5.why : '';
return done({ ok: true, rule: 'R2', text: (player === 'B' ? 'BLACK' : 'WHITE') + ' plays ' + sq(r, c) + '.' + tail, fired, trace });`;

const DISPATCH = `
const ev = input ?? {};
let req = null;
if (ev.r != null) req = ev;
else if (ev.value?.r != null) req = ev.value;
else if (caller?.metadata?.current?.r != null) req = caller.metadata.current;
else req = (await runtime.get('move.request')).data;
if (!req || req.r == null) return { skipped: true };
return (await runtime.call('move.arbiter', req)).data;`;

const FEATURES = `
${GK}
// features of placing at (r,c): my new shapes + the opponent shapes I erase.
const grid = input?.grid, r = input?.r, c = input?.c, player = input?.player;
if (grid[r][c] !== '') return null;
const mine = patternAt(grid, r, c, player);
const theirs = patternAt(grid, r, c, opp(player));   // what the enemy would get HERE — occupying erases it
return { f: {
  five: mine.five, open4: mine.open4, four: mine.four, open3: mine.open3,
  blockFive: theirs.five, blockOpen4: theirs.open4, blockFour: theirs.four,
} };`;

const CHOOSE = `
${GK}
${SNIPPETS.rng}
const grid = (await runtime.get('board.grid')).data;
const player = input?.player ?? (await runtime.get('turn.current')).data;
const weights = input?.weights ?? (await runtime.get('ai.weights')).data;
const seed = input?.seed ?? 1;
const phase = (await runtime.get('phase.current')).data;
if (phase !== 'play') return null;
const cands = candidates(grid);
if (!cands.length) return { pass: true, player };
const scored = [];
for (const m of cands) {
  const out = (await runtime.call('ai.features', { grid, r: m.r, c: m.c, player, seq: seed + ':' + m.sq })).data;
  if (!out) continue;
  let s = 0; for (const k of Object.keys(weights)) s += (weights[k] ?? 0) * (out.f[k] ?? 0);
  scored.push({ ...m, score: Math.round(s * 100) / 100, f: out.f });
}
scored.sort((a, b) => b.score - a.score);
// hindsight-eligible features: was an immediate opportunity square available,
// and did THIS move take it or ignore it? (gives missed blocks a gradient)
let fiveSq = null, fourSq = null;
for (const m of scored) {
  if (m.f.blockFive > 0 && !fiveSq) fiveSq = m.sq;
  if (m.f.blockOpen4 > 0 && !fourSq) fourSq = m.sq;
}
for (const m of scored) {
  m.f.tookFive = fiveSq && m.sq === fiveSq ? 1 : 0;
  m.f.missedFive = fiveSq && m.sq !== fiveSq ? 1 : 0;
  m.f.tookOpen4 = fourSq && m.sq === fourSq ? 1 : 0;
  m.f.missedOpen4 = fourSq && m.sq !== fourSq ? 1 : 0;
  let s2 = 0; for (const k of Object.keys(weights)) s2 += (weights[k] ?? 0) * (m.f[k] ?? 0);
  m.score = Math.round(s2 * 100) / 100;
}
scored.sort((a, b) => b.score - a.score);
const rnd = rng(seed * 7919 + r2s(grid));
const top = scored.slice(0, Math.min(3, scored.length));
const pick = rnd() < 0.85 ? top[0] : top[Math.floor(rnd() * top.length)];
return { ...pick, player, considered: scored.length,
  why: player + ' plays ' + pick.sq + ' (score ' + pick.score + ')' };
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
  theta[k] = Math.max(-8, Math.min(12, theta[k] + alpha * s * (f[k] ?? 0)));
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
return (await runtime.call('move.arbiter', { r: choice.r, c: choice.c, player, seq: (await runtime.get('match.seq')).data + 1 })).data;`;

const NEW_GAME = `
for (let r = 1; r <= 9; r++) for (let c = 1; c <= 9; c++)
  await runtime.set('board.r' + r + 'c' + c, '');
const g = [];
for (let r = 0; r < 9; r++) { const row = []; for (let c = 0; c < 9; c++) row.push(''); g.push(row); }
await runtime.set('board.grid', g);
await runtime.set('turn.current', 'B');
await runtime.set('phase.current', 'play');
await runtime.set('winner.current', null);
await runtime.set('winner.line', null);
await runtime.set('flip.trace', []);
for (const n of ['R1','R2','R3','R4','R5']) await runtime.set('rule.' + n + '.verdict', null);
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
    ['R1', 'R1 (bounds): squares outside the 9x9 grid do not exist.'],
    ['R2', 'R2 (empty): stones only on empty squares; never moved, never captured.'],
    ['R3', 'R3 (five): five or more own stones in an unbroken line win; the rule names the squares.'],
    ['R4', 'R4 (draw): 81 stones with no five is a draw; closed boards refuse everything.'],
    ['R5', 'R5 (threat): advisory scan — open fours, fours, open threes for the side to move.'],
  ]) {
    cells.push(law(`rule.${n}.law`, clause, `clause ${n} quoted from rules.book`));
    cells.push(v(`rule.${n}.verdict`, null, `last evaluation of clause ${n} (bubble UI reads this)`));
  }
  cells.push(v('rules.fired', [], 'clauses that came into play for the last action'));
  cells.push(v('rules.verdict', null, 'master verdict of the last pushed move'));

  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++)
    cells.push(v(`board.r${r + 1}c${c + 1}`, '', `square ${sqName(r, c)}: '' | B | W`));
  cells.push(v('board.grid', Array.from({ length: 9 }, () => Array(9).fill('')), 'mirror of the 81 board cells'));
  cells.push(v('flip.trace', [], 'the placement trace of the last accepted move'));

  cells.push(v('turn.current', 'B', 'B | W'));
  cells.push(v('phase.current', 'play', 'play | over'));
  cells.push(v('winner.current', null, 'B | W | draw | null'));
  cells.push(v('winner.line', null, 'winning squares (R3) for highlighting'));
  cells.push(v('match.seq', 0, 'monotonic request sequence'));
  cells.push(formula('score.b', `board.grid.flat().filter(x => x === 'B').length`, 'BLACK stones'));
  cells.push(formula('score.w', `board.grid.flat().filter(x => x === 'W').length`, 'WHITE stones'));

  cells.push(prog('rule.R1.check', CHK_R1, 'R1 port: bounds', []));
  cells.push(prog('rule.R2.check', CHK_R2, 'R2 port: empty square', []));
  cells.push(prog('rule.R3.check', CHK_R3, 'R3 port: five-in-line through the placed stone', []));
  cells.push(prog('rule.R4.check', CHK_R4, 'R4 port: full-board draw', []));
  cells.push(prog('rule.R5.check', CHK_R5, 'R5 port: advisory shape scan', []));

  cells.push(prog('move.arbiter', ARBITER, 'THE REFEREE — sequences rule cells, applies placement, keeps the ledger', ['move.request']));
  cells.push(prog('move.dispatch', DISPATCH, 'push trampoline: move.request -> move.arbiter', ['move.request']));
  cells.push(listenerCell('move.push', ['move.request'], 'move.dispatch', null, 'push of one value drives the cascade'));
  cells.push(v('move.request', null, 'UI writes {r,c,player,seq} here — the entire input surface'));

  cells.push(v('ai.weights', { five: 8, open4: 2, four: 1, open3: 0.5, blockFive: 0, blockOpen4: 0, blockFour: 0, tookFive: 0, missedFive: 0, tookOpen4: 0, missedOpen4: 0 },
    'learner policy weights (theta) — updated by learn.update'));
  cells.push(v('ai.fixed_weights', { five: 8, open4: 2, four: 1, open3: 0.5, blockFive: 0, blockOpen4: 0, blockFour: 0, tookFive: 0, missedFive: 0, tookOpen4: 0, missedOpen4: 0 },
    'frozen baseline opponent weights (never learns — the control group)'));
  cells.push(v('ai.move_log', [], "feature vectors of the learner's moves this game"));
  cells.push(prog('ai.features', FEATURES, 'pattern features of a candidate square (pure)', []));
  cells.push(prog('ai.choose', CHOOSE, 'score candidate squares by dot(theta, features); seeded tie-break', ['board.grid', 'turn.current', 'phase.current', 'ai.weights']));

  cells.push(v('learn.alpha', 0.08, 'perceptron learning rate'));
  cells.push(v('learn.gen', 0, 'generations learned so far'));
  cells.push(v('learn.receipts', [], 'fnv1a64 hash-chained witness receipts: one per game'));
  cells.push(v('learn.last', null, 'snapshot of the latest update'));
  cells.push(prog('learn.update', LEARN, 'perceptron update + witness receipt (call once per finished game)', ['winner.current', 'score.b', 'score.w', 'ai.move_log', 'ai.weights']));

  cells.push(prog('match.step', MATCH_STEP, 'one AI ply (input {weights?, seed?, log?})', ['phase.current', 'turn.current', 'ai.weights']));
  cells.push(prog('new_game', NEW_GAME, 'reset the board, keep the learning ledger', ['board.grid']));
  cells.push(v('log.events', [], 'append-only audit (cap 200)'));
  return { id: 'gomoku', title: 'Quilt Arcade — Gomoku (patterns + learning loop)', cells };
}
