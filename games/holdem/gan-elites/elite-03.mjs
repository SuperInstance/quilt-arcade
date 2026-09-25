// Hold’em — 5-card best class + kickers — GAN-HARDENED elite #3
// bred by the quilt-loom Divergence Foundry (live leg)
// family: sorted_runs   hash: 4b916d85be   voice: mech   gen: 6   novelty: 0.82459
// contract: Given {cards} (exactly 5 card strings like "As","Th","2c"; ranks 23456789TJQKA, suits shdc), return {cat, kickers}: cat 0 highcard, 1 pair, 2 two pair, 3 trips, 4 straight, 5 flush, 6 full house, 7 quads, 8 straight flush. Kickers = tiebreak ranks descending, per category: highcard/flush all 5; pair [pair,k,k,k]; two pair [hi,lo,k]; trips [t,k,k]; straight/SF [hi, 5 for the wheel A-5]; full house [trip,pair]; quads [q,k]. Ace plays high AND low in straights (A2345 is a straight with hi=5).
// provenance: outputs/elites/hand_eval5/ + outputs/fleet_live_results.json
export const solve = function solve(input) {
  const RV = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
  const rs = input.cards.map((c) => RV[c[0]]).sort((a, b) => b - a);
  const flush = input.cards.every((c) => c[1] === input.cards[0][1]);
  const runs = [];
  for (const r of rs) {
    if (runs.length && runs[runs.length - 1][0] === r) runs[runs.length - 1][1]++;
    else runs.push([r, 1]);
  }
  const u = runs.map((x) => x[0]);
  let sHi = 0;
  if (u.length === 5) {
    sHi = (u[0] - u[4] === 4) ? u[0] : 0;
    if (!sHi && u[0] === 14 && u[1] === 5 && u[4] === 2) sHi = 5;
  }
  
  const shape = runs.map((x) => x[1]).sort().join('');
  const pairs = runs.filter((x) => x[1] === 2).map((x) => x[0]).sort((a, b) => b - a);
  const trips = runs.filter((x) => x[1] === 3).map((x) => x[0]);
  const quads = runs.filter((x) => x[1] === 4).map((x) => x[0]);
  const singles = runs.filter((x) => x[1] === 1).map((x) => x[0]).sort((a, b) => b - a);
  if (flush && sHi) return { cat: 8, kickers: [sHi] };
  if (quads.length) return { cat: 7, kickers: [quads[0], u.find((r) => r !== quads[0])] };
  if (trips.length && pairs.length) return { cat: 6, kickers: [trips[0], pairs[0]] };
  if (flush) return { cat: 5, kickers: u.slice(0, 5) };
  if (sHi) return { cat: 4, kickers: [sHi] };
  if (trips.length) return { cat: 3, kickers: [trips[0], ...singles] };
  if (pairs.length >= 2) return { cat: 2, kickers: [pairs[0], pairs[1], singles[0]] };
  if (pairs.length === 1) return { cat: 1, kickers: [pairs[0], ...singles] };
  return { cat: 0, kickers: u.slice(0, 5) };
};
export default solve;
