// PONG — the continuous game on the discrete sheet.
//
// The template (tictactoe) ports a turn-based rulebook: clause cells, a
// referee that sequences them, one push per move. Pong ports a REALTIME
// rulebook: the laws of motion as clause cells, the tick arbiter as
// referee, one match.step per physics tick. Laws stay first-class:
//   node -e "engine.call('rule.W2.check', {...})" — inspectable physics.
//
// Constants (the table): field 100x60, paddles at x=2/x=98 half-height 6,
// serve speed 0.9/tick, +4% per paddle return, cap 2.6, first to 7.

import { v, law, prog } from '../../shared/kit.mjs';

const W = 100, H = 60;          // field
const PX = { left: 2, right: 98 }; // paddle faces
const PH = 6;                   // paddle half-height
const V0 = 0.9, VMAX = 2.6;     // serve speed / return cap
const WIN = 7;                  // closure

const BOOK = `PONG — RULEBOOK v1

W1 (walls)      The field is closed at y=0 and y=60. A ball contacting a
                wall reflects: vy -> -vy. The walls never score.

W2 (paddle)     A paddle is a segment of half-height 6 at x=2 (left) and
                x=98 (right). Ball contact within reach returns the ball:
                vx -> -vx * 1.04 (capped at 2.6), with vy gaining
                0.12 * (ballY - paddleY) — the return angle is the player's
                only expressive act.

W3 (score)      A ball crossing x=-3 awards one point to the right player;
                crossing x=103 awards one point to the left player. After a
                point the ball is re-served from center toward the player
                who was scored upon.

W4 (closure)    The first player to 7 points wins; the table closes. A
                closed table ticks no further.

AI (derived)    Each paddle tracks ball.y at its own speed (left 0.85,
                right 0.70 per tick) with a deadzone of 1.5 — identical
                laws, asymmetric reflexes, so every seeded match terminates.

DETERMINISM     Every serve is mulberry32(seed, pointsPlayed). No wall
                clock, no RNG outside the serve — a replayed seed is the
                same match, bit for bit.`;

const CHK_W1 = `
// W1 port: wall reflection. Pure: ({y, vy}) -> {fired, vy, why}
const y = input?.y, vy = input?.vy ?? 0;
if (y < 1) return { fired: true, y: 1 + (1 - y), vy: -vy, why: 'floor contact at y=' + y + ' — reflected: vy -> ' + (-vy) };
if (y > ${H - 1}) return { fired: true, y: ${H - 1} - (y - ${H - 1}), vy: -vy, why: 'ceiling contact at y=' + y + ' — reflected: vy -> ' + (-vy) };
return { fired: false, vy, why: 'ball at y=' + y + ' — clear of both walls' };`;

const CHK_W2 = `
// W2 port: paddle return. Pure: ({x, vx, ballY, paddleY, side}) -> {fired, vx, vy}
const x = input?.x, vx = input?.vx ?? 0, ballY = input?.ballY, paddleY = input?.paddleY, side = input?.side;
const face = ${JSON.stringify(PX)}[side];
const reach = Math.abs(ballY - paddleY) <= ${PH} + 1;
const atFace = side === 'left' ? (x - 1 <= face && x > face - 2.5) : (x + 1 >= face && x < face + 2.5);
const approaching = side === 'left' ? vx < 0 : vx > 0;
if (atFace && reach && approaching) {
  const speed = Math.min(Math.abs(vx) * 1.04, ${VMAX});
  const nvx = side === 'left' ? speed : -speed;
  const nvy = (ballY - paddleY) * 0.12;
  return { fired: true, vx: nvx, vy: nvy,
    why: side + ' paddle returns at speed ' + speed.toFixed(3) + ', angle ' + (ballY - paddleY).toFixed(2) };
}
return { fired: false, vx, why: side + ' paddle untouched (reach=' + reach + ', face=' + atFace + ')' };`;

const CHK_W3 = `
// W3 port: goal detection. Pure: ({x, side}) -> {fired, point}
const x = input?.x, side = input?.side;
if (side === 'left' && x < -3) return { fired: true, point: 'right', why: 'ball crossed the left goal line — point right' };
if (side === 'right' && x > ${W + 3}) return { fired: true, point: 'left', why: 'ball crossed the right goal line — point left' };
return { fired: false, point: null, why: 'ball in play at x=' + x };`;

const CHK_W4 = `
// W4 port: closure. Pure: ({left, right}) -> {fired, winner}
const l = input?.left ?? 0, r = input?.right ?? 0;
if (l >= ${WIN}) return { fired: true, winner: 'left', why: 'left reached ${WIN} — table closed' };
if (r >= ${WIN}) return { fired: true, winner: 'right', why: 'right reached ${WIN} — table closed' };
return { fired: false, winner: null, why: 'match live at ' + l + '-' + r };`;

