// SLOT: judge — the JEV position reviewer.
//
// Interface only (constitution rule: slots land as interfaces first,
// implementations later). A judge scores a position or reviews a move
// verdict produced by the rule cells. Returning null means "no opinion"
// — games must stay fully playable with every slot unimplemented.
//
// Credentials, when an implementation needs them, come from the
// environment: QUILT_SLOT_JUDGE_KEY (none configured yet).

export const JUDGE_SLOT = {
  slot: 'judge',
  name: 'JEV',
  version: '0.1.0',
  status: 'interface',
  hooks: ['scorePosition', 'reviewMove'],
};

export function createJudgeSlot(cfg = {}) {
  const envVar = cfg.envVar ?? 'QUILT_SLOT_JUDGE_KEY';
  const apiKey = cfg.apiKey ?? (typeof process !== 'undefined' ? process.env[envVar] : undefined) ?? null;
  return {
    ...JUDGE_SLOT,
    credentials: { env: envVar, configured: !!apiKey },
    hooks: {
      // async (snapshot) → { score, why } | null
      scorePosition: async () => null,
      // async (move, verdict) → { agree, why } | null
      reviewMove: async () => null,
    },
  };
}
