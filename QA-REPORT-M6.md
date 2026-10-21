# QA-REPORT-M6.md - independent acceptance review (Wordfall v1.1 / M6)

Reviewer: `docs-qa` (independent verifier - not the author of `game.js`,
`index.html`, `style.css`, `words.js`, `tools/` or `win/`).
Date: 2026-10-21. Build: **v1.1 / M6, frozen**. Final status:
**PASS - no open defects** on the build pinned below.

This review covers the v1.1 feature set - pause, lifetime Records, run stats / seeds /
Retry Seed, settings persistence, the 13th card **Split**, and the modal polish - plus a
regression pass over M1-M5, the bot balance cells, the 1024×768 and 1280×800 Win95
presentation, and the native Windows build. The v1.0 review (`QA-REPORT.md`) is kept as a
historical record and was not rewritten.

## Build under test (final, frozen)

| File | Size | mtime | MD5 |
| --- | --- | --- | --- |
| `game.js` | **75,399 B** | **2026-10-21 18:00:23** | **`ED5A9DD647389C013F4FA4DDDB92ACD2`** |
| `index.html` | **20,322 B** | **2026-10-21 17:58:57** | **`554FD24463C0CF9CE0C9BF00B9B1EEF3`** |
| `style.css` | **19,630 B** | **2026-10-21 17:44:45** | **`08A5D40C5F52EACD51FF8BA5DF97327C`** |
| `words.js` | 4,982 B | 2026-10-21 15:54:55 | `CFE5D0F630AA2610844A0406D93E9736` |
| `tools/smoke.mjs` | **88,504 B** | **2026-10-21 18:01:32** | **`A315A38B0319829CC8207E2FECB554D1`** |
| `tools/bot.mjs` | 16,476 B | 2026-10-21 17:46:22 | `330E0329990E5CF3C6033722687BF630` |
| `win/SmokeRunner.cs` | 12,909 B | 2026-10-21 17:48:07 | `43688FF157785D4C64DF5058EC55EC31` |
| `dist/Wordfall-win64/Wordfall.exe` | 166,400 B | 2026-10-21 18:03:00 | `48C060309F2CCC8A90E9B908CBB3B33A` |
| `dist/Wordfall-win64/Wordfall.dll` | 165,376 B | 2026-10-21 18:03:00 | `C8E00FC579C46B2701430ED39763BD5D` |

`window.__wordfall.version === "M6"`; `CARDS.length === 13`; `hexTotal === 5`.
The four web assets, `tools/` and `win/SmokeRunner.cs` were hashed after the last run and
did not change during it. The native `dist/` was rebuilt at 18:03:00, after the web freeze
at 18:00:23; `Wordfall.dll` contains the frozen M6 strings (`wordfall.records`,
`wordfall.settings`, `const wordsLabel`, `id: 'split'`, `splitEvery`, `hexTotal`,
`version: 'M6'`), so the published app embeds the reviewed web files.

### Moving-target note

QA started on an earlier candidate build. The tree kept moving (Lead/tests finalised
`game.js`, `index.html`, `tools/`), so the Lead declared the tree **frozen** at
`game.js` 18:00:23 / `tools/smoke.mjs` 18:01:32 and rebuilt the native dist at 18:03:00.
The numbers below are fresh runs **after** that freeze; earlier candidate runs are
discarded. Two late fixes were re-verified in this pass: the result-stat line now says
"1 **word** cleared" for a single clear, and the Controls dialog has 7 rows with exactly
one `Esc` row (the duplicate was removed).

## Verdict

**PASS.** All M6 acceptance criteria hold; every M5 balance target still holds at 100 and
400 seeds; the pause/records/stats/seed/Split features behave as specified; 1024×768 (the
smallest reviewed size) and 1280×800 are clean; no console or page errors; the native
`--smoke` reports `ok:true`, `version:"M6"`, `embeddedMode:true`. **Blocker: none.
Major: none. Minor open: none.** §7 lists three non-defect observations and two residual
unverified areas (§8), not defects.

## 1. What I ran (exact frozen-build results)

