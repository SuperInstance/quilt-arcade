// GOMOKU PLAYTEST — pattern rules vs an independent reference; learning loop.
// The learner starts threat-blind (block weights 0) and must discover that the
// square the opponent wants is worth taking.

import { QuiltEngine } from '../../engine/index.js';
import { mulberry32, harness, verifyChain, fnv1a64, canon } from '../../shared/kit.mjs';
import { buildSheet } from './sheet.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const H = harness('gomoku');
const engine = new QuiltEngine('arcade-gomoku', { eager: true });
engine.loadSheet(buildSheet());

const get = async (id) => (await engine.get(id)).data;
let lastSeq = 0;
const push = async (req) => {
  lastSeq = Math.max(lastSeq, (await engine.get('match.seq')).data) + 1;
  await engine.set('move.request', { ...req, seq: lastSeq });
  const verdict = (await engine.get('rules.verdict')).data;
  return verdict?.seq === lastSeq ? verdict : (await engine.call('move.dispatch', { ...req, seq: lastSeq })).data;
};

// ── independent reference ─────────────────────────────────────────────────────
const RAXES = [[0, 1], [1, 0], [1, 1], [1, -1]];
const refFive = (g, r, c, p) => {
  for (const [dr, dc] of RAXES) {
    let n = 1;
    for (const s of [1, -1]) {
      let rr = r + s * dr, cc = c + s * dc;
      while (rr >= 0 && rr < 9 && cc >= 0 && cc < 9 && g[rr][cc] === p) { n++; rr += s * dr; cc += s * dc; }
    }
    if (n >= 5) return true;
  }
  return false;
};
const refNear = (g, r, c) => {
  for (let rr = Math.max(0, r - 2); rr <= Math.min(8, r + 2); rr++)
    for (let cc = Math.max(0, c - 2); cc <= Math.min(8, c + 2); cc++)
      if (g[rr][cc] !== '') return true;
  return false;
};
const emptyGrid = () => Array.from({ length: 9 }, () => Array(9).fill(''));

// frozen generation-1 policy: attack-only, threat-blind (the control group)
const THETA0 = { five: 8, open4: 2, four: 1, open3: 0.5, blockFive: 0, blockOpen4: 0, blockFour: 0 };

async function playGame({ learnerSide = null, seed = 1, learn = false } = {}) {
  await engine.call('new_game');
  const rng = mulberry32(seed);
  let ref = emptyGrid();
  let plies = 0;
  const history = [];
  while ((await get('phase.current')) === 'play' && plies < 81) {
    const side = await get('turn.current');
    const isLearner = side === learnerSide;
    const step = (await engine.call('match.step', {
      weights: isLearner ? undefined : THETA0,
      seed: 1 + Math.floor(rng() * 1e9), log: isLearner && learn,
    })).data;
    if (step.over || step.pass) break;
    H.ok(step.ok, 'engine refused its own AI move: ' + JSON.stringify(step).slice(0, 140));
    const placed = step.trace[0];
    const m = /^([A-I])([1-9])$/.exec(placed.sq);
    const rr = Number(m[2]) - 1, cc = 'ABCDEFGHI'.indexOf(m[1]);
    H.ok(ref[rr][cc] === '' && (plies === 0 ? (rr === 4 && cc === 4) : refNear(ref, rr, cc)),
      `reference disagrees on ${placed.sq} legality/adjacency`);
    ref[rr][cc] = placed.to;
    const eng = await get('board.grid');
    H.eq(eng, ref, `whole-board divergence after ply ${plies}`);
    history.push({ side: placed.to, sq: placed.sq });
    plies++;
    if (refFive(ref, rr, cc, placed.to)) break; // reference confirms the win
  }
  H.ok((await get('phase.current')) === 'over', 'game ended');
  if (plies > 0) {
    // if the reference sees a five, the engine must have ended the game with that winner
    let b5 = false, w5 = false;
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      if (ref[r][c] === 'B' && !b5 && refFive(ref, r, c, 'B')) b5 = true;
      if (ref[r][c] === 'W' && !w5 && refFive(ref, r, c, 'W')) w5 = true;
    }
    const winner = await get('winner.current');
    if (b5) H.eq(winner, 'B', 'reference five for B == engine winner');
    else if (w5) H.eq(winner, 'W', 'reference five for W == engine winner');
    else H.ok(winner === 'draw' || winner === null, 'no reference five -> draw/null');
  }
  return { winner: await get('winner.current'), plies, history };
}