const SERVE = `
// serve: deterministic from (seed, pointsPlayed) — inlined mulberry32,
// no wall clock, no module scope (cell sandbox exposes input/runtime/math only)
const seed = (await runtime.get('serve.seed')).data ?? 1;
const seq = (await runtime.get('match.seq')).data ?? 0;
let a = (Math.imul(seed, 2654435761) + Math.imul(seq + 1, 40503)) >>> 0;
const rnd = () => {
  a = a + 0x6D2B79F5 | 0;
  let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
const dir = rnd() < 0.5 ? -1 : 1;
const vy = (rnd() * 2 - 1) * 0.6;
await runtime.set('ball.x', ${W / 2});
await runtime.set('ball.y', ${H / 2});
await runtime.set('ball.vx', dir * ${V0});
await runtime.set('ball.vy', vy);
return { dir, vy, why: 'serve #' + (seq + 1) + ' from seed ' + seed + ' toward ' + (dir < 0 ? 'left' : 'right') };`;

const TRACK = `
// AI (derived law): track ball.y at side-specific speed with a deadzone
const side = input?.side;
const paddle = (await runtime.get('paddle.' + side)).data;
const target = (await runtime.get('ball.y')).data;
const speed = side === 'left' ? 0.85 : 0.70;
const dead = 1.5;
let y = paddle;
if (Math.abs(target - y) > dead) y += Math.sign(target - y) * Math.min(speed, Math.abs(target - y) - dead);
y = Math.max(${PH}, Math.min(${H - PH}, y));
await runtime.set('paddle.' + side, y);
return { side, y, target };`;

const ARBITER = `
// THE REFEREE — knows no physics; it runs the law cells in clause order.
// One call = one physics tick: track, integrate, W1, W2, W3, W4, ledger.
const phase = (await runtime.get('phase.current')).data;
if (phase !== 'play') return { over: true, why: 'table closed' };

// derived law: both paddles track
await runtime.call('ai.track', { side: 'left' });
await runtime.call('ai.track', { side: 'right' });

// integrate (the only non-law motion: the ball moves by its velocity)
let x = (await runtime.get('ball.x')).data + (await runtime.get('ball.vx')).data;
let y = (await runtime.get('ball.y')).data + (await runtime.get('ball.vy')).data;
let vx = (await runtime.get('ball.vx')).data;
let vy = (await runtime.get('ball.vy')).data;
const fired = [];

// W1 walls
const w1 = (await runtime.call('rule.W1.check', { y, vy })).data;
await runtime.set('rule.W1.verdict', { ...w1, ts: Date.now() });
if (w1.fired) { y = w1.y; vy = w1.vy; fired.push('W1'); }

// W2 paddles (both faces, in play order)
for (const side of ['left', 'right']) {
  const py = (await runtime.get('paddle.' + side)).data;
  const w2 = (await runtime.call('rule.W2.check', { x, vx, ballY: y, paddleY: py, side })).data;
  await runtime.set('rule.W2.verdict', { ...w2, side, ts: Date.now() });
  if (w2.fired) {
    vx = w2.vx; vy += w2.vy; fired.push('W2');
    const log = (await runtime.get('log.events')).data;
    await runtime.set('log.events', [...log.slice(-299), { ts: Date.now(), kind: 'hit', side, text: w2.why }]);
  }
}

await runtime.set('ball.x', x);
await runtime.set('ball.y', y);
await runtime.set('ball.vx', vx);
await runtime.set('ball.vy', vy);

// W3 score
let point = null;
for (const side of ['left', 'right']) {
  const w3 = (await runtime.call('rule.W3.check', { x, side })).data;
  await runtime.set('rule.W3.verdict', { ...w3, ts: Date.now() });
  if (w3.fired) { point = w3.point; fired.push('W3'); break; }
}
if (point) {
  const cell = 'score.' + point;
  const score = (await runtime.get(cell)).data + 1;
  await runtime.set(cell, score);
  await runtime.set('match.seq', (await runtime.get('match.seq')).data + 1);
  const log = (await runtime.get('log.events')).data;
  await runtime.set('log.events', [...log.slice(-299), { ts: Date.now(), kind: 'point', side: point, score: score, text: 'point ' + point + ' — ' + score + ' (serve follows)' }]);
  const serve = (await runtime.call('serve.ball')).data;
  await runtime.set('log.events', [...(await runtime.get('log.events')).data.slice(-299), { ts: Date.now(), kind: 'serve', text: serve.why }]);
}

// W4 closure
const sl = (await runtime.get('score.left')).data;
const sr = (await runtime.get('score.right')).data;
const w4 = (await runtime.call('rule.W4.check', { left: sl, right: sr })).data;
await runtime.set('rule.W4.verdict', { ...w4, ts: Date.now() });
if (w4.fired) {
  fired.push('W4');
  await runtime.set('phase.current', 'over');
  await runtime.set('winner.current', w4.winner);
  const log = (await runtime.get('log.events')).data;
  await runtime.set('log.events', [...log.slice(-299), { ts: Date.now(), kind: 'over', text: w4.why }]);
}

await runtime.set('rules.fired', fired);
await runtime.set('tick.count', (await runtime.get('tick.count')).data + 1);
await runtime.set('rules.verdict', { fired, point, ts: Date.now() });
return { over: w4.fired === true, point, fired, score: { left: sl, right: sr } };`;

