// TICTACTOE PLUGIN — the two-file linkable surface (module.mjs + manifest.json).
//
// The game module talks to the engine core and the shared platform only —
// never to another game module. The manifest declares the cells, listeners,
// receipts surface, deps and slots; run_all Phase A re-verifies that the
// declarations match buildSheet() exactly.
import { buildSheet } from './sheet.mjs';
import { createDriver as gridDriver } from '../../shared/driver.mjs';

export const id = 'tictactoe';
export const slots = ['judge', 'jester', 'predictor'];
export const receipts = {
  sources: [{ cell: 'log.events', chained: false, hint: 'log.events — the sheet audit trail, one line per accepted/refused move' }],
  min: 1,
};

export { buildSheet };

const empties = (grid) => {
  const out = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (!grid[r][c]) out.push('ABC'[c] + (r + 1));
  return out;
};

export function createDriver(engine) {
  return gridDriver({
    engine,
    title: 'TicTacToe — the template game',
    tagline: '~40 cells · rules-as-cells · perfect minimax',
    shape: { rows: 3, cols: 3, colLabels: 'ABC'.split(''), cellSize: 92 },
    ruleIds: ['R1', 'R2', 'R3', 'R4'],
    humanColor: 'X',
    thetaKeys: null,
    requestFor: (r, c, player) => ({ r, c, player }),
    faces: (v) => v === 'X' ? { glyph: '✕', cls: 'b' } : v === 'O' ? { glyph: '◯', cls: 'w' } : { glyph: '', cls: '' },
    scores: async (get) => [
      { label: '✕ marks', value: await get('score.x') },
      { label: '◯ marks', value: await get('score.o') },
    ],
    hints: async (get, grid) => empties(grid),
    // CVC variety: O plays seeded-random legal moves against perfect X
    randomSide: (rnd, side, grid) => {
      const opts = empties(grid);
      if (!opts.length) return null;
      const sq = opts[Math.floor(rnd() * opts.length)];
      return { r: Number(sq[1]) - 1, c: 'ABC'.indexOf(sq[0]), player: side };
    },
  });
}

// headless smoke: boot → one AI ply → the audit log must carry ≥1 receipt line.
export async function smoke(engine) {
  await engine.call('new_game');
  await engine.call('match.step', { seed: 7 });
  const rows = (await engine.get('log.events')).data ?? [];
  return { receipts: rows, detail: `${rows.length} audit lines after one AI ply` };
}
