# Wordfall: Design Spec (v2.1)

A one-screen typing game with a draft-only roguelite layer. No map, no branches.

Status: **M1–M7 implemented**, shipped as v1.2, presented as a Windows 95-era desktop
application (browser and native Windows build), plus the Relay 12 background and curve
smoothing in §11 and the M7 impact/draft-balance pass in §12. M5 numbers, tuning notes and
deviations are in §9; the M6 additions and their measured numbers are in §10; M7 is in §12,
with the measured card-power evidence in [BALANCE-LAB.md](BALANCE-LAB.md).

## 1. Pillar

> **Read. Commit. Survive.** You may only type the word closest to the ground.

Every card bends exactly one of three things:
- **The rule:** which words you're allowed to type (Wide Scope, Overclock)
- **The reading:** how words look (Reverse, Tunnel, Ghost, Decoy)
- **The economy:** score, speed, survival (Greed, Ledger, Grace, Slow Drift)

If a proposed card doesn't bend one of these, cut it.

## 1.1 Setting — Relay 12 (current build)

Relay 12, 03:00. The city's last long-wave station is still on the air. After midnight the
dead channel starts dropping words — fragments of a broadcast that was never sent. The
player is the night operator: type each fragment before it reaches the line, patch the
receiver when a wave ends, and hold the line until Dawn. "Signal Lost" is the relay going
dark.

The fiction is carried by:
- the **Welcome** and **About** dialogs (setting + what Boons, Gambits and Hexes are in
  diegetic terms);
- a one-line **relay log** in every draft (`RELAY 12 — …`), one beat per cleared wave;
- an **abstract signal horizon** in the playfield: irregular vertical bars and spectrum
  clusters, no buildings, windows or mast. This is the only visual change; there is no
  new screen and no new asset.

Copy lives in `index.html` (Welcome/About) and `RELAY_LOG` in `game.js` (draft lines).
The log is flavor only: no rule reads it.

## 2. Run structure

```mermaid
flowchart LR
    A[Wave n: clear 10 words] --> B[Freeze + Draft]
    B --> C["Pressure += 4"]
    C --> D{Wave 12 done?}
    D -- no --> A
    D -- yes --> E["Dawn: run won, continue endless for score"]
    A -- word hits line, no lives --> F[Signal Lost]
```

- **Wave** = 10 clears. The draft opens when a wave ends. The board freezes, and words keep their positions.
- **Pressure** is the one difficulty variable: `pressure = cleared + 4 x draftsTaken`.
  - `wordRange`, `spawnInterval` and `speed` all read `pressure` instead of `cleared`. (Small code change: swap one input.)
  - Skip still counts as a draft taken. You can't dodge escalation by skipping.
- **Dawn:** finishing wave 12 wins the run. Play continues in endless mode with a score-only goal. Without this, the game has no ending.
- **Target run length:** 8 to 12 minutes for a 60 WPM player.

### 2.1 Pause, records, seeds and run stats (M6)

- **Pause is a phase** (`paused`). `Esc` while playing pauses; `Esc` or `Enter` resumes, and
  Game → Pause/Resume is the mouse path. Printable letters always type — a typing game
  cannot spend a letter on a hotkey. The board and the *playing-time* clock freeze while
  paused; the pause dialog shows `Seed N · MM:SS played`. Minimize auto-pauses, and restore
  resumes only that minimize-induced pause, never a pause the player asked for.
- **Run stats:** each run tracks correct letters, wrong keys (shield-eaten wrong keys
  included), seconds spent in the `playing` phase, and its seed. The game-over and Dawn
  dialogs show
  `wave · words cleared · best combo · WPM · accuracy% · MM:SS · Seed N`.
  WPM = correct letters / 5 per minute of playing time; accuracy = correct /
  (correct + wrong keys). **Retry Seed** on the game-over dialog starts a new run on the
  same seed.
- **Records** are lifetime and per machine: `{runs, dawns, bestScore, bestWave,
  bestCombo, words, fastestDawnSec}` in `localStorage` key `wordfall.records`, written
  exactly once when a run ends (game over or Dawn), and migrated from the old
  `wordfall.best` key. Game → Records… shows them; the welcome dialog keeps showing the
  record best score. Headless tuning sweeps do not touch the record book.
- **Settings:** `wordfall.settings` (`{muted}`) persists the sound toggle.
- **Seeded runs:** `reset(seed?)` seeds the PRNG deterministically, so a seed reproduces
  the same run. The headless bot drives runs through the same path.

## 3. Scoring

```
points = letters x (10 + ledger) x comboMult x heatMult x Greed x Longshot x Drought x Bargain
comboMult = 1 + 0.05 x min(combo, 20)      // unchanged, max 2.0x
heatMult  = 1 + 0.25 x heat                // heat = number of Hexes held (+ tier II counts twice)
```

