// QUILT ARCADE — plugin smoke runner + full playtest gate.
//
//   node run_all.mjs
//
// Phase A (plugin gate): discovers every games/*/manifest.json, loads the
// two-file plugin surface (module + manifest) under a stub DOM, validates
// manifest declarations against the built sheet, then boots each plugin
// headlessly and asserts it emits ≥1 receipt — chained sources must
// re-derive from GENESIS. FAIL-first: this gate existed before the games
// were pluginized, and failed until every plugin landed.
//
// Phase B (behavior gate): runs each game's full playtest harness
// (behavior-preserving — the pin from before the refactor) and aggregates
// experiments/learning_curves.md.

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverPlugins, installStubDom, loadPlugin, smokePlugin, validateSheet } from './plugins.mjs';
import { assertSlotsValid, createSlot, SLOT_NAMES } from './slots/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const games = ['tictactoe', 'reversi', 'connect4', 'gomoku', 'holdem'];

console.log('QUILT ARCADE — plugin smoke + full playtest run\n' + '='.repeat(52));

// ── Phase A: plugin smoke ────────────────────────────────────────────────────
installStubDom();
assertSlotsValid();

const smokeResults = [];
const found = discoverPlugins(join(here, 'games'));
const foundIds = new Set(found.map((f) => f.id));
console.log(`\n▶ PHASE A — plugin smoke (${found.length} manifests discovered)`);

// a game directory without a manifest is a plugin-gate failure
for (const game of games) {
  if (!foundIds.has(game)) {
    smokeResults.push({ game, ok: false, detail: 'no manifest.json — not a plugin yet' });
    console.log(`  ✗ ${game.padEnd(12)} no manifest.json — not a plugin yet`);
  }
}

for (const foundPlugin of found) {
  const t0 = Date.now();
  let ok = true;
  const fails = [];
  let plugin = null;
  try {
    plugin = await loadPlugin(foundPlugin);
    fails.push(...plugin.errors);
    if (!fails.length) {
      fails.push(...validateSheet(plugin));
      // declared slots must resolve against the registry
      for (const name of plugin.manifest.slots ?? []) {
        if (!SLOT_NAMES.includes(name)) { fails.push(`unknown slot '${name}'`); continue; }
        const slot = createSlot(name);
        if (slot.credentials.configured && !process.env[slot.credentials.env])
          fails.push(`slot '${name}' claims configured credentials but ${slot.credentials.env} is unset`);
      }
    }
    if (!fails.length) await smokePlugin(plugin);
  } catch (e) {
    fails.push(e.message);
  }
  ok = fails.length === 0;
  smokeResults.push({ game: foundPlugin.id, ok, detail: fails.join(' | ') });
  console.log(`  ${ok ? '✓' : '✗'} ${foundPlugin.id.padEnd(12)} boots + receipts + chains  (${Date.now() - t0}ms)`);
  if (!ok) console.log(`      ${fails.join('\n      ')}`);
}