// ── checks ────────────────────────────────────────────────────────────────────
await H.check('initial state: empty 9x9, BLACK to move', async () => {
  H.eq(await get('board.grid'), emptyGrid());
  H.eq(await get('turn.current'), 'B');
});

await H.check('R1 fires: off-board refused', async () => {
  const v = await push({ r: 10, c: 4, player: 'B' });
  H.ok(v.ok === false && v.rule === 'R1');
});

await H.check('R2 fires: occupied square refused with contextual text', async () => {
  H.eq((await push({ r: 4, c: 4, player: 'B' })).ok, true);   // E5
  const v = await push({ r: 4, c: 4, player: 'W' });
  H.ok(v.ok === false && v.rule === 'R2');
  H.ok(String(v.text).includes('E5') && String(v.text).includes('BLACK'), v.text);
});

await H.check('R3 fires: five in a row names the line and closes the board', async () => {
  await engine.call('new_game');
  // B builds row 5 (r=4): A5..E5; W pokes column J... column I rows elsewhere
  const moves = [];
  for (let i = 0; i < 5; i++) moves.push([4, i, 'B']);
  for (let i = 0; i < 4; i++) moves.push([i, 8, 'W']);
  // interleave: B,W,B,W,... (B has 5 stones, W has 4)
  const seq = [];
  for (let i = 0; i < 5; i++) { seq.push(moves[i]); if (i < 4) seq.push(moves[5 + i]); }
  let last = null;
  for (const [r, c, p] of seq) last = await push({ r, c, player: p });
  H.ok(last.ok && last.rule === 'R3', 'R3 verdict: ' + JSON.stringify(last).slice(0, 160));
  H.eq(last.line, ['A5', 'B5', 'C5', 'D5', 'E5'], 'winning line named');
  H.eq(await get('winner.current'), 'B');
  H.eq(await get('phase.current'), 'over');
});

await H.check('R5 advisory: direct call flags the opponent\'s open shape', async () => {
  // W holds an open three C4-D4-E4 (both ends empty); B to move must be warned
  const g = emptyGrid();
  g[3][2] = 'W'; g[3][3] = 'W'; g[3][4] = 'W';
  g[7][7] = 'B';
  const out = (await engine.call('rule.R5.check', { grid: g, player: 'B', seq: 'direct' })).data;
  H.ok(out.fired && String(out.why).includes('open three'), 'R5 why: ' + out.why);
  H.ok(out.theirs.open4 >= 1, 'scan bucket open4 for the opponent');
});

await H.check('cross-checked games vs reference (4 seeds)', async () => {
  for (const seed of [5, 55, 555, 5555]) await playGame({ seed });
});

