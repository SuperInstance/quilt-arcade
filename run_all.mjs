// QUILT ARCADE — run every playtest harness and print the scoreboard.
// Also aggregates the learning experiments into experiments/learning_curves.md.
//
//   node run_all.mjs

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const games = ['tictactoe', 'reversi', 'connect4', 'gomoku', 'holdem'];

console.log('QUILT ARCADE — full playtest run\n' + '='.repeat(46));
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

console.log('\nSCOREBOARD');
console.log('─'.repeat(46));
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.game.padEnd(12)} ${r.pass}/${r.total} green  (${r.ms}ms)`);
const allOk = results.every(r => r.ok);
console.log('─'.repeat(46));
console.log(allOk ? `ALL GREEN — ${results.reduce((s, r) => s + r.pass, 0)} checks across ${results.length} games` : 'FAILURES PRESENT');

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
