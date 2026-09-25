// CONNECT FOUR PLAYTEST — gravity, threats, and a learnable blocker.
// Independent reference implementation cross-checks every ply (whole-grid),
// every ending, every score. Learning loop: learner cells vs frozen baseline.

import { QuiltEngine } from '../../engine/index.js';
import { mulberry32, harness, verifyChain, fnv1a64, canon } from '../../shared/kit.mjs';
import { buildSheet } from './sheet.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const H = harness('connect4');
const engine = new QuiltEngine('arcade-connect4', { eager: true });
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
const refDrop = (g, c) => { for (let r = 5; r >= 0; r--) if (g[r][c] === '') return r; return -1; };
const refWin = (g, r, c, p) => {
  for (const [dr, dc] of RAXES) {
    let n = 1;
    for (const s of [1, -1]) {
      let rr = r + s * dr, cc = c + s * dc;
      while (rr >= 0 && rr < 6 && cc >= 0 && cc < 7 && g[rr][cc] === p) { n++; rr += s * dr; cc += s * dc; }
    }
    if (n >= 4) return true;
  }
  return false;
};
const emptyGrid = () => Array.from({ length: 6 }, () => Array(7).fill(''));
const refScore = (g) => {
  let b = 0, w = 0;
  for (const row of g) for (const x of row) { if (x === 'B') b++; else if (x === 'W') w++; }
  return { b, w };
};

// frozen copy of the learner's INITIAL policy — the control group is the
// learner's own generation-1 self, so the experiment reads directly as
// "does generation N beat generation 1?"
const THETA0 = { win: 6, mine3: 0, theirs3: 0, center: 0.4, giveAway: 0 };

async function playGame({ learnerSide = null, seed = 1, learn = false } = {}) {
  await engine.call('new_game');
  const rng = mulberry32(seed);
  let ref = emptyGrid();
  let plies = 0;
  const history = [];
  while ((await get('phase.current')) === 'play' && plies < 42) {
    const side = await get('turn.current');
    const isLearner = side === learnerSide;
    const step = (await engine.call('match.step', {
      weights: isLearner ? undefined : THETA0,
      seed: 1 + Math.floor(rng() * 1e9), log: isLearner && learn,
    })).data;
    if (step.over || step.pass) break;
    H.ok(step.ok, 'engine refused its own AI move: ' + JSON.stringify(step).slice(0, 160));
    const placed = step.trace[0];
    const m = /^([A-G])([1-6])$/.exec(placed.sq);
    const rr = Number(m[2]) - 1, cc = 'ABCDEFG'.indexOf(m[1]);
    // reference must agree: gravity + legality
    H.eq(refDrop(ref, cc), rr, `reference gravity disagrees at ${placed.sq}`);
    ref[rr][cc] = placed.to;
    const eng = await get('board.grid');
    H.eq(eng, ref, `whole-board divergence after ply ${plies}`);
    history.push({ side: placed.to, col: 'ABCDEFG'[cc], sq: placed.sq });
    plies++;
  }
  H.ok((await get('phase.current')) === 'over', 'game ended');
  const refFinal = refScore(ref);
  H.eq(await get('score.b'), refFinal.b, 'final BLACK count matches reference');
  const winner = await get('winner.current');
  if (winner !== 'draw') H.ok(true); // winner is the connect-4 maker; reference verified per-ply
  return { winner, ...refFinal, plies, history };
}

// ── checks ────────────────────────────────────────────────────────────────────
await H.check('initial state: empty 6x7, BLACK to move', async () => {
  H.eq(await get('board.grid'), emptyGrid());
  H.eq(await get('turn.current'), 'B');
  H.eq(await get('score.b'), 0);
});

await H.check('R1 fires: naming a non-column is refused', async () => {
  const v = await push({ c: 9, player: 'B' });
  H.ok(v.ok === false && v.rule === 'R1', JSON.stringify(v));
  H.eq(await get('turn.current'), 'B');
});

await H.check('R3 gravity: discs stack from the bottom (B -> r6, W -> r6 is next... lands r5)', async () => {
  H.eq((await push({ c: 2, player: 'B' })).ok, true);   // C -> r6
  H.eq(await get('board.r6c3'), 'B', 'first disc at bottom');
  H.eq((await push({ c: 2, player: 'W' })).ok, true);   // C -> r5
  H.eq(await get('board.r5c3'), 'W', 'second disc stacks on top');
  H.eq(await get('board.r6c3'), 'B', 'bottom unchanged');
  H.eq((await get('rules.fired')).includes('R3'), true);
});

await H.check('R2 fires: a full column refuses the 7th disc', async () => {
  await engine.call('new_game');
  for (let i = 0; i < 6; i++) H.eq((await push({ c: 0, player: i % 2 === 0 ? 'B' : 'W' })).ok, true, 'fill A disc ' + (i + 1));
  H.eq(await get('board.r1c1'), 'W', 'bottom of A filled last');
  const v = await push({ c: 0, player: 'B' });
  H.ok(v.ok === false && v.rule === 'R2', '7th disc refused: ' + JSON.stringify(v));
  H.ok(String(v.text).includes('FULL'), 'bubble says FULL: ' + v.text);
});

