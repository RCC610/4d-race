import { store } from './store.js';
import { TEAMS, SW3, OKC, RACE, clamp, pct, esc, score, tally, bolt } from './common.js';

const $ = s => document.querySelector(s);
const INK = '#2A1714';
const LINK = 'rcc610.github.io/4d-race';
const GRACE = 1.5;          // seconds after the timer before answers close
const LEADER_AFTER = [1, 3, 5]; // show top players after rounds 2, 4 and 6 (one per D)

let db, S = null;            // S = shared state doc
let players = [], answers = [];
let tick = null, closing = false, lastRender = '';

const now = () => Date.now();
const curR = () => RACE[S.i];
const live = () => players.filter(p => p.run === S.run);
const ansFor = i => answers.filter(a => a.run === S.run && a.i === i);

/* ---------- scoring from raw answers (host is the only one who counts) ---------- */
function roundScores(i) { const m = new Map(); ansFor(i).forEach(a => m.set(a.pid, score(RACE[i], a.v))); return m; }
function totals(upto) {
  const pts = new Map(); live().forEach(p => pts.set(p.id, 0));
  for (let i = 0; i <= upto; i++) roundScores(i).forEach((s, pid) => pts.set(pid, (pts.get(pid) || 0) + Math.round(s * 1000)));
  return pts;
}
function ranking(upto) {
  const pts = totals(upto), byId = new Map(live().map(p => [p.id, p]));
  return [...pts].filter(([id]) => byId.has(id)).map(([id, p]) => ({ id, name: byId.get(id).n, team: byId.get(id).t ?? 0, pts: p }))
    .sort((a, b) => b.pts - a.pts || a.name.localeCompare(b.name));
}
const teamPct = () => [0, 1, 2, 3].map(i => (S.tp && S.tp['t' + i]) || []);
const qTot = i => teamPct()[i].reduce((a, b) => a + b, 0);
const qAvg = i => teamPct()[i].length ? Math.round(qTot(i) / teamPct()[i].length) : 0;
const qProg = t => clamp(t / (RACE.length * 80), 0, 1);
const qLead = () => [0, 1, 2, 3].reduce((b, i) => qTot(i) > qTot(b) ? i : b, 0);

/* ---------- game flow ---------- */
async function newGame() {
  if (S && S.phase !== 'lobby' && S.phase !== 'final' && !confirm('Start a brand-new game? Everyone will need to join again.')) return;
  stopTick();
  await Promise.all([db.clearCol('players'), db.clearCol('ans')]);
  await db.set('board', { run: '', r: {} });
  await db.set('state', { run: Math.random().toString(36).slice(2, 8), phase: 'lobby', i: -1, tp: { t0: [], t1: [], t2: [], t3: [] }, last: [0, 0, 0, 0] });
}
async function startRound(i) {
  closing = false;
  await db.set('state', { ...S, phase: 'play', i, T: RACE[i].T, at: now() });
}
async function reveal() {
  if (closing || S.phase !== 'play') return; closing = true; stopTick();
  const R = curR(), sc = roundScores(S.i), sum = [0, 0, 0, 0], n = [0, 0, 0, 0];
  live().forEach(p => { if (sc.has(p.id)) { sum[p.t ?? 0] += sc.get(p.id); n[p.t ?? 0]++; } });
  const last = sum.map((v, k) => n[k] ? Math.round(100 * v / n[k]) : 0);
  const tp = { ...S.tp }; last.forEach((v, k) => tp['t' + k] = [...(tp['t' + k] || []).slice(0, S.i), v]);
  await db.set('state', { ...S, phase: 'reveal', last, tp, prev: [0, 1, 2, 3].map(qTot) });
  void R;
}
async function showBoard(phase) {
  const rk = ranking(S.i), r = {}; let place = 0, prev = null;
  rk.forEach((p, k) => { if (p.pts !== prev) { place = k + 1; prev = p.pts; } r[p.id] = [place, p.pts]; });
  await db.set('board', { run: S.run, r, n: rk.length, upto: S.i });
  await db.set('state', { ...S, phase });
}
async function next() {
  if (!S) return;
  if (S.phase === 'lobby') return startRound(0);
  if (S.phase === 'play') return reveal();
  if (S.phase === 'reveal') {
    if (S.i === RACE.length - 1) return showBoard('final');
    if (LEADER_AFTER.includes(S.i)) return showBoard('leaders');
    return startRound(S.i + 1);
  }
  if (S.phase === 'leaders') return startRound(S.i + 1);
}

