# Independent QA — Wordfall v1.4 juice pass

Date: 2026-10-21 (Asia/Singapore) · QA: `qa-juice` (independent verifier, read-only on product code)
Workspace: `C:\Users\muhdb\OneDrive\Documents\deepseek-harness\default-workspace\wordfall`

This pass verifies the uncommitted v1.4 juice work against the user request:
*improve the game; make typing effects even more extreme; more animations; more distracting
animations; word trails; louder typing sound; replace the city-ish background with a very
trippy one* — plus the follow-up user bug report about title-bar buttons under modals.

Product code was not modified. The only new files are this report, `shots/qa-*.png` and the
harness `tools/qa-juice.mjs`.

## Frozen build under test (SHA-256, first 12)

| File | SHA-256 | Note |
| --- | --- | --- |
| `game.js` | `6CE188B3989B` | frost |
| `style.css` | `660472BC3E11` | frost v2 (title-bar buttons live under modals) |
| `index.html` | `35B299819793` | frost |
| `README.md` | `99BB96576001` | frost v2 (docs only) |
| `tools/smoke.mjs` | `978B0273AB87` | authoritative regression suite |
| `tools/bot.mjs` | `9AE7EC247BB6` | balance bot |
| `win/Wordfall.csproj` | `0890061F1C55` | v1.4.0 |

`game.js` was identical across the whole final sequence; only `style.css`/`README.md` changed
in the last user-requested fix, and the final smoke + QA runs were made after that freeze.

## Commands run and outcomes

| # | Command (from `wordfall/`) | Result |
| --- | --- | --- |
| 1 | `node tools/smoke.mjs` (final, clean run on frozen hashes) | **PASS — `pass:true`, 197/197 checks, exit 0**, 34.74 s, `consoleErrors: []` |
| 2 | `node tools/bot.mjs --seeds 100` | **PASS — `RESULT: PASS`, 5/5 assertions**, 100 seeds/cell, 1.6 s |
| 3 | `node tools/qa-juice.mjs` (`QA_OLD_DIR` = git-HEAD v1.3 extract) | 52 PASS / **2 FAIL** of 54 checks; both viewports; no page/console errors |
| 4 | `node tools/qa-juice.mjs --vp 1280x800` (harness calibration runs) | used to tune pixel thresholds, not a product verdict |

Old-build reference used for the "is it really a different background" comparison:

```
git archive --format=tar -o $env:TEMP\wordfall-head.tar HEAD game.js style.css index.html words.js
tar -xf $env:TEMP\wordfall-head.tar -C $env:TEMP\wordfall-head-ref
$env:QA_OLD_DIR = "$env:TEMP\wordfall-head-ref"
node tools/qa-juice.mjs
```

**Smoke history (honest note):** two earlier smoke runs failed the same check
(`M7 perf: long frames stay rare in full FX mode`, p95 33.3 ms > 20 ms target, exit 1).
One ran while the Lead was still editing `game.js` (hash changed mid-run), the other while
the Lead's own Playwright processes were live. The final clean run on the frozen hashes —
nothing else running — passed 197/197 with p95 16.9 ms. The perf gate is load-sensitive;
the authoritative result is the clean run.

## User-requirement verdicts

