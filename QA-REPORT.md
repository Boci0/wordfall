# QA-REPORT.md - independent acceptance review (Wordfall, Win95 presentation + native build)

Reviewer: `qa2` (independent verifier - not the author of `game.js`, `style.css`, `index.html`,
`words.js`, `tools/` or `win/`).
Date: 2026-10-21. Final status: **PASS - no open defects** on the build pinned below.

This review covers the Windows 95 presentation overhaul, the fall-speed retune requested by
the user, and the native Windows build. The earlier M2-M5 sign-off (`qa`) is not assumed;
the reported numbers below are my own fresh runs on the final build.

## Build under test (final, pinned)

| File | Size | mtime | Hash |
| --- | --- | --- | --- |
| `game.js` | **66,224 B** | **2026-10-21 17:03:32** | MD5 **`463B7FCE93DEAEDFAE8E08EC42A2E032`** |
| `style.css` | **18,215 B** | **2026-10-21 17:03:24** | MD5 **`7D477C99773E4FCF592AFFD2C154E89B`** |
| `index.html` | 17,850 B | 2026-10-21 16:36:38 | MD5 `8874078F0344E6A000A6BBA6DB88938C` |
| `words.js` | 4,982 B | 2026-10-21 15:54:55 | MD5 `CFE5D0F630AA2610844A0406D93E9736` |
| `tools/smoke.mjs` | 55,103 B | 2026-10-21 16:01:07 | MD5 `63FA7EA30DCF739C902C3F9AD5A65838` |
| `tools/bot.mjs` | 16,429 B | 2026-10-21 16:07:52 | MD5 `6F8D9599FAC9F9D04AA59387119CBFDD` |
| `dist/Wordfall-win64/Wordfall.exe` | 166,400 B | 2026-10-21 17:07:55 | SHA-256 `F296189F0DB2ECB9CAFFE2C633ED458771439B4F8999FB8E2E0018309800D3EB` |
| `dist/Wordfall-win64/Wordfall.dll` | 152,576 B | 2026-10-21 17:07:55 | SHA-256 `42056A09A80C561DBA854E71E3F61D17BA772CCC6715A73EB0BB9FB4506A0AE1` |

The four web assets and `tools/` were re-hashed after the last test run and did not change.
All numbers below are from this build; probes ran after the final file timestamps.

### Moving-target note

QA started on the pre-retune build (`game.js` `0CDEC34A…`, `style.css` `6F845D2E…`, native exe
16:53). The user then asked for faster falling words, and the Lead retuned `CFG` + `maxWords`
and fixed three presentation defects I had reported (taskbar raised bevel, Alt menu
accelerators, inert modal frame). This report is entirely re-run on the retuned build; the
earlier-build probes are cited only where explicitly marked interim.

## Verdict

**PASS.** Every M2-M5 acceptance target holds on the retuned build; the Windows 95
presentation reads as a genuine period application at 1024×768, 1280×800, 1920×1080 and in
the native embedded mode; the native exe passes its own headless smoke test and embeds the
exact final web files. **Blocker: none. Major: none. Minor open: none.** The three defects
reported during the interim pass are fixed and re-verified (§7.1). Remaining items in §7.2
are stylistic observations, not defects.

## 1. What I ran (exact final-build results)

