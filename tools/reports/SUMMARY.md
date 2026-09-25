# v7 verification summary (2026-09-25, model 20260925_1608, the v6 notebook's fit)

Phase 1 of the v7 plan: inference corrections on the site, using the existing weights. Everything here is
**computational** (the code does what it claims, with the fitted models taken as given). None of it is evidence that
the advice wins more real games. Full outputs are next to this file.

## Value engine (`engine.js`), `check_v7.txt`
| Check | Result |
|---|---|
| Expected lineup after the ban phase, 0–6 of our heroes fixed | exactly 6.000 for both teams (v6 raw: 5.95–6.50) |
| Probabilities in [0, 1], banned heroes 0, six fixed heroes leave no open slot | all hold |
| Rollouts: k positions left give k distinct legal bans, never a hero we show | 30,720 rollouts, all hold (v6 `later()` implied 2.87 distinct bans for 3 positions, 4.60 for 5) |
| Our lineup when we swap which hero we banned (intervention) | changes by 0 except for legality (v6 conditioning: up to 17.2 points) |
| Other team's lineup and next-ban chances when our hovers change | change by 0 |
| Stability, two independent sets of random draws (60 lobbies) | same top ban 56/60, top-3 overlap 93%, rank correlation 0.981; largest top-10 deviation 3.8 simulation SEs (about 3.5 expected by chance over 600 values) |
| Same best pair across draws (two-ban lobbies) | 18/18 |
| Against the v6 engine | same top ban 47/60, rank correlation 0.950 (levels differ by design: v7 is against a typical ban) |
| Best pair = the two best single bans | 17/20 |
| Shortlist of 10 against every pair | same best pair 20/20 |
| After entering the pair's first ban, the next suggestion is the partner | 20/20 |
| Latency (Node, one thread) | median 59 ms one-ban turns, 77 ms two-ban turns with 45 pairs |

## Reference parity, `python tools/check_ref.py`
`engine.js` and the numpy reference (`engine_ref.py`, embedded verbatim in notebook v7) on the same float16 model:
lineups agree to 2e-7, values and pairs to 0 at five decimals (the random numbers are reproduced bit for bit).
The notebook's crash-check export, built into site files, passes `check_notebook.js` with 0.0000 pp differences.

## Re-draft simulator (`sim.js`), `check_sim_v7.txt`, `check_sim_seeds_64_draws*.txt`
| Check | Result |
|---|---|
| Continuations end with six distinct bans, none a hero we show | 96/96 |
| Dropping the own-ban tilt of our own draft (v6 against v7, same stand-ins) | top ban changed in 5 of 8 lobbies: the Wo self-tilt was driving much of v6's simulator advice |
| Pairs: shortlist of 10 against 20 | same best pair 4/4 |
| Best pair = the two best singles | 2/4 |
| Seed-to-seed stability, one stand-in draw, 16 runs | top ban agreed in 0/4 lobbies; intervals did not cover the differences |
| Same, 64 runs | still unstable (for example +2.07 ± 0.27 against +0.75 ± 0.34 for the same ban) |
| 64 runs split over four stand-in draws (now the site's setting) | three seeds agree fully in 2/4 lobbies, 2 of 3 in a third; where they differ the values overlap; intervals widen to about ±0.4 and now cover the stand-in choice |
| Browser timing (4 workers, 16 runs) | single bans about 1.4 s including worker start, 45 pairs done by 2.5 s |

## What this does and does not show
- **Computational correctness:** the rules the plan set (coherence, sequential rollouts, information boundaries,
  intervention, joint pairs, common random numbers, no double counting) hold, and the site, the reference and the
  notebook compute the same thing.
- **Predictive improvement:** not measured here. The weights are v6's. Notebook v7 measures it on chronological
  windows.
- **Real win-rate improvement:** not measured anywhere. See `ban-solver/docs/HOVER_DATA_SPEC.md`.
