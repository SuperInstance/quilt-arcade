// RECEIPTS — the shared receipt-renderer module every plugin mounts.
//
// A receipt is one human-readable line. Chained receipts carry an fnv1a64
// hash chain (GENESIS → row N) so tampering with history is detectable;
// the renderer prints each row and a chain-verification badge. Uncached
// sources (plain audit logs) render as plain lines with a display hash.
//
//   import { mountReceipts } from '../../shared/receipts.mjs';
//   mountReceipts(root.querySelector('.qa-side-col'), engine, {
//     sources: [{ cell: 'learn.receipts', chained: true,
//                 fields: ['seq','side','result','score_b','score_w','theta_hash','win_rate10'] }],
//   });
//
// One building block, independently replaceable: no game imports another
// game's receipt code; they all mount this.

import { verifyChain } from './kit.mjs';

export { verifyChain };

const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const shortHash = (h) => String(h ?? '').slice(0, 12);

// one receipt row → one human-readable line
export function receiptLine(row, src = {}) {
  if (src.chained) {
    const fields = src.fields ?? Object.keys(row).filter((k) => k !== 'prev_hash' && k !== 'row_hash');
    const bits = fields
      .map((f) => { const val = row[f]; return `${f}=${typeof val === 'number' ? val : shortHash(val)}`; })
      .join(' ');
    return `#${row.seq} ${bits} ·@ ${shortHash(row.row_hash)}`;
  }
  const kind = row.kind ? `[${row.kind}] ` : '';
  return `${kind}${row.text ?? JSON.stringify(row)}`;
}

// chain badge: re-derive from GENESIS, compare against the stored tail hash
export function chainBadge(rows, src) {
  if (!rows?.length) return null;
  const fields = src.fields ?? [];
  const last = verifyChain(rows, (r) => Object.fromEntries(fields.map((f) => [f, r[f]])));
  const ok = last === rows[rows.length - 1].row_hash;
  return { ok, links: rows.length, tail: shortHash(last) };
}

// render-only helper (headless-friendly): returns the line strings
export function renderReceiptLines(rows, src = {}, { limit = 12 } = {}) {
  const lines = (rows ?? []).slice(-limit).map((row) => receiptLine(row, src));
  const badge = src.chained ? chainBadge(rows, src) : null;
  if (badge) lines.push(`chain ${badge.ok ? '✓' : '✗ BROKEN'} — ${badge.links} links from GENESIS → ${badge.tail}`);
  return lines;
}

let cssInstalled = false;
function ensureCss(doc) {
  if (cssInstalled || !doc?.head?.appendChild) return;
  const style = doc.createElement('style');
  style.textContent = `
.qa-receipt-lines .qa-rcpt { border-left-color: #b9ad93; }
.qa-receipt-lines .qa-rcpt-chain { border-left-color: #7a5b00; color: #7a5b00; }
.qa-receipt-lines .qa-rcpt-ok { border-left-color: #1e7d4f; color: #1e7d4f; }
.qa-receipt-lines .qa-rcpt-bad { border-left-color: #b3361e; color: #b3361e; }`;
  doc.head.appendChild(style);
  cssInstalled = true;
}

// mount a live receipts panel into `host` (a side column or any element).
// cfg.sources: [{ cell, chained?, fields?, label? }] — mirrors the manifest
// receipts surface. Returns { el, refresh }.
export function mountReceipts(host, engine, cfg = {}) {
  const doc = host?.ownerDocument ?? globalThis.document;
  ensureCss(doc);
  const sources = cfg.sources ?? [];
  const limit = cfg.limit ?? 12;
  const title = cfg.title ?? 'receipts';
  const hint = cfg.hint ?? (sources.some((s) => s.chained)
    ? 'fnv1a64 witness chain — every experiment leaves a receipt'
    : 'audit lines from the sheet');

  const section = doc.createElement('section');
  section.className = 'qa-panel qa-receipts-panel';
  const head = doc.createElement('h2');
  head.innerHTML = `${esc(title)} <span class="qa-hint">${esc(hint)}</span>`;
  const box = doc.createElement('div');
  box.className = 'qa-log qa-receipt-lines';
  section.appendChild(head);
  section.appendChild(box);
  host.appendChild(section);

  async function refresh() {
    const parts = [];
    for (const src of sources) {
      let rows = [];
      try { rows = (await engine.get(src.cell)).data ?? []; } catch { rows = []; }
      if (src.label) parts.push({ text: src.label, cls: 'qa-rcpt' });
      for (const line of renderReceiptLines(rows, src, { limit })) {
        const badge = typeof line === 'string' && line.startsWith('chain ');
        parts.push({ text: line, cls: badge ? (line.includes('✓') ? 'qa-rcpt-ok' : 'qa-rcpt-bad') : src.chained ? 'qa-rcpt-chain' : '' });
      }
    }
    box.innerHTML = parts
      .map((p) => `<div class="qa-logline ${p.cls ?? ''}">${esc(p.text)}</div>`)
      .join('');
    return parts.length;
  }

  for (const src of sources) engine.subscribe?.(src.cell, () => { void refresh(); });
  void refresh();
  return { el: section, refresh };
}
