#!/usr/bin/env node
/**
 * Wordfall balance lab — card power + draft economy analysis.
 *
 * Loads the real game in headless Chrome (playwright-core + installed Chrome) and
 * uses the in-page debug hook `window.__wordfall` to measure:
 *
 *   1. baseline      40/60/80 WPM x random/skip acceptance cells
 *   2. cards         per-card power delta (tier I and II) vs the 60 WPM baselines
 *   3. offers        draft-offer distribution over 11 real drafts / run (200 seeds)
 *   4. policies      deck quality of draft policies (skip / random / slot1 / ...)
 *                    measured by granting a run's *final* deck at wave 1
 *   5. cfg           CFG-mutation proxies for proposed curve / card-ish changes
 *
 * Nothing in game.js is edited. Every measurement reloads the page, records the
 * game.js sha256 it measured, and retries if the Lead's concurrent rewrite is
 * mid-save.
 *
 * Usage (from the wordfall/ folder):
 *   node tools/balance-lab.mjs                          # everything, default sizes
 *   node tools/balance-lab.mjs --phase baseline --seeds 60
 *   node tools/balance-lab.mjs --phase cards --card-seeds 120
 *   node tools/balance-lab.mjs --json                   # raw JSON on stdout instead of tables
 *
 * Phases: baseline, cards, offers, policies, cfg (comma list) or all.
 */
import { chromium } from 'playwright-core';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import process from 'node:process';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const INDEX_URL = pathToFileURL(path.join(ROOT, 'index.html')).href;
const GAME_PATH = path.join(ROOT, 'game.js');

const DEFAULTS = {
  phase: 'all',
  seeds: 400,          // baseline seeds per cell
  seedBase: 1000,
  cardSeeds: 200,      // per-card seeds (paired against baseline subset)
  offerSeeds: 200,     // runs sampled for the draft-offer distribution
  policySeeds: 200,    // runs per draft policy (deck-at-start proxy)
  cfgSeeds: 100,       // seeds per WPM/mode cell for CFG probes
  maxSec: 1200,
  waitSec: 300,
  cards: null,
  json: false,
};

const MODES = ['skip', 'random'];
const WPM_LIST = [40, 60, 80];

// ─── CLI ─────────────────────────────────────────────────────────────────────
const USAGE = `Wordfall balance lab

Options:
  --phase LIST      comma list from baseline,cards,offers,policies,cfg (default all)
  --seeds N         baseline runs per cell (default 400)
  --card-seeds N    runs per per-card cell (default 200)
  --offer-seeds N   runs sampled for offer distribution (default 200)
  --policy-seeds N  runs per draft policy (default 200)
  --cfg-seeds N     runs per cell per CFG probe (default 100)
  --cards LIST      only measure these card ids in the cards phase (default all)
  --seed-base N     first seed (default 1000)
  --max-sec N       per-run simulated seconds (default 1200)
  --wait-sec N      how long to wait for a working build (default 300)
  --json            print raw JSON only (no tables)
  -h, --help        this help`;

function usageError(msg) {
  console.error(`balance-lab: ${msg}\n\n${USAGE}`);
  process.exit(2);
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS };
  const positiveInt = (name, value) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) usageError(`${name} must be a positive integer`);
    return n;
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) usageError(`${arg} needs a value`);
      return argv[++i];
    };
    switch (arg) {
      case '--phase': {
        const list = value().split(',').map((s) => s.trim()).filter(Boolean);
        const allowed = ['baseline', 'cards', 'offers', 'policies', 'cfg'];
        for (const p of list) if (!allowed.includes(p)) usageError(`unknown phase ${p}`);
        opts.phase = list.join(',');
        break;
      }
      case '--seeds': opts.seeds = positiveInt('--seeds', value()); break;
      case '--card-seeds': opts.cardSeeds = positiveInt('--card-seeds', value()); break;
      case '--offer-seeds': opts.offerSeeds = positiveInt('--offer-seeds', value()); break;
      case '--policy-seeds': opts.policySeeds = positiveInt('--policy-seeds', value()); break;
      case '--cfg-seeds': opts.cfgSeeds = positiveInt('--cfg-seeds', value()); break;
      case '--cards': opts.cards = value().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--seed-base': {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 0) usageError('--seed-base must be a non-negative integer');
        opts.seedBase = n;
        break;
      }
      case '--max-sec': {
        const n = Number(value());
        if (!(n > 0)) usageError('--max-sec must be positive');
        opts.maxSec = n;
        break;
      }
      case '--wait-sec': {
        const n = Number(value());
        if (!(n >= 0)) usageError('--wait-sec must be >= 0');
        opts.waitSec = n;
        break;
      }
      case '--json': opts.json = true; break;
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
const phases = opts.phase === 'all' ? ['baseline', 'cards', 'offers', 'policies', 'cfg'] : opts.phase.split(',');
const say = (...a) => (opts.json ? console.error : console.log)(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const startedAt = Date.now();
const firstLine = (e) => String((e && e.message) || e).split('\n')[0];

// ─── math helpers ────────────────────────────────────────────────────────────
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stdev(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const pctDelta = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}pp`;
const signed = (x, d = 2) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
const padL = (v, n) => String(v).padEnd(n);
const padR = (v, n) => String(v).padStart(n);
const chunks = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};
function rangeSeeds(base, count) {
  return Array.from({ length: count }, (_, i) => base + i);
}

// ─── build identity ─────────────────────────────────────────────────────────
function gameBuild() {
  const buf = fs.readFileSync(GAME_PATH);
  const st = fs.statSync(GAME_PATH);
  return {
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    short: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12),
    bytes: buf.length,
    mtime: st.mtime.toISOString(),
  };
}

// ─── browser / page management ──────────────────────────────────────────────
let browser = null;

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded ${(ms / 1000).toFixed(0)}s`)), ms);
    }),
  ]);
}