- Combo carries through the draft pause (resolves Q2).
- Combo resets on a wrong key or a word hitting the line. Word progress is kept after a wrong key (M1 rule, revisit in M5).
- M7 economies: Greed ×1.4 (tier II ×1.7), Longshot ×2 on 7+ letter words, Drought ×0.9
  (tier II ×0.85) in exchange for slower spawns, Bargain ×2 with Skip paying nothing.
  Close-call clears and combo milestones are presentation only — they never change score.

## 4. Mechanical primitives

Cards may only use these. If a card needs something new, add it here first.

| Primitive | Definition |
| --- | --- |
| **Life** | Word hits the line: lose 1. At 0 the run ends. Start: 1. |
| **Shield** | Takes the hit from one wrong key: combo kept, no flash. Refills when a wave starts. |
| **Heat** | Count of Hexes held. Feeds `heatMult`. Never goes down. |
| **Target set** | The words you're allowed to type. Default: the lowest one. |
| **Lock-on** | When the target set holds more than 1 word, the first correct letter locks onto one word (ties go to the lowest). The lock holds until that word is cleared. |
| **Line save** | A once-per-run effect (Lifeline) that destroys the first word to reach the line instead of costing a Life. It does not clear a wave and keeps the combo. |
| **Pressure** | See §2. |

## 5. Cards

### 5.1 Draft rules

- 3 cards. Slot 1 = **Boon**, slot 2 = any type, slot 3 = **Hex or Gambit**. No duplicates within one draft.
- **Reroll:** 1 per run (Second Draft adds one). **Skip:** `150 x wave` points and +1 temporary
  Shield for the following wave; it still counts as a draft (Pressure +4) and Bargain makes it pay 0.
- Rarity is rolled per slot: **24% base + 1.2% per wave**, except slot 3 which starts at 30%,
  capped at 45% for every slot. A rare roll with no eligible rare in the slot's lane falls
  back to any eligible rare card (cross-lane fallback), so a rare roll always delivers a rare
  while one exists. Slot 2 prefers a card type different from slot 1 70% of the time, so late
  drafts do not become two Hex picks while the ANY slot still carries Boons (always
  excluding them removed the Boon lane and starved runs; never excluding them made 60 WPM
  random too hot).
- Repeat pick: upgrades to tier II if the card has one. Otherwise the card leaves the pool after the first pick. Draft cards carry a NEW or UPGRADE tag.
- Slot exhaustion: if every card of a slot's type is ineligible, that slot falls back to any other eligible card so the draft still shows three cards. If the whole pool is exhausted the slot is empty (only Skip is available).
- Auto-clears (**Overclock**) score and count toward Pressure, but do not count toward a wave: a wave is exactly ten player clears.
- Between waves the board holds for a 0.85 s "WAVE n CLEARED" beat (presentation only; headless `sim()` skips it so tuning runs keep exact timing).

### 5.2 Card list (18)

