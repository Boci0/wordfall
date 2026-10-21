# BALANCE-LAB — card power & draft economy for Wordfall M7

**Measured build:** `game.js` sha256 `5255d14e2322…` (M7, 107,810 bytes, mtime 2026-10-21T19:07 local) for the
baseline/card/offer/policy sweeps; the CFG proxy sweep was re-run on the pulseStatus-fixed build
`f1b565e6054e…` (M7, 108,113 bytes) and reproduces the shipped row exactly (37.5% / 96.0%). The baseline was
also re-verified on `f1b565e6054e…` with 100 seeds: 60 random 35.0%, 60 skip median 7, 80 random 97.0%.
The only rule-affecting change between those two builds was `if (state.simulating) return;` in `pulseStatus()`.
All 13 cards and every `CFG` number are unchanged from the original set (`version: 'M7'`, 13 `id:` entries).

**Tool:** `tools/balance-lab.mjs` — Playwright + `window.__wordfall.sim()`, seed-paired cells, per-phase page reload,
records the `game.js` hash it measured. Runs a full sweep in ~25 s; see *Reproduce* at the bottom.

**Seeds:** baseline 400 (1000–1399); per-card 200; offers/policies 200; CFG 200. Every cell is paired by seed.

**TL;DR — the three things to fix**
1. **Slot 3 is a survival black hole.** It is 100% Hex/Gambit (by design) and that lane's cards are
   survival-neutral to −18 pp. Decks built from slot 1 only dawn 100%; slot 3 only dawn 0%. A random
   drafter picks a Hex 37% of the time.
2. **The card spread is enormous:** Overclock I is **+42 pp** dawn vs baseline; Longshot is **−18.5 pp**.
   Rare is not better, it is *higher variance* (mean rare I = +7.1 pp, but excluding Overclock it is −4.5 pp).