/** Load index.html until the debug hook is live and the build hash is stable. */
async function boot(waitSec = opts.waitSec) {
  const deadline = Date.now() + waitSec * 1000;
  let last = 'not attempted';
  for (let attempt = 1; ; attempt++) {
    const before = gameBuild();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(firstLine(e)));
    try {
      await page.goto(INDEX_URL, { waitUntil: 'load', timeout: 20000 });
      await page.waitForFunction(
        () => !!(window.__wordfall && typeof window.__wordfall.sim === 'function' && typeof window.__wordfall.version === 'string'),
        undefined,
        { timeout: 15000 }
      );
      const after = gameBuild();
      if (before.sha256 !== after.sha256) {
        last = 'game.js changed while loading; reloading';
        await context.close().catch(() => {});
        continue;
      }
      const meta = await page.evaluate(() => ({
        version: window.__wordfall.version,
        cards: window.__wordfall.CARDS.map((c) => ({
          id: c.id, name: c.name, type: c.type, rarity: c.rarity, maxTier: c.maxTier,
        })),
        hexTotal: window.__wordfall.hexTotal,
      }));
      // Measurement-only speedup: the M7 renderer runs a 60 fps visual loop that
      // fights the synchronous sim for CPU. The lab measures rule outcomes, not
      // pixels, so stop the loop after the game has booted and initialised.
      await page.evaluate(() => {
        try {
          window.requestAnimationFrame = () => 0;
        } catch (e) { /* ignore */ }
        // M7's pulseStatus() does `void el.offsetWidth` on every clear, which
        // forces a synchronous layout even inside sim() (state.simulating is
        // not checked there). That makes bot sweeps ~25x slower. No rule reads
        // offsetWidth, so stub it out for the measurement page only.
        try {
          Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
            configurable: true,
            get() { return 0; },
          });
        } catch (e) { /* ignore */ }
      });
      say(`[lab] loaded ${INDEX_URL} -> version ${meta.version}, game.js ${after.short} (${after.bytes} bytes)`);
      return { context, page, meta, build: after };
    } catch (err) {
      last = pageErrors.length ? `pageerror: ${pageErrors[0]}` : firstLine(err);
      await context.close().catch(() => {});
    }
    if (Date.now() >= deadline) {
      throw new Error(`could not load a working game.js + debug hook within ${waitSec}s (last: ${last})`);
    }
    say(`[lab] build not ready (${last}); retrying in 3s`);
    await sleep(3000);
  }
}

/** Reload if game.js changed on disk since the page was loaded. */
async function ensureBuild(state) {
  const now = gameBuild();
  if (now.sha256 === state.build.sha256) return state;
  say(`[lab] game.js changed on disk (${state.build.short} -> ${now.short}); reloading page`);
  await state.context.close().catch(() => {});
  return boot();
}

/** page.evaluate with a timeout and one page reload + retry on failure. */
async function pageEval(stateRef, fn, arg, label, timeoutMs = 180000) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await withTimeout(stateRef.state.page.evaluate(fn, arg), timeoutMs, label);
      return result;
    } catch (err) {
      say(`[lab] ${label} failed (${firstLine(err)}) [attempt ${attempt}/3]`);
      if (attempt === 3) throw err;
      await stateRef.state.context.close().catch(() => {});
      stateRef.state = await boot();
    }
  }
}

// ─── in-page payloads ────────────────────────────────────────────────────────
/**
 * Runs a list of sim() calls in the page. Each job is
 * { seed, wpm, mode, grant, cfg, maxSec }. Returns the raw sim results.
 */
async function runSimJobs(stateRef, jobs, label) {
  const raw = await pageEval(stateRef, ({ jobs }) => {
    const w = window.__wordfall;
    const out = [];
    for (const job of jobs) {
      const saved = {};
      let used = [];
      if (job.cfg) {
        for (const k of Object.keys(job.cfg)) {
          saved[k] = w.CFG[k];
          w.CFG[k] = job.cfg[k];
        }
        used = Object.keys(job.cfg);
      }
      try {
        out.push({ seed: job.seed, result: w.sim({
          wpm: job.wpm, mode: job.mode, seed: job.seed,
          maxSec: job.maxSec, grant: job.grant || undefined,
        }) });
      } catch (err) {
        out.push({ seed: job.seed, error: String((err && err.message) || err) });
      } finally {
        for (const k of used) w.CFG[k] = saved[k];
      }
    }
    return out;
  }, { jobs }, label);
  const results = [];
  for (const item of raw) {
    if (item.error) throw new Error(`sim(seed=${item.seed}) threw: ${item.error}`);
    results.push({ ...item.result, seed: item.seed });
  }
  return results;
}

// ─── aggregation ─────────────────────────────────────────────────────────────
function summarize(runs) {
  const n = runs.length;
  const dawn = runs.filter((r) => r.dawn).length;
  const died = runs.filter((r) => r.died).length;
  const unfinished = n - dawn - died;
  const waves = runs.map((r) => r.wave);
  const histogram = {};
  for (const w of waves) histogram[w] = (histogram[w] || 0) + 1;
  return {
    n,
    dawn,
    died,
    unfinished,
    dawnRate: n ? dawn / n : 0,
    deathRate: n ? died / n : 0,
    medianWave: median(waves),
    meanWave: mean(waves),
    meanScore: mean(runs.map((r) => r.score)),
    meanSeconds: mean(runs.map((r) => r.seconds)),
    meanCleared: mean(runs.map((r) => r.cleared)),
    histogram,
  };
}

