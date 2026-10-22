#!/usr/bin/env node
/**
 * Wordfall Cards-mode acceptance checks. Cards are the reveal-and-grade memory
 * drill in Custom Stage: nothing is typed, Space flips a card, 1/2/3 grades it,
 * and "Again" re-queues it while Good/Easy retire it.
 *
 * Every assertion drives the real game in headless Chrome through
 * window.__wordfall; nothing in the game is edited to make a check pass.
 *
 * Run from the wordfall/ folder:
 *   node tools/qa-cards.mjs [--wait-sec N]
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
const SHOTS = path.join(ROOT, 'shots');

const startedAt = Date.now();
const checks = [];
const errors = [];
const log = (...args) => console.error('[qa-cards]', ...args);
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
      console.error('qa-cards: --wait-sec must be a number > 0');
      process.exit(2);
    }
  } else if (arg === '-h' || arg === '--help') {
    console.log('Usage: node tools/qa-cards.mjs [--wait-sec N]');
    process.exit(0);
  } else {
    console.error(`qa-cards: unknown argument: ${arg}`);
    process.exit(2);
  }
}

// A poem deck and a Chinese deck. The Chinese one is the point: the line and
// word layouts are ASCII-only, but a deck must keep 你好 and its pinyin intact.
const POEM = [
  'The woods are lovely, dark and deep :: Robert Frost, Stopping by Woods',
  'But I have promises to keep :: the speaker still has obligations',
  'And miles to go before I sleep :: the journey is not over',
].join('\n');
const CHINESE = [
  '你好 :: ni hao — hello',
  '谢谢 :: xie xie — thank you',
  '再见 :: zai jian — goodbye',
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

  async function boot() {
    await page.goto(INDEX_URL, { waitUntil: 'load' });
    return waitFor(() => window.__wordfall && window.__wordfall.version === 'M9', null, waitSec * 1000);
  }

  async function customState() {
    return wf(() => {
      const c = window.__wordfall.state.custom;
      if (!c) return null;
      return {
        name: c.name,
        layout: c.layout,
        total: c.total,
        pass: c.pass,
        loop: c.loop,
        memorize: c.memorize,
        cardDone: c.cardDone,
        cardFirst: c.cardFirst,
        cardAgain: c.cardAgain,
        cardReviews: c.cardReviews,
        queue: c.cardQueue.slice(),
        live: c.cardLive && {
          index: c.cardLive.index,
          prompt: c.cardLive.card.prompt,
          answer: c.cardLive.card.answer,
          revealed: c.cardLive.revealed,
          timedOut: c.cardLive.timedOut,
          y: c.cardLive.y,
          dur: c.cardLive.dur,
        },
        words: window.__wordfall.state.words.length,
        keys: window.__wordfall.state.keys,
        mistakes: window.__wordfall.state.mistakes,
        configText: c.config ? c.config.text : null,
      };
    });
  }

  async function dom() {
    return wf(() => {
      const el = (id) => document.getElementById(id);
      const classed = (id, cls) => !!(el(id) && el(id).classList.contains(cls));
      const active = document.querySelector('#customLayout .mode-btn[aria-pressed="true"]');
      const labels = Array.from(document.querySelectorAll('#stripHud .strip-label')).map((n) => n.textContent);
      return {
        phase: window.__wordfall.state.phase,
        bodyClass: document.body.className,
        meta: el('customMeta').textContent,
        hint: el('customHint').textContent,
        dialog: classed('dlgCustom', 'show'),
        doneDialog: classed('dlgCustomDone', 'show'),
        pauseDialog: classed('dlgPause', 'show'),
        resultStats: el('customResultStats').textContent,
        resultName: el('customResultName').textContent,
        layout: active ? active.dataset.layout : null,
        memorizeDisabled: el('customMemorize').disabled,
        memorizeChecked: el('customMemorize').checked,
        stripLabels: labels,
        stripWave: el('stripWave').textContent,
        stripWaveSub: el('stripWaveSub').textContent,
        stripBestSub: el('stripBestSub').textContent,
        statusMain: el('statusMain').textContent,
      };
    });
  }

  async function key(k) {
    await page.evaluate((kk) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: kk, bubbles: true, cancelable: true }));
    }, k);
    await sleep(60);
  }

  async function openEditor() {
    await wf(() => window.__wordfall.custom.open());
    await waitFor(() => document.getElementById('dlgCustom').classList.contains('show'));
  }

  async function fillEditor(text, layout) {
    await wf(({ text: t, layout: l }) => {
      const area = document.getElementById('customText');
      area.value = t;
      area.dispatchEvent(new Event('input', { bubbles: true }));
      const btn = document.querySelector(`#customLayout .mode-btn[data-layout="${l}"]`);
      if (btn) btn.click();
    }, { text, layout });
    await sleep(60);
  }

  async function startFromEditor() {
    await wf(() => document.getElementById('customStart').click());
    await sleep(120);
  }

  async function startCards(text, opts = {}) {
    return wf(({ text: t, opts: o }) => window.__wordfall.custom.start({
      name: o.name || '', text: t, layout: 'cards', clean: false,
      loop: !!o.loop,
    }), { text, opts });
  }

  // ── boot ────────────────────────────────────────────────────────────────
  const booted = await boot();
  check('boot: game loads', booted);
  if (!booted) throw new Error('game did not boot');
  await sleep(200);

  baseline = await wf(() => ({
    records: JSON.parse(JSON.stringify(window.__wordfall.records)),
    achievements: Object.keys(window.__wordfall.achieved || {}).length,
  }));

  // ── parser (pure functions) ─────────────────────────────────────────────
  const parse = await wf(() => {
    const c = window.__wordfall.custom;
    return {
      two: c.cards('alpha :: one\nbeta :: two').length,
      arrow: c.cards('alpha => one').length,
      colonRequired: c.cards('just a line\nanother line').length,
      emptyAnswer: c.cards('alpha ::').length,
      cjk: c.cards('你好 :: ni hao'),
      counts: c.cardCounts('a :: 1\nb :: 2\njunk'),
      cappedPrompt: c.cards('x'.repeat(200) + ' :: answer')[0].prompt.length,
      max: c.max.maxCards,
    };
  });
  check('parser: one card per line', parse.two === 2, parse.two, 2);
  check('parser: => separator', parse.arrow === 1, parse.arrow, 1);
  check('parser: lines without :: are skipped', parse.colonRequired === 0, parse.colonRequired, 0);
  check('parser: empty answer rejected', parse.emptyAnswer === 0, parse.emptyAnswer, 0);
  check('parser: CJK survives', parse.cjk.length === 1 && parse.cjk[0].prompt === '你好' &&
    parse.cjk[0].answer === 'ni hao', parse.cjk, '你好 / ni hao');
  check('parser: skipped lines counted', parse.counts.cards === 2 && parse.counts.skipped === 1,
    parse.counts, '{cards:2, skipped:1}');
  check('parser: prompt length capped', parse.cappedPrompt === 120, parse.cappedPrompt, 120);

  // ── editor: third layout, meta and validation ───────────────────────────
  await openEditor();
  const d0 = await dom();
  check('editor: opens in menu', d0.dialog === true, d0.dialog, true);
  check('editor: three layout buttons', await wf(() =>
    document.querySelectorAll('#customLayout .mode-btn').length), 3);

  await fillEditor(POEM, 'cards');
  const d1 = await dom();
  check('editor: Cards layout selected', d1.layout === 'cards', d1.layout, 'cards');
  check('editor: memorize disabled for cards', d1.memorizeDisabled === true && d1.memorizeChecked === false,
    { disabled: d1.memorizeDisabled, checked: d1.memorizeChecked }, { disabled: true, checked: false });
  check('editor: meta counts cards', /3 cards/.test(d1.meta), d1.meta, '3 cards');
  check('editor: meta hints the syntax when empty', await wf(() => {
    const area = document.getElementById('customText');
    area.value = '';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    return /prompt :: answer/.test(document.getElementById('customMeta').textContent);
  }), true);

  await fillEditor('no separator anywhere', 'cards');
  await startFromEditor();
  const dInvalid = await dom();
  check('editor: no cards refuses to start', dInvalid.dialog === true && /no cards/i.test(dInvalid.hint),
    { dialog: dInvalid.dialog, hint: dInvalid.hint }, 'dialog open + no cards hint');

  await fillEditor(POEM, 'cards');
  await startFromEditor();
  let cs = await customState();
  check('start: cards stage plays', cs && cs.layout === 'cards', cs && cs.layout, 'cards');
  check('start: total is the deck size', cs && cs.total === 3, cs && cs.total, 3);
  check('start: a live card exists', !!(cs && cs.live), cs && cs.live, 'card');
  check('start: no falling words on a card board', cs && cs.words === 0, cs && cs.words, 0);
  check('start: deck order preserved', cs && cs.live.prompt === 'The woods are lovely, dark and deep',
    cs && cs.live.prompt, 'first card prompt');

  const hud = await dom();
  check('hud: practice class', /practice/.test(hud.bodyClass), hud.bodyClass, 'practice');
  check('hud: strip labels TIME/CARDS/CUSTOM',
    hud.stripLabels.join(',') === 'TIME,CARDS,CUSTOM', hud.stripLabels, 'TIME,CARDS,CUSTOM');
  check('hud: progress starts at 0 / 3', hud.stripWave === '0 / 3', hud.stripWave, '0 / 3');
  check('hud: sub-line says Recall', hud.stripWaveSub === 'Recall', hud.stripWaveSub, 'Recall');
  check('hud: layout line says Cards', hud.stripBestSub === 'Cards', hud.stripBestSub, 'Cards');
  check('hud: practice panel', hud.statusMain === 'Practice', hud.statusMain, 'Practice');

  // ── real input: Space reveals, 2 grades Good ─────────────────────────────
  check('input: card starts unrevealed', cs.revealed !== true, cs.live.revealed, false);
  await key(' ');
  cs = await customState();
  check('input: Space reveals the answer', cs.live && cs.live.revealed === true,
    cs.live && cs.live.revealed, true);
  check('input: revealing types nothing', cs.keys === 0 && cs.mistakes === 0,
    { keys: cs.keys, mistakes: cs.mistakes }, { keys: 0, mistakes: 0 });

  await key('2');
  cs = await customState();
  check('input: 2 grades Good and retires the card', cs.cardDone === 1, cs.cardDone, 1);
  check('input: first-try count', cs.cardFirst === 1, cs.cardFirst, 1);
  check('input: next card is live', cs.live && cs.live.index === 1, cs.live && cs.live.index, 1);

  // ── Again re-queues ──────────────────────────────────────────────────────
  await key(' ');
  await key('1');
  cs = await customState();
  check('again: grade 1 counts a repeat', cs.cardAgain === 1, cs.cardAgain, 1);
  check('again: card comes back later', cs.queue.indexOf(1) >= 0, cs.queue, 'contains 1');
  check('again: repeat keeps progress at 1', cs.cardDone === 1, cs.cardDone, 1);

  // Escape still pauses on a card stage.
  await key('Escape');
  const paused = await dom();
  check('input: Escape pauses a card stage', paused.phase === 'paused', paused.phase, 'paused');
  await key('Escape');
  await sleep(80);

  // ── finish the deck through the debug grade hook ─────────────────────────
  await wf(() => {
    const c = window.__wordfall.custom;
    for (let i = 0; i < 40; i++) {
      const s = window.__wordfall.state.custom;
      if (!s || s.finished) break;
      if (!s.cardLive) break;
      if (!s.cardLive.revealed) c.reveal();
      c.grade('good');
    }
  });
  await waitFor(() => window.__wordfall.state.phase === 'customdone', null, 4000);
  const done = await dom();
  check('complete: deck finishes', done.phase === 'customdone', done.phase, 'customdone');
  check('complete: Stage Complete dialog shows', done.doneDialog === true, done.doneDialog, true);
  check('complete: stats report recall, not WPM', /cards recalled/.test(done.resultStats) &&
    /no typing/.test(done.resultStats), done.resultStats, 'cards recalled ... no typing');
  check('complete: no WPM in the deck result', !/WPM/.test(done.resultStats), done.resultStats, 'no WPM');
  check('complete: name shown', done.resultName.length > 0, done.resultName, 'non-empty');

  // ── timeout: an unanswered card misses itself ────────────────────────────
  await wf(() => window.__wordfall.returnToMenu());
  await startCards('only card :: only answer');
  cs = await customState();
  check('timeout: short deck starts', cs && cs.total === 1, cs && cs.total, 1);
  const timedOut = await waitFor(() => {
    const c = window.__wordfall.state.custom;
    return c && c.cardLive && c.cardLive.timedOut === true;
  }, null, 16000);
  check('timeout: unanswered card flips itself', timedOut, timedOut, true);
  const autoAgain = await waitFor(() => {
    const c = window.__wordfall.state.custom;
    return c && c.cardAgain === 1;
  }, null, 4000);
  check('timeout: it counts as an Again', autoAgain, autoAgain, true);

  // ── loop restarts the deck without the result dialog ─────────────────────
  await wf(() => window.__wordfall.returnToMenu());
  await startCards('one :: 1\ntwo :: 2', { loop: true });
  await wf(() => {
    const c = window.__wordfall.custom;
    for (let i = 0; i < 2; i++) {
      const s = window.__wordfall.state.custom;
      if (!s || !s.cardLive) break;
      if (!s.cardLive.revealed) c.reveal();
      c.grade('good');
    }
  });
  cs = await customState();
  check('loop: a looping deck starts pass 2', cs && cs.pass === 2, cs && cs.pass, 2);
  check('loop: the deck is reset for the new pass', cs && cs.cardDone === 0 && cs.queue.length + 1 === 2,
    cs && { done: cs.cardDone, live: !!cs.live }, { done: 0, live: true });
  check('loop: still playing, no result dialog', (await dom()).phase === 'playing', (await dom()).phase, 'playing');

  // ── Chinese deck, save, reload and start ────────────────────────────────
  await wf(() => window.__wordfall.returnToMenu());
  await openEditor();
  await fillEditor(CHINESE, 'cards');
  await wf(() => { document.getElementById('customName').value = 'Chinese basics'; });
  await wf(() => document.getElementById('customSave').click());
  await sleep(120);
  const stored = await wf(() => {
    const raw = localStorage.getItem('wordfall.custom.stages');
    const list = raw ? JSON.parse(raw) : [];
    return list[0] || null;
  });
  check('save: card stage persists', stored && stored.layout === 'cards', stored && stored.layout, 'cards');
  check('save: CJK stored unchanged', stored && stored.text.indexOf('你好') >= 0 &&
    stored.text.indexOf('ni hao') >= 0, stored && stored.text, 'contains 你好 / ni hao');

  await boot();
  await sleep(250);
  const hasStage = await wf(() => window.__wordfall.custom.stages()
    .some((s) => s.layout === 'cards' && /Chinese basics/.test(s.name)));
  check('reload: saved card stage comes back', hasStage, hasStage, true);

  await wf(() => window.__wordfall.returnToMenu());
  await openEditor();
  await wf(() => {
    const item = Array.from(document.querySelectorAll('.custom-saved-item'))
      .find((n) => /Chinese basics/.test(n.textContent));
    if (item) item.click();
  });
  await sleep(80);
  const dZh = await dom();
  check('reload: editor loads the deck layout', dZh.layout === 'cards', dZh.layout, 'cards');
  await startFromEditor();
  cs = await customState();
  check('reload: Chinese deck starts', cs && cs.layout === 'cards' && cs.total === 3,
    cs && { layout: cs.layout, total: cs.total }, { layout: 'cards', total: 3 });
  check('reload: first prompt is 你好', cs && cs.live.prompt === '你好', cs && cs.live.prompt, '你好');

  // ── Sharp text: practice renders 1:1 instead of the soft-focus upscale ──
  let sc = await wf(() => window.__wordfall.scene());
  check('sharp: practice is soft by default',
    sc.crisp === false && sc.sharp === false && sc.sceneW < sc.canvasW,
    sc, 'sceneW < canvasW');

  await openEditor();
  await wf(() => {
    const cb = document.getElementById('customCrisp');
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(150);
  sc = await wf(() => window.__wordfall.scene());
  check('sharp: the option redraws at full resolution',
    sc.crisp === true && sc.sharp === true && sc.sceneW === sc.canvasW,
    sc, 'crisp + sceneW === canvasW');
  const crispStored = await wf(() => {
    const raw = localStorage.getItem('wordfall.settings');
    return raw ? JSON.parse(raw).crisp : null;
  });
  check('sharp: the choice is persisted', crispStored === true, crispStored, true);

  await key('Escape');          // close the editor and resume the drill
  await sleep(120);
  const resumed = await dom();
  check('sharp: closing the editor resumes the card stage', resumed.phase === 'playing',
    resumed.phase, 'playing');

  // ── screenshots ─────────────────────────────────────────────────────────
  await page.screenshot({ path: path.join(SHOTS, 'cards-recall.png') });
  await key(' ');
  await sleep(120);
  await page.screenshot({ path: path.join(SHOTS, 'cards-answer.png') });

  // ── isolation from the roguelite record book ────────────────────────────
  const after = await wf(() => ({
    records: JSON.parse(JSON.stringify(window.__wordfall.records)),
    achieved: Object.keys(window.__wordfall.achieved || {}).length,
  }));
  check('isolation: records untouched',
    JSON.stringify(after.records) === JSON.stringify(baseline.records), after.records, baseline.records);
  check('isolation: achievements untouched',
    after.achieved === baseline.achievements, after.achieved, baseline.achievements);

  // ── F2 restarts the deck cleanly ────────────────────────────────────────
  await key('F2');
  await sleep(150);
  cs = await customState();
  check('restart: F2 resets the deck', cs && cs.cardDone === 0 && cs.cardAgain === 0 && cs.pass === 1,
    cs && { done: cs.cardDone, again: cs.cardAgain, pass: cs.pass }, { done: 0, again: 0, pass: 1 });

  // ── Sharp text is practice-only and survives a reload ───────────────────
  await wf(() => window.__wordfall.returnToMenu());
  await sleep(150);
  sc = await wf(() => window.__wordfall.scene());
  check('sharp: the menu returns to the soft-focus scene',
    sc.sharp === false && sc.sceneW < sc.canvasW, sc, 'soft scene');

  await boot();
  await sleep(250);
  const afterReload = await wf(() => window.__wordfall.scene());
  check('sharp: the preference survives a reload', afterReload.crisp === true,
    afterReload.crisp, true);
  await startCards('one :: 1');
  const sharpStage = await wf(() => window.__wordfall.scene());
  check('sharp: a new drill starts sharp',
    sharpStage.sharp === true && sharpStage.sceneW === sharpStage.canvasW,
    sharpStage, 'sharp scene');
  await wf(() => window.__wordfall.returnToMenu());

  // ── diagnostics ─────────────────────────────────────────────────────────
  const canvasOk = await wf(() => {
    const c = document.getElementById('game');
    return !!c && c.width > 0 && c.height > 0;
  });
  check('render: playfield canvas sized', canvasOk, canvasOk, true);
} catch (err) {
  errors.push('exception: ' + firstLine(err));
  log('EXCEPTION', err);
} finally {
  if (browser) await browser.close();
}

const failed = checks.filter((c) => !c.pass);
const summary = {
  ok: failed.length === 0 && errors.length === 0,
  passed: checks.length - failed.length,
  failed: failed.length,
  errors,
  durationSec: Math.round(((Date.now() - startedAt) / 1000) * 10) / 10,
  checks,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
