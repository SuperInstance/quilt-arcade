// SLOT: quantum — the MOTH / MicroMoth sampler.
//
// Interface only. A quantum slot samples moves/ranges from amplitudes
// instead of argmax — the natural fit for hidden-information games
// (holdem ranges) and for diversity search across candidate moves.
// Returning null means "no sample" — the game's own chooser decides.
//
// Credentials, when an implementation needs them, come from the
// environment: QUILT_SLOT_QUANTUM_KEY (none configured yet).

export const QUANTUM_SLOT = {
  slot: 'quantum',
  name: 'MOTH/MicroMoth',
  version: '0.1.0',
  status: 'interface',
  hooks: ['sample'],
};

export function createQuantumSlot(cfg = {}) {
  const envVar = cfg.envVar ?? 'QUILT_SLOT_QUANTUM_KEY';
  const apiKey = cfg.apiKey ?? (typeof process !== 'undefined' ? process.env[envVar] : undefined) ?? null;
  return {
    ...QUANTUM_SLOT,
    credentials: { env: envVar, configured: !!apiKey },
    hooks: {
      // async (amplitudes) → { index } | null
      sample: async () => null,
    },
  };
}
