import { store } from './store.js';
import { TEAMS, SW3, OKC, RACE, pct, esc, score, blank, resultLabel, bolt } from './common.js';

const $ = s => document.querySelector(s);
const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };

let db, S = null, me = null, board = null;
let pid = ls.get('4d-pid'); if (!pid) { pid = Math.random().toString(36).slice(2, 12); ls.set('4d-pid', pid); }
let name = ls.get('4d-name') || '';
let joining = false;
// Per-round answer state
let R = null, ri = -1, rIn = null, locked = false, sent = null, gotAt = 0, autoT = null, barT = null;

const pb = p => `<div class="ph-bolt">${bolt(p)}</div>`;
const joined = () => S && me && me.run === S.run;

function resetRound(i) {
  ri = i; R = RACE[i]; rIn = blank(R); locked = false; sent = null; gotAt = Date.now();
  const saved = ls.get(`4d-a-${S.run}-${i}`);   // survive a page reload mid-round
  if (saved) { try { rIn = JSON.parse(saved); locked = true; sent = rIn; } catch (e) { } }
  clearTimeout(autoT);
  // Lock in whatever they have a moment before the big screen closes the round.
  autoT = setTimeout(() => { if (!locked && touched()) lock(); }, Math.max(1000, (R.T - 1.5) * 1000));
}
const touched = () => Array.isArray(rIn) && rIn.some(x => x >= 0);

async function lock() {
  if (locked || !S || S.phase !== 'play') return;
  locked = true; sent = [...rIn]; draw();
  ls.set(`4d-a-${S.run}-${ri}`, JSON.stringify(sent));
  try { await db.set(`ans/${ri}_${pid}`, { i: ri, pid, run: S.run, t: me?.t ?? 0, v: sent, at: Date.now() }); }
  catch (e) { locked = false; draw(); toast('Could not send. Check your connection and tap Lock in again.'); }
}

async function join() {
  const v = ($('#nm')?.value || '').trim().replace(/\s+/g, ' ').slice(0, 18);
  if (!v) { $('#nm')?.focus(); return; }
  if (joining) return; joining = true;
  name = v; ls.set('4d-name', v);
  try { await db.set(`players/${pid}`, { n: v, run: S.run, at: Date.now() }); }
  catch (e) { toast('Could not join. Check your connection and try again.'); }
  joining = false;
}

/* ---------- screens ---------- */
function draw() {
  const ph = $('#app');
  const t = me && me.t >= 0 ? TEAMS[me.t] : null;
  const top = `<div class="ph-top"><span class="brand4"><b>4D</b> Race</span>${joined() ? (t ? `<span class="ph-team" style="--tc:${t.c}">Team ${t.n}</span>` : `<span class="ph-team" style="--tc:#ccc">${esc(me.n)}</span>`) : ''}</div>`;
  let b = '';
  if (!S) b = `<div class="ph-center">${pb('think')}<h4>Getting ready…</h4><p>The game hasn't opened yet. Keep this page open.</p></div>`;
  else if (!joined()) {
    b = S.phase === 'final' ? `<div class="ph-center">${pb('up')}<h4>This game just finished</h4><p>Thanks for stopping by!</p></div>`
      : `<div class="ph-center join">${pb('wave')}<h4>Join Bolt's 4D Race</h4><p>Type your name. We'll put you on a team.</p></div>
      <input id="nm" value="${esc(name)}" maxlength="18" autocomplete="given-name" enterkeyhint="go" placeholder="Your name" aria-label="Your name">
      <button class="ph-btn" id="joinb" ${joining ? 'disabled' : ''}>${joining ? 'Joining…' : 'Join'}</button>`;
  }
  else if (S.phase === 'lobby') b = `<div class="ph-center">${pb('up')}<h4>${t ? `You're on Team ${t.n}!` : `You're in, ${esc(me.n)}!`}</h4><p>${t ? 'Eyes on the big screen. We’ll start in a moment.' : 'Finding you a team…'}</p></div>`;
  else if (S.phase === 'play') b = playUI();
  else if (S.phase === 'reveal') b = revealUI();
  else b = boardUI();
  ph.innerHTML = top + `<div class="ph-body">${b}</div>`;
  wire();
  if (S && S.phase === 'play' && !locked) startBar();
}

