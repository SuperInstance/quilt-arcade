// REVERSI VIEWER ENTRY — 64 board cells, sandwich rule bubbles, flip cascade,
// learning strip watching theta drift (corner discovery in real time).
// The driver + sheet + smoke live in module.mjs (the plugin surface); this
// file only wires the engine to the shared viewer and mounts receipts.
import { QuiltEngine } from '../../engine/index.js';
import { buildSheet, createDriver, receipts } from './module.mjs';
import { mountGame } from '../../shared/viewer.mjs';

const engine = new QuiltEngine('view-reversi', { eager: true });
engine.loadSheet(buildSheet());

const driver = createDriver(engine);

window.__engine = engine;
window.__driver = driver;
mountGame(document.getElementById('app'), driver, { engine, receipts: { sources: receipts.sources } });