| Command / probe | Exit | Result |
| --- | --- | --- |
| `node tools/smoke.mjs` | **0** | **82/82 checks PASS**, 0 failed, 0 console/page errors, **14.06 s** |
| `node tools/bot.mjs --seeds 100` | **0** | **5/5 assertions PASS**; 60/skip dies 100%, median **6**, mean 6.23, `{6:78, 7:21, 8:1}`; 60/random Dawn **33.0%** (33/100); 80/random **100%**; 2.0 s |
| `node tools/bot.mjs --seeds 400` | **0** | **5/5 assertions PASS**; 60/skip dies 400/400, median **6**, mean 6.24, `{5:4, 6:299, 7:93, 8:4}`; 60/random **34.8%** (139/400); 80/random **100%** (400/400); 3.7 s |
| my mechanics probe (`qa2 mech`) | 0 | **19/19 checks PASS** |
| my resolution-independence probe (`qa2 res`) | 0 | **PASS** - identical sims and identical 100-seed sweeps at 1024×768 / 1920×1080 / embedded |
| my final UI probe (`qa2 ui-final`) | 0 | **40/40 checks PASS**, 0 console/page errors (fixes + core flows) |
| my real-keyboard probe (`qa2 realkeys`) | 0 | **5/5 PASS** - 22+ human-pace keypresses, 10 clears typed on the real keyboard open the draft, key 2 picks, 0 console/page errors |
| my FPS probe (12 forced words + 4 echoes) | 0 | **60.1-60.4 avg fps**, 0 frames > 25 ms, 0 long tasks, 4 viewport/embed cells |
| my retune probe | 0 | fall crossing **14.57 s** start / **7.98 s** at max pressure (from y=0), queue cap **6**, `spawnMin` 1.25 s |
| native `Wordfall.exe --selftest` (temp copy) | **0** | `ok:true`; embedded assets byte-identical to the four web files; WebView2 runtime **155.0.4283.62** |
| native `Wordfall.exe --smoke` (temp copy) | **0** | `ok:true`, `version:"M5"`, `embeddedMode:true`, `hasWebViewBridge:true`, seeded sim identical to browser |

The 100/400-seed bot cells reproduce exactly the Lead's stated retune expectations
(34.8% and the `{5:4,6:299,7:93,8:4}` distribution at 400 seeds; 33% and 100% at the default
100-seed run), so the retune did not trade away the M5 targets.

## 2. SPEC §7 acceptance criteria

| Milestone | Criterion (abridged) | Result | Evidence |
| --- | --- | --- | --- |
| **M2** | 10 clears → draft; pick resumes with combo kept; pressure +4; Heat changes score; Skip/Reroll/1-2-3/R/S | **PASS** | smoke M2 block all green; my probe: combo 7 kept through pick, `pressure = cleared + 4·drafts` at 11, skip +4 pressure / +50·wave points, reroll once, keys 1/2/3 pick |
| **M3** | 12 cards; Shield; Lock-on; eligibility; tier II | **PASS** | smoke verifies every card/tier; my probe re-derived 300 seeded offers (slot 1 Boon 300/300, slot 3 Hex/Gambit 300/300, no duplicates, tier I) and **800 constrained-state offers with 0 illegal cards**; lock-on/shield verified independently |
| **M4** | hit-pause, particles, combo pitch, near-miss shake, danger audio, card rise; 60 fps with 12 words + Ghost echoes | **PASS** (audible audio still UNVERIFIED) | smoke M4 checks; my FPS run: **60.1-60.4 avg fps**, max frame 17.4-19.2 ms, 0 frames > 25 ms, 0 long tasks with 11-12 forced words + 4 echoes + DOM HUD updating every frame (see §8) |
| **M5** | 400+ words; 60 no cards dies wave 5-7; 60 random Dawn 30-50%; 80 random > 70% | **PASS (retuned)** | 60/skip dies **100%**, median **6** (inside 5-7); 60/random **33.0% / 34.8%**; 80/random **100% / 100%** at 100/400 seeds |

## 3. Measured M5 numbers (final build)

| Cell | 100 seeds (base 1000) | 400 seeds (block 1000-1399) | SPEC target | Result |
| --- | --- | --- | --- | --- |
| 60 WPM no cards (`skip`) | dies 100%, median **6**, mean 6.23, `{6:78, 7:21, 8:1}` | dies 400/400, median **6**, mean 6.24, `{5:4, 6:299, 7:93, 8:4}` | dies at wave 5-7 | **PASS** |
| 60 WPM random picks | Dawn **33.0%** (33/100), median wave 7 | Dawn **34.8%** (139/400), median wave 7 | Dawn 30-50% | **PASS** |
| 80 WPM random picks | Dawn **100%** (100/100) | Dawn **100%** (400/400) | > 70% | **PASS** |
| 40 WPM (informational) | skip dies 100% median 4; random dies 100% median 4 | same | not asserted | informational |