| Card | Type | Rarity | Effect | Tier II |
| --- | --- | --- | --- | --- |
| **Wide Scope** | Boon | rare | The target set includes the 2nd lowest word (uses lock-on) | 3rd lowest too |
| **Overclock** | Boon | rare | Every 5th clear auto-clears the next target. Auto-clears give points but no combo | Every 4th |
| **Grace** | Boon | common | +1 Life | none |
| **Steady Hand** | Boon | common | +1 Shield | +2 Shields |
| **Slow Drift** | Boon | common | Fall speed x0.85 | x0.75 |
| **Lifeline** | Boon | rare | The first word to reach the line is destroyed instead of costing a Life (once per run; combo kept) | none |
| **Rally** | Boon | common | Word length reads 10 less Pressure | 18 less |
| **Greed** | Gambit | common | Score x1.4, fall speed x1.03 | x1.7 / x1.06 |
| **Longshot** | Gambit | rare | 7+ letter words score x2 and fall 5% faster | none |
| **Ledger** | Gambit | common | +2 points per letter | none |
| **Drought** | Gambit | common | Spawn interval x1.15, score x0.9 | x1.20 / x0.85 |
| **Bargain** | Gambit | rare | Score x2; Skip pays no points | none |
| **Reverse** | Hex | common | Type the target word right to left | none |
| **Tunnel** | Hex | common | Only the next 3 letters of the target (in typing order) are visible | Next 2 |
| **Ghost** | Hex | common | Each cleared word leaves an inert echo in place for 3 s | none |
| **Decoy** | Hex | rare | 1 in 8 spawns is a misspelled fake that drops 4.5× faster. While a fake is the lowest word, every key counts as a mistake. Fakes fall through the line harmlessly | 1 in 5 |
| **Split** | Hex | common | Every 5th spawn also drops a free word. It is a real 3–5 letter word: it scores and counts toward the wave, blocks the words above it while it falls, and costs no life at the line. It spawns even when the queue is full (the Hex's cost) | Every 3rd spawn |
| **Second Draft** | Hex | rare | +1 reroll for the run | none |

**M6 promoted Split** as the fifth Hex and 13th card. The free word carries
`word.harmless === true`, renders teal (`COL.splitWord = '#00a0a0'`) with a dotted marker
above it (fakes are marked below), and is never a fake. Its cadence lives in
`splitEvery()` (5th spawn at tier I, 3rd at tier II), not in `CFG`.

**M7 draft-balance pass** added five cards and retuned three traps, all measured in
[BALANCE-LAB.md](BALANCE-LAB.md): before the pass the marginal pick spread ran from
Overclock I (+42 pp dawn) to Longshot (−18.5 pp), Greed II was a downgrade over Greed I, and
a slot-3-only deck dawned 0% while slot 1 only dawned 100%. After the pass the spread is
about +61 pp to −8 pp, slot-3-only decks reach ~21%, and the acceptance cells still hold.
The changes: Greed's speed penalty ×1.10/×1.20 → ×1.03/×1.06 (score up to ×1.4/×1.7),
Longshot's speed penalty 20% → 5%, Ledger's hidden +8 Pressure surcharge removed, Skip
50 → 150 × wave plus a shield, wave-scaled rarity + cross-lane rare fallback + slot-2 lane
diversity, and the five cards above (Lifeline and Rally add boon tiers; Drought is the
first survival-positive Hex/Gambit lane card; Bargain and Second Draft widen slot 3's thin
rare pool).

### 5.3 Card interactions (defined up front)

- **Reverse + Tunnel:** Tunnel counts in typing order, so it shows the rightmost unrevealed letters. The two stack.
- **Reverse + Wide Scope:** lock-on uses the word's *first letter in typing order*.
- **Decoy + Wide Scope:** a fake in the target set doesn't block if a real word in the set can be locked.
- **Overclock + Decoy:** auto-clear skips fakes.
- **Greed + Slow Drift + Drought:** speed and spawn multipliers stack; Drought does not touch fall speed.
- **Lifeline + Split:** a harmless Split word never reaches the "costs a Life" branch, so it cannot consume Lifeline.
- **Rally + Ledger:** Rally subtracts from the word-length bucket only; Ledger no longer adds Pressure.
- **Second Draft + Bargain + Skip:** Bargain zeroes the Skip payout but the +1 Shield still applies.

### 5.4 Eligibility filter (no dead picks)

| Card | Offered only when |
| --- | --- |
| Longshot | the current word range includes 7+ letter words |
| Wide Scope II | Wide Scope I is held |
| Grace | lives held < 3 |
| Steady Hand | shields held < 3 |
| Any Hex | the player doesn't already hold all 6 |
| Any maxed card | the player has not already reached its `maxTier` |

The Hex rule is generic: it reads the number of Hex cards in `CARD_LIST` (exported as
`window.__wordfall.hexTotal`), so it stays correct as the pool grows — M6 added Split and
M7 added Second Draft, and the check moved from 4 to 6 without a hard-coded list. The
sweeps in [BALANCE-LAB.md](BALANCE-LAB.md) show 0 dead drafts, 0 ineligible offers and no
duplicate cards within a draft.

## 6. Decisions log

| Decision | Status |
| --- | --- |
| Canvas, single page, no build step, monospace | **Superseded** — gameplay is still a canvas playfield, but the shell is a Windows 95-style DOM/CSS application (title bar, menus, status bar, dialogs). The web version still has no build step; the native Windows build (§9) adds a .NET shell. |
| No map, draft-only roguelite | Kept |
| No backspace | Kept |
| Wrong key keeps word progress | Kept. First thing to revisit in M5 |
| Draft trigger = waves of 10 clears | **New** (resolves Q1) |
| Combo carries through the draft | **New** (resolves Q2) |
| Split goes to the backlog | **Resolved in M6** — promoted as the 13th card, Hex / common (§5.2) |
| Keyboard only, no touch | Kept (Q4 closed) |
| Dawn win state at wave 12 | **New** |
| Win95-era presentation, browser + native | **New** (§9) |
| Pause is a real phase; Esc pauses, Esc/Enter resumes | **New (M6)** — no letter is spent on a hotkey; the run clock freezes (§2.1) |
| Lifetime records in localStorage, per machine | **New (M6)** — `wordfall.records`; no accounts, no network (§2.1) |
| Runs carry a visible seed and can be retried | **New (M6)** — seed on pause/game-over/Dawn; Retry Seed replays it (§2.1) |
| Sound setting persists across launches | **New (M6)** — `wordfall.settings` (§2.1) |
| Impact layer: capped FX pools + adaptive budget | **New (M7)** — presentation never mutates rules and is skipped in `sim()`; 60fps verified under load (§12) |
| Effects quality toggle, persisted | **New (M7)** — View → Effects: Full/Light; `wordfall.settings.fx` (§12) |
| 18-card pool with wave-scaled draft rarity | **New (M7)** — measured in BALANCE-LAB.md; acceptance cells unchanged (§5, §12) |
| Skip is a real choice (score + shield), still +4 Pressure | **New (M7)** — `150 × wave` points and +1 temporary Shield (§5.1) |

## 7. Milestones (with acceptance criteria)

| Milestone | Scope | Done when | Status |
| --- | --- | --- | --- |
| **M2 Draft + Pressure** | `draft` phase, wave counter, `pressure` replaces `cleared` in the ramps, 3 starter cards: **Slow Drift** (Boon), **Greed** (Gambit), **Reverse** (Hex), plus Heat in scoring/HUD, Skip, Reroll, keys 1/2/3/R/S | Smoke test: clearing 10 words enters `draft`, picking resumes play with combo kept, pressure +4, and Heat changes the score | **Done** |
| **M3 Card set** | Remaining 9 cards, primitives (Shield, Lock-on), eligibility filter, tier II | Smoke test per card through `__wordfall` (force a pick, assert the effect). No card offered while ineligible across 1000 seeded drafts | **Done** |
| **M4 Feel** | Hit-pause on clear, particles, combo pitch rise, near-miss shake, danger-line audio, card rise animation | Manual playtest checklist. 60 fps held with 12 words + Ghost echoes | **Done** |
| **M5 Tuning** | Headless bot at 40/60/80 WPM with random picks, plus a word pool of 400+ words | 60 WPM bot, no cards: dies at wave 5 to 7. 60 WPM with picks: reaches Dawn in 30 to 50% of runs. 80 WPM: over 70% | **Done** |
| **M6 Pause + records + run identity + Split** | `paused` phase and dialog, lifetime Records, WPM/accuracy/run-time/seed stats on game-over and Dawn, Retry Seed, settings persistence, 13th card Split | Smoke test: pause freezes board and clock and resumes via Esc/Enter; records load and save once per finished run; `reset(seed)` is deterministic; the result dialogs carry WPM/accuracy/time/seed; Retry Seed replays the seed; Split spawns a real harmless 3–5 letter word on its cadence and is the fifth Hex. Bot: all M5 cells still pass at 400 seeds | **Done** |
| **M7 Impact + draft balance + 18 cards** | Capped canvas effect layer (particles, glyph shards, rings, pop-ups, milestones, wave-clear beat, ambient motion, adaptive budget), per-word typing/clear impact, Effects Full/Light toggle, status combo panel + CSS FX overlay; 5 new cards, trap retune, wave-scaled rarity, cross-lane rare fallback, slot-2 lane diversity, Skip rework | Smoke test: effect pools fire on a clear, milestone and wave-clear beat, FX toggle + persistence + CSS hooks, full-board 60fps check; every card asserted; bot: 60 skip dies 100% median 7, 60 random Dawn 30–50%, 80 random > 70%; balance-lab spread and no dead drafts | **Done** |

## 8. Backlog / open questions

1. **Split:** **Resolved in M6** — promoted as the 13th card, Hex / common, tier I every
   5th spawn, tier II every 3rd (§5.2). The measured impact is in §10.
2. **Meta progression** (unlocking cards between runs): out of scope.
3. **Word pool:** **Resolved in M5** — 459 words in `words.js`, 38 of them 10–11 letters.
4. **80 WPM bot cell is not discriminative** (99.8% vs a >70% bar). Candidates for a later
   pass: tighten to >85% or add a 70 WPM random cell (30–60%), and/or make the bot's
   draft-quality invariant (slot-1-only vs slot-3-only decks) a first-class acceptance cell.
5. **Bot is blind to reading cost and mistakes**: Reverse/Tunnel/Ghost measure ~0 delta and
   Steady Hand's shields measure 0 because the bot never mistypes. Human playtest is still
   the only signal for those cards ([BALANCE-LAB.md](BALANCE-LAB.md) §8).
6. **Overclock is still the strongest card** (+61 pp marginal in M7). It is the first lever
   if the 60 WPM random cell ever runs hot (nerf cadence 5th→6th / 4th→5th).

## 9. Implementation notes (M5)

What shipped vs. this doc, and the numbers that back the M5 "Done when" column.

**Measured (400 bot runs per cell, seed block 1000–1399, `node tools/bot.mjs --seeds 400`)**

| Cell | Result | Target |
| --- | --- | --- |
| 60 WPM, no cards (`skip`) | dies 400/400 (100%); median wave 6, mean 6.24; `{5:4, 6:299, 7:93, 8:4}` | dies at wave 5–7 |
| 60 WPM, random picks | Dawn 34.8% (139/400) | Dawn 30–50% |
| 80 WPM, random picks | Dawn 100% (400/400) | Dawn > 70% |

The default 100-seed run used by the bot's assertions gives median 6, 33% and 100% on the
M5 build; the M6 re-measure is in §10.

Run-to-run seed blocks vary by a few points; the shipped curve sits mid-band on purpose.

**Deviations from the letter of the doc**

- **Decoy fakes drop faster.** The card table never pinned how fast a fake falls, and
  at normal fall speed a single fake blocked the target for a whole fall (10–20 s), which
  made a picked Decoy an automatic loss and kept random-pick runs far below the M5 Dawn
  targets. Fakes now fall at `CFG.fakeSpeedMult = 4.5×`; the misspelled-fake rule is
  unchanged.
- **Run length.** Target §2 says 8–12 minutes for a 60 WPM player. The bot's winning runs
  average ~4.2 minutes (4.0–4.7 min): reaching wave 12 requires the spawn rate and fall
  speed to stay threatening, and those same two values make clears fast. Human runs are
  longer because of draft reading and imperfect play, but the gap is real.
- **Tuning lives entirely in `CFG`** (see README §Tuning), including `wordRangeSteps`
  and `fakeSpeedMult`. Any change to the curve should be checked with `tools/bot.mjs`.
- **Deterministic sim seeding.** `setSeed()` hashes the seed before feeding the PRNG
  (splitmix32-style), otherwise adjacent seeds were correlated enough to bias bot sweeps
  by ±20 points on Dawn rate. Normal play seeds from the clock, so this only affects the
  headless bot.
- **Pressure scale.** The old M1 ramp (`speedPerClear 1.9`, `spawnMin 0.8`, range
  up to `[5,11]`) was far too steep once Pressure added 4 per draft; M5 retuned it to
  `speedPerClear 0.354`, `maxSpeed 45`, `spawnMin 1.05`, and a `[6,10]` late word range.
- **Faster fall after playtest.** The first M5 build felt sluggish ("words fall too
  slow"): crossing took ~38 s at wave 1 and ~18.6 s at max pressure. The shipped curve
  doubles it to `baseSpeed 52` / `maxSpeed 95` / `speedPerClear 0.662`, i.e. ~16 s and
  ~8.8 s, with `maxWords` halved to 6 and `spawnMin` raised to 1.25 s so the smaller,
  faster queue preserves the same survival margins. M5 numbers above are from that build.

**Presentation (Windows 95-era)**

- The shell is a Win95 application: teal desktop with icons and taskbar in the browser
  build, borderless native window with the same chrome in the native build. Real DOM/CSS
  elements (title bar, menu bar, toolbar, status bar, Start menu, modal dialogs), not
  canvas imitations: Win95 grey, 2px bevels, Tahoma / Microsoft Sans Serif.
- The playfield is a 16-colour canvas: ordered-dither sky, abstract signal-field horizon,
  Lucida Console words, square particles, dotted target brackets.
- The rules run in a **fixed 800-unit-tall logical playfield**, uniformly scaled to the
  client area. This keeps fall times — and therefore difficulty — identical at any window
  size; the bot's M5 numbers are the same in a 1024×768 window and a maximised 1080p one.
- Native build: `win/` is a .NET 10 WinForms + WebView2 shell. It embeds `index.html`,
  `style.css`, `words.js`, `game.js` as resources and serves them from
  `https://wordfall.local/` in memory (so `localStorage` works), then removes the real
  title bar: the page's title bar drags the window and its buttons post
  `drag`/`min`/`max`/`close` to the host. Build with `win/build.ps1 -Smoke`; output is
  `dist/Wordfall-win64/Wordfall.exe`.

## 10. Implementation notes (M6 / v1.1)

What shipped against §2.1, §5.2 and the M6 milestone, and the numbers behind it. The
independent M6 acceptance review is [QA-REPORT-M6.md](QA-REPORT-M6.md); the v1.0 review
`QA-REPORT.md` is kept as a historical record and was not rewritten.

**Measured on the shipped M6 build** (my own fresh runs; the same commands and seed blocks
as §9, not numbers carried over from M5):

| Cell | 400 seeds (block 1000–1399) | 100 seeds | Target | Result |
| --- | --- | --- | --- | --- |
| 60 WPM, no cards (`skip`) | dies 400/400; median 6, mean 6.24, `{5:4, 6:299, 7:93, 8:4}` | dies 100/100; median 6, `{6:78, 7:21, 8:1}` | dies at wave 5–7 | **PASS** |
| 60 WPM, random picks | Dawn **37.3%** (149/400) | Dawn **40.0%** (40/100) | Dawn 30–50% | **PASS** |
| 80 WPM, random picks | Dawn **98.8%** (395/400) | Dawn **99.0%** (99/100) | Dawn > 70% | **PASS** |

`node tools/smoke.mjs` on the same build: **133/133 checks pass, 0 page/console errors,
≈22 s**. It covers pause (board and playing clock frozen, Escape/Enter resume), records
(localStorage round-trip and save-once-per-run), deterministic `reset(seed)` and Retry
Seed, the WPM/accuracy/time/seed result line, and Split (real short harmless word on the
5th/3rd-spawn cadence, typeable and scoring, no life at the line, bypasses `maxWords`,
never fake). The eligibility sweep re-checks 1050 seeded drafts with 0 violations.

**Pause.** A real `paused` phase. Escape is the only pause key; Escape or Enter resumes;
printable letters are swallowed while paused (P is a letter, not a resume key). The pause
dialog shows `Seed N · MM:SS played`, offers Resume (default), Restart Run and Controls…,
and opening Controls/About from it returns to the pause dialog. Game → Pause/Resume keeps
the Esc shortcut span and switches its label. `state.runSec` only advances in the
`playing` phase. Minimize auto-pauses; restore resumes only that minimize-induced pause,
not a user pause. Modal-open title-bar buttons are visually inert.

**Records.** `wordfall.records` holds `{runs, dawns, bestScore, bestWave, bestCombo, words,
fastestDawnSec}`, defaults 0, migrated from `wordfall.best`. `recordRun(won)` is called
exactly once per finished run (game over or Dawn), guarded by `runRecorded`, and is skipped
while `state.simulating` so bot sweeps never write the player's record book.
`wordfall.best` is still mirrored for compatibility; the welcome/About best score reads
`records.bestScore`. The dialog lives in the Game menu only.

**Split.** The free word is drawn from the real pool at 3–5 letters via
`pickSpawnText(3, 5)`; it is not a fake. It is typeable, scores like a normal clear and
counts toward the wave; it carries `word.harmless = true` so reaching the line costs no
life, and it is staged above the queue so while it falls it blocks the words above it —
that lost reading time is the Hex's cost. It deliberately ignores `maxWords`, so the card
bites even at a full queue. Teal (`COL.splitWord = '#00a0a0'`) with a dotted marker above
the word (fake markers stay below). Tier I every 5th spawn, tier II every 3rd, driven by
`state.spawnCount`; never faked. Hex eligibility is generic over `CARD_LIST`
(`HEX_TOTAL`, exposed as `__wordfall.hexTotal`), so the rule moved from four Hexes to five
without a hard-coded list.

**Settings.** `wordfall.settings` stores `{muted}`, loaded at boot and written on every
sound toggle; the menu label and toolbar button reflect it.

**Deviation / notes.** No `CFG` tuning changed for M6 — the cards changed the random-pick
mix, which moved the 60/random rate from 34.8% (M5) to 37.3% and 80/random from 100% to
98.8%; both remain inside their M5 bands. Run length is unchanged (an 80 WPM bot run
reaches Dawn in ~224 s, 3.7 min mean over 400 seeds). The native shell was rebuilt after
the web freeze: the published `dist\Wordfall-win64\` passes its own `--smoke` as
`version:"M6"` / `embeddedMode:true` and embeds the frozen web files (`Wordfall.dll`
contains the M6 strings). `dist/` is gitignored and regenerated, so a GitHub release must
attach the built folder rather than rely on the repo.

## 11. Relay 12 and curve smoothing (current build)

**Problem.** Pressure was already linear, but the mapping from Pressure to difficulty was
not. The old `wordRangeSteps` put the first 4+ band at pressure 36, the 5+ band at 48 and
the 6–10 band at 65; `spawnInterval` hit its floor at pressure 31 and `maxSpeed` capped at
65. Wave 4 was therefore the first wave with both the spawn floor and the 4–7 band, and
waves 4–6 stacked three separate steps. That is the wave-4 cliff.

**Background.** The game is now framed as the night shift at Relay 12: words fall out of a
dead long-wave channel, the player patches the receiver at each wave break, and Dawn is the
end of the shift. The Welcome/About copy and the one-line draft log (`RELAY_LOG` in
`game.js`) carry it. The playfield backdrop is an abstract signal horizon — irregular bars
and clusters of one-pixel caps, with no buildings, windows or mast — so the scenery reads as
frozen signal noise rather than a literal city. No rule reads the log; no new screen or
asset was added.

**New curve (all in `CFG`).**

| Key | Value |
| --- | ---: |
| `baseSpeed` | 54 |
| `speedPerClear` | 0.60 |
| `maxSpeed` | 100 |
| `spawnStart` | 2.85 |
| `spawnMin` | 1.16 |
| `spawnDecay` | 0.031 |
| `wordRangeSteps` | `[10,[3,5]] [22,[3,6]] [38,[4,6]] [54,[4,7]] [68,[5,8]] [86,[6,9]] [105,[6,10]]` |

Each length step moves at most one bound. Wave 4 is `4–6` with a 1.55 s spawn interval
instead of `4–7` with the 1.25 s floor. Fall speed keeps rising to pressure 77 instead of
capping near wave 5–6. The 800-unit playfield crosses in ~15.5 s at wave 1 and ~8.4 s once
the speed cap is reached.

**Measured on the implemented build** (`node tools/bot.mjs --seeds 400`, seed block
1000–1399; independent block 5000 in parentheses):

| Cell | Result | M5 target | Status |
| --- | --- | --- | --- |
| 60 WPM, no cards (`skip`) | dies 400/400; median 7, mean 7.13, `{6:1, 7:345, 8:53, 9:1}` | median 5–7 | PASS |
| 60 WPM, random picks | Dawn 33.0% (132/400); 36.0% (144/400) | 30–50% | PASS |
| 80 WPM, random picks | Dawn 96.8% (387/400); 96.3% (385/400) | >70% | PASS |

The default 100-seed run gives median 7, 32.0% and 96.0%. The 80 WPM winning run averages
~231 s. `node tools/smoke.mjs` passes 134/134, including a new check that the draft log is
populated. The debug hook stays `version: 'M6'` so the existing bot/smoke harnesses keep
working; this is a tuning/presentation update, not a new numbered milestone.


## 12. Implementation notes (M7 / v1.2)

M7 is the impact + draft-balance release. Nothing about the rules the bot measures changed
outside the cards and the draft rules themselves; the effect layer is strictly presentation
and is a no-op inside the headless simulator.

### 12.1 Impact and effect layer

The playfield renderer grew a presentation-only effect system driven by four capped pools:
`state.particles` (square sparks, ≤520), `state.shards` (one glyph per cleared letter, ≤140),
`state.rings` (square shockwaves, ≤18) and `state.popups` (floating score/combo/callout
text, ≤22). `burst()`, `shatter()`, `ring()`, `popup()` and `milestone()` are the only
emitters, and each starts with `if (state.simulating) return;`. Because `render()` is never
called inside `sim()`, and every emitter is guarded, the seeded bot stream is untouched by
the effect layer.

**Typing impact.** Each committed letter records `word.typedAt[pos]`; the renderer pops the
glyph (scale 1.55→1.0 over 160 ms, white flash on the first frames) and emits one spark.
Falling words leave two ghost trails whose alpha scales with current fall speed, materialise
out of the signal during their first 240 ms, and the target paints an animated progress bar
plus corner brackets and a dashed box whose dash offset animates.

**Clear impact.** A completed word shatters every letter as a spinning glyph shard, adds a
gold square ring, a score pop-up and a combo-multiplier pop-up, and scales the freeze-frame
(`hitPause`), shake, zoom punch and gold flash by how close the word was to the line. A clear
inside the bottom ~38% of the field additionally shows a CLOSE CALL callout. There is a
combo-milestone burst every 10 (banner, ring, flash, jingle). A lost life shatters the word
red and pops "-1 LIFE". `state.waveBanner` (previously dead state) is now rendered as the
"WAVE n" title card at wave start, and a wave end plays a 0.85 s "WAVE n CLEARED" beat
(`state.waveClearT`, board frozen, `typeLetter()` inert) before the draft opens.

**Ambient motion.** The signal-field bars breathe and their one-pixel caps flicker, a slow
scan line sweeps the field, rare interference bands cross it, stars twinkle and a signal
flare crosses the sky every ~11 s. All time-derived (`state.t`), never rng-derived, so the
renderer cannot perturb the seeded stream.

**Frame budget and adaptive quality.** `CFG.fxMaxParticles/fxMaxShards/fxMaxRings/fxMaxPopups`
cap every pool. `frame()` measures real frame time only while the board is live; if the
90-frame average exceeds 21.5 ms the internal `fxPressure` emitter multiplier drops by 0.2
(floor 0.45), and it recovers when the average is below 17.8 ms. The player-facing
**View → Effects: Full/Light** setting multiplies counts by 0.35, disables ambient motion and
persists in `wordfall.settings.fx`; `prefers-reduced-motion` selects Light on first launch.
Measured in headless Chrome with a full board and continuous clears: 60 fps / ~16.7 ms
average, no frame over 25 ms; light mode is never slower.

**CSS shell.** An `#fxOverlay` layer above the canvas and below the dialogs
(pointer-events:none) carries scanlines, vignette and a combo/danger glow. `game.js` sets
`--fx-combo`, `--fx-danger`, `--fx-heat`, `--fx-lives`, `--fx-wave` on `#app` and toggles
`phase-*`, `fx-combo-hot`, `fx-danger`, `fx-low-life`, `fx-light` and the transient
`fx-milestone` class on `<body>`; `style.css` owns every visual. All loop animations are
transform/opacity only.

### 12.2 Draft balance pass

Evidence: [BALANCE-LAB.md](BALANCE-LAB.md) (13-card baseline, 400 seeds/cell, per-card power
paired by seed, 2,200 seeded drafts, draft-policy proxies). Headline findings: slot 3 was a
survival black hole (slot-3-only decks dawn 0%, slot-1-only 100%), the card spread ran
+42 pp (Overclock I) to −18.5 pp (Longshot), Greed II was worse than Greed I, Ledger carried
a hidden +8 Pressure tax, Skip was dominated, and late drafts decayed because the 9 boon
tiers were exhausted by wave ~9.

Shipped changes:

- **Five new cards** (§5.2): Lifeline, Rally, Drought, Bargain, Second Draft (13→18 cards,
  Hexes 5→6).
- **Trap retune**: Greed speed ×1.10/×1.20 → ×1.03/×1.06 with score ×1.4/×1.7; Longshot
  speed penalty 20%→5%; Ledger's +8 Pressure surcharge removed (score-only card now).
- **Skip**: `50 × wave` → `150 × wave` points and +1 temporary Shield for the following
  wave; still +4 Pressure. Damage-free bot cells are unchanged (the bot never mistypes, so
  shields are invisible to it; the points are score-only).
- **Draft rules**: rare roll = 24% + 1.2%/wave (slot 3 base 30%), cap 45%; cross-lane rare
  fallback; slot 2 prefers a different type from slot 1 70% of the time. Measured effect:
  slot-3 rare rate 21.4% → 36.6% (late bands now reach 38–47%), slot 2 still offers Boons
  (~12% of its offers), 0 dead drafts / 0 ineligible offers, no-boon drafts 0%.

Measured on the shipped M7 build (seed block 1000–1399; independent block base 5000 in
parentheses):

| Cell | Result | Target | Status |
| --- | --- | --- | --- |
| 60 WPM, no cards (`skip`) | dies 400/400; median 7, mean 7.20 (median 7) | dies at wave 5–7 | PASS |
| 60 WPM, random picks | Dawn **43.3%** (173/400); **42.3%** (127/300 on base 5000) | 30–50% | PASS |
| 80 WPM, random picks | Dawn **99.8%** (399/400); **100%** (300/300) | > 70% | PASS |

Card spread after the pass (marginal Δdawn at 60 WPM, paired, final-build measurement):
Overclock II +59, Overclock I +56, Slow Drift II +50, Slow Drift I +25, Decoy +18/+19,
Drought +14/+24, Rally +2/+19, Lifeline +12, Bargain/Second Draft +1 … Greed II −8,
Greed I −7, Longshot −5. The −18.5 pp trap is gone and every remaining negative card is a
mild tempo cost (<0.1 wave isolated survival impact). Draft policies in the same build:
slot-1-only decks dawn 100%, slot-3-only 21% (was 0%), random 69%, skip 0% — the slot-3
hole is closed but still the weaker lane by design.

### 12.3 Notes and deviations

- The effect layer adds no new assets, no build step and no new dependencies. It is all
  canvas primitives + CSS, consistent with the 16-colour/2px-bevel rules elsewhere.
- `pulseStatus()` originally forced a synchronous layout via `void el.offsetWidth` even
  during `sim()`, making tuning sweeps ~25× slower. It now returns immediately when
  `state.simulating`; this is a test-speed fix only (no rule reads it).
- `window.__wordfall.version` is now `'M7'`; `CARDS` is 18, `hexTotal` 6. The smoke and bot
  harnesses were updated for the new milestone, and the debug hook gained `fxState()`,
  `toggleEffects()`, `perf()`, `scoreMult()`, `spawnInterval()` and `rerollsLeft()`.
- The 80 WPM acceptance cell is not discriminative (100% vs a >70% bar); see §8 backlog.
