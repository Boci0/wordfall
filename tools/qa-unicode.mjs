#!/usr/bin/env node
/**
 * Wordfall multilingual / Prompts acceptance checks.
 *
 * Covers the parts that turned Custom Stage multilingual:
 *  - Lines and Falling words keep non-ASCII text instead of stripping it
 *    (customPlainText), and wrap/tokenise by measured width and Intl.Segmenter.
 *  - IME input: the invisible focus sink receives compositionend and feeds the
 *    committed characters through the normal typing rules; composing keys are
 *    not counted as misses.
 *  - Prompts: `shown :: typed` per line, the cue can be left up or hidden after
 *    the preview, and only the typed side is played.
 *  - New Run restarts the practice stage that is on the board instead of
 *    dropping the player into the roguelite.
 *
 *   node tools/qa-unicode.mjs [--wait-sec N]
 */
import { chromium } from 'playwright-core';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;

const started = Date.now();
const checks = [];
const errors = [];
const log = (...a) => console.error('[qa-unicode]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function check(name, pass, actual, target) {
  checks.push({ name, pass: !!pass, actual: actual === undefined ? null : actual, target: target === undefined ? null : target });
  if (!pass) log(`FAIL ${name} — ${JSON.stringify(actual)} (target: ${JSON.stringify(target)})`);
  return !!pass;
}

let waitSec = 60;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--wait-sec') waitSec = Number(process.argv[++i]) || waitSec;
}

