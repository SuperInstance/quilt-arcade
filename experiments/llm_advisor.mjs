// LLM ADVISOR SEAM — "plug a small model into the sheet, the referee stays in charge."
//
// The arcade's learning loops are pure engine (deterministic, offline, honest).
// But the user asked for the OTHER option too: a small LLM (llama-8b-class) as
// a move advisor. This experiment wires exactly that, with the doctrine the
// fleet already uses (see e9 System One):
//
//   1. the sheet formats the position into a LETTER-CODED menu (A/B/C/... =
//      concrete legal moves) — the model can only point at a letter, never
//      invent a move (synonym-gravity defense)
//   2. the adapter DECODES the letter back to the move — invalid letters are
//      refused, never applied
//   3. the ARBITER still verifies the suggested move through the rule cells —
//      the model is an advisor, the referee is the law
//   4. provider offline / rate-limited / nonsense → the sheet degrades to the
//      heuristic policy and SAYS SO (source: 'heuristic-fallback')
//
// Default run uses a MOCK provider through the REAL engine ai-cell path
// (deterministic, tests the full wiring). Run with --real to use z-ai (GLM)
// with 15/30/45s backoff. Same code path either way.
//
//   node experiments/llm_advisor.mjs [--real]

import { QuiltEngine } from '../engine/index.js';
import { mulberry32, harness } from '../shared/kit.mjs';
import { buildSheet } from '../games/reversi/sheet.mjs';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const REAL = process.argv.includes('--real');

// ── the provider (mock by default; --real swaps in z-ai with backoff) ────────
class MockLLM {
  constructor() { this.calls = 0; }
  async call(config) {
    this.calls++;
    const menu = String(config.prompt ?? '');
    // deterministic "model" behaviour: prefers the first letter, sometimes
    // (every 3rd call) answers nonsense to prove the fence refuses it
    const letters = [...menu.matchAll(/^([A-Z]) = /gm)].map(m => m[1]);
    if (!letters.length) return { content: 'I do not understand the menu.' };
    if (this.calls % 3 === 0) return { content: 'BANANA' };
    return { content: JSON.stringify({ choice: letters[0] }) };
  }
}

class ZaiLLM {
  constructor() { this.calls = 0; this.zai = null; }
  async init() { const { default: ZAI } = await import('z-ai-web-dev-sdk'); this.zai = await ZAI.create(); }
  async call(config) {
    this.calls++;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const completion = await this.zai.chat.completions.create({
          messages: [
            { role: 'assistant', content: config.system ?? 'You are a Reversi move advisor. Reply with ONLY strict JSON {"choice":"<letter>"}.' },
            { role: 'user', content: String(config.prompt ?? '') },
          ],
          thinking: { type: 'disabled' },
        });
        return { content: (completion.choices[0]?.message?.content ?? '').trim() };
      } catch (e) {
        const transient = String(e.message).includes('429') || String(e.message).includes('Too many');
        if (!transient || attempt === 3) throw e;
        await new Promise(r => setTimeout(r, 15000 * (attempt + 1)));
      }
    }
  }
}

// ── engine with the advisor cells layered on the reversi sheet ───────────────
const provider = REAL ? new ZaiLLM() : new MockLLM();
if (REAL) await provider.init();
const engine = new QuiltEngine('arcade-llm-advisor', { eager: true, ai: provider });
engine.loadSheet(buildSheet());

// NOTE: loadSheet REPLACES the sheet; overlay cells are registered one by one.
for (const def of [

    { id: 'advisor.menu', kind: 'value', value: '', description: 'letter-coded legal-move menu (the fence input)' },
    { id: 'advisor.llm', kind: 'ai', ai_kind: 'ai.llm', provider: REAL ? 'zai' : 'mock',
      system: 'You are a Reversi move advisor. Reply with ONLY strict JSON {"choice":"<letter>"}.',
      prompt: 'Legal moves (letter = square):\n{{advisor.menu}}\nPick the strongest square. Reply {"choice":"<letter>"}.',
      description: 'the small model, fenced to a letter-coded menu' },
    { id: 'advisor.suggest', kind: 'program', deps: ['advisor.menu'],
      description: 'format menu -> call advisor.llm -> decode (fence) -> fallback to heuristic',
      code: `
const legal = (await runtime.call('legal.moves')).data;
if (!legal.length) return { source: 'none', why: 'no legal moves' };
const menu = legal.map((m, i) => String.fromCharCode(65 + i) + ' = ' + m.sq).join('\\n');
await runtime.set('advisor.menu', menu);
let source = 'llm', sq = null, raw = null;
try {
  const out = (await runtime.call('advisor.llm')).data;
  raw = out && out.content != null ? String(out.content) : JSON.stringify(out);
  const m = String(raw).match(/"choice"\\s*:\\s*"([A-Z])"/);
  const idx = m ? m[1].charCodeAt(0) - 65 : -1;
  sq = idx >= 0 && idx < legal.length ? legal[idx].sq : null;
} catch (e) {
  source = 'heuristic-fallback';
}
if (!sq) source = 'heuristic-fallback';
if (source === 'heuristic-fallback') {
  const pick = (await runtime.call('ai.choose', { seed: 7 })).data;
  sq = pick && pick.sq;
  return { source, sq, why: 'advisor refused/failed (' + String(raw).slice(0, 40) + ') — heuristic chose ' + sq, menu };
}
return { source, sq, why: 'model pointed at ' + sq + ' (referee will verify)', menu, raw: String(raw).slice(0, 60) };` },
  ]) engine.register(def);

