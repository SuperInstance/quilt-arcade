// TICTACTOE VIEWER ENTRY — bundles into a single-file HTML (see build script).
import { QuiltEngine } from '../../engine/index.js';
import { buildSheet } from './sheet.mjs';
import { mountGame } from '../../shared/viewer.mjs';
import { createDriver } from '../../shared/driver.mjs';

const engine = new QuiltEngine('view-tictactoe', { eager: true });
engine.loadSheet(buildSheet());

const empties = (grid) => {
  const out = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (!grid[r][c]) out.push('ABC'[c] + (r + 1));
  return out;
};

const driver = createDriver({
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

window.__engine = engine;
window.__driver = driver;
mountGame(document.getElementById('app'), driver);