/** Paired delta against a baseline run list keyed by seed. */
function pairedDelta(runs, baselineRuns) {
  const base = new Map(baselineRuns.map((r) => [r.seed, r]));
  const pairs = runs.filter((r) => base.has(r.seed)).map((r) => ({ run: r, base: base.get(r.seed) }));
  if (!pairs.length) return null;
  const dawnDiff = pairs.map((p) => (p.run.dawn ? 1 : 0) - (p.base.dawn ? 1 : 0));
  const waveDiff = pairs.map((p) => p.run.wave - p.base.wave);
  const scoreDiff = pairs.map((p) => p.run.score - p.base.score);
  return {
    n: pairs.length,
    dawnDiff: mean(dawnDiff),
    dawnDiffSE: stdev(dawnDiff) / Math.sqrt(pairs.length),
    waveDiff: mean(waveDiff),
    waveDiffSE: stdev(waveDiff) / Math.sqrt(pairs.length),
    scoreDiff: mean(scoreDiff),
    scoreDiffSE: stdev(scoreDiff) / Math.sqrt(pairs.length),
  };
}

function formatHistogram(h) {
  return Object.keys(h)
    .map(Number)
    .sort((a, b) => a - b)
    .map((w) => `${w}:${h[w]}`)
    .join(' ');
}