// ── Phase B: full playtest harnesses (behavior-preserving) ──────────────────
console.log('\n▶ PHASE B — playtest harnesses');
const results = [];
for (const game of games) {
  process.stdout.write(`\n▶ ${game}\n`);
  const r = spawnSync('node', [join(here, 'games', game, 'play.mjs')], {
    encoding: 'utf8', timeout: 300000,
    env: { ...process.env, __verbose: process.env.__verbose ?? '' },
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const m = out.match(/: (\d+)\/(\d+) checks green in (\d+)ms/);
  const pass = m ? Number(m[1]) : 0, total = m ? Number(m[2]) : 0, ms = m ? Number(m[3]) : 0;
  const ok = r.status === 0 && pass === total && total > 0;
  results.push({ game, pass, total, ms, ok });
  if (!ok) console.log(out.split('\n').filter(l => l.includes('FAILED') || l.includes('Error')).slice(0, 6).join('\n'));
  console.log(`  ${ok ? '✓' : '✗'} ${pass}/${total} checks in ${ms}ms`);
}

// ── scoreboard ───────────────────────────────────────────────────────────────
console.log('\nSCOREBOARD');
console.log('─'.repeat(52));
for (const r of smokeResults) console.log(`${r.ok ? '✓' : '✗'} ${('[smoke] ' + r.game).padEnd(22)} ${r.ok ? 'plugin green' : r.detail}`);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${('[play] ' + r.game).padEnd(22)} ${r.pass}/${r.total} green  (${r.ms}ms)`);
const allOk = smokeResults.every((r) => r.ok) && results.every((r) => r.ok);
console.log('─'.repeat(52));
console.log(allOk
  ? `ALL GREEN — ${smokeResults.length} plugins smoke-clean, ${results.reduce((s, r) => s + r.pass, 0)} checks across ${results.length} games`
  : 'FAILURES PRESENT');

// ── aggregate the learning experiments ────────────────────────────────────────
const lines = ['# Learning curves — quilt-arcade', '',
  'Every number below was produced by cells: `ai.choose` (policy), `ai.move_log`',
  '(features of each learner move), `learn.update` (averaged perceptron + witness',
  'receipt). The control group is each learner\'s own frozen generation-1 policy.',
  'Receipt chains re-derive from GENESIS (see each harness).', ''];

for (const game of ['reversi', 'connect4', 'gomoku', 'holdem']) {
  const p = join(here, 'experiments', game + '.json');
  if (!existsSync(p)) continue;
  const d = JSON.parse(readFileSync(p, 'utf8'));
  if (game === 'holdem') {
    // different shape: per-block stacks (fish vs two learners with visible weights)
    const b = d.blocks ?? [];
    if (b.length) {
      const first = b[0], last = b[b.length - 1];
      const learnersFirst = first.stacks[1] + first.stacks[2], learnersLast = last.stacks[1] + last.stacks[2];
      lines.push(`## holdem (Texas Hold'em — hidden information + ML strategy cells)`, '');
      lines.push(`- setup: ${d.hands} hands, 3-max (frozen fish + two learners), α=${d.alpha}, nudge rate visible per hand`);
      lines.push(`- combined learner stacks: **${learnersFirst} → ${learnersLast}** chips vs the frozen fish at **${last.stacks[0]}** — the table hardens around a stationary opponent`);
      const drifts = Object.keys(d.theta0[1]).map(k => `\`${k}\`: ${(d.theta0[1][k]).toFixed(2)} → ${last.th1[k].toFixed(2)}`);
      lines.push(`- P1 weight refinement: ${drifts.join(', ')}`);
      lines.push(`- agent decision traces: ${d.thoughts_sample?.length ?? 0} entries captured (see \`ai.thoughts.pN\` cells and agent_ux_field_notes.md)`);
      lines.push('');
    }
    continue;
  }
  lines.push(`## ${game}`, '');
  lines.push(`- setup: ${d.gens} generations × ${d.games_per_gen} games, α=${d.alpha}, baseline: ${d.baseline}`);
  const curve = d.curve.filter(c => c.gen !== 'eval');
  const evalRow = d.curve.find(c => c.gen === 'eval');
  if (curve.length) {
    const first = curve.slice(0, 4).reduce((s, c) => s + c.win_rate, 0) / Math.min(4, curve.length);
    const last = curve.slice(-4).reduce((s, c) => s + c.win_rate, 0) / Math.min(4, curve.length);
    lines.push(`- training win rate: first-4-gen avg **${first.toFixed(0)}%** → last-4-gen avg **${last.toFixed(0)}%**`);
  }
  if (evalRow) lines.push(`- **held-out eval vs generation-1: ${evalRow.win_rate}%** over ${evalRow.wins + evalRow.losses + evalRow.draws} games (30 per colour)`);
  const t0 = d.theta0, tN = curve.length ? curve[curve.length - 1].theta : {};
  const drift = Object.keys(tN).filter(k => Math.abs((tN[k] ?? 0) - (t0[k] ?? 0)) > 0.5)
    .map(k => `\`${k}\`: ${(t0[k] ?? 0).toFixed(2)} → ${tN[k].toFixed(2)}`);
  if (drift.length) lines.push(`- weight discoveries: ${drift.join(', ')}`);
  lines.push('');
}
lines.push('What "learning" means here: the score cells stay honest (the referee validates every move),',
  'the weights are plain cell values you can watch move in the viewer\'s learning strip, and every',
  'generation is pinned into an fnv1a64 witness chain — tampering with history breaks the chain.');
writeFileSync(join(here, 'experiments', 'learning_curves.md'), lines.join('\n') + '\n');
console.log('\n(emitted experiments/learning_curves.md)');
process.exitCode = allOk ? 0 : 1;
