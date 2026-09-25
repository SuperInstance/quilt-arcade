// SLOTS — the plugin-slot registry.
//
// Four slots, interfaces now, implementations later (constitution rule).
// A game manifest declares which slots it is designed for; the host
// resolves them here. Every slot reads its credentials from env vars —
// none are needed yet, so nothing is configured.

import { createJudgeSlot, JUDGE_SLOT } from './judge.mjs';
import { createJesterSlot, JESTER_SLOT } from './jester.mjs';
import { createQuantumSlot, QUANTUM_SLOT } from './quantum.mjs';
import { createPredictorSlot, PREDICTOR_SLOT } from './predictor.mjs';

export const SLOT_DEFS = [JUDGE_SLOT, JESTER_SLOT, QUANTUM_SLOT, PREDICTOR_SLOT];
export const SLOT_NAMES = SLOT_DEFS.map((s) => s.slot);

const FACTORIES = {
  judge: createJudgeSlot,
  jester: createJesterSlot,
  quantum: createQuantumSlot,
  predictor: createPredictorSlot,
};

export function createSlot(name, cfg = {}) {
  const factory = FACTORIES[name];
  if (!factory) throw new Error(`unknown slot '${name}' — known slots: ${SLOT_NAMES.join(', ')}`);
  return factory(cfg);
}

export function assertSlotsValid() {
  for (const name of SLOT_NAMES) {
    const slot = createSlot(name);
    if (slot.slot !== name) throw new Error(`slot '${name}' mislabeled itself '${slot.slot}'`);
    if (typeof slot.hooks !== 'object' || !slot.hooks) throw new Error(`slot '${name}' exposes no hooks`);
    for (const [h, fn] of Object.entries(slot.hooks)) if (typeof fn !== 'function') throw new Error(`slot '${name}' hook '${h}' is not async-callable`);
    if (typeof slot.credentials?.configured !== 'boolean') throw new Error(`slot '${name}' does not declare credential state`);
  }
  return true;
}