// ─── Phase 1: baseline ──────────────────────────────────────────────────────
async function phaseBaseline(stateRef) {
  const seeds = rangeSeeds(opts.seedBase, opts.seeds);
  const cells = [];
  for (const wpm of WPM_LIST) {
    for (const mode of MODES) {
      const t0 = Date.now();
      const runs = [];
      for (const chunk of chunks(seeds, 100)) {
        const jobs = chunk.map((seed) => ({ seed, wpm, mode, maxSec: opts.maxSec }));
        runs.push(...(await runSimJobs(stateRef, jobs, `baseline ${wpm}/${mode}`)));
      }
      const s = summarize(runs);
      s.wpm = wpm;
      s.mode = mode;
      s.runs = runs;
      cells.push(s);
      say(`[lab] baseline ${wpm} WPM / ${mode.padEnd(6)}: dawn ${pct(s.dawnRate)}  death ${pct(s.deathRate)}  median wave ${s.medianWave}  mean score ${s.meanScore.toFixed(0)}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  }
  return cells;
}

// ─── Phase 2: per-card power ────────────────────────────────────────────────
async function phaseCards(stateRef, baselineCells) {
  const { hexTotal, version } = stateRef.state.meta;
  const allCards = stateRef.state.meta.cards;
  const cards = opts.cards ? allCards.filter((c) => opts.cards.includes(c.id)) : allCards;
  if (!cards.length) throw new Error(`--cards matched no card ids (${opts.cards.join(',')})`);
  const seeds = rangeSeeds(opts.seedBase, opts.cardSeeds);
  const baselineRandom = baselineCells.find((c) => c.wpm === 60 && c.mode === 'random').runs;
  const baselineSkip = baselineCells.find((c) => c.wpm === 60 && c.mode === 'skip').runs;
  const baseRandomSubset = baselineRandom.filter((r) => seeds.includes(r.seed));
  const baseSkipSubset = baselineSkip.filter((r) => seeds.includes(r.seed));

  const cells = [];
  for (const card of cards) {
    const tiers = card.maxTier >= 2 ? [1, 2] : [1];
    for (const tier of tiers) {
      const grant = [{ id: card.id, tier }];
      const t0 = Date.now();
      const out = { id: card.id, name: card.name, type: card.type, rarity: card.rarity, maxTier: card.maxTier, tier };
      for (const [mode, baseRuns] of [['random', baseRandomSubset], ['skip', baseSkipSubset]]) {
        const runs = [];
        for (const chunk of chunks(seeds, 100)) {
          const jobs = chunk.map((seed) => ({ seed, wpm: 60, mode, grant, maxSec: opts.maxSec }));
          runs.push(...(await runSimJobs(stateRef, jobs, `card ${card.id} t${tier} ${mode}`)));
        }
        out[mode] = summarize(runs);
        out[mode].delta = pairedDelta(runs, baseRuns);
      }
      cells.push(out);
      say(`[lab] card ${padL(card.id, 12)} t${tier}: random dawn ${pct(out.random.dawnRate)} (${pctDelta(out.random.delta.dawnDiff)}) median ${out.random.medianWave} | skip median wave ${out.skip.medianWave} (${signed(out.skip.delta.waveDiff)})  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
  }
  return { version, hexTotal, cells };
}

// ─── Phase 3: offer distribution ────────────────────────────────────────────
async function phaseOffers(stateRef) {
  const { cards, hexTotal, version } = stateRef.state.meta;
  const seeds = rangeSeeds(opts.seedBase, opts.offerSeeds);
  const POLICIES = ['random', 'slot1', 'nohex', 'newfirst', 'boonfirst', 'slot3', 'skip'];
  const rawRuns = [];

  for (const chunk of chunks(seeds, 25)) {
    const payload = await pageEval(stateRef, ({ seeds, policies, cardDefs, hexTotal }) => {
      const w = window.__wordfall;
      const CARDS = cardDefs;
      const byId = Object.fromEntries(CARDS.map((c) => [c.id, c]));
      // Local RNG so draft choices never touch the game's RNG stream.
      const mulberry32 = (a) => () => {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const hexHeld = () => CARDS.filter((c) => c.type === 'hex' && (w.state.deck[c.id] || 0) > 0).length;
      const eligible = (card) => {
        const held = w.state.deck[card.id] || 0;
        if (held >= card.maxTier) return false;
        if (card.type === 'hex' && held === 0 && hexHeld() >= hexTotal) return false;
        if (card.id === 'grace' && w.state.lives >= w.CFG.maxLives) return false;
        if (card.id === 'steady-hand' && w.state.shieldMax >= w.CFG.maxShields) return false;
        if (card.id === 'longshot' && w.wordRange()[1] < 7) return false;
        return true;
      };
      const nonNull = (offer) => offer.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
      const choose = (policy, offer, heldDeck, rnd) => {
        const idx = nonNull(offer);
        if (!idx.length) return -1;
        if (policy === 'skip') return null;
        if (policy === 'slot1') return idx[0];
        if (policy === 'slot3') return idx[idx.length - 1];
        if (policy === 'random') return idx[(rnd() * idx.length) | 0];
        const score = (i) => {
          const c = offer[i];
          const held = heldDeck[c.id] || 0;
          if (policy === 'newfirst') return (held > 0 ? 0 : 10) + (c.rarity === 'rare' ? 1 : 0);
          if (policy === 'nohex') return (c.type === 'hex' ? 0 : 10) + (held > 0 ? 0 : 1);
          if (policy === 'boonfirst') return (c.type === 'boon' ? 10 : c.type === 'gambit' ? 5 : 0) + (held > 0 ? 0 : 1);
          return 0;
        };
        let best = idx[0];
        let bestScore = -Infinity;
        for (const i of idx) {
          const s = score(i) + rnd() * 1e-6; // deterministic tie-break via local rnd
          if (s > bestScore) { bestScore = s; best = i; }
        }
        return best;
      };

      const runs = [];
      for (const seed of seeds) {
        for (const policy of policies) {
          w.reset(seed);
          const rnd = mulberry32(((seed * 2654435761) ^ (policy.length * 0x9e3779b9)) >>> 0);
          const drafts = [];
          let chose = 0;
          for (let k = 1; k <= 11; k++) {
            // Realistic pressure for the draft after wave k: 10 clears/wave.
            w.state.cleared = 10 * k;
            w.state.wave = k;
            w.beginDraft();
            const offer = w.state.offer || [];
            const heldDeck = { ...w.state.deck };
            const rec = {
              k,
              wave: k,
              pressure: w.pressure(),
              offer: [],
            };
            for (let i = 0; i < 3; i++) {
              const c = offer[i];
              if (!c) { rec.offer.push(null); continue; }
              rec.offer.push({
                id: c.id, name: c.name, type: c.type, rarity: c.rarity, tier: c.tier,
                isNew: !(heldDeck[c.id] > 0),
                eligible: eligible(c),
                fromSlot: i,
              });
            }
            // slot fallback = offered card's type does not satisfy the slot's lane
            rec.slotFallback = [
              rec.offer[0] ? rec.offer[0].type !== 'boon' : null,
              null, // slot 2 accepts any type
              rec.offer[2] ? !(rec.offer[2].type === 'hex' || rec.offer[2].type === 'gambit') : null,
            ];
            drafts.push(rec);
            const pickIdx = choose(policy, offer, heldDeck, rnd);
            if (pickIdx === null || pickIdx === -1) {
              w.skip();
            } else {
              const picked = w.pick(pickIdx);
              if (!picked) w.skip();
              else chose++;
            }
          }
          const finalDeck = Object.keys(w.state.deck).map((id) => [id, w.state.deck[id]]);
          runs.push({ seed, policy, drafts, finalDeck, chosen: chose });
        }
      }
      return { runs };
    }, { seeds: chunk, policies: POLICIES, cardDefs: cards, hexTotal }, `offers ${chunk[0]}-${chunk[chunk.length - 1]}`);
    rawRuns.push(...payload.runs);
    say(`[lab] offers: sampled runs for seeds ${chunk[0]}-${chunk[chunk.length - 1]}`);
  }

  // Aggregate offers from the canonical 'random' policy path.
  const canonical = rawRuns.filter((r) => r.policy === 'random');
  const agg = {
    runs: canonical.length,
    drafts: 0,
    nullSlots: 0,
    slotFallback: [0, 0, 0],
    slotTypeCounts: [new Map(), new Map(), new Map()],
    rarityBySlot: [new Map(), new Map(), new Map()],
    rareOffers: 0,
    commonOffers: 0,
    offers: 0,
    tier2Offers: 0,
    tier1Offers: 0,
    duplicateDrafts: 0,
    ineligibleOffers: 0,
    deadDrafts: 0,
    noBoonDrafts: 0,
    noNewDrafts: 0,
    upgradeOnlyDrafts: 0,
    cardOffers: new Map(),
    cardOffersByBand: new Map(), // band -> Map(id -> n)
    slotTypeByBand: new Map(),   // band -> [Map, Map, Map] type counts per slot
    rarityByBand: new Map(),     // band -> [ {common,rare}, {..}, {..} ]
    tier2ByCard: new Map(),
    offerCountPerDraft: new Map(),
    laneFallbackExamples: [],
  };
  const bands = [
    [1, 3], [4, 6], [7, 9], [10, 11],
  ];
  const bandOf = (k) => {
    for (const [lo, hi] of bands) if (k >= lo && k <= hi) return `${lo}-${hi === 11 ? 12 : hi}`;
    return 'other';
  };
  for (const run of canonical) {
    for (const d of run.drafts) {
      agg.drafts++;
      let offered = 0;
      let anyBoon = false;
      let anyNew = false;
      let anyUpgrade = false;
      let anyIneligible = false;
      const ids = [];
      let slotEmpty = 0;
      const band = bandOf(d.k);
      if (!agg.slotTypeByBand.has(band)) agg.slotTypeByBand.set(band, [new Map(), new Map(), new Map()]);
      if (!agg.rarityByBand.has(band)) agg.rarityByBand.set(band, [{ common: 0, rare: 0 }, { common: 0, rare: 0 }, { common: 0, rare: 0 }]);
      const bandTypes = agg.slotTypeByBand.get(band);
      const bandRarity = agg.rarityByBand.get(band);
      for (let i = 0; i < 3; i++) {
        const o = d.offer[i];
        if (!o) { slotEmpty++; agg.nullSlots++; continue; }
        offered++;
        ids.push(o.id);
        agg.offers++;
        agg.slotTypeCounts[i].set(o.type, (agg.slotTypeCounts[i].get(o.type) || 0) + 1);
        agg.rarityBySlot[i].set(o.rarity, (agg.rarityBySlot[i].get(o.rarity) || 0) + 1);
        if (o.rarity === 'rare') { agg.rareOffers++; bandRarity[i].rare++; } else { agg.commonOffers++; bandRarity[i].common++; }
        bandTypes[i].set(o.type, (bandTypes[i].get(o.type) || 0) + 1);
        if (o.tier >= 2) { agg.tier2Offers++; agg.tier2ByCard.set(o.id, (agg.tier2ByCard.get(o.id) || 0) + 1); } else agg.tier1Offers++;
        if (o.type === 'boon') anyBoon = true;
        if (o.isNew) anyNew = true;
        else anyUpgrade = true;
        if (!o.eligible) { agg.ineligibleOffers++; anyIneligible = true; }
        agg.cardOffers.set(o.id, (agg.cardOffers.get(o.id) || 0) + 1);
        const band = bandOf(d.k);
        if (!agg.cardOffersByBand.has(band)) agg.cardOffersByBand.set(band, new Map());
        const bm = agg.cardOffersByBand.get(band);
        bm.set(o.id, (bm.get(o.id) || 0) + 1);
      }
      agg.offerCountPerDraft.set(offered, (agg.offerCountPerDraft.get(offered) || 0) + 1);
      if (new Set(ids).size !== ids.length) agg.duplicateDrafts++;
      if (offered === 0 || (anyIneligible && offered === 0)) agg.deadDrafts++;
      if (!anyBoon) agg.noBoonDrafts++;
      if (!anyNew) { agg.noNewDrafts++; if (anyUpgrade) agg.upgradeOnlyDrafts++; }
      for (let i = 0; i < 3; i++) if (d.slotFallback[i]) agg.slotFallback[i]++;
      if (d.slotFallback[0] || d.slotFallback[2]) {
        if (agg.laneFallbackExamples.length < 6) {
          agg.laneFallbackExamples.push({ seed: run.seed, wave: d.k, offer: d.offer.map((o) => (o ? `${o.id}/${o.type}/${o.rarity}` : 'null')) });
        }
      }
    }
  }

  // Policy deck paths for the policies phase.
  const policyDecks = rawRuns.map((r) => ({ seed: r.seed, policy: r.policy, finalDeck: r.finalDeck, drafts: r.drafts.map((d) => ({ k: d.k, picked: null })) }));

  return { agg, rawRuns: canonical, policyDecks, bands, version };
}

// ─── Phase 4: draft policies (deck-at-start proxy) ──────────────────────────
async function phasePolicies(stateRef, offersResult) {
  const { policyDecks } = offersResult;
  const seeds = [...new Set(policyDecks.map((r) => r.seed))].slice(0, opts.policySeeds);
  const byPolicy = new Map();
  for (const p of ['skip', 'random', 'slot1', 'nohex', 'newfirst', 'boonfirst', 'slot3']) byPolicy.set(p, []);

  // deck-at-start: every card the policy would own at Dawn is granted at wave 1
  for (const policy of byPolicy.keys()) {
    const jobs = [];
    for (const seed of seeds) {
      const row = policyDecks.find((r) => r.seed === seed && r.policy === policy);
      const deck = row ? row.finalDeck : [];
      jobs.push({ seed, wpm: 60, mode: 'skip', grant: deck.map(([id, tier]) => ({ id, tier })), maxSec: opts.maxSec });
    }
    const runs = [];
    for (const chunk of chunks(jobs, 50)) {
      runs.push(...(await runSimJobs(stateRef, chunk, `policy ${policy} deck-at-start`)));
    }
    byPolicy.set(policy, { runs, summary: summarize(runs) });
  }

  // Also measure the plain policies with the real sim (skip only; random is the baseline cell).
  const skipSeeds = rangeSeeds(opts.seedBase, Math.min(opts.policySeeds, opts.seeds));
  const skipRuns = [];
  for (const chunk of chunks(skipSeeds, 100)) {
    skipRuns.push(...(await runSimJobs(stateRef, chunk.map((seed) => ({ seed, wpm: 60, mode: 'skip', maxSec: opts.maxSec })), 'policy skip plain')));
  }
  const plainSkip = summarize(skipRuns);

  // Additive estimate from per-card deltas is filled in by buildPolicyAdditive() in Node.
  return { byPolicy, plainSkip, seeds };
}

// ─── Phase 5: CFG-mutation proxies ──────────────────────────────────────────
async function phaseCfg(stateRef) {
  const seeds = rangeSeeds(opts.seedBase, opts.cfgSeeds);
  const shiftedRange = [
    [22, [3, 5]], [34, [3, 6]], [50, [4, 6]], [66, [4, 7]],
    [80, [5, 8]], [98, [6, 9]], [117, [6, 10]], [Infinity, [6, 10]],
  ];
  const variants = [
    { label: 'shipped', cfg: null },
    { label: 'pressurePerDraft 4->3', cfg: { pressurePerDraft: 3 } },
    { label: 'pressurePerDraft 4->5', cfg: { pressurePerDraft: 5 } },
    { label: 'speedPerClear 0.60->0.55', cfg: { speedPerClear: 0.55 } },
    { label: 'speedPerClear 0.60->0.65', cfg: { speedPerClear: 0.65 } },
    { label: 'spawnStart 2.85->3.10 (+9% gaps)', cfg: { spawnStart: 3.10 } },
    { label: 'spawnStart 2.85->3.30 (+16% early gaps)', cfg: { spawnStart: 3.30 } },
    { label: 'spawnMin 1.16->1.30 (+12% late gaps)', cfg: { spawnMin: 1.30 } },
    { label: 'maxWords 6->5', cfg: { maxWords: 5 } },
    { label: 'skipPointsPerWave 50->100', cfg: { skipPointsPerWave: 100 } },
    { label: 'startLives 1->2 (proxy: +1 Life card)', cfg: { startLives: 2 } },
    { label: 'wordRange thresholds +12 (proxy: Rally -12p)', cfg: { wordRangeSteps: shiftedRange } },
  ];
  const results = [];
  for (const v of variants) {
    const cell = { label: v.label, cfg: v.cfg, cells: [] };
    for (const [wpm, mode] of [[40, 'skip'], [60, 'skip'], [60, 'random'], [80, 'random']]) {
      const runs = [];
      const jobs = seeds.map((seed) => ({ seed, wpm, mode, maxSec: opts.maxSec, cfg: v.cfg }));
      for (const chunk of chunks(jobs, 100)) {
        runs.push(...(await runSimJobs(stateRef, chunk, `cfg ${v.label} ${wpm}/${mode}`)));
      }
      const s = summarize(runs);
      s.wpm = wpm;
      s.mode = mode;
      cell.cells.push(s);
    }
    results.push(cell);
    const r60 = cell.cells.find((c) => c.wpm === 60 && c.mode === 'random');
    const s60 = cell.cells.find((c) => c.wpm === 60 && c.mode === 'skip');
    const r80 = cell.cells.find((c) => c.wpm === 80 && c.mode === 'random');
    const s40 = cell.cells.find((c) => c.wpm === 40 && c.mode === 'skip');
    say(`[lab] cfg ${padL(v.label, 34)} 40skip med ${s40.medianWave}  60rnd ${pct(r60.dawnRate)} 60skip med ${s60.medianWave} 80rnd ${pct(r80.dawnRate)}`);
  }
  return results;
}

// ─── printing ───────────────────────────────────────────────────────────────
function printBaseline(cells) {
  console.log('\n=== 1. BASELINE ===');
  console.log('WPM  MODE    RUNS  DAWN%   DEATH%  MED WAVE  MEAN WAVE  MEAN SCORE  MEAN SEC  HISTOGRAM');
  for (const c of cells) {
    console.log(
      `${padL(c.wpm, 4)} ${padL(c.mode, 7)} ${padR(c.n, 4)}  ${padR(pct(c.dawnRate), 6)}  ${padR(pct(c.deathRate), 6)}  ` +
      `${padR(c.medianWave, 8)}  ${padR(c.meanWave.toFixed(2), 9)}  ${padR(c.meanScore.toFixed(0), 10)}  ${padR(c.meanSeconds.toFixed(0), 8)}  ${formatHistogram(c.histogram)}`
    );
  }
}

function printCards(cardsResult) {
  console.log('\n=== 2. PER-CARD POWER (60 WPM; card granted at wave 1; paired vs same-seed baseline) ===');
  console.log('Delta random = the acceptance-cell metric (adding this card to a normal random-draft run).');
  console.log('Delta skip   = isolated single-card survival (same pressure path as the no-card run).');
  console.log('CARD          TYPE    RAR    TIER  rndDAWN  rndΔdawn(±SE)   rndΔwave  rndΔscore      skipMED  skipΔwave(±SE)   skipDAWN');
  const sorted = [...cardsResult.cells].sort(
    (a, b) => (b.random.delta.dawnDiff - a.random.delta.dawnDiff) || (b.skip.delta.waveDiff - a.skip.delta.waveDiff)
  );
  for (const c of sorted) {
    console.log(
      `${padL(c.id, 13)} ${padL(c.type, 7)} ${padL(c.rarity, 6)} ${padR(c.tier, 4)}  ` +
      `${padR(pct(c.random.dawnRate), 7)}  ${padR(`${pctDelta(c.random.delta.dawnDiff)}±${(c.random.delta.dawnDiffSE * 100).toFixed(1)}`, 15)}  ` +
      `${padR(signed(c.random.delta.waveDiff), 9)}  ${padR(signed(c.random.delta.scoreDiff, 0), 12)}  ` +
      `${padR(c.skip.medianWave, 7)}  ${padR(`${signed(c.skip.delta.waveDiff)}±${c.skip.delta.waveDiffSE.toFixed(2)}`, 14)}  ${padR(pct(c.skip.dawnRate), 8)}`
    );
  }
}

function printOffers(offersResult) {
  const a = offersResult.agg;
  console.log('\n=== 3. OFFER DISTRIBUTION ===');
  console.log(`runs ${a.runs}, drafts ${a.drafts}, offers ${a.offers} (${(a.offers / a.drafts).toFixed(2)} per draft), empty slots ${a.nullSlots}`);
  console.log(`offers per draft: ${[...a.offerCountPerDraft.entries()].map(([k, v]) => `${k}:${v}`).join('  ')}`);
  console.log('\nSLOT LANE MIX (type actually offered) and LANE FALLBACKS');
  for (let i = 0; i < 3; i++) {
    const types = [...a.slotTypeCounts[i].entries()].map(([t, n]) => `${t}:${n}`).join('  ');
    console.log(`  slot ${i + 1}: ${types}   lane-fallback ${a.slotFallback[i]}/${a.drafts} (${pct(a.slotFallback[i] / a.drafts)})`);
  }
  console.log('\nRARITY BY SLOT (rare expected 25%/slot)');
  for (let i = 0; i < 3; i++) {
    const common = a.rarityBySlot[i].get('common') || 0;
    const rare = a.rarityBySlot[i].get('rare') || 0;
    console.log(`  slot ${i + 1}: common ${common}, rare ${rare} -> rare ${pct(rare / Math.max(1, rare + common))}`);
  }
  console.log(`\noverall offers: rare ${pct(a.rareOffers / a.offers)}  tier-II ${pct(a.tier2Offers / a.offers)}  ineligible-offered ${a.ineligibleOffers}`);
  console.log(`drafts: duplicate-id ${a.duplicateDrafts}  no-boon ${a.noBoonDrafts} (${pct(a.noBoonDrafts / a.drafts)})  no-new-card ${a.noNewDrafts} (${pct(a.noNewDrafts / a.drafts)})  upgrade-only ${a.upgradeOnlyDrafts}  all-null ${a.deadDrafts}`);
  console.log('\nOFFERED CARD IDS (per policy=random path)');
  const total = [...a.cardOffers.values()].reduce((x, y) => x + y, 0);
  const cardById = Object.fromEntries(offersResult.cardsMeta.map((c) => [c.id, c]));
  for (const [id, n] of [...a.cardOffers.entries()].sort((x, y) => y[1] - x[1])) {
    const meta = cardById[id] || { type: '?', rarity: '?' };
    console.log(`  ${padL(id, 13)} ${padL(meta.type, 7)} ${padL(meta.rarity, 6)} offers ${padR(n, 5)} (${pct(n / total)})  tierII ${a.tier2ByCard.get(id) || 0}`);
  }
  console.log('\nOFFERED CARD IDS BY WAVE BAND (band: id=count)');
  for (const [band, m] of a.cardOffersByBand) {
    console.log(`  waves ${band}: ` + [...m.entries()].sort((x, y) => y[1] - x[1]).map(([id, n]) => `${id}=${n}`).join(' '));
  }
  console.log('\nSLOT TYPE MIX BY WAVE BAND (band: slot1 | slot2 | slot3)');
  for (const [band, maps] of a.slotTypeByBand) {
    const fmt = (m) => [...m.entries()].sort((x, y) => y[1] - x[1]).map(([t, n]) => `${t}:${n}`).join(',');
    console.log(`  waves ${band}: ${fmt(maps[0])} | ${fmt(maps[1])} | ${fmt(maps[2])}`);
  }
  console.log('\nRARE RATE BY SLOT BY WAVE BAND');
  for (const [band, arr] of a.rarityByBand) {
    const f = (r) => {
      const n = r.common + r.rare;
      return n ? pct(r.rare / n) : 'n/a';
    };
    console.log(`  waves ${band}: slot1 ${f(arr[0])}  slot2 ${f(arr[1])}  slot3 ${f(arr[2])}`);
  }
  if (a.laneFallbackExamples.length) {
    console.log('\nLANE FALLBACK EXAMPLES');
    for (const e of a.laneFallbackExamples) console.log(`  seed ${e.seed} wave ${e.wave}: ${e.offer.join(' | ')}`);
  }
}

function printPolicies(policiesResult, baselineCells, offersResult) {
  console.log('\n=== 4. DRAFT POLICIES (deck accumulated by Dawn, granted at wave 1, 60 WPM, same seeds) ===');
  console.log('Absolute rates are inflated by early granting; compare policies against each other.');
  console.log('POLICY      RUNS  DAWN%   DEATH%  MED WAVE  MEAN WAVE  MEAN SCORE  MEAN CLEARED');
  const order = ['skip', 'random', 'slot1', 'nohex', 'newfirst', 'boonfirst', 'slot3'];
  const rows = [];
  for (const p of order) {
    const entry = policiesResult.byPolicy.get(p);
    if (!entry) continue;
    const s = entry.summary;
    rows.push({ policy: p, ...s });
    console.log(`${padL(p, 11)} ${padR(s.n, 4)}  ${padR(pct(s.dawnRate), 6)}  ${padR(pct(s.deathRate), 6)}  ${padR(s.medianWave, 8)}  ${padR(s.meanWave.toFixed(2), 9)}  ${padR(s.meanScore.toFixed(0), 10)}  ${padR(s.meanCleared.toFixed(1), 12)}`);
  }
  const plain = policiesResult.plainSkip;
  console.log(`${padL('skip(sim)', 11)} ${padR(plain.n, 4)}  ${padR(pct(plain.dawnRate), 6)}  ${padR(pct(plain.deathRate), 6)}  ${padR(plain.medianWave, 8)}  ${padR(plain.meanWave.toFixed(2), 9)}  ${padR(plain.meanScore.toFixed(0), 10)}  ${padR(plain.meanCleared.toFixed(1), 12)}`);
  // Expected deck size per policy (from the offer sample).
  console.log('\nmean decks at Dawn (from the offer sampler, 11 drafts):');
  for (const p of order) {
    const rows = offersResult.policyDecks.filter((r) => r.policy === p);
    const sizes = rows.map((r) => r.finalDeck.length);
    const tiers = rows.map((r) => r.finalDeck.reduce((x, [, t]) => x + t, 0));
    console.log(`  ${padL(p, 11)} cards ${mean(sizes).toFixed(2)}  total tiers ${mean(tiers).toFixed(2)}`);
  }
  return rows;
}

function printCfg(cfgResults) {
  console.log('\n=== 5. CFG PROXIES (seeds, 60/80 WPM acceptance-shaped cells) ===');
  console.log('VARIANT                             40skip med  60skip med  60skip death  60rnd dawn  80rnd dawn  60rnd score');
  const shipped = cfgResults.find((v) => v.label === 'shipped');
  for (const v of cfgResults) {
    const s40 = v.cells.find((c) => c.wpm === 40 && c.mode === 'skip');
    const s60 = v.cells.find((c) => c.wpm === 60 && c.mode === 'skip');
    const r60 = v.cells.find((c) => c.wpm === 60 && c.mode === 'random');
    const r80 = v.cells.find((c) => c.wpm === 80 && c.mode === 'random');
    console.log(
      `${padL(v.label, 36)} ${padR(s40.medianWave, 10)}  ${padR(s60.medianWave, 10)}  ${padR(pct(s60.deathRate), 12)}  ${padR(pct(r60.dawnRate), 10)}  ${padR(pct(r80.dawnRate), 10)}  ${padR(r60.meanScore.toFixed(0), 11)}`
    );
  }
  console.log('\n(shipped row is the same build as the baseline phase when seeds overlap)');
}

// ─── main ───────────────────────────────────────────────────────────────────
let payload = null;
let exitCode = 0;
const stateRef = { state: null };

try {
  say('[lab] launching headless Chrome (channel=chrome)...');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  stateRef.state = await boot();

  const out = { build: stateRef.state.build, version: stateRef.state.meta.version, buildLog: [] };
  let baselineCells = null;
  const markBuild = (phase) => out.buildLog.push({ phase, short: stateRef.state.build.short, version: stateRef.state.meta.version, mtime: stateRef.state.build.mtime });

  if (phases.includes('baseline') || phases.includes('cards') || phases.includes('policies')) {
    // baseline is needed by cards/policies as a comparison; always run it first if cards run.
    if (phases.includes('baseline') || phases.includes('cards')) {
      markBuild('baseline');
      baselineCells = await phaseBaseline(stateRef);
      out.baseline = baselineCells.map((c) => ({ wpm: c.wpm, mode: c.mode, n: c.n, dawnRate: c.dawnRate, deathRate: c.deathRate, medianWave: c.medianWave, meanWave: c.meanWave, meanScore: c.meanScore, meanSeconds: c.meanSeconds, histogram: c.histogram }));
      if (!opts.json) printBaseline(baselineCells);
    }
  }

  if (phases.includes('cards')) {
    markBuild('cards');
    const cardsResult = await phaseCards(stateRef, baselineCells);
    out.cards = cardsResult;
    if (!opts.json) printCards(cardsResult);
  }

  let offersResult = null;
  if (phases.includes('offers') || phases.includes('policies')) {
    markBuild('offers');
    offersResult = await phaseOffers(stateRef);
    offersResult.cardsMeta = stateRef.state.meta.cards;
    out.offers = {
      runs: offersResult.agg.runs,
      drafts: offersResult.agg.drafts,
      offers: offersResult.agg.offers,
      nullSlots: offersResult.agg.nullSlots,
      slotFallback: offersResult.agg.slotFallback,
      slotTypeCounts: offersResult.agg.slotTypeCounts.map((m) => Object.fromEntries(m)),
      rarityBySlot: offersResult.agg.rarityBySlot.map((m) => Object.fromEntries(m)),
      rareOffers: offersResult.agg.rareOffers,
      commonOffers: offersResult.agg.commonOffers,
      tier2Offers: offersResult.agg.tier2Offers,
      tier1Offers: offersResult.agg.tier1Offers,
      duplicateDrafts: offersResult.agg.duplicateDrafts,
      ineligibleOffers: offersResult.agg.ineligibleOffers,
      deadDrafts: offersResult.agg.deadDrafts,
      noBoonDrafts: offersResult.agg.noBoonDrafts,
      noNewDrafts: offersResult.agg.noNewDrafts,
      upgradeOnlyDrafts: offersResult.agg.upgradeOnlyDrafts,
      offerCountPerDraft: Object.fromEntries(offersResult.agg.offerCountPerDraft),
      cardOffers: Object.fromEntries(offersResult.agg.cardOffers),
      cardOffersByBand: Object.fromEntries([...offersResult.agg.cardOffersByBand].map(([b, m]) => [b, Object.fromEntries(m)])),
      slotTypeByBand: Object.fromEntries([...offersResult.agg.slotTypeByBand].map(([b, maps]) => [b, maps.map((m) => Object.fromEntries(m))])),
      rarityByBand: Object.fromEntries([...offersResult.agg.rarityByBand].map(([b, arr]) => [b, arr])),
      tier2ByCard: Object.fromEntries(offersResult.agg.tier2ByCard),
      laneFallbackExamples: offersResult.agg.laneFallbackExamples,
      policyDecks: offersResult.policyDecks.map((r) => ({ seed: r.seed, policy: r.policy, finalDeck: r.finalDeck })),
    };
    if (!opts.json) printOffers(offersResult);
  }

  if (phases.includes('policies')) {
    const policiesResult = await phasePolicies(stateRef, offersResult);
    out.policies = {};
    for (const [p, v] of policiesResult.byPolicy) out.policies[p] = v.summary;
    out.policies.plainSkip = policiesResult.plainSkip;
    if (!opts.json) printPolicies(policiesResult, baselineCells, offersResult);
  }

  if (phases.includes('cfg')) {
    markBuild('cfg');
    const cfgResult = await phaseCfg(stateRef);
    out.cfg = cfgResult.map((v) => ({
      label: v.label,
      cfg: v.cfg,
      cells: v.cells.map((c) => ({ wpm: c.wpm, mode: c.mode, dawnRate: c.dawnRate, deathRate: c.deathRate, medianWave: c.medianWave, meanWave: c.meanWave, meanScore: c.meanScore })),
    }));
    if (!opts.json) printCfg(cfgResult);
  }

  out.elapsedSec = Number(((Date.now() - startedAt) / 1000).toFixed(1));
  payload = out;
  if (!opts.json) console.log(`\n[lab] done in ${out.elapsedSec}s on game.js ${out.build.short} (${out.build.bytes} bytes, ${out.build.mtime})`);
  else console.log(JSON.stringify(out, null, 2));
} catch (err) {
  console.error(`\n[lab] FAILED: ${firstLine(err)}`);
  exitCode = 1;
  if (opts.json) console.log(JSON.stringify({ pass: false, error: firstLine(err) }, null, 2));
} finally {
  if (browser) await browser.close().catch(() => {});
}

process.exitCode = exitCode;
