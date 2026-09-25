// GOMOKU VIEWER ENTRY — 9x9, five-in-line law naming the winning squares,
// pattern-based AI whose block weights you can watch being learned.
// The driver + sheet + smoke live in module.mjs (the plugin surface); this
// file only wires the engine to the shared viewer and mounts receipts.
import { QuiltEngine } from '../../engine/index.js';
import { buildSheet, createDriver, receipts } from './module.mjs';
import { mountGame } from '../../shared/viewer.mjs';

const engine = new QuiltEngine('view-gomoku', { eager: true });
engine.loadSheet(buildSheet());

const driver = createDriver(engine);

window.__engine = engine;
window.__driver = driver;
mountGame(document.getElementById('app'), driver, { engine, receipts: { sources: receipts.sources } });