| # | Requirement | Verdict | Key evidence |
| --- | --- | --- | --- |
| 1 | Improve the game (without breaking rules/scoring) | **PASS** | v1.4 version bump (`csproj` 1.4.0, About "Version 1.4 · signal-melt edition"), README "What's new in v1.4", smoke 197/197, bot 5/5 asserting the M5 rules/scoring, 18-card pool/eligibility checks unchanged |
| 2 | Typing effect even more extreme | **PASS (with one spec gap) — see risk R1** | One correct letter: `particles 5, streaks 3, rings 1, keyPunch 0.335, keyFlash 0.102, shake 0.078`; 9-key rapid streak: `particles 61, rings 11, streaks 44, keyPunch 0.612, keyFlash 0.201, glitch 0.231`. One-letter `glitch` is `0` (QA brief expected > 0) |
| 3 | More animations | **PASS** | Six animated layers in `render()` (plasma tunnel, rotating diamond vortex + mote spiral, floaters/flare, scan sweep/interference/slant rain, reactive equaliser, word sway, glitch slices). Pixel change over 4×620 ms: top 85.3%, middle 87.3%, bottom/equaliser 76.8% (1280×800); 85.5% / 89.2% / 77.4% (1920×1080) |
| 4 | More distracting animations | **PASS** | Ambient glitch bursts while idle: 4 bursts in 8 s (max 0.75) at 1280×800 and 5 bursts (max 0.75) at 1920×1080; CSS `.fx-rainbow` rolling interference band `animationName: fx-rainbow-roll` (9 s, 0.42–0.95 opacity, faster/dimmer during danger), plus scanline/noise/vignette FX overlay |
| 5 | Words have trails | **PASS** | 5/6 words carried `trail.length = 10` (config `trailEvery 0.045`, `trailLen 10`); removing trails changed 5 706 / 6 383 pixels in the word-above regions vs 677 / 789 same-frame control pixels (8.4× / 8.1×), i.e. the comet tails are visibly separate geometry. See `shots/qa-trails-*.png` |
| 6 | Louder typing sound | **PASS** (verified by code inspection + run-time probe; not audibly verified) | Old v1.3 committed-letter gain `0.010` square → new `0.065` square = **6.5×** (8.1× after the 1.25 master gain), plus a 0.07 s triangle layer (0.05), first-letter sawtooth (0.03) and a new filtered-noise key click. Master chain: `GainNode(1.25) → DynamicsCompressor(threshold −15, ratio 5, knee 8) → destination`; `audioOut()` returns the master and the only `ac.destination` connection is the compressor (no bypass). Runtime probe: context `running`, 2 typed letters produced +5 oscillators / +2 buffer sources, master gain 1.25 present, both chain edges observed, no page errors |
| 7 | Very trippy background replacing the city-ish one | **PASS** | Over 560 ms the playfield changed 90.6% of pixels (1280×800) / 99.95% (1920×1080); saturated pixels 80.7% / 69.7%, mean luminance 36.0 / 52.5, 10 / 5 populated hue families. Git-HEAD v1.3 reference backdrop: mean luminance 4.86, 1 hue family, visual = dark navy sky + skyline. See `shots/qa-bg-*`, `shots/qa-playfield-*` vs `shots/qa-old-ref-*` |
| 8 | User bug: title-bar minimize/maximize/close usable while a modal is open | **PASS** | Welcome dialog open + `#app.modal-open`: computed `pointer-events` = `auto, auto, auto` (not `none`), `elementFromPoint` on `#btnMin` = `btnMin`; real click minimized `#app` (class `minimized`), taskbar click restored it; real click on `#btnClose` opened `#dlgQuit.show`. Repeated with the Draft dialog open (pointer-events `auto`; real minimize click worked). Both viewports |

## Supporting measurements

### Smoke run (authoritative)

```
pass:true, 197/197, exit 0, elapsed 34.74 s, consoleErrors: []
full FX : frames 185, avgMs 16.67, medianMs 16.7, fps 60.0, p95Ms 16.9, maxMs 17.5,
          longFrames 0, clears 185, pools at caps (520/140/18/22)
light FX: frames 185, avgMs 16.67, medianMs 16.7, fps 60.0, p95Ms 16.8, maxMs 17.4,
          longFrames 0
```

### Independent `qa-juice.mjs` results (both viewports, no page/console errors)

| Check | 1280×800 | 1920×1080 |
| --- | --- | --- |
| Background changed over 560 ms | 90.6% pixels, meanAbs 81.9 | 99.95% pixels, meanAbs 149.0 |
| Background saturation / hue families | 80.7% / 10 | 69.7% / 5 |
| Full-board perf (full FX) | 180 frames, avg 16.66 ms (60.0 fps), p95 17.0 ms, max 18.1 ms, 0 long frames | 180 frames, avg 16.66 ms (60.0 fps), p95 16.9 ms, max 17.6 ms, 0 long frames |
| Light-mode backdrop change | 0.25% (vs 82.6% full) | 0.25% (vs 82.7% full) |
| Trail pixel isolation | 5 706 vs 677 control (8.4×) | 6 383 vs 789 control (8.1×) |
| Ambient glitch bursts / 8 s | 4 (max 0.75) | 5 (max 0.75) |
| Audio probe on 2 letters | +5 oscillators, +2 buffers, ctx running | same |
| Page/console errors | none | none |

## Bugs and risks

* **R1 (spec gap, real FAIL): a single correct letter does not trigger `state.glitch`.**
  Measured `glitch = 0` after the first correct letter at both viewports (`keyStreak = 1`,
  `combo = 0`). Code path: `keyBurst()` sets `glitch` only when
  `hype > 0.45`, where `hype = keyStreak/13 + combo/24 + urgent·0.3`; a fresh first letter
  gives ≈0.077. The first key-triggered glitch appears at `keyStreak = 6` (measured), or
  earlier when combo/urgency is high. The rest of the per-letter burst (particles, streaks,
  rings, punch, flash, shake) does fire on the first letter. QA brief's acceptance line
  "after typing one correct letter ... `state.glitch` must be > 0" is therefore not met.
  User-visible impact is minor (glitch still arrives during a streak), but it is reported as
  a failure, not waived.
