// SPDX-License-Identifier: MIT — Copyright (c) 2026 Paul Richeson
//
// The feature guide, played. Starts a new run of play.html in headless Chromium,
// plays it the way a player would (origin, the courier, Birka, a skill check, the
// board, the map, a road, Hunt Mode, fights, an inn, a level, a death if one comes),
// rings what each step is about, and writes docs/FEATURE_GUIDE.md with what was on
// the screen when it ran.
//
//   node src/tools/feature-guide.mjs     → docs/FEATURE_GUIDE.md, docs/features/*.png
//
// Zero dependencies: Node's own http server serves the repo read-only, and the
// browser is driven over the DevTools protocol. Needs `chromium` on PATH. The run
// uses a throwaway browser profile, so its saves never touch yours.
// Flags: --port 8150 (the browser's debugging port is port+1)   --grind 360 (seconds)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const PORT = Number(arg('port', 8150)), CDP = PORT + 1, BASE = `http://127.0.0.1:${PORT}`;
const GRIND_S = Number(arg('grind', 360));
const OUT = path.join(ROOT, 'docs'), SHOTS = path.join(OUT, 'features');
const W = 1440, H = 900;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...a) => console.log(...a);
const BOX = fs.mkdtempSync(path.join(os.tmpdir(), 'coc-features-'));

// ── the repo, served read-only ───────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || path.basename(file).startsWith('._') || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// ── browser plumbing ─────────────────────────────────────────────────────────
let ws, seq = 0; const pending = new Map(), pageErrors = [];
const send = (method, params = {}) => new Promise((res) => { const i = ++seq; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) throw new Error('page: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text).slice(0, 300) + '\n  in: ' + expr.slice(0, 160));
  return r.result?.result?.value;
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch { /* not yet */ } await sleep(200); } return false; };
const need = async (expr, what, ms = 30000) => { if (!(await waitFor(expr, ms))) throw new Error(`timed out waiting for: ${what}`); };
const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const btn = (root, text) => `[...document.querySelectorAll(${JSON.stringify(root + ' button')})].find(b=>b.offsetParent!==null&&b.textContent.trim()===${JSON.stringify(text)})`;
const btnHas = (root, text) => `[...document.querySelectorAll(${JSON.stringify(root + ' button')})].find(b=>b.offsetParent!==null&&b.textContent.includes(${JSON.stringify(text)}))`;
const click = async (expr) => { if (!(await ev(`(()=>{const e=${expr}; if(!e)return false; e.click(); return true;})()`))) throw new Error(`nothing to click: ${expr.slice(0, 120)}`); };
const vis = (id) => `!!(document.getElementById(${JSON.stringify(id)})&&document.getElementById(${JSON.stringify(id)}).classList.contains('visible'))`;
const text = (expr) => ev(`(()=>{const e=${expr}; return e?e.innerText.trim():'';})()`);

const OVERLAY = `
window.__clear=()=>document.querySelectorAll('.__g').forEach(e=>e.remove());
window.__mark=(items)=>{
  __clear(); const vw=innerWidth, vh=innerHeight, found=[], rings=[], caps=[];
  const over=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  items.forEach(([el])=>{
    if(!el){found.push(false);rings.push(null);return;} found.push(true);
    const r=el.getBoundingClientRect();
    const x=Math.max(4,r.left-4), y=Math.max(4,r.top-4), w=Math.min(vw-8-x,r.width+8), h=Math.min(vh-8-y,r.height+8);
    const ring=document.createElement('div'); ring.className='__g';
    ring.style.cssText='position:fixed;z-index:2147483646;pointer-events:none;border:3px solid #0d6eaa;border-radius:4px;box-shadow:0 0 0 2px #fff;left:'+x+'px;top:'+y+'px;width:'+w+'px;height:'+h+'px';
    document.body.appendChild(ring); rings.push({x,y,w,h});
  });
  items.forEach(([el,text],i)=>{
    const g=rings[i]; if(!g)return;
    const cap=document.createElement('div'); cap.className='__g';
    const n=document.createElement('b'); n.textContent=String(i+1);
    n.style.cssText='display:inline-block;background:#fff;color:#0d6eaa;border-radius:50%;width:20px;height:20px;line-height:20px;text-align:center;margin-right:7px';
    cap.appendChild(n); cap.appendChild(document.createTextNode(text));
    cap.style.cssText='position:fixed;z-index:2147483647;pointer-events:none;max-width:360px;background:#0d6eaa;color:#fff;font:600 13px/1.35 system-ui,sans-serif;padding:6px 10px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.45);left:0;top:0';
    document.body.appendChild(cap);
    const c=cap.getBoundingClientRect(), cw=c.width, chh=c.height, m=8;
    const spots=[[g.x,g.y+g.h+m],[g.x+g.w-cw,g.y+g.h+m],[g.x,g.y-chh-m],[g.x+g.w-cw,g.y-chh-m],[g.x+g.w+m,g.y],[g.x-cw-m,g.y],
      [g.x+g.w-cw-m,g.y+g.h-chh-m],[g.x+g.w-cw-m,g.y+m],[g.x+m,g.y+g.h-chh-m]];
    let best=null;
    spots.forEach(([sx,sy],k)=>{
      const fits=sx>=4&&sy>=4&&sx+cw<=vw-4&&sy+chh<=vh-4;
      const x=Math.min(Math.max(4,sx),vw-cw-4), y=Math.min(Math.max(4,sy),vh-chh-4), box={x,y,w:cw,h:chh};
      const cost=rings.reduce((a,r,j)=>a+(r?over(box,r)*(j===i?(k>=6?0.02:1):3):0),0)+caps.reduce((a,r)=>a+over(box,r)*10,0)+(fits?0:500)+k;
      if(!best||cost<best.cost)best={x,y,cost};
    });
    cap.style.left=best.x+'px'; cap.style.top=best.y+'px'; caps.push({x:best.x,y:best.y,w:cw,h:chh});
  });
  return found;
};`;

// ── the guide being written ──────────────────────────────────────────────────
const parts = [];
let S = null, shotK = 0;
const section = (title, why, fits) => { S = { title, why, fits, items: [] }; parts.push(S); say(`\n${parts.length}. ${title}`); return S; };
const p = (t, into = S) => into.items.push({ type: 'p', text: t });
const table = (head, rows, into = S) => into.items.push({ type: 'table', head, rows });
const check = (items, into = S) => into.items.push({ type: 'check', items });
async function shot(name, caption, marks = [], { scroll = true, into = S } = {}) {
  if (scroll && marks[0]) await ev(`(()=>{const e=${marks[0][0]}; if(e)e.scrollIntoView({block:'center',inline:'nearest'});})()`);
  await sleep(450);
  const found = await ev(`__mark([${marks.map(([e, t]) => `[(()=>{try{return ${e}}catch(_){return null}})(),${JSON.stringify(t)}]`).join(',')}])`);
  (found || []).forEach((ok, i) => { if (!ok) say(`   ! nothing to ring for caption ${i + 1} of ${name}: ${marks[i][1]}`); });
  await sleep(150);
  const tmp = `tmp-${String(++shotK).padStart(2, '0')}-${name}.png`;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SHOTS, tmp), Buffer.from(r.result.data, 'base64'));
  await ev('__clear()');
  into.items.push({ type: 'shot', tmp, name, caption, marks: marks.filter((_, i) => found?.[i]).map((m) => m[1]) });
  say(`   ${name}`);
}
const reuse = (file, caption, into = S) => into.items.push({ type: 'reuse', file, caption });