/* ---------- timer ---------- */
function stopTick() { if (tick) clearInterval(tick); tick = null; }
function runTick() {
  stopTick();
  tick = setInterval(() => {
    if (!S || S.phase !== 'play') return stopTick();
    const left = S.T - (now() - S.at) / 1000;
    const t = $('#tmr'); if (t) { t.style.setProperty('--p', clamp(100 * left / S.T, 0, 100)); t.querySelector('span').textContent = Math.max(0, Math.ceil(left)); }
    const everyone = live().length > 0 && ansFor(S.i).length >= live().length;
    if (left <= -GRACE || (everyone && now() - S.at > 3000)) reveal();
  }, 250);
}

/* ---------- big screen ---------- */
const timerHTML = () => { const left = Math.max(0, S.T - (now() - S.at) / 1000); return `<div class="mini-timer" id="tmr" style="--p:${clamp(100 * left / S.T, 0, 100)}"><span>${Math.ceil(left)}</span></div>`; };
function render() {
  if (!S) { $('#screen').innerHTML = `<div class="layer lobby-wait"><p>Press <b>New game</b> to set up.</p></div>`; lastRender = ''; return controls(); }
  const key = S.run + ':' + S.phase + ':' + S.i;
  if (key !== lastRender) {
    lastRender = key;
    $('#screen').innerHTML = S.phase === 'lobby' ? lobbyHTML() : (S.phase === 'leaders' || S.phase === 'final') ? boardHTML() : raceHTML();
    if (S.phase === 'reveal') moveCars();
  }
  updateLive(); controls();
}
// Small in-place updates (counts, names) so Bolt and the cars don't restart their animations.
function updateLive() {
  if (S.phase === 'lobby') {
    const ps = live(), c = [0, 0, 0, 0]; ps.forEach(p => c[p.t ?? 0]++);
    c.forEach((v, i) => { const e = $('#tc' + i); if (e) e.textContent = `${v} player${v === 1 ? '' : 's'}`; });
    const j = $('#jc'); if (j) j.textContent = ps.length;
    const nm = $('#names'); if (nm) nm.innerHTML = [...ps].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 14).map(p => `<span style="--tc:${TEAMS[p.t ?? 0].c}">${esc(p.n)}</span>`).join('');
  }
  if (S.phase === 'play') { const l = $('#live'); if (l) l.textContent = `${ansFor(S.i).length} / ${live().length} answered`; }
}
function controls() {
  const lbl = !S ? ['New game', ''] : {
    lobby: ['Start game →', `${live().length} joined`],
    play: ['Reveal now →', `${S ? ansFor(S.i).length : 0} of ${live().length} answered`],
    reveal: [S.i === RACE.length - 1 ? 'Final results →' : LEADER_AFTER.includes(S.i) ? 'Top players →' : 'Next round →', `Round ${S.i + 1} of ${RACE.length}`],
    leaders: ['Next round →', `Round ${S.i + 1} of ${RACE.length} done`],
    final: ['Game over', 'Press New game to play again']
  }[S.phase];
  $('#next').textContent = lbl[0]; $('#next').disabled = !S || S.phase === 'final'; $('#status').textContent = lbl[1];
}

function lobbyHTML() {
  const ps = live(), c = [0, 0, 0, 0]; ps.forEach(p => c[p.t ?? 0]++);
  const recent = [...ps].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, 14);
  return `<div class="layer lobby sun"><div class="joinbox"><h2>Scan to join</h2><p>In the room or on Teams</p><img class="qrimg" src="qr.svg" alt="QR code to join">
   <p>or go to</p><div class="link">${LINK}</div></div>
   <div class="lobby-bolt"><div style="position:relative"><span class="bubble">Hi, I'm Bolt!</span>${bolt('wave')}</div></div>
   <div class="lobby-r"><h3>Join fast.<br>We'll put you on a team.</h3><div class="tgrid">${TEAMS.map((t, i) => `<div class="tbox" style="--tc:${t.c}"><b>${t.n}</b><span id="tc${i}">${c[i]} player${c[i] === 1 ? '' : 's'}</span></div>`).join('')}</div>
   <p class="sub"><b id="jc">${ps.length}</b> players joined</p><div class="names" id="names">${recent.map(p => `<span style="--tc:${TEAMS[p.t ?? 0].c}">${esc(p.n)}</span>`).join('')}</div></div></div>`;
}

