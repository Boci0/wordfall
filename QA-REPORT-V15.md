# QA report — Wordfall v1.5 (independent verification)

**Verdict: SHIP.** No v1.5 regression found. The only failing checks are machine-sensitive
frame-time checks that fail identically on the pre-v1.5 (M7) baseline, plus one balance-cell
sampling artefact at 30 seeds that disappears at the bot's calibrated 100 seeds.
**Blockers: none.** Two release-process notes below (quiet machine for the perf gate; use
`--seeds 100` for the balance gate).

- Date: 2026-10-22 · reviewer: qa-v15 (independent; no source/test/tool/doc files modified)
- Tree reviewed: working tree at 14:34 local — `game.js` M8, `tools/qa-v15.mjs` present,
  `tools/bot.mjs` gate patched to M8, title-bar clock removed. All file checks below were
  run after those edits.

## Post-review fix

The Lead fixed the only cosmetic finding after this review: endless waves 13+ now label their
split `WAVE n - MM:SS.t - ENDLESS` instead of repeating `FIRST SPLIT` every wave
(`announceSplit` in `game.js`). The 45/45 result below still stands; the suite contains no
endless-split assertion, so re-running only needs the standard commands.

## Commands and results

### 1. `node tools/qa-v15.mjs` (v1.5 acceptance suite)
```
{
  "passed": 45,
  "total": 45,
  "elapsedSec": 7.45,
  "errors": [],
  "failed": []
}
EXIT=0
```
45/45 pass, zero console/page errors. The task brief said "44/44"; the current file contains
45 `check()` calls. The extra assertion is
`timer: the signal strip carries the same clock` (tools/qa-v15.mjs:114), added when the
title-bar clock was removed. Not a failure — the expected count in the brief is stale.

### 2. `node tools/smoke.mjs` (197-check regression suite)
| Run | Pass | Failures | Full-FX frame numbers |
|---|---|---|---|
| v1.5, pass A (machine busy: bot Chrome also up) | 194/197 | the 3 M7 perf checks only | avg 25.94 ms, **median 32.6 ms**, p95 33.5, long 90, 38.5 fps |
| v1.5, pass B (clean machine, current tree) | 194/197 | the 3 M7 perf checks only | avg 23.33 ms, **median 16.7 ms**, p95 33.4, long 68, 42.9 fps |
| **M7 baseline control** (HEAD `e584828` extracted to `%TEMP%\qa-v15`, pre-v1.5 code) | 194/197 | **the same 3 M7 perf checks** | avg 24.5 ms, **median 16.8 ms**, p95 33.5, long 79, 40.8 fps |

Failing checks in every run above, including the pre-v1.5 baseline:
- `M7 perf: full FX sustains >= 50 fps while clearing a full board` (v1.5: 42.9 fps)
- `M7 perf: long frames stay rare in full FX mode` (68 long frames vs budget 19; p95 33.4 ms)
- `M7 perf: perf() reports {avgMs, fps, pressure, quality}` (fps 43, threshold 45)

All other 191 non-perf checks pass, `consoleErrors: []`, and the median frame time is
16.7–16.8 ms in both the v1.5 and the M7 control runs. The failure signature is identical
with and without v1.5 code, so this is machine/frame-time noise (roughly every third frame
takes two vsync intervals on this host), **not a v1.5 regression**. Perf gate should be run
on a quiet machine.
(One redirected smoke run was discarded: the shell produced `EBADF: bad file descriptor,
write` inside Node's stderr writes, aborting sections. Re-run without that redirection was
clean as reported. Tooling artefact, not game behaviour.)

### 3. `node tools/bot.mjs` — balance must not move
**`--seeds 30` → EXIT 1, 4/5 assertions pass.** Only the 60 WPM/random cell misses:
```
60   random    30   23.3%   76.7%         9       9.43       187       21663
FAIL  60 WPM / random: dawn rate 30-50%
      actual: dawn rate 23.3% (7/30)
```
Other cells at 30 seeds: 40 skip median wave 5; 60 skip median 7 (distribution
`{6:1, 7:27, 8:2}`); 80 random dawn 100%.

