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
- **Smoother ramp** - the wave-4 cliff is gone. Word lengths now move one bound at a time
  across the run, spawn keeps tightening past wave 4, and fall speed keeps rising instead
  of capping at wave 5-6. Pressure, cards, Heat and scoring are unchanged.
- **Impact and presentation (M7 + v1.4)** - the per-letter detonations, word trails,
  shockwaves, soft-focus backdrop, louder typing and the low-resolution renderer that keeps
  a full board at 60fps; the game remains a single canvas plus DOM shell with no build
  step, and the effect layer is capped and adaptive.

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
- **Records** - lifetime best score / wave / combo, runs, Dawns, words cleared and fastest
  Dawn, kept in `localStorage` (`wordfall.records`) on this machine. Open with
  Game → Records…; sound on/off is stored in `wordfall.settings`.

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

## Files

| File | Purpose |
| --- | --- |
| `index.html` | the Win95 desktop + application markup (title bar, menus, toolbar, dialogs, status bar, taskbar) |
| `style.css` | the Windows 95 theme: 16-colour palette, 2px bevels, Tahoma/Microsoft Sans Serif, no gradients or blur |
| `words.js` | 459-word pool (`window.WORDFALL_WORDS`), lengths 3-11 |
| `game.js` | the game - config, state, rules, cards, the pixel playfield renderer, audio, DOM UI wiring, headless sim, debug hook |
| `win/` | native Windows shell: .NET 10 WinForms + WebView2, embeds the web files, borderless Win95 chrome |
| `win/Updater.cs` | in-app updater: GitHub release check, SHA-256-verified download, staged file swap + relaunch |
| `win/UpdateProgressForm.cs` | small Win95-style download progress dialog shown by the updater |
| `win/build.ps1` | one-command build/publish (`-Smoke` also runs the published exe's self-test) |
| `install.ps1` | copies the build into `%LOCALAPPDATA%\Programs\Wordfall` and (re)creates the desktop shortcut |
| `dist/Wordfall-win64/` | published native app (`Wordfall.exe`), regenerated by `win/build.ps1`; gitignored, not in the repo |
| `SPEC.md` | design doc, cards, milestones, tuning targets |
| `tools/smoke.mjs` | Playwright smoke test - drives the real UI and asserts M1-M7 rules + effects/perf |
| `tools/bot.mjs` | headless WPM bot - asserts the SPEC M5 balance targets |
| `tools/balance-lab.mjs` | card-power + draft-economy lab (baseline/cards/offers/policies/CFG phases) |
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
node tools/bot.mjs --seeds 100
node tools/bot.mjs --seeds 400
```

Both scripts launch headless Chrome through `playwright-core` (resolvable from the parent
workspace). `smoke.mjs` plays words, checks that non-target words are inert, clears ten
words to reach a draft, asserts every card's effect through the debug hook, checks draft
eligibility over hundreds of seeded offers, forces a word onto the danger line, covers the
M6 features (pause freezes board and clock, Records load/save, seed determinism and Retry
Seed, WPM/accuracy stats, Split), and covers the M7 build: the effect pools fire on a
clear, combo milestones and the wave-clear beat, the Effects toggle persists, the CSS
hook classes/vars are applied, and a full-board frame-time check holds 60fps. It writes
screenshots to `shots/`. `bot.mjs` runs the in-page simulator at 40/60/80 WPM with random
or skipped drafts and checks the M5/M7 acceptance numbers at 100 and 400 seeds;
`tools/balance-lab.mjs` reproduces the card-power and draft-offer measurements in
[BALANCE-LAB.md](BALANCE-LAB.md).

### Debug hook

`window.__wordfall` exposes `version` (`'M7'`), `state`, `CFG`, `CARDS` (18), `records`
(live lifetime object), `settings` (`{muted, fx}`), `hexTotal` (6), `reset(seed?)`,
`newRun()`, `pause()`, `resume()`, `stats()` (`{keys, mistakes, runSec, wpm, accuracy}`),
`fxState()` (`{quality, particles, shards, rings, popups, streaks, milestone, danger, cssCombos}`),
`toggleEffects()`, `perf()` (`{avgMs, fps, pressure, quality}`), `typeLetter()`,
`targetWord()`, `targetSet()`, `spawnWord()`, `spawnOne()`, `beginDraft()`, `pick()`,
`reroll()`, `skip()`, `grant(id, tier)`, `setSeed(n)`, `pressure()`, `heat()`,
`heatMult()`, `comboMultiplier()`, `speedMult()`, `scoreMult()`, `spawnInterval()`,
`nextChar()`, `visibleCount()`, `wordRange()`, `bucketPressure()`, `isFake()`, `sim(opts)`,
and `rng()`.
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

- `baseSpeed` (54), `speedPerClear` (0.60), `maxSpeed` (100) - fall speed (all read
  Pressure); the shipped curve crosses the field in ~15.5 s at wave 1 and ~8.4 s once
  speed caps, around wave 7
- `spawnStart` (2.85), `spawnMin` (1.16), `spawnDecay` (0.031), `maxWords` (6) - how fast
  the queue fills; the interval keeps tightening through wave 4 and reaches its floor
  around wave 5
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

## Measured balance

Measured on the M7 build with the headless simulator (seed block 1000-1399; 400 seeds per
cell, and the 60 WPM cell re-checked on an independent block, base 5000):

| Cell | Result | SPEC M5 target |
| --- | --- | --- |
| 60 WPM, no cards (`skip`) | dies 400/400 (100%), median wave 7, mean 7.20 | dies at wave 5-7 |
| 60 WPM, random picks | Dawn 43.3% (173/400); 42.3% (127/300 on base 5000) | Dawn 30-50% |
| 80 WPM, random picks | Dawn 99.8% (399/400); 100% on base 5000 | Dawn > 70% |

The card-pool spread is much tighter than v1.1: the strongest marginal pick (Overclock II)
is +61pp dawn and the weakest (Greed I) is −8pp, versus +55pp / −18pp before the M7 pass.
A winning 80 WPM bot run reaches Dawn in ~235 s (3.9 min mean); the SPEC's 8-12 minute
aspiration assumes human draft-reading time and imperfect play.