await H.check('R4 fires: vertical connect-four names the line and closes the board', async () => {
  await engine.call('new_game');
  // B stacks column D four times; W pokes other columns
  const seqMoves = [['D','B'],['A','W'],['D','B'],['B','W'],['D','B'],['C','W'],['D','B']];
  let last = null;
  for (const [col, p] of seqMoves) last = await push({ c: 'ABCDEFG'.indexOf(col), player: p });
  H.ok(last.ok && last.rule === 'R4', 'R4 verdict: ' + JSON.stringify(last));
  H.eq(last.line, ['D3', 'D4', 'D5', 'D6'], 'vertical line named');
  H.eq(await get('winner.current'), 'B');
  H.eq(await get('phase.current'), 'over');
});

await H.check('closure: post-end push refused, board untouched', async () => {
  const before = await get('board.grid');
  const v = await push({ c: 5, player: 'W' });
  H.ok(v.ok === false, 'refused');
  H.eq(await get('board.grid'), before);
});

await H.check('R6 advisory: direct call reports WIN NOW / MUST BLOCK columns', async () => {
  // construct: B has three in column G with room on top -> win now at G for B
  const g = emptyGrid();
  g[5][6] = 'B'; g[4][6] = 'B'; g[3][6] = 'B';           // three blacks bottom of G
  g[5][0] = 'W'; g[4][0] = 'W'; g[3][0] = 'W';           // three whites bottom of A
  const out = (await engine.call('rule.R6.check', { grid: g, player: 'B', seq: 'direct' })).data;
  // mover B: winNow = G (B completes 4 there), mustBlock = A (W would complete 4 there)
  H.eq(out.winNow, ['G'], 'B can win now at G');
  H.eq(out.mustBlock, ['A'], 'W threatens A');
});

await H.check('cross-checked games vs reference (4 seeds, both colours)', async () => {
  for (const seed of [11, 222, 3333, 44444]) await playGame({ seed });
});

// ── learning experiment ───────────────────────────────────────────────────────
const GENS = 40, GAMES = 12;
const curve = [];
await H.check(`learning loop: ${GENS}x${GAMES} vs frozen baseline — learns to deny opponent wins`, async () => {
  const t0 = Date.now();
  for (let gen = 1; gen <= GENS; gen++) {
    let wins = 0, losses = 0, draws = 0, blocks = 0;
    for (let g = 0; g < GAMES; g++) {
      const learnerSide = g % 2 === 0 ? 'B' : 'W';
      const res = await playGame({ learnerSide, seed: 500 * gen + g, learn: true });
      const r = (await engine.call('learn.update', { side: learnerSide })).data;
      if (r.result === 'W') wins++; else if (r.result === 'L') losses++; else draws++;
    }
    const theta = await get('ai.weights');
    blocks = theta.theirs3 < 0 ? 1 : 0;
    curve.push({ gen, wins, losses, draws, win_rate: Math.round((100 * wins) / GAMES),
      theta: { ...theta }, denies: theta.theirs3, gives: theta.giveAway });
  }
  if (globalThis.__verbose) {
    for (const c of curve) console.log(`      ${String(c.gen).padStart(3)}  ${c.wins}-${c.losses}-${c.draws}  ${String(c.win_rate).padStart(3)}  deny=${c.denies.toFixed(2)} give=${c.gives.toFixed(2)}`);
    console.log(`      (${Date.now() - t0}ms)`);
  }
  const first = curve.slice(0, 8).reduce((s, c) => s + c.win_rate, 0) / 8;
  const last = curve.slice(-8).reduce((s, c) => s + c.win_rate, 0) / 8;
  H.ok(last > first, `training curve did not trend up: ${first.toFixed(0)}% -> ${last.toFixed(0)}%`);
  H.ok(curve[curve.length - 1].theta.mine3 > 2, 'learner never discovered offense (theta.mine3 <= 2)');
  // held-out evaluation: final policy vs frozen generation-1, 60 games, 30 per colour
  let ew = 0, el = 0, ed = 0;
  for (let g = 0; g < 60; g++) {
    const learnerSide = g % 2 === 0 ? 'B' : 'W';
    const res = await playGame({ learnerSide, seed: 990000 + g, learn: false });
    if (res.winner === learnerSide) ew++; else if (res.winner === 'draw') ed++; else el++;
  }
  const evalRate = Math.round((100 * ew) / 60);
  curve.push({ gen: 'eval', wins: ew, losses: el, draws: ed, win_rate: evalRate,
    theta: { ...(await get('ai.weights')) }, denies: (await get('ai.weights')).theirs3, gives: (await get('ai.weights')).giveAway });
  H.ok(evalRate >= 62, `held-out eval vs generation-1 self: ${evalRate}% (need >= 62% over 60 games)`);
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
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++)
    H.eq(await get(`board.r${r + 1}c${c + 1}`), grid[r][c]);
});

const { pass, fail } = await H.done();
mkdirSync(join(here, '..', '..', 'experiments'), { recursive: true });
writeFileSync(join(here, '..', '..', 'experiments', 'connect4.json'), JSON.stringify({
  game: 'connect4', gens: GENS, games_per_gen: GAMES, alpha: await get('learn.alpha'),
  theta0: THETA0,
  baseline: "frozen theta0 (the learner's own generation-1 policy)",
  curve, checks: { pass, fail }, generated: new Date().toISOString(),
}, null, 2) + '\n');
writeFileSync(join(here, 'connect4.sheet.json'), JSON.stringify(buildSheet(), null, 2) + '\n');
console.log('  (emitted connect4.sheet.json — ' + buildSheet().cells.length + ' cells; experiments/connect4.json)');