### 3.1 Retune verification (user: "the words fall too slow")

`CFG`: `baseSpeed 52`, `speedPerClear 0.662`, `maxSpeed 95`, `spawnMin 1.25`, `spawnDecay 0.05`,
`maxWords 6` (was 22 / 0.354 / 45 / 1.05 / 0.055 / 12). Measured independently in-page:

- fall speed at pressure 0 = **46.2 logical px/s** (52 × 800/900); at the cap = **≈84.5 px/s**.
- a word placed at y=0 reaches the danger line in **14.57 s** at pressure 0 and **7.98 s** at the
  speed cap; from the real spawn point above the viewport that is ≈15.5 s / ≈8.5 s.
  The pre-retune build measured ≈36.6 s / ≈17.9 s on the same path - so fall crossing is now
  roughly **2× faster**, matching the requested change.
- `spawn()` queue cap measured at **6** words; spawn interval 2.8 s at pressure 0, reaching the
  1.25 s minimum at pressure 31. The retune is therefore not just a speed multiplier: the
  spawn/queue curve was retuned with it, and the M5 cells above still pass.

## 4. Mechanics regression (independent of the developer tools)

The UI overhaul / retune did not change the rules. My own probe (19 checks, all PASS)
independently recomputed the spec:

- **Scoring**: `round(letters × (10 + Ledger) × comboMult × heatMult × Greed × Longshot)`  - 
  base 5-letter clear 50; stacked case (7 letters, combo 20 → ×2.0, Ledger, 2 Heat → ×1.5,
  Greed II ×1.6) = **403** = predicted 403.
- **Pressure**: `cleared + 4 × draftsTaken` → 11 after 3 clears + 2 drafts.
- **Combo through draft**: combo 7 kept across `beginDraft()` + pick, phase resumes `playing`.
- **Shield**: consumes one shield, combo kept, `flash === 0`; without a shield the same wrong key
  resets combo and flashes.
- **Lock-on**: with Wide Scope, first correct letter locks the lowest of two matching words and
  holds; a letter matching the other word is a mistake, not a re-target.
- **Word-length ramp**: `wordRange()` matched an independent reimplementation of
  `CFG.wordRangeSteps` at 16 pressure points including every boundary.
- **Draft composition**: 300 seeded offers - slot 1 always Boon, slot 3 always Hex/Gambit, no
  duplicate card, fresh offers tier I.
- **Eligibility**: 800 offers across 4 constrained states (3 lives, shieldMax 3, all four Hexes,
  maxed cards) - **0** illegal offers.
- **Overclock**: 5th manual clear auto-clears one extra word (cleared 5→6) while `waveCleared`
  only counts the manual clear; the 10th manual clear ends the wave and the auto-clear still
  scores.
- **Decoy**: fake fall ratio measured **4.5×** a real word.
- **Sim contract**: same seed → identical result, different seed → different; `simulating`
  returns to `false`.
- **Retune side-check**: `spawn()` never exceeds 6 queued words.

The developer `smoke.mjs` (82/82) independently covers the same ground card-by-card and
screenshot-checks the M4 screenshot; I trust it as corroboration, not as the only evidence.

## 5. Resolution independence (fixed 800-unit logical playfield)

Rules run in a fixed **800-unit-tall** logical playfield (`state.groundY` is always **704**),
uniformly scaled to the client; only the logical *width* changes with the window. Verified:

| Viewport | client (canvas) | scale | logical W × H | word font |
| --- | --- | --- | --- | --- |
| 1024×768 | 814×578 | 0.723 | 1127 × 800 | 17.3 CSS px |
| 1280×800 | 1070×610 | 0.763 | 1403 × 800 | 18.3 CSS px |
| 1920×1080 | 1090×674 | 0.843 | 1294 × 800 | 20.2 CSS px |
| 1920×1080 embedded | 1912×984 | 1.230 | 1554 × 800 | 29.5 CSS px |