* **R2 (documentation drift, minor):** `README.md:350` documents
  `fxState() -> {quality, particles, shards, rings, popups, milestone, danger, cssCombos}`
  but the shipped hook also exposes `streaks`. `README.md:244` (Presentation notes) still
  says the plasma tunnel has **16 frames** while `game.js:248` `PLASMA_FRAMES = 24` and the
  v1.4 section (README:22) says 24-frame. Docs only; no runtime impact.
* **R3 (brief drift, not a defect):** the QA brief expected `playKey()` to call
  `playClick(0.85)`; the frozen code calls `playClick(0.5)` (`game.js:3368`). The click layer
  is still new and routes through the master chain; loudness is still ≈6.5–8.1× the v1.3
  square tone. Noted so the acceptance text and code are not silently assumed equal.
* **R4 (measurement note):** the smoke p95 frame-time gate is sensitive to concurrent machine
  load (see smoke history). On a quiet machine the final run holds 60 fps with p95 16.9 ms and
  zero long frames at both viewports, so this is environment sensitivity, not a shippable
  regression.
* **Non-issue checked:** the new `modal-open` CSS no longer disables title buttons, and since
  `.modal-layer` lives inside `.client` (below the title bar), real clicks are not intercepted
  by the modal backdrop. Verified with `elementFromPoint` + real clicks, Welcome and Draft.
* **Audio limitation:** sound was verified by code inspection plus an instrumented
  AudioContext run-time probe (graph nodes/edges and no page errors). This is **not** an
  audible verification — QA could not hear the output.

## Screenshots (all in `shots/`, produced by this QA pass)

| File | Shows |
| --- | --- |
| `qa-bg-1280x800.png`, `qa-bg-1920x1080.png` | full app, trippy animated playfield + Win95 shell |
| `qa-playfield-1280x800.png`, `qa-playfield-1920x1080.png` | playfield-only crop of the new backdrop |
| `qa-typing-1280x800.png`, `qa-typing-1920x1080.png` | frame right after a 7-key streak (detonations, trails, glitch) |
| `qa-trails-1280x800.png`, `qa-trails-1920x1080.png` | comet trails above 5–6 falling words |
| `qa-light-1280x800.png`, `qa-light-1920x1080.png` | Effects: Light — static dim backdrop, rainbow layer off, paused dialog |
| `qa-perf-1280x800.png`, `qa-perf-1920x1080.png` | full-board effects during the frame-time run |
| `qa-final-1280x800.png`, `qa-final-1920x1080.png` | clean play state at the end of each viewport run |
| `qa-old-ref-1280x800.png`, `qa-old-ref-1920x1080.png` | git-HEAD v1.3 reference (dark navy sky + skyline) for the background comparison |

`node tools/smoke.mjs` also rewrote the normal `shots/01-…13-*.png` set, as documented.

---

## Lead addendum (post-QA, 2026-10-21 22:36 +08:00)

