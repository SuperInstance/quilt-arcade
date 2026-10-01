// Referral-edge pins — FAIL-first (arcade rule).
//
// Pin 1: every game manifest carries a `referrals` block citing the
//   SuperInstance/quilt-tools S3 witness shape BY NAME
//   (experiments/s3-quantum-tided-budget.mjs — the quantum-tided budget
//   appeal cell: fnv1a-chained WitnessLog rows, PENDING → ENTANGLED →
//   COLLAPSED, COLLAPSED rows carry job_id + backend + result digest,
//   custody booked BEFORE the outcome exists).
//   The weight law: when THIS PR merges in quilt-arcade (the target repo),
//   the citation is a merged PR in the to-node's repo naming the source —
//   edge qt-s3-witness -> qa-receipts-surface upgrades VERIFIED=1.0 in
//   quilt-tools experiments/REFERRAL_GRAPH.md. Never self-upgrade.
// Pin 2: chained receipts.sources declare the S3 row fields
//   (state transition witnessed, hash-chained) — the receipts surface is
//   S3-shaped, not just prose-cited.
//
// RED on the pre-citation tree (zero referrals), GREEN once booked.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'games');
const SOURCE_REPO = 'SuperInstance/quilt-tools';
const SOURCE_PATH = 'experiments/s3-quantum-tided-budget.mjs';
const SOURCE_URL = `https://github.com/${SOURCE_REPO}/blob/main/${SOURCE_PATH}`;

let red = 0;
const fail = (msg) => { console.error(`FAIL ${msg}`); red++; };

const dirs = readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory());
if (!dirs.length) fail('no game plugins discovered');

for (const d of dirs) {
  const manifestPath = join(ROOT, d.name, 'manifest.json');
  let m;
  try { m = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch { fail(`${d.name}: manifest.json unreadable`); continue; }

  // Pin 1 — the referral citation is booked in-repo, by name.
  const refs = m.referrals ?? [];
  const s3 = refs.find((r) => r.repo === SOURCE_REPO && r.path === SOURCE_PATH);
  if (!s3) fail(`${d.name}: no referral citing ${SOURCE_REPO} ${SOURCE_PATH}`);
  else {
    if (s3.url !== SOURCE_URL) fail(`${d.name}: referral url mismatch (must be ${SOURCE_URL})`);
    if (s3.edge !== 'qt-s3-witness -> qa-receipts-surface') fail(`${d.name}: referral edge name wrong`);
    if (typeof s3.note !== 'string' || !s3.note.includes('WitnessLog'))
      fail(`${d.name}: referral note must name the WitnessLog row shape`);
  }

  // Pin 2 — the receipts surface DECLARES the S3 witness shape it follows
  // (fnv1a-chained rows; custody booked before outcome — the engine's
  // verifyChain re-derives from GENESIS at smoke time).
  const ws = m.receipts?.witness_shape ?? '';
  if (!ws.includes('s3-quantum-tided-budget.mjs') || !ws.includes('WitnessLog'))
    fail(`${d.name}: receipts.witness_shape must declare the quilt-tools S3 WitnessLog shape`);
}

if (red) { console.error(`${red} pin(s) RED`); process.exit(1); }
console.log(`referral pins GREEN — ${dirs.length} manifests cite ${SOURCE_PATH} (S3 witness shape)`);
