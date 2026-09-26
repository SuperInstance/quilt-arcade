// PONG PLUGIN — the two-file linkable surface (module.mjs + manifest.json).
//
// The continuous game on the discrete sheet: physics laws as rule cells,
// the tick arbiter as referee, seeded deterministic serves. The module
// talks to the engine core and the shared platform only — never to another
// game module. run_all Phase A re-verifies the manifest against buildSheet().
import { buildSheet } from './sheet.mjs';

export const id = 'pong';
export const receipts = {
  sources: [{ cell: 'log.events', chained: false, hint: 'log.events — the sheet audit trail: new_game, paddle hits, points, serves, closure' }],
  min: 1,
};

export { buildSheet };

// Interactive-surface driver (headless-verifiable contract; a canvas viewer
// can consume this same object in a follow-up — see play.mjs for the proof).
export function createDriver(engine) {
  const get = async (id) => {
    try { return (await engine.get(id)).data; } catch { return undefined; }
  };
  return {
    title: 'Pong — realtime laws on the discrete sheet',
    tagline: '14 law cells · deterministic serves · AI vs AI',
    async newGame(seed = 1) { return (await engine.call('new_game', { seed })).data; },
    async step(n = 1) {
      let last;
      for (let i = 0; i < n; i++) { last = (await engine.call('match.step')).data; if (last?.over) break; }
      return last;
    },
    // human override: take a paddle (release with side=null)
    async setPaddle(side, y) {
      if (side) await engine.set('paddle.' + side, y);
      return { side, y: side ? await get('paddle.' + side) : null };
    },
    async snapshot() {
      const fired = (await get('rules.fired')) ?? [];
      return {
        ball: { x: await get('ball.x'), y: await get('ball.y'), vx: await get('ball.vx'), vy: await get('ball.vy') },
        paddles: { left: await get('paddle.left'), right: await get('paddle.right') },
        scores: { left: await get('score.left'), right: await get('score.right') },
        phase: await get('phase.current'),
        winner: await get('winner.current'),
        ticks: await get('tick.count'),
        fired,
        rules: (await Promise.all(['W1', 'W2', 'W3', 'W4'].map(async (id) => ({
          id, law: (await get(`rule.${id}.law`)) ?? '', fired: fired.includes(id),
          why: (await get(`rule.${id}.verdict`))?.why ?? '',
        })))),
        events: ((await get('log.events')) ?? []).slice(-12),
      };
    },
  };
}

// headless smoke: boot → seeded new_game → a few ticks → the audit log
// must carry ≥1 receipt line (the new_game row).
export async function smoke(engine) {
  await engine.call('new_game', { seed: 5 });
  for (let i = 0; i < 3; i++) await engine.call('match.step');
  const rows = (await engine.get('log.events')).data ?? [];
  return { receipts: rows, detail: `${rows.length} audit lines after a seeded serve` };
}