| Command / probe | Exit | Result |
| --- | --- | --- |
| `node tools/smoke.mjs` | **0** | **133/133 checks PASS**, 0 failed, 0 console/page errors, **21.64 s** |
| `node tools/bot.mjs --seeds 100` | **0** | **5/5 assertions PASS**; 60/skip dies 100%, median **6**, mean 6.23, `{6:78, 7:21, 8:1}`; 60/random Dawn **40.0%** (40/100); 80/random **99.0%** (99/100); 1.5 s |
| `node tools/bot.mjs --seeds 400` | **0** | **5/5 assertions PASS**; 60/skip dies 400/400, median **6**, mean 6.24, `{5:4, 6:299, 7:93, 8:4}`; 60/random **37.3%** (149/400); 80/random **98.8%** (395/400); 2.9 s |
| my M6 feature probe (headless Chrome, 1024×768) | 0 | **28/28 checks PASS**, 0 console/page errors |
| my pause sub-flow probe (headless Chrome, 1024×768) | 0 | **6/6 checks PASS**, 0 console/page errors |
| my FPS probe (1280×800, live play) | 0 | **60.3 avg fps** (121 frames / 2.0 s) |
| native `Wordfall.exe --smoke` (temp copy of `dist/`) | **0** | `ok:true`, `version:"M6"`, `phase:"gameover"`, `embeddedMode:true`, `hasWebViewBridge:true`, seeded sim seed 1000, 60 WPM/skip died wave **7**, **2,261 ms**, WebView2 **155.0.4283.62** |

Probe details are kept as logs in `%TEMP%`:
`wordfall-smoke-final.log`, `wordfall-bot100-final.log`,
`wordfall-bot400-final.log`, `wordfall-m6-verify-final.log`,
`wordfall-m6-pause-extra-final.log`, `wordfall-m6-native-smoke-result.json`.

## 2. M6 acceptance criteria

| Area | Criterion (abridged) | Result | Evidence |
| --- | --- | --- | --- |
| **Pause** | `paused` phase; Esc pauses, Esc/Enter resume; board and playing clock freeze; dialog shows seed/time and Resume-Restart-Controls; Game menu label flips to Resume; Esc closes a menu instead of pausing; P types nothing while paused; not resumable by letters | **PASS** | smoke M6-pause block; my probe: phase `paused`, `#dlgPause.show`, seed line `Seed 31337 · 00:04 played`, Resume default, status/title "Paused", word `y` and `runSec` (3.8827 → 3.8827) unchanged over 800 ms, resume advanced `runSec` to 4.2995; Game menu reads Pause→Resume with `Esc`; Escape closed an open menu without pausing |
| **Records** | `wordfall.records` loads at boot, saves exactly once per finished run, shows 7 fields, migrates `wordfall.best`, Records… in the Game menu | **PASS** | smoke round-trips the 7 fields (baseline 100/3/7/4/1/42/77 → after run 250/4/9/5/1/92/77) and asserts the persisted copy; my probe: dialog values equal `window.__wordfall.records`, OK closes and resumes; `shots/09-records.png` shows the populated table |
| **Run stats + seed** | `stats()` `{keys, mistakes, runSec, wpm, accuracy}`; result line has wave/words/combo/WPM/accuracy/time/seed; `reset(seed)` deterministic; Retry Seed replays the seed; pause never advances `runSec` | **PASS** | smoke seed determinism (identical spawn sequences for the same seed, different for another), stats counts, result line, Retry Seed; my probe: game over line `Wave 1 · 1 word cleared · best combo 1 · 431 WPM · 100% accuracy · 00:00 · Seed 777`, Retry Seed keeps 777 and resets score/keys; Dawn line `Run won · 12 waves cleared · 129 words cleared · best combo 120 · 55 WPM · 100% accuracy · 02:50 · Seed 4242` |
| **Split card** | 13th card, Hex/common/maxTier 2, tier I every 5th spawn / tier II every 3rd; real 3-5 letter word; scores and counts as a clear; no life at the line; blocks words above; bypasses `maxWords`; never fake; teal with dotted marker above; fifth Hex | **PASS** | smoke: cadence `[1,1,1,1,2,…]` / `[1,1,2,…]`, real harmless 3-5 letter extras, typeable + scores (score 30, 3 keys), line costs no life, queue 5→7, 0 fake extras in 12/60 split spawns, fifth Hex (`hexTotal` 5); my 1024×768 capture shows teal `beard` with the dotted marker above and toolbar "Split II" |
| **Settings** | `wordfall.settings` persists the sound toggle across launches | **PASS** | my probe: toggle → `{muted:true}` stored and menu "Sound: Off"; after a full page reload `state.muted` and the stored value are still true |
| **13 cards / eligibility** | 13-card set and generic "all Hexes held" rule over 5 Hexes | **PASS** | smoke: exact 13-card table, 5 Hex ids incl `split`, `hexTotal === 5`, 1050 seeded drafts with 0 eligibility violations |
| **Modal polish** | Title-bar buttons inert while a modal is open | **PASS** | my probe: a real mouse click on the greyed min button while the pause dialog is open does not minimise or change phase; §7 records a non-user-reachable nuance |

## 3. Bot cells - M5 regression (measured)