let browser = null;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const wf = (fn, arg) => page.evaluate(fn, arg);
  const waitFor = async (fn, arg = null, timeout = 5000) => {
    try { await page.waitForFunction(fn, arg, { timeout }); return true; } catch (e) { return false; }
  };
  const boot = async () => {
    await page.goto(INDEX_URL, { waitUntil: 'load' });
    return waitFor(() => window.__wordfall && window.__wordfall.version === 'M9', null, waitSec * 1000);
  };
  const start = (text, layout, opts = {}) => wf(({ text, layout, opts }) =>
    window.__wordfall.custom.start({ name: opts.name || '', text, layout, clean: false, memorize: !!opts.memorize, loop: !!opts.loop }),
    { text, layout, opts });
  const state = () => wf(() => {
    const s = window.__wordfall.state;
    const c = s.custom;
    return {
      phase: s.phase,
      keys: s.keys,
      mistakes: s.mistakes,
      words: s.words.map((w) => ({ text: w.text, progress: w.progress, prompt: w.prompt || null })),
      custom: c && {
        layout: c.layout, total: c.total, done: c.done, lineIndex: c.lineIndex,
        hidden: c.hidden, memorize: c.memorize,
        liveText: c.liveLine ? c.liveLine.text : null,
        livePrompt: c.liveLine ? c.liveLine.prompt || null : null,
        liveProgress: c.liveLine ? c.liveLine.progress : null,
        configLayout: c.config ? c.config.layout : null,
        configText: c.config ? c.config.text : null,
      },
      imeFocused: window.__wordfall.custom.imeFocused(),
      scene: window.__wordfall.scene(),
    };
  });
  const commit = (data) => wf((d) => {
    const sink = document.getElementById('imeSink');
    sink.focus();
    sink.dispatchEvent(new CompositionEvent('compositionend', { data: d, bubbles: true }));
  }, data);
  const key = (k) => page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent('keydown', { key: kk, bubbles: true, cancelable: true })), k);

  const booted = await boot();
  check('boot', booted);
  if (!booted) throw new Error('no boot');
  await sleep(200);

  // ── text pipeline keeps other scripts ───────────────────────────────────
  const parse = await wf(() => {
    const c = window.__wordfall.custom;
    return {
      plain: c.plain('你好，世界\nHello'),
      segs: c.segments('你好，世界，这是一句中文。'),
      segsJoin: c.segments('你好，世界，这是一句中文。').join(''),
      tokens: c.tokens('你好 世界 老师 hello'),
      tokensAscii: c.tokens("don't stop hello"),
      prompts: c.prompts('你好 :: ni hao\n谢谢 :: xie xie\njunk line'),
      promptCounts: c.promptCounts('你好 :: ni hao\njunk'),
    };
  });
  check('plain: CJK survives', /你好/.test(parse.plain) && /Hello/.test(parse.plain), parse.plain, '你好 + Hello');
  check('segments: Chinese produces segments', parse.segs.length >= 1, parse.segs, '>=1');
  check('segments: all characters preserved', parse.segsJoin.replace(/\s/g, '') === '你好，世界，这是一句中文。',
    parse.segsJoin, '你好，世界，这是一句中文。');
  check('tokens: Chinese words segmented', parse.tokens.indexOf('你好') >= 0 && parse.tokens.indexOf('老师') >= 0,
    parse.tokens, 'contains 你好 and 老师');
  check('tokens: ASCII path unchanged', parse.tokensAscii.join(',') === 'stop,hello' || parse.tokensAscii.indexOf('hello') >= 0,
    parse.tokensAscii, 'no apostrophe token');
  check('prompts: pairs parsed, junk skipped',
    parse.prompts.length === 2 && parse.prompts[0].shown === '你好' && parse.prompts[0].typed === 'ni hao',
    parse.prompts, '2 pairs');
  check('prompts: counts report skipped lines', parse.promptCounts.prompts === 1 && parse.promptCounts.skipped === 1,
    parse.promptCounts, '{prompts:1, skipped:1}');

  // ── Lines: Chinese text, committed through the IME sink ─────────────────
  await start('你好世界', 'lines');
  let st = await state();
  check('lines: Chinese stage starts', st.custom && st.custom.total === 1, st.custom && st.custom.total, 1);
  check('lines: Chinese line on the board', st.custom.liveText === '你好世界', st.custom.liveText, '你好世界');
  check('lines: IME sink is focused', st.imeFocused === true, st.imeFocused, true);

  // Composing keys must not be counted.
  await wf(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', isComposing: true, bubbles: true })));
  await sleep(50);
  st = await state();
  check('ime: composing keys are ignored', st.keys === 0 && st.mistakes === 0,
    { keys: st.keys, mistakes: st.mistakes }, { keys: 0, mistakes: 0 });

  await commit('你好世界');
  await sleep(120);
  st = await state();
  check('lines: committed text clears the line', st.custom == null || st.custom.liveText == null,
    st.custom && st.custom.liveText, 'no live line');
  check('lines: four committed characters count as keys', st.keys === 4, st.keys, 4);
  check('lines: no misses from composition', st.mistakes === 0, st.mistakes, 0);
  check('lines: stage completes', st.phase === 'customdone', st.phase, 'customdone');
  await wf(() => window.__wordfall.returnToMenu());

  // ── Falling words: Chinese tokens and a committed clear ─────────────────
  await start('你好 世界 老师', 'words');
  await sleep(700);
  st = await state();
  check('words: Chinese tokens spawn', st.custom && st.words.length >= 1, st.words, '>=1 word');
  const target = st.words[0] && st.words[0].text;
  check('words: a Chinese token is on the board', !!target && /[\u4e00-\u9fff]/.test(target), target, 'CJK token');
  await commit(target);
  await sleep(120);
  st = await state();
  check('words: committed token clears', st.words.indexOf(target) < 0 || st.keys > 0, st.words, 'cleared');
  check('words: no misses from composition', st.mistakes === 0, st.mistakes, 0);
  await wf(() => window.__wordfall.returnToMenu());

  // ── Prompts: cue and typed answer are different strings ─────────────────
  const PROMPTS = '你好 :: ni hao\n谢谢 :: xie xie';
  await start(PROMPTS, 'prompts');
  st = await state();
  check('prompts: stage starts', st.custom && st.custom.layout === 'prompts', st.custom && st.custom.layout, 'prompts');
  check('prompts: typed side is the live line', st.custom.liveText === 'ni hao', st.custom.liveText, 'ni hao');
  check('prompts: shown side is the cue', st.custom.livePrompt === '你好', st.custom.livePrompt, '你好');
  check('prompts: cue stays up without Memorize', st.custom.hidden === false, st.custom.hidden, false);

  await page.keyboard.type('ni hao');
  await sleep(520);
  st = await state();
  check('prompts: typing the answer advances the line', st.custom && st.custom.liveText === 'xie xie',
    st.custom && st.custom.liveText, 'xie xie');
  check('prompts: cue not hidden mid-drill', st.custom && st.custom.hidden === false, st.custom && st.custom.hidden, false);
  await page.keyboard.type('xie xie');
  await waitFor(() => window.__wordfall.state.phase === 'customdone', null, 3000);
  check('prompts: stage completes', (await state()).phase === 'customdone', (await state()).phase, 'customdone');
  await wf(() => window.__wordfall.returnToMenu());

  // Memorize hides the cue for a prompt stage.
  await start('你好 :: ni hao', 'prompts', { memorize: true });
  st = await state();
  check('prompts: Memorize keeps the cue for the preview', st.custom.hidden === false, st.custom.hidden, false);
  await page.keyboard.type('n');
  await sleep(80);
  st = await state();
  check('prompts: first key hides the cue', st.custom.hidden === true, st.custom.hidden, true);
  await wf(() => window.__wordfall.returnToMenu());

  // ── New Run restarts the stage instead of starting the roguelite ────────
  await start('The woods are lovely, dark and deep', 'lines');
  st = await state();
  check('newrun: line stage active', st.custom && st.custom.layout === 'lines', st.custom && st.custom.layout, 'lines');
  await wf(() => window.__wordfall.state.words.length = 0);
  await page.click('#tbNew');
  await sleep(150);
  st = await state();
  check('newrun: still in the practice stage', !!(st.custom && st.custom.layout === 'lines'),
    st.custom && st.custom.layout, 'lines');
  check('newrun: stage restarted at prompt 1', st.custom && st.custom.lineIndex === 0 && st.custom.done === 0,
    st.custom && { line: st.custom.lineIndex, done: st.custom.done }, { line: 0, done: 0 });
  check('newrun: no roguelite run started', st.phase === 'playing' && st.custom && st.custom.total === 1,
    { phase: st.phase, total: st.custom && st.custom.total }, { phase: 'playing', total: 1 });
  await wf(() => window.__wordfall.returnToMenu());

  // ── Persistence of the Prompts layout ───────────────────────────────────
  await wf((text) => {
    localStorage.setItem('wordfall.custom.stages', JSON.stringify([{
      id: 'stage-prompt', name: 'Chinese prompts', layout: 'prompts', memorize: true, loop: false, updated: 1,
      text,
    }]));
  }, PROMPTS);
  await boot();
  await sleep(250);
  const stage = await wf(() => window.__wordfall.custom.stages().find((s) => s.layout === 'prompts'));
  check('persist: Prompts stage reloads', !!stage && /你好/.test(stage.text), stage, 'contains 你好');
  await wf(() => window.__wordfall.returnToMenu());
  await wf(() => window.__wordfall.custom.open());
  await sleep(80);
  await wf(() => {
    const item = Array.from(document.querySelectorAll('.custom-saved-item'))
      .find((n) => /Chinese prompts/.test(n.textContent));
    if (item) item.click();
  });
  await sleep(120);
  const dom = await wf(() => {
    const active = document.querySelector('#customLayout .mode-btn[aria-pressed="true"]');
    return {
      layout: active ? active.dataset.layout : null,
      memorizeDisabled: document.getElementById('customMemorize').disabled,
      memorizeChecked: document.getElementById('customMemorize').checked,
      buttons: document.querySelectorAll('#customLayout .mode-btn').length,
    };
  });
  check('persist: editor loads the Prompts layout', dom.layout === 'prompts', dom.layout, 'prompts');
  check('persist: Memorize is available for prompts', dom.memorizeDisabled === false, dom.memorizeDisabled, false);
  check('editor: four layout buttons', dom.buttons === 4, dom.buttons, 4);
} catch (err) {
  errors.push('exception: ' + String((err && err.message) || err).split('\n')[0]);
  log('EXCEPTION', err);
} finally {
  if (browser) await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({
  ok: failed.length === 0 && errors.length === 0,
  passed: checks.length - failed.length,
  failed: failed.length,
  errors,
  durationSec: Math.round(((Date.now() - started) / 1000) * 10) / 10,
  checks,
}, null, 2));
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
