#!/usr/bin/env node
/**
 * Wordfall v1.6 acceptance checks for the Custom Stage practice mode: entry
 * points, dialog validation, Lines / Falling words layouts, Memorize, Loop,
 * pause / F2 restart, result stats, save-load-reload-delete and the promise
 * that practice never touches the roguelite record book or achievements.
 * Every assertion drives the real game in headless Chrome through
 * window.__wordfall; nothing in the game is edited to make a check pass.
 *
 * Run from the wordfall/ folder:
 *   node tools/qa-custom.mjs [--wait-sec N]
 *
 * Prints a JSON summary on stdout; progress goes to stderr. Exits 0 only if
 * every check passes and the page logged no errors.
 */
import { chromium } from 'playwright-core';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;

const startedAt = Date.now();
const checks = [];
const errors = [];
const log = (...args) => console.error('[qa-custom]', ...args);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const firstLine = (err) => String((err && err.message) || err).split('\n')[0];

function check(name, pass, actual, target) {
  checks.push({
    name,
    pass: !!pass,
    actual: actual === undefined ? null : actual,
    target: target === undefined ? null : target,
  });
  if (!pass) log(`FAIL ${name} — ${JSON.stringify(actual)} (target: ${JSON.stringify(target)})`);
  return !!pass;
}

let waitSec = 60;
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--wait-sec') {
    waitSec = Number(process.argv[++i]);
    if (!Number.isFinite(waitSec) || waitSec <= 0) {
      console.error('qa-custom: --wait-sec must be a number > 0');
      process.exit(2);
    }
  } else if (arg === '-h' || arg === '--help') {
    console.log("Usage: node tools/qa-custom.mjs [--wait-sec N]\n\nWaits up to N seconds for game.js window.__wordfall.version === 'M9' (default 60).");
    process.exit(0);
  } else {
    console.error(`qa-custom: unknown argument: ${arg}`);
    process.exit(2);
  }
}

// The lines stage below relies on a first row with capitals, punctuation and a
// space; the second row proves multi-line text gets its own targets.
const SEG0 = "Hello, World! It's 2026.";
const SEG1 = 'Second line: two, three.';
const LINES_TEXT = SEG0 + '\n' + SEG1;
// Long enough to need several display rows at any sane window width.
const LONG_TEXT = (
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima ' +
  'mike november oscar papa quebec romeo sierra tango uniform victor whiskey ' +
  'xray yankee zulu'
).trim();
// A real "copy the article" paste: citation markers, a bare reference URL, the
// wiki chrome a whole-page copy drags in and the reference tail.
const WIKI_TEXT = [
  'World War II[b] or the Second World War was a global conflict.[1] It was the deadliest conflict in history.[citation needed]',
  '',
  'Jump to content',
  'Main page',
  'Contents',
  'Current events',
  'References',
  '^ Jump up to: https://example.com/source',
  'Retrieved from "https://en.wikipedia.org/wiki/World_War_II"',
].join('\n');
// Same shape, but no wiki markers: an ordinary paste must keep these lines.
const NON_WIKI_TEXT = [
  'Main page',
  'Contents',
  '^ this caret line stays',
  'Retrieved from my notebook',
  'The prose stays here.',
].join('\n');

