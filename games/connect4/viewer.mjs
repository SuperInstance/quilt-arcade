// CONNECT FOUR VIEWER ENTRY — click a column letter to drop; gravity, threats
// and connect-four law as rule cells; learner vs frozen-baseline CVC mode.
// The driver + sheet + smoke live in module.mjs (the plugin surface); this
// file only wires the engine to the shared viewer and mounts receipts.
import { QuiltEngine } from '../../engine/index.js';
import { buildSheet, createDriver, receipts } from './module.mjs';
import { mountGame } from '../../shared/viewer.mjs';

const engine = new QuiltEngine('view-connect4', { eager: true });
engine.loadSheet(buildSheet());

const driver = createDriver(engine);

window.__engine = engine;
window.__driver = driver;
mountGame(document.getElementById('app'), driver, { engine, receipts: { sources: receipts.sources } });
