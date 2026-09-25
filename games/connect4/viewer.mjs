// CONNECT FOUR VIEWER ENTRY — click a column letter to drop; gravity, threats
// and connect-four law as rule cells; learner vs frozen-baseline CVC mode.
import { QuiltEngine } from '../../engine/index.js';
import { buildSheet } from './sheet.mjs';
import { mountGame } from '../../shared/viewer.mjs';
import { createDriver } from '../../shared/driver.mjs';

const engine = new QuiltEngine('view-connect4', { eager: true });
engine.loadSheet(buildSheet());

const dropRow = (grid, c) => { for (let r = 5; r >= 0; r--) if (grid[r][c] === '') return r; return -1; };

const driver = createDriver({
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

window.__engine = engine;
window.__driver = driver;
mountGame(document.getElementById('app'), driver);
