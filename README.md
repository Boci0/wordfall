# Wordfall

*Wordfall for Windows* — a one-screen typing game dressed as a 1995 Windows application.
**Read. Commit. Survive.** You may only type the word closest to the ground — everything
else is inert until it becomes a target. Clear ten words and the board freezes for a
draft of one card out of three. Every card bends the rule, the reading, or the economy.
Survive twelve waves to reach Dawn, then keep playing for score.

Design doc: [SPEC.md](SPEC.md). Independent review: [QA-REPORT.md](QA-REPORT.md).

![The Wordfall application window](shots/02-play.png)
![Draft dialog](shots/06-draft.png)

## Run it

**Native Windows app** (recommended) — a borderless Win95-style window hosted in WebView2:

```
dist\Wordfall-win64\Wordfall.exe
```

**In a browser** — shows the full fake desktop (teal wallpaper, icons, taskbar, Start menu)
with the application window in the middle. No build step, no server, no dependencies:

```
start index.html
```

The game itself is always the same; the native build simply hides the decorative desktop
and fills the window with the app.

## Controls

| Key | Action |
| --- | --- |
| letters | type the target word (the lowest word, or the word you locked onto) |
| Enter | start / retry / continue after Dawn |
| 1 2 3 | draft: pick the matching card |
| R | draft: reroll the offer (once per run) |
| S | draft: skip (+50 × wave points, still raises Pressure) |
| F2 | new run |
| Esc | close a dialog or menu |

Everything in the window is also clickable: File / Game / View / Help menus, the toolbar,
desktop icon, taskbar button and title-bar buttons (minimize, maximize, close) work in the
browser mock desktop and, for the title bar, in the native build.

## How a run works

- **Wave** = 10 clears. When a wave ends the board freezes and a draft opens: slot 1 is a
  Boon, slot 2 anything, slot 3 a Hex or Gambit. Rarity is rolled 75% common / 25% rare.
  Duplicate picks upgrade a card to tier II; cards without a tier II leave the pool.
- **Pressure** = `cleared + 4 × drafts taken` (skips count). Word length, spawn rate and
  fall speed all read Pressure, so skipping does not dodge escalation.
- **Dawn** at the end of wave 12 wins the run; play continues in endless mode, score-only.
- **Lives** start at 1; a word touching the line costs one. **Shields** eat one wrong key
  each (combo kept, no flash) and refill when a wave starts.
- **Heat** = hexes held (tier II counts twice); it multiplies score and keeps rising.
- **Score** = `letters × (10 + Ledger) × combo × heat × Greed × Longshot`, rounded.
- **Wide Scope** widens the target set; the first correct letter **locks on** to one word
  and holds until it is cleared. **Decoy** fakes are misspelled and cannot be typed —
  they drop through fast and are harmless, but while a fake is the lowest word every key
  is a mistake.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | the Win95 desktop + application markup (title bar, menus, toolbar, dialogs, status bar, taskbar) |
