# Ban Call

Which hero to ban in Marvel Rivals ranked. A static site (no framework, no server): the ban value model
runs in the browser.

**Inputs:** your rank, the map, whether your team bans first, your hero, any teammate hovers, and the bans
so far.

**Outputs:** every legal ban (and, on a two-ban turn, the best pairs) ranked by its value in win-probability points
against a typical ban, with 95% intervals that take the fitted models as given.

## The value model (engine v7.1)
Every hero banned in the rest of the ban phase, by either team, is worth to us

    w(y) = P_them(y)·R_them(y | set) − P_us(y)·R_us(y | set)

and a ban's value is a rollout comparison against a typical ban with the same budget:

    value(x) = E[Σ w over the bans from now on | we ban x] − E[Σ w over the bans from now on | we ban as a typical team]

- **Rollouts:** the rest of the ban phase is sampled 512 times, one ban at a time, from a ban model fitted on every
  Season 10 ban (legality, the acting team and the response terms are updated after every ban). Every candidate faces
  the same random numbers. The rollout already contains "banned later anyway" and the other team's replies, so nothing
  is added afterwards.
- **P_them, P_us:** a masked team-lineup network (2×512 GELU, ensemble of 4) that sees only what a lobby shows.
  - The other team's side uses public information only (never our hovers).
  - Our own bans are interventions: they remove heroes but say nothing new about our players, so our side is averaged
    over 32 legal ban histories a typical team in our seat could have made (never a hero the other team bans at any
    point, never one we show), weighted by how likely the other team's actual bans are under each. The assumptions
    this rests on are written out at the top of `tools/engine_ref.py`; averaging does not remove selection in general.
  - Probabilities are made coherent (six heroes, banned 0, fixed 1, a bounded logit shift) when they describe one
    availability state: after the ban phase, or with six fixed heroes. Mid ban phase each is its own "if it stays
    available" hypothetical and is left as the network gives it.
- **R:** the cost to a team of losing a hero, from a fitted outcome model and pick model on 1.8M real opening picks.
  With export v7 (notebook v7.1), `R(x | set)` adds joint-removal terms: if y is banned too, x's players also lose y as
  a fallback (a main and its backup), computed from the same outcome and pick models.
- **Ban model:** export v7 can carry the richer family B (responses to the immediately previous ban, protection and fear
  by position) when the notebook's chronological comparison selects it.
- **Two-ban turns:** the ten best single bans are paired every way and the 45 pairs are scored together. Once the
  first ban of the turn is in, the second is scored as completing the pair, from the state at the start of the turn.
- **Intervals:** the four networks, the removal-cost bootstrap, the rollout noise and the own-ban averaging. They do
  not include refitting the models on other matches (the notebook's refit bootstrap measures that).

A second model, the re-draft simulator (`sim.js`, run in Web Workers by `sim-worker.js`), values each ban by simulating
the rest of the ban phase and re-drafting both teams with stand-in players (16, 32 or 64 runs per top ban, split over
four independent stand-in draws). Our own bans do not tilt our own draft (v7); the other team's picks react to them.
On a two-ban turn it scores the 45 pairs of its ten best single bans. Its tables are in `model/sim.json`.

The models are fitted in the ban-solver notebook (Colab). This repo only serves them. The v6 engines are frozen in
`baseline/` and tagged `v6-baseline`.

## Files
- `index.html`, `app.js`: the page and its interface. `engine.js`: the value model (v7). `sim.js`, `sim-worker.js`:
  the re-draft simulator.
- `model/meta.json` (tables) and `model/weights.bin` (the lineup networks, float16): built by
  `tools/build_site_model.py` from the notebook's `ban_value_model_*.json` (export v5 from notebook v6, v6 from v7).
- `img/heroes/`: portraits.
- `baseline/engine_v6.js`, `baseline/sim_v6.js`: the v6 engines, kept to check v6 exports and to measure what v7 changed.
- `tools/engine_ref.py`: the canonical numpy implementation of the v7 engine. The notebook embeds it verbatim
  (`tools/sync_engine.py` copies it in). `tools/check_ref.py` checks `engine.js` against it bit for bit (same random
  numbers) and checks the notebook's copy.
- `tools/check_notebook.js`: the site's engines against lobbies the notebook scored (v5 exports through the frozen v6
  engine, v6 exports through `engine.js`).
- `tools/check_v7.js`, `tools/check_sim_v7.js`, `tools/check_sim_seeds.js`, `tools/check_histories.py`: the v7
  verification (coherence, rollouts, information boundaries, legal own-ban histories, stability, pairs, latency, changes
  against v6). `tools/check_ref.py` also checks the joint-removal and ban-model-B paths on a synthetic variant.
  `tools/check_comments.py` flags an inline comment that swallows code (a bug that reached a worker file and a notebook
  checkpoint here). Their latest output is in `tools/reports/`.

## Update the model
    python tools/build_site_model.py <downloads>/ban_value_model_<stamp>.json
    cp <downloads>/ban_model_<stamp>.json model/sim.json
    node tools/check_notebook.js          # the site's engines against lobbies the notebook scored
    node tools/check_v7.js 60             # the v7 engine's rules on the new model
    python tools/check_ref.py             # engine.js against the numpy reference, and the notebook's embedded copy
    python tools/check_histories.py       # own-ban averaging uses legal histories only
    git add model && git commit -m "Model <stamp>" && git push
Before committing any script change, run `python tools/stamp.py`: it stamps every script address (and the worker's) with a hash of its content, so browsers never mix a new page with a cached old script.
Node is at `~/tools/node/node.exe` on the development machine (portable, not on PATH).

## Run locally
    python -m http.server 8765    # then open http://127.0.0.1:8765
