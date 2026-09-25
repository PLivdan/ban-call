// One of several simulator workers; each evaluates the candidates and scenarios it is given.
importScripts("sim.js");
let E = null;
const ready = fetch("model/sim.json").then(r => r.json()).then(M => { E = new SimEngine(M, { MU: 48, K: 96, LOOK: 16 }); });
onmessage = async ev => {
  await ready; const { id, job, st, cands, looks, baseLooks } = ev.data; let n = 0;
  const out = E.evaluate(st, cands, looks, baseLooks, () => { if (++n % 3 === 0) postMessage({ id, tick: 3 }); });
  postMessage({ id, tick: n % 3 });
  const f = a => Array.from(a);
  const cnt = {}; for (const h in out.cnt) cnt[h] = { u: f(out.cnt[h].u), o: f(out.cnt[h].o) };
  postMessage({ id, job, done: true, vals: out.vals, cnt, base: out.base, baseCnt: out.baseCnt ? { u: f(out.baseCnt.u), o: f(out.baseCnt.o) } : null });
};