function raceHTML() {
  const R = curR(), rev = S.phase === 'reveal', all = live().length, got = ansFor(S.i);
  const avg = (S.last || [0]).reduce((a, b) => a + b, 0) / 4;
  const pose = rev ? (avg >= 70 ? 'up' : 'tired') : 'think';
  const top = `<div class="topbar"><span class="tagc red">Round ${S.i + 1} of ${RACE.length} · ${TEAMS[R.d].n}</span><span class="rtype">${R.title}</span><span class="rins">${R.ins}</span><span class="grow"></span>
    ${rev ? `<span class="live">${got.length} answered</span>` : `<span class="live" id="live">${got.length} / ${all} answered</span>${timerHTML()}`}</div>`;
  const agg = rev ? tally(R, got) : null, N = got.length || 1;
  let body = '';
  if (R.type === 'swipe') body = `<div class="sw3">${R.items.map((it, k) => {
    const a = agg ? agg[k] : [0, 0, 0], n = a.reduce((x, y) => x + y, 0) || 1;
    return `<div class="tcard">${rev ? `<span class="stamp sm" style="background:${SW3[it.c].c}">${SW3[it.c].n}</span>` : ''}<p class="tt">${it.t}</p>
      ${rev ? `<div class="split">${[0, 1, 2].map(j => `<i style="width:${pct(a[j], n)}%;background:${SW3[j].c}"></i>`).join('')}</div>
      <div class="tl">${[0, 1, 2].map(j => `<span><b style="color:${SW3[j].c}">${pct(a[j], n)}%</b> ${SW3[j].short}</span>`).join('')}</div>
      <span class="matched">${pct(a[it.c], n)}% got it</span>` : `<div class="tl wait">${SW3.map(x => `<span style="color:${x.c}">${x.short}</span>`).join('<span>·</span>')}</div>`}</div>`;
  }).join('')}</div>${rev ? `<div class="rsay">${R.say}</div>` : ''}`;
  if (R.type === 'build') body = `<div class="bld"><div class="weak ${rev ? 'better' : ''}"><span class="wl">${rev ? 'Better prompt' : 'Weak prompt'}</span><p>${rev ? R.better : '“' + R.weak + '”'}</p></div>
    <div class="chips">${R.chips.map((c, k) => { const v = agg ? agg[k] : 0; return `<div class="chipr ${rev ? (c.ok ? 'good' : 'bad') : ''}"><span class="ct">${rev ? (c.ok ? '✓ ' : '✕ ') : ''}${c.t}</span>${rev ? `<span class="cb"><i style="width:${pct(v, N)}%"></i></span><b>${pct(v, N)}%</b>` : ''}</div>`; }).join('')}</div></div>`;
  if (R.type === 'pen') body = `<div class="aic ${rev ? 'reveal' : ''}"><div class="aiq"><span>Asked the AI</span>“${R.ask}”</div><div class="aia">${R.segs.map((g, k) => `<span class="seg ${g.bad ? 'bad' : 'fine'}">${g.t}</span>${rev && g.bad ? `<span class="flag">${g.bad}<em>· ${pct(agg[k], N)}% caught it</em></span>` : ''} `).join('')}</div></div>`;
  if (R.type === 'ok') body = `<div class="oks">${R.items.map((it, k) => {
    const a = agg ? agg[k] : [0, 0], n = a[0] + a[1] || 1, right = it.ok ? 0 : 1;
    return `<div class="okrow ${rev ? '' : 'wait'}">${rev ? `<span class="okstamp" style="background:${OKC[right].c}">${OKC[right].n}</span>` : ''}<span class="ot">${it.t}</span>
      ${rev ? `<span class="ob"><i style="width:${pct(a[0], n)}%;background:${OKC[0].c}"></i><i style="width:${pct(a[1], n)}%;background:${OKC[1].c}"></i></span>
      <span class="ol"><b style="color:#5BE39A">${pct(a[0], n)}%</b> OK · <b style="color:#FF8A78">${pct(a[1], n)}%</b> Not OK</span>` : ''}</div>`;
  }).join('')}</div>`;
  const prev = S.prev || [0, 0, 0, 0];
  const lead = S.i > 0 || rev ? (rev ? [0, 1, 2, 3].reduce((b, i) => prev[i] > prev[b] ? i : b, 0) : qLead()) : -1;
  const strip = `<div class="strip">${TEAMS.map((t, i) => {
    const p = qProg(rev ? prev[i] : qTot(i));
    return `<div class="mlane"><span class="mtag" style="--tc:${t.c}">${t.n}<em>${qAvg(i)}%</em></span><div class="mtrack"><div class="finish"></div>
      <div class="car mcar idle" id="car${i}" style="left:${miniLeft(p)};animation-delay:${i * .2}s">${carSVG(i)}<span id="cr${i}" ${i === lead && (S.i > 0 || rev) && qTot(lead) > 0 ? '' : 'hidden'}>${CROWN}</span></div></div></div>`;
  }).join('')}</div>`;
  return `<div class="layer">${top}<div class="rc"><div class="rc-bolt">${bolt(pose)}</div><div class="rc-main">${body}</div></div>${strip}</div>`;
}
const miniLeft = p => `calc(${p * 100}% - ${p * 8.6}cqw + .5cqw)`;
function moveCars() {
  const lead = qLead();
  setTimeout(() => TEAMS.forEach((t, i) => {
    const car = $('#car' + i); if (!car) return; const p = qProg(qTot(i));
    car.style.left = miniLeft(p); car.classList.remove('idle'); car.classList.add('zoom'); setTimeout(() => { car.classList.remove('zoom'); car.classList.add('idle'); }, 1600);
    const cr = $('#cr' + i); if (cr) cr.hidden = i !== lead;
    const g = document.createElement('span'); g.className = 'gain sm'; g.innerHTML = `<b>+${(S.last || [])[i] || 0}%</b>`; g.style.left = `calc(${p * 100}% - ${p * 8.6}cqw + 6.2cqw)`; g.style.top = '-.1cqw';
    car.parentElement.appendChild(g); setTimeout(() => g.remove(), 2900);
  }), 400);
}
function carSVG(i) {
  const t = TEAMS[i];
  return `<svg viewBox="0 0 120 74"><g stroke="${INK}" stroke-width="4" stroke-linejoin="round">
   <path d="M34 26 Q38 8 60 8 L74 8 Q92 8 98 28 Z" fill="${t.l}"/><path d="M58 13 L72 13 Q86 13 90 27 L58 27 Z" fill="#E9F6FB"/>
   <path d="M8 34 Q8 26 18 26 L100 26 Q114 27 114 42 L114 50 Q114 56 108 56 L12 56 Q6 56 6 50 Z" fill="${t.h}"/>
   <circle cx="31" cy="58" r="11" fill="#3A3030"/><circle cx="31" cy="58" r="4" fill="#D9D0C8" stroke-width="3"/>
   <circle cx="91" cy="58" r="11" fill="#3A3030"/><circle cx="91" cy="58" r="4" fill="#D9D0C8" stroke-width="3"/></g>
   <ellipse cx="68" cy="20" rx="2.6" ry="3.6" fill="${INK}"/><ellipse cx="80" cy="20" rx="2.6" ry="3.6" fill="${INK}"/>
   <path d="M70 24 Q74 27 78 24" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>
   <ellipse cx="104" cy="38" rx="5" ry="3" fill="#FFE7A3" stroke="${INK}" stroke-width="2.5"/><rect x="20" y="34" width="22" height="7" rx="3.5" fill="rgba(255,255,255,.35)"/></svg>`;
}
const CROWN = `<svg class="crown" viewBox="0 0 40 28"><path d="M3 24 L6 6 L15 15 L20 3 L25 15 L34 6 L37 24 Z" fill="#F2B134" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/></svg>`;
function confetti() { let c = ''; for (let i = 0; i < 40; i++) c += `<i style="left:${(i * 37) % 100}%;background:${['#E0553B', '#4FA3A0', '#E8B04A', '#A5B6B6', '#fff'][i % 5]};animation-duration:${2.6 + (i % 7) * .35}s;animation-delay:${-(i % 9) * .55}s"></i>`; return `<div class="confetti">${c}</div>`; }