**`--seeds 100` (acceptance run) → EXIT 0, 5/5 assertions pass:**
```
WPM  MODE    RUNS  DAWN%   DEATH%  MED WAVE  MEAN WAVE  MEAN SEC  MEAN SCORE
40   skip     100    0.0%  100.0%         5       5.05       110        5682
40   random   100    0.0%  100.0%       5.5       5.52       119        6620
60   skip     100    0.0%  100.0%         7       7.07       137        9882
60   random   100   35.0%   65.0%         9       9.54       191       22687
80   skip     100  100.0%    0.0%        12      12.00       216       24671
80   random   100   99.0%    1.0%        12      12.00       224       44069
```
**Independently compared against the pre-v1.5 M7 build** (same tool, HEAD extracted from
git): the 100-seed per-cell table is **identical line for line**, including the
`60 WPM/skip` death distribution `{ 6:2, 7:89, 8:9 }`. v1.5 does not move balance.
The 30-seed 23.3% cell is sampling noise (7/30 vs 35/100); the bot's own header says the
M5 assertions are calibrated at 100/400 seeds. Recommendation: keep `--seeds 100` (or more)
as the balance gate, or note the calibration in the tool/README.

## Diff review against the v1.5 claims (all verified)

| Claim | Evidence | Result |
|---|---|---|
| Run clock only in play | `game.js:1924` advances `runSec` only when `phase === 'playing' && waveClearT <= 0`; pause/draft freeze verified in qa-v15 and independently in Chrome (0.000 s drift over 700 ms paused) | pass |
| Wave splits + PB storage | `game.js:619` `registerWaveSplit`; separate `wordfall.splits` key (`game.js:480`, load 523, save 559); strip readout `game.js:3175`; Splits dialog `game.js:3035`; PBs survive reload (qa-v15 persistence check) | pass |
| Achievements persisted separately, skipped in sim | `ACHIEVEMENTS` `game.js:444`; `wordfall.achievements` key `game.js:479`; `evaluateAchievements()` returns early when `state.simulating` (`game.js:665-666`) and `unlockAchievement` also guards (`game.js:676`); 15 rows, count header, toasts verified | pass |
| Difficulty multipliers default to 1.0; bot/balance unchanged | `DIFFICULTIES` `game.js:100-124` (standard speed 1, spawn 1, 1 life); `state.lives = difficulty().startLives` `game.js:739`; spawn ×mult `game.js:986`; speed ×mult `game.js:991`; default setting `standard`; bot 100-seed table byte-identical to M7 baseline (above) | pass |
| Decoy fake visually distinct without changing the rule | fake target colour `game.js:2500`; DECOY tag + double underline `drawFakeMarker` `game.js:2551`; one-time `DECOY · LET IT PASS` cue `game.js:2034`; status `DECOY - WAIT`; qa-v15 confirms typing a fake still yields progress 0, every key a mistake, word stays on the board. Independent screenshot `shots/qa-v15-decoy-target.png` shows magenta word + DECOY tag, distinct from the real target | pass (rule unchanged by design) |
| No overlapping wave-clear callouts | center `RECEIVER PATCHED` popup removed; combo milestone suppressed on the 10th clear (`game.js:1482`); wave title card moved to `H * 0.5` (`game.js:2673`); qa-v15 asserts no `WAVE n ·` centre popup; spot-check at the beat found popups only for points/combo streaks, none in the centre; screenshot `shots/qa-v15-wave-clear.png` | pass |

Additional checks: title bar no longer duplicates the clock (verified; docs consistent),
difficulty buttons in the Welcome dialog select/persist correctly, and all repo text files
(SPEC/README/CHANGELOG/TECHNICAL/tools) are valid UTF-8 — the invalid `0x85` byte that was
in SPEC.md during the first pass has been fixed in the current tree.

## Headless Chrome spot-check (independent, 1260x876, `file://`, channel chrome)