**Evidence:** for seeds 1000-1011, `__wordfall.sim({wpm:60, mode:'random'|'skip', seed})`
returned **byte-identical JSON** at 1024×768, 1920×1080 and the embedded 1920×1080 viewport.
The in-page 100-seed sweeps were also identical at 1024×768 and 1920×1080:
60/skip Dawn 0% median 6; 60/random 33% median 7; 80/random 100% median 12.
So difficulty does **not** depend on window size. Word size stays readable at the smallest
size (17.3 CSS px glyphs in a bold Lucida Console face), clicking a word in the playfield
does not type it (typing-game only), and every dialog fits the client area without internal
scrolling at 1024×768, 1280×800 and 1920×1080 (§7, §9).

## 6. UI behaviour checklist (final build)

| Area | Checks | Result |
| --- | --- | --- |
| Welcome dialog | shown on load; Start and Enter start a run; Start/Enter hide it; best score shown | **PASS** |
| Controls / About | open from View/Help/toolbar/Start/welcome/Readme icon; close with Escape, OK and backdrop; game pauses (`phase:'paused'`, status “Paused”) and resumes; words fall again after close | **PASS** |
| Draft dialog | 3 cards; click, keys 1/2/3 pick; R rerolls once (button → “Reroll (used)”, disabled, second R no-op); S skips (+50×wave, pressure +4); auto-opens after exactly 10 clears; 12-card “Held:” line fits at 1024×768; status bar and buttons update | **PASS** |
| Menus | File/Game/View/Help open; New Run, Restart Run, Skip Draft, Sound toggle, Maximize/Restore, Controls, About, Exit all run; disabled states when not applicable; click-outside closes; hovering another menu switches; **Alt+F/G/V/H now open the matching menu** | **PASS** |
| Modal frame (new) | while any dialog is open the window frame is inert and greyed (`modal-open`; menus/toolbar `pointer-events:none`, menu labels grey); mouse and Alt accelerators do nothing; closing restores the frame; in-dialog Reroll/Skip buttons still work | **PASS** |
| Title bar - minimize | hides the window, pauses the game; taskbar button visible and now **raised** (top-left light bevel); taskbar button restores the window and resumes; button returns to the pressed bevel | **PASS** |
| Title bar - maximize | toggles; maximised fills 100vw × (100vh−30); View menu label switches Maximize/Restore; double-click title bar toggles | **PASS** |
| Title bar - close | opens the quit confirmation; No keeps the app open; Yes hides the app and its taskbar button; desktop icon double-click/Start menu item restores | **PASS** |
| Title bar - drag | browser mode drags the window by the title bar (clamped to the viewport) | **PASS** |
| Taskbar / Start / desktop | Start menu opens with the vertical banner and 4 items (Wordfall, Controls…, About…, Shut Down…); items run; clock renders 12-hour time; two desktop icons select/double-click; Readme opens Controls | **PASS** |
| Game/overlays | gameover dialog (score, stats, cards, Retry, Quit→quit confirm); Dawn dialog (score, stats, cards, Keep Playing → endless wave 13, New Run → wave 1 / score 0); title and taskbar text follow phase | **PASS** |
| Keyboard play | final-build real-key probe: 22+ real keypresses at ~110 ms human pace cleared words; 10 clears typed on the real keyboard opened the draft; key 2 picked a card and resumed; no console/page errors | **PASS** |
| Runtime errors | 0 console/page errors across the whole final UI pass and all viewport runs | **PASS** |

The interim build had a 109/110 full-sweep result; its only failure was the taskbar raised
bevel (now fixed). The final-build probe re-verifies every changed behaviour plus the core
flows (40/40).

## 7. Presentation / authenticity

### 7.1 Win95 details - PASS

Verified by screenshot inspection (crops at 2-4× nearest-neighbour) and computed styles:

