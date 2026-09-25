# Ban Call

Which hero to ban in Marvel Rivals ranked. A static site (no framework, no server): the ban value model
runs in the browser.

**Inputs:** your rank, the map, whether your team bans first, your hero, any teammate hovers, and the bans
so far.

**Outputs:** every legal ban ranked by its value in win-probability points, with 95% intervals.

**value(x) = (1 − P_later(x)) · [P_them(x)·R_them(x) − P_us(x)·R_us(x)] + reply(x)**

- **P_them, P_us:** a masked team-lineup network (2×512 GELU, ensemble of 4) that sees only what a lobby
  shows.
- **R:** the cost to a team of losing a hero. It is computed from a fitted outcome model and pick model on
  1.8M real opening picks.
- **P_later and the reply:** from a ban model fitted on every Season 10 ban.

The models are fitted in the ban-solver notebook (Colab). This repo only serves them.

## Files
- `index.html`, `app.js`: the page and its interface. `engine.js`: the value model (port of the notebook's
  `ban_values`).
- `model/meta.json` (tables) and `model/weights.bin` (the lineup networks, float16): built by
  `tools/build_site_model.py` from the notebook's `ban_value_model_*.json`.
- `img/heroes/`: portraits.
- `tools/engine_ref.py`: numpy reference implementation. `tools/check_engine.js` runs the browser engine
  in Node so the two can be compared (agreement to ~2e-7).

## Update the model
    python tools/build_site_model.py ~/Downloads/ban_value_model_<stamp>.json
    git add model && git commit -m "Model <stamp>" && git push

## Run locally
    python -m http.server 8765    # then open http://127.0.0.1:8765
