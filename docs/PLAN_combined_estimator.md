# Plan: one estimator with the value model's precision and the simulator's completeness (2026-09-26)

Status: planned, not started. Option 1 (the simulator breaks the value model's ties) is live, commit `9761a61`.

## The problem
Both advisors estimate the same quantity from the same fitted models: how much a ban changes your team's win
probability against a typical ban.
- **Ban value model** (`engine.js`): first order in each banned hero, so it is precise (intervals about ±0.09 points,
  same top ban in 56 of 60 lobbies across draws) but misses re-draft and composition effects.
- **Re-draft simulator** (`sim.js`): re-drafts both teams under each ban set, so it captures those effects, but it is
  noisy (about ±0.15 points even at 256 runs) and sensitive to which stand-in players it draws.

## The idea: a control variate built from the simulator's own first-order answer
For candidate ban x and simulated scenario j (stand-in draw, rest of the ban phase, random draws):
- `d_j = p_x,j − p_0,j`: the simulator's full answer (both teams re-drafted under x's ban set, minus the typical ban).
- `f_j = p~_x,j − p_0,j`: a **first-order answer computed on the same scenario**. Keep the typical-ban drafts, and let
  only the players whose pick is now banned move to their best legal alternative, with teammates fixed, the same noise
  and no Gibbs sweep. Then score with the outcome model. This is the value model's logic (remove, replace, score), run on
  the simulator's own stand-ins and draws.
- `d_j − f_j` is the re-draft and interaction part. Because `d_j` and `f_j` share every random number, most of the noise
  cancels, and this part is small and much less variable than `d_j`.

Two estimators, in order of preference:
1. **Two-phase control variate** (targets exactly what the simulator estimates, with no extra assumption):
   `V = mean_n(d − β f) + β · mean_N(f)`. There are n full scenarios and N ≫ n cheap ones. `f` needs no full
   re-draft, so it costs roughly a tenth of a scenario. β is the regression slope of d on f over the n full runs. The
   variance of the first term shrinks by a factor of about (1 − ρ²), where ρ = corr(d, f).
2. **Anchored to the value model**: `V = V_value(x) + mean_n(d − f)`. This is valid only if `E[f] ≈ V_value(x)`: both
   are first-order answers but use different ingredients (lineup network and removal-cost tables, against stand-in
   picks and the outcome model). Check it first by comparing `mean_N(f)` with `V_value` across lobbies. Use this form
   only if the gap is small and not systematic.

## Implementation steps (`sim.js`, `sim-worker.js`, `app.js`)
1. **`patchDraft(line, picks0, legal, tilt)`**: given a lineup's typical-ban picks and the candidate's legal set,
   re-pick only the slots whose hero is now illegal, in the line's pick order, greedy on the same utility (base + noise
   of the last sweep + role and co-pick terms with teammates fixed). Cost: only the affected players.
2. **Share the typical-ban drafts.** For each scenario j, draft both teams under the typical ban set once and cache
   their picks and lineup scores. Every candidate then reuses them for `p_0,j` and for patching. Today `evaluate` drafts
   the baseline separately from the candidates; restructure it per look j.
3. **`scorePatched`**: score the patched lineups. Only lineups that changed need new team scores. Reuse the matchup
   vectors of unchanged lineups.
4. **Worker protocol**: jobs say which looks get the full re-draft (the n) and which get only `f` (the N). The reply
   carries d and f per look.
5. **Estimator in `app.js`**: per candidate, β by least squares over the n looks (pooled across candidates if n is
   small), V and its standard error, both by a bootstrap over looks (resampling whole looks keeps the pairing).
6. **Interface**: at first a third Model option ("Combined"). If validation holds, it replaces the simulator's plain
   estimate, and the value model's tie-break (option 1) becomes redundant.

## Validation (computational; the fitted models taken as given)
Add `tools/check_combined.js` and write its report to `tools/reports/`.
- **Correlation**: the distribution of ρ = corr(d, f) per candidate across 20 lobbies. Expect above 0.8. Anything
  much lower means the patch misses too much, for example when a ban reshuffles the rest of the ban phase heavily.
- **Variance reduction at equal CPU time**: the standard error of V against the plain simulator using the same
  milliseconds. Ship only if it is at least 2× smaller.
- **No bias**: V against the plain simulator at 1,024 runs, on 20 lobbies, within simulation noise (a paired z-test
  per candidate and a check across lobbies).
- **Stability**: same top ban across independent seeds and stand-in draws, compared with the simulator alone and
  with the value model (`check_sim_seeds.js` style).
- **Where it disagrees with the value model**: list those lobbies and check that the difference comes from `d − f`
  (interactions), not from `f` versus `V_value` (ingredients).

## Risks
- **Small n makes β unstable.** Pool β across candidates, or fix β = 1 (this is then exactly the anchored form with a
  simulator-side first-order term) if it is close to 1 anyway.
- **Weak correlation** when a ban changes the rest of the ban phase a lot. The patch already uses the candidate's own
  continuation. If ρ is still low for such candidates, give them more full runs, allocating by the variance of d − f.
- **Cost**: the patch must stay much cheaper than a full scenario. Profile it with `prof_sim`-style timing, as for
  the 1.8× speed-up (commit `9d9c60b`).
