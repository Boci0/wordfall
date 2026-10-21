/* Wordfall - Read. Commit. Survive.
 *
 * Rule that defines the game: you may only type the word that is currently
 * closest to the ground. Every other word is inert until it becomes a target.
 *
 * M1 core loop, M2 draft + pressure, M3 full card set, M4 feel, M5 tuning hooks,
 * M6 pause, lifetime records, run stats + seeds, and the Split card.
 * Design notes and milestones live in SPEC.md.
 */
(() => {
  'use strict';

  // ─── Config ───────────────────────────────────────────────────────────────
  const CFG = {
    // survival
    startLives: 1,
    maxLives: 3,
    maxShields: 3,

    // layout
    pad: 32,                  // horizontal screen margin for words
    groundPad: 96,            // height of the abstract signal strip at the bottom
    charH: 30,                // vertical footprint of one word

    // difficulty ramp - every one of these reads `pressure`, not raw clears.
    // The ramp is deliberately spread across the whole run: the old curve hit the
    // spawn floor and the first 4+ letter band on the same wave (wave 4), then
    // stacked two more length jumps and the speed cap by wave 6.
    baseSpeed: 54,            // px/s at a 900px-tall viewport
    speedPerClear: 0.60,
    maxSpeed: 100,
    spawnStart: 2.85,         // seconds between spawns at run start
    spawnMin: 1.16,
    spawnDecay: 0.031,
    maxWords: 6,              // smaller queue, because words cross twice as fast

    // word-length ramp: [pressureThreshold, [shortest, longest]] from the top down.
    // Each step moves at most one bound, roughly one notch every 1-2 waves.
    wordRangeSteps: [
      [10, [3, 5]],
      [22, [3, 6]],
      [38, [4, 6]],
      [54, [4, 7]],
      [68, [5, 8]],
      [86, [6, 9]],
      [105, [6, 10]],
      [Infinity, [6, 10]],
    ],

    // scoring
    basePointsPerChar: 10,
    comboStep: 0.05,
    comboCap: 20,
    heatStep: 0.25,

    // run structure
    waveSize: 10,
    wavesPerRun: 12,
    pressurePerDraft: 4,
    rerollsPerRun: 1,
    skipPointsPerWave: 150,
    draftRise: 0.34,
    draftPause: 4,            // used only by the headless bot's duration estimate

    // feel
    mistakeFlash: 0.22,
    hitPause: 0.055,
    echoLife: 3,
    shakeHit: 0.4,
    shakeNearMiss: 0.16,

    // M7 effect budget. Every pool is capped, so a long combo or a crowded
    // board can never turn the effect layer into a frame-rate cliff.
    // 'light' FX scales the counts down but keeps every impact beat.
    fxMaxParticles: 520,
    fxMaxShards: 140,
    fxMaxRings: 18,
    fxMaxPopups: 22,
    // Fakes "fall through" rather than settling in the queue: they drop faster
    // so a Decoy blocks the target for seconds, not for a whole fall.
    fakeSpeedMult: 4.5,
  };

  // Relay 12: one story beat after each cleared wave. These are flavor only  - 
  // no rule reads them. The endless line replaces the table after wave 12.
  const RELAY_LOG = [
    'The channel opens. Something on the other end is typing back.',
    'The words are arriving out of order.',
    'The signal is learning the shape of your hands.',
    'Relay 12 is running hot.',
    'The city has gone quiet.',
    'You are not the only one listening.',
    'The message is almost complete.',
    'Do not read it aloud.',
    'The horizon is flickering.',
    'Dawn is a window, not a rescue.',
    'Hold the line.',
  ];
  const ENDLESS_LOG = 'The channel is still open.';

  // 16-colour-era palette: no gradients, no glow, no alpha except fades.
  const COL = {
    skyDark: '#000020',
    skyLight: '#000060',
    star: '#c0c0c0',
    building0: '#383838',
    building1: '#484848',
    buildingTop: '#707070',
    buildingEdge: '#101010',
    windowWarm: '#c0c000',
    windowCool: '#00a0a0',
    danger: '#ff0000',
    wordIdle: '#808080',
    wordSet: '#c0c0c0',
    target: '#ffff00',
    typed: '#00a000',
    fake: '#c000c0',
    splitWord: '#00a0a0',
    hidden: '#606060',
    echo: 'rgba(128, 128, 128, 0.30)',
    accent: '#ffff00',
    white: '#ffffff',
    gold: '#ffff00',
    amber: '#c0c000',
    scan: '#00a0a0',
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  // ─── Word pool ────────────────────────────────────────────────────────────
  // words.js ships a 400+ word pool; this small built-in list keeps the game
  // playable on its own if that file is missing.
  const DEFAULT_WORDS = [
    // 3
    'cat', 'dog', 'sun', 'ice', 'oak', 'map', 'ink', 'fog', 'gem', 'arc',
    'orb', 'ash', 'bay', 'dew', 'elm', 'fin', 'hub', 'jot', 'keg', 'lid',
    // 4
    'leaf', 'wind', 'rain', 'dusk', 'moss', 'coin', 'rope', 'tide', 'void',
    'glow', 'hare', 'kite', 'loom', 'nail', 'dawn', 'echo', 'fern', 'gale',
    'haze', 'iris', 'jade', 'kelp', 'lark', 'mint', 'nova', 'opal', 'peak',
    // 5
    'ember', 'river', 'spark', 'stone', 'drift', 'frost', 'glass', 'hound',
    'ivory', 'north', 'ocean', 'pilot', 'quart', 'ridge', 'sable', 'thorn',
    'umbra', 'vapor', 'whale', 'yield', 'zesty', 'amber', 'brisk', 'cedar',
    // 6
    'candle', 'hollow', 'marble', 'pebble', 'shadow', 'silver', 'tunnel',
    'velvet', 'wander', 'winter', 'cobalt', 'dragon', 'fabric', 'garnet',
    'helium', 'indigo', 'jasper', 'kernel', 'lichen', 'meteor', 'nectar',
    // 7
    'lantern', 'crimson', 'drizzle', 'eclipse', 'gravity', 'harvest',
    'journey', 'kingdom', 'mystery', 'orbital', 'phantom', 'quantum',
    'radiant', 'shelter', 'tempest', 'updraft', 'vintage', 'whisper',
    // 8
    'asteroid', 'blizzard', 'catalyst', 'daybreak', 'elevator', 'firewall',
    'gasoline', 'humidity', 'infernal', 'junction', 'keystone', 'luminous',
    'magnetic', 'navigate', 'obsidian', 'particle', 'quicksand',
    // 9
    'adventure', 'blossoming', 'challenge', 'dangerous', 'elevation',
    'fractured', 'gathering', 'hollowing', 'intricate', 'labyrinth',
    'nightfall', 'overgrown', 'parchment', 'shattered', 'shipwreck',
    // 10-11
    'blacksmith', 'candlelight', 'constellate', 'dangerously',
    'lighthouse', 'thunderbolt', 'wilderness', 'sandcastle',
  ];

  const WORD_BUCKETS = new Map();   // length -> [word]
  (function buildWordPool() {
    const external = Array.isArray(window.WORDFALL_WORDS) ? window.WORDFALL_WORDS : [];
    const source = external.length >= 50 ? external : DEFAULT_WORDS;
    const seen = new Set();
    for (const raw of source) {
      const w = String(raw || '').toLowerCase();
      if (!/^[a-z]{3,11}$/.test(w) || seen.has(w)) continue;
      seen.add(w);
      if (!WORD_BUCKETS.has(w.length)) WORD_BUCKETS.set(w.length, []);
      WORD_BUCKETS.get(w.length).push(w);
    }
    if (!seen.size) {
      for (const w of DEFAULT_WORDS) {
        if (!WORD_BUCKETS.has(w.length)) WORD_BUCKETS.set(w.length, []);
        WORD_BUCKETS.get(w.length).push(w);
      }
    }
  })();

  function wordsByLength(lo, hi) {
    const out = [];
    for (let len = lo; len <= hi; len++) {
      const bucket = WORD_BUCKETS.get(len);
      if (bucket) out.push(...bucket);
    }
    return out;
  }

  // ─── Canvas ───────────────────────────────────────────────────────────────
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  let W = 0;
  let H = 0;
  let charW = 0;
  let stars = [];
  let signalField = [];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewW = canvas.clientWidth || window.innerWidth;
    const viewH = canvas.clientHeight || window.innerHeight;
    // The rules live in a fixed 800-unit-tall logical playfield, uniformly scaled
    // to the window. Otherwise a shorter/longer client area would change fall
    // times and difficulty (the old full-page canvas happened to be 800 tall).
    const scale = Math.max(0.5, viewH / 800);
    W = viewW / scale;
    H = 800;
    canvas.width = Math.round(viewW * dpr);
    canvas.height = Math.round(viewH * dpr);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);

    ctx.font = WORD_FONT;
    ctx.textBaseline = 'top';
    charW = ctx.measureText('M').width || 16;

    state.groundY = H - CFG.groundPad;
    stars = makeStars();
    signalField = makeSignalField();
  }

  function makeStars() {
    const rnd = mulberry32(1337);
    const out = [];
    const n = Math.round((W * H) / 14000);
    for (let i = 0; i < n; i++) {
      out.push({
        x: rnd() * W,
        y: rnd() * (H - CFG.groundPad),
        r: rnd() < 0.85 ? 1 : 1.6,
        a: 0.12 + rnd() * 0.5,
        tw: rnd() * Math.PI * 2,
      });
    }
    return out;
  }

  // The floor strip is an abstract signal field: irregular bars and clusters,
  // no buildings, windows or mast. It reads as a spectrum frozen at the horizon
  // and leaves the playfield free of literal scenery.
  function makeSignalField() {
    const rnd = mulberry32(4242);
    const out = [];
    let x = -8;
    while (x < W + 8) {
      const cluster = rnd() < 0.16;
      const w = cluster ? 7 + rnd() * 16 : 1 + rnd() * 4;
      const h = 10 + rnd() * (CFG.groundPad - 18);
      out.push({
        x,
        w,
        h,
        tone: rnd() < 0.5 ? 0 : 1,
        cap: rnd() < 0.18 ? (rnd() < 0.6 ? COL.windowWarm : COL.windowCool) : COL.buildingTop,
      });
      x += w + 2 + rnd() * 7;
    }
    return out;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Seeded RNG for gameplay randomness (spawns, drafts, decoys, particles).
  let rngState = 0x9e3779b9;
  function rng() {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function setSeed(n) {
    // splitmix32-style hash: nearby seeds must produce uncorrelated streams,
    // otherwise headless bot sweeps are biased by whichever seed block they use.
    let z = ((Number(n) >>> 0) + 0x9e3779b9) | 0;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    z = (z ^ (z >>> 15)) >>> 0;
    rngState = z || 1;
  }
  setSeed((Date.now() ^ 0x5f356495) >>> 0);

  // ─── State ────────────────────────────────────────────────────────────────
  let nextId = 1;

  const state = {
    phase: 'menu',            // menu | playing | paused | draft | dawn | gameover
    words: [],
    echoes: [],
    particles: [],
    shards: [],               // M7: cleared-letter glyphs that fly apart
    rings: [],                // M7: expanding shockwave rings
    popups: [],               // M7: floating score / combo / callout text
    score: 0,
    combo: 0,
    bestCombo: 0,
    cleared: 0,
    wave: 1,
    waveCleared: 0,
    lives: CFG.startLives,
    shields: 0,
    shieldMax: 0,
    deck: {},                 // cardId -> tier held
    draftsTaken: 0,
    rerollsLeft: CFG.rerollsPerRun,
    offer: null,              // [card|null, card|null, card|null] while drafting
    draftAnim: 0,
    lockWord: null,
    autoClears: 0,
    spawnT: 0,
    speed: CFG.baseSpeed,
    flash: 0,
    blockFlash: 0,
    shake: 0,
    hitPause: 0,
    waveBanner: 0,
    dangerT: 0,
    dangerLevel: 0,           // 0..1, drives the canvas edge glow and CSS vars
    clearFlash: 0,            // gold flash on a clear
    milestoneT: 0,            // combo milestone banner timer (also a body class)
    punch: 0,                 // short zoom-punch on a clear
    waveClearT: 0,            // wave-complete celebration before the draft opens
    waveClearWave: 0,
    runStartBest: 0,          // records.bestScore when the run started
    lastClear: null,
    t: 0,
    groundY: 0,
    best: 0,
    lastTime: 0,
    dawn: false,
    endless: false,
    simulating: false,
    muted: false,
    // M6: run identity + per-run stat counters
    seed: 0,
    keys: 0,                  // correct letters typed this run
    mistakes: 0,              // wrong keys this run (shield-eaten included)
    runSec: 0,                // seconds spent in the 'playing' phase
    spawnCount: 0,            // successful spawns (drives the Split card)
    lifelineUsed: false,      // Lifeline saves exactly one life per run
    runRecorded: false,
  };

  Object.defineProperties(state, {
    pressure: { get: () => pressure(), enumerable: true },
    heat: { get: () => heat(), enumerable: true },
    heatMult: { get: () => heatMult(), enumerable: true },
  });

  // ─── Persistence: best score, lifetime records, settings ─────────────────
  const RECORD_DEFAULTS = {
    runs: 0,
    dawns: 0,
    bestScore: 0,
    bestWave: 0,
    bestCombo: 0,
    words: 0,
    fastestDawnSec: 0,
  };
  const records = Object.assign({}, RECORD_DEFAULTS);
  const settings = { muted: false, fx: 'full' };

  // Respect the OS "reduce motion" preference on first launch; the player can
  // always switch back with View → Effects.
  let storedSettings = null;
  try { storedSettings = JSON.parse(localStorage.getItem('wordfall.settings') || 'null'); } catch (e) { /* ignore */ }
  if (!storedSettings && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    settings.fx = 'light';
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem('wordfall.records');
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const key of Object.keys(RECORD_DEFAULTS)) {
          const v = Number(parsed && parsed[key]);
          if (Number.isFinite(v) && v > 0) records[key] = v;
        }
      }
      // Migrate the pre-M6 single best-score key.
      const legacyBest = Number(localStorage.getItem('wordfall.best') || 0) || 0;
      if (legacyBest > records.bestScore) records.bestScore = legacyBest;
      const rawSettings = localStorage.getItem('wordfall.settings');
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings);
        if (parsed && typeof parsed.muted === 'boolean') settings.muted = parsed.muted;
        if (parsed && (parsed.fx === 'full' || parsed.fx === 'light')) settings.fx = parsed.fx;
      }
    } catch (e) { /* file:// or privacy mode */ }
    state.best = records.bestScore;
    state.muted = settings.muted;
  }
  loadStore();

  function saveStore() {
    try {
      localStorage.setItem('wordfall.records', JSON.stringify(records));
      localStorage.setItem('wordfall.best', String(records.bestScore));
      localStorage.setItem('wordfall.settings', JSON.stringify({ muted: !!settings.muted, fx: settings.fx }));
    } catch (e) { /* ignore */ }
  }

  // Called exactly once per finished run (game over or Dawn).
  function recordRun(won) {
    if (state.runRecorded) return;
    state.runRecorded = true;
    // Headless sim sweeps are tuning runs, not the player's record book.
    if (state.simulating) return;
    records.runs += 1;
    if (won) {
      records.dawns += 1;
      const sec = Math.max(1, Math.round(state.runSec));
      if (!records.fastestDawnSec || sec < records.fastestDawnSec) records.fastestDawnSec = sec;
    }
    records.bestScore = Math.max(records.bestScore, state.score);
    records.bestWave = Math.max(records.bestWave, state.wave);
    records.bestCombo = Math.max(records.bestCombo, state.bestCombo);
    records.words += state.cleared;
    state.best = records.bestScore;
    saveStore();
  }

  // ─── Run statistics ──────────────────────────────────────────────────────
  function wpmNow() {
    if (state.runSec <= 0) return 0;
    return Math.round((state.keys / 5) / (state.runSec / 60));
  }
  function accuracyNow() {
    const total = state.keys + state.mistakes;
    return total ? Math.round((state.keys / total) * 100) : 100;
  }
  function fmtTime(sec) {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function fmtInt(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function reset(seed) {
    const chosen = seed == null ? ((Date.now() ^ 0x5f356495) >>> 0) : (Number(seed) >>> 0);
    state.seed = chosen;
    setSeed(chosen);
    state.phase = 'playing';
    state.words.length = 0;
    state.echoes.length = 0;
    state.particles.length = 0;
    state.shards.length = 0;
    state.rings.length = 0;
    state.popups.length = 0;
    state.score = 0;
    state.combo = 0;
    state.bestCombo = 0;
    state.cleared = 0;
    state.wave = 1;
    state.waveCleared = 0;
    state.lives = CFG.startLives;
    state.shields = 0;
    state.shieldMax = 0;
    state.deck = {};
    state.draftsTaken = 0;
    state.rerollsLeft = CFG.rerollsPerRun;
    state.offer = null;
    state.draftAnim = 0;
    state.lockWord = null;
    state.autoClears = 0;
    state.spawnT = 0.45;
    state.speed = CFG.baseSpeed;
    state.flash = 0;
    state.blockFlash = 0;
    state.shake = 0;
    state.hitPause = 0;
    state.waveBanner = 0;
    state.dangerT = 0;
    state.dangerLevel = 0;
    state.clearFlash = 0;
    state.milestoneT = 0;
    state.punch = 0;
    state.waveClearT = 0;
    state.waveClearWave = 0;
    state.runStartBest = records.bestScore || 0;
    state.lastClear = null;
    state.t = 0;
    state.dawn = false;
    state.endless = false;
    state.keys = 0;
    state.mistakes = 0;
    state.runSec = 0;
    state.spawnCount = 0;
    state.lifelineUsed = false;
    state.runRecorded = false;
    nextId = 1;
  }

  // ─── Cards ────────────────────────────────────────────────────────────────
  // Every card bends exactly one thing: the rule, the reading, or the economy.
  const CARD_LIST = [
    {
      id: 'wide-scope', name: 'Wide Scope', type: 'boon', rarity: 'rare', maxTier: 2,
      blurb: (tier) => (tier >= 2
        ? 'The target set includes the 2nd and 3rd lowest words.'
        : 'The target set includes the 2nd lowest word.'),
    },
    {
      id: 'overclock', name: 'Overclock', type: 'boon', rarity: 'rare', maxTier: 2,
      blurb: (tier) => (tier >= 2
        ? 'Every 4th clear auto-clears the next target. Auto-clears score but do not combo.'
        : 'Every 5th clear auto-clears the next target. Auto-clears score but do not combo.'),
    },
    {
      id: 'grace', name: 'Grace', type: 'boon', rarity: 'common', maxTier: 1,
      blurb: () => '+1 Life. A word reaching the line costs one.',
    },
    {
      id: 'steady-hand', name: 'Steady Hand', type: 'boon', rarity: 'common', maxTier: 2,
      blurb: (tier) => (tier >= 2
        ? '+2 Shields. A Shield eats one wrong key, keeps the combo, and refills each wave.'
        : '+1 Shield. A Shield eats one wrong key, keeps the combo, and refills each wave.'),
    },
    {
      id: 'slow-drift', name: 'Slow Drift', type: 'boon', rarity: 'common', maxTier: 2,
      blurb: (tier) => (tier >= 2 ? 'Fall speed x0.75.' : 'Fall speed x0.85.'),
    },
    {
      id: 'greed', name: 'Greed', type: 'gambit', rarity: 'common', maxTier: 2,
      blurb: (tier) => (tier >= 2 ? 'Score x1.7. Fall speed x1.06.' : 'Score x1.4. Fall speed x1.03.'),
    },
    {
      id: 'longshot', name: 'Longshot', type: 'gambit', rarity: 'rare', maxTier: 1,
      blurb: () => '7+ letter words score x2 and fall 5% faster.',
    },
    {
      id: 'ledger', name: 'Ledger', type: 'gambit', rarity: 'common', maxTier: 1,
      blurb: () => '+2 points per letter.',
    },
    {
      id: 'reverse', name: 'Reverse', type: 'hex', rarity: 'common', maxTier: 1,
      blurb: () => 'Type the target word right to left.',
    },
    {
      id: 'tunnel', name: 'Tunnel', type: 'hex', rarity: 'common', maxTier: 2,
      blurb: (tier) => (tier >= 2
        ? 'Only the next 2 letters of the target are visible.'
        : 'Only the next 3 letters of the target are visible.'),
    },
    {
      id: 'ghost', name: 'Ghost', type: 'hex', rarity: 'common', maxTier: 1,
      blurb: () => 'Each cleared word leaves an inert echo in place for 3 seconds.',
    },
    {
      id: 'decoy', name: 'Decoy', type: 'hex', rarity: 'rare', maxTier: 2,
      blurb: (tier) => (tier >= 2
        ? '1 in 5 spawns is a misspelled fake. While it is the lowest word, every key is a mistake.'
        : '1 in 8 spawns is a misspelled fake. While it is the lowest word, every key is a mistake.'),
    },
    {
      // Promoted from the SPEC backlog after M5: the extra word breaks the
      // spawn queue (it ignores `maxWords`), which is the cost of the Hex.
      id: 'split', name: 'Split', type: 'hex', rarity: 'common', maxTier: 2,
      blurb: (tier) => (tier >= 2
        ? 'Every 3rd spawn also drops a free word. It scores, but blocks the words above it.'
        : 'Every 5th spawn also drops a free word. It scores, but blocks the words above it.'),
    },
    // ── M7 additions: one survival option and one economy option for the Hex
    // /Gambit lane (which measured as the weakest lane), plus a late-boon ramp
    // and two rare cards that widen slot 3's thin rare pool.
    {
      id: 'lifeline', name: 'Lifeline', type: 'boon', rarity: 'rare', maxTier: 1,
      blurb: () => 'The first word to reach the line is destroyed instead of costing a Life.',
    },
    {
      id: 'rally', name: 'Rally', type: 'boon', rarity: 'common', maxTier: 2,
      blurb: (tier) => (tier >= 2
        ? 'Word length reads 18 less Pressure.'
        : 'Word length reads 10 less Pressure.'),
    },
    {
      id: 'drought', name: 'Drought', type: 'gambit', rarity: 'common', maxTier: 2,
      blurb: (tier) => (tier >= 2
        ? 'Spawns 20% slower. Score x0.85.'
        : 'Spawns 15% slower. Score x0.9.'),
    },
    {
      id: 'bargain', name: 'Bargain', type: 'gambit', rarity: 'rare', maxTier: 1,
      blurb: () => 'Score x2. Skip pays no points.',
    },
    {
      id: 'second-draft', name: 'Second Draft', type: 'hex', rarity: 'rare', maxTier: 1,
      blurb: () => '+1 reroll for the run.',
    },
  ];
  const CARD_BY_ID = Object.fromEntries(CARD_LIST.map((c) => [c.id, c]));
  const HEX_TOTAL = CARD_LIST.filter((c) => c.type === 'hex').length;

  function heldTier(id) {
    return state.deck[id] || 0;
  }
  function has(id) {
    return heldTier(id) > 0;
  }

  function pressure() {
    return state.cleared + CFG.pressurePerDraft * state.draftsTaken;
  }
  function heat() {
    let h = 0;
    for (const id of Object.keys(state.deck)) {
      const card = CARD_BY_ID[id];
      if (card && card.type === 'hex') h += state.deck[id];   // tier II counts twice
    }
    return h;
  }
  function heatMult() {
    return 1 + CFG.heatStep * heat();
  }
  function comboMultiplier() {
    return 1 + Math.min(state.combo, CFG.comboCap) * CFG.comboStep;
  }
  function speedMult() {
    let m = 1;
    if (has('slow-drift')) m *= heldTier('slow-drift') >= 2 ? 0.75 : 0.85;
    if (has('greed')) m *= heldTier('greed') >= 2 ? 1.06 : 1.03;
    return m;
  }
  function scoreMult() {
    let m = 1;
    if (has('greed')) m *= heldTier('greed') >= 2 ? 1.7 : 1.4;
    const drought = heldTier('drought');
    if (drought >= 2) m *= 0.85;
    else if (drought >= 1) m *= 0.9;
    if (has('bargain')) m *= 2;
    return m;
  }
  function lettersBonus() {
    return has('ledger') ? 2 : 0;
  }
  function bucketPressure() {
    let p = pressure();
    const rally = heldTier('rally');
    if (rally >= 2) p -= 18;
    else if (rally >= 1) p -= 10;
    return Math.max(0, p);
  }
  function targetSetSize() {
    const ws = heldTier('wide-scope');
    return 1 + (ws >= 2 ? 2 : ws >= 1 ? 1 : 0);
  }
  function autoClearEvery() {
    const oc = heldTier('overclock');
    return oc >= 2 ? 4 : oc >= 1 ? 5 : 0;
  }
  function tunnelVisible() {
    const tn = heldTier('tunnel');
    return tn >= 2 ? 2 : tn >= 1 ? 3 : 0;
  }
  function reversed() {
    return has('reverse');
  }
  function decoyChance() {
    const d = heldTier('decoy');
    return d >= 2 ? 1 / 5 : d >= 1 ? 1 / 8 : 0;
  }
  function splitEvery() {
    const sp = heldTier('split');
    return sp >= 2 ? 3 : sp >= 1 ? 5 : 0;
  }

  function hexCountHeld() {
    let n = 0;
    for (const card of CARD_LIST) if (card.type === 'hex' && has(card.id)) n += 1;
    return n;
  }

  // ─── Word range / pressure ────────────────────────────────────────────────
  function wordRange() {
    const p = bucketPressure();
    for (const [limit, range] of CFG.wordRangeSteps) {
      if (p < limit) return range;
    }
    return CFG.wordRangeSteps[CFG.wordRangeSteps.length - 1][1];
  }

  function spawnInterval() {
    let t = Math.max(CFG.spawnMin, CFG.spawnStart - pressure() * CFG.spawnDecay);
    // Drought buys reading time by stretching the queue; it is the Hex/Gambit
    // lane's survival option (spawn rate, not fall speed, is the strong lever).
    const drought = heldTier('drought');
    if (drought >= 2) t *= 1.2;
    else if (drought >= 1) t *= 1.15;
    return t;
  }

  function baseSpeedNow() {
    return Math.min(CFG.maxSpeed, CFG.baseSpeed + pressure() * CFG.speedPerClear);
  }

  // ─── Word spawn ───────────────────────────────────────────────────────────
  function misspell(text) {
    const i = 1 + ((rng() * (text.length - 1)) | 0);
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    let c = alphabet[(rng() * 26) | 0];
    if (c === text[i]) c = c === 'a' ? 'e' : 'a';
    return text.slice(0, i) + c + text.slice(i + 1);
  }

  function pickSpawnText(lo, hi) {
    let pool;
    if (lo != null && hi != null) {
      pool = wordsByLength(lo, hi);
    } else {
      [lo, hi] = wordRange();
      pool = wordsByLength(lo, hi);
    }
    if (!pool.length) pool = wordsByLength(1, 11);
    if (!pool.length) return null;

    const onScreen = new Set(state.words.map((w) => w.text));
    let pickPool = pool.filter((w) => !onScreen.has(w));
    if (!pickPool.length) pickPool = pool;
    return pickPool[(rng() * pickPool.length) | 0];
  }

  // Highest free slot above the viewport: queue words instead of stacking them.
  function queueTop(exclude) {
    let y = -CFG.charH - 12;
    for (const other of state.words) {
      if (other !== exclude && other.y <= CFG.charH * 2) {
        y = Math.min(y, other.y - CFG.charH - 8);
      }
    }
    return y;
  }

  function spawnWord(text, opts = {}) {
    text = String(text || '').toLowerCase();
    if (!/^[a-z]{1,20}$/.test(text)) return null;
    const w = charW * text.length;
    const maxX = Math.max(CFG.pad, W - CFG.pad - w);
    const x = opts.x != null ? opts.x : CFG.pad + rng() * Math.max(0, maxX - CFG.pad);
    const word = {
      id: nextId++,
      text,
      x,
      y: opts.y != null ? opts.y : -CFG.charH - 12,
      w,
      progress: 0,
      fake: !!opts.fake,
      born: state.t,
      typedAt: [],
    };
    state.words.push(word);
    return word;
  }

  // Split's free word: real only, short (cheap to type), and it deliberately
  // ignores `maxWords` so the card actually bites even when the queue is full.
  function spawnExtra() {
    const text = pickSpawnText(3, 5);
    if (!text) return null;
    const word = spawnWord(text, {});
    if (!word) return null;
    word.harmless = true;      // paid in reading time, not in lives
    word.y = queueTop(word);
    return word;
  }

  function spawn() {
    if (state.words.length >= CFG.maxWords) return null;

    const text = pickSpawnText();
    if (!text) return null;

    let spawnText = text;
    let fake = false;
    if (has('decoy') && rng() < decoyChance()) {
      fake = true;
      spawnText = misspell(text);
    }

    const word = spawnWord(spawnText, { fake });
    if (!word) return null;
    word.y = queueTop(word);

    state.spawnCount += 1;
    const every = splitEvery();
    if (every > 0 && state.spawnCount % every === 0) spawnExtra();
    return word;
  }

  // ─── Target set / lock-on ─────────────────────────────────────────────────
  function targetSet() {
    if (!state.words.length) return [];
    if (state.lockWord && state.words.indexOf(state.lockWord) >= 0) {
      return [state.lockWord];
    }
    const sorted = state.words.slice().sort((a, b) => b.y - a.y);
    return sorted.slice(0, targetSetSize());
  }

  function targetWord() {
    if (state.lockWord && state.words.indexOf(state.lockWord) >= 0) {
      return state.lockWord;
    }
    const set = targetSet();
    if (!set.length) return null;
    for (const w of set) if (!w.fake) return w;   // a fake never blocks a real word in the set
    return set[0];                                // only fakes are in range
  }

  function typingOrderIndex(word, pos) {
    return reversed() ? word.text.length - 1 - pos : pos;
  }

  function nextChar(word) {
    const pos = word.progress;
    if (pos >= word.text.length) return null;
    return word.text[typingOrderIndex(word, pos)];
  }

  function visibleCount() {
    return tunnelVisible();
  }

  function calcPoints(word) {
    const letters = word.text.length;
    const base = letters * (CFG.basePointsPerChar + lettersBonus());
    let mult = comboMultiplier() * heatMult() * scoreMult();
    if (has('longshot') && letters >= 7) mult *= 2;
    return Math.round(base * mult);
  }

  // ─── Clear / wave ─────────────────────────────────────────────────────────
  function removeWord(word) {
    const i = state.words.indexOf(word);
    if (i >= 0) state.words.splice(i, 1);
    if (state.lockWord === word) state.lockWord = null;
  }

  function echoOf(word) {
    state.echoes.push({
      text: word.text,
      x: word.x,
      y: word.y,
      w: word.w,
      ttl: CFG.echoLife,
      t: CFG.echoLife,
    });
  }

  // ─── Effects (M7) ─────────────────────────────────────────────────────────
  // Presentation only: nothing in here mutates a rule. Every emitter is a
  // no-op while `state.simulating`, so the headless bot's seeded runs stay
  // identical to the visual game. All pools are capped (see CFG.fxMax*) and
  // the 'light' FX setting scales counts down without removing impact beats.
  const MILESTONE_COMBO = 10;

  // Adaptive effect budget. If the measured frame rate sags the emitter counts
  // shrink automatically, then recover when the machine catches up. This is
  // what keeps "lots of effects" from becoming "lots of lag" on weak GPUs.
  let fxPressure = 1;
  let perfAccMs = 0;
  let perfFrames = 0;
  let perfAvgMs = 0;

  function fxScale() {
    return (settings.fx === 'light' ? 0.35 : 1) * fxPressure;
  }
  function fxCount(n) {
    return Math.max(1, Math.round(n * fxScale()));
  }
  function capPool(pool, max) {
    if (pool.length > max) pool.splice(0, pool.length - max);
  }

  // Additive square sparks: the M4 particle, now with per-particle gravity and
  // drag so shards, debris and heat trails can share one cheap update loop.
  function addSpark(x, y, vx, vy, opts) {
    opts = opts || {};
    state.particles.push({
      x,
      y,
      vx,
      vy,
      life: opts.life != null ? opts.life : 0.35 + rng() * 0.35,
      max: opts.max != null ? opts.max : 0.7,
      color: opts.color || PARTICLE_COLORS[(rng() * PARTICLE_COLORS.length) | 0],
      size: opts.size || (rng() < 0.3 ? 3 : 2),
      g: opts.g != null ? opts.g : 340,
      drag: opts.drag != null ? opts.drag : 1.4,
    });
  }

  function burst(word, color, count) {
    if (state.simulating) return;
    const cx = clamp(word.x + word.w / 2, 0, W);
    const cy = word.y + CFG.charH / 2;
    const n = fxCount(count);
    for (let i = 0; i < n; i++) {
      const ang = rng() * Math.PI * 2;
      const sp = 40 + rng() * 170;
      addSpark(cx, cy, Math.cos(ang) * sp, Math.sin(ang) * sp - 40, { color });
    }
    capPool(state.particles, CFG.fxMaxParticles);
  }

  // Every letter of a cleared word becomes a spinning glyph shard, so the word
  // visibly comes apart exactly where the player typed it.
  function shatter(word, color) {
    if (state.simulating) return;
    const baseX = Math.max(4, Math.min(word.x, W - 4 - word.w));
    const glyphs = word.text.split('');
    const max = Math.min(glyphs.length, fxCount(14));
    for (let i = 0; i < max; i++) {
      const gx = baseX + i * charW + charW / 2;
      const ang = -Math.PI / 2 + (rng() - 0.5) * 2.4;
      const sp = 70 + rng() * 200;
      state.shards.push({
        x: gx,
        y: word.y + CFG.charH / 2,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        g: 520,
        rot: (rng() - 0.5) * 0.4,
        vr: (rng() - 0.5) * 9,
        life: 0.42 + rng() * 0.32,
        max: 0.74,
        ch: glyphs[i],
        color,
        scale: 1 + rng() * 0.3,
      });
    }
    capPool(state.shards, CFG.fxMaxShards);
  }

  // Square shockwave ring (period-correct: no circles).
  function ring(x, y, color, radius, life, width) {
    if (state.simulating) return;
    state.rings.push({
      x,
      y,
      r: 5,
      vr: radius / Math.max(0.08, life),
      life,
      max: life,
      color,
      width: width || 2,
    });
    capPool(state.rings, CFG.fxMaxRings);
  }

  function popup(x, y, text, color, opts) {
    if (state.simulating) return;
    opts = opts || {};
    const life = opts.life || 0.85;
    state.popups.push({
      x: clamp(x, 40, W - 40),
      y,
      text,
      color: color || COL.white,
      vy: opts.vy != null ? opts.vy : -46,
      life,
      max: life,
      size: opts.size || 18,
      shadow: opts.shadow !== false,
    });
    capPool(state.popups, CFG.fxMaxPopups);
  }

  function milestone(combo) {
    if (state.simulating) return;
    state.milestoneT = 0.75;
    state.clearFlash = Math.max(state.clearFlash, 0.8);
    state.shake = Math.max(state.shake, 0.24);
    state.punch = Math.max(state.punch, 1);
    popup(W / 2, H * 0.33, 'COMBO \u00d7' + combo, COL.gold, { size: 30, vy: -26, life: 1.1 });
    ring(W / 2, H * 0.33, COL.gold, 300, 0.6, 3);
    playMilestone(combo);
  }


  function clearWord(word, auto) {
    if (!word || state.words.indexOf(word) < 0) return;
    removeWord(word);

    const points = calcPoints(word);
    state.score += points;
    state.cleared += 1;
    state.waveCleared += 1;
    state.lastClear = { points, x: word.x, y: word.y, auto: !!auto, t: 0.9 };

    if (has('ghost')) echoOf(word);

    const cx = clamp(word.x + word.w / 2, 0, W);
    const cy = word.y + CFG.charH / 2;

    if (auto) {
      state.autoClears += 1;
      burst(word, COL.accent, 12);
      shatter(word, COL.accent);
      ring(cx, cy, COL.accent, 80, 0.32, 1);
      popup(cx, word.y - 6, '+' + fmtInt(points), COL.accent, { size: 15, life: 0.6 });
    } else {
      state.combo += 1;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
      // Impact scales with how close the word was to the line: the riskier the
      // clear, the longer the freeze-frame, the harder the hit.
      const proximity = clamp(1 - (state.groundY - (word.y + CFG.charH)) / 260, 0, 1);
      const close = proximity > 0.62;
      state.hitPause = Math.max(state.hitPause, CFG.hitPause + proximity * 0.04);
      state.shake = Math.max(state.shake, 0.15 + proximity * 0.32);
      state.clearFlash = Math.max(state.clearFlash, 0.14 + proximity * 0.12);
      state.punch = Math.max(state.punch, 0.55 + proximity * 0.45);
      burst(word, COL.typed, 18 + Math.min(14, state.combo));
      shatter(word, COL.white);
      ring(cx, cy, COL.gold, 110 + proximity * 140, 0.34 + proximity * 0.14, 2);
      popup(cx, word.y - 8, '+' + fmtInt(points), COL.gold, { size: 20 });
      popup(cx, word.y + CFG.charH + 26, '\u00d7' + comboMultiplier().toFixed(2), COL.typed, {
        size: 13, vy: -30, life: 0.7,
      });
      if (close) {
        popup(cx, word.y - 30, 'CLOSE CALL', COL.danger, { size: 13, vy: -20, life: 0.85 });
        state.shake = Math.max(state.shake, 0.36);
        state.clearFlash = Math.max(state.clearFlash, 0.3);
      }
      if (state.combo % MILESTONE_COMBO === 0) milestone(state.combo);
      playClear(state.combo, proximity, close, word.text.length);
      pulseStatus('score');
      pulseStatus('combo');
    }

    const every = autoClearEvery();
    if (!auto && every > 0 && state.cleared % every === 0) autoClearNext();

    checkWaveEnd();
  }

  function autoClearNext() {
    if (state.phase !== 'playing') return;
    const set = targetSet();
    let word = null;
    for (const w of set) {
      if (!w.fake) { word = w; break; }
    }
    if (!word) {
      const reals = state.words.filter((w) => !w.fake).sort((a, b) => b.y - a.y);
      word = reals[0] || null;
    }
    if (!word) return;

    const points = calcPoints(word);
    removeWord(word);
    state.score += points;
    state.cleared += 1;
    state.autoClears += 1;                 // auto-clears score and raise Pressure, but do not count toward a wave
    state.lastClear = { points, x: word.x, y: word.y, auto: true, t: 0.9 };
    if (has('ghost')) echoOf(word);
    burst(word, COL.accent, 12);
    shatter(word, COL.accent);
    popup(clamp(word.x + word.w / 2, 0, W), word.y - 6, '+' + fmtInt(points), COL.accent, { size: 15, life: 0.6 });
    pulseStatus('score');
    playAutoClear();
  }

  function checkWaveEnd() {
    if (state.phase !== 'playing') return;
    if (state.waveCleared < CFG.waveSize) return;
    if (!state.endless && state.wave >= CFG.wavesPerRun) {
      openDawn();
      return;
    }
    // The headless sim skips the celebration so tuning runs keep their exact
    // timing; the visual game gets a beat of impact before the draft opens.
    if (state.simulating) {
      openDraft();
      return;
    }
    celebrateWave();
  }

  function celebrateWave() {
    state.waveClearT = 0.85;
    state.waveClearWave = state.wave;
    state.dangerLevel = 0;
    state.punch = Math.max(state.punch, 0.8);
    state.clearFlash = Math.max(state.clearFlash, 0.55);
    state.shake = Math.max(state.shake, 0.2);
    popup(W / 2, H * 0.37, 'RECEIVER PATCHED', COL.white, { size: 14, vy: -14, life: 1.1 });
    popup(W / 2, H * 0.37, 'RECEIVER PATCHED', COL.white, { size: 14, vy: -14, life: 1.1 });
    ring(W / 2, H * 0.42, COL.gold, 380, 0.7, 3);
    ring(W / 2, H * 0.42, COL.gold, 240, 0.5, 2);
    for (let i = 0; i < fxCount(34); i++) {
      const ang = rng() * Math.PI * 2;
      const sp = 150 + rng() * 320;
      addSpark(W / 2, H * 0.42, Math.cos(ang) * sp, Math.sin(ang) * sp, {
        color: PARTICLE_COLORS[(rng() * PARTICLE_COLORS.length) | 0],
        life: 0.5 + rng() * 0.5,
        max: 1,
        g: 180,
      });
    }
    playWaveClear();
  }

  // ─── Draft ────────────────────────────────────────────────────────────────
  const DRAFT_SLOTS = [
    { type: 'boon', label: 'BOON' },
    { type: 'any', label: 'ANY' },
    { type: 'hex-gambit', label: 'HEX / GAMBIT' },
  ];

  function slotAccepts(slot, card) {
    if (slot.type === 'any') return true;
    if (slot.type === 'boon') return card.type === 'boon';
    return card.type === 'hex' || card.type === 'gambit';
  }

  function cardEligible(card) {
    const held = heldTier(card.id);
    if (held >= card.maxTier) return false;              // maxed out (no-tier cards leave after one pick)
    if (card.type === 'hex' && held === 0 && hexCountHeld() >= HEX_TOTAL) return false;
    if (card.id === 'grace' && state.lives >= CFG.maxLives) return false;
    if (card.id === 'steady-hand' && state.shieldMax >= CFG.maxShields) return false;
    if (card.id === 'longshot' && wordRange()[1] < 7) return false;
    return true;
  }

  // Per-slot rare odds. Slot 3 gets a higher roll because its rare pool is
  // smaller and its common cards are the least survival-positive in the game.
  // Draft quality also improves as the run goes on (late drafts used to decay:
  // the small Boon pool was exhausted while slot 3 stayed rare-starved).
  function slotRareChance(slotIndex) {
    const base = slotIndex === 2 ? 0.30 : 0.24;
    return Math.min(0.45, base + state.wave * 0.012);
  }

  function makeOffer() {
    const used = new Set();
    const offer = [];
    let laneOneType = null;
    for (let i = 0; i < DRAFT_SLOTS.length; i++) {
      const slot = DRAFT_SLOTS[i];
      const eligible = CARD_LIST.filter((c) => cardEligible(c) && !used.has(c.id));
      let candidates = eligible.filter((c) => slotAccepts(slot, c));
      if (!candidates.length) candidates = eligible;     // keep three cards if a slot is exhausted
      if (!candidates.length) { offer.push(null); continue; }

      // Slot 2 prefers a different lane from slot 1 most of the time. Always
      // doing it removed the Boon lane from the ANY slot entirely (slot 1 is
      // always a Boon); never doing it made the 60 WPM cell too hot (~49%).
      // A 70% preference keeps both lanes alive and the cell mid-band.
      if (i === 1 && laneOneType && rng() < 0.7) {
        const diverse = candidates.filter((c) => c.type !== laneOneType);
        if (diverse.length) candidates = diverse;
      }

      const wantRare = rng() < slotRareChance(i);
      let pool = candidates.filter((c) => (wantRare ? c.rarity === 'rare' : c.rarity === 'common'));
      // Cross-lane rare fallback: a rare roll should deliver a rare whenever any
      // eligible rare exists, even outside this slot's lane (slot 3 used to fall
      // back to a common ~4% of the time because its rare pool was thin).
      if (!pool.length && wantRare) pool = eligible.filter((c) => c.rarity === 'rare');
      if (!pool.length) pool = candidates;

      const card = pool[(rng() * pool.length) | 0];
      const tier = heldTier(card.id) + 1;
      offer.push(Object.assign({}, card, { tier, desc: card.blurb(tier) }));
      used.add(card.id);
      if (i === 0) laneOneType = card.type;
    }
    return offer;
  }

  function openDraft() {
    state.phase = 'draft';
    state.offer = makeOffer();
    state.draftAnim = 0;
    state.lockWord = null;
    playDraft();
  }

  function advanceWave() {
    state.wave += 1;
    state.waveCleared = 0;
    state.shields = state.shieldMax;      // Shield refills when a wave starts
    state.phase = 'playing';
    state.waveBanner = 1.6;
    state.spawnT = Math.min(state.spawnT, 0.6);
    playWave();
  }

  function applyInstant(id, tier) {
    if (id === 'grace') state.lives = Math.min(CFG.maxLives, state.lives + 1);
    if (id === 'steady-hand') {
      const add = tier >= 2 ? 2 : 1;
      state.shieldMax = Math.min(CFG.maxShields, state.shieldMax + add);
      state.shields = Math.min(state.shieldMax, state.shields + add);
    }
    if (id === 'second-draft') state.rerollsLeft += 1;
  }

  function applyCard(card) {
    state.deck[card.id] = card.tier;
    applyInstant(card.id, card.tier);
  }

  function grant(id, tier = 1) {
    const card = CARD_BY_ID[id];
    if (!card) return null;
    const target = clamp(Math.floor(Number(tier) || 1), 1, card.maxTier);
    const start = state.deck[id] || 0;
    if (start >= target) return start;
    // Walk the tiers so instant effects stack exactly like two real picks would.
    for (let t = start + 1; t <= target; t++) {
      state.deck[id] = t;
      applyInstant(id, t);
    }
    return target;
  }

  function pick(index) {
    if (state.phase !== 'draft' || !state.offer) return null;
    const card = state.offer[index];
    if (!card) return null;
    applyCard(card);
    state.draftsTaken += 1;
    state.offer = null;
    advanceWave();
    playPick();
    return card.id;
  }

  function reroll() {
    if (state.phase !== 'draft' || state.rerollsLeft <= 0) return false;
    state.rerollsLeft -= 1;
    state.offer = makeOffer();
    state.draftAnim = 0;
    playPick();
    return true;
  }

  function skip() {
    if (state.phase !== 'draft') return false;
    // Skip is the score/defence valve for a bad offer: it still raises Pressure
    // (you cannot dodge the curve), pays a wave-scaled bounty, and buys one
    // temporary Shield for the wave that follows.
    if (!has('bargain')) state.score += CFG.skipPointsPerWave * state.wave;
    state.draftsTaken += 1;
    state.offer = null;
    advanceWave();
    if (state.shields < CFG.maxShields) {
      state.shields += 1;
      pulseStatus('shields');
    }
    playPick();
    return true;
  }

  function openDawn() {
    state.phase = 'dawn';
    state.dawn = true;
    state.lockWord = null;
    recordRun(true);
    playDawn();
  }

  function continueEndless() {
    if (state.phase !== 'dawn') return;
    state.endless = true;
    state.phase = 'playing';
    state.wave += 1;
    state.waveCleared = 0;
    state.shields = state.shieldMax;
    state.waveBanner = 1.6;
  }

  // ─── Typing rules ─────────────────────────────────────────────────────────
  function typeLetter(ch) {
    if (state.phase !== 'playing' || state.waveClearT > 0) return;
    ch = String(ch || '').toLowerCase();
    if (!/^[a-z]$/.test(ch)) return;

    const set = targetSet();
    if (!set.length) return;

    let word = null;
    if (state.lockWord && state.words.indexOf(state.lockWord) >= 0) {
      word = state.lockWord;
    } else {
      const reals = set.filter((w) => !w.fake);
      if (!reals.length) { mistake(); return; }          // a fake is the lowest word
      const matches = reals.filter((w) => nextChar(w) === ch);
      if (!matches.length) { mistake(); return; }
      matches.sort((a, b) => b.y - a.y);                 // ties go to the lowest word
      word = matches[0];
    }

    if (nextChar(word) === ch) {
      state.lockWord = word;                             // lock-on: holds until this word is cleared
      word.progress += 1;
      state.keys += 1;
      word.typedAt[word.progress - 1] = state.t;
      if (word.progress >= word.text.length) {
        clearWord(word, false);
      } else {
        // Per-letter impact: a spark and a short scale-pop on the typed glyph.
        if (!state.simulating) {
          const pos = typingOrderIndex(word, word.progress - 1);
          const px = clamp(word.x + pos * charW + charW / 2, 0, W);
          const py = word.y + CFG.charH / 2;
          addSpark(px, py, (rng() - 0.5) * 70, -20 - rng() * 40, {
            color: COL.typed, size: 2, life: 0.2, max: 0.25, g: 120,
          });
        }
        playKey(word.progress, word.text.length);
      }
    } else {
      mistake();
    }
  }

  function mistake() {
    state.mistakes += 1;
    if (state.shields > 0) {
      state.shields -= 1;                                // Shield eats the hit, combo kept, no flash
      state.blockFlash = 0.18;
      if (!state.simulating) {
        const t = targetWord();
        if (t) {
          const cx = clamp(t.x + t.w / 2, 0, W);
          const cy = t.y + CFG.charH / 2;
          ring(cx, cy, COL.white, 70, 0.22, 2);
          for (let i = 0; i < fxCount(5); i++) {
            addSpark(cx, cy, (rng() - 0.5) * 130, (rng() - 0.5) * 130, {
              color: COL.white, size: 2, life: 0.22, max: 0.3, g: 60,
            });
          }
        }
        pulseStatus('shields');
      }
      playShield();
      return;
    }
    state.combo = 0;
    state.flash = CFG.mistakeFlash;
    state.shake = Math.max(state.shake, 0.12);
    if (!state.simulating) {
      const t = targetWord();
      if (t) {
        const cx = clamp(t.x + t.w / 2, 0, W);
        popup(cx, t.y - 6, 'MISS', COL.danger, { size: 13, vy: -28, life: 0.6 });
      }
    }
    playMistake();
  }

  function hitGround(word) {
    removeWord(word);
    if (word.fake) return;                               // fakes fall through harmlessly
    if (word.harmless) return;                           // Split's free word costs no life

    // Lifeline: the first word that reaches the line is destroyed instead of
    // costing a Life. Combo is kept - it is a rare, once-per-run save.
    if (has('lifeline') && !state.lifelineUsed) {
      state.lifelineUsed = true;
      if (!state.simulating) {
        const cx = clamp(word.x + word.w / 2, 0, W);
        shatter(word, COL.gold);
        ring(cx, state.groundY, COL.gold, 300, 0.5, 3);
        popup(cx, state.groundY - 48, 'LINE HELD', COL.gold, { size: 24, vy: -36, life: 1.1 });
        state.clearFlash = Math.max(state.clearFlash, 0.5);
        state.shake = Math.max(state.shake, 0.26);
        state.punch = Math.max(state.punch, 0.7);
        playLifeline();
      }
      return;
    }

    state.combo = 0;
    state.flash = CFG.mistakeFlash;
    state.shake = CFG.shakeHit;
    state.lives -= 1;
    if (!state.simulating) {
      // The word breaks on the line: red glyph shards, a hard ring and a
      // full-screen damage pulse make losing a life unmissable.
      shatter(word, COL.danger);
      const cx = clamp(word.x + word.w / 2, 0, W);
      const cy = state.groundY - CFG.charH / 2;
      ring(cx, state.groundY, COL.danger, 220, 0.42, 3);
      popup(cx, state.groundY - 40, '-1 LIFE', COL.danger, { size: 22, vy: -34, life: 1 });
      state.clearFlash = 0;
      pulseStatus('lives');
    }
    playHit();
    if (state.lives <= 0) gameOver();
  }

  function gameOver() {
    state.phase = 'gameover';
    recordRun(false);
  }

  // ─── Update ───────────────────────────────────────────────────────────────
  function update(dt) {
    state.t += dt;
    if (state.phase === 'playing' && state.waveClearT <= 0) state.runSec += dt;
    state.flash = Math.max(0, state.flash - dt);
    state.blockFlash = Math.max(0, state.blockFlash - dt);
    state.clearFlash = Math.max(0, state.clearFlash - dt * 2.4);
    state.milestoneT = Math.max(0, state.milestoneT - dt);
    state.punch = Math.max(0, state.punch - dt * 6);
    state.shake = Math.max(0, state.shake - dt * 1.7);
    state.waveBanner = Math.max(0, state.waveBanner - dt);
    if (state.lastClear) {
      state.lastClear.t -= dt;
      if (state.lastClear.t <= 0) state.lastClear = null;
    }

    updateEchoes(dt);
    updateParticles(dt);
    updateShards(dt);
    updateRings(dt);
    updatePopups(dt);

    if (state.phase === 'draft') {
      state.draftAnim = Math.min(1, state.draftAnim + dt / CFG.draftRise);
      return;
    }
    if (state.phase !== 'playing') return;
    if (state.hitPause > 0) {
      state.hitPause -= dt;
      return;
    }

    // Wave-complete beat: the board hangs for a moment, effects keep playing,
    // then the draft dialog opens.
    if (state.waveClearT > 0) {
      state.waveClearT -= dt;
      if (state.waveClearT <= 0) {
        state.waveClearT = 0;
        openDraft();
      }
      return;
    }

    state.speed = baseSpeedNow() * speedMult();

    state.spawnT -= dt;
    if (state.spawnT <= 0) {
      spawn();
      state.spawnT = spawnInterval();
    }

    const longshotBoost = has('longshot') ? 1.05 : 1;
    const base = state.speed * (H / 900);
    for (const w of state.words) {
      const fakeBoost = w.fake ? CFG.fakeSpeedMult : 1;
      const mult = (w.text.length >= 7 ? longshotBoost : 1) * fakeBoost;
      w.y += base * mult * dt;
    }

    for (let i = state.words.length - 1; i >= 0; i--) {
      if (state.phase !== 'playing') break;
      const w = state.words[i];
      if (!w) continue;
      if (w.y + CFG.charH >= state.groundY) hitGround(w);
    }

    // danger level: 0 when the target is high, 1 when it is about to cross.
    // Drives the canvas edge glow, the heartbeat and the CSS vignette.
    if (!state.simulating) {
      const t = targetWord();
      let danger = 0;
      if (t && !t.fake) {
        danger = clamp(1 - (state.groundY - (t.y + CFG.charH)) / 230, 0, 1);
      }
      state.dangerLevel = state.phase === 'playing' ? danger : 0;
      if (danger > 0.55) {
        state.dangerT -= dt;
        if (state.dangerT <= 0) {
          state.dangerT = danger > 0.85 ? 0.3 : 0.5;
          tone(64, 0.09, 'sine', 0.03);
        }
      } else {
        state.dangerT = 0;
      }
    }
  }

  function updateEchoes(dt) {
    for (let i = state.echoes.length - 1; i >= 0; i--) {
      const e = state.echoes[i];
      e.t -= dt;
      if (e.t <= 0) state.echoes.splice(i, 1);
    }
  }

  function updateParticles(dt) {
    for (let i = state.particles.length - 1; i >= 0; i--) {
      const p = state.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        state.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.g || 340) * dt;
      p.vx *= 1 - (p.drag || 1.4) * dt;
    }
  }

  function updateShards(dt) {
    for (let i = state.shards.length - 1; i >= 0; i--) {
      const s = state.shards[i];
      s.life -= dt;
      if (s.life <= 0) {
        state.shards.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += s.g * dt;
      s.vx *= 1 - 1.1 * dt;
      s.rot += s.vr * dt;
    }
  }

  function updateRings(dt) {
    for (let i = state.rings.length - 1; i >= 0; i--) {
      const r = state.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        state.rings.splice(i, 1);
        continue;
      }
      r.r += r.vr * dt;
    }
  }

  function updatePopups(dt) {
    for (let i = state.popups.length - 1; i >= 0; i--) {
      const p = state.popups[i];
      p.life -= dt;
      if (p.life <= 0) {
        state.popups.splice(i, 1);
        continue;
      }
      p.y += p.vy * dt;
      p.vy *= 1 - 1.8 * dt;
    }
  }

  // ─── Playfield rendering - 16 colours, dithered, 1995 ────────────────────
  const WORD_FONT = 'bold 24px "Lucida Console", "Courier New", monospace';
  const PIXEL_FONT = '9px "Microsoft Sans Serif", Tahoma, sans-serif';
  const PARTICLE_COLORS = ['#ffff00', '#ffffff', '#00a000', '#c0c0c0', '#ff0000'];

  let dither25 = null;
  let dither50 = null;

  function makeDitherPatterns() {
    const make = (dots) => {
      const c = document.createElement('canvas');
      c.width = 4;
      c.height = 4;
      const g = c.getContext('2d');
      g.fillStyle = COL.skyDark;
      g.fillRect(0, 0, 4, 4);
      g.fillStyle = COL.skyLight;
      for (const [x, y] of dots) g.fillRect(x, y, 1, 1);
      return ctx.createPattern(c, 'repeat');
    };
    dither25 = make([[1, 1], [3, 3]]);
    dither50 = make([[0, 0], [2, 0], [1, 1], [3, 1], [0, 2], [2, 2], [1, 3], [3, 3]]);
  }

  function render() {
    ctx.save();
    if (state.punch > 0.01) {
      const s = 1 + state.punch * 0.012;
      ctx.translate(W / 2, H / 2);
      ctx.scale(s, s);
      ctx.translate(-W / 2, -H / 2);
    }
    if (state.shake > 0.01) {
      ctx.translate(
        Math.sin(state.t * 91) * state.shake * 9,
        Math.cos(state.t * 67) * state.shake * 6
      );
    }
    drawSky();
    drawStars();
    drawSignalField();
    drawAmbient();
    drawEchoes();
    drawDangerLine();
    drawWords();
    drawShards();
    drawParticles();
    drawRings();
    drawPopups();
    drawWaveBanner();
    drawWaveClear();
    ctx.restore();

    drawEdgeFx();
    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255, 0, 0, ${(state.flash / CFG.mistakeFlash) * 0.18})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state.blockFlash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${(state.blockFlash / 0.18) * 0.10})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state.clearFlash > 0) {
      ctx.fillStyle = `rgba(255, 255, 0, ${state.clearFlash * 0.09})`;
      ctx.fillRect(0, 0, W, H);
    }
    syncUi();
  }

  // Ambient playfield motion: a slow scan sweep and rare interference bars.
  // Everything is time-derived, never rng-derived, so rendering can never
  // perturb the seeded gameplay stream.
  function drawAmbient() {
    if (settings.fx === 'light') return;
    const sweep = ((state.t * 46) % (H + 80)) - 40;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.fillRect(0, Math.round(sweep), W, 1);

    const cycle = state.t % 9;
    if (cycle < 0.22) {
      for (let i = 0; i < 3; i++) {
        const seed = Math.sin(i * 91.7 + Math.floor(state.t * 24) * 13.3) * 0.5 + 0.5;
        const yy = seed * (H - CFG.groundPad);
        const hh = 1 + ((i * 7) % 3);
        ctx.fillStyle = i % 2 ? 'rgba(0, 160, 160, 0.20)' : 'rgba(255, 255, 255, 0.09)';
        ctx.fillRect(0, Math.round(yy), W, hh);
      }
    }
  }

  // Combo and danger bleed into the frame edges, so the state of the run is
  // readable from the playfield even when the HUD is out of focus.
  function drawEdgeFx() {
    const combo = Math.min(state.combo, 20);
    if (combo >= 3) {
      const a = 0.10 + (combo / 20) * 0.22;
      const wide = 2 + Math.round((combo / 20) * 4);
      ctx.fillStyle = `rgba(255, 255, 0, ${a})`;
      ctx.fillRect(0, 0, wide, H);
      ctx.fillRect(W - wide, 0, wide, H);
    }
    const danger = state.dangerLevel || 0;
    if (danger > 0.12) {
      const beat = 0.55 + 0.45 * Math.sin(state.t * 8);
      ctx.fillStyle = `rgba(255, 0, 0, ${danger * 0.26 * beat})`;
      ctx.fillRect(0, 0, W, 3);
      ctx.fillRect(0, H - 3, W, 3);
    }
    if (state.lives <= 1 && state.phase === 'playing') {
      const pulse = 0.5 + 0.5 * Math.sin(state.t * 3.1);
      ctx.fillStyle = `rgba(255, 0, 0, ${0.04 + pulse * 0.04})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state.phase === 'gameover') {
      ctx.fillStyle = `rgba(255, 0, 0, ${0.10 + 0.05 * Math.sin(state.t * 2)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state.phase === 'dawn') {
      ctx.fillStyle = `rgba(255, 255, 0, ${0.06 + 0.03 * Math.sin(state.t * 1.4)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawSky() {
    if (!dither25) makeDitherPatterns();
    ctx.fillStyle = COL.skyDark;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = dither25;
    ctx.fillRect(0, H * 0.40, W, H * 0.34);
    ctx.fillStyle = dither50;
    ctx.fillRect(0, H * 0.74, W, H * 0.26);
  }

  function drawStars() {
    ctx.fillStyle = COL.star;
    for (const s of stars) {
      const a = 0.35 + 0.5 * Math.abs(Math.sin(state.t * 1.6 + s.tw));
      ctx.globalAlpha = a;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
    }
    // Occasional signal flare crossing the sky (time-derived, no allocation).
    const cyc = state.t % 11;
    if (cyc < 0.8 && settings.fx !== 'light') {
      const p = cyc / 0.8;
      const sx = W * (0.18 + p * 0.72);
      const sy = H * 0.12 + p * 120;
      const fade = Math.sin(p * Math.PI);
      ctx.globalAlpha = fade * 0.9;
      ctx.fillStyle = COL.white;
      ctx.fillRect(Math.round(sx), Math.round(sy), 2, 2);
      ctx.globalAlpha = fade * 0.5;
      ctx.fillRect(Math.round(sx - 7), Math.round(sy - 3), 2, 1);
    }
    ctx.globalAlpha = 1;
  }

  // A frozen spectrum at the horizon: flat bars, no windows, no edges and no
  // mast. The only colour accents are one-pixel caps, so the strip reads as
  // signal noise rather than a city.
  function drawSignalField() {
    let i = 0;
    for (const b of signalField) {
      const lift = settings.fx === 'light' ? 0 : Math.round(Math.sin(state.t * 1.4 + i * 0.7) * 2);
      i += 1;
      const x = Math.round(b.x);
      const top = Math.round(H - b.h) + lift;
      const w = Math.max(1, Math.round(b.w));
      const h = Math.round(b.h) - lift;
      ctx.fillStyle = b.tone ? COL.building1 : COL.building0;
      ctx.fillRect(x, top, w, h);
      // Caps flicker like a spectrum analyser, one pixel at a time.
      if (settings.fx !== 'light' && (i * 7 + Math.floor(state.t * 5)) % 13 === 0) continue;
      ctx.fillStyle = b.cap;
      ctx.fillRect(x, top, w, 1);
    }
  }

  function drawEchoes() {
    ctx.font = WORD_FONT;
    ctx.textBaseline = 'top';
    ctx.fillStyle = COL.echo;
    for (const e of state.echoes) {
      const x = Math.max(4, Math.min(e.x, W - 4 - e.w));
      ctx.fillText(e.text, x, e.y);
    }
  }

  function drawDangerLine() {
    const y = state.groundY;
    const danger = state.dangerLevel || 0;
    const beat = 0.5 + 0.5 * Math.sin(state.t * (danger > 0.5 ? 9 : 2.2));
    if (danger > 0.02) {
      ctx.fillStyle = `rgba(255, 0, 0, ${danger * (0.10 + 0.10 * beat)})`;
      ctx.fillRect(0, y - 34, W, 34);
    }
    ctx.save();
    ctx.globalAlpha = 0.55 + 0.45 * beat;
    ctx.strokeStyle = COL.danger;
    ctx.lineWidth = danger > 0.6 ? 2 : 1;
    ctx.setLineDash([4, 3]);
    ctx.lineDashOffset = -((state.t * 18) % 7);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = PIXEL_FONT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = COL.danger;
    ctx.fillText(danger > 0.6 ? 'DANGER !' : 'DANGER', W - 6, y - 2);
    ctx.restore();
  }

  function drawWords() {
    const inPlay = state.phase === 'playing' || state.phase === 'draft';
    const set = inPlay ? targetSet() : [];
    const target = inPlay ? targetWord() : null;
    const tunnelN = tunnelVisible();
    const rev = reversed();
    const light = settings.fx === 'light';

    ctx.font = WORD_FONT;
    ctx.textBaseline = 'top';

    const ordered = state.words.slice().sort((a, b) => a.y - b.y);
    for (const w of ordered) {
      const urgent = w.y + CFG.charH > state.groundY - 130;
      let x = Math.max(4, Math.min(w.x, W - 4 - w.w));
      if (urgent && w === target) x += Math.round(Math.sin(state.t * 42) * 1.5);
      const inSet = set.indexOf(w) >= 0;
      const isTarget = w === target;

      let color = COL.wordIdle;
      if (inSet) color = COL.wordSet;
      if (w.fake) color = COL.fake;
      if (w.harmless) color = COL.splitWord;
      if (isTarget) {
        color = urgent
          ? (Math.sin(state.t * 20) > 0 ? COL.danger : COL.gold)
          : COL.target;
      }

      // Motion trail: fast words leave ghost copies of themselves behind.
      if (!light && state.phase === 'playing') {
        const speedRatio = clamp((state.speed - 54) / 46, 0, 1);
        if (speedRatio > 0.04) {
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.15 * speedRatio;
          ctx.fillText(w.text, x, w.y - 10);
          ctx.globalAlpha = 0.06 * speedRatio;
          ctx.fillText(w.text, x, w.y - 21);
          ctx.globalAlpha = 1;
        }
      }

      const age = state.t - (w.born || 0);
      const spawnPhase = age < 0.24 ? age / 0.24 : 1;
      const spawning = spawnPhase < 1 && !light;
      if (spawning) ctx.globalAlpha = 0.35 + 0.65 * spawnPhase;

      for (let i = 0; i < w.text.length; i++) {
        const pos = rev ? w.text.length - 1 - i : i;
        const typed = pos < w.progress;
        const hidden = tunnelN > 0 && !typed && pos >= w.progress + tunnelN;
        const px = x + i * charW;
        if (hidden) {
          ctx.fillStyle = COL.hidden;
          ctx.fillText('\u00b7', px, w.y);
          continue;
        }
        // Words materialise out of the signal: a few glyphs flicker in first.
        if (spawning && (i * 37 + Math.floor(state.t * 34) * 17) % 7 < 2) continue;

        // Typed letters pop: a short scale-up and a white flash on commit.
        const pop = typed ? state.t - (w.typedAt[pos] || -9) : 9;
        if (pop >= 0 && pop < 0.16) {
          const k = pop / 0.16;
          const scale = 1 + 0.55 * (1 - k);
          ctx.save();
          ctx.translate(px + charW / 2, w.y + CFG.charH / 2);
          ctx.scale(scale, scale);
          ctx.fillStyle = k < 0.35 ? COL.white : COL.typed;
          ctx.fillText(w.text[i], -charW / 2, -CFG.charH / 2);
          ctx.restore();
          continue;
        }

        ctx.fillStyle = typed ? COL.typed : color;
        ctx.fillText(w.text[i], px, w.y);
      }
      if (spawning) ctx.globalAlpha = 1;

      if (isTarget) drawTargetMarker(w, x, urgent);
      else if (inSet) drawSetMarker(w, x);
      if (w.fake) drawFakeMarker(w, x);
      if (w.harmless) drawHarmlessMarker(w, x);
    }
  }

  // Split's free word: dotted teal rule ABOVE the word (fakes are marked below).
  function drawHarmlessMarker(w, x) {
    ctx.save();
    ctx.fillStyle = COL.splitWord;
    for (let px = x; px < x + w.w; px += 3) ctx.fillRect(px, w.y - 4, 2, 1);
    ctx.restore();
  }

  function drawTargetMarker(w, x, urgent) {
    const color = urgent ? COL.danger : COL.target;
    const beat = 0.5 + 0.5 * Math.sin(state.t * (urgent ? 10 : 5.5));
    const progress = w.text.length ? w.progress / w.text.length : 0;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35 + beat * 0.45;
    ctx.lineWidth = urgent && beat > 0.5 ? 2 : 1;
    ctx.setLineDash([2, 2]);
    ctx.lineDashOffset = -((state.t * 24) % 8);
    ctx.strokeRect(x - 5, w.y - 4, w.w + 10, CFG.charH + 6);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Corner brackets on top of the dashed box.
    ctx.fillStyle = color;
    const b = 4;
    ctx.fillRect(x - 5, w.y - 4, b, 2);
    ctx.fillRect(x - 5, w.y - 4, 2, b);
    ctx.fillRect(x + w.w + 5 - b, w.y - 4, b, 2);
    ctx.fillRect(x + w.w + 5 - 2, w.y - 4, 2, b);
    ctx.fillRect(x - 5, w.y + CFG.charH + 2, b, 2);
    ctx.fillRect(x - 5, w.y + CFG.charH + 2 - b + 2, 2, b);
    ctx.fillRect(x + w.w + 5 - b, w.y + CFG.charH + 2, b, 2);
    ctx.fillRect(x + w.w + 5 - 2, w.y + CFG.charH + 2 - b + 2, 2, b);

    // Lock-on caret + typing progress pips under the word.
    const cx = x + w.w / 2;
    ctx.beginPath();
    ctx.moveTo(cx - 4, w.y + CFG.charH + 5);
    ctx.lineTo(cx + 4, w.y + CFG.charH + 5);
    ctx.lineTo(cx, w.y + CFG.charH + 10);
    ctx.closePath();
    ctx.fill();
    const barY = w.y + CFG.charH + 13;
    ctx.fillStyle = 'rgba(128, 128, 128, 0.55)';
    ctx.fillRect(x, barY, w.w, 2);
    ctx.fillStyle = COL.typed;
    ctx.fillRect(x, barY, w.w * progress, 2);
    ctx.restore();
  }

  function drawSetMarker(w, x) {
    ctx.save();
    ctx.fillStyle = COL.wordSet;
    for (let px = x; px < x + w.w; px += 4) ctx.fillRect(px, w.y + CFG.charH + 3, 2, 1);
    ctx.restore();
  }

  function drawFakeMarker(w, x) {
    ctx.save();
    ctx.fillStyle = COL.fake;
    for (let px = x; px < x + w.w; px += 3) ctx.fillRect(px, w.y + CFG.charH + 1, 2, 1);
    ctx.restore();
  }

  function drawParticles() {
    for (const p of state.particles) {
      const a = Math.max(0, Math.min(1, p.life / p.max));
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  // Cleared letters, falling apart with rotation and gravity.
  function drawShards() {
    if (!state.shards.length) return;
    ctx.save();
    ctx.font = WORD_FONT;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const s of state.shards) {
      const a = Math.max(0, Math.min(1, s.life / s.max));
      ctx.globalAlpha = a;
      ctx.fillStyle = s.color;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.scale(s.scale, s.scale);
      ctx.fillText(s.ch, 0, 0);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  function drawRings() {
    if (!state.rings.length) return;
    ctx.save();
    for (const r of state.rings) {
      const a = Math.max(0, Math.min(1, r.life / r.max));
      ctx.globalAlpha = a * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.width;
      ctx.strokeRect(Math.round(r.x - r.r), Math.round(r.y - r.r), Math.round(r.r * 2), Math.round(r.r * 2));
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawPopups() {
    if (!state.popups.length) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of state.popups) {
      const k = 1 - p.life / p.max;
      const fadeIn = clamp((p.max - p.life) / 0.08, 0, 1);
      const fadeOut = clamp(p.life / 0.28, 0, 1);
      ctx.globalAlpha = Math.min(fadeIn, fadeOut);
      ctx.font = 'bold ' + p.size + 'px "Lucida Console", "Courier New", monospace';
      const rise = easeOut(clamp(k * 1.6, 0, 1));
      const y = p.y - 4 * rise;
      if (p.shadow) {
        ctx.fillStyle = '#000000';
        ctx.fillText(p.text, p.x + 2, y + 2);
      }
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, y);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }

  // Wave intro banner. state.waveBanner was dead state before M7; now it lands
  // as a hard-edged title card at the top of the playfield.
  function drawWaveBanner() {
    if (state.waveBanner <= 0) return;
    const t = state.waveBanner;
    const alpha = t > 0.35 ? 1 : t / 0.35;
    const rise = easeOut(clamp((1.6 - t) / 0.4, 0, 1));
    const label = state.endless || state.wave > CFG.wavesPerRun
      ? `WAVE ${state.wave} \u00b7 ENDLESS`
      : `WAVE ${state.wave}`;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 34px "Lucida Console", "Courier New", monospace';
    const y = H * 0.30 + (1 - rise) * 16;
    ctx.fillStyle = '#000000';
    ctx.fillText(label, W / 2 + 3, y + 3);
    ctx.fillStyle = COL.gold;
    ctx.fillText(label, W / 2, y);
    ctx.font = PIXEL_FONT;
    ctx.fillStyle = COL.wordSet;
    ctx.fillText(state.wave <= CFG.wavesPerRun ? 'HOLD THE LINE' : 'THE CHANNEL IS STILL OPEN', W / 2, y + 26);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // Big "wave cleared" title card during the 0.85s beat before the draft.
  function drawWaveClear() {
    if (state.waveClearT <= 0) return;
    const total = 0.85;
    const p = 1 - state.waveClearT / total;
    const pop = easeOut(clamp(p * 5, 0, 1));
    const fade = state.waveClearT < 0.2 ? state.waveClearT / 0.2 : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(W / 2, H * 0.32);
    const s = 0.65 + 0.35 * pop;
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 44px "Lucida Console", "Courier New", monospace';
    ctx.fillStyle = '#000000';
    ctx.fillText('WAVE ' + state.waveClearWave + ' CLEARED', 3, 3);
    ctx.fillStyle = COL.gold;
    ctx.fillText('WAVE ' + state.waveClearWave + ' CLEARED', 0, 0);
    ctx.font = PIXEL_FONT;
    ctx.fillStyle = COL.white;
    ctx.fillText('+ DRAFT INCOMING', 0, 34);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // ─── Application shell (Windows 95 style UI) ──────────────────────────────
  const $ = (id) => document.getElementById(id);
  const nativeHost = (window.chrome && window.chrome.webview) ? window.chrome.webview : null;
  const CARD_TYPE_LABEL = { boon: 'BOON', gambit: 'GAMBIT', hex: 'HEX' };

  const ui = {
    app: $('app'),
    titleBar: $('titleBar'),
    titleText: $('titleText'),
    taskText: $('taskText'),
    taskBtn: $('taskBtn'),
    startBtn: $('startBtn'),
    startMenu: $('startMenu'),
    iconWordfall: $('iconWordfall'),
    iconReadme: $('iconReadme'),
    soundBtn: $('tbSound'),
    menuSound: $('menuSound'),
    menuReroll: $('menuReroll'),
    menuSkip: $('menuSkip'),
    menuPause: $('menuPause'),
    menuPauseLabel: $('menuPauseLabel'),
    menuRecords: $('menuRecords'),
    menuMaximize: $('menuMaximize'),
    menuEffects: $('menuEffects'),
    deckField: $('deckField'),
    modalLayer: $('modalLayer'),
    modalBackdrop: $('modalBackdrop'),
    welcomeBest: $('welcomeBest'),
    aboutBest: $('aboutBest'),
    status: {
      main: $('statusMain'),
      score: $('statusScore'),
      wave: $('statusWave'),
      lives: $('statusLives'),
      shields: $('statusShields'),
      heat: $('statusHeat'),
      combo: $('statusCombo'),
      pressure: $('statusPressure'),
    },
    dialogs: {
      welcome: $('dlgWelcome'),
      draft: $('dlgDraft'),
      gameover: $('dlgGameover'),
      dawn: $('dlgDawn'),
      pause: $('dlgPause'),
      records: $('dlgRecords'),
      controls: $('dlgControls'),
      about: $('dlgAbout'),
      quit: $('dlgQuit'),
    },
    draft: {
      grid: $('draftGrid'),
      meta: $('draftMeta'),
      log: $('draftLog'),
      held: $('draftHeld'),
      note: $('draftNote'),
      reroll: $('draftReroll'),
      skip: $('draftSkip'),
    },
    over: { score: $('overScore'), stats: $('overStats'), deck: $('overDeck') },
    dawn: { score: $('dawnScore'), stats: $('dawnStats'), deck: $('dawnDeck') },
    pause: { seed: $('pauseSeedLine') },
    records: {
      bestScore: $('recBestScore'),
      bestWave: $('recBestWave'),
      bestCombo: $('recBestCombo'),
      runs: $('recRuns'),
      dawns: $('recDawns'),
      words: $('recWords'),
      fastest: $('recFastest'),
    },
  };

  let uiPhase = null;
  let uiDeckKey = '';
  let uiModal = null;
  let resumePhase = null;
  let appOpen = true;

  const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
  const setClass = (el, cls, on) => { if (el) el.classList.toggle(cls, !!on); };

  // ── FX quality + CSS contract ────────────────────────────────────────────
  // game.js owns the numbers; style.css owns the look. The playfield layer is
  // driven by a handful of CSS custom properties on #app and phase/state
  // classes on <body>, so all DOM-side effects are compositor-friendly.
  function toggleEffects() {
    settings.fx = settings.fx === 'light' ? 'full' : 'light';
    saveStore();
    applyFxSettings();
    updateMenuStates();
    if (settings.fx === 'full') ensureAudio();
  }

  function applyFxSettings() {
    if (!document.body) return;
    document.body.classList.toggle('fx-light', settings.fx === 'light');
  }

  let uiFxKey = '';
  function syncFxState() {
    const app = ui.app;
    if (!app) return;
    const combo = Math.min(20, state.combo);
    const danger = state.phase === 'playing' ? Math.round((state.dangerLevel || 0) * 20) / 20 : 0;
    const key = state.phase + '|' + combo + '|' + danger + '|' + state.heat + '|' +
      state.lives + '|' + (state.milestoneT > 0 ? 1 : 0) + '|' + settings.fx;
    if (key === uiFxKey) return;
    uiFxKey = key;
    app.style.setProperty('--fx-combo', String(combo));
    app.style.setProperty('--fx-danger', String(danger));
    app.style.setProperty('--fx-heat', String(state.heat));
    app.style.setProperty('--fx-lives', String(state.lives));
    app.style.setProperty('--fx-wave', String(state.wave));
    const body = document.body;
    for (const phase of ['menu', 'playing', 'paused', 'draft', 'dawn', 'gameover']) {
      body.classList.toggle('phase-' + phase, state.phase === phase);
    }
    body.classList.toggle('fx-combo-hot', combo >= 5);
    body.classList.toggle('fx-danger', danger > 0.55);
    // "Low life" means one life AND a word about to cross - the last life is
    // tense, not permanently red from the first frame.
    body.classList.toggle('fx-low-life', state.lives <= 1 && danger > 0.25);
    body.classList.toggle('fx-milestone', state.milestoneT > 0);
    body.classList.toggle('fx-light', settings.fx === 'light');
  }

  // One-shot status-panel flash, retriggered cleanly even on back-to-back clears.
  // Skipped entirely in headless sims: `void el.offsetWidth` would force a
  // synchronous layout on every clear and make tuning sweeps ~20x slower.
  function pulseStatus(name) {
    if (state.simulating) return;
    const el = ui.status[name];
    if (!el) return;
    el.classList.remove('flash-score');
    void el.offsetWidth;
    el.classList.add('flash-score');
  }

  // ── dialogs ──────────────────────────────────────────────────────────────
  function showDialog(name) {
    const dialog = ui.dialogs[name];
    if (!dialog) return;
    for (const key of Object.keys(ui.dialogs)) {
      setClass(ui.dialogs[key], 'show', ui.dialogs[key] === dialog);
    }
    setClass(ui.modalLayer, 'open', true);
    setClass(ui.app, 'modal-open', true);
    uiModal = name;
  }

  function hideDialogs() {
    for (const key of Object.keys(ui.dialogs)) setClass(ui.dialogs[key], 'show', false);
    setClass(ui.modalLayer, 'open', false);
    setClass(ui.app, 'modal-open', false);
    uiModal = null;
  }

  function phaseDialog() {
    if (state.phase === 'menu') return 'welcome';
    if (state.phase === 'paused') return 'pause';
    if (state.phase === 'draft') return 'draft';
    if (state.phase === 'gameover') return 'gameover';
    if (state.phase === 'dawn') return 'dawn';
    return null;
  }

  function syncToPhase() {
    const name = phaseDialog();
    if (name) showDialog(name);
    else hideDialogs();
  }

  function openOverlay(name) {
    closeMenus();
    ui.startMenu.classList.remove('open');
    if (state.phase === 'playing') {
      resumePhase = 'playing';
      state.phase = 'paused';
    }
    if (name === 'about') populateAbout();
    if (name === 'records') populateRecords();
    if (name === 'controls') ensureAudio();
    showDialog(name);
  }

  function closeOverlay() {
    const resume = resumePhase;
    resumePhase = null;
    if (resume === 'playing' && state.phase === 'paused') state.phase = 'playing';
    syncToPhase();
    updateMenuStates();
  }

  // ── population ───────────────────────────────────────────────────────────
  function populateWelcome() {
    setText(ui.welcomeBest, `Best score: ${state.best}`);
    setText(ui.aboutBest, String(state.best));
  }

  function heldCardsText() {
    const ids = Object.keys(state.deck);
    if (!ids.length) return 'No cards';
    return ids.map((id) => CARD_BY_ID[id].name + (state.deck[id] >= 2 ? ' II' : '')).join(', ');
  }

  function buildDraftCard(card, index) {
    const el = document.createElement('div');
    if (!card) {
      el.className = 'draft-card';
      el.textContent = 'No more cards';
      return el;
    }
    el.className = 'draft-card ' + card.type;
    el.dataset.index = String(index);

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = CARD_TYPE_LABEL[card.type] || card.type.toUpperCase();
    el.appendChild(badge);

    if (card.rarity === 'rare') {
      const rare = document.createElement('span');
      rare.className = 'rare';
      rare.textContent = 'RARE';
      el.appendChild(rare);
    }

    // New card vs tier-II upgrade: the draft tells you what you are buying.
    const tag = document.createElement('span');
    tag.className = card.tier >= 2 ? 'tag-up' : 'tag-new';
    tag.textContent = card.tier >= 2 ? 'UPGRADE' : 'NEW';
    el.appendChild(tag);

    const name = document.createElement('div');
    name.className = 'draft-name';
    name.textContent = card.name + (card.tier >= 2 ? ' II' : '');
    el.appendChild(name);

    const desc = document.createElement('div');
    desc.className = 'draft-desc';
    desc.textContent = card.desc || '';
    el.appendChild(desc);

    const key = document.createElement('div');
    key.className = 'draft-key';
    key.textContent = '[' + (index + 1) + ']';
    el.appendChild(key);

    el.addEventListener('click', () => {
      ensureAudio();
      pick(index);
    });
    return el;
  }

  function populateDraft() {
    const offer = state.offer || [];
    ui.draft.grid.textContent = '';
    for (let i = 0; i < offer.length; i++) ui.draft.grid.appendChild(buildDraftCard(offer[i], i));
    setText(ui.draft.meta, `Wave ${state.wave} cleared · Pressure ${pressure()} · Combo kept`);
    const logLine = state.endless || state.wave > RELAY_LOG.length
      ? ENDLESS_LOG
      : RELAY_LOG[Math.max(0, state.wave - 1)];
    setText(ui.draft.log, `RELAY 12: ${logLine}`);
    setText(ui.draft.held, 'Held: ' + heldCardsText());
    setText(
      ui.draft.note,
      'Press 1, 2 or 3 to pick \u00b7 R to reroll \u00b7 S to skip. Skipping still counts as a draft ' +
      '(pressure +4) and grants +1 Shield for the next wave.'
    );
    ui.draft.reroll.textContent = state.rerollsLeft > 0 ? `Reroll (${state.rerollsLeft})` : 'Reroll (used)';
    ui.draft.reroll.disabled = state.rerollsLeft <= 0;
    ui.draft.skip.textContent = `Skip (+${CFG.skipPointsPerWave * state.wave})`;
    updateMenuStates();
  }

  function populateResult(kind) {
    const parts = kind === 'dawn' ? ui.dawn : ui.over;
    setText(parts.score, fmtInt(state.score));
    const wave = Math.min(state.wave, CFG.wavesPerRun);
    const wordsLabel = state.cleared === 1 ? 'word' : 'words';
    const newBest = state.runStartBest > 0 && state.score > state.runStartBest;
    const statLine =
      `${newBest ? 'NEW BEST! \u00b7 ' : ''}${wpmNow()} WPM \u00b7 ${accuracyNow()}% accuracy \u00b7 ${fmtTime(state.runSec)}` +
      ` \u00b7 Seed ${state.seed}`;
    setText(
      parts.stats,
      kind === 'dawn'
        ? `Run won \u00b7 12 waves cleared \u00b7 ${state.cleared} ${wordsLabel} cleared \u00b7 best combo ${state.bestCombo} \u00b7 ${statLine}`
        : `Wave ${wave} \u00b7 ${state.cleared} ${wordsLabel} cleared \u00b7 best combo ${state.bestCombo} \u00b7 ${statLine}`
    );
    setText(parts.deck, 'Cards: ' + heldCardsText());
  }

  function populateAbout() {
    setText(ui.aboutBest, String(state.best));
  }

  function populateRecords() {
    setText(ui.records.bestScore, String(records.bestScore));
    setText(ui.records.bestWave, String(records.bestWave));
    setText(ui.records.bestCombo, String(records.bestCombo));
    setText(ui.records.runs, String(records.runs));
    setText(ui.records.dawns, String(records.dawns));
    setText(ui.records.words, String(records.words));
    setText(ui.records.fastest, records.fastestDawnSec ? fmtTime(records.fastestDawnSec) : '-');
  }

  function populatePause() {
    setText(
      ui.pause.seed,
      `Seed ${state.seed} \u00b7 ${fmtTime(state.runSec)} played \u00b7 ` +
      `Wave ${Math.min(state.wave, CFG.wavesPerRun)} \u00b7 ${wpmNow()} WPM \u00b7 ` +
      `combo \u00d7${comboMultiplier().toFixed(2)}`
    );
  }

  // ── menu / toolbar state ─────────────────────────────────────────────────
  function updateMenuStates() {
    setClass(ui.menuReroll, 'disabled', !(state.phase === 'draft' && state.rerollsLeft > 0));
    setClass(ui.menuSkip, 'disabled', state.phase !== 'draft');
    const canPause = state.phase === 'playing' || state.phase === 'paused';
    setText(ui.menuPauseLabel, state.phase === 'paused' ? 'Resume' : 'Pause');
    setClass(ui.menuPause, 'disabled', !canPause);
    setText(ui.menuSound, state.muted ? 'Sound: Off' : 'Sound: On');
    setText(ui.menuEffects, settings.fx === 'light' ? 'Effects: Light' : 'Effects: Full');
    setText(ui.menuMaximize, ui.app.classList.contains('maximized') ? 'Restore' : 'Maximize');
    setClass(ui.soundBtn, 'off', !!state.muted);
    if (ui.draft.reroll) ui.draft.reroll.disabled = state.rerollsLeft <= 0;
  }

  function updateMenuBar() {
    updateMenuStates();
  }

  function updateStatus() {
    const phaseText = {
      menu: 'Ready',
      playing: 'Playing' + (state.combo > 0 ? ` · combo x${comboMultiplier().toFixed(2)}` : ''),
      paused: 'Paused',
      draft: 'Draft - choose a card',
      dawn: 'Dawn - run won',
      gameover: 'Signal lost',
    }[state.phase] || 'Ready';
    setText(ui.status.main, phaseText);
    setText(ui.status.score, `Score: ${fmtInt(state.score)}`);
    setText(ui.status.combo, `Combo: ${comboMultiplier().toFixed(2)}\u00d7`);
    setText(
      ui.status.wave,
      state.endless ? `Wave: ${state.wave} (endless)` : `Wave: ${Math.min(state.wave, CFG.wavesPerRun)}/${CFG.wavesPerRun}`
    );
    setText(ui.status.lives, `Lives: ${state.lives}`);
    setText(ui.status.shields, `Shields: ${state.shields}/${Math.max(state.shieldMax, state.shields)}`);
    setText(ui.status.heat, `Heat: ${state.heat}`);
    setText(ui.status.pressure, `Pressure: ${pressure()}`);
  }

  function updateTitle() {
    let label = 'Untitled';
    if (state.phase === 'paused') {
      label = 'Paused';
    } else if (state.phase === 'playing') {
      label = `Wave ${Math.min(state.wave, CFG.wavesPerRun)}` + (state.endless ? ' (endless)' : '');
    } else if (state.phase === 'draft') label = 'Draft';
    else if (state.phase === 'dawn') label = 'Dawn';
    else if (state.phase === 'gameover') label = 'Signal Lost';
    const title = `Wordfall - ${label}`;
    setText(ui.titleText, title);
    setText(ui.taskText, title);
  }

  function updateDeckField() {
    setText(ui.deckField, heldCardsText());
  }

  function onPhaseChange() {
    if (state.phase === 'draft') populateDraft();
    if (state.phase === 'paused') populatePause();
    if (state.phase === 'gameover') populateResult('gameover');
    if (state.phase === 'dawn') populateResult('dawn');
    if (state.phase === 'menu') populateWelcome();
    updateMenuStates();
    if (uiModal === 'controls' || uiModal === 'about' || uiModal === 'quit' || uiModal === 'records') return;
    syncToPhase();
  }

  function syncUi(force) {
    updateStatus();
    updateTitle();
    syncFxState();
    const deckKey = Object.keys(state.deck).map((id) => id + ':' + state.deck[id]).join(',');
    if (force || deckKey !== uiDeckKey) {
      uiDeckKey = deckKey;
      updateDeckField();
    }
    updateMenuBar();
    if (force || uiPhase !== state.phase) {
      uiPhase = state.phase;
      onPhaseChange();
    }
  }

  // ── window behaviour ─────────────────────────────────────────────────────
  function hostMessage(message) {
    if (nativeHost) nativeHost.postMessage(message);
  }

  function closeMenus() {
    document.querySelectorAll('.menu-item.open').forEach((m) => m.classList.remove('open'));
  }

  function openMenuByName(name) {
    closeMenus();
    const item = document.querySelector(`.menu-item[data-menu="${name}"]`);
    if (item) item.classList.add('open');
  }

  function pauseGame() {
    if (state.phase !== 'playing') return false;
    closeMenus();
    ui.startMenu.classList.remove('open');
    resumePhase = null;
    state.phase = 'paused';
    syncUi(true);
    return true;
  }

  function resumeGame() {
    if (state.phase !== 'paused') return false;
    state.phase = 'playing';
    syncUi(true);
    return true;
  }

  function startNewRun(seed) {
    closeMenus();
    ui.startMenu.classList.remove('open');
    resumePhase = null;
    hideDialogs();
    ensureAudio();
    reset(seed);
    syncUi(true);
  }

  function toggleSound() {
    state.muted = !state.muted;
    settings.muted = state.muted;
    saveStore();
    if (!state.muted) ensureAudio();
    updateMenuStates();
    setClass(ui.soundBtn, 'off', !!state.muted);
  }

  function setAppOpen(open) {
    appOpen = open;
    setClass(ui.app, 'gone', !open);
    setClass(ui.taskBtn, 'hidden', !open);
    if (open) setClass(ui.app, 'minimized', false);
  }

  function onMinimize() {
    closeMenus();
    if (nativeHost) { hostMessage('min'); return; }
    setClass(ui.app, 'minimized', true);
    setClass(ui.taskBtn, 'raised', true);
    if (state.phase === 'playing') {
      resumePhase = 'playing';
      state.phase = 'paused';
    }
  }

  function restoreApp() {
    if (!appOpen) setAppOpen(true);
    setClass(ui.app, 'minimized', false);
    setClass(ui.taskBtn, 'raised', false);
    if (state.phase === 'paused' && resumePhase === 'playing') {
      state.phase = 'playing';
      resumePhase = null;
      syncToPhase();
    }
    closeMenus();
    ui.startMenu.classList.remove('open');
  }

  function toggleMaximize() {
    closeMenus();
    if (nativeHost) { hostMessage('max'); return; }
    const maximized = ui.app.classList.toggle('maximized');
    setText(ui.menuMaximize, maximized ? 'Restore' : 'Maximize');
  }

  function onClose() {
    closeMenus();
    ui.startMenu.classList.remove('open');
    if (nativeHost) { hostMessage('close'); return; }
    openOverlay('quit');
  }

  function quitConfirmed() {
    if (nativeHost) { hostMessage('close'); return; }
    hideDialogs();
    resumePhase = null;
    setAppOpen(false);
    if (state.phase === 'playing' || state.phase === 'paused') {
      state.phase = 'menu';
      state.words.length = 0;
      state.echoes.length = 0;
      state.particles.length = 0;
      state.lockWord = null;
    }
    syncUi(true);
  }

  function runCommand(cmd) {
    closeMenus();
    ui.startMenu.classList.remove('open');
    switch (cmd) {
      case 'new': startNewRun(); break;
      case 'exit': onClose(); break;
      case 'restore': setAppOpen(true); restoreApp(); break;
      case 'reroll':
        if (state.phase === 'draft' && reroll()) populateDraft();
        break;
      case 'skip':
        if (state.phase === 'draft') skip();
        break;
      case 'sound': toggleSound(); break;
      case 'effects': toggleEffects(); break;
      case 'pause':
        if (state.phase === 'playing') pauseGame();
        else if (state.phase === 'paused') resumeGame();
        break;
      case 'records': openOverlay('records'); break;
      case 'maximize': toggleMaximize(); break;
      case 'controls': openOverlay('controls'); break;
      case 'about': openOverlay('about'); break;
      // The desktop shell owns the updater; in a browser just point at the releases.
      case 'update':
        if (nativeHost) hostMessage('check-update');
        else window.open('https://github.com/Boci0/wordfall/releases/latest', '_blank', 'noopener');
        break;
      case 'shutdown': onClose(); break;
      default: break;
    }
  }

  function click(id, fn) {
    const el = $(id);
    if (!el) return;
    el.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (el.blur) el.blur();
      ensureAudio();
      fn();
    });
  }

  function updateClock() {
    const now = new Date();
    let h = now.getHours();
    const m = String(now.getMinutes()).padStart(2, '0');
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    setText($('clock'), `${h}:${m} ${ap}`);
  }

  function initUi() {
    if (nativeHost) document.body.classList.add('embedded');
    applyFxSettings();

    // title bar
    click('btnMin', onMinimize);
    click('btnMax', toggleMaximize);
    click('btnClose', onClose);
    ui.titleBar.addEventListener('dblclick', (event) => {
      if (!event.target.closest('.title-btn, .title-buttons')) toggleMaximize();
    });
    let drag = null;
    ui.titleBar.addEventListener('mousedown', (event) => {
      if (event.target.closest('.title-btn, .title-buttons')) return;
      if (nativeHost) { hostMessage('drag'); return; }
      const rect = ui.app.getBoundingClientRect();
      drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      event.preventDefault();
    });
    document.addEventListener('mousemove', (event) => {
      if (!drag) return;
      const left = Math.max(-ui.app.offsetWidth + 100, Math.min(window.innerWidth - 100, event.clientX - drag.dx));
      const top = Math.max(0, Math.min(window.innerHeight - 60, event.clientY - drag.dy));
      ui.app.style.left = left + 'px';
      ui.app.style.top = top + 'px';
      ui.app.style.transform = 'none';
    });
    document.addEventListener('mouseup', () => { drag = null; });

    // menus
    document.querySelectorAll('.menu-item').forEach((item) => {
      const label = item.querySelector('.menu-label');
      label.addEventListener('mousedown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (item.classList.contains('open')) closeMenus();
        else {
          closeMenus();
          item.classList.add('open');
        }
      });
      item.addEventListener('mouseenter', () => {
        if (document.querySelector('.menu-item.open')) {
          closeMenus();
          item.classList.add('open');
        }
      });
    });
    document.querySelectorAll('.drop-item').forEach((item) => {
      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (item.classList.contains('disabled')) return;
        runCommand(item.dataset.cmd);
      });
    });
    document.addEventListener('mousedown', (event) => {
      if (!event.target.closest('.menu-bar')) closeMenus();
      if (!event.target.closest('#startMenu') && !event.target.closest('#startBtn')) {
        ui.startMenu.classList.remove('open');
        ui.startBtn.classList.remove('open');
      }
    });

    // toolbar
    click('tbNew', startNewRun);
    click('tbSound', toggleSound);
    click('tbHelp', () => openOverlay('controls'));

    // desktop and taskbar
    click('taskBtn', restoreApp);
    click('startBtn', () => {
      const open = ui.startMenu.classList.toggle('open');
      setClass(ui.startBtn, 'open', open);
    });
    document.querySelectorAll('.start-item').forEach((item) => {
      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        runCommand(item.dataset.cmd);
      });
    });
    ui.iconWordfall.addEventListener('click', () => {
      ui.iconWordfall.classList.add('selected');
      ui.iconReadme.classList.remove('selected');
    });
    ui.iconWordfall.addEventListener('dblclick', () => { setAppOpen(true); restoreApp(); });
    ui.iconReadme.addEventListener('click', () => {
      ui.iconReadme.classList.add('selected');
      ui.iconWordfall.classList.remove('selected');
    });
    ui.iconReadme.addEventListener('dblclick', () => {
      setAppOpen(true);
      openOverlay('controls');
    });

    // dialogs
    click('welcomeStart', startNewRun);
    click('welcomeControls', () => openOverlay('controls'));
    click('controlsOk', closeOverlay);
    click('aboutOk', closeOverlay);
    click('recordsOk', closeOverlay);
    click('quitNo', closeOverlay);
    click('quitYes', quitConfirmed);
    click('overRetry', () => startNewRun());
    click('overSeed', () => startNewRun(state.seed));
    click('overQuit', onClose);
    click('pauseResume', resumeGame);
    click('pauseRestart', () => startNewRun());
    click('pauseControls', () => openOverlay('controls'));
    click('dawnKeep', () => {
      ensureAudio();
      continueEndless();
    });
    click('dawnNew', startNewRun);
    ui.modalBackdrop.addEventListener('click', () => {
      if (uiModal === 'controls' || uiModal === 'about' || uiModal === 'quit' || uiModal === 'records') closeOverlay();
    });
    ui.draft.reroll.addEventListener('click', () => {
      ensureAudio();
      if (reroll()) populateDraft();
    });
    ui.draft.skip.addEventListener('click', () => {
      ensureAudio();
      skip();
    });

    // native window messages (maximized state)
    if (nativeHost) {
      nativeHost.addEventListener('message', (event) => {
        try {
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (data && data.type === 'maximized') setText(ui.menuMaximize, data.value ? 'Restore' : 'Maximize');
        } catch (e) { /* ignore non-JSON host messages */ }
      });
    }

    updateClock();
    setInterval(updateClock, 15000);
    updateMenuStates();
    syncUi(true);
  }

  // ─── Audio (M4) ───────────────────────────────────────────────────────────
  let ac = null;

  function ensureAudio() {
    if (state.simulating || state.muted) return;
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
      }
      if (ac.state === 'suspended') ac.resume().catch(() => {});
    } catch (e) { /* audio is optional */ }
  }

  function tone(freq, dur = 0.08, type = 'sine', gain = 0.04, slideTo = 0, when = 0) {
    if (!ac || state.muted || state.simulating) return;
    try {
      const t0 = ac.currentTime + when;
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(Math.max(20, freq), t0);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(ac.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch (e) { /* ignore */ }
  }

  function playKey(pos, len) {
    // Rising pitch as the word fills in; tiny click per committed letter.
    const pitch = 120 + (pos || 1) * 13 + (len || 4) * 5;
    tone(pitch, 0.018, 'square', 0.010);
    if ((pos || 1) === 1) tone(pitch * 2, 0.012, 'square', 0.004);
  }
  function playClear(combo, proximity, close, letters) {
    // A three-note chord whose root climbs with the combo, plus a low thump
    // that gets heavier the closer the word was to the line.
    const step = Math.min(combo || 0, 24);
    const root = 196 * Math.pow(2, step / 12);
    tone(root, 0.10, 'triangle', 0.045);
    tone(root * 1.5, 0.07, 'sine', 0.022, 0, 0.015);
    tone(root * 2, 0.05, 'sine', 0.014, 0, 0.03);
    tone(70 + (proximity || 0) * 30, 0.16, 'sine', 0.05 + (proximity || 0) * 0.04, 42);
    if (close) tone(1046, 0.09, 'square', 0.018, 1568, 0.05);
    if (letters >= 8) tone(root * 2.5, 0.05, 'sine', 0.012, 0, 0.06);
  }
  function playMilestone(combo) {
    const base = 330 * Math.pow(2, Math.min(combo || 10, 30) / 24);
    for (let i = 0; i < 4; i++) tone(base * Math.pow(2, i / 4), 0.12, 'square', 0.028, 0, i * 0.055);
    tone(64, 0.22, 'sine', 0.05, 40);
  }
  function playAutoClear() {
    tone(660, 0.05, 'sine', 0.02);
    tone(990, 0.04, 'sine', 0.012, 0, 0.03);
  }
  function playWave() {
    tone(262, 0.09, 'square', 0.025, 0, 0);
    tone(392, 0.09, 'square', 0.025, 0, 0.09);
    tone(523, 0.14, 'triangle', 0.03, 0, 0.18);
  }
  function playWaveClear() {
    const notes = [392, 523, 659, 784, 1046];
    notes.forEach((n, i) => tone(n, 0.16, 'square', 0.026, 0, i * 0.07));
    tone(60, 0.3, 'sine', 0.06, 40);
  }
  function playMistake() {
    tone(112, 0.12, 'square', 0.03, 70);
  }
  function playShield() {
    tone(880, 0.07, 'sine', 0.03, 1250);
  }
  function playHit() {
    tone(72, 0.4, 'sawtooth', 0.08, 34);
  }
  function playLifeline() {
    tone(523, 0.16, 'triangle', 0.05, 0, 0);
    tone(784, 0.16, 'triangle', 0.05, 0, 0.1);
    tone(1046, 0.3, 'sine', 0.05, 0, 0.2);
    tone(64, 0.35, 'sine', 0.06, 40, 0.05);
  }
  function playDraft() {
    tone(330, 0.1, 'sine', 0.03, 0, 0);
    tone(440, 0.1, 'sine', 0.03, 0, 0.1);
    tone(590, 0.16, 'sine', 0.035, 0, 0.2);
  }
  function playPick() {
    tone(520, 0.08, 'triangle', 0.04, 0, 0);
    tone(780, 0.12, 'triangle', 0.04, 0, 0.08);
  }
  function playDawn() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => tone(n, 0.22, 'sine', 0.04, 0, i * 0.12));
  }

  // ─── Loop ─────────────────────────────────────────────────────────────────
  function frame(now) {
    const dt = state.lastTime ? Math.min(0.05, (now - state.lastTime) / 1000) : 0;
    state.lastTime = now;

    // Adaptive FX budget: watch the real frame time only while the board is
    // live (menus and dialogs are cheap and would bias the average).
    if (!state.simulating && dt > 0 && state.phase === 'playing') {
      perfAccMs += dt * 1000;
      perfFrames += 1;
      if (perfFrames >= 90) {
        perfAvgMs = perfAccMs / perfFrames;
        perfAccMs = 0;
        perfFrames = 0;
        if (perfAvgMs > 21.5 && fxPressure > 0.45) {
          fxPressure = Math.max(0.45, fxPressure - 0.2);
        } else if (perfAvgMs < 17.8 && fxPressure < 1) {
          fxPressure = Math.min(1, fxPressure + 0.1);
        }
      }
    }

    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  // ─── Input ────────────────────────────────────────────────────────────────
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey) return;

    if (event.altKey) {
      // Win95 menu accelerators: Alt+F / Alt+G / Alt+V / Alt+H.
      const menu = { f: 'file', g: 'game', v: 'view', h: 'help' }[event.key.toLowerCase()];
      if (menu && !uiModal) {
        event.preventDefault();
        ensureAudio();
        openMenuByName(menu);
      }
      return;
    }

    ensureAudio();

    // A user-opened dialog (Controls / About / Records / Quit) captures Enter and Esc.
    if (uiModal === 'controls' || uiModal === 'about' || uiModal === 'quit' || uiModal === 'records') {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        closeOverlay();
      }
      return;
    }

    if (event.key === 'F2') {
      event.preventDefault();
      startNewRun();
      return;
    }

    // Paused: Escape / Enter resume. Every other key is swallowed so the board
    // stays frozen and no letters leak into the next run.
    if (state.phase === 'paused') {
      if (event.key === 'Escape' || event.key === 'Enter') {
        if (event.key === 'Escape') {
          closeMenus();
          ui.startMenu.classList.remove('open');
        }
        event.preventDefault();
        resumeGame();
        return;
      }
      event.preventDefault();
      return;
    }

    // Escape pauses; a printable letter can never be a hotkey in a typing game.
    if (event.key === 'Escape') {
      const hadMenu = !!document.querySelector('.menu-item.open') || ui.startMenu.classList.contains('open');
      closeMenus();
      ui.startMenu.classList.remove('open');
      if (state.phase === 'playing' && !hadMenu) pauseGame();
      event.preventDefault();
      return;
    }

    if (event.key === 'Enter') {
      if (state.phase === 'menu' || state.phase === 'gameover') reset();
      else if (state.phase === 'dawn') continueEndless();
      event.preventDefault();
      return;
    }

    if (state.phase === 'draft') {
      if (event.key === '1' || event.key === '2' || event.key === '3') {
        pick(Number(event.key) - 1);
        event.preventDefault();
        return;
      }
      if (event.key === 'r' || event.key === 'R') {
        if (reroll()) populateDraft();
        event.preventDefault();
        return;
      }
      if (event.key === 's' || event.key === 'S') {
        skip();
        event.preventDefault();
        return;
      }
      event.preventDefault();
      return;
    }

    if (event.key === ' ' || event.key === 'Backspace') {
      event.preventDefault();
      return;
    }

    if (event.key.length === 1 && state.phase === 'playing') {
      typeLetter(event.key.toLowerCase());
      event.preventDefault();
    }
  });

  window.addEventListener('pointerdown', ensureAudio);
  window.addEventListener('resize', resize);

  // ─── Headless bot simulation ──────────────────────────────────────────────
  // Drives a full run synchronously with a virtual clock so tuning sweeps are
  // fast. `mode` is the draft policy: 'random' picks a card, 'skip' never does.
  function sim(opts = {}) {
    const wpm = Math.max(10, Number(opts.wpm) || 60);
    const mode = opts.mode === 'skip' ? 'skip' : 'random';
    const seed = opts.seed == null ? 1 : opts.seed;
    const maxSec = Number(opts.maxSec) || 1500;
    const mistakeRate = clamp(Number(opts.mistakeRate) || 0, 0, 0.5);
    const draftPause = opts.draftPauseSec == null ? CFG.draftPause : Number(opts.draftPauseSec);
    const charInterval = 60 / (wpm * 5);
    const dt = 1 / 60;

    const prevSim = state.simulating;
    reset(seed);
    state.simulating = true;
    if (Array.isArray(opts.grant)) {
      for (const item of opts.grant) {
        if (typeof item === 'string') grant(item, 1);
        else if (item && item.id) grant(item.id, item.tier || 1);
      }
    }

    const cards = [];
    let seconds = 0;
    let charT = 0.35;

    try {
      while (seconds < maxSec) {
        update(dt);
        seconds += dt;

        if (state.phase === 'gameover') break;
        if (state.phase === 'dawn') break;

        if (state.phase === 'draft') {
          seconds += draftPause;                     // reading time, for duration estimates
          if (mode === 'skip') {
            skip();
          } else {
            const idx = [];
            for (let i = 0; i < 3; i++) if (state.offer && state.offer[i]) idx.push(i);
            if (idx.length) {
              const picked = pick(idx[(rng() * idx.length) | 0]);
              if (picked) cards.push(picked);
            } else {
              skip();
            }
          }
          charT = 0.2;
          continue;
        }

        if (state.phase !== 'playing') continue;

        charT -= dt;
        if (charT > 0) continue;

        const word = targetWord();
        if (!word || word.fake) {
          charT = 0.08;                              // wait for fakes to fall through
          continue;
        }
        const ch = nextChar(word);
        if (!ch) { charT = 0.05; continue; }

        if (mistakeRate > 0 && rng() < mistakeRate) {
          const alphabet = 'abcdefghijklmnopqrstuvwxyz';
          let wrong = alphabet[(rng() * 26) | 0];
          if (wrong === ch) wrong = wrong === 'a' ? 'e' : 'a';
          typeLetter(wrong);
        } else {
          typeLetter(ch);
        }
        charT = charInterval;
      }
    } finally {
      state.simulating = prevSim;
    }

    return {
      wpm,
      mode,
      seed,
      dawn: state.dawn,
      died: state.phase === 'gameover',
      cleared: state.cleared,
      wave: state.wave,
      score: state.score,
      pressure: pressure(),
      seconds: Math.round(seconds),
      cards,
      bestCombo: state.bestCombo,
    };
  }

  // ─── Debug / test hook ────────────────────────────────────────────────────
  window.__wordfall = {
    version: 'M7',
    state,
    CFG,
    CARDS: CARD_LIST,
    records,
    settings,
    reset,
    newRun: reset,
    pause: pauseGame,
    resume: resumeGame,
    stats: () => ({
      keys: state.keys,
      mistakes: state.mistakes,
      runSec: state.runSec,
      wpm: wpmNow(),
      accuracy: accuracyNow(),
    }),
    fxState: () => ({
      quality: settings.fx,
      particles: state.particles.length,
      shards: state.shards.length,
      rings: state.rings.length,
      popups: state.popups.length,
      milestone: state.milestoneT > 0,
      danger: state.dangerLevel,
      cssCombos: document.body.classList.contains('fx-combo-hot'),
    }),
    toggleEffects,
    perf: () => ({
      avgMs: Number(perfAvgMs.toFixed(2)),
      fps: perfAvgMs ? Math.round(1000 / perfAvgMs) : 0,
      pressure: Number(fxPressure.toFixed(2)),
      quality: settings.fx,
    }),
    hexTotal: HEX_TOTAL,
    typeLetter,
    targetWord,
    targetSet,
    spawnWord,
    spawnOne: spawn,
    beginDraft: openDraft,
    pick,
    reroll,
    skip,
    setSeed,
    grant,
    has,
    heldTier,
    pressure,
    heat,
    heatMult,
    comboMultiplier,
    speedMult,
    scoreMult,
    spawnInterval,
    rerollsLeft: () => state.rerollsLeft,
    nextChar,
    visibleCount,
    wordRange,
    bucketPressure,
    isFake: (w) => !!(w && w.fake),
    sim,
    rng,
  };

  // ─── Boot ─────────────────────────────────────────────────────────────────
  resize();
  initUi();
  if (window.ResizeObserver) {
    new ResizeObserver(() => resize()).observe($('client'));
  }
  requestAnimationFrame(frame);
})();
