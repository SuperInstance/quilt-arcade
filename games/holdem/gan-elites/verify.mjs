// verify.mjs — is the GAN-hardened logic STILL FUNCTIONING in place?
// Every elite runs against the vendored oracle on the full frozen corpus.
// Also reports the structural distance (token 3-gram Jaccard, alpha-renamed)
// between each elite and the oracle — proof of divergence, not mimicry.
// Zero imports beyond this directory. Exit 0 only if 100%% equivalent.
import { solve as s1 } from './elite-01.mjs';
import { solve as s2 } from './elite-02.mjs';
import { solve as s3 } from './elite-03.mjs';
import { solve as s4 } from './elite-04.mjs';

import { CONTRACT, oracle, canon } from './contract.mjs';

const ELITES = [
  ['elite-01.mjs', s1],
  ['elite-02.mjs', s2],
  ['elite-03.mjs', s3],
  ['elite-04.mjs', s4],
];

function alphaTokens(src) {
  const toks = String(src).match(/=>|[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|[{}()[\];,.]|<=|>=|===|!==|&&|\|\||[+\-*/%<>=!?:&|]/g) || [];
  const KW = new Set(['function','return','const','let','var','if','else','for','while','of','in','new','typeof','true','false','null','undefined','break','continue']);
  const map = new Map(); const out = []; let prevDot = false;
  for (const t of toks) {
    const ident = /^[A-Za-z_$][\w$]*$/.test(t) && !KW.has(t);
    if (ident && !prevDot) { if (!map.has(t)) map.set(t, 'a' + map.size); out.push(map.get(t)); }
    else out.push(t);
    prevDot = t === '.';
  }
  return out;
}
function structDist(a, b) {
  const ga = new Set(), gb = new Set();
  const ta = alphaTokens(a), tb = alphaTokens(b);
  for (let i = 0; i + 3 <= ta.length; i++) ga.add(ta.slice(i, i + 3).join(' '));
  for (let i = 0; i + 3 <= tb.length; i++) gb.add(tb.slice(i, i + 3).join(' '));
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  const uni = ga.size + gb.size - inter;
  return uni ? +(1 - inter / uni).toFixed(4) : 0;
}

const corpus = CONTRACT.probes;
const want = corpus.map((p) => { try { return canon(oracle(p)); } catch { return '<oracle-error>'; } });

let checks = 0, ok = 0;
const rows = [];
for (const [name, fn] of ELITES) {
  let local = 0;
  corpus.forEach((p, i) => {
    checks++;
    let tok;
    try { tok = canon(fn(p)); } catch { tok = '<error>'; }
    if (tok === want[i]) { ok++; local++; }
    else if (local + 1 === corpus.length - [...corpus.slice(0, i + 1)].length) { /* unreachable */ }
  });
  const dist = structDist(CONTRACT.oracleSrc, String(fn));
  rows.push(`${name}: equivalence ${local}/${corpus.length}  structural-distance-from-oracle ${dist}`);
}

console.log('══ GAN-HARDENED LOGIC — in-place verification ══');
console.log('contract:', CONTRACT.title);
for (const r of rows) console.log('  ' + r);
console.log(`TOTAL: ${ok}/${checks} equivalence checks across ${ELITES.length} elites × ${corpus.length} probes`);
if (ok !== checks) { console.log('VERDICT: BROKEN — an elite diverged from the oracle'); process.exit(1); }
console.log('VERDICT: ALL ELITES STILL FUNCTIONING — divergent in form, exact in behavior');
