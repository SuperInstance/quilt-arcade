// quilt-arcade driver — engine-facing adapter shared by all four game viewers.
//
// createDriver({ engine, shape, ... }) returns the object mountGame() expects:
//   snapshot()  — one consistent read of the whole game state (board faces,
//                 rulebook clause states, bubble verdict, event log, learning
//                 strip data, legal-move hints, arbiter trace)
//   click(r,c)  — the push of one value: engine.set('move.request', ...) with
//                 seq bookkeeping; falls back to an explicit dispatch call
//   step(rnd)   — one AI ply via match.step (weights: live theta for the
//                 learner side, frozen ai.fixed_weights for the control side)
//   learn(rnd)  — one generation of learning (learn.update for the learner side)
//   newGame()   — engine.call('new_game')

export function createDriver(cfg) {
  const {
    engine,
    shape,
    ruleIds,
    requestFor,          // (r, c, player) -> request payload (no seq)
    faces,               // (v, r, c) -> {glyph, cls, title?}
    scores,              // async (get) -> [{label, value}]
    hints,               // async (get, grid, turn) -> [sq names] | null
    thetaKeys,           // array | null (null = no learning UI)
    humanColor = 'B',
    randomSide,          // optional (rnd, side, grid) -> request | null (CVC variety)
    tagline,
    cellSize,
    columnClickable,
  } = cfg;

  const colLabels = shape.colLabels;
  const sqOf = (r, c) => colLabels[c] + (r + 1);
  const rcOf = (sq) => {
    const m = /^([A-Z]+)([0-9]+)$/.exec(sq);
    if (!m) return null;
    return { r: Number(m[2]) - 1, c: colLabels.indexOf(m[1]) };
  };

  const get = async (id) => {
    try { return (await engine.get(id)).data; } catch { return undefined; }
  };

  const hasLearning = thetaKeys != null;
  let mode = 'hvae';
  let learnerSide = humanColor === 'X' ? 'X' : 'B';

  async function push(req) {
    const seq = ((await get('match.seq')) ?? 0) + 1;
    await engine.set('move.request', { ...req, seq });
    let verdict = await get('rules.verdict');
    if (verdict?.seq !== seq) {
      const out = await engine.call('move.dispatch', { ...req, seq });
      verdict = out?.data ?? out;
    }
    return verdict ?? { ok: false, rule: 'ERR', text: 'no verdict returned' };
  }

  return {
    // shape pass-through for the viewer
    rows: shape.rows, cols: shape.cols, colLabels,
    rowLabels: shape.rowLabels ?? null,
    cellSize: shape.cellSize ?? cellSize,
    columnClickable: shape.columnClickable ?? columnClickable,
    humanColor, tagline,
    hasLearning,

    title: cfg.title, tagline: cfg.tagline,

    async snapshot() {
      const grid = await get('board.grid');
      const turn = await get('turn.current');
      const phase = await get('phase.current');
      const winner = await get('winner.current');
      const line = await get('winner.line');
      const fired = (await get('rules.fired')) ?? [];
      const verdict = await get('rules.verdict');
      const events = (await get('log.events')) ?? [];

      const rules = [];
      for (const id of ruleIds) {
        const law = await get(`rule.${id}.law`);
        const vd = await get(`rule.${id}.verdict`);
        rules.push({ id, law: law ?? '', fired: fired.includes(id) && phase !== undefined,
          ok: verdict ? !!verdict.ok : true, why: vd?.why ?? '' });
      }
      // clause flash only makes sense for the clauses that actually fired
      for (const cl of rules) cl.fired = fired.includes(cl.id);

      const cells = grid.map((row, r) => row.map((v, c) => faces(v, r, c)));

      let theta = null;
      let gen = null, winRate = null;
      if (hasLearning) {
        const w = (await get('ai.weights')) ?? {};
        theta = thetaKeys.map(k => ({ key: k, value: Number(w[k] ?? 0) }));
        gen = await get('learn.gen');
        const receipts = (await get('learn.receipts')) ?? [];
        winRate = receipts.length ? receipts[receipts.length - 1].win_rate10 : null;
      }

      const legal = hints ? await hints(get, grid, turn) : null;

      const trace = [];
      if (verdict?.trace) for (const t of verdict.trace) {
        const rc = typeof t.sq === 'string' ? rcOf(t.sq) : null;
        if (rc) trace.push({ r: rc.r, c: rc.c });
      }

      return {
        cells, turn, phase, winner, line,
        rules, bubble: verdict ? { ok: !!verdict.ok, rule: verdict.rule, text: verdict.text, seq: verdict.seq } : null,
        events, theta, gen, winRate, legal,
        lastTrace: trace,
        seq: String(verdict?.seq ?? 0) + ':' + String(gen ?? 0) + ':' + String(phase),
      };
    },

    async click(r, c) {
      const player = await get('turn.current');
      const req = requestFor(r, c, player);
      if (!req) return { refused: true, text: 'not a playable square' };
      const verdict = await push(req);
      return { refused: !verdict.ok };
    },

    async step(rnd) {
      const side = await get('turn.current');
      // tictactoe-style variety hook: a random side in CVC
      if (randomSide && mode === 'cvc' && side !== learnerSide) {
        const grid = await get('board.grid');
        const req = randomSide(rnd, side, grid);
        if (req) { await push(req); return; }
      }
      const isLearner = mode === 'cvc' && hasLearning && side === learnerSide;
      const fixed = await get('ai.fixed_weights');
      const weights = isLearner ? undefined : (hasLearning && fixed ? fixed : undefined);
      const seed = 1 + Math.floor(rnd() * 1e9);
      await engine.call('match.step', { weights, seed, log: isLearner });
    },

    async learn(rnd) {
      if (!hasLearning) return;
      await engine.call('learn.update', { side: learnerSide });
      // alternate colours so the receipt chain alternates too
      const gen = (await get('learn.gen')) ?? 0;
      learnerSide = gen % 2 === 0 ? 'B' : 'W';
      if (humanColor === 'X') learnerSide = learnerSide === 'B' ? 'X' : 'O';
    },

    setMode(m) {
      mode = m;
      learnerSide = humanColor === 'X' ? 'X' : 'B';
    },

    async newGame() {
      await engine.call('new_game');
      const gen = (await get('learn.gen')) ?? 0;
      learnerSide = gen % 2 === 0 ? 'B' : 'W';
      if (humanColor === 'X') learnerSide = learnerSide === 'B' ? 'X' : 'O';
    },
  };
}
