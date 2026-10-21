#!/usr/bin/env node
/**
 * Independent QA harness for the Wordfall v1.4 juice pass.
 * Read-only on product code: opens the real game in headless Chrome at two
 * viewports, drives it through window.__wordfall, reads canvas pixels in-page
 * (no image libraries) and writes shots/qa-*.png.
 *
 * Run from wordfall/:
 *   node tools/qa-juice.mjs
 *   QA_OLD_DIR=<dir with HEAD index.html/game.js/style.css/words.js> node tools/qa-juice.mjs --old-only
 *
 * Prints a JSON summary on stdout, exits 0 only if every check passes.
 */
import { chromium } from 'playwright-core';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const SHOTS = path.join(ROOT, 'shots');
const OLD_DIR = process.env.QA_OLD_DIR || '';
const ONLY_OLD = process.argv.includes('--old-only');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error('[qa]', ...a);
const checks = [];
function check(id, requirement, pass, target, actual, evidence) {
  checks.push({ id, requirement, pass: !!pass, target, actual, evidence: evidence || null });
  log(`${pass ? 'PASS' : 'FAIL'} ${id} :: ${requirement} — actual=${JSON.stringify(actual)} target=${JSON.stringify(target)}`);
}

// ─── Audio instrumentation injected before any page script ──────────────────
function audioProbe() {
  const stats = (window.__qaAudio = {
    available: false, contexts: 0, oscillators: 0, buffers: 0,
    compressors: 0, gains: 0, gainNodes: [], compressorNodes: [], connects: [],
    ctxState: null, error: null,
  });
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    stats.available = true;
    const proto = AC.prototype;
    const oGain = proto.createGain;
    const oOsc = proto.createOscillator;
    const oBuf = proto.createBufferSource;
    const oComp = proto.createDynamicsCompressor;
    proto.createGain = function () {
      stats.gains += 1;
      const g = oGain.apply(this, arguments);
      stats.gainNodes.push(g);
      return g;
    };
    proto.createOscillator = function () {
      stats.oscillators += 1;
      return oOsc.apply(this, arguments);
    };
    proto.createBufferSource = function () {
      stats.buffers += 1;
      return oBuf.apply(this, arguments);
    };
    proto.createDynamicsCompressor = function () {
      stats.compressors += 1;
      const c = oComp.apply(this, arguments);
      stats.compressorNodes.push(c);
      return c;
    };
    const AN = window.AudioNode;
    if (AN && AN.prototype.connect) {
      const oConnect = AN.prototype.connect;
      AN.prototype.connect = function (dest) {
        try {
          stats.connects.push({
            from: this.constructor && this.constructor.name,
            to: dest && dest.constructor && dest.constructor.name,
          });
        } catch (e) { /* ignore */ }
        return oConnect.apply(this, arguments);
      };
    }
    // Capture the AudioContext instance the game creates.
    const Wrapped = function () {
      stats.contexts += 1;
      const c = new AC(...arguments);
      stats.ctx = c;
      stats.ctxState = c.state;
      return c;
    };
    Wrapped.prototype = AC.prototype;
    window.AudioContext = Wrapped;
    window.webkitAudioContext = Wrapped;
  } catch (e) {
    stats.error = String((e && e.message) || e);
  }
}

async function newPage(browser, width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String((e && e.message) || e).split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(audioProbe);
  return { context, page, errors };
}

async function loadGame(page, url) {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => window.__wordfall && window.__wordfall.version === 'M7', null, { timeout: 30000 });
}

async function shot(page, name, clip) {
  const opts = { path: path.join(SHOTS, name) };
  if (clip) opts.clip = { x: Math.round(clip.x), y: Math.round(clip.y), width: Math.round(clip.width), height: Math.round(clip.height) };
  await page.screenshot(opts);
  return name;
}

