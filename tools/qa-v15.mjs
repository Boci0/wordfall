#!/usr/bin/env node
/**
 * Wordfall v1.5 acceptance checks: run clock, wave splits, achievements and
 * difficulty modes. Complement to tools/smoke.mjs (which stays the full
 * regression sweep); every assertion here drives the real game in headless
 * Chrome through window.__wordfall.
 *
 * Run from the wordfall/ folder:
 *   node tools/qa-v15.mjs [--wait-sec N]
 *
 * Prints a JSON summary on stdout; progress goes to stderr. Exits 0 only if
 * every check passes and the page logged no errors.
 */
import { chromium } from 'playwright-core';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const SHOTS = path.join(ROOT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const startedAt = Date.now();
const checks = [];
const errors = [];
const log = (...args) => console.error('[qa-v15]', ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shot = (name) => path.join(SHOTS, name);
const firstLine = (err) => String((err && err.message) || err).split('\n')[0];

function check(name, pass, actual, target) {
  checks.push({ name, pass: !!pass, actual: actual === undefined ? null : actual, target: target === undefined ? null : target });
  if (!pass) log(`FAIL ${name} — ${JSON.stringify(actual)} (target: ${JSON.stringify(target)})`);
  return !!pass;
}

let waitSec = 60;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--wait-sec') waitSec = Number(process.argv[++i]);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1260, height: 876 } });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const wf = (fn, arg) => page.evaluate(fn, arg);

await page.goto(INDEX_URL);
try {
  await page.waitForFunction(() => window.__wordfall && window.__wordfall.version === 'M8', null, { timeout: waitSec * 1000 });
} catch (e) {
  console.error('game.js never exposed version M8');
  await browser.close();
  process.exit(1);
}
log('game.js M8 is live — running v1.5 checks');

const txt = (id) => wf((i) => { const el = document.getElementById(i); return el ? el.textContent : null; }, id);

/** Type the target word until the current wave ends. */
async function clearWaveFast() {
  return wf(() => {
    const w = window.__wordfall;
    let guard = 0;
    while (w.state.waveCleared < 10 && w.state.phase === 'playing' && guard < 40) {
      guard += 1;
      if (!w.state.words.length) w.spawnOne();
      const t = w.targetWord();
      if (!t) break;
      if (t.fake) { w.state.words.splice(w.state.words.indexOf(t), 1); continue; }
      for (let k = 0; k < 12; k++) {
        const c = w.nextChar(t);
        if (!c) break;
        w.typeLetter(c);
      }
    }
    return { wave: w.state.wave, waveCleared: w.state.waveCleared, phase: w.state.phase };
  });
}

async function waitFor(predicate, timeout = 5000) {
  await page.waitForFunction(predicate, null, { timeout });
}

// ═══ Contract ══════════════════════════════════════════════════════════════
const contract = await wf(() => {
  const w = window.__wordfall;
  return {
    version: w.version,
    difficulty: typeof w.difficulty === 'function' ? w.difficulty().id : null,
    hasSplits: !!w.splits && Array.isArray(w.splits.split),
    hasAchievements: Array.isArray(w.ACHIEVEMENTS) && w.ACHIEVEMENTS.length > 0,
    fmtSplit: typeof w.fmtSplit === 'function' ? w.fmtSplit(62.34) : null,
  };
});
check('contract: version is M8', contract.version === 'M8', contract.version, "'M8'");
check('contract: default difficulty is standard', contract.difficulty === 'standard', contract.difficulty, "'standard'");
check('contract: split store and achievement table are exposed', contract.hasSplits && contract.hasAchievements, contract, 'both exposed');
check('contract: fmtSplit prints mm:ss.t', contract.fmtSplit === '01:02.3', contract.fmtSplit, "'01:02.3'");

// ═══ Main screen ═══════════════════════════════════════════════════════════
const main = await wf(() => ({
  phase: window.__wordfall.state.phase,
  visible: getComputedStyle(document.getElementById('mainScreen')).display !== 'none',
  title: document.getElementById('titleText').textContent,
  start: !!document.getElementById('menuStart'),
  modeButtons: document.querySelectorAll('#mainMode .mode-btn').length,
  achCount: document.getElementById('mainAchCount').textContent,
  best: document.getElementById('mainBest').textContent,
  rain: window.__wordfall.state.menuRain.length,
  items: Array.from(document.querySelectorAll('#mainScreen .main-item')).map((b) => b.dataset.cmd),
}));
check('main screen: shown on boot with Start and mode choices', main.phase === 'menu' && main.visible && main.start && main.modeButtons === 3, main, 'visible menu, Start, 3 modes');
check('main screen: attract rain is running behind it', main.rain > 0, main.rain, '> 0 drifting words');
check('main screen: shows meta-game destinations and stats', ['records', 'splits', 'achievements', 'controls', 'about', 'quit'].every((c) => main.items.includes(c)) && /^\d+ \/ \d+$/.test(main.achCount), { items: main.items, ach: main.achCount, best: main.best }, 'six destinations + achievement count');

const mainDiff = await wf(() => {
  document.querySelector('#mainMode .mode-btn[data-diff="nightmare"]').click();
  return {
    setting: window.__wordfall.settings.difficulty,
    pressed: document.querySelector('#mainMode .mode-btn[data-diff="nightmare"]').getAttribute('aria-pressed'),
    note: document.getElementById('mainModeNote').textContent,
  };
});
check('main screen: difficulty buttons select a mode', mainDiff.setting === 'nightmare' && mainDiff.pressed === 'true', mainDiff, 'nightmare selected');

await wf(() => document.querySelector('#mainScreen .main-item[data-cmd="records"]').click());
await sleep(120);
const mainDialog = await wf(() => ({
  records: document.getElementById('dlgRecords').classList.contains('show'),
  phase: window.__wordfall.state.phase,
  menuVisible: getComputedStyle(document.getElementById('mainScreen')).display !== 'none',
}));
check('main screen: Records opens above it and returns to it', mainDialog.records && mainDialog.phase === 'menu', mainDialog, 'records open, phase menu');
await wf(() => document.getElementById('recordsOk').click());
await sleep(80);

await wf(() => document.getElementById('menuStart').click());
await sleep(200);
const started = await wf(() => ({
  phase: window.__wordfall.state.phase,
  menuHidden: getComputedStyle(document.getElementById('mainScreen')).display === 'none',
}));
check('main screen: Start Run starts the run and hides the screen', started.phase === 'playing' && started.menuHidden, started, 'playing, main screen hidden');

await wf(() => window.__wordfall.pause());
await sleep(80);
const pausedDialog = await wf(() => ({
  pause: document.getElementById('dlgPause').classList.contains('show'),
  menuBtn: !!document.getElementById('pauseMenu'),
}));
check('main screen: pause offers Main Menu', pausedDialog.pause && pausedDialog.menuBtn, pausedDialog, 'pause dialog with Main Menu');
await wf(() => document.getElementById('pauseMenu').click());
await sleep(150);
const returned = await wf(() => ({
  phase: window.__wordfall.state.phase,
  visible: getComputedStyle(document.getElementById('mainScreen')).display !== 'none',
  modal: !!document.querySelector('#modalLayer.open'),
}));
check('main screen: Main Menu abandons the run and returns', returned.phase === 'menu' && returned.visible && !returned.modal, returned, 'menu, visible, no modal');
const resetBar = await wf(() => ({
  score: document.getElementById('statusScore').textContent,
  time: document.getElementById('statusTime').textContent,
  wave: document.getElementById('statusWave').textContent,
  mainTime: document.getElementById('stripRun').textContent,
}));
check('main screen: the abandoned run is cleared from the status bar', resetBar.score === 'Score: 0' && resetBar.time === 'Time: 00:00' && /^Wave: 1\/12/.test(resetBar.wave) && resetBar.mainTime === '00:00', resetBar, 'Score 0, Time 00:00, Wave 1/12');

// ═══ Timer ═════════════════════════════════════════════════════════════════
await wf(() => { window.__wordfall.setDifficulty('standard'); window.__wordfall.reset(987654); });
await sleep(1300);
const timer = await wf(() => ({
  runSec: window.__wordfall.state.runSec,
  text: document.getElementById('statusTime').textContent,
  title: document.getElementById('titleText').textContent,
}));
check('timer: the status bar carries a live run clock', /^Time: \d\d:\d\d$/.test(timer.text) && timer.runSec > 0.5, timer, 'Time: MM:SS and runSec > 0.5');
check('timer: the signal strip carries the same clock', /^\d\d:\d\d$/.test(await txt('stripRun')), await txt('stripRun'), 'MM:SS in the strip');

// Pause freezes the clock.
const beforePause = await wf(() => window.__wordfall.state.runSec);
await wf(() => window.__wordfall.pause());
await sleep(700);
const paused = await wf(() => ({ runSec: window.__wordfall.state.runSec, phase: window.__wordfall.state.phase }));
check('timer: pausing freezes the clock', paused.phase === 'paused' && Math.abs(paused.runSec - beforePause) < 0.15, paused, 'runSec unchanged while paused');
await wf(() => window.__wordfall.resume());
await sleep(500);
const resumed = await wf(() => window.__wordfall.state.runSec);
check('timer: resuming continues the clock', resumed > beforePause + 0.2, resumed, 'runSec advances after resume');

// ═══ Difficulty ════════════════════════════════════════════════════════════
const casual = await wf(() => {
  const w = window.__wordfall;
  w.setDifficulty('casual');
  w.reset(1001);
  return { lives: w.state.lives, difficulty: w.state.difficulty, speed: w.baseSpeedNow(), spawn: w.spawnInterval() };
});
check('difficulty: Casual starts with two lives', casual.lives === 2, casual.lives, 2);
check('difficulty: run records Casual mode', casual.difficulty === 'casual', casual.difficulty, "'casual'");
check('difficulty: Casual falls slower than the 54px/s base', casual.speed < 54 && casual.spawn > 2.85, casual, 'speed < 54, spawn > 2.85');

const nightmare = await wf(() => {
  const w = window.__wordfall;
  w.setDifficulty('nightmare');
  w.reset(1002);
  return { lives: w.state.lives, difficulty: w.state.difficulty, speed: w.baseSpeedNow(), spawn: w.spawnInterval() };
});
check('difficulty: Nightmare starts with one life', nightmare.lives === 1, nightmare.lives, 1);
check('difficulty: Nightmare is faster and tighter than Casual', nightmare.speed > casual.speed && nightmare.spawn < casual.spawn, { casual, nightmare }, 'speed up, spawn down');

const cycle = await wf(() => {
  const w = window.__wordfall;
  w.setDifficulty('standard');
  const before = w.settings.difficulty;
  document.getElementById('menuDifficulty').click();
  const after = w.settings.difficulty;
  document.getElementById('menuDifficulty').click();
  const after2 = w.settings.difficulty;
  return { before, after, after2, label: document.getElementById('menuDifficulty').textContent };
});
check('difficulty: Game menu cycles Casual -> Standard -> Nightmare', cycle.after === 'nightmare' && cycle.after2 === 'casual', cycle, 'standard -> nightmare -> casual');

const persistedBefore = await wf(() => {
  window.__wordfall.setDifficulty('casual');
  return { setting: window.__wordfall.settings.difficulty, stored: JSON.parse(localStorage.getItem('wordfall.settings') || 'null') };
});
check('difficulty: the choice is persisted with the other settings', persistedBefore.stored && persistedBefore.stored.difficulty === 'casual', persistedBefore, 'settings.difficulty = casual');

// ═══ Wave splits ═══════════════════════════════════════════════════════════
await wf(() => { window.__wordfall.setDifficulty('standard'); window.__wordfall.reset(424242); });
await sleep(300);
const waveOne = await clearWaveFast();
await sleep(120);
const splitOne = await wf(() => ({
  splits: window.__wordfall.state.waveSplits.slice(),
  lastSplit: window.__wordfall.state.lastSplit,
  stored: JSON.parse(JSON.stringify(window.__wordfall.splits)),
  storedRaw: localStorage.getItem('wordfall.splits'),
  stripWave: document.getElementById('stripWave').textContent,
  stripSub: document.getElementById('stripWaveSub').textContent,
  stripFlash: document.getElementById('stripHud').classList.contains('flash'),
  achieved: Object.keys(window.__wordfall.achieved),
}));
check('splits: finishing wave 1 records one split', waveOne.waveCleared === 10 && splitOne.splits.length === 1 && splitOne.splits[0] > 0, splitOne.splits, 'one positive split');
check('splits: wave 1 PB is written to localStorage', !!splitOne.storedRaw && splitOne.stored.split[0] > 0 && splitOne.stored.cum[0] > 0, splitOne.stored, 'split[] and cum[] populated');
check('splits: the completed split lands in the signal strip', splitOne.lastSplit && splitOne.lastSplit.wave === 1 && /^00:/.test(splitOne.stripWave) && /WAVE 1 CLEARED/.test(splitOne.stripSub) && splitOne.stripFlash, splitOne, 'strip shows WAVE 1 CLEARED + flash');
check('splits: the split announcement no longer stacks a centre popup', !(await wf(() => window.__wordfall.state.popups.some((p) => /^WAVE 1 · /.test(p.text)))), null, 'no centre WAVE popup');

await waitFor(() => window.__wordfall.state.phase === 'draft', 5000);
const draftClock = await wf(() => window.__wordfall.state.runSec);
await sleep(600);
const draftClock2 = await wf(() => window.__wordfall.state.runSec);
check('timer: the draft does not run the clock', Math.abs(draftClock2 - draftClock) < 0.01, { draftClock, draftClock2 }, 'runSec frozen during draft');
await wf(() => window.__wordfall.pick(0));
await sleep(150);
const waveTwoStart = await wf(() => ({ wave: window.__wordfall.state.wave, waveStartSec: window.__wordfall.state.waveStartSec, runSec: window.__wordfall.state.runSec, waveMistakes: window.__wordfall.state.waveMistakes }));
check('splits: a new wave resets its own split clock', waveTwoStart.wave === 2 && Math.abs(waveTwoStart.waveStartSec - waveTwoStart.runSec) < 0.2 && waveTwoStart.waveMistakes === 0, waveTwoStart, 'waveStartSec ≈ runSec');

// Second wave split, then the dialog.
await clearWaveFast();
await sleep(400);
const dialog = await wf(() => {
  document.getElementById('menuSplits').click();
  return {
    show: document.getElementById('dlgSplits').classList.contains('show'),
    rows: document.querySelectorAll('#splitsBody tr').length,
    first: document.querySelector('#splitsBody tr') ? Array.from(document.querySelectorAll('#splitsBody tr'))[0].textContent : null,
    second: Array.from(document.querySelectorAll('#splitsBody tr'))[1] ? Array.from(document.querySelectorAll('#splitsBody tr'))[1].textContent : null,
    paused: window.__wordfall.state.phase,
  };
});
check('splits: the Splits dialog lists all twelve waves', dialog.show && dialog.rows === 12, dialog, '12 rows');
check('splits: wave 1 and wave 2 rows show a best split', /\d\d:\d\d\.\d/.test(dialog.first) && /\d\d:\d\d\.\d/.test(dialog.second), [dialog.first, dialog.second], 'both times present');
check('splits: opening the dialog pauses the run', dialog.paused === 'paused', dialog.paused, 'paused');
await page.screenshot({ path: shot('qa-v15-splits.png') });
await wf(() => document.getElementById('splitsOk').click());
await sleep(100);
check('splits: OK returns to the run', await wf(() => window.__wordfall.state.phase === 'playing'), null, 'playing');

// ═══ Achievements ══════════════════════════════════════════════════════════
const achievementState = await wf(() => {
  const w = window.__wordfall;
  return {
    achieved: Object.keys(w.achieved),
    headBefore: document.getElementById('achHead').textContent,
  };
});
check('achievements: first clear unlocks Signal Acquired', achievementState.achieved.includes('first-clear'), achievementState.achieved, 'first-clear');
check('achievements: a ten clear combo unlocks Chain Reaction', achievementState.achieved.includes('combo-10'), achievementState.achieved, 'combo-10');

const unlocked = await wf(() => {
  const w = window.__wordfall;
  const before = typeof w.achieved['score-10k'];
  w.state.score = 12000;
  w.state.longestClear = 10;
  w.state.flaresCleared = 1;
  w.evaluateAchievements();
  return {
    before,
    after: Object.keys(w.achieved),
    stored: JSON.parse(localStorage.getItem('wordfall.achievements') || 'null'),
    toasts: document.querySelectorAll('.toast').length,
  };
});
check('achievements: a 10,000 score unlocks Ten Thousand', unlocked.after.includes('score-10k'), unlocked, 'score-10k');
check('achievements: clearing a 10 letter word unlocks Full Bandwidth', unlocked.after.includes('long-word'), unlocked, 'long-word');
check('achievements: catching a flare unlocks Flare Chaser', unlocked.after.includes('flare'), unlocked, 'flare');
check('achievements: unlocks are persisted to localStorage', !!unlocked.stored && !!unlocked.stored['score-10k'], unlocked.stored, 'wordfall.achievements has entries');
check('achievements: an unlock raises a toast', unlocked.toasts > 0, unlocked.toasts, '> 0 toasts');
check('achievements: the menu shows the unlocked count', await wf(() => /\(\d+\/15\)/.test(document.getElementById('menuAchievements').textContent)), await txt('menuAchievements'), 'Achievements… (n/15)');

await wf(() => document.getElementById('menuAchievements').click());
await sleep(150);
const achDialog = await wf(() => ({
  show: document.getElementById('dlgAchievements').classList.contains('show'),
  head: document.getElementById('achHead').textContent,
  rows: document.querySelectorAll('#achList .ach-row').length,
  unlockedRows: document.querySelectorAll('#achList .ach-row.unlocked').length,
  lockedRows: document.querySelectorAll('#achList .ach-row.locked').length,
}));
check('achievements: the dialog lists every achievement', achDialog.show && achDialog.rows === 15, achDialog, '15 rows');
check('achievements: the header counts the unlocks', /^Unlocked \d+ \/ 15$/.test(achDialog.head), achDialog.head, 'Unlocked n / 15');
check('achievements: unlocked and locked rows both render', achDialog.unlockedRows > 0 && achDialog.lockedRows > 0, achDialog, 'both kinds');
await page.screenshot({ path: shot('qa-v15-achievements.png') });
await wf(() => document.getElementById('achOk').click());
await sleep(100);

// Unlocks survive a reload.
await wf(() => window.__wordfall.setDifficulty('casual'));
await page.reload();
await page.waitForFunction(() => window.__wordfall && window.__wordfall.version === 'M8', null, { timeout: waitSec * 1000 });
const reloaded = await wf(() => ({
  achieved: Object.keys(window.__wordfall.achieved),
  splits: window.__wordfall.splits.split.filter((v) => v > 0).length,
  difficulty: window.__wordfall.settings.difficulty,
}));
check('persistence: achievements survive a reload', reloaded.achieved.includes('score-10k') && reloaded.achieved.includes('first-clear'), reloaded.achieved, 'achievements restored');
check('persistence: split PBs survive a reload', reloaded.splits >= 2, reloaded.splits, '>= 2 wave PBs');
check('persistence: difficulty setting survives a reload', reloaded.difficulty === 'casual', reloaded.difficulty, "'casual'");

// ═══ Long words actually clear ═════════════════════════════════════════════
const longWords = await wf(() => {
  const w = window.__wordfall;
  w.setDifficulty('standard');
  w.reset(31337);
  w.state.phase = 'playing';
  const sample = ['accountant', 'appreciate', 'beneficial', 'capability', 'commercial',
    'comparison', 'conclusion', 'conference', 'confidence', 'consistent',
    'convenient', 'difference', 'enterprise', 'everything', 'experiment',
    'foundation', 'generation', 'government', 'helicopter', 'illustrate'];
  const results = [];
  for (const text of sample) {
    for (const card of [null, 'reverse', 'tunnel']) {
      // Fresh run per case: a wave-clear beat would block typeLetter otherwise.
      w.reset(4242);
      w.state.phase = 'playing';
      w.state.waveClearT = 0;
      if (card) w.grant(card, 1);
      const word = w.spawnWord(text);
      if (!word) { results.push({ text, card, ok: false, why: 'spawn failed' }); continue; }
      for (let k = 0; k < text.length + 2; k++) {
        const c = w.nextChar(word);
        if (!c) break;
        w.typeLetter(c);
      }
      results.push({ text, card, ok: w.state.words.indexOf(word) < 0 && w.state.cleared === 1 });
    }
  }
  w.state.deck = {};
  return results;
});
const failedLong = longWords.filter((r) => !r.ok);
check(`long words: all ${longWords.length} 10-letter spawn/hex combinations clear`, failedLong.length === 0, failedLong, '[]');

// Nine/ten-letter words get 8% more air, so a long word is a challenge rather
// than a death sentence. Compare a 10-letter and a 3-letter word started at the
// same y on the same board (no Longshot held).
const reliefStart = await wf(() => {
  const w = window.__wordfall;
  w.setDifficulty('standard');
  w.reset(5150);
  w.state.words.length = 0;
  w.state.spawnT = 999;
  w.state.flareT = 999;
  const long = w.spawnWord('government', { y: 100 });
  const short = w.spawnWord('arm', { y: 100 });
  return { longId: long.id, shortId: short.id, longY: long.y, shortY: short.y };
});
await sleep(500);
const relief = await wf(({ longId, shortId, longY, shortY }) => {
  const s = window.__wordfall.state;
  const long = s.words.find((x) => x.id === longId);
  const short = s.words.find((x) => x.id === shortId);
  if (!long || !short || short.y === shortY) return { ratio: 0, moved: 0 };
  return { ratio: (long.y - longY) / (short.y - shortY), moved: short.y - shortY };
}, reliefStart);
check('long words: 9+ letter words fall 8% slower', relief.moved > 5 && relief.ratio >= 0.88 && relief.ratio <= 0.95, relief, 'fall ratio in [0.88, 0.95] (nominal 0.92)');

// ═══ Decoy target is legible ══════════════════════════════════════════════
// The player report "long words don't die" was a Decoy fake rendered like a
// real target. The rule stays, the presentation must not lie.
const decoy = await wf(() => {
  const w = window.__wordfall;
  w.setDifficulty('standard');
  w.reset(77);
  w.grant('decoy', 1);
  w.spawnWord('government', { y: 120 });
  w.spawnWord('govrenment', { y: 330, fake: true });
  w.state.spawnT = 999;
  w.state.flareT = 999;
  return true;
}) && (await sleep(250), await wf(() => {
  const w = window.__wordfall;
  const target = w.targetWord();
  const before = { progress: target.progress, mistakes: w.state.mistakes };
  for (const ch of target.text) w.typeLetter(ch);
  return {
    isFake: target.fake,
    statusText: document.getElementById('statusMain').textContent,
    popups: w.state.popups.map((p) => p.text),
    progress: target.progress,
    typed: target.text.length,
    mistakes: w.state.mistakes - before.mistakes,
    stillOnBoard: w.state.words.indexOf(target) >= 0,
  };
}));
check('decoy: a fake as the lowest word is still marked as a fake', decoy.isFake && /DECOY/.test(decoy.statusText), decoy.statusText, 'status mentions DECOY');
check('decoy: a fake target raises a one-time LET IT PASS cue', decoy.popups.some((t) => /DECOY .* LET IT PASS/.test(t)), decoy.popups, 'DECOY · LET IT PASS popup');
check('decoy: typing a fake is still all misses by design', decoy.progress === 0 && decoy.mistakes === decoy.typed, { progress: decoy.progress, mistakes: decoy.mistakes, typed: decoy.typed }, 'progress 0, every key a miss');
check('decoy: the fake is not removed from the board when typed', decoy.stillOnBoard, decoy.stillOnBoard, true);

// ═══ Frame CPU budget ══════════════════════════════════════════════════════
// A synchronous update+render loop, independent of the browser's vsync. The
// wall-clock smoke perf gate is noisy on busy machines; this number is not.
const bench = await wf(() => window.__wordfall.benchScene(180));
check('performance: update+render CPU budget', bench.frames === 180 && bench.perFrameMs > 0 && bench.perFrameMs < 12, bench, '< 12 ms of CPU per frame');
await wf(() => window.__wordfall.returnToMenu ? window.__wordfall.returnToMenu() : null);

// ═══ No page errors ════════════════════════════════════════════════════════
check('page: no console or runtime errors', errors.length === 0, errors, '[]');

const elapsedSec = Number(((Date.now() - startedAt) / 1000).toFixed(2));
const passed = checks.filter((c) => c.pass).length;
console.log(JSON.stringify({ passed, total: checks.length, elapsedSec, errors, failed: checks.filter((c) => !c.pass) }, null, 2));
await browser.close();
process.exit(passed === checks.length && errors.length === 0 ? 0 : 1);
