import { estimateDamage, moveInfo, spriteIdFor } from './calc.js';

const TYPE_COLORS = {
  Normal: '#a8a77a', Fire: '#ee8130', Water: '#6390f0', Electric: '#f7d02c',
  Grass: '#7ac74c', Ice: '#96d9d6', Fighting: '#c22e28', Poison: '#a33ea1',
  Ground: '#e2bf65', Flying: '#a98ff3', Psychic: '#f95587', Bug: '#a6b91a',
  Rock: '#b6a136', Ghost: '#735797', Dragon: '#6f35fc', Dark: '#705746',
  Steel: '#b7b7ce', Fairy: '#d685ad', Stellar: '#40b5a5', '???': '#68a090',
};
const RETRY_MS = 30 * 1000;

const state = {
  snap: null,
  targetKey: null, // team member the user picked (by ident, stable across switches)
  userPicked: false,
  teamSig: '',
  collapsed: false,
  docked: false,
  usage: new Map(), // "format|gameType|species" -> { status: 'loading'|'ok'|'none'|'error', data, t }
};

// ---------- panel skeleton ----------
const panel = document.createElement('div');
panel.id = 'smh-panel';
panel.innerHTML = `
  <div class="smh-header">
    <span class="smh-title">Enemy top moves</span>
    <button id="smh-toggle" type="button" title="Collapse panel">–</button>
  </div>
  <div class="smh-target">
    <div class="smh-target-label">Damage vs</div>
    <img id="smh-target-sprite" alt="">
    <select id="smh-target"></select>
  </div>
  <div class="smh-body" id="smh-body"></div>`;
panel.style.display = 'none';
document.documentElement.appendChild(panel);

const body = panel.querySelector('#smh-body');
const select = panel.querySelector('#smh-target');
const targetSprite = panel.querySelector('#smh-target-sprite');
const toggleBtn = panel.querySelector('#smh-toggle');

select.addEventListener('change', () => {
  state.targetKey = select.value;
  state.userPicked = true;
  render();
});
toggleBtn.addEventListener('click', () => {
  state.collapsed = !state.collapsed;
  panel.classList.toggle('smh-collapsed', state.collapsed);
  toggleBtn.textContent = state.collapsed ? '+' : '–';
  toggleBtn.title = state.collapsed ? 'Expand panel' : 'Collapse panel';
  updateDock();
});

// Sprite fallback chain: each <img data-fallbacks="url|url"> walks to the next on error.
panel.addEventListener(
  'error',
  (ev) => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.fallbacks) return;
    const [next, ...rest] = img.dataset.fallbacks.split('|');
    img.dataset.fallbacks = rest.join('|');
    if (next) img.src = next;
    else img.style.visibility = 'hidden';
  },
  true
);

// Squeeze Showdown into the left 3/4 so the battle and turn log stay visible.
// panel.css narrows <body>; page-hook.js (MAIN world) sees the class change, makes
// Showdown's layout code measure the narrower viewport and fires a resize.
function updateDock() {
  const want = panel.style.display !== 'none' && !state.collapsed;
  if (want === state.docked) return;
  state.docked = want;
  document.documentElement.classList.toggle('smh-docked', want);
}

// ---------- helpers ----------
const SPRITES = 'https://play.pokemonshowdown.com/sprites';
function spriteUrls(mon, gen) {
  const id = mon.spriteid || spriteIdFor(mon.species, gen);
  return [
    `${SPRITES}/home-centered/${id}.png`, // what Showdown itself uses for gen 8+
    `${SPRITES}/dex/${id}.png`,
    `${SPRITES}/gen5/${id}.png`,
  ];
}

function spriteImg(cls, mon, gen) {
  const [first, ...rest] = spriteUrls(mon, gen);
  return `<img class="${cls}" alt="${esc(mon.species)}" src="${esc(first)}" data-fallbacks="${esc(rest.join('|'))}">`;
}