let browser = null;
let baseline = null;

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });

  const wf = (fn, arg) => page.evaluate(fn, arg);

  /** Wait for a page predicate; returns false on timeout instead of throwing. */
  async function waitFor(fn, arg = null, timeout = 5000) {
    try {
      await page.waitForFunction(fn, arg, { timeout });
      return true;
    } catch (err) {
      return false;
    }
  }
  const waitPhase = (phase, timeout = 5000) =>
    waitFor((p) => window.__wordfall.state.phase === p, phase, timeout);

  async function getState() {
    return wf(() => {
      const w = window.__wordfall;
      const s = w.state;
      const c = s.custom;
      return {
        phase: s.phase,
        lives: s.lives,
        cleared: s.cleared,
        wave: s.wave,
        runSec: s.runSec,
        keys: s.keys,
        mistakes: s.mistakes,
        words: s.words.map((word) => ({ text: word.text, y: word.y, progress: word.progress })),
        custom: c && {
          name: c.name,
          layout: c.layout,
          total: c.total,
          done: c.done,
          lineIndex: c.lineIndex,
          hidden: c.hidden,
          preview: c.preview,
          pass: c.pass,
          remaining: c.remaining,
          memorize: c.memorize,
          loop: c.loop,
          queue: c.queue.slice(),
          liveText: c.liveLine ? c.liveLine.text : null,
          liveProgress: c.liveLine ? c.liveLine.progress : null,
          configName: c.config ? c.config.name : null,
          configText: c.config ? c.config.text : null,
          configLoop: c.config ? c.config.loop : null,
          configClean: c.config ? c.config.clean : null,
          cleaned: c.cleaned ? Object.assign({}, c.cleaned) : null,
        },
      };
    });
  }

  async function getDom() {
    return wf(() => {
      const el = (id) => document.getElementById(id);
      const classed = (id, cls) => !!(el(id) && el(id).classList.contains(cls));
      const empty = document.querySelector('.custom-saved-empty');
      const activeLayout = document.querySelector('#customLayout .mode-btn[aria-pressed="true"]');
      return {
        bodyClass: document.body.className,
        title: el('titleText').textContent,
        statusMain: el('statusMain').textContent,
        statusMode: el('statusMode').textContent,
        mainVisible: getComputedStyle(el('mainScreen')).display !== 'none',
        customDialog: classed('dlgCustom', 'show'),
        doneDialog: classed('dlgCustomDone', 'show'),
        controlsDialog: classed('dlgControls', 'show'),
        pauseDialog: classed('dlgPause', 'show'),
        hint: el('customHint').textContent,
        meta: el('customMeta').textContent,
        resultStats: el('customResultStats').textContent,
        resultTime: el('customResultTime').textContent,
        resultName: el('customResultName').textContent,
        nameValue: el('customName').value,
        textValue: el('customText').value,
        layoutState: activeLayout ? activeLayout.dataset.layout : null,
        savedCount: document.querySelectorAll('.custom-saved-item').length,
        emptySaved: document.querySelectorAll('.custom-saved-empty').length,
        emptySavedText: empty ? empty.textContent : '',
        deleteDisabled: el('customDelete').disabled,
        memorizeDisabled: el('customMemorize').disabled,
        memorizeChecked: el('customMemorize').checked,
        cleanDisabled: el('customClean').disabled,
        cleanChecked: el('customClean').checked,
        newButton: !!el('customNew'),
        cleanButton: !!el('customCleanBtn'),
        savedNames: Array.from(document.querySelectorAll('.custom-saved-item .custom-saved-name')).map((n) => n.textContent),
      };
    });
  }

  /**
   * Computed-style snapshot of the HUD. The de-duplication work leaves every
   * element in the DOM, so visibility must be read from getComputedStyle, not
   * from textContent or element presence.
   */
  async function getHud() {
    return wf(() => {
      const vis = (id) => {
        const el = document.getElementById(id);
        return !!el && getComputedStyle(el).display !== 'none';
      };
      const text = (id) => {
        const el = document.getElementById(id);
        return el ? el.textContent : null;
      };
      const statusIds = [
        'statusMain', 'statusTime', 'statusMode', 'statusCombo', 'statusScore',
        'statusWave', 'statusLives', 'statusShields', 'statusHeat', 'statusPressure',
      ];
      const toolSep = document.querySelector('#toolbar .tool-sep');
      return {
        practice: document.body.classList.contains('practice'),
        visiblePanels: statusIds.filter(vis),
        mainText: text('statusMain'),
        timeVisible: vis('statusTime'),
        modeVisible: vis('statusMode'),
        comboVisible: vis('statusCombo'),
        scoreVisible: vis('statusScore'),
        waveVisible: vis('statusWave'),
        livesVisible: vis('statusLives'),
        shieldsVisible: vis('statusShields'),
        heatVisible: vis('statusHeat'),
        pressureVisible: vis('statusPressure'),
        deckFieldVisible: vis('deckField'),
        toolSepVisible: !!toolSep && getComputedStyle(toolSep).display !== 'none',
        stripRun: text('stripRun'),
        stripRunSub: text('stripRunSub'),
        stripWave: text('stripWave'),
        stripWaveSub: text('stripWaveSub'),
        stripBest: text('stripBest'),
        stripBestSub: text('stripBestSub'),
        stripMode: text('stripMode'),
        stripLabels: Array.from(document.querySelectorAll('#stripHud .strip-label')).map((n) => n.textContent),
      };
    });
  }

  async function openCustomDialog() {
    await page.locator('.main-item[data-cmd="custom"]').click();
    return waitFor(() => {
      const d = document.getElementById('dlgCustom');
      return !!d && d.classList.contains('show');
    }, null, 3000);
  }

  async function blurActive() {
    await wf(() => {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    });
  }

  async function typeText(text, delay = 4) {
    await page.keyboard.type(text, { delay });
  }

  /** Back to the main screen from any custom phase (used to isolate sections). */
  async function returnToMenu() {
    const phase = await wf(() => window.__wordfall.state.phase);
    if (phase !== 'menu') {
      await wf(() => window.__wordfall.returnToMenu());
      await waitPhase('menu', 3000);
      await sleep(100);
    }
  }

  /** Type every target token until the falling-words stage completes. */
  async function clearCustomWords(maxSteps = 90) {
    for (let i = 0; i < maxSteps; i++) {
      const phase = await wf(() => window.__wordfall.state.phase);
      if (phase !== 'playing') return phase;
      const step = await wf(() => {
        const w = window.__wordfall;
        const target = w.targetWord();
        if (!target) return null;
        const ch = w.nextChar(target);
        return ch == null ? null : { ch };
      });
      if (!step) {
        await sleep(100);
        continue;
      }
      await page.keyboard.press(step.ch === ' ' ? 'Space' : step.ch);
      await sleep(40);
    }
    return wf(() => window.__wordfall.state.phase);
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────
  await page.goto(INDEX_URL, { waitUntil: 'load' });
  try {
    await page.waitForFunction(
      () => window.__wordfall && window.__wordfall.version === 'M9',
      null,
      { timeout: waitSec * 1000 }
    );
  } catch (err) {
    console.error(`[qa-custom] game.js never exposed window.__wordfall.version === 'M9' within ${waitSec}s (last: ${firstLine(err)})`);
    await browser.close();
    process.exit(1);
  }

  // This suite owns the custom-stage store: start from a known empty slate so
  // the empty-list and prefill checks are deterministic. (Playwright uses a
  // throw-away browser profile; nothing of the user's is touched.)
  await wf(() => {
    try {
      localStorage.removeItem('wordfall.custom.stages');
      localStorage.removeItem('wordfall.custom.last');
    } catch (err) { /* ignore */ }
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__wordfall && window.__wordfall.version === 'M9',
    null,
    { timeout: waitSec * 1000 }
  );
  await sleep(300);
  log('game.js M9 is live — running Custom Stage checks');

  baseline = await wf(() => ({
    records: JSON.parse(JSON.stringify(window.__wordfall.records)),
    achieved: Object.keys(window.__wordfall.achieved).sort(),
  }));

  // ─── 1. Entry points and the empty dialog ────────────────────────────────
  let s = await getState();
  let dom = await getDom();
  const mainCustom = page.locator('.main-item[data-cmd="custom"]');
  check('boot: opens on the main menu', s.phase === 'menu', s.phase, "'menu'");
  check('boot: body phase class is phase-menu', /\bphase-menu\b/.test(dom.bodyClass), dom.bodyClass, 'phase-menu');
  check(
    'entry: the main-screen Custom Stage button is visible',
    (await mainCustom.count()) === 1 && (await mainCustom.isVisible()),
    await mainCustom.count(),
    'one visible item'
  );
  check(
    'entry: the Game-menu Custom Stage item exists',
    (await page.locator('#menuCustom').count()) === 1,
    await page.locator('#menuCustom').count(),
    'one #menuCustom item'
  );
  check(
    'entry: both custom dialogs are in the document',
    (await page.locator('#dlgCustom').count()) === 1 && (await page.locator('#dlgCustomDone').count()) === 1,
    null,
    '#dlgCustom + #dlgCustomDone'
  );

  check(
    'entry: the Game menu item opens the editor',
    await page.locator('.menu-item[data-menu="game"] .menu-label').click()
      .then(() => waitFor(() => {
        const item = document.getElementById('menuCustom');
        return !!item && item.offsetParent !== null;
      }, null, 2000))
      .then(async (visible) => {
        if (!visible) return false;
        await page.locator('#menuCustom').click();
        return waitFor(() => document.getElementById('dlgCustom').classList.contains('show'), null, 3000);
      }),
    null,
    'dropdown visible then dialog open'
  );
  dom = await getDom();
  s = await getState();
  check(
    'entry: the Game-menu entry leaves the menu phase intact',
    s.phase === 'menu' && dom.customDialog && dom.mainVisible,
    { phase: s.phase, dialog: dom.customDialog },
    'menu phase, dialog over the main screen'
  );

  // Controls dialog documents the mode.
  await page.locator('#customCancel').click();
  await sleep(100);
  await page.locator('.main-item[data-cmd="controls"]').click();
  await waitFor(() => document.getElementById('dlgControls').classList.contains('show'), null, 3000);
  const controlsRow = await wf(() => {
    const rows = Array.from(document.querySelectorAll('#dlgControls .key-table tr'));
    const row = rows.find((r) => {
      const key = r.querySelector('.key');
      return key && key.textContent.trim() === 'Custom';
    });
    return row ? row.textContent : null;
  });
  check(
    'entry: the Controls dialog documents Custom Stage',
    !!controlsRow && /Custom Stage/.test(controlsRow) && /practice stage/.test(controlsRow),
    controlsRow,
    'a Custom row describing the practice stage'
  );
  await page.locator('#controlsOk').click();
  await sleep(120);
  s = await getState();
  check('entry: closing Controls returns to the menu', s.phase === 'menu', s.phase, "'menu'");

  // The only entry point left is the main-screen button, which the rest of the
  // suite uses; this also checks the empty saved list.
  await openCustomDialog();
  dom = await getDom();
  s = await getState();
  check(
    'dialog: the main-screen button opens the editor over the menu',
    dom.customDialog && s.phase === 'menu' && dom.mainVisible,
    { dialog: dom.customDialog, phase: s.phase },
    'dialog open, phase menu'
  );
  check(
    'dialog: a fresh profile shows the empty saved list',
    dom.savedCount === 0 && dom.emptySaved === 1 && /No saved stages/.test(dom.emptySavedText),
    { saved: dom.savedCount, empty: dom.emptySaved },
    '0 items, empty placeholder'
  );
  check('dialog: Delete is disabled when nothing is loaded', dom.deleteDisabled, dom.deleteDisabled, true);
  check(
    'dialog: the New and Clean text controls are present',
    dom.newButton && dom.cleanButton,
    { newButton: dom.newButton, cleanButton: dom.cleanButton },
    'both buttons in the editor'
  );
  check(
    'dialog: Clean on start defaults to checked',
    dom.cleanChecked && !dom.cleanDisabled,
    { checked: dom.cleanChecked, disabled: dom.cleanDisabled },
    'enabled and checked'
  );

  // ─── 2. Dialog validation ────────────────────────────────────────────────
  await page.locator('#customStart').click();
  await sleep(100);
  dom = await getDom();
  s = await getState();
  check(
    'validation: Start with empty text hints and stays on the menu',
    /Paste some text first/.test(dom.hint) && s.phase === 'menu' && dom.customDialog,
    { hint: dom.hint, phase: s.phase },
    'inline hint, phase menu, dialog still open'
  );

  await page.locator('#customText').fill('a 1 2 b');
  await page.locator('#customLayout .mode-btn[data-layout="words"]').click();
  await sleep(100);
  dom = await getDom();
  check(
    'validation: the words layout counts tokens and disables Memorize',
    dom.layoutState === 'words' && /0 falling words/.test(dom.meta) && dom.memorizeDisabled,
    { layout: dom.layoutState, meta: dom.meta, disabled: dom.memorizeDisabled },
    'words layout, 0 words, Memorize disabled'
  );
  await page.locator('#customStart').click();
  await sleep(100);
  dom = await getDom();
  s = await getState();
  check(
    'validation: words layout with no usable words hints and keeps the menu',
    /no usable words/.test(dom.hint) && s.phase === 'menu',
    { hint: dom.hint, phase: s.phase },
    'inline hint, phase menu'
  );

  // Memorize belongs to the lines layout only, and switching to words clears it.
  await page.locator('#customLayout .mode-btn[data-layout="lines"]').click();
  await sleep(80);
  await page.locator('#customMemorize').check();
  await sleep(60);
  dom = await getDom();
  check(
    'validation: Memorize is usable on the lines layout',
    !dom.memorizeDisabled && dom.memorizeChecked,
    { disabled: dom.memorizeDisabled, checked: dom.memorizeChecked },
    'enabled and checked'
  );
  await page.locator('#customLayout .mode-btn[data-layout="words"]').click();
  await sleep(80);
  dom = await getDom();
  check(
    'validation: switching to words disables and clears Memorize',
    dom.memorizeDisabled && !dom.memorizeChecked,
    { disabled: dom.memorizeDisabled, checked: dom.memorizeChecked },
    'disabled and unchecked'
  );
  await page.locator('#customCancel').click();
  await waitFor(() => !document.getElementById('dlgCustom').classList.contains('show'), null, 2000);
  await sleep(100);

  // ─── 3. Lines: case, spaces, punctuation and the result dialog ───────────
  await openCustomDialog();
  await page.locator('#customName').fill('QA Lines');
  await page.locator('#customText').fill(LINES_TEXT);
  await sleep(100);
  dom = await getDom();
  check(
    'lines: the live meta counts the text rows',
    /2 lines to type/.test(dom.meta),
    dom.meta,
    '2 lines to type'
  );
  await page.locator('#customStart').click();
  const linesPlaying = await waitPhase('playing', 4000);
  await waitFor(() => {
    const c = window.__wordfall.state.custom;
    return !!c && !!c.liveLine;
  }, null, 3000);
  s = await getState();
  dom = await getDom();
  check(
    'lines: the stage starts playing with the text split into rows',
    linesPlaying && s.phase === 'playing' && s.custom && s.custom.layout === 'lines' && s.custom.total === 2,
    { phase: s.phase, custom: s.custom && { layout: s.custom.layout, total: s.custom.total } },
    'playing, lines layout, 2 rows'
  );
  check(
    'lines: the first row is the first text line with its case preserved',
    s.custom && s.custom.liveText === SEG0,
    s.custom && s.custom.liveText,
    JSON.stringify(SEG0)
  );
  check('lines: body phase class is phase-playing', /\bphase-playing\b/.test(dom.bodyClass), dom.bodyClass, 'phase-playing');
  check(
    'lines: the status bar switches to practice readouts',
    dom.statusMain === 'Practice' && /Mode: Custom/.test(dom.statusMode),
    { main: dom.statusMain, mode: dom.statusMode },
    'Practice / Mode: Custom'
  );

  // HUD de-duplication: one clock (the strip), one mode (the strip), and in a
  // practice stage exactly one status panel. Everything else stays in the DOM
  // but must compute to display:none.
  const practiceHud = await getHud();
  check(
    'HUD practice: body carries the practice class during a custom stage',
    practiceHud.practice,
    practiceHud.practice,
    true
  );
  check(
    'HUD practice: only the Practice status panel is visible',
    practiceHud.visiblePanels.length === 1 &&
      practiceHud.visiblePanels[0] === 'statusMain' &&
      practiceHud.mainText === 'Practice',
    { visible: practiceHud.visiblePanels, text: practiceHud.mainText },
    '["statusMain"] with text Practice'
  );
  check(
    'HUD practice: the roguelite panels, deck field and toolbar separator are hidden',
    !practiceHud.comboVisible && !practiceHud.scoreVisible && !practiceHud.waveVisible &&
      !practiceHud.livesVisible && !practiceHud.shieldsVisible && !practiceHud.heatVisible &&
      !practiceHud.pressureVisible && !practiceHud.deckFieldVisible && !practiceHud.toolSepVisible,
    {
      combo: practiceHud.comboVisible, score: practiceHud.scoreVisible, wave: practiceHud.waveVisible,
      lives: practiceHud.livesVisible, shields: practiceHud.shieldsVisible, heat: practiceHud.heatVisible,
      pressure: practiceHud.pressureVisible, deck: practiceHud.deckFieldVisible, sep: practiceHud.toolSepVisible,
    },
    'all hidden'
  );
  check(
    'HUD practice: the run clock and mode live only in the signal strip',
    !practiceHud.timeVisible && !practiceHud.modeVisible &&
      /^\d\d:\d\d$/.test(practiceHud.stripRun) && practiceHud.stripMode === 'CUSTOM',
    { timeVisible: practiceHud.timeVisible, modeVisible: practiceHud.modeVisible, stripRun: practiceHud.stripRun, stripMode: practiceHud.stripMode },
    'statusTime/statusMode hidden, stripRun MM:SS, strip mode CUSTOM'
  );
  check(
    'HUD practice: the strip sub-labels are trimmed to one fact each',
    practiceHud.stripRunSub === '' && practiceHud.stripWaveSub === '' &&
      practiceHud.stripBestSub === 'Lines',
    { runSub: practiceHud.stripRunSub, waveSub: practiceHud.stripWaveSub, bestSub: practiceHud.stripBestSub },
    "runSub '', waveSub '', bestSub 'Lines'"
  );

  await blurActive();
  const target0 = SEG0.toLowerCase();
  await typeText(target0.slice(0, 5), 5);
  await sleep(100);
  s = await getState();
  check(
    'lines: a typed prefix advances progress in place',
    s.custom && s.custom.liveProgress === 5 && s.phase === 'playing',
    s.custom && s.custom.liveProgress,
    5
  );
  await typeText(target0.slice(5), 3);
  const row2 = await waitFor(() => {
    const c = window.__wordfall.state.custom;
    return !!c && c.lineIndex === 1 && !!c.liveLine && c.liveLine.text === 'Second line: two, three.';
  }, null, 5000);
  s = await getState();
  check(
    'lines: clearing a row spawns the next row',
    row2 && s.custom && s.custom.done === 1 && s.custom.liveText === SEG1,
    s.custom && { done: s.custom.done, live: s.custom.liveText },
    'row 2 spawned after row 1 cleared'
  );
  await typeText(SEG1.toLowerCase(), 3);
  await waitPhase('customdone', 5000);
  await sleep(100);
  s = await getState();
  dom = await getDom();
  check(
    'lines: completing every row opens the result dialog',
    s.phase === 'customdone' && dom.doneDialog,
    { phase: s.phase, dialog: dom.doneDialog },
    'customdone + dialog'
  );
  check(
    'lines: every space, capital and punctuation key counts as a hit',
    s.keys === SEG0.length + SEG1.length && s.mistakes === 0,
    { keys: s.keys, expected: SEG0.length + SEG1.length, mistakes: s.mistakes },
    'all keys hit, no misses'
  );
  check(
    'lines: result stats report rows, keys, WPM and accuracy',
    /2\/2 lines typed/.test(dom.resultStats) && /[1-9]\d* WPM/.test(dom.resultStats) && /% accuracy/.test(dom.resultStats),
    dom.resultStats,
    '2/2 lines typed + WPM + accuracy'
  );
  check('lines: result shows the elapsed time', /^\d\d:\d\d$/.test(dom.resultTime), dom.resultTime, 'MM:SS');
  check('lines: result names the stage', dom.resultName === 'QA Lines', dom.resultName, "'QA Lines'");
  check(
    'lines: body phase class is phase-customdone',
    /\bphase-customdone\b/.test(dom.bodyClass),
    dom.bodyClass,
    'phase-customdone'
  );

  // ─── 4. Result dialog: Again, Edit Text, Main Menu ───────────────────────
  await page.locator('#customAgain').click();
  await waitPhase('playing', 3000);
  await sleep(120);
  s = await getState();
  check(
    'result: Again restarts the same stage from row 1',
    s.phase === 'playing' && s.custom && s.custom.lineIndex === 0 && s.custom.total === 2 && s.custom.done === 0,
    s.custom && { phase: s.phase, line: s.custom.lineIndex, done: s.custom.done },
    'playing, row 1, 0 done'
  );
  await blurActive();
  await typeText(target0, 3);
  await waitFor(() => {
    const c = window.__wordfall.state.custom;
    return !!c && c.lineIndex === 1 && !!c.liveLine;
  }, null, 5000);
  await typeText(SEG1.toLowerCase(), 3);
  await waitPhase('customdone', 5000);
  await sleep(100);

  await page.locator('#customEdit').click();
  await waitFor(() => document.getElementById('dlgCustom').classList.contains('show'), null, 3000);
  await sleep(80);
  dom = await getDom();
  check(
    'result: Edit Text reopens the editor with the same stage',
    dom.customDialog && dom.nameValue === 'QA Lines' && dom.textValue === LINES_TEXT,
    { dialog: dom.customDialog, name: dom.nameValue, text: dom.textValue },
    'editor prefilled with the played stage'
  );
  await page.locator('#customCancel').click();
  await waitFor(() => document.getElementById('dlgCustomDone').classList.contains('show'), null, 3000);
  await sleep(80);
  await page.locator('#customResultMenu').click();
  await waitPhase('menu', 3000);
  await sleep(120);
  dom = await getDom();
  s = await getState();
  check(
    'result: Main Menu abandons practice and returns to the main screen',
    s.phase === 'menu' && dom.mainVisible && !dom.doneDialog,
    { phase: s.phase, main: dom.mainVisible, dialog: dom.doneDialog },
    'menu, main screen visible, no dialog'
  );
  const menuHud = await getHud();
  check(
    'HUD practice: leaving the stage clears the practice class and restores the roguelite panels',
    !menuHud.practice && menuHud.comboVisible && menuHud.scoreVisible &&
      menuHud.waveVisible && menuHud.livesVisible && !menuHud.timeVisible && !menuHud.modeVisible,
    {
      practice: menuHud.practice, combo: menuHud.comboVisible, score: menuHud.scoreVisible,
      wave: menuHud.waveVisible, lives: menuHud.livesVisible,
      time: menuHud.timeVisible, mode: menuHud.modeVisible,
    },
    'no practice class, panels back, clock/mode still strip-only'
  );

  // ─── 5. Long pasted line wraps into several targets ──────────────────────
  await openCustomDialog();
  await page.locator('#customName').fill('QA Long');
  await page.locator('#customText').fill(LONG_TEXT);
  await sleep(100);
  const split = await wf((text) => {
    const w = window.__wordfall;
    const segments = w.custom.segments(text);
    const maxChars = w.custom.segments('a'.repeat(400))[0].length;
    return { segments, maxChars };
  }, LONG_TEXT);
  dom = await getDom();
  check(
    'long line: one pasted line becomes several display-sized targets',
    split.segments.length >= 2 && split.segments.every((seg) => seg.length <= split.maxChars),
    { count: split.segments.length, maxChars: split.maxChars },
    '>= 2 rows, none wider than the board'
  );
  check(
    'long line: segments split at word boundaries and keep every word in order',
    split.segments.every((seg) => seg === seg.trim() && !/\s{2,}/.test(seg)) &&
      split.segments.join(' ') === LONG_TEXT,
    split.segments.join(' ') === LONG_TEXT,
    'row text re-joins to the source line'
  );
  check(
    'long line: the dialog meta reports the wrapped row count',
    new RegExp(`${split.segments.length} lines to type`).test(dom.meta),
    dom.meta,
    `${split.segments.length} lines to type`
  );
  await page.locator('#customStart').click();
  await waitPhase('playing', 4000);
  await sleep(100);
  s = await getState();
  check(
    'long line: the stage runs one target per wrapped row',
    s.custom && s.custom.layout === 'lines' && s.custom.total === split.segments.length && s.custom.liveText === split.segments[0],
    s.custom && { total: s.custom.total, live: s.custom.liveText },
    'total === wrapped rows, first row spawned'
  );
  await blurActive();
  await typeText(split.segments[0].toLowerCase(), 3);
  const advanced = await waitFor((count) => {
    const c = window.__wordfall.state.custom;
    return !!c && c.lineIndex === 1 && !!c.liveLine && c.liveLine.text === c.lines[1];
  }, null, 5000);
  s = await getState();
  check(
    'long line: finishing a wrapped row advances to the next one',
    advanced && s.custom && s.custom.done === 1 && s.custom.lineIndex === 1,
    s.custom && { done: s.custom.done, line: s.custom.lineIndex },
    'row 2 active after row 1'
  );
  await returnToMenu();

  // ─── 6. Memorize: preview, hide, recall ──────────────────────────────────
  await openCustomDialog();
  await page.locator('#customName').fill('QA Memory');
  await page.locator('#customText').fill('hold the line');
  await page.locator('#customMemorize').check();
  await page.locator('#customStart').click();
  await waitPhase('playing', 4000);
  await waitFor(() => {
    const c = window.__wordfall.state.custom;
    return !!c && !!c.liveLine;
  }, null, 3000);
  s = await getState();
  check(
    'memorize: the line starts visible during the preview window',
    s.custom && s.custom.memorize && s.custom.hidden === false && s.custom.preview > 0 &&
      s.custom.liveText === 'hold the line',
    s.custom && { hidden: s.custom.hidden, preview: s.custom.preview },
    'visible with a preview timer'
  );
  await wf(() => {
    const c = window.__wordfall.custom.state();
    if (c) c.preview = 0.05;
  });
  const hid = await waitFor(() => {
    const c = window.__wordfall.custom.state();
    return !!c && c.hidden === true;
  }, null, 3000);
  s = await getState();
  check('memorize: the line hides when the preview expires', hid && s.custom && s.custom.hidden === true, s.custom && s.custom.hidden, true);
  const memoHud = await getHud();
  check(
    'HUD practice: Memorize is the only middle strip sub-label',
    memoHud.stripWaveSub === 'Memorize' && memoHud.stripRunSub === '',
    { waveSub: memoHud.stripWaveSub, runSub: memoHud.stripRunSub },
    "waveSub 'Memorize', runSub ''"
  );
  await blurActive();
  await typeText('hold', 4);
  await sleep(120);
  s = await getState();
  check(
    'memorize: typing from memory advances the hidden prefix',
    s.custom && s.custom.hidden === true && s.custom.liveProgress === 4 &&
      s.words.length === 1 && s.words[0].text === 'hold the line',
    s.custom && { hidden: s.custom.hidden, progress: s.custom.liveProgress },
    'hidden line, progress 4, still on board'
  );
  await typeText(' the line', 4);
  await waitPhase('customdone', 5000);
  await sleep(100);
  dom = await getDom();
  check(
    'memorize: typing the hidden line from memory completes the stage',
    /1\/1 lines typed/.test(dom.resultStats),
    dom.resultStats,
    '1/1 lines typed'
  );
  await page.locator('#customResultMenu').click();
  await waitPhase('menu', 3000);
  await sleep(100);

  // ─── 7. Falling words: order, miss requeue, completion ───────────────────
  await openCustomDialog();
  await page.locator('#customName').fill('QA Words');
  await page.locator('#customText').fill('alpha beta gamma');
  await page.locator('#customLayout .mode-btn[data-layout="words"]').click();
  await sleep(100);
  dom = await getDom();
  check(
    'words: the dialog reports the falling-word token count',
    dom.layoutState === 'words' && /3 falling words/.test(dom.meta),
    dom.meta,
    '3 falling words'
  );
  await page.locator('#customStart').click();
  await waitPhase('playing', 4000);
  await sleep(100);
  s = await getState();
  check(
    'words: falling-words stage queues the tokens in text order',
    s.custom && s.custom.layout === 'words' && s.custom.total === 3 && s.custom.remaining === 3 &&
      JSON.stringify(s.custom.queue) === '["alpha","beta","gamma"]',
    s.custom && { total: s.custom.total, remaining: s.custom.remaining, queue: s.custom.queue },
    'alpha, beta, gamma'
  );
  await waitFor(() => window.__wordfall.state.words.length >= 1, null, 4000);
  const firstTokens = await wf(() => window.__wordfall.state.words.map((w) => w.text));
  check('words: the first falling token is the first word', firstTokens[0] === 'alpha', firstTokens, 'alpha first');
  await waitFor(() => window.__wordfall.state.words.length >= 2, null, 5000);
  const pair = await wf(() => window.__wordfall.state.words.map((w) => w.text));
  check(
    'words: tokens fall in reading order',
    pair[0] === 'alpha' && pair[1] === 'beta',
    pair,
    'alpha then beta'
  );

  const livesBefore = (await getState()).lives;
  await wf(() => {
    const st = window.__wordfall.state;
    const word = st.words[0];
    if (word) word.y = st.groundY - 2;
  });
  const missed = await waitFor(() => window.__wordfall.state.words.every((w) => w.text !== 'alpha'), null, 2500);
  await sleep(120);
  s = await getState();
  check(
    'words: a word forced across the line costs no life',
    missed && s.lives === livesBefore,
    { lives: s.lives, before: livesBefore },
    livesBefore
  );
  check(
    'words: a missed word stays counted in remaining',
    s.custom && s.custom.remaining === 3,
    s.custom && s.custom.remaining,
    3
  );
  check(
    'words: a missed word is requeued instead of lost',
    s.custom && s.custom.queue.includes('alpha'),
    s.custom && s.custom.queue,
    'queue contains alpha'
  );
  check('words: the stage keeps playing after a miss', s.phase === 'playing', s.phase, "'playing'");
  const respawned = await waitFor(() => window.__wordfall.state.words.some((w) => w.text === 'alpha'), null, 7000);
  check('words: the requeued word comes back round', respawned, respawned, true);

  const finalPhase = await clearCustomWords();
  await sleep(100);
  dom = await getDom();
  check(
    'words: clearing every token completes the stage',
    finalPhase === 'customdone' && dom.doneDialog,
    { phase: finalPhase, dialog: dom.doneDialog },
    'customdone + result dialog'
  );
  check(
    'words: result stats count the cleared words',
    /3\/3 words cleared/.test(dom.resultStats),
    dom.resultStats,
    '3/3 words cleared'
  );
  await page.locator('#customResultMenu').click();
  await waitPhase('menu', 3000);
  await sleep(100);

  // ─── 8. Loop, Esc pause/resume, F2 restart ───────────────────────────────
  const loopStarted = await wf(() =>
    window.__wordfall.custom.start({ name: 'Loop Stage', text: 'loop me', layout: 'lines', loop: true })
  );
  await waitPhase('playing', 3000);
  await sleep(120);
  s = await getState();
  check(
    'loop: the stage starts on pass 1',
    loopStarted && s.custom && s.custom.loop === true && s.custom.pass === 1,
    s.custom && { pass: s.custom.pass, loop: s.custom.loop },
    'pass 1, loop on'
  );
  await blurActive();
  await typeText('loop me', 5);
  const looped = await waitFor(() => {
    const c = window.__wordfall.state.custom;
    return !!c && c.pass === 2;
  }, null, 5000);
  s = await getState();
  check(
    'loop: clearing the text starts pass 2 instead of ending',
    looped && s.phase === 'playing' && s.custom && s.custom.pass === 2 && s.custom.done === 0,
    s.custom && { phase: s.phase, pass: s.custom.pass, done: s.custom.done },
    'still playing, pass 2'
  );
  const freshLine = await waitFor(() => {
    const c = window.__wordfall.state.custom;
    return !!c && !!c.liveLine && c.liveLine.text === 'loop me';
  }, null, 4000);
  dom = await getDom();
  s = await getState();
  check(
    'loop: pass 2 spawns a fresh line and keeps playing',
    freshLine && s.phase === 'playing' && s.custom && s.custom.lineIndex === 0 &&
      /\bphase-playing\b/.test(dom.bodyClass),
    s.custom && { line: s.custom.lineIndex, live: s.custom.liveText },
    'fresh row, phase-playing'
  );
  const loopHud = await getHud();
  check(
    'HUD practice: the loop pass is the only left strip sub-label',
    loopHud.stripRunSub === 'Loop 2' && loopHud.stripWaveSub === '',
    { runSub: loopHud.stripRunSub, waveSub: loopHud.stripWaveSub },
    "runSub 'Loop 2', waveSub ''"
  );

  const beforePause = (await getState()).runSec;
  await page.keyboard.press('Escape');
  const pausedOk = await waitPhase('paused', 3000);
  await sleep(300);
  const midPause = await getState();
  dom = await getDom();
  check(
    'pause: Esc pauses a custom stage and opens the pause dialog',
    pausedOk && midPause.phase === 'paused' && dom.pauseDialog,
    { phase: midPause.phase, dialog: dom.pauseDialog },
    'paused + dialog'
  );
  check(
    'pause: the practice clock freezes while paused',
    Math.abs(midPause.runSec - beforePause) < 0.12,
    { paused: midPause.runSec, before: beforePause },
    'runSec unchanged'
  );
  check('pause: body phase class is phase-paused', /\bphase-paused\b/.test(dom.bodyClass), dom.bodyClass, 'phase-paused');
  await page.keyboard.press('Escape');
  const resumedOk = await waitPhase('playing', 3000);
  await sleep(150);
  s = await getState();
  dom = await getDom();
  check(
    'pause: Esc resumes the same line mid-stage',
    resumedOk && s.phase === 'playing' && s.custom && s.custom.liveText === 'loop me' &&
      s.custom.liveProgress === 0 && /\bphase-playing\b/.test(dom.bodyClass),
    s.custom && { live: s.custom.liveText, progress: s.custom.liveProgress },
    'same row, phase-playing'
  );

  await sleep(250);
  const beforeF2 = (await getState()).runSec;
  await page.keyboard.press('F2');
  const restarted = await waitFor(() => {
    const st = window.__wordfall.state;
    const c = st.custom;
    return st.phase === 'playing' && !!c && c.pass === 1 && c.lineIndex === 0 && !!c.liveLine;
  }, null, 3000);
  await sleep(100);
  s = await getState();
  dom = await getDom();
  check(
    'F2: restarts the custom stage instead of starting a standard run',
    restarted && s.custom && s.custom.name === 'Loop Stage' && s.custom.configLoop === true && s.runSec < beforeF2,
    s.custom && { phase: s.phase, name: s.custom.name, runSec: s.runSec, before: beforeF2 },
    'custom stage restarted, clock reset'
  );
  check(
    'F2: the practice UI survives the restart',
    /Practice/.test(dom.statusMain) && /Custom · Line/.test(dom.title),
    { status: dom.statusMain, title: dom.title },
    'Practice + Custom title'
  );
  await returnToMenu();

  // ─── 9. Save / load / reload / delete ────────────────────────────────────
  await openCustomDialog();
  await page.locator('#customName').fill('Saved Stage');
  await page.locator('#customText').fill('alpha beta gamma');
  await page.locator('#customSave').click();
  await sleep(150);
  const savedStages = await wf(() => window.__wordfall.custom.stages());
  dom = await getDom();
  check(
    'save: Save stores the stage with its name, text and layout',
    savedStages.length === 1 && savedStages[0].name === 'Saved Stage' && savedStages[0].text === 'alpha beta gamma',
    savedStages.map((x) => ({ name: x.name, text: x.text, layout: x.layout })),
    'one Saved Stage'
  );
  check(
    'save: the saved list renders the stage',
    dom.savedCount === 1 && dom.emptySaved === 0,
    { saved: dom.savedCount, empty: dom.emptySaved },
    '1 item, no placeholder'
  );
  check(
    'save: the hint confirms the save and Delete becomes enabled',
    /Saved/.test(dom.hint) && !dom.deleteDisabled,
    { hint: dom.hint, deleteDisabled: dom.deleteDisabled },
    'saved hint, Delete enabled'
  );
  await page.locator('#customCancel').click();
  await waitFor(() => !document.getElementById('dlgCustom').classList.contains('show'), null, 2000);
  await sleep(120);
  check('save: Cancel returns to the main menu', (await getState()).phase === 'menu', null, "'menu'");

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(
    () => window.__wordfall && window.__wordfall.version === 'M9',
    null,
    { timeout: waitSec * 1000 }
  );
  await sleep(300);
  await openCustomDialog();
  await sleep(100);
  dom = await getDom();
  const reloadedStages = await wf(() => window.__wordfall.custom.stages());
  check(
    'save: the saved stage survives a page reload',
    dom.savedCount === 1 && reloadedStages.length === 1 && reloadedStages[0].name === 'Saved Stage',
    { saved: dom.savedCount, stored: reloadedStages.map((x) => x.name) },
    '1 stage after reload'
  );
  await page.locator('.custom-saved-item').first().click();
  await sleep(120);
  dom = await getDom();
  check(
    'save: loading a saved stage fills the editor',
    dom.nameValue === 'Saved Stage' && dom.textValue === 'alpha beta gamma' && dom.layoutState === 'lines',
    { name: dom.nameValue, text: dom.textValue, layout: dom.layoutState },
    'editor filled from storage'
  );
  await page.locator('#customDelete').click();
  await sleep(150);
  const afterDelete = await wf(() => window.__wordfall.custom.stages());
  dom = await getDom();
  check(
    'delete: Delete removes the saved stage and shows the empty list again',
    afterDelete.length === 0 && dom.savedCount === 0 && dom.emptySaved === 1 && dom.deleteDisabled,
    { stored: afterDelete.length, saved: dom.savedCount, empty: dom.emptySaved },
    '0 stored, placeholder back, Delete disabled'
  );
  await page.locator('#customCancel').click();
  await waitPhase('menu', 3000);
  await sleep(100);

  // ─── 11. Smart text cleanup: cleaner rules ──────────────────────────────
  const cleanApi = await wf(() => typeof window.__wordfall.custom.clean);
  check('cleaner: window.__wordfall.custom.clean is exposed', cleanApi === 'function', cleanApi, "'function'");

  const wikiClean = await wf((text) => window.__wordfall.custom.clean(text), WIKI_TEXT);
  check(
    'cleaner: a wiki paste loses [b], [1] and [citation needed] markers',
    !/\[b\]|\[1\]|\[citation needed\]/i.test(wikiClean.text) && !/citation needed/i.test(wikiClean.text),
    wikiClean.text.slice(0, 120),
    'no citation markers left'
  );
  check(
    'cleaner: a wiki paste loses its bare URLs',
    !/https?:\/\//i.test(wikiClean.text),
    wikiClean.text.slice(0, 120),
    'no http(s) URLs left'
  );
  check(
    'cleaner: the wiki paste prose survives intact',
    wikiClean.text.includes('World War II or the Second World War was a global conflict. It was the deadliest conflict in history.'),
    wikiClean.text,
    'both prose sentences intact'
  );
  check(
    'cleaner: wiki chrome lines and the ^ reference tail are stripped',
    !/Jump to content|Main page|Contents|Current events|Retrieved from/.test(wikiClean.text) &&
      !/^\s*\^\s/m.test(wikiClean.text),
    wikiClean.text,
    'no chrome lines, no ^ reference lines'
  );
  const wikiStats = wikiClean.stats;
  check(
    'cleaner: the wiki receipt totals every removal category',
    wikiStats.citations >= 3 && wikiStats.urls >= 2 && wikiStats.chrome >= 5 && wikiStats.references >= 1 &&
      wikiClean.removed === wikiStats.citations + wikiStats.links + wikiStats.urls +
        wikiStats.markup + wikiStats.chrome + wikiStats.references,
    { stats: wikiStats, removed: wikiClean.removed },
    'citations, URLs, chrome and reference lines all counted'
  );

  const nonWikiClean = await wf((text) => window.__wordfall.custom.clean(text), NON_WIKI_TEXT);
  check(
    'cleaner: chrome-looking lines in an ordinary paste are kept',
    nonWikiClean.text === NON_WIKI_TEXT && nonWikiClean.removed === 0,
    nonWikiClean,
    'text unchanged, removed 0'
  );

  const mdClean = await wf(() => window.__wordfall.custom.clean(
    '**Bold** and [label](https://x.test) and https://y.test and `code`.\n- one\n- two'
  ));
  check(
    'cleaner: Markdown links keep the label while markup, URLs and list markers go',
    mdClean.text === 'Bold and label and and code.\none\ntwo',
    mdClean.text,
    JSON.stringify('Bold and label and and code.\none\ntwo')
  );

  const htmlClean = await wf(() => window.__wordfall.custom.clean(
    '<p>Hello <a href="x">world</a>.</p><p>Second&nbsp;line</p>'
  ));
  check(
    'cleaner: HTML tags and entities become plain text with paragraph breaks',
    htmlClean.text === 'Hello world.\nSecond line',
    htmlClean.text,
    JSON.stringify('Hello world.\nSecond line')
  );

  const urlClean = await wf(() => window.__wordfall.custom.clean('See https://example.com/x for more.'));
  check(
    'cleaner: a bare URL in a sentence is removed and the spacing tidied',
    urlClean.text === 'See for more.' && urlClean.stats.urls === 1,
    urlClean,
    JSON.stringify('See for more.')
  );
  const plainClean = await wf(() => window.__wordfall.custom.clean('Just plain text, nothing to strip.'));
  check(
    'cleaner: plain text is untouched and reports nothing removed',
    plainClean.text === 'Just plain text, nothing to strip.' && plainClean.removed === 0,
    plainClean,
    'text unchanged, removed 0'
  );

  // ─── 12. Smart text cleanup: editor UI + clean-on-start ─────────────────
  await openCustomDialog();
  await page.locator('#customNew').click();
  await sleep(100);
  dom = await getDom();
  check(
    'cleaner UI: New starts a blank editor with Clean on start checked',
    dom.nameValue === '' && dom.textValue === '' && dom.layoutState === 'lines' &&
      dom.cleanChecked && /New stage/.test(dom.hint),
    { name: dom.nameValue, text: dom.textValue, clean: dom.cleanChecked, hint: dom.hint },
    'blank editor, lines layout, cleanup on'
  );
  await page.locator('#customText').fill(WIKI_TEXT);
  await sleep(120);
  dom = await getDom();
  const metaCount = (dom.meta.match(/(\d+) cleaned away/) || [])[1];
  check(
    'cleaner UI: the live meta counts what Cleanup would strip',
    !!metaCount && Number(metaCount) >= 8,
    dom.meta,
    'N cleaned away (N >= 8)'
  );
  await page.locator('#customCleanBtn').click();
  await sleep(120);
  const cleanedValue = await page.locator('#customText').inputValue();
  dom = await getDom();
  check(
    'cleaner UI: Clean text rewrites the textarea',
    !/\[b\]|\[1\]|https?:\/\//i.test(cleanedValue) && cleanedValue.includes('global conflict'),
    cleanedValue.slice(0, 100),
    'markers and URLs gone, prose kept'
  );
  check(
    'cleaner UI: Clean text reports the receipt in the hint',
    /Cleaned: removed/.test(dom.hint) && /citation markers/.test(dom.hint) &&
      /URLs/.test(dom.hint) && /wiki chrome lines/.test(dom.hint) && /reference line/.test(dom.hint),
    dom.hint,
    'receipt names each category'
  );
  check(
    'cleaner UI: the cleaned-away suffix clears once the text is clean',
    !/cleaned away/.test(dom.meta),
    dom.meta,
    'no suffix left'
  );

  await page.locator('#customNew').click();
  await sleep(80);
  await page.locator('#customText').fill('World War II[b] was a war.');
  await page.locator('#customStart').click();
  await waitPhase('playing', 4000);
  await sleep(120);
  s = await getState();
  check(
    'clean on start: the default Start strips citation markers from the first row',
    s.custom && s.custom.liveText === 'World War II was a war.' && s.custom.configClean === true &&
      s.custom.cleaned && s.custom.cleaned.citations >= 1,
    s.custom && { live: s.custom.liveText, cleaned: s.custom.cleaned },
    "'World War II was a war.' with a citation removed"
  );
  await returnToMenu();

  await openCustomDialog();
  await page.locator('#customNew').click();
  await sleep(80);
  await page.locator('#customText').fill('World War II[b] was a war.');
  await page.locator('#customClean').uncheck();
  await sleep(100);
  dom = await getDom();
  check(
    'clean on start: unchecking Clean on start drops the cleanup preview',
    !dom.cleanChecked && !/cleaned away/.test(dom.meta),
    { checked: dom.cleanChecked, meta: dom.meta },
    'unchecked, no cleaned-away suffix'
  );
  await page.locator('#customStart').click();
  await waitPhase('playing', 4000);
  await sleep(120);
  s = await getState();
  check(
    'clean on start: an unchecked Start preserves the citation markers',
    s.custom && s.custom.liveText === 'World War II[b] was a war.' &&
      s.custom.configClean === false && s.custom.cleaned === null,
    s.custom && { live: s.custom.liveText, configClean: s.custom.configClean, cleaned: s.custom.cleaned },
    "'World War II[b] was a war.' with markers kept"
  );
  await returnToMenu();

  // ─── 13. Multiple saved stages via New ───────────────────────────────────
  const stageCap = await wf(() => window.__wordfall.custom.max.maxStages);
  check('multi-stage: the saved-stage cap is 20', stageCap === 20, stageCap, 20);
  await openCustomDialog();
  await page.locator('#customNew').click();
  await sleep(80);
  await page.locator('#customName').fill('First Stage');
  await page.locator('#customText').fill('the first saved stage');
  await page.locator('#customSave').click();
  await sleep(150);
  let stages = await wf(() => window.__wordfall.custom.stages());
  dom = await getDom();
  check(
    'multi-stage: the first stage saves',
    stages.length === 1 && stages[0].name === 'First Stage' && stages[0].text === 'the first saved stage',
    stages.map((x) => ({ name: x.name, text: x.text })),
    'one First Stage'
  );
  check(
    'multi-stage: the saved list and counter show one stage',
    dom.savedCount === 1 && /1 of 20/.test(dom.hint),
    { saved: dom.savedCount, hint: dom.hint },
    '1 item, 1 of 20'
  );

  await page.locator('#customNew').click();
  await sleep(100);
  dom = await getDom();
  check(
    'multi-stage: New clears the editor without touching the saved list',
    dom.nameValue === '' && dom.textValue === '' && dom.layoutState === 'lines' &&
      dom.cleanChecked && dom.savedCount === 1 && /New stage/.test(dom.hint),
    { name: dom.nameValue, text: dom.textValue, saved: dom.savedCount, hint: dom.hint },
    'blank editor, 1 saved stage kept'
  );
  await page.locator('#customText').fill('alpha beta gamma delta epsilon zeta');
  await page.locator('#customSave').click();
  await sleep(150);
  stages = await wf(() => window.__wordfall.custom.stages());
  dom = await getDom();
  check(
    'multi-stage: New + Save adds a second stage instead of overwriting',
    stages.length === 2 && stages.some((x) => x.name === 'First Stage') && dom.savedCount === 2,
    { stored: stages.map((x) => x.name), saved: dom.savedCount },
    '2 stored, 2 listed'
  );
  check(
    'multi-stage: an unnamed stage is named from its opening words',
    stages[0].name === 'alpha beta gamma delta epsilon',
    stages[0].name,
    "'alpha beta gamma delta epsilon'"
  );
  check(
    'multi-stage: the list renders both names and the counter',
    dom.savedNames.includes('First Stage') && dom.savedNames.includes('alpha beta gamma delta epsilon') &&
      /2 of 20/.test(dom.hint),
    { names: dom.savedNames, hint: dom.hint },
    'both names, 2 of 20'
  );

  await page.locator('.custom-saved-item').nth(1).click();
  await sleep(120);
  dom = await getDom();
  check(
    'multi-stage: the older stage loads into the editor',
    dom.nameValue === 'First Stage' && dom.textValue === 'the first saved stage',
    { name: dom.nameValue, text: dom.textValue },
    'First Stage loaded'
  );
  await page.locator('.custom-saved-item').nth(0).click();
  await sleep(120);
  dom = await getDom();
  check(
    'multi-stage: the newer stage loads into the editor',
    dom.nameValue === 'alpha beta gamma delta epsilon' &&
      dom.textValue === 'alpha beta gamma delta epsilon zeta',
    { name: dom.nameValue, text: dom.textValue },
    'derived-name stage loaded'
  );
  await page.locator('#customDelete').click();
  await sleep(150);
  stages = await wf(() => window.__wordfall.custom.stages());
  dom = await getDom();
  check(
    'multi-stage: Delete removes only the loaded stage',
    stages.length === 1 && stages[0].name === 'First Stage' && dom.savedCount === 1,
    { stored: stages.map((x) => x.name), saved: dom.savedCount },
    'one First Stage remains'
  );
  await page.locator('.custom-saved-item').first().click();
  await sleep(120);
  dom = await getDom();
  check(
    'multi-stage: the remaining stage is still loadable',
    dom.nameValue === 'First Stage' && dom.textValue === 'the first saved stage',
    { name: dom.nameValue, text: dom.textValue },
    'First Stage loads after the other delete'
  );
  await page.locator('#customDelete').click();
  await sleep(150);
  stages = await wf(() => window.__wordfall.custom.stages());
  dom = await getDom();
  check(
    'multi-stage: deleting the last stage restores the empty list',
    stages.length === 0 && dom.savedCount === 0 && dom.emptySaved === 1,
    { stored: stages.length, saved: dom.savedCount },
    '0 stored, empty placeholder'
  );
  await page.locator('#customCancel').click();
  await waitPhase('menu', 3000);
  await sleep(100);

  // ─── 14. Isolation from the roguelite + standard run regression ──────────
  const afterCustom = await wf(() => ({
    records: JSON.parse(JSON.stringify(window.__wordfall.records)),
    achieved: Object.keys(window.__wordfall.achieved).sort(),
  }));
  check(
    'isolation: custom practice leaves records.runs untouched',
    afterCustom.records.runs === baseline.records.runs,
    { after: afterCustom.records.runs, before: baseline.records.runs },
    baseline.records.runs
  );
  check(
    'isolation: custom practice leaves records.dawns untouched',
    afterCustom.records.dawns === baseline.records.dawns,
    { after: afterCustom.records.dawns, before: baseline.records.dawns },
    baseline.records.dawns
  );
  check(
    'isolation: custom practice leaves records.bestScore untouched',
    afterCustom.records.bestScore === baseline.records.bestScore,
    { after: afterCustom.records.bestScore, before: baseline.records.bestScore },
    baseline.records.bestScore
  );
  check(
    'isolation: custom practice unlocks no achievements',
    JSON.stringify(afterCustom.achieved) === JSON.stringify(baseline.achieved),
    afterCustom.achieved,
    baseline.achieved
  );

  await page.locator('#menuStart').click();
  const stdPlaying = await waitPhase('playing', 4000);
  const stdSpawned = await waitFor(() => window.__wordfall.state.words.length >= 1, null, 8000);
  await sleep(600);
  s = await getState();
  dom = await getDom();
  const clockAfterStd = s.runSec;
  check(
    'standard: Start Run still starts a normal run',
    stdPlaying && s.phase === 'playing' && !s.custom && s.lives > 0,
    { phase: s.phase, custom: !!s.custom, lives: s.lives },
    'playing, no custom state, lives intact'
  );
  check(
    'standard: the normal run still spawns words',
    stdSpawned && s.words.length >= 1,
    s.words.length,
    '>= 1 falling word'
  );
  check(
    'standard: the normal run clock and title behave as before',
    clockAfterStd > 0.2 && /Wave 1/.test(dom.title),
    { runSec: clockAfterStd, title: dom.title },
    'clock advancing, Wave 1 title'
  );
  check('standard: body phase class is phase-playing', /\bphase-playing\b/.test(dom.bodyClass), dom.bodyClass, 'phase-playing');
  const stdHud = await getHud();
  check(
    'HUD standard: statusTime and statusMode stay hidden; the strip owns clock and mode',
    !stdHud.timeVisible && !stdHud.modeVisible &&
      /^\d\d:\d\d$/.test(stdHud.stripRun) && stdHud.stripMode === 'STANDARD',
    {
      time: stdHud.timeVisible, mode: stdHud.modeVisible,
      stripRun: stdHud.stripRun, stripMode: stdHud.stripMode,
    },
    'clock/mode hidden in the status bar, MM:SS + STANDARD in the strip'
  );
  check(
    'HUD standard: the score, wave, lives and combo panels are visible',
    stdHud.scoreVisible && stdHud.waveVisible && stdHud.livesVisible && stdHud.comboVisible,
    {
      score: stdHud.scoreVisible, wave: stdHud.waveVisible,
      lives: stdHud.livesVisible, combo: stdHud.comboVisible,
    },
    'all four roguelite panels visible'
  );
  check(
    'HUD standard: the status main line is exactly Playing with no combo suffix',
    stdHud.mainText === 'Playing' && !/combo/i.test(stdHud.mainText),
    stdHud.mainText,
    "'Playing'"
  );
  check(
    'HUD standard: the toolbar deck field and separator are visible outside practice',
    stdHud.deckFieldVisible && stdHud.toolSepVisible && !stdHud.practice,
    { deck: stdHud.deckFieldVisible, sep: stdHud.toolSepVisible, practice: stdHud.practice },
    'deck field + separator visible, no practice class'
  );
  const afterStd = await wf(() => JSON.parse(JSON.stringify(window.__wordfall.records)));
  check(
    'standard: starting a run records nothing on its own',
    afterStd.runs === baseline.records.runs,
    { after: afterStd.runs, before: baseline.records.runs },
    baseline.records.runs
  );
} catch (err) {
  check('qa-custom: completed without a fatal error', false, firstLine(err), 'no fatal error');
} finally {
  if (browser) await browser.close().catch(() => {});
}

check('page: no console or runtime errors', errors.length === 0, errors.slice(0, 6), '[]');

const passed = checks.filter((c) => c.pass).length;
const elapsedSec = Number(((Date.now() - startedAt) / 1000).toFixed(2));
console.log(JSON.stringify({
  passed,
  total: checks.length,
  elapsedSec,
  errors,
  failed: checks.filter((c) => !c.pass),
}, null, 2));
process.exitCode = passed === checks.length && errors.length === 0 ? 0 : 1;
