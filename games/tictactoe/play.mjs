// TICTACTOE PLAYTEST — proves the template architecture end-to-end:
// push semantics, rule-cell sequencing, refusals, closure, perfect-play AI,
// and the fact that rule cells are first-class (callable directly).
//
//   node games/tictactoe/play.mjs

import { QuiltEngine } from '../../engine/index.js';
import { mulberry32, harness } from '../../shared/kit.mjs';
import { buildSheet, sqName } from './sheet.mjs';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const H = harness('tictactoe');
const engine = new QuiltEngine('arcade-tictactoe', { eager: true });
engine.loadSheet(buildSheet());

// push() = the whole user input surface: write one value, get the verdict.
// Works whether listener propagation is synchronous or needs one explicit call.
let lastSeq = 0;
const push = async (req) => {
  const seq = ++lastSeq;
  req = { ...req, seq };
  await engine.set('move.request', req);
  let verdict = (await engine.get('rules.verdict')).data;
  if (verdict?.seq !== seq) verdict = (await engine.call('move.dispatch', req)).data;
  return verdict;
};
const get = async (id) => (await engine.get(id)).data;

const legal = async () => (await engine.call('legal.moves')).data;

await H.check('initial state: empty board, X to move, phase play', async () => {
  H.eq(await get('board.grid'), [['','',''],['','',''],['','','']]);
  H.eq(await get('turn.current'), 'X');
  H.eq(await get('phase.current'), 'play');
  H.eq(await get('score.x'), 0);
});

await H.check('push semantics: one value write plays X center, turn passes to O', async () => {
  const v = await push({ r: 1, c: 1, player: 'X' });
  H.ok(v.ok, 'verdict should be ok: ' + JSON.stringify(v));
  H.eq(await get('board.r2c2'), 'X');
  H.eq(await get('turn.current'), 'O');
  H.eq((await get('rules.fired')).includes('R1'), true, 'R1 evaluated');
  H.eq((await get('rules.fired')).includes('R2'), true, 'R2 evaluated');
  H.eq(await get('score.x'), 1);
});

await H.check('R1 fires: off-board square refused, board unchanged, turn kept', async () => {
  const v = await push({ r: 5, c: 0, player: 'O' });
  H.ok(v.ok === false && v.rule === 'R1', 'refused by R1: ' + JSON.stringify(v));
  H.eq(await get('turn.current'), 'O');
  H.eq(await get('score.o'), 0);
});

await H.check('R2 fires: occupied square refused with contextual text', async () => {
  const v = await push({ r: 1, c: 1, player: 'O' });
  H.ok(v.ok === false && v.rule === 'R2', 'refused by R2');
  H.ok(String(v.text).includes('B2') && String(v.text).includes('X'), 'bubble names the square and holder: ' + v.text);
  H.eq(await get('board.r2c2'), 'X');
});

await H.check('rule cells are first-class: R2.check callable directly, pure', async () => {
  const grid = await get('board.grid');
  const out = (await engine.call('rule.R2.check', { r: 1, c: 1, grid, seq: 999 })).data;
  H.ok(out.fired === true, 'B2 is occupied -> R2 fires');
  const out2 = (await engine.call('rule.R2.check', { r: 0, c: 0, grid, seq: 999 })).data;
  H.ok(out2.fired === false, 'A1 is empty -> R2 silent');
});

await H.check('R3 fires: X completes the top row (A1-B1-C1) and the board closes', async () => {
  H.eq((await push({ r: 1, c: 0, player: 'O' })).ok, true);   // O A2
  H.eq((await push({ r: 0, c: 0, player: 'X' })).ok, true);   // X A1
  H.eq((await push({ r: 2, c: 0, player: 'O' })).ok, true);   // O A3
  const v = await push({ r: 0, c: 1, player: 'X' });          // X B1
  H.eq((await push({ r: 2, c: 1, player: 'O' })).ok, true);   // O B3 (legal, game still open)
  const w = await push({ r: 0, c: 2, player: 'X' });          // X C1 — R3!
  H.ok(w.rule === 'R3' && w.ok, 'R3 verdict: ' + JSON.stringify(w));
  H.eq(w.line, ['A1', 'B1', 'C1'], 'winning line named');
  H.eq(await get('phase.current'), 'over');
  H.eq(await get('winner.current'), 'X');
});