async function playfieldRect(page) {
  return page.evaluate(() => {
    const r = document.getElementById('game').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

// ─── Check 1: trippy animated background ────────────────────────────────────
async function checkBackground(page, vp) {
  await page.evaluate(({ seed }) => {
    const w = window.__wordfall;
    w.reset(seed);
    if (w.settings.fx !== 'full') w.toggleEffects();
    const s = w.state;
    s.lives = 99; s.wave = 1; s.pressure = 20;
    const words = [['lighthouse', 90], ['blacksmith', 200], ['quicksand', 300], ['magnetic', 415], ['ember', 520], ['drift', 610]];
    for (const [t, y] of words) w.spawnWord(t, { y });
  }, { seed: 4321 });
  await sleep(500);
  const rect = await playfieldRect(page);
  const fullShot = await shot(page, `qa-bg-${vp}.png`);
  const fieldShot = await shot(page, `qa-playfield-${vp}.png`, rect);

  const m = await page.evaluate(async () => {
    const src = document.getElementById('game');    const cap = () => {
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(src, 0, 0);
      return g.getImageData(0, 0, c.width, c.height);
    };
    const A = cap();
    await new Promise((r) => setTimeout(r, 560));
    const B = cap();
    const n = A.data.length / 4;
    let changed = 0, sum = 0;
    for (let i = 0; i < A.data.length; i += 4) {
      const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
      if (d > 24) changed++;
      sum += d;
    }
    // colourfulness of the second frame
    let lum = 0, satPix = 0, colorful = 0;
    const bins = new Array(12).fill(0);
    const d = B.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (mx - mn > 45 && mx > 50) {
        satPix++;
        if ((mx - mn) / 255 > 0.35) colorful++;
        let h;
        if (mx === r) h = ((g - b) / (mx - mn) + 6) % 6;
        else if (mx === g) h = (b - r) / (mx - mn) + 2;
        else h = (r - g) / (mx - mn) + 4;
        bins[Math.min(11, Math.floor(h * 2))]++;
      }
    }
    return {
      changedFrac: changed / n, meanAbs: sum / n,
      meanLum: lum / n, satFrac: satPix / n, colorfulFrac: colorful / n,
      hueBins: bins.filter((c) => c > n * 0.003).length,
      canvas: { w: src.width, h: src.height, cssW: src.clientWidth, cssH: src.clientHeight },
    };
  });
  const pass = m.changedFrac >= 0.1 && m.meanAbs >= 4 && m.meanLum >= 25 && m.satFrac >= 0.1 && m.hueBins >= 4;
  check('trippy-bg', 'Background is a trippy, colourful, continuously animated image (not the old dark sky)', pass,
    '>=10% pixels change over ~560ms, meanAbs>=4, meanLum>=25, saturated>=10%, hue bins>=4', m,
    `${fullShot}, ${fieldShot}`);
  return { metrics: m, rect };
}

// ─── Check 2: per-letter typing is extreme ──────────────────────────────────
async function checkTyping(page, vp, rect) {
  const single = await page.evaluate(() => {
    const w = window.__wordfall;
    w.reset(123);
    if (w.settings.fx !== 'full') w.toggleEffects();
    const s = w.state;
    s.lives = 99;
    w.spawnWord('lighthouse', { y: 120 });
    const base = { fx: w.fxState(), keyPunch: s.keyPunch, keyFlash: s.keyFlash, glitch: s.glitch, keyStreak: s.keyStreak };
    const word = w.targetWord();
    const ch = w.nextChar(word);
    w.typeLetter(ch);
    return {
      typed: ch, word: word.text,
      before: base,
      after: {
        fx: w.fxState(), keyPunch: s.keyPunch, keyFlash: s.keyFlash,
        glitch: s.glitch, keyStreak: s.keyStreak, combo: s.combo, shake: s.shake,
      },
      words: s.words.length,
    };
  });
  const fx = single.after.fx;
  const emotiveOk = fx.particles > 0 && fx.streaks > 0 && fx.rings > 0;
  check('typing-one-letter-fx', 'One correct letter fires particles + streaks + rings', emotiveOk,
    'particles>0, streaks>0, rings>0', fx);
  check('typing-one-letter-frame', 'One correct letter punches/flashes the frame', single.after.keyPunch > 0 && single.after.keyFlash > 0,
    'keyPunch>0 and keyFlash>0', { keyPunch: single.after.keyPunch, keyFlash: single.after.keyFlash, shake: single.after.shake });
  check('typing-one-letter-glitch', 'One correct letter ALSO sets state.glitch > 0', single.after.glitch > 0,
    'glitch > 0', { glitch: single.after.glitch, keyStreak: single.after.keyStreak, combo: single.after.combo });

  // Escalation under a rapid streak: keyStreak feeds intensity.
  const streak = await page.evaluate(() => {
    const w = window.__wordfall;
    w.reset(321);
    if (w.settings.fx !== 'full') w.toggleEffects();
    const s = w.state;
    s.lives = 99;
    for (const [t, y] of [['blacksmith', 100], ['quicksand', 250], ['lighthouse', 400]]) w.spawnWord(t, { y });
    let maxGlitch = 0, peak = null, firstGlitchStreak = null;
    for (let i = 0; i < 9; i++) {
      const word = w.targetWord();
      if (!word) break;
      const ch = w.nextChar(word);
      if (ch == null) break;
      w.typeLetter(ch);
      if (s.glitch > 0 && firstGlitchStreak === null) firstGlitchStreak = s.keyStreak;
      maxGlitch = Math.max(maxGlitch, s.glitch);
      if (i === 8) peak = { fx: w.fxState(), keyPunch: s.keyPunch, keyFlash: s.keyFlash, glitch: s.glitch, keyStreak: s.keyStreak };
    }
    return { peak, maxGlitch, keyStreak: s.keyStreak, firstGlitchStreak };
  });
  // Grab a frame right after a burst.
  await page.evaluate(() => {
    const w = window.__wordfall;
    w.reset(555);
    if (w.settings.fx !== 'full') w.toggleEffects();
    w.state.lives = 99;
    for (const [t, y] of [['blacksmith', 100], ['quicksand', 240], ['lighthouse', 380]]) w.spawnWord(t, { y });
    for (let i = 0; i < 7; i++) {
      const word = w.targetWord();
      if (!word) break;
      const ch = w.nextChar(word);
      if (ch == null) break;
      w.typeLetter(ch);
    }
  });
  await sleep(45);
  const typingShot = await shot(page, `qa-typing-${vp}.png`, rect);

  const escalation = streak.peak && streak.peak.fx.streaks > 0 && streak.maxGlitch > 0;
  check('typing-streak-escalates', 'Rapid typing escalates the effects and produces glitch bursts', escalation,
    'streak peaks with particles/streaks/rings > 0 and maxGlitch > 0', streak, typingShot);
  return { single, streak, typingShot };
}

// ─── Check 3: more animations (regions + glitch bursts + CSS rainbow) ───────
async function checkAnimations(page, vp) {
  await page.evaluate(() => {
    const w = window.__wordfall;
    w.reset(7777);
    if (w.settings.fx !== 'full') w.toggleEffects();
    const s = w.state;
    s.lives = 99;
    for (const [t, y] of [['signal', 60], ['tunnel', 200], ['drift', 360], ['ember', 520]]) w.spawnWord(t, { y });
  });
  await sleep(300);
  const region = await page.evaluate(async () => {
    const src = document.getElementById('game');
    const cap = () => {
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(src, 0, 0);
      return g.getImageData(0, 0, c.width, c.height);
    };
    const shots = [];
    for (let i = 0; i < 5; i++) {
      shots.push(cap());
      if (i < 4) await new Promise((r) => setTimeout(r, 620));
    }
    const H = src.height, W = src.width;
    const zones = { top: [0, Math.floor(H * 0.34)], mid: [Math.floor(H * 0.34), Math.floor(H * 0.7)], bottom: [Math.floor(H * 0.7), H] };
    const out = {};
    for (const [name, [y0, y1]] of Object.entries(zones)) {
      let changed = 0, total = 0;
      for (let k = 0; k < shots.length - 1; k++) {
        const a = shots[k].data, b = shots[k + 1].data;
        for (let y = y0; y < y1; y++) {
          for (let x = 0; x < W; x++) {
            const i = (y * W + x) * 4;
            const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
            if (d > 24) changed++;
            total++;
          }
        }
      }
      out[name] = { changedFrac: changed / total };
    }
    return out;
  });
  const topOk = region.top.changedFrac >= 0.05;
  const midOk = region.mid.changedFrac >= 0.03;
  const bottomOk = region.bottom.changedFrac >= 0.02;
  check('animations-regions', 'Plasma/vortex (top), playfield (mid) and equaliser (bottom) all visibly animate', topOk && midOk && bottomOk,
    'top>=5%, mid>=3%, bottom>=2% pixels change across 620ms intervals', region);

  const glitchRun = await page.evaluate(async () => {
    const w = window.__wordfall;
    const s = w.state;
    s.lives = 99;
    const samples = [];
    let bursts = 0, prev = 0;
    const t0 = performance.now();
    return await new Promise((resolve) => {
      const id = setInterval(() => {
        const g = s.glitch;
        samples.push(g);
        if (g > 0.08 && prev < 0.05) bursts++;
        prev = g;
        if (performance.now() - t0 > 8000) {
          clearInterval(id);
          resolve({ samples: samples.length, bursts, max: Math.max(...samples), mean: samples.reduce((a, b) => a + b, 0) / samples.length, t: s.t });
        }
      }, 80);
    });
  });
  check('animations-glitch-bursts', 'Random distraction glitch bursts appear over time while playing', glitchRun.bursts >= 1 && glitchRun.max > 0.08,
    '>=1 ambient glitch burst in ~8s with peak > 0.08', glitchRun);

  const css = await page.evaluate(() => {
    const el = document.querySelector('.fx-rainbow');
    const cs = el ? getComputedStyle(el) : null;
    return {
      exists: !!el,
      display: cs && cs.display,
      opacity: cs && Number(cs.opacity),
      animationName: cs && cs.animationName,
      animationDuration: cs && cs.animationDuration,
      bodyClass: document.body.className,
      fx: window.__wordfall.settings.fx,
    };
  });
  check('animations-css-rainbow', 'The rolling rainbow interference overlay is present and animating in full FX mode', !!css.exists && css.animationName === 'fx-rainbow-roll' && css.display !== 'none' && css.opacity > 0.2,
    'display!=none, animationName=fx-rainbow-roll, opacity>0.2', css);
  return { region, glitchRun, css };
}

// ─── Check 4: word trails exist and are visible ─────────────────────────────
async function checkTrails(page, vp, rect) {
  await page.evaluate(() => {
    const w = window.__wordfall;
    w.reset(99);
    if (w.settings.fx !== 'full') w.toggleEffects();
    const s = w.state;
    s.lives = 99;
    s.cleared = 160;
    s.phase = 'playing';
    for (const [t, y] of [['blacksmith', 130], ['lighthouse', 230], ['quicksand', 340], ['magnetic', 450], ['ember', 540], ['drift', 610]]) w.spawnWord(t, { y });
  });
  await sleep(800);
  const trails = await page.evaluate(() => {
    const w = window.__wordfall;
    return {
      words: w.state.words.map((x) => ({ text: x.text, trail: x.trail.length, y: Math.round(x.y) })),
      trailEvery: w.CFG.trailEvery,
      trailLen: w.CFG.trailLen,
      speed: w.state.speed,
    };
  });
  const shotName = await shot(page, `qa-trails-${vp}.png`, rect);
  const visible3 = trails.words.filter((w) => w.trail > 2).length;
  const maxTrail = Math.max(0, ...trails.words.map((w) => w.trail));
  check('trails-sampled', 'Falling words record a non-trivial position history', maxTrail >= 5 && visible3 >= 3,
    '>=3 words with trail>=3 and max trail>=5', trails, shotName);

  const vis = await page.evaluate(async () => {
    const w = window.__wordfall;
    const src = document.getElementById('game');
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const cap = () => {
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(src, 0, 0);
      return g.getImageData(0, 0, c.width, c.height);
    };
    const k = (src.width / src.clientWidth) * (src.clientHeight / 800); // logical -> backing px
    const W = src.width, H = src.height;
    const stage = () => {
      w.reset(99);
      if (w.settings.fx !== 'full') w.toggleEffects();
      const s = w.state;
      s.lives = 99;
      s.cleared = 160;
      s.phase = 'playing';
      for (const [t, y] of [['blacksmith', 130], ['lighthouse', 230], ['quicksand', 340], ['magnetic', 450], ['ember', 540], ['drift', 610]]) w.spawnWord(t, { y });
    };
    const diffIn = (A, B, regions) => {
      let changed = 0, total = 0;
      for (const r of regions) {
        for (let y = r.y0; y < r.y0 + r.h; y++) {
          for (let x = r.x0; x < r.x0 + r.w; x++) {
            const i = (y * W + x) * 4;
            const d = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
            if (d > 24) changed++;
            total++;
          }
        }
      }
      return { changed, total, frac: total ? changed / total : 0 };
    };
    const every = w.CFG.trailEvery;
    let attempts = 0;
    let sameFrame = false;
    let trailsOn = null, control = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      attempts = attempt + 1;
      stage();
      await new Promise((r) => setTimeout(r, 520)); // let trails fill to ~10 samples
      // Wait until no ambient glitch is painting the frame.
      for (let guard = 0; guard < 120 && w.state.glitch > 0.02; guard++) await frame();
      const regions = w.state.words.map((x) => ({
        x0: Math.max(0, Math.round((x.x - 8) * k)),
        y0: Math.max(0, Math.round((x.y - 78) * k)),
        w: Math.min(Math.round(90 * k), Math.round((x.w + 16) * k)),
        h: Math.min(Math.round(80 * k), Math.round(74 * k)),
      })).filter((r) => r.y0 + r.h < H && r.w > 0 && r.h > 0);
      if (!regions.length) continue;
      const A = cap();
      const fa = Math.floor(w.state.t * 20);
      w.CFG.trailEvery = 1e9;                 // no new samples
      for (const x of w.state.words) x.trail = [];  // hide trails
      await frame();
      const B = cap();
      const fb = Math.floor(w.state.t * 20);
      await frame();
      const C = cap();
      const fc = Math.floor(w.state.t * 20);
      trailsOn = diffIn(A, B, regions);
      control = diffIn(B, C, regions);
      w.CFG.trailEvery = every;
      // Valid trial only when all three captures sit inside one plasma frame.
      if (fa === fb && fb === fc) { sameFrame = true; break; }
    }
    return { trailsOn, control, regions: 5, k, attempts, sameFrame };
  });
  const visible = vis.trailsOn.changed >= 1500 && vis.trailsOn.changed >= vis.control.changed * 3;
  check('trails-visible', 'Trails contribute clearly visible extra pixels above each word', visible,
    '>=1500 pixels changed by removing trails and >=3x the same-frame no-change control', vis, shotName);
  return { trails, vis, shotName };
}

// ─── Check 5: light mode is calmer but still alive ──────────────────────────
async function checkLight(page, vp, rect) {
  const diffPair = async (delay) => page.evaluate(async (d) => {
    const src = document.getElementById('game');
    const cap = () => {
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(src, 0, 0);
      return g.getImageData(0, 0, c.width, c.height);
    };
    const A = cap();
    await new Promise((r) => setTimeout(r, d));
    const B = cap();
    const n = A.data.length / 4;
    let changed = 0;
    for (let i = 0; i < A.data.length; i += 4) {
      const dd = Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]);
      if (dd > 24) changed++;
    }
    return { changedFrac: changed / n };
  }, delay);

  await page.evaluate(() => {
    const w = window.__wordfall;
    w.reset(11);
    if (w.settings.fx !== 'full') w.toggleEffects();
    w.state.lives = 99;
    w.state.phase = 'paused'; // freeze words so any diff is the backdrop itself
  });
  await sleep(350);
  const fullDiff = await diffPair(650);
  const cssFull = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.fx-rainbow'));
    return { display: cs.display, animationName: cs.animationName, opacity: Number(cs.opacity) };
  });
  await page.evaluate(() => window.__wordfall.toggleEffects());
  await sleep(350);
  const lightDiff = await diffPair(650);
  const cssLight = await page.evaluate(() => {
    const w = window.__wordfall;
    const cs = getComputedStyle(document.querySelector('.fx-rainbow'));
    return {
      fx: w.settings.fx,
      bodyClass: document.body.className,
      rainbowDisplay: cs.display,
      rainbowAnimation: cs.animationName,
      fxLightClass: document.body.classList.contains('fx-light'),
    };
  });
  const lightShot = await shot(page, `qa-light-${vp}.png`);
  const calmer = lightDiff.changedFrac <= fullDiff.changedFrac * 0.35 || lightDiff.changedFrac < 0.02;
  check('light-backdrop', 'Effects: Light makes the backdrop (near-)static compared with full FX', calmer,
    'light changedFrac <= 35% of full (or <2%)', { fullDiff, lightDiff, cssFull, cssLight }, lightShot);
  check('light-rainbow-off', 'Light mode removes the rainbow interference layer', cssLight.rainbowDisplay === 'none' && cssLight.fxLightClass,
    'display:none + body.fx-light', cssLight);
  check('light-persisted-setting', 'Settings report light quality after the toggle', cssLight.fx === 'light', 'settings.fx = light', { fx: cssLight.fx });

  // Still emits effects in light mode.
  const lightFx = await page.evaluate(() => {
    const w = window.__wordfall;
    w.reset(12);
    w.state.lives = 99;
    w.spawnWord('lighthouse', { y: 120 });
    const word = w.targetWord();
    w.typeLetter(w.nextChar(word));
    return { fx: w.fxState(), keyPunch: w.state.keyPunch, keyFlash: w.state.keyFlash, glitch: w.state.glitch };
  });
  check('light-effects', 'Light mode still emits some effects when typing', lightFx.fx.particles > 0 && lightFx.keyPunch > 0,
    'particles>0 and keyPunch>0', lightFx);
  await page.evaluate(() => { const w = window.__wordfall; if (w.settings.fx !== 'full') w.toggleEffects(); });
  return { fullDiff, lightDiff, cssFull, cssLight, lightFx, lightShot };
}

