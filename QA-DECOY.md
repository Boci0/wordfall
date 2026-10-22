# Decoy investigation - "some long words don't die" (v1.5)

Investigation: read-only, no repo source/test files modified. This file is the only repo
artifact. Scratch scripts, the tested snapshot and screenshots live in
`%TEMP%\wordfall-investigation\` (outside the repo).

> **Status: fixed in v1.5.0.** The report below was written against commit `e584828`; the presentation fix (fake keeps magenta as target, DECOY tag, status hint, one-time cue) is in the working tree.

## Verdict

**Not a rules/logic bug. It is a UX/presentation trap built on the intentional Decoy hex.**

Every real word in the pool clears when typed, in every hex state, at every on-screen position
(459/459 words × 7 scenarios × 4 y positions, zero failures). The words that "don't die" are
**Decoy fakes** — misspelled decoy words that are, by the card's own design, un-typeable: while a
fake is the lowest word, every key is a `mistake()` and its progress can never advance
(`game.js:1505-1506`). What turns that intentional rule into a bug report is presentation:

1. With no Wide Scope, the target set is only the single lowest word (`game.js:693-696, 877-884`),
   so when the lowest word is a fake, `targetWord()` returns the fake itself (`game.js:886-894`).
2. A fake that is *not* the lowest word is drawn magenta and is easy to recognise.
   But `drawWords()` applies `COL.fake` at `game.js:2072` and then **overwrites it with the normal
   target colour** at `game.js:2075-2079`. A fake in the target slot therefore renders in ordinary
   target yellow with the normal dashed target box — visually identical to a real target.
3. The only remaining tell is a 1-px dotted magenta line one pixel under the word
   (`drawFakeMarker`, `game.js:2262-2267`), which sits on top of the target box's own bottom
   bracket (`game.js:2236-2237`) and is washed out by the deliberately soft renderer
   (`SCENE_SCALE = 0.55`, `game.js:250`) and the comet-trail ghosting.
4. A fake falls 4.5× faster than a real word (`fakeSpeedMult: 4.5`, `game.js:86`), so it blocks
   the target slot for a few seconds: measured **3.37 s / 29 rejected keys** for a 10-letter fake.
   It then disappears through the line *without* being typed, which is exactly how "the word
   didn't die" looks.

Long words make it worse for three reasons: at high pressure the spawn band is 6–10 letters
(`CFG.wordRangeSteps`, `game.js:39-48`), so fakes are long; a long word takes longer to type
before the player notices nothing registers; and a long fake read quickly or typed from memory is
nearly indistinguishable from the correct word (the fake is always exactly **one letter** off a
real pool word: sampled 60/60 fakes were 1 substitution from a pool word, lengths 6–10).

The card blurb does document the rule ("While it is the lowest word, every key is a mistake",
`game.js:602-603`) — so the rule is intended. The defect is that, in the one state where the rule
bites, the fake **stops looking like a fake**.

## Tested version

- Repo: `C:\Users\muhdb\OneDrive\Documents\deepseek-harness\default-workspace\wordfall`
- Commit: **`e584828443368bc9acefdb834079dda7b941f9a5`** (HEAD at investigation time)
- Tested snapshot: `game.js` git blob **`acb9e07ee154cd79aada707f2f4c38b4b63ac7d9`** (133,469 bytes),
  `words.js` blob `115267f8d2a4133ab18889b9095fe31525a1cb91` (459 words), exported with
  `git archive HEAD` to `%TEMP%\wordfall-investigation\head\`.
- Note: the working tree was being edited concurrently by another task (unrelated
  difficulty/achievements work), so all results and line numbers are pinned to the committed
  snapshot above. If that work lands, re-grep the quoted function names; the rule code is unchanged.
- Browser: installed Chrome via `playwright-core` (`channel: 'chrome'`), viewport 1366×900,
  playfield 1090×674 CSS / 1294×800 logical; decoy fakes were also verified while frozen with
  `state.hitPause` for the staged screenshots (renderer and `typeLetter` unaffected).

## Exact reproduction

Player-side (natural, no debug hooks):

1. Play until a draft offers the **Decoy** hex (rare) and pick it (Tier II raises the fake rate).
2. Keep playing. Decoy II makes **1 in 5** spawns a misspelled fake (`game.js:708-711`); measured
   natural rate 79/400 spawns = **19.75%**.
3. Wait until a fake is the lowest word. It is drawn in the normal yellow target style with a
   dashed target box. (Before that, while another word is lower, the same fake is magenta — see
   screenshot 07.)
4. Type the fake exactly as displayed (e.g. `govrenment`), or type the correct spelling
   (`government`). **Every key is a MISS**: progress pips stay empty, combo resets, the word stays
   on screen and is never cleared. It only vanishes when it crosses the danger line, and it costs
   no life (fakes fall through harmlessly, `game.js:1580-1582`).
5. Repeat: this happens for every fake that reaches the target slot for the rest of the run. To a
   player it reads as "some long words don't die".

Deterministic repro via the in-page debug hook (`window.__wordfall`):

```js
const wf = window.__wordfall;
wf.reset(1);
wf.grant('decoy', 2);
wf.spawnWord('govrenment', { y: 300, fake: true });   // fake, lowest => target
wf.targetWord().text;      // "govrenment"
wf.nextChar(wf.targetWord()); // "g" (computed, but typeLetter will still reject it)

