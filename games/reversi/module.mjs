// REVERSI PLUGIN — two-file surface (module.mjs + manifest.json).
// Talks to the engine core and shared platform only; never to another game.
import { buildSheet } from './sheet.mjs';
import { createDriver as gridDriver } from '../../shared/driver.mjs';

export const id = 'reversi';
export const slots = ['judge', 'predictor'];
export const receipts = {
  sources: [{ cell: 'learn.receipts', chained: true, fields: ['seq', 'side', 'result', 'score_b', 'score_w', 'theta_hash', 'win_rate10'] }],
  min: 1,
};

export { buildSheet };

export function createDriver(engine) {
  return gridDriver({
    engine,
    title: 'Reversi — rules-as-cells flagship',
    tagline: '113 cells · sandwich law · flip cascade · learning loop with witness receipts',
    shape: { rows: 8, cols: 8, colLabels: 'ABCDEFGH'.split(''), cellSize: 54 },
    ruleIds: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'],
    humanColor: 'B',
    thetaKeys: ['corner', 'x', 'edge', 'mobility', 'frontier'],
    requestFor: (r, c, player) => ({ r, c, player }),
    faces: (v) => v === 'B' ? { glyph: '●', cls: 'b' } : v === 'W' ? { glyph: '○', cls: 'w' } : { glyph: '', cls: '' },
    scores: async (get) => [
      { label: '● black', value: await get('score.b'), emph: (await get('turn.current')) === 'B' },
      { label: '○ white', value: await get('score.w'), emph: (await get('turn.current')) === 'W' },
    ],
    hints: async (get, grid, turn) => {
      if ((await get('phase.current')) !== 'play') return [];
      return ((await engine.call('legal.moves', { player: turn })).data ?? []).map((m) => m.sq);
    },
  });
}

// headless smoke: boot → capped self-play → one perceptron update books a
// witness receipt → the fnv1a64 chain must re-derive from GENESIS.
export async function smoke(engine) {
  await engine.call('new_game');
  for (let i = 0; i < 80; i++) {
    const phase = (await engine.get('phase.current')).data;
    if (phase !== 'play') break;
    const res = (await engine.call('match.step', { seed: 100 + i, log: true })).data;
    if (res?.over || res?.pass) {
      // both sides may pass out the end of a reversi game
      const again = (await engine.call('match.step', { seed: 200 + i, log: true })).data;
      if (again?.over) break;
    }
  }
  await engine.call('learn.update', { side: 'B' });
  const rows = (await engine.get('learn.receipts')).data ?? [];
  return { receipts: rows, detail: `chain of ${rows.length} witness receipt(s) after capped self-play` };
}
