// quilt-arcade shared kit — one kit, four games.
//
// Provides:
//   harness(title)        — check()/done() playtest harness (honest verdicts)
//   mulberry32(seed)      — deterministic RNG for reproducible experiments
//   fnv1a64 / canon       — witness receipt idiom (ported from quilt-cloudflare ocean.ts)
//   verifyChain(rows)     — re-derive a receipt chain; throws on tamper
//   v(), law(), chk(), prog(), formula(), listenerCell() — cell builders
//   SNIPPETS              — JS code fragments interpolated into program-cell
//                           code at SHEET BUILD TIME (program cells run in a
//                           new-Function scope: helpers must be inlined — the
//                           E8 lesson, applied at build time so there is no
//                           duplication in source).

// ── cell builders ────────────────────────────────────────────────────────────
export const v = (id, value, description) => ({ id, kind: 'value', value, description });
export const law = (id, value, description) => v(id, value, description);          // rule text cell
export const prog = (id, code, description, deps = []) =>
  ({ id, kind: 'program', code, description, deps });
export const formula = (id, expr, description) => ({ id, kind: 'formula', expr, description });
export const listenerCell = (id, watch, action, condition, description) =>
  ({ id, kind: 'listener', watch, action, ...(condition ? { condition } : {}), description });

// ── deterministic RNG ────────────────────────────────────────────────────────
export const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// ── witness receipt idiom (fnv1a64 hash chain, GENESIS prev) ────────────────
export const fnv1a64 = (input) => {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n, mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) { h ^= BigInt(input.charCodeAt(i)); h = (h * prime) & mask; }
  return h.toString(16).padStart(16, '0');
};
export const canon = (row) => {
  const s = {};
  for (const k of Object.keys(row).sort()) s[k] = row[k];
  return JSON.stringify(s);
};
export const GENESIS_PREV = '0'.repeat(16);

// Re-derive a hash chain. Throws on any tamper. Returns last row hash.
export function verifyChain(rows, fieldsOf = (r) => r) {
  let prev = GENESIS_PREV;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fields = fieldsOf(row);
    const expect = fnv1a64(canon({ ...fields, prev_hash: prev }));
    if (row.row_hash !== expect) throw new Error(`chain broken at seq ${row.seq ?? i}`);
    if (row.prev_hash !== prev) throw new Error(`prev_hash mismatch at seq ${row.seq ?? i}`);
    prev = row.row_hash;
  }
  return prev;
}

// ── code snippets interpolated into program cells at build time ─────────────
export const SNIPPETS = {
  // seeded RNG inside a program cell: const rnd = rng(input?.seed ?? seed)
  rng: `
    const rng = (seed) => { let a = (seed ?? 1) >>> 0;
      return () => { a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };`,
  // witness hashing inside a program cell (fnv1a64 + canonical json)
  witness: `
    const fnv1a64 = (s) => { let h = 0xcbf29ce484222325n;
      const p = 0x100000001b3n, m = 0xffffffffffffffffn;
      for (let i = 0; i < s.length; i++) { h ^= BigInt(s.charCodeAt(i)); h = (h * p) & m; }
      return h.toString(16).padStart(16, '0'); };
    const canon = (row) => { const s = {}; for (const k of Object.keys(row).sort()) s[k] = row[k];
      return JSON.stringify(s); };
    const GENESIS_PREV = '0'.repeat(16);`,
};

// ── playtest harness ─────────────────────────────────────────────────────────
export function harness(title) {
  const t0 = Date.now();
  let pass = 0, fail = 0; const failures = [];
  const check = async (name, fn) => {
    try { await fn(); pass++; console.log(`  ✓ ${name}`); }
    catch (e) { fail++; failures.push({ name, error: String(e?.message ?? e) }); console.log(`  ✗ ${name}\n      ${String(e?.message ?? e)}`); }
  };
  const eq = (a, b, msg = '') => {
    const ja = JSON.stringify(a), jb = JSON.stringify(b);
    if (ja !== jb) throw new Error(`${msg} expected ${jb}, got ${ja}`);
  };
  const ok = (cond, msg = 'expected truthy') => { if (!cond) throw new Error(msg); };
  const done = async () => {
    const ms = Date.now() - t0;
    console.log(`\n${title}: ${pass}/${pass + fail} checks green in ${ms}ms`);
    if (fail) { for (const f of failures) console.log(`  FAILED: ${f.name}: ${f.error}`); process.exitCode = 1; }
    return { pass, fail, ms };
  };
  return { check, eq, ok, done };
}
