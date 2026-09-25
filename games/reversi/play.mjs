// REVERSI PLAYTEST — rule cells vs an independent reference implementation.
//
// The harness carries its OWN sandwich/flip code (written separately from the
// sheet). Every accepted engine move must produce EXACTLY the board the
// reference predicts — whole-board equality, every ply. Passes, endings and
// scores are likewise cross-checked. Then the learning loop runs for real:
// learner (cell-held theta, perceptron updates) vs a frozen baseline, with a
// witness receipt booked per generation and the chain re-derived here.
//
//   node games/reversi/play.mjs

import { QuiltEngine } from '../../engine/index.js';
import { mulberry32, harness, verifyChain, GENESIS_PREV, fnv1a64, canon } from '../../shared/kit.mjs';
import { buildSheet } from './sheet.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const H = harness('reversi');
const engine = new QuiltEngine('arcade-reversi', { eager: true });
engine.loadSheet(buildSheet());

const get = async (id) => (await engine.get(id)).data;
let lastSeq = 0;
const push = async (req) => {
  // the arbiter's counter also advances via match.step — stay ahead of it
  lastSeq = Math.max(lastSeq, (await engine.get('match.seq')).data) + 1;
  await engine.set('move.request', { ...req, seq: lastSeq });
  const verdict = (await engine.get('rules.verdict')).data;
  return verdict?.seq === lastSeq ? verdict : (await engine.call('move.dispatch', { ...req, seq: lastSeq })).data;
};

// ── INDEPENDENT reference implementation (do not share code with the sheet) ──
const REFDIRS = [[-1,0],[-1,1],[0,1],[1,1],[1,0],[1,-1],[0,-1],[-1,-1]];
const refFlips = (g, r, c, p) => {
  const o = p === 'B' ? 'W' : 'B', out = [];
  for (const [dr, dc] of REFDIRS) {
    const line = [];
    let rr = r + dr, cc = c + dc;
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && g[rr][cc] === o) { line.push([rr, cc]); rr += dr; cc += dc; }
    if (line.length && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && g[rr][cc] === p) out.push(...line);
  }
  return out;
};
const refLegal = (g, p) => {
  const out = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
    if (!g[r][c] && refFlips(g, r, c, p).length) out.push({ r, c });
  return out;
};
const refApply = (g, r, c, p) => {
  const g2 = g.map(x => x.slice());
  g2[r][c] = p;
  for (const [a, b] of refFlips(g, r, c, p)) g2[a][b] = p;
  return g2;
};
const refScore = (g) => {
  let b = 0, w = 0;
  for (const row of g) for (const x of row) { if (x === 'B') b++; else if (x === 'W') w++; }
  return { b, w };
};

const initialGrid = () => {
  const g = Array.from({ length: 8 }, () => Array(8).fill(''));
  g[3][3] = 'W'; g[4][4] = 'W'; g[3][4] = 'B'; g[4][3] = 'B';
  return g;
};

// one full driver game. learnerSide: the colour whose moves go through the
// cell-held theta (and get logged for learn.update). strict: assert the
// reference agrees BEFORE each ply (engine and reference agree unconditionally
// after every ply either way — the whole-board equality always runs).
async function playGame({ learnerSide = null, seed = 1, strict = true, learn = false } = {}) {
  await engine.call('new_game');
  const rng = mulberry32(seed);
  let ref = initialGrid();
  let plies = 0, stuck = 0, lastKey = '';
  const history = [];
  while ((await get('phase.current')) === 'play' && plies < 120) {
    const side = await get('turn.current');
    const key = side + ':' + JSON.stringify(await get('board.grid'));
    if (key === lastKey) { stuck++; if (stuck > 2) throw new Error('stuck loop: no progress on ' + side); }
    else { stuck = 0; lastKey = key; }
    // strict honesty: if the ENGINE says this side must move, the reference must agree
    if (strict) H.eq(refLegal(ref, side).length > 0, true, `engine turn=${side} but reference says no legal move`);
    const isLearner = side === learnerSide;
    const step = (await engine.call('match.step', {
      weights: isLearner ? undefined : { corner: 3, x: -1, edge: 1, mobility: -0.5, frontier: -0.2 },
      seed: 1 + Math.floor(rng() * 1e9), log: isLearner && learn,
    })).data;
    if (step.over) break;
    if (step.pass) continue; // arbiter normally absorbs passes; defensive
    H.ok(step.ok, 'engine refused its own AI move: ' + JSON.stringify(step));
    // recover the played square + player from the trace (verdict carries it)
    const tr = step.trace ?? [];
    const placed = tr[0];
    H.ok(placed && placed.ray === 'place', 'trace starts with the placement');
    const player = placed.to;
    {
      // reference: decode square name -> coordinates
      const m = /^([A-H])([1-8])$/.exec(placed.sq);
      const rr = Number(m[2]) - 1, cc = 'ABCDEFGH'.indexOf(m[1]);
      if (strict) {
        H.ok(ref[rr][cc] === '', 'reference agrees square was empty');
        H.ok(refFlips(ref, rr, cc, player).length > 0, 'reference agrees placement is legal');
      }
      ref = refApply(ref, rr, cc, player);
      const eng = await get('board.grid');
      H.eq(eng, ref, `whole-board divergence after ply ${plies} (${placed.sq})`);
    }
    history.push({ side: player, sq: placed.sq, flips: tr.length - 1 });
    plies++;
  }
  const phase = await get('phase.current');
  H.ok(phase === 'over', 'game reached R5 end');
  const { b, w } = refScore(ref);
  H.eq(await get('score.b'), b, 'final BLACK score matches reference');
  H.eq(await get('score.w'), w, 'final WHITE score matches reference');
  const winner = await get('winner.current');
  H.eq(winner, b === w ? 'draw' : b > w ? 'B' : 'W', 'R6 verdict matches reference majority');
  return { winner, b, w, plies, history };
}