function playUI() {
  if (locked) return `<div class="ph-center">${pb('think')}<h4>Locked in</h4><p>Waiting for everyone else…</p></div>`;
  const head = `<div class="tbar"><i id="ptb"></i></div><p class="ph-kick">Round ${ri + 1} of ${RACE.length} · ${TEAMS[R.d].n}</p><p class="ph-q">${R.ins}</p>`;
  if (R.type === 'swipe') {
    const k = rIn.indexOf(-1);
    if (k < 0) return head + `<p class="ph-scn">Tap a task to change your pick.</p><div class="ph-mail">${R.items.map((x, i) => `<button class="ph-seg" data-rr="${i}"><b style="color:${SW3[rIn[i]].c}">${SW3[rIn[i]].n}</b><br>${x.t}</button>`).join('')}</div><button class="ph-btn" id="rlock">Lock in</button>`;
    const it = R.items[k], last = rIn.reduce((a, v, i) => v >= 0 ? i : a, -1);
    return head + `<div class="ph-card"><span class="no">Task ${k + 1} of ${R.items.length}</span><span class="task">${it.t}</span></div>
      <div class="sw-btns">${SW3.map((x, j) => `<button class="sw-btn" data-rs="${j}" style="background:${x.c}">${x.n}</button>`).join('')}</div>${last >= 0 ? `<button class="ph-undo" data-rr="${last}">↩ Undo last pick</button>` : ''}`;
  }
  if (R.type === 'build') return head + `<div class="ph-out">“${R.weak}”</div>
    <div class="ph-mail">${R.chips.map((c, k) => `<button class="ph-seg pick ${rIn.includes(k) ? 'sel' : ''}" data-rt="${k}">${rIn.includes(k) ? '✓ ' : '+ '}${c.t}</button>`).join('')}</div>
    <button class="ph-btn" id="rlock" ${rIn.length ? '' : 'disabled'}>Lock in · ${rIn.length} of 3</button>`;
  if (R.type === 'pen') return head + `<p class="ph-scn">Asked the AI: “${R.ask}”</p><div class="ph-mail">${R.segs.map((g, k) => `<button class="ph-seg ${rIn.includes(k) ? 'on' : ''}" data-rt="${k}">${g.t}</button>`).join('')}</div>
    <button class="ph-btn" id="rlock">Done · ${rIn.length} marked</button>`;
  return head + `<div class="ph-mail">${R.items.map((it, k) => `<div class="okp"><span>${it.t}</span><div class="okb">${OKC.map((o, j) => `<button class="${rIn[k] === j ? 'sel' : ''}" data-ro="${k},${j}" style="--oc:${o.c}">${o.n}</button>`).join('')}</div></div>`).join('')}</div>
    <button class="ph-btn" id="rlock" ${rIn.indexOf(-1) < 0 ? '' : 'disabled'}>Lock in · ${rIn.filter(v => v >= 0).length} of ${R.items.length}</button>`;
}

function revealUI() {
  const t = TEAMS[me.t ?? 0], team = (S.last || [])[me.t ?? 0] ?? 0;
  if (!sent) return `<div class="ph-center">${pb('tired')}<h4>You missed this one</h4><p>No worries, the next round is coming up.</p><p>Team ${t.n} scored <b class="hi">${team}%</b> this round</p></div>`;
  const sc = Math.round(score(R, sent) * 100);
  return `<div class="ph-center">${pb(sc >= 67 ? 'hype' : sc > 0 ? 'up' : 'tired')}<p class="res" style="color:${sc >= 67 ? 'var(--a3)' : sc > 0 ? 'var(--a2)' : 'var(--a0)'}">${resultLabel(sc)}</p>
    <span class="pts">+${(sc * 10).toLocaleString()} pts</span><p>Team ${t.n} scored <b class="hi">${team}%</b> this round</p><p class="look">Look up: the answers are on the big screen.</p></div>`;
}