| Cell | 400 seeds (block 1000-1399) | 100 seeds | SPEC M5 target | Result |
| --- | --- | --- | --- | --- |
| 60 WPM, no cards (`skip`) | dies **400/400**, median **6**, mean 6.24, `{5:4, 6:299, 7:93, 8:4}` | dies 100/100, median **6**, mean 6.23, `{6:78, 7:21, 8:1}` | dies at wave 5-7 | **PASS** |
| 60 WPM, random picks | Dawn **37.3% (149/400)**, median wave 7.5 | Dawn **40.0% (40/100)**, median wave 9 | Dawn 30-50% | **PASS** |
| 80 WPM, random picks | Dawn **98.8% (395/400)** | Dawn **99.0% (99/100)** | Dawn > 70% | **PASS** |

The 40 WPM informational cells remain 100% deaths at median wave 4 (not asserted). The M6
card mix shifts the random-pick numbers slightly from the M5 record (34.8% → 37.3%,
100% → 98.8%) but every M5 target stays inside its band.

## 4. Feature evidence in detail

### 4.1 Pause

- Escape is the only pause key; printable letters are swallowed while paused (smoke
  asserts P does not resume), Escape or Enter resumes, and Escape closes an open menu
  without pausing (`smoke`, my probe).
- The pause dialog: title "Paused", `#pauseSeedLine` = `Seed <n> · MM:SS played`,
  `.pause-note` = "Words are frozen. Nothing falls until you resume.", buttons Resume
  (default), Restart Run, Controls… (`shots/08-pause.png`, my 1024×768 capture).
- Status bar reads "Paused"; title/taskbar read "Wordfall - Paused".
- Game menu item reads "Pause" with the `Esc` shortcut span intact while playing and
  "Resume" while paused; it is disabled during the draft.
- Controls… opened from the pause dialog returns to the pause dialog on close; backdrop
  clicks do not close it (my probe).
- Minimize while playing auto-pauses and restore resumes; a user pause cannot be
  dismissed with the (inert) title-bar min button (my probe).
- `runSec` advanced only while playing: frozen at 3.8827 during the pause, 4.2995 after
  resume.

### 4.2 Records

- `window.__wordfall.records` = `{runs, dawns, bestScore, bestWave, bestCombo, words,
  fastestDawnSec}`; boot loads `wordfall.records`, migrates a larger legacy
  `wordfall.best`, and the welcome dialog / About read `records.bestScore`.
- A forced game over increments runs and words, updates best score/wave/combo, leaves
  dawns/fastest untouched, and persists the same object to `localStorage` once
  (`smoke`: 4→5 runs, 100→250 best, 42→92 words, fastest still 01:17).
- `shots/09-records.png` (1280×800) shows the dialog over a finished run:
  Best score 250, best wave 4, best combo 9, runs 5, Dawns 1, words 92, fastest 01:17.
- My independent probe compared the dialog cells with the live object and verified OK
  closes the dialog and resumes the frozen run.

### 4.3 Run stats, seed and Retry Seed

- `stats()` returns `{keys, mistakes, runSec, wpm, accuracy}`; correct keys and
  wrong keys (including shield-eaten ones) are counted (`smoke`: 1 key + 1 mistake →
  50% accuracy).
- The game-over line is
  `Wave N · N word(s) cleared · best combo N · WPM · accuracy% · MM:SS · Seed N`
  (verified singular "1 word cleared" after the late fix) and the Dawn line uses the
  same tail with `Run won · 12 waves cleared · …`.
- `reset(seed)` stores `state.seed` and reproduces the same spawn sequence for the same
  seed, a different one for another; Retry Seed starts a new run on the old seed with
  score/keys reset.
- WPM is correct-letters/5 per playing minute; the result line tolerates a longer seed
  by wrapping (§7.1).

### 4.4 Split

- `CARDS` has 13 entries and `split` is Hex / common / maxTier 2; `hexTotal` is 5 and the
  eligibility rule is generic (`HEX_TOTAL`).
- Tier I adds an extra word on every 5th successful spawn, tier II on every 3rd
  (`[1,1,1,1,2,…]` / `[1,1,2,…]`), driven by `state.spawnCount`.
- The extra is drawn from the real word pool at 3-5 letters (`beard` 5, `hen` 3 in my
  capture), marked `harmless:true`, never `fake:true`, never misspelled in the
  split-spawn sample.
- It is typeable and scores (clear +1, score +30 for a 3-letter word, keys +3, no
  mistake), and counts toward wave progress.
- At the danger line it is removed without losing a life (lives 1 → 1, phase stays
  playing).
