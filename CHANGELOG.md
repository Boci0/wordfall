# Changelog

All notable changes to Wordfall. Every release is also published on the
[releases page](https://github.com/Boci0/wordfall/releases) with the download attached.

## v1.7.0 - custom stages, text cleanup and one HUD

- **Custom stages.** **Custom Stage…** on the main screen and in the Game menu opens a
  Win95 editor: paste any text, name it, pick **Lines** or **Falling words**, and
  optionally **Memorize** or **Loop**. Up to 20 saved stages live on this machine and
  the editor prefills the last stage you started.
- **New** clears the editor and drops the editing id, so Save adds another stage instead
  of overwriting the loaded one; the cap stays at 20. A blank stage name falls back to the
  first five words of the cleaned text, so an unnamed list of stages is still readable.
  **Delete** still removes only the stage that is loaded.
- **Smart text cleanup.** **Clean text** rewrites the paste and reports what it removed:
  citation markers (`[1]`, `[b]`, `[note 3]`, `[citation needed]`...), bare URLs,
  Markdown/HTML links (labels kept), HTML tags and entities, emphasis/headings/list
  markers, `(listen)` residue, and - only when the paste looks like a Wikipedia copy - the
  navigation/footer chrome and the `^` reference tail. **Clean on start** (default on) runs
  the same pass at every start; when it removes something, the stage opens with
  `TEXT CLEANED · N ITEMS REMOVED`.
  Saved stages keep the textarea text, so cleanup stays an optional per-start choice (an
  explicit Clean text edit is saved as-is); from the console,
  `window.__wordfall.custom.clean(text)` returns `{text, stats, removed}`.
- **Lines layout.** The text is split into single-row segments, wrapped greedily at word
  boundaries (a word longer than a row is hard-split), and typed one at a time with a
  blinking caret, a dashed target frame and progress pips. Spaces, punctuation and letter
  case are typed in full; the comparison itself is case-insensitive.
- **Falling words layout.** The text becomes a queue of 2-16 letter lowercase words
  (punctuation stripped), dropped at a fixed gentle 42 px/s with a 1.45 s spawn interval
  and at most six on the board. Every word must be cleared; a word that reaches the line
  is put back in the queue instead of costing a life.
- **Memorize** shows each new line for a 3.5 s preview (or until the first key), then
  renders the untyped remainder as dots under a "TYPE FROM MEMORY" cue; typed letters
  stay visible. **Loop** restarts the same stage on completion, counting passes.
- **Practice, not progression.** No cards, no lives, no Pressure, no waves and no Dawn.
  Completion shows time, keys, misses, WPM and accuracy. Records, splits and achievements
  are untouched, and there is no game over.
- **Caps and storage.** 12,000 characters, 400 line-segments, 600 falling words, token
  length 2-16, 20 saved stages. Saved stages live in `wordfall.custom.stages` and the
  last started config in `wordfall.custom.last`; only the Delete button removes a stage.
- **One HUD, one fact.** The signal strip is now the only visible run clock and mode
  readout (`#statusTime` / `#statusMode` are hidden but still updated in the DOM), the
  status main line no longer repeats the combo, and a practice stage collapses the status
  bar to a single `Practice` panel, hides the toolbar deck field and separator, and trims
  the strip sub-labels to `Loop n` (left, looping only), `Memorize` (centre, on only) and
  `Lines` / `Falling words` (right).
- **Tests** - `tools/qa-custom.mjs` (124 checks) covers the entry points and dialog validation, both
  layouts, memorization, looping, pause / F2, the result stats, save-load-reload-delete,
  the New / multi-stage flow, the cleaner rules and clean-on-start, the single-HUD rules,
  and the promise that practice never touches the roguelite record book or achievements.

## v1.6.0 - typing-speed balance and seed picker

- **The balance curve is derived from typing speed.** Spawn intervals now come from an
  explicit demand curve (`demandStart` 16 → `demandEnd` 92 WPM, exponent 1.82) instead of a
  linear timer, and the curve is calibrated to real typist percentiles: wave 1 asks about the
  10th percentile, wave 6 about the median typist, wave 12 roughly the top 1-2%. The old
  curve ran 17 / 23 / 30 / 42 / 65 WPM through waves 1-5 and then flattened to a 78 WPM wall,
  which made no-card runs fall off a cliff between 60 and 70 WPM. Before → after, 400 seeds:
  40 WPM no cards median death wave 5 → 8; 50 WPM 6 → 10; 60 WPM 7 → 11; 60 WPM random Dawn
  ~35-43% → **46.0%**; 80 WPM random Dawn 99%. The 70 WPM cells now sit at 28% (skip) and 92%
  (random) - a smooth spread rather than a wall.
- **Smoother fall-speed ramp.** `baseSpeed` 54, `speedPerClear` 0.43 and `maxSpeed` 120 keep
  the fall speed climbing across all twelve waves instead of capping around wave 6-7. A word
  crosses the 800-unit field in ~14.8 s at wave 1 and ~6.7 s at wave 12.
- **The seed is now actionable.** The main screen has an optional seed field (digits only,
  placeholder "random"); **Start Run** and Enter use it and then clear it. The Dawn dialog
  gains **Retry Seed**, matching game over, so the seed shown on the result and pause screens
  can always be replayed or typed in later. The Controls dialog documents the field.
- **Tests** - `tools/smoke.mjs` is now **202 checks** including a new v1.6 section (seed field
  and Dawn Retry Seed, a seed typed and started exactly, a strictly rising demand curve,
  wave 1 ~16 / wave 6 33-45 / wave 12 ≥90 WPM, and no wave falling through the spawn floor);
  200-202 checks pass depending on machine load (the suite is 202 checks); the only failures
  are the known machine-sensitive M7 perf checks documented in QA-REPORT-V15.md. `tools/bot.mjs` asserts the new 40/60/80 sweep (40 skip always dies with median
  7-9, 60 skip always dies with median 10-12, 60 random 30-50%, 80 random >70%) and passes.
  `node tools/qa-v15.mjs` still passes 56/56. The debug hook is `version: 'M9'` and exports
  `demandWpm()` alongside `spawnInterval()`.

## v1.5.0 - main screen, run clock, splits, achievements and difficulty

- **A real main screen.** The game now opens on a full Win95 title screen instead of a small
  welcome dialog: the Wordfall wordmark, a big **Start Run** button, Casual / Standard /
  Nightmare selection, shortcuts to Records, Splits, Achievements, Controls, About and Quit,
  and a live stats panel (best score, fastest Dawn, Dawns). Attract-mode words drift behind
  the panel on the soft-focus field. **File → Main Menu** and the pause / game-over dialogs
  now return to it.
- **The run has a clock.** A live `Time: MM:SS` readout sits in the status bar and in the
  signal strip. It runs only while the board is live, so pauses, drafts, the wave-clear beat
  and dialogs never count towards it.
- **Wave splits.** Every wave is timed from its first word to its tenth clear. The new
  signal strip below the danger line shows the live split, the previous split and the
  personal best for that wave; the best split per wave is stored on this machine. A new
  **Game → Splits…** dialog (also reachable from **Records → Splits…**) lists all twelve
  waves with best split, best cumulative time and this run's splits. Endless waves 13+ are
  still timed in the strip, tagged `ENDLESS`, but do not enter the twelve-wave PB table.
- **Fifteen achievements.** First clear, combo and score milestones, wave 5 and 12, Dawn,
  a flawless wave, a ten-letter word, a flare catch, a sub-five-minute Dawn, a Nightmare
  Dawn and more. Unlocks raise a Win95 notification in the corner of the window and are
  listed with their dates in **Game → Achievements…**; the menu shows the count. Nothing
  is sent anywhere.
- **Three difficulties.** **Casual** starts with two lives and falls/spawns 15% slower,
  **Nightmare** keeps one life and falls 15% faster while spawning 10% tighter, and
  **Standard** is the existing balance. Pick one on the main screen or cycle it from
  **Game → Difficulty**; the choice is remembered and named on the result screen.
- **The signal strip.** The empty black band below the danger line is now a readout: run
  clock and wave progress on the left, the this-wave split and PB in the centre, mode,
  best score and fastest Dawn on the right. Completed waves flash the centre readout gold
  and show the delta against the wave PB without covering the playfield.
- **Wave-clear animations no longer overlap.** The split announcement moved into the
  strip, the duplicate "RECEIVER PATCHED" callout is gone, the "WAVE n CLEARED" title card
  holds the centre of the screen on its own, and a combo milestone that lands exactly on
  the tenth clear no longer fights the title card. Achievement notifications sit clear of
  the strip.
- **Decoy fakes can no longer be mistaken for real targets** - found during the same
  playtest review. A fake that becomes the lowest word used to be re-coloured as a
  normal target, leaving only a 1-px line as a tell; it now keeps its magenta colour and
  its dashed target box, gains a hard **DECOY** tag and double underline, prints a one-time
  "DECOY · LET IT PASS" cue, and the status bar spells out `DECOY - WAIT`. The rule itself
  is unchanged: every key is still a mistake while a fake is the lowest word.
- **Long words get a little more air.** Nine- and ten-letter words now fall 8% slower. The
  playtest line "the word is so long I die" was hyperbole about length pressure, not a
  stuck word - this softens the late-run spike without touching the length ramp, and
  **Casual** gives a gentler option for the same complaint.
- **Status bar** spells out active hexes that change the typing rule (`REVERSE`, `TUNNEL`)
  and the wave clock, so a word that is not accepting keys always has a visible reason. It
  also resets to zero when **Main Menu** abandons a run instead of keeping the old numbers.
- **Performance.** The target set is computed once per rendered frame instead of three or
  four times; the back-to-front word draw reuses one scratch array instead of allocating a
  sorted copy every frame; the status bar is rebuilt only when a value it shows changes.
  A new synchronous benchmark (`window.__wordfall.benchScene`) measures update+render CPU
  independently of vsync - the v1.5 frame costs ~0.4 ms of CPU with a full board on this
  machine.
- **Tests** - new `tools/qa-v15.mjs` acceptance pass (56 checks) for the main screen, clock,
  splits, achievements, difficulty, decoy presentation, long-word clears and pacing, and the
  frame CPU budget, alongside the existing smoke and bot suites.

## v1.4.1 - softer blur, flare words

- **Softer blur.** The playfield is now rendered at 55% of the display resolution instead
  of 40%, so the words are noticeably clearer while the whole picture keeps its soft-focus
  look.
- **Flare words.** Every 13-25 seconds a short 3-5 letter word races down at 2.5x speed,
  tagged with cyan brackets and chevrons. It scores like any other clear, but if it reaches
  the line it slips through harmlessly - no Life lost, no combo break. Ignore it or chase
  it; it is never a penalty.
- First release shipped through the in-app updater.

## v1.4 - juice pass

- **The playfield is soft-focus.** Everything on the canvas - backdrop, words, particles,
  trails - is drawn into a low-resolution scene and upscaled with smoothing, so the whole
  picture carries a heavy blur, words included. Behind it sits a near-black backdrop with a
  handful of huge, very dim colour discs that drift slowly. There is no warping, no
  plasma, no rolling rainbow layer and no glitch tearing any more.
- **Much faster.** The low-resolution scene is the main optimisation: the canvas paints
  roughly 16% of the pixels it used to, the plasma pre-render and all of its full-screen
  layers are gone, and the smoothed upscale is a single blit per frame. That is what
  removed the lag.
- **Typing is now an event.** Every committed letter detonates at its own glyph: a
  hue-cycled spark burst, speed-lines, a shockwave ring, a red/cyan chromatic split of the
  glyph, a hard zoom-punch, a full-frame colour flash and shake. Rapid typing feeds a
  streak meter, so a clean burst escalates key by key; the intensity also climbs as the
  target approaches the line.
- **Clears got violent.** A cleared word shatters into every one of its glyphs, throws
  radial speed-lines, fires three shockwave rings and expanding screen bands, and stamps
  combo callouts. Combo milestones add an OVERDRIVE card and a ring storm.
- **Words have trails.** Every falling word samples its position into a fading comet tail
  and grows hard speed-lines underneath as the board heats up.
- **Flares liven the board.** Every 13-25 seconds a short 3-5 letter word drops in at 2.5x
  speed, marked with cyan brackets, chevrons and a bright sparkle trail. It scores like any
  other clear, but if it reaches the line it slips through harmlessly - no Life lost, no
  combo break. Chase it for points or let it pass; it never punishes you.
- **Louder typing.** A new master chain (gain + compressor) sits in front of the effects
  and every committed letter now fires a mechanical filtered-noise key click plus a
  rising thock - roughly five times the old gain, without clipping.
- **The original console is still in there.** The Windows 95 chrome, dialogs, draft and
  rules are unchanged and stay crisp above the blurred playfield; **View → Effects: Light**
  cuts the effect counts, `prefers-reduced-motion` is still respected, and the headless
  bots are untouched because every new effect is presentation-only.

## v1.3 - in-app updater

- **In-app updater (native Windows build)** - Wordfall now checks the public GitHub
  releases feed for a newer version (once shortly after launch, and any time via
  **Help → Check for Updates…**). When one exists it offers to download it, verifies the
  release asset's SHA-256 digest, stages it, then closes and restarts through a small
  detached helper that swaps the installed files. Your records and settings live outside
  the install folder, so updates keep them. If the install folder is not writable (for
  example a copy in `Program Files`) it falls back to opening the release page.
- The update check is a plain HTTPS request to GitHub's release API; no account, no
  telemetry and no other data is sent. Failures are silent, so the game keeps working
  offline.
- The browser build's Help → Check for Updates… simply opens the release page.
- The Controls dialog's Skip line now matches v1.2's `+150 × wave` + Shield rules.

## v1.2 / M7 - impact effects and the 18-card draft

- **Impact** - typing a completed word now cracks it apart glyph by glyph, with a square
  shockwave, a freeze-frame tuned to how close the word was to the line, screen punch and
  shake, a rising chord and a floating score pop-up. Committed letters pop, the target
  paints a live progress bar, and words materialise out of the signal and leave motion
  trails when they speed up.
- **Effects layer** - capped particle, glyph-shard, ring and pop-up pools; combo milestone
  bursts every 10; a "WAVE n CLEARED" beat before every draft; a close-call callout; a
  breathing signal horizon, scan sweep, interference bands and shooting signal flares.
  All 16-colour, all capped, with an adaptive budget that quietly scales emissions down
  if the frame time sags. **View → Effects: Full / Light** switches the whole layer, and
  the setting is remembered.
- **Draft balance** - the card pool grows from 13 to **18** with five new cards
  (`Lifeline`, `Rally`, `Drought`, `Bargain`, `Second Draft`), the trap cards are retuned
  (Greed's speed penalty cut, Longshot's speed penalty 20%→5%, Ledger's hidden Pressure
  tax removed), and the draft itself gets healthier: late-draft rarity scales with the
  wave, slot 3 rolls rares harder, a rare roll can fall back across lanes, and slot 2
  prefers a different lane from slot 1 most of the time so late drafts stop becoming two
  Hex picks while Boons stay in the ANY slot.
- **Skip** is no longer dominated: it pays `150 × wave` points (was 50) and buys one
  temporary Shield for the following wave. It still costs +4 Pressure.
- **Polish** - live combo panel in the status bar, NEW/UPGRADE tags on draft cards,
  full-screen flash/vignette/scanline CSS layer, low-life and danger states, the pause
  dialog now shows wave/WPM/combo, and the result dialog calls out a new personal best.

## v1.1 / M6 - pause, records, seeds, Split

- **Pause** - `Esc` freezes the board and the run clock; `Esc` or `Enter` resumes. Also
  Game → Pause/Resume. The pause dialog shows the seed and time played, and offers
  Resume, Restart Run and Controls….
- **Records** - a lifetime records dialog (Game → Records…) for best score, best wave,
  best combo, runs, Dawns, words cleared and fastest Dawn. Kept on this machine in
  `localStorage`; nothing leaves it.
- **Run stats and seeds** - every run has a seed, and the game-over and Dawn dialogs show
  WPM, accuracy, run time and the seed. **Retry Seed** on the game-over dialog replays the
  same seed.
- **Split** - the 13th card (Hex, common): every 5th spawn also drops a real 3-5 letter
  word. It scores, blocks the words above it while it falls, and costs no life at the
  line. Tier II makes it every 3rd spawn.
- Sound on/off is now remembered across launches.

## v1.0 - first release

- The core loop: falling words, nearest-only typing, combo, one Life, run end and best
  score.
- Waves, Pressure, the three-choice draft with reroll and Skip, Heat in scoring and the
  HUD, and the starter card set.
- The full card set with Shield, Lock-on, Ghost echoes, Decoy fakes, the eligibility
  filter and tier II upgrades.
- The Windows 95 presentation and the native WinForms/WebView2 build.
- Feel: hit-pause, clear particles, rising combo pitch, near-miss shake, danger-line
  heartbeat and card rise animation.
- A 459-word pool and a headless WPM bot used to tune the difficulty curve.

## Milestones

- [x] M1 - core loop (falling words, nearest-only typing, combo, run ends, best score)
- [x] M2 - draft + Pressure (waves, draft screen, reroll/skip, Heat in scoring/HUD, 3 starter cards)
- [x] M3 - full 12-card set, Shield, Lock-on, Ghost echoes, Decoy fakes, eligibility filter, tier II
- [x] M4 - hit-pause, clear particles, combo pitch rise, near-miss shake, danger-line heartbeat, card rise animation
- [x] M5 - 459-word pool + headless WPM bot + tuned curve
- [x] M6 / v1.1 - pause, lifetime Records, run stats + seeds + Retry Seed, settings persistence, Split (13 cards)
- [x] M7 / v1.2 - impact/effects layer + adaptive 60fps budget, Effects toggle, wave-clear beat, 18-card draft with a rebalanced pool, wave-scaled rarity, healthier Skip
- [x] v1.3 - native in-app updater (GitHub release check, SHA-256-verified download, staged swap + relaunch, Help → Check for Updates…), Controls copy fixes
- [x] v1.4 - juice pass: per-letter detonations, word comet trails, reactive equaliser, louder mechanical key sounds (the plasma/glitch look was replaced by the soft-focus renderer in v1.4.1)
- [x] v1.4.1 - soft-focus renderer at 55% resolution, flare words, first updater-driven release
- [x] v1.5 - run clock, wave splits + signal strip, fifteen achievements, three difficulty modes, Decoy readability fix
- [x] v1.6 - typing-speed demand curve calibrated to real typist percentiles, smoother fall-speed ramp, main-screen seed field + Dawn Retry Seed
- [x] Windows 95 presentation + native WinForms/WebView2 build
- [x] Relay 12 background, draft log, trippy signal field + smoothed difficulty curve
