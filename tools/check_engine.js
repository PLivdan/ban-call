// Runs the browser engine in Node on scenarios from stdin and prints results as JSON.
const fs = require("fs"); const { BanEngine } = require("../engine.js");
const meta = JSON.parse(fs.readFileSync("model/meta.json")); const buf = fs.readFileSync("model/weights.bin");
const E = new BanEngine(meta, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
const sc = JSON.parse(fs.readFileSync(0)); const t0 = Date.now();
const out = sc.map(s => { const r = E.values(s); return { V: Array.from(r.V), se: Array.from(r.se), Pt: Array.from(r.Pt), Pu: Array.from(r.Pu), PL: Array.from(r.PL), reply: Array.from(r.reply) }; });
console.error(`${sc.length} scenarios in ${Date.now() - t0} ms`); console.log(JSON.stringify(out));
