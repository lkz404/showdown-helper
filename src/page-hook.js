// Runs in the page's MAIN world so it can read Showdown's client globals.
// Posts a compact battle snapshot to the isolated content script, and makes
// Showdown lay itself out for the left 75% of the window while the panel is docked.
//
// Supports both clients served on play.pokemonshowdown.com:
//  - old client (default): window.app, app.curRoom / app.curSideRoom (BattleRoom)
//  - new Preact client (preactalpha cookie): global PS, PS.room / leftPanel / rightPanel
// In both, a battle room has `.battle` (src/battle.ts Battle) and `.request`
// (the server's raw request JSON, with side.pokemon[]).

const toID = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ORIGIN = location.origin;
const DOCK_FRACTION = 0.75; // keep in sync with panel.css (75vw / 25vw)
let lastJSON = '';

// ---------- docking: make Showdown's layout code see a narrower viewport ----------
// Both clients size their panels from document.documentElement.clientWidth
// (old client via jQuery $(window).width(), new client directly), so squeezing
// <body> with CSS alone leaves the two-panel layout computed for the full window.
// While docked we shadow clientWidth / innerWidth on the instances so Showdown
// computes its layout for 75% of the viewport, then fire a resize.
const de = document.documentElement;
const cwDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
const iwOwn = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const iwDesc = iwOwn || Object.getOwnPropertyDescriptor(Window.prototype, 'innerWidth');
const realClientWidth = () => cwDesc.get.call(de);
const realInnerWidth = () => (iwDesc && iwDesc.get ? iwDesc.get.call(window) : realClientWidth());
let docked = false;

function setDocked(want) {
  if (want === docked) return;
  docked = want;
  try {
    if (want) {
      const dockedWidth = () => Math.floor(realInnerWidth() * DOCK_FRACTION);
      Object.defineProperty(de, 'clientWidth', {
        configurable: true,
        get: () => Math.min(realClientWidth(), dockedWidth()),
      });
      Object.defineProperty(window, 'innerWidth', { configurable: true, get: dockedWidth });
    } else {
      delete de.clientWidth; // falls back to the Element.prototype getter
      if (iwOwn) Object.defineProperty(window, 'innerWidth', iwOwn);
      else delete window.innerWidth;
    }
  } catch (e) {
    /* layout still works via the CSS squeeze, just less precisely */
  }
  window.dispatchEvent(new Event('resize'));
}

new MutationObserver(() => setDocked(de.classList.contains('smh-docked'))).observe(de, {
  attributes: true,
  attributeFilter: ['class'],
});
setDocked(de.classList.contains('smh-docked'));

// ---------- battle snapshot ----------
function getPS() {
  if (window.PS) return window.PS;
  try {
    // eslint-disable-next-line no-undef
    return typeof PS !== 'undefined' ? PS : null; // top-level `const PS` is not a window property
  } catch (e) {
    return null;
  }
}

function findBattleRoom() {
  const app = window.app;
  if (app && (app.curRoom || app.curSideRoom)) {
    for (const r of [app.curRoom, app.curSideRoom]) if (r && r.battle) return r;
    return null;
  }
  const ps = getPS();
  if (ps) {
    for (const r of [ps.room, ps.leftPanel, ps.rightPanel]) if (r && r.battle) return r;
  }
  return null;
}

// Showdown's own sprite id (battle-dex-data.ts Species.spriteid), if Dex is reachable.
function spriteId(species) {
  try {
    const s = window.Dex && window.Dex.species && window.Dex.species.get(species);
    return (s && s.exists !== false && s.spriteid) || '';
  } catch (e) {
    return '';
  }
}

function parseCondition(cond) {
  // "123/200 par" | "0 fnt" | "100/100"
  const m = String(cond || '').match(/^(\d+)(?:\/(\d+))?\s*(\w+)?/);
  if (!m) return { hp: 0, maxhp: 0, status: '', fainted: false };
  return {
    hp: +m[1],
    maxhp: m[2] ? +m[2] : +m[1],
    status: m[3] && m[3] !== 'fnt' ? m[3] : '',
    fainted: m[3] === 'fnt' || +m[1] === 0,
  };
}