let w = wf.targetWord();
for (const ch of 'govrenment') wf.typeLetter(ch);
// => wf.state.cleared === 0, w.progress === 0, wf.state.mistakes === 10
//    word still in wf.state.words; no life lost when it reaches the line
```

Actual measured natural-time run (real `keyboard.press` every 100 ms while the fake was lowest):
fake `accountant` spawned at y=-42, track from y=-38 to y=563, gone at **3.37 s**; **29 keys
pressed, 29 mistakes, progress 0, cleared 0, lives 1** (no penalty) — see
`results-interaction.json`, `fakeLifetime`.

## Root cause with file:line (commit e584828)

| # | Location | What it does |
|---|----------|--------------|
| 1 | `game.js:693-696` `targetSetSize()` | Default target-set size is 1 (Wide Scope raises it). |
| 2 | `game.js:877-884` `targetSet()` | Sorts by y descending and takes `slice(0, targetSetSize())` → with no Wide Scope the set is just the lowest word. |
| 3 | `game.js:886-894` `targetWord()` | Returns the first non-fake in the set, else `set[0]`. With a set of one fake, the fake **is** the target. |
| 4 | `game.js:1493-1506` `typeLetter()` | `const reals = set.filter(w => !w.fake); if (!reals.length) { mistake(); return; }` → while only a fake is in the set, **no key can ever advance it**. This is the "word won't die" rule; it is intentional (see `game.js:602-603`). |
| 5 | `game.js:747-752, 830-835` `misspell()`, `spawn()` | A fake is a real pool word with exactly one character (index 1..len-1) substituted. 60/60 sampled fakes were one substitution from a pool word. |
| 6 | `game.js:2070-2079` `drawWords()` colour precedence | `if (w.fake) color = COL.fake;` at 2072 is **overwritten** by the `isTarget` branch at 2075-2079 (`COL.target` = yellow). A fake in the target slot loses its only strong visual cue. |
| 7 | `game.js:2262-2267` `drawFakeMarker()` | The remaining cue: a 1-px dotted magenta line at `w.y + CFG.charH + 1`, overlapping the target box bottom bracket at `+2` (`game.js:2236-2237`). Practically invisible after the 0.55-scale soft-focus blit (`game.js:250`) and trail ghosting. |
| 8 | `game.js:86` `fakeSpeedMult: 4.5` | Fake blocks the target slot for ~2–8 s while it falls, then leaves without being typed. |
| 9 | `game.js:1580-1582` `hitGround()` | Fakes are removed on reaching the line with no life/combo penalty → the player never learns what happened. |

Note: the comment at `game.js:892` ("a fake never blocks a real word in the set") is only true
when a real word is actually *in* the set. With the default `targetSetSize() === 1`, the set
contains only the fake, so it does block. (With Wide Scope II the fake does not block: tested, set
`[govrenment, bicycle, government]`, target `bicycle`, real word typed normally.)

## Minimal proposed fix (not implemented)

Presentation-only; the "every key is a mistake" rule should stay.

1. **Don't let the target highlight erase the fake identity** in `drawWords()`: make the
   `isTarget` colour branch at `game.js:2075-2079` not apply to fakes (e.g. `if (isTarget && !w.fake)`),
   or re-apply `if (w.fake) color = COL.fake;` immediately after that block. A fake then stays
   magenta even in the target slot while still being the correct rule target (lock-on, clearing,
   scanning and `targetWord()` are untouched).
2. **Move/strengthen the fake marker** in `drawFakeMarker()` (`game.js:2262-2267`): the only
   pixel of signalling currently competes with the target box border. Draw it *above* the word
   (e.g. a 2-px dashed magenta rule at `w.y - 6`) or reuse magenta for the target box/brackets
   when `isTarget && w.fake`.
3. Optional polish: briefly underline the substituted letter, or add a small `FAKE` tag; keep the
   Decoy card text as-is.
4. Optional comment fix: correct `game.js:892` so it does not claim fakes "never block".

No rule, scoring, speed or card text needs to change; this is a one- to three-line visual fix.

## Screenshots (absolute paths; `%TEMP%` = `C:\Users\muhdb\AppData\Local\Temp`)

| File | Shows |
|------|-------|
| `%TEMP%\wordfall-investigation\shots\01-real-target-full.png` | Real 10-letter target in normal play (yellow target box, no fake marker). |
| `%TEMP%\wordfall-investigation\shots\02-real-target-crop.png` | Same, cropped — reference for the comparison. |
| `%TEMP%\wordfall-investigation\shots\03-fake-target-full.png` | Fake `govrenment` as the lowest word (= target), rendered yellow like a normal target, with real `government` above it in idle grey. |
| `%TEMP%\wordfall-investigation\shots\04-fake-target-crop.png` | Crop of the fake-as-target: indistinguishable from a real target except the 1-px dotted line under the word. |
| `%TEMP%\wordfall-investigation\shots\05-fake-target-real-above-crop.png` | Real word above the fake, idle grey. |
| `%TEMP%\wordfall-investigation\shots\06-typed-fake-misses.png` | After typing the fake exactly as displayed: `MISS`, empty progress pips, word still on screen (`mistakes` 10, `cleared` 0). |
| `%TEMP%\wordfall-investigation\shots\07-fake-not-target-crop.png` | The same fake when it is **not** the lowest word: drawn magenta, obviously a fake. Proves the colour cue exists but is overridden in the target slot. |
| `%TEMP%\wordfall-investigation\shots\08-natural-play.png` | Natural Decoy II play (before a fake reached the target slot). |
| `%TEMP%\wordfall-investigation\shots\09-reverse-midword-crop.png` | Latent (debug-hook-only) Reverse-granted-mid-word highlight desync; see secondary notes. |
| `%TEMP%\wordfall-investigation\shots\10-narrow-window.png` | 10-letter word in a 760×560 window — no clipping, typing unaffected. |
| `%TEMP%\wordfall-investigation\shots\11-fake-vs-real-zoom.png` | Labelled 3× composite: real target / fake as target (both yellow) / fake not target (magenta). |
| `%TEMP%\wordfall-investigation\shots\12-fake-marker-5x.png` | 5× zoom of the fake marker overlapping the target box bottom bracket — the whole remaining tell. |
| `%TEMP%\wordfall-investigation\shots\13-draft-dialog.png` | Real draft dialog after a real wave clear (used for the click-focus test). |
| `%TEMP%\wordfall-investigation\shots\14-resized.png` | Run after a mid-run window resize. |
| `%TEMP%\wordfall-investigation\shots\15-fake-fell-through.png` | The fake after it fell through the line untouched — no life lost. |
| `%TEMP%\wordfall-investigation\shots\16-reverse-held-full.png` | Reverse held while typing a 10-letter word (secondary UX risk; UI deck field not refreshed because the card was granted through the hook). |
| `%TEMP%\wordfall-investigation\shots\17-reverse-left-to-right-misses.png` | Typing the word left-to-right while Reverse is held: 9 misses + 1 lucky key, word still on screen. |
| `%TEMP%\wordfall-investigation\shots\18-natural-fake-as-target-full.png` | **Natural** run (no staged words): fake `azgle` is the target and looks like a normal target. |
| `%TEMP%\wordfall-investigation\shots\19-natural-fake-as-target-crop.png` | Crop of the natural fake target. |
| `%TEMP%\wordfall-investigation\shots\20-natural-fake-4x.png` | 4× nearest-neighbour zoom of the natural fake. |

## Evidence: coverage and results

All of the following returned **zero failures for real words** (raw data:
`%TEMP%\wordfall-investigation\results-core.json`, `results-visual.json`,
`results-interaction.json`, `results-final.json`, `results-edge.json`, `results-fakesample.json`):

- **All 459 pool words × 7 hex states** (none, Reverse, Tunnel I, Tunnel II, Reverse+Tunnel I,
  Decoy II, Wide Scope II): each word spawned at y=300 and typed fully through `nextChar` →
  removed, `cleared` +1, score > 0. 0 failures (2,803 keys per scenario).
- **All 76 words of length ≥ 9 at y = 40, 300, 640, 670**: 0 failures.
- **All 38 words of length ≥ 10** (24 × 10 letters + 14 × 11 letters) typed through the rule:
  0 failures. (The 11-letter bucket is not reachable by normal spawns — max band is [6,10] — but
  the words themselves clear when they exist.)
- **Decoy fake as target, typing its own displayed letters**: `progress` 0, `cleared` 0,
  `mistakes` 10, word still on board. Also true under every hex held (Reverse, Tunnel, Ghost,
  Decoy, Split, Second Draft): 10 keys → 10 mistakes, progress 0.
- **Every letter a–z pressed while a fake is the lowest word**: all 26 increment `mistakes`; none
  is accepted; the fake never progresses.
- **Fake below a real word**: `targetWord()` = fake, real word's typed letter is a `mistake` (by
  design); after the fake falls through, the real word becomes the target and is typeable again
  (`game.js:1580-1582`; verified live, no life lost).
- **Real player flows with the real keyboard**: click Start → type target → cleared (5 keys,
  combo 1); force a wave end → draft dialog opens with 3 cards → **click** a draft card with the
  mouse → `document.activeElement` is BODY → typing the next target works (13 keys, 0 misses);
  Escape pause/resume → typing works; rapid typing at 5 ms/key clears a 10-letter word; window
  resize (1366×900 → 820×620 → 760×560) mid-word → word still typeable and unclipped.
- **No permanent-stuck state found**: `lockWord` is cleared when its word is removed
  (`removeWord`, `game.js:919-923`), when a draft opens (`game.js:1393`) and on run reset
  (`game.js:509`); a locked word reaching the line releases it and typing continues (verified with
  Lifeline). `targetWord()` never returns a word above the viewport in a way that blocks play;
  words queued above the viewport (up to y=-232) all enter normally. No page errors in any run.

## Secondary observations (not the reported cause)

1. **Reverse UX risk (a second plausible reading of the report).** If Reverse is held and the
   player types left-to-right, almost every key is a miss: typing `government` left-to-right at
   progress 0 gave 9 misses and 1 accidental key (the final `t` is the required first letter),
   leaving the word at progress 1 with combo broken; only right-to-left typing clears it
   (`game.js:1139-1147`). There is no in-play "type right-to-left" cue on the word itself (the held
   card is listed in the toolbar after a real draft). This affects *every* word, not "some", and
   long words are the most painful — but it is the documented card rule, not a logic bug.
   Screenshots 16/17.
2. **Latent Reverse-granted-mid-word desync (debug-hook reachable only).** If `reverse` becomes
   active while a word already has `progress > 0`, the renderer marks the *wrong* glyphs as typed
   (it now treats the rightmost `progress` letters as typed while the player typed the leftmost
   ones) and the next required character jumps (e.g. `government` progress 4 finds next `n`
   instead of `r`); a new `typedAt` mapping is displayed against stale times. The word still
   clears (needed sequence `n r e v o g`; verified cleared). **Not reachable in normal play**:
   while `lockWord` is set, `targetSet()` returns only that word, so no other word can be cleared
   to end the wave; every manual clear while locked is the locked word itself, and words removed by
   the line/auto-clear take their progress with them. So no surviving word can have
   `progress > 0` when the draft opens. Verified: with `government` at progress 4, a second word
   could not be cleared (`targetSet` = `[government]`, second word stayed at progress 0). Worth
   fixing only if wave handling changes to leave partially typed words behind.
3. **11-letter words are dead content.** The pool has 14 words of length 11, but length bands top
   out at `[6, 10]` (`game.js:39-48`); 400 max-pressure spawns contained 0 eleven-letter words.
   Unrelated to this report.
4. **0.85 s of typed keys are swallowed during the wave-clear celebration** (`typeLetter` returns
   while `state.waveClearT > 0`, `game.js:1494`); minor feel issue, unrelated.
5. The `targetWord()` comment at `game.js:892` is misleading for the default target-set size
   (see root cause note).

## Rerun command

```powershell
$t = "$env:TEMP\wordfall-investigation"
# one-time: export the tested commit and make playwright-core resolvable from the scratch dir
cd C:\Users\muhdb\OneDrive\Documents\deepseek-harness\default-workspace\wordfall
git archive HEAD -o "$t\head.zip"
if (Test-Path "$t\head") { Remove-Item "$t\head" -Recurse -Force }
Expand-Archive "$t\head.zip" -DestinationPath "$t\head"
if (-not (Test-Path "$t\node_modules")) {
  New-Item -ItemType Junction -Path "$t\node_modules" `
    -Target "C:\Users\muhdb\OneDrive\Documents\deepseek-harness\default-workspace\node_modules"
}

# run from the scratch dir (scripts already exist there)
node "$t\core-tests.mjs"          # 459 words x 7 hex states + fake/blocking function tests
node "$t\final-checks.mjs"        # partial-word/draft, wide-scope fake, spawn lengths, long words
node "$t\interaction-tests.mjs"   # real keyboard: start, draft click, pause, rapid, resize, fake lifetime
node "$t\visual-tests.mjs"        # staged screenshots 01-12
node "$t\edge-tests.mjs"          # lockWord release, above-viewport queue, canvas click
node "$t\fake-sample.mjs"         # fake = 1-substitution sample
node "$t\reverse-natural.mjs"     # Reverse UX + natural fake capture
node "$t\natural-fake.mjs"        # natural run that keeps itself alive until a fake is the target
```

Results are written as JSON next to each script (`results-*.json`) and screenshots to
`%TEMP%\wordfall-investigation\shots\`. Re-run against a different commit by re-exporting `head/`;
the scripts load `file:///.../wordfall-investigation/head/index.html` (no build step, no server).