function boardHTML() {
  const fin = S.phase === 'final', r = ranking(S.i);
  const d = Math.floor(S.i / 2);
  let title;
  if (!fin) title = `Top players so far<small>After round ${S.i + 1} · ${TEAMS[d].n} done</small>`;
  else { const ord = [0, 1, 2, 3].sort((x, y) => qTot(y) - qTot(x)), w = ord[0];
    title = `Team ${TEAMS[w].n} takes the checkered flag!<small>${ord.map((t, k) => `<span class="winner"><b>${k + 1}</b><span style="width:.9cqw;height:.9cqw;border-radius:50%;background:${TEAMS[t].c}"></span>${TEAMS[t].n} \u00b7 ${qAvg(t)}%</span>`).join(' ')}</small>`; }
  const col = ['#E0553B', '#4FA3A0', '#E8B04A', '#A5B6B6'];
  if (!r.length) return `<div class="layer board sun"><h2>${title}</h2><div class="board-bolt">${bolt('up')}</div></div>`;
  const topPts = r[0].pts, tied = r.filter(p => p.pts === topPts);
  if (tied.length > 1) {
    const max = 24, shown = tied.slice(0, max);
    const chips = shown.map((p, i) => `<span class="wchip" style="animation-delay:${Math.min(i * .03, .9)}s"><i style="background:${col[p.team]}"></i>${esc(p.name)}</span>`).join('')
      + (tied.length > max ? `<span class="wchip more">+${tied.length - max} more</span>` : '');
    return `<div class="layer board wallb sun">${fin ? confetti() : ''}<h2>${title}</h2><div class="board-bolt">${bolt(fin ? 'hype' : 'up')}</div>
      <div class="wall"><div class="wall-h"><b>${tied.length} players tied for the top score</b><span>${topPts.toLocaleString()} pts each</span></div><div class="wall-g">${chips}</div></div></div>`;
  }
  const order = [1, 0, 2].filter(k => r[k]), heights = [24, 18, 13.5];
  const pods = order.map(k => { const p = r[k]; return `<div class="pod"><div class="av" style="background:${col[p.team]}">${esc((p.name[0] || '?').toUpperCase())}<span class="medal">${['1st', '2nd', '3rd'][k]}</span></div>
    <div class="pname">${esc(p.name)}</div><div class="block" style="height:${heights[k]}cqw;animation-delay:${.15 * (2 - k)}s"><b>${k + 1}</b><span>${p.pts.toLocaleString()} pts</span></div></div>`; }).join('');
  const rest = r.slice(3, 5).map((p, i) => `<li style="animation-delay:${.5 + i * .1}s"><span class="rk">${i + 4}</span><span class="nm">${esc(p.name)}</span><span class="pt">${p.pts.toLocaleString()}</span></li>`).join('');
  return `<div class="layer board sun">${fin ? confetti() : ''}<h2>${title}</h2><div class="board-bolt">${bolt(fin ? 'hype' : 'up')}</div><div class="podium">${pods}</div><ol class="rest">${rest}</ol></div>`;
}