// Close whatever story modal the walk has opened (a journal entry found, an NPC
// card), so the tour can carry on. Returns the ids it closed.
async function dismissStray() {
  return ev(`(()=>{
    const keep=new Set(['story-panel','story-battle-overlay','story-victory-overlay','story-levelup-modal','story-gameover-modal','story-sleep-overlay']);
    const open=[...document.querySelectorAll('.visible')].filter(e=>e.id&&!keep.has(e.id));
    const closed=[];
    for(const m of open){
      const b=[...m.querySelectorAll('button')].find(b=>b.offsetParent!==null&&/continue|close|ok|got it|back|done|→|✕/i.test(b.textContent));
      if(b) b.click(); else m.classList.remove('visible');
      closed.push(m.id);
    }
    return closed;
  })()`);
}

// ── run ──────────────────────────────────────────────────────────────────────
let chrome;
const stop = () => { try { chrome?.kill(); } catch {} try { server.close(); } catch {} try { fs.rmSync(BOX, { recursive: true, force: true }); } catch {} };
process.on('SIGINT', () => { stop(); process.exit(130); });

try {
  await new Promise((r, j) => { server.once('error', j); server.listen(PORT, '127.0.0.1', r); });
  fs.rmSync(SHOTS, { recursive: true, force: true }); fs.mkdirSync(SHOTS, { recursive: true });
  chrome = spawn('chromium', ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${CDP}`, `--window-size=${W},${H}`, `--user-data-dir=${path.join(BOX, 'chrome')}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 80; i++) { await sleep(250); try { targets = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch {} }
  ws = new WebSocket((targets.find((t) => t.type === 'page' && t.url === 'about:blank') || targets.find((t) => t.type === 'page')).webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => { const j = JSON.parse(m.data);
    if (j.id && pending.has(j.id)) { pending.get(j.id)(j); pending.delete(j.id); }
    if (j.method === 'Runtime.exceptionThrown') pageErrors.push((j.params.exceptionDetails.exception?.description || j.params.exceptionDetails.text).slice(0, 200)); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const open = async () => {
    await send('Page.navigate', { url: `${BASE}/play.html` });
    await need(`typeof S_story==='object'&&typeof storyNewGame==='function'&&!!document.getElementById('story-panel')`, 'the game to load', 60000);
    await sleep(1500); await ev(OVERLAY);
  };
  const lines = fs.readFileSync(path.join(ROOT, 'play.html'), 'utf8').split('\n').length;
  const today = new Date().toISOString().slice(0, 10);

  // A first visit has no save and drops straight into Birka; the autosave it writes
  // is what makes the second visit open on the choice below.
  await open();
  const firstScores = await ev(`JSON.stringify(S_story.abilityScores)`);
  await send('Page.reload'); await sleep(500);
  await need(`typeof S_story==='object'&&${vis('story-continue-modal')}`, 'the Continue / New Game choice', 60000);
  await sleep(1200); await ev(OVERLAY);

  // ═══ 1. Opening the file ═══════════════════════════════════════════════════
  section('Opening the file: one page, no install',
    'The whole game is meant to be carried around: emailed, put on a USB stick, served from any static host. So there is nothing to install and no account; the browser is the machine and its `localStorage` is the save slot.',
    'Everything in this guide happens inside this one page. The save it reads here is the same one every later part writes to.');
  p(`\`play.html\` is ${lines.toLocaleString('en-US')} lines of HTML, CSS and JavaScript: combat engine, world map, NPC dialogue, quests and saves. Open it from disk or from <https://vonglurt.github.io/codexofconquest/>. The very first visit has no save, so it starts at once in Birka with the plain sheet (${firstScores.replace(/[{}"]/g, '').replace(/,/g, ', ').replace(/:/g, ' ')}). From then on it opens on this choice.`);
  const contSub = await text(q('#continue-sub'));
  await shot('continue', 'The second visit: continue the run, or start a new one.', [
    [q('#continue-sub'), `What the save holds: ${contSub}.`],
    [q('#btn-continue-load'), 'Continue Journey loads the autosave.'],
    [q('#btn-continue-new'), 'New Game goes to character creation.'],
  ], { scroll: false });

  // ═══ 2. Origin ═════════════════════════════════════════════════════════════
  section('Character creation: an origin and a 27-point budget',
    'The tabletop rules are the point of the game, and they start here. Point-buy shows every cost before you pay it, so the sheet you carry for 49 days is one you chose with your eyes open.',
    'Every roll later in the game adds one of these six modifiers. Constitution also sets your hit points (a level 1 Fighter has 10 + CON modifier), and the starting scores are kept as the first tattoo, "Origin".');
  await click(q('#btn-continue-new'));
  await need(vis('story-charcreate-modal'), 'the origin screen');
  await click(q('#cc-std-array'));
  await sleep(300);
  const cc = await ev(`({left:document.getElementById('cc-pts-left').textContent, cost:[...document.querySelectorAll('#story-charcreate-modal *')].map(e=>e.childElementCount===0?e.textContent:'').find(t=>t.includes('costs:'))||''})`);
  p('You play one Human Fighter Champion, level 1 to 20. **Custom Build** spends a 27-point budget, each score between 8 and 15; **Hard Mode** starts at STR 10 and 8 in everything else. The **Standard Array** button fills in 15 · 14 · 13 · 12 · 10 · 8, ordered for a fighter, and the steppers stay live. The tour took the array.');
  await shot('origin', 'Choose Your Origin, with the Standard Array spent.', [
    [q('#charcreate-tabs'), 'Custom Build or Hard Mode.'],
    [q('#cc-std-array'), 'The classic array in one click.'],
    [q('#cc-stat-grid'), `Each score with its modifier, live. ${cc.left} points left.`],
    [q('#btn-charcreate-begin'), 'Begin Journey starts the run.'],
  ], { scroll: false });
  if (cc.cost) p(`The price list is printed under the grid: *${cc.cost.trim()}*.`);
  await click(q('#btn-charcreate-begin'));
  await need(vis('story-courier-modal'), "the courier's map");
  const goals = await ev(`[...document.querySelectorAll('#courier-body li, #courier-body div')].map(e=>e.innerText.trim()).filter(t=>t&&t.length<200)`);
  p('Then the opening frame: a dying courier presses a bloodstained map into your hand and says one word, *"Sweelinck."* The card states the goal of the whole game in four lines.');
  await shot('courier', 'A Map Pressed Into Your Hand: the goal, stated once.', [
    [q('#courier-body'), 'Seven Codex Shards, level 20, Commander Auros at the Codex. And: take the time you need.'],
    [q('#btn-courier-begin'), 'Take the Map.'],
  ], { scroll: false });
  if (goals?.length) table(['The courier\'s goals'], goals.slice(0, 4).map((g) => [g]));
  check(['Which of your six scores will your attacks add?', 'What is your hit point maximum at level 1, and why?']);
  await click(q('#btn-courier-begin'));
  await sleep(800);

  // ═══ 3. The screen ═════════════════════════════════════════════════════════
  section('Birka: reading the screen',
    'A MUD describes the world instead of drawing it. The screen keeps the description in the middle and puts everything you would otherwise have to remember (HP, gold, the day, where the exits go, what the last roll was) around it.',
    'Each later part is one of these regions in use: the tabs open the bag, quests, map, journal and sheet; the compass walks; the combat log records every roll.');
  await ev(`switchSheet('sheet-story'); document.getElementById('sheet-story').scrollTop=0`);
  await sleep(500);
  const status = await ev(`({hp:S_story.hp+'/'+S_story.hpMax, gold:S_story.gold, day:S_story.day, loc:NODE_MAP[S_story.currentCode].label})`);
  p(`The run begins at **${status.loc}**, Act I, day ${status.day} of 49, with ${status.hp} HP and ${status.gold} gp. The starting kit is a Pointy Stick in the main hand, a Flint Dagger in the off hand, a Rusted Dagger and two Minor Healing Potions in the pack, and the courier's map.`);
  await shot('screen', 'The story screen in Birka.', [
    [q('#story-left'), 'You: HP, level and XP, what you hold, gold, the day, rests left.'],
    [q('#story-location-hd-card'), 'Where you are, the act, the seven Shard slots, level and day.'],
    [q('#story-sheet-tab-bar'), 'Story, Bag (I), Quests (Q), Map (M), Journal (J), Char.'],
    [q('#btn-N') + '.parentElement', 'The compass: one cell per press. WP travels to a waypoint; the target toggles Hunt Mode.'],
    [q('#bot-world'), 'Local, world and globe maps, always on.'],
    [q('#bot-exits'), 'Exits: where each direction leads.'],
    [q('#story-bottom-log'), 'The combat log: every roll, with its sum.'],
  ], { scroll: false });
  check(['Where is the day counter, and what is the last day?', 'Which tab holds the quests, and what is its key?']);

  // ═══ 4. People ═════════════════════════════════════════════════════════════
  section('People: talk, and favour',
    'The story is carried by people, not cut-scenes, and the ending notices whom you befriended. Favour is how the game remembers that you chose a person over efficiency.',
    'Favour changes what an NPC says, and the friends you keep are named at the end. Many NPCs also give quests, and some sell.');
  const npcCard = `document.querySelector('#story-npc-cards-row').firstElementChild`;
  const npcName = (await text(`${npcCard}.firstElementChild`)).split('\n')[0];
  const talkMax = await ev('TALK_TO_FRIENDLY');
  await shot('npc', `${npcName}, the first person you meet.`, [
    [`[...document.querySelectorAll('#story-npc-cards-row *')].find(e=>e.childElementCount===0&&/Impartial|Friendly|Quest Active/.test(e.textContent))`, 'Where you stand with her: Impartial, to start.'],
    [`[...document.querySelectorAll('#story-npc-cards-row .npc-talk-btn')][0]`, `Talk. ${talkMax} deliberate talks, on different days, make her Friendly.`],
  ]);
  p(`Her first speech is the game's own tutorial, in character: check the MAP, open the QUEST LOG, sleep at an inn before you are desperate, read the Warrant's Board, and go north to the Fisherman at the lake. The game has 204 NPC profiles (the landing page's count), each with lines for Impartial, Friendly and Dear Friend.`);
  await click(`[...document.querySelectorAll('#story-npc-cards-row .npc-talk-btn')][0]`);
  await sleep(700);
  const talkLabel = await text(`[...document.querySelectorAll('#story-npc-cards-row .npc-talk-btn')][0]`);
  if (talkLabel) p(`After one talk the button reads **${talkLabel}**.`);

  // ═══ 5. Skill checks ═══════════════════════════════════════════════════════
  section('Skill checks, rolled in the open',
    'A tabletop game master says the roll out loud: the die, the modifier, the target. The game does the same, and gives you the odds before you commit, so a failure is a risk you took, not a trick.',
    'The same d20 plus modifier against a number runs attacks, skill checks and saving throws. Checks pay XP, and the ROLL rows sit beside the quests that use them.');
  await ev(`switchSheet('sheet-story')`); await sleep(300);
  const rollBtn = btn('#sheet-story', 'Roll Ceremonia');
  await click(rollBtn); await sleep(800);
  const odds = await ev(`(()=>{const e=[...document.querySelectorAll('#sheet-story *')].find(e=>e.offsetParent&&/to pass/.test(e.textContent)&&e.childElementCount<12&&e.textContent.length<160); return e?e.textContent.replace(/\\s+/g,' ').trim():''})()`);
  await shot('check', 'A skill check, opened.', [
    [`[...document.querySelectorAll('#sheet-story *')].find(e=>e.offsetParent&&/to pass/.test(e.textContent)&&e.childElementCount<12&&e.textContent.length<160)`, 'The skill, the modifier and where it comes from, the DC, and the chance to pass.'],
    [btnHas('#sheet-story', 'Roll Ceremonia —'), 'Roll Ceremonia: commit.'],
  ]);
  if (odds) p(`On the screen: \`${odds}\`.`);
  const xp0 = await ev('S_story.xp');
  await click(btnHas('#sheet-story', 'Roll Ceremonia —'));
  await sleep(2200);
  const xp1 = await ev('S_story.xp');
  const rollLog = await text(`document.querySelector('#story-hcard-container').firstElementChild`);
  await ev(`document.querySelector('#story-hcard-container').scrollLeft=0`);
  await shot('check-result', 'The result, written into the combat log.', [
    [`document.querySelector('#story-hcard-container').firstElementChild`, 'd20, plus skill, plus proficiency, against the DC.'],
    [q('#story-left'), `XP went from ${xp0} to ${xp1}.`],
  ], { scroll: false });
  if (rollLog) p(`The log card read: \`${rollLog.split('\n').slice(0, 4).join(' · ')}\`.`);
  check(['Before rolling, what were the odds, and where did the modifier come from?', 'What did the check pay, pass or fail?']);

  // ═══ 6. Quests and the board ═══════════════════════════════════════════════
  section("Quests and the Warrant's Board",
    'Quests are how the world tells you what matters. There are 2,853 of them (the landing page\'s count), so the game needs a log that says the next step, a way to walk there, and a board where optional work is posted.',
    'Quests are data, not code: each names where it starts, what completes it (often just arriving), and what it pays. Mission bits record what you have done, and later quests and dialogue read them. No quest ever blocks a road.');
  await ev(`storyQuestToggle()`); await need(`!!document.querySelector('#sheet-quests')&&document.querySelector('#sheet-quests').offsetParent!==null`, 'the quest log');
  await sleep(600);
  const questCount = await ev(`document.querySelectorAll('#sheet-quests .quest-card, #sheet-quests [class*=quest-item]').length`);
  await shot('quests', 'The quest log (Q).', [
    [`[...document.querySelectorAll('#sheet-quests *')].find(e=>e.childElementCount===0&&/Follow the Bloodstained Map/.test(e.textContent))`, 'MAIN: the courier\'s trail. The first step is a person in Tilbury.'],
    [`[...document.querySelectorAll('#sheet-quests button, #sheet-quests a')].find(b=>/Navigate/.test(b.textContent))`, 'Navigate sets a waypoint and starts walking there.'],
    [`[...document.querySelectorAll('#sheet-quests *')].filter(e=>e.childElementCount===0&&/^SIDE$/.test(e.textContent.trim()))[0]`, 'SIDE quests: the slums, the first fights, the first levels.'],
  ], { scroll: false });
  if (questCount) p(`The log listed ${questCount} entries on day 1.`);
  await ev(`switchSheet('sheet-story')`); await sleep(400);
  const firstBounty = (await text(`document.querySelector('#story-board-section')`)).split('\n').find((l) => /^📜 /.test(l) && !/BOARD/.test(l)) || '';
  await shot('board', "The Warrant's Board, in the story view.", [
    [`[...document.querySelectorAll('#story-board-section *')].find(e=>e.childElementCount===0&&/WARRANT'S BOARD/i.test(e.textContent))`, "Bounties posted by the Crimson Warrant at inns and rest nodes."],
    [btn('#story-board-section', 'Take'), 'Take one, and it joins the log, with how many legs away it is and what it pays.'],
  ]);
  if (firstBounty) p(`The first posting that morning was *${firstBounty.replace(/^📜\s*/, '')}*.`);

  // ═══ 7. Map and walking ════════════════════════════════════════════════════
  section('The map, and walking',
    'Movement is a system, not a menu. Distance costs time against a 49-day clock, and terrain decides what you meet, so the map has to show where you are, what is around you, and how far it is.',
    'Every location is a cell on one grid; named places sit on cells and the wilderness fills the rest. Free movement is a rule of the game: a quest, a flag or an item never closes a road.');
  await ev(`switchSheet('sheet-story'); storyMapToggle ? storyMapToggle() : document.querySelector('#story-sheet-tab-bar .sheet-tab[data-sheet="sheet-map"]').click()`).catch(async () => { await click(`document.querySelector('#story-sheet-tab-bar .sheet-tab[data-sheet="sheet-map"]')`); });
  await need(`!!document.querySelector('#sheet-map')&&document.querySelector('#sheet-map').offsetParent!==null`, 'the map tab');
  await sleep(3000);
  const here = `([...document.querySelectorAll('#sheet-map *')].filter(e=>e.childElementCount===0&&e.textContent.trim()===S_story.currentCode&&e.offsetParent!==null).map(e=>e.parentElement).find(t=>{const r=t.getBoundingClientRect(); return r.width>20&&r.top>80&&r.bottom<innerHeight-180;})||null)`;
  const mapTabs = `(()=>{let e=[...document.querySelectorAll('#sheet-map *')].find(e=>e.childElementCount===0&&/local/i.test(e.textContent.trim())&&e.textContent.trim().length<12); while(e&&!/lists/i.test(e.textContent))e=e.parentElement; return e;})()`;
  await shot('map', 'The map (M), local view.', [
    [here, 'You are here: the cell with your location\'s code.'],
    [mapTabs, 'Local, World, Full, Multiplayer, Discover, Lists.'],
    [`[...document.querySelectorAll('#sheet-map *')].find(e=>e.childElementCount===0&&/Click any tile to travel/.test(e.textContent))`, 'Click any tile and the game walks you there along the roads.'],
  ]);
  await ev(`switchSheet('sheet-story')`); await sleep(400);
  const exitsW = await text(q('#bot-exits'));
  await click(q('#btn-W')); await sleep(1500);
  if (await ev(vis('story-battle-overlay'))) say('   (an encounter on the first step; the road picture is skipped)');
  else {
    const road = await ev(`({pos:JSON.stringify(_playerPos()), title:(document.getElementById('story-location-hd-card')||{}).innerText||''})`);
    await ev(`document.getElementById('sheet-story').scrollTop=0`);
    await shot('road', 'One step west of the city: a road cell.', [
      [q('#story-text-box'), 'Between named places the room is described from the terrain, with signposts toward the next town.'],
      [q('#story-mini-map'), 'The local map follows you, one cell at a time.'],
      [q('#bot-exits'), 'Exits from this cell.'],
    ], { scroll: false });
    p(`The first exit list in Birka read: ${exitsW.split('\n').filter(Boolean).slice(0, 3).join(' · ')}. One press of W later the player stood at grid cell ${road.pos.replace(/[{}"]/g, '')}.`);
  }
  p('Roads and junctions have an encounter rate of zero. Off the road, each step rolls against the terrain\'s rate, and **Hunt Mode** (the target in the compass) roughly doubles it, favouring monsters at or below your level. Tougher foes can still find you. Later, after a night at the inn, the tour turns it on and walks off the road.');
  check(['Name two ways to travel to a far place without pressing a direction each time.', 'Why can walking on a road never start a fight?']);
  // ── playing: one tick at a time ────────────────────────────────────────────

  // The fight section is filled from here on, but placed after the inn.
  const fightS = { title: 'Combat: the d20, shown', items: [],
    why: 'Combat is where the tabletop rules matter most, so it hides nothing: armour class, attack bonus, damage dice, initiative and every roll are on the screen, and the log says the sum.',
    fits: 'Wins pay XP, gold and drops into the bag; XP brings levels; a loss brings death saves. Battle XP is the foe\'s armour class times its hit points, and even a miss earns a little "effort" XP.' };
  const seen = { battle: false, attack: false, victory: false, levelup: false, deathsave: false, gameover: false, sleep: false };
  const stats = { battles: 0, wins: 0, deaths: 0, potions: 0, shortRests: 0, fled: 0, strays: [] };
  const dirs = ['W', 'N', 'S', 'E', 'N', 'W', 'S', 'E'];
  let step = 0, lastWin = null;
  const levelS = { title: 'Levelling up: roll the hit die yourself', why: 'A level is the reward for everything above, so the game lets you roll it. The hit die, the feature gained and the sheet it changes are all in front of you.', fits: 'Levels unlock the Fighter Champion features (Action Surge, Second Wind, a wider critical range, extra attacks) up to level 20, and each one is recorded as a tattoo.', items: [] };
  const deathS = { title: 'Dying, and the checkpoint', why: 'Dropping to zero should be dangerous but not abrupt. Death saves give you three chances to crawl away, and a death costs the loose loot you carried, left on a corpse where you fell, which you can walk back to.', fits: 'Three failed saves and you fall. Your gold and bagged loot stay on your body, as a corpse you can walk back to and reclaim; equipped gear and Codex shards stay with you; a "Fallen" tattoo records the day and the place; and you wake at the checkpoint (the last inn you slept at, Birka before that) with 1 HP. Tattoos and the career chronicle outlive every death.', items: [] };

  // One tick of play: answer whatever the screen is asking, else take a step.
  let inFight = false;
  async function tick(phase) {
    const inB = await ev(vis('story-battle-overlay'));
    if (inB && !inFight) stats.battles++;
    inFight = inB;
    if (await ev(vis('story-levelup-modal'))) {
      const lvl = await ev(`(document.getElementById('lu-lvl-num')||{}).textContent||''`);
      if (await ev(`(()=>{const b=document.getElementById('btn-lu-roll-hp'); return !!(b&&b.offsetParent&&!b.disabled)})()`)) { await click(q('#btn-lu-roll-hp')); await sleep(1200); }
      if (await ev(`(()=>{const b=document.getElementById('btn-lu-roll-bonus-hp'); return !!(b&&b.offsetParent&&!b.disabled)})()`)) { await click(q('#btn-lu-roll-bonus-hp')); await sleep(1000); }
      if (!seen.levelup) {
        seen.levelup = true;
        const hpRoll = (await text(q('#lu-hp-roll-result'))).replace(/\s+/g, ' ');
        const feat = await text(q('#lu-feature-name'));
        await shot('level-up', `Level ${lvl}, earned in play.`, [
          [q('#lu-feature-name'), `The feature gained: ${feat}.`],
          [q('#lu-hp-section'), `The hit die, rolled by you: ${hpRoll || 'd10 + CON'}.`],
          [q('#lu-stats-grid'), 'The sheet as it now stands.'],
        ], { scroll: false, into: levelS });
        p(`Reached in the tour after ${stats.wins} win${stats.wins === 1 ? '' : 's'}: level ${lvl}, **${feat}**. ${hpRoll ? `The roll: \`${hpRoll}\`.` : ''}`, levelS);
      }
      for (let i = 0; i < 12 && await ev(`document.getElementById('btn-lu-continue').disabled`); i++) {
        await ev(`(()=>{const b=[...document.querySelectorAll('#lu-asi-btns button')].find(b=>!b.disabled); if(b)b.click();})()`); await sleep(300);
      }
      await click(q('#btn-lu-continue')); await sleep(900);
      return 'levelup';
    }
    if (await ev(vis('story-victory-overlay'))) {
      stats.wins++;
      lastWin = await text(q('#story-victory-overlay'));
      if (!seen.victory && seen.battle) {
        seen.victory = true;
        await shot('victory', 'Victory: what the fight paid.', [
          [`[...document.querySelectorAll('#story-victory-overlay *')].find(e=>e.childElementCount===0&&/XP$/.test(e.textContent.trim())&&/^\\+/.test(e.textContent.trim()))`, 'The XP, and how far to the next level.'],
          [`[...document.querySelectorAll('#story-victory-overlay *')].find(e=>e.childElementCount===0&&/^DROPS$/i.test(e.textContent.trim()))`, 'Drops go straight into the bag.'],
          [q('#btn-svo-return'), 'Back to Quest: back to the map.'],
        ], { scroll: false, into: fightS });
        p(`The banner read: ${lastWin.split('\n').filter(Boolean).slice(0, 7).join(' · ')}.`, fightS);
      }
      await click(q('#btn-svo-return')); await sleep(900);
      return 'win';
    }
    if (await ev(vis('story-gameover-modal'))) {
      stats.deaths++;
      if (!seen.gameover) {
        seen.gameover = true;
        const cp = await text(q('#gameover-cp'));
        await shot('fallen', 'You Have Fallen: three failed death saves.', [
          [q('#gameover-cp'), `${cp}: where a respawn puts you.`],
          [q('#gameover-chronicle'), 'This Run: the life just ended, in numbers.'],
          [q('#btn-gameover-respawn'), 'Respawn at Checkpoint, at half HP.'],
        ], { scroll: false, into: deathS });
      }
      await click(q('#btn-gameover-respawn')); await sleep(1200);
      return 'dead';
    }
    if (await ev(vis('story-battle-overlay'))) {
      if (await ev('S_story.hp<=0')) {
        const can = await ev(`(()=>{const b=document.getElementById('btn-sbo-ds-roll'); return !!(b&&b.offsetParent&&!b.disabled)})()`);
        if (can) {
          const bodies = await ev('(S_story.corpsesQuests||[]).length');
          await click(q('#btn-sbo-ds-roll')); await sleep(1600);
          if (await ev('(S_story.corpsesQuests||[]).length') > bodies) {
            stats.deaths++;
            await sleep(1500);
            if (!seen.gameover) {
              seen.gameover = true;
              const fell = `[...document.querySelectorAll('#story-center *')].filter(e=>e.offsetParent&&e.childElementCount<3&&/You fell at/.test(e.textContent)).pop()`;
              await ev(`(()=>{const e=${fell}; if(e)e.scrollIntoView({block:'center'});})()`);
              const msg = await text(fell);
              await shot('fallen', 'Three failures: you fall, and wake at the checkpoint.', [
                [fell, 'Where you fell, what your body carries, what stayed with you, and where you woke.'],
                [q('#story-left'), '1 HP, and no gold: it is on the body.'],
              ], { scroll: false, into: deathS });
              if (msg) p(`The message read: *${msg.replace(/\s+/g, ' ').trim()}*`, deathS);
              if (/fell at null/.test(msg)) p('> **A bug, seen in passing.** The place reads `null` because this fight was a wilderness encounter, which has no node; the message (and the corpse\'s record) take the name from the battle\'s node.', deathS);
            }
            return 'dead';
          }
          if (!seen.deathsave && await ev(`S_story.hp<=0&&${vis('story-battle-overlay')}`)) {
            seen.deathsave = true;
            const foe = await ev('S.enemy.name');
            await shot('death-saves', `Dying, in a fight with: ${foe}.`, [
              [`[...document.querySelectorAll('#story-battle-overlay *')].find(e=>e.childElementCount===0&&/Death Saving Throws/i.test(e.textContent))`, 'Roll a d20: 10 or more succeeds. Three successes and you crawl away; three failures and you fall.'],
              [q('#btn-sbo-ds-roll'), 'Each save is a button you press.'],
              [q('#sbo-log'), 'The blow that dropped you, in the log.'],
            ], { scroll: false, into: deathS });
          }
        } else await sleep(800);
        return 'dying';
      }
      if (await ev(`S_story.battleTurn==='player'`)) {
        const drank = await ev(`(()=>{if(S_story.hp>S_story.hpMax*0.35)return false; const b=[...document.querySelectorAll('#story-battle-overlay .sbo-btn-potion')].find(b=>b.offsetParent&&!b.disabled); if(!b)return false; b.click(); return true;})()`);
        if (drank) { stats.potions++; await sleep(900); }
        if (await ev(`!document.getElementById('btn-sbo-attack').disabled`)) await click(q('#btn-sbo-attack'));
        else if (phase === 'travel' && await ev(`!document.getElementById('btn-sbo-flee').disabled&&S.opp.hp>0`)) { await click(q('#btn-sbo-flee')); stats.fled++; }
        else if (await ev(`!document.getElementById('btn-sbo-wimper').disabled`)) await click(q('#btn-sbo-wimper'));
      }
      await sleep(1400);
      return 'fight';
    }
    const strays = await dismissStray();
    if (strays?.length) { stats.strays.push(...strays); await sleep(600); return 'stray'; }
    if (await ev(`S_story.hp<S_story.hpMax*0.5&&(S_story.shortRests||0)>0&&!_travelActive()`)) {
      const ok = await ev(`(()=>{switchSheet('sheet-story'); const b=[...document.querySelectorAll('#sheet-story button')].find(b=>b.offsetParent&&b.textContent.trim()==='Short Rest'&&!b.disabled); if(!b)return false; b.click(); return true;})()`);
      if (ok) { stats.shortRests++; await sleep(1200); return 'rest'; }
    }
    if (phase === 'travel') return 'idle';
    const d = dirs[(step++) % dirs.length];
    await ev(`(()=>{const b=document.getElementById('btn-${d}'); if(b&&!b.disabled)b.click();})()`);
    await sleep(700);
    return 'walk';
  }

  // ═══ 8. Rest ═══════════════════════════════════════════════════════════════
  section('Resting: the clock, and the inn',
    'Forty-nine days is the budget, and sleep is what spends it. Resting is where the game makes you weigh healing against time, and the inn is where it saves your place.',
    'A long rest at an inn heals, resets the three short rests, advances the day, and writes the checkpoint a death returns you to. A short rest costs an hour and rolls a hit die. The Void gains only while you sleep.');
  await ev(`if(S_story.huntMode) storyToggleHunt()`);
  for (let i = 0; i < 6 && (await tick('travel')) !== 'idle'; i++);
  await ev(`switchSheet('sheet-story')`); await sleep(300);
  const restRow = `${btn('#sheet-story', 'Waypoint')}`;
  const innHint = (await ev(`(()=>{const e=[...document.querySelectorAll('#sheet-story *')].find(e=>e.childElementCount===0&&/^Nearest Inn/.test(e.textContent.trim())); return e?e.textContent.trim():'';})()`)) || 'Nearest Inn';
  p(`Every place without an inn shows the nearest one in its REST card (*${innHint}*), with a **Waypoint** button; the **WP** key in the compass then walks you there and any key halts it. The captain had named the First Inn in Birka as the hearth, so the tour set its waypoint (the same call the quest log's Navigate makes) and walked, straight after the map: the captain's advice is to sleep before you are desperate. On the road a sensible traveller does not finish every fight, so after its attack the tour took the safe flee, the bonus action that leaves a fight (it still pays a quarter of the XP).`);
  await ev(`storySetWaypoint('TLL')`);
  let dbg = 0, stuck = 0, best = Infinity;
  let t0 = Date.now();
  while (Date.now() - t0 < 240000) {
    const r = await tick('travel');
    if (await ev(`!S_story.waypoint&&S_story.currentCode==='TLL'`)) break;
    if (r === 'idle' && !(await ev('_travelActive()'))) {
      const dist = await ev("_roadGridPath(_playerPos(),'TLL').length");
      if (dist < best) { best = dist; stuck = 0; } else stuck++;
      if (stuck >= 3) { await ev(`(()=>{const d=['S','N','E','W'][${stuck}%4]; const b=document.getElementById('btn-'+d); if(b&&!b.disabled)b.click();})()`); await sleep(700); }
      else if (await ev('!S_story.waypoint')) await ev(`storySetWaypoint('TLL')`); else await click(q('#btn-waypoint'));
    }
    if (++dbg % 20 === 0) say(`   travel: ${await ev(`S_story.currentCode+' '+JSON.stringify(_playerPos())+' hp '+S_story.hp+' wp '+S_story.waypoint+' active '+_travelActive()`)} (${r})`);
    await sleep(500);
  }
  await sleep(800);
  for (let i = 0; i < 4; i++) { const s = await dismissStray(); if (s?.length) { stats.strays.push(...s); await sleep(600); } }
  const restBtn = `[...document.querySelectorAll('#sheet-story .btn-rest')].find(b=>b.offsetParent&&/^Rest/.test(b.textContent.trim()))`;
  if (await ev(`!!(${restBtn})`)) {
    await click(restBtn); await need(vis('story-sleep-overlay'), 'the rest card');
    const sl = await ev(`({hp:document.getElementById('sleep-hp-preview').textContent, cost:document.getElementById('sleep-cost-preview').textContent, day:document.getElementById('sleep-day-preview').textContent, warn:document.getElementById('sleep-warning').textContent.trim()})`);
    await shot('inn', `Resting at ${await ev(`NODE_MAP.TLL.label`)}.`, [
      [q('#sleep-hp-preview'), 'The heal, estimated before you commit. The first night at each inn rolls the die twice.'],
      [q('#sleep-cost-preview'), `The price: ${sl.cost}.`],
      [q('#sleep-day-preview'), `${sl.day}: the clock moves.`],
      [q('#btn-sleep-confirm'), 'Rest and continue: heal, and write the checkpoint.'],
    ], { scroll: false });
    p(`On the card: \`${sl.hp}\` · \`${sl.cost}\` · \`${sl.day}\`${sl.warn ? ` · *${sl.warn}*` : ''}.`);
    if (await ev(`!document.getElementById('btn-sleep-confirm').disabled`) && !/cannot afford/i.test(sl.warn)) {
      await click(q('#btn-sleep-confirm')); await sleep(1500);
      seen.sleep = true;
      const after = await ev(`({hp:S_story.hp+'/'+S_story.hpMax, day:S_story.day, cp:S_story.checkpointNode})`);
      p(`After the night: ${after.hp} HP, day ${after.day}, checkpoint **${after.cp}**.`);
    } else {
      await click(q('#btn-sleep-cancel'));
      p('The tour could not pay for the room, so it stayed up; a short rest is the cheaper option.');
    }
    for (let i = 0; i < 4; i++) { const s = await dismissStray(); if (s?.length) { stats.strays.push(...s); await sleep(600); } }
  } else {
    p('> **Not reached.** The tour did not get to the inn in its time budget (the road to it runs through wilderness, and every encounter halts the walk), so this run has no picture of the long rest. The short rest is shown instead.');
    await ev(`switchSheet('sheet-story')`); await sleep(400);
    const sr = btn('#sheet-story', 'Short Rest');
    if (await ev(`!!(${sr})`)) await shot('short-rest', 'The REST card, wherever there is no inn.', [
      [`[...document.querySelectorAll('#sheet-story *')].find(e=>e.childElementCount===0&&/^Nearest Inn/.test(e.textContent.trim()))?.parentElement?.parentElement`, 'The nearest inn, and how many moves away. Waypoint walks you there.'],
      [`${sr}.parentElement.parentElement`, 'A short rest: one hour, roll a hit die, three per long rest.'],
    ]);
  }
  check(['How many days does a long rest cost, and what does it give back?', 'Where will you wake if you die now?']);

  // ═══ 9. Combat ═════════════════════════════════════════════════════════════
  parts.push(fightS); S = fightS; say(`\n${parts.length}. ${fightS.title}`);
  await ev(`if(!S_story.huntMode) storyToggleHunt()`);
  // Walk until the first encounter, and show it before it is fought.
  t0 = Date.now();
  while (!(await ev(vis('story-battle-overlay'))) && Date.now() - t0 < 120000) await tick('walk');
  if (!(await ev(vis('story-battle-overlay')))) throw new Error('no encounter in two minutes of walking');
  stats.battles++; inFight = true;
  await waitFor(`S_story.battleTurn==='player'||S_story.hp<=0`, 15000);
  const foe = await ev(`({name:S.enemy.name, ac:S.enemy.ac, hp:S.opp.hp, init:(document.querySelector('#story-battle-overlay')||{}).innerText.match(/Init:[^\\n]*/)?.[0]||''})`);
  await shot('battle', `A wild ${foe.name}.`, [
    [`[...document.querySelectorAll('#story-battle-overlay *')].find(e=>e.childElementCount===0&&/^opponent$/i.test(e.textContent.trim())).parentElement`, `The foe, in full: AC ${foe.ac}, attack bonus, damage dice, ${foe.hp} HP.`],
    [`[...document.querySelectorAll('#story-battle-overlay *')].find(e=>e.childElementCount===0&&/^Init:/.test(e.textContent.trim()))`, `Initiative, both rolls: ${foe.init.replace(/^Init:\s*/, '')}.`],
    [`[...document.querySelectorAll('#story-battle-overlay *')].find(e=>e.childElementCount===0&&/or Pass|^Bonus:|resolving/i.test(e.textContent.trim()))?.parentElement`, 'Action points: 1.5 a turn. An attack costs 1; the half is the bonus action.'],
    [q('#btn-sbo-attack') + '.parentElement', 'Attack, Offhand, Flee, Pass. Potions sit below.'],
  ], { scroll: false, into: fightS });
  seen.battle = true;
  p(`The encounter came off the road, ${foe.name} rolled from the terrain's monster list. The game has 398 monsters across 111 terrains (the landing page's counts), with encounter rates per terrain, so walking somewhere you are not ready for is legible before it is fatal.`, fightS);
  if (await waitFor(`S_story.hp>0&&${vis('story-battle-overlay')}&&S_story.battleTurn==='player'&&!document.getElementById('btn-sbo-attack').disabled`, 12000)) {
    await click(q('#btn-sbo-attack')); await sleep(1300);
    const atk = await text(`[...document.querySelectorAll('#sbo-log > *')].find(e=>/YOUR ATTACK/.test(e.textContent))`);
    await shot('attack', 'One attack, and the half action left.', [
      [`[...document.querySelectorAll('#sbo-log > *')].find(e=>/YOUR ATTACK/.test(e.textContent))`, `The roll against the foe's AC: ${atk.replace(/^YOUR ATTACK:\s*/, '')}`],
      [`[...document.querySelectorAll('#story-battle-overlay *')].find(e=>e.childElementCount===0&&/^Bonus:/.test(e.textContent.trim()))`, 'The bonus action: heal, offhand, spell, a safe flee, or pass.'],
    ], { scroll: false, into: fightS });
    p(`A natural 20 is a critical hit and doubles the damage dice; a natural 1 fumbles. The full sum of each roll also goes to the combat log on the story screen.`, fightS);
  }
  t0 = Date.now();
  while (Date.now() - t0 < 120000) { const r = await tick('fight'); if (r === 'win' || r === 'dead' || r === 'levelup') break; if (r === 'walk' || r === 'idle') break; }
  check(['What did the foe need to roll to hit you, and why?', 'What does a missed attack still earn?'], fightS);

  // ═══ 10, 11. Grind: level up and death, live when they come ════════════════
  parts.push(levelS, deathS);
  await ev(`if(!S_story.huntMode) storyToggleHunt()`);
  t0 = Date.now();
  while (Date.now() - t0 < GRIND_S * 1000 && !(seen.levelup && seen.deathsave)) {
    await tick('walk');
  }
  await ev(`if(S_story.huntMode) storyToggleHunt()`);
  for (let i = 0; i < 30; i++) { const r = await tick('travel'); if (r === 'idle') break; }
  say(`   grind: ${stats.battles} battles, ${stats.wins} wins, ${stats.potions} potions, ${stats.shortRests} short rests, ${stats.fled} fled, level ${await ev('S_story.level')}, deaths ${stats.deaths}`);
  if (!seen.levelup) {
    p('> **Reused picture.** The tour did not reach level 2 in its time budget, so this is the README\'s screenshot, made by `src/tools/capture-screens.mjs` from a seeded save.', levelS);
    reuse('../assets/screenshots/07-level-up.png', 'Level up (reused from the README; seeded, not played).', levelS);
  }
  p('Level 2 needs 400 XP and level 20 needs 195,000. The character sheet lists every level\'s feature and the tattoo that marks it, so you can see what is coming.', levelS);
  if (!seen.deathsave) {
    p('> **Reused picture.** The tour did not drop to zero HP in this run, so this is the README\'s screenshot, made by `src/tools/capture-screens.mjs` from a seeded save.', deathS);
    reuse('../assets/screenshots/08-death-saves.png', 'Death saves (reused from the README; seeded, not played).', deathS);
  } else p(`The tour went down ${stats.deaths ? `and fell ${stats.deaths} time${stats.deaths === 1 ? '' : 's'}` : 'and crawled away'}. It plays simply: attack, drink a potion below about a third of its HP, take a short rest after a fight when below half, and flee only while travelling to the inn.`, deathS);
  check(['How many failed death saves end a life?', 'What survives a death, and what is left on the corpse?'], deathS);

  // ═══ 12. Bag and sheet ═════════════════════════════════════════════════════
  section('The bag and the character sheet',
    'A fighter is what he carries and what he has become. The bag sorts things by what they are for; the sheet shows every number a roll uses, so nothing is computed behind your back.',
    'Drops from fights land in the bag; the equipped weapon sets the damage dice in combat; the shard and Void counters are the campaign\'s score; the tattoos are the record that survives death and New Game+.');
  await ev(`storyInventoryToggle()`); await need(`!!document.querySelector('#sheet-inventory')&&document.querySelector('#sheet-inventory').offsetParent!==null`, 'the bag');
  await sleep(700);
  const bagCount = await ev('S_story.inventory.length');
  const leaf = (re, root) => `[...document.querySelectorAll('${root} *')].find(e=>e.childElementCount===0&&${re}.test(e.textContent.trim()))`;
  await shot('bag', `The bag (I), ${bagCount} items after the tour's fights.`, [
    [`${leaf('/SHARDS/i', '#sheet-inventory')}.parentElement.parentElement`, 'Codex Shards found, and how full the Void is.'],
    [`${leaf('/EQUIPPED/i', '#sheet-inventory')}`, 'What you hold, with its dice. Unequip or swap here.'],
    [`${leaf('/^QUEST ITEMS$/i', '#sheet-inventory')}`, 'Everything else, sorted by what it is for; weapons below can be equipped from here.'],
  ], { scroll: false });
  await ev(`storyCharToggle()`); await need(`!!document.getElementById('char-sheet-body')&&document.getElementById('char-sheet-body').offsetParent!==null`, 'the character sheet');
  await sleep(700);
  const sheet = await ev(`({ac:S_story.ac, lvl:S_story.level, luck:([...document.querySelectorAll('#char-sheet-body *')].find(e=>e.childElementCount===0&&/geometric mean/.test(e.textContent))||{}).textContent||''})`);
  await shot('sheet', 'The character sheet.', [
    [`${leaf('/^ABILITY SCORES$/i', '#char-sheet-body')}.parentElement`, 'Six abilities and their modifiers, and Luck, a seventh that is the geometric mean of the six.'],
    [`${leaf('/^PROGRESSION/i', '#char-sheet-body')}`, 'All twenty levels: the feature each gives and the tattoo that records it.'],
    [`${leaf('/^HP$/', '#char-sheet-body')}.parentElement.parentElement`, 'HP, AC, proficiency, attack bonus and how it is made, crit range, XP.'],
  ], { scroll: false });
  if (sheet.luck) p(`Luck on this sheet: \`${sheet.luck.trim()}\`. Further down, the **Chronicle** counts this life and the whole career: kills, deaths, battles, hit rate, damage, exits taken, sleeps.`);
  await ev(`storyCharToggle()`); await sleep(300);

  // ═══ 13. Journal and saves ═════════════════════════════════════════════════
  section('The journal, and the save',
    'The story is told partly by a dead man. Froberger\'s journal is found a page at a time across the world, and a run is long, so the game saves itself after every meaningful action and asks, each time you open it, whether to go on.',
    'Journal entries are found by arriving at places (the First Inn hands you one). The autosave holds the whole state; the checkpoint holds the last night at an inn. Both live in your browser and nothing is uploaded.');
  await ev(`switchSheet('sheet-story'); storyJournalToggle ? storyJournalToggle() : 0`).catch(async () => { await click(`document.querySelector('#story-sheet-tab-bar .sheet-tab[data-sheet="sheet-journal"]')`); });
  if (!(await waitFor(`!!document.querySelector('#sheet-journal')&&document.querySelector('#sheet-journal').offsetParent!==null`, 3000))) await click(`document.querySelector('#story-sheet-tab-bar .sheet-tab[data-sheet="sheet-journal"]')`);
  await sleep(700);
  const jh = (await text(q('#sheet-journal-hd'))).split('\n')[0].replace(/^\W+/, '');
  await shot('journal', "Froberger's Journal (J).", [
    [q('#sheet-journal-hd'), `${jh || 'The journal'}: seventeen entries, found one at a time.`],
    [`[...document.querySelectorAll('#sheet-journal *')].find(e=>e.childElementCount===0&&/not yet found/.test(e.textContent))`, 'The ones still out there.'],
  ], { scroll: false });
  p('In New Game+ you write the next entry, Entry 42, yourself; the journal and the tattoos carry over.');
  const saved = await ev(`(()=>{const a=localStorage.getItem('coc_autosave'), c=localStorage.getItem('coc_checkpoint'); return {a:a?a.length:0, c:c?c.length:0}})()`);
  await send('Page.reload'); await sleep(500);
  await need(`typeof S_story==='object'&&${vis('story-continue-modal')}`, 'the Continue choice after a reload', 60000);
  await sleep(1200); await ev(OVERLAY);
  const sub2 = await text(q('#continue-sub'));
  await shot('saved', 'The same page, reloaded: the run is still there.', [
    [q('#continue-sub'), `${sub2}.`],
    [q('#btn-continue-load'), 'Continue Journey.'],
  ], { scroll: false });
  p(`At that moment the browser held an autosave of ${saved.a.toLocaleString('en-US')} characters (\`coc_autosave\`)${saved.c ? ` and a checkpoint of ${saved.c.toLocaleString('en-US')} (\`coc_checkpoint\`)` : ', and no checkpoint, since it had not slept at an inn'}. Both keys hold JSON in \`localStorage\`, on your machine only. The README mentions **Export Save** and **Import Save** buttons; this build of \`play.html\` has none, so moving a run between browsers means copying those two keys.`);
  await click(q('#btn-continue-load')); await sleep(800);

  // ═══ 14. How it fits together ══════════════════════════════════════════════
  section('How it fits together',
    'The game is one loop: read a place, choose a verb, roll in the open, and let the world remember. Every system exists to feed that loop or to keep it honest.',
    'Each row below is a part of this guide; the third column is why it would not be enough alone.');
  table(['Stage', 'Feature', 'Why it is not enough alone'], [
    ['Begin', 'Origin, point-buy, the courier\'s map', 'A sheet and a goal say who you are and where to go, not how to get there.'],
    ['Read', 'The story screen, NPCs and favour', 'A place described is a place you still have to act in.'],
    ['Decide', 'Skill checks with the odds shown', 'A check resolves one moment; quests string the moments into a story.'],
    ['Go', 'Quests, the Warrant\'s Board, the map, waypoints', 'Walking costs time and meets monsters on the way.'],
    ['Fight', 'Initiative, the d20 against AC, action points', 'A won fight pays XP and drops; a lost one needs a way back.'],
    ['Grow', 'XP, levels, tattoos, the bag', 'Strength without rest runs out; the clock and the Void keep counting.'],
    ['Endure', 'Short and long rests, death saves, the checkpoint', 'The inn saves your place, but each night spends one of 49 days.'],
    ['Remember', 'Mission bits, the journal, the chronicle, the autosave', 'The world knows what you did; the ending names the friends you kept.'],
  ]);
  p('Beyond this tour: fishing at the lakes (shore, reeds and deep water unlock separately), vendors, the twenty Epic Battlegrounds where Void pressure builds, New Game+, and an optional peer **mesh** for presence, chat and consensual duels when the local server runs. All of it is in the same file.');
  p('Behind the game sits the authoring side: `edit.html`, a visual editor for nodes, terrains, monsters, quests, NPCs and mission bits, which needs the local WBAPI server (`make wbapi`). World data goes in through that API, and `make check` runs the gates that look for dead links, unreachable nodes, duplicate keys and quests that can never complete.');

  // ── number the pictures in reading order, and write the guide ─────────────
  let n = 0;
  for (const s of parts) for (const x of s.items) if (x.type === 'shot') {
    x.file = `${String(++n).padStart(2, '0')}-${x.name}.png`;
    fs.renameSync(path.join(SHOTS, x.tmp), path.join(SHOTS, x.file));
  }
  const md = [];
  md.push('# Codex of Conquest — feature guide', '',
    `A tour of the game in pictures: the player's process from a new character to a saved run, what each feature is, why it exists, and how it fits the whole. Played by \`src/tools/feature-guide.mjs\` on ${today} in headless Chromium against this repository's \`play.html\`, with a fresh browser profile, and written with what was on the screen. The dice were real, so another run will meet other monsters and roll other numbers. Run \`node src/tools/feature-guide.mjs\` to play it again.`, '',
    '> **How the pictures were made.** Every picture marked as played was captured from the live game while the tour played it: the clicks are a player\'s clicks, and the rolls are the game\'s own. To head for the inn the tour called the same function the quest log\'s Navigate button calls (`storySetWaypoint`), and it closed any story card that opened on the way, as a player clicking Continue would. Pictures it could not reach in its time budget are reused from the README and say so. The VM that ran it has no emoji font, so the game\'s emoji icons show as small boxes.', '',
    'For the README\'s player guide and the screenshots of single surfaces, see the [README](../README.md).', '',
    '## Contents', '', ...parts.map((s, i) => `${i + 1}. [${s.title}](#part-${i + 1})`), '');
  parts.forEach((s, i) => {
    md.push(`<a id="part-${i + 1}"></a>`, `## ${i + 1}. ${s.title}`, '', `**Why it exists.** ${s.why}`, '', `**How it fits.** ${s.fits}`, '');
    for (const x of s.items) {
      if (x.type === 'p') md.push(x.text, '');
      else if (x.type === 'check') md.push('**Check yourself**', '', ...x.items.map((t) => `- [ ] ${t}`), '');
      else if (x.type === 'table') md.push(`| ${x.head.join(' | ')} |`, `| ${x.head.map(() => '---').join(' | ')} |`, ...x.rows.map((r) => `| ${r.map((c) => String(c).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ')} |`), '');
      else if (x.type === 'shot') md.push(`![${x.caption}](features/${x.file})`, '', `*${x.caption}*`, '', ...x.marks.map((m, k) => `${k + 1}. ${m}`), ...(x.marks.length ? [''] : []));
      else if (x.type === 'reuse') md.push(`![${x.caption}](${x.file})`, '', `*${x.caption}*`, '');
    }
  });
  fs.writeFileSync(path.join(OUT, 'FEATURE_GUIDE.md'), md.join('\n'));
  say(`\nwrote docs/FEATURE_GUIDE.md (${parts.length} parts, ${n} pictures; ${stats.battles} battles, ${stats.wins} wins, ${stats.deaths} deaths; live: ${Object.entries(seen).filter(([, v]) => v).map(([k]) => k).join(', ')})`);
  if (stats.strays.length) say(`closed on the way: ${[...new Set(stats.strays)].join(', ')}`);
  if (pageErrors.length) say(`\npage errors seen:\n  ${[...new Set(pageErrors)].join('\n  ')}`);
} catch (err) {
  console.error(`\nGUIDE STOPPED: ${err.message}`);
  try { if (ws) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, 'zz-stopped-here.png'), Buffer.from(r.result.data, 'base64')); console.error('   the screen at that moment: docs/features/zz-stopped-here.png'); } } catch {}
  process.exitCode = 1;
} finally { stop(); }
