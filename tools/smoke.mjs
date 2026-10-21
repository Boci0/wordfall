#!/usr/bin/env node
/**
 * Wordfall end-to-end smoke test (M1 core loop + M2 draft/pressure + M3 cards
 * + M4 screenshots). Drives the real game in headless Chrome through the
 * `window.__wordfall` debug hook; every assertion runs against live state.
 *
 * Run from the wordfall/ folder:
 *   node tools/smoke.mjs
 *   node tools/smoke.mjs --wait-sec 60     # shorten the "wait for M5" window
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
      console.log('Usage: node tools/smoke.mjs [--wait-sec N]\n\nWaits up to N seconds for game.js window.__wordfall.version === \'M5\' (default 900).');
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

async function waitForM5() {
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
    if (version === 'M5') {
      page = candidate;
      return;
    }
    if (version) last = `version=${JSON.stringify(version)}`;
    else if (pageErrors.length) last = `no hook; pageerror: ${pageErrors[0]}`;
    await context.close().catch(() => {});
    if (Date.now() >= deadline) {
      throw new Error(`game.js never exposed window.__wordfall.version === 'M5' within ${opts.waitSec}s (last: ${last})`);
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
      best: s.best,
      bestSaved: (() => { try { return Number(localStorage.getItem('wordfall.best') || 0); } catch (e) { return null; } })(),
    };
  });
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
      scoreMult: w.has('greed') ? (w.heldTier('greed') >= 2 ? 1.6 : 1.3) : 1,
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
    return { phase: s.phase, cleared: s.cleared, combo: s.combo, score: s.score, words: s.words.length };
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

// ─── Main ───────────────────────────────────────────────────────────────────
let summary = null;
try {
  log('launching headless Chrome (channel=chrome)…');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  log(`waiting for ${INDEX_URL} to expose version M5…`);
  await waitForM5();
  log('game.js M5 is live — running checks');

  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const version = await wf(() => window.__wordfall.version);
  check('contract: window.__wordfall.version === M5', version === 'M5', version, "'M5'");

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
    await sleep(120);
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
    const draft = await stateInfo();
    check(
      'M2: clearing 10 words enters the draft',
      draft.phase === 'draft' && draft.cleared === 10,
      { phase: draft.phase, cleared: draft.cleared, wave: draft.wave, waveCleared: draft.waveCleared },
      "phase 'draft' after cleared 10"
    );
    check('M2: combo carries into the draft', draft.combo === 10, { combo: draft.combo, bestCombo: draft.bestCombo }, 'combo 10');
    check('M2: pressure before the first draft is cleared + 4*drafts', draft.pressure === draft.cleared + 4 * draft.draftsTaken, draft.pressure, draft.cleared + 4 * draft.draftsTaken);
    notes.draftOffer = draft.offer;

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

    // Skip still counts as a draft and pays 50 x wave.
    await resetRun();
    const skipped = await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      w.beginDraft();
      const before = { phase: s.phase, pressure: w.pressure(), draftsTaken: s.draftsTaken, score: s.score, wave: s.wave, deck: Object.assign({}, s.deck), skipValue: w.CFG.skipPointsPerWave };
      const ok = w.skip();
      return { before, ok, after: { phase: s.phase, pressure: w.pressure(), draftsTaken: s.draftsTaken, score: s.score, wave: s.wave, deck: Object.assign({}, s.deck) } };
    });
    check('M2: beginDraft() forces the draft open', skipped.before.phase === 'draft', skipped.before.phase, "'draft'");
    check('M2: skip resumes play and takes the draft', skipped.ok === true && skipped.after.phase === 'playing' && skipped.after.draftsTaken === skipped.before.draftsTaken + 1, skipped, 'skip() true, phase playing, draftsTaken +1');
    check('M2: skip raises pressure by exactly 4', skipped.after.pressure - skipped.before.pressure === 4, { before: skipped.before.pressure, after: skipped.after.pressure }, '+4');
    check(
      'M2: skip pays 50 x wave points',
      skipped.after.score - skipped.before.score === skipped.before.skipValue * skipped.before.wave,
      { delta: skipped.after.score - skipped.before.score, expected: skipped.before.skipValue * skipped.before.wave, wave: skipped.before.wave },
      '50 x wave'
    );
    check('M2: skip leaves the deck empty', Object.keys(skipped.after.deck).length === 0, skipped.after.deck, '{}');

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
  };
  const C = {}; // card name -> id
  const catalogue = await wf(() => ({
    cards: window.__wordfall.CARDS.map((c) => ({
      id: c.id, name: c.name, type: c.type, rarity: c.rarity, maxTier: c.maxTier, blurbType: typeof c.blurb,
    })),
  }));
  {
    const problems = [];
    if (catalogue.cards.length !== 12) problems.push(`expected 12 cards, got ${catalogue.cards.length}`);
    const ids = catalogue.cards.map((c) => c.id);
    if (new Set(ids).size !== ids.length) problems.push('duplicate card ids');
    for (const [name, expected] of Object.entries(EXPECTED_CARDS)) {
      const card = catalogue.cards.find((c) => c.name === name);
      if (!card) { problems.push(`missing card "${name}"`); continue; }
      C[name] = card.id;
      for (const field of ['id', 'type', 'rarity', 'maxTier']) {
        if (card[field] !== expected[field]) problems.push(`${name}.${field}: expected ${JSON.stringify(expected[field])}, got ${JSON.stringify(card[field])}`);
      }
    }
    check(
      'M3: CARDS list matches the 12 SPEC cards (id/type/rarity/maxTier)',
      problems.length === 0,
      { count: catalogue.cards.length, problems },
      '12 cards, exact ids/types/rarities/maxTier'
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
      const expected1 = scoreFormula(5, run1, { greedMult: 1.3 });
      check('M3 Greed: fall speed x1.1 and score x1.3 (tier I)', approx(t1.speedMult, 1.1) && run1.cleared && scoreDelta(run1) === expected1, { speedMult: t1.speedMult, delta: scoreDelta(run1), expected: expected1 }, 'speedMult 1.1, score x1.3');

      await wf(({ id }) => window.__wordfall.grant(id, 2), { id: C['Greed'] });
      const t2 = await stateInfo();
      const run2 = await clearWithHook('ember');
      const expected2 = scoreFormula(5, run2, { greedMult: 1.6 });
      check('M3 Greed: tier II speed x1.2 and score x1.6', t2.deck[ C['Greed'] ] === 2 && approx(t2.speedMult, 1.2) && run2.cleared && scoreDelta(run2) === expected2, { deck: t2.deck, speedMult: t2.speedMult, delta: scoreDelta(run2), expected: expected2, before: run2.before }, 'heldTier 2, speedMult 1.2, score x1.6');
    });
  }

  if (C['Longshot']) {
    await section('M3 Longshot', async () => {
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
        'M3 Ledger: +8 bucket pressure, pressure() itself unchanged',
        r.after.bucket - r.before.bucket === 8 && r.after.pressure === r.before.pressure,
        r,
        'bucketPressure +8, pressure unchanged'
      );
      check('M3 Ledger: bucket ramp keeps 7+ letter words out of range at 0 clears', r.after.range[1] < 7, r.after.range, 'wordRange max < 7 (Longshot stays ineligible)');
      const run = await clearWithHook('ember');
      const expected = scoreFormula(5, run, { ledger: true });
      check('M3 Ledger: +2 points per letter', run.cleared && scoreDelta(run) === expected, { delta: scoreDelta(run), expected, before: run.before }, `round(5*(10+2)*comboMult*heatMult) = ${expected}`);
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

  // ═══ M3: all four Hexes raise heat (and score) by tier ═════════════════
  const hexNames = ['Reverse', 'Tunnel', 'Ghost', 'Decoy'].filter((n) => C[n]);
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

  if (hexNames.length === 4) {
    await section('M3 Hex heat aggregate', async () => {
      const r = await wf(({ ids }) => {
        const w = window.__wordfall;
        w.reset();
        for (const id of ids) w.grant(id, 1);
        const tier1 = { heat: w.heat(), heatMult: w.heatMult() };
        w.grant(ids[1], 2); // tunnel
        w.grant(ids[3], 2); // decoy
        return { tier1, tier2: { heat: w.heat(), heatMult: w.heatMult() } };
      }, { ids: [C['Reverse'], C['Tunnel'], C['Ghost'], C['Decoy']] });
      check('M3 Hex heat: all four Hexes stack (heat 4, heatMult 2)', r.tier1.heat === 4 && approx(r.tier1.heatMult, 2), r.tier1, 'heat 4, heatMult 2');
      check('M3 Hex heat: tier II Hexes count twice (heat 6, heatMult 2.5)', r.tier2.heat === 6 && approx(r.tier2.heatMult, 2.5), r.tier2, 'heat 6, heatMult 2.5');
      const run = await clearWithHook('ember');
      const expected = Math.round(5 * 10 * run.before.comboMult * run.before.heatMult);
      check('M3 Hex heat: stack multiplies the score', run.cleared && scoreDelta(run) === expected, { delta: scoreDelta(run), expected, before: run.before }, `expected ${expected}`);
    });
  }

  // ═══ M3: eligibility filter over seeded drafts ═════════════════════════
  await section('M3 draft eligibility', async () => {
    const allGrants = Object.values(EXPECTED_CARDS).map((c) => ({ id: c.id, tier: c.maxTier }));
    const scenarios = [
      { name: 'fresh', count: 200, cleared: 0, seedBase: 10000, grants: [] },
      { name: 'lives3', count: 150, cleared: 0, seedBase: 20000, grants: [], lives: 3 },
      { name: 'shield3', count: 150, cleared: 0, seedBase: 30000, grants: [{ id: C['Steady Hand'], tier: 2 }] },
      { name: 'high-pressure', count: 150, cleared: 200, seedBase: 40000, grants: [] },
      { name: 'scope1', count: 150, cleared: 30, seedBase: 50000, grants: [{ id: C['Wide Scope'], tier: 1 }] },
      { name: 'maxed', count: 100, cleared: 200, seedBase: 60000, grants: allGrants },
    ];
    const result = await wf(({ scenarios, ids }) => {
      const w = window.__wordfall;
      const violations = [];
      const offeredCount = {};
      const scenarioState = {};
      const samples = [];
      let drafts = 0;
      let nullSlotCount = 0;
      let offerCount = 0;
      const hexIds = [ids['Reverse'], ids['Tunnel'], ids['Ghost'], ids['Decoy']];
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
            if (card.type === 'hex' && hexIds.every((id) => (held[id] || 0) >= 1)) violate('a Hex is not offered when all four Hexes are held', { scenario: sc.name, seed: sc.seedBase + i, card: card.id });
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
        violations: violations.slice(0, 40),
        violationCount: violations.length,
        offeredCount,
        scenarioState,
        samples,
      };
    }, { scenarios, ids: Object.fromEntries(Object.entries(C)) });

    check(
      'M3 eligibility: no ineligible card offered across seeded drafts',
      result.violationCount === 0,
      { drafts: result.drafts, scenarioCount: scenarios.length, violationCount: result.violationCount, violations: result.violations },
      '0 violations; 900 seeded beginDraft() offers'
    );
    check(
      'M3 eligibility: scenario preconditions (lives 3, shieldMax 3, low/high word range)',
      result.scenarioState.fresh.range[1] < 7 &&
      result.scenarioState['high-pressure'].range[1] >= 7 &&
      result.scenarioState.lives3.lives === 3 &&
      result.scenarioState.shield3.shieldMax >= 3,
      {
        freshRange: result.scenarioState.fresh.range,
        highRange: result.scenarioState['high-pressure'].range,
        lives3: result.scenarioState.lives3.lives,
        shield3: result.scenarioState.shield3.shieldMax,
      },
      'fresh range max<7, high range max>=7, lives3=3, shield3>=3'
    );
    const covered = Object.values(EXPECTED_CARDS).filter((c) => (result.offeredCount[c.id] || 0) > 0).length;
    check(
      'M3 eligibility: all 12 cards can be offered (draft pool coverage)',
      covered === 12,
      { covered, offeredCount: result.offeredCount },
      '12/12 cards observed'
    );
    notes.eligibility = {
      drafts: result.drafts,
      violations: result.violationCount,
      offeredCount: result.offeredCount,
      samples: result.samples,
      scenarioState: result.scenarioState,
    };
  });

  // ═══ M4: screenshots with cards on the HUD ═════════════════════════════
  await section('M4 screenshots', async () => {
    const allIds = Object.values(EXPECTED_CARDS).map((c) => c.id);
    await resetRun(allIds.map((id) => ({ id, tier: 1 })));
    // Clear one word so a Ghost echo + particles are on screen.
    await clearWithHook('cat', { y: 260 });
    await wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      s.words.length = 0;
      [['lantern', 120], ['ember', 250], ['drift', 380], ['hollow', 510]].forEach(([text, y]) => w.spawnWord(text, { y }));
      const target = w.targetWord();
      if (target) target.progress = 1;
    });
    await sleep(160);
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
    check('M4: HUD-with-cards state renders (12 cards held)', Object.keys(visual.deck).length === 12 && visual.phase === 'playing', { deck: visual.deck, phase: visual.phase }, '12 held cards, phase playing');
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
  version: 'M5',
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
