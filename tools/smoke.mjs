#!/usr/bin/env node
/**
 * Wordfall end-to-end smoke test (M1 core loop + M2 draft/pressure + M3 cards
 * + M4 screenshots + M5 tuning hooks + M6 pause/records/stats/seeds/Split
 * + M7 effects/juice, FX toggle persistence, wave-clear beat and frame-time).
 * Drives the real game in headless Chrome through the `window.__wordfall`
 * debug hook; every assertion runs against live state.
 *
 * Run from the wordfall/ folder:
 *   node tools/smoke.mjs
 *   node tools/smoke.mjs --wait-sec 60     # shorten the "wait for M8" window
 *
 * Prints a JSON summary on stdout; progress goes to stderr. Screenshots land in
 * shots/. Exits 0 only if every check passes and the page logged no errors.
 *
 * This file never edits the game to make checks pass: a failure is reported.
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
const RETRY_WAIT_MS = 20000;
fs.mkdirSync(SHOTS, { recursive: true });

const startedAt = Date.now();
const checks = [];
const errors = [];
const notes = {};
const log = (...args) => console.error('[smoke]', ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shot = (name) => path.join(SHOTS, name);
const firstLine = (err) => String((err && err.message) || err).split('\n')[0];
const approx = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

let browser = null;
let page = null;

function check(name, pass, actual, target) {
  checks.push({ name, pass: !!pass, target: target === undefined ? null : target, actual: actual === undefined ? null : actual });
  if (!pass) log(`FAIL ${name} — ${JSON.stringify(actual)} (target: ${JSON.stringify(target)})`);
  return !!pass;
}

const wf = (fn, arg) => page.evaluate(fn, arg);

async function section(name, fn) {
  try {
    await fn();
  } catch (err) {
    check(`${name}: completed without throwing`, false, firstLine(err), 'no exception');
  }
}

function parseArgs(argv) {
  const opts = { waitSec: 900 };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--wait-sec') {
      opts.waitSec = Number(argv[++i]);
      if (!Number.isFinite(opts.waitSec) || opts.waitSec < 0) {
        console.error('smoke: --wait-sec must be a number >= 0');
        process.exit(2);
      }
    } else if (arg === '-h' || arg === '--help') {
      console.log("Usage: node tools/smoke.mjs [--wait-sec N]\n\nWaits up to N seconds for game.js window.__wordfall.version === 'M8' (default 900).");
      process.exit(0);
    } else {
      console.error(`smoke: unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return opts;
}
const opts = parseArgs(process.argv);

// ─── Page helpers ───────────────────────────────────────────────────────────

async function waitForM7() {
  const deadline = Date.now() + opts.waitSec * 1000;
  let last = 'window.__wordfall missing';
  for (;;) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const candidate = await context.newPage();
    let version = null;
    const pageErrors = [];
    candidate.on('pageerror', (e) => pageErrors.push(firstLine(e)));
    try {
      await candidate.goto(INDEX_URL, { waitUntil: 'load', timeout: 20000 });
      version = await candidate.evaluate(() => (window.__wordfall && window.__wordfall.version) || null);
    } catch (err) {
      last = `load failed: ${firstLine(err)}`;
    }
    if (version === 'M8') {
      page = candidate;
      return;
    }
    if (version) last = `version=${JSON.stringify(version)}`;
    else if (pageErrors.length) last = `no hook; pageerror: ${pageErrors[0]}`;
    await context.close().catch(() => {});
    if (Date.now() >= deadline) {
      throw new Error(`game.js never exposed window.__wordfall.version === 'M8' within ${opts.waitSec}s (last: ${last})`);
    }
    log(`game not ready (${last}); retrying in ${RETRY_WAIT_MS / 1000}s`);
    await sleep(RETRY_WAIT_MS);
  }
}

/** A compact snapshot of everything the checks care about. */
async function stateInfo() {
  return wf(() => {
    const w = window.__wordfall;
    const s = w.state;
    return {
      phase: s.phase,
      score: s.score,
      combo: s.combo,
      bestCombo: s.bestCombo,
      cleared: s.cleared,
      wave: s.wave,
      waveCleared: s.waveCleared,
      lives: s.lives,
      shields: s.shields,
      shieldMax: s.shieldMax,
      deck: Object.assign({}, s.deck),
      draftsTaken: s.draftsTaken,
      rerollsLeft: s.rerollsLeft,
      offer: s.offer ? s.offer.map((c) => (c ? { id: c.id, name: c.name, type: c.type, rarity: c.rarity, tier: c.tier, maxTier: c.maxTier } : null)) : null,
      pressure: w.pressure(),
      bucketPressure: w.bucketPressure(),
      heat: w.heat(),
      heatMult: w.heatMult(),
      comboMult: w.comboMultiplier(),
      speedMult: w.speedMult(),
      wordRange: w.wordRange(),
      visibleCount: w.visibleCount(),
      words: s.words.map((x) => ({ id: x.id, text: x.text, x: x.x, y: x.y, progress: x.progress, fake: !!x.fake })),
      echoes: s.echoes.map((e) => ({ text: e.text, ttl: e.ttl, t: e.t })),
      particles: s.particles.length,
      // M7: wave-complete beat + effect layer snapshot
      waveClearT: s.waveClearT,
      waveClearWave: s.waveClearWave,
      waveBanner: s.waveBanner,
      milestoneT: s.milestoneT,
      fx: (() => {
        const f = w.fxState();
        return { quality: f.quality, particles: f.particles, shards: f.shards, rings: f.rings, popups: f.popups, milestone: f.milestone, danger: f.danger, cssCombos: f.cssCombos };
      })(),
      settingsFx: w.settings.fx,
      best: s.best,
      bestSaved: (() => { try { return Number(localStorage.getItem('wordfall.best') || 0); } catch (e) { return null; } })(),
      // M6: run identity + lifetime records
      seed: s.seed,
      keys: s.keys,
      mistakes: s.mistakes,
      runSec: s.runSec,
      records: w.records ? Object.assign({}, w.records) : null,
      storedRecords: (() => { try { return JSON.parse(localStorage.getItem('wordfall.records') || 'null'); } catch (e) { return null; } })(),
    };
  });
}

/** DOM/UI snapshot for the M6 dialogs and menu items. */
async function domInfo() {
  return wf(() => {
    const txt = (id) => {
      const el = document.getElementById(id);
      return el ? String(el.textContent || '').trim() : null;
    };
    const dialog = (id) => {
      const el = document.getElementById(id);
      if (!el) return { exists: false, show: false, text: null };
      const cs = getComputedStyle(el);
      return {
        exists: true,
        show: el.classList.contains('show') && cs.display !== 'none' && cs.visibility !== 'hidden',
        text: String(el.textContent || '').trim(),
      };
    };
    const menu = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const shortcut = el.querySelector('.shortcut');
      return {
        text: String(el.textContent || '').trim(),
        label: (el.childNodes[0] && el.childNodes[0].textContent || '').trim(),
        shortcut: shortcut ? String(shortcut.textContent || '').trim() : null,
        disabled: el.classList.contains('disabled'),
        exists: true,
      };
    };
    const cs = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el) : null;
    };
    const body = document.body;
    const fxOverlay = document.getElementById('fxOverlay');
    const fxCs = fxOverlay ? getComputedStyle(fxOverlay) : null;
    const modalCs = cs('#modalLayer');
    const app = document.getElementById('app');
    const draftGrid = document.getElementById('draftGrid');
    const draftCards = draftGrid ? Array.from(draftGrid.children).map((el) => ({
      classes: Array.from(el.classList),
      badge: el.querySelector('.badge') ? String(el.querySelector('.badge').textContent || '').trim() : null,
      rare: !!el.querySelector('.rare'),
      tag: el.querySelector('.tag-new, .tag-up') ? String(el.querySelector('.tag-new, .tag-up').textContent || '').trim() : null,
      tagClass: el.querySelector('.tag-new, .tag-up') ? el.querySelector('.tag-new, .tag-up').className : null,
      name: el.querySelector('.draft-name') ? String(el.querySelector('.draft-name').textContent || '').trim() : null,
      desc: el.querySelector('.draft-desc') ? String(el.querySelector('.draft-desc').textContent || '').trim() : null,
    })) : null;
    return {
      phase: window.__wordfall.state.phase,
      statusMain: txt('statusMain'),
      statusCombo: txt('statusCombo'),
      statusShields: txt('statusShields'),
      titleText: txt('titleText'),
      taskText: txt('taskText'),
      bodyClasses: Array.from(body.classList),
      fxOverlay: fxOverlay ? {
        exists: true,
        pointerEvents: fxCs.pointerEvents,
        zIndex: fxCs.zIndex,
        display: fxCs.display,
        opacity: fxCs.opacity,
      } : { exists: false },
      modalZIndex: modalCs ? modalCs.zIndex : null,
      appVars: app ? {
        combo: app.style.getPropertyValue('--fx-combo'),
        danger: app.style.getPropertyValue('--fx-danger'),
        heat: app.style.getPropertyValue('--fx-heat'),
        lives: app.style.getPropertyValue('--fx-lives'),
        wave: app.style.getPropertyValue('--fx-wave'),
      } : null,
      menuEffects: menu('menuEffects'),
      draftCards,
      dlgPause: dialog('dlgPause'),
      dlgRecords: dialog('dlgRecords'),
      dlgControls: dialog('dlgControls'),
      modalOpen: !!document.querySelector('#modalLayer.open'),
      pauseSeedLine: txt('pauseSeedLine'),
      pauseNote: (() => {
        const el = document.querySelector('#dlgPause .pause-note');
        return el ? String(el.textContent || '').trim() : null;
      })(),
      pauseButtons: ['pauseResume', 'pauseRestart', 'pauseControls'].map((id) => ({
        id,
        exists: !!document.getElementById(id),
        text: txt(id),
        isDefault: !!(document.getElementById(id) && document.getElementById(id).classList.contains('default')),
      })),
      menuPause: menu('menuPause'),
      menuRecords: menu('menuRecords'),
      overSeed: { exists: !!document.getElementById('overSeed'), text: txt('overSeed') },
      records: {
        bestScore: txt('recBestScore'),
        bestWave: txt('recBestWave'),
        bestCombo: txt('recBestCombo'),
        runs: txt('recRuns'),
        dawns: txt('recDawns'),
        words: txt('recWords'),
        fastest: txt('recFastest'),
      },
    };
  });
}