// ── checks ────────────────────────────────────────────────────────────────────
await H.check('initial position: 4 discs, BLACK to move, legal = D3 C4 F5 E6', async () => {
  H.eq(await get('score.b'), 2);
  H.eq(await get('score.w'), 2);
  H.eq(await get('turn.current'), 'B');
  const legal = (await engine.call('legal.moves')).data.map(m => m.sq).sort();
  H.eq(legal, ['C4', 'D3', 'E6', 'F5'], 'standard opening moves');
});

await H.check('R1 fires: off-board square refused', async () => {
  const v = await push({ r: 9, c: 0, player: 'B' });
  H.ok(v.ok === false && v.rule === 'R1');
  H.eq(await get('score.b'), 2);
});

await H.check('R2 fires: occupied square refused with contextual text', async () => {
  const v = await push({ r: 3, c: 4, player: 'B' });   // E4 holds BLACK
  H.ok(v.ok === false && v.rule === 'R2');
  H.ok(String(v.text).includes('E4') && String(v.text).includes('BLACK'), 'bubble names square + holder: ' + v.text);
});

await H.check('R3 fires (no bracket): early corner attempt refused', async () => {
  const v = await push({ r: 0, c: 0, player: 'B' });   // A1 brackets nothing
  H.ok(v.ok === false && v.rule === 'R3');
  H.ok(String(v.text).includes('A1') && String(v.text).includes('no enemy line'), 'bubble explains the failed bracket: ' + v.text);
  H.eq(await get('turn.current'), 'B', 'refused move kept the turn');
});

await H.check('R3 legal: D3 brackets D4, exactly one flip along S, scores update live', async () => {
  const v = await push({ r: 2, c: 3, player: 'B' });
  H.ok(v.ok && v.rule === 'R3', JSON.stringify(v));
  H.eq(v.trace, [{ sq: 'D3', from: '', to: 'B', ray: 'place' }, { r: 3, c: 3, sq: 'D4', from: 'W', to: 'B', ray: 'S' }]);
  H.eq(await get('board.r4c4'), 'B', 'D4 flipped');
  H.eq(await get('score.b'), 4);
  H.eq(await get('score.w'), 1);
  H.eq(await get('turn.current'), 'W');
  H.eq((await get('rules.fired')).join(','), 'R1,R2,R3');
});

await H.check('rule cells are first-class: R3.check called directly returns the exact flip list', async () => {
  const grid = await get('board.grid');
  const out = (await engine.call('rule.R3.check', { grid, r: 5, c: 3, player: 'W', seq: 'direct' })).data;
  const ref = refFlips(grid, 5, 3, 'W').map(([r, c]) => 'ABCDEFGH'[c] + (r + 1)).sort();
  H.eq((out.flips ?? []).map(f => f.sq).sort(), ref, 'engine flip list == reference flip list');
});

await H.check('cross-checked random game: engine board == reference board on EVERY ply', async () => {
  const res = await playGame({ seed: 20260925 });
  if (globalThis.__verbose) console.log(`      game: ${res.plies} plies, B ${res.b} - W ${res.w}, winner ${res.winner}`);
});

await H.check('three more cross-checked seeds (alternating dynamics)', async () => {
  for (const seed of [7, 1234, 98765]) await playGame({ seed });
});

