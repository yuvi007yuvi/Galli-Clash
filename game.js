/* Galli Clash — a browser street fighter with online room-code multiplayer.
 * Online play uses PeerJS (WebRTC). The room creator's browser runs the fight
 * and streams snapshots to the friend, who sends back their button presses. */
(() => {
'use strict';

// ---------- constants ----------
const W = 960, H = 540, GROUND = 462;
const TICK = 1000 / 60;
const ROUND_SECONDS = 60;
const WINS_NEEDED = 2;
const MAX_ROUNDS = 5;
const PEER_PREFIX = 'galliclash-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ICE = { iceServers: [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
] };

const MOVES = {
  punch: { startup: 4, active: 4, total: 16, range: 74, dmg: 6, stun: 14, kb: 4 },
  kick:  { startup: 8, active: 5, total: 26, range: 100, dmg: 11, stun: 20, kb: 9 },
  throw: { startup: 10, total: 24 },
};
const CHAPPAL = { speed: 9, dmg: 8, chip: 2, stun: 16, kb: 6, cooldown: 180 };

const CHARS = [
  { name: 'RAJU',  vest: '#ff7a1a', pants: '#2f4f9a', band: '#e53935', skin: '#c68642', hair: '#1b1b1b' },
  { name: 'BUNTY', vest: '#2e9e5b', pants: '#3a3a3a', band: '#fdd835', skin: '#a86b3c', hair: '#2b1a10' },
];

// ---------- dom ----------
const $ = id => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');
const wrap = $('wrap');
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  wrap.style.transform = `scale(${s})`;
  wrap.style.left = ((innerWidth - W * s) / 2) + 'px';
  wrap.style.top = ((innerHeight - H * s) / 2) + 'px';
}
addEventListener('resize', fit);
fit();

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function show(id, on) { $(id).classList.toggle('hidden', !on); }

// ---------- game state ----------
function makeFighter(side) {
  return {
    x: side === 0 ? 300 : 660, y: GROUND, vx: 0, vy: 0, face: side === 0 ? 1 : -1,
    hp: 100, act: null, at: 0, hit: false, stun: 0, gs: 0, block: false,
    cd: 0, walk: 0, flash: 0,
    lp: 0, lk: 0, lj: 0, ls: 0, // last-seen press counters
  };
}

function newState() {
  return {
    phase: 'intro', pt: 0, round: 1, wins: [0, 0], time: ROUND_SECONDS * 60,
    f: [makeFighter(0), makeFighter(1)], proj: [], sparks: [], pid: 0,
    msg: '', rw: -1, winner: -1, shake: 0, ev: [],
  };
}

function emptyInput() { return { l: false, r: false, u: false, d: false, pc: 0, kc: 0, jc: 0, sc: 0 }; }

// ---------- simulation ----------
function step(s, ins) {
  // Consume button presses every tick, even when fighters can't act,
  // so a press during the intro doesn't fire later.
  const pr = s.f.map((f, i) => {
    const n = ins[i];
    const r = { p: n.pc !== f.lp, k: n.kc !== f.lk, j: n.jc !== f.lj, s: n.sc !== f.ls };
    f.lp = n.pc; f.lk = n.kc; f.lj = n.jc; f.ls = n.sc;
    return r;
  });

  if (s.shake > 0) s.shake--;
  for (const p of s.sparks) p.life--;
  s.sparks = s.sparks.filter(p => p.life > 0);

  if (s.phase !== 'fight') {
    s.pt++;
    for (const f of s.f) { f.vx *= 0.85; if (f.flash > 0) f.flash--; physics(f); }
    pushApart(s);
    if (s.phase === 'intro') {
      if (s.pt === 1) s.ev.push('round');
      if (s.pt >= 110) { s.phase = 'fight'; s.pt = 0; s.ev.push('fight'); }
    } else if (s.phase === 'roundEnd' && s.pt >= 170) {
      endRoundOrMatch(s);
    }
    return;
  }

  s.time--;
  for (let i = 0; i < 2; i++) control(s, i, ins[i], pr[i]);
  for (const f of s.f) physics(f);
  pushApart(s);
  for (let i = 0; i < 2; i++) {
    const f = s.f[i], o = s.f[1 - i];
    if (!f.act && f.stun === 0 && f.gs === 0) f.face = o.x >= f.x ? 1 : -1;
  }
  checkHits(s);
  updateProjectiles(s);

  const [a, b] = s.f;
  if (a.hp <= 0 || b.hp <= 0) {
    s.rw = a.hp <= 0 && b.hp <= 0 ? -1 : (a.hp <= 0 ? 1 : 0);
    s.msg = 'K.O.!';
    finishRound(s);
    s.ev.push('ko');
  } else if (s.time <= 0) {
    s.rw = a.hp === b.hp ? -1 : (a.hp > b.hp ? 0 : 1);
    s.msg = 'TIME!';
    finishRound(s);
    s.ev.push('round');
  }
}

