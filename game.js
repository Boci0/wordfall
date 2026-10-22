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
    // Demand curve: spawns are derived from a target typing speed instead of a
    // linear timer. The targets come from real typing-speed data (median typist
    // ~35-45 WPM; top 10% ~65-80): wave 1 asks ~16 WPM, wave 6 ~36 (around the
    // median), wave 12 ~92 (top ~1-2% for Dawn). `demandCurve` > 1 keeps the
    // early waves gentle and spends the difficulty in the last third, so
    // progress tracks a player's real speed instead of hitting one flat wall.
    baseSpeed: 54,            // px/s at a 900px-tall viewport
    speedPerClear: 0.43,
    maxSpeed: 120,
    demandStart: 16,          // sustained WPM implied by spawn rate at wave 1
    demandEnd: 92,            // ...at the start of wave 12 (the last full-pressure point)
    demandCurve: 1.82,        // >1 = gentle start, steeper finish
    spawnMin: 0.88,           // hard safety floor, never reached in a 12-wave run
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
    fxMaxStreaks: 150,
    // Word motion trails: one history sample every `trailEvery` seconds, up to
    // `trailLen` samples. The samples are visual-only (never read by a rule).
    trailEvery: 0.045,
    trailLen: 10,
    // Fakes "fall through" rather than settling in the queue: they drop faster
    // so a Decoy blocks the target for seconds, not for a whole fall.
    fakeSpeedMult: 4.5,
    // Flares: an occasional short word that races down the board. It scores
    // like any other word, but if it reaches the line it slips through
    // harmlessly instead of costing a Life. Purely for liveliness; the gap is
    // a time range in seconds.
    flareMinGap: 13,
    flareMaxGap: 25,
    flareSpeedMult: 2.5,
  };

  // ─── Custom stages ────────────────────────────────────────────────────────
  // A practice mode built from pasted text: no cards, no lives, no pressure.
  // `lines` turns the text into single-row segments typed in full (spaces and
  // punctuation included); `words` drops the text's words as ordinary falling
  // targets that must all be cleared. Completion is the win; the clock and the
  // accuracy readout are the score.
  const CUSTOM = {
    maxTextChars: 12000,      // localStorage + layout sanity cap
    maxLines: 400,            // segments of one pasted text
    maxTokens: 600,           // falling-words instances
    maxTokenLen: 16,
    maxStages: 20,
    previewSec: 3.5,          // Memorize: how long a fresh line stays visible
    practiceSpeed: 42,        // px/s, fixed and gentle (no pressure ramp)
    practiceSpawn: 1.45,      // seconds between falling words
    practiceMaxWords: 6,
    nextLineGap: 0.34,        // beat between a cleared line and the next one
    minSegChars: 16,
    // Cards - reveal-and-grade recall. Nothing is typed: a card costs one
    // thought, and the grade (not a keystroke match) is the score.
    maxCards: 200,            // cards in one deck
    cardMaxPrompt: 120,       // characters of a prompt
    cardMaxAnswer: 240,       // characters of an answer
    cardRecallSec: 10,        // fall time before an unanswered card is missed
    cardRepeatGap: 4,         // an "again" card returns this many cards later
    cardTimeoutRevealSec: 1.8, // how long a timed-out answer stays up
  };

  // ─── Difficulty ───────────────────────────────────────────────────────────
  // Difficulty is a survivability dial, not a scoring one: the record book and
  // the achievements are shared, so the numbers on screen stay comparable. A
  // harder run simply reaches fewer points before it ends.
  const DIFFICULTIES = {
    casual: {
      id: 'casual',
      name: 'Casual',
      startLives: 2,
      speed: 0.85,
      spawn: 1.15,
      desc: 'Two lives · words fall 15% slower · spawns 15% slower',
    },
    standard: {
      id: 'standard',
      name: 'Standard',
      startLives: 1,
      speed: 1,
      spawn: 1,
      desc: 'One life · the balance the game is tuned around',
    },
    nightmare: {
      id: 'nightmare',
      name: 'Nightmare',
      startLives: 1,
      speed: 1.15,
      spawn: 0.9,
      desc: 'One life · words fall 15% faster · spawns 10% tighter',
    },
  };
  const DIFFICULTY_ORDER = ['casual', 'standard', 'nightmare'];

  function difficulty() {
    return DIFFICULTIES[settings.difficulty] || DIFFICULTIES.standard;
  }
  function difficultyName() {
    return difficulty().name;
  }

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

  // Attract mode behind the main screen: relay-flavoured words drifting down the
  // soft-focus field. Presentation only, never read by a rule.
  const MENU_RAIN_WORDS = [
    'signal', 'relay', 'dawn', 'static', 'transmit', 'frequency',
    'hold', 'line', 'wordfall', 'night', 'operator', 'channel',
  ];

  // Win95 palette for chrome, plus a few "signal" accents the playfield uses.
  // The backdrop is full colour now; the word colours stay high-contrast so the
  // rules remain readable on top of the warp.
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
    danger: '#ff0033',
    wordIdle: '#b9b3cc',
    wordSet: '#eeeeff',
    target: '#ffff00',
    typed: '#39ff14',
    fake: '#ff2bd1',
    splitWord: '#25f4ff',
    flare: '#8dfff2',
    hidden: '#6a6070',
    echo: 'rgba(200, 200, 255, 0.26)',
    accent: '#ffff00',
    white: '#ffffff',
    gold: '#ffff00',
    amber: '#ffe066',
    scan: '#00f0ff',
  };

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  // ─── Psychedelic palette ──────────────────────────────────────────────────
  // The Win95 chrome stays 16-colour; the playfield has been taken over by the
  // signal. Everything behind the words is full colour, hue-cycled and warped.
  // Time- and index-derived only - never the seeded gameplay RNG.
  const MOD = (n, m) => ((n % m) + m) % m;
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  function hsl(h, s, l, a) {
    h = MOD(h, 1);
    s = clamp(s, 0, 1);
    l = clamp(l, 0, 1);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = Math.round(hue2rgb(p, q, h + 1 / 3) * 255);
    const g = Math.round(hue2rgb(p, q, h) * 255);
    const b = Math.round(hue2rgb(p, q, h - 1 / 3) * 255);
    return a == null ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
  }
  // Hue positions for sparks / shards / callouts so the whole effect layer
  // shares the background's colour wheel instead of the old 16-colour set.
  const NEON = (t) => hsl(t * 0.13 + 0.08, 1, 0.62);
  const TRIPPY = ['#ff2bd1', '#25f4ff', '#b6ff1a', '#ffae00', '#8a5bff', '#ff3b3b', '#ffffff'];

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
  // The playfield is drawn into a small offscreen scene and then upscaled with
  // smoothing. That is the "blurry filter over everything": words, particles and
  // backdrop are all rendered soft, and - the real win - the canvas only paints
  // a fraction of the pixels, which is where most of the old lag came from.
  // The Win95 chrome around the playfield is ordinary DOM, so it stays crisp.
  const canvas = document.getElementById('game');
  const out = canvas.getContext('2d');
  const scene = document.createElement('canvas');
  const sctx = scene.getContext('2d');
  const SCENE_SCALE = 0.55;      // lower = heavier blur + faster; raise for clarity
  let ctx = out;                 // active context: scene while drawing, out for the blit

  // Practice-only "Sharp text": render the scene 1:1 instead of at 0.55 and
  // upscaling it, so card prompts, answers and key hints stay legible. The
  // roguelite keeps its soft-focus look regardless of the setting.
  function sharpPractice() {
    return !!(state.custom && settings.crisp);
  }

  let W = 0;
  let H = 0;
  let charW = 0;
  const drawOrder = [];          // reused scratch list for back-to-front word draw

  // A transform-free 2D context used only for measureText. Custom stages can
  // contain CJK, whose glyph advance is not the ASCII monospace width, so line
  // wrapping and per-glyph drawing ask the real font instead of multiplying.
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  function measureLogicalWidth(text) {
    mctx.font = WORD_FONT;
    return mctx.measureText(String(text)).width;
  }

  // Cumulative x offsets and per-glyph advances for one word/line. Pure ASCII
  // takes the cheap monospace path, so the roguelite and old stages render
  // pixel-identically.
  function glyphMetrics(text) {
    const n = text.length;
    const offsets = new Array(n);
    const widths = new Array(n);
    const ascii = /^[\x20-\x7e]*$/.test(text);
    let x = 0;
    if (!ascii) mctx.font = WORD_FONT;
    for (let i = 0; i < n; i++) {
      offsets[i] = x;
      const advance = ascii ? charW : (mctx.measureText(text[i]).width || charW);
      widths[i] = advance;
      x += advance;
    }
    return { offsets, widths, width: x };
  }

  // Slow, dim colour drifting behind the words. These are a handful of huge,
  // low-alpha discs - not warped shapes - and the low-resolution upscale turns
  // them into soft, out-of-focus blobs.
  const BG_BLOBS = [
    { hue: 0.56, x: 0.24, y: 0.28, r: 0.55, l: 0.16, a: 0.55, sx: 0.07, sy: 0.05, ph: 0.0 },
    { hue: 0.72, x: 0.74, y: 0.22, r: 0.50, l: 0.14, a: 0.50, sx: 0.05, sy: 0.09, ph: 1.7 },
    { hue: 0.84, x: 0.58, y: 0.60, r: 0.60, l: 0.13, a: 0.60, sx: 0.09, sy: 0.06, ph: 3.1 },
    { hue: 0.94, x: 0.20, y: 0.72, r: 0.45, l: 0.13, a: 0.50, sx: 0.04, sy: 0.08, ph: 4.4 },
    { hue: 0.46, x: 0.82, y: 0.75, r: 0.50, l: 0.13, a: 0.45, sx: 0.08, sy: 0.05, ph: 2.2 },
    { hue: 0.10, x: 0.45, y: 0.05, r: 0.35, l: 0.12, a: 0.35, sx: 0.06, sy: 0.07, ph: 5.3 },
  ];

  function resize() {
    const viewW = canvas.clientWidth || window.innerWidth;
    const viewH = canvas.clientHeight || window.innerHeight;
    // The rules live in a fixed 800-unit-tall logical playfield, uniformly
    // scaled to the window (fall times stay identical at any window size).
    const scale = Math.max(0.5, viewH / 800);
    W = viewW / scale;
    H = 800;

    // Output at 1:1 CSS pixels. The scene is upscaled into it anyway, so a 2x
    // backing store would only multiply the blit cost for no visible gain.
    canvas.width = Math.max(1, Math.round(viewW));
    canvas.height = Math.max(1, Math.round(viewH));
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.imageSmoothingEnabled = true;
    out.imageSmoothingQuality = 'low';

    const sceneScale = sharpPractice() ? 1 : SCENE_SCALE;
    scene.width = Math.max(120, Math.round(viewW * sceneScale));
    scene.height = Math.max(80, Math.round(viewH * sceneScale));
    sctx.setTransform(scene.width / W, 0, 0, scene.height / H, 0, 0);

    ctx = sctx;
    ctx.font = WORD_FONT;
    ctx.textBaseline = 'top';
    charW = ctx.measureText('M').width || 16;
    ctx = out;

    state.groundY = H - CFG.groundPad;

    // A practice line is positioned from W, so re-centre it when the window
    // changes mid-stage (the segment itself stays the same length).
    if (state.custom && (state.custom.layout === 'lines' || state.custom.layout === 'prompts') &&
        state.custom.liveLine) {
      const line = state.custom.liveLine;
      line.x = Math.max(CFG.pad, Math.min((W - line.w) / 2, W - CFG.pad - line.w));
      line.y = customLineY();
    }
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
    streaks: [],              // speed-lines behind typed letters and clears
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
    flareT: 7,                // seconds until the next flare word
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
    keyPunch: 0,              // per-keystroke zoom spike (bigger and sharper than punch)
    keyFlash: 0,              // per-keystroke full-frame colour flash
    keyHue: 0,                // hue wheel position advanced by every keystroke
    keyStreak: 0,             // rapid-typing meter: rises per key, decays fast
    shock: 0,                 // clear shockwave-band timer
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
    waveStartSec: 0,          // runSec when the current wave began (drives splits)
    waveSplits: [],           // seconds spent in each wave this run
    waveMistakes: 0,          // wrong keys pressed during the current wave
    cleanWaves: 0,            // waves cleared with no wrong keys at all (achievements)
    longestClear: 0,          // longest word cleared this run (achievements)
    flaresCleared: 0,         // flare words cleared this run (achievements)
    splitFlashT: 0,           // signal-strip highlight after a wave split
    lastSplit: null,          // {wave, split, delta, newSplit} for the strip readout
    menuRain: [],             // attract-mode words drifting behind the main screen
    difficulty: 'standard',
    spawnCount: 0,            // successful spawns (drives the Split card)
    lifelineUsed: false,      // Lifeline saves exactly one life per run
    runRecorded: false,
    custom: null,             // active custom-stage state (practice mode)
  };

  Object.defineProperties(state, {
    pressure: { get: () => pressure(), enumerable: true },
    heat: { get: () => heat(), enumerable: true },
    heatMult: { get: () => heatMult(), enumerable: true },
  });

  // ─── Achievements ─────────────────────────────────────────────────────────
  // Everything here is presentation and persistence only: `evaluateAchievements`
  // is skipped while the headless bot simulates, so tuning runs stay identical.
  // `test` reads live state, so one pass after any scoring event is enough.
  const ACHIEVEMENTS = [
    { id: 'first-clear', name: 'Signal Acquired', desc: 'Clear your first word.', test: () => state.cleared >= 1 },
    { id: 'combo-10', name: 'Chain Reaction', desc: 'Reach a 10 clear combo.', test: () => state.bestCombo >= 10 },
    { id: 'combo-25', name: 'Overdrive', desc: 'Reach a 25 clear combo.', test: () => state.bestCombo >= 25 },
    { id: 'wave-5', name: 'Relay Online', desc: 'Reach wave 5.', test: () => state.wave >= 5 },
    { id: 'wave-12', name: 'Last Operator', desc: 'Reach wave 12.', test: () => state.wave >= 12 },
    { id: 'dawn', name: 'Dawnbreaker', desc: 'Survive all twelve waves to Dawn.', test: () => state.dawn },
    { id: 'score-10k', name: 'Ten Thousand', desc: 'Score 10,000 in one run.', test: () => state.score >= 10000 },
    { id: 'score-50k', name: 'Carrier Wave', desc: 'Score 50,000 in one run.', test: () => state.score >= 50000 },
    { id: 'words-100', name: 'Transcriptionist', desc: 'Clear 100 words in one run.', test: () => state.cleared >= 100 },
    { id: 'flawless-wave', name: 'Clean Signal', desc: 'Clear a whole wave without a single wrong key.', test: () => state.cleanWaves >= 1 },
    { id: 'long-word', name: 'Full Bandwidth', desc: 'Clear a 10 letter word.', test: () => state.longestClear >= 10 },
    { id: 'flare', name: 'Flare Chaser', desc: 'Catch a flare word.', test: () => state.flaresCleared >= 1 },
    { id: 'speed-dawn', name: 'Fast Forward', desc: 'Reach Dawn in under five minutes.', test: () => state.dawn && state.runSec <= 300 },
    { id: 'nightmare-dawn', name: 'Night Shift', desc: 'Reach Dawn on Nightmare.', test: () => state.dawn && state.difficulty === 'nightmare' },
    { id: 'endless-15', name: 'Still Listening', desc: 'Reach wave 15 after Dawn.', test: () => state.endless && state.wave >= 15 },
  ];
  const ACH_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

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
  const settings = { muted: false, fx: 'full', difficulty: 'standard', crisp: false };

  // Achievements and wave-split PBs live in their own keys so the long-standing
  // records blob keeps its shape (and its migrations) intact.
  const ACH_KEY = 'wordfall.achievements';
  const SPLIT_KEY = 'wordfall.splits';
  const achieved = Object.create(null);          // achievement id -> unlock timestamp
  const splitStore = { split: [], cum: [] };     // best split / best cumulative per wave

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
        if (parsed && DIFFICULTIES[parsed.difficulty]) settings.difficulty = parsed.difficulty;
        // Practice-only sharp rendering: the soft-focus upscale makes small
        // card text hard to read, so the player can turn it off for drills.
        if (parsed && typeof parsed.crisp === 'boolean') settings.crisp = parsed.crisp;
      }
      // Achievements: only ids that still exist are kept, and only a positive
      // timestamp counts as unlocked.
      const rawAch = localStorage.getItem(ACH_KEY);
      if (rawAch) {
        const parsed = JSON.parse(rawAch);
        for (const id of Object.keys(parsed || {})) {
          const when = Number(parsed[id]);
          if (ACH_BY_ID[id] && Number.isFinite(when) && when > 0) achieved[id] = when;
        }
      }
      // Wave-split PBs: two arrays of finite positive seconds.
      const rawSplits = localStorage.getItem(SPLIT_KEY);
      if (rawSplits) {
        const parsed = JSON.parse(rawSplits);
        for (const key of ['split', 'cum']) {
          const list = parsed && parsed[key];
          if (!Array.isArray(list)) continue;
          for (let i = 0; i < CFG.wavesPerRun; i++) {
            const v = Number(list[i]);
            if (Number.isFinite(v) && v > 0) splitStore[key][i] = v;
          }
        }
      }
    } catch (e) { /* file:// or privacy mode */ }
    state.best = records.bestScore;
    state.muted = settings.muted;
    state.difficulty = settings.difficulty;
  }
  loadStore();

  function saveStore() {
    try {
      localStorage.setItem('wordfall.records', JSON.stringify(records));
      localStorage.setItem('wordfall.best', String(records.bestScore));
      localStorage.setItem('wordfall.settings', JSON.stringify({
        muted: !!settings.muted,
        fx: settings.fx,
        difficulty: settings.difficulty,
        crisp: !!settings.crisp,
      }));
    } catch (e) { /* ignore */ }
  }

  function saveAchievements() {
    try { localStorage.setItem(ACH_KEY, JSON.stringify(achieved)); } catch (e) { /* ignore */ }
  }

  function saveSplits() {
    try { localStorage.setItem(SPLIT_KEY, JSON.stringify(splitStore)); } catch (e) { /* ignore */ }
  }

  // Called exactly once per finished run (game over or Dawn).
  function recordRun(won) {
    if (state.runRecorded) return;
    state.runRecorded = true;
    // Headless sim sweeps are tuning runs, not the player's record book.
    if (state.simulating) return;
    // Custom practice never touches the roguelite record book or achievements.
    if (state.custom) return;
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
    evaluateAchievements();
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

  // Splits are read to a tenth of a second: the difference between a good wave
  // and a great one is usually a few keypresses, not a whole second.
  function fmtSplit(sec) {
    const v = Math.max(0, Number(sec) || 0);
    const m = Math.floor(v / 60);
    const s = Math.floor(v % 60);
    const tenths = Math.floor((v * 10) % 10);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + tenths;
  }

  function fmtDelta(sec) {
    const v = Number(sec) || 0;
    const sign = v < 0 ? '-' : '+';
    return sign + Math.abs(v).toFixed(1) + 's';
  }

  // ─── Wave splits ──────────────────────────────────────────────────────────
  // A split is the time spent inside one wave of play. runSec only advances in
  // the 'playing' phase, so drafts, pauses and the wave-clear beat never leak in.
  function registerWaveSplit(wave, split) {
    const idx = wave - 1;
    if (idx < 0) return null;
    const cumulative = state.runSec;
    const prev = splitStore.split[idx] || 0;
    const prevCum = splitStore.cum[idx] || 0;
    const newSplit = (!prev || split < prev) && split >= 0.05;
    const newCum = (!prevCum || cumulative < prevCum) && split >= 0.05;
    // Waves past the twelfth are endless and have no slot in the table.
    if (idx < CFG.wavesPerRun) {
      if (newSplit) splitStore.split[idx] = split;
      if (newCum) splitStore.cum[idx] = cumulative;
      if (newSplit || newCum) saveSplits();
    }
    return {
      prev,
      cumulative,
      prevCum,
      newSplit: idx < CFG.wavesPerRun && newSplit,
      newCum: idx < CFG.wavesPerRun && newCum,
      delta: prev ? split - prev : 0,
      cumDelta: prevCum ? cumulative - prevCum : 0,
    };
  }

  function announceSplit(wave, split, info) {
    if (state.simulating || !info) return;
    // The wave-clear title card owns the centre of the playfield. The split is
    // announced in the signal strip instead, so the two never overlap.
    state.splitFlashT = 2.2;
    state.lastSplit = {
      wave,
      split,
      delta: info.delta,
      newSplit: info.newSplit,
      // Only the very first wave of a run has no split to compare against.
      // Waves 13+ are endless and have no PB slot, so they are labelled as
      // endless instead of pretending to be a "first split" every time.
      first: wave === 1,
      endless: wave > CFG.wavesPerRun,
    };
  }

  // ─── Achievements ─────────────────────────────────────────────────────────
  function achievementCount() {
    let n = 0;
    for (const a of ACHIEVEMENTS) if (achieved[a.id]) n += 1;
    return n;
  }

  function evaluateAchievements() {
    if (state.simulating) return;
    // Practice stages are not part of the roguelite record book.
    if (state.custom) return;
    for (const a of ACHIEVEMENTS) {
      if (achieved[a.id]) continue;
      let ok = false;
      try { ok = !!a.test(); } catch (e) { ok = false; }
      if (ok) unlockAchievement(a);
    }
  }

  function unlockAchievement(a) {
    if (!a || achieved[a.id] || state.simulating) return false;
    achieved[a.id] = Date.now();
    saveAchievements();
    pushToast(a);
    playAchievement();
    updateAchievementsMenu();
    if (uiModal === 'achievements') populateAchievements();
    return true;
  }

  // Win95-style notification window in the bottom-right of the app.
  function pushToast(a) {
    const stack = document.getElementById('toastStack');
    if (!stack) return;
    const el = document.createElement('div');
    el.className = 'toast';
    const title = document.createElement('div');
    title.className = 'toast-title';
    title.textContent = 'Achievement unlocked';
    const body = document.createElement('div');
    body.className = 'toast-body';
    const mark = document.createElement('div');
    mark.className = 'toast-mark';
    mark.textContent = '\u2713';
    const text = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'toast-name';
    name.textContent = a.name;
    const desc = document.createElement('div');
    desc.className = 'toast-desc';
    desc.textContent = a.desc;
    text.appendChild(name);
    text.appendChild(desc);
    body.appendChild(mark);
    body.appendChild(text);
    el.appendChild(title);
    el.appendChild(body);
    stack.appendChild(el);
    while (stack.children.length > 3) stack.removeChild(stack.firstChild);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 240);
    }, 4200);
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
    state.streaks.length = 0;
    state.score = 0;
    state.combo = 0;
    state.bestCombo = 0;
    state.cleared = 0;
    state.wave = 1;
    state.waveCleared = 0;
    state.lives = difficulty().startLives;
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
    state.flareT = 7;
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
    state.keyPunch = 0;
    state.keyFlash = 0;
    state.keyStreak = 0;
    state.shock = 0;
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
    state.waveStartSec = 0;
    state.waveSplits = [];
    state.waveMistakes = 0;
    state.cleanWaves = 0;
    state.longestClear = 0;
    state.flaresCleared = 0;
    state.splitFlashT = 0;
    state.lastSplit = null;
    state.difficulty = settings.difficulty;
    state.spawnCount = 0;
    state.lifelineUsed = false;
    state.runRecorded = false;
    state.custom = null;
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

  // Expected word length for the current band, weighted by the pool. The spawn
  // interval is derived from it plus `demandWpm()`, so the board's ask is a
  // typing speed rather than a timer.
  function expectedWordLength() {
    const [lo, hi] = wordRange();
    let total = 0;
    let count = 0;
    for (let len = lo; len <= hi; len++) {
      const bucket = WORD_BUCKETS.get(len);
      if (!bucket) continue;
      total += bucket.length * len;
      count += bucket.length;
    }
    return count ? total / count : 5;
  }

  // The balance curve. x is how far through the 12-wave run the current
  // pressure sits; the exponent keeps waves 1-5 gentle and spends most of the
  // climb late. Matches real typist percentiles: ~16 WPM at wave 1 (anyone),
  // ~36 at wave 6 (around the median), ~92 at wave 12 (roughly the top 2%).
  function demandWpm() {
    // Pressure at the start of the final wave: 11 waves of clears + 11 drafts.
    // Normalising here means `demandEnd` is the actual wave-12 ask, not a value
    // the run never reaches.
    const span = (CFG.wavesPerRun - 1) * (CFG.waveSize + CFG.pressurePerDraft);
    const x = clamp(pressure() / span, 0, 1);
    return CFG.demandStart + (CFG.demandEnd - CFG.demandStart) * Math.pow(x, CFG.demandCurve);
  }

  function spawnInterval() {
    let t = Math.max(CFG.spawnMin, (expectedWordLength() * 12) / demandWpm());
    // Drought buys reading time by stretching the queue; it is the Hex/Gambit
    // lane's survival option (spawn rate, not fall speed, is the strong lever).
    const drought = heldTier('drought');
    if (drought >= 2) t *= 1.2;
    else if (drought >= 1) t *= 1.15;
    t *= difficulty().spawn;
    return t;
  }

  function baseSpeedNow() {
    return Math.min(CFG.maxSpeed, CFG.baseSpeed + pressure() * CFG.speedPerClear) * difficulty().speed;
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
    // Custom practice lines keep their case, spaces, punctuation and script; the
    // roguelite pool is lowercase single words only, exactly as before.
    const raw = String(text == null ? '' : text);
    text = state.custom ? raw.replace(/\s+/g, ' ').trim() : raw.toLowerCase();
    if (state.custom) {
      // Printable text in any script, one line, capped so a pasted paragraph
      // cannot become a single target.
      if (!text || text.length > 160 || /[\u0000-\u001f\u007f]/.test(text)) return null;
    } else if (!/^[a-z]{1,20}$/.test(text)) {
      return null;
    }
    const metrics = glyphMetrics(text);
    const w = metrics.width;
    const maxX = Math.max(CFG.pad, W - CFG.pad - w);
    const x = opts.x != null ? opts.x : CFG.pad + rng() * Math.max(0, maxX - CFG.pad);
    const word = {
      id: nextId++,
      text,
      x,
      y: opts.y != null ? opts.y : -CFG.charH - 12,
      w,
      offsets: metrics.offsets,
      glyphW: metrics.widths,
      progress: 0,
      fake: !!opts.fake,
      flare: !!opts.flare,
      born: state.t,
      typedAt: [],
      // Visual-only motion state: a short position history (the comet tail),
      // a deterministic sway phase (no RNG, so seeded runs stay reproducible)
      // and a hue seed that drives the trail colour.
      trail: [],
      trailT: 0,
      sway: (nextId * 1.73) % (Math.PI * 2),
      hue: (nextId * 0.137) % 1,
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

  // Flare: a short word that drops in fast and is gone. It scores like a normal
  // clear, but if it reaches the line it just slips through - no Life lost, no
  // combo break. It deliberately ignores `maxWords` so it can always show up as
  // an event, but it tries to pick a lane that is not already occupied.
  function spawnFlare() {
    const text = pickSpawnText(3, 5);
    if (!text) return null;
    const w = charW * text.length;
    const maxX = Math.max(CFG.pad, W - CFG.pad - w);
    let x = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const cand = CFG.pad + rng() * Math.max(0, maxX - CFG.pad);
      let clear = true;
      for (const other of state.words) {
        if (cand + w + 14 > other.x && cand - 14 < other.x + other.w) { clear = false; break; }
      }
      if (clear) { x = cand; break; }
    }
    if (x == null) x = CFG.pad + rng() * Math.max(0, maxX - CFG.pad);
    const word = spawnWord(text, { x, flare: true, y: -CFG.charH - 12 });
    if (!word) return null;
    word.harmless = true;      // no Life lost if it crosses the line
    if (!state.simulating) {
      playFlareSpawn();
      popup(W / 2, 62, 'FLARE INCOMING', COL.flare, { size: 14, vy: -8, life: 0.95 });
    }
    return word;
  }

  // ─── Target set / lock-on ─────────────────────────────────────────────────
  // The target set is asked for several times per rendered frame (word colours,
  // title flags, danger glow). A frame-scoped cache keeps that to one sort while
  // input events, which run between frames, always see fresh state.
  let renderStamp = 0;
  let renderCacheActive = false;
  let targetSetStamp = -1;
  let targetSetCache = [];
  let targetWordStamp = -1;
  let targetWordCache = null;

  function targetSet() {
    if (renderCacheActive && targetSetStamp === renderStamp) return targetSetCache;
    let result;
    if (!state.words.length) {
      result = [];
    } else if (state.lockWord && state.words.indexOf(state.lockWord) >= 0) {
      result = [state.lockWord];
    } else {
      const sorted = state.words.slice().sort((a, b) => b.y - a.y);
      result = sorted.slice(0, targetSetSize());
    }
    if (renderCacheActive) {
      targetSetStamp = renderStamp;
      targetSetCache = result;
    }
    return result;
  }

  function targetWord() {
    if (renderCacheActive && targetWordStamp === renderStamp) return targetWordCache;
    let result;
    if (state.lockWord && state.words.indexOf(state.lockWord) >= 0) {
      result = state.lockWord;
    } else {
      const set = targetSet();
      result = null;
      if (set.length) {
        for (const w of set) if (!w.fake) { result = w; break; }   // a fake never blocks a real word in the set
        if (!result) result = set[0];                              // only fakes are in range
      }
    }
    if (renderCacheActive) {
      targetWordStamp = renderStamp;
      targetWordCache = result;
    }
    return result;
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

  // Speed-lines: the trail primitive used by typing, clears and word motion.
  // They are drawn as hard 1-3px streaks, which is cheap and reads as motion at
  // any frame rate.
  function addStreak(x, y, opts) {
    if (state.simulating) return;
    opts = opts || {};
    const life = opts.life != null ? opts.life : 0.24;
    state.streaks.push({
      x,
      y,
      vx: opts.vx || 0,
      vy: opts.vy != null ? opts.vy : -70,
      len: opts.len != null ? opts.len : 8,
      width: opts.width != null ? opts.width : 2,
      life,
      max: life,
      color: opts.color || NEON(Math.random() * 6),
      drag: opts.drag != null ? opts.drag : 3.2,
    });
    capPool(state.streaks, CFG.fxMaxStreaks);
  }

  function streakBurst(x, y, count, opts) {
    if (state.simulating) return;
    opts = opts || {};
    const n = fxCount(count);
    for (let i = 0; i < n; i++) {
      const ang = opts.radial ? Math.random() * Math.PI * 2 : (Math.random() < 0.5 ? 0.8 : 2.3);
      const sp = (opts.speed || 120) * (0.4 + Math.random());
      addStreak(x + (Math.random() - 0.5) * (opts.spread || 12), y, {
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        len: 6 + Math.random() * 16,
        width: Math.random() < 0.3 ? 3 : 1,
        life: 0.16 + Math.random() * 0.24,
        color: opts.color || NEON(Math.floor(Math.random() * 7) / 6),
      });
    }
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

  function burst(word, color, count, opts) {
    if (state.simulating) return;
    opts = opts || {};
    const cx = clamp(word.x + word.w / 2, 0, W);
    const cy = word.y + CFG.charH / 2;
    const n = fxCount(count);
    const power = opts.power || 1;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (40 + Math.random() * 170) * power;
      addSpark(
        cx + (Math.random() - 0.5) * (word.w * 0.9),
        cy + (Math.random() - 0.5) * CFG.charH,
        Math.cos(ang) * sp,
        Math.sin(ang) * sp - 40,
        {
          color: color || NEON(Math.random() * 6),
          life: 0.28 + Math.random() * 0.4,
          max: 0.75,
          size: Math.random() < 0.35 ? 3 : 2,
        }
      );
    }
    capPool(state.particles, CFG.fxMaxParticles);
  }

  // Every letter of a cleared word becomes a spinning glyph shard, so the word
  // visibly comes apart exactly where the player typed it. `power` scales the
  // explosion for clears, milestones and big combos.
  function shatter(word, color, power) {
    if (state.simulating) return;
    power = power || 1;
    const baseX = Math.max(4, Math.min(word.x, W - 4 - word.w));
    const glyphs = word.text.split('');
    const max = Math.min(glyphs.length, fxCount(14 * Math.min(power, 1.6)));
    for (let i = 0; i < max; i++) {
      const ox = word.offsets ? word.offsets[i] : i * charW;
      const gw = word.glyphW ? word.glyphW[i] : charW;
      const gx = baseX + ox + gw / 2;
      const ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const sp = (70 + Math.random() * 200) * power;
      state.shards.push({
        x: gx,
        y: word.y + CFG.charH / 2,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        g: 520,
        rot: (Math.random() - 0.5) * 0.4,
        vr: (Math.random() - 0.5) * 12,
        life: 0.42 + Math.random() * 0.34,
        max: 0.78,
        ch: glyphs[i],
        color: color || NEON(Math.floor(Math.random() * 7) / 6),
        scale: 1 + Math.random() * 0.4,
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

  // Per-keystroke overkill. Every correct letter detonates at its own glyph:
  // a hue-cycled spark burst, speed-lines, a tiny shockwave and a punch/flash
  // on the whole frame. Intensity climbs with the combo and with proximity to
  // the danger line, so a hot streak feels physically loud.
  function keyBurst(word, pos, urgent) {
    if (state.simulating) return;
    // Rapid typing feeds its own meter on top of the combo, so a clean burst of
    // letters escalates the visual noise key by key instead of at word level.
    state.keyStreak = Math.min(22, state.keyStreak + 1);
    const px = clamp(word.x + (word.offsets ? word.offsets[pos] : pos * charW) +
      ((word.glyphW ? word.glyphW[pos] : charW) / 2), 0, W);
    const py = word.y + CFG.charH / 2;
    const hype = clamp(state.keyStreak / 13, 0, 1) + (urgent ? 0.3 : 0) +
      clamp(state.combo / 24, 0, 0.4);
    state.keyHue = MOD(state.keyHue + 0.07 + Math.random() * 0.03, 1);
    const color = hsl(state.keyHue, 1, 0.62);
    const accent = hsl(MOD(state.keyHue + 0.42, 1), 1, 0.66);
    for (let i = 0; i < fxCount(4 + Math.round(hype * 7)); i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * (150 + hype * 220);
      addSpark(px, py, Math.cos(ang) * sp, Math.sin(ang) * sp - 30, {
        color: Math.random() < 0.5 ? color : accent,
        size: Math.random() < 0.35 ? 3 : 2,
        life: 0.18 + Math.random() * 0.24,
        max: 0.42,
        g: 180,
        drag: 2.2,
      });
    }
    capPool(state.particles, CFG.fxMaxParticles);
    streakBurst(px, py, 3 + Math.round(hype * 5), { speed: 140 + hype * 80, spread: 12, color });
    ring(px, py, color, 20 + hype * 30, 0.16, 1);
    if (hype > 0.55) ring(px, py, accent, 12 + hype * 14, 0.11, 1);
    // The frame reacts too: a hard zoom spike and a coloured flash of the whole
    // playfield, so every committed letter moves the picture.
    state.keyPunch = Math.max(state.keyPunch, 0.3 + hype * 0.45);
    state.keyFlash = Math.max(state.keyFlash, 0.09 + hype * 0.16);
    state.shake = Math.max(state.shake, 0.07 + hype * 0.1);
  }

  function milestone(combo) {
    if (state.simulating) return;
    state.milestoneT = 0.75;
    state.clearFlash = Math.max(state.clearFlash, 0.9);
    state.shake = Math.max(state.shake, 0.34);
    state.punch = Math.max(state.punch, 1);
    state.keyPunch = Math.max(state.keyPunch, 0.9);
    state.shock = Math.max(state.shock, 0.5);
    popup(W / 2, H * 0.33, 'COMBO \u00d7' + combo, hsl(0.14, 1, 0.63), { size: 34, vy: -26, life: 1.2 });
    popup(W / 2, H * 0.33 + 34, 'OVERDRIVE', hsl(0.55, 1, 0.7), { size: 16, vy: -20, life: 1 });
    ring(W / 2, H * 0.33, hsl(0.14, 1, 0.6), 320, 0.6, 3);
    ring(W / 2, H * 0.33, hsl(0.55, 1, 0.65), 210, 0.42, 2);
    streakBurst(W / 2, H * 0.33, 18, { speed: 320, radial: true, spread: 60 });
    playMilestone(combo);
  }


  function clearWord(word, auto) {
    if (!word || state.words.indexOf(word) < 0) return;
    removeWord(word);

    const points = calcPoints(word);
    state.score += points;
    state.cleared += 1;
    state.waveCleared += 1;
    if (word.text.length > state.longestClear) state.longestClear = word.text.length;
    if (word.flare) state.flaresCleared += 1;
    state.lastClear = { points, x: word.x, y: word.y, auto: !!auto, t: 0.9 };

    if (has('ghost')) echoOf(word);

    const cx = clamp(word.x + word.w / 2, 0, W);
    const cy = word.y + CFG.charH / 2;

    if (auto) {
      state.autoClears += 1;
      const ac = hsl(MOD(state.t * 0.11 + 0.5, 1), 1, 0.65);
      burst(word, ac, 14, { power: 1.1 });
      shatter(word, ac, 1.1);
      ring(cx, cy, ac, 90, 0.3, 1);
      streakBurst(cx, cy, 6, { radial: true, speed: 150 });
      popup(cx, word.y - 6, '+' + fmtInt(points), ac, { size: 16, life: 0.65 });
    } else {
      state.combo += 1;
      state.bestCombo = Math.max(state.bestCombo, state.combo);
      // Impact scales with how close the word was to the line: the riskier the
      // clear, the longer the freeze-frame, the harder the hit.
      const proximity = clamp(1 - (state.groundY - (word.y + CFG.charH)) / 260, 0, 1);
      const close = proximity > 0.62;
      const power = 1 + Math.min(state.combo, 20) * 0.045 + proximity * 0.5;
      const hueBase = MOD(state.t * 0.13 + state.combo * 0.06, 1);
      const c1 = hsl(hueBase, 1, 0.63);
      const c2 = hsl(MOD(hueBase + 0.33, 1), 1, 0.66);
      const c3 = hsl(MOD(hueBase + 0.66, 1), 1, 0.68);
      state.hitPause = Math.max(state.hitPause, CFG.hitPause + proximity * 0.05);
      state.shake = Math.max(state.shake, 0.22 + proximity * 0.38);
      state.clearFlash = Math.max(state.clearFlash, 0.18 + proximity * 0.14);
      state.punch = Math.max(state.punch, 0.7 + proximity * 0.5);
      state.keyPunch = Math.max(state.keyPunch, 0.9 + proximity * 0.4);
      state.shock = Math.max(state.shock, 0.45 + proximity * 0.4);
      // Everything at once: sparks, every glyph thrown off the word, a triple
      // neon shockwave, radial speed-lines and three floating callouts.
      burst(word, c1, 26 + Math.min(22, state.combo), { power });
      shatter(word, c2, power);
      streakBurst(cx, cy, 14 + Math.min(10, state.combo), { radial: true, speed: 260, spread: word.w });
      ring(cx, cy, c1, 120 + proximity * 200 + state.combo * 4, 0.36 + proximity * 0.16, 3);
      ring(cx, cy, c2, 70 + proximity * 120, 0.24, 2);
      ring(cx, cy, c3, 40 + proximity * 50, 0.16, 1);
      popup(cx, word.y - 8, '+' + fmtInt(points), c1, { size: 22 + Math.min(8, state.combo * 0.3) });
      popup(cx, word.y + CFG.charH + 26, '\u00d7' + comboMultiplier().toFixed(2), c3, {
        size: 14, vy: -30, life: 0.75,
      });
      if (state.combo >= 4) {
        popup(cx, word.y - 34, state.combo + ' IN A ROW', hsl(0.12, 1, 0.62), {
          size: 12, vy: -18, life: 0.8,
        });
      }
      if (close) {
        popup(cx, word.y - 30, 'CLOSE CALL', hsl(0.0, 1, 0.6), { size: 14, vy: -20, life: 0.9 });
        state.shake = Math.max(state.shake, 0.42);
        state.clearFlash = Math.max(state.clearFlash, 0.34);
      }
      // A combo milestone that lands on the tenth clear would fight the wave
      // title card for the centre of the screen. The wave wins; the combo is
      // still counted and its achievements still fire.
      if (state.combo % MILESTONE_COMBO === 0 && state.waveCleared < CFG.waveSize) milestone(state.combo);
      if (word.flare) {
        // Flares are short, fast and harmless - clear one and it gets its own
        // bright cyan beat on top of the normal impact.
        ring(cx, cy, COL.flare, 190, 0.32, 2);
        streakBurst(cx, cy, 12, { radial: true, speed: 320, color: COL.flare });
        popup(cx, word.y - 30, 'FLARE!', COL.flare, { size: 16, vy: -26, life: 0.9 });
        playFlareHit();
      }
      playClear(state.combo, proximity, close, word.text.length);
      pulseStatus('score');
      pulseStatus('combo');
    }

    // Practice stages replace the roguelite bookkeeping entirely: no waves, no
    // draft, no achievements, no record book. Advancing the text is the rule.
    if (state.custom) {
      onCustomCleared(word);
      return;
    }

    evaluateAchievements();

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
    evaluateAchievements();
  }

  function checkWaveEnd() {
    if (state.phase !== 'playing') return;
    if (state.waveCleared < CFG.waveSize) return;

    // Splits and clean-wave tracking are bookkeeping, not presentation, so they
    // also run in the headless sim (which is how the tests can read them).
    const split = Math.max(0, state.runSec - state.waveStartSec);
    state.waveSplits[state.wave - 1] = split;
    if (state.waveMistakes === 0) state.cleanWaves += 1;
    const info = state.simulating ? null : registerWaveSplit(state.wave, split);
    announceSplit(state.wave, split, info);
    evaluateAchievements();

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
    state.punch = Math.max(state.punch, 0.95);
    state.keyPunch = Math.max(state.keyPunch, 0.9);
    state.clearFlash = Math.max(state.clearFlash, 0.75);
    state.shake = Math.max(state.shake, 0.3);
    state.shock = Math.max(state.shock, 0.7);
    ring(W / 2, H * 0.42, hsl(0.12, 1, 0.64), 400, 0.72, 4);
    ring(W / 2, H * 0.42, hsl(0.52, 1, 0.68), 260, 0.52, 2);
    ring(W / 2, H * 0.42, hsl(0.85, 1, 0.66), 150, 0.34, 2);
    streakBurst(W / 2, H * 0.42, 26, { radial: true, speed: 380, spread: 40 });
    for (let i = 0; i < fxCount(40); i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 150 + Math.random() * 360;
      addSpark(W / 2, H * 0.42, Math.cos(ang) * sp, Math.sin(ang) * sp, {
        color: NEON(Math.floor(Math.random() * 7) / 6),
        life: 0.5 + Math.random() * 0.5,
        max: 1,
        g: 180,
        size: Math.random() < 0.35 ? 3 : 2,
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
    state.waveStartSec = state.runSec;    // the next split starts now
    state.waveMistakes = 0;
    evaluateAchievements();
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
    state.waveStartSec = state.runSec;
    state.waveMistakes = 0;
    evaluateAchievements();
  }

  // ─── Typing rules ─────────────────────────────────────────────────────────
  function typeLetter(ch) {
    if (state.phase !== 'playing' || state.waveClearT > 0) return;
    const custom = state.custom;
    ch = String(ch == null ? '' : ch).toLowerCase();
    // Practice accepts any printable single character in any script (a line can
    // be Chinese, Japanese, Korean); the roguelite stays letters-only.
    if (custom) {
      if (!ch || ch.length !== 1 && ch.length !== 2 || /[\u0000-\u001f\u007f]/.test(ch)) return;
    } else if (!/^[a-z]$/.test(ch)) {
      return;
    }

    const set = targetSet();
    if (!set.length) return;

    let word = null;
    if (state.lockWord && state.words.indexOf(state.lockWord) >= 0) {
      word = state.lockWord;
    } else {
      const reals = set.filter((w) => !w.fake);
      if (!reals.length) { mistake(); return; }          // a fake is the lowest word
      const matches = reals.filter((w) => {
        const expected = nextChar(w);
        return expected != null && expected.toLowerCase() === ch;
      });
      if (!matches.length) { mistake(); return; }
      matches.sort((a, b) => b.y - a.y);                 // ties go to the lowest word
      word = matches[0];
    }

    const expected = nextChar(word);
    if (expected != null && ch === expected.toLowerCase()) {
      state.lockWord = word;                             // lock-on: holds until this word is cleared
      word.progress += 1;
      state.keys += 1;
      // Memorize: the first committed key hides the rest of the line, so the
      // player is reading the words back from memory from here on.
      if (custom && (custom.layout === 'lines' || custom.layout === 'prompts') && custom.memorize && !custom.hidden) customHideLine();
      word.typedAt[word.progress - 1] = state.t;
      if (word.progress >= word.text.length) {
        clearWord(word, false);
      } else {
        // Per-letter impact: the glyph detonates (see keyBurst).
        if (!state.simulating) {
          const pos = typingOrderIndex(word, word.progress - 1);
          const urgent = word.y + CFG.charH > state.groundY - 130;
          keyBurst(word, pos, urgent);
        }
        playKey(word.progress, word.text.length);
      }
    } else {
      mistake();
    }
  }

  function mistake() {
    state.mistakes += 1;
    state.waveMistakes += 1;
    state.keyStreak = 0;
    if (state.shields > 0) {
      state.shields -= 1;                                // Shield eats the hit, combo kept, no flash
      state.blockFlash = 0.18;
      if (!state.simulating) {
        const t = targetWord();
        if (t) {
          const cx = clamp(t.x + t.w / 2, 0, W);
          const cy = t.y + CFG.charH / 2;
          const sc = hsl(0.5, 1, 0.7);
          ring(cx, cy, sc, 90, 0.24, 2);
          ring(cx, cy, sc, 50, 0.16, 1);
          streakBurst(cx, cy, 8, { radial: true, speed: 170, color: sc });
          for (let i = 0; i < fxCount(7); i++) {
            addSpark(cx, cy, (Math.random() - 0.5) * 170, (Math.random() - 0.5) * 170, {
              color: sc, size: 2, life: 0.22, max: 0.3, g: 60,
            });
          }
          state.keyFlash = Math.max(state.keyFlash, 0.14);
        }
        pulseStatus('shields');
      }
      playShield();
      return;
    }
    state.combo = 0;
    state.flash = CFG.mistakeFlash;
    state.shake = Math.max(state.shake, 0.2);
    state.keyPunch = Math.max(state.keyPunch, 0.5);
    state.keyFlash = Math.max(state.keyFlash, 0.2);
    if (!state.simulating) {
      const t = targetWord();
      if (t) {
        const cx = clamp(t.x + t.w / 2, 0, W);
        const cy = t.y + CFG.charH / 2;
        const rc = hsl(0.0, 1, 0.58);
        popup(cx, t.y - 6, 'MISS', rc, { size: 16, vy: -30, life: 0.65 });
        ring(cx, cy, rc, 130, 0.28, 2);
        streakBurst(cx, cy, 9, { radial: true, speed: 190, color: rc });
      }
    }
    playMistake();
  }

  function hitGround(word) {
    // Custom practice: a missed target is recycled, never a lost life.
    if (state.custom) { customMiss(word); return; }
    removeWord(word);
    if (word.fake) return;                               // fakes fall through harmlessly
    if (word.harmless) {
      // Split's free word and flares cost no Life. A flare gets a visible
      // "slipped past" cue at the line so the player knows it was harmless.
      if (word.flare && !state.simulating) {
        const cx = clamp(word.x + word.w / 2, 0, W);
        ring(cx, state.groundY, COL.flare, 90, 0.24, 1);
        streakBurst(cx, state.groundY - 6, 8, { radial: true, speed: 180, color: COL.flare });
        popup(cx, state.groundY - 24, 'FLARE MISSED', COL.flare, { size: 11, vy: -18, life: 0.7 });
        playFlareMiss();
      }
      return;
    }

    // Lifeline: the first word that reaches the line is destroyed instead of
    // costing a Life. Combo is kept - it is a rare, once-per-run save.
    if (has('lifeline') && !state.lifelineUsed) {
      state.lifelineUsed = true;
      if (!state.simulating) {
        const cx = clamp(word.x + word.w / 2, 0, W);
        const lc = hsl(0.13, 1, 0.64);
        shatter(word, lc, 1.4);
        ring(cx, state.groundY, lc, 320, 0.55, 3);
        ring(cx, state.groundY, hsl(0.55, 1, 0.68), 220, 0.4, 2);
        streakBurst(cx, state.groundY - 12, 16, { radial: true, speed: 300, spread: 260 });
        popup(cx, state.groundY - 48, 'LINE HELD', lc, { size: 26, vy: -36, life: 1.1 });
        state.clearFlash = Math.max(state.clearFlash, 0.6);
        state.keyFlash = Math.max(state.keyFlash, 0.5);
        state.shake = Math.max(state.shake, 0.34);
        state.punch = Math.max(state.punch, 0.8);
        state.keyPunch = Math.max(state.keyPunch, 0.8);
        playLifeline();
      }
      return;
    }

    state.combo = 0;
    state.flash = CFG.mistakeFlash;
    state.shake = CFG.shakeHit * 1.3;
    state.shock = Math.max(state.shock, 0.9);
    state.keyFlash = Math.max(state.keyFlash, 0.35);
    state.lives -= 1;
    if (!state.simulating) {
      // The word breaks on the line: red glyph shards, a hard ring and a
      // full-screen damage pulse make losing a life unmissable.
      const rc = hsl(0.0, 1, 0.58);
      shatter(word, rc, 1.6);
      const cx = clamp(word.x + word.w / 2, 0, W);
      const cy = state.groundY - CFG.charH / 2;
      const wide = 220 + word.w;
      ring(cx, state.groundY, rc, wide, 0.46, 4);
      ring(cx, state.groundY, hsl(0.08, 1, 0.6), wide * 0.6, 0.3, 2);
      burst(word, rc, 30, { power: 1.8 });
      streakBurst(cx, cy, 22, { radial: true, speed: 340, spread: word.w });
      popup(cx, state.groundY - 40, '-1 LIFE', rc, { size: 26, vy: -34, life: 1.1 });
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

  // ─── Custom stages: storage, content prep and practice rules ─────────────
  // A custom stage is deliberately outside the roguelite: reset() clears
  // `state.custom`, the standard wave/draft/pressure code never runs, and the
  // record book and achievements are skipped. What remains is the typed text,
  // the clock and the accuracy — the whole point of a memorization drill.
  const CUSTOM_KEY = 'wordfall.custom.stages';
  const CUSTOM_LAST_KEY = 'wordfall.custom.last';
  let customStages = [];
  let customLast = null;          // last started config, used to prefill the dialog
  let customEditingId = null;     // id of the saved stage currently loaded in the dialog

  // The typing layouts (Lines / Falling words) are no longer ASCII-only: a
  // Chinese poem or a Japanese vocab list has to survive the editor, so they
  // keep their script and only collapse whitespace. IME input and per-glyph
  // widths are handled further down.
  function customPlainText(raw) {
    let text = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n');
    text = text.replace(/[\t\f\v]/g, ' ');
    // Control characters are not typeable; keep newlines, drop the rest.
    text = text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ');
    text = text.replace(/ {2,}/g, ' ');
    return text.slice(0, CUSTOM.maxTextChars);
  }

  function customPlainLines(text) {
    return customPlainText(text).split('\n').map((line) => line.trim()).filter(Boolean);
  }

  // ─── Cards ────────────────────────────────────────────────────────────────
  // A card is `prompt :: answer`, one per line. Cards were the first layout to
  // keep Unicode ("你好 :: ni hao"); the typing layouts use customPlainText now
  // too, so a deck is not the only multilingual option.
  function customLayoutId(value) {
    if (value === 'words') return 'words';
    if (value === 'cards') return 'cards';
    if (value === 'prompts') return 'prompts';
    return 'lines';
  }

  function customCardSource(raw) {
    const text = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').replace(/[\f\v]/g, ' ');
    const lines = text.split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean);
    return lines.join('\n').slice(0, CUSTOM.maxTextChars);
  }

  // Prompts are the typed counterpart of Cards: `shown :: typed` per line. The
  // board shows the left side and the player types the right side, so a Chinese
  // character can cue its pinyin (or an English meaning can cue the Chinese,
  // with an IME). The shown side can be hidden after the preview (Memorize).
  const PROMPT_SHOWN_MAX = 80;
  const PROMPT_TYPED_MAX = 80;

  function customPromptPairs(text) {
    const source = customCardSource(text);
    if (!source) return [];
    const out = [];
    for (const line of source.split('\n')) {
      const pair = customPairSplit(line);
      if (!pair) continue;
      out.push({
        shown: pair.left.slice(0, PROMPT_SHOWN_MAX),
        typed: pair.right.slice(0, PROMPT_TYPED_MAX),
      });
      if (out.length >= CUSTOM.maxLines) break;
    }
    return out;
  }

  function customPromptCounts(text) {
    const source = customCardSource(text);
    if (!source) return { prompts: 0, skipped: 0, chars: 0 };
    let prompts = 0;
    let skipped = 0;
    for (const line of source.split('\n')) {
      if (customPairSplit(line)) prompts += 1;
      else skipped += 1;
    }
    return {
      prompts: Math.min(prompts, CUSTOM.maxLines),
      skipped,
      chars: source.replace(/\s+/g, ' ').trim().length,
    };
  }

  // The first `::` or `=>` splits a two-part line. The left side is allowed to
  // contain the other separator, so a definition can say "a => b" intact.
  function customPairSplit(line) {
    const match = /^(.*?)\s*(?:::|=>)\s*(.*)$/.exec(String(line == null ? '' : line).trim());
    if (!match) return null;
    const left = match[1].trim();
    const right = match[2].trim();
    if (!left || !right) return null;
    return { left, right };
  }

  function customCardSplit(line) {
    const pair = customPairSplit(line);
    if (!pair) return null;
    return {
      prompt: pair.left.slice(0, CUSTOM.cardMaxPrompt),
      answer: pair.right.slice(0, CUSTOM.cardMaxAnswer),
    };
  }

  function customCards(text) {
    const source = customCardSource(text);
    if (!source) return [];
    const out = [];
    for (const line of source.split('\n')) {
      const card = customCardSplit(line);
      if (!card) continue;
      out.push(card);
      if (out.length >= CUSTOM.maxCards) break;
    }
    return out;
  }

  function customCardCounts(text) {
    const source = customCardSource(text);
    if (!source) return { cards: 0, skipped: 0, chars: 0 };
    const lines = source.split('\n');
    let cards = 0;
    let skipped = 0;
    for (const line of lines) {
      if (customCardSplit(line)) cards += 1;
      else skipped += 1;
    }
    return {
      cards: Math.min(cards, CUSTOM.maxCards),
      skipped,
      chars: source.replace(/\s+/g, ' ').trim().length,
    };
  }

  // One helper for "the text this layout will actually play": cards and prompts
  // are pair-per-line sources, the typing layouts keep their script as-is.
  function customLayoutText(raw, layout) {
    const id = customLayoutId(layout);
    return id === 'cards' || id === 'prompts'
      ? customCardSource(raw)
      : customPlainText(raw);
  }

  // ─── Smart text cleanup ───────────────────────────────────────────────────
  // Web pastes arrive full of things that are noise in a typing drill: citation
  // markers ("World War II[b]", "...[12]"), bare URLs, Markdown or HTML link
  // syntax, and the chrome a whole-page copy drags in. The cleaner strips those
  // and reports what it removed, so the editor can show the receipt.
  const WIKI_CHROME = new Set([
    'jump to content', 'main page', 'contents', 'current events', 'random article',
    'about wikipedia', 'contact us', 'donate', 'contribute', 'help', 'learn to edit',
    'community portal', 'recent changes', 'upload file', 'tools', 'what links here',
    'related changes', 'special pages', 'permanent link', 'page information',
    'cite this page', 'get shortened url', 'download qr code', 'wikidata item',
    'download as pdf', 'printable version', 'in other projects', 'languages', 'search',
    'create account', 'log in', 'personal tools', 'toggle the table of contents',
    'toggle the contents', 'appearance', 'main menu', 'navigation', 'move to sidebar',
    'from wikipedia, the free encyclopedia', 'privacy policy', 'disclaimers',
    'code of conduct', 'developers', 'statistics', 'cookie statement', 'mobile view',
    'wikimedia foundation', 'powered by mediawiki',
    // Section headings that survive as bare lines once the markers are gone.
    'references', 'external links', 'see also', 'further reading', 'notes', 'citations',
    'sources', 'bibliography', 'works cited', 'general references', 'notes and references',
  ]);

  function decodeCustomEntities(text) {
    return text
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&mdash;|&ndash;/gi, '-')
      .replace(/&#x([0-9a-f]+);/gi, (m, hex) => {
        const code = parseInt(hex, 16);
        return code >= 32 && code <= 126 ? String.fromCharCode(code) : ' ';
      })
      .replace(/&#(\d+);/g, (m, dec) => {
        const code = Number(dec);
        return code >= 32 && code <= 126 ? String.fromCharCode(code) : ' ';
      });
  }

  function customCleanText(raw) {
    const stats = { citations: 0, links: 0, urls: 0, markup: 0, chrome: 0, references: 0 };
    let text = String(raw == null ? '' : raw);

    // 1. Real HTML, if rendered markup was pasted in.
    text = text.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, () => { stats.markup++; return ' '; });
    text = text.replace(/<img\b[^>]*>/gi, () => { stats.markup++; return ' '; });
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/(?:p|div|li|h[1-6]|tr|blockquote|section|td|th)\s*>/gi, '\n');
    text = text.replace(/<a\b[^>]*>/gi, () => { stats.links++; return ''; });
    text = text.replace(/<\/?[a-z][^>]*>/gi, () => { stats.markup++; return ''; });
    text = decodeCustomEntities(text);

    // 2. Markdown images and links: keep the label, drop the target.
    text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, () => { stats.links++; return ' '; });
    text = text.replace(/\[([^\]]{1,160})\]\([^)]+\)/g, (m, label) => { stats.links++; return label; });
    text = text.replace(/\[([^\]]{1,160})\]\[[^\]]*\]/g, (m, label) => { stats.links++; return label; });

    // 3. Bare URLs, plus the empty parentheses they leave behind.
    text = text.replace(/\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"')\]]+/gi, () => { stats.urls++; return ' '; });
    text = text.replace(/\(\s*\)/g, ' ');

    // 4. Citation markers: [1] [b] [note 3] [nb 1] [citation needed] [edit] ...
    const marker = /\[\s*(?:\d{1,3}|[a-z]|note\s*\d{1,2}|nb\s*\d{1,2}|citation needed|edit|update|sic|clarification needed|dubious|according to whom\?|who\?|when\?|where\?|why\?|how\?|not verified in body|page needed|need quotation to verify|failed verification|better source needed|original research\?)\s*\]/gi;
    text = text.replace(marker, () => { stats.citations++; return ''; });
    // MediaWiki residue that is not bracketed.
    text = text.replace(/\s*\((?:listen|help·info|info)\)/gi, () => { stats.citations++; return ''; });

    // 5. Markdown emphasis, headings and list markers.
    text = text.replace(/^#{1,6}\s+/gm, () => { stats.markup++; return ''; });
    text = text.replace(/(\*\*|__)(.+?)\1/g, (m, mark, inner) => { stats.markup++; return inner; });
    text = text.replace(/\*([^*\n]+?)\*/g, (m, inner) => { stats.markup++; return inner; });
    text = text.replace(/`([^`\n]*)`/g, (m, inner) => { stats.markup++; return inner; });
    text = text.replace(/^\s{0,4}(?:[-*•]|\d{1,3}[.)])\s+/gm, () => { stats.markup++; return ''; });

    // 6. Wikipedia chrome and the reference tail. Only when the paste really
    //    looks like a wiki copy, so an ordinary article keeps its own lines.
    const lookedLikeWiki = stats.citations > 0 || /\bWikipedia\b/.test(text);
    if (lookedLikeWiki) {
      const kept = [];
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        const key = trimmed.toLowerCase();
        if (key && (WIKI_CHROME.has(key) ||
            /^retrieved from\b/.test(key) ||
            /^this page was last edited on\b/.test(key) ||
            /^text is available under the creative commons\b/.test(key) ||
            /^wikimedia foundation\b/.test(key))) {
          stats.chrome++;
          continue;
        }
        if (/^\^\s/.test(trimmed)) { stats.references++; continue; }
        kept.push(line);
      }
      text = kept.join('\n');
    }

    // 7. Tidy the gaps the removals left behind.
    text = text.replace(/[ \t]+([,.;:!?])/g, '$1');
    text = text.replace(/[ \t]{2,}/g, ' ');
    text = text.replace(/[ \t]+\n/g, '\n');
    text = text.replace(/\n{3,}/g, '\n\n').trim();

    const removed = stats.citations + stats.links + stats.urls + stats.markup + stats.chrome + stats.references;
    return { text, stats, removed };
  }

  // One segment is one target: a single row of monospace glyphs typed in full,
  // spaces and punctuation included. Long pasted lines wrap at word boundaries.
  // Lines are wrapped by the measured pixel width, not by a character count:
  // a CJK glyph is not one ASCII monospace cell, and a Chinese sentence has no
  // spaces to break at, so wrap falls back to a per-character split.
  function customSegments(text) {
    const rowW = Math.max(320, W) - CFG.pad * 2;
    const maxW = Math.max(CUSTOM.minSegChars * Math.max(8, charW), rowW);
    const out = [];
    for (const line of customPlainLines(text)) {
      const chars = Array.from(line);
      const widths = chars.map((ch) => measureLogicalWidth(ch));
      let segStart = 0;
      let segW = 0;
      let lastSpace = -1;
      for (let i = 0; i < chars.length; i++) {
        segW += widths[i];
        if (chars[i] === ' ') lastSpace = i;
        if (segW <= maxW || i === segStart) continue;
        // Break the segment before char i, at the last space when there is one;
        // a script with no spaces (Chinese, Japanese) breaks per character.
        const cut = lastSpace > segStart ? lastSpace : i;
        const seg = chars.slice(segStart, cut).join('').trimEnd();
        if (seg) out.push(seg);
        if (out.length >= CUSTOM.maxLines) return out.slice(0, CUSTOM.maxLines);
        segStart = cut;
        if (chars[segStart] === ' ') segStart += 1;
        segW = 0;
        lastSpace = -1;
        for (let j = segStart; j <= i; j++) {
          segW += widths[j];
          if (chars[j] === ' ') lastSpace = j;
        }
      }
      const tail = chars.slice(segStart).join('').trim();
      if (tail) out.push(tail);
      if (out.length >= CUSTOM.maxLines) break;
    }
    return out.slice(0, CUSTOM.maxLines);
  }

  // Falling words: reading-order tokens. Pure-ASCII text keeps the historical
  // letters-only tokenizer; anything with another script goes through
  // Intl.Segmenter so "你好世界" becomes real words instead of one 4-character
  // token (and Japanese/Korean get the same treatment).
  function customTokens(text) {
    const source = customPlainText(text);
    const out = [];
    const push = (token) => {
      if (!token) return false;
      out.push(token);
      return out.length >= CUSTOM.maxTokens;
    };
    if (/^[\x20-\x7e\n]*$/.test(source)) {
      const raw = source.toLowerCase().match(/[a-z]+/g) || [];
      for (const token of raw) {
        if (token.length < 2 || token.length > CUSTOM.maxTokenLen) continue;
        if (push(token)) break;
      }
      return out;
    }
    let parts = null;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      try {
        parts = [];
        const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
        for (const part of segmenter.segment(source)) {
          if (part.isWordLike) parts.push(part.segment);
        }
      } catch (e) {
        parts = null;
      }
    }
    if (!parts) {
      parts = source.match(/[\p{L}\p{M}]+/gu) || [];
    }
    for (const part of parts) {
      // Keep letters and combining marks; drops punctuation and digits, which
      // matches the ASCII tokenizer's letters-only rule.
      const letters = String(part).replace(/[^\p{L}\p{M}]/gu, '');
      if (!letters) continue;
      let token = letters;
      if (/^[a-zA-Z]+$/.test(token)) {
        token = token.toLowerCase();
        if (token.length < 2 || token.length > CUSTOM.maxTokenLen) continue;  // "a", "I"
      } else if (token.length > CUSTOM.maxTokenLen) {
        continue;
      }
      if (push(token)) break;
    }
    return out;
  }

  function customCounts(text) {
    const normal = customPlainText(text);
    const lines = customPlainLines(text).length;
    const words = normal.trim() ? normal.trim().split(/\s+/).length : 0;
    const tokens = customTokens(text).length;
    const chars = normal.replace(/\s+/g, ' ').trim().length;
    return { lines, words, tokens, chars };
  }

  function customStageFromRecord(item) {
    if (!item || typeof item !== 'object') return null;
    const layout = customLayoutId(item.layout);
    const text = customLayoutText(item.text, layout);
    if (!text.trim()) return null;
    return {
      id: String(item.id || ('stage-' + Math.random().toString(36).slice(2, 10))),
      name: (String(item.name || 'Untitled stage').trim() || 'Untitled stage').slice(0, 40),
      text,
      layout,
      memorize: (layout === 'lines' || layout === 'prompts') && !!item.memorize,
      loop: !!item.loop,
      updated: Number(item.updated) || Date.now(),
    };
  }

  function loadCustomStages() {
    customStages = [];
    customLast = null;
    try {
      const raw = localStorage.getItem(CUSTOM_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const stage = customStageFromRecord(item);
          if (stage) customStages.push(stage);
          if (customStages.length >= CUSTOM.maxStages) break;
        }
      }
      const lastRaw = localStorage.getItem(CUSTOM_LAST_KEY);
      const last = lastRaw ? JSON.parse(lastRaw) : null;
      const lastLayout = last ? customLayoutId(last.layout) : 'lines';
      const lastText = last && typeof last.text === 'string'
        ? customLayoutText(last.text, lastLayout) : '';
      if (lastText.trim()) {
        customLast = {
          name: String(last.name || 'Untitled stage').slice(0, 40),
          text: lastText,
          layout: lastLayout,
          memorize: (lastLayout === 'lines' || lastLayout === 'prompts') && !!last.memorize,
          loop: !!last.loop,
          clean: last.clean !== false,
        };
      }
    } catch (e) {
      customStages = [];
      customLast = null;
    }
  }

  function saveCustomStages() {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(customStages)); } catch (e) { /* ignore */ }
  }

  function rememberCustomConfig(config) {
    customLast = {
      name: config.name,
      text: config.text,
      layout: config.layout,
      memorize: !!config.memorize,
      loop: !!config.loop,
      clean: config.clean !== false,
    };
    try { localStorage.setItem(CUSTOM_LAST_KEY, JSON.stringify(customLast)); } catch (e) { /* ignore */ }
  }

  // A blank stage name falls back to the text's opening words, so a list of
  // saved stages is still readable when the player never names them. A deck
  // uses its first prompt: the first `::` line is the title, not the whole deck.
  function customDefaultName(text, layout) {
    const id = customLayoutId(layout);
    let source;
    if (id === 'cards' || id === 'prompts') {
      const first = customCardSource(text).split('\n')[0] || '';
      const pair = customPairSplit(first);
      source = pair ? pair.left : '';
    } else {
      source = customPlainText(text);
    }
    const words = source.replace(/\s+/g, ' ').trim().split(' ').slice(0, 5).join(' ');
    return (words || 'Untitled stage').slice(0, 40);
  }

  function customConfigOf(config) {
    // Raw text: startCustomStage cleans and normalises it, so a direct debug
    // start and the editor take exactly the same path.
    const text = String(config && config.text != null ? config.text : '');
    const layout = customLayoutId(config && config.layout);
    // No fallback here: the name is derived from the *cleaned* text in
    // startCustomStage, so markup or citation junk never becomes the title.
    const name = String((config && config.name) || '').trim().slice(0, 40);
    return {
      id: config && config.id ? String(config.id) : null,
      name,
      text,
      clean: !(config && config.clean === false),
      layout,
      memorize: (layout === 'lines' || layout === 'prompts') && !!(config && config.memorize),
      loop: !!(config && config.loop),
    };
  }

  // The vertical home of a practice line: just above the middle of the board,
  // far from the signal strip, with room for the target frame and progress bar.
  function customLineY() {
    return Math.round((state.groundY - CFG.charH) * 0.52);
  }

  function startCustomStage(config) {
    const cfg = customConfigOf(config);
    // One cleaner, one entry point: the editor, F2/Again and the debug hook all
    // get the same treatment.
    const cleaned = cfg.clean ? customCleanText(cfg.text) : null;
    const sourceText = cleaned ? cleaned.text : cfg.text;
    const text = customLayoutText(sourceText, cfg.layout);
    cfg.text = text;
    if (!text.trim()) return false;
    // The auto-name ignores citation junk even when cleanup is switched off.
    const nameSource = cleaned ? cleaned.text : customCleanText(cfg.text).text;
    if (!cfg.name || cfg.name === 'Untitled stage') cfg.name = customDefaultName(nameSource, cfg.layout);
    const prepared = cfg.layout === 'lines'
      ? customSegments(text)
      : cfg.layout === 'words' ? customTokens(text)
        : cfg.layout === 'prompts' ? customPromptPairs(text) : customCards(text);
    if (!prepared.length) return false;

    closeMenus();
    if (ui.startMenu) ui.startMenu.classList.remove('open');
    resumePhase = null;
    hideDialogs();
    ensureAudio();
    rememberCustomConfig(cfg);
    reset();                       // fresh board, counters and RNG; clears custom
    state.phase = 'playing';
    state.difficulty = settings.difficulty;
    const custom = {
      config: cfg,
      name: cfg.name,
      layout: cfg.layout,
      memorize: cfg.memorize,
      loop: cfg.loop,
      cleaned: cleaned ? cleaned.stats : null,
      lines: cfg.layout === 'prompts'
        ? prepared.map((pair) => pair.typed)
        : cfg.layout === 'lines' ? prepared : [],
      tokens: cfg.layout === 'words' ? prepared : [],
      cards: cfg.layout === 'cards' ? prepared : [],
      prompts: cfg.layout === 'prompts' ? prepared : [],
      queue: [],
      remaining: 0,
      done: 0,
      total: prepared.length,
      lineIndex: 0,
      liveLine: null,
      nextLineT: 0,
      spawnT: 0.45,
      pass: 1,
      preview: 0,
      hidden: false,
      finished: false,
      // Cards: the session queue, per-card attempt counts, the live card and
      // the memory stats the result screen reports instead of WPM.
      cardQueue: [],
      cardSeen: {},
      cardLive: null,
      cardDone: 0,
      cardFirst: 0,
      cardAgain: 0,
      cardReviews: 0,
    };
    state.custom = custom;
    // The scene resolution depends on whether this practice stage runs sharp,
    // so pick it before the first frame of the stage.
    resize();
    if (custom.layout === 'lines' || custom.layout === 'prompts') {
      spawnCustomLine(0);
    } else if (custom.layout === 'words') {
      custom.queue = custom.tokens.slice();
      custom.remaining = custom.tokens.length;
    } else {
      custom.cardQueue = custom.cards.map((_, index) => index);
      spawnNextCard(custom);
    }
    if (!state.simulating && cleaned && cleaned.removed > 0) {
      popup(W / 2, 118, 'TEXT CLEANED \u00b7 ' + cleaned.removed + ' ITEMS REMOVED', COL.accent, {
        size: 12, vy: -12, life: 1.5,
      });
    }
    syncUi(true);
    focusImeSink();
    return true;
  }

  function spawnCustomLine(index) {
    const custom = state.custom;
    if (!custom || (custom.layout !== 'lines' && custom.layout !== 'prompts')) return null;
    const text = custom.lines[index];
    if (text == null) return null;
    const word = spawnWord(text, { x: CFG.pad, y: customLineY() });
    if (!word) return null;
    word.custom = true;
    word.static = true;
    word.line = true;
    if (custom.layout === 'prompts') {
      // The word is the typed answer; the shown side is drawn by its own pass.
      word.promptOnly = true;
      word.prompt = custom.prompts[index] ? custom.prompts[index].shown : '';
    }
    word.x = Math.max(CFG.pad, Math.min((W - word.w) / 2, W - CFG.pad - word.w));
    word.y = customLineY();
    word.progress = 0;
    custom.lineIndex = index;
    custom.liveLine = word;
    custom.nextLineT = 0;
    custom.preview = custom.memorize ? CUSTOM.previewSec : 0;
    custom.hidden = false;
    return word;
  }

  function spawnCustomRainWord() {
    const custom = state.custom;
    if (!custom || custom.layout !== 'words' || custom.remaining <= 0) return null;
    if (!custom.queue.length) return null;
    const text = custom.queue.shift();
    const word = spawnWord(text, {});
    if (!word) return null;
    word.custom = true;
    word.token = text;
    word.y = queueTop(word);
    return word;
  }

  function customLineHidden(word) {
    const custom = state.custom;
    return !!(custom && custom.layout === 'lines' && custom.memorize &&
      custom.hidden && word === custom.liveLine);
  }

  // ─── Cards: reveal and grade ──────────────────────────────────────────────
  // A card falls from the top of the board to the line. The player recalls the
  // answer, presses Space to flip the card, then grades with 1/2/3. "Again"
  // re-queues the card a few cards later; Good and Easy retire it. Nothing is
  // typed, so a slow keyboard is never the bottleneck - and a paraphrase is a
  // valid answer, because the player, not a string compare, is the judge.
  function cardStartY() {
    return Math.round(H * 0.16);
  }

  function cardFloorY() {
    return Math.round(state.groundY - 30);
  }

  function spawnNextCard(custom) {
    if (!custom) return null;
    if (!custom.cardQueue.length) { custom.cardLive = null; return null; }
    const index = custom.cardQueue.shift();
    const card = custom.cards[index];
    if (!card) return spawnNextCard(custom);
    const seen = custom.cardSeen[index] || 0;
    custom.cardSeen[index] = seen + 1;
    const attempts = seen + 1;
    // Longer definitions get a little more thinking time; one number for every
    // card would either rush a paragraph or pad a two-word translation.
    const dur = clamp(
      CUSTOM.cardRecallSec + Math.floor(card.answer.length / 14) + (attempts > 1 ? 2 : 0),
      CUSTOM.cardRecallSec,
      22
    );
    custom.cardLive = {
      index,
      card,
      attempts,
      y: cardStartY(),
      dur,
      t: 0,
      revealed: false,
      timedOut: false,
      timeoutT: 0,
    };
    return custom.cardLive;
  }

  function revealCard() {
    const custom = state.custom;
    if (!custom || custom.layout !== 'cards') return false;
    const live = custom.cardLive;
    if (!live || live.revealed) return false;
    live.revealed = true;
    live.timedOut = false;
    if (!state.simulating) {
      state.keyFlash = Math.max(state.keyFlash, 0.1);
      playKey(1, 4);
    }
    return true;
  }

  function cardTimeoutReveal(live) {
    live.revealed = true;
    live.timedOut = true;
    live.timeoutT = CUSTOM.cardTimeoutRevealSec;
    if (!state.simulating) {
      popup(W / 2, cardFloorY() - 46, 'TIME', COL.danger, { size: 16, vy: -20, life: 0.9 });
      playMistake();
    }
  }

  function gradeCard(grade) {
    const custom = state.custom;
    if (!custom || custom.layout !== 'cards') return false;
    const live = custom.cardLive;
    if (!live || !live.revealed) return false;
    custom.cardLive = null;
    custom.cardReviews += 1;
    if (grade === 'again') {
      custom.cardAgain += 1;
      const at = Math.min(custom.cardQueue.length, CUSTOM.cardRepeatGap);
      custom.cardQueue.splice(at, 0, live.index);
      if (!state.simulating) {
        popup(W / 2, cardFloorY() - 34, 'AGAIN', COL.danger, { size: 18, vy: -26, life: 0.9 });
        ring(W / 2, state.groundY, COL.danger, 150, 0.3, 2);
        playMistake();
      }
    } else {
      custom.cardDone += 1;
      if (live.attempts <= 1) custom.cardFirst += 1;
      if (!state.simulating) {
        popup(W / 2, cardFloorY() - 40, grade === 'easy' ? 'EASY' : 'GOOD', COL.typed, {
          size: 18, vy: -26, life: 0.9,
        });
        ring(W / 2, state.groundY, COL.typed, 160, 0.32, 2);
        streakBurst(W / 2, state.groundY - 40, 9, { radial: true, speed: 240, color: COL.typed });
        playClear(custom.cardDone, 0, false, 4);
      }
    }
    if (!custom.cardQueue.length) {
      if (custom.loop) customStartPass(custom);
      else customComplete();
    } else {
      spawnNextCard(custom);
    }
    return true;
  }

  // The only keys cards answer to: Space flips, 1/2/3 grade, Enter is a quick
  // Good. Anything else falls through, so Esc still pauses and F2 still restarts.
  function cardKey(key) {
    const custom = state.custom;
    if (!custom || custom.layout !== 'cards' || !custom.cardLive) return false;
    const live = custom.cardLive;
    if (!live.revealed) {
      if (key === ' ' || key === 'Spacebar') return revealCard();
      return false;
    }
    if (key === '1') return gradeCard('again');
    if (key === '2' || key === 'Enter') return gradeCard('good');
    if (key === '3') return gradeCard('easy');
    return false;
  }

  function updateCards(custom, dt) {
    const live = custom.cardLive;
    if (!live) {
      spawnNextCard(custom);
      if (!custom.cardLive) customComplete();
      return;
    }
    if (live.revealed) {
      // A timed-out card shows the answer for a beat, then takes itself as an
      // "again"; the player can still grade it first if they were close.
      if (live.timedOut && live.timeoutT > 0) {
        live.timeoutT -= dt;
        if (live.timeoutT <= 0) gradeCard('again');
      }
      return;
    }
    live.t += dt;
    const span = Math.max(1, cardFloorY() - cardStartY());
    live.y = cardStartY() + Math.min(1, live.t / live.dur) * span;
    if (live.t >= live.dur) cardTimeoutReveal(live);
  }

  function customHideLine() {
    const custom = state.custom;
    if (!custom || custom.hidden) return;
    custom.hidden = true;
    custom.preview = 0;
    // The persistent "TYPE FROM MEMORY" label above the line carries the cue;
    // a popup here would land on top of it.
    if (!state.simulating) state.keyFlash = Math.max(state.keyFlash, 0.12);
  }

  function updateCustom(dt) {
    const custom = state.custom;
    if (!custom || custom.finished) return;
    if (custom.layout === 'lines' || custom.layout === 'prompts') {
      if (custom.nextLineT > 0) {
        custom.nextLineT -= dt;
        if (custom.nextLineT <= 0) spawnCustomLine(custom.lineIndex + 1);
      } else if (custom.memorize && !custom.hidden && custom.preview > 0) {
        custom.preview -= dt;
        if (custom.preview <= 0) customHideLine();
      }
      state.dangerLevel = 0;
      state.dangerT = 0;
      return;
    }
    if (custom.layout === 'cards') {
      updateCards(custom, dt);
      state.dangerLevel = 0;
      state.dangerT = 0;
      return;
    }

    state.speed = CUSTOM.practiceSpeed;
    custom.spawnT -= dt;
    if (custom.spawnT <= 0 && state.words.length < CUSTOM.practiceMaxWords) {
      custom.spawnT = spawnCustomRainWord() ? CUSTOM.practiceSpawn : 0.45;
    }
    const base = state.speed * (H / 900);
    for (const word of state.words) word.y += base * dt;
    for (let i = state.words.length - 1; i >= 0; i--) {
      const word = state.words[i];
      if (word && word.y + CFG.charH >= state.groundY) customMiss(word);
    }
    state.dangerLevel = 0;
    state.dangerT = 0;
  }

  function customMiss(word) {
    const custom = state.custom;
    if (!custom || custom.finished) return;
    removeWord(word);
    if (word.token) custom.queue.push(word.token);   // comes back later; never a lost word
    state.combo = 0;
    state.flash = CFG.mistakeFlash * 0.7;
    state.shake = Math.max(state.shake, 0.16);
    if (!state.simulating) {
      const cx = clamp(word.x + word.w / 2, 0, W);
      popup(cx, state.groundY - 26, 'MISSED', hsl(0.0, 1, 0.58), { size: 14, vy: -20, life: 0.8 });
      ring(cx, state.groundY, hsl(0.0, 1, 0.58), 90, 0.24, 1);
    }
    playMistake();
  }

  function onCustomCleared(word) {
    const custom = state.custom;
    if (!custom || custom.finished) return;
    custom.done += 1;
    if (custom.layout === 'lines' || custom.layout === 'prompts') {
      custom.liveLine = null;
      if (custom.lineIndex + 1 >= custom.lines.length) customComplete();
      else custom.nextLineT = CUSTOM.nextLineGap;
    } else if (custom.remaining > 0) {
      custom.remaining -= 1;
      if (custom.remaining <= 0) customComplete();
    }
  }

  function customStartPass(custom) {
    custom.pass += 1;
    custom.done = 0;
    // -1 means "the next spawn is line 0 of the new pass" (updateCustom adds
    // one when it advances), so a looping one-line stage restarts correctly.
    custom.lineIndex = (custom.layout === 'lines' || custom.layout === 'prompts') ? -1 : 0;
    custom.liveLine = null;
    custom.hidden = false;
    custom.preview = 0;
    custom.nextLineT = 0;
    state.words.length = 0;
    state.lockWord = null;
    if (custom.layout === 'lines' || custom.layout === 'prompts') {
      custom.nextLineT = 0.6;
    } else if (custom.layout === 'cards') {
      custom.cardQueue = custom.cards.map((_, index) => index);
      custom.cardSeen = {};
      custom.cardLive = null;
      custom.cardDone = 0;
      custom.cardFirst = 0;
      custom.cardAgain = 0;
      custom.cardReviews = 0;
      spawnNextCard(custom);
    } else {
      custom.queue = custom.tokens.slice();
      custom.remaining = custom.tokens.length;
      custom.spawnT = 0.55;
    }
    state.punch = Math.max(state.punch, 0.8);
    state.clearFlash = Math.max(state.clearFlash, 0.6);
    ring(W / 2, H * 0.42, hsl(0.5, 1, 0.68), 260, 0.5, 3);
    popup(W / 2, H * 0.35, 'LOOP ' + custom.pass, hsl(0.5, 1, 0.68), { size: 26, vy: -18, life: 1.2 });
    playPick();
    syncUi(true);
  }

  function customComplete() {
    const custom = state.custom;
    if (!custom || custom.finished) return;
    if (custom.loop) {
      customStartPass(custom);
      return;
    }
    custom.finished = true;
    state.phase = 'customdone';
    state.dangerLevel = 0;
    state.dangerT = 0;
    state.punch = Math.max(state.punch, 1);
    state.clearFlash = Math.max(state.clearFlash, 0.9);
    state.shake = Math.max(state.shake, 0.32);
    ring(W / 2, H * 0.42, hsl(0.12, 1, 0.64), 360, 0.7, 4);
    ring(W / 2, H * 0.42, hsl(0.52, 1, 0.68), 230, 0.5, 2);
    ring(W / 2, H * 0.42, hsl(0.85, 1, 0.66), 130, 0.34, 2);
    streakBurst(W / 2, H * 0.42, 22, { radial: true, speed: 340, spread: 40 });
    popup(W / 2, H * 0.36, 'STAGE COMPLETE', hsl(0.12, 1, 0.64), { size: 30, vy: -22, life: 1.4 });
    playDawn();
    syncUi(true);
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
    state.keyPunch = Math.max(0, state.keyPunch - dt * 10);
    state.keyFlash = Math.max(0, state.keyFlash - dt * 4.2);
    state.keyStreak = Math.max(0, state.keyStreak - dt * 11);
    state.shock = Math.max(0, state.shock - dt * 2.4);
    state.splitFlashT = Math.max(0, state.splitFlashT - dt);
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
    updateStreaks(dt);

    if (state.phase === 'menu') {
      updateMenuRain(dt);
      return;
    }

    if (state.phase === 'draft') {
      state.draftAnim = Math.min(1, state.draftAnim + dt / CFG.draftRise);
      return;
    }
    if (state.phase !== 'playing') return;
    if (state.hitPause > 0) {
      state.hitPause -= dt;
      return;
    }

    // Custom stages run their own update: no pressure, no spawn ramp, no
    // flares, no hearts. The practice clock and input path are shared.
    if (state.custom) {
      updateCustom(dt);
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

    // Flare event: an occasional short word that races down and cannot cost a
    // Life. It is timed rather than pressure-driven, so it reads as a bonus.
    state.flareT -= dt;
    if (state.flareT <= 0) {
      state.flareT = CFG.flareMinGap + rng() * (CFG.flareMaxGap - CFG.flareMinGap);
      spawnFlare();
    }

    const longshotBoost = has('longshot') ? 1.05 : 1;
    const base = state.speed * (H / 900);
    for (const w of state.words) {
      const fakeBoost = w.fake ? CFG.fakeSpeedMult : 1;
      const flareBoost = w.flare ? CFG.flareSpeedMult : 1;
      // Nine- and ten-letter words get 8% more air. Playtest feedback was that
      // long words feel like a death sentence late in a run ("the word is so
      // long I die"); this keeps them dangerous without making the ramp unfair.
      const lengthRelief = w.text.length >= 9 ? 0.92 : 1;
      const mult = (w.text.length >= 7 ? longshotBoost : 1) * fakeBoost * flareBoost * lengthRelief;
      w.y += base * mult * dt;
      // Flares leave a bright sparkle trail so the player can spot one coming.
      if (!state.simulating && w.flare) {
        w.sparkT = (w.sparkT || 0) - dt;
        if (w.sparkT <= 0) {
          w.sparkT = 0.04;
          addStreak(w.x + Math.random() * w.w, w.y + Math.random() * CFG.charH, {
            vy: -130 - Math.random() * 90,
            life: 0.26 + Math.random() * 0.18,
            len: 8 + Math.random() * 12,
            width: 1,
            color: COL.flare,
          });
        }
      }
      // Comet tail: sample the word's position a little under the RNG-free
      // visual clock. Presentation only, so the headless sim skips it.
      if (!state.simulating) {
        w.trailT -= dt;
        if (w.trailT <= 0) {
          w.trailT = CFG.trailEvery;
          w.trail.push({ x: w.x, y: w.y });
          if (w.trail.length > CFG.trailLen) w.trail.shift();
        }
      }
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
      // First time a fake becomes the lowest word, say so out loud. The rule is
      // "every key is a mistake", but the player deserves the one-time cue.
      if (t && t.fake && !t.decoyHinted) {
        t.decoyHinted = true;
        popup(clamp(t.x + t.w / 2, 60, W - 60), Math.max(24, t.y - 16), 'DECOY \u00b7 LET IT PASS', COL.fake, {
          size: 13, vy: -18, life: 1.2,
        });
      }
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

  function updateStreaks(dt) {
    for (let i = state.streaks.length - 1; i >= 0; i--) {
      const s = state.streaks[i];
      s.life -= dt;
      if (s.life <= 0) {
        state.streaks.splice(i, 1);
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 1 - (s.drag || 3) * dt;
      s.vy *= 1 - (s.drag || 3) * dt;
      s.len *= 1 - 1.6 * dt;
    }
  }

  // ─── Playfield rendering - soft-focus ─────────────────────────────────────
  const WORD_FONT = 'bold 24px "Lucida Console", "Courier New", "Microsoft YaHei", "SimHei", monospace';
  // Cards carry arbitrary text, including CJK: the CJK faces at the end of the
  // stack are what keep a Chinese deck legible, and measureText gives the real
  // width so nothing is positioned with the ASCII glyph advance.
  const CARD_FAMILY = '"Lucida Console", "Courier New", "Microsoft YaHei", "SimHei", monospace';
  // Card chrome is deliberately larger than the 9px PIXEL_FONT labels: the hint
  // has to survive the soft-focus upscale when Sharp text is off.
  const CARD_LABEL_FONT = 'bold 13px "Lucida Console", "Courier New", monospace';
  const CARD_LEGEND_FONT = 'bold 16px "Lucida Console", "Courier New", monospace';
  const PIXEL_FONT = '9px "Microsoft Sans Serif", Tahoma, sans-serif';
  const PARTICLE_COLORS = ['#ff2bd1', '#25f4ff', '#b6ff1a', '#ffae00', '#ffffff', '#8a5bff'];

  function render() {
    // Draw the whole scene at low resolution, then upscale it into the visible
    // canvas with smoothing. Everything - backdrop, words, hit effects - shares
    // the same soft blur, and the pixel cost is a fraction of a full-res frame.
    renderStamp += 1;
    renderCacheActive = true;
    ctx = sctx;
    ctx.save();
    const zoom = 1 + state.punch * 0.014 + state.keyPunch * 0.04;
    if (zoom > 1.001) {
      ctx.translate(W / 2, H / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-W / 2, -H / 2);
    }
    if (state.shake > 0.01) {
      ctx.translate(
        Math.sin(state.t * 91) * state.shake * 11,
        Math.cos(state.t * 67) * state.shake * 7
      );
    }
    drawBackdrop();
    if (state.phase === 'menu') drawMenuRain();
    drawEchoes();
    drawDangerLine();
    drawWords();
    drawCustomPrompts();
    drawCustomCards();
    drawShards();
    drawParticles();
    drawStreaks();
    drawRings();
    drawPopups();
    drawShockBands();
    drawWaveBanner();
    drawWaveClear();
    ctx.restore();

    drawEdgeFx();
    if (state.flash > 0) {
      ctx.fillStyle = `rgba(255, 0, 0, ${(state.flash / CFG.mistakeFlash) * 0.22})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state.blockFlash > 0) {
      ctx.fillStyle = `rgba(120, 255, 255, ${(state.blockFlash / 0.18) * 0.12})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state.clearFlash > 0) {
      ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.16, state.clearFlash * 0.1)})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawKeyFlash();

    // The upscale. This single smoothed draw is the heavy blur over the words.
    ctx = out;
    out.drawImage(scene, 0, 0, canvas.width, canvas.height);
    syncUi();
    renderCacheActive = false;
  }

  // The blurred backdrop: near-black with a handful of huge, very dim colour
  // discs drifting slowly. There is no warping, no glitch and no rainbow layer;
  // the low-resolution upscale is what turns these into soft out-of-focus blobs.
  function drawBackdrop() {
    ctx.fillStyle = '#04030a';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const b of BG_BLOBS) {
      const x = W * (b.x + Math.sin(state.t * b.sx + b.ph) * 0.06);
      const y = H * (b.y + Math.cos(state.t * b.sy + b.ph) * 0.05);
      const r = Math.max(W, H) * b.r * (1 + Math.sin(state.t * 0.05 + b.ph) * 0.05);
      const hue = MOD(b.hue + state.t * 0.004, 1);
      ctx.fillStyle = hsl(hue, 0.75, b.l, b.a);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    // A veil for word contrast, and a darker strip below the danger line.
    ctx.fillStyle = 'rgba(3, 2, 10, 0.30)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(2, 1, 8, 0.7)';
    ctx.fillRect(0, state.groundY, W, H - state.groundY);
  }

  // ── Attract mode (main screen backdrop) ───────────────────────────────────
  function makeMenuDrop(scatter) {
    const text = MENU_RAIN_WORDS[(Math.random() * MENU_RAIN_WORDS.length) | 0];
    const w = charW * text.length;
    return {
      text,
      x: CFG.pad + Math.random() * Math.max(40, W - CFG.pad * 2 - w),
      y: scatter ? Math.random() * (H - CFG.groundPad) : -40 - Math.random() * 240,
      speed: 14 + Math.random() * 28,
      alpha: 0.16 + Math.random() * 0.18,
      hue: (Math.random() * 0.5 + 0.42) % 1,
      sway: Math.random() * Math.PI * 2,
    };
  }

  function initMenuRain() {
    state.menuRain = [];
    for (let i = 0; i < 14; i++) state.menuRain.push(makeMenuDrop(true));
  }

  function updateMenuRain(dt) {
    if (!state.menuRain.length) { initMenuRain(); return; }
    for (const drop of state.menuRain) {
      drop.y += drop.speed * dt;
      if (drop.y > H - CFG.groundPad + 12) Object.assign(drop, makeMenuDrop(false));
    }
  }

  function drawMenuRain() {
    if (!state.menuRain.length) return;
    ctx.save();
    ctx.font = WORD_FONT;
    ctx.textBaseline = 'top';
    for (const drop of state.menuRain) {
      const textW = charW * drop.text.length;
      const x = clamp(drop.x + Math.sin(state.t * 0.5 + drop.sway) * 6, 4, Math.max(4, W - 4 - textW));
      ctx.globalAlpha = drop.alpha;
      ctx.fillStyle = hsl(drop.hue, 0.7, 0.6);
      ctx.fillText(drop.text, x, drop.y);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Combo and danger bleed into the frame edges, so the state of the run is
  // readable from the playfield even when the HUD is out of focus.
  function drawEdgeFx() {    const combo = Math.min(state.combo, 20);
    if (combo >= 3) {
      const a = 0.12 + (combo / 20) * 0.26;
      const wide = 2 + Math.round((combo / 20) * 5);
      ctx.fillStyle = hsl(MOD(state.t * 0.09 + 0.14, 1), 1, 0.6, a);
      ctx.fillRect(0, 0, wide, H);
      ctx.fillRect(W - wide, 0, wide, H);
    }
    const danger = state.dangerLevel || 0;
    if (danger > 0.12) {
      const beat = 0.55 + 0.45 * Math.sin(state.t * 8);
      ctx.fillStyle = `rgba(255, 0, 0, ${danger * 0.3 * beat})`;
      ctx.fillRect(0, 0, W, 3);
      ctx.fillRect(0, H - 3, W, 3);
      ctx.fillStyle = hsl(0.0, 1, 0.6, danger * 0.18 * beat);
      ctx.fillRect(0, 0, 8, H);
      ctx.fillRect(W - 8, 0, 8, H);
    }
    if (state.lives <= 1 && state.phase === 'playing') {
      const pulse = 0.5 + 0.5 * Math.sin(state.t * 3.1);
      ctx.fillStyle = `rgba(255, 0, 0, ${0.04 + pulse * 0.05})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state.phase === 'gameover') {
      ctx.fillStyle = `rgba(255, 0, 0, ${0.10 + 0.06 * Math.sin(state.t * 2)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (state.phase === 'dawn') {
      ctx.fillStyle = `rgba(255, 255, 0, ${0.06 + 0.04 * Math.sin(state.t * 1.4)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  // The per-keystroke colour flash: each letter paints the frame with its own
  // hue for a couple of frames.
  function drawKeyFlash() {
    if (state.keyFlash <= 0.006) return;
    const a = Math.min(0.2, state.keyFlash * 0.85);
    ctx.fillStyle = hsl(state.keyHue, 1, 0.6, a);
    ctx.fillRect(0, 0, W, H);
  }

  // Expanding horizontal bands on a clear - the "screen just got hit" beat.
  function drawShockBands() {
    if (state.shock <= 0.02) return;
    const spread = (1 - state.shock) * H * 0.55 + 24;
    for (let i = 0; i < 4; i++) {
      const a = state.shock * (0.5 - i * 0.09);
      if (a <= 0) continue;
      ctx.fillStyle = hsl(MOD(state.t * 0.15 + i * 0.3, 1), 1, 0.7, a);
      const up = Math.round(H / 2 - spread - i * 20);
      const down = Math.round(H / 2 + spread + i * 20);
      ctx.fillRect(0, up, W, 3);
      ctx.fillRect(0, down, W, 3);
    }
  }

  function drawStreaks() {
    if (!state.streaks.length) return;
    for (const s of state.streaks) {
      const a = Math.max(0, Math.min(1, s.life / s.max));
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = s.color;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), s.width, Math.max(1, Math.round(s.len)));
    }
    ctx.globalAlpha = 1;
  }

  function drawEchoes() {
    ctx.font = WORD_FONT;
    ctx.textBaseline = 'top';
    for (const e of state.echoes) {
      const k = clamp(e.t / e.ttl, 0, 1);
      const flicker = 0.55 + 0.45 * Math.sin(state.t * 9 + e.x * 0.01);
      ctx.globalAlpha = (0.12 + k * 0.4) * flicker;
      ctx.fillStyle = hsl(MOD(0.58 + state.t * 0.06, 1), 0.7, 0.68);
      const x = Math.max(4, Math.min(e.x, W - 4 - e.w));
      ctx.fillText(e.text, x, e.y + (1 - k) * 5);
    }
    ctx.globalAlpha = 1;
  }

  function drawDangerLine() {
    const y = state.groundY;
    // Practice has no danger: a quiet rule marks the edge of the board and
    // nothing here can cost a life.
    if (state.custom) {
      ctx.save();
      ctx.globalAlpha = 0.42;
      ctx.strokeStyle = COL.wordSet;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = PIXEL_FONT;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = COL.wordSet;
      ctx.fillText('PRACTICE', W - 6, y - 2);
      ctx.restore();
      return;
    }
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

    drawOrder.length = 0;
    for (const w of state.words) drawOrder.push(w);
    drawOrder.sort((a, b) => a.y - b.y);
    for (const w of drawOrder) {
      // Prompts draw their own pass: the board shows the cue, not the answer.
      if (w.promptOnly) continue;
      const urgent = w.y + CFG.charH > state.groundY - 130;
      const inSet = set.indexOf(w) >= 0;
      const isTarget = w === target;
      const memorized = customLineHidden(w);
      // Idle sway: every word drifts on its own little orbit. Visual only.
      const sway = light ? 0 : Math.sin(state.t * 1.55 + w.sway) * (isTarget ? 2.4 : 1.3);
      let x = Math.max(4, Math.min(w.x + sway, W - 4 - w.w));
      if (urgent && w === target) x += Math.round(Math.sin(state.t * 42) * 2);

      let color = COL.wordIdle;
      if (inSet) color = COL.wordSet;
      if (w.fake) color = COL.fake;
      if (w.harmless) color = COL.splitWord;
      if (w.flare) color = COL.flare;
      if (isTarget) {
        // A Decoy fake that happens to be the lowest word is still a fake: it
        // must never borrow the target colour, or the one moment where the
        // "every key is a mistake" rule bites reads as a stuck real word.
        color = w.fake
          ? COL.fake
          : (urgent
            ? (Math.sin(state.t * 20) > 0 ? COL.danger : COL.gold)
            : COL.target);
      }

      // ── Comet trail ──────────────────────────────────────────────────────
      // Every word drags a fading neon tail behind it (sampled in update()).
      // The colour is its own hue rotated into the background's wheel, so the
      // trail reads as motion without stealing the word's own colour identity.
      if (!light && !w.static && state.phase === 'playing' && w.trail.length > 1) {
        const trailColor = w.flare
          ? COL.flare
          : hsl(MOD(w.hue + state.t * 0.05 + 0.45, 1), 1, 0.62);
        const speedRatio = clamp((state.speed - 40) / 60, 0, 1);
        for (let k = 0; k < w.trail.length - 1; k++) {
          const p = w.trail[k];
          const a = (k + 1) / w.trail.length;
          ctx.globalAlpha = ((w.flare ? 0.06 : 0.035) + (w.flare ? 0.3 : 0.2) * a) *
            (0.6 + speedRatio * 0.4);
          ctx.fillStyle = trailColor;
          ctx.fillText(w.text, Math.max(4, Math.min(p.x, W - 4 - w.w)), p.y);
        }
        ctx.globalAlpha = 1;
        // Speed-lines underneath the word: three hard vertical dashes.
        if (speedRatio > 0.05) {
          ctx.fillStyle = trailColor;
          ctx.globalAlpha = (w.flare ? 0.3 : 0.16) + speedRatio * 0.3;
          const lx = Math.max(4, Math.min(w.x + sway, W - 4 - w.w));
          ctx.fillRect(lx + w.w * 0.25, w.y - 9, 1, 7 + speedRatio * 8);
          ctx.fillRect(lx + w.w * 0.55, w.y - 13, 1, 9 + speedRatio * 10);
          ctx.fillRect(lx + w.w * 0.82, w.y - 8, 1, 6 + speedRatio * 6);
          ctx.globalAlpha = 1;
        }
      }

      const age = state.t - (w.born || 0);
      const spawnPhase = age < 0.24 ? age / 0.24 : 1;
      const spawning = spawnPhase < 1 && !light;
      if (spawning) ctx.globalAlpha = 0.35 + 0.65 * spawnPhase;

      // Shadow pass first: one fillText for the whole word keeps glyphs legible
      // over the bright parts of the tunnel without doubling the glyph cost.
      // A memorized line must skip it: the black copy would leak every letter
      // the player is supposed to be recalling.
      if (!light && !memorized) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
        ctx.fillText(w.text, x + 2, w.y + 2);
      }

      for (let i = 0; i < w.text.length; i++) {
        const pos = rev ? w.text.length - 1 - i : i;
        const typed = pos < w.progress;
        const hidden = tunnelN > 0 && !typed && pos >= w.progress + tunnelN;
        const px = x + (w.offsets ? w.offsets[i] : i * charW);
        const gw = w.glyphW ? w.glyphW[i] : charW;
        if (hidden) {
          ctx.fillStyle = COL.hidden;
          ctx.fillText('\u00b7', px, w.y);
          continue;
        }
        // Memorize: the untyped rest of the line becomes dots. The rhythm and
        // length stay readable; the words have to come from memory.
        if (memorized && pos >= w.progress) {
          ctx.fillStyle = COL.hidden;
          ctx.fillText('\u00b7', px, w.y);
          continue;
        }
        // Words materialise out of the signal: a few glyphs flicker in first.
        if (spawning && (i * 37 + Math.floor(state.t * 34) * 17) % 7 < 2) continue;

        // Typed letters detonate: a big scale-pop with a red/cyan chromatic
        // split, then they settle at the typed colour.
        const popDur = 0.24;
        const pop = typed ? state.t - (w.typedAt[pos] || -9) : 9;
        if (pop >= 0 && pop < popDur) {
          const k = pop / popDur;
          const scale = 1 + (light ? 0.5 : 2.1) * (1 - k);
          const glyph = w.text[i];
          ctx.save();
          ctx.translate(px + gw / 2, w.y + CFG.charH / 2);
          ctx.scale(scale, scale);
          if (!light && k < 0.65) {
            const off = 2 + (1 - k) * 5;
            ctx.fillStyle = 'rgba(255, 0, 96, 0.9)';
            ctx.fillText(glyph, -gw / 2 - off, -CFG.charH / 2);
            ctx.fillStyle = 'rgba(0, 238, 255, 0.9)';
            ctx.fillText(glyph, -gw / 2 + off, -CFG.charH / 2);
          }
          ctx.fillStyle = k < 0.45
            ? COL.white
            : hsl(MOD(state.keyHue + i * 0.05, 1), 1, 0.7);
          ctx.fillText(glyph, -gw / 2, -CFG.charH / 2);
          ctx.restore();
          continue;
        }

        ctx.fillStyle = typed ? COL.typed : color;
        ctx.fillText(w.text[i], px, w.y);
      }
      if (spawning) ctx.globalAlpha = 1;

      if (w.custom && w.line) drawCustomLineHints(w, x);

      if (isTarget) drawTargetMarker(w, x, urgent);
      else if (inSet) drawSetMarker(w, x);
      if (w.fake) drawFakeMarker(w, x);
      if (w.flare) drawFlareMarker(w, x);
      else if (w.harmless) drawHarmlessMarker(w, x);
    }
  }

  // Flare: bright cyan chevrons above the word, a pulsing bracket and a dotted
  // underline, so the fast harmless bonus word reads as an event rather than a
  // normal target even through the soft-focus blur.
  function drawFlareMarker(w, x) {
    const beat = 0.5 + 0.5 * Math.sin(state.t * 12);
    const cx = x + w.w / 2;
    ctx.save();
    ctx.fillStyle = COL.flare;
    ctx.globalAlpha = 0.55 + beat * 0.4;
    for (let i = 0; i < 2; i++) {
      const yy = w.y - 8 - i * 5;
      ctx.beginPath();
      ctx.moveTo(cx - 6, yy);
      ctx.lineTo(cx, yy - 4);
      ctx.lineTo(cx + 6, yy);
      ctx.lineTo(cx + 6, yy + 2);
      ctx.lineTo(cx, yy - 2);
      ctx.lineTo(cx - 6, yy + 2);
      ctx.closePath();
      ctx.fill();
    }
    // Pulsing bracket around the word.
    ctx.globalAlpha = 0.4 + beat * 0.45;
    ctx.strokeStyle = COL.flare;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 4, w.y - 3, w.w + 8, CFG.charH + 6);
    for (let px = x; px < x + w.w; px += 4) ctx.fillRect(px, w.y + CFG.charH + 4, 2, 2);
    ctx.restore();
  }

  // Split's free word: dotted teal rule ABOVE the word (fakes are marked below).
  function drawHarmlessMarker(w, x) {
    ctx.save();
    ctx.fillStyle = COL.splitWord;
    for (let px = x; px < x + w.w; px += 3) ctx.fillRect(px, w.y - 4, 2, 1);
    ctx.restore();
  }

  function drawTargetMarker(w, x, urgent) {
    const color = w.fake ? COL.fake : (urgent ? COL.danger : COL.target);
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

  // Practice-line furniture: a blinking caret at the next character, plus the
  // Memorize state above the line (preview countdown, then the recall cue).
  // ─── Card rendering ───────────────────────────────────────────────────────
  // A card is a prompt that falls to the line and flips to show its answer.
  // The text is measured with the real font (CJK faces included), not with the
  // ASCII glyph advance, so a mixed deck wraps correctly.
  function cardSetFont(size) {
    ctx.font = 'bold ' + size + 'px ' + CARD_FAMILY;
  }

  function cardWrap(text, maxW, size) {
    cardSetFont(size);
    const out = [];
    let line = '';
    let lastSpace = -1;
    for (const ch of String(text)) {
      if (ch === ' ') lastSpace = line.length;
      if (line && ctx.measureText(line + ch).width > maxW) {
        const cut = lastSpace > 0 ? lastSpace : line.length;
        out.push(line.slice(0, cut).trimEnd());
        line = line.slice(cut).trimStart() + ch;
        lastSpace = -1;
      } else {
        line += ch;
      }
    }
    if (line.trim()) out.push(line.trim());
    return out.length ? out : [''];
  }

  function cardFit(text, maxW, maxSize, minSize, maxLines) {
    let size = maxSize;
    while (size > minSize) {
      const lines = cardWrap(text, maxW, size);
      if (lines.length <= maxLines) return { size, lines };
      size -= 2;
    }
    return { size: minSize, lines: cardWrap(text, maxW, minSize).slice(0, maxLines) };
  }

  function drawCardLines(lines, cx, top, lineHeight, color, shadow) {
    ctx.textAlign = 'left';
    if (shadow) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
      for (let i = 0; i < lines.length; i++) {
        const w = ctx.measureText(lines[i]).width;
        ctx.fillText(lines[i], cx - w / 2 + 2, top + i * lineHeight + 2);
      }
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = color;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], cx, top + i * lineHeight);
    }
  }

  function drawCustomCards() {
    const custom = state.custom;
    if (!custom || custom.layout !== 'cards' || state.phase !== 'playing') return;
    const live = custom.cardLive;
    if (!live) return;

    const cx = W / 2;
    const maxW = Math.max(240, W - CFG.pad * 2);
    const floor = cardFloorY();
    const promptFit = cardFit(
      live.card.prompt, maxW,
      Math.round(clamp(H * 0.055, 24, 46)), 18, 2
    );
    const answerFit = live.revealed
      ? cardFit(live.card.answer, maxW, Math.round(clamp(H * 0.032, 15, 28)), 12, 4)
      : null;
    const promptLH = Math.round(promptFit.size * 1.2);
    const answerLH = answerFit ? Math.round(answerFit.size * 1.32) : 0;
    const gap = live.revealed ? Math.round(promptFit.size * 0.5) : 0;
    const blockH = promptFit.lines.length * promptLH + gap +
      (answerFit ? answerFit.lines.length * answerLH : 0);
    let top = live.revealed ? Math.min(live.y, floor - blockH - 16) : live.y;
    top = Math.max(24, Math.min(top, Math.max(24, floor - 10)));
    const timeLeft = live.revealed ? 0 : clamp(1 - live.t / live.dur, 0, 1);
    const urgent = !live.revealed && timeLeft < 0.22;

    ctx.save();
    ctx.textBaseline = 'top';

    // Label above the card: the recall cue, or the answer cue once flipped.
    ctx.font = CARD_LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.fillStyle = live.revealed ? COL.typed : (urgent ? COL.danger : COL.accent);
    ctx.globalAlpha = 1;
    ctx.fillText(
      live.revealed
        ? (live.timedOut ? 'ANSWER \u00b7 MISSED' : 'ANSWER')
        : 'RECALL \u00b7 ' + (custom.cardDone + 1) + '/' + custom.total,
      cx, top - 24
    );
    ctx.globalAlpha = 1;

    // Prompt block.
    cardSetFont(promptFit.size);
    drawCardLines(promptFit.lines, cx, top, promptLH,
      live.revealed ? COL.wordIdle : COL.wordSet, true);

    // Answer block, with a short rule between prompt and answer.
    if (live.revealed && answerFit) {
      const ruleY = top + promptFit.lines.length * promptLH + gap * 0.5;
      ctx.fillStyle = COL.typed;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(cx - 28, ruleY, 56, 1);
      ctx.globalAlpha = 1;
      cardSetFont(answerFit.size);
      drawCardLines(answerFit.lines, cx, top + promptFit.lines.length * promptLH + gap,
        answerLH, live.timedOut ? COL.amber : COL.typed, true);
    }

    // The fall itself is the timer: a thin bar under the prompt drains as the
    // card approaches the line, so the pressure is readable without a number.
    if (!live.revealed) {
      const barW = Math.min(maxW, 460);
      const barY = top + promptFit.lines.length * promptLH + 10;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.fillRect(cx - barW / 2, barY, barW, 2);
      ctx.fillStyle = urgent ? COL.danger : COL.accent;
      ctx.fillRect(cx - barW / 2, barY, Math.max(0, barW * timeLeft), 2);
    }

    // Key legend, parked in the top-right where a card can never reach it. It
    // gets its own dark plate and a much larger font: this is the only place
    // that tells a first-time player the drill's controls.
    const legend = live.revealed
      ? '1 AGAIN   2 GOOD   3 EASY   ENTER GOOD'
      : 'SPACE REVEAL';
    ctx.font = CARD_LEGEND_FONT;
    ctx.textAlign = 'right';
    const legendW = ctx.measureText(legend).width;
    const legendRight = W - CFG.pad;
    const legendTop = 12;
    ctx.fillStyle = 'rgba(2, 1, 8, 0.78)';
    ctx.fillRect(legendRight - legendW - 10, legendTop - 4, legendW + 18, 24);
    ctx.fillStyle = live.revealed ? COL.accent : COL.white;
    ctx.globalAlpha = 0.96;
    ctx.fillText(legend, legendRight, legendTop);
    ctx.restore();
  }

  // Prompts: the cue sits above the line and the answer is typed below it. The
  // typed glyphs stay green; untyped glyphs are dots, so the answer is never
  // shown but the player still sees their place in it.
  function drawCustomPrompts() {
    const custom = state.custom;
    if (!custom || custom.layout !== 'prompts' || state.phase !== 'playing') return;
    const word = custom.liveLine;
    if (!word) return;
    const cx = W / 2;
    const maxW = Math.max(240, W - CFG.pad * 2);
    const promptTop = Math.round(customLineY() - 88);

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    if (!custom.hidden) {
      const fit = cardFit(word.prompt || '', maxW, Math.round(clamp(H * 0.045, 22, 38)), 16, 2);
      cardSetFont(fit.size);
      const lh = Math.round(fit.size * 1.2);
      ctx.fillStyle = COL.amber;
      for (let i = 0; i < fit.lines.length; i++) ctx.fillText(fit.lines[i], cx, promptTop + i * lh);
      if (custom.memorize && custom.preview > 0) {
        ctx.font = CARD_LABEL_FONT;
        ctx.fillStyle = COL.target;
        ctx.globalAlpha = 0.8;
        ctx.fillText('HIDES IN ' + Math.ceil(custom.preview) + 's', cx, promptTop - 24);
        ctx.globalAlpha = 1;
      }
    } else {
      ctx.font = CARD_LEGEND_FONT;
      ctx.fillStyle = COL.accent;
      ctx.globalAlpha = 0.85;
      ctx.fillText('TYPE FROM MEMORY', cx, promptTop + 6);
      ctx.globalAlpha = 1;
    }

    // The typed answer line: the prompt above was the cue, not this text.
    ctx.font = WORD_FONT;
    ctx.textAlign = 'left';
    const y = word.y;
    for (let i = 0; i < word.text.length; i++) {
      const px = word.x + (word.offsets ? word.offsets[i] : i * charW);
      if (i < word.progress) {
        ctx.fillStyle = COL.typed;
        ctx.fillText(word.text[i], px, y);
      } else {
        ctx.fillStyle = COL.hidden;
        ctx.fillText('\u00b7', px, y);
      }
    }
    drawTargetMarker(word, word.x, false);
    ctx.restore();
  }

  function drawCustomLineHints(w, x) {
    const custom = state.custom;
    if (!custom || state.phase !== 'playing' || state.words.indexOf(w) < 0) return;
    if (w.progress < w.text.length && Math.sin(state.t * 7.5) > 0) {
      const px = x + (w.offsets ? w.offsets[w.progress] : w.progress * charW);
      const gw = w.glyphW ? w.glyphW[w.progress] : charW;
      ctx.fillStyle = COL.typed;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(px + 1, w.y + CFG.charH - 3, Math.max(2, gw - 2), 2);
      ctx.globalAlpha = 1;
    }
    if (!custom.memorize || w !== custom.liveLine) return;
    ctx.save();
    ctx.font = PIXEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    if (custom.hidden) {
      ctx.fillStyle = COL.accent;
      ctx.globalAlpha = 0.75;
      ctx.fillText('TYPE FROM MEMORY', x + w.w / 2, w.y - 12);
    } else if (custom.preview > 0) {
      ctx.fillStyle = COL.target;
      ctx.globalAlpha = 0.8;
      ctx.fillText('PREVIEW ' + Math.ceil(custom.preview) + 's', x + w.w / 2, w.y - 12);
    }
    ctx.restore();
  }

  function drawSetMarker(w, x) {
    ctx.save();
    ctx.fillStyle = COL.wordSet;
    for (let px = x; px < x + w.w; px += 4) ctx.fillRect(px, w.y + CFG.charH + 3, 2, 1);
    ctx.restore();
  }

  // Decoy fakes are un-typeable on purpose, so they must not look like a target.
  // A magenta word, a hard DOUBLE underline and a DECOY tag above it survive the
  // soft-focus renderer; the old single 1-px line did not.
  function drawFakeMarker(w, x) {
    ctx.save();
    ctx.fillStyle = COL.fake;
    ctx.font = 'bold 10px "Lucida Console", "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText('DECOY', x + 1, w.y - 7);
    for (let px = x; px < x + w.w; px += 3) {
      ctx.fillRect(px, w.y + CFG.charH + 1, 2, 2);
      ctx.fillRect(px, w.y + CFG.charH + 4, 2, 1);
    }
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
    ctx.translate(W / 2, H * 0.5);
    const s = 0.65 + 0.35 * pop;
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 44px "Lucida Console", "Courier New", monospace';
    ctx.fillStyle = '#000000';
    ctx.fillText('WAVE ' + state.waveClearWave + ' CLEARED', 3, 3);
    ctx.fillStyle = COL.gold;
    ctx.fillText('WAVE ' + state.waveClearWave + ' CLEARED', 0, 0);
    ctx.font = 'bold 13px "Lucida Console", "Courier New", monospace';
    ctx.fillStyle = '#000000';
    ctx.fillText('+ DRAFT INCOMING', 2, 56);
    ctx.fillStyle = COL.white;
    ctx.fillText('+ DRAFT INCOMING', 0, 54);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  // ─── Application shell (Windows 95 style UI) ──────────────────────────────
  const $ = (id) => document.getElementById(id);
  const nativeHost = (window.chrome && window.chrome.webview) ? window.chrome.webview : null;
  const CARD_TYPE_LABEL = { boon: 'BOON', gambit: 'GAMBIT', hex: 'HEX' };

  const ui = {
    app: $('app'),
    imeSink: $('imeSink'),
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
    menuSplits: $('menuSplits'),
    menuAchievements: $('menuAchievements'),
    menuDifficulty: $('menuDifficulty'),
    menuMaximize: $('menuMaximize'),
    menuEffects: $('menuEffects'),
    deckField: $('deckField'),
    mainScreen: $('mainScreen'),
    seedInput: $('seedInput'),
    mainMode: $('mainMode'),
    mainModeNote: $('mainModeNote'),
    mainBest: $('mainBest'),
    mainFastest: $('mainFastest'),
    mainDawns: $('mainDawns'),
    mainAchCount: $('mainAchCount'),
    toastStack: $('toastStack'),
    modalLayer: $('modalLayer'),
    modalBackdrop: $('modalBackdrop'),
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
      time: $('statusTime'),
      mode: $('statusMode'),
    },
    dialogs: {
      draft: $('dlgDraft'),
      gameover: $('dlgGameover'),
      dawn: $('dlgDawn'),
      pause: $('dlgPause'),
      records: $('dlgRecords'),
      splits: $('dlgSplits'),
      achievements: $('dlgAchievements'),
      controls: $('dlgControls'),
      about: $('dlgAbout'),
      quit: $('dlgQuit'),
      custom: $('dlgCustom'),
      customdone: $('dlgCustomDone'),
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
    custom: {
      name: $('customName'),
      text: $('customText'),
      layout: $('customLayout'),
      memorize: $('customMemorize'),
      loop: $('customLoop'),
      clean: $('customClean'),
      crisp: $('customCrisp'),
      saved: $('customSaved'),
      meta: $('customMeta'),
      hint: $('customHint'),
      remove: $('customDelete'),
    },
    customResult: {
      time: $('customResultTime'),
      stats: $('customResultStats'),
      name: $('customResultName'),
    },
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
    splits: { body: $('splitsBody') },
    achievements: { head: $('achHead'), list: $('achList') },
    strip: {
      root: $('stripHud'),
      run: $('stripRun'),
      runSub: $('stripRunSub'),
      wave: $('stripWave'),
      waveSub: $('stripWaveSub'),
      mode: $('stripMode'),
      best: $('stripBest'),
      bestSub: $('stripBestSub'),
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
      state.lives + '|' + (state.milestoneT > 0 ? 1 : 0) + '|' + settings.fx + '|' +
      (state.custom ? 1 : 0);
    if (key === uiFxKey) return;
    uiFxKey = key;
    app.style.setProperty('--fx-combo', String(combo));
    app.style.setProperty('--fx-danger', String(danger));
    app.style.setProperty('--fx-heat', String(state.heat));
    app.style.setProperty('--fx-lives', String(state.lives));
    app.style.setProperty('--fx-wave', String(state.wave));
    const body = document.body;
    for (const phase of ['menu', 'playing', 'paused', 'draft', 'dawn', 'gameover', 'customdone']) {
      body.classList.toggle('phase-' + phase, state.phase === phase);
    }
    // Practice strips the roguelite HUD down to one state panel (see style.css).
    body.classList.toggle('practice', !!state.custom);
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

  // Info dialogs pause the run and are dismissed with Enter/Esc or a backdrop
  // click; phase dialogs (draft, results) are handled by the game.
  function isInfoOverlay() {
    return uiModal === 'controls' || uiModal === 'about' || uiModal === 'quit' ||
      uiModal === 'records' || uiModal === 'splits' || uiModal === 'achievements' ||
      uiModal === 'custom';
  }

  function phaseDialog() {
    if (state.phase === 'paused') return 'pause';
    if (state.phase === 'draft') return 'draft';
    if (state.phase === 'gameover') return 'gameover';
    if (state.phase === 'dawn') return 'dawn';
    if (state.phase === 'customdone') return 'customdone';
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
    if (name === 'splits') populateSplits();
    if (name === 'achievements') populateAchievements();
    if (name === 'controls') ensureAudio();
    if (name === 'custom') populateCustomDialog();
    showDialog(name);
  }

  function closeOverlay() {
    const resume = resumePhase;
    resumePhase = null;
    if (resume === 'playing' && state.phase === 'paused') state.phase = 'playing';
    if (state.phase === 'playing' && state.custom) focusImeSink();
    syncToPhase();
    updateMenuStates();
  }

  // ── population ───────────────────────────────────────────────────────────
  // The main screen is the title/menu page shown in the 'menu' phase. It is a
  // DOM overlay (not a modal) so Records, Splits and Achievements can open on
  // top of it and closing them returns to it.
  function populateMain() {
    setText(ui.mainBest, fmtInt(records.bestScore));
    setText(ui.mainFastest, records.fastestDawnSec ? fmtTime(records.fastestDawnSec) : '\u2014');
    setText(ui.mainDawns, String(records.dawns));
    setText(ui.mainAchCount, `${achievementCount()} / ${ACHIEVEMENTS.length}`);
    setText(ui.aboutBest, String(state.best));
    updateDifficultyUi();
  }

  // ── custom stage dialog ───────────────────────────────────────────────────
  let customPrefill = null;

  function openCustomStageDialog(prefill) {
    customPrefill = prefill || null;
    if (prefill && prefill.id) customEditingId = String(prefill.id);
    openOverlay('custom');
    customPrefill = null;
  }

  function setCustomHint(message) {
    if (ui.custom && ui.custom.hint) setText(ui.custom.hint, message);
  }

  function customFormLayout() {
    if (!ui.custom || !ui.custom.layout) return 'lines';
    const active = ui.custom.layout.querySelector('.mode-btn[aria-pressed="true"]');
    return active ? customLayoutId(active.dataset.layout) : 'lines';
  }

  function setCustomLayout(layout) {
    if (!ui.custom || !ui.custom.layout) return;
    const value = customLayoutId(layout);
    ui.custom.layout.querySelectorAll('.mode-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(customLayoutId(btn.dataset.layout) === value));
    });
    if (ui.custom.memorize) {
      // Memorize is the "hide the cue after a preview" switch: meaningful for
      // Lines and Prompts, not for a deck (own reveal) or a word rain.
      ui.custom.memorize.disabled = value !== 'lines' && value !== 'prompts';
      if (value !== 'lines' && value !== 'prompts') ui.custom.memorize.checked = false;
    }
  }

  function updateCustomMeta() {
    if (!ui.custom || !ui.custom.meta) return;
    const clean = !!(ui.custom.clean && ui.custom.clean.checked);
    const raw = ui.custom.text ? ui.custom.text.value : '';
    const cleaned = clean ? customCleanText(raw) : null;
    const layout = customFormLayout();
    const text = customLayoutText(cleaned ? cleaned.text : raw, layout);
    const suffix = cleaned && cleaned.removed > 0 ? ` \u00b7 ${cleaned.removed} cleaned away` : '';
    if (!text.trim()) {
      setText(ui.custom.meta, layout === 'cards'
        ? 'Cards: one per line as prompt :: answer. Paste some text to begin.'
        : layout === 'prompts'
          ? 'Prompts: one per line as shown :: typed. Paste some text to begin.'
          : (clean ? 'Paste some text to begin. Cleanup is on.' : 'Paste some text to begin.'));
      return;
    }
    if (layout === 'cards') {
      const counts = customCardCounts(text);
      const skipped = counts.skipped
        ? ` \u00b7 ${counts.skipped} line${counts.skipped === 1 ? '' : 's'} skipped (no ::)`
        : '';
      setText(
        ui.custom.meta,
        `${counts.cards} ${counts.cards === 1 ? 'card' : 'cards'} \u00b7 ${counts.chars} characters${skipped}${suffix}`
      );
      return;
    }
    if (layout === 'prompts') {
      const counts = customPromptCounts(text);
      const skipped = counts.skipped
        ? ` \u00b7 ${counts.skipped} line${counts.skipped === 1 ? '' : 's'} skipped (no ::)`
        : '';
      setText(
        ui.custom.meta,
        `${counts.prompts} ${counts.prompts === 1 ? 'prompt' : 'prompts'} \u00b7 ${counts.chars} characters${skipped}${suffix}`
      );
      return;
    }
    const counts = customCounts(text);
    if (layout === 'words') {
      setText(ui.custom.meta, `${counts.tokens} falling words \u00b7 ${counts.chars} characters${suffix}`);
    } else {
      const segments = customSegments(text).length;
      setText(ui.custom.meta,
        `${segments} ${segments === 1 ? 'line' : 'lines'} to type \u00b7 ${counts.words} words \u00b7 ${counts.chars} characters${suffix}`);
    }
  }

  function loadCustomStageIntoForm(stage) {
    if (!ui.custom || !stage) return;
    customEditingId = stage.id;
    if (ui.custom.name) ui.custom.name.value = stage.name;
    if (ui.custom.text) ui.custom.text.value = stage.text;
    setCustomLayout(stage.layout);
    if (ui.custom.memorize) ui.custom.memorize.checked = !!stage.memorize &&
      (customLayoutId(stage.layout) === 'lines' || customLayoutId(stage.layout) === 'prompts');
    if (ui.custom.loop) ui.custom.loop.checked = !!stage.loop;
    if (ui.custom.clean) ui.custom.clean.checked = stage.clean !== false;
    setCustomHint(`Loaded \u201c${stage.name}\u201d \u2014 edits stay local until you Save.`);
    updateCustomMeta();
    buildCustomSavedList();
  }

  function buildCustomSavedList() {
    if (!ui.custom || !ui.custom.saved) return;
    const box = ui.custom.saved;
    box.textContent = '';
    if (!customStages.length) {
      const empty = document.createElement('div');
      empty.className = 'custom-saved-empty';
      empty.textContent = 'No saved stages yet. Save this one to keep it.';
      box.appendChild(empty);
      if (ui.custom.remove) ui.custom.remove.disabled = true;
      return;
    }
    for (const stage of customStages) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'custom-saved-item' + (stage.id === customEditingId ? ' selected' : '');
      const name = document.createElement('span');
      name.className = 'custom-saved-name';
      name.textContent = stage.name;
      const note = document.createElement('span');
      note.className = 'custom-saved-note';
      const counts = customCounts(stage.text);
      const cardCounts = stage.layout === 'cards' ? customCardCounts(stage.text) : null;
      const promptCounts = stage.layout === 'prompts' ? customPromptCounts(stage.text) : null;
      note.textContent = (stage.layout === 'words'
        ? counts.tokens + ' words'
        : stage.layout === 'cards'
          ? cardCounts.cards + ' cards'
          : stage.layout === 'prompts'
            ? promptCounts.prompts + ' prompts'
            : counts.lines + ' lines') +
        (stage.memorize ? ' \u00b7 memorize' : '') + (stage.loop ? ' \u00b7 loop' : '');
      item.appendChild(name);
      item.appendChild(note);
      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        ensureAudio();
        loadCustomStageIntoForm(stage);
      });
      box.appendChild(item);
    }
    if (ui.custom.remove) ui.custom.remove.disabled = !customEditingId;
  }

  function populateCustomDialog() {
    if (!ui.custom || !ui.custom.text) return;
    let source = customPrefill || customLast || customStages[0] || null;
    if (source && source.layout) {
      customEditingId = source.id ? String(source.id) : null;
      // A prefill can carry the id of a stage that has since been deleted; only
      // a live saved id counts, otherwise match by content.
      if (customEditingId && !customStages.some((s) => s.id === customEditingId)) customEditingId = null;
      if (!customEditingId) {
        const match = customStages.find((s) => s.text === source.text && s.name === source.name);
        if (match) customEditingId = match.id;
      }
    }
    if (ui.custom.name) ui.custom.name.value = source ? source.name : '';
    ui.custom.text.value = source ? source.text : '';
    setCustomLayout(source ? source.layout : 'lines');
    if (ui.custom.memorize) ui.custom.memorize.checked = !source || !source.memorize ? false :
      (customFormLayout() === 'lines' || customFormLayout() === 'prompts');
    if (ui.custom.loop) ui.custom.loop.checked = !!(source && source.loop);
    if (ui.custom.clean) ui.custom.clean.checked = !source || source.clean !== false;
    if (ui.custom.crisp) ui.custom.crisp.checked = !!settings.crisp;
    setCustomHint(customStages.length
      ? `Saved stages: ${customStages.length} of ${CUSTOM.maxStages}. Click one to load it, or New for a fresh stage.`
      : 'Practice stage: no cards, no lives, no Pressure.');
    updateCustomMeta();
    buildCustomSavedList();
  }

  function customReadConfig() {
    const raw = ui.custom.text ? ui.custom.text.value : '';
    const clean = !!(ui.custom.clean && ui.custom.clean.checked);
    const cleaned = clean ? customCleanText(raw) : null;
    const layout = customFormLayout();
    const text = customLayoutText(cleaned ? cleaned.text : raw, layout);
    const name = (String(ui.custom.name ? ui.custom.name.value : '').trim() ||
      customDefaultName(text, layout)).slice(0, 40);
    const counts = layout === 'cards' ? customCardCounts(text)
      : layout === 'prompts' ? customPromptCounts(text) : customCounts(text);
    return {
      name,
      text,                        // cleaned + normalised preview (validation, counts)
      raw: String(raw),            // untouched paste, for Save and "clean off" starts
      clean,
      layout,
      memorize: (layout === 'lines' || layout === 'prompts') &&
        !!(ui.custom.memorize && ui.custom.memorize.checked),
      loop: !!(ui.custom.loop && ui.custom.loop.checked),
      counts,
      removed: cleaned ? cleaned.removed : 0,
    };
  }

  function submitCustomStage() {
    if (!ui.custom) return;
    const config = customReadConfig();
    if (!config.text.trim()) {
      setCustomHint('Paste some text first.');
      if (ui.custom.text) ui.custom.text.focus();
      return;
    }
    if (config.layout === 'words' && !config.counts.tokens) {
      setCustomHint('That text has no usable words (2 to 16 letters).');
      return;
    }
    if (config.layout === 'cards' && !config.counts.cards) {
      setCustomHint('That text has no cards. Use one per line: prompt :: answer.');
      return;
    }
    if (config.layout === 'prompts' && !config.counts.prompts) {
      setCustomHint('That text has no prompts. Use one per line: shown :: typed.');
      return;
    }
    if (config.layout === 'lines' && !config.counts.lines) {
      setCustomHint('That text has no usable lines.');
      return;
    }
    // Start never rewrites the saved-stage list: only Save does. A saved stage
    // can be tried with edits and left untouched.
    const started = startCustomStage({
      id: customEditingId || null,
      name: config.name,
      text: config.raw,
      clean: config.clean,
      layout: config.layout,
      memorize: config.memorize,
      loop: config.loop,
    });
    if (!started) setCustomHint('That text produced no playable stage.');
  }

  function saveCustomStageAction() {
    if (!ui.custom) return;
    const config = customReadConfig();
    // Save the raw paste (normalised only), so "Clean on start" stays a choice
    // the player can turn off later instead of being baked into the stage. A
    // deck keeps its Unicode; only the typing layouts are ASCII-normalised.
    const storedText = customLayoutText(config.raw, config.layout);
    if (!storedText.trim()) { setCustomHint('Nothing to save yet.'); return; }
    let stage = customEditingId ? customStages.find((s) => s.id === customEditingId) : null;
    if (stage) {
      Object.assign(stage, {
        name: config.name, text: storedText, layout: config.layout,
        memorize: config.memorize, loop: config.loop, updated: Date.now(),
      });
    } else {
      stage = {
        id: 'stage-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: config.name, text: storedText, layout: config.layout,
        memorize: config.memorize, loop: config.loop, updated: Date.now(),
      };
      customStages.unshift(stage);
      if (customStages.length > CUSTOM.maxStages) customStages.length = CUSTOM.maxStages;
      customEditingId = stage.id;
    }
    saveCustomStages();
    if (ui.custom.name) ui.custom.name.value = stage.name;
    setCustomHint(`Saved \u201c${stage.name}\u201d \u00b7 ${customStages.length} of ${CUSTOM.maxStages} stages. Use New to make another.`);
    buildCustomSavedList();
  }

  function deleteCustomStageAction() {
    if (!customEditingId) { setCustomHint('Load a saved stage first.'); return; }
    const index = customStages.findIndex((s) => s.id === customEditingId);
    if (index < 0) { customEditingId = null; buildCustomSavedList(); return; }
    const name = customStages[index].name;
    customStages.splice(index, 1);
    saveCustomStages();
    customEditingId = null;
    setCustomHint(`Deleted \u201c${name}\u201d \u00b7 ${customStages.length} of ${CUSTOM.maxStages} stages left.`);
    buildCustomSavedList();
  }

  // Start a blank editor without touching the saved list: the way to make a
  // second, third, ... stage. Saving allocates a new id because customEditingId
  // is cleared here.
  function newCustomStageAction() {
    if (!ui.custom) return;
    customEditingId = null;
    if (ui.custom.name) ui.custom.name.value = '';
    if (ui.custom.text) ui.custom.text.value = '';
    setCustomLayout('lines');
    if (ui.custom.memorize) ui.custom.memorize.checked = false;
    if (ui.custom.loop) ui.custom.loop.checked = false;
    if (ui.custom.clean) ui.custom.clean.checked = true;
    setCustomHint(customStages.length
      ? `New stage. ${customStages.length} saved \u2014 paste text, then Save to add another.`
      : 'New stage. Paste text, name it if you like, then Save.');
    updateCustomMeta();
    buildCustomSavedList();
    if (ui.custom.text) ui.custom.text.focus();
  }

  // Explicit Clean button: runs the same cleaner and reports the receipt.
  function cleanCustomTextAction() {
    if (!ui.custom || !ui.custom.text) return;
    const raw = ui.custom.text.value;
    if (!raw.trim()) { setCustomHint('Nothing to clean yet.'); return; }
    const result = customCleanText(raw);
    ui.custom.text.value = result.text;
    updateCustomMeta();
    if (!result.removed) {
      setCustomHint('Nothing to clean: the text is already plain.');
      return;
    }
    const bits = [];
    if (result.stats.citations) bits.push(result.stats.citations + ' citation markers');
    if (result.stats.links) bits.push(result.stats.links + ' links');
    if (result.stats.urls) bits.push(result.stats.urls + ' URLs');
    if (result.stats.markup) bits.push(result.stats.markup + ' markup bits');
    if (result.stats.chrome) bits.push(result.stats.chrome + ' wiki chrome lines');
    if (result.stats.references) {
      bits.push(result.stats.references + (result.stats.references === 1 ? ' reference line' : ' reference lines'));
    }
    setCustomHint('Cleaned: removed ' + bits.join(', ') + '.');
  }

  function populateCustomResult() {
    if (!ui.customResult) return;
    const custom = state.custom;
    const elapsed = Math.max(0, state.runSec);
    const wpm = elapsed > 0 ? Math.round((state.keys / 5) / (elapsed / 60)) : 0;
    const totalKeys = state.keys + state.mistakes;
    const accuracy = totalKeys ? Math.round((state.keys / totalKeys) * 100) : 100;
    setText(ui.customResult.time, fmtTime(elapsed));
    const layout = custom ? custom.layout : 'lines';
    if (layout === 'cards') {
      // No keys, no misses, no WPM: a deck is scored on recall. First-try
      // recalls are the headline; repeats are the honest number.
      const done = custom.cardDone;
      const total = custom.total;
      const first = custom.cardFirst;
      const again = custom.cardAgain;
      const pass = custom.pass > 1 ? ` \u00b7 pass ${custom.pass}` : '';
      setText(
        ui.customResult.stats,
        `${done}/${total} cards recalled \u00b7 ${first} first try \u00b7 ` +
        `${again} ${again === 1 ? 'repeat' : 'repeats'} \u00b7 no typing${pass}`
      );
      setText(ui.customResult.name, custom.name);
      return;
    }
    const unit = layout === 'words' ? 'words' : layout === 'prompts' ? 'prompts' : 'lines';
    const done = custom ? custom.done : 0;
    const total = custom ? custom.total : 0;
    const pass = custom && custom.pass > 1 ? ` \u00b7 pass ${custom.pass}` : '';
    setText(
      ui.customResult.stats,
      `${done}/${total} ${unit} ${layout === 'words' ? 'cleared' : 'typed'} \u00b7 ${state.keys} keys \u00b7 ` +
      `${state.mistakes} misses \u00b7 ${wpm} WPM \u00b7 ${accuracy}% accuracy${pass}`
    );
    setText(ui.customResult.name, custom ? custom.name : 'Custom stage');
  }

  function againCustomStage() {
    const config = state.custom ? state.custom.config : null;
    if (config) startCustomStage(config);
  }

  function editCustomStage() {
    const config = state.custom ? state.custom.config : customLast;
    openCustomStageDialog(config || null);
  }

  function returnToMenu() {
    if (state.phase === 'menu') return;
    hideDialogs();
    resumePhase = null;
    // Reset run-scoped state so the status bar cannot keep showing an abandoned
    // run's score/time/wave under a "Ready" label. reset() also clears the
    // board, effects, wave-clear beat, offer and deck, and reseeds the RNG.
    reset(state.seed);
    state.phase = 'menu';
    state.words.length = 0;
    state.lockWord = null;
    state.dangerLevel = 0;
    closeMenus();
    ui.startMenu.classList.remove('open');
    blurImeSink();
    // Return to the roguelite's soft-focus scene resolution if a sharp drill
    // was running.
    resize();
    syncUi(true);
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
    const mode = (DIFFICULTIES[state.difficulty] || DIFFICULTIES.standard).name;
    const statLine =
      `${newBest ? 'NEW BEST! \u00b7 ' : ''}${wpmNow()} WPM \u00b7 ${accuracyNow()}% accuracy \u00b7 ${fmtTime(state.runSec)}` +
      ` \u00b7 Seed ${state.seed} \u00b7 ${mode} mode`;
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

  // ── splits ───────────────────────────────────────────────────────────────
  function populateSplits() {
    const body = ui.splits.body;
    if (!body) return;
    body.textContent = '';
    const runSplits = state.waveSplits || [];
    for (let i = 0; i < CFG.wavesPerRun; i++) {
      const wave = i + 1;
      const best = splitStore.split[i] || 0;
      const bestCum = splitStore.cum[i] || 0;
      const run = runSplits[i] || 0;
      const tr = document.createElement('tr');
      tr.className = best ? 'done' : 'todo';
      const cells = [
        String(wave),
        best ? fmtSplit(best) : '\u2013',
        bestCum ? fmtCumulative(bestCum) : '\u2013',
        run ? fmtSplit(run) : '\u2013',
      ];
      for (let c = 0; c < cells.length; c++) {
        const td = document.createElement('td');
        td.textContent = cells[c];
        if (c === 1 && best && run && Math.abs(run - best) < 0.001) td.className = 'pb';
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
  }

  // Cumulative PBs are whole-run times, so they read like the run clock.
  function fmtCumulative(sec) {
    return fmtTime(sec);
  }

  // ── achievements ─────────────────────────────────────────────────────────
  function populateAchievements() {
    if (!ui.achievements.list) return;
    setText(ui.achievements.head, `Unlocked ${achievementCount()} / ${ACHIEVEMENTS.length}`);
    const list = ui.achievements.list;
    list.textContent = '';
    for (const a of ACHIEVEMENTS) {
      const row = document.createElement('div');
      const unlocked = !!achieved[a.id];
      row.className = 'ach-row ' + (unlocked ? 'unlocked' : 'locked');
      const mark = document.createElement('div');
      mark.className = 'ach-mark';
      mark.textContent = unlocked ? '\u2713' : '\u00b7';
      const text = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'ach-name';
      name.textContent = a.name;
      const desc = document.createElement('div');
      desc.className = 'ach-desc';
      desc.textContent = a.desc;
      text.appendChild(name);
      text.appendChild(desc);
      if (unlocked) {
        const when = document.createElement('div');
        when.className = 'ach-when';
        when.textContent = 'Unlocked ' + new Date(achieved[a.id]).toLocaleDateString();
        text.appendChild(when);
      }
      row.appendChild(mark);
      row.appendChild(text);
      list.appendChild(row);
    }
  }

  function updateAchievementsMenu() {
    setText(ui.menuAchievements, `Achievements… (${achievementCount()}/${ACHIEVEMENTS.length})`);
  }

  // ── difficulty ───────────────────────────────────────────────────────────
  function updateDifficultyUi() {
    const selected = difficulty();
    setText(ui.menuDifficulty, 'Difficulty: ' + selected.name);
    setText(ui.mainModeNote, selected.desc);
    if (ui.mainMode) {
      ui.mainMode.querySelectorAll('.mode-btn').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.dataset.diff === selected.id));
      });
    }
    updateStatus();
  }

  function setDifficulty(id) {
    if (!DIFFICULTIES[id]) return;
    if (settings.difficulty === id) return;
    settings.difficulty = id;
    saveStore();
    updateDifficultyUi();
  }

  function cycleDifficulty() {
    const i = DIFFICULTY_ORDER.indexOf(settings.difficulty);
    const next = DIFFICULTY_ORDER[(i + 1) % DIFFICULTY_ORDER.length];
    setDifficulty(next);
  }

  function populatePause() {
    const note = ui.dialogs.pause && ui.dialogs.pause.querySelector('.pause-note');
    const fine = ui.dialogs.pause && ui.dialogs.pause.querySelector('.fine-print');
    if (state.custom) {
      const custom = state.custom;
      setText(note, 'The stage is frozen. Nothing changes until you resume.');
      setText(fine, 'Press Esc or Enter to resume. Restart begins the stage again from the top; Main Menu abandons it.');
      setText(
        ui.pause.seed,
        `${custom.name} \u00b7 ${fmtTime(state.runSec)} played \u00b7 ` +
        (custom.layout === 'lines'
          ? `line ${Math.max(1, Math.min(custom.lineIndex + 1, custom.total))}/${custom.total}`
          : `${custom.done}/${custom.total} words`) +
        (custom.memorize ? ' \u00b7 memorize' : '') + (custom.loop ? ' \u00b7 loop' : '')
      );
      return;
    }
    setText(note, 'Words are frozen. Nothing falls until you resume.');
    setText(fine, 'Press Esc or Enter to resume. Restart begins a new run at wave 1; Main Menu abandons the run.');
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

  // The signal strip below the danger line is the live readout: run clock,
  // this wave's split, and the personal bests. It is DOM (not canvas) so the
  // numbers stay crisp above the soft-focus playfield.
  function liveWaveSplit() {
    if (state.phase === 'menu') return null;
    if (state.phase === 'playing' && state.waveClearT <= 0) {
      return Math.max(0, state.runSec - state.waveStartSec);
    }
    const done = state.waveSplits[state.wave - 1];
    if (done != null) return done;
    if (state.phase === 'dawn' || state.phase === 'gameover') return null;
    return Math.max(0, state.runSec - state.waveStartSec);
  }

  // The signal strip is DOM, so in a practice stage its three cells become the
  // practice readout (time, progress, stage) and the labels change with them.
  let uiStripLabelCache = null;
  function stripLabelEls() {
    if (!uiStripLabelCache && ui.strip.root) {
      uiStripLabelCache = Array.from(ui.strip.root.querySelectorAll('.strip-label'));
    }
    return uiStripLabelCache || [];
  }

  function restoreStripLabels() {
    const labels = stripLabelEls();
    if (labels.length && labels[0].textContent !== 'RUN') labels[0].textContent = 'RUN';
    if (labels.length > 1 && labels[1].textContent !== 'THIS WAVE') labels[1].textContent = 'THIS WAVE';
  }

  let uiStripKey = '';
  function populateStrip() {
    if (!ui.strip.root) return;
    if (state.custom) {
      const custom = state.custom;
      const key = [
        'custom', Math.floor(state.runSec), custom.layout, custom.pass, custom.done,
        custom.lineIndex, custom.total, custom.hidden ? 1 : 0, state.phase,
        custom.cardDone, custom.cardLive ? custom.cardLive.index : -1,
        custom.cardLive && custom.cardLive.revealed ? 1 : 0,
      ].join('|');
      if (key === uiStripKey) return;
      uiStripKey = key;
      const labels = stripLabelEls();
      if (labels.length > 0) labels[0].textContent = 'TIME';
      if (labels.length > 1) {
        labels[1].textContent = custom.layout === 'lines'
          ? 'LINE' : custom.layout === 'words' ? 'WORDS'
            : custom.layout === 'prompts' ? 'PROMPT' : 'CARDS';
      }
      if (labels.length > 2) labels[2].textContent = 'STAGE';
      const done = (custom.layout === 'lines' || custom.layout === 'prompts')
        ? (state.phase === 'customdone' ? custom.total : Math.min(custom.lineIndex + 1, custom.total))
        : custom.layout === 'cards' ? custom.cardDone : custom.done;
      setText(ui.strip.run, fmtTime(state.runSec));
      // One fact per cell: loop pass on the left, the memorize/recall cue in the
      // middle, the layout on the right. No repeated labels.
      setText(ui.strip.runSub, custom.loop ? `Loop ${custom.pass}` : '');
      setText(ui.strip.wave, `${done} / ${custom.total}`);
      setText(ui.strip.waveSub, custom.layout === 'cards'
        ? (custom.cardLive && custom.cardLive.revealed ? 'Answer' : 'Recall')
        : (custom.memorize ? 'Memorize' : ''));
      setClass(ui.strip.root, 'flash', false);
      setText(ui.strip.mode, 'CUSTOM');
      setText(ui.strip.best, custom.name.toUpperCase().slice(0, 18));
      setText(ui.strip.bestSub, custom.layout === 'lines'
        ? 'Lines' : custom.layout === 'words' ? 'Falling words'
          : custom.layout === 'prompts' ? 'Prompts' : 'Cards');
      return;
    }
    restoreStripLabels();
    const wave = Math.min(state.wave, CFG.wavesPerRun);
    const live = liveWaveSplit();
    const flash = state.splitFlashT > 0 && state.lastSplit;
    const d = state.phase === 'menu'
      ? difficulty()
      : (DIFFICULTIES[state.difficulty] || DIFFICULTIES.standard);
    // The strip is cheap to compute but expensive to touch: only write the DOM
    // when one of the visible values actually changed (the split ticks at 10 Hz).
    const key = [
      Math.floor(state.runSec), wave, state.waveCleared,
      live == null ? -1 : Math.round(live * 10),
      flash ? 1 : 0, d.id, records.bestScore, records.fastestDawnSec,
    ].join('|');
    if (key === uiStripKey) return;
    uiStripKey = key;

    setText(ui.strip.run, fmtTime(state.runSec));
    setText(ui.strip.runSub, state.phase === 'menu'
      ? 'No run yet'
      : `Wave ${wave} \u00b7 ${state.waveCleared}/${CFG.waveSize} cleared`);
    setText(ui.strip.wave, live == null ? '--:--.-' : fmtSplit(live));

    let sub;
    if (flash) {
      const ls = state.lastSplit;
      if (ls.endless) sub = `WAVE ${ls.wave} \u00b7 ${fmtSplit(ls.split)} \u00b7 ENDLESS`;
      else if (ls.first) sub = `WAVE ${ls.wave} CLEARED \u00b7 FIRST SPLIT`;
      else if (ls.newSplit) sub = `WAVE ${ls.wave} CLEARED \u00b7 NEW PB`;
      else sub = `WAVE ${ls.wave} CLEARED \u00b7 ${fmtDelta(ls.delta)} VS PB`;
    } else {
      const pb = splitStore.split[wave - 1] || 0;
      const prev = state.waveSplits[wave - 2] || 0;
      sub = (prev ? `Last ${fmtSplit(prev)} \u00b7 ` : '') + (pb ? `PB ${fmtSplit(pb)}` : 'No PB yet');
    }
    setText(ui.strip.waveSub, sub);
    setClass(ui.strip.root, 'flash', !!flash);

    setText(ui.strip.mode, d.name.toUpperCase());
    setText(ui.strip.best, `BEST ${fmtInt(records.bestScore)}`);
    setText(ui.strip.bestSub, records.fastestDawnSec
      ? `Fastest Dawn ${fmtTime(records.fastestDawnSec)}`
      : 'No Dawn yet');
  }

  let uiStatusKey = '';
  function updateStatus() {
    populateStrip();                     // has its own, faster-changing cache key
    const target = state.phase === 'playing' ? targetWord() : null;
    // The status bar only changes on a rule event or once a second, so a single
    // key skips the other ~50 frames' worth of DOM writes entirely.
    const statusKey = [
      state.phase, state.endless ? 1 : 0, state.wave, state.waveCleared,
      state.lives, state.shields, state.shieldMax, state.heat, pressure(),
      Math.floor(state.runSec), state.score, state.combo, state.difficulty,
      target && target.fake ? 1 : 0, reversed() ? 1 : 0, tunnelVisible() > 0 ? 1 : 0,
      state.custom ? 1 : 0, state.custom ? state.custom.lineIndex : -1,
      state.custom ? state.custom.done : -1, state.custom ? (state.custom.hidden ? 1 : 0) : 0,
      state.custom ? state.custom.cardDone : -1,
      state.custom && state.custom.cardLive ? state.custom.cardLive.index : -1,
      state.custom && state.custom.cardLive && state.custom.cardLive.revealed ? 1 : 0,
    ].join('|');
    if (statusKey === uiStatusKey) return;
    uiStatusKey = statusKey;

    // Practice stages replace every roguelite readout with the practice ones.
    if (state.custom) {
      const custom = state.custom;
      setText(ui.status.main, state.phase === 'customdone' ? 'Stage complete' : 'Practice');
      setText(ui.status.time, `Time: ${fmtTime(state.runSec)}`);
      setText(ui.status.mode, 'Mode: Custom');
      setText(ui.status.score, `Cleared: ${custom.layout === 'cards' ? custom.cardDone : custom.done}/${custom.total}`);
      setText(ui.status.combo, `Combo: ${comboMultiplier().toFixed(2)}\u00d7`);
      setText(ui.status.wave, custom.layout === 'lines' || custom.layout === 'prompts'
        ? `${custom.layout === 'prompts' ? 'Prompt' : 'Line'}: ${Math.max(1, Math.min(custom.lineIndex + 1, custom.total))}/${custom.total}`
        : custom.layout === 'cards'
          ? `Cards: ${custom.cardDone}/${custom.total}`
          : `Words: ${custom.done}/${custom.total}`);
      setText(ui.status.lives, 'Lives: \u2014');
      setText(ui.status.shields, 'Shields: \u2014');
      setText(ui.status.heat, 'Heat: \u2014');
      setText(ui.status.pressure, 'Pressure: \u2014');
      return;
    }

    // State flags that explain why a word is not accepting keys: a fake target,
    // Reverse, Tunnel. They sit in the wide status panel next to the combo.
    let playingText = 'Playing';
    if (state.phase === 'playing') {
      if (reversed()) playingText += ' \u00b7 REVERSE';
      if (tunnelVisible() > 0) playingText += ' \u00b7 TUNNEL';
      if (target && target.fake) playingText += ' \u00b7 DECOY - WAIT';
      // The combo lives in its own status panel; repeating it here was a second
      // readout of the same number.
    }
    const phaseText = {
      menu: 'Ready',
      playing: playingText,
      paused: 'Paused',
      draft: 'Draft - choose a card',
      dawn: 'Dawn - run won',
      gameover: 'Signal lost',
    }[state.phase] || 'Ready';
    setText(ui.status.main, phaseText);
    setText(ui.status.time, `Time: ${fmtTime(state.runSec)}`);
    const mode = state.phase === 'menu'
      ? difficulty().name
      : (DIFFICULTIES[state.difficulty] || DIFFICULTIES.standard).name;
    setText(ui.status.mode, `Mode: ${mode}`);
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
    if (state.phase === 'menu') {
      label = 'Main Menu';
    } else if (state.phase === 'paused') {
      label = 'Paused';
    } else if (state.phase === 'playing') {
      if (state.custom) {
        label = state.custom.layout === 'lines'
          ? `Custom \u00b7 Line ${Math.max(1, Math.min(state.custom.lineIndex + 1, state.custom.total))}`
          : state.custom.layout === 'cards'
            ? `Custom \u00b7 Card ${Math.min(state.custom.cardDone + 1, state.custom.total)}`
            : state.custom.layout === 'prompts'
              ? `Custom \u00b7 Prompt ${Math.max(1, Math.min(state.custom.lineIndex + 1, state.custom.total))}`
              : 'Custom \u00b7 Words';
      } else {
        label = `Wave ${Math.min(state.wave, CFG.wavesPerRun)}` + (state.endless ? ' (endless)' : '');
      }
    } else if (state.phase === 'draft') label = 'Draft';
    else if (state.phase === 'dawn') label = 'Dawn';
    else if (state.phase === 'customdone') label = 'Stage Complete';
    else if (state.phase === 'gameover') label = 'Signal Lost';
    const title = `Wordfall - ${label}`;
    setText(ui.titleText, title);
    setText(ui.taskText, title);
  }

  function updateDeckField() {
    if (state.custom) {
      const custom = state.custom;
      setText(ui.deckField,
        'Practice \u00b7 ' + (custom.layout === 'lines'
          ? 'Lines' : custom.layout === 'words' ? 'Words'
            : custom.layout === 'prompts' ? 'Prompts' : 'Cards') +
        (custom.memorize ? ' \u00b7 Memorize' : '') + (custom.loop ? ' \u00b7 Loop' : ''));
      return;
    }
    setText(ui.deckField, heldCardsText());
  }

  function onPhaseChange() {
    if (state.phase === 'draft') populateDraft();
    if (state.phase === 'paused') populatePause();
    if (state.phase === 'gameover') populateResult('gameover');
    if (state.phase === 'dawn') populateResult('dawn');
    if (state.phase === 'customdone') populateCustomResult();
    if (state.phase === 'menu') populateMain();
    updateMenuStates();
    if (isInfoOverlay()) return;
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

  // ─── IME input ────────────────────────────────────────────────────────────
  // Chrome/WebView2 route composition (pinyin -> 汉字) only to a focused text
  // field. Custom stages park focus in a 1px invisible sink and consume the
  // committed string; plain Latin typing still arrives through keydown.
  // On a touchscreen the sink doubles as the keyboard opener for every run.
  const touchPrimary = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  function focusImeSink() {
    if (!ui.imeSink) return;
    try { ui.imeSink.focus({ preventScroll: true }); } catch (e) {
      try { ui.imeSink.focus(); } catch (e2) { /* ignore */ }
    }
  }

  function blurImeSink() {
    if (ui.imeSink && document.activeElement === ui.imeSink) {
      try { ui.imeSink.blur(); } catch (e) { /* ignore */ }
    }
  }

  function syncImeFocus() {
    if (state.phase === 'playing' && (state.custom || touchPrimary)) focusImeSink();
    else blurImeSink();
  }

  // Feed the committed characters through the normal typing rules, so lock-on,
  // combo, progress, the line advance and the score all behave exactly as if
  // they had been typed one key at a time.
  function typeChunk(str) {
    if (state.phase !== 'playing') return;
    for (const ch of Array.from(String(str || ''))) {
      if (state.phase !== 'playing') return;
      typeLetter(ch);
    }
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
    if (state.custom) focusImeSink();
    syncUi(true);
    return true;
  }

  // Optional seed on the main screen. Empty field = a fresh clock seed.
  function seedFromInput() {
    if (!ui.seedInput) return undefined;
    const digits = String(ui.seedInput.value || '').replace(/\D+/g, '');
    if (!digits) return undefined;
    return Number(digits) >>> 0;
  }

  function startNewRun(seed) {
    closeMenus();
    ui.startMenu.classList.remove('open');
    resumePhase = null;
    hideDialogs();
    ensureAudio();
    // The field is a one-shot: after any start it goes back to "random".
    if (ui.seedInput) ui.seedInput.value = '';
    reset(seed);
    blurImeSink();
    // Back to the roguelite's soft-focus scene resolution after a sharp drill.
    resize();
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
      case 'new':
        // While a practice stage is on the board, "new run" means restart it.
        if (state.custom) startCustomStage(state.custom.config);
        else startNewRun();
        break;
      case 'menu': returnToMenu(); break;
      case 'quit': onClose(); break;
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
      case 'splits': openOverlay('splits'); break;
      case 'achievements': openOverlay('achievements'); break;
      case 'custom': openCustomStageDialog(); break;
      case 'difficulty': cycleDifficulty(); break;
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
    click('tbNew', () => runCommand('new'));
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
    click('menuStart', () => startNewRun(seedFromInput()));
    if (ui.seedInput) {
      // Digits only; keep the value inside a sane seed length.
      ui.seedInput.addEventListener('input', () => {
        const digits = ui.seedInput.value.replace(/\D+/g, '').slice(0, 10);
        if (digits !== ui.seedInput.value) ui.seedInput.value = digits;
      });
    }

    // Custom stage dialog: layout pills, live counts, save/delete/start.
    if (ui.custom && ui.custom.layout) {
      ui.custom.layout.querySelectorAll('.mode-btn').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (btn.blur) btn.blur();
          ensureAudio();
          setCustomLayout(btn.dataset.layout);
          updateCustomMeta();
        });
      });
    }
    if (ui.custom && ui.custom.text) {
      ui.custom.text.addEventListener('input', updateCustomMeta);
    }
    if (ui.custom && ui.custom.clean) {
      ui.custom.clean.addEventListener('change', updateCustomMeta);
    }
    if (ui.custom && ui.custom.crisp) {
      ui.custom.crisp.addEventListener('change', () => {
        settings.crisp = !!ui.custom.crisp.checked;
        saveStore();
        // Re-size the scene now: a paused drill should switch immediately, and
        // the next stage start reads the same flag.
        resize();
        updateMenuStates();
      });
    }
    // IME: the committed string is the answer. The pinyin/candidate keystrokes
    // themselves are ignored by the keydown guard, so they never count as
    // misses, and a committed phrase is fed through the normal typing rules.
    if (ui.imeSink) {
      ui.imeSink.addEventListener('compositionend', (event) => {
        const data = event.data || ui.imeSink.value || '';
        ui.imeSink.value = '';
        if (data) typeChunk(data);
      });
      // Virtual keyboards report keyCode 229 for every key, so keydown never
      // sees their Latin letters; the input event is then the only source.
      let virtualKb = false;
      ui.imeSink.addEventListener('keydown', (event) => {
        virtualKb = event.keyCode === 229 && !event.isComposing;
      });
      ui.imeSink.addEventListener('input', (event) => {
        const value = ui.imeSink.value || '';
        if (!value) return;
        ui.imeSink.value = '';
        // With a physical keyboard only non-ASCII text can double-count here;
        // Latin was already handled by the keydown path.
        const viaVirtual = virtualKb && !event.isComposing;
        const committed = Array.from(value).filter((ch) => viaVirtual || ch.codePointAt(0) > 0x7e).join('');
        if (committed) typeChunk(committed);
      });
    }
    if (ui.custom && ui.custom.name) {
      ui.custom.name.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); submitCustomStage(); }
      });
    }
    click('customNew', newCustomStageAction);
    click('customCleanBtn', cleanCustomTextAction);
    click('customStart', submitCustomStage);
    click('customSave', saveCustomStageAction);
    click('customDelete', deleteCustomStageAction);
    click('customCancel', closeOverlay);
    click('customAgain', () => { ensureAudio(); againCustomStage(); });
    click('customEdit', editCustomStage);
    click('customResultMenu', returnToMenu);
    click('controlsOk', closeOverlay);
    click('aboutOk', closeOverlay);
    click('recordsOk', closeOverlay);
    click('splitsOk', closeOverlay);
    click('achOk', closeOverlay);
    // Records -> Splits keeps the same paused state; only the dialog swaps.
    click('recordsSplits', () => {
      populateSplits();
      showDialog('splits');
    });
    if (ui.mainMode) {
      ui.mainMode.querySelectorAll('.mode-btn').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (btn.blur) btn.blur();
          ensureAudio();
          setDifficulty(btn.dataset.diff);
        });
      });
    }
    // Main-screen destinations reuse the menu commands, so they behave exactly
    // like the File / Game / Help menu entries.
    document.querySelectorAll('.main-item[data-cmd]').forEach((item) => {
      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (item.blur) item.blur();
        ensureAudio();
        runCommand(item.dataset.cmd);
      });
    });
    click('overMenu', returnToMenu);
    click('pauseMenu', returnToMenu);
    click('quitNo', closeOverlay);
    click('quitYes', quitConfirmed);
    click('overRetry', () => startNewRun());
    click('overSeed', () => startNewRun(state.seed));
    click('overQuit', onClose);
    click('pauseResume', resumeGame);
    click('pauseRestart', () => {
      if (state.custom) startCustomStage(state.custom.config);
      else startNewRun();
    });
    click('pauseControls', () => openOverlay('controls'));
    click('dawnKeep', () => {
      ensureAudio();
      continueEndless();
    });
    click('dawnNew', startNewRun);
    click('dawnSeed', () => startNewRun(state.seed));
    ui.modalBackdrop.addEventListener('click', () => {
      if (isInfoOverlay()) closeOverlay();
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
    updateDifficultyUi();
    updateAchievementsMenu();
    updateMenuStates();
    syncUi(true);
  }

  // ─── Audio (M4) ───────────────────────────────────────────────────────────
  let ac = null;
  let master = null;
  let clickBuf = null;

  function ensureAudio() {
    if (state.simulating || state.muted) return;
    try {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ac = new AC();
        // Master chain: a little gain, then a compressor so the now-much-louder
        // key clicks stay punchy instead of clipping when a clear chord lands
        // on top of them.
        master = ac.createGain();
        master.gain.value = 1.25;
        const comp = ac.createDynamicsCompressor();
        comp.threshold.value = -15;
        comp.knee.value = 8;
        comp.ratio.value = 5;
        comp.attack.value = 0.002;
        comp.release.value = 0.14;
        master.connect(comp);
        comp.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      if (!clickBuf) {
        const len = Math.max(1, Math.floor(ac.sampleRate * 0.055));
        clickBuf = ac.createBuffer(1, len, ac.sampleRate);
        const data = clickBuf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          // Sharp mechanical attack, fast decay - a keycap, not a hiss.
          const k = i / len;
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, 3.6);
        }
      }
    } catch (e) { /* audio is optional */ }
  }

  function audioOut() {
    return master || (ac ? ac.destination : null);
  }

  // Mechanical key click: a short filtered noise burst. This is the sound the
  // player asked to be louder, so it gets its own path in front of the master.
  function playClick(vol, freq) {
    if (!ac || !clickBuf || state.muted || state.simulating) return;
    try {
      const src = ac.createBufferSource();
      src.buffer = clickBuf;
      const bp = ac.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq || (1300 + Math.random() * 900);
      bp.Q.value = 0.9;
      const g = ac.createGain();
      g.gain.value = vol == null ? 0.6 : vol;
      src.connect(bp);
      bp.connect(g);
      g.connect(audioOut());
      src.start(ac.currentTime);
    } catch (e) { /* ignore */ }
  }

  function tone(freq, dur = 0.08, type = 'sine', gain = 0.04, slideTo = 0, when = 0) {
    if (!ac || state.muted || state.simulating) return;
    try {
      const out = audioOut();
      if (!out) return;
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
      g.connect(out);
      osc.start(t0);
      osc.stop(t0 + dur + 0.03);
    } catch (e) { /* ignore */ }
  }

  function playKey(pos, len) {
    // Rising pitch as the word fills in - now a proper mechanical thock layered
    // under a bright click, roughly five times the old gain.
    const pitch = 120 + (pos || 1) * 13 + (len || 4) * 5;
    tone(pitch, 0.042, 'square', 0.065);
    tone(pitch * 0.5, 0.07, 'triangle', 0.05);
    if ((pos || 1) === 1) tone(pitch * 2, 0.03, 'sawtooth', 0.03);
    playClick(0.5);
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
  // Flare words: a rising incoming whistle, a bright double chime on a hit, and
  // a soft descending "slipped past" blip if it crosses the line.
  function playFlareSpawn() {
    tone(520, 0.22, 'sine', 0.025, 1040);
    tone(780, 0.18, 'triangle', 0.014, 1560, 0.04);
  }
  function playFlareHit() {
    tone(1046, 0.09, 'square', 0.03, 1568);
    tone(1568, 0.14, 'sine', 0.035, 2093, 0.05);
  }
  function playFlareMiss() {
    tone(440, 0.14, 'triangle', 0.022, 220);
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
  // Achievement: a short bright arpeggio that does not cover the clear chord.
  function playAchievement() {
    [784, 988, 1175, 1568].forEach((n, i) => tone(n, 0.14, 'triangle', 0.024, 0, i * 0.075));
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

    // An IME is composing (pinyin/candidates): those keystrokes belong to the
    // input method, not to the game. keyCode 229 is the legacy composition key.
    if (event.isComposing || event.keyCode === 229 || event.key === 'Process') return;

    // Form fields own their keys. The seed field still passes Enter/Esc/F2
    // through; the custom-stage textarea is a real editor (Enter inserts a
    // newline), and Esc always closes the dialog it belongs to. The IME sink is
    // the exception: it is focused during a drill, so the game owns its keys.
    const fieldTag = event.target && event.target.tagName;
    const isImeSink = !!(ui.imeSink && event.target === ui.imeSink);
    if ((fieldTag === 'INPUT' || fieldTag === 'TEXTAREA') && !isImeSink) {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (isInfoOverlay()) closeOverlay();
        return;
      }
      const isSeed = event.target === ui.seedInput;
      const passthrough = isSeed && (event.key === 'Enter' || event.key === 'F2');
      if (!passthrough) return;
    }

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

    // A user-opened dialog (Controls / About / Records / Custom / Quit) captures
    // Enter and Esc. In the Custom editor, Enter on a real button should press
    // that button instead of closing the dialog.
    if (isInfoOverlay()) {
      if (event.key === 'Enter' && uiModal === 'custom' &&
          event.target && event.target.closest && event.target.closest('#dlgCustom button')) {
        return;
      }
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        closeOverlay();
      }
      return;
    }

    if (event.key === 'F2') {
      event.preventDefault();
      if (state.custom) startCustomStage(state.custom.config);
      else startNewRun();
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

    // Cards: Space flips the card, 1/2/3 grade it, Enter is a quick Good.
    // Everything else falls through, so Esc still pauses and F2 still restarts.
    if (state.phase === 'playing' && state.custom && state.custom.layout === 'cards') {
      if (cardKey(event.key)) {
        event.preventDefault();
        return;
      }
    }

    if (event.key === 'Enter') {
      if (state.phase === 'menu') startNewRun(seedFromInput());
      else if (state.phase === 'gameover') reset();
      else if (state.phase === 'dawn') continueEndless();
      else if (state.phase === 'customdone') againCustomStage();
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
      // Space is a real character on a practice line; everywhere else it stays
      // swallowed so it can never be a hotkey in the roguelite.
      if (event.key === ' ' && state.phase === 'playing' &&
          state.custom && (state.custom.layout === 'lines' || state.custom.layout === 'prompts')) {
        typeLetter(' ');
      }
      event.preventDefault();
      return;
    }

    if (event.key.length === 1 && state.phase === 'playing') {
      typeLetter(event.key.toLowerCase());
      event.preventDefault();
    }
  });

  window.addEventListener('pointerdown', () => {
    ensureAudio();
    // A click can move focus off the IME sink; put it back while a drill runs.
    if (state.phase === 'playing' && state.custom) focusImeSink();
  });
  // A tap is the gesture that lets a phone raise its on-screen keyboard.
  window.addEventListener('click', () => {
    if (touchPrimary && state.phase === 'playing') focusImeSink();
  });
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
  // Synchronous CPU benchmark used by tools/qa-v15.mjs: runs update+render for a
  // fixed number of frames with a full board, so the number is independent of
  // the browser's vsync and the host's background load.
  function benchScene(frames) {
    frames = Math.max(1, Math.min(1200, Math.floor(Number(frames) || 180)));
    reset(4242);
    state.lives = 99;
    for (let i = 0; i < 8; i++) spawn();
    state.spawnT = 9999;
    state.flareT = 9999;
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      update(1 / 60);
      render();
    }
    const total = performance.now() - t0;
    return {
      frames,
      totalMs: Number(total.toFixed(1)),
      perFrameMs: Number((total / frames).toFixed(2)),
      words: state.words.length,
    };
  }

  window.__wordfall = {
    version: 'M9',
    state,
    CFG,
    CARDS: CARD_LIST,
    records,
    settings,
    ACHIEVEMENTS,
    achieved,
    splits: splitStore,
    difficulty,
    setDifficulty,
    cycleDifficulty,
    evaluateAchievements,
    fmtSplit,
    reset,
    newRun: reset,
    returnToMenu,
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
      streaks: state.streaks.length,
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
    scene: () => ({
      logicalW: W,
      logicalH: H,
      sceneW: scene.width,
      sceneH: scene.height,
      canvasW: canvas.width,
      canvasH: canvas.height,
      sharp: sharpPractice(),
      crisp: !!settings.crisp,
    }),
    hexTotal: HEX_TOTAL,
    typeLetter,
    targetWord,
    targetSet,
    spawnWord,
    spawnOne: spawn,
    spawnFlare,
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
    demandWpm,
    baseSpeedNow,
    rerollsLeft: () => state.rerollsLeft,
    nextChar,
    visibleCount,
    wordRange,
    bucketPressure,
    isFake: (w) => !!(w && w.fake),
    benchScene,
    sim,
    rng,
    custom: {
      stages: () => customStages.map((s) => Object.assign({}, s, { text: s.text.slice(0, 120) })),
      last: () => customLast,
      start: startCustomStage,
      open: openCustomStageDialog,
      state: () => state.custom,
      segments: customSegments,
      tokens: customTokens,
      cards: customCards,
      cardCounts: customCardCounts,
      cardSource: customCardSource,
      plain: customPlainText,
      prompts: customPromptPairs,
      promptCounts: customPromptCounts,
      reveal: revealCard,
      grade: gradeCard,
      cardKey,
      typeChunk,
      imeFocused: () => !!(ui.imeSink && document.activeElement === ui.imeSink),
      counts: customCounts,
      clean: customCleanText,
      config: customConfigOf,
      max: CUSTOM,
    },
  };

  // ─── Boot ─────────────────────────────────────────────────────────────────
  loadCustomStages();
  resize();
  initUi();
  if (window.ResizeObserver) {
    new ResizeObserver(() => resize()).observe($('client'));
  }
  requestAnimationFrame(frame);
})();
