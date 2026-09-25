// GOMOKU PLUGIN — two-file surface (module.mjs + manifest.json).
// Talks to the engine core and shared platform only; never to another game.
import { buildSheet } from './sheet.mjs';
import { createDriver as gridDriver } from '../../shared/driver.mjs';

export const id = 'gomoku';
export const slots = ['judge', 'predictor'];
export const receipts = {
  sources: [{ cell: 'learn.receipts', chained: true, fields: ['seq', 'side', 'result', 'score_b', 'score_w', 'theta_hash', 'win_rate10'] }],
  min: 1,
};

export { buildSheet };

const nearAny = (grid, r, c) => {
  for (let rr = Math.max(0, r - 2); rr <= Math.min(8, r + 2); rr++)
    for (let cc = Math.max(0, c - 2); cc <= Math.min(8, c + 2); cc++)
      if (grid[rr][cc] !== '') return true;
  return false;
};

export function createDriver(engine) {
  return gridDriver({
    engine,
    title: 'Gomoku — pattern law + learning loop',
    tagline: '124 cells · five-in-line named by the rule · tookFive/missedFive gradient cells',
    shape: { rows: 9, cols: 9, colLabels: 'ABCDEFGHI'.split(''), cellSize: 46 },
    ruleIds: ['R1', 'R2', 'R3', 'R4', 'R5'],
    humanColor: 'B',
    thetaKeys: ['five', 'open4', 'four', 'open3', 'tookFive', 'missedFive', 'tookOpen4', 'missedOpen4'],
    requestFor: (r, c, player) => ({ r, c, player }),
    faces: (v) => v === 'B' ? { glyph: '●', cls: 'b' } : v === 'W' ? { glyph: '○', cls: 'w' } : { glyph: '', cls: '' },
    scores: async (get) => [
      { label: '● black', value: await get('score.b'), emph: (await get('turn.current')) === 'B' },
      { label: '○ white', value: await get('score.w'), emph: (await get('turn.current')) === 'W' },
    ],
    hints: async (get, grid, turn) => {
      if ((await get('phase.current')) !== 'play') return [];
      const out = [];
      for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++)
        if (grid[r][c] === '' && nearAny(grid, r, c)) out.push('ABCDEFGHI'[c] + (r + 1));
      return out.slice(0, 40);
    },
  });
}

// headless smoke: boot → capped self-play → one perceptron update books a
// witness receipt → the fnv1a64 chain must re-derive from GENESIS.
export async function smoke(engine) {
  await engine.call('new_game');
  for (let i = 0; i < 60; i++) {
    const phase = (await engine.get('phase.current')).data;
    if (phase !== 'play') break;
    const res = (await engine.call('match.step', { seed: 400 + i, log: true })).data;
    if (res?.over) break;
  }
  await engine.call('learn.update', { side: 'B' });
  const rows = (await engine.get('learn.receipts')).data ?? [];
  return { receipts: rows, detail: `chain of ${rows.length} witness receipt(s) after capped self-play` };
}