22/22 spot checks passed, exit 0, no console/page errors:
welcome difficulty buttons (Standard default, Nightmare click), live strip readout, pause
freezes the clock and resume continues it, one wave clear (title card live, strip flashes
`WAVE 1 CLEARED · FIRST SPLIT`, no stacked centre popup), Splits dialog 12 rows with the
clock frozen, opening Splits during live play pauses the run and OK resumes it, Achievements
dialog 15 rows / `Unlocked 3 / 15` / menu label `(3/15)`.

Screenshots written for this review (repo `shots/`):
- `shots/qa-v15-welcome.png` — Welcome dialog with Casual / Standard / Nightmare, Standard selected
- `shots/qa-v15-strip-run.png` — live run: strip RUN / THIS WAVE / STANDARD + status bar clock
- `shots/qa-v15-pause.png` — paused run with the clock frozen
- `shots/qa-v15-wave-clear.png` — wave-clear title card + gold strip flash, toasts clear of the strip
- `shots/qa-v15-splits.png` — Splits dialog (12 rows, wave 1 best and this-run split)
- `shots/qa-v15-achievements.png` — Achievements dialog (15 rows, 3 unlocked)
- `shots/qa-v15-decoy-target.png` — Decoy fake as the lowest word: magenta + DECOY tag + cue

## Residual risks / notes for the Lead (non-blocking)

1. **Perf checks need a quiet machine.** On this host all three `M7 perf` checks fail for
   both v1.5 and the pre-v1.5 M7 control with the same numbers (median 16.7 ms but ~35–40%
   of frames are one vsync long). Do not treat this as a v1.5 regression; re-run on an idle
   machine for the release gate.
2. **Bot at `--seeds 30` exits 1 on the 60 WPM/random cell (23.3%).** It is sampling noise
   (100 seeds: 35.0%, identical to the M7 baseline); use 100+ seeds for acceptance or
   document that the 30-seed cell is underpowered.
3. **Endless waves 13+ show `FIRST SPLIT` every wave.** `registerWaveSplit` (`game.js:619`)
   has no storage slot past wave 12, so `prev` is always 0 and the strip announces
   "FIRST SPLIT" / delta 0 for every endless wave. Cosmetic only; splits past 12 are not
   persisted by design.
4. **Splits opened from the draft keeps `phase === 'draft'`** rather than `paused` (the run
   clock is already frozen in the draft). Closing returns to the draft; not a bug, but the
   qa-v15 "opening the dialog pauses the run" check only holds from live play.
5. Balance/splits/achievements share the existing localStorage area but use new keys; no
   migration of the old records blob was needed and old saves load cleanly (qa-v15 reload
   checks pass).

## v1.5 final addendum — main screen + optimization pass

**Verdict: SHIP.** The main screen and the performance pass introduce no rule, balance or
persistence regression. One cosmetic inconsistency found (stale status-bar numbers after
`Main Menu`), no blockers.
- Addendum date: 2026-10-22 15:3x · reviewer: qa-v15 (read-only; only this file and the two
  `shots/qa-v15-main-*.png` screenshots were written).
