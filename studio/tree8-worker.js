/* The ban-phase tree for the studio, from the v8 value networks (../engine8.js): each of your leading options, the other
   team's likeliest replies from the ban model (as the page sees the lobby), then the best ban left for your next turn. Posts
   the tree as it grows; the slow part is the networks' advice at each of your next turns. */
importScripts("../engine8.js" + self.location.search);
let E = null, loading = null;
async function load(v) {
  const q = v ? `?v=${v}` : "";
  const [lay, ban] = await Promise.all([fetch(`../model8/value_v8.json${q}`).then(r => r.json()), fetch(`../model8/ban_v8.json${q}`).then(r => r.json())]);
  E = new Engine8(lay, ban); E.addBuffer("opt", await fetch(`../model8/${lay.files.opt.path}${q}`).then(r => r.arrayBuffer()));
}
onmessage = async ev => {
  const { id, base, opts, v, reply = 2, minP = .04 } = ev.data;
  try {
    if (!E) { loading = loading || load(v); await loading; }
    const H = E.H, root = { kids: [] }; let calls = 0, last = 0;
    const post = done => { const t = Date.now(); if (done || t - last > 400) { last = t; postMessage({ id, root, calls, done }); } };
    const legal = s => { const L = new Uint8Array(H).fill(1); for (const h of s.bans) L[h] = 0; return L; };
    function grow(node, s) {                               // their bans until your next turn, then your best next ban
      const e = s.bans.length; if (e >= 6) return;
      if (E.ours(s.firstUs, e)) {
        const R = E.ourTurn(s); calls++; if (!R) return;
        const two = e + 1 < 6 && E.ours(s.firstUs, e + 1);
        if (two) { const Q = E.sequence(s, R); calls++; if (Q) node.kids.push({ hs: [Q.a, Q.b], who: "us", V: Q.V, bans: s.bans.concat([Q.a, Q.b]), kids: [] }); }   // the advice, one ban at a time
        else node.kids.push({ hs: [R.best], who: "us", V: R.V[R.best], bans: s.bans.concat([R.best]), kids: [] });
        post(false); return;
      }
      const L = legal(s), p = E.banProbs(s, e, L), order = Array.from(p.keys()).filter(h => L[h]).sort((a, b) => p[b] - p[a]);
      const pick = order.slice(0, reply).filter((h, i) => i === 0 || p[h] >= minP);
      for (const h of pick) { const k = { hs: [h], who: "them", p: p[h], bans: s.bans.concat([h]), kids: [] }; node.kids.push(k); grow(k, Object.assign({}, s, { bans: s.bans.concat([h]) })); }
    }
    for (const o of opts) { const n = { hs: o.hs, who: "us", V: o.V, bans: base.bans.concat(o.hs), kids: [] }; root.kids.push(n); }
    for (const n of root.kids) grow(n, Object.assign({}, base, { bans: n.bans }));
    // the likeliest path after each option is marked as the main line
    const mark = n => { if (!n.kids.length) return; let m = n.kids[0]; for (const k of n.kids) if ((k.p || 1) > (m.p || 1)) m = k; m.main = true; n.kids.forEach(mark); };
    root.kids.forEach(mark); post(true);
  } catch (e) { postMessage({ id, error: String(e && e.stack || e) }); }
};
