# Wordfall technical notes

Internals, tuning and test material for developers. Player-facing documentation lives in
the [README](README.md); release history is in the [changelog](CHANGELOG.md).

- [Design notes](#design-notes)
- [Rules reference](#rules-reference)
- [Presentation notes](#presentation-notes)
- [Files](#files)
- [Native Windows app](#native-windows-app)
- [Tests](#tests)
- [Tuning](#tuning)
- [Measured balance](#measured-balance)

## Design notes

- **Background** - the game is framed as the night shift at Relay 12. The Welcome and
  About dialogs carry the setting, and a one-line relay log appears at every draft. The
  playfield is deliberately soft-focus: a near-black backdrop with huge, dim, slowly
  drifting colour discs, everything rendered at low resolution and upscaled so the whole
  picture - words included - carries a heavy blur. There are no buildings, windows or mast,
  and no warping or glitch layers.
- **Typing-speed balance (v1.6)** - spawn intervals are derived from an explicit demand
  curve (`demandStart` 16 WPM → `demandEnd` 92 WPM, exponent 1.82) instead of a linear
  timer. The curve is calibrated to real typist percentiles - wave 1 is about the 10th
  percentile, wave 6 about the median typist, wave 12 roughly the top 1-2% - and replaces
  the old 17→65 WPM climb followed by a flat 78 WPM wall, which produced a hard skill cliff
  between 60 and 70 WPM. Fall speed now ramps to `maxSpeed` 120 across all twelve waves
  instead of capping around wave 6-7, and word lengths still move one bound at a time.
  Pressure, cards, Heat and scoring are unchanged; the old `spawnStart`/`spawnDecay` keys
  are gone.
- **Impact and presentation (M7 + v1.4)** - the per-letter detonations, word trails,
  shockwaves, soft-focus backdrop, louder typing and the low-resolution renderer that keeps
  a full board at 60fps; the game remains a single canvas plus DOM shell with no build
  step, and the effect layer is capped and adaptive.
- **Score-attack shell (v1.5)** - a live run clock (playing time only), per-wave splits with
  per-wave PBs in `localStorage`, fifteen achievements with Win95 toasts, and three
  difficulty modes that scale fall speed, spawn interval and starting lives. The empty band
  below the danger line is now the signal strip: a DOM readout (crisp above the soft-focus
  canvas) for the clock, this-wave split, wave PB and mode. It is the **only** visible run
  clock and mode readout: `#statusTime` / `#statusMode` are hidden in `style.css` but stay
  in the DOM (and keep their text) for tests and internals, and the status main line no
  longer repeats the combo - the Combo panel owns that number. A practice stage adds
  `body.practice`, collapsing the status bar to one panel and trimming the strip labels
  (see [Presentation notes](#presentation-notes)). No rule reads any of it and the headless
  sim skips the whole layer, so the balance numbers are unchanged.

- **Main screen (v1.5)** - the `menu` phase is a full title screen (`#mainScreen`) inside the
  playfield: wordmark, Start Run, difficulty, seven destinations (Custom Stage was added
  after the six the v1.5 screen shipped with), machine bests and a
  presentation-only attract-mode word rain. It is a DOM overlay shown by `body.phase-menu`,
  not a modal, so the existing dialogs open on top of it; `returnToMenu()` is the shared
  path back from File, pause and game over.
- **Custom stages (v1.7)** - a practice mode built from pasted text: no cards, no
  lives, no Pressure and no waves. The `CUSTOM` block near the top of `game.js` owns every
  constant (12,000-character text cap, 400 line segments, 600 tokens, 2-16 letter tokens,
  200 cards, 20 saved stages, 3.5 s memorize preview, 42 px/s, 1.45 s spawn, six on the
  board).
  `startCustomStage()` calls `reset()` (which clears `state.custom`) and then attaches the
  live stage object to `state.custom`; the practice phase is `playing` and completion sets
  `customdone`. `update()` routes to `updateCustom()` and returns before Pressure, the
  spawn curve and the wave logic, `hitGround()` recycles a missed falling word instead of
  taking a life, and `recordRun()` / `evaluateAchievements()` return early while
  `state.custom` is set. **New** (`#customNew`) clears the editor and the editing id so
  Save appends a new stage instead of updating, and blank names fall back to the first
  five words of the text (the cleaned text when cleanup is on; a start always derives the
  fallback from the cleaner's output). **Clean text** (`#customCleanBtn`) and **Clean on
  start** (`#customClean`, default on) share `customCleanText()`, whose `WIKI_CHROME` set
  gates the Wikipedia nav/footer lines; `startCustomStage()` is the single cleanup entry
  point, the `clean` flag rides on the config and `wordfall.custom.last`, and saved stages
  keep the normalised textarea text (an explicit Clean text edit is literal). Storage keys
  and the debug hook are documented below.
- **Frame budget (v1.5)** - the target set is computed once per rendered frame (the cache is
  active only while `render()` runs, so input events always see fresh state), the word draw
  order reuses one scratch array, and the status bar early-outs unless a displayed value
  changed. `benchScene()` measures update+render CPU independently of browser vsync.

## Rules reference

- **Wave** = 10 clears. When a wave ends the board holds for a short "WAVE n CLEARED"
  beat, then a draft opens: slot 1 is a Boon, slot 2 anything, slot 3 a Hex or Gambit.
  Each slot rolls rare independently - 24% base, +1.2% per wave for slots 1-2 and a 30%
  base for slot 3, capped at 45%; a rare roll can fall back to any eligible rare card, and
  slot 2 prefers a type different from slot 1 70% of the time so Boons stay in the pool
  while late drafts avoid becoming two Hex picks. Duplicate picks upgrade a card to tier II;
  cards without a tier II leave the pool.
- **Pressure** = `cleared + 4 × drafts taken` (skips count). Word length, spawn rate and
  fall speed all read Pressure, so skipping does not dodge escalation.
- **Dawn** at the end of wave 12 wins the run; play continues in endless mode, score-only.
- **Run clock** advances only while the board is live (not paused, drafting, on the Dawn or
  result screen, or during the wave-clear beat), and the signal strip is its only visible
  readout. **Wave split** = clock at the tenth clear
  minus the clock when that wave began. The fastest split and cumulative time for each of
  waves 1-12 are kept per machine; endless waves are timed but not stored.
- **Achievements** - fifteen global unlocks (first clear, combo 10/25, waves 5/12, Dawn,
  10k/50k score, 100 words, a flawless wave, a 10-letter word, a flare catch, a sub-5-minute
  Dawn, a Nightmare Dawn, endless wave 15). They are checked after scoring events and never
  during headless sims.
- **Difficulty** - Casual (2 lives, fall x0.85, spawn x1.15), Standard (1 life, x1.0/x1.0)
  and Nightmare (1 life, fall x1.15, spawn x0.90). There is no score multiplier, so the
  shared record book stays comparable across modes.
- **Long-word relief** - nine- and ten-letter words fall at 92% speed (`lengthRelief` in
  `update()`), so the two longest bands get ~8% more typing time. The length ramp, spawn
  rate and scoring are unchanged; the 7-letter Longshot rule is unaffected.
- **Relay log** - the draft shows one line of the night's log (`RELAY 12 - …`). It is
  flavor only; the backdrop is a melting signal field, not a city.
- **Lives** start at 1; a word touching the line costs one. **Shields** eat one wrong key
  each (combo kept, no flash) and refill when a wave starts.
- **Heat** = hexes held (tier II counts twice); it multiplies score and keeps rising.
- **Score** = `letters × (10 + Ledger) × combo × heat × Greed × Longshot × Drought × Bargain`, rounded.
- **Wide Scope** widens the target set; the first correct letter **locks on** to one word
  and holds until it is cleared. **Decoy** fakes are misspelled and cannot be typed -
  they drop through fast and are harmless, but while a fake is the lowest word every key
  is a mistake. **Split** drops an extra real 3-5 letter word every 5th spawn (every 3rd
  at tier II); it scores and blocks the words above it, but costs no life at the line.
- **Flares** - every 13-25 seconds a short 3-5 letter word races down at 2.5x speed,
  tagged with cyan brackets and chevrons. It scores like any other word, but if it reaches
  the line it slips through harmlessly: no Life is lost and the combo is kept. It is a
  bonus, never a penalty - take it for points or let it go.
- **New M7 cards** - **Lifeline** destroys the first word that reaches the line instead of
  costing a Life; **Rally** makes word length read 10 (18 at tier II) less Pressure;
  **Drought** slows spawns by 15% (20% at tier II) and takes a 10-15% score cut;
  **Bargain** doubles score but Skip pays no points; **Second Draft** grants one extra
  reroll for the run. **Greed** is now a gentler risk (speed ×1.03/×1.06, score ×1.4/×1.7),
  **Longshot** only speeds up 7+ letter words by 5%, and **Ledger** no longer adds Pressure.
- **Skip** pays `150 × wave` points and one temporary Shield for the wave that follows; it
  still counts as a draft and raises Pressure by 4.
- **Feel** - each committed letter now detonates at its own glyph with sparks,
  speed-lines, a shockwave ring, a chromatic red/cyan split, a zoom-punch and a
  full-frame colour flash, and rapid typing escalates the intensity key by key. Falling
  words drag neon comet trails; a completed word shatters into every one of its glyphs
  with three shockwave rings, screen bands, radial speed-lines, a proximity-scaled
  freeze-frame and shake, a rising chord and score callouts. Every tenth combo triggers
  an OVERDRIVE milestone burst; clearing a word near the line adds a CLOSE CALL callout.
  Effects are capped and adaptive; **View → Effects** switches them to Light (remembered
  across launches).
- **Pause** (`Esc`, Game → Pause) freezes the words and the run clock; `Esc` or `Enter`, or
  Game → Resume, continues. The pause dialog shows `Seed N · MM:SS played`. Minimizing
  auto-pauses, and restoring resumes only that minimize-induced pause - not a pause you
  asked for.
- **Run stats** - the game-over and Dawn dialogs show wave, words cleared, best combo,
  WPM (`correct letters / 5` per minute of playing time), accuracy (correct vs wrong keys,
  shields included), run time and the seed. **Retry Seed** replays the same seed.
- **Seed entry (v1.6)** - the main screen has an optional digits-only seed field
  (`#seedInput`, placeholder "random"). Start Run / Enter runs that seed and clears the
  field; Dawn gained a **Retry Seed** button (`#dawnSeed`) to match game over, so the seed
  shown on the result and pause screens can always be replayed or typed in later. The
  Controls dialog's Seed row documents it.
- **Records** - lifetime best score / wave / combo, runs, Dawns, words cleared and fastest
  Dawn, kept in `localStorage` (`wordfall.records`) on this machine. Open with
  Game → Records…; sound on/off is stored in `wordfall.settings`.
- **Custom stages** - pasted text becomes either **Lines** (segments of at most one
  display row, wrap by measured pixel width with a per-character fallback for scripts
  without spaces, one segment at a time typed in full - spaces, punctuation, script and
  displayed case included; key comparison is case-insensitive), **Falling words**
  (pure-ASCII keeps lowercase `[a-z]+` tokens of 2-16 letters; any other script goes
  through `Intl.Segmenter` words of 1-16 characters, reading order, fixed 42 px/s and
  1.45 s spawn, at most six on board), **Cards** (`prompt :: answer` per line, 120/240
  character caps, 200 cards max) or **Prompts** (`shown :: typed` per line, 80/80 caps,
  400 prompts max: the cue is drawn above the line and the typed side is played below it,
  optionally hidden by Memorize). All four use Unicode-preserving sources
  (`customPlainText()` / `customCardSource()`), not the old ASCII normaliser. Glyph metrics
  are measured per character (`offsets[]` / `glyphW[]` on the word) with a fast
  `i * charW` path for pure ASCII, so CJK lines do not overlap. A 1x1 `#imeSink` input is
  focused during a custom stage to receive IME composition; composing `keydown`s are
  ignored and `compositionend` feeds `typeChunk()` into `typeLetter()`. Memorize previews
  a line for 3.5 s or until the first key, then renders the untyped remainder as dots with
  a `TYPE FROM MEMORY` cue; Loop restarts the same config and increments `pass`. A missed
  falling word is requeued, never fatal. A Cards deck is the typing-free path: a card falls
  to the line, Space reveals, 1/2/3 grade, Again is re-queued four cards later, and
  Good/Easy retire it; its result screen reports first-try recalls and repeats instead of
  keys/WPM. **Sharp text** (`settings.crisp`, persisted in `wordfall.settings.crisp`, off
  by default) renders the scene canvas at 1:1 instead of `SCENE_SCALE` 0.55 while a
  practice stage is active: `startCustomStage()` re-sizes the scene, and `startNewRun()` /
  `returnToMenu()` restore the soft focus. Completion on the typing layouts reports time,
  keys, misses, WPM (`keys / 5` per minute) and accuracy (`keys / (keys + misses)`).
  Records, splits and achievements are not touched. Saved stages live in
  `wordfall.custom.stages` (max 20) and the last started config in
  `wordfall.custom.last`. **New** empties the form and clears
  the editing id so Save adds another stage (cap 20); **Delete** removes only the loaded
  one. **Clean text** / **Clean on start** strip citation markers (`[1]`, `[b]`,
  `[note 3]`, `[citation needed]`...), bare URLs, Markdown/HTML links (labels kept), HTML
  tags/entities and Markdown markup, plus - gated on the paste looking like a Wikipedia
  copy (a citation marker was removed or "Wikipedia" appears) - `WIKI_CHROME` lines,
  footer lines and the `^` reference tail. Saved stages store the layout's Unicode textarea
  text, so the cleaner runs again on every start unless an explicit Clean text was saved.

## Presentation notes

- The playfield is a canvas in a fixed **800-unit-tall logical space**, uniformly scaled to
  whatever the window gives. Fall times and difficulty stay identical at any window size.
- Everything around the playfield is ordinary DOM/CSS: the title bar, menus, toolbar,
  status bar, taskbar, Start menu and dialogs are real elements, not canvas drawings.
- The Win95 chrome stays 16-colour, bevel-correct and crisp. The playfield is drawn into a
  small offscreen canvas at **55% of the display resolution** and upscaled with smoothing,
  which is both the heavy soft-focus blur (it covers the words too) and the main
  optimisation. Behind the words: a near-black field with six huge, very dim colour discs
  that drift slowly. Lucida Console words, square particles, glyph shards and rectangular
  pop-up text are all rendered into the same low-res scene, so they share the blur.
- The CSS FX overlay (`#fxOverlay`: glow, vignette, scanlines, noise) is a separate layer
  above the canvas and below the dialogs, pointer-events none, animated with
  transform/opacity only. `game.js` drives it with a handful of CSS custom properties on
  `#app` (`--fx-combo`, `--fx-danger`, `--fx-heat`, `--fx-lives`, `--fx-wave`) and
  phase/state classes on `<body>`; `style.css` owns the look. No gradients or blur are used
  for the Win95 chrome; the playfield effect layers are the only place gradients appear.
- The **signal strip** (`#stripHud`) is DOM, not canvas, overlaid on the bottom 12% of the
  playfield - exactly the `CFG.groundPad / H` band below the danger line. It stays crisp
  above the soft-focus scene, is pointer-events none, and updates at most ten times a second
  (a cached key skips per-frame DOM writes). The wave-split flash and the wave-clear title
  card are deliberately in different places so the two celebrations cannot stack. It is the
  **only visible run clock and mode readout**: `#statusTime` and `#statusMode` are
  `display: none` globally but remain in the DOM and are still written by `updateStatus()`
  for tests, and the status main line carries only state flags (`REVERSE`, `TUNNEL`,
  `DECOY - WAIT`) rather than the combo. In a practice stage `body.practice` collapses the
  status bar to the wide `Practice` / `Stage complete` panel, hides the combo, score, wave,
  lives, shields, heat and pressure panels plus the toolbar deck field and its separator,
  and relabels the three strip cells `TIME` / `LINE` (or `WORDS`) / `STAGE` with one
  sub-fact each: `Loop n` on the left while looping, `Memorize` in the centre while it is
  on, and `Lines` / `Falling words` on the right.


## Files

| File | Purpose |
| --- | --- |
| `index.html` | the Win95 desktop + application markup (title bar, menus, toolbar, dialogs, status bar, taskbar) |
| `style.css` | the Windows 95 theme: 16-colour palette, 2px bevels, Tahoma/Microsoft Sans Serif, no gradients or blur |
| `words.js` | 1,974-word pool (`window.WORDFALL_WORDS`), lengths 3-11 |
| `game.js` | the game - config, state, rules, cards, the pixel playfield renderer, audio, DOM UI wiring, headless sim, debug hook |
| `win/` | native Windows shell: .NET 10 WinForms + WebView2, embeds the web files, borderless Win95 chrome |
| `win/Updater.cs` | in-app updater: GitHub release check, SHA-256-verified download, staged file swap + relaunch |
| `win/UpdateProgressForm.cs` | small Win95-style download progress dialog shown by the updater |
| `win/build.ps1` | one-command build/publish (`-Smoke` also runs the published exe's self-test) |
| `install.ps1` | copies the build into `%LOCALAPPDATA%\Programs\Wordfall` and (re)creates the desktop shortcut |
| `dist/Wordfall-win64/` | published native app (`Wordfall.exe`), regenerated by `win/build.ps1`; gitignored, not in the repo |
| `SPEC.md` | design doc, cards, milestones, tuning targets |
| `tools/smoke.mjs` | Playwright smoke test - drives the real UI and asserts M1-M7 rules + v1.6 seed/curve + effects/perf |
| `tools/qa-v15.mjs` | Playwright v1.5 acceptance - clock, splits, achievements, difficulty, decoy presentation, long words |
| `tools/qa-custom.mjs` | Playwright custom-stage acceptance - editor, Lines/Falling words, memorize, loop, save/load/delete, New/multi-stage, text cleanup, isolation |
| `tools/qa-cards.mjs` | Playwright Cards acceptance - parser/caps, editor, Space/1/2/3/Enter input, Again rescheduling, timeout, loop, CJK save/reload, Sharp text resolution/persistence, F2, isolation |
| `tools/qa-unicode.mjs` | Playwright multilingual acceptance - Unicode source, measured-width wrap, `Intl.Segmenter` tokens, IME commits, composing-key suppression, Prompts cue/hide, persistence, New Run restart |
| `tools/bot.mjs` | headless WPM bot - asserts the v1.6 balance cells |
| `tools/balance-lab.mjs` | card-power + draft-economy lab (baseline/cards/offers/policies/CFG phases); CFG-proxy rows ported to the v1.6 demand keys but not re-run |
| `tools/preview-juice.mjs` | visual preview harness - stages a board and writes `shots/juice-*.png` |
| `tools/qa-juice.mjs` | independent v1.4 QA harness - two viewports, pixel-diff, audio-graph probe, real-click modal checks |
| `shots/` | screenshots written by the smoke test and the preview/QA harnesses |
| `QA-REPORT.md` | independent acceptance review of v1.0 |
| `QA-REPORT-M6.md` | independent acceptance review of v1.1 / M6 |
| `QA-REPORT-M7.md` | independent acceptance review of v1.2 / M7 |
| `QA-JUICE.md` | independent acceptance review of the v1.4 juice pass (+ Lead addendum for the post-QA glitch fix) |
| `BALANCE-LAB.md` | measured card power, draft-offer distribution and tuning recommendations |

## Native Windows app

Requirements: the .NET 10 SDK and the WebView2 runtime (both already on this machine).

```
powershell -NoProfile -ExecutionPolicy Bypass -File win\build.ps1 -Smoke
```

This publishes a framework-dependent single-file x64 exe to `dist\Wordfall-win64\` (it
needs the installed .NET desktop runtime and WebView2), then runs `Wordfall.exe --smoke`.
`dist/` is gitignored: the GitHub release carries the built folder, and a fresh clone
rebuilds it with this command. The shell serves the web files from memory at
`https://wordfall.local/`, so `localStorage` (best score, records and settings) works, and
the page sees `window.chrome.webview` and hides the mock desktop.

The borderless window uses the page's title bar for dragging and its buttons post
`drag` / `min` / `max` / `close` to the host. The host also reports maximise state back so
the View → Maximize menu label stays in sync. Startup is hardened: a second launch
activates the existing window instead of touching WebView2, and a locked/broken browser
profile is retried and then replaced with a fresh one (`%LOCALAPPDATA%\Wordfall\WebView2-…`)
instead of showing an error.

### In-app updater

The native build **checks GitHub releases** shortly after launch and from
Help → Check for Updates…. The flow is:

1. `GET https://api.github.com/repos/Boci0/wordfall/releases/latest` and compare the tag
   with the running assembly version.
2. If newer, offer to download the `Wordfall-win64…zip` asset. The download is checked
   against the SHA-256 `digest` published by GitHub.
3. The zip is extracted into `%LOCALAPPDATA%\Wordfall\updates\<tag>\staged`; a detached
   PowerShell helper waits for Wordfall to exit, copies the staged files over the install
   folder (with retries for files the WebView2 host may briefly hold), cleans up and
   relaunches `Wordfall.exe`. The update log is `%LOCALAPPDATA%\Wordfall\updates\last-update.log`.
4. If the install folder is not writable, Wordfall offers the release page instead.

No update is installed without the user answering **Yes** to the prompt. Settings, records
and best scores stay in `%LOCALAPPDATA%\Wordfall` (outside the install folder), so they
survive updates. The updater is diagnostic-testable without touching the running install:

```
# Print the release-check result as JSON (exit 0 = check succeeded, 1 = error)
Wordfall.exe --check-update
Wordfall.exe --check-update --current-version=1.0.0 --update-out=check.json

# Full updater path: check, download latest, verify digest, extract, validate (then clean)
Wordfall.exe --update-selftest=%TEMP%\wf-update --current-version=1.0.0
Wordfall.exe --update-selftest=%TEMP%\wf-update --current-version=1.0.0 --keep-staged

# Write the detached install helper for inspection (used by the swap test)
Wordfall.exe --write-updater-script=%TEMP%\wf-install.ps1
```

The install helper accepts `-NoStart` so a swap can be tested against a scratch folder
without relaunching the game.

### Install a desktop shortcut

```
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
```

This copies the published build to `%LOCALAPPDATA%\Programs\Wordfall` and points
`Desktop\Wordfall.lnk` at the installed exe. The WebView2 profile, best score and lifetime
records live in `%LOCALAPPDATA%\Wordfall`, so reinstalling keeps them.

## Tests

```
node tools/smoke.mjs
node tools/qa-v15.mjs
node tools/qa-custom.mjs
node tools/qa-cards.mjs
node tools/qa-unicode.mjs
node tools/bot.mjs --seeds 100
node tools/bot.mjs --seeds 400
```

All scripts launch headless Chrome through `playwright-core` (resolvable from the parent
workspace). `smoke.mjs` plays words, checks that non-target words are inert, clears ten
words to reach a draft, asserts every card's effect through the debug hook, checks draft
eligibility over hundreds of seeded offers, forces a word onto the danger line, covers the
M6 features (pause freezes board and clock, Records load/save, seed determinism and Retry
Seed, WPM/accuracy stats, Split), covers the M7 build (the effect pools fire on a clear,
combo milestones and the wave-clear beat, the Effects toggle persists, the CSS hook
classes/vars are applied, and a full-board frame-time check holds 60fps), and covers the
v1.6 build: the main-screen seed field and the Dawn Retry Seed exist, a typed seed starts
exactly that run and clears the field, the demand curve rises strictly every wave
(wave 1 ~16, wave 6 33-45, wave 12 ≥90 WPM), and no wave's spawn interval falls through
`spawnMin`. The suite is **202 checks**; 200-202 pass depending on machine load - the only
failures are the known machine-sensitive M7 perf checks documented in
[QA-REPORT-V15.md](QA-REPORT-V15.md), not a v1.6 regression. It writes screenshots to
`shots/`. `qa-v15.mjs` is the focused v1.5 acceptance pass (56 checks):
the main screen (title, Start, difficulty, destinations, attract rain, Main Menu paths and
status-bar reset), clock behaviour under pause/draft, wave splits and PB persistence, the
signal strip readout, the fifteen achievements (unlock, toast, persistence, dialog), all
three difficulty modes, decoy-target presentation, every 10-letter word clearing under
Reverse and Tunnel, the 9+ letter fall-speed relief, and the synchronous frame-CPU budget
(`benchScene`); it still passes 56/56 on v1.6. `qa-custom.mjs` is the custom-stage
acceptance pass: the entry points and dialog validation, both layouts via the debug hook,
the Memorize preview and hide, Loop pass counting, pause / F2 restart, the result stats,
save-load-reload-delete through the two `localStorage` keys, the New / multi-stage flow
(the cap, derived names, add-don't-overwrite, delete-only-loaded), the cleaner rules
(citation markers, URLs, Markdown/HTML, wiki gating and receipt totals), clean-on-start
and the Clean text UI, and the record-book / achievement isolation. `bot.mjs` runs the
in-page simulator at 40/60/80 WPM with random or skipped drafts and asserts the v1.6
acceptance cells at 100 and
400 seeds: 40 skip always dies with median death wave 7-9, 60 skip always dies with median
10-12, 60 random Dawn 30-50%, 80 random Dawn >70%. `tools/balance-lab.mjs` reproduces the
card-power and draft-offer measurements in [BALANCE-LAB.md](BALANCE-LAB.md); its CFG-proxy
rows were ported to the demand keys but were not re-run on the v1.6 curve, so the published
BALANCE-LAB numbers remain the M7/v1.5 historical baseline.

### Debug hook

`window.__wordfall` exposes `version` (`'M9'`), `state`, `CFG`, `CARDS` (18), `records`
(live lifetime object), `settings` (`{muted, fx, difficulty}`), `ACHIEVEMENTS`, `achieved`,
`splits` (the PB store), `hexTotal` (6), `reset(seed?)`, `newRun()`, `returnToMenu()`,
`pause()`, `resume()`, `stats()` (`{keys, mistakes, runSec, wpm, accuracy}`),
`fxState()` (`{quality, particles, shards, rings, popups, streaks, milestone, danger, cssCombos}`),
`toggleEffects()`, `perf()` (`{avgMs, fps, pressure, quality}`), `benchScene(frames)`
(`{frames, totalMs, perFrameMs, words}`), `typeLetter()`,
`targetWord()`, `targetSet()`, `spawnWord()`, `spawnOne()`, `beginDraft()`, `pick()`,
`reroll()`, `skip()`, `grant(id, tier)`, `setSeed(n)`, `pressure()`, `heat()`,
`heatMult()`, `comboMultiplier()`, `speedMult()`, `scoreMult()`, `spawnInterval()`,
`demandWpm()`, `baseSpeedNow()`, `nextChar()`, `visibleCount()`, `wordRange()`,
`bucketPressure()`,
`isFake()`, `difficulty()`, `setDifficulty(id)`, `cycleDifficulty()`,
`evaluateAchievements()`, `fmtSplit()`, `sim(opts)`, and `rng()`. The custom-stage hook is
nested at `window.__wordfall.custom`: `stages()` (saved records; each `text` is truncated
to 120 characters for inspection), `last()`, `start(config)`, `open(prefill)`, `state()`,
`segments(text)`, `tokens(text)`, `cards(text)`, `cardCounts(text)`, `cardSource(text)`,
`prompts(text)`, `promptCounts(text)`, `plain(text)`, `typeChunk(str)`,
`imeFocused()`, `reveal()`, `grade('again'|'good'|'easy')`, `cardKey(key)`, `counts(text)`,
`clean(text)`, `config(config)` and
`max` (the live `CUSTOM` object). `clean(text)` returns `{text, stats, removed}` using the
same cleaner as the editor (`stats` breaks removals into `citations`, `links`, `urls`,
`markup`, `chrome`, `references`). `start()` returns `false` when the text produces no
playable segments or tokens; `state()` is `null` outside a practice stage.

`sim({ wpm, mode: 'random'|'skip', seed, maxSec, mistakeRate, draftPauseSec, grant })`
runs a full run synchronously on a virtual clock and returns
`{ dawn, died, cleared, wave, score, pressure, seconds, cards, bestCombo }`. Presentation
(including the wave-clear beat) is skipped inside `sim()`, so tuning runs are deterministic.

### Native updater diagnostics

`--check-update`, `--update-selftest`, `--write-updater-script` and `--current-version`
exercise the updater against the live release feed without touching the installed copy;
see [In-app updater](#in-app-updater) for the commands and expected JSON.

## Tuning

The `CFG` block at the top of `game.js` owns the whole difficulty curve:

- `baseSpeed` (54), `speedPerClear` (0.43), `maxSpeed` (120) - fall speed (all read
  Pressure); a word crosses the 800-unit field in ~14.8 s at wave 1 and ~6.7 s at the start
  of wave 12
- `demandStart` (16), `demandEnd` (92), `demandCurve` (1.82) - the target typing speed of
  the run. `demandWpm()` returns `demandStart + (demandEnd - demandStart) ×
  (pressure / 154) ^ demandCurve`, where 154 is the pressure at the start of wave 12
  (11 waves of 10 clears + 11 drafts of +4)
- `spawnMin` (0.88), `maxWords` (6) - how fast the queue fills. `spawnInterval()` is
  `expectedWordLength() × 12 / demandWpm()`: `expectedWordLength()` is the pool-weighted
  mean length of the current word band, so the board asks for a typing speed rather than a
  gap. Drought (`×1.15` / `×1.20`) and the difficulty multiplier apply on top. `spawnMin` is
  a safety floor only - every wave's interval stays above it in a normal twelve-wave run
  (wave 12 is ~0.98 s)
- `wordRangeSteps` - `[pressureThreshold, [shortest, longest]]` word-length ramp. Each step
  moves at most one bound (3-5 → 3-6 → 4-6 → 4-7 → 5-8 → 6-9 → 6-10), so there is no
  wave-4 cliff
- `waveSize` (10), `wavesPerRun` (12), `pressurePerDraft` (4), `skipPointsPerWave` (150)
- `fakeSpeedMult` - how much faster Decoy fakes drop than real words (4.5×)
- feel: `hitPause`, `echoLife`, shake values, `heatStep`, `comboStep`, `comboCap`;
  `fxMaxParticles` / `fxMaxShards` / `fxMaxRings` / `fxMaxPopups` cap the M7 effect pools
  (the adaptive budget scales the counts down automatically if frame time sags)

Split's cadence lives in `splitEvery()` (5th spawn at tier I, 3rd at tier II) and the draft
rarity curve lives in `slotRareChance()`, not in `CFG`. The shipped numbers are tuned so
`tools/bot.mjs` passes; if you change the curve or the cards, rerun it (and
`tools/balance-lab.mjs --phase cards` to re-rank the card pool).

The custom-stage numbers are deliberately **not** in `CFG`: the `CUSTOM` block owns the
practice caps, the 3.5 s memorize preview, the 42 px/s fall speed, the 1.45 s spawn
interval and the card clock (`cardRecallSec`, `cardRepeatGap`, `cardTimeoutRevealSec`).
Practice bypasses the Pressure curve and the difficulty multipliers, so tuning
the run balance does not move a custom stage, and vice versa.

## Measured balance

Measured on the v1.6 / M9 build with the headless simulator (seed block 1000-1399; 400
seeds per cell, independent block base 5000 in parentheses):

| Cell | Result | Target |
| --- | --- | --- |
| 40 WPM, no cards (`skip`) | dies 400/400, median wave 8 (median 8) | always dies, median 7-9 |
| 50 WPM, no cards (`skip`) | dies 400/400, median wave 10 | always dies |
| 60 WPM, no cards (`skip`) | dies 400/400, median wave 11 | always dies, median 10-12 |
| 60 WPM, random picks | Dawn **46.0%** (47.0%) | Dawn 30-50% |
| 80 WPM, no cards (`skip`) | Dawn 96% (98%) | monitoring cell |
| 80 WPM, random picks | Dawn **99%** (99%) | Dawn > 70% |

The wider spread from the same validation: 20 WPM skip dies at wave 4; 30 WPM skip at 6,
30 random 7, 40 random 9, 50 random Dawn 9%; 70 WPM skip Dawn 28%, 70 random 92%. The
demand curve maps wave 1 to roughly the 10th-percentile typist, wave 6 to the median and
wave 12 to roughly the top 1-2%; bot WPM is an upper bound for a human of the same test
speed, because human play loses ~10-15% to reading and target switching.

### v1.2 / M7 (historical)

The previously published M7 cells are kept for comparison; they no longer describe the
shipped curve. Same seed block and 400 seeds unless noted:

| Cell | Result | SPEC M5 target |
| --- | --- | --- |
| 60 WPM, no cards (`skip`) | dies 400/400 (100%), median wave 7, mean 7.20 | dies at wave 5-7 |
| 60 WPM, random picks | Dawn 43.3% (173/400); 42.3% (127/300 on base 5000) | Dawn 30-50% |
| 80 WPM, random picks | Dawn 99.8% (399/400); 100% on base 5000 | Dawn > 70% |

The card-pool spread is much tighter than v1.1: the strongest marginal pick (Overclock II)
is +61pp dawn and the weakest (Greed I) is −8pp, versus +55pp / −18pp before the M7 pass.
A winning 80 WPM bot run reaches Dawn in ~235 s (3.9 min mean); the SPEC's 8-12 minute
aspiration assumes human draft-reading time and imperfect play.
