/* The lobby's state and link (lobby-state.js), shared by the main page and the studio: a hover that gets banned stays shown
   for the model through a copied link and a reload, undo and a replacement hover behave the same in both, and a link cannot
   carry an impossible lobby (non-integers, duplicate bans or heroes, more than six bans, a gone hover that was not banned).
     node tools/check_state.js */
const LS = require("../lobby-state.js");
const ctx = { H: 47, tiers: { "Grandmaster 3": 4550, "Celestial 1": 5050 }, maps: new Set([...Array(21).keys()]), tier: "Grandmaster 3", map: 11 };
let bad = 0; const ok = (c, msg) => { if (!c) { bad++; console.log("  FAIL " + msg); } else console.log("  ok   " + msg); };
const base = () => Object.assign({ tier: "Grandmaster 3", map: 11, first: true }, LS.fresh());
const model = st => JSON.stringify(LS.lobby(st, ctx.tiers[st.tier]));
// a shown hero that gets banned, then a copied link and a reload
let st = base(); LS.hover(st, 0, 5); LS.hover(st, 2, 30); LS.ban(st, 12); LS.ban(st, 5);
const before = model(st), back = LS.decode(LS.encode(st), ctx);
ok(LS.shownOf(st, 0) === 5 && st.team[0] === -1, "a banned hover leaves the slot but stays shown");
ok(model(back) === before, "a link round trip keeps the model's input (your banned hover included)");
ok(JSON.stringify(back.bans) === "[12,5]", "bans keep their order");
// undo brings the hover back; a replacement hover replaces it
LS.unban(back); ok(back.team[0] === 5 && !back.gone.length, "undoing the ban brings the hover back");
const r = LS.decode(LS.encode(st), ctx); LS.hover(r, 0, 7); ok(LS.shownOf(r, 0) === 7 && !r.gone.some(g => g.i === 0), "a new hover replaces the banned one");
// the studio's extra keys ride along
const withX = LS.decode(LS.encode(st, { x: 1, n: 128 }), ctx); ok(model(withX) === before && new URLSearchParams(LS.encode(st, { x: 1, n: 128 }).slice(1)).get("n") === "128", "the studio's own keys do not disturb the lobby");
// impossible links are cleaned
const d = LS.decode("#t=Grandmaster+3&m=11&f=1&u=5,5,x,1.5,60,-&b=3,3,2.5,9,10,11,12,13,14&g=4:40,1:9", ctx);
ok(JSON.stringify(d.bans) === "[3,9,10,11,12,13]", "bans: integers only, no repeats, at most six, in order");
ok(JSON.stringify(d.team) === "[5,-1,-1,-1,-1,-1]", "hovers: integers in range, a hero in one slot only");
ok(d.gone.length === 1 && d.gone[0].i === 1 && d.gone[0].h === 9, "gone hovers: only banned heroes in empty slots");
const hb = LS.decode("#m=11&u=9,-,-,-,-,-&b=9", ctx); ok(hb.team[0] === -1 && LS.shownOf(hb, 0) === 9, "a hover that is also banned (an old link) becomes that slot's banned hover");
// map numbers: old links (no schema) meant K'un-Lun by 15, new ones mean God Quarry
ok(LS.decode("#m=15&u=-,-,-,-,-,-&b=", ctx).map === 16 && LS.decode("#m=15&s=8&u=-,-,-,-,-,-&b=", ctx).map === 15, "map 15: remapped only in links from before the schema");
ok(LS.decode("#m=99", ctx).map === 11 && LS.decode("#m=abc", ctx).map === 11, "an unknown map falls back to the default");
console.log(bad ? `${bad} state check(s) FAILED` : "all state checks passed"); process.exit(bad ? 1 : 0);
