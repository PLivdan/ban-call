# Ban Call

Which hero to ban in Marvel Rivals ranked. A static site (no framework, no server): the model runs in the browser.

**Inputs:** your rank, the map, whether your team bans first, your hero, any teammate hovers, and the bans so far.

**Outputs:** every legal ban ranked by its value in win-probability points against a typical ban, the best pairs on a
two-ban turn (the advice one ban at a time, with pairs for comparison), a forecast of the other team's bans with the reasons, what each of their likely bans does to you, your win
chance from here, and where a banned hero's mains go.

## The model (the current release: `model8/value_v8.json` names its version and run; the page shows both)
The ban-solver notebook `02_ban_solver_v8` simulates lobbies (stand-in players near the lobby's rank that follow the heroes
your team shows, the rest of the ban phase from a fitted ban model, both teams' drafts after the bans from a fitted pick
model, and a fitted outcome model) and trains teacher networks per ban position by backward induction: network k values a
lobby after k bans, with our later bans the model's best and theirs as teams really ban. From v8.2 a small student network per
position reproduces the teachers' average, their spread and the behaviour chain, and only the students ship. On the page
(`engine8.js`):

    value(x) = the student's mean at network(k + 1)(lobby after we ban x) − the same averaged over a typical team's bans

- **Advice:** the highest mean − 0.5 × spread among bans a typical team makes with probability at least 0.1% (the ban model
  for our seat; all legal bans when none is). The spread is the teachers' disagreement given one fitted world, not an interval.
- **Two-ban turns:** the advice one ban at a time, as the notebook evaluates it: the best first ban, then the advice again at
  the state after it (`Engine8.sequence`), with the support rule at each state. Pairs scored together (`Engine8.pairs`, supported
  bans at both states) are shown for comparison only.
- **Their bans:** the selected ban family, averaged over stand-in teams per rank band. It does not infer who they are from
  their earlier bans (the likely comps in `sim8.js` share this approximation).
- **Win chance:** the students' mean (the teachers' chain, with the model's best later bans) and the behaviour chain (both
  teams ban as usual). The page shows it once all six bans are in.
- **The lobby and its link** (`lobby-state.js`): a hover that gets banned stays shown for
  the model (key `g`), every link value is checked, and `s=8` marks the map numbering that includes God Quarry.
- **Likely comps** come from the v8 simulator (`sim8.js`, `sim8-worker.js`); the roster order and the previous columns still
  use the old lineup network (`engine.js`, `model/`), which is simply absent on maps it never had.

## Update the model
    python tools/build_site_v8.py <ban-solver run folder> <colab_v8 data folder>   # validates, stages, checks and publishes model8/
    python tools/stamp.py                                                           # cache-busting script addresses
The importer is all or nothing: it refuses a run that failed the null-world gate (from v8.4 the summary must say), whose files
or run identities do not agree, or that has no simulator (ALLOW_NO_SIM=1 publishes without one), builds the release in
`model8.staging`, runs `tools/check_v8_ref.py`, `check_v8.js` and `check_sim_v8.js` there, and only then swaps it in. The
page checks each binary's size and SHA-256 against the manifest and refuses to give advice from a bad or mixed release.
Other checks: `python tools/check_import.py <run>` (the importer's contract) and `node tools/check_state.js` (the lobby link).

## The previous model (v7.2), kept as a backup in `v7/`
`v7/index.html` and `v7/app.js` are the v7.2 page. They use `engine.js`, `sim.js`, `sim-worker.js` and `model/` from the
root. Git tag `v7.2-site` is the site before v8. What follows describes that model.

### The value model (engine v7.1)
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

### Files
- `v7/index.html`, `v7/app.js`: the page and its interface. `engine.js`: the value model (v7). `sim.js`, `sim-worker.js`:
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

### Update the model
    python tools/build_site_model.py <downloads>/ban_value_model_<stamp>.json
    cp <downloads>/ban_model_<stamp>.json model/sim.json
    node tools/check_notebook.js          # the site's engines against lobbies the notebook scored
    node tools/check_v7.js 60             # the v7 engine's rules on the new model
    python tools/check_ref.py             # engine.js against the numpy reference, and the notebook's embedded copy
    python tools/check_histories.py       # own-ban averaging uses legal histories only
    git add model && git commit -m "Model <stamp>" && git push
Before committing any script change, run `python tools/stamp.py`: it stamps every script address (and the worker's) with a hash of its content, so browsers never mix a new page with a cached old script.
Node is at `~/tools/node/node.exe` on the development machine (portable, not on PATH).

### Studio (retired)
The studio, a second interface on the same models, was retired on 2026-09-29. `studio/index.html` redirects to the main page, and
the last version is the git tag `studio-final`.

### Run locally
    python -m http.server 8765    # then open http://127.0.0.1:8765