const MATCH_STEP = `
// one physics tick — a driver calls this in a loop (60/s live, unbounded headless)
return (await runtime.call('tick.arbiter')).data;`;

const NEW_GAME = `
// reset the table; seed drives every serve of the coming match
const seed = (typeof input?.seed === 'number') ? input.seed : 1;
await runtime.set('serve.seed', seed);
await runtime.set('ball.x', ${W / 2});
await runtime.set('ball.y', ${H / 2});
await runtime.set('ball.vx', 0);
await runtime.set('ball.vy', 0);
await runtime.set('paddle.left', ${H / 2});
await runtime.set('paddle.right', ${H / 2});
await runtime.set('score.left', 0);
await runtime.set('score.right', 0);
await runtime.set('phase.current', 'play');
await runtime.set('winner.current', null);
await runtime.set('match.seq', 0);
await runtime.set('tick.count', 0);
for (const n of ['W1', 'W2', 'W3', 'W4']) await runtime.set('rule.' + n + '.verdict', null);
await runtime.set('rules.fired', []);
await runtime.set('rules.verdict', null);
const serve = (await runtime.call('serve.ball')).data;
const log = (await runtime.get('log.events')).data;
await runtime.set('log.events', [...log.slice(-299), { ts: Date.now(), kind: 'new_game', seed, text: 'table reset — seed ' + seed + ', ' + serve.why }]);
return { ok: true, seed, serve };`;

export function buildSheet() {
  const cells = [];

  cells.push(v('rules.book', BOOK, 'the complete rulebook in precise language; every clause is ported 1:1 to a rule.WN.check cell'));
  for (const [n, clause] of [
    ['W1', 'W1 (walls): the field closes at y=0 and y=60; a contacting ball reflects, vy -> -vy.'],
    ['W2', 'W2 (paddle): contact within half-height 6 returns the ball at 1.04x speed, angle = 0.12 * offset.'],
    ['W3', 'W3 (score): crossing x=-3 awards right; crossing x=103 awards left; serve follows toward the scored-on player.'],
    ['W4', 'W4 (closure): first to 7 points wins; the closed table ticks no further.'],
  ]) {
    cells.push(law(`rule.${n}.law`, clause, `clause ${n} as written (quoted from rules.book)`));
    cells.push(v(`rule.${n}.verdict`, null, `last evaluation of clause ${n}`));
  }
  cells.push(v('rules.fired', [], 'laws that came into play on the last tick'));
  cells.push(v('rules.verdict', null, 'master verdict of the last tick'));

  // ball + paddles (the table state)
  cells.push(v('ball.x', W / 2, 'ball x on the 100-wide field'));
  cells.push(v('ball.y', H / 2, 'ball y on the 60-high field'));
  cells.push(v('ball.vx', 0, 'ball x velocity per tick'));
  cells.push(v('ball.vy', 0, 'ball y velocity per tick'));
  cells.push(v('paddle.left', H / 2, 'left paddle center y (face at x=2, half-height 6)'));
  cells.push(v('paddle.right', H / 2, 'right paddle center y (face at x=98, half-height 6)'));
  cells.push(v('score.left', 0, 'left points'));
  cells.push(v('score.right', 0, 'right points'));
  cells.push(v('phase.current', 'play', 'play | over'));
  cells.push(v('winner.current', null, 'left | right | null'));
  cells.push(v('match.seq', 0, 'points played — seeds each serve and paces the ledger'));
  cells.push(v('tick.count', 0, 'physics ticks since new_game'));
  cells.push(v('serve.seed', 1, 'match seed — every serve is mulberry32(seed, match.seq)'));

  // law ports — pure, first-class, callable directly
  cells.push(prog('rule.W1.check', CHK_W1, 'W1 port: wall reflection', []));
  cells.push(prog('rule.W2.check', CHK_W2, 'W2 port: paddle return with speedup + angle', []));
  cells.push(prog('rule.W3.check', CHK_W3, 'W3 port: goal detection', []));
  cells.push(prog('rule.W4.check', CHK_W4, 'W4 port: closure at 7', []));

  // derived laws + referee + driver
  cells.push(prog('serve.ball', SERVE, 'deterministic serve from (seed, match.seq)', ['serve.seed', 'match.seq']));
  cells.push(prog('ai.track', TRACK, 'derived law: track ball.y at side-specific speed with deadzone', ['ball.y']));
  cells.push(prog('tick.arbiter', ARBITER, 'THE REFEREE — one physics tick: track, integrate, W1-W4, ledger', []));
  cells.push(prog('match.step', MATCH_STEP, 'one physics tick; a driver loops this until {over:true}', []));
  cells.push(prog('new_game', NEW_GAME, 'reset the table and serve from a seed', []));

  // ledger
  cells.push(v('log.events', [], 'append-only audit: new_game, hits, points, serves, closure (cap 300)'));

  return { id: 'pong', title: 'Quilt Arcade — Pong (realtime laws on the discrete sheet)', cells };
}