await H.check('closure: moves after R3 are refused and change nothing', async () => {
  const v = await push({ r: 2, c: 2, player: 'O' });
  H.ok(v.ok === false, 'refused on closed board');
  H.eq(await get('score.o'), 3, 'no mark added');
});

await H.check('R4 fires: a full board with no line is a draw', async () => {
  H.eq((await engine.call('new_game')).data.ok, true);
  // verified drawn game (alternating, no early line)
  const draw = [[0,0,'X'],[0,1,'O'],[0,2,'X'],[1,1,'O'],[1,0,'X'],[1,2,'O'],[2,1,'X'],[2,0,'O'],[2,2,'X']];
  let last = null;
  for (const [r, c, p] of draw) last = await push({ r, c, player: p });
  H.ok(last && last.ok && last.rule === 'R4', 'final verdict R4: ' + JSON.stringify(last));
  H.eq(await get('winner.current'), 'draw');
  H.eq(await get('phase.current'), 'over');
});

await H.check('ai.minimax never loses: 300 games vs seeded random (both colors)', async () => {
  const rng = mulberry32(20260925);
  let losses = 0, wins = 0, draws = 0;
  for (let g = 0; g < 300; g++) {
    await engine.call('new_game');
    const aiIsX = g % 2 === 0;
    for (let ply = 0; ply < 9; ply++) {
      const player = await get('turn.current');
      if ((player === 'X') === aiIsX) {
        const mv = (await engine.call('ai.minimax', { player })).data;
        await push({ r: mv.r, c: mv.c, player });
      } else {
        const opts = await legal();
        const mv = opts[Math.floor(rng() * opts.length)];
        await push({ r: mv.r, c: mv.c, player });
      }
      if ((await get('phase.current')) === 'over') break;
    }
    const w = await get('winner.current');
    const aiWon = w === (aiIsX ? 'X' : 'O');
    if (aiWon) wins++; else if (w === 'draw') draws++; else losses++;
  }
  H.eq(losses, 0, `minimax lost ${losses}/300 — perfect play violated`);
  if (globalThis.__verbose) console.log(`      minimax: ${wins}W ${draws}D ${losses}L vs random`);
});

await H.check('new_game resets everything and logs it', async () => {
  await engine.call('new_game');
  H.eq(await get('board.grid'), [['','',''],['','',''],['','','']]);
  H.eq(await get('phase.current'), 'play');
  H.eq(await get('winner.current'), null);
  const log = await get('log.events');
  H.eq(log[log.length - 1].kind, 'new_game');
});

await H.check('board cell <-> grid mirror invariant over a random game', async () => {
  const rng = mulberry32(7);
  await engine.call('new_game');
  for (let ply = 0; ply < 9; ply++) {
    if ((await get('phase.current')) !== 'play') break;
    const opts = await legal();
    const mv = opts[Math.floor(rng() * opts.length)];
    await push({ r: mv.r, c: mv.c, player: await get('turn.current') });
  }
  const grid = await get('board.grid');
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++)
    H.eq(await get(`board.r${r + 1}c${c + 1}`), grid[r][c], `mirror mismatch at ${sqName(r, c)}`);
});

await H.done();

// keep the emitted sheet beside the game — always in sync with the builder
writeFileSync(join(here, 'tictactoe.sheet.json'), JSON.stringify(buildSheet(), null, 2) + '\n');
console.log(`  (emitted tictactoe.sheet.json — ${buildSheet().cells.length} cells)`);