3. **Skip is strictly dominated for winning:** it pays ≤3,300 pts over a whole run (~1,050 in a real 60 WPM
   run = half of one average card's score value) and still adds +4 Pressure, with zero survival benefit.

**Do the bot acceptance cells still pass?** Yes, on the measured build:

| Cell | Result | Target | Status |
| --- | --- | --- | --- |
| 60 WPM / skip | dies 400/400, median wave 7 (mean 7.20) | always dies, median 5–7 | PASS |
| 60 WPM / random | Dawn 35.5% (142/400) | 30–50% | PASS |
| 80 WPM / random | Dawn 97.0% (388/400) | > 70% | PASS |

`60 random` sits mid-band: there is ~14 pp of headroom before the 50% ceiling, which is exactly the budget
for the new/buffed cards below. `80 random` is not discriminative (97% vs a >70% bar).

---

## 1. Baseline cells (400 seeds, seeds 1000–1399)

| WPM | mode | dawn% | death% | median wave | mean wave | mean score | mean sec | wave histogram |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 40 | skip | 0.0% | 100% | 5 | 5.15 | 4,885 | 120 | 5:340 6:60 |
| 40 | random | 0.0% | 100% | 5 | 5.37 | 6,296 | 125 | 5:265 6:128 7:5 8:1 10:1 |
| 60 | skip | 0.0% | 100% | 7 | 7.20 | 8,134 | 149 | 6:1 7:322 8:75 9:2 |
| 60 | random | 35.5% | 64.5% | 8 | 9.17 | 20,835 | 192 | 6:43 7:107 8:58 9:24 10:11 11:13 12:144 |
| 80 | skip | 99.8% | 0.3% | 12 | 12.00 | 18,412 | 228 | 11:1 12:399 |
| 80 | random | 97.0% | 3.0% | 12 | 11.94 | 37,086 | 231 | 8:2 9:2 10:3 11:4 12:389 |

Note: 40 WPM is below the curve — cards barely move it (all card cells at 40 would be noise on a 100%-death
floor). Use 50–70 WPM if you want a second card-sensitive cell.

---

## 2. Per-card power (60 WPM, 200 seeds, card granted at wave 1)

Two measurements:
* **rnd Δdawn / Δwave / Δscore** — `sim({mode:'random', grant:[card]})` vs the same-seed random baseline.
  This is the *acceptance-cell marginal*: "add this card to a normal run". It is confounded by the later
  draft path changing (holding a card changes future offers), so it is a cell-impact number, not a pure card number.
* **skip Δwave / skip dawn** — `sim({mode:'skip', grant:[card]})` vs the no-card skip baseline. No drafts are
  taken, so the deck is exactly that one card and Pressure is identical: this is the **isolated card power**.
  Use this column to rank cards.

`±` is the paired SE (`n=200`). Sorted by isolated power (skip Δwave), then by cell impact.

| Card | Type | Rarity | Tier | rnd dawn | rnd Δdawn | rnd Δwave | rnd Δscore | skip median | skip Δwave | skip dawn |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Overclock | boon | rare | II | 92.0% | **+54.5 ±3.9** | +2.56 | +23,551 | 12 | **+4.82 ±0.03** | 99.0% |
| Overclock | boon | rare | I | 79.5% | **+42.0 ±4.0** | +2.15 | +17,995 | 12 | **+4.30 ±0.06** | 59.0% |
| Slow Drift | boon | common | II | 66.5% | +29.0 ±3.9 | +1.65 | +9,907 | 12 | **+4.58 ±0.07** | 87.0% |
| Slow Drift | boon | common | I | 53.5% | +16.0 ±3.2 | +0.95 | +5,221 | 8 | +1.60 ±0.10 | 2.5% |
| Wide Scope | boon | rare | II | 50.0% | +12.5 ±4.0 | +0.66 | +4,939 | 7 | 0.00 | 0.0% |
| Steady Hand | boon | common | II | 46.5% | +9.0 ±3.6 | +0.43 | +3,007 | 7 | 0.00 | 0.0% |
| Decoy | hex | rare | II | 46.5% | +9.0 ±5.1 | +0.59 | +12,669 | 8 | +1.28 ±0.10 | 1.5% |
| Decoy | hex | rare | I | 43.0% | +5.5 ±5.0 | +0.35 | +5,463 | 8 | +0.53 ±0.05 | 0.0% |
| Grace | boon | common | I | 40.0% | +2.5 ±2.6 | +0.14 | +1,231 | 7 | +0.04 ±0.01 | 0.0% |
| Steady Hand | boon | common | I | 39.0% | +1.5 ±1.8 | +0.05 | +455 | 7 | 0.00 | 0.0% |
| Split | hex | common | II | 39.0% | +1.5 ±4.3 | +0.04 | +5,965 | 8 | +0.69 ±0.09 | 0.5% |
| Wide Scope | boon | rare | I | 37.0% | −0.5 ±2.6 | +0.10 | +971 | 7 | 0.00 | 0.0% |
| Split | hex | common | I | 37.5% | 0.0 ±4.3 | +0.03 | +2,038 | 7 | +0.01 ±0.05 | 0.0% |
| Tunnel | hex | common | I | 36.5% | −1.0 ±1.6 | +0.03 | +3,840 | 7 | 0.00 | 0.0% |
| Reverse | hex | common | I | 35.5% | −2.0 ±2.6 | −0.03 | +3,623 | 7 | 0.00 | 0.0% |
| Ghost | hex | common | I | 34.5% | −3.0 ±2.3 | −0.12 | +3,300 | 7 | 0.00 | 0.0% |
| Tunnel | hex | common | II | 34.5% | −3.0 ±2.6 | −0.07 | +7,334 | 7 | 0.00 | 0.0% |
| Ledger | gambit | common | I | 32.5% | −5.0 ±2.9 | −0.40 | +2,569 | 7 | −0.38 ±0.04 | 0.0% |
| Greed | gambit | common | I | 22.5% | **−15.0 ±2.7** | −0.79 | +1,328 | 7 | −0.17 ±0.03 | 0.0% |
| Greed | gambit | common | II | 19.5% | **−18.0 ±3.2** | −1.20 | +3,801 | 7 | −0.33 ±0.04 | 0.0% |
| Longshot | gambit | rare | I | 19.0% | **−18.5 ±3.3** | −0.96 | +3,549 | 7 | −0.33 ±0.04 | 0.0% |

**Ranked strongest → weakest** (by cell impact; isolated power in brackets):
Overclock II > Overclock I > Slow Drift II > Slow Drift I > Wide Scope II > Steady Hand II ≈ Decoy II >
Decoy I > Grace > Steady Hand I > Split II > Wide Scope I ≈ Split I > Tunnel I > Reverse > Ghost ≈ Tunnel II >
Ledger > Greed I > Greed II > Longshot.

**Autopicks:** Overclock (I already a near-win button: 59% dawn single-card at 60 WPM), Slow Drift I/II.
**Strong:** Wide Scope II, Decoy (bot only — see caveat), Steady Hand (human only), Grace.
**Trap picks for winning (Δ ≤ 0):** Longshot (−18.5), Greed I/II (−15/−18), Ledger (−5). Greed II is
*worse than Greed I* (tier-up is a downgrade for survival). Tunnel/Reverse/Ghost are ~0 for the bot but
costly for a human reader (the bot ignores visibility).

### Rare vs common
| Rarity (tier I) | mean Δdawn | median Δdawn | cards |
| --- | --- | --- | --- |
| rare | **+7.1 pp** | +2.5 | Overclock +42.0, Decoy +5.5, Wide Scope −0.5, Longshot −18.5 |
| common | −0.7 pp | −1.0 | Slow Drift +16.0, Grace +2.5, Steady Hand +1.5, Split 0, Tunnel −1, Reverse −2, Ghost −3, Ledger −5, Greed −15 |
| rare **excluding Overclock** | **−4.5 pp** | −0.5 | — |

A 25% rare is **not** "strictly better": it is a lottery where one card (Overclock) carries the whole rarity.
This is worth fixing on the rare side (see §6) rather than by raising rarity rates.

### Tier-up value (Δdawn tier II − tier I)
| Card | tier I | tier II | value of upgrading | verdict |
| --- | --- | --- | --- | --- |
| Overclock | +42.0 | +54.5 | **+12.5** | worth, but already S-tier |
| Slow Drift | +16.0 | +29.0 | **+13.0** | worth |
| Wide Scope | −0.5 | +12.5 | **+13.0** | worth — tier I alone is near-zero |
| Steady Hand | +1.5 | +9.0 | +7.5 | worth (human value higher) |
| Decoy | +5.5 | +9.0 | +3.5 | ok |
| Split | 0.0 | +1.5 | +1.5 | neutral |
| Tunnel | −1.0 | −3.0 | −2.0 | not worth |
| Greed | −15.0 | −18.0 | **−3.0** | tier II is a downgrade |

A fresh random card averages **+1.7 pp** (median 0.0); the average tier-up above is **+5.8 pp**. So
upgrading a good card usually beats taking a random new card — but the *best* pick is always a top-tier boon.

---

## 3. Draft-offer distribution (200 runs × 11 real drafts = 2,200 drafts, 6,600 offers)

11 drafts is the real maximum: after wave 11 a draft opens, then wave 12 ends in Dawn. The sampler sets
`state.cleared = 10×wave` before each `beginDraft()` so Pressure/eligibility match a run that never dies.

**Structural health (all good):**
- Offers per draft: **3.00** (2,200/2,200). Empty slots: **0**. All-null drafts: **0**.
- Duplicate card within a draft: **0**. Ineligible card offered: **0** (eligibility filter works).
- No-boon drafts: **0.0%** (slot 1 always delivers one). No-new-card drafts: **1.4%** (all three offers are
  upgrades). Upgrade-only drafts: **1.4%**. → "dead pick" risk for *invalid* offers is zero; the problem is
  low-value lanes, not dead cards.
- Tier-II share of offers: **20.7%** (tier I 79.3%).

**Lane mix and fallbacks:**
| Slot | Lane rule | Types actually offered | Type fallbacks |
| --- | --- | --- | --- |
| 1 | Boon | boon 100% | 0 / 2,200 |
| 2 | Any | hex 45.1% · boon 30.6% · gambit 24.3% | 0 / 2,200 |
| 3 | Hex or Gambit | hex 66.4% · gambit 33.6% | 0 / 2,200 |

Random-drafter lane odds: **Boon 43.5% · Hex 37.2% · Gambit 19.3%** (`(1+0.306+0)/3`, etc.).

**Rarity by slot (nominal 25% per slot):**
| Slot | overall rare | waves 1–3 | 4–6 | 7–9 | 10–12 |
| --- | --- | --- | --- | --- | --- |
| 1 | 28.0% | 23.8% | 26.8% | 28.5% | **35.5%** |
| 2 | 25.1% | 27.3% | 24.0% | 24.3% | 24.8% |
| 3 | **21.4%** | 19.0% | 20.8% | 25.5% | **19.5%** |

The fallback distorts rarity in both directions: slot 1 becomes rare-*rich* late because common boons are
exhausted and the common roll falls back onto the rare boons; slot 3 is rare-*poor* because its rare pool is
only Longshot (maxTier 1) + Decoy, so a "rare" roll frequently has no candidate and falls back to common.
Overall rare rate is 24.8%, but slot 3 never actually delivers its nominal 25%.

**Pool exhaustion skews late drafts toward the worst lane:**
| Wave band | slot 2 type mix | slot 1 rare | slot 3 rare |
| --- | --- | --- | --- |
| 1–3 | hex 40.5% · boon 40.0% · gambit 19.5% | 23.8% | 19.0% |
| 4–6 | hex 46.5% · boon 28.3% · gambit 25.2% | 26.8% | 20.8% |
| 7–9 | hex 46.2% · boon 27.3% · gambit 26.5% | 28.5% | 25.5% |
| 10–12 | **hex 48.3%** · gambit 27.0% · boon 24.8% | 35.5% | 19.5% |

So by the last drafts, slot 2 is nearly a second hex lane and slot 3 has the worst rare rate of the run.

**Offer share per card** (3 = 100% of drafts contain 3 offers):
slow-drift 11.8%, steady-hand 11.7%, greed 9.3%, tunnel 9.1%, split 8.5%, decoy 7.3%, grace 6.8%,
overclock 6.7%, wide-scope 6.6%, reverse 6.2%, ghost 6.2%, ledger 5.7%, longshot 4.3%.

---

## 4. Draft policies — what the *deck* is worth (200 seeds, 60 WPM)

Measured by taking each policy's **final deck at Dawn** and granting it all at wave 1, then running with
drafts skipped. This deliberately neutralises timing to compare deck quality; absolute dawn rates are inflated
by granting early, so compare policies to each other, not to §1.

| Policy | dawn% | death% | median wave | mean wave | mean score | mean cleared | mean cards | mean tiers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| skip (no cards) | 0.0% | 100% | 7 | 7.18 | 8,128 | 66.6 | 0.00 | 0.00 |
| **slot 1 always** | **100.0%** | 0% | 12 | 12.00 | 34,510 | 145.9 | 6.96 | 11.0 |
| boon-first | 100.0% | 0% | 12 | 12.00 | 37,546 | 146.2 | 6.93 | 11.0 |
| no-hex | 78.5% | 21.5% | 12 | 11.55 | 45,852 | 137.1 | 7.55 | 11.0 |
| new-card-first | 76.5% | 23.5% | 12 | 11.26 | 68,073 | 130.3 | 10.47 | 11.0 |
| random | 63.5% | 36.5% | 12 | 10.45 | 47,746 | 115.3 | 8.62 | 11.0 |
| **slot 3 always** | **0.0%** | 100% | 6 | 6.10 | 34,164 | 55.3 | 7.75 | 11.0 |

Draft policy is the single biggest lever in the game: same number of picks (11 tiers), yet slot-1 decks are
100% and slot-3 decks 0%. Every policy still takes the same +4 Pressure per draft; the difference is purely
card quality. This is the core balance finding.

---

## 5. Skip value

- Skip payout: `50 × wave`. Maximum over a full 11-draft run = `50 × (1+…+11)` = **3,300 pts**.
  A real 60 WPM skip run dies at wave ~7, so it collects ~`50 × 21` ≈ **1,050 pts** (mean score 8,134).
- Typical card score value (tier I, paired random cell Δscore): mean **≈3,970**, median **≈3,300** —
  i.e. **one average card is worth more score than all 11 possible skips**, and it also buys survival.
- Skip still adds +4 Pressure and never contributes survival. In this data it is dominated unless the
  three offers are all survival-negative — which never happens structurally (slot 1 is always a Boon).
- `--cfg` proxy: `skipPointsPerWave 50→100` leaves every acceptance cell bit-identical (60 skip 7,
  60 random 37.5%, 80 random 96.0%), confirming skip payout is pure score economy and safe to buff.

**Verdict:** skip is never the correct pick for winning. Buff it as a *score/endless* option (see §6).

---

## 6. Diagnosis and recommended changes

### 6.1 Card-number changes (with predicted cell effect)

| # | Change | Rationale (measured) | Predicted effect |
| --- | --- | --- | --- |
| 1 | **Greed:** fall speed ×1.10→**×1.05** (I), ×1.20→**×1.10** (II). Score unchanged 1.3/1.6. | −15.0 pp / −18.0 pp; tier II is a downgrade. Speed is expensive at 60 WPM. | Trap → mild trade; 60 random **+2–3 pp** (→ ~38%). |
| 2 | **Longshot:** 7+ speed penalty 20%→**10%** (score ×2 unchanged). | −18.5 pp, worst card in the game; a rare should not be a trap. | −18.5 → ~−8 pp; 60 random **+1–2 pp**. |
| 3 | **Ledger:** remove the `+8 Pressure` word-bucket surcharge (keep +2 pts/letter). | −5.0 pp; it is a score card that also accelerates the difficulty curve — double tax. | −5 → ~0 pp; 60 random **+1 pp**. |
| 4 | *(optional)* **Overclock:** every 5th→**6th** clear (I), 4th→**5th** (II). | +42/+54 pp, the single card that decides runs; if new cards push 60 random >50%, this is the cheapest lever. | marginal ~+30 pp; 60 random **−1–2 pp**. |
| 5 | *(optional)* **Slow Drift:** ×0.85→**0.88** (I), ×0.75→**0.80** (II). | Tier II single-card dawn 87%; near-win button. Only if the cell runs hot. | 60 random **−2–3 pp**. |
| 6 | **Skip:** payout 50→**150 × wave** (max 9,900) and skip grants **+1 Shield** for the next wave (cap 3). | Skip is dominated (§5). Shield is invisible to a 0-mistake bot, so bot cells don't move; points are verified cell-neutral. | Cells unchanged; skip becomes a real human score/defence option. |

### 6.2 Draft-rule changes

1. **Slot-3 rarity: roll 0.25 → 0.32, with a cross-lane rare fallback.** Today slot 3 delivers 21.4% rare
   (19.5% late) because its rare pool is only Longshot+Decoy. On a rare roll with no eligible rare in the
   lane, fall back to any eligible rare card (or add rare cards to the lane). Predicted: slot-3 rare
   ~21% → ~30%; small (≈+0.5–1 pp) effect on the 60 random cell; mostly improves draft feel.
2. **Slot-2 lane diversity:** prefer a card whose type differs from slot 1's type when both exist.
   Today late slot 2 is 48% hex because common boons are exhausted. This is a soft preference only; it does
   not change card power, it stops late drafts from becoming two hex lanes.
3. **Guaranteed-new in slot 2** when an unowned card exists: cheap, but low priority — upgrade-only drafts
   are already only 1.4%.
4. **Late-boost boons or add boons:** the root of the late-draft decay is that the 5 boons offer only 9 tiers
   total (2+2+1+2+2) and are exhausted by wave ~9. Two of the new cards below (Lifeline, Rally) add boon
   tiers; alternatively give Grace a maxTier 2 (+1 Life / +1 Life, cap 3) — cheap and directly adds survival tiers.

**What I would *not* do:** raise `pressurePerDraft` (4→5 breaks 60 random: 37.5%→**28.5%**, below the 30% floor)
or lower `maxWords` (6→5 breaks 60 skip: median 8, 96% deaths). Both CFG proxies are measured in §7.

### 6.3 New card designs (5 — each bends exactly one thing)

Predicted cell effect = proxy measurement × expected pick rate. Proxies are CFG mutations on the measured
build (`--phase cfg`, 200 seeds). "Cell impact" is the expected shift of the 60 random acceptance cell if the
card is added to the pool (offer dilution + ~43% chance a random drafter takes a given offered card).

| # | id | Name | Type | Rarity | maxTier | Tier I / II text | Implementation (cheap) | Proxy measurement | Predicted cell impact |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `lifeline` | Lifeline | boon | rare | 1 | "The first word to reach the line is destroyed instead of costing a Life." | `state.lifelineUsed=false` in `reset()`; top of `hitGround()`: `if (has('lifeline') && !state.lifelineUsed) { state.lifelineUsed = true; ring(W/2, state.groundY, COL.gold, 420, 0.8, 3); popup(...,'LINE HELD'); return; }` (word is already removed). Render a small heart in the deck field. | `CFG.startLives 1→2` (proxy for +1 Life): 60 random **42.5%** (+5.0 pp), 60 skip median 7, 80 random 97.5% — all cells still pass. | **+2–3 pp** (60 random → ~38%). |
| 2 | `rally` | Rally | boon | common | 2 | "Word length reads 10 less Pressure (18 at tier II)." | `bucketPressure()` → `pressure() + (has('ledger')?8:0) - (heldTier('rally')>=2?18:heldTier('rally')>=1?10:0)`. No new state. | `wordRangeSteps` thresholds +12: 60 random **38.5%** (+1.0 pp), 80 random 98.5%. (Global proxy also lifts 60 skip median to 8, but as a card it only affects runs holding it, so the skip cell is untouched.) | **+1 pp**; safe. |
| 3 | `drought` | Drought | gambit | common | 2 | "Spawn interval +15% (II +20%). Score ×0.9 (II ×0.85)." | `spawnInterval()` `* (heldTier('drought')>=2?1.20:heldTier('drought')>=1?1.15:1)`; `scoreMult()` `*= 0.9/0.85`. | Early spawn gaps +16%: 60 random **36.5%** (−1.0 pp). Late gap +12%: 60 random **50.5%** (+13 pp) but breaks 60 skip (median 8) — that is a *global* proxy; tier II +20% is the caution point, so cap at +20%. | **+1–2 pp**; gives slot 3 a survival-positive option (its main purpose). |
| 4 | `bargain` | Bargain | gambit | rare | 1 | "Score ×2. Skip pays no points." | `scoreMult()` `*= 2` when held; `skip()` skips the payout when `has('bargain')`. | Survival-neutral by construction (no speed/pressure change) → **0 pp** on all cells; score economy only. | **0 pp**; safe, and adds a rare gambit to slot 3's thin rare pool. |
| 5 | `second-draft` | Second Draft | hex | rare | 1 | "+1 reroll for the run." | `applyInstant`: `state.rerollsLeft += 1;` (existing counter/UI already handle it). Optional render: a small "R+1" in the draft dialog. | Sim never rerolls → **0 pp** on all bot cells. Human value ≈ one better offer; also adds a rare hex to slot 3. | **0 pp**; safe. |

**Order to implement:** 1, 3, 2 (survival options for both lanes), then 4, 5 (economy/rarity).
**Expected combined cell shift:** 60 random **+3 to +6 pp** (35.5% → ~39–42%, inside 30–50%),
60 skip **unchanged** (median 7), 80 random ~97–98%. Re-run `tools/bot.mjs` after implementing; if
60 random exceeds 50%, apply the optional Overclock nerf (§6.1 #4).

### 6.4 Should the acceptance cells be kept or retuned?

**Keep them.** All three currently pass with margin and they express the design correctly
(no-card runs must die, random drafting must be a coin-flip-ish climb, a fast player should win).
The binding constraint is the 50% ceiling on 60 WPM random — keep it, because the easy way to "improve"
cards is to inflate survival and destroy the roguelite tension. Two suggestions:
- **80 WPM is not discriminative** (97% vs >70%). Consider tightening to >85% or replacing it with a
  70 WPM random cell (30–60%) once the new cards are in.
- **Add a draft-quality invariant** to the bot, which is more informative than another WPM cell:
  at 60 WPM on seed block 1000–1099, a deck that always picks slot 3 must Dawn <5%, and a deck that always
  picks slot 1 must Dawn >80% (this lab already measures both: 0% and 100%). Keep this as a *relative*
  invariant, not an absolute, since deck-at-wave-1 inflates rates.

---

## 7. CFG proxies (200 seeds; every cell is WPM × draft mode)

Handy for judging curve-level changes without an implementation. The shipped row is the same build as §1.

| Variant | 40 skip med | 60 skip med | 60 skip death | 60 rnd dawn | 80 rnd dawn | 60 rnd score |
| --- | --- | --- | --- | --- | --- | --- |
| **shipped** | 5 | 7 | 100.0% | **37.5%** | **96.0%** | 21,461 |
| pressurePerDraft 4→3 | 6 | 7 | 100.0% | 41.0% | 96.0% | 22,918 |
| pressurePerDraft 4→5 | 5 | 7 | 100.0% | **28.5% ✗** | 95.5% | 19,662 |
| speedPerClear 0.60→0.55 | 5 | 7 | 100.0% | 37.5% | 95.5% | 21,356 |
| speedPerClear 0.60→0.65 | 5 | 7 | 100.0% | 36.0% | 96.0% | 21,172 |
| spawnStart 2.85→3.10 (+9%) | 6 | 7 | 100.0% | 37.0% | 96.0% | 21,964 |
| spawnStart 2.85→3.30 (+16%) | 6 | 7 | 100.0% | 36.5% | 95.5% | 22,038 |
| spawnMin 1.16→1.30 (+12%) | 5 | **8 ✗** | 100.0% | **50.5%** | 99.0% | 26,528 |
| maxWords 6→5 | 5 | **8 ✗** | **96.0% ✗** | 63.5% | 99.5% | 27,818 |
| skipPointsPerWave 50→100 | 5 | 7 | 100.0% | 37.5% | 96.0% | 21,461 |
| startLives 1→2 | 5 | 7 | 100.0% | 42.5% | 97.5% | 22,339 |
| wordRange thresholds +12 | 6 | **8 ✗** | 100.0% | 38.5% | 98.5% | 22,092 |

`✗` marks a change that breaks a current acceptance cell. Key takeaways:
- Late spawn-rate relief is the strongest lever on 60 random (50.5%) and also breaks the 60 skip cell — use it
  only as a *card* (Drought), never as a global CFG change.
- Pressure relief (ppd 3) is safe for all cells (60 random 41.0%, 60 skip still 7); pressure increase (ppd 5)
  breaks the 60 random floor.
- `skipPointsPerWave` is completely cell-neutral.

---

## 8. Methodology, caveats and reproduce

**Method**
- One Playwright page per phase, `window.__wordfall.sim({wpm, mode, seed, maxSec, grant})` called inside the
  page so a full sweep is synchronous and deterministic. Seed-paired cells: deltas use only seeds present in
  both the card cell and its baseline, and report the paired SE.
- Card power is measured twice: isolated (`mode:'skip'` + grant, identical Pressure path) and marginal
  (`mode:'random'` + grant, the acceptance-cell impact). Grant happens at wave 1 (one wave earlier than the
  first real draft), which slightly overstates early-game cards.
- Offer sampler uses `reset(seed)` + 11 × (`state.cleared = 10×wave`; `beginDraft()`; read `state.offer`;
  pick with a local mulberry32 RNG so the game RNG stream is untouched by policy choices). Offer randomness is
  the game's own RNG.
- Deck-policy measurement grants the policy's final deck at wave 1 and runs `mode:'skip'`: timing-neutral
  deck-quality comparison; absolute rates inflated (not comparable to §1).
- CFG proxies mutate `CFG` around each sweep and restore it afterwards (the page's `CFG` is the live object).

**Caveats**
- **The bot is blind/spared in three places:** it ignores word visibility (Reverse/Tunnel/Ghost read as 0
  delta) and never makes mistakes (Steady Hand's shields read as 0). Real human cost is not measured here.
  Decoy *helps* the bot (fake spawns replace real spawns and fakes fall through fast) even though it hurts
  humans; treat its positive delta as bot-only.
- Single-card grants measure the card at wave 1 in an otherwise empty deck. Real runs combine cards; the
  `grant` list can be used to test combinations if needed.
- Measurements were taken on build `5255d14e2322…`; two newer M7 builds exist (`f1b565e6054e…` verified with
  the same baseline). Re-run after card edits.

**Perf note for the Lead (already fixed):** M7's `pulseStatus()` forced a synchronous layout
(`void el.offsetWidth`) on every clear even while `state.simulating`; that made every sim ~25× slower
(39 → 1.5 ms/sim). The lab stubs `offsetWidth` page-side; the `if (state.simulating) return;` guard is the
correct game-side fix and makes `tools/bot.mjs` usable again.

**Reproduce**
```
node tools/balance-lab.mjs                                  # whole suite (~25 s)
node tools/balance-lab.mjs --phase baseline --seeds 400
node tools/balance-lab.mjs --phase cards --card-seeds 200   # all 13 cards, both tiers
node tools/balance-lab.mjs --phase cards --cards greed,longshot --card-seeds 200
node tools/balance-lab.mjs --phase offers,policies --offer-seeds 200 --policy-seeds 200
node tools/balance-lab.mjs --phase cfg --cfg-seeds 200
node tools/balance-lab.mjs --phase all --json               # raw JSON (policy decks included)
```

---

# POST-TUNING VERIFICATION

**Final build:** `game.js` sha256 `0435bac2b391…` (M7, 112,845 bytes, mtime 19:24:00), card pool **18** cards,
`hexTotal` **6** (the five old Hexes + Second Draft). Commands run:
`--phase baseline --seeds 400`, `--phase baseline --seeds 300 --seed-base 5000`,
`--phase offers --offer-seeds 100`, `--phase policies --policy-seeds 100` (plus `--phase cards --card-seeds 100`
for the trap-pick check below).

**Slot-2 fix (final build):** the "different lane from slot 1" preference now applies 70% of the time instead of
always. Measured effect: slot-2 Boon offer share **0% → 11.5%** (127/1,100; Lead measured ~11.5%), and 60 WPM
random moved **37.3% → 43.3%** (base 1000) and **35.3% → 42.3%** (base 5000), while 60 skip, 80 random and
the slot-3 lane mix stayed put. The ANY slot is a lane again, and late drafts still avoid double-Hex.

## PV.1 Acceptance cells after tuning

| Cell | Target | Base 1000 (400 seeds) | Base 5000 (300 seeds) | Verdict |
| --- | --- | --- | --- | --- |
| 60 WPM / skip | always dies, median 5–7 | died 400/400 (100%), median **7**, mean 7.14 | died 300/300 (100%), median **7**, mean 7.14 | **PASS** |
| 60 WPM / random | Dawn 30–50% | **43.3%** (173/400), median wave 10 | **42.3%** (127/300), median wave 10 | **PASS** |
| 80 WPM / random | Dawn > 70% | **99.8%** (399/400), median 12 | **100.0%** (300/300), median 12 | **PASS** |

No cell is outside its target. 60 WPM random sits upper-middle in-band with ~7 pp of headroom to the 50% cap;
60 skip is unchanged at median 7 with 100% deaths; 80 WPM is pinned at the 100% ceiling (the >70% bar no longer
discriminates — see retune note). Side cells: 40 skip median 5 (100% death), 40 random median 6 (100% death),
80 skip 99.7–100%. Mean 60 random score 28,055 / 27,552, mean 60 skip score 10,298 / 10,272 (skip payout up
from 8,134 pre-tuning).

## PV.2 Offer distribution after tuning (100 runs, 1,100 drafts, 3,300 offers)

- 3.00 offers/draft, **0** empty slots, **0** duplicate-id, **0** all-null, **0** ineligible offered,
  **0.0%** no-boon drafts, no-new-card drafts **0.5%** (6/1,100).
- **Lane mix:** slot1 Boon 1,100/1,100 (100%); slot2 **hex 551 · boon 127 · gambit 422** (Boon 11.5%);
  slot3 hex 597 · gambit 498 · **boon 5** (0.5%, cross-lane rare fallback; 5/1,100 slot-3 lane fallbacks are
  the intended fallback, not exhaustion).
- **Rarity:** slot1 29.5%, slot2 31.2%, slot3 **36.6%**; overall **32.5%** (was 24.8%). By wave band the
  slot-3 rare rate is 33.3% → 32.7% → 41.0% → 41.0% (waves 1–3 → 10–12), so late drafts get rarer, not poorer.
- Tier-II share of offers **15.0%** (was 20.7% before tuning; 18-card pool, fewer duplicates).
- Top offer shares: slow-drift 7.9%, split 7.1%, steady-hand 7.0%, drought 6.9%, decoy 6.6%, greed 6.5%,
  tunnel 6.5%, rally 6.2%. All five new cards are offered (drought 6.9%, rally 6.2%, second-draft 5.0%,
  bargain 4.8%, lifeline 3.5%).

## PV.3 Draft policies after tuning (60 WPM, deck-at-start proxy, 100 seeds)

| Policy | dawn% | death% | median wave | mean wave | mean cards at Dawn |
| --- | --- | --- | --- | --- | --- |
| skip (no cards) | 0.0% | 100% | 7 | 7.13 | 0.00 |
| random | 69.0% | 31.0% | 12 | 11.25 | 9.42 |
| slot 1 always | **100.0%** | 0% | 12 | 12.00 | 6.95 |
| boon-first | 100.0% | 0% | 12 | 12.00 | 6.95 |
| no-hex | 82.0% | 18.0% | 12 | 11.71 | 9.12 |
| new-card-first | 82.0% | 18.0% | 12 | 11.54 | 10.87 |
| slot 3 always | **21.0%** | 79.0% | 8 | 8.99 | 8.87 |

The gap that motivated the tuning is much smaller: slot-3-only decks went from **0% → 21%** dawn and now clear
mean wave 8.99 (was 6.10) — the Hex/Gambit lane is no longer a death sentence, though slot 1 (100%) and random
(69%) still dominate it. Absolute rates are inflated by granting decks at wave 1; compare policies to each other.

## PV.4 Trap-pick check after tuning (60 WPM, 100 seeds, card granted at wave 1)

Bottom of the spread (marginal Δdawn vs paired baseline 41.0%):

| Card | Δdawn | Cell dawn | Isolated skip Δwave |
| --- | --- | --- | --- |
| Greed II | −8.0 ±3.9 | 33.0% | −0.09 |
| Greed I | −7.0 ±2.9 | 34.0% | −0.06 |
| Longshot | −5.0 ±4.8 | 36.0% | −0.08 |
| Ledger | −1.0 ±3.0 | 40.0% | 0.00 |
| Reverse | −1.0 ±3.0 | 40.0% | 0.00 |
| Tunnel I | 0.0 ±1.4 | 41.0% | 0.00 |
| Ghost | +1.0 ±3.6 | 42.0% | 0.00 |

No large trap remains: the worst cards are Greed I/II at −7.0/−8.0 pp (±2.9/±3.9) and Longshot at −5.0 pp
(±4.8), versus −15/−18 pp and −18.5 pp pre-tuning, and their **isolated** survival cost is under 0.1 wave —
Greed is now a score card with a small tempo cost, not a trap. All five new cards land at or above baseline
(Lifeline +12.0, Drought +14.0/+24.0, Rally +2.0/+19.0, Split +12.0, Bargain +1.0, Second Draft +1.0).
The strong end is still concentrated: Overclock I/II +56.0/+59.0 (97%/100% dawn), Slow Drift I/II +25.0/+50.0,
Drought II +24.0, Rally II +19.0, Decoy I/II +9.0/+16.0, Wide Scope II +15.0. Only Overclock and Slow Drift
remain true autopicks — acceptable for capstone cards, but the 60 random cell now has only ~7 pp of headroom
before the 50% cap, so any further survival-positive card or buff should be paired with a cell re-check.


