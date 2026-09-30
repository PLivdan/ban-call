/* The lobby the page sends to the model, and its link.
   A lobby: rank tier, map, whether we ban first, the heroes our six slots hover now (team, -1 = none), the bans in order,
   and gone: hovers the bans removed ({i: slot, h: hero}). The model reads what each slot showed (shownOf), so a hover that
   gets banned still counts as shown; picking a new hover for that slot replaces it.
   Link keys: t tier, m map, f we ban first (1/0), u hovers by slot ("-" = none), b bans in order, g gone hovers as
   slot:hero, o the other team's heroes by seat when entered ("-" = not seen; only written when one is), s the schema (8). Links
   without s come from before God Quarry was on the menu, when map 15 was K'un-Lun. */
(function (root) {
  "use strict";
  const SCHEMA = 8;
  const fresh = () => ({ team: [-1, -1, -1, -1, -1, -1], bans: [], gone: [], them: [-1, -1, -1, -1, -1, -1] });
  const shownOf = (st, i) => st.team[i] >= 0 ? st.team[i] : (st.gone.find(g => g.i === i) || { h: -1 }).h;
  /* Parse a link. ctx: H (heroes), tiers (object with the tier names), maps (Set of valid map indices), and the defaults. Every
     value is checked: integers in range, bans unique and in order (at most 6), a hero in at most one slot, a hovered hero
     that is banned becomes that slot's gone hover, a gone hover must be banned and its slot empty. */
  function decode(hash, ctx) {
    const q = new URLSearchParams(String(hash || "").replace(/^#/, "")); if (!q.has("m")) return null;
    const int = x => (/^-?\d+$/.test(String(x).trim()) ? +x : NaN), okH = h => Number.isInteger(h) && h >= 0 && h < ctx.H, st = fresh();
    st.tier = q.get("t") && Object.prototype.hasOwnProperty.call(ctx.tiers, q.get("t")) ? q.get("t") : ctx.tier;   // own names only: "constructor" is not a tier
    let m = int(q.get("m")); if (!q.has("s") && m === 15 && ctx.maps.has(16)) m = 16;   // an old link: K'un-Lun was map 15 before God Quarry was added
    st.map = ctx.maps.has(m) ? m : ctx.map; st.first = q.get("f") !== "0";
    for (const x of (q.get("b") || "").split(",")) { const h = int(x); if (okH(h) && !st.bans.includes(h) && st.bans.length < 6) st.bans.push(h); }
    const tm = (q.get("u") || "").split(",").map(x => (x === "" || x === "-") ? -1 : int(x)), used = new Set();
    for (let i = 0; i < 6; i++) {
      const h = tm[i]; if (!okH(h) || used.has(h)) continue; used.add(h);
      if (st.bans.includes(h)) st.gone.push({ i, h }); else st.team[i] = h;
    }
    for (const x of (q.get("g") || "").split(",")) {
      const [i, h] = x.split(":").map(int);
      if (Number.isInteger(i) && i >= 0 && i < 6 && okH(h) && st.bans.includes(h) && st.team[i] < 0 && !used.has(h) && !st.gone.some(g => g.i === i)) { used.add(h); st.gone.push({ i, h }); }
    }
    const ot = (q.get("o") || "").split(",").map(x => (x === "" || x === "-") ? -1 : int(x));   // the other team: a hero at most once, never a banned one
    for (let i = 0; i < 6; i++) { const h = ot[i]; if (okH(h) && !st.bans.includes(h) && !st.them.includes(h)) st.them[i] = h; }
    return st;
  }
  function encode(st, extra) {
    const q = new URLSearchParams(Object.assign({ t: st.tier, m: st.map, f: st.first ? 1 : 0, u: st.team.map(h => h < 0 ? "-" : h).join(","), b: st.bans.join(",") }, extra || {}));
    if (st.gone.length) q.set("g", st.gone.map(g => `${g.i}:${g.h}`).join(","));
    if (st.them && st.them.some(h => h >= 0)) q.set("o", st.them.map(h => h < 0 ? "-" : h).join(","));
    q.set("s", SCHEMA); return "#" + q.toString();
  }
  /* Edits. hover: slot i now hovers h (h leaves any other slot; slot i's gone hover is replaced). ban: h is banned; a slot hovering
     it keeps it as gone. unban: the last ban is undone, and its hover comes back if the slot is still empty. */
  function hover(st, i, h) { for (let k = 0; k < 6; k++) if (st.team[k] === h) st.team[k] = -1; st.gone = st.gone.filter(g => g.i !== i); st.team[i] = h; }
  function clearSlot(st, i) { st.team[i] = -1; st.gone = st.gone.filter(g => g.i !== i); }
  function ban(st, h) {
    if (st.bans.length >= 6 || st.bans.includes(h)) return false;
    for (let k = 0; k < 6; k++) if (st.team[k] === h) { st.team[k] = -1; st.gone.push({ i: k, h }); }
    if (st.them) for (let k = 0; k < 6; k++) if (st.them[k] === h) st.them[k] = -1;   // a banned hero cannot be on their team
    st.bans.push(h); return true;
  }
  function unban(st) {
    if (!st.bans.length) return -1; const h = st.bans.pop(), g = st.gone.findIndex(x => x.h === h);
    if (g >= 0) { const x = st.gone[g]; st.gone.splice(g, 1); if (st.team[x.i] < 0) st.team[x.i] = x.h; }
    return h;
  }
  /* What the model reads: map, rank score, side, bans, your shown hero and your teammates' (mates6: by slot, for the simulator), and
     the other team's heroes where you entered them (them6, for the simulator; the value networks do not read it). */
  function lobby(st, r0) {
    const sh = [0, 1, 2, 3, 4, 5].map(i => shownOf(st, i));
    return { m: st.map, r0, firstUs: st.first, bans: st.bans.slice(), you: sh[0], mates: sh.slice(1).filter(h => h >= 0), mates6: sh.slice(1),
             them6: (st.them || [-1, -1, -1, -1, -1, -1]).slice() };
  }
  const LobbyState = { SCHEMA, fresh, shownOf, decode, encode, hover, clearSlot, ban, unban, lobby };
  root.LobbyState = LobbyState;
  if (typeof module !== "undefined") module.exports = LobbyState;
})(typeof window !== "undefined" ? window : globalThis);
