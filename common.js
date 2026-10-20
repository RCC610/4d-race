// Shared by the big screen (host.html) and the phone page (index.html).
// Questions come from the "4D Race: Question Bank" doc. Edit them here.

export const TEAMS = [
  { n: 'Delegation', c: 'var(--t0)', h: '#E0553B', l: '#F3A897' },
  { n: 'Description', c: 'var(--t1)', h: '#4FA3A0', l: '#A9D8D5' },
  { n: 'Discernment', c: 'var(--t2)', h: '#E8B04A', l: '#F6D899' },
  { n: 'Diligence', c: 'var(--t3)', h: '#A5B6B6', l: '#D5DEDE' }
];
export const SW3 = [
  { n: 'Keep it human', short: 'Human', c: 'var(--t1)' },
  { n: 'Do it together', short: 'Together', c: 'var(--t2)' },
  { n: 'Hand it to AI', short: 'AI', c: 'var(--t0)' }
];
export const OKC = [{ n: 'OK', c: '#36A16B' }, { n: 'Not OK', c: '#E5533D' }];

export const RACE = [
  { type: 'swipe', d: 0, title: 'Swipe sort', ins: 'Who should do each task?', T: 30, items: [
    { t: 'Decide who gets promoted', c: 0 }, { t: 'Turn 300 test cases into a clean table', c: 2 }, { t: 'Summarize a 40-page requirements doc', c: 1 }],
    say: 'Promotions stay human. Tables go to AI. Summaries: <b>AI drafts, you check</b>.' },
  { type: 'swipe', d: 0, title: 'Swipe sort', ins: 'Who should do each task?', T: 30, items: [
    { t: 'Write the client apology after an outage', c: 1 }, { t: 'Brainstorm names for the workshop', c: 2 }, { t: 'Approve a change to a customer’s bill', c: 0 }],
    say: 'AI can draft the apology, <b>the relationship is yours</b>. Billing approvals stay human.' },
  { type: 'build', d: 1, title: 'Build the prompt', ins: 'Pick the 3 additions that help this prompt most', T: 35, weak: 'Write an email about the go-live.',
    chips: [{ t: 'Who it’s for: 80,000 customers', ok: 1 }, { t: 'Make it exciting!!!' }, { t: 'The go-live date and what changes for them', ok: 1 }, { t: 'Add “please” and “thank you”' }, { t: 'A past notice to use as an example', ok: 1 }, { t: 'Make it longer' }],
    better: 'Write a go-live notice for 80,000 residential customers. Billing moves to the new system on Tuesday, March 3. Bills will look different, but amounts won’t change. Match the tone of the attached past notice.' },
  { type: 'build', d: 1, title: 'Build the prompt', ins: 'Pick the 3 additions that help this prompt most', T: 35, weak: 'Summarize this contract.',
    chips: [{ t: 'What you’ll use the summary for', ok: 1 }, { t: 'Tell it it’s the best AI ever' }, { t: 'The format: 5 plain-language bullets', ok: 1 }, { t: 'Use ALL CAPS so it pays attention' }, { t: 'Ask it to flag risky clauses and quote them', ok: 1 }, { t: 'Say it’s urgent' }],
    better: 'Summarize this vendor contract for our project lead, who decides this week whether to sign. Use 5 plain-language bullets, then list any risky clauses with the exact quote.' },
  { type: 'pen', d: 2, title: 'Red Pen', ins: 'Tap anything wrong in this AI answer', T: 40, ask: 'Where are we on go-live?', segs: [
    { t: 'Go-live is set for Tuesday, March 3.' }, { t: 'A 2024 industry study found 92% of utilities finish go-live early.', bad: 'Made-up source' },
    { t: 'Cutover starts Friday at 6 PM.' }, { t: 'Final data validation is optional for smaller utilities, so we skipped it.', bad: 'Wrong and risky' }] },
  { type: 'pen', d: 2, title: 'Red Pen', ins: 'Tap anything wrong in this AI answer', T: 40, ask: 'Summarize today’s design review.', segs: [
    { t: 'Cutover moves to the weekend of the 14th.' }, { t: 'Priya owns the rate mapping, due Friday.' }, { t: 'Sam seemed unprepared and frustrated.', bad: 'Personal judgment' },
    { t: 'The client approved the Phase 2 budget.', bad: 'Nobody said this' }, { t: 'Next meeting: Thursday at 10 AM.' }] },
  { type: 'ok', d: 3, title: 'OK or Not OK', ins: 'Quick calls: is this OK?', T: 30, items: [
    { t: 'Drafting a status report with an approved AI tool', ok: 1 }, { t: 'Pasting customer records into a public chatbot', ok: 0 },
    { t: 'Telling the client AI helped draft the report', ok: 1 }, { t: 'Letting AI email the client without review', ok: 0 }] },
  { type: 'ok', d: 3, title: 'OK or Not OK', ins: 'Quick calls: is this OK?', T: 30, items: [
    { t: 'Sending a deliverable that still says “As an AI language model”', ok: 0 }, { t: 'Checking AI’s numbers against the source before sharing', ok: 1 },
    { t: 'Using AI to write a colleague’s review without reading it', ok: 0 }, { t: 'Asking for a source when AI gives a stat with none', ok: 1 }] }
];

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Empty answer for a round. Arrays so they store cleanly in Firestore.
export function blank(R) { return R.type === 'swipe' ? [-1, -1, -1] : R.type === 'ok' ? R.items.map(() => -1) : []; }

