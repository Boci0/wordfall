# Changelog

All notable changes to Wordfall. Every release is also published on the
[releases page](https://github.com/Boci0/wordfall/releases) with the download attached.

## v1.11.2 - Menus open without a hitch

- **First menu no longer stalls.** The first time you tapped anything, the game created its
  audio context on the spot, and the first dialog you opened was also laid out from scratch,
  so Achievements, Records and Custom Stage hitched on first open. The audio context is now
  built quietly a second after load and each dialog is laid out once while hidden on the main
  screen. On a phone-sized screen with the CPU slowed 4x, time to the first frame after
  opening Achievements dropped from 139 ms to 39 ms (Records 12 ms, About 19 ms, Custom Stage
  46 ms).
- **Lighter behind dialogs.** While an info dialog covers a paused game or the main menu, the
  board is drawn every other frame instead of every frame; logic and input are unchanged.
  CPU use behind a dialog fell from 39% to 23% in the same test.
- **Tests** - `tools/qa-custom.mjs` (124), `qa-cards.mjs` (64), `qa-unicode.mjs` (37),
  `qa-v15.mjs` (56) and the smoke run pass. `tools/qa-juice.mjs` still fails: it is a v1.4-era
  script that expects game version "M7" and fails the same way on v1.11.1. Timings were taken
  in headless Chrome with CPU throttling, not on a physical phone.

## v1.11.1 - Cards work by touch

- **Tap to play Cards.** A card deck only answered the keyboard (Space to flip, 1/2/3 or
  Enter to grade), so on a phone it could not be played at all. Tap anywhere to flip the
  card, then tap the **Again / Good / Easy** buttons now drawn under it. The keys still
  work, the buttons also work with a mouse, and a stray tap that misses a button does
  nothing. The phone keyboard no longer pops up over a deck, since nothing is typed.
- **Long stage names are no longer cut off.** The status strip hard-cut a stage name to 18
  characters ("MANDARIN PBU1103 L"). It now shows the whole name, wrapped on up to three
  lines in a smaller size.
- **Tests** - `tools/qa-cards.mjs` (64) and `tools/qa-custom.mjs` (124) pass. Tap play and the
  strip name were checked in a 390x780 touch-emulated browser, not on a physical phone.

## v1.11.0 - Downloadable deck packs

- **Get packs.** The Custom Stage editor has a **Get packs** button. It lists decks published
  in [`packs/`](packs/) on the project's GitHub Pages site; picking one saves it as a normal
  Cards stage (picking an installed one updates it). After that it works offline. Needs an
  internet connection only while downloading. A first pack ships: Mandarin PBU1103 lessons
  1-5 (43 compulsory cards, plus an extra-words deck).
- **Study page.** [`study.html`](study.html) is a standalone flashcard / listen-and-choose /
  mock-exam page for the same words. Audio uses the browser's own Mandarin voice.
- **Desktop and Android builds.** The Windows exe and the Android APK both embed the same
  files, so v1.11.0 carries the button on every platform; no change to either native shell.
  Android is versionCode 7 and is signed with the same key as v1.10.1, so it updates in place.
- **Tests** - `tools/qa-custom.mjs` (124) passes; pack install was checked against a local
  copy of `packs/`, and the live `index.json` answers with CORS open.

## v1.10.1 - Custom Stage fits on a phone

- **Layout buttons stay on one line.** On a phone the Custom Stage **Falling words**
  button wrapped its label onto two lines and spilled past its border. Mode buttons now
  keep their label on one line and the row wraps instead; at 360 px all four still fit
  on one row.
- **Toggles wrap.** **Sharp text** ran off the right edge of the dialog. The Memorize /
  Loop / Clean on start / Sharp text row now wraps on narrow screens.
- **Tests** - `tools/qa-custom.mjs` (124) passes. The dialog was checked at 360x780 and
  320x640 with touch emulation, not on a physical phone.

## v1.10.0 - Full-alphabet word pool and endless scaling

- **Word pool covers the whole alphabet.** The roguelite pool stopped partway through the
  alphabet: every 5- and 6-letter word began with **a** or **b**, 7-letter words ended at
  **c** and 8-letter words at **d**, so from wave 3 the board was mostly words sharing a
  first letter. `words.js` now holds 1,974 words (was 459) across a-z. Each length keeps
  about its old share, and spawn timing is derived from the target WPM, so the difficulty
  curve is unchanged. Seeded runs from earlier versions draw different words.
- **Endless keeps scaling.** Past Dawn every wave used to play exactly like wave 12 (the
  speed ask, fall speed and word lengths all plateau there), so endless only got easier as
  the deck grew. Each endless wave now adds +4 WPM to the speed ask and +3% fall speed
  (Standard: 96 WPM at wave 13, 104 at 15, 124 at 20), and the spawn floor drops from
  0.88 s to 0.4 s in endless so it does not stall the climb. Waves 1-12 are unchanged.
- **Tests** - `tools/bot.mjs` passes all 7 cells (60 WPM random reaches Dawn in 41%),
  `qa-cards.mjs` (57) and `qa-custom.mjs` (124) pass. The bot does not play endless; the
  endless numbers were read from the live game, not playtested deep into a run.

## v1.9.2 - Android updater and phone cutoff fixes

- **Android in-app updater.** Help > Check for Updates… now works in the Android app
  (it used `window.open`, which does nothing in a WebView). The app asks GitHub for the
  latest release, compares its tag with the installed version, and offers **Update** or
  **Later**; Update downloads `Wordfall-android.apk` with a progress readout and hands it to
  Android's installer through a `FileProvider`. A quiet check also runs a few seconds after
  launch and only speaks up when a newer release exists. The first install asks Android to
  allow Wordfall to install apps. Updates install over the existing app as long as they are
  signed with the same key. The first version with the updater has to be installed by hand.
- **Dialog buttons wrap.** Four-button rows (Game Over, Pause, Custom Stage) overflowed the
  dialog on a phone and clipped the leftmost button. The row now wraps, the buttons flex to
  fit, and they are 32 px tall so they are easier to tap.
- **Long lines wrap.** The Pause seed line and the signal strip's `Wave n · 0/10 cleared`
  wrap instead of ending in an ellipsis, and the draft cards leave room for their `[1]`
  `[2]` `[3]` key labels.
- **Landscape phone.** On a screen under 520 px tall the toolbar and taskbar step aside and
  the main screen and draft are trimmed, so Start Run, the menu items, Reroll and Skip are
  all on screen instead of below the fold.
- **Tall dialogs.** A dialog taller than the screen scrolls with its button row pinned to
  the bottom, so OK, Save and Start stay reachable.
- **Tests** - `tools/qa-cards.mjs` (64), `qa-custom.mjs` (124), `qa-unicode.mjs` (37) and
  `qa-v15.mjs` (56) pass unchanged; `smoke.mjs` passes 201 of 202, the one miss being the
  known machine-sensitive `M7 perf` long-frame check. Layout was checked at 360x780,
  360x430 and 780x360 with touch emulation. The updater's download and install steps have
  not been run on a physical device.

## v1.9.1 - Phone readability fixes

- **Readable playfield on a phone.** With the keyboard up the board is far shorter than the
  800-unit logical playfield, and the old minimum scale of 0.5 drew everything half-size and
  squashed vertically. On a touchscreen the minimum scale is now 0.85 and the playfield
  height follows the screen (`H = height / scale`) instead of the text shrinking. Word
  speed already scales with `H`, so a fall takes about as long as before.
- **Sharp text on touch.** The soft-focus 0.55x scene upscale is off on touch devices, and
  the canvas draws at the device pixel ratio (capped at 2), so words, the target frame and
  the signal strip stay crisp. Desktop rendering is unchanged.
- **Phone status bar.** Ten panels no longer fight for one row. On narrow screens the state
  text, Heat and Pressure are hidden and Combo, Score, Wave, Lives and Shields share the
  width evenly, so none of them is cut off.
- **Letter-by-letter keyboard input.** Outside practice stages the hidden input is a
  password-type field on touch devices, which stops keyboards such as Gboard from composing
  whole words, so each letter arrives as it is tapped. Practice stages keep a text field so
  pinyin, Japanese and Korean IME input still works.
- **Tests** - `tools/qa-cards.mjs` (64), `qa-custom.mjs` (124), `qa-unicode.mjs` (37) and
  `qa-v15.mjs` (56) pass unchanged; `smoke.mjs` passes 201 to 202 of 202, the one miss being
  the known machine-sensitive `M7 perf` long-frame check. The layout was checked at 360 px
  wide with and without the keyboard; typing from a phone keyboard has not been verified on
  a physical device.

## v1.9.0 - Mobile layout and Android app

- **Android app.** A native Android build in `android/`: a thin WebView wrapper around the
  same web files, copied in at build time so there is no second copy to keep in sync. It
  runs fullscreen with the system bars hidden, keeps records, settings and custom stages in
  local storage, and targets Android 7.0 and up. The system **Back** button acts as **Esc**
  (pause, close a dialog) and leaves the app from the main menu.
- **Phone layout.** On a narrow or short screen the window now fills the whole display like
  a maximized one instead of staying a narrow strip, and the desktop icons step aside. It
  applies in portrait and landscape, so the menus, the playfield and the signal strip use
  the full width and no text is clipped.
- **On-screen keyboard.** On a touchscreen a tap on the board focuses the invisible input,
  which raises the keyboard, and the page resizes with `interactive-widget=resizes-content`
  so the keyboard never covers the playfield. Keyboards that report every key as keyCode
  229 are read through the input event, so their Latin letters count in the roguelite and in
  practice stages alike; composing text is still handed over only on commit.
- **Typing path.** `typeChunk` no longer requires a practice stage, so committed text feeds
  the normal typing rules in a roguelite run too. The roguelite stays letters-only.
- **Build.** `cd android && ./gradlew assembleDebug` produces
  `android/app/build/outputs/apk/debug/app-debug.apk`. The release APK is debug-signed, so
  Android asks to allow installs from unknown sources.
- **Tests** - `tools/smoke.mjs` (202 checks), `qa-cards.mjs` (64), `qa-custom.mjs` (124),
  `qa-unicode.mjs` (37) and `qa-v15.mjs` (56) pass unchanged. The phone layout was checked
  at 390x844 with touch emulation; the APK has not been run on a physical device.

## v1.8.0 - Cards, Prompts and multilingual practice

- **Cards layout.** Custom Stage gains a third layout for memorization rather than typing.
  One card per line as `prompt :: answer` (or `prompt => answer`); prompts cap at 120
  characters, answers at 240, and a deck at 200 cards. Lines without a separator are
  skipped and reported in the meta line. Nothing is typed: a card costs one thought.
- **Reveal and grade.** The prompt falls from the top of the board to the line. **Space**
  flips it to its answer; **1** grades **Again** (the card returns four cards later),
  **2** or **Enter** grades **Good**, **3** grades **Easy** (both retire the card). A card
  that reaches the line flips itself, shows its answer for 1.8 s, then auto-grades as
  Again. The stage completes when every card is retired; **Loop** replays the deck.
- **The deck remembers in the session.** First-try recalls, repeats and the per-card
  attempt count drive the rescheduling, and the Stage Complete dialog reports
  `N/M cards recalled · N first try · N repeats · no typing` - never WPM, keys or
  accuracy. Like every practice stage, none of it touches records or achievements.
- **Prompts layout.** A fourth layout for cross-modal drills: one `shown :: typed` per
  line, so 你好 cues `ni hao`, an English meaning cues the target word, or a definition
  cues the term. The cue is drawn above the line and the answer typed below it; **Memorize**
  is the cue's hide switch (3.5 s preview or first key), and with it off the cue stays up.
- **Any language, with IME.** Lines and Falling words no longer strip non-Latin text: the
  editor, Save, reload and the playfield keep `你好`, Japanese and Korean. Per-glyph
  positions use measured advances instead of monospace cells, Lines wrap by measured width
  and Falling words tokenise with `Intl.Segmenter`. A 1x1 invisible focus sink accepts IME
  composition, so pinyin/Japanese/Korean input commits into the line as if typed; composing
  keystrokes never count as misses.
- **New Run restarts the drill.** The toolbar New Run button (and the File menu) now
  restarts the practice stage on the board instead of dropping the player into a fresh
  roguelite run.
- **Unicode decks.** Cards and Prompts keep their Unicode: the editor, Save, reload and the
  playfield all preserve `你好 :: ni hao`, and the renderer measures real glyph widths with
  a CJK-capable font fallback.
- **Editor and HUD.** A third **Cards** pill and a fourth **Prompts** pill in the Layout
  row, counts in the meta line, `CARDS` / `PROMPT` in the signal strip,
  `Custom · Card n` / `Custom · Prompt n` in the window title, and the layout name in the
  practice strip and toolbar.
- **Sharp text.** A new practice-only **Sharp text** checkbox in the Custom Stage editor
  renders the playfield 1:1 instead of at the 0.55× soft-focus upscale, so card prompts,
  answers and key hints stay readable. The choice is remembered in
  `wordfall.settings.crisp`, flips a paused drill immediately, and never changes the
  roguelite's look. The in-stage key legend grew to 16px bold on a dark plate and the
  `RECALL` / `ANSWER` label to 13px, so the controls read even with Sharp text off.
- **Tests** - `tools/qa-cards.mjs` (64 checks) covers the card parser and caps, the
  editor and validation, the real Space/1/2/3/Enter input path, rescheduling, timeout,
  loop, save/reload with CJK, Sharp text (default soft, full-resolution toggle,
  persistence, practice-only), F2 restart, pause, and the record-book exclusion.
  `tools/qa-unicode.mjs` (37 checks) covers Unicode source preservation, measured-width
  wrapping, `Intl.Segmenter` tokens, IME `compositionend` commits, composing-key
  suppression, the Prompts cue/hide behaviour, persistence and the New Run restart.
  `tools/qa-custom.mjs` (124 checks) still passes unchanged.

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