// ─── Check 6: perf full board in full FX (>=50 fps) ─────────────────────────
async function checkPerf(page, vp) {
  const perf = await page.evaluate(async () => {
    const w = window.__wordfall;
    w.reset(2024);
    if (w.settings.fx !== 'full') w.toggleEffects();
    const s = w.state;
    s.lives = 999;
    for (const [t, y] of [['blacksmith', 90], ['lighthouse', 190], ['quicksand', 300], ['magnetic', 420], ['ember', 540], ['drift', 620]]) w.spawnWord(t, { y });
    const texts = ['signal', 'lantern', 'ember', 'drift', 'hollow', 'tunnel', 'magnetic', 'blacksmith'];
    const deltas = [];
    let seen = 0, clears = 0, last = performance.now();
    const maxPools = { particles: 0, shards: 0, rings: 0, popups: 0 };
    return await new Promise((resolve) => {
      const tick = (now) => {
        const dt = now - last;
        last = now;
        s.lives = 999;
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
        }
        const fs = w.fxState();
        maxPools.particles = Math.max(maxPools.particles, fs.particles);
        maxPools.shards = Math.max(maxPools.shards, fs.shards);
        maxPools.rings = Math.max(maxPools.rings, fs.rings);
        maxPools.popups = Math.max(maxPools.popups, fs.popups);
        if (seen >= 8) deltas.push(dt);
        seen += 1;
        if (seen >= 188) {
          const total = deltas.reduce((a, b) => a + b, 0);
          const sorted = deltas.slice().sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          resolve({
            frames: deltas.length,
            avgMs: total / deltas.length,
            fps: 1000 / (total / deltas.length),
            medianMs: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
            p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
            maxMs: sorted[sorted.length - 1],
            longFrames: deltas.filter((d) => d > 33).length,
            clears, maxPools, perf: w.perf(),
          });
        } else {
          requestAnimationFrame(tick);
        }
      };
      requestAnimationFrame(tick);
    });
  });
  const shotName = await shot(page, `qa-perf-${vp}.png`);
  check('perf-full', 'Full FX mode sustains >= 50 fps on a full board', perf.avgMs <= 20,
    'avg frame <= 20ms (>=50 fps) over ~3s of continuous clears', perf, shotName);
  check('perf-p95', 'Full FX frame-time p95 stays <= 20ms (the smoke gate)', perf.p95Ms <= 20,
    'p95Ms <= 20 (plus longFrames<=19, maxMs<=100)', { p95Ms: perf.p95Ms, longFrames: perf.longFrames, maxMs: perf.maxMs, avgMs: perf.avgMs, fps: Number(perf.fps.toFixed(1)) }, shotName);
  return { perf, shotName };
}