// Score 0..1 for one player's answer v.
export function score(R, v) {
  if (!Array.isArray(v)) return 0;
  if (R.type === 'swipe') return v.filter((x, k) => x === R.items[k].c).length / R.items.length;
  if (R.type === 'build') return v.slice(0, 3).filter(k => R.chips[k] && R.chips[k].ok).length / 3;
  if (R.type === 'pen') { let f = 0, x = 0; v.forEach(k => R.segs[k] && (R.segs[k].bad ? f++ : x++)); return clamp((f - .5 * x) / R.segs.filter(g => g.bad).length, 0, 1); }
  return v.filter((x, k) => x === (R.items[k].ok ? 0 : 1)).length / R.items.length;
}

// Tally everyone's answers for the big-screen bars.
export function tally(R, answers) {
  let a;
  if (R.type === 'swipe') a = R.items.map(() => [0, 0, 0]);
  if (R.type === 'ok') a = R.items.map(() => [0, 0]);
  if (R.type === 'build') a = R.chips.map(() => 0);
  if (R.type === 'pen') a = R.segs.map(() => 0);
  answers.forEach(x => {
    const v = x.v || [];
    if (R.type === 'swipe' || R.type === 'ok') v.forEach((c, k) => { if (c >= 0 && a[k]) a[k][c]++; });
    else v.forEach(k => { if (a[k] !== undefined) a[k]++; });
  });
  return a;
}

export const resultLabel = sc => sc === 100 ? 'Perfect!' : sc >= 67 ? 'Nice!' : sc > 0 ? 'Partly right' : 'Not quite';

export function bolt(pose) {
  return `<div class="bolt ${pose || ''}"><div class="bl-shadow"></div><div class="bl">
   <div class="bl-ant"><svg class="bl-zap" viewBox="0 0 44 60"><polygon points="30,2 10,34 22,34 14,58 34,26 22,26 32,2" fill="#FFD23F" stroke="#2A1714" stroke-width="3.5" stroke-linejoin="round"/></svg></div>
   <div class="bl-arm l"></div><div class="bl-arm r"></div><div class="bl-foot l"></div><div class="bl-foot r"></div>
   <div class="bl-body"><div class="bl-belly"><span>R</span></div></div>
   <div class="bl-head"><span class="bl-ear l"></span><span class="bl-ear r"></span>
    <div class="bl-visor"><span class="bl-eye l"></span><span class="bl-eye r"></span><span class="bl-happy l"></span><span class="bl-happy r"></span>
     <span class="bl-lid l"></span><span class="bl-lid r"></span><span class="bl-blush l"></span><span class="bl-blush r"></span><span class="bl-mouth"></span></div></div></div></div>`;
}
