// Hold’em — 5-card best class + kickers — GAN-HARDENED elite #1
// bred by the quilt-loom Divergence Foundry (live leg)
// family: count_entries   hash: 4c8209d42c   voice: mech   gen: 1   novelty: 1
// contract: Given {cards} (exactly 5 card strings like "As","Th","2c"; ranks 23456789TJQKA, suits shdc), return {cat, kickers}: cat 0 highcard, 1 pair, 2 two pair, 3 trips, 4 straight, 5 flush, 6 full house, 7 quads, 8 straight flush. Kickers = tiebreak ranks descending, per category: highcard/flush all 5; pair [pair,k,k,k]; two pair [hi,lo,k]; trips [t,k,k]; straight/SF [hi, 5 for the wheel A-5]; full house [trip,pair]; quads [q,k]. Ace plays high AND low in straights (A2345 is a straight with hi=5).
// provenance: outputs/elites/hand_eval5/ + outputs/fleet_live_results.json
export const solve = function solve(input) {
  const RV = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
  const rs = input.cards.map((c) => RV[c[0]]);
  const flush = input.cards.every((c) => c[1] === input.cards[0][1]);
  const cnt = {};
  for (const r of rs) cnt[r] = (cnt[r] || 0) + 1;
  const groups = Object.entries(cnt).map((e) => [Number(e[0]), e[1]])
    .sort((x, y) => (y[1] - x[1]) || (y[0] - x[0]));
  const uniq = [...new Set(rs)].sort((a, b) => b - a);
  let straightHi = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHi = uniq[0];
    else if ((uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2)) straightHi = 5;
  }
  const seq = flush && straightHi ? [8] : groups[0][1] === 4 ? [7]
    : groups[0][1] === 3 && groups[1][1] === 2 ? [6] : flush ? [5]
    : straightHi ? [4] : groups[0][1] === 3 ? [3]
    : groups[0][1] === 2 && groups[1][1] === 2 ? [2]
    : groups[0][1] === 2 ? [1] : [0];
  const cat = seq[0];
  if (cat === 8 || cat === 4) return { cat, kickers: [straightHi] };
  if (cat === 7 || cat === 6) return { cat, kickers: [groups[0][0], groups[1][0]] };
  if (cat === 5 || cat === 0) return { cat, kickers: uniq.slice(0, 5) };
  if (cat === 3) return { cat, kickers: [groups[0][0], groups[1][0], groups[2][0]] };
  if (cat === 2) return { cat, kickers: [groups[0][0], groups[1][0], groups[2][0]] };
  return { cat, kickers: [groups[0][0], groups[1][0], groups[2][0], groups[3][0]] };
};
export default solve;