- Tree reviewed: `game.js` 163,582 B @ 15:31, `index.html` @ 15:28, `style.css` @ 15:31,
  `tools/qa-v15.mjs` @ 15:31, `tools/smoke.mjs` @ 15:29 (Lead's main-screen + optimization pass).

### 1. `node tools/qa-v15.mjs` — 54/54 PASS
```
{ "passed": 54, "total": 54, "elapsedSec": 8.11, "errors": [], "failed": [] }
EXIT=0
```
All 54 checks pass (the 45 from the first review plus 9 main-screen/benchmark checks),
zero console/page errors. The benchmark check measured `benchScene(180)` well under its
12 ms/frame budget (0.2 ms/frame here).

### 2. `node tools/smoke.mjs` — 194/197, only the 3 known `M7 perf` failures
Same signature as the M7 baseline control documented above:
`M7 perf: full FX sustains >= 50 fps` (42.5 fps), `M7 perf: long frames stay rare`
(72 long frames vs budget 19, p95 33.4 ms), `M7 perf: perf() reports ...` (fps 39-43).
Full-FX median frame time **16.8 ms**, light median 16.7 ms, `consoleErrors: []`. Including
the adapted checks `M6 records: the main screen shows the record best score` and the
`#mainStart` FX-dialog path. Not a regression (identical on pre-v1.5 HEAD, section 2 above).

### 3. `node tools/bot.mjs --seeds 100` — 5/5 PASS, balance unchanged
```
40 skip 5.05 · 40 random 5.52 · 60 skip 7.07 · 60 random 35.0% dawn · 80 skip 12.00 · 80 random 99.0%
60 WPM / skip death-wave distribution: { 6:2, 7:89, 8:9 }
RESULT: PASS — 5 passed, 0 failed
```
Per-cell table is identical to the pre-main-screen run and to the pre-v1.5 M7 baseline
(see section 3 above). The attract-mode rain uses `Math.random` only (`MENU_RAIN_WORDS`
`game.js:154`, `makeMenuDrop` `game.js:2270-2282`, `initMenuRain` `game.js:2284`) and lives in
`state.menuRain` (`game.js:436`), never in `state.words`, so the seeded sim is untouched —
confirmed by the unchanged sweep.

### 4. Main screen review (independent headless Chrome, 1260x876, `file://`)
All checks pass; 22/22 in the main-screen pass plus 7/7 edge checks, no console/page errors:
- **Boot** shows `#mainScreen` (`display:flex` via `body.phase-menu`, `style.css:403,416`;
  phase class in `game.js:2929`), not `dlgWelcome` (the element is gone from `index.html`).
  Title bar and taskbar read **`Wordfall - Main Menu`** (`game.js:3395-3398`).
- **Start + difficulty**: `#menuStart` and 3 `#mainMode .mode-btn` (Standard pressed by
  default); clicking Casual then Start began a run with `state.difficulty='casual'`,
  `lives=2`, status `Mode: Casual`; Start hides the screen. **Enter** on the menu also starts.
- **Six destinations** `records / splits / achievements / controls / about / quit`
  (`index.html:209-214`), live stats `best / fastest Dawn / dawns`, achievement count `n / 15`,
  and **14 attract-rain words** that drift while visible (positions advanced over 700 ms).
- **Dialogs above it**: Records/Splits/Achievements open with `phase='menu'`, main screen
  still visible, modal z-index 5 > main-screen z-index 3; OK or **Escape** returns to the
  main screen (`body.phase-menu` re-shown). Screenshots below.
- **Return paths**: `File -> Main Menu` while playing and while paused, the pause dialog's
  `#pauseMenu`, and the game-over dialog's `#overMenu` all return to the title screen with
  the board and effects cleared, no modal open, and the title bar back to `Main Menu`
  (`returnToMenu`, `game.js:3028-3046`; handlers `game.js:3709,3742-3743`). After a finished
  run the main-screen stats panel shows the new record best (verified: 321).
- **Rain is presentation-only**: menu `update()` returns before any rule code
  (`game.js:1991`), `updateMenuRain`/`drawMenuRain` (`game.js:2289,2297`) touch only
  `state.menuRain`; no rule reads it.

### 5. Optimization review (correctness traps)
- **Frame-scoped target cache** — `targetSet()`/`targetWord()` at `game.js:1141-1188`; the
  cache is armed at the top of `render()` (`game.js:2191`) and disarmed at its end
  (`game.js:2241`). `render()` has no early `return` between those two lines, so the cache
  cannot leak past a frame. All rule/input call sites (`game.js:1548,1811,1855,1881,2076`
  inside update/typing, `4142` in `sim`) run outside render, where `renderCacheActive` is
  false, so they always recompute. Independently tested the trap: between frames the lowest
  word was removed; `targetWord()` returned the *new* lowest and `targetSet()` no longer
  contained the removed word (no stale hit).
- **Reused draw order** — `drawOrder` (`game.js:302`) is `length = 0` then re-filled and
  sorted each `drawWords` call (`game.js:2435`), so no stale entries.
- **Status-bar early-out** — `updateStatus()` (`game.js:3346-3358`) keys every value it
  prints (phase, endless, wave/waveCleared, lives, shields, shieldMax, heat, pressure,
  floor(runSec), score, combo, difficulty, fake/reverse/tunnel); `populateStrip()` keeps its
  own 10 Hz key. It is only called from `syncUi()` inside `render()` (`game.js:2240`) plus
  `updateDifficultyUi()` on a user action, so the key's `targetWord()` read hits the frame
  cache rather than adding a sort.
- **`benchScene()`** — exposed at `game.js:4184`; resets to a seeded run, spawns a full
  board, then runs `update(1/60)+render()` synchronously and returns
  `{frames, totalMs, perFrameMs, words}`. Measured 0.2 ms/frame (SPEC says ~0.4) and the
  qa-v15 budget check (< 12 ms) passes. It deliberately leaves the benchmark run in
  `state` (phase `playing`, `lives=99`, ~3 s on the clock); it is a test hook only and a
  normal `reset()`/Start Run restores a clean run (verified). Nothing in the UI can reach it.

### 6. Findings
- **Minor / cosmetic — status bar keeps the abandoned run's numbers on the main screen.**
  `returnToMenu()` (`game.js:3028-3046`) clears the board/effects but not the run counters,
  and `updateStatus()` (`game.js:3378`) prints `state.runSec/score/...` in every phase.
  Repro: play to ~Score 4,321 / 01:27 / Wave 3, then `File -> Main Menu`; the status bar reads
  `Ready | Time: 01:27 | Score: 4,321 | Wave: 3/12 | Combo: 1.20×` while the main screen
  claims `No run yet` (strip is hidden by CSS in menu). Not a rule bug and the main-screen
  stats panel is correct; suggested fix is to zero the run counters in `returnToMenu()` (or
  show `—` while `phase === 'menu'`).
- **Internal note — `returnToMenu()` during the wave-clear beat leaves `state.waveClearT` set**
  (menu `update()` returns at `game.js:1991` before the decrement at `game.js:2008`), so the
  timer survives in the menu until the next `reset()`. No visual effect found: the
  "WAVE n CLEARED" canvas card sits behind the opaque main panel and is cleared by the next
  run. Not worth a fix unless the timer is reused elsewhere.
- Docs are consistent with the build: SPEC 14.5/14.6, CHANGELOG v1.5, README and TECHNICAL
  all describe the main screen, the frame cache, `benchScene` and the 54-check suite; all
  repo text files are valid UTF-8.

### 7. Screenshots (this addendum)
- [`shots/qa-v15-main-menu.png`](shots/qa-v15-main-menu.png) — boot: full main screen, Wordfall wordmark, Start Run, Standard selected, six destinations, stats, attract rain behind, title bar `Wordfall - Main Menu`.
- [`shots/qa-v15-main-records.png`](shots/qa-v15-main-records.png) — Records dialog open above the main screen (modal layer over the title screen), ready to OK/Esc back.

**Blockers: none.** Suggest (optional) fixing the stale status bar before release; everything
else is ship-ready.

## 8. Post-QA adjustments (Lead, same release)

Two changes landed after this review; both are covered by `tools/qa-v15.mjs`, now **56
checks**:

1. **Stale status bar fixed.** `returnToMenu()` now calls `reset(state.seed)` before entering
   the menu phase, so score/time/wave/combo and the wave-clear beat are zeroed and the main
   screen and status bar agree. New check: "main screen: the abandoned run is cleared from
   the status bar".
2. **Long-word pacing.** The playtest line behind the decoy review turned out to be hyperbole
   ("the word is so long I die"), so nine- and ten-letter words now fall at 92% speed
   (`lengthRelief` in `update()`). New check: "long words: 9+ letter words fall 8% slower".
   Balance re-run: `--seeds 100` PASS (60 WPM random Dawn 42.0%) and `--seeds 400` PASS
   (39.5%, inside the SPEC 30-50% cell); the 7-letter Longshot speed assertion is unaffected.

Re-run after the adjustments: `qa-v15.mjs` 56/56 PASS, `bot.mjs` 5/5 PASS at 100 and 400
seeds, full `smoke.mjs` 194/197 with only the three known machine-noise perf checks
(median frame 16.7 ms). No console errors.