| Detail | Observation | Result |
| --- | --- | --- |
| Palette | face `#c0c0c0`, light `#dfdfdf`, shadow `#808080`, dark `#000000`, navy `#000080`, desktop teal `#008080`; 16-colour canvas | **PASS** |
| Bevels | 2 px inset bevels on buttons, title buttons, toolbar buttons, sunken input/status/toolbar fields, raised minimised task button | **PASS** |
| Title bar | 18 px navy bar, 16×16 pixel icon, bold 11 px white title, three 16×14 bevel buttons at the top right (minimise underscore / maximise square / close X) | **PASS** |
| Menu bar | File/Game/View/Help with underlined access keys; open label inverts to navy/white; dropdown grey with 2 px border, hard 3 px shadow, separators, shortcut column; disabled items grey with white emboss. Access keys now actually work | **PASS** |
| Toolbar | 28 px strip with beveled 23×21 icon buttons, separator, and a full-width sunken “deck” field with ellipsis | **PASS** |
| Status bar | 21 px strip of sunken panels: grow panel (phase/status) then Score / Wave / Lives / Shields / Heat / Pressure; no clipping even at score 9,876,543 | **PASS** |
| Client | 16-colour canvas: ordered-dither sky, 1 px stars, dark skyline with 2×2 warm/cool windows, Lucida Console words, dotted target bracket + caret, dotted red DANGER line, square particles | **PASS** |
| Taskbar | 30 px grey bar; Start button with the 4-colour flag; divider; pressed task button with icon + truncated title; sunken clock panel | **PASS** |
| Start menu | vertical navy “Wordfall 95” banner reading bottom-to-top, grey body, item icons, hover inversion, separators, “Shut Down…” | **PASS** |
| Dialogs | grey bodies, navy title bars, default button with 1 px outline, no rounded corners; welcome/draft/gameover/dawn/controls/about/quit all consistent | **PASS** |
| Typography | `Microsoft Sans Serif, Tahoma` 11 px for chrome; bold 24 logical-px Lucida Console for words; all three fonts resolve on this machine | **PASS** |
| Period discipline | static check of final `style.css`: **0** `border-radius`, **0** gradient rules, **0** blur/filter, **0** transitions, **0** emoji in the UI; only hard 0-blur shadows | **PASS** |
| Embedded (native) mode | `body.embedded` hides desktop icons + taskbar, app fills the viewport with no outer border, title/menu/toolbar/status chrome still present and the three title buttons remain at the top right | **PASS** |

### 7.2 Remaining modern/authenticity observations (cosmetic, not defects)

1. **Modal backdrop dims the playfield 30 %** (`rgba(0,0,0,.3)`). Windows 95 did not dim behind
   a modal dialog; this is a modern affordance kept for legibility. Visually restrained.
2. **Only menu labels grey out while a dialog is open** - the toolbar icons and the title-bar
   buttons keep their enabled look (the toolbar is pointer-inert, but the title-bar buttons are
   still clickable). Win95 would grey/disable the whole frame. Cosmetic inconsistency.
3. **Hard drop shadows** on dropdowns/dialogs (0 blur, 3-5 px offset) - win95 itself had no
   shadows; these are hard-edged and read as period-adjacent rather than modern.
4. **Start flag** is four solid squares rather than the wavy Win95 flag; still clearly
   period-coded.
5. Title/task text uses an em dash (“Wordfall - Untitled”); Win95-era captions usually used a
   hyphen. Cosmetic.
6. With `maxWords: 6` the M4 “12 words + echoes” condition is not reachable through normal
   spawning; it is still verified synthetically (11-12 forced words + 4 echoes at 60 fps).

### 7.3 Visual QA screenshots

Inspected with the image tool at 1024×768, 1280×800 and 1920×1080, plus embedded mode; final
build re-captured at 1280×800 (menu/welcome, playing, draft). Findings: no clipping or overlap
at any size; window/dialog metrics sane; menu bar greyed correctly behind the draft dialog;
draft cards fit; status panels never clip; word font 17.3-29.5 CSS px depending on scale;
no mojibake, no broken bevels, no modern UI artefacts. The Tunnel card correctly renders
hidden letters as dots in the playfield (intentional card effect, not a rendering fault).

## 8. Performance

Final build, headless Chrome (vsync 60 Hz), 11-12 forced words + 4 Ghost echoes, DOM HUD
updating every frame:

