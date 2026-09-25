// Runs the re-draft simulator off the main thread so the page stays responsive.
importScripts("sim.js");
let E = null;
const ready = fetch("model/sim.json").then(r => r.json()).then(M => { E = new SimEngine(M, { MU: 48, K: 96, LOOK: 16 }); });
onmessage = async ev => {
  await ready; const { id, st } = ev.data;
  const r = E.values(st, p => postMessage({ id, progress: p }));
  postMessage({ id, done: true, V: Array.from(r.V), se: Array.from(r.se), win: Array.from(r.win), base: r.base });
};
