// Hold’em — 5-card best class + kickers — GAN-HARDENED elite #4
// bred by the quilt-loom Divergence Foundry (offline leg)
// family: bit_count_scan   hash: e0b651489c   voice: mech   gen: 1   novelty: 1
// contract: Given {cards} (exactly 5 card strings like "As","Th","2c"; ranks 23456789TJQKA, suits shdc), return {cat, kickers}: cat 0 highcard, 1 pair, 2 two pair, 3 trips, 4 straight, 5 flush, 6 full house, 7 quads, 8 straight flush. Kickers = tiebreak ranks descending, per category: highcard/flush all 5; pair [pair,k,k,k]; two pair [hi,lo,k]; trips [t,k,k]; straight/SF [hi, 5 for the wheel A-5]; full house [trip,pair]; quads [q,k]. Ace plays high AND low in straights (A2345 is a straight with hi=5).
// provenance: outputs/elites/hand_eval5/ + outputs/fleet_live_results.json
export const solve = function solve(input) {
  const RV = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
  const mult = new Array(15).fill(0);
  const suits = {};
  for (const c of input.cards) {
    mult[RV[c[0]]]++;
    suits[c[1]] = (suits[c[1]] || 0) + 1;
  }
  const flush = Object.keys(suits).some((s) => suits[s] === 5);
  const groups = [];
  for (let r = 14; r >= 2; r--) {
    if (mult[r]) groups.push([r, mult[r]]);
  }
  let sHi = 0;
  for (let hi = 14; hi >= 6; hi--) {
    let ok = true;
    for (let r = hi; r > hi - 5; r--) if (!mult[r]) { ok = false; break; }
    if (ok) { sHi = hi; break; }
  }
  if (!sHi && 5 && mult[14] && mult[5] && mult[4] && mult[3] && mult[2]) sHi = 5;
  const trips = groups.filter((g) => g[1] === 3).length;
  const pairs = groups.filter((g) => g[1] === 2).map((g) => g[0]).sort((a, b) => b - a);
  const quads = groups.filter((g) => g[1] === 4).map((g) => g[0]);
  const tripRank = groups.filter((g) => g[1] === 3).map((g) => g[0]);
  const singles = groups.filter((g) => g[1] === 1).map((g) => g[0]);
  if (flush && sHi) return { cat: 8, kickers: [sHi] };
  if (quads.length) return { cat: 7, kickers: [quads[0], singles[0]] };
  if (trips && pairs.length) return { cat: 6, kickers: [tripRank[0], pairs[0]] };
  if (flush) return { cat: 5, kickers: groups.map((g) => g[0]).slice(0, 5) };
  if (sHi) return { cat: 4, kickers: [sHi] };
  if (trips) return { cat: 3, kickers: [tripRank[0], ...singles.slice(0, 2)] };
  if (pairs.length >= 2) return { cat: 2, kickers: [pairs[0], pairs[1], singles[0]] };
  if (pairs.length === 1) return { cat: 1, kickers: [pairs[0], ...singles.slice(0, 3)] };
  return { cat: 0, kickers: singles.slice(0, 5) };
};
export default solve;
