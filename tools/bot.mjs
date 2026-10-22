#!/usr/bin/env node
/**
 * Wordfall M9 balance bot (acceptance cells for the v1.6 typing-speed curve).
 *
 * Loads the real game in headless Chrome (playwright-core + installed Chrome),
 * then calls the in-page debug simulator `window.__wordfall.sim(...)` for a
 * sweep of WPM x draft-mode x seeds. Every run is synchronous inside the page,
 * so a whole sweep is fast and deterministic.
 *
 * SPEC.md acceptance checked here:
 *   - 40 WPM, skip drafts (no cards): the bot ALWAYS dies; MEDIAN death wave 7-9.
 *   - 60 WPM, skip drafts (no cards): the bot ALWAYS dies; MEDIAN death wave 10-12.
 *   - 60 WPM, random drafts:            Dawn rate 30-50%.
 *   - 80 WPM, random drafts:            Dawn rate > 70%.
 *
 * Usage (from the wordfall/ folder):
 *   node tools/bot.mjs              # 40/60/80 WPM x skip/random x 100 seeds
 *   node tools/bot.mjs --seeds 200   # more seeds = steadier percentages
 *   node tools/bot.mjs --seed-base 5000 --seeds 100   # independent seed block
 *   node tools/bot.mjs --wpm 60,80 --json             # machine-readable only
 *   node tools/bot.mjs --wait-sec 60                  # shorten "wait for M9" window
 *
 * Exits 0 when every assertion passes, 1 when any fails / the game never becomes
 * M9 / a sweep errors, 2 on bad CLI usage. Human-readable by default; --json
 * prints only the JSON result on stdout (progress goes to stderr).
 */
import { chromium } from 'playwright-core';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;

const COMBO_TIMEOUT_MS = 120000; // a single (wpm, mode) sweep of N synchronous sims
const RETRY_WAIT_MS = 20000;     // between "game.js is not M9 yet" reloads
const MODES = ['skip', 'random'];

const USAGE = `Wordfall M9 balance bot

Usage: node tools/bot.mjs [options]

Options:
  --seeds N        runs per (wpm, mode) cell; default 100, minimum 1
  --wpm LIST       comma-separated wpm values, default "40,60,80"
  --seed-base N    first seed of the sweep (seeds are seed-base + 0..N-1);
                   default 1000. Use a different base to re-sample independently
  --max-sec N      per-run simulated time cap passed to sim(); default 1200
  --wait-sec N     how long to wait for window.__wordfall.version === 'M9';
                   default 900 (15 min), retrying every 20 s
  --json           print only the machine-readable JSON result on stdout
  -h, --help       show this help

Exits 0 if all SPEC M5 assertions pass, 1 otherwise.`;

