// CONNECT4 PLUGIN — two-file surface (module.mjs + manifest.json).
// Talks to the engine core and shared platform only; never to another game.
import { buildSheet } from './sheet.mjs';
import { createDriver as gridDriver } from '../../shared/driver.mjs';

export const id = 'connect4';
export const slots = ['judge', 'predictor'];
export const receipts = {
  sources: [{ cell: 'learn.receipts', chained: true, fields: ['seq', 'side', 'result', 'score_b', 'score_w', 'theta_hash', 'win_rate10'] }],
  min: 1,
};

export { buildSheet };

const dropRow = (grid, c) => { for (let r = 5; r >= 0; r--) if (grid[r][c] === '') return r; return -1; };

export function createDriver(engine) {
  return gridDriver({
    engine,
    title: 'Connect Four — gravity as a rule cell',
    tagline: '89 cells · WIN NOW / MUST BLOCK advisories · learnable threat denial',
    shape: { rows: 6, cols: 7, colLabels: 'ABCDEFG'.split(''), cellSize: 58, columnClickable: true },
    ruleIds: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'],
    humanColor: 'B',
    thetaKeys: ['win', 'mine3', 'theirs3', 'center', 'giveAway'],
    requestFor: (r, c, player) => ({ c, player }),
    faces: (v) => v === 'B' ? { glyph: '●', cls: 'b' } : v === 'W' ? { glyph: '○', cls: 'w' } : { glyph: '', cls: '' },
    scores: async (get) => [
      { label: '● black', value: await get('score.b'), emph: (await get('turn.current')) === 'B' },
      { label: '○ white', value: await get('score.w'), emph: (await get('turn.current')) === 'W' },
    ],
    hints: async (get, grid) => {
      const out = [];
      for (let c = 0; c < 7; c++) {
        const r = dropRow(grid, c);
        if (r >= 0) out.push('ABCDEFG'[c] + (r + 1));
      }
      return out;
    },
  });
}

// headless smoke: boot → capped self-play → one perceptron update books a
// witness receipt → the fnv1a64 chain must re-derive from GENESIS.
export async function smoke(engine) {
  await engine.call('new_game');
  for (let i = 0; i < 50; i++) {
    const phase = (await engine.get('phase.current')).data;
    if (phase !== 'play') break;
    const res = (await engine.call('match.step', { seed: 300 + i, log: true })).data;
    if (res?.over) break;
  }
  await engine.call('learn.update', { side: 'B' });
  const rows = (await engine.get('learn.receipts')).data ?? [];
  return { receipts: rows, detail: `chain of ${rows.length} witness receipt(s) after capped self-play` };
}
