// SLOT: predictor — the JEPA world-model.
//
// Interface only. A predictor forecasts the position/state that follows
// a candidate action, letting a game look ahead without growing its own
// rule sheet. Returning null means "no prediction" — the game plays
// without foresight.
//
// Credentials, when an implementation need them, come from the
// environment: QUILT_SLOT_PREDICTOR_KEY (none configured yet).

export const PREDICTOR_SLOT = {
  slot: 'predictor',
  name: 'JEPA',
  version: '0.1.0',
  status: 'interface',
  hooks: ['predict'],
};

export function createPredictorSlot(cfg = {}) {
  const envVar = cfg.envVar ?? 'QUILT_SLOT_PREDICTOR_KEY';
  const apiKey = cfg.apiKey ?? (typeof process !== 'undefined' ? process.env[envVar] : undefined) ?? null;
  return {
    ...PREDICTOR_SLOT,
    credentials: { env: envVar, configured: !!apiKey },
    hooks: {
      // async (state, action) → { state, confidence } | null
      predict: async () => null,
    },
  };
}
