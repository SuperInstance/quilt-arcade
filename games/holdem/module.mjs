// HOLDEM PLUGIN — two-file surface (module.mjs + manifest.json).
// Talks to the engine core and shared platform only; never to another game.
import { buildSheet } from './sheet.mjs';

export const id = 'holdem';
export const slots = ['judge', 'quantum', 'predictor'];
export const receipts = {
  sources: [
    { cell: 'learn.receipts.p1', chained: true, fields: ['seq', 'hand', 'net_bb', 'stack', 'theta_hash', 'nudge_count'], label: 'P1 learner' },
    { cell: 'learn.receipts.p2', chained: true, fields: ['seq', 'hand', 'net_bb', 'stack', 'theta_hash', 'nudge_count'], label: 'P2 learner' },
  ],
  min: 1,
};

export { buildSheet };

const WEIGHTS = ['aggro', 'tight', 'bluff', 'sticky', 'adapt'];

export function createDriver(engine) {
  const get = async (id) => {
    try { return (await engine.get(id)).data; } catch { return undefined; }
  };

  let mode = 'hvae'; // 'hvae' (human seat 1) | 'cvc'
  let learnOn = true;
  let rngState = 424242;
  const rnd = () => {
    rngState |= 0; rngState = (rngState + 0x6D2B79F5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  async function pushAction(req) {
    const seq = ((await get('match.seq')) ?? 0) + 1;
    await engine.set('action.request', { ...req, seq });
    let verdict = await get('rules.verdict');
    if (verdict?.seq !== seq) verdict = (await engine.call('action.dispatch', { ...req, seq })).data;
    return verdict ?? { ok: false, rule: 'ERR', text: 'no verdict' };
  }

  return {
    async snapshot() {
      const pub = (await engine.call('table.public')).data;
      const legal = (await engine.call('legal.actions')).data;
      const fired = (await get('rules.fired')) ?? [];
      const verdict = await get('rules.verdict');
      const events = (await get('log.events')) ?? [];
      const rules = [];
      for (const id of ['C1','C2','C3','C4','C5','C6','C7','C8','C9','C10']) {
        rules.push({ id, law: (await get(`rule.${id}.law`)) ?? '', fired: fired.includes(id),
          ok: verdict ? !!verdict.ok : true, why: (await get(`rule.${id}.verdict`))?.why ?? '' });
      }
      const learners = [];
      for (const seat of [1, 2]) {
        learners.push({
          seat,
          weights: await Promise.all(WEIGHTS.map(async (k) => ({ key: k, value: Number((await get(`W.p${seat}.${k}`)) ?? 0) }))),
          gen: await get(`learn.gen.p${seat}`),
          receipts: ((await get(`learn.receipts.p${seat}`)) ?? []).length,
          nudges: (await get(`learn.last.p${seat}`))?.nudges ?? [],
          om: await get(`om.p${seat}`),
        });
      }
      const thoughts = {};
      for (const seat of [0, 1, 2]) thoughts[seat] = ((await get(`ai.thoughts.p${seat}`)) ?? []).slice(-8);
      return { pub, legal, rules, verdict, events, learners, thoughts,
        seq: String(pub.phase) + ':' + String(pub.pot) + ':' + String(events.length) + ':' + String(learners.map(l => l.gen)) };
    },

    act: (action, amount) => pushAction({ seat: mode === 'hvae' ? 1 : (action.seat ?? 0), action, amount }),

    async step() {
      const seed = 1 + Math.floor(rnd() * 1e9);
      const step = (await engine.call('match.step', { seed, log: true })).data;
      if (step?.wait) return { wait: true, seat: step.seat };
      return step;
    },

    deal: () => engine.call('deal.hand', { seed: 1 + Math.floor(rnd() * 1e9) }),

    async learn() {
      if (!learnOn) return;
      for (const seat of [1, 2]) await engine.call('learn.update', { seat });
    },

    show: () => engine.call('reveal.show'),
    newMatch: () => engine.call('new_match'),

    async setMode(m) {
      mode = m;
      await engine.call('new_match');
      await engine.set('seats.cfg', m === 'hvae' ? { 0: 'fish', 1: 'human', 2: 'learn' } : { 0: 'fish', 1: 'learn', 2: 'learn' });
      if (m === 'hvae') await engine.set('view.seat', 1); else await engine.set('view.seat', 0);
    },
  };
}

// headless smoke: boot → one capped AI hand → both learners book witness
// receipts → both fnv1a64 chains re-derive from GENESIS.
export async function smoke(engine) {
  await engine.call('new_match');
  await engine.set('seats.cfg', { 0: 'fish', 1: 'learn', 2: 'learn' });
  await engine.set('view.seat', 0);
  await engine.call('deal.hand', { seed: 11 });
  for (let i = 0; i < 120; i++) {
    const phase = (await engine.get('hand.phase')).data;
    if (phase !== 'play') break;
    const step = (await engine.call('match.step', { seed: 1000 + i, log: true })).data;
    if (step?.over || step?.wait) break;
  }
  const receipts = [];
  for (const seat of [1, 2]) {
    const first = (await engine.call('learn.update', { seat })).data;
    const second = (await engine.call('learn.update', { seat })).data;
    const rows = (await engine.get(`learn.receipts.p${seat}`)).data ?? [];
    receipts.push(...rows);
    if (!rows.length) throw new Error(`holdem smoke: P${seat} booked no learner receipts (${JSON.stringify({ first, second })})`);
  }
  return { receipts, detail: `both learner chains booked receipts after one capped hand` };
}