function finishRound(s) {
  if (s.rw >= 0) s.wins[s.rw]++;
  s.phase = 'roundEnd';
  s.pt = 0;
  s.proj = [];
  for (const f of s.f) { f.act = null; f.block = false; }
}

function endRoundOrMatch(s) {
  const done = s.wins[0] >= WINS_NEEDED || s.wins[1] >= WINS_NEEDED || s.round >= MAX_ROUNDS;
  if (done) {
    s.phase = 'matchEnd';
    s.pt = 0;
    s.winner = s.wins[0] === s.wins[1] ? -1 : (s.wins[0] > s.wins[1] ? 0 : 1);
    return;
  }
  s.round++;
  s.time = ROUND_SECONDS * 60;
  s.f = s.f.map((old, i) => {
    const f = makeFighter(i);
    f.lp = old.lp; f.lk = old.lk; f.lj = old.lj; f.ls = old.ls;
    return f;
  });
  s.phase = 'intro';
  s.pt = 0;
}

function startMove(s, f, act) {
  f.act = act; f.at = 0; f.hit = false; f.block = false;
  s.ev.push(act === 'throw' ? 'throw' : 'swing');
}

function control(s, i, inp, pr) {
  const f = s.f[i];
  if (f.cd > 0) f.cd--;
  if (f.flash > 0) f.flash--;
  if (f.stun > 0) { f.stun--; f.block = false; return; }
  if (f.gs > 0) { f.gs--; f.block = true; return; }
  const onGround = f.y >= GROUND;

  if (f.act) {
    f.at++;
    if (f.act === 'throw' && f.at === MOVES.throw.startup) {
      s.proj.push({ id: ++s.pid, x: f.x + f.face * 40, y: f.y - 98, vx: f.face * CHAPPAL.speed, owner: i, rot: 0 });
    }
    if (f.at >= MOVES[f.act].total) f.act = null;
    else return;
  }

  f.block = onGround && inp.d;
  if (pr.s && f.cd === 0) { startMove(s, f, 'throw'); f.cd = CHAPPAL.cooldown; return; }
  if (pr.p) { startMove(s, f, 'punch'); return; }
  if (pr.k) { startMove(s, f, 'kick'); return; }
  if (f.block) { f.vx = 0; return; }

  const dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
  if (onGround) {
    f.vx = dir * 4.4;
    if (dir) f.walk += 0.28;
    if (pr.j) { f.vy = -15.5; f.y -= 1; s.ev.push('jump'); }
  } else {
    f.vx = Math.max(-5, Math.min(5, f.vx + dir * 0.3));
  }
}

function physics(f) {
  const onGround = f.y >= GROUND;
  if (!onGround) f.vy += 0.8;
  if (onGround && (f.stun > 0 || f.gs > 0 || f.act)) f.vx *= 0.8;
  f.x += f.vx;
  f.y += f.vy;
  if (f.y >= GROUND) { f.y = GROUND; f.vy = 0; }
  f.x = Math.max(40, Math.min(W - 40, f.x));
}

function pushApart(s) {
  const [a, b] = s.f;
  const dx = b.x - a.x;
  if (Math.abs(dx) < 56 && Math.abs(a.y - b.y) < 90) {
    const push = (56 - Math.abs(dx)) / 2;
    const d = dx >= 0 ? 1 : -1;
    a.x -= d * push; b.x += d * push;
    a.x = Math.max(40, Math.min(W - 40, a.x));
    b.x = Math.max(40, Math.min(W - 40, b.x));
    if (Math.abs(b.x - a.x) < 56) { // pinned against a wall
      if (a.x <= 40 || a.x >= W - 40) b.x = a.x + d * 56;
      else a.x = b.x - d * 56;
    }
  }
}

function checkHits(s) {
  for (let i = 0; i < 2; i++) {
    const f = s.f[i], o = s.f[1 - i];
    if (!f.act || f.act === 'throw' || f.hit) continue;
    const m = MOVES[f.act];
    if (f.at < m.startup || f.at >= m.startup + m.active) continue;
    const dx = (o.x - f.x) * f.face;
    if (dx > 0 && dx < m.range && Math.abs(o.y - f.y) < 90) {
      f.hit = true;
      const hy = f.y - (f.act === 'kick' ? 88 : 118);
      applyHit(s, o, f.face, m.dmg, 1, m.stun, m.kb, o.x - f.face * 18, hy);
    }
  }
}

function applyHit(s, o, dir, dmg, chip, stun, kb, x, y) {
  const blocked = o.block && o.face === -dir;
  if (blocked) {
    o.hp -= chip; o.gs = 10; o.vx = dir * kb * 0.6;
    s.ev.push('block');
  } else {
    o.hp -= dmg; o.stun = stun; o.act = null; o.block = false; o.vx = dir * kb; o.flash = 8;
    if (o.y < GROUND) o.vy = -5;
    s.shake = 6;
    s.ev.push('hit');
  }
  o.hp = Math.max(0, o.hp);
  s.sparks.push({ x, y, life: 12, b: blocked });
}