- It bypasses `maxWords` (queue 5 → 7) and is staged above the queue, so it blocks the
  words above it while falling - the Hex's reading-time cost.
- Visual: teal (`COL.splitWord '#00a0a0'`) with a dotted marker above the word; the
  1024×768 capture shows `beard` teal with its dotted rule, toolbar "Split II", Heat 2.

### 4.5 Settings and modal polish

- `wordfall.settings` (`{muted}`) is written on toggle and reloaded at boot (verified
  across a real page reload); the menu label and sound toolbar button follow it.
- While a modal is open the title-bar buttons are greyed and a real mouse click on them
  is blocked; opening Controls/About from pause returns to pause.

## 5. Presentation at 1024×768 and 1280×800

- 1024×768 (smallest reviewed size): app window at 100,46-924,722; `scrollWidth/Height`
  = 1024/768 (no scrollbars); pause, Records, Controls and the Split playfield all fit.
- 1280×800: `shots/08-pause.png` and `shots/09-records.png` inspected; both dialogs are
  centred, period-correct (2px bevels, Win95 grey, no gradients/rounded corners), with
  right-aligned records values and hard separators.
- `shots/04-gameover.png` shows the longer stats line wrapping inside the dialog (allowed
  by the contract) with the Retry / Retry Seed / Quit button row.
- The Controls dialog now has 7 rows and exactly one Esc row; captured at 1024×768 in
  this pass.

## 6. Performance sanity

- Live play at 1280×800 on the frozen build: **60.3 average fps** (121 frames in 2.0 s),
  i.e. full-rate rendering in headless Chrome.
- No console errors, page errors or unhandled rejections in any run (smoke reports
  `consoleErrors: []`; both of my probes report 0).

## 7. Defects and observations

**No defects found.** The two issues that appeared during the review were fixed before
the freeze and re-verified:

1. Result-stat plural: a run with exactly one clear read "1 words cleared"; the frozen
   build reads "1 word cleared" (verified in my probe and in smoke's expected line).
2. Controls dialog had the `Esc` row twice; the frozen `index.html` has 7 rows and exactly
   one `Esc` row (verified by DOM count and the 1024×768 screenshot).

Non-defect observations (no action required for the release):

- **O1 - stats-line wrap.** At 1280×800 a 9-digit seed wraps the game-over/Dawn stat line
  to a second line. The contract explicitly allows the `.stats` line to wrap; it still
  reads correctly and the dialog grows to fit.
- **O2 - CSS-only modal inertness.** While `.app.modal-open`, real mouse clicks on the
  title-bar buttons are blocked (verified inert), but a programmatic `element.click()`
  still runs the handler. This is not reachable by a player and only matters to synthetic
  tests; a defensive `if (document.querySelector('.app.modal-open')) return` would close
  the gap if that is desired later.
- **O3 - release packaging.** `dist/` is gitignored, so the GitHub release must attach the
  built `Wordfall-win64` folder rather than rely on the repo. At the start of this review
  no remote was configured; during the review the Lead added
  `origin https://github.com/Boci0/wordfall.git` and rebuilt `dist/` at 18:03:00. No tag
  was present when this report was written - that is the Lead's release step, not a game
  defect.

## 8. Residual risks / not covered here

- **Audio** was not listened to (headless review). The audio code paths are exercised by
  smoke via the sound toggle/settings checks, but not audibly verified.
- **Native window behaviour** (drag, minimize, maximize, close, first-run profile
  fallback) was not exercised with a visible window (this review intentionally opens no
  visible windows). The native `--smoke` run does verify M6 asset embedding, the WebView2
  bridge, embedded mode and a seeded run identical to the browser.
- **Long human sessions** are represented by bot sweeps plus targeted probes, not by a
  multi-hour manual playtest.
- `QA-REPORT.md` (v1.0) was not rewritten, by design.

## 9. Files and evidence

- Reviewed screenshots: `shots/08-pause.png` (56,534 B, 1280×800),
  `shots/09-records.png` (56,727 B, 1280×800), `shots/04-gameover.png` (stats line and
  Retry Seed), plus the other seven regenerated shots.
- My independent 1024×768 captures (in `%TEMP%`): `wordfall-1024-pause.png`,
  `wordfall-1024-records.png`, `wordfall-1024-controls.png`, `wordfall-1024-split.png`.
- Docs checked against the shipped behaviour: `README.md` (v1.1 features, controls, run
  description, files, test/debug-hook, tuning, measured bot table) and `SPEC.md` (v2.1,
  §2.1 pause/records/seeds/stats, 13-card table, Split, generic Hex eligibility, M6
  milestone, resolved backlog, §10 M6 implementation notes).