QA's R1 finding (a single correct letter left state.glitch at 0) was fixed after the QA run:
keyBurst() now always raises the glitch floor ( .07 + hype * 0.22) instead of gating it
behind hype > 0.45. The R2 documentation drifts were fixed too: the Debug hook docs now
list xState().streaks, and the Presentation notes say 24 plasma frames (matching
PLASMA_FRAMES = 24). R3 (playClick(0.5) vs the brief's 0.85) is intentionally unchanged -
0.5 through the 1.25 master gain is the tuned level.

Re-verified by the Lead on the post-fix build (game.js changed; style.css/index.html/README
changed after QA; nothing else):

- `node --check game.js` - OK.
- One correct letter now reports glitch 0.153, keyPunch 0.470, keyFlash 0.150, particles 7,
  streaks 5, rings 1 (> 0), and word trails reach 8-10 samples after 0.4-0.5 s.
- `node tools/smoke.mjs` (clean run, nothing else running) - **PASS, 197/197,
  consoleErrors 0**; full FX avg 16.67 ms / 60 fps / p95 16.9 ms / **0 long frames**; light
  FX identical. This re-confirms the R4 load-sensitivity note: the perf gate passes cleanly.
- `powershell -File win\build.ps1 -Smoke` - native **v1.4.0** published to
  `dist\Wordfall-win64` and `Wordfall.exe --smoke` **PASSED** (ok:true, embeddedMode:true,
  version M7, 2265 ms). The shipped native build now contains the v1.4 juice pass.
- `node tools/bot.mjs` was not re-run: the only post-QA game.js change is inside
  `keyBurst()`, which is a no-op while `state.simulating`, so rules/scoring are untouched
  (QA's 5/5 bot run remains valid).

Post-fix frozen hashes (SHA-256, first 12): game.js `5D2E177722A6`, style.css
`660472BC3E11`, index.html `35B299819793`, README.md `1A5694646AB1`,
tools/smoke.mjs `978B0273AB87`, tools/bot.mjs `9AE7EC247BB6`, win/Wordfall.csproj
`0890061F1C55`.

---

## Lead addendum 2 (v1.4 final look, 2026-10-21 22:52 +08:00)

After the user played the v1.4 build, two direct requests changed the playfield rendering again:

1. Remove the distorted-colour animation (plasma tunnel, vortex, motes, neon equaliser,
   rolling rainbow overlay, glitch tears) and replace it with a heavy blur that covers the
   whole playfield, words included, over a dark backdrop with subtle drifting colour.
2. Reduce the lag.

Implementation: the entire playfield is now drawn into an offscreen scene at **40% of the
display resolution** and upscaled with smoothed bilinear filtering. That single change is
both the heavy blur (everything, words included, shares it) and the optimisation: the
canvas paints ~16% of the pixels it used to, and the plasma pre-render, rainbow CSS layer,
vortex/mote/equaliser passes and glitch overlay are deleted. The backdrop is a near-black
field with six huge, very dim, slowly drifting colour discs. The Win95 chrome, dialogs and
status bar are DOM and stay crisp above the blurred canvas.

Re-verified by the Lead on the final build:

- `node --check game.js` - OK.
- `node tools/smoke.mjs` (clean) - **PASS, 197/197, consoleErrors 0**; full FX avg 16.76 ms
  / 59.7 fps / p95 16.9 ms / 1 long frame (within the 10% budget); light FX avg 16.67 ms /
  60 fps / p95 16.9 ms / 0 long frames.
- `node tools/bot.mjs` was not re-run: the change is rendering-only and does not touch
  the seeded gameplay path (QA's 5/5 bot result still applies).
- Native app rebuilt with `win\build.ps1 -Smoke` and reinstalled to the desktop copy;
  `Wordfall.exe --smoke` **PASSED**.

Note for readers of the earlier sections: the "trippy plasma background", "rolling rainbow
interference" and "glitch" findings above describe the intermediate v1.4 build that QA
tested. They were intentionally replaced by the soft-focus renderer described here.

Final frozen hashes for the soft-focus build (SHA-256, first 12): game.js `B12B7CF4F178`,
style.css `BC3BD676FBCE`, index.html `3BC624752B30`, README.md `275DDE39E546`.
Desktop install refreshed from this build (`8E5307BBCD509FAD` exe / `ED3C0BDEF42EB7DA`
Wordfall.dll, matching `dist`); installed `Wordfall.exe --smoke` still shows the
embedded v1.4 game source (SCENE_SCALE/drawBackdrop present, PLASMA_FRAMES absent).

---

## Lead addendum 3 (flare words, 2026-10-21 23:00 +08:00)

User follow-up: "maybe have some occasional fast moving short word that doesn't consume
live so it feels more lively." Implemented as **flare words**:

- Every 13-25 s (`CFG.flareMinGap`/`CFG.flareMaxGap`) one short 3-5 letter word spawns
  at the top with `flare = true` and `harmless = true`. It falls at
  `CFG.flareSpeedMult = 2.5x` speed, ignores `maxWords`, tries to pick an unoccupied
  lane, and is typeable/scorable like any other word (counts as a normal clear and wave
  progress).
- If it reaches the line it is removed with a cyan "FLARE MISSED" cue and a descending
  blip: **no Life lost, combo kept**. Clearing one adds a cyan ring/streak burst and a
  "FLARE!" popup plus a bright chime.
- Visuals: cyan colour, chevrons + pulsing bracket + dotted underline, a bright comet
  trail and a "FLARE INCOMING" callout so it reads as an event through the blur.
- Sound: rising incoming whistle, double chime on hit, soft descending blip on miss.
- Debug hook: `window.__wordfall.spawnFlare()`.

Balance (`node tools/bot.mjs --seeds 100`): **PASS 5/5** - 60 WPM random Dawn **35.0%**
(target 30-50%), 80 WPM random Dawn 99.0% (target >70%), 60 WPM skip dies 100% median wave
7 (target 5-7), 40 WPM cells 0%. Flares stay inside the existing SPEC acceptance bands.

Regression (`node tools/smoke.mjs`, clean): **PASS 197/197**, consoleErrors 0; full FX
avg 16.67 ms / 60 fps / p95 17.0 ms / 0 long frames. Native `win\build.ps1 -Smoke` passed
and the desktop install was refreshed (exe/dll match `dist`; embedded source contains
`spawnFlare` and `FLARE INCOMING`).

Final hashes: game.js 988B33BCF0A6; style.css BC3BD676FBCE; index.html 3BC624752B30; README.md 60282322ED27.