function readEnemy(battle) {
  const side = battle.farSide;
  if (!side) return [];
  const out = [];
  for (const mon of side.active || []) {
    if (!mon || mon.fainted || !mon.speciesForme) continue;
    out.push({
      species: mon.speciesForme,
      spriteid: spriteId(mon.speciesForme),
      level: mon.level || 100,
      status: mon.status || '',
      boosts: mon.boosts || {},
      ability: mon.ability || '',
      item: mon.item || '',
      tera: mon.terastallized || '',
    });
  }
  return out;
}

function readTeam(room, battle) {
  const req = room.request && room.request.side && room.request.side.pokemon;
  if (req && req.length) {
    return req.map((p) => {
      const details = String(p.details || '');
      const species = details.split(',')[0].trim();
      const lvl = (details.match(/, L(\d+)/) || [])[1];
      const c = parseCondition(p.condition);
      return {
        key: p.ident || species,
        species,
        spriteid: spriteId(species),
        level: lvl ? +lvl : 100,
        stats: { hp: c.maxhp, ...(p.stats || {}) },
        curHP: c.hp,
        status: c.status,
        fainted: c.fainted,
        active: !!p.active,
        item: p.item && p.item !== 'none' ? p.item : '',
        ability: p.ability || p.baseAbility || '',
        tera: p.terastallized || '',
      };
    });
  }
  // Spectating (or no request yet): only what has been revealed on our side.
  const mine = battle.mySide && battle.mySide.pokemon;
  if (!mine) return [];
  const active = new Set(battle.mySide.active || []);
  return mine.map((p, i) => ({
    key: `${p.ident || p.name || ''}|${i}`,
    species: p.speciesForme,
    spriteid: spriteId(p.speciesForme),
    level: p.level || 100,
    stats: null, // unknown: calc falls back to a neutral spread
    curHP: p.hp,
    status: p.status || '',
    fainted: !!p.fainted,
    active: active.has(p),
    item: p.item || '',
    ability: p.ability || '',
    tera: p.terastallized || '',
  }));
}

// Room ids look like "battle-gen9vgc2026regf-123456[-password]"; that segment is the
// canonical format id. battle.tier ("[Gen 9] VGC 2026 Reg F") is the fallback.
function formatOf(room, battle) {
  const seg = String(room.id || room.roomid || battle.roomid || '').split('-')[1] || '';
  if (/^gen\d/.test(seg)) return seg;
  return toID(battle.tier) || seg;
}

function snapshot() {
  const room = findBattleRoom();
  const battle = room && room.battle;
  if (!battle || !battle.farSide) return null;

  const pseudo = (battle.pseudoWeather || []).map((w) => (Array.isArray(w) ? w[0] : w));
  const terrain = pseudo.find((n) => /terrain/i.test(n)) || '';

  return {
    roomid: room.id || room.roomid || '',
    format: formatOf(room, battle),
    gen: battle.gen || 9,
    gameType: battle.gameType || 'singles',
    weather: battle.weather || '',
    terrain,
    enemy: readEnemy(battle),
    team: readTeam(room, battle),
    // Showdown plays its step queue (move animations included) and sets atQueueEnd once
    // every queued step has finished animating and it is waiting for the next input.
    // While paused (e.g. a replay before Play) nothing is animating either.
    settled: !!(battle.atQueueEnd || battle.paused) && battle.seeking == null,
  };
}

// Hold the panel on its last snapshot while Showdown is still animating, so enemy
// switches, field changes and our HP only show up after the move animation finishes.
const SETTLE_TIMEOUT_MS = 20000; // safety net in case the flags ever stay unsettled
let lastRoom = null;
let unsettledSince = 0;

function tick() {
  let snap = null;
  try {
    snap = snapshot();
  } catch (e) {
    snap = null;
  }
  if (snap && !snap.settled && lastRoom === snap.roomid && lastJSON !== 'null') {
    unsettledSince = unsettledSince || Date.now();
    if (Date.now() - unsettledSince < SETTLE_TIMEOUT_MS) return;
  }
  unsettledSince = 0;
  if (snap) delete snap.settled;
  const json = JSON.stringify(snap);
  if (json === lastJSON) return;
  lastJSON = json;
  lastRoom = snap ? snap.roomid : null;
  window.postMessage({ source: 'smh', snapshot: snap }, ORIGIN);
}

setInterval(tick, 500);
tick();