/* ---------- team assignment: host balances teams as people join ---------- */
let assigning = false;
async function assignTeams() {
  if (assigning || !S) return;
  const todo = live().filter(p => p.t === undefined || p.t === null);
  if (!todo.length) return;
  assigning = true;
  const c = [0, 0, 0, 0]; live().forEach(p => { if (p.t >= 0) c[p.t]++; });
  const ops = todo.sort((a, b) => (a.at || 0) - (b.at || 0)).map(p => { const t = c.indexOf(Math.min(...c)); c[t]++; p.t = t; return { p: 'players/' + p.id, data: { t }, merge: true }; });
  try { await db.batch(ops); } finally { assigning = false; }
}

/* ---------- boot ---------- */
async function boot() {
  db = await store();
  $('#next').onclick = next;
  $('#new').onclick = newGame;
  $('#full').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  $('#hide').onclick = () => document.body.classList.toggle('bare');
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); if (!$('#next').disabled) next(); }
    if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('bare');
    if (e.key === 'f' || e.key === 'F') $('#full').click();
  });
  db.watchDoc('state', d => {
    const was = S; S = d;
    if (S && S.phase === 'play' && (!was || was.phase !== 'play' || was.i !== S.i)) { closing = false; runTick(); }
    render(); assignTeams();
  }, e => showErr(e));
  db.watchCol('players', d => { players = d; assignTeams(); render(); }, e => showErr(e));
  db.watchCol('ans', d => { answers = d; render(); }, e => showErr(e));
}
function showErr(e) { $('#status').textContent = 'Connection problem: ' + (e && e.message || e); }
boot();
