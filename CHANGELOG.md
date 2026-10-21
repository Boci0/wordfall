# Changelog

All notable changes to Wordfall. Every release is also published on the
[releases page](https://github.com/Boci0/wordfall/releases) with the download attached.

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
- [x] Windows 95 presentation + native WinForms/WebView2 build
- [x] Relay 12 background, draft log, trippy signal field + smoothed difficulty curve