function usageError(message) {
  console.error(`bot: ${message}\n\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { seeds: 100, wpm: [40, 60, 80], seedBase: 1000, maxSec: 1200, waitSec: 900, json: false };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) usageError(`${arg} needs a value`);
      return argv[++i];
    };
    switch (arg) {
      case '--seeds': {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 1) usageError('--seeds must be a positive integer');
        opts.seeds = n;
        break;
      }
      case '--wpm': {
        const list = value().split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
        if (!list.length || list.some((n) => !(n > 0))) usageError('--wpm must be a comma list of positive numbers, e.g. --wpm 60,80');
        opts.wpm = list;
        break;
      }
      case '--seed-base': {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 0) usageError('--seed-base must be a non-negative integer');
        opts.seedBase = n;
        break;
      }
      case '--max-sec': {
        const n = Number(value());
        if (!(n > 0)) usageError('--max-sec must be a positive number');
        opts.maxSec = n;
        break;
      }
      case '--wait-sec': {
        const n = Number(value());
        if (!(n >= 0)) usageError('--wait-sec must be >= 0');
        opts.waitSec = n;
        break;
      }
      case '--json':
        opts.json = true;
        break;
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        usageError(`unknown argument: ${arg}`);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv);
// stdout is reserved for the JSON payload when --json is set.
const say = (...args) => (opts.json ? console.error : console.log)(...args);
const warn = (...args) => console.error(...args);
const startedAt = Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pct = (rate) => `${(rate * 100).toFixed(1)}%`;
const firstLine = (err) => String((err && err.message) || err).split('\n')[0];

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

/** Mean / median helpers (median of an even-length list averages the middle two). */
function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Open the game and wait until window.__wordfall.version === 'M9'.
 * Each attempt gets a fresh browser context so a concurrently rewritten
 * game.js / index.html / words.js is re-read from disk.
 */
async function waitForM9(browser) {
  const deadline = Date.now() + opts.waitSec * 1000;
  let last = 'window.__wordfall missing';
  for (let attempt = 1; ; attempt++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    let version = null;
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(firstLine(e)));
    try {
      await page.goto(INDEX_URL, { waitUntil: 'load', timeout: 20000 });
      version = await page.evaluate(() => (window.__wordfall && window.__wordfall.version) || null);
    } catch (err) {
      last = `load failed: ${firstLine(err)}`;
    }
    if (version === 'M9') {
      say(`[bot] ${INDEX_URL} -> game.js version M9`);
      return { context, page };
    }
    if (version) last = `version=${JSON.stringify(version)}`;
    else if (pageErrors.length) last = `no hook; pageerror: ${pageErrors[0]}`;
    else if (last !== 'window.__wordfall missing') { /* keep previous detail */ }
    await context.close().catch(() => {});
    if (Date.now() >= deadline) {
      throw new Error(
        `game.js never exposed window.__wordfall.version === 'M9' within ${opts.waitSec}s ` +
        `(last: ${last}). The Lead may still be rewriting game.js; rerun with --wait-sec 900 or wait for the ready ping.`
      );
    }
    warn(`[bot] not ready yet (${last}); retrying in ${RETRY_WAIT_MS / 1000}s — ${Math.max(0, Math.round((deadline - Date.now()) / 1000))}s left`);
    await sleep(RETRY_WAIT_MS);
  }
}

function validateSimRun(raw, fallbackSeed, contractErrors) {
  if (!raw || typeof raw !== 'object') {
    contractErrors.push(`sim(seed=${fallbackSeed}) returned ${raw === null ? 'null' : typeof raw}`);
    return null;
  }
  const problems = [];
  if (typeof raw.wave !== 'number') problems.push('wave not a number');
  if (typeof raw.score !== 'number') problems.push('score not a number');
  if (typeof raw.seconds !== 'number') problems.push('seconds not a number');
  if (typeof raw.cleared !== 'number') problems.push('cleared not a number');
  if (typeof raw.dawn !== 'boolean') problems.push('dawn not a boolean');
  if (typeof raw.died !== 'boolean') problems.push('died not a boolean');
  if (typeof raw.pressure !== 'number') problems.push('pressure not a number');
  if (problems.length) {
    contractErrors.push(`sim(seed=${fallbackSeed}) bad shape: ${problems.join(', ')}`);
    return null;
  }
  if (raw.dawn && raw.died) {
    contractErrors.push(`sim(seed=${fallbackSeed}) reported dawn AND died`);
    return null;
  }
  return { ...raw, seed: typeof raw.seed === 'number' ? raw.seed : fallbackSeed };
}

async function runCombo(page, wpm, mode, contractErrors) {
  const payload = { wpm, mode, seeds: opts.seeds, seedBase: opts.seedBase, maxSec: opts.maxSec };
  const raw = await withTimeout(
    page.evaluate(({ wpm, mode, seeds, seedBase, maxSec }) => {
      const w = window.__wordfall;
      if (!w || typeof w.sim !== 'function') return { fatal: 'window.__wordfall.sim is not a function' };
      const out = [];
      for (let i = 0; i < seeds; i++) {
        const seed = seedBase + i;
        try {
          out.push({ seed, result: w.sim({ wpm, mode, seed, maxSec }) });
        } catch (err) {
          out.push({ seed, error: String((err && err.message) || err) });
        }
      }
      return { out };
    }, payload),
    COMBO_TIMEOUT_MS,
    `sim sweep ${wpm} WPM / ${mode} exceeded ${COMBO_TIMEOUT_MS / 1000}s (a single sim is hung?)`
  );
  if (raw && raw.fatal) throw new Error(raw.fatal);

  const runs = [];
  for (const item of raw.out) {
    if (item.error) {
      contractErrors.push(`sim(${wpm} WPM, ${mode}, seed=${item.seed}) threw: ${firstLine(item.error)}`);
      continue;
    }
    const run = validateSimRun(item.result, item.seed, contractErrors);
    if (run) runs.push(run);
  }

  const dawn = runs.filter((r) => r.dawn).length;
  const died = runs.filter((r) => r.died).length;
  const unfinished = runs.length - dawn - died;
  const waves = runs.map((r) => r.wave);
  const waveHistogram = {};
  for (const w of waves) waveHistogram[w] = (waveHistogram[w] || 0) + 1;

  return {
    wpm,
    mode,
    runs: runs.length,
    seedsRequested: opts.seeds,
    dawn,
    died,
    unfinished,
    dawnRate: runs.length ? dawn / runs.length : 0,
    deathRate: runs.length ? died / runs.length : 0,
    medianWave: median(waves),
    meanWave: mean(waves),
    meanSeconds: mean(runs.map((r) => r.seconds)),
    meanScore: mean(runs.map((r) => r.score)),
    waveHistogram,
  };
}

function formatHistogram(histogram) {
  return Object.keys(histogram)
    .map(Number)
    .sort((a, b) => a - b)
    .map((wave) => `${wave}:${histogram[wave]}`)
    .join('  ');
}

function evaluateAssertions(combos, contractErrors) {
  const byKey = new Map(combos.map((c) => [`${c.wpm}/${c.mode}`, c]));
  const assertions = [];

  const comboAssertion = (wpm, mode, name, target, fn) => {
    const combo = byKey.get(`${wpm}/${mode}`);
    if (!combo) {
      assertions.push({ name, target, actual: 'combo not run', pass: true, skipped: true });
      return;
    }
    const { pass, actual } = fn(combo);
    assertions.push({ name, target, actual, pass: !!pass, skipped: false });
  };

  comboAssertion(
    40,
    'skip',
    '40 WPM / skip: always dies (no cards)',
    'death rate 100%',
    (c) => ({
      pass: c.runs > 0 && c.died === c.runs && c.dawn === 0,
      actual: `death rate ${pct(c.deathRate)} (${c.died}/${c.runs}), dawn ${pct(c.dawnRate)} (${c.dawn})`,
    })
  );

  comboAssertion(
    40,
    'skip',
    '40 WPM / skip: median death wave 7-9',
    'median in [7, 9]',
    (c) => ({
      pass: c.medianWave >= 7 && c.medianWave <= 9,
      actual:
        `median ${c.medianWave}, mean ${c.meanWave.toFixed(2)}, ` +
        `distribution { ${formatHistogram(c.waveHistogram)} }`,
    })
  );

  comboAssertion(
    60,
    'skip',
    '60 WPM / skip: always dies (no cards)',
    'death rate 100%',
    (c) => ({
      pass: c.runs > 0 && c.died === c.runs && c.dawn === 0,
      actual: `death rate ${pct(c.deathRate)} (${c.died}/${c.runs}), dawn ${pct(c.dawnRate)} (${c.dawn})`,
    })
  );

  comboAssertion(
    60,
    'skip',
    '60 WPM / skip: median death wave 10-12',
    'median in [10, 12]',
    (c) => ({
      pass: c.medianWave >= 10 && c.medianWave <= 12,
      actual:
        `median ${c.medianWave}, mean ${c.meanWave.toFixed(2)}, ` +
        `distribution { ${formatHistogram(c.waveHistogram)} }`,
    })
  );

  comboAssertion(
    60,
    'random',
    '60 WPM / random: dawn rate 30-50%',
    'dawn rate in [30%, 50%]',
    (c) => {
      // Compare on integer counts to avoid float fuzz at the bounds.
      const pass = c.runs > 0 && c.dawn * 100 >= 30 * c.runs && c.dawn * 100 <= 50 * c.runs;
      return { pass, actual: `dawn rate ${pct(c.dawnRate)} (${c.dawn}/${c.runs})` };
    }
  );

  comboAssertion(
    80,
    'random',
    '80 WPM / random: dawn rate > 70%',
    'dawn rate > 70%',
    (c) => ({
      pass: c.runs > 0 && c.dawn * 100 > 70 * c.runs,
      actual: `dawn rate ${pct(c.dawnRate)} (${c.dawn}/${c.runs})`,
    })
  );

  assertions.push({
    name: 'contract: sim() result shape is valid',
    target: 'no shape errors',
    actual: contractErrors.length ? `${contractErrors.length} error(s); first: ${contractErrors[0]}` : 'no errors',
    pass: contractErrors.length === 0,
    skipped: false,
  });

  return assertions;
}

function printHuman(result, contractErrors) {
  console.log(`\nWordfall balance bot — version ${result.version}, seeds ${result.config.seeds}/cell (base ${result.config.seedBase}), maxSec ${result.config.maxSec}, ${result.elapsedSec.toFixed(1)}s`);
  console.log('\nWPM  MODE    RUNS  DAWN%   DEATH%  MED WAVE  MEAN WAVE  MEAN SEC  MEAN SCORE');
  for (const c of result.combos) {
    console.log(
      `${String(c.wpm).padEnd(4)} ${c.mode.padEnd(7)} ${String(c.runs).padStart(4)}  ` +
      `${pct(c.dawnRate).padStart(6)}  ${pct(c.deathRate).padStart(6)}  ` +
      `${String(c.medianWave).padStart(8)}  ${c.meanWave.toFixed(2).padStart(9)}  ` +
      `${c.meanSeconds.toFixed(0).padStart(8)}  ${c.meanScore.toFixed(0).padStart(10)}` +
      (c.unfinished ? `  (${c.unfinished} unfinished)` : '')
    );
  }

  const skip60 = result.combos.find((c) => c.wpm === 60 && c.mode === 'skip');
  if (skip60) console.log(`\n60 WPM / skip death-wave distribution: { ${formatHistogram(skip60.waveHistogram)} }`);
  const skip40 = result.combos.find((c) => c.wpm === 40 && c.mode === 'skip');
  if (skip40) console.log(`40 WPM / skip death-wave distribution: { ${formatHistogram(skip40.waveHistogram)} }`);

  console.log('\nASSERTIONS');
  let passed = 0;
  let failed = 0;
  for (const a of result.assertions) {
    const status = a.skipped ? 'SKIP' : a.pass ? 'PASS' : 'FAIL';
    if (!a.skipped) (a.pass ? passed++ : failed++);
    console.log(`${status}  ${a.name}`);
    console.log(`      target: ${a.target}`);
    console.log(`      actual: ${a.actual}`);
  }
  const skipped = result.assertions.filter((a) => a.skipped).length;
  console.log(
    `\nRESULT: ${result.pass ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed` +
    (skipped ? `, ${skipped} skipped` : '') +
    ` (${result.elapsedSec.toFixed(1)}s)`
  );
  if (contractErrors.length) {
    console.log('\nContract errors:');
    for (const e of contractErrors.slice(0, 10)) console.log(`  - ${e}`);
  }
}

let browser = null;
let payload = null;
let exitCode = 1;

try {
  say('[bot] launching headless Chrome (channel=chrome)…');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const { page } = await waitForM9(browser);
  const contractErrorsForThisRun = [];

  // A hung sim should not hang the whole script; closing the browser in the
  // finally block settles any still-pending evaluate.
  const combos = [];
  for (const wpm of opts.wpm) {
    for (const mode of MODES) {
      say(`[bot] sweeping ${wpm} WPM / ${mode} x ${opts.seeds} seeds…`);
      const t0 = Date.now();
      const combo = await runCombo(page, wpm, mode, contractErrorsForThisRun);
      combos.push(combo);
      say(
        `[bot]   dawn ${pct(combo.dawnRate)}  death ${pct(combo.deathRate)}  ` +
        `median wave ${combo.medianWave}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`
      );
    }
  }

  const assertions = evaluateAssertions(combos, contractErrorsForThisRun);
  payload = {
    pass: assertions.every((a) => a.skipped || a.pass),
    version: 'M9',
    config: { seeds: opts.seeds, seedBase: opts.seedBase, wpm: opts.wpm, modes: MODES, maxSec: opts.maxSec },
    combos,
    assertions,
    contractErrors: contractErrorsForThisRun,
    elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
  };
  exitCode = payload.pass ? 0 : 1;
  if (!opts.json) printHuman(payload, contractErrorsForThisRun);
  else console.log(JSON.stringify(payload, null, 2));
} catch (err) {
  const message = firstLine(err);
  if (opts.json) {
    console.log(JSON.stringify({
      pass: false,
      version: null,
      error: message,
      elapsedSec: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
    }, null, 2));
  } else {
    console.error(`\nRESULT: FAIL — ${message}`);
    console.error('No game.js edits were made by this script; report contract/API mismatches to the Lead.');
  }
  exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
}

// Exit code was decided above; nothing after this line may change it.
process.exitCode = exitCode;
