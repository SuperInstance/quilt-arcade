// REVERSI VIEWER ENTRY — 64 board cells, sandwich rule bubbles, flip cascade,
// learning strip watching theta drift (corner discovery in real time).
import { QuiltEngine } from '../../engine/index.js';
import { buildSheet } from './sheet.mjs';
import { mountGame } from '../../shared/viewer.mjs';
import { createDriver } from '../../shared/driver.mjs';

const engine = new QuiltEngine('view-reversi', { eager: true });
engine.loadSheet(buildSheet());

const driver = createDriver({
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
    return ((await engine.call('legal.moves', { player: turn })).data ?? []).map(m => m.sq);
  },
});

window.__engine = engine;
window.__driver = driver;
mountGame(document.getElementById('app'), driver);