function updateProjectiles(s) {
  const keep = [];
  for (const p of s.proj) {
    p.x += p.vx; p.rot += 0.45;
    const o = s.f[1 - p.owner];
    if (Math.abs(p.x - o.x) < 30 && p.y > o.y - 150 && p.y < o.y) {
      applyHit(s, o, Math.sign(p.vx), CHAPPAL.dmg, CHAPPAL.chip, CHAPPAL.stun, CHAPPAL.kb, p.x, p.y);
      continue;
    }
    if (p.x > -40 && p.x < W + 40) keep.push(p);
  }
  s.proj = keep;
}

// ---------- rendering ----------
function seeded(seed) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

function sign(g, text, x, y, bg, fg = '#fff') {
  g.font = 'bold 15px Trebuchet MS, sans-serif';
  const w = g.measureText(text).width + 18;
  g.fillStyle = '#000'; g.fillRect(x - 2, y - 2, w + 4, 30);
  g.fillStyle = bg; g.fillRect(x, y, w, 26);
  g.fillStyle = fg; g.textBaseline = 'middle'; g.fillText(text, x + 9, y + 14);
}

function buildBackground() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const rnd = seeded(11);

  const sky = g.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, '#2b1b4a'); sky.addColorStop(0.55, '#c2477a'); sky.addColorStop(1, '#ffb35c');
  g.fillStyle = sky; g.fillRect(0, 0, W, GROUND);
  g.fillStyle = '#ffe9a8'; g.beginPath(); g.arc(790, 105, 36, 0, Math.PI * 2); g.fill();

  g.fillStyle = '#3a2350';
  for (let x = 0; x < W;) {
    const w = 40 + rnd() * 70, h = 140 + rnd() * 140;
    g.fillRect(x, GROUND - h - 60, w, h + 60);
    if (rnd() < 0.4) g.fillRect(x + w / 2 - 2, GROUND - h - 90, 4, 30); // water-tank pipe
    x += w - 4;
  }

  const cols = ['#e57373', '#ffb74d', '#81c784', '#64b5f6', '#ba68c8', '#f06292', '#4db6ac', '#ffd54f'];
  const houses = [];
  for (let x = -10; x < W;) {
    const w = 110 + rnd() * 80, h = 170 + rnd() * 110, top = GROUND - h;
    g.fillStyle = cols[Math.floor(rnd() * cols.length)];
    g.fillRect(x, top, w, h);
    g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(x + w - 8, top, 8, h);
    g.fillStyle = 'rgba(255,255,255,.28)'; g.fillRect(x - 3, top - 8, w + 6, 10);
    for (let wy = top + 22; wy < GROUND - 120; wy += 58) {
      for (let wx = x + 16; wx < x + w - 34; wx += 42) {
        g.fillStyle = rnd() < 0.45 ? '#ffe082' : '#2d2140';
        g.fillRect(wx, wy, 22, 30);
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(wx - 3, wy + 30, 28, 4);
      }
    }
    g.fillStyle = '#8f8f8f'; g.fillRect(x + 12, GROUND - 80, w - 30, 80);
    g.fillStyle = 'rgba(0,0,0,.18)';
    for (let sy = GROUND - 76; sy < GROUND; sy += 8) g.fillRect(x + 12, sy, w - 30, 2);
    houses.push({ x, w });
    x += w;
  }
  const signs = [['CHAI ☕', '#d32f2f'], ['RECHARGE', '#1565c0'], ['PAAN', '#2e7d32'], ['SAMOSA', '#6a1b9a'], ['XEROX', '#ef6c00'], ['TAILOR', '#00838f']];
  houses.forEach((hs, i) => { const [t, c2] = signs[i % signs.length]; sign(g, t, hs.x + 16, GROUND - 116, c2); });

  g.fillStyle = '#2b2b2b'; g.fillRect(470, 30, 10, GROUND - 30);
  g.fillRect(440, 50, 70, 6);
  g.strokeStyle = '#111'; g.lineWidth = 2;
  for (let i = 0; i < 6; i++) {
    g.beginPath(); g.moveTo(0, 55 + i * 16);
    g.quadraticCurveTo(240, 120 + i * 20, 475, 53 + (i % 3) * 2);
    g.quadraticCurveTo(720, 125 + i * 18, W, 60 + i * 14);
    g.stroke();
  }

  const road = g.createLinearGradient(0, GROUND, 0, H);
  road.addColorStop(0, '#6b5a50'); road.addColorStop(1, '#3a2f29');
  g.fillStyle = road; g.fillRect(0, GROUND, W, H - GROUND);
  g.fillStyle = '#2a221e'; g.fillRect(0, GROUND, W, 6);
  g.fillStyle = 'rgba(255,255,255,.06)';
  for (let i = 0; i < 90; i++) g.fillRect(rnd() * W, GROUND + 10 + rnd() * 70, 2 + rnd() * 6, 2);
  return c;
}
const BG = buildBackground();