function boardUI() {
  const fin = S.phase === 'final', mine = board && board.run === S.run && board.r ? board.r[pid] : null;
  const rank = mine ? `<span class="pts">#${mine[0]} of ${board.n}</span><p>${mine[1].toLocaleString()} points</p>` : `<p>Check the big screen!</p>`;
  if (!fin) return `<div class="ph-center">${pb('up')}<h4>Nice going!</h4>${rank}<p class="look">Top players are on the big screen.</p></div>`;
  const tot = i => ((S.tp || {})['t' + i] || []).reduce((a, b) => a + b, 0);
  const order = [0, 1, 2, 3].sort((a, b) => tot(b) - tot(a)), place = order.indexOf(me.t ?? 0) + 1;
  return `<div class="ph-center">${pb('hype')}<h4>Thanks for playing!</h4>${rank}<p>Team ${TEAMS[me.t ?? 0].n} finished <b class="hi">#${place} of 4</b></p><p class="look">Remember the 4 D's next time you use AI.</p></div>`;
}

/* ---------- inputs ---------- */
function wire() {
  const on = (sel, fn) => document.querySelectorAll(sel).forEach(x => x.onclick = () => fn(x));
  const jb = $('#joinb'); if (jb) jb.onclick = join;
  const nm = $('#nm'); if (nm) { nm.onkeydown = e => { if (e.key === 'Enter') join(); }; nm.oninput = () => name = nm.value; }
  on('[data-rs]', x => { if (locked) return; const k = rIn.indexOf(-1); if (k >= 0) { rIn[k] = +x.dataset.rs; draw(); } });
  on('[data-rr]', x => { if (locked) return; rIn[+x.dataset.rr] = -1; draw(); });
  on('[data-rt]', x => { if (locked) return; const k = +x.dataset.rt, j = rIn.indexOf(k);
    if (j >= 0) rIn.splice(j, 1); else { if (R.type === 'build' && rIn.length >= 3) return toast('Pick only 3. Tap one to remove it first.'); rIn.push(k); } draw(); });
  on('[data-ro]', x => { if (locked) return; const [k, j] = x.dataset.ro.split(',').map(Number); rIn[k] = j; draw(); });
  const rl = $('#rlock'); if (rl) rl.onclick = lock;
}
function startBar() {
  cancelAnimationFrame(barT);
  const f = () => { const b = $('#ptb'); if (!b || !S || S.phase !== 'play') return; const left = Math.max(0, 1 - (Date.now() - gotAt) / 1000 / R.T); b.style.width = (left * 100) + '%'; barT = requestAnimationFrame(f); };
  f();
}
let toastT = null;
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200); }

/* ---------- boot ---------- */
let meUnsub = null;
async function boot() {
  draw();
  db = await store();
  db.watchDoc('state', d => {
    const was = S; S = d;
    if (S && S.phase === 'play' && (!was || was.phase !== 'play' || was.i !== S.i || was.run !== S.run)) resetRound(S.i);
    if (S && S.i >= 0 && ri !== S.i) { ri = S.i; R = RACE[S.i]; const saved = ls.get(`4d-a-${S.run}-${S.i}`); sent = saved ? JSON.parse(saved) : null; }
    // Don't wipe a half-typed name while waiting in the join screen.
    if (!joined() && $('#nm') && document.activeElement === $('#nm') && was && was.phase === S?.phase) return;
    draw();
  }, () => toast('Connection hiccup. Reconnecting…'));
  meUnsub = db.watchDoc(`players/${pid}`, d => { me = d; draw(); });
  db.watchDoc('board', d => { board = d; if (S && (S.phase === 'leaders' || S.phase === 'final')) draw(); });
}
boot();