await H.check('R5 closure: every refused post-end move leaves the board untouched', async () => {
  // current engine state: last cross-checked game is over
  const before = await get('board.grid');
  const v = await push({ r: 0, c: 0, player: 'B' });
  H.ok(v.ok === false && (v.rule === 'R5' || v.rule === 'R3' || v.rule === 'R2'));
  H.eq(await get('board.grid'), before);
});

// ── the learning experiment: learner cells vs frozen baseline ────────────────
const GENS = 24, GAMES = 8;
const curve = [];
await H.check(`learning loop: ${GENS} generations x ${GAMES} games vs frozen baseline — win rate climbs, corners get discovered`, async () => {
  const t0 = Date.now();
  for (let gen = 1; gen <= GENS; gen++) {
    let wins = 0, losses = 0, draws = 0, cornerCaps = 0;
    for (let g = 0; g < GAMES; g++) {
      const learnerSide = g % 2 === 0 ? 'B' : 'W';
      const res = await playGame({ learnerSide, seed: 1000 * gen + g, learn: true, strict: gen === 1 || gen === GENS });
      // corner capture count from the learner's history (feature discovery signal)
      cornerCaps += res.history.filter(h => h.side === learnerSide && ['A1','H1','A8','H8'].includes(h.sq)).length;
      const r = (await engine.call('learn.update', { side: learnerSide })).data;
      if (r.result === 'W') wins++; else if (r.result === 'L') losses++; else draws++;
    }
    const theta = await get('ai.weights');
    curve.push({ gen, wins, losses, draws, cornerCaps,
      win_rate: Math.round((100 * wins) / GAMES),
      theta: { ...theta }, theta_corner: theta.corner, theta_mobility: theta.mobility });
  }
  if (globalThis.__verbose) {
    console.log('      gen  W-L-D  win%  corners  theta(corner, mobility, edge, x, frontier)');
    for (const c of curve) console.log(`      ${String(c.gen).padStart(3)}  ${c.wins}-${c.losses}-${c.draws}  ${String(c.win_rate).padStart(3)}  ${String(c.cornerCaps).padStart(4)}     (${c.theta_corner.toFixed(2)}, ${c.theta_mobility.toFixed(2)}, ${c.theta.edge.toFixed(2)}, ${c.theta.x.toFixed(2)}, ${c.theta.frontier.toFixed(2)})`);
    console.log(`      (${Date.now() - t0}ms)`);
  }
  const first = curve.slice(0, 3).reduce((s, c) => s + c.win_rate, 0) / 3;
  const last = curve.slice(-3).reduce((s, c) => s + c.win_rate, 0) / 3;
  H.ok(last > first, `win rate did not climb: first-3 avg ${first.toFixed(0)}% vs last-3 avg ${last.toFixed(0)}%`);
  H.ok(curve[curve.length - 1].theta_corner > curve[0].theta_corner, 'corner weight did not rise — corner discovery failed');
});

await H.check('witness ledger: receipt chain re-derives from GENESIS (tamper-evident learning curve)', async () => {
  const receipts = await get('learn.receipts');
  H.eq(receipts.length, GENS * GAMES);
  const last = verifyChain(receipts, (r) => ({ seq: r.seq, side: r.side, result: r.result,
    score_b: r.score_b, score_w: r.score_w, theta_hash: r.theta_hash, win_rate10: r.win_rate10 }));
  H.eq(last, receipts[receipts.length - 1].row_hash);
  // pin one receipt's theta_hash to the actual theta that produced it
  const snapshot = await get('learn.last');
  H.eq(snapshot.receipt.theta_hash, fnv1a64(canon(snapshot.theta)));
});

await H.check('mirror invariant over the final position', async () => {
  const grid = await get('board.grid');
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++)
    H.eq(await get(`board.r${r + 1}c${c + 1}`), grid[r][c]);
});

const { pass, fail } = await H.done();

// artifacts
mkdirSync(join(here, '..', '..', 'experiments'), { recursive: true });
writeFileSync(join(here, '..', '..', 'experiments', 'reversi.json'), JSON.stringify({
  game: 'reversi', gens: GENS, games_per_gen: GAMES, alpha: await get('learn.alpha'),
  theta0: { corner: 0, x: 0, edge: 0, mobility: -1, frontier: 0 },
  baseline: { corner: 3, x: -1, edge: 1, mobility: -0.5, frontier: -0.2 },
  curve, checks: { pass, fail }, generated: new Date().toISOString(),
}, null, 2) + '\n');
writeFileSync(join(here, 'reversi.sheet.json'), JSON.stringify(buildSheet(), null, 2) + '\n');
console.log('  (emitted reversi.sheet.json — ' + buildSheet().cells.length + ' cells; experiments/reversi.json)');