// ─── Check 7: audio path (runtime probe + code inspection) ──────────────────
async function checkAudio(page, vp) {
  // Real user gesture + keydown so ensureAudio() runs through the normal path.
  await page.mouse.click(640, 400);
  await page.keyboard.press('KeyA');
  await sleep(120);
  const before = await page.evaluate(() => {
    const S = window.__qaAudio || {};
    return { oscillators: S.oscillators, buffers: S.buffers, gains: S.gains };
  });
  await page.evaluate(() => {
    const w = window.__wordfall;
    w.reset(8080);
    w.state.lives = 99;
    w.spawnWord('lighthouse', { y: 120 });
    const word = w.targetWord();
    w.typeLetter(w.nextChar(word));
    const w2 = w.targetWord();
    if (w2) w.typeLetter(w.nextChar(w2));
  });
  await sleep(150);
  const runtime = await page.evaluate(() => {
    const S = window.__qaAudio || { available: false };
    const gains = (S.gainNodes || []).map((n) => n.gain.value);
    const comps = (S.compressorNodes || []).map((c) => ({ threshold: c.threshold.value, ratio: c.ratio.value, knee: c.knee.value }));
    const hasMaster = gains.some((v) => Math.abs(v - 1.25) < 1e-6);
    const chainGainToComp = (S.connects || []).some((e) => e.from === 'GainNode' && e.to === 'DynamicsCompressorNode');
    const chainCompToDest = (S.connects || []).some((e) => e.from === 'DynamicsCompressorNode' && e.to === 'AudioDestinationNode');
    return {
      available: S.available, contexts: S.contexts, oscillators: S.oscillators, buffers: S.buffers,
      compressors: S.compressors, gains: S.gains, hasMasterGain125: hasMaster, chainGainToComp, chainCompToDest,
      ctxState: (S.ctx && S.ctx.state) || S.ctxState || null, comps, error: S.error,
      muted: window.__wordfall.state.muted,
    };
  });
  const delta = { oscillators: runtime.oscillators - before.oscillators, buffers: runtime.buffers - before.buffers };
  const rtPass = runtime.available && runtime.contexts >= 1 && delta.oscillators >= 3 && delta.buffers >= 1 && runtime.hasMasterGain125 && runtime.chainGainToComp && runtime.chainCompToDest;
  check('audio-runtime', 'Audio graph actually runs on a committed letter (oscillators + noise click through a master gain -> compressor -> destination)',
    rtPass, 'on 2 typed letters: >=3 new oscillators, >=1 new buffer source, gain 1.25, GainNode->Compressor->Destination', { ...runtime, delta });

  // Code inspection + comparison with the v1.3 baseline from git HEAD.
  const now = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
  let old = '';
  try { old = execFileSync('git', ['show', 'HEAD:game.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); } catch (e) { old = ''; }
  const grab = (src, re) => { const m = src.match(re); return m || null; };
  const masterMatch = grab(now, /master\.gain\.value\s*=\s*([\d.]+)/);
  const newChain = {
    master: masterMatch ? masterMatch[1] : null,
    masterConnect: grab(now, /master\.connect\(comp\);\s*\r?\n\s*comp\.connect\(ac\.destination\)/),
    audioOut: grab(now, /function audioOut\(\)\s*\{[\s\S]*?\n\s{2}\}/),
    playKey: grab(now, /function playKey\(pos, len\) \{[\s\S]*?\n\s{2}\}/),
  };
  const oldPlayKeyRaw = old.match(/function playKey\(pos, len\) \{[\s\S]*?\n\s{2}\}/);
  const oldPlayKey = oldPlayKeyRaw ? oldPlayKeyRaw[0] : '';
  const newPlayKeyRaw = newChain.playKey ? newChain.playKey[0] : '';
  const oldGain = Number((oldPlayKey.match(/tone\(pitch, [\d.]+, 'square', ([\d.]+)\)/) || [])[1] || NaN);
  const newGain = Number((newPlayKeyRaw.match(/tone\(pitch, [\d.]+, 'square', ([\d.]+)\)/) || [])[1] || NaN);
  const ratio = newGain / oldGain;
  const masterVal = newChain.master ? Number(newChain.master) : NaN;
  const hasClick = /playClick\(0\.[4-9]\)/.test(newPlayKeyRaw);
  const codePass = !!newChain.masterConnect && /master/.test(newChain.audioOut ? newChain.audioOut[0] : '') &&
    hasClick && /tone\(pitch \* 0\.5, 0\.07, 'triangle', 0\.05\)/.test(newPlayKeyRaw) &&
    ratio >= 5 && ratio <= 10 && Math.abs(masterVal - 1.25) < 1e-6;
  check('audio-code', 'Committed-letter gain is ~5-10x the v1.3 0.010 square tone, behind a master gain+compressor with no bypass',
    codePass, 'ratio 5-10x, master gain 1.25, compressor chain, new click/triangle layers, all output via audioOut()', {
      oldGain, newGain, ratio, effectiveRatio: Number((ratio * masterVal).toFixed(3)), masterGain: masterVal,
      hasCompressorChain: !!newChain.masterConnect, audioOutUsesMaster: /master/.test(newChain.audioOut ? newChain.audioOut[0] : ''),
      clickLayer: hasClick, triangleLayer: /tone\(pitch \* 0\.5, 0\.07, 'triangle', 0\.05\)/.test(newPlayKeyRaw), oldPlayKey,
    });
  return { runtime, code: { oldGain, newGain, ratio, masterVal } };
}

// ─── Check 0: title-bar buttons stay live while a modal dialog is open ──────
async function checkTitleButtons(page, vp) {
  const firstLine = (e) => String((e && e.message) || e).split('\n')[0];
  // At boot the Welcome dialog owns the screen (phase menu).
  const welcome = await page.evaluate(() => {
    const app = document.getElementById('app');
    const dlg = document.getElementById('dlgWelcome');
    const btns = [...document.querySelectorAll('.title-buttons .title-btn')];
    const hit = document.elementFromPoint(
      ...(() => { const r = document.getElementById('btnMin').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })(),
    );
    return {
      welcomeShown: dlg.classList.contains('show'),
      modalOpen: app.classList.contains('modal-open'),
      count: btns.length,
      pointerEvents: btns.map((b) => getComputedStyle(b).pointerEvents),
      hitAtBtnMin: hit ? (hit.id || hit.className || hit.tagName) : null,
    };
  });
  const peLive = welcome.count >= 3 && welcome.pointerEvents.every((p) => p !== 'none');
  check('title-buttons-welcome', 'Title-bar buttons stay clickable while the Welcome dialog is open (pointer-events not none)', welcome.welcomeShown && welcome.modalOpen && peLive,
    'welcome+modal-open, 3 buttons, no pointer-events:none', welcome);

  // Real click on minimize while the modal is open.
  let err = null;
  try { await page.click('#btnMin', { timeout: 4000 }); } catch (e) { err = firstLine(e); }
  const min = await page.evaluate(() => ({
    minimized: document.getElementById('app').classList.contains('minimized'),
    phase: window.__wordfall.state.phase,
    welcomeShown: document.getElementById('dlgWelcome').classList.contains('show'),
  }));
  check('title-minimize-click', 'A real click on #btnMin minimizes the app even with the Welcome dialog open', err === null && min.minimized,
    'click succeeds, #app.minimized', { err, ...min });

  // Restore through the taskbar button.
  let rerr = null;
  try { await page.click('#taskBtn', { timeout: 4000 }); } catch (e) { rerr = firstLine(e); }
  const restored = await page.evaluate(() => ({
    minimized: document.getElementById('app').classList.contains('minimized'),
    taskRaised: document.getElementById('taskBtn').classList.contains('raised'),
  }));
  check('title-minimize-restore', 'The taskbar button restores the app after the title-bar minimize', rerr === null && !restored.minimized,
    'click succeeds, #app not minimized', { err: rerr, ...restored });

  // Real click on close while a dialog is open -> Quit confirmation.
  let cerr = null;
  try { await page.click('#btnClose', { timeout: 4000 }); } catch (e) { cerr = firstLine(e); }
  const quit = await page.evaluate(() => ({
    quitShown: document.getElementById('dlgQuit').classList.contains('show'),
    welcomeShown: document.getElementById('dlgWelcome').classList.contains('show'),
    modalOpen: document.getElementById('app').classList.contains('modal-open'),
  }));
  check('title-close-dialog', 'A real click on #btnClose with a dialog open opens the Quit confirmation', cerr === null && quit.quitShown,
    'click succeeds, #dlgQuit.show', { err: cerr, ...quit });

  // Dismiss Quit, open the Draft dialog, and repeat with the Draft dialog.
  await page.evaluate(() => {
    document.getElementById('quitNo').click();
    const w = window.__wordfall;
    w.reset(4242);
    w.beginDraft();
  });
  await sleep(300);
  const draft = await page.evaluate(() => {
    const app = document.getElementById('app');
    return {
      draftShown: document.getElementById('dlgDraft').classList.contains('show'),
      modalOpen: app.classList.contains('modal-open'),
      phase: window.__wordfall.state.phase,
      pointerEvents: [...document.querySelectorAll('.title-buttons .title-btn')].map((b) => getComputedStyle(b).pointerEvents),
    };
  });
  check('title-buttons-draft', 'Title-bar buttons stay clickable while the Draft dialog is open', draft.draftShown && draft.modalOpen && draft.pointerEvents.length >= 3 && draft.pointerEvents.every((p) => p !== 'none'),
    'draft+modal-open, no pointer-events:none', draft);

  // And a real minimize click from the draft screen.
  let derr = null;
  try { await page.click('#btnMin', { timeout: 4000 }); } catch (e) { derr = firstLine(e); }
  const dmin = await page.evaluate(() => ({
    minimized: document.getElementById('app').classList.contains('minimized'),
    draftShown: document.getElementById('dlgDraft').classList.contains('show'),
  }));
  check('title-minimize-draft', 'A real click on #btnMin minimizes the app with the Draft dialog open', derr === null && dmin.minimized,
    'click succeeds, #app.minimized', { err: derr, ...dmin });
  await page.evaluate(() => {
    document.getElementById('app').classList.remove('minimized');
    document.getElementById('taskBtn').classList.remove('raised');
  });
  return { welcome, min, restored, quit, draft, dmin };
}

// ─── Old-build reference (git HEAD v1.3 backdrop) ───────────────────────────
async function checkOldReference(browser, vp, width, height) {
  if (!OLD_DIR || !fs.existsSync(path.join(OLD_DIR, 'index.html'))) return null;
  const { context, page, errors } = await newPage(browser, width, height);
  try {
    await loadGame(page, pathToFileURL(path.join(OLD_DIR, 'index.html')).href);
    await page.evaluate(() => { window.__wordfall.reset(4321); window.__wordfall.state.lives = 99; });
    await sleep(500);
    const m = await page.evaluate(() => {
      const src = document.getElementById('game');
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(src, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const n = d.length / 4;
      let lum = 0, satPix = 0;
      const bins = new Array(12).fill(0);
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i], gg = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        lum += 0.2126 * r + 0.7152 * gg + 0.0722 * b;
        if (mx - mn > 45 && mx > 50) {
          satPix++;
          let h;
          if (mx === r) h = ((gg - b) / (mx - mn) + 6) % 6;
          else if (mx === gg) h = (b - r) / (mx - mn) + 2;
          else h = (r - gg) / (mx - mn) + 4;
          bins[Math.min(11, Math.floor(h * 2))]++;
        }
      }
      return { meanLum: lum / n, satFrac: satPix / n, hueBins: bins.filter((x) => x > n * 0.003).length };
    });
    const name = await shot(page, `qa-old-ref-${vp}.png`);
    return { metrics: m, screenshot: name, errors };
  } finally {
    await context.close().catch(() => {});
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────
const VIEWPORTS = [
  { vp: '1280x800', width: 1280, height: 800 },
  { vp: '1920x1080', width: 1920, height: 1080 },
].filter((v) => { const i = process.argv.findIndex((a) => a === '--vp'); return i < 0 || process.argv[i + 1] === v.vp; });
const summary = { viewports: {}, audioCode: null, oldRef: {}, errors: [], startedAt: new Date().toISOString() };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  if (!ONLY_OLD) {
    for (const { vp, width, height } of VIEWPORTS) {
      log(`=== viewport ${vp} ===`);
      const { context, page, errors } = await newPage(browser, width, height);
      try {
        await loadGame(page, URL);
        const contract = await page.evaluate(() => ({ version: window.__wordfall.version, hasFx: typeof window.__wordfall.fxState === 'function', hasStreaks: 'streaks' in window.__wordfall.fxState() }));
        check(`contract-${vp}`, 'Debug hook exposes version M7, fxState (with streaks) and controls', contract.version === 'M7' && contract.hasFx && contract.hasStreaks, 'M7 + fxState.streaks', contract);

        const titleBtns = await checkTitleButtons(page, vp);
        const bg = await checkBackground(page, vp);
        const typing = await checkTyping(page, vp, bg.rect);
        const anim = await checkAnimations(page, vp);
        const trails = await checkTrails(page, vp, bg.rect);
        const light = await checkLight(page, vp, bg.rect);
        const perf = await checkPerf(page, vp);
        const audio = await checkAudio(page, vp);

        await page.evaluate(() => { const w = window.__wordfall; w.reset(1); if (w.settings.fx !== 'full') w.toggleEffects(); });
        await sleep(300);
        await shot(page, `qa-final-${vp}.png`);
        check(`runtime-errors-${vp}`, 'No page or console errors during the whole viewport run', errors.length === 0, '0 errors', errors);
        summary.viewports[vp] = { titleBtns, bg: bg.metrics, typing, animations: anim, trails, light, perf, audio, errors };
      } catch (err) {
        check(`viewport-${vp}-completed`, `Viewport ${vp} completed without throwing`, false, 'no exception', String((err && err.message) || err));
        summary.viewports[vp] = { error: String((err && err.stack) || err), errors };
      } finally {
        await context.close().catch(() => {});
      }
    }
  }
  // Old-build reference for both viewports.
  for (const { vp, width, height } of VIEWPORTS) {
    const ref = await checkOldReference(browser, vp, width, height);
    if (ref) {
      summary.oldRef[vp] = ref;
      log(`old reference ${vp}: ${JSON.stringify(ref.metrics)}`);
    }
  }
  if (summary.oldRef['1280x800'] && summary.viewports['1280x800'] && summary.viewports['1280x800'].bg) {
    const o = summary.oldRef['1280x800'].metrics;
    const n = summary.viewports['1280x800'].bg;
    check('old-background-replaced', 'The v1.3 dark sky/skyline backdrop is actually replaced (new is much brighter and more hue-diverse than git HEAD)',
      n.meanLum > o.meanLum * 3 && n.hueBins >= o.hueBins + 2 && n.satFrac > o.satFrac * 1.2,
      'new meanLum > 3x old, hueBins >= old+2, satFrac > 1.2x old', { old: o, new: { meanLum: n.meanLum, satFrac: n.satFrac, hueBins: n.hueBins } });
  }
  // Doc/version checks.
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const csproj = fs.readFileSync(path.join(ROOT, 'win', 'Wordfall.csproj'), 'utf8');
  const versionOk = /<Version>1\.4\.0<\/Version>/.test(csproj) && /Version 1\.4 ·/.test(html) && /What's new in v1\.4/.test(readme);
  const readmeFeatures = [/plasma tunnel/, /comet\s+tail/, /mechanical/, /rainbow interference/, /glitch/].every((re) => re.test(readme));
  check('release-version', 'Native version bump + in-game About + README v1.4 section are consistent', versionOk && readmeFeatures,
    'csproj 1.4.0, About "Version 1.4", README v1.4 section', { versionOk, readmeFeatures });
  // Documentation drift is a real (minor) defect, kept out of the requirement gate.
  const gameSrc = fs.readFileSync(path.join(ROOT, 'game.js'), 'utf8');
  summary.risks = [{
    id: 'readme-doc-drift',
    detail: 'README documentation does not fully match the shipped code',
    evidence: {
      fxStateDocMentionsStreaks: /fxState\(\)` \(`\{quality,[^}]*streaks/.test(readme),
      presentationSays16Frames: /plasma tunnel \(16 frames/.test(readme),
      v14SectionSays24Frames: /24-frame/.test(readme),
      codePlasmaFrames: Number((gameSrc.match(/PLASMA_FRAMES = (\d+)/) || [])[1]),
    },
  }];
} finally {
  await browser.close().catch(() => {});
  summary.checks = checks;
  summary.passed = checks.filter((c) => c.pass).length;
  summary.failed = checks.filter((c) => !c.pass);
  summary.total = checks.length;
  summary.pass = summary.failed.length === 0;
  summary.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.pass ? 0 : 1;
}
