#!/usr/bin/env node
/**
 * Visual preview harness for the juice pass. Opens the real game in headless
 * Chrome, starts a run, stages words and types through them so the effect
 * layer is on screen, and writes screenshots to shots/juice-*.png.
 *
 * Run from wordfall/:
 *   node tools/preview-juice.mjs
 */
import { chromium } from 'playwright-core';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const SHOTS = path.join(ROOT, 'shots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__wordfall && window.__wordfall.version === 'M7', null, { timeout: 30000 });

  await page.evaluate(() => {
    const w = window.__wordfall;
    w.reset(1234);
    w.settings.fx = 'full';
    document.body.classList.remove('fx-light');
    const s = w.state;
    s.lives = 9;
    // Stage a full board with words at different heights.
    const texts = [
      ['signal', 120], ['lantern', 210], ['ember', 310], ['drift', 420],
      ['hollow', 520], ['tunnel', 610],
    ];
    for (const [text, y] of texts) w.spawnWord(text, { y });
  });
  await sleep(700);
  await page.screenshot({ path: path.join(SHOTS, 'juice-board.png') });

  // Type most of a word and grab the frame right after a keystroke.
  await page.evaluate(() => {
    const w = window.__wordfall;
    const word = w.targetWord();
    if (word) {
      for (let i = 0; i < Math.min(3, word.text.length - 1); i++) w.typeLetter(w.nextChar(word));
    }
  });
  await sleep(60);
  await page.screenshot({ path: path.join(SHOTS, 'juice-typing.png') });

  // Clear five words back to back, screenshot mid-explosion.
  await page.evaluate(() => {
    const w = window.__wordfall;
    const s = w.state;
    s.lives = 99;
    for (let n = 0; n < 5; n++) {
      const word = w.targetWord();
      if (!word) break;
      let guard = 0;
      while (w.state.words.indexOf(word) >= 0 && guard++ < 30) {
        const ch = w.nextChar(word);
        if (ch == null) break;
        w.typeLetter(ch);
      }
      s.hitPause = 0;
    }
  });
  await sleep(70);
  await page.screenshot({ path: path.join(SHOTS, 'juice-clear.png') });

  // High-speed board: word trails should be obvious here.
  await page.evaluate(() => {
    const w = window.__wordfall;
    const s = w.state;
    w.reset(99);
    s.lives = 99;
    s.cleared = 160;
    s.phase = 'playing';
    const texts = [
      ['blacksmith', 130], ['lighthouse', 230], ['quicksand', 340],
      ['magnetic', 450], ['ember', 540], ['drift', 610],
    ];
    for (const [text, y] of texts) w.spawnWord(text, { y });
  });
  await sleep(650);
  await page.screenshot({ path: path.join(SHOTS, 'juice-trails.png') });

  // Flare word: the fast harmless bonus target.
  const flareInfo = await page.evaluate(() => {
    const w = window.__wordfall;
    const s = w.state;
    w.reset(4242);
    s.lives = 9;
    s.words.length = 0;
    w.spawnWord('signal', { y: 140 });
    w.spawnWord('lantern', { y: 330 });
    const flare = w.spawnFlare();
    if (flare) flare.y = 120;
    return { spawned: !!flare, harmless: !!(flare && flare.harmless), flare: !!(flare && flare.flare) };
  });
  await sleep(320);
  await page.screenshot({ path: path.join(SHOTS, 'juice-flare.png') });

  // Combo milestone burst for a second big screenshot.
  await page.evaluate(() => {
    const w = window.__wordfall;
    w.state.combo = 9;
    const word = w.targetWord();
    if (word) {
      let guard = 0;
      while (w.state.words.indexOf(word) >= 0 && guard++ < 30) {
        const ch = w.nextChar(word);
        if (ch == null) break;
        w.typeLetter(ch);
      }
    }
  });
  await sleep(90);
  await page.screenshot({ path: path.join(SHOTS, 'juice-milestone.png') });

  // Light mode check: the background should still be there, calmer.
  await page.evaluate(() => {
    const w = window.__wordfall;
    if (w.settings.fx !== 'light') w.toggleEffects();
  });
  await sleep(400);
  await page.screenshot({ path: path.join(SHOTS, 'juice-light.png') });

  const stats = await page.evaluate(() => ({
    fx: window.__wordfall.fxState(),
    perf: window.__wordfall.perf(),
    phase: window.__wordfall.state.phase,
  }));
  console.log(JSON.stringify({ stats, errors }, null, 2));
} finally {
  await browser.close();
}
if (errors.length) process.exitCode = 1;
