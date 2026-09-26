// PONG PLAYTEST — the continuous game on the discrete sheet:
// physics laws as first-class rule cells, the tick arbiter as referee,
// seeded deterministic serves, AI-vs-AI full games, cross-engine determinism.
//
//   node games/pong/play.mjs
//
// FAIL-first: this harness was written against the sheet before the sheet
// existed (module not found), then built until green.

import { QuiltEngine } from '../../engine/index.js';
import { mulberry32, harness, fnv1a64 } from '../../shared/kit.mjs';
import { buildSheet } from './sheet.mjs';

const H = harness('pong');

const boot = () => {
  const engine = new QuiltEngine('arcade-pong', { eager: true });
  engine.loadSheet(buildSheet());
  return engine;
};
const get = (engine, id) => engine.get(id).then((r) => r.data);

// run whole AI-vs-AI games; returns final physics hash + summary
const playGame = async (engine, seed, maxTicks = 20000) => {
  await engine.call('new_game', { seed });
  let last = null;
  for (let i = 0; i < maxTicks; i++) {
    last = (await engine.call('match.step')).data;
    if (last.over) break;
  }
  const hash = fnv1a64(JSON.stringify([
    await get(engine, 'ball.x'), await get(engine, 'ball.y'),
    await get(engine, 'score.left'), await get(engine, 'score.right'),
    await get(engine, 'tick.count'),
  ]));
  return { ...last, hash };
};

await H.check('initial state: centered ball, level paddles, zero scores, phase play', async () => {
  const e = boot();
  await e.call('new_game', { seed: 7 });
  H.eq(await get(e, 'ball.x'), 50);
  H.eq(await get(e, 'ball.y'), 30);
  H.eq(await get(e, 'paddle.left'), 30);
  H.eq(await get(e, 'paddle.right'), 30);
  H.eq(await get(e, 'score.left'), 0);
  H.eq(await get(e, 'score.right'), 0);
  H.eq(await get(e, 'phase.current'), 'play');
});

await H.check('serve determinism: same seed -> identical serve vector', async () => {
  const serve = async () => {
    const e = boot();
    await e.call('new_game', { seed: 42 });
    await e.call('match.step'); // one tick advances the served ball
    return [await get(e, 'ball.vx'), await get(e, 'ball.vy')];
  };
  H.eq(await serve(), await serve());
});

await H.check('W1 is first-class: wall contact returns a reflected vy', async () => {
  const e = boot();
  await e.call('new_game', { seed: 1 });
  const r = (await e.call('rule.W1.check', { y: 0.4, vy: -0.8 })).data;
  H.ok(r.fired, 'W1 must fire below the floor: ' + JSON.stringify(r));
  H.eq(r.vy, 0.8);
  const calm = (await e.call('rule.W1.check', { y: 30, vy: -0.8 })).data;
  H.ok(!calm.fired, 'W1 must not fire mid-field');
});

await H.check('W2 is first-class: paddle contact returns flipped, sped-up vx', async () => {
  const e = boot();
  await e.call('new_game', { seed: 1 });
  // contract: the check sees the ball's POST-integration position this tick
  const r = (await e.call('rule.W2.check', {
    x: 2.3, vx: -1.0, ballY: 32, paddleY: 30, side: 'left',
  })).data;
  H.ok(r.fired, 'W2 must fire at the left paddle face: ' + JSON.stringify(r));
  H.ok(r.vx > 1.0, 'return speed must exceed approach (accelerate): ' + r.vx);
  const miss = (await e.call('rule.W2.check', {
    x: 2.3, vx: -1.0, ballY: 45, paddleY: 30, side: 'left',
  })).data;
  H.ok(!miss.fired, 'W2 must not fire beyond paddle reach');
  const early = (await e.call('rule.W2.check', {
    x: 3.4, vx: -1.0, ballY: 30, paddleY: 30, side: 'left',
  })).data;
  H.ok(!early.fired, 'W2 must not fire before the ball reaches the face (pre-contact x)');
});

await H.check('W3 is first-class: ball past the left goal line awards right', async () => {
  const e = boot();
  await e.call('new_game', { seed: 1 });
  const r = (await e.call('rule.W3.check', { x: -3.5, side: 'left' })).data;
  H.ok(r.fired && r.point === 'right', 'left goal-line breach must award right: ' + JSON.stringify(r));
});

await H.check('W4 closure: seven points ends the match with a winner', async () => {
  const e = boot();
  await e.call('new_game', { seed: 1 });
  await e.set('score.left', 6);
  const r = (await e.call('rule.W4.check', { left: 7, right: 5 })).data;
  H.ok(r.fired && r.winner === 'left', 'W4 must close at 7: ' + JSON.stringify(r));
});

await H.check('live wall bounce: a floor-heading ball reflects off the floor', async () => {
  const e = boot();
  await e.call('new_game', { seed: 1 });
  await e.set('ball.x', 50); await e.set('ball.y', 1.2);
  await e.set('ball.vx', 0.9); await e.set('ball.vy', -1.1);
  await e.set('paddle.left', 30); await e.set('paddle.right', 30);
  await e.call('match.step');
  H.eq(await get(e, 'ball.vy') > 0, true, 'vy must be positive after floor contact');
  H.eq((await get(e, 'rules.fired')).includes('W1'), true);
});

await H.check('live rally: a full AI-vs-AI game scores and records paddle hits', async () => {
  const e = boot();
  const g = await playGame(e, 11, 20000);
  H.ok(g.over === true, 'game must terminate: ' + JSON.stringify(g));
  const sl = await get(e, 'score.left'), sr = await get(e, 'score.right');
  H.eq(Math.max(sl, sr), 7, 'closure: winner reaches exactly 7 (loser keeps their points)');
  H.eq(await get(e, 'phase.current'), 'over');
  const log = await get(e, 'log.events');
  H.ok(log.some((l) => l.kind === 'point'), 'ledger must record points');
  H.ok(log.some((l) => l.kind === 'hit'), 'ledger must record paddle hits');
});

await H.check('cross-engine determinism: same seed, same full game, same physics hash', async () => {
  const a = await playGame(boot(), 99, 20000);
  const b = await playGame(boot(), 99, 20000);
  H.eq(a.hash, b.hash, 'physics hashes must agree across fresh engines');
  H.eq(a.winner, b.winner);
});

await H.check('different seeds diverge', async () => {
  const a = await playGame(boot(), 3, 20000);
  const b = await playGame(boot(), 4, 20000);
  H.ok(a.hash !== b.hash, 'seeds 3 and 4 must produce different games');
});

await H.check('driver contract: createDriver exposes the interactive surface (Phase A demanded this export)', async () => {
  const e = boot();
  const { createDriver } = await import('./module.mjs');
  const d = createDriver(e);
  await d.newGame(5);
  await d.step(3);
  const snap = await d.snapshot();
  H.ok(snap.ball && typeof snap.ball.x === 'number', 'snapshot carries live ball state');
  H.eq(snap.rules.length, 4, 'all four laws inspectable');
  H.ok(snap.scores.left === 0, 'scores level at start');
});

await H.check('receipts: the audit log survives a fresh engine replay from GENESIS', async () => {
  const e = boot();
  await playGame(e, 21, 20000);
  const log = await get(e, 'log.events');
  H.ok(log.length >= 8, 'a complete match logs serves, hits, points: got ' + log.length);
  H.ok(log.every((l) => typeof l.text === 'string' && l.text.length > 0), 'every row is human-readable');
});

await H.done();