/** Reload the page in the same context (localStorage survives) and wait for M8 again. */
async function reloadGame() {
  await page.reload({ waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(
    () => window.__wordfall && window.__wordfall.version === 'M8',
    null,
    { timeout: 20000 }
  );
  await sleep(150);
}

async function resetRun(grants = []) {
  return wf((grants) => {
    const w = window.__wordfall;
    w.reset();
    for (const g of grants) w.grant(g.id, g.tier || 1);
    const s = w.state;
    return { lives: s.lives, shieldMax: s.shieldMax, shields: s.shields, pressure: w.pressure() };
  }, grants);
}

/** Replace the board with a single word and return it. */
async function spawnOnly(text, extra = {}) {
  return wf(({ text, extra }) => {
    const w = window.__wordfall;
    w.state.words.length = 0;
    const word = w.spawnWord(text, extra || {});
    return word ? { id: word.id, text: word.text, y: word.y, x: word.x } : null;
  }, { text, extra });
}

/**
 * Clear a freshly spawned word by feeding it `nextChar(word)` through
 * typeLetter(), so Reverse / Tunnel / Lock-on do not need special casing.
 * Returns score/combo multipliers captured *before* the clear, so the scorer
 * formula can be checked exactly.
 */
async function clearWithHook(text, extra = {}) {
  return wf(({ text, extra }) => {
    const w = window.__wordfall;
    const s = w.state;
    s.words.length = 0;
    const word = w.spawnWord(text, extra || {});
    if (!word) return { error: `spawnWord(${text}) returned null` };
    const before = {
      score: s.score,
      combo: s.combo,
      cleared: s.cleared,
      pressure: w.pressure(),
      comboMult: w.comboMultiplier(),
      heatMult: w.heatMult(),
      scoreMult: w.has('greed') ? (w.heldTier('greed') >= 2 ? 1.7 : 1.4) : 1,
    };
    const chars = [];
    let guard = 0;
    while (guard++ < 64 && s.words.indexOf(word) >= 0 && s.phase === 'playing') {
      const ch = w.nextChar(word);
      if (ch == null) break;
      chars.push(ch);
      w.typeLetter(ch);
    }
    return {
      text: word.text,
      chars,
      before,
      after: { score: s.score, combo: s.combo, cleared: s.cleared, pressure: w.pressure() },
      cleared: s.words.indexOf(word) < 0,
      phase: s.phase,
    };
  }, { text, extra });
}

/** Type a word through the REAL keyboard path (keydown handler). */
async function clearReal(text) {
  await wf((text) => {
    const w = window.__wordfall;
    w.state.words.length = 0;
    w.spawnWord(text, { y: 220 });
  }, text);
  for (const ch of text) await page.keyboard.press(ch);
  return wf(() => {
    const w = window.__wordfall;
    const s = w.state;
    return { phase: s.phase, cleared: s.cleared, combo: s.combo, score: s.score, words: s.words.length, waveClearT: s.waveClearT, waveCleared: s.waveCleared };
  });
}

function scoreDelta(run) {
  return run.after.score - run.before.score;
}

const scoreFormula = (letters, run, opts2 = {}) => {
  const lettersBonus = opts2.ledger ? 2 : 0;
  let mult = run.before.comboMult * run.before.heatMult * (opts2.greedMult || 1);
  if (opts2.longshot && letters >= 7) mult *= 2;
  return Math.round(letters * (10 + lettersBonus) * mult);
};

/**
 * Fill the board and run N rAF frames while clearing a word every frame, then
 * report frame-interval stats and the peak effect-pool sizes. The first 8
 * frames are warm-up and are ignored (Chrome's first paint is not steady).
 */
async function measureFxLoad(frames) {
  return wf(async (frames) => {
    const w = window.__wordfall;
    const s = w.state;
    w.reset(5150);
    s.lives = 99;
    s.cleared = 400;
    s.wave = 7;
    s.waveCleared = 0;
    s.words.length = 0;
    const texts = ['lantern', 'ember', 'drift', 'hollow', 'tunnel', 'signal'];
    for (let i = 0; i < 6; i++) w.spawnWord(texts[i], { y: 60 + i * 85 });
    return await new Promise((resolve) => {
      const deltas = [];
      const maxPools = { particles: 0, shards: 0, rings: 0, popups: 0 };
      let seen = 0;
      let clears = 0;
      let effectsSeen = 0;
      let last = performance.now();
      const tick = (now) => {
        const dt = now - last;
        last = now;
        // Keep the swarm alive: full lives and no wave end may interrupt it.
        s.lives = 99;
        s.waveCleared = 0;
        s.waveClearT = 0;
        if (s.phase !== 'playing') s.phase = 'playing';
        if (seen >= 8) {
          const target = w.targetWord();
          if (target && !target.fake) {
            let guard = 0;
            while (guard++ < 24 && s.words.indexOf(target) >= 0) {
              const ch = w.nextChar(target);
              if (ch == null) break;
              w.typeLetter(ch);
            }
            clears += 1;
          }
          if (s.words.length < 6) w.spawnWord(texts[(clears + 1) % texts.length], { y: 40 + ((clears * 37) % 240) });
          s.waveCleared = 0;
        }
        const fs = w.fxState();
        maxPools.particles = Math.max(maxPools.particles, fs.particles);
        maxPools.shards = Math.max(maxPools.shards, fs.shards);
        maxPools.rings = Math.max(maxPools.rings, fs.rings);
        maxPools.popups = Math.max(maxPools.popups, fs.popups);
        if (fs.particles + fs.shards + fs.rings + fs.popups > 0) effectsSeen += 1;
        if (seen >= 8) deltas.push(dt);
        seen += 1;
        if (seen >= frames + 8) {
          const total = deltas.reduce((a, b) => a + b, 0);
          const sorted = deltas.slice().sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          resolve({
            frames: deltas.length,
            avgMs: total / deltas.length,
            medianMs: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
            p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
            maxMs: sorted[sorted.length - 1],
            longFrames: deltas.filter((d) => d > 33).length,
            clears,
            effectsSeen,
            maxPools,
            caps: {
              particles: w.CFG.fxMaxParticles,
              shards: w.CFG.fxMaxShards,
              rings: w.CFG.fxMaxRings,
              popups: w.CFG.fxMaxPopups,
            },
            perf: w.perf(),
          });
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
  }, frames);
}

// ─── Main ───────────────────────────────────────────────────────────────────
let summary = null;
try {
  log('launching headless Chrome (channel=chrome)…');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  log(`waiting for ${INDEX_URL} to expose version M8…`);
  await waitForM7();
  log('game.js M8 is live — running checks');

  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const version = await wf(() => window.__wordfall.version);
  check('contract: window.__wordfall.version === M8', version === 'M8', version, "'M8'");

  // ═══ M1: core loop ═════════════════════════════════════════════════════
  await section('M1 core loop', async () => {
    await sleep(250);
    const menu = await stateInfo();
    check('M1: opens on the menu', menu.phase === 'menu', menu.phase, "'menu'");
    await page.screenshot({ path: shot('01-menu.png') });

    await page.keyboard.press('Enter');
    await sleep(120);
    const playing = await stateInfo();
    check('M1: Enter starts a run', playing.phase === 'playing', playing.phase, "'playing'");

    await page.waitForFunction(() => window.__wordfall.state.words.length >= 3, null, { timeout: 20000 });
    const spawned = await stateInfo();
    check('M1: words spawn automatically', spawned.words.length >= 3, spawned.words.length, '>= 3');
    await page.screenshot({ path: shot('02-play.png') });

    // A non-target word must be inert.
    const inert = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      const target = w.targetWord();
      const other = s.words.find((x) => x !== target);
      if (!other) return { skipped: true };
      const before = other.progress;
      w.typeLetter(other.text[0]);
      return { letter: other.text[0], other: other.text, before, after: other.progress, targetAfter: target ? target.progress : null };
    });
    check(
      'M1: a non-target word is inert',
      !inert.skipped && inert.before === inert.after,
      inert,
      'non-target progress unchanged'
    );

    // Clear three words through the real keyboard path.
    const startScore = (await stateInfo()).score;
    let st = null;
    const samples = ['cat', 'dog', 'sun', 'ice', 'oak', 'map'];
    for (let i = 0; i < 8; i++) {
      st = await clearReal(samples[i % samples.length]);
      if (st.phase !== 'playing' || st.cleared >= 3) break;
    }
    const afterTyping = await stateInfo();
    check(
      'M1: clearing words increases the score',
      afterTyping.score > startScore && afterTyping.cleared >= 3,
      { startScore, score: afterTyping.score, cleared: afterTyping.cleared },
      'score increases and >= 3 cleared'
    );
    check('M1: still playing after three clears', afterTyping.phase === 'playing', afterTyping.phase, "'playing'");
    // Stage a readable board for the mid-run shot (the loop clears its own
    // spawns, so the board can be empty; the spawn-materialise flicker needs
    // ~0.25 s to finish).
    await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      s.words.length = 0;
      [['audio', 160], ['signal', 300], ['relay', 430], ['lantern', 540]].forEach(([text, y]) => w.spawnWord(text, { y }));
    });
    await sleep(420);
    await page.screenshot({ path: shot('03-mid-run.png') });

    // Staged mid-run showcase (several words + partial progress).
    await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      s.words.length = 0;
      [['lantern', 120], ['ember', 250], ['drift', 380], ['hollow', 510], ['tunnel', 620]].forEach(([text, y]) => w.spawnWord(text, { y }));
      const target = w.targetWord();
      if (target) target.progress = Math.min(2, target.text.length - 1);
    });
    await sleep(450); // spawn-materialise flicker is intentional; wait it out for the showcase
    await page.screenshot({ path: shot('05-showcase.png') });

    // One word on the danger line ends the run (fresh run = 1 life).
    const fresh = await resetRun();
    check('M1: a fresh run starts with one life', fresh.lives === 1, fresh.lives, '1');
    await sleep(60);
    const lineDrop = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      s.words.length = 0;
      const word = w.spawnWord('cat', { y: 120 });
      word.y = s.groundY - 10;
      return { groundY: s.groundY, lives: s.lives };
    });
    await sleep(450);
    const dead = await stateInfo();
    check(
      'M1: a word reaching the danger line ends the run',
      dead.phase === 'gameover' && dead.lives === 0,
      { phase: dead.phase, lives: dead.lives, lineDrop },
      "phase 'gameover', lives 0"
    );
    await page.screenshot({ path: shot('04-gameover.png') });
    check('M1: best score is persisted (state.best >= last score)', dead.best >= dead.score, { best: dead.best, score: dead.score }, 'best >= score');

    await page.keyboard.press('Enter');
    await sleep(200);
    const restarted = await stateInfo();
    check(
      'M1: Enter restarts after a loss',
      restarted.phase === 'playing' && restarted.score === 0,
      { phase: restarted.phase, score: restarted.score },
      "phase 'playing', score 0"
    );
  });

  // ═══ M2: draft + pressure + heat ═══════════════════════════════════════
  await section('M2 draft + pressure', async () => {
    await resetRun();
    await sleep(50);

    // Clear exactly 10 words through the real keyboard path.
    const pool = ['cat', 'dog', 'sun', 'ice', 'oak', 'map', 'gem', 'arc', 'orb', 'ash', 'bay', 'dew'];
    let st = await stateInfo();
    for (let i = 0; i < 14 && st.phase === 'playing' && st.cleared < 10; i++) {
      st = await clearReal(pool[i % pool.length]);
    }
    // M7: the 10th clear starts a 0.85 s celebration; the draft opens after it.
    const beat = await stateInfo();
    check(
      'M7: clearing 10 words starts the wave-clear celebration (draft deferred)',
      beat.phase === 'playing' && beat.cleared === 10 && beat.waveClearT > 0,
      { phase: beat.phase, cleared: beat.cleared, waveClearT: beat.waveClearT, waveCleared: beat.waveCleared },
      "phase 'playing' and waveClearT > 0 before the draft"
    );
    await page.screenshot({ path: shot('11-wave-clear.png') }); // M7: celebration beat
    const inertBeat = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      const before = { keys: s.keys, cleared: s.cleared, combo: s.combo };
      w.typeLetter('x');
      return { before, after: { keys: s.keys, cleared: s.cleared, combo: s.combo, waveClearT: s.waveClearT } };
    });
    check(
      'M7: typeLetter() is inert during the wave-clear beat',
      inertBeat.after.keys === inertBeat.before.keys &&
      inertBeat.after.cleared === inertBeat.before.cleared &&
      inertBeat.after.combo === inertBeat.before.combo,
      inertBeat,
      'no keys / clears / combo change'
    );
    const beatYsA = await wf(() => window.__wordfall.state.words.map((x) => x.y));
    await sleep(200);
    const beatYsB = await wf(() => window.__wordfall.state.words.map((x) => x.y));
    check(
      'M7: the board hangs frozen during the wave-clear beat',
      JSON.stringify(beatYsA) === JSON.stringify(beatYsB),
      { before: beatYsA, after: beatYsB, reactivated: false },
      'word positions unchanged during the beat'
    );
    const draftWaitStart = Date.now();
    await page.waitForFunction(() => window.__wordfall.state.phase === 'draft', null, { timeout: 3000 });
    const draftWaitMs = Date.now() - draftWaitStart;
    check(
      'M7: the draft opens after the ~0.85 s wave-clear celebration',
      draftWaitMs <= 2500,
      { waitedMs: draftWaitMs },
      'draft within 2.5 s of the beat checks (deferred from the 10th clear)'
    );
    await sleep(80);
    const draft = await stateInfo();
    check(
      'M2: clearing 10 words enters the draft',
      draft.phase === 'draft' && draft.cleared === 10,
      { phase: draft.phase, cleared: draft.cleared, wave: draft.wave, waveCleared: draft.waveCleared },
      "phase 'draft' after cleared 10"
    );
    check('M2: combo carries into the draft', draft.combo === 10, { combo: draft.combo, bestCombo: draft.bestCombo }, 'combo 10');
    check('M2: pressure before the first draft is cleared + 4*drafts', draft.pressure === draft.cleared + 4 * draft.draftsTaken, draft.pressure, draft.cleared + 4 * draft.draftsTaken);
    await page.waitForFunction(() => {
      const el = document.getElementById('draftLog');
      return !!el && el.textContent.trim().startsWith('RELAY 12');
    }, null, { timeout: 5000 });
    const draftLog = await wf(() => {
      const el = document.getElementById('draftLog');
      return el ? el.textContent.trim() : '';
    });
    check(
      'M2: the Relay 12 log line is shown in the draft',
      draftLog.startsWith('RELAY 12') && draftLog.length > 20,
      draftLog,
      "starts with 'RELAY 12', non-empty"
    );
    notes.draftOffer = draft.offer;

    // M7 draft cards: type badges, NEW/UPGRADE tags and the RARE outline marker.
    const draftDom = await domInfo();
    const draftCards = draftDom.draftCards || [];
    const offerSlotTypes = (draft.offer || []).map((c) => (c ? c.type : null));
    const rareOffers = (draft.offer || []).filter((c) => c && c.rarity === 'rare').length;
    check(
      'M7 draft: three cards render with a lane badge and a NEW tag',
      draftCards.length === 3 &&
      draftCards.every((c) => c.badge && (c.badge === 'BOON' || c.badge === 'HEX' || c.badge === 'GAMBIT')) &&
      draftCards.every((c) => c.tag === 'NEW' && /tag-new/.test(c.tagClass || '')) &&
      offerSlotTypes[0] === 'boon' && offerSlotTypes[2] !== 'boon' && !!offerSlotTypes[2],
      { cards: draftCards, offerSlotTypes },
      '3 cards, badges, all NEW (tier I offers), slot 1 Boon, slot 3 Hex/Gambit'
    );
    const renderedRare = draftCards.filter((c) => c.rare).length;
    check(
      'M7 draft: rare offers carry the RARE outline marker',
      renderedRare === rareOffers,
      { renderedRare, rareOffers, cards: draftCards.map((c) => ({ name: c.name, rare: c.rare, tag: c.tag })) },
      'RARE marker on exactly the rare offers'
    );

    // Board freezes while drafting.
    const frozenA = await wf(() => window.__wordfall.state.words.map((w) => w.y));
    await sleep(350);
    const frozenB = await wf(() => window.__wordfall.state.words.map((w) => w.y));
    check('M2: the board freezes during the draft', JSON.stringify(frozenA) === JSON.stringify(frozenB), { before: frozenA, after: frozenB }, 'word positions unchanged');

    await sleep(120);
    await page.screenshot({ path: shot('06-draft.png') }); // M4 deliverable

    const picked = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      const before = {
        phase: s.phase,
        combo: s.combo,
        comboMult: w.comboMultiplier(),
        pressure: w.pressure(),
        draftsTaken: s.draftsTaken,
        wave: s.wave,
        score: s.score,
        offer: (s.offer || []).map((c) => (c ? c.id : null)),
      };
      const index = (s.offer || []).findIndex(Boolean);
      const pickedId = index >= 0 ? w.pick(index) : null;
      const deck = Object.assign({}, s.deck);
      return {
        before,
        index,
        pickedId,
        after: {
          phase: s.phase,
          combo: s.combo,
          comboMult: w.comboMultiplier(),
          pressure: w.pressure(),
          draftsTaken: s.draftsTaken,
          wave: s.wave,
          score: s.score,
          heldTier: pickedId ? w.heldTier(pickedId) : null,
          hasCard: pickedId ? w.has(pickedId) : null,
        },
        deck,
      };
    });
    check('M2: picking a card resumes play', picked.pickedId !== null && picked.after.phase === 'playing', picked, 'pickedId non-null, phase playing');
    check('M2: picking keeps the combo', picked.after.combo === picked.before.combo && approx(picked.after.comboMult, picked.before.comboMult), { before: picked.before, after: picked.after }, 'combo and comboMult unchanged');
    check('M2: picking raises pressure by exactly 4', picked.after.pressure - picked.before.pressure === 4, { before: picked.before.pressure, after: picked.after.pressure, draftsTaken: [picked.before.draftsTaken, picked.after.draftsTaken] }, '+4');
    check('M2: picked card is in the deck', picked.pickedId !== null && picked.after.hasCard && picked.after.heldTier === 1 && picked.deck[picked.pickedId] === 1, { pickedId: picked.pickedId, heldTier: picked.after.heldTier, deck: picked.deck }, 'held at tier 1');

    // Skip still counts as a draft, pays 150 x wave and grants +1 temporary Shield.
    await resetRun();
    const skipped = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      w.beginDraft();
      const before = {
        phase: s.phase, pressure: w.pressure(), draftsTaken: s.draftsTaken, score: s.score,
        wave: s.wave, deck: Object.assign({}, s.deck), skipValue: w.CFG.skipPointsPerWave,
        shieldMax: s.shieldMax, shields: s.shields,
      };
      const ok = w.skip();
      return {
        before, ok,
        after: {
          phase: s.phase, pressure: w.pressure(), draftsTaken: s.draftsTaken, score: s.score,
          wave: s.wave, deck: Object.assign({}, s.deck), shieldMax: s.shieldMax, shields: s.shields,
          waveBanner: s.waveBanner,
        },
      };
    });
    check('M2: beginDraft() forces the draft open', skipped.before.phase === 'draft', skipped.before.phase, "'draft'");
    check('M2: skip resumes play and takes the draft', skipped.ok === true && skipped.after.phase === 'playing' && skipped.after.draftsTaken === skipped.before.draftsTaken + 1, skipped, 'skip() true, phase playing, draftsTaken +1');
    check('M2: skip raises pressure by exactly 4', skipped.after.pressure - skipped.before.pressure === 4, { before: skipped.before.pressure, after: skipped.before.pressure }, '+4');
    check(
      'M2: skip pays 150 x wave points',
      skipped.before.skipValue === 150 &&
      skipped.after.score - skipped.before.score === skipped.before.skipValue * skipped.before.wave,
      { delta: skipped.after.score - skipped.before.score, expected: skipped.before.skipValue * skipped.before.wave, wave: skipped.before.wave, skipValue: skipped.before.skipValue },
      '150 x wave'
    );
    check(
      'M7: skip grants +1 temporary Shield for the next wave',
      skipped.after.shields === skipped.before.shields + 1 &&
      skipped.after.shields <= 3 &&
      skipped.after.shieldMax === skipped.before.shieldMax,
      { before: { shields: skipped.before.shields, shieldMax: skipped.before.shieldMax }, after: { shields: skipped.after.shields, shieldMax: skipped.after.shieldMax } },
      'shields +1 (above shieldMax), shieldMax unchanged'
    );
    check('M2: skip leaves the deck empty', Object.keys(skipped.after.deck).length === 0, skipped.after.deck, '{}');
    check('M7: skip starts the next wave and arms the WAVE banner', skipped.after.wave === skipped.before.wave + 1 && skipped.after.waveBanner > 0, { before: skipped.before.wave, after: skipped.after.wave, waveBanner: skipped.after.waveBanner }, 'wave +1, waveBanner > 0');
    await sleep(80);
    const skipDom = await domInfo();
    check(
      'M7: the HUD shows the over-max temporary Shield (Shields: 1/1)',
      skipDom.statusShields === 'Shields: 1/1',
      { statusShields: skipDom.statusShields, shields: skipped.after.shields, shieldMax: skipped.after.shieldMax },
      '"Shields: 1/1"'
    );

    // Reroll: costs the single reroll, does not take a draft.
    await resetRun();
    const rerolled = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      w.beginDraft();
      const before = { pressure: w.pressure(), draftsTaken: s.draftsTaken, left: s.rerollsLeft, offer: (s.offer || []).map((c) => (c ? c.id : null)) };
      const first = w.reroll();
      const mid = { left: s.rerollsLeft, pressure: w.pressure(), draftsTaken: s.draftsTaken, phase: s.phase, offer: (s.offer || []).map((c) => (c ? c.id : null)) };
      const second = w.reroll();
      return { before, first, mid, second, after: { left: s.rerollsLeft, phase: s.phase, pressure: w.pressure(), draftsTaken: s.draftsTaken } };
    });
    check('M2: reroll() re-rolls the offer', rerolled.first === true && rerolled.mid.phase === 'draft' && rerolled.mid.offer.filter(Boolean).length === 3, rerolled, 'true, still drafting, 3 cards');
    check(
      'M2: only one reroll per run',
      rerolled.before.left === 1 && rerolled.mid.left === 0 && rerolled.second === false && rerolled.after.left === 0,
      { before: rerolled.before.left, mid: rerolled.mid.left, second: rerolled.second, after: rerolled.after.left },
      '1 -> 0, second reroll false'
    );
    check('M2: reroll does not count as a draft', rerolled.after.pressure === rerolled.before.pressure && rerolled.after.draftsTaken === rerolled.before.draftsTaken, { before: rerolled.before, after: rerolled.after }, 'pressure/draftsTaken unchanged');

    // Heat changes the score: Reverse is a Hex, so heatMult = 1.25.
    const heatRun = await (async () => {
      await resetRun([{ id: 'reverse' }]);
      const info = await stateInfo();
      check('M2: a Hex raises heat and heatMult', info.heat === 1 && approx(info.heatMult, 1.25), { heat: info.heat, heatMult: info.heatMult }, 'heat 1, heatMult 1.25');
      const run = await clearWithHook('ember');
      return { info, run };
    })();
    const heatExpected = scoreFormula(5, heatRun.run);
    check(
      'M2: heat multiplies the points for a word',
      heatRun.run.cleared && scoreDelta(heatRun.run) === heatExpected,
      { delta: scoreDelta(heatRun.run), expected: heatExpected, before: heatRun.run.before, chars: heatRun.run.chars },
      `round(letters*(10+ledger)*comboMult*heatMult) = ${heatExpected}`
    );
    notes.m2Heat = { heat: heatRun.info.heat, heatMult: heatRun.info.heatMult, expected: heatExpected, got: scoreDelta(heatRun.run) };
  });

  // ═══ M3: card catalogue ════════════════════════════════════════════════
  const EXPECTED_CARDS = {
    'Wide Scope': { id: 'wide-scope', type: 'boon', rarity: 'rare', maxTier: 2 },
    'Overclock': { id: 'overclock', type: 'boon', rarity: 'rare', maxTier: 2 },
    'Grace': { id: 'grace', type: 'boon', rarity: 'common', maxTier: 1 },
    'Steady Hand': { id: 'steady-hand', type: 'boon', rarity: 'common', maxTier: 2 },
    'Slow Drift': { id: 'slow-drift', type: 'boon', rarity: 'common', maxTier: 2 },
    'Greed': { id: 'greed', type: 'gambit', rarity: 'common', maxTier: 2 },
    'Longshot': { id: 'longshot', type: 'gambit', rarity: 'rare', maxTier: 1 },
    'Ledger': { id: 'ledger', type: 'gambit', rarity: 'common', maxTier: 1 },
    'Reverse': { id: 'reverse', type: 'hex', rarity: 'common', maxTier: 1 },
    'Tunnel': { id: 'tunnel', type: 'hex', rarity: 'common', maxTier: 2 },
    'Ghost': { id: 'ghost', type: 'hex', rarity: 'common', maxTier: 1 },
    'Decoy': { id: 'decoy', type: 'hex', rarity: 'rare', maxTier: 2 },
    'Split': { id: 'split', type: 'hex', rarity: 'common', maxTier: 2 },
    // M7 additions (18 cards total).
    'Lifeline': { id: 'lifeline', type: 'boon', rarity: 'rare', maxTier: 1 },
    'Rally': { id: 'rally', type: 'boon', rarity: 'common', maxTier: 2 },
    'Drought': { id: 'drought', type: 'gambit', rarity: 'common', maxTier: 2 },
    'Bargain': { id: 'bargain', type: 'gambit', rarity: 'rare', maxTier: 1 },
    'Second Draft': { id: 'second-draft', type: 'hex', rarity: 'rare', maxTier: 1 },
  };
  const CARD_COUNT = 18;
  const HEX_COUNT = 6;
  const C = {}; // card name -> id
  const catalogue = await wf(() => ({
    cards: window.__wordfall.CARDS.map((c) => ({
      id: c.id, name: c.name, type: c.type, rarity: c.rarity, maxTier: c.maxTier, blurbType: typeof c.blurb,
    })),
    hexTotal: window.__wordfall.hexTotal,
  }));
  {
    const problems = [];
    if (catalogue.cards.length !== CARD_COUNT) problems.push(`expected ${CARD_COUNT} cards, got ${catalogue.cards.length}`);
    const ids = catalogue.cards.map((c) => c.id);
    if (new Set(ids).size !== ids.length) problems.push('duplicate card ids');
    for (const [name, expected] of Object.entries(EXPECTED_CARDS)) {
      const card = catalogue.cards.find((c) => c.name === name);
      if (!card) { problems.push(`missing card "${name}"`); continue; }
      C[name] = card.id;
      for (const field of ['id', 'type', 'rarity', 'maxTier']) {
        if (card[field] !== expected[field]) problems.push(`${name}.${field}: expected ${JSON.stringify(expected[field])}, got ${JSON.stringify(card[field])}`);
      }
      if (card.blurbType !== 'function') problems.push(`${name}.blurb is not a function`);
    }
    check(
      `M7: CARDS list matches the ${CARD_COUNT} SPEC cards (id/type/rarity/maxTier)`,
      problems.length === 0,
      { count: catalogue.cards.length, problems },
      `${CARD_COUNT} cards, exact ids/types/rarities/maxTier`
    );
    const hexCards = catalogue.cards.filter((c) => c.type === 'hex');
    check(
      'M7 cards: Split is the fifth Hex, Second Draft the sixth, hexTotal is generic',
      hexCards.length === HEX_COUNT &&
      !!C['Split'] &&
      catalogue.hexTotal === HEX_COUNT &&
      !!catalogue.cards.find((c) => c.id === C['Split'] && c.blurbType === 'function') &&
      !!catalogue.cards.find((c) => c.id === C['Second Draft'] && c.blurbType === 'function'),
      { hexCards: hexCards.map((c) => c.id), hexTotal: catalogue.hexTotal, split: C['Split'], secondDraft: C['Second Draft'] },
      `${HEX_COUNT} Hex cards incl split + second-draft, window.__wordfall.hexTotal === ${HEX_COUNT}`
    );
  }

  // ═══ M3: per-card effects (forced via grant) ═══════════════════════════
  if (C['Wide Scope']) {
    await section('M3 Wide Scope', async () => {
      const r = await wf(({ id }) => {
        const w = window.__wordfall;
        const s = w.state;
        w.reset();
        s.words.length = 0;
        w.spawnWord('cat', { y: 320 });
        w.spawnWord('dog', { y: 200 });
        w.spawnWord('sun', { y: 80 });
        const before = { set: w.targetSet().length, lowest: w.targetWord() && w.targetWord().text };
        w.grant(id);
        const tier1 = { set: w.targetSet().length, texts: w.targetSet().map((x) => x.text), held: w.heldTier(id) };
        w.grant(id, 2); // debug upgrade path: walks tier I -> tier II
        const tier2 = { set: w.targetSet().length, texts: w.targetSet().map((x) => x.text), held: w.heldTier(id) };
        return { before, tier1, tier2 };
      }, { id: C['Wide Scope'] });
      check(
        'M3 Wide Scope: target set grows 1 -> 2 -> 3',
        r.before.set === 1 && r.tier1.set === 2 && r.tier2.set === 3,
        r,
        '1, 2, 3'
      );
      check('M3 Wide Scope: tier II via grant', r.tier2.held === 2 && r.tier1.held === 1, { tier1Held: r.tier1.held, tier2Held: r.tier2.held }, 'heldTier 1 then 2');
    });
  }

  if (C['Wide Scope']) {
    await section('M3 Lock-on', async () => {
      const r = await wf(({ wide }) => {
        const w = window.__wordfall;
        const s = w.state;
        w.reset();
        w.grant(wide);
        s.words.length = 0;
        const cat = w.spawnWord('cat', { y: 300 });
        const cow = w.spawnWord('cow', { y: 150 });
        const setBefore = w.targetSet().map((x) => x.text);
        w.typeLetter('c');
        const afterFirst = { cat: cat.progress, cow: cow.progress, locked: s.lockWord ? s.lockWord.text : null, targetSet: w.targetSet().map((x) => x.text) };
        w.typeLetter('o');
        const afterSecond = { cat: cat.progress, cow: cow.progress, locked: s.lockWord ? s.lockWord.text : null, combo: s.combo, cleared: s.cleared };
        return { setBefore, afterFirst, afterSecond };
      }, { wide: C['Wide Scope'] });
      check(
        'M3 Lock-on: first correct letter locks the target word',
        r.setBefore.length === 2 && r.afterFirst.cat === 1 && r.afterFirst.cow === 0 && r.afterFirst.locked === 'cat' && r.afterFirst.targetSet.length === 1,
        r,
        'targetSet [cat,cow] -> lockWord cat, cat.progress 1, cow 0'
      );
      check(
        'M3 Lock-on: locked word rejects a letter that matches another word in the set',
        r.afterSecond.cow === 0 && r.afterSecond.cat === 1 && r.afterSecond.locked === 'cat',
        r.afterSecond,
        'cow stays 0, cat stays 1'
      );
    });
  }

  if (C['Overclock']) {
    const overclockRun = (tier, clears) => wf(({ id, tier, clears }) => {
      const w = window.__wordfall;
      const s = w.state;
      w.reset();
      w.grant(id, tier);
      const steps = [];
      for (let i = 0; i < clears; i++) {
        s.words.length = 0;
        w.spawnWord('cat', { y: 300 });
        w.spawnWord('dog', { y: 100 });
        const before = { cleared: s.cleared, combo: s.combo, score: s.score, waveCleared: s.waveCleared };
        const target = w.targetWord();
        let guard = 0;
        while (guard++ < 24 && target && s.words.indexOf(target) >= 0) {
          const ch = w.nextChar(target);
          if (ch == null) break;
          w.typeLetter(ch);
        }
        steps.push({ before, after: { cleared: s.cleared, combo: s.combo, score: s.score, waveCleared: s.waveCleared } });
      }
      return { steps, final: { cleared: s.cleared, combo: s.combo, waveCleared: s.waveCleared, phase: s.phase } };
    }, { id: C['Overclock'], tier, clears });

    await section('M3 Overclock', async () => {
      const one = await overclockRun(1, 5);
      const lastOne = one.steps[one.steps.length - 1];
      const dOne = { cleared: lastOne.after.cleared - lastOne.before.cleared, combo: lastOne.after.combo - lastOne.before.combo };
      const singlesOk = one.steps.slice(0, 4).every((st) => st.after.cleared - st.before.cleared === 1);
      check(
        'M3 Overclock: every 5th clear auto-clears the next target (tier I)',
        singlesOk && dOne.cleared === 2 && one.final.cleared === 6 && one.final.phase === 'playing',
        { steps: one.steps, final: one.final },
        '5th clear removes 2 words; 6 cleared total'
      );
      check('M3 Overclock: auto-clears give points but no combo', dOne.combo === 1 && lastOne.after.score > lastOne.before.score, { delta: dOne, score: [lastOne.before.score, lastOne.after.score] }, 'combo +1 (manual only), score rises');

      const two = await overclockRun(2, 4);
      const lastTwo = two.steps[two.steps.length - 1];
      const dTwo = { cleared: lastTwo.after.cleared - lastTwo.before.cleared, combo: lastTwo.after.combo - lastTwo.before.combo };
      check(
        'M3 Overclock: tier II auto-clears every 4th clear',
        dTwo.cleared === 2 && dTwo.combo === 1 && two.final.cleared === 5,
        { steps: two.steps, final: two.final },
        '4th clear removes 2 words; 5 cleared total'
      );
    });
  }

  if (C['Grace']) {
    await section('M3 Grace', async () => {
      const r = await wf(({ id }) => {
        const w = window.__wordfall;
        const s = w.state;
        w.reset();
        const before = s.lives;
        w.grant(id);
        const after = s.lives;
        w.grant(id);
        return { before, after, after2: s.lives, held: w.heldTier(id), maxTier: w.CARDS.find((c) => c.id === id).maxTier, startLives: w.CFG.startLives };
      }, { id: C['Grace'] });
      check('M3 Grace: +1 Life', r.before === r.startLives && r.after === r.before + 1, r, `${r.before} -> ${r.before + 1}`);
      check('M3 Grace: maxTier 1, picking again cannot stack lives', r.held === 1 && r.after2 === r.after, r, 'lives unchanged, heldTier 1');
    });
  }

  if (C['Steady Hand']) {
    await section('M3 Steady Hand', async () => {
      const r = await wf(({ id }) => {
        const w = window.__wordfall;
        const s = w.state;
        w.reset();
        w.grant(id);
        const tier1 = { shieldMax: s.shieldMax, shields: s.shields, held: w.heldTier(id) };
        w.grant(id, 2); // upgrade: tier II adds +2 shields on top of tier I
        const tier2 = { shieldMax: s.shieldMax, shields: s.shields, held: w.heldTier(id) };
        return { tier1, tier2, maxShields: w.CFG.maxShields };
      }, { id: C['Steady Hand'] });
      check('M3 Steady Hand: +1 Shield at tier I', r.tier1.shieldMax === 1 && r.tier1.shields === 1, r.tier1, 'shieldMax 1, shields 1');
      check('M3 Steady Hand: tier II adds +2 (shieldMax 3 total)', r.tier2.shieldMax === 3 && r.tier2.shields === 3 && r.tier2.shieldMax <= r.maxShields, r, 'shieldMax 3, shields 3');

      const consume = await wf(({ id }) => {
        const w = window.__wordfall;
        const s = w.state;
        w.reset();
        w.grant(id, 2);
        s.words.length = 0;
        const word = w.spawnWord('ember', { y: 200 });
        let guard = 0;
        while (guard++ < 16 && s.words.indexOf(word) >= 0) {
          const ch = w.nextChar(word);
          if (ch == null) break;
          w.typeLetter(ch);
        }
        const comboBefore = s.combo;
        const shieldsBefore = s.shields;
        s.words.length = 0;
        const target = w.spawnWord('dog', { y: 200 });
        const correct = w.nextChar(target);
        const wrong = correct === 'z' ? 'y' : 'z';
        w.typeLetter(wrong);
        return { comboBefore, comboAfter: s.combo, shieldsBefore, shieldsAfter: s.shields, lives: s.lives, cleared: s.cleared };
      }, { id: C['Steady Hand'] });
      check(
        'M3 Shield: eats one wrong key, keeps the combo',
        consume.comboBefore > 0 && consume.comboAfter === consume.comboBefore && consume.shieldsAfter === consume.shieldsBefore - 1,
        consume,
        'combo unchanged, shields -1'
      );
    });
  }

  if (C['Slow Drift']) {
    await section('M3 Slow Drift', async () => {
      const r = await wf(({ id }) => {
        const w = window.__wordfall;
        w.reset();
        const base = w.speedMult();
        w.grant(id);
        const t1 = w.speedMult();
        w.grant(id, 2);
        const t2 = w.speedMult();
        return { base, t1, t2, held: w.heldTier(id) };
      }, { id: C['Slow Drift'] });
      check('M3 Slow Drift: fall speed x0.85 at tier I', approx(r.base, 1) && approx(r.t1, 0.85), r, '1 -> 0.85');
      check('M3 Slow Drift: fall speed x0.75 at tier II', approx(r.t2, 0.75) && r.held === 2, r, '0.75, heldTier 2');
    });
  }

  if (C['Greed']) {
    await section('M3 Greed', async () => {
      await resetRun([{ id: C['Greed'] }]);
      const t1 = await stateInfo();
      const run1 = await clearWithHook('ember');
      const expected1 = scoreFormula(5, run1, { greedMult: 1.4 });
      check('M3 Greed: fall speed x1.03 and score x1.4 (tier I)', approx(t1.speedMult, 1.03) && run1.cleared && scoreDelta(run1) === expected1, { speedMult: t1.speedMult, delta: scoreDelta(run1), expected: expected1 }, 'speedMult 1.03, score x1.4');

      await wf(({ id }) => window.__wordfall.grant(id, 2), { id: C['Greed'] });
      const t2 = await stateInfo();
      const run2 = await clearWithHook('ember');
      const expected2 = scoreFormula(5, run2, { greedMult: 1.7 });
      check('M3 Greed: tier II speed x1.06 and score x1.7', t2.deck[ C['Greed'] ] === 2 && approx(t2.speedMult, 1.06) && run2.cleared && scoreDelta(run2) === expected2, { deck: t2.deck, speedMult: t2.speedMult, delta: scoreDelta(run2), expected: expected2, before: run2.before }, 'heldTier 2, speedMult 1.06, score x1.7');
    });
  }

  if (C['Longshot']) {
    await section('M3 Longshot', async () => {
      await resetRun([{ id: C['Longshot'] }]);
      // M7: 7+ letter words fall 5% faster (was 20%).
      const fall = await wf(() => {
        const w = window.__wordfall;
        const s = w.state;
        s.words.length = 0;
        const long = w.spawnWord('lantern', { y: 40 });
        const short = w.spawnWord('ember', { y: 40 });
        return { longId: long.id, shortId: short.id, longY: long.y, shortY: short.y };
      });
      await sleep(600);
      const fall2 = await wf(({ longId, shortId }) => {
        const s = window.__wordfall.state;
        const long = s.words.find((w) => w.id === longId);
        const short = s.words.find((w) => w.id === shortId);
        return { longY: long ? long.y : null, shortY: short ? short.y : null, phase: s.phase };
      }, fall);
      const longDelta = fall2.longY == null ? 0 : fall2.longY - fall.longY;
      const shortDelta = fall2.shortY == null ? 0 : fall2.shortY - fall.shortY;
      const longRatio = shortDelta > 0 ? longDelta / shortDelta : 0;
      check(
        'M7 Longshot: 7+ letter words fall x1.05 (was x1.2)',
        fall2.phase === 'playing' && shortDelta > 8 && longRatio >= 1.02 && longRatio <= 1.09,
        { longDelta, shortDelta, ratio: Number(longRatio.toFixed(4)) },
        'ratio in [1.02, 1.09] (nominal 1.05)'
      );
      await resetRun([{ id: C['Longshot'] }]);
      const long = await clearWithHook('lantern');
      const expectedLong = scoreFormula(7, long, { longshot: true });
      check('M3 Longshot: 7+ letter word scores x2', long.cleared && scoreDelta(long) === expectedLong, { delta: scoreDelta(long), expected: expectedLong, before: long.before }, `round(7*10*comboMult*heatMult*2) = ${expectedLong}`);
      const short = await clearWithHook('ember');
      const expectedShort = scoreFormula(5, short);
      check('M3 Longshot: under 7 letters scores normally', short.cleared && scoreDelta(short) === expectedShort, { delta: scoreDelta(short), expected: expectedShort, before: short.before }, `round(5*10*comboMult*heatMult) = ${expectedShort}`);
    });
  }

  if (C['Ledger']) {
    await section('M3 Ledger', async () => {
      const r = await wf(({ id }) => {
        const w = window.__wordfall;
        w.reset();
        const before = { pressure: w.pressure(), bucket: w.bucketPressure(), range: w.wordRange() };
        w.grant(id);
        return { before, after: { pressure: w.pressure(), bucket: w.bucketPressure(), range: w.wordRange(), held: w.heldTier(id) } };
      }, { id: C['Ledger'] });
      check(
        'M7 Ledger: no +8 bucket-pressure surcharge (pressure and bucket unchanged)',
        r.after.bucket === r.before.bucket && r.after.pressure === r.before.pressure && r.after.held === 1,
        r,
        'bucketPressure unchanged (the M6 +8 was removed), pressure unchanged'
      );
      check('M3 Ledger: bucket ramp keeps 7+ letter words out of range at 0 clears', r.after.range[1] < 7, r.after.range, 'wordRange max < 7 (Longshot stays ineligible)');
      const run = await clearWithHook('ember');
      const expected = scoreFormula(5, run, { ledger: true });
      check('M3 Ledger: +2 points per letter', run.cleared && scoreDelta(run) === expected, { delta: scoreDelta(run), expected, before: run.before }, `round(5*(10+2)*comboMult*heatMult) = ${expected}`);
    });
  }

  // ═══ M7: the five new cards ═════════════════════════════════════════════
  if (C['Lifeline']) {
    await section('M7 Lifeline', async () => {
      const setup = await wf(({ id }) => {
        const w = window.__wordfall;
        const s = w.state;
        w.reset(8801);
        w.grant(id);
        const before = { lives: s.lives, used: s.lifelineUsed, held: w.heldTier(id) };
        s.words.length = 0;
        const word = w.spawnWord('cat', { y: s.groundY - 6 });
        return { before, wordId: word.id, groundY: s.groundY };
      }, { id: C['Lifeline'] });
      await page.waitForFunction(
        (id) => !window.__wordfall.state.words.some((w) => w.id === id),
        setup.wordId,
        { timeout: 5000 }
      );
      const saved = await wf(({ wordId }) => {
        const w = window.__wordfall;
        const s = w.state;
        return { phase: s.phase, lives: s.lives, used: s.lifelineUsed, gone: !s.words.some((x) => x.id === wordId) };
      }, { wordId: setup.wordId });
      check(
        'M7 Lifeline: the first word to reach the line is destroyed, life kept',
        saved.phase === 'playing' && saved.lives === setup.before.lives && saved.used === true && saved.gone,
        { setup, saved },
        "phase 'playing', lives unchanged, lifelineUsed true"
      );
      const second = await wf(() => {
        const w = window.__wordfall;
        const s = w.state;
        s.words.length = 0;
        w.spawnWord('dog', { y: s.groundY - 6 });
        return { lives: s.lives };
      });
      await page.waitForFunction(() => window.__wordfall.state.phase === 'gameover', null, { timeout: 5000 });
      const dead = await wf(() => ({ phase: window.__wordfall.state.phase, lives: window.__wordfall.state.lives }));
      check(
        'M7 Lifeline: it saves exactly one life per run',
        dead.phase === 'gameover' && dead.lives === 0 && second.lives === 1,
        { second, dead },
        'second word reaches the line -> gameover'
      );
    });
  }

  if (C['Rally']) {
    await section('M7 Rally', async () => {
      const r = await wf(({ id }) => {
        const w = window.__wordfall;
        const s = w.state;
        w.reset(8802);
        s.cleared = 22; // pressure 22, before the first draft
        const base = { pressure: w.pressure(), bucket: w.bucketPressure(), range: w.wordRange() };
        w.grant(id);
        const tier1 = { bucket: w.bucketPressure(), range: w.wordRange(), held: w.heldTier(id), scoreMult: w.scoreMult() };
        w.grant(id, 2);
        const tier2 = { bucket: w.bucketPressure(), range: w.wordRange(), held: w.heldTier(id), scoreMult: w.scoreMult() };
        return { base, tier1, tier2 };
      }, { id: C['Rally'] });
      check(
        'M7 Rally: word length reads 10 less Pressure (tier I)',
        r.base.pressure === 22 && r.base.bucket === 22 && r.tier1.bucket === 12 && r.tier1.held === 1,
        r,
        'bucketPressure 22 -> 12 at pressure 22'
      );
      check(
        'M7 Rally: tier II reads 18 less Pressure',
        r.tier2.bucket === 4 && r.tier2.held === 2,
        r.tier2,
        'bucketPressure 4 at pressure 22'
      );
      check(
        'M7 Rally: the lower bucket shifts the word-length band',
        r.base.range[0] === 4 && r.tier1.range[1] === 6 && r.tier2.range[1] === 5,
        { base: r.base.range, tier1: r.tier1.range, tier2: r.tier2.range },
        'range 4-6 -> 3-6 -> 3-5'
      );
    });
  }

  if (C['Drought']) {
    await section('M7 Drought', async () => {
      const r = await wf(({ id }) => {
        const w = window.__wordfall;
        w.reset(8803);
        const base = { interval: w.spawnInterval(), scoreMult: w.scoreMult() };
        w.grant(id);
        const tier1 = { interval: w.spawnInterval(), scoreMult: w.scoreMult(), held: w.heldTier(id) };
        w.grant(id, 2);
        const tier2 = { interval: w.spawnInterval(), scoreMult: w.scoreMult(), held: w.heldTier(id) };
        return { base, tier1, tier2 };
      }, { id: C['Drought'] });
      check(
        'M7 Drought: spawn interval x1.15 and score x0.9 (tier I)',
        approx(r.tier1.interval, r.base.interval * 1.15, 1e-9) && approx(r.tier1.scoreMult, 0.9) && r.tier1.held === 1,
        r,
        'interval x1.15, scoreMult 0.9'
      );
      check(
        'M7 Drought: spawn interval x1.2 and score x0.85 (tier II)',
        approx(r.tier2.interval, r.base.interval * 1.2, 1e-9) && approx(r.tier2.scoreMult, 0.85) && r.tier2.held === 2,
        r.tier2,
        'interval x1.2, scoreMult 0.85'
      );
    });
  }

  if (C['Bargain']) {
    await section('M7 Bargain', async () => {
      const r = await wf(({ id }) => {
        const w = window.__wordfall;
        const s = w.state;
        w.reset(8804);
        const base = { scoreMult: w.scoreMult() };
        w.grant(id);
        const held = { scoreMult: w.scoreMult(), tier: w.heldTier(id) };
        w.beginDraft();
        const before = { score: s.score, pressure: w.pressure(), wave: s.wave, shields: s.shields };
        const ok = w.skip();
        return {
          base, held, ok, before,
          after: { score: s.score, pressure: w.pressure(), wave: s.wave, shields: s.shields, phase: s.phase },
        };
      }, { id: C['Bargain'] });
      check('M7 Bargain: score x2', approx(r.held.scoreMult, 2) && r.held.scoreMult === r.base.scoreMult * 2 && r.held.tier === 1, { base: r.base, held: r.held }, 'scoreMult 1 -> 2');
      check(
        'M7 Bargain: Skip pays no points (pressure/draft rules unchanged)',
        r.ok === true && r.after.score === r.before.score && r.after.pressure === r.before.pressure + 4 && r.after.wave === r.before.wave + 1 && r.after.shields === r.before.shields + 1,
        r,
        'score +0, pressure +4, wave +1, +1 Shield'
      );
    });
  }

  if (C['Second Draft']) {
    await section('M7 Second Draft', async () => {
      const r = await wf(({ id }) => {
        const w = window.__wordfall;
        w.reset(8805);
        const before = { rerolls: w.rerollsLeft(), held: w.heldTier(id) };
        w.grant(id);
        const after = { rerolls: w.rerollsLeft(), held: w.heldTier(id), maxTier: w.CARDS.find((c) => c.id === id).maxTier };
        w.beginDraft();
        const first = w.reroll();
        const mid = w.rerollsLeft();
        const second = w.reroll();
        return { before, after, first, mid, second, finalLeft: w.rerollsLeft() };
      }, { id: C['Second Draft'] });
      check(
        'M7 Second Draft: +1 reroll for the run',
        r.before.rerolls === 1 && r.after.rerolls === 2 && r.after.held === 1 && r.after.maxTier === 1,
        r,
        'reroll 1 -> 2, heldTier 1'
      );
      check(
        'M7 Second Draft: both rerolls are usable in one draft',
        r.first === true && r.mid === 1 && r.second === true && r.finalLeft === 0,
        { first: r.first, mid: r.mid, second: r.second, finalLeft: r.finalLeft },
        '1 -> 0 after two rerolls'
      );
      await wf(() => window.__wordfall.skip());
    });
  }

  if (C['Reverse']) {
    await section('M3 Reverse', async () => {
      const r = await wf(({ id }) => {
        const w = window.__wordfall;
        const s = w.state;
        w.reset();
        w.grant(id);
        s.words.length = 0;
        const word = w.spawnWord('ember', { y: 200 });
        const next = w.nextChar(word);
        const last = word.text[word.text.length - 1];
        const before = { score: s.score, comboMult: w.comboMultiplier(), heatMult: w.heatMult() };
        let guard = 0;
        while (guard++ < 16 && s.words.indexOf(word) >= 0) {
          const ch = w.nextChar(word);
          if (ch == null) break;
          w.typeLetter(ch);
        }
        return { next, last, before, after: { score: s.score }, cleared: s.words.indexOf(word) < 0, heat: w.heat() };
      }, { id: C['Reverse'] });
      check('M3 Reverse: nextChar is the last letter', r.next === r.last && r.next === 'r', { next: r.next, last: r.last }, "'r'");
      const expected = Math.round(5 * 10 * r.before.comboMult * r.before.heatMult);
      check('M3 Reverse: clears right-to-left and scores with heat', r.cleared && r.after.score - r.before.score === expected, { cleared: r.cleared, delta: r.after.score - r.before.score, expected, before: r.before }, `rounded ${expected}`);
    });
  }

  if (C['Tunnel']) {
    await section('M3 Tunnel', async () => {
      const r = await wf(({ id }) => {
        const w = window.__wordfall;
        w.reset();
        const base = w.visibleCount();
        w.grant(id);
        const tier1 = w.visibleCount();
        w.grant(id, 2);
        const tier2 = w.visibleCount();
        return { base, tier1, tier2, held: w.heldTier(id) };
      }, { id: C['Tunnel'] });
      check('M3 Tunnel: 3 visible letters at tier I', r.base === 0 && r.tier1 === 3, r, '0 -> 3');
      check('M3 Tunnel: 2 visible letters at tier II', r.tier2 === 2 && r.held === 2, r, '2, heldTier 2');
    });
  }

  if (C['Ghost']) {
    await section('M3 Ghost', async () => {
      const r = await wf(({ id }) => {
        const w = window.__wordfall;
        const s = w.state;
        w.reset();
        w.grant(id);
        s.words.length = 0;
        const word = w.spawnWord('cat', { y: 200 });
        w.typeLetter('c');
        w.typeLetter('a');
        w.typeLetter('t');
        const echoes = s.echoes.slice();
        return {
          cleared: s.cleared,
          echoCount: echoes.length,
          echo: echoes[0] ? { text: echoes[0].text, ttl: echoes[0].ttl, t: echoes[0].t } : null,
          wordsLeft: s.words.length,
          targetSetHasEcho: w.targetSet().some((t) => echoes.indexOf(t) >= 0),
          phase: s.phase,
        };
      }, { id: C['Ghost'] });
      check('M3 Ghost: clearing a word leaves one inert echo', r.cleared === 1 && r.echoCount === 1 && r.echo && r.echo.text === 'cat' && r.wordsLeft === 0 && !r.targetSetHasEcho, r, '1 echo, text cat, not targetable');
      check('M3 Ghost: echo lifetime is 3 s', r.echo && approx(r.echo.ttl, 3, 1e-6), r.echo, 'ttl 3');
      await sleep(3400);
      const decay = await stateInfo();
      check('M3 Ghost: the echo decays after ~3 s', decay.echoes.length === 0 && decay.phase === 'playing', { echoes: decay.echoes, phase: decay.phase }, '0 echoes');
    });
  }

  if (C['Decoy']) {
    await section('M3 Decoy', async () => {
      const rates = await wf(({ id }) => {
        const w = window.__wordfall;
        const s = w.state;
        const sample = (tier, count, seed) => {
          w.reset();
          w.grant(id, tier);
          w.setSeed(seed);
          let fakes = 0;
          let total = 0;
          const texts = [];
          for (let i = 0; i < count; i++) {
            s.words.length = 0;                 // keep spawnOne() from hitting maxWords
            const word = w.spawnOne();
            if (!word) continue;
            total++;
            if (word.fake) {
              fakes++;
              if (texts.length < 5) texts.push(word.text);
            }
          }
          return { tier, count, total, fakes, rate: total ? fakes / total : 0, sampleFakes: texts };
        };
        return { tier1: sample(1, 400, 7701), tier2: sample(2, 400, 7702) };
      }, { id: C['Decoy'] });
      check(
        'M3 Decoy: about 1 in 8 natural spawns is a fake (tier I)',
        rates.tier1.total >= 380 && rates.tier1.rate >= 1 / 12 && rates.tier1.rate <= 0.22,
        rates.tier1,
        '400 seeded spawnOne() samples, rate in [1/12, 22%]'
      );
      check(
        'M3 Decoy: about 1 in 5 natural spawns is a fake (tier II)',
        rates.tier2.total >= 380 && rates.tier2.rate >= 0.13 && rates.tier2.rate <= 0.28 && rates.tier2.rate > rates.tier1.rate,
        rates.tier2,
        'rate in [13%, 28%] and above tier I'
      );

      // A fake as the lowest word turns every key into a mistake.
      const fakeMistake = await wf(({ id }) => {
        const w = window.__wordfall;
        const s = w.state;
        w.reset();
        w.grant(id);
        s.words.length = 0;
        const real = w.spawnWord('cat', { y: 200 });
        w.typeLetter('c');
        w.typeLetter('a');
        w.typeLetter('t');
        const comboAfterClear = s.combo;
        const clearedAfterClear = s.cleared;
        s.words.length = 0;
        const fake = w.spawnWord('wrod', { fake: true, y: 300 });
        w.typeLetter('w');                       // matches the text, but a fake is lowest
        return {
          isFake: w.isFake(fake),
          comboAfterClear,
          comboAfterFakeKey: s.combo,
          progress: fake.progress,
          clearedAfterClear,
          cleared: s.cleared,
          lives: s.lives,
        };
      }, { id: C['Decoy'] });
      check(
        'M3 Decoy: while a fake is the lowest word every key is a mistake',
        fakeMistake.isFake && fakeMistake.comboAfterClear === 1 && fakeMistake.comboAfterFakeKey === 0 && fakeMistake.progress === 0 && fakeMistake.cleared === fakeMistake.clearedAfterClear,
        fakeMistake,
        'combo 1 -> 0, fake progress 0, no clear'
      );

      // Fakes fall through the danger line harmlessly.
      const setup = await wf(({ id }) => {
        const w = window.__wordfall;
        const s = w.state;
        w.reset();
        w.grant(id);
        s.words.length = 0;
        const fake = w.spawnWord('wrod', { fake: true, y: 100 });
        fake.y = s.groundY - 5;
        return { livesBefore: s.lives, fakeId: fake.id, phase: s.phase };
      }, { id: C['Decoy'] });
      await sleep(450);
      const after = await wf((fakeId) => {
        const w = window.__wordfall;
        const s = w.state;
        return { phase: s.phase, lives: s.lives, ids: s.words.map((x) => x.id), cleared: s.cleared, fakeOnBoard: s.words.some((x) => x.fake) };
      }, setup.fakeId);
      check(
        'M3 Decoy: fakes fall through the line harmlessly',
        after.phase === 'playing' && after.lives === setup.livesBefore && after.ids.indexOf(setup.fakeId) < 0,
        { setup, after },
        'life lost: none, phase playing, fake removed'
      );
    });
  }

  // ═══ M3: all six Hexes raise heat (and score) by tier ═════════════════
  const hexNames = ['Reverse', 'Tunnel', 'Ghost', 'Decoy', 'Split', 'Second Draft'].filter((n) => C[n]);
  for (const name of hexNames) {
    await section(`M3 ${name} heat`, async () => {
      const t1 = await wf(({ id }) => {
        const w = window.__wordfall;
        w.reset();
        const base = { heat: w.heat(), heatMult: w.heatMult(), visible: w.visibleCount() };
        w.grant(id);
        return { base, heat: w.heat(), heatMult: w.heatMult(), held: w.heldTier(id) };
      }, { id: C[name] });
      check(`M3 ${name}: tier I raises heat to 1 (heatMult 1.25)`, t1.base.heat === 0 && t1.heat === 1 && approx(t1.heatMult, 1.25), t1, 'heat 1, heatMult 1.25');

      const run1 = await clearWithHook('ember');
      const expected1 = Math.round(5 * 10 * run1.before.comboMult * run1.before.heatMult);
      check(
        `M3 ${name}: tier I score is multiplied by heatMult`,
        run1.cleared && scoreDelta(run1) === expected1,
        { delta: scoreDelta(run1), expected: expected1, before: run1.before },
        `round(5*10*comboMult*heatMult) = ${expected1}`
      );

      const maxTier = EXPECTED_CARDS[name].maxTier;
      if (maxTier >= 2) {
        const t2 = await wf(({ id }) => {
          const w = window.__wordfall;
          w.grant(id, 2);
          return { heat: w.heat(), heatMult: w.heatMult(), held: w.heldTier(id) };
        }, { id: C[name] });
        check(`M3 ${name}: tier II counts as two Hexes (heat 2, heatMult 1.5)`, t2.heat === 2 && approx(t2.heatMult, 1.5) && t2.held === 2, t2, 'heat 2, heatMult 1.5');
        const run2 = await clearWithHook('ember');
        const expected2 = Math.round(5 * 10 * run2.before.comboMult * run2.before.heatMult);
        check(
          `M3 ${name}: tier II score is multiplied by heatMult`,
          run2.cleared && scoreDelta(run2) === expected2,
          { delta: scoreDelta(run2), expected: expected2, before: run2.before },
          `round(5*10*comboMult*heatMult) = ${expected2}`
        );
      }
    });
  }

  if (hexNames.length === HEX_COUNT) {
    await section('M3 Hex heat aggregate', async () => {
      const r = await wf(({ ids }) => {
        const w = window.__wordfall;
        w.reset();
        for (const id of ids) w.grant(id, 1);
        const tier1 = { heat: w.heat(), heatMult: w.heatMult() };
        w.grant(ids[1], 2); // tunnel
        w.grant(ids[3], 2); // decoy
        return { tier1, tier2: { heat: w.heat(), heatMult: w.heatMult() } };
      }, { ids: [C['Reverse'], C['Tunnel'], C['Ghost'], C['Decoy'], C['Split'], C['Second Draft']] });
      check('M3 Hex heat: all six Hexes stack (heat 6, heatMult 2.5)', r.tier1.heat === 6 && approx(r.tier1.heatMult, 2.5), r.tier1, 'heat 6, heatMult 2.5');
      check('M3 Hex heat: tier II Hexes count twice (heat 8, heatMult 3.0)', r.tier2.heat === 8 && approx(r.tier2.heatMult, 3.0), r.tier2, 'heat 8, heatMult 3.0');
      const run = await clearWithHook('ember');
      const expected = Math.round(5 * 10 * run.before.comboMult * run.before.heatMult);
      check('M3 Hex heat: stack multiplies the score', run.cleared && scoreDelta(run) === expected, { delta: scoreDelta(run), expected, before: run.before }, `expected ${expected}`);
    });
  }

  // ═══ M3: eligibility filter over seeded drafts ═════════════════════════
  await section('M3 draft eligibility', async () => {
    const allGrants = Object.values(EXPECTED_CARDS).map((c) => ({ id: c.id, tier: c.maxTier }));
    const hexCardIds = Object.values(EXPECTED_CARDS).filter((c) => c.type === 'hex').map((c) => c.id);
    const scenarios = [
      { name: 'fresh', count: 200, cleared: 0, seedBase: 10000, grants: [] },
      { name: 'lives3', count: 150, cleared: 0, seedBase: 20000, grants: [], lives: 3 },
      { name: 'shield3', count: 150, cleared: 0, seedBase: 30000, grants: [{ id: C['Steady Hand'], tier: 2 }] },
      { name: 'high-pressure', count: 150, cleared: 200, seedBase: 40000, grants: [] },
      { name: 'scope1', count: 150, cleared: 30, seedBase: 50000, grants: [{ id: C['Wide Scope'], tier: 1 }] },
      { name: 'maxed', count: 100, cleared: 200, seedBase: 60000, grants: allGrants },
      { name: 'all-hexes', count: 150, cleared: 100, seedBase: 70000, grants: hexCardIds.map((id) => ({ id, tier: 1 })) },
    ];
    const result = await wf(({ scenarios, ids, hexIds }) => {
      const w = window.__wordfall;
      const violations = [];
      const offeredCount = {};
      const scenarioState = {};
      const samples = [];
      let drafts = 0;
      let nullSlotCount = 0;
      let offerCount = 0;
      let slot2Offers = 0;
      let slot2Boons = 0;
      let slot3Offers = 0;
      let slot3Rares = 0;
      const deadByScenario = {};
      const violate = (rule, detail) => {
        if (violations.length < 200) violations.push(Object.assign({ rule }, detail));
      };

      for (const sc of scenarios) {
        for (let i = 0; i < sc.count; i++) {
          w.reset();
          w.setSeed(sc.seedBase + i);
          const s = w.state;
          if (sc.cleared != null) s.cleared = sc.cleared;
          if (sc.lives != null) s.lives = sc.lives;
          for (const g of sc.grants) w.grant(g.id, g.tier);
          const snap = {
            lives: s.lives,
            shieldMax: s.shieldMax,
            pressure: w.pressure(),
            bucket: w.bucketPressure(),
            range: w.wordRange(),
            held: Object.assign({}, s.deck),
          };
          if (!scenarioState[sc.name]) scenarioState[sc.name] = snap;
          w.beginDraft();
          drafts++;
          if (s.phase !== 'draft') {
            violate('beginDraft() enters the draft phase', { scenario: sc.name, seed: sc.seedBase + i, phase: s.phase });
            continue;
          }
          const offer = s.offer || [];
          offerCount++;
          const held = Object.assign({}, s.deck);
          const cards = offer.filter(Boolean);
          const cardIds = cards.map((c) => c.id);
          if (offer.length !== 3) violate('offer has exactly 3 slots', { scenario: sc.name, seed: sc.seedBase + i, length: offer.length });
          if (new Set(cardIds).size !== cardIds.length) violate('no duplicate card ids in one offer', { scenario: sc.name, seed: sc.seedBase + i, cardIds });
          if (!offer[0]) nullSlotCount += 1;
          if (cards.length === 0) deadByScenario[sc.name] = (deadByScenario[sc.name] || 0) + 1;
          if (offer[1]) {
            slot2Offers += 1;
            if (offer[1].type === 'boon') slot2Boons += 1;
          }
          if (offer[2]) {
            slot3Offers += 1;
            if (offer[2].rarity === 'rare') slot3Rares += 1;
          }
          if (offer[0] && offer[0].type !== 'boon') violate('slot 1 is a Boon', { scenario: sc.name, seed: sc.seedBase + i, card: offer[0].id, type: offer[0].type });
          if (offer[2] && offer[2].type !== 'hex' && offer[2].type !== 'gambit') violate('slot 3 is a Hex or Gambit', { scenario: sc.name, seed: sc.seedBase + i, card: offer[2].id, type: offer[2].type });
          if (sc.name === 'maxed' && cards.length > 0) violate('no cards offered when every card is at max tier', { scenario: sc.name, seed: sc.seedBase + i, cardIds });
          for (const card of cards) {
            offeredCount[card.id] = (offeredCount[card.id] || 0) + 1;
            const heldTier = held[card.id] || 0;
            if (card.tier !== heldTier + 1) violate('offered tier is heldTier + 1', { scenario: sc.name, seed: sc.seedBase + i, card: card.id, tier: card.tier, heldTier });
            if (heldTier >= card.maxTier) violate('a card already at max tier is never offered', { scenario: sc.name, seed: sc.seedBase + i, card: card.id, tier: card.tier, maxTier: card.maxTier });
            if (card.id === ids['Grace'] && snap.lives >= 3) violate('Grace is not offered when lives >= 3', { scenario: sc.name, seed: sc.seedBase + i, lives: snap.lives });
            if (card.id === ids['Steady Hand'] && snap.shieldMax >= 3) violate('Steady Hand is not offered when shieldMax >= 3', { scenario: sc.name, seed: sc.seedBase + i, shieldMax: snap.shieldMax });
            if (card.id === ids['Longshot'] && snap.range[1] < 7) violate('Longshot is not offered when the word range max < 7', { scenario: sc.name, seed: sc.seedBase + i, range: snap.range });
            if (card.type === 'hex' && held[card.id] === 0 && hexIds.every((id) => (held[id] || 0) >= 1)) violate('a new Hex is not offered when every Hex is held', { scenario: sc.name, seed: sc.seedBase + i, card: card.id });
          }
          if (samples.length < 8) samples.push({ scenario: sc.name, offer: offer.map((c) => (c ? { id: c.id, type: c.type, tier: c.tier } : null)) });
          const beforeSkip = { pressure: w.pressure(), draftsTaken: s.draftsTaken };
          w.skip();
          if (s.phase !== 'playing') violate('skip() resumes play', { scenario: sc.name, seed: sc.seedBase + i, phase: s.phase });
          if (w.pressure() !== beforeSkip.pressure + 4) violate('skip() raises pressure by 4', { scenario: sc.name, seed: sc.seedBase + i });
          if (s.draftsTaken !== beforeSkip.draftsTaken + 1) violate('skip() counts as a draft', { scenario: sc.name, seed: sc.seedBase + i });
        }
      }
      return {
        drafts,
        offerCount,
        nullSlotCount,
        slot2Offers,
        slot2Boons,
        slot3Offers,
        slot3Rares,
        deadByScenario,
        violations: violations.slice(0, 40),
        violationCount: violations.length,
        offeredCount,
        scenarioState,
        samples,
      };
    }, { scenarios, ids: Object.fromEntries(Object.entries(C)), hexIds: hexCardIds });

    check(
      'M3 eligibility: no ineligible card offered across seeded drafts',
      result.violationCount === 0,
      { drafts: result.drafts, scenarioCount: scenarios.length, violationCount: result.violationCount, violations: result.violations },
      '0 violations across seeded beginDraft() offers'
    );
    check(
      'M7 eligibility: no dead drafts (except the deliberately maxed deck)',
      scenarios.filter((sc) => sc.name !== 'maxed').reduce((n, sc) => n + (result.deadByScenario[sc.name] || 0), 0) === 0 &&
      (result.deadByScenario.maxed || 0) === 100,
      { deadByScenario: result.deadByScenario, nullSlotCount: result.nullSlotCount },
      '0 dead offers in normal scenarios; 100 in the maxed scenario'
    );
    const nonMaxedOffers = result.offerCount - 100;
    const noBoon = result.nullSlotCount - 100;
    check(
      'M7 eligibility: every normal draft has a Boon in slot 1',
      nonMaxedOffers > 0 && noBoon === 0 && result.slot2Offers === nonMaxedOffers,
      { nonMaxedOffers, noBoonDrafts: noBoon, slot2Offers: result.slot2Offers },
      'slot 1 always a Boon; slot 2 always populated'
    );
    const slot2BoonRate = result.slot2Offers ? result.slot2Boons / result.slot2Offers : 0;
    check(
      'M7 draft: slot 2 is mostly diverse but can still offer a Boon (~11.5%)',
      result.slot2Boons > 0 && result.slot2Boons < result.slot2Offers && slot2BoonRate > 0.03 && slot2BoonRate < 0.35,
      { slot2Offers: result.slot2Offers, slot2Boons: result.slot2Boons, slot2BoonRate: Number(slot2BoonRate.toFixed(4)) },
      '0% < slot-2 Boon rate < 35% (measured ~11.5%)'
    );
    const slot3RareRate = result.slot3Offers ? result.slot3Rares / result.slot3Offers : 0;
    check(
      'M7 draft: slot 3 rare rate is in the wave-scaled band',
      slot3RareRate > 0.2 && slot3RareRate < 0.5,
      { slot3Offers: result.slot3Offers, slot3Rares: result.slot3Rares, slot3RareRate: Number(slot3RareRate.toFixed(4)) },
      'slot-3 rare rate in (20%, 50%) at wave 1 (nominal 31%, fallback-raised)'
    );
    check(
      'M3 eligibility: scenario preconditions (lives 3, shieldMax 3, low/high word range, all six Hexes)',
      result.scenarioState.fresh.range[1] < 7 &&
      result.scenarioState['high-pressure'].range[1] >= 7 &&
      result.scenarioState.lives3.lives === 3 &&
      result.scenarioState.shield3.shieldMax >= 3 &&
      Object.values(result.scenarioState['all-hexes'].held).filter((t) => t >= 1).length === HEX_COUNT,
      {
        freshRange: result.scenarioState.fresh.range,
        highRange: result.scenarioState['high-pressure'].range,
        lives3: result.scenarioState.lives3.lives,
        shield3: result.scenarioState.shield3.shieldMax,
        allHexesHeld: result.scenarioState['all-hexes'].held,
      },
      'fresh range max<7, high range max>=7, lives3=3, shield3>=3, all six hexes held'
    );
    const covered = Object.values(EXPECTED_CARDS).filter((c) => (result.offeredCount[c.id] || 0) > 0).length;
    check(
      `M7 eligibility: all ${CARD_COUNT} cards can be offered (draft pool coverage)`,
      covered === CARD_COUNT,
      { covered, offeredCount: result.offeredCount },
      `${CARD_COUNT}/${CARD_COUNT} cards observed`
    );
    notes.eligibility = {
      drafts: result.drafts,
      violations: result.violationCount,
      offeredCount: result.offeredCount,
      deadByScenario: result.deadByScenario,
      slot2Boons: result.slot2Boons,
      slot2Offers: result.slot2Offers,
      slot3Rares: result.slot3Rares,
      slot3Offers: result.slot3Offers,
      samples: result.samples,
      scenarioState: result.scenarioState,
    };
  });

  // ═══ M4: screenshots with cards on the HUD ═════════════════════════════
  await section('M4 screenshots', async () => {
    const allIds = Object.values(EXPECTED_CARDS).map((c) => c.id);
    await resetRun(allIds.map((id) => ({ id, tier: 1 })));
    await clearWithHook('cat', { y: 260 });
    await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      s.words.length = 0;
      [['lantern', 120], ['ember', 250], ['drift', 380], ['hollow', 510]].forEach(([text, y]) => w.spawnWord(text, { y }));
      const target = w.targetWord();
      if (target) target.progress = 1;
    });
    await sleep(520); // let the spawn-materialise flicker finish for the HUD shot
    await page.screenshot({ path: shot('07-hud-cards.png') });
    const visual = await stateInfo();
    notes.m4 = {
      deck: visual.deck,
      heat: visual.heat,
      heatMult: visual.heatMult,
      particles: visual.particles,
      echoes: visual.echoes.length,
      pressure: visual.pressure,
      wave: visual.wave,
      lives: visual.lives,
      shields: visual.shields,
    };
    check('M4: HUD-with-cards state renders (18 cards held)', Object.keys(visual.deck).length === CARD_COUNT && visual.phase === 'playing', { deck: visual.deck, phase: visual.phase }, '18 held cards, phase playing');
  });

  // ═══ M6: pause ═════════════════════════════════════════════════════════
  await section('M6 pause', async () => {
    const hooks = await wf(() => ({
      pause: typeof window.__wordfall.pause,
      resume: typeof window.__wordfall.resume,
    }));
    check('M6 pause: pause()/resume() debug hooks exist', hooks.pause === 'function' && hooks.resume === 'function', hooks, 'both functions');

    await wf(() => window.__wordfall.reset(31337));
    await page.waitForFunction(() => window.__wordfall.state.words.length >= 2, null, { timeout: 15000 });
    await sleep(150);
    // Snapshot AND pause atomically: a rAF frame can run between two
    // page.evaluate round-trips, so a separate "before" evaluate would be stale
    // by the time pause() lands (it once differed by exactly one frame).
    const before = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      const snap = { phase: s.phase, seed: s.seed, runSec: s.runSec, ys: s.words.map((x) => x.y), stats: w.stats() };
      w.pause();
      return snap;
    });
    await sleep(150);

    const paused = await domInfo();
    check('M6 pause: pause() sets phase paused', paused.phase === 'paused', paused.phase, "'paused'");
    check('M6 pause: the pause dialog is visible', paused.dlgPause.exists && paused.dlgPause.show, paused.dlgPause, '#dlgPause.show');
    check(
      'M6 pause: status bar and title say Paused',
      paused.statusMain === 'Paused' && String(paused.titleText || '').includes('Paused') && String(paused.taskText || '').includes('Paused'),
      { statusMain: paused.statusMain, titleText: paused.titleText, taskText: paused.taskText },
      'status "Paused", title and taskbar include "Paused"'
    );
    check(
      'M6 pause: the seed line shows the seed and played time',
      new RegExp(`^Seed ${before.seed} \\u00b7 \\d\\d:\\d\\d played`).test(String(paused.pauseSeedLine || '')),
      paused.pauseSeedLine,
      `Seed ${before.seed} · MM:SS played (+ wave/WPM/combo detail)`
    );
    check(
      'M6 pause: the dialog offers Resume (default), Restart Run and Controls',
      paused.pauseButtons.every((b) => b.exists) &&
      /resume/i.test(paused.pauseButtons[0].text) && paused.pauseButtons[0].isDefault &&
      /restart/i.test(paused.pauseButtons[1].text) && /controls/i.test(paused.pauseButtons[2].text) &&
      paused.pauseNote !== null && /frozen|will not fall|nothing falls/i.test(paused.pauseNote),
      { buttons: paused.pauseButtons, note: paused.pauseNote },
      '#pauseResume default, #pauseRestart, #pauseControls, .pause-note mentions frozen'
    );
    check(
      'M6 pause: the game menu offers Resume while paused',
      paused.menuPause && !paused.menuPause.disabled && /^Resume/.test(paused.menuPause.label) && paused.menuPause.shortcut === 'Esc',
      paused.menuPause,
      'enabled, label Resume, shortcut Esc'
    );

    // Frozen board + run clock.
    await sleep(320);
    const frozen = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      return { phase: s.phase, ys: s.words.map((x) => x.y), runSec: s.runSec };
    });
    check(
      'M6 pause: the board stays frozen while paused',
      frozen.phase === 'paused' && JSON.stringify(frozen.ys) === JSON.stringify(before.ys),
      { before: before.ys, after: frozen.ys },
      'word y positions unchanged after ~300 ms'
    );
    check(
      'M6 pause: runSec does not advance while paused',
      frozen.runSec === before.runSec,
      { before: before.runSec, after: frozen.runSec },
      'runSec unchanged'
    );
    await page.screenshot({ path: shot('08-pause.png') });

    // Backdrop click must not close the pause dialog.
    await wf(() => document.getElementById('modalBackdrop').click());
    await sleep(100);
    const backdrop = await domInfo();
    check(
      'M6 pause: clicking the backdrop does not close the pause dialog',
      backdrop.phase === 'paused' && backdrop.dlgPause.show && backdrop.modalOpen,
      { phase: backdrop.phase, pauseShown: backdrop.dlgPause.show },
      'still paused with #dlgPause shown'
    );

    // Controls opened from the pause dialog return to it when closed.
    await wf(() => document.getElementById('pauseControls').click());
    await sleep(120);
    const controls = await domInfo();
    check(
      'M6 pause: Controls from the pause dialog opens the Controls dialog',
      controls.dlgControls.show && !controls.dlgPause.show && controls.phase === 'paused',
      { controls: controls.dlgControls.show, pause: controls.dlgPause.show, phase: controls.phase },
      'controls shown, pause hidden, phase still paused'
    );
    await wf(() => document.getElementById('controlsOk').click());
    await sleep(120);
    const back = await domInfo();
    check(
      'M6 pause: closing Controls returns to the pause dialog',
      back.phase === 'paused' && back.dlgPause.show && !back.dlgControls.show,
      { phase: back.phase, pause: back.dlgPause.show, controls: back.dlgControls.show },
      'paused with #dlgPause shown again'
    );

    // resume() hook.
    await wf(() => window.__wordfall.resume());
    await sleep(150);
    const resumed = await domInfo();
    check(
      'M6 pause: resume() returns to playing and hides the dialog',
      resumed.phase === 'playing' && !resumed.dlgPause.show && !resumed.modalOpen && /^Playing/.test(String(resumed.statusMain || '')),
      { phase: resumed.phase, pauseShown: resumed.dlgPause.show, statusMain: resumed.statusMain },
      "phase 'playing', dialog hidden"
    );

    // Typing regression: 'p' is a normal letter, never a pause key.
    await wf(() => {
      const w = window.__wordfall;
      w.reset(9090);
      w.state.words.length = 0;
      w.spawnWord('map', { y: 240 });
    });
    await sleep(80);
    for (const ch of ['m', 'a', 'p']) await page.keyboard.press(ch);
    await sleep(120);
    const typedP = await wf(() => ({
      phase: window.__wordfall.state.phase,
      cleared: window.__wordfall.state.cleared,
      keys: window.__wordfall.state.keys,
      words: window.__wordfall.state.words.map((x) => x.text),
    }));
    check(
      'M6 pause: the letter P types normally and does not pause',
      typedP.phase === 'playing' && typedP.cleared === 1 && typedP.keys === 3 && typedP.words.indexOf('map') < 0,
      typedP,
      "phase 'playing', 'map' cleared, 3 keys typed"
    );

    // Keyboard: Escape pauses, Escape resumes.
    await wf(() => window.__wordfall.reset(9091));
    await page.waitForFunction(() => window.__wordfall.state.words.length >= 1, null, { timeout: 15000 });
    await page.keyboard.press('Escape');
    await sleep(150);
    const escPaused = await domInfo();
    check('M6 pause: the Escape key pauses', escPaused.phase === 'paused' && escPaused.dlgPause.show, { phase: escPaused.phase, dialog: escPaused.dlgPause.show }, "'paused'");
    await page.keyboard.press('Escape');
    await sleep(150);
    const escResumed = await domInfo();
    check('M6 pause: Escape resumes while paused', escResumed.phase === 'playing' && !escResumed.dlgPause.show, { phase: escResumed.phase }, "'playing'");

    // Keyboard: Enter resumes while paused; other letters do not.
    await page.keyboard.press('Escape');
    await sleep(150);
    await page.keyboard.press('p');
    await sleep(120);
    const pWhilePaused = await domInfo();
    check(
      'M6 pause: P no longer resumes while paused',
      pWhilePaused.phase === 'paused' && pWhilePaused.dlgPause.show,
      { phase: pWhilePaused.phase, dialog: pWhilePaused.dlgPause.show },
      'still paused after P'
    );
    await page.keyboard.press('Enter');
    await sleep(150);
    const enterResumed = await domInfo();
    check('M6 pause: Enter resumes while paused', enterResumed.phase === 'playing' && !enterResumed.dlgPause.show, { phase: enterResumed.phase }, "'playing'");

    // Escape closes an open menu instead of pausing the run.
    await wf(() => window.__wordfall.reset(9092));
    await page.waitForFunction(() => window.__wordfall.state.words.length >= 1, null, { timeout: 15000 });
    await page.keyboard.press('Alt+g');
    await sleep(120);
    const menuOpen = await wf(() => ({ open: !!document.querySelector('.menu-item.open'), phase: window.__wordfall.state.phase }));
    await page.keyboard.press('Escape');
    await sleep(150);
    const menuClosed = await wf(() => ({ open: !!document.querySelector('.menu-item.open'), phase: window.__wordfall.state.phase, dialog: document.getElementById('dlgPause').classList.contains('show') }));
    check(
      'M6 pause: Escape closes an open menu instead of pausing',
      menuOpen.open && menuOpen.phase === 'playing' && !menuClosed.open && menuClosed.phase === 'playing' && !menuClosed.dialog,
      { opened: menuOpen, afterEscape: menuClosed },
      'menu open -> closed, phase stays playing'
    );
    await wf(() => window.__wordfall.resume()); // no-op when already playing
    await sleep(80);

    // The menu item is disabled outside playing/paused.
    await wf(() => {
      const w = window.__wordfall;
      w.reset(6161);
      w.beginDraft();
    });
    await page.waitForFunction(
      () => {
        const item = document.getElementById('menuPause');
        return window.__wordfall.state.phase === 'draft' && item && item.classList.contains('disabled');
      },
      null,
      { timeout: 10000 }
    );
    const drafting = await domInfo();
    check(
      'M6 pause: the Game menu Pause item is disabled during the draft',
      drafting.phase === 'draft' && drafting.menuPause && drafting.menuPause.disabled && /^Pause/.test(drafting.menuPause.label),
      drafting.menuPause,
      'disabled while drafting'
    );
    await wf(() => window.__wordfall.skip());
    await sleep(100);
  });

  // ═══ M6: lifetime records ══════════════════════════════════════════════
  await section('M6 records', async () => {
    const hooks = await wf(() => ({
      records: window.__wordfall.records && typeof window.__wordfall.records === 'object',
      fields: window.__wordfall.records ? Object.keys(window.__wordfall.records).sort() : null,
    }));
    check(
      'M6 records: the records hook exposes the contract fields',
      hooks.records && JSON.stringify(hooks.fields) === JSON.stringify(['bestCombo', 'bestScore', 'bestWave', 'dawns', 'fastestDawnSec', 'runs', 'words']),
      hooks,
      '7 fields on window.__wordfall.records'
    );

    // Seed a known baseline, then reload to prove load-at-boot.
    await wf(() => {
      const baseline = { runs: 4, dawns: 1, bestScore: 100, bestWave: 3, bestCombo: 7, words: 42, fastestDawnSec: 77 };
      localStorage.setItem('wordfall.records', JSON.stringify(baseline));
      localStorage.setItem('wordfall.best', '100');
    });
    await reloadGame();
    const loaded = await wf(() => {
      const w = window.__wordfall;
      return {
        phase: w.state.phase,
        records: Object.assign({}, w.records),
        best: w.state.best,
        stored: JSON.parse(localStorage.getItem('wordfall.records') || 'null'),
        welcomeBest: String((document.getElementById('mainBest') || {}).textContent || '').trim(),
        menuRecords: !!document.getElementById('menuRecords'),
      };
    });
    check(
      'M6 records: lifetime records load from localStorage at boot',
      loaded.phase === 'menu' &&
      loaded.records.runs === 4 && loaded.records.dawns === 1 && loaded.records.bestScore === 100 &&
      loaded.records.bestWave === 3 && loaded.records.bestCombo === 7 && loaded.records.words === 42 &&
      loaded.records.fastestDawnSec === 77 && loaded.best === 100,
      loaded.records,
      'baseline loaded, state.best 100'
    );
    check(
      'M6 records: the main screen shows the record best score',
      loaded.welcomeBest === '100' && loaded.menuRecords,
      { welcomeBest: loaded.welcomeBest, menuRecords: loaded.menuRecords },
      '"Best score: 100", #menuRecords exists'
    );

    // Force a run end and check the records update exactly once.
    const forced = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      w.reset(424242);
      s.score = 250;
      s.bestCombo = 9;
      s.wave = 4;
      s.cleared = 50;
      s.words.length = 0;
      w.spawnWord('cat', { y: s.groundY - 10 });
      return { before: Object.assign({}, w.records), seed: s.seed };
    });
    await page.waitForFunction(() => window.__wordfall.state.phase === 'gameover', null, { timeout: 10000 });
    const ended = await wf(() => {
      const w = window.__wordfall;
      return {
        phase: w.state.phase,
        records: Object.assign({}, w.records),
        stored: JSON.parse(localStorage.getItem('wordfall.records') || 'null'),
        best: w.state.best,
        legacyBest: Number(localStorage.getItem('wordfall.best') || 0),
      };
    });
    check('M6 records: the forced run ended in game over', ended.phase === 'gameover', ended.phase, "'gameover'");
    check(
      'M6 records: a finished run increments runs and updates the best fields',
      ended.records.runs === forced.before.runs + 1 &&
      ended.records.bestScore === 250 && ended.records.bestWave === 4 && ended.records.bestCombo === 9 &&
      ended.records.words === forced.before.words + 50 && ended.records.dawns === 1 && ended.records.fastestDawnSec === 77,
      { before: forced.before, after: ended.records },
      'runs +1, bestScore 250, bestWave 4, bestCombo 9, words +50, dawns/fastest unchanged'
    );
    check(
      'M6 records: the run is saved to localStorage once and best mirrors it',
      JSON.stringify(ended.stored) === JSON.stringify(ended.records) && ended.best === 250 && ended.legacyBest === 250,
      { stored: ended.stored, records: ended.records, best: ended.best, legacyBest: ended.legacyBest },
      'wordfall.records persisted, wordfall.best 250'
    );

    // The Records dialog renders the saved values.
    await wf(() => document.getElementById('menuRecords').click());
    await sleep(150);
    const recDom = await domInfo();
    check(
      'M6 records: the Records dialog is visible with the saved values',
      recDom.dlgRecords.exists && recDom.dlgRecords.show &&
      recDom.records.bestScore === '250' && recDom.records.bestWave === '4' && recDom.records.bestCombo === '9' &&
      recDom.records.runs === '5' && recDom.records.dawns === '1' && recDom.records.words === '92' &&
      recDom.records.fastest === '01:17',
      { dialog: recDom.dlgRecords.show, values: recDom.records },
      '#dlgRecords shown; 250 / 4 / 9 / 5 / 1 / 92 / 01:17'
    );
    await page.screenshot({ path: shot('09-records.png') });
    await wf(() => document.getElementById('recordsOk').click());
    await sleep(120);
    const recClosed = await domInfo();
    check(
      'M6 records: the Records OK button closes the dialog',
      !recClosed.dlgRecords.show,
      { shown: recClosed.dlgRecords.show, modalOpen: recClosed.modalOpen },
      'dialog closed'
    );
    notes.records = { forcedSeed: forced.seed, before: forced.before, after: ended.records };
  });

  // ═══ M6: run stats + seed ══════════════════════════════════════════════
  await section('M6 run stats + seed', async () => {
    const det = await wf(() => {
      const w = window.__wordfall;
      const sample = (seed) => {
        w.reset(seed);
        const s = w.state;
        const seq = [];
        for (let i = 0; i < 10; i++) {
          s.words.length = 0;                      // avoid maxWords while sampling
          const word = w.spawnOne();
          seq.push(word ? `${word.text}@${word.x.toFixed(3)}` : 'null');
        }
        return { seed: s.seed, seq };
      };
      const a = sample(123456789);
      const b = sample(123456789);
      const c = sample(987654321);
      return { a, b, c };
    });
    check(
      'M6 seed: reset(seed) seeds the PRNG deterministically and stores state.seed',
      det.a.seed === 123456789 && det.b.seed === 123456789 && det.c.seed === 987654321,
      { a: det.a.seed, b: det.b.seed, c: det.c.seed },
      'state.seed equals the requested seed'
    );
    check(
      'M6 seed: the same seed produces the same spawn sequence',
      JSON.stringify(det.a.seq) === JSON.stringify(det.b.seq) && det.a.seq.every((s) => s !== 'null'),
      { a: det.a.seq, b: det.b.seq },
      'identical texts and x positions'
    );
    check(
      'M6 seed: a different seed produces a different spawn sequence',
      JSON.stringify(det.a.seq) !== JSON.stringify(det.c.seq),
      { a: det.a.seq.slice(0, 4), c: det.c.seq.slice(0, 4) },
      'sequences differ'
    );

    const stats = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      w.reset(2468);
      s.words.length = 0;
      const word = w.spawnWord('cat', { y: 240 });
      w.typeLetter('c');                          // correct
      w.typeLetter('z');                          // wrong key
      const stats = w.stats();
      return { stats, keys: s.keys, mistakes: s.mistakes, runSec: s.runSec, seed: s.seed, progress: word.progress };
    });
    check(
      'M6 stats: stats() returns the contract shape',
      ['keys', 'mistakes', 'runSec', 'wpm', 'accuracy'].every((k) => stats.stats && typeof stats.stats[k] === 'number'),
      stats.stats,
      '{keys, mistakes, runSec, wpm, accuracy} all numbers'
    );
    check(
      'M6 stats: correct and wrong keys are counted',
      stats.keys === 1 && stats.mistakes === 1 && stats.stats.keys === 1 && stats.stats.mistakes === 1 &&
      stats.stats.accuracy === 50 && stats.stats.runSec === stats.runSec && stats.progress === 1,
      { keys: stats.keys, mistakes: stats.mistakes, stats: stats.stats, progress: stats.progress },
      'keys 1, mistakes 1, accuracy 50'
    );

    // Force a game over and check the stats line + Retry Seed button.
    await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      w.reset(777);
      s.words.length = 0;
      w.spawnWord('cat', { y: 200 });
      w.typeLetter('c');
      w.typeLetter('a');
      w.typeLetter('t');
      s.words.length = 0;
      w.spawnWord('dog', { y: s.groundY - 10 });
    });
    await page.waitForFunction(() => window.__wordfall.state.phase === 'gameover', null, { timeout: 10000 });
    const over = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      return {
        phase: s.phase,
        seed: s.seed,
        stats: w.stats(),
        keys: s.keys,
        text: String((document.getElementById('overStats') || {}).textContent || ''),
        overSeed: !!document.getElementById('overSeed'),
        overSeedText: String((document.getElementById('overSeed') || {}).textContent || '').trim(),
      };
    });
    check('M6 stats: the forced run ends in game over', over.phase === 'gameover', over.phase, "'gameover'");
    check(
      'M6 stats: the game-over stats line carries WPM, accuracy, run time and seed',
      /\d+ WPM \u00b7 \d+% accuracy \u00b7 \d\d:\d\d \u00b7 Seed \d+/.test(over.text) &&
      over.text.includes(`Seed ${over.seed}`) &&
      /\d+ (?:word|words) cleared/.test(over.text) && over.text.includes('best combo'),
      over.text,
      'Wave N · N word(s) cleared · best combo N · WPM · accuracy % · MM:SS · Seed N'
    );
    check(
      'M6 stats: the game-over retry button is labelled Retry Seed',
      over.overSeed && /retry seed/i.test(over.overSeedText),
      { exists: over.overSeed, text: over.overSeedText },
      '#overSeed exists, "Retry Seed"'
    );

    // Retry Seed restores the seed.
    await wf(() => document.getElementById('overSeed').click());
    await sleep(200);
    const retried = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      return { phase: s.phase, seed: s.seed, score: s.score, keys: s.keys, mistakes: s.mistakes, runRecorded: s.runRecorded };
    });
    check(
      'M6 seed: Retry Seed starts a new run with the same seed',
      retried.phase === 'playing' && retried.seed === over.seed && retried.score === 0 && retried.keys === 0 && retried.mistakes === 0,
      { before: over.seed, after: retried.seed, phase: retried.phase, score: retried.score },
      'phase playing, same seed, counters reset'
    );
    notes.seed = { seed: over.seed, retried: retried.seed, stats: over.stats, text: over.text };
  });

  // ═══ M6: Split card ═════════════════════════════════════════════════════
  await section('M6 Split', async () => {
    const seqs = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      const run = (tier) => {
        w.reset(9001);
        w.grant('split', tier);
        const rows = [];
        for (let i = 0; i < 9; i++) {
          s.words.length = 0;
          w.spawnOne();
          rows.push(s.words.length);
        }
        return rows;
      };
      return { tier1: run(1), tier2: run(2) };
    });
    check(
      'M6 Split: tier I adds a free word on every 5th spawn',
      JSON.stringify(seqs.tier1) === JSON.stringify([1, 1, 1, 1, 2, 1, 1, 1, 1]),
      seqs.tier1,
      '[1,1,1,1,2,1,1,1,1]'
    );
    check(
      'M6 Split: tier II adds a free word on every 3rd spawn',
      JSON.stringify(seqs.tier2) === JSON.stringify([1, 1, 2, 1, 1, 2, 1, 1, 2]),
      seqs.tier2,
      '[1,1,2,1,1,2,1,1,2]'
    );

    // The free word is real, short and harmless.
    const extras = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      const sample = (tier, every, seed) => {
        w.reset(seed);
        w.grant('split', tier);
        const rows = [];
        for (let i = 0; i < 30; i++) {
          s.words.length = 0;
          const primary = w.spawnOne();
          if (!primary) continue;
          const extra = s.words.filter((x) => x !== primary)[0] || null;
          if ((i + 1) % every === 0) {
            rows.push({
              spawn: i + 1,
              has: !!extra,
              text: extra ? extra.text : null,
              len: extra ? extra.text.length : null,
              harmless: extra ? extra.harmless === true : null,
              fake: extra ? !!extra.fake : null,
            });
          }
        }
        return rows;
      };
      return { tier1: sample(1, 5, 9002), tier2: sample(2, 3, 9003) };
    });
    const allExtras = extras.tier1.concat(extras.tier2);
    check(
      'M6 Split: the free word is a real, short word flagged harmless',
      allExtras.length === 16 && allExtras.every((r) => r.has && r.harmless === true && r.fake === false && r.len >= 3 && r.len <= 5),
      { tier1: extras.tier1.slice(0, 3), tier2: extras.tier2.slice(0, 3), count: allExtras.length },
      'every 5th/3rd spawn adds a harmless 3-5 letter word, never fake'
    );

    // The free word is fully typeable and scores like a normal clear.
    const typeable = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      w.reset(9004);
      s.words.length = 0;
      const word = w.spawnWord('sun', { y: 240 });
      word.harmless = true;
      const before = { cleared: s.cleared, score: s.score, mistakes: s.mistakes, keys: s.keys };
      let guard = 0;
      while (guard++ < 12 && s.words.indexOf(word) >= 0) {
        const ch = w.nextChar(word);
        if (ch == null) break;
        w.typeLetter(ch);
      }
      return { before, cleared: s.cleared, score: s.score, mistakes: s.mistakes, keys: s.keys, gone: s.words.indexOf(word) < 0, phase: s.phase };
    });
    check(
      'M6 Split: the free word is typeable and scores',
      typeable.gone && typeable.cleared === typeable.before.cleared + 1 &&
      typeable.score > typeable.before.score && typeable.mistakes === typeable.before.mistakes &&
      typeable.keys === typeable.before.keys + 3,
      typeable,
      'cleared +1, score rises, no mistake, 3 correct keys'
    );

    // Reaching the danger line costs no life.
    const ground = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      w.reset(9005);
      w.grant('split', 1);
      s.words.length = 0;
      const word = w.spawnWord('sun', { y: s.groundY - 5 });
      word.harmless = true;
      return { lives: s.lives, id: word.id, phase: s.phase };
    });
    await page.waitForFunction(
      (id) => {
        const s = window.__wordfall.state;
        return s.phase === 'playing' && !s.words.some((x) => x.id === id);
      },
      ground.id,
      { timeout: 10000 }
    );
    const groundAfter = await wf((id) => {
      const w = window.__wordfall;
      const s = w.state;
      return { phase: s.phase, lives: s.lives, ids: s.words.map((x) => x.id), cleared: s.cleared, has: s.words.some((x) => x.id === id) };
    }, ground.id);
    check(
      'M6 Split: a harmless word reaching the danger line costs no life',
      groundAfter.phase === 'playing' && groundAfter.lives === ground.lives && !groundAfter.has,
      { setup: ground, after: groundAfter },
      'phase playing, lives unchanged, word removed'
    );

    // The free word breaks the spawn queue: it lands above maxWords.
    const cap = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      w.reset(9006);
      w.grant('split', 1);
      for (let i = 0; i < 4; i++) {          // prime the spawn counter to the 5th
        s.words.length = 0;
        w.spawnOne();
      }
      s.words.length = 0;
      const maxWords = w.CFG.maxWords;
      while (s.words.length < maxWords - 1) w.spawnWord('cat', { y: 0 });   // spawnWord does not count
      const beforeIds = s.words.map((x) => x.id);
      const beforeYs = s.words.map((x) => x.y);
      const primary = w.spawnOne();
      const added = s.words.filter((x) => beforeIds.indexOf(x.id) < 0);
      return {
        maxWords,
        beforeCount: beforeIds.length,
        afterCount: s.words.length,
        primaryId: primary ? primary.id : null,
        added: added.map((x) => ({ id: x.id, text: x.text, fake: !!x.fake, harmful: x.harmless === true, y: x.y })),
        beforeYs,
      };
    });
    const extra = cap.added.filter((x) => x.id !== cap.primaryId)[0] || null;
    check(
      'M6 Split: the free word bypasses maxWords',
      cap.beforeCount === cap.maxWords - 1 && cap.afterCount === cap.maxWords + 1 && cap.added.length === 2,
      { maxWords: cap.maxWords, beforeCount: cap.beforeCount, afterCount: cap.afterCount, added: cap.added },
      `queue ${cap.maxWords - 1} -> ${cap.maxWords + 1} words`
    );
    check(
      'M6 Split: the queue-breaking word is the harmless word above the queue',
      !!extra && extra.harmful === true && extra.fake === false && extra.y < Math.min(...cap.beforeYs),
      { extra, beforeYs: cap.beforeYs },
      'harmless word, y above the existing queue'
    );

    // Never a fake, even when Decoy is turning primaries into fakes.
    const fakeCheck = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      w.reset(9007);
      w.grant('split', 1);
      w.grant('decoy', 2);
      let splitSpawns = 0;
      let fakeExtras = 0;
      let harmlessExtras = 0;
      let primaryFakes = 0;
      for (let i = 0; i < 60; i++) {
        s.words.length = 0;
        const primary = w.spawnOne();
        if (!primary) continue;
        if (primary.fake) primaryFakes += 1;
        const extraWords = s.words.filter((x) => x !== primary);
        if (extraWords.length) {
          splitSpawns += 1;
          fakeExtras += extraWords.filter((x) => x.fake).length;
          harmlessExtras += extraWords.filter((x) => x.harmless === true).length;
        }
      }
      return { splitSpawns, fakeExtras, harmlessExtras, primaryFakes };
    });
    check(
      'M6 Split: the free word is never a fake',
      fakeCheck.splitSpawns === 12 && fakeCheck.harmlessExtras === 12 && fakeCheck.fakeExtras === 0 && fakeCheck.primaryFakes > 0,
      fakeCheck,
      '12/60 split spawns, 12 harmless extras, 0 fakes, primaries include fakes'
    );

    // Grant path + tier bookkeeping.
    const tiers = await wf(() => {
      const w = window.__wordfall;
      w.reset(9008);
      const t1 = w.heldTier('split');
      w.grant('split', 1);
      const first = w.heldTier('split');
      w.grant('split', 2);
      return { before: t1, first, second: w.heldTier('split'), maxTier: w.CARDS.find((c) => c.id === 'split').maxTier };
    });
    check(
      'M6 Split: grant() walks tiers I -> II',
      tiers.before === 0 && tiers.first === 1 && tiers.second === 2 && tiers.maxTier === 2,
      tiers,
      '0 -> 1 -> 2, maxTier 2'
    );
    notes.split = { seqs, extras: allExtras, typeable, ground: { setup: ground, after: groundAfter }, fakeCheck, cap: { maxWords: cap.maxWords, beforeCount: cap.beforeCount, afterCount: cap.afterCount, extra } };
  });

  // ═══ M7: effects, juice, FX toggle, overlay, celebration, frame time ════
  await section('M7 effects layer', async () => {
    // Headless Chrome may report prefers-reduced-motion on boot; force full FX
    // so the effect assertions measure the real full-quality layer.
    const quality = await wf(() => {
      const w = window.__wordfall;
      if (w.settings.fx !== 'full') w.toggleEffects();
      return w.settings.fx;
    });
    check('M7 FX: full effects quality is active for the FX checks', quality === 'full', quality, "'full'");

    const clear = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      w.reset(7001);
      s.lives = 3;
      s.words.length = 0;
      const word = w.spawnWord('ember', { y: 300 });
      let guard = 0;
      while (guard++ < 16 && s.words.indexOf(word) >= 0) {
        const ch = w.nextChar(word);
        if (ch == null) break;
        w.typeLetter(ch);
      }
      return {
        cleared: s.cleared,
        combo: s.combo,
        fx: w.fxState(),
        caps: { particles: w.CFG.fxMaxParticles, shards: w.CFG.fxMaxShards, rings: w.CFG.fxMaxRings, popups: w.CFG.fxMaxPopups },
      };
    });
    check(
      'M7 FX: clearing a word emits particles, glyph shards, rings and popups',
      clear.cleared === 1 && clear.fx.particles > 0 && clear.fx.shards > 0 && clear.fx.rings > 0 && clear.fx.popups > 0,
      clear,
      'all four pools non-empty right after the last letter'
    );
    check(
      'M7 FX: live pools stay within the CFG caps right after a clear',
      clear.fx.particles <= clear.caps.particles &&
      clear.fx.shards <= clear.caps.shards &&
      clear.fx.rings <= clear.caps.rings &&
      clear.fx.popups <= clear.caps.popups,
      { fx: clear.fx, caps: clear.caps },
      'pool sizes <= CFG.fxMax*'
    );
    check(
      'M7 FX: fxState() exposes the documented contract',
      ['quality', 'particles', 'shards', 'rings', 'popups', 'milestone', 'danger', 'cssCombos'].every((k) => k in clear.fx) &&
      clear.fx.quality === 'full',
      clear.fx,
      '{quality, particles, shards, rings, popups, milestone, danger, cssCombos}'
    );
    await sleep(80);
    const hud = await domInfo();
    const comboMult = await wf(() => window.__wordfall.comboMultiplier());
    check(
      'M7 HUD: #statusCombo tracks comboMultiplier()',
      hud.statusCombo === `Combo: ${comboMult.toFixed(2)}\u00d7` && hud.bodyClasses.includes('phase-playing'),
      { statusCombo: hud.statusCombo, expected: `Combo: ${comboMult.toFixed(2)}\u00d7`, comboMult, body: hud.bodyClasses },
      '"Combo: 1.05×" after one clear, body.phase-playing'
    );
    check(
      'M7 HUD: #app carries the --fx-combo and --fx-danger CSS vars',
      !!hud.appVars && hud.appVars.combo !== '' && hud.appVars.danger !== '' && Number(hud.appVars.combo) === 1,
      hud.appVars,
      '--fx-combo 1, --fx-danger set'
    );

    // Dense staging for the effects screenshot: several clears in quick
    // succession so particles/shards/rings/popups are all on screen at once.
    await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      const texts = ['ember', 'lantern', 'drift', 'hollow', 'tunnel'];
      for (const text of texts) {
        s.words.length = 0;
        const word = w.spawnWord(text, { y: 240 });
        let guard = 0;
        while (guard++ < 20 && s.words.indexOf(word) >= 0) {
          const ch = w.nextChar(word);
          if (ch == null) break;
          w.typeLetter(ch);
        }
      }
    });
    await page.screenshot({ path: shot('10-fx-clear.png') }); // M7: impact layer
  });

  await section('M7 combo milestone', async () => {
    const r = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      w.reset(7002);
      s.lives = 3;
      s.cleared = 9;
      s.combo = 9;
      s.bestCombo = 9;
      s.words.length = 0;
      const word = w.spawnWord('ember', { y: 250 });
      let guard = 0;
      while (guard++ < 16 && s.words.indexOf(word) >= 0) {
        const ch = w.nextChar(word);
        if (ch == null) break;
        w.typeLetter(ch);
      }
      return { combo: s.combo, milestoneT: s.milestoneT, fx: w.fxState(), comboMult: w.comboMultiplier() };
    });
    check(
      'M7 milestone: the 10th combo sets fxState().milestone and the transient timer',
      r.combo === 10 && r.fx.milestone === true && r.milestoneT > 0,
      r,
      'combo 10, milestone true'
    );
    await sleep(80);
    const hud = await domInfo();
    check(
      'M7 milestone: body gets fx-milestone and the combo-hot class at combo >= 5',
      hud.bodyClasses.includes('fx-milestone') && hud.bodyClasses.includes('fx-combo-hot'),
      { body: hud.bodyClasses, statusCombo: hud.statusCombo },
      'fx-milestone + fx-combo-hot on body'
    );
    check(
      'M7 milestone: #statusCombo and --fx-combo track the milestone combo',
      hud.statusCombo === `Combo: ${r.comboMult.toFixed(2)}\u00d7` && Number(hud.appVars.combo) === 10,
      { statusCombo: hud.statusCombo, expected: `Combo: ${r.comboMult.toFixed(2)}\u00d7`, appCombo: hud.appVars.combo },
      'status "Combo: 1.50×", --fx-combo 10'
    );
  });

  await section('M7 draft tags', async () => {
    const found = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      for (let seed = 1; seed < 800; seed++) {
        w.reset(seed);
        w.grant('rally', 1);
        w.beginDraft();
        const offer = s.offer || [];
        if (offer.some((c) => c && c.id === 'rally' && c.tier === 2)) {
          return { seed, offer: offer.map((c) => (c ? { id: c.id, tier: c.tier } : null)) };
        }
      }
      return null;
    });
    check('M7 draft: a tier-II upgrade offer is reachable (Rally II)', !!found, found, 'found in seeded offers');
    if (found) {
      await wf((seed) => {
        const w = window.__wordfall;
        w.reset(seed);
        w.grant('rally', 1);
        w.beginDraft();
      }, found.seed);
      await sleep(100);
      const hud = await domInfo();
      const cards = hud.draftCards || [];
      const upCard = cards.find((c) => /tag-up/.test(c.tagClass || ''));
      check(
        'M7 draft: the UPGRADE tag renders inside a tier-II draft card',
        !!upCard && upCard.tag === 'UPGRADE' && /II/.test(upCard.name || '') && !!upCard.desc,
        { cards, upCard },
        'tag-up / UPGRADE / "Rally II" + description'
      );
      await page.screenshot({ path: shot('13-draft-upgrade.png') });
      await wf(() => window.__wordfall.skip());
    }

    // A rare offer for the RARE-outline screenshot: find it in the seeded pool.
    const rareFound = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      for (let seed = 1; seed < 800; seed++) {
        w.reset(seed);
        w.beginDraft();
        const offer = s.offer || [];
        if (offer.some((c) => c && c.rarity === 'rare')) {
          return { seed, offer: offer.map((c) => (c ? { id: c.id, rarity: c.rarity, tier: c.tier } : null)) };
        }
      }
      return null;
    });
    check('M7 draft: a rare offer is reachable in the seeded draft pool', !!rareFound, rareFound, 'found in seeded offers');
    if (rareFound) {
      await wf((seed) => {
        const w = window.__wordfall;
        w.reset(seed);
        w.beginDraft();
      }, rareFound.seed);
      await sleep(100);
      const hud = await domInfo();
      const cards = hud.draftCards || [];
      const rares = cards.filter((c) => c.rare);
      const expectedRare = rareFound.offer.filter((c) => c && c.rarity === 'rare').length;
      check(
        'M7 draft: the RARE outline marker renders on exactly the rare cards',
        expectedRare > 0 && rares.length === expectedRare && rares.every((c) => c.tag === 'NEW' || c.tag === 'UPGRADE'),
        { cards, expectedRare },
        'RARE marker on rare offers'
      );
      await page.screenshot({ path: shot('12-draft-rare.png') });
      await wf(() => window.__wordfall.skip());
    }
  });

  await section('M7 effects toggle + persistence', async () => {
    const start = await wf(() => {
      const w = window.__wordfall;
      if (w.settings.fx !== 'full') w.toggleEffects();
      return {
        quality: w.settings.fx,
        menu: String((document.getElementById('menuEffects') || {}).textContent || '').trim(),
        fxLight: document.body.classList.contains('fx-light'),
      };
    });
    check(
      'M7 FX toggle: full mode renders the Effects: Full menu label',
      start.quality === 'full' && start.menu === 'Effects: Full' && !start.fxLight,
      start,
      "'Effects: Full', body without fx-light"
    );

    const measureClear = (seed) => wf((seed) => {
      const w = window.__wordfall;
      const s = w.state;
      w.reset(seed);
      s.lives = 3;
      s.words.length = 0;
      const word = w.spawnWord('ember', { y: 250 });
      let guard = 0;
      while (guard++ < 16 && s.words.indexOf(word) >= 0) {
        const ch = w.nextChar(word);
        if (ch == null) break;
        w.typeLetter(ch);
      }
      return w.fxState();
    }, seed);
    const fullFx = await measureClear(7010);

    const toggled = await wf(() => {
      const w = window.__wordfall;
      const before = w.settings.fx;
      w.toggleEffects();
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem('wordfall.settings') || 'null'); } catch (e) { /* ignore */ }
      return {
        before,
        after: w.settings.fx,
        fxLight: document.body.classList.contains('fx-light'),
        menu: String((document.getElementById('menuEffects') || {}).textContent || '').trim(),
        stored,
      };
    });
    check(
      'M7 FX toggle: toggleEffects() flips full -> light, sets the body class and menu label',
      toggled.before === 'full' && toggled.after === 'light' && toggled.fxLight && toggled.menu === 'Effects: Light',
      toggled,
      'full -> light, body.fx-light, "Effects: Light"'
    );
    check(
      'M7 FX toggle: the light setting is persisted to localStorage wordfall.settings',
      !!toggled.stored && toggled.stored.fx === 'light' && typeof toggled.stored.muted === 'boolean',
      toggled.stored,
      'wordfall.settings = {muted, fx: "light"}'
    );

    const lightFx = await measureClear(7010);
    check(
      'M7 FX toggle: light mode emits fewer particles but still produces effects',
      lightFx.quality === 'light' &&
      lightFx.particles > 0 && lightFx.shards > 0 &&
      lightFx.particles < fullFx.particles * 0.7,
      { full: { particles: fullFx.particles, shards: fullFx.shards, rings: fullFx.rings }, light: { particles: lightFx.particles, shards: lightFx.shards, rings: lightFx.rings } },
      'light particles < 70% of full, and non-zero'
    );

    await reloadGame();
    const persisted = await wf(() => {
      const w = window.__wordfall;
      let stored = null;
      try { stored = JSON.parse(localStorage.getItem('wordfall.settings') || 'null'); } catch (e) { /* ignore */ }
      return {
        quality: w.settings.fx,
        fxLight: document.body.classList.contains('fx-light'),
        menu: String((document.getElementById('menuEffects') || {}).textContent || '').trim(),
        stored,
        phase: w.state.phase,
        version: w.version,
      };
    });
    check(
      'M7 FX toggle: the light setting survives a page reload',
      persisted.quality === 'light' && persisted.fxLight && persisted.menu === 'Effects: Light' &&
      persisted.stored && persisted.stored.fx === 'light' && persisted.version === 'M8',
      persisted,
      'boots into light FX from localStorage'
    );

    const restored = await wf(() => {
      const w = window.__wordfall;
      if (w.settings.fx !== 'full') w.toggleEffects();
      return {
        quality: w.settings.fx,
        fxLight: document.body.classList.contains('fx-light'),
        menu: String((document.getElementById('menuEffects') || {}).textContent || '').trim(),
      };
    });
    check(
      'M7 FX toggle: full mode can be restored and re-applies the full-FX hooks',
      restored.quality === 'full' && !restored.fxLight && restored.menu === 'Effects: Full',
      restored,
      "'Effects: Full', no body.fx-light"
    );
  });

  await section('M7 FX overlay + dialogs', async () => {
    await wf(() => {
      const el = document.getElementById('menuStart');
      if (el) el.click();
    });
    await sleep(200);
    const hud = await domInfo();
    check(
      'M7 FX: #fxOverlay exists, is pointer-events:none and sits below #modalLayer',
      hud.fxOverlay.exists &&
      hud.fxOverlay.pointerEvents === 'none' &&
      Number(hud.fxOverlay.zIndex) < Number(hud.modalZIndex),
      { overlay: hud.fxOverlay, modalZIndex: hud.modalZIndex },
      'pointer-events none, overlay z-index < modal z-index'
    );

    await page.keyboard.press('Alt+h');
    await sleep(120);
    const menuOpen = await wf(() => !!document.querySelector('.menu-item[data-menu="help"].open'));
    await wf(() => document.querySelector('.menu-item[data-menu="help"] .drop-item[data-cmd="controls"]').click());
    await sleep(150);
    const controls = await domInfo();
    check(
      'M7 FX: dialogs still open above the FX overlay (Help > Controls)',
      menuOpen && controls.dlgControls.show && /controls/i.test(controls.dlgControls.text || '') && controls.modalOpen,
      { menuOpen, controlsShown: controls.dlgControls.show, modalOpen: controls.modalOpen },
      'Controls dialog shown, modal layer open'
    );
    await wf(() => document.getElementById('controlsOk').click());
    await sleep(150);
    const after = await wf(() => ({
      phase: window.__wordfall.state.phase,
      controls: document.getElementById('dlgControls').classList.contains('show'),
      modal: !!document.querySelector('#modalLayer.open'),
    }));
    check(
      'M7 FX: closing Controls returns to play (the overlay does not block clicks)',
      after.phase === 'playing' && !after.controls && !after.modal,
      after,
      "phase 'playing', Controls closed"
    );
  });

  await section('M7 wave celebration', async () => {
    const setup = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      w.reset(7100);
      s.lives = 3;
      s.words.length = 0;
      s.waveCleared = 9;
      s.cleared = 9;
      const word = w.spawnWord('ember', { y: 250 });
      let guard = 0;
      while (guard++ < 16 && s.words.indexOf(word) >= 0) {
        const ch = w.nextChar(word);
        if (ch == null) break;
        w.typeLetter(ch);
      }
      return {
        phase: s.phase, cleared: s.cleared, waveCleared: s.waveCleared, wave: s.wave,
        waveClearT: s.waveClearT, fx: w.fxState(),
      };
    });
    check(
      'M7 wave celebration: the 10th clear freezes play and starts the beat',
      setup.phase === 'playing' && setup.cleared === 10 && setup.waveCleared === 10 && setup.waveClearT > 0,
      setup,
      "phase 'playing', cleared 10, waveClearT > 0"
    );
    check(
      'M7 wave celebration: the celebration emitters fire (rings + popups)',
      setup.fx.rings > 0 && setup.fx.popups > 0 && setup.fx.particles > 0,
      setup.fx,
      'rings / popups / particles live during the beat'
    );
    const t0 = Date.now();
    const inert = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      const keysBefore = s.keys;
      const comboBefore = s.combo;
      w.typeLetter('q');
      return { keysBefore, comboBefore, keysAfter: s.keys, combo: s.combo, phase: s.phase, waveClearT: s.waveClearT };
    });
    check(
      'M7 wave celebration: typeLetter() is inert during the beat',
      inert.keysAfter === inert.keysBefore && inert.combo === inert.comboBefore && inert.phase === 'playing',
      inert,
      'no keys/combo change'
    );
    const ysA = await wf(() => window.__wordfall.state.words.map((w) => w.y));
    await sleep(200);
    const frozen = await wf(() => ({ ys: window.__wordfall.state.words.map((w) => w.y), phase: window.__wordfall.state.phase, waveClearT: window.__wordfall.state.waveClearT }));
    check(
      'M7 wave celebration: the board hangs frozen during the beat',
      JSON.stringify(ysA) === JSON.stringify(frozen.ys),
      { before: ysA, during: frozen.ys, phase: frozen.phase },
      'word y positions unchanged'
    );
    await page.waitForFunction(() => window.__wordfall.state.phase === 'draft', null, { timeout: 2500 });
    const waitedMs = Date.now() - t0;
    check(
      'M7 wave celebration: the draft opens ~0.85 s after the last clear, not immediately',
      waitedMs >= 150 && waitedMs <= 2200,
      { waitedMs },
      'deferred draft (150-2200 ms)'
    );
    await wf(() => window.__wordfall.skip());
  });

  await section('M7 perf', async () => {
    const mode = await wf(() => {
      const w = window.__wordfall;
      if (w.settings.fx !== 'full') w.toggleEffects();
      return w.settings.fx;
    });
    check('M7 perf: the frame-time run starts in full FX mode', mode === 'full', mode, "'full'");

    const full = await measureFxLoad(185);
    const fullFps = full.avgMs ? 1000 / full.avgMs : 0;
    check(
      'M7 perf: full FX sustains >= 50 fps while clearing a full board',
      full.frames >= 160 && full.avgMs <= 20 && full.clears >= 100,
      { frames: full.frames, avgMs: Number(full.avgMs.toFixed(2)), fps: Number(fullFps.toFixed(1)), clears: full.clears, p95Ms: Number(full.p95Ms.toFixed(2)) },
      'avg frame <= 20 ms (>= 50 fps) over ~3 s of continuous clears'
    );
    // Headless Chrome occasionally drops an isolated vsync frame; budget 10%
    // of frames (never fewer than 5) while keeping p95 inside one 60 fps frame.
    const longBudget = Math.max(5, Math.ceil(full.frames * 0.1));
    check(
      'M7 perf: long frames stay rare in full FX mode',
      full.longFrames <= longBudget && full.maxMs <= 100 && full.p95Ms <= 20,
      { longFrames: full.longFrames, longBudget, maxMs: Number(full.maxMs.toFixed(2)), p95Ms: Number(full.p95Ms.toFixed(2)) },
      `<= ${longBudget} frames over 33 ms (10% budget), p95 <= 20 ms, worst frame <= 100 ms`
    );
    check(
      'M7 perf: every effect pool stayed within its CFG cap under load',
      full.maxPools.particles <= full.caps.particles &&
      full.maxPools.shards <= full.caps.shards &&
      full.maxPools.rings <= full.caps.rings &&
      full.maxPools.popups <= full.caps.popups,
      { maxPools: full.maxPools, caps: full.caps },
      'peak pools <= CFG.fxMax*'
    );
    check(
      'M7 perf: effects stay live for the whole load run',
      full.effectsSeen >= full.frames - 5 && full.maxPools.particles > 20,
      { effectsSeen: full.effectsSeen, frames: full.frames, peakParticles: full.maxPools.particles },
      'effect pools non-empty on essentially every frame'
    );
    check(
      'M7 perf: perf() reports {avgMs, fps, pressure, quality}',
      full.perf && typeof full.perf.avgMs === 'number' && typeof full.perf.fps === 'number' &&
      typeof full.perf.pressure === 'number' && full.perf.quality === 'full' && full.perf.fps >= 45,
      full.perf,
      'shape valid, quality full, fps >= 45'
    );

    const lightMode = await wf(() => {
      const w = window.__wordfall;
      if (w.settings.fx !== 'light') w.toggleEffects();
      return w.settings.fx;
    });
    const light = await measureFxLoad(185);
    check(
      'M7 perf: light FX is not slower than full FX',
      lightMode === 'light' && light.medianMs <= full.medianMs + 1,
      {
        full: { medianMs: Number(full.medianMs.toFixed(2)), avgMs: Number(full.avgMs.toFixed(2)), fps: Number(fullFps.toFixed(1)) },
        light: { medianMs: Number(light.medianMs.toFixed(2)), avgMs: Number(light.avgMs.toFixed(2)), fps: Number((light.avgMs ? 1000 / light.avgMs : 0).toFixed(1)) },
      },
      'light median frame time <= full median + 1 ms (robust to a one-off Chrome stall)'
    );
    check(
      'M7 perf: light FX still emits effects while clearing',
      light.effectsSeen >= light.frames - 5 && light.maxPools.particles > 0 && light.clears >= 100,
      { effectsSeen: light.effectsSeen, frames: light.frames, peakParticles: light.maxPools.particles, clears: light.clears },
      'effects live on most frames, peak particles > 0'
    );
    const restored = await wf(() => {
      const w = window.__wordfall;
      if (w.settings.fx !== 'full') w.toggleEffects();
      return w.settings.fx;
    });
    check('M7 perf: full FX mode is restored after the measurements', restored === 'full', restored, "'full'");
    notes.perf = {
      full: { frames: full.frames, avgMs: Number(full.avgMs.toFixed(2)), medianMs: Number(full.medianMs.toFixed(2)), fps: Number(fullFps.toFixed(1)), p95Ms: Number(full.p95Ms.toFixed(2)), maxMs: Number(full.maxMs.toFixed(2)), longFrames: full.longFrames, clears: full.clears, maxPools: full.maxPools, caps: full.caps, perf: full.perf },
      light: { frames: light.frames, avgMs: Number(light.avgMs.toFixed(2)), medianMs: Number(light.medianMs.toFixed(2)), fps: Number((light.avgMs ? 1000 / light.avgMs : 0).toFixed(1)), p95Ms: Number(light.p95Ms.toFixed(2)), maxMs: Number(light.maxMs.toFixed(2)), longFrames: light.longFrames, clears: light.clears, maxPools: light.maxPools },
    };
  });

  // ═══ Console/page errors are failures ═════════════════════════════════
  check('runtime: no page or console errors', errors.length === 0, errors.slice(0, 10), 'no errors');
} catch (err) {
  check('smoke: completed without a fatal error', false, firstLine(err), 'no fatal error');
} finally {
  if (browser) await browser.close().catch(() => {});
}

const passed = checks.filter((c) => c.pass).length;
summary = {
  pass: checks.every((c) => c.pass),
  version: 'M8',
  checks,
  failed: checks.filter((c) => !c.pass).map((c) => c.name),
  consoleErrors: errors,
  notes,
  elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
  passed,
  total: checks.length,
};
console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.pass ? 0 : 1;