| Cell | avg fps | min fps | max frame | frames > 25 ms | long tasks > 50 ms |
| --- | --- | --- | --- | --- | --- |
| 1280×800 | 60.3 | 56.8 | 17.6 ms | 0 | 0 |
| 1920×1080 | 60.4 | 56.5 | 17.7 ms | 0 | 0 |
| 1024×768 | 60.2 | 52.1 | 19.2 ms | 0 | 0 |
| 1024×768 embedded | 60.1 | 57.5 | 17.4 ms | 0 | 0 |

One 52.1 fps frame at 1024×768 was a single scheduler hitch (max frame still 19.2 ms); no
frame exceeded 25 ms and no long task was recorded. The DOM updates (status bar score/wave/
lives/shields/heat/pressure, title/taskbar text, toolbar deck list) do not tank frames; the
live-update path was also re-verified functionally after the retune.

## 9. Native Windows app

**Published output:** `dist\Wordfall-win64\` contains `Wordfall.exe` (apphost), `Wordfall.dll`,
deps/runtimeconfig, three WebView2 managed assemblies and `WebView2Loader.dll`
(folder publish, **not** single-file).

Verified on the final exe (SHA-256 `F296189F…`, `Wordfall.dll` `42056A09…`, 17:07:55):

| Item | Result |
| --- | --- |
| `--selftest` (no WebView2) | **PASS, exit 0**: the four embedded resources exist and are byte-identical to the final web files (`index.html` 17,850 B, `style.css` 18,215 B, `words.js` 4,982 B, `game.js` 66,224 B); WebView2 runtime **155.0.4283.62** detected |
| `--smoke` from a temp copy of the published folder | **PASS, exit 0**, `smoke-result.json`: `ok:true`, `version:"M5"`, `phase:"gameover"`, `embeddedMode:true`, `hasWebViewBridge:true`, `titleText:"Wordfall - Untitled"`, `browserVersion:"155.0.4283.62"`, `profileFallback:false`, 2.26 s |
| Sim inside the native shell | seeded `sim({wpm:60, mode:'skip', seed:1000})` = cleared **60**, wave **7**, score **7,758**, pressure **84** - identical to the browser sim for the same seed, so the embedded files are the real ones and the JS runs normally in WebView2 |
| `--smoke` launched in place from `wordfall\dist` | **fails in this agent sandbox** with `0x800700AA … after retrying with a clean one`, and the result file cannot be written to `%TEMP%` either. The sandbox denies file creation to executables launched from the workspace path, so WebView2 cannot create its profile. Copying the identical published folder to `%TEMP%` passes. `win/build.ps1 -Smoke` implements exactly this fallback; it is an environment limitation, not an app defect |
| Framework-dependent | `<SelfContained>false</SelfContained>`; `Wordfall.runtimeconfig.json` requires `Microsoft.NETCore.App 10.0.0` + `Microsoft.WindowsDesktop.App 10.0.0`; this machine has .NET **10.0.10** + WindowsDesktop 10.0.x, and WebView2 155 |
| Embedding | `win/Wordfall.csproj` embeds `..\index.html`, `..\style.css`, `..\words.js`, `..\game.js` as manifest resources (explicit relative includes, so a rebuild always picks up the current files); `WebAssets.cs` serves them from memory; selftest byte sizes prove the final exe is current |
| In-memory origin / localStorage | `CoreWebView2.AddWebResourceRequestedFilter("https://wordfall.local/*")` + `WebResourceRequested` serve the four files with correct content types, 404 otherwise; `%LOCALAPPDATA%\Wordfall\WebView2\EBWebView\Default\Local Storage\leveldb` exists, and the native welcome dialog showed a **best score persisted from an earlier native session** (3,732), so `localStorage` works across restarts |
| Frameless chrome | `FormBorderStyle = None`, `ClientSize 1200×760`, centred; the page draws the entire Win95 frame. Startup hardening: 3 attempts (delayed retry on the configured profile, stale-lock cleanup, then a fresh unique fallback profile) before showing the 0x800700AA error; `profileFallback` is reported in smoke JSON |
| Title-bar protocol (code review) | page posts strings via `window.chrome.webview.postMessage`: `drag` → `ReleaseCapture()` + `WM_NCLBUTTONDOWN/HTCAPTION`; `min` → `WindowState = Minimized`; `max` → toggle with `MaximizedBounds = WorkingArea`, then host posts back JSON `{"type":"maximized","value":…}`; `close` → `Close()` |
| WebView2 hygiene | context menus, DevTools, browser accelerators, zoom control, status bar, built-in error page disabled; popups suppressed; single-instance mutex (non-smoke) activates the existing window |

**Interactive native verification (previous native build, same title-bar protocol code; done
before the user asked us not to open visible windows):** I launched the published exe from a
temp copy and captured the real window: borderless client exactly **1200×760** (no OS title
bar), page chrome across the whole window, three bevel buttons at the top right. Clicking the
page's title-bar buttons drove the OS window: **Maximize** → `0,0 1920×1032` (working area,
not covering the taskbar), **Restore** → `1200×760`, **Minimize** → process minimised, **drag**
→ window moved (+96,+48), **Close** → process exited **0**; no stray process left. The final
exe was rebuilt after that pass (startup-hardening only), and per instruction I verified it
headless (`--selftest`, `--smoke`) rather than re-driving visible windows. Fresh native
screenshots also exist in `win/shots/` (`wordfall-draft.png`, `wordfall-gameplay.png`,
`wordfall-launch-dialog.png`, `wordfall-maximized.png`).

## 10. Defects

### 10.1 Resolved during this review (all re-verified on the final build)

| # | Severity | Defect | Fix / evidence |
| --- | --- | --- | --- |
| 1 | Minor | `.task-btn.raised` class was applied by JS on minimize but had no CSS rule, so the taskbar button kept its pressed bevel (no visual cue the window was minimised) | `style.css` now has `.task-btn.raised` with the light-top/left bevel; verified computed box-shadow changes both ways: pressed `inset 0 0 dark, inset -1 -1 white, inset 2 2 shadow, inset -2 -2 light` → raised `inset -1 -1 dark, inset 1 1 white, inset -2 -2 shadow, inset 2 2 light`; restore returns to pressed |
| 2 | Minor | Menu accelerator underlines were decorative - Alt+F/G/V/H did nothing | `game.js` keydown handles `altKey` and opens the matching menu when no modal is open; verified all four open and Escape closes |
| 3 | Minor | A modal dialog did not disable the window frame: File/Game/View/Help and the toolbar stayed clickable behind Controls/About/Quit/draft/welcome | `showDialog()`/`hideDialogs()` add/remove `.app.modal-open`; CSS makes menu bar and toolbar `pointer-events:none` and greys menu labels; verified real mouse clicks and Alt accelerators are blocked, in-dialog buttons still work, closing restores the frame |

### 10.2 Open defects

**None.**

## 11. Edge cases (final build)

| Case | Result |
| --- | --- |
| Space / Backspace ignored | PASS (smoke) |
| Uppercase letters accepted | PASS (smoke, real Shift typing) |
| Digits/symbols while playing ignored | PASS |
| Letters/Enter during draft inert; 1/2/3/R/S handled | PASS |
| Reroll once per run; second R no-op | PASS |
| Skip pays 50×wave, still +4 pressure, still counts as a draft | PASS |
| Resize mid-run (1280×800 → 900×600 and back) | PASS - `groundY` stays 704, words kept, no error |
| localStorage best through reload / native restart | PASS |
| Fake reaches the line | PASS - harmless |
| All four Hexes / maxed cards / all-Boons state | PASS - eligibility 0 violations; 3 cards still shown via documented fallback |
| Extreme HUD values (score 9,876,543, 12/12 wave, 3/3 shields, heat 6) | PASS - no panel hard-overflow at 1024/1280/1920 |
| 12-card “Held:” line in draft at 1024×768 | PASS - fits; description grid fits with no dialog scrolling |
| 22+ real human-pace keypresses, 10 clears, key pick | PASS, no console/page errors |

## 12. Screenshot index

All under `%TEMP%\qa2-shots\` (final build unless noted):

| File | Shows |
| --- | --- |
| `final-1280-01-play.png` | final build, 1280×800 playing (Tunnel effect, HUD, skyline, droid status bar) |
| `final-1280-02-draft.png` | final build draft dialog with greyed inert menu bar behind it |
| `final-1280-04-welcome.png` | final build welcome dialog over the greyed frame |
| `1280x800-01-menu.png` … `07-filemenu.png` | interim build (layout identical): menu/welcome, playing, draft, gameover, dawn, about, File dropdown |
| `1024x768-*.png`, `1920x1080-*.png` | same states at the smallest/largest review sizes; `1024x768-10-extreme-hud.png`, `1024x768-11-draft-12held.png` for extreme values/12-card draft |
| `1024x768-embedded-*.png`, `1920x1080-embedded-*.png` | embedded (native viewport simulation) states; app fills viewport, desktop/taskbar hidden |
| `1280x800-08-startmenu.png`, `1280x800-09-minimized-taskbar.png` | Start menu; **pre-fix** minimised taskbar-button evidence (kept for the defect history) |
| `native-10-windowed.png`, `native-11-maximized.png`, `native-12-restored.png`, `native-13-dragged.png` | real native window capture (previous native build): borderless 1200×760, maximised 1920×1032, restored, dragged; title buttons at top right |
| `crops/` | 2-4× nearest-neighbour crops used to inspect bevels, title-bar buttons, menu underlines, taskbar, status bar, dialogs |

## 13. Artifacts and limitations

Probe scripts and raw logs/results are in `%TEMP%`: `qa2\res.mjs` (`res-results.json`),
`qa2\mech.mjs` (`mech-results.json`), `qa2\ui-final.mjs` (`ui-final-results.json`), `qa2\realkeys.mjs` (`realkeys-results.json`),
`qa2\perf.mjs` (`perf-results.json`), `qa2\retune.mjs` (`retune-results.json`),
`qa2\vis.mjs` / `vis2.mjs` (`vis-results.json`), `qa2\extreme.mjs` (`extreme-results.json`),
`qa2\presentation.mjs` (`presentation-results.json`), `qa2\res-final.log`,
`qa2\mech-final.log`, `qa2\ui-final3.log`, `qa2\perf-final.log`, `qa2\smoke-final.log`,
`qa2\bot100-final.log`, `qa2\bot400-final.log`, and the native results
`qa2\native-selftest-final2.json`, `qa2\native-smoke-final2.json`.
No workspace file other than this report was written.

Limitations:

- Headless Chrome on one machine; FPS is vsync-capped at 60 Hz, so headroom above 60 Hz is not
  measured.
- **Audible audio output remains UNVERIFIED** (headless Chrome has no audio device). The M4
  audio items were previously verified by instrumenting oscillator creation/frequencies; this
  pass did not re-derive them because the retune does not touch audio.
- The native app's interactive title-bar behaviour was verified on the immediately preceding
  native build (identical title-bar protocol code); per the user's instruction the final exe
  was verified headless only (`--selftest`, `--smoke`), not by driving a visible window.
- Native `--smoke` launched in place from the workspace path fails in this agent sandbox
  (`0x800700AA`, profile folder cannot be created; result file also unwritable) while the
  identical published binaries pass from a temp copy - this is the documented environment
  limitation, not a code defect.
- The bot/`sim()` model assumes perfect reading/typing except for the configured mistake rate;
  human feel at the new fall speed is a tuning judgement for the Lead/user, not something a
  headless bot can grade.
- Per instructions, no desktop screenshots, visible windows or mouse control were used for the
  final native pass.

**Bottom line:** on `game.js` `463B7FCE93DEAEDFAE8E08EC42A2E032` / `style.css`
`7D477C99773E4FCF592AFFD2C154E89B` and the native build `F296189F…` (17:07:55), Wordfall
satisfies SPEC §7 M2-M5 with the retuned, roughly-2×-faster fall speed; the Win95 presentation
reads convincingly at all reviewed sizes and in the native shell; difficulty is provably
independent of window size; the native exe embeds the final web files and passes its headless
smoke test; and **no defects are open**. QA sign-off.
