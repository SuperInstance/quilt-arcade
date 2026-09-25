// QUILT ARCADE — plugin loader / validator / headless smoke harness.
//
// A game is a PLUGIN: a manifest.json (declares cells, listeners, receipts
// surface, deps, slots) + a module.mjs (buildSheet, createDriver, smoke).
// The two files are the whole linkable surface. Game modules never import
// each other — they talk to the engine core and the shared platform only.
//
//   const found  = discoverPlugins();          // every games/*/manifest.json
//   const plugin = await loadPlugin(found[0]); // manifest + module + errors[]
//   const errs   = await validateSheet(plugin);// manifest cells ≡ built cells
//   const smoke  = await smokePlugin(plugin);  // boots headless, demands receipts
//
// The stub DOM lets a plugin boot under bare node — a plugin that reaches for
// real browser APIs during smoke is a bug (its viewer belongs in the iframe).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { QuiltEngine } from './engine/index.js';
import { verifyChain } from './shared/kit.mjs';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const GAMES_DIR = join(ROOT, 'games');

// ── stub DOM (headless smoke) ────────────────────────────────────────────────
export function installStubDom() {
  if (globalThis.document) return;
  const el = () => ({
    innerHTML: '', textContent: '', className: '', style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, append() {}, addEventListener() {}, setAttribute() {},
    querySelector: () => null, querySelectorAll: () => [],
    get offsetWidth() { return 0; },
  });
  globalThis.window = globalThis;
  globalThis.document = {
    getElementById: () => el(), createElement: () => el(), createElementNS: () => el(),
    querySelector: () => el(), querySelectorAll: () => [], body: el(), head: el(),
  };
}

// ── discovery ────────────────────────────────────────────────────────────────
export function discoverPlugins(gamesDir = GAMES_DIR) {
  const out = [];
  if (!existsSync(gamesDir)) return out;
  for (const name of readdirSync(gamesDir).sort()) {
    const dir = join(gamesDir, name);
    const manifestPath = join(dir, 'manifest.json');
    if (existsSync(manifestPath)) out.push({ id: name, dir, manifestPath });
  }
  return out;
}

// ── loading + module/manifest consistency ────────────────────────────────────
export async function loadPlugin({ dir, manifestPath }) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const errors = [];
  if (!manifest.id) errors.push('manifest.id missing');
  if (!manifest.entry) errors.push('manifest.entry missing');
  let module = null;
  if (manifest.entry) {
    try {
      module = await import(pathToFileURL(join(dir, manifest.entry)).href);
    } catch (e) {
      errors.push(`entry import failed: ${e.message}`);
    }
  }
  if (module) {
    if (module.id !== manifest.id)
      errors.push(`module.id '${module.id}' ≠ manifest.id '${manifest.id}'`);
    for (const k of ['buildSheet', 'createDriver', 'smoke'])
      if (typeof module[k] !== 'function') errors.push(`module.${k} is not a function`);
    if (JSON.stringify(module.slots ?? null) !== JSON.stringify(manifest.slots ?? null))
      errors.push(`module.slots ≠ manifest.slots (${JSON.stringify(module.slots)} vs ${JSON.stringify(manifest.slots)})`);
    if (JSON.stringify(module.receipts ?? null) !== JSON.stringify(manifest.receipts ?? null))
      errors.push('module.receipts ≠ manifest.receipts');
  }
  return { manifest, module, errors };
}

// ── manifest declarations ≡ built sheet ──────────────────────────────────────
export function validateSheet(plugin) {
  const { manifest, module } = plugin;
  const errors = [];
  const sheet = module.buildSheet();
  const built = sheet.cells.map((c) => c.id).sort();
  const declared = [...(manifest.cells ?? [])].sort();
  if (JSON.stringify(built) !== JSON.stringify(declared)) {
    const missing = built.filter((x) => !declared.includes(x));
    const extra = declared.filter((x) => !built.includes(x));
    errors.push(`cell declaration mismatch — built-not-declared: [${missing.join(', ')}] / declared-not-built: [${extra.join(', ')}]`);
  }
  const builtL = sheet.cells
    .filter((c) => c.kind === 'listener')
    .map((c) => ({ id: c.id, watch: c.watch, action: c.action }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const declaredL = [...(manifest.listeners ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1));
  if (JSON.stringify(builtL) !== JSON.stringify(declaredL))
    errors.push(`listener declaration mismatch — built: ${JSON.stringify(builtL)} declared: ${JSON.stringify(declaredL)}`);
  return errors;
}

// ── smoke: boot headless, run the plugin's own minimal interaction ──────────
// Asserts: the sheet loads, the plugin drives ≥1 receipt into its declared
// receipts surface, and every declared fnv1a64 chain re-derives from GENESIS.
export async function smokePlugin(plugin) {
  const { manifest, module } = plugin;
  const engine = new QuiltEngine(`smoke-${manifest.id}`, { eager: true });
  engine.loadSheet(module.buildSheet());
  const out = await module.smoke(engine);
  const min = manifest.receipts?.min ?? 1;
  const got = Array.isArray(out?.receipts) ? out.receipts.length : 0;
  if (got < min) throw new Error(`receipts ${got} < required min ${min}`);
  const chains = [];
  for (const src of manifest.receipts?.sources ?? []) {
    if (!src.chained) continue;
    const rows = (await engine.get(src.cell)).data ?? [];
    if (!rows.length) throw new Error(`chained source '${src.cell}' is empty after smoke`);
    const fields = src.fields ?? [];
    const last = verifyChain(rows, (r) => Object.fromEntries(fields.map((f) => [f, r[f]])));
    const ok = last === rows[rows.length - 1].row_hash;
    chains.push({ cell: src.cell, links: rows.length, ok });
    if (!ok) throw new Error(`hash chain broken in '${src.cell}' after ${rows.length} links`);
  }
  return { engine, ...out, chains };
}