function setSprite(img, mon, gen) {
  const [first, ...rest] = spriteUrls(mon, gen);
  if (img.dataset.src === first) return;
  img.dataset.src = first;
  img.dataset.fallbacks = rest.join('|');
  img.style.visibility = 'visible';
  img.src = first;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function requestUsage(snap, species) {
  const key = `${snap.format}|${snap.gameType}|${species}`;
  const cached = state.usage.get(key);
  if (cached && !(cached.status === 'error' && Date.now() - cached.t > RETRY_MS)) return cached;
  const entry = { status: 'loading', data: null, t: Date.now() };
  state.usage.set(key, entry);
  const done = (status, data = null) => {
    entry.status = status;
    entry.data = data;
    entry.t = Date.now();
    render();
  };
  try {
    chrome.runtime.sendMessage(
      { type: 'usage', format: snap.format, gameType: snap.gameType, species },
      (res) => {
        if (chrome.runtime.lastError || !res) done('error');
        else if (res.ok) done('ok', res.data);
        else done(res.error ? 'error' : 'none');
      }
    );
  } catch (e) {
    // Extension was reloaded/updated: this content script is orphaned.
    entry.status = 'error';
  }
  return entry;
}

// ---------- rendering ----------
function pickTarget(team) {
  const keys = team.map((m) => m.key);
  if (state.userPicked && keys.includes(state.targetKey)) return;
  // Default (until the user picks): our first active, non-fainted Pokemon.
  const def = team.find((m) => m.active && !m.fainted) || team.find((m) => !m.fainted) || team[0];
  state.targetKey = def ? def.key : null;
  state.userPicked = false;
}

function renderTargets(snap) {
  const team = snap.team;
  pickTarget(team);
  const sig = JSON.stringify(team.map((m) => [m.key, m.species, m.fainted]));
  if (sig !== state.teamSig) {
    // Rebuild options only when the team changes, so an open dropdown isn't closed.
    state.teamSig = sig;
    select.innerHTML = team
      .map((m) => `<option value="${esc(m.key)}">${esc(m.species)}${m.fainted ? ' (fainted)' : ''}</option>`)
      .join('');
  }
  if (state.targetKey !== null && select.value !== state.targetKey) select.value = state.targetKey;
  const member = team.find((m) => m.key === state.targetKey) || null;
  if (member) setSprite(targetSprite, member, snap.gen);
  targetSprite.style.visibility = member ? 'visible' : 'hidden';
  select.disabled = !team.length;
  return member;
}

function renderMove(snap, enemy, member, { move }) {
  const d = member
    ? estimateDamage(snap, enemy, move, member)
    : { ...moveInfo(snap.gen, move), text: '', ko: '' };
  const color = TYPE_COLORS[d.type] || TYPE_COLORS['???'];
  const name = d.name || move;
  const dmg = [d.text, d.ko].filter(Boolean).join(' · ');
  return `<div class="smh-move">
    <span class="smh-mname" style="background:${color}" title="${esc(name)} (${esc(d.type)})">${esc(name)}</span>
    <div class="smh-dmg" title="${esc(dmg)}">
      <span class="smh-dmg-main${d.canKO ? ' smh-ko' : ''}">${esc(d.text)}</span>
    </div>
  </div>`;
}

function renderCard(snap, enemy, member) {
  const usage = requestUsage(snap, enemy.species);
  let rows;
  let src = ''; // shows which Pikalytics format was used when it isn't the battle's own
  if (usage.status === 'loading') {
    rows = '<div class="smh-note">Fetching Pikalytics…</div>';
  } else if (usage.status !== 'ok') {
    rows = `<div class="smh-note">${
      usage.status === 'error' ? 'Pikalytics unavailable' : `No usage data for ${esc(snap.format || 'this format')}`
    }</div>`;
  } else {
    if (usage.data.format !== snap.format) src = ` <span class="smh-src">(${esc(usage.data.format)})</span>`;
    rows = `<div class="smh-moves">${usage.data.moves.map((m) => renderMove(snap, enemy, member, m)).join('')}</div>`;
  }
  return `<div class="smh-card">
    ${spriteImg('smh-sprite', enemy, snap.gen)}
    <div class="smh-name">${esc(enemy.species)}${src}</div>
    ${rows}
  </div>`;
}

function render() {
  const snap = state.snap;
  if (!snap) {
    panel.style.display = 'none';
    updateDock();
    return;
  }
  panel.style.display = '';
  updateDock();
  const member = renderTargets(snap);
  body.innerHTML = snap.enemy.length
    ? snap.enemy.map((e) => renderCard(snap, e, member)).join('')
    : '<div class="smh-note">Waiting for the opponent’s active Pokémon…</div>';
}

window.addEventListener('message', (ev) => {
  if (ev.source !== window || ev.origin !== location.origin) return;
  if (!ev.data || ev.data.source !== 'smh') return;
  state.snap = ev.data.snapshot || null;
  render();
});
