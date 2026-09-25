// Checks the site's engines against lobbies the notebook scored itself (exports from notebook v6 on).
//   value model: meta.json "check" (ban_values, mean over networks, point removal costs)
//   simulator:   sim.json "check" (outcome log-odds of fixed lineups from the stand-in tables)
// Usage: node tools/check_notebook.js [model/meta.json] [model/sim.json]
const fs = require("fs"); const { BanEngine } = require("../engine.js"); const { SimEngine } = require("../sim.js");
const metaPath = process.argv[2] || "model/meta.json", simPath = process.argv[3] || "model/sim.json";
let bad = 0;
const meta = JSON.parse(fs.readFileSync(metaPath));
if (meta.check) {
  const buf = fs.readFileSync(metaPath.replace(/meta\.json$/, "weights.bin"));
  const E = new BanEngine(meta, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  for (const c of meta.check) {
    const r = E.values(c); let mx = 0;
    for (let h = 0; h < E.H; h++) if (c.V[h] > -90) mx = Math.max(mx, Math.abs(r.V[h] - c.V[h]));
    console.log(`value model, ${c.bans.length} bans, ${c.rev.length} shown: max |JS - notebook| = ${(100 * mx).toFixed(4)} pp`); if (mx > 2e-4) bad++;
  }
} else console.log("meta.json has no check block (export from notebook v5 or earlier)");
const M = JSON.parse(fs.readFileSync(simPath));
if (M.check) {
  const S = new SimEngine(M);
  for (const c of M.check) {
    const e = S.checkEta(c); console.log(`simulator lineup: JS ${e.toFixed(5)} notebook ${c.eta.toFixed(5)}`); if (Math.abs(e - c.eta) > 1e-3) bad++;
  }
} else console.log("sim.json has no check block (export from notebook v5 or earlier)");
if (bad) { console.error(`${bad} checks failed`); process.exit(1); } else console.log("all checks passed");
