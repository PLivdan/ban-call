// Builds the "what comes next" tree off the main thread: your best options now, the other team's likeliest replies
// (ban model), and the best ban left for your next turn (ban value model). Posts a snapshot after every scored position.
importScripts("../engine.js" + self.location.search);
let E = null, META = null;
const ready = Promise.all([fetch("../model/meta.json").then(r => r.json()), fetch("../model/weights.bin").then(r => r.arrayBuffer())])
  .then(([m, w]) => { META = m; E = new BanEngine(m, w, m.engine ? { NS: m.engine.ns, NOWN: m.engine.nown, SHORT: m.engine.short } : {}); });
onmessage = async ev => {
  await ready;
  const { id, base, opts } = ev.data, ORDER = META.ban_order, ours = i => (ORDER[i] === 0) === base.firstUs, widths = [3, 2, 2, 2];
  const root = { kids: opts.map(o => ({ who: "us", hs: o.hs, V: o.V, bans: base.bans.concat(o.hs), kids: null, main: true })) };
  const queue = root.kids.slice(); let calls = 0;
  const snap = done => postMessage({ id, root, calls, done });
  snap(false);
  while (queue.length) {
    const n = queue.shift(), e1 = n.bans.length;
    if (e1 >= 6) { n.kids = []; continue; }
    if (!ours(e1)) {                                         // their ban: branch on their likeliest
      const lvl = n.who === "us" ? 0 : n.lvl + 1, s = Object.assign({}, base, { bans: n.bans, cnt: 1 }), res = E.values(s), P = E.theirNextBan(s, res);
      n.kids = Array.from(P.keys()).filter(h => P[h] > 0).sort((a, b) => P[b] - P[a]).slice(0, widths[lvl] || 2)
        .map((h, k) => ({ who: "them", hs: [h], p: P[h], lvl, bans: n.bans.concat([h]), kids: null, main: n.main && k === 0 }));
      queue.push(...n.kids);
    } else if (n.who === "them") {                           // our next turn: the best ban, or pair, left
      const c2 = e1 + 1 < 6 && ours(e1 + 1) ? 2 : 1, s = Object.assign({}, base, { bans: n.bans, cnt: c2 }), res = E.values(s), p = c2 === 2 && res.pairs && res.pairs[0];
      const b = p ? null : Array.from(res.V.keys()).filter(h => !isNaN(res.V[h])).sort((a, c) => res.V[c] - res.V[a])[0];
      n.kids = [p ? { who: "us", hs: [p.a, p.b], V: p.V, kids: [], main: n.main } : { who: "us", hs: [b], V: res.V[b], kids: [], main: n.main }];
    } else n.kids = [];
    calls++; snap(false);
  }
  snap(true);
};
