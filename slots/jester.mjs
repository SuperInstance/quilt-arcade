// SLOT: jester — variety/novelty injection.
//
// Interface only. A jester perturbs otherwise-deterministic policy choices
// so self-play does not collapse onto a single line. Returning null means
// "no surprise" — the game's own RNG decides.
//
// Credentials, when an implementation needs them, come from the
// environment: QUILT_SLOT_JESTER_KEY (none configured yet).

export const JESTER_SLOT = {
  slot: 'jester',
  name: 'JESTER',
  version: '0.1.0',
  status: 'interface',
  hooks: ['surprise'],
};

export function createJesterSlot(cfg = {}) {
  const envVar = cfg.envVar ?? 'QUILT_SLOT_JESTER_KEY';
  const apiKey = cfg.apiKey ?? (typeof process !== 'undefined' ? process.env[envVar] : undefined) ?? null;
  return {
    ...JESTER_SLOT,
    credentials: { env: envVar, configured: !!apiKey },
    hooks: {
      // async (rng, snapshot) → { twist } | null
      surprise: async () => null,
    },
  };
}