| `style.css` | the Windows 95 theme: 16-colour palette, 2px bevels, Tahoma/Microsoft Sans Serif, no gradients or blur |
| `words.js` | 459-word pool (`window.WORDFALL_WORDS`), lengths 3–11 |
| `game.js` | the game — config, state, rules, cards, the pixel playfield renderer, audio, DOM UI wiring, headless sim, debug hook |
| `win/` | native Windows shell: .NET 10 WinForms + WebView2, embeds the web files, borderless Win95 chrome |
| `win/build.ps1` | one-command build/publish (`-Smoke` also runs the published exe's self-test) |
| `install.ps1` | copies the build into `%LOCALAPPDATA%\Programs\Wordfall` and (re)creates the desktop shortcut |
| `dist/Wordfall-win64/` | published native app (`Wordfall.exe`) |
| `SPEC.md` | design doc, cards, milestones, tuning targets |
| `tools/smoke.mjs` | Playwright smoke test — drives the real UI and asserts M1–M4 rules |
| `tools/bot.mjs` | headless WPM bot — asserts the SPEC M5 balance targets |
| `shots/` | screenshots written by the smoke test |
| `QA-REPORT.md` | independent acceptance review |

### Presentation notes

- The playfield is a canvas in a fixed **800-unit-tall logical space**, uniformly scaled to
  whatever the window gives. Fall times and difficulty stay identical at any window size.
- Everything around the playfield is ordinary DOM/CSS: the title bar, menus, toolbar,
  status bar, taskbar, Start menu and dialogs are real elements, not canvas drawings.
- The playfield uses a 16-colour palette, ordered dithering for the sky, 2×2 pixel windows
  in the skyline, Lucida Console words and square particles — deliberately period-correct.

## Native app

Requirements: the .NET 10 SDK and the WebView2 runtime (both already on this machine).

```
powershell -NoProfile -ExecutionPolicy Bypass -File win\build.ps1 -Smoke
```

This publishes a framework-dependent single-file x64 exe to `dist\Wordfall-win64\` (it
needs the installed .NET desktop runtime and WebView2), then runs `Wordfall.exe --smoke`.
The shell serves the web files from memory at `https://wordfall.local/`, so `localStorage`
(best score) works, and the page sees `window.chrome.webview` and hides the mock desktop.

The borderless window uses the page's title bar for dragging and its buttons post
`drag` / `min` / `max` / `close` to the host. The host also reports maximise state back so
the View → Maximize menu label stays in sync. Startup is hardened: a second launch
activates the existing window instead of touching WebView2, and a locked/broken browser
profile is retried and then replaced with a fresh one (`%LOCALAPPDATA%\Wordfall\WebView2-…`)
instead of showing an error.

### Install a desktop shortcut

```
powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
```

This copies the published build to `%LOCALAPPDATA%\Programs\Wordfall` and points
`Desktop\Wordfall.lnk` at the installed exe. The WebView2 profile and best score live in
`%LOCALAPPDATA%\Wordfall`, so reinstalling keeps them.

## Test

```
node tools/smoke.mjs
node tools/bot.mjs --seeds 100
```

Both launch headless Chrome through `playwright-core` (resolvable from the parent
workspace). `smoke.mjs` plays words, checks that non-target words are inert, clears ten
words to reach a draft, asserts every card's effect through the debug hook, checks draft
eligibility over hundreds of seeded offers, forces a word onto the danger line, and writes
screenshots to `shots/`. `bot.mjs` runs the in-page simulator at 40/60/80 WPM with random
or skipped drafts and checks the M5 acceptance numbers.

### Debug hook

`window.__wordfall` exposes `state`, `CFG`, `CARDS`, `reset()`, `typeLetter()`,
`targetWord()`, `targetSet()`, `spawnWord()`, `spawnOne()`, `beginDraft()`, `pick()`,
`reroll()`, `skip()`, `grant(id, tier)`, `setSeed(n)`, `pressure()`, `heat()`,
`heatMult()`, `comboMultiplier()`, `speedMult()`, `nextChar()`, `visibleCount()`,
`wordRange()`, `bucketPressure()`, `isFake()`, `sim(opts)`, and `rng()`.
`sim({ wpm, mode: 'random'|'skip', seed, maxSec, mistakeRate, draftPauseSec, grant })`
runs a full run synchronously on a virtual clock and returns
`{ dawn, died, cleared, wave, score, pressure, seconds, cards, bestCombo }`.

## Tuning

The `CFG` block at the top of `game.js` owns the whole difficulty curve:

- `baseSpeed`, `speedPerClear`, `maxSpeed` — fall speed (all read Pressure); the shipped
  curve crosses the field in ~16 s at wave 1 and ~8.8 s at max Pressure
- `spawnStart`, `spawnMin`, `spawnDecay`, `maxWords` — how fast the queue fills (6 max)
- `wordRangeSteps` — `[pressureThreshold, [shortest, longest]]` word-length ramp
- `waveSize` (10), `wavesPerRun` (12), `pressurePerDraft` (4), `skipPointsPerWave` (50)
- `fakeSpeedMult` — how much faster Decoy fakes drop than real words (4.5×)
- feel: `hitPause`, `echoLife`, shake values, `heatStep`, `comboStep`, `comboCap`

The shipped numbers are tuned so `tools/bot.mjs` passes. If you change the curve, rerun it.

## Status

- [x] M1 — core loop (falling words, nearest-only typing, combo, run ends, best score)
- [x] M2 — draft + Pressure (waves, draft screen, reroll/skip, Heat in scoring/HUD, 3 starter cards)
- [x] M3 — full 12-card set, Shield, Lock-on, Ghost echoes, Decoy fakes, eligibility filter, tier II
- [x] M4 — hit-pause, clear particles, combo pitch rise, near-miss shake, danger-line heartbeat, card rise animation
- [x] M5 — 459-word pool + headless WPM bot + tuned curve
- [x] Windows 95 presentation + native WinForms/WebView2 build

Measured with `node tools/bot.mjs --seeds 400` (seed block 1000–1399); the default
`--seeds 100` run gives median 6, 33% / 100%:

| Cell | Result | SPEC M5 target |
| --- | --- | --- |
| 60 WPM, no cards (`skip`) | dies 400/400 (100%), median wave 6, mean 6.24, {5:4, 6:299, 7:93, 8:4} | dies at wave 5–7 |
| 60 WPM, random picks | Dawn 34.8% (139/400) | Dawn 30–50% |
| 80 WPM, random picks | Dawn 100% (400/400) | Dawn > 70% |

A winning bot run takes ~4.2 minutes (255 s mean over 43 bot wins); the SPEC's 8–12
minute aspiration assumes human draft-reading time and imperfect play.