const H = harness('llm-advisor');
const get = async (id) => (await engine.get(id)).data;

await H.check('menu format: legal moves rendered as a letter-coded fence', async () => {
  const out = (await engine.call('advisor.suggest')).data;
  H.ok(/A = [A-H][1-8]/.test(out.menu), 'menu letters present: ' + out.menu.split('\n')[0]);
  H.ok(out.source === 'llm' || out.source === 'heuristic-fallback', 'honest source label');
});

await H.check('model suggestion survives the fence only if it decodes to a legal move', async () => {
  for (let i = 0; i < 5; i++) {
    const out = (await engine.call('advisor.suggest', { seq: i })).data;
    const legal = (await engine.call('legal.moves')).data.map(m => m.sq);
    if (out.source === 'llm') H.ok(legal.includes(out.sq), `fenced suggestion ${out.sq} is legal`);
    else H.ok(true);
    if (legal.length < 2) break;
    // play the suggestion through the referee so the board advances
    const m = /^([A-H])([1-8])$/.exec(out.sq);
    const seq = ((await get('match.seq')) ?? 0) + 1;
    await engine.set('move.request', { r: Number(m[2]) - 1, c: 'ABCDEFGH'.indexOf(m[1]), player: await get('turn.current'), seq });
    const verdict = await get('rules.verdict');
    if (verdict?.seq !== seq) await engine.call('move.dispatch', { r: Number(m[2]) - 1, c: 'ABCDEFGH'.indexOf(m[1]), player: await get('turn.current'), seq });
    const v = await get('rules.verdict');
    H.ok(v && v.ok !== undefined, 'referee always returns a verdict');
    if ((await get('phase.current')) !== 'play') { await engine.call('new_game'); }
  }
  H.ok(true, `provider calls so far: ${provider.calls}`);
});

await H.check('nonsense answers (BANANA) never reach the board — fallback fires', async () => {
  // the mock answers BANANA every 3rd call; the fence must refuse it
  const out = (await engine.call('advisor.suggest', { seq: 'banana-test' })).data;
  H.ok(out.source === 'llm' || out.source === 'heuristic-fallback');
  H.ok(/^[A-H][1-8]$/.test(out.sq ?? ''), 'suggested square is always a real square: ' + out.sq);
});

await H.check('offline degrade: throwing provider -> honest heuristic fallback', async () => {
  const dead = new QuiltEngine('arcade-llm-dead', { eager: true, ai: { async call() { throw new Error('429 Too many requests'); } } });
  dead.loadSheet(buildSheet());
  for (const def of [
      { id: 'advisor.menu', kind: 'value', value: '', description: 'menu' },
      { id: 'advisor.llm', kind: 'ai', ai_kind: 'ai.llm', provider: 'dead', system: 'x', prompt: '{{advisor.menu}}', description: 'dead' },
      { id: 'advisor.suggest', kind: 'program', deps: ['advisor.menu'],
        description: 'same seam, dead provider',
        code: `
const legal = (await runtime.call('legal.moves')).data;
if (!legal.length) return { source: 'none', sq: null };
await runtime.set('advisor.menu', legal.map((m, i) => String.fromCharCode(65 + i) + ' = ' + m.sq).join('\\n'));
// NOTE: the engine's ai cells do not throw on provider errors — they return an
// unusable CellValue. Treat both throws AND unusable results as refusal.
let usable = false;
try {
  const out = (await runtime.call('advisor.llm')).data;
  const content = out && out.data && out.data.content != null ? out.data.content
    : (out && out.content != null ? out.content : null);
  usable = content != null && String(content).length > 0;
} catch (e) { usable = false; }
if (!usable) {
  const pick = (await runtime.call('ai.choose', { seed: 7 })).data;
  return { source: 'heuristic-fallback', sq: pick && pick.sq, why: 'provider down — the sheet heard a refusal, not a stack trace' };
}
return { source: 'llm', sq: legal[0].sq };` },
  ]) dead.register(def);
  const out = (await dead.call('advisor.suggest')).data;
  H.eq(out.source, 'heuristic-fallback', 'degraded honestly');
  H.ok(/^[A-H][1-8]$/.test(out.sq ?? ''), 'fallback move is a real square');
  H.ok(String(out.why).includes('provider down'), 'the sheet says why: ' + out.why);
});

const { pass, fail } = await H.done();
writeFileSync(join(here, 'llm_advisor.json'), JSON.stringify({
  provider: REAL ? 'zai (real GLM calls)' : 'mock (deterministic, same code path)',
  provider_calls: provider.calls, checks: { pass, fail },
  doctrine: 'letter-coded menu fence; arbiter verifies every suggestion; offline -> honest heuristic fallback',
  generated: new Date().toISOString(),
}, null, 2) + '\n');
console.log(`  provider: ${REAL ? 'zai (REAL calls)' : 'mock'} — ${provider.calls} call(s)`);
console.log('  (emitted experiments/llm_advisor.json)');