function lerp(a, b, t) { return a + (b - a) * t; }

function limb(ax, ay, bx, by, bend, w, col) {
  const mx = (ax + bx) / 2 + bend[0], my = (ay + by) / 2 + bend[1];
  ctx.strokeStyle = col; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(mx, my); ctx.lineTo(bx, by); ctx.stroke();
}

function drawFighter(f, ch, phase) {
  const air = f.y < GROUND - 1;
  const ko = f.hp <= 0 && phase !== 'intro';
  let lean = 0, c = 0;
  let fa = [26, -112], ba = [16, -104];        // fists (front / back)
  let ff = [14, 0], bf = [-14, 0];             // feet (front / back)

  if (!air && Math.abs(f.vx) > 0.5 && !f.act && !f.stun) {
    const sw = Math.sin(f.walk) * 13;
    ff = [14 + sw, -Math.max(0, Math.cos(f.walk)) * 6];
    bf = [-14 - sw, -Math.max(0, -Math.cos(f.walk)) * 6];
  }
  if (air) { ff = [18, -34]; bf = [-10, -26]; }
  if (f.block) { c = 8; fa = [28, -130]; ba = [24, -112]; }
  if (f.act) {
    const m = MOVES[f.act], t = f.at;
    if (f.act === 'punch') {
      if (t < m.startup) fa = [8, -116];
      else if (t < m.startup + m.active) { fa = [64, -118]; lean = 0.08; }
      else fa = [32, -114];
    } else if (f.act === 'kick') {
      if (t < m.startup) ff = [22, -34];
      else if (t < m.startup + m.active) { ff = [84, -88]; lean = -0.22; }
      else ff = [30, -22];
    } else if (f.act === 'throw') {
      fa = t < m.startup ? [-30, -142] : [54, -132];
    }
  }
  if (f.stun > 0) { lean = -0.25; fa = [4, -132]; ba = [-8, -126]; }

  ctx.save();
  ctx.translate(f.x, f.y);
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath(); ctx.ellipse(0, GROUND - f.y + 2, 34, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(f.face, 1);
  if (ko) { ctx.translate(-30, -14); ctx.rotate(-1.45); }
  else ctx.rotate(lean);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  const white = f.flash > 0 && f.flash % 2 === 0;
  const C = k => (white ? '#fff' : ch[k]);
  const hip = [0, -68 + c], sh = [4, -116 + c];

  limb(hip[0], hip[1], bf[0], bf[1], [6, 0], 13, C('pants'));
  limb(sh[0] - 6, sh[1] + 2, ba[0], ba[1] + c, [-6, 10], 10, C('skin'));
  ctx.fillStyle = C('vest');
  ctx.beginPath(); ctx.roundRect(-16, sh[1] - 8, 36, 58, 9); ctx.fill();
  ctx.fillStyle = C('pants'); ctx.fillRect(-15, hip[1] - 8, 32, 9);
  limb(hip[0] + 4, hip[1], ff[0], ff[1], [8, 0], 13, C('pants'));
  ctx.fillStyle = '#1d1d1d';
  for (const p of [bf, ff]) { ctx.beginPath(); ctx.ellipse(p[0] + 5, p[1] - 2, 11, 5, 0, 0, Math.PI * 2); ctx.fill(); }

  const hx = 6, hy = -140 + c;
  ctx.fillStyle = C('skin'); ctx.beginPath(); ctx.arc(hx, hy, 15, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C('hair'); ctx.beginPath(); ctx.arc(hx, hy - 2, 15, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
  ctx.fillStyle = C('band'); ctx.fillRect(hx - 15, hy - 8, 30, 6);
  const tail = Math.sin(performance.now() / 120 + f.x) * 4;
  ctx.strokeStyle = C('band'); ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(hx - 14, hy - 5); ctx.lineTo(hx - 30, hy - 2 + tail); ctx.stroke();
  ctx.fillStyle = '#111'; ctx.fillRect(hx + 7, hy - 2, 3, 4);

  limb(sh[0] + 6, sh[1] + 2, fa[0], fa[1] + c, [-8, 12], 11, C('skin'));
  ctx.fillStyle = C('skin');
  for (const p of [fa, ba]) { ctx.beginPath(); ctx.arc(p[0], p[1] + c, 7.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function drawChappal(p) {
  ctx.save();
  ctx.translate(p.x, p.y); ctx.rotate(p.rot);
  ctx.fillStyle = '#5d4037'; ctx.beginPath(); ctx.ellipse(0, 0, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#29b6f6'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-4, -6); ctx.lineTo(4, 0); ctx.lineTo(-4, 6); ctx.stroke();
  ctx.restore();
}

function drawSpark(p) {
  const r = (12 - p.life) * 3 + 8;
  ctx.save(); ctx.translate(p.x, p.y);
  ctx.globalAlpha = p.life / 12;
  ctx.strokeStyle = p.b ? '#80d8ff' : '#ffeb3b'; ctx.lineWidth = 4;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4);
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.stroke();
  }
  ctx.restore();
}

function bigText(text, y, size = 84, col = '#ffcc33') {
  ctx.save();
  ctx.font = `italic bold ${size}px Trebuchet MS, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 10; ctx.strokeStyle = '#000'; ctx.strokeText(text, W / 2, y);
  ctx.fillStyle = '#c2185b'; ctx.fillText(text, W / 2 + 4, y + 4);
  ctx.fillStyle = col; ctx.fillText(text, W / 2, y);
  ctx.restore();
}

function playerLabel(i) {
  if (mode === 'host' || mode === 'guest') return i === myIndex() ? 'YOU' : 'FRIEND';
  return 'P' + (i + 1);
}

function drawHUD(s) {
  const bw = 370;
  for (let i = 0; i < 2; i++) {
    const f = s.f[i];
    const x = i === 0 ? 30 : W - 30 - bw;
    ctx.fillStyle = '#000'; ctx.fillRect(x - 4, 16, bw + 8, 32);
    ctx.fillStyle = '#5d0b0b'; ctx.fillRect(x, 20, bw, 24);
    const w = bw * f.hp / 100;
    ctx.fillStyle = f.hp > 50 ? '#ffd600' : f.hp > 25 ? '#ff9100' : '#ff1744';
    ctx.fillRect(i === 0 ? x + bw - w : x, 20, w, 24);

    ctx.font = 'bold 18px Trebuchet MS, sans-serif';
    ctx.textBaseline = 'top';
    ctx.textAlign = i === 0 ? 'left' : 'right';
    const tx = i === 0 ? x : x + bw;
    ctx.fillStyle = '#000'; ctx.fillText(`${CHARS[i].name} (${playerLabel(i)})`, tx + 2, 54);
    ctx.fillStyle = '#fff'; ctx.fillText(`${CHARS[i].name} (${playerLabel(i)})`, tx, 52);

    for (let k = 0; k < WINS_NEEDED; k++) {
      const cx = i === 0 ? x + bw - 12 - k * 24 : x + 12 + k * 24;
      ctx.beginPath(); ctx.arc(cx, 64, 8, 0, Math.PI * 2);
      ctx.fillStyle = s.wins[i] > k ? '#ffcc33' : '#333'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
    }

    const cw = 120, cx0 = i === 0 ? x : x + bw - cw;
    const ready = f.cd === 0;
    ctx.fillStyle = '#000'; ctx.fillRect(cx0 - 2, 78, cw + 4, 10);
    ctx.fillStyle = ready ? '#29b6f6' : '#455a64';
    ctx.fillRect(cx0, 80, cw * (1 - f.cd / CHAPPAL.cooldown), 6);
  }

  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(W / 2, 34, 30, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffcc33'; ctx.font = 'bold 28px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.max(0, Math.ceil(s.time / 60))), W / 2, 35);

  if (net && net.open) {
    ctx.font = '13px Trebuchet MS, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#fffa';
    ctx.fillText(net.ping ? `ping ${net.ping} ms` : 'online', 10, H - 12);
  }
}

function drawYouMarker(f) {
  ctx.save();
  ctx.translate(f.x, f.y - 182 - Math.sin(performance.now() / 200) * 4);
  ctx.fillStyle = '#ffcc33'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-10, 0); ctx.lineTo(10, 0); ctx.lineTo(0, 12); ctx.closePath();
  ctx.stroke(); ctx.fill();
  ctx.restore();
}

function render(s, inGame) {
  ctx.save();
  if (s.shake > 0) ctx.translate((Math.random() - 0.5) * s.shake * 2, (Math.random() - 0.5) * s.shake * 2);
  ctx.drawImage(BG, 0, 0);
  const order = s.f[0].act ? [1, 0] : [0, 1]; // attacker drawn on top
  for (const i of order) drawFighter(s.f[i], CHARS[i], s.phase);
  for (const p of s.proj) drawChappal(p);
  for (const p of s.sparks) drawSpark(p);
  ctx.restore();
  if (!inGame) return;

  if ((mode === 'host' || mode === 'guest') && s.phase !== 'matchEnd') drawYouMarker(s.f[myIndex()]);
  drawHUD(s);
  if (s.phase === 'intro') {
    if (s.pt < 70) bigText(`ROUND ${s.round}`, H / 2 - 40);
    else bigText('FIGHT!', H / 2 - 40, 100, '#fff');
  } else if (s.phase === 'roundEnd') {
    bigText(s.msg, H / 2 - 60);
    if (s.pt > 50) {
      const t = s.rw < 0 ? 'DRAW' : `${CHARS[s.rw].name} wins the round`;
      bigText(t, H / 2 + 30, 40, '#fff');
    }
  }
}

// ---------- audio ----------
let actx = null;
function initAudio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
  }
  if (actx.state === 'suspended') actx.resume();
}
addEventListener('pointerdown', initAudio);
addEventListener('keydown', initAudio);

function tone(freq, dur, type = 'square', vol = 0.12, slide = 0) {
  const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.linearRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
}
let noiseBuf = null;
function noise(dur, vol, freq) {
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 0.5, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = actx.currentTime, src = actx.createBufferSource(), flt = actx.createBiquadFilter(), g = actx.createGain();
  src.buffer = noiseBuf; flt.type = 'bandpass'; flt.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(flt).connect(g).connect(actx.destination); src.start(t); src.stop(t + dur);
}
function sfx(e) {
  if (!actx || actx.state !== 'running') return;
  switch (e) {
    case 'hit': noise(0.12, 0.6, 900); tone(120, 0.14, 'sine', 0.4, -70); break;
    case 'block': tone(950, 0.05, 'square', 0.08); break;
    case 'swing': noise(0.07, 0.15, 2600); break;
    case 'throw': noise(0.16, 0.18, 1500); break;
    case 'jump': tone(280, 0.08, 'triangle', 0.08, 220); break;
    case 'ko': tone(320, 0.7, 'sawtooth', 0.15, -260); break;
    case 'round': tone(440, 0.14, 'square', 0.08); break;
    case 'fight': tone(523, 0.1, 'square', 0.1); setTimeout(() => tone(784, 0.22, 'square', 0.1), 110); break;
  }
}

// ---------- input ----------
const KEYMAP = {
  KeyA: [0, 'l'], KeyD: [0, 'r'], KeyW: [0, 'u'], KeyS: [0, 'd'], KeyF: [0, 'p'], KeyG: [0, 'k'], KeyH: [0, 's'],
  ArrowLeft: [1, 'l'], ArrowRight: [1, 'r'], ArrowUp: [1, 'u'], ArrowDown: [1, 'd'],
  Comma: [1, 'p'], Period: [1, 'k'], Slash: [1, 's'],
};
const keySets = [emptyInput(), emptyInput()];
const touchSet = emptyInput();

function press(set, k, down) {
  if (k === 'p') { if (down) set.pc++; return; }
  if (k === 'k') { if (down) set.kc++; return; }
  if (k === 's') { if (down) set.sc++; return; }
  if (k === 'u' && down && !set.u) set.jc++;
  set[k] = down;
}

addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  const m = KEYMAP[e.code];
  if (!m) return;
  e.preventDefault();
  if (e.repeat) return;
  press(keySets[m[0]], m[1], true);
});
addEventListener('keyup', e => {
  const m = KEYMAP[e.code];
  if (m) press(keySets[m[0]], m[1], false);
});
addEventListener('blur', () => {
  for (const s of [...keySets, touchSet]) s.l = s.r = s.u = s.d = false;
});

document.querySelectorAll('#touch .btn').forEach(b => {
  const k = b.dataset.k;
  const down = e => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); b.classList.add('on'); press(touchSet, k, true); };
  const up = e => { e.preventDefault(); b.classList.remove('on'); press(touchSet, k, false); };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
});

function mergeInput(list) {
  const o = emptyInput();
  for (const s of list) {
    o.l = o.l || s.l; o.r = o.r || s.r; o.u = o.u || s.u; o.d = o.d || s.d;
    o.pc += s.pc; o.kc += s.kc; o.jc += s.jc; o.sc += s.sc;
  }
  return o;
}

function cleanInput(i) {
  const o = emptyInput();
  if (!i || typeof i !== 'object') return o;
  for (const k of ['l', 'r', 'u', 'd']) o[k] = !!i[k];
  for (const k of ['pc', 'kc', 'jc', 'sc']) o[k] = Number.isFinite(i[k]) ? i[k] : 0;
  return o;
}

// ---------- game flow ----------
let mode = null;      // null (menu) | 'local' | 'host' | 'guest'
let net = null;
let state = newState();

function myIndex() { return mode === 'guest' ? 1 : 0; }

function startGame(m) {
  mode = m;
  state = newState();
  for (const id of ['menu', 'lobby', 'endScreen']) show(id, false);
  show('exitBtn', true);
  show('touch', isTouch);
  if (m === 'host' || m === 'guest') toast('Connected! You are ' + CHARS[myIndex()].name);
}

function toMenu(msg) {
  const n = net;
  net = null;
  if (n) {
    clearTimeout(n.timer);
    try { if (n.conn && n.conn.open) n.conn.send({ t: 'bye' }); } catch (e) { /* ignore */ }
    setTimeout(() => { try { n.conn && n.conn.close(); } catch (e) {} try { n.peer.destroy(); } catch (e) {} }, 150);
  }
  mode = null;
  state = newState();
  show('menu', true);
  for (const id of ['lobby', 'endScreen', 'exitBtn', 'touch']) show(id, false);
  if (msg) toast(msg, 3500);
}

function currentView() {
  return mode === 'guest' && net && net.snaps.length ? net.snaps[net.snaps.length - 1].s : state;
}

let endShownFor = null;
function updateEndScreen() {
  const s = currentView();
  const on = !!mode && s.phase === 'matchEnd' && s.pt > 50;
  show('endScreen', on);
  if (!on) { endShownFor = null; return; }
  const key = mode + ':' + s.winner + ':' + s.wins.join('-');
  if (endShownFor === key) return;
  endShownFor = key;
  let text;
  if (mode === 'local') text = s.winner < 0 ? 'DRAW!' : `${CHARS[s.winner].name} WINS!`;
  else text = s.winner < 0 ? 'DRAW!' : (s.winner === myIndex() ? 'YOU WIN! 🏆' : 'YOU LOSE 😵');
  $('endText').textContent = text;
  $('endNote').textContent = mode === 'local' ? '' : 'Either player can start a rematch.';
}

function rematch() {
  if (mode === 'guest') {
    if (net && net.open) net.conn.send({ t: 'rematch' });
    $('endNote').textContent = 'Rematch requested…';
  } else {
    state = newState();
  }
}

// ---------- networking ----------
function genCode() {
  let c = '';
  const r = crypto.getRandomValues(new Uint32Array(5));
  for (let i = 0; i < 5; i++) c += CODE_CHARS[r[i] % CODE_CHARS.length];
  return c;
}

function showLobby(title, status) {
  show('menu', false); show('lobby', true); show('codeBox', false);
  $('lobbyTitle').textContent = title;
  setLobbyStatus(status);
}
function setLobbyStatus(msg, err) {
  const el = $('lobbyStatus');
  el.textContent = msg;
  el.classList.toggle('err', !!err);
}

function newNet(role, peer, code) {
  return { role, peer, code, conn: null, open: false, remoteIn: emptyInput(), snaps: [], pend: [],
    tick: 0, ping: 0, lastSent: '', lastSentT: 0, timer: 0 };
}

function friendlyError(e) {
  switch (e && e.type) {
    case 'peer-unavailable': return 'Room not found. Check the code and make sure your friend is still on the room screen.';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed':
      return "Can't reach the online server. Check your internet and try again.";
    case 'browser-incompatible': return 'This browser does not support online play. Try Chrome.';
    default: return 'Connection problem: ' + ((e && (e.type || e.message)) || 'unknown');
  }
}

function netError(e) {
  if (mode === 'host' || mode === 'guest') toMenu('Connection lost. ' + friendlyError(e));
  else { setLobbyStatus(friendlyError(e), true); show('codeBox', false); }
}

function wireConn(conn) {
  conn.on('data', m => onData(conn, m));
  conn.on('close', () => {
    if (net && net.conn === conn) toMenu(mode ? 'Your friend left the game.' : 'Connection closed.');
  });
  conn.on('error', e => { if (net && net.conn === conn) netError(e); });
}

function onData(conn, m) {
  if (!net || net.conn !== conn || !m || typeof m !== 'object') return;
  switch (m.t) {
    case 'start':
      if (net.role === 'guest') { clearTimeout(net.timer); startGame('guest'); }
      break;
    case 'full':
      setLobbyStatus('That room already has two players.', true);
      break;
    case 'in':
      if (net.role === 'host') net.remoteIn = cleanInput(m.i);
      break;
    case 's':
      if (net.role === 'guest' && m.s && m.s.f) {
        net.snaps.push({ t: performance.now(), s: m.s });
        if (net.snaps.length > 2) net.snaps.shift();
        (m.s.ev || []).forEach(sfx);
      }
      break;
    case 'rematch':
      if (net.role === 'host' && state.phase === 'matchEnd') { state = newState(); toast('Friend started a rematch!'); }
      break;
    case 'ping': conn.send({ t: 'pong', ts: m.ts }); break;
    case 'pong': net.ping = Math.round(performance.now() - m.ts); break;
    case 'bye': toMenu('Your friend left the game.'); break;
  }
}

setInterval(() => {
  if (net && net.open && net.conn) { try { net.conn.send({ t: 'ping', ts: performance.now() }); } catch (e) {} }
}, 2000);

function hostRoom(attempt = 0) {
  if (typeof window.Peer !== 'function') {
    showLobby('Online Room', '');
    setLobbyStatus('Online mode could not load. Check your internet and reload the page.', true);
    return;
  }
  showLobby('Online Room', 'Creating room…');
  const code = genCode();
  const peer = new window.Peer(PEER_PREFIX + code, { config: ICE, debug: 1 });
  net = newNet('host', peer, code);

  peer.on('open', () => {
    if (!net || net.peer !== peer) return;
    $('roomCode').textContent = code;
    show('codeBox', true);
    setLobbyStatus('Waiting for your friend to join…');
  });
  peer.on('connection', conn => {
    if (!net || net.peer !== peer) return;
    if (net.conn) {
      conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 400); });
      return;
    }
    net.conn = conn;
    wireConn(conn);
    conn.on('open', () => {
      net.open = true;
      conn.send({ t: 'start' });
      startGame('host');
    });
  });
  peer.on('error', e => {
    if (!net || net.peer !== peer) return;
    if (e.type === 'unavailable-id' && attempt < 3) { peer.destroy(); hostRoom(attempt + 1); return; }
    netError(e);
  });
}

function joinRoom(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== 5) { toast('Enter the 5-character room code'); return; }
  if (typeof window.Peer !== 'function') {
    showLobby('Joining ' + code, '');
    setLobbyStatus('Online mode could not load. Check your internet and reload the page.', true);
    return;
  }
  showLobby('Joining ' + code, 'Connecting…');
  const peer = new window.Peer({ config: ICE, debug: 1 });
  net = newNet('guest', peer, code);
  net.timer = setTimeout(() => {
    if (net && net.peer === peer && !mode) {
      setLobbyStatus("Couldn't connect. Check the code. If you're on mobile data, try both being on Wi-Fi.", true);
    }
  }, 20000);

  peer.on('open', () => {
    if (!net || net.peer !== peer) return;
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
    net.conn = conn;
    wireConn(conn);
    conn.on('open', () => { if (net && net.conn === conn) { net.open = true; setLobbyStatus('Connected! Starting…'); } });
  });
  peer.on('error', e => { if (net && net.peer === peer) netError(e); });
}

function shareUrl(code) {
  return location.origin + location.pathname + '?room=' + code;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) {}
    ta.remove(); return ok;
  }
}

// ---------- main loop ----------
let acc = 0, last = performance.now();

function simTick() {
  let ins;
  if (mode === 'local') ins = [mergeInput([keySets[0], touchSet]), keySets[1]];
  else ins = [mergeInput([keySets[0], keySets[1], touchSet]), net ? net.remoteIn : emptyInput()];
  step(state, ins);
  if (state.ev.length) {
    state.ev.forEach(sfx);
    if (mode === 'host' && net) net.pend.push(...state.ev);
    state.ev = [];
  }
  if (mode === 'host' && net && net.open && (++net.tick % 2 === 0)) {
    try { net.conn.send({ t: 's', s: Object.assign({}, state, { ev: net.pend }) }); } catch (e) {}
    net.pend = [];
  }
}

function sendGuestInput() {
  if (!net || !net.open) return;
  const i = mergeInput([keySets[0], keySets[1], touchSet]);
  const k = JSON.stringify(i);
  const now = performance.now();
  if (k !== net.lastSent || now - net.lastSentT > 250) {
    try { net.conn.send({ t: 'in', i }); } catch (e) {}
    net.lastSent = k; net.lastSentT = now;
  }
}

function guestView(now) {
  const b = net ? net.snaps : [];
  if (!b.length) return state;
  const L = b[b.length - 1];
  if (b.length < 2) return L.s;
  const P = b[b.length - 2];
  const a = Math.min(1, (now - L.t) / Math.max(16, L.t - P.t));
  const v = Object.assign({}, L.s);
  v.f = L.s.f.map((f, i) => Object.assign({}, f, { x: lerp(P.s.f[i].x, f.x, a), y: lerp(P.s.f[i].y, f.y, a) }));
  v.proj = (L.s.proj || []).map(p => {
    const q = (P.s.proj || []).find(z => z.id === p.id);
    return q ? Object.assign({}, p, { x: lerp(q.x, p.x, a) }) : p;
  });
  return v;
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = now - last; last = now;
  if (dt > 250) dt = 250;
  if (mode === 'local' || mode === 'host') {
    acc += dt;
    let n = 0;
    while (acc >= TICK && n < 6) { simTick(); acc -= TICK; n++; }
    if (n === 6) acc = 0;
    render(state, true);
  } else if (mode === 'guest') {
    sendGuestInput();
    render(guestView(now), true);
  } else {
    render(state, false);
  }
  updateEndScreen();
}

// ---------- ui wiring ----------
$('btnLocal').onclick = () => startGame('local');
$('btnHost').onclick = () => hostRoom();
$('btnJoin').onclick = () => joinRoom($('codeInput').value);
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(e.target.value); });
$('btnCancel').onclick = () => toMenu();
$('exitBtn').onclick = () => toMenu();
$('btnEndMenu').onclick = () => toMenu();
$('btnRematch').onclick = rematch;
$('btnCopy').onclick = async () => { if (net) toast(await copyText(net.code) ? 'Code copied!' : 'Copy failed. Read it out to your friend.'); };
$('btnShare').onclick = async () => {
  if (!net) return;
  const url = shareUrl(net.code);
  if (navigator.share) {
    try { await navigator.share({ title: 'Galli Clash', text: `Fight me in Galli Clash! Room code: ${net.code}`, url }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  toast(await copyText(url) ? 'Invite link copied!' : url, 4000);
};

const params = new URLSearchParams(location.search);
const roomParam = params.get('room');
if (roomParam) {
  history.replaceState(null, '', location.pathname);
  $('codeInput').value = roomParam.toUpperCase();
  joinRoom(roomParam);
}

// test hook (harmless in normal play)
window.__galli = { get state() { return state; }, get mode() { return mode; }, get net() { return net; }, currentView };

requestAnimationFrame(frame);
})();
