// Runs the browser engine in Node on lobbies from stdin (JSON list) and prints its values as JSON (tools/check_ref.py
// compares them with the numpy reference, tools/engine_ref.py).
const fs = require("fs"); const { BanEngine } = require("../engine.js");
const sc = JSON.parse(fs.readFileSync(0)), opt = sc.opt || {};
// sc.meta: a variant of the tables (same weights)
const meta = JSON.parse(fs.readFileSync(sc.meta || "model/meta.json")); const buf = fs.readFileSync("model/weights.bin");
const E = new BanEngine(meta, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length), opt); const t0 = Date.now();
const A = a => Array.from(a, v => (v === undefined || Number.isNaN(v)) ? null : v);
const out = sc.lobbies.map(s => { const r = E.values(s);
  return { V: A(r.V || []), se: A(r.se || []), Pu: A(r.Pu), Pt: A(r.Pt), PuRaw: A(r.PuRaw), PL: A(r.PL || []), pairs: (r.pairs || []).map(p => ({ a: p.a, b: p.b, V: p.V, se: p.se })) }; });
console.error(`${sc.lobbies.length} lobbies in ${Date.now() - t0} ms`); console.log(JSON.stringify(out));