// ── learning experiment ───────────────────────────────────────────────────────
const GENS = 24, GAMES = 8;
const curve = [];
await H.check(`learning loop: ${GENS}x${GAMES} vs frozen generation-1 self — discovers blocking`, async () => {
  const t0 = Date.now();
  for (let gen = 1; gen <= GENS; gen++) {
    let wins = 0, losses = 0, draws = 0;
    for (let g = 0; g < GAMES; g++) {
      const learnerSide = g % 2 === 0 ? 'B' : 'W';
      const res = await playGame({ learnerSide, seed: 700 * gen + g, learn: true });
      const r = (await engine.call('learn.update', { side: learnerSide })).data;
      if (r.result === 'W') wins++; else if (r.result === 'L') losses++; else draws++;
    }
    const theta = await get('ai.weights');
    curve.push({ gen, wins, losses, draws, win_rate: Math.round((100 * wins) / GAMES),
      theta: { ...theta }, blockFive: theta.tookFive, blockOpen4: theta.missedFive });
  }
  if (globalThis.__verbose) {
    for (const c of curve) console.log(`      ${String(c.gen).padStart(3)}  ${c.wins}-${c.losses}-${c.draws}  ${String(c.win_rate).padStart(3)}  blockFive=${c.blockFive.toFixed(2)} blockOpen4=${c.blockOpen4.toFixed(2)}`);
    console.log(`      (${Date.now() - t0}ms)`);
  }
  const first = curve.slice(0, 6).reduce((s, c) => s + c.win_rate, 0) / 6;
  const last = curve.slice(-6).reduce((s, c) => s + c.win_rate, 0) / 6;
  H.ok(last > first, `training curve did not trend up: ${first.toFixed(0)}% -> ${last.toFixed(0)}%`);
  const tEnd = curve[curve.length - 1].theta;
  H.ok(tEnd.tookFive > 0.5 || tEnd.missedFive < -0.5, 'learner never learned about the five-square (tookFive <= 0.5 and missedFive >= -0.5)');
  // held-out evaluation: final policy vs frozen generation-1, 40 games, 20 per colour
  let ew = 0, el = 0, ed = 0;
  for (let g = 0; g < 40; g++) {
    const learnerSide = g % 2 === 0 ? 'B' : 'W';
    const res = await playGame({ learnerSide, seed: 880000 + g, learn: false });
    if (res.winner === learnerSide) ew++; else if (res.winner === 'draw') ed++; else el++;
  }
  const evalRate = Math.round((100 * ew) / 40);
  curve.push({ gen: 'eval', wins: ew, losses: el, draws: ed, win_rate: evalRate, theta: { ...(await get('ai.weights')) } });
  H.ok(evalRate >= 60, `held-out eval vs generation-1 self: ${evalRate}% (need >= 60% over 40 games)`);
  if (globalThis.__verbose) console.log(`      EVAL vs gen-1: ${ew}W-${el}L-${ed}D = ${evalRate}%`);
});

await H.check('witness ledger: chain re-derives from GENESIS', async () => {
  const receipts = await get('learn.receipts');
  H.eq(receipts.length, GENS * GAMES);
  const last = verifyChain(receipts, (r) => ({ seq: r.seq, side: r.side, result: r.result,
    score_b: r.score_b, score_w: r.score_w, theta_hash: r.theta_hash, win_rate10: r.win_rate10 }));
  H.eq(last, receipts[receipts.length - 1].row_hash);
  const snapshot = await get('learn.last');
  H.eq(snapshot.receipt.theta_hash, fnv1a64(canon(snapshot.theta)));
});

await H.check('mirror invariant over the final position', async () => {
  const grid = await get('board.grid');
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++)
    H.eq(await get(`board.r${r + 1}c${c + 1}`), grid[r][c]);
});

const { pass, fail } = await H.done();
mkdirSync(join(here, '..', '..', 'experiments'), { recursive: true });
writeFileSync(join(here, '..', '..', 'experiments', 'gomoku.json'), JSON.stringify({
  game: 'gomoku', gens: GENS, games_per_gen: GAMES, alpha: await get('learn.alpha'),
  theta0: THETA0, baseline: "frozen theta0 (the learner's own generation-1 policy)",
  curve, checks: { pass, fail }, generated: new Date().toISOString(),
}, null, 2) + '\n');
writeFileSync(join(here, 'gomoku.sheet.json'), JSON.stringify(buildSheet(), null, 2) + '\n');
console.log('  (emitted gomoku.sheet.json — ' + buildSheet().cells.length + ' cells; experiments/gomoku.json)');
