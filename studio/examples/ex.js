/* Shared loader for the example pages: the lobby's model output (data.json, built by build_data.js) and small helpers. */
window.EX = (async function () {
  const [D, PORT] = await Promise.all([fetch("data.json").then(r => r.json()), fetch("../../model/portraits.json").then(r => r.json())]);
  const N = D.heroes, SHORT = { "Deadpool (Duelist)": "Deadpool D", "Deadpool (Vanguard)": "Deadpool V", "Deadpool (Strategist)": "Deadpool S", "Gorr The God Butcher": "Gorr",
    "Captain America": "Cap", "Devil Dinosaur": "Devil Dino", "Rocket Raccoon": "Rocket", "Elsa Bloodstone": "Elsa", "Doctor Strange": "Dr. Strange", "Jeff The Land Shark": "Jeff" };
  const tierName = D.lobby.tier, mapName = D.lobby.mapName.replace(" · ", " (") + ")";
  document.querySelectorAll("[data-lobby]").forEach(el => el.textContent = `${tierName}, ${mapName}. Your team bans first, you play ${N[D.lobby.you]}. Ban 1 of 6.`);
  return {
    D, N, img: h => `../../img/heroes/${PORT[N[h]]}.webp`, short: h => SHORT[N[h]] || N[h],
    pp: (x, d = 2) => (x >= 0 ? "+" : "−") + Math.abs(100 * x).toFixed(d), pct: (x, d = 0) => (100 * x).toFixed(d) + "%",
    esc: s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])),
    diffs: h => D.sim.runs[h].map((v, j) => v - D.sim.base[j]),
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
})();
