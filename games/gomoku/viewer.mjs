// GOMOKU VIEWER ENTRY — 9x9, five-in-line law naming the winning squares,
// pattern-based AI whose block weights you can watch being learned.
import { QuiltEngine } from '../../engine/index.js';
import { buildSheet } from './sheet.mjs';
import { mountGame } from '../../shared/viewer.mjs';
import { createDriver } from '../../shared/driver.mjs';

const engine = new QuiltEngine('view-gomoku', { eager: true });
engine.loadSheet(buildSheet());

const nearAny = (grid, r, c) => {
  for (let rr = Math.max(0, r - 2); rr <= Math.min(8, r + 2); rr++)
    for (let cc = Math.max(0, c - 2); cc <= Math.min(8, c + 2); cc++)
      if (grid[rr][cc] !== '') return true;
  return false;
};

const driver = createDriver({
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

window.__engine = engine;
window.__driver = driver;
mountGame(document.getElementById('app'), driver);
