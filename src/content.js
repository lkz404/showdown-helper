import { estimateDamage, megaInfo, moveInfo, spriteIdFor, withPasteStats } from './calc.js';
import { typeIcon } from './type-icons.js';

// Each type's colour is a token in panel.css (--type-fire, ...); anything else uses --type-unknown.
const KNOWN_TYPES = new Set(['normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy', 'stellar']);
function typeToken(type) {
  const t = String(type || '').toLowerCase();
  return `var(--type-${KNOWN_TYPES.has(t) ? t : 'unknown'})`;
}
const RETRY_MS = 30 * 1000;

const state = {
  snap: null,
  targetKey: null, // team member the user picked (by ident, stable across switches)
  userPicked: false,
  teamSig: '',
  collapsed: false,
  docked: false,
  mega: new Map(), // "room|species" -> mega forme the user switched an enemy to
  paste: null, // imported team { link, sets }, written by the toolbar popup into chrome.storage.local
  usage: new Map(), // "format|gameType|species" -> { status: 'loading'|'ok'|'none'|'error', data, t }
};

// ---------- panel skeleton ----------
const panel = document.createElement('div');
panel.id = 'smh-panel';
panel.dataset.theme = 'smh-sheet'; // panel.css scopes its tokens to this block
panel.innerHTML = `
  <div class="smh-header">
    <span class="smh-title">Enemy top moves</span>
    <button id="smh-toggle" type="button" title="Collapse panel" aria-label="Collapse panel" aria-expanded="true">−</button>
  </div>
  <div class="smh-target">
    <div class="smh-target-head">
      <div class="smh-target-label">Damage vs</div>
      <div class="smh-stages" id="smh-tstages"></div>
    </div>
    <div class="smh-team" id="smh-team"></div>
  </div>
  <div class="smh-body" id="smh-body"></div>`;
panel.style.display = 'none';
document.documentElement.appendChild(panel);

const body = panel.querySelector('#smh-body');
const teamEl = panel.querySelector('#smh-team');
const toggleBtn = panel.querySelector('#smh-toggle');
const targetLabel = panel.querySelector('.smh-target-label');
const targetStages = panel.querySelector('#smh-tstages');

// The imported team comes from the toolbar popup; follow it live.
try {
  chrome.storage.local.get('smh_paste', (r) => {
    state.paste = (r && r.smh_paste) || null;
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.smh_paste) return;
    state.paste = changes.smh_paste.newValue || null;
    render();
  });
} catch (e) {
  /* extension reloaded: orphaned script */
}

teamEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-key]');
  if (!btn) return;
  state.targetKey = btn.dataset.key;
  state.userPicked = true;
  render();
});
toggleBtn.addEventListener('click', () => {
  state.collapsed = !state.collapsed;
  panel.classList.toggle('smh-collapsed', state.collapsed);
  toggleBtn.textContent = state.collapsed ? '+' : '−';
  toggleBtn.title = state.collapsed ? 'Expand panel' : 'Collapse panel';
  toggleBtn.setAttribute('aria-label', toggleBtn.title);
  toggleBtn.setAttribute('aria-expanded', String(!state.collapsed));
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
    // Extension was reloaded/updated: this content script is orphaned and can never reach the
    // extension again, so say so instead of sitting on 'Fetching Pikalytics…'.
    entry.status = 'orphaned'; // the render that asked shows it
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

// Stat stages the damage numbers already include, e.g. 'Atk +1', 'Def −2' (a real minus sign).
const STAT_NAMES = { atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD' };
function stageChips(b, keys) {
  return keys
    .filter((k) => b && Number.isFinite(b[k]) && b[k] !== 0)
    .map((k) => `<span class="smh-stage" title="${STAT_NAMES[k]} ${b[k] > 0 ? 'raised' : 'lowered'} ${Math.abs(b[k])} stage${Math.abs(b[k]) > 1 ? 's' : ''}, included in the damage">${STAT_NAMES[k]} ${b[k] > 0 ? '+' : '−'}${Math.abs(b[k])}</span>`)
    .join('');
}

function hpClass(frac) {
  return frac > 0.5 ? 'smh-hp-ok' : frac > 0.2 ? 'smh-hp-mid' : 'smh-hp-low';
}

function teamBox(m, snap) {
  const frac = m.maxhp ? Math.max(0, Math.min(1, m.curHP / m.maxhp)) : m.fainted ? 0 : 1;
  const cls = ['smh-tbox', m.key === state.targetKey ? 'smh-selected' : '', m.fainted ? 'smh-fainted' : '']
    .filter(Boolean)
    .join(' ');
  return `<button type="button" class="${cls}" data-key="${esc(m.key)}" aria-pressed="${m.key === state.targetKey}" title="${esc(m.species)}">
    ${spriteImg('smh-tsprite', m, snap.gen)}
    <span class="smh-tname">${esc(m.species)}</span>
    <span class="smh-hpbar"><span class="${hpClass(frac)}" style="width:${Math.round(frac * 100)}%"></span></span>
  </button>`;
}

// The target boxes (like Showdown's own team buttons). Returns the picked member, or null
// until the battle has started and the player's Pokemon are chosen.
function renderTargets(snap) {
  if (!snap.started) {
    state.teamSig = '';
    targetLabel.textContent = 'Damage vs';
    teamEl.innerHTML = '<div class="smh-note">Damage appears once the battle starts</div>';
    targetStages.innerHTML = '';
    return null;
  }
  const sets = state.paste ? state.paste.sets : [];
  const team = sets.length ? snap.team.map((m) => withPasteStats(snap, m, sets)) : snap.team;
  pickTarget(team);
  // Rebuild only when something shown changes, so a click is never lost to a re-render.
  const sig = JSON.stringify([state.targetKey, team.map((m) => [m.key, m.species, m.fainted, m.curHP, m.maxhp])]);
  if (sig !== state.teamSig) {
    state.teamSig = sig;
    teamEl.style.setProperty('--cols', String(team.length > 4 ? 3 : Math.max(team.length, 1)));
    teamEl.innerHTML = team.map((m) => teamBox(m, snap)).join('');
  }
  targetLabel.textContent = team.some((m) => m.fromPaste) ? 'Damage vs your Pokepaste stats' : 'Damage vs';
  const picked = team.find((m) => m.key === state.targetKey) || null;
  targetStages.innerHTML = picked ? stageChips(picked.boosts, ['def', 'spd']) : '';
  return picked;
}

// Types dark enough that their swatch takes a white glyph; every other type takes navy (the higher contrast of the two).
const DARK_TYPES = new Set(['Fighting', 'Poison', 'Ghost', 'Dragon', 'Dark']);

function renderMove(snap, enemy, member, { move, pct }) {
  const d = member
    ? estimateDamage(snap, enemy, move, member)
    : { ...moveInfo(snap.gen, move), text: '', ko: '' };
  const color = typeToken(d.type);
  const name = d.name || move;
  const icon = typeIcon(d.type);
  const usage = Number.isFinite(pct) ? `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}% usage` : '';
  const dmg = [d.text, d.ko].filter(Boolean).join(' · ');
  const cls = ['smh-move', DARK_TYPES.has(d.type) ? '' : 'smh-light', d.text === '—' ? 'smh-status' : '', d.canKO ? 'smh-ko' : '', d.text === '0%' ? 'smh-zero' : '']
    .filter(Boolean)
    .join(' ');
  return `<div class="${cls}" style="--c:${color}" title="${esc(name)} (${esc(d.type)})${dmg ? ' · ' + esc(dmg) : ''}">
    <span class="smh-ticon">${icon}</span>
    <div class="smh-mtext">
      <div class="smh-nameline"><span class="smh-mname">${esc(name)}</span>${d.canKO ? '<span class="smh-kotag">KO</span>' : ''}</div>
      ${usage ? `<span class="smh-usage">${usage}</span>` : ''}
    </div>
    <span class="smh-dmg">${esc(d.text)}</span>
  </div>`;
}

// Applies the Mega toggle: an enemy the user switched to its Mega forme is shown, looked up
// on Pikalytics and calculated as that forme. One already mega evolved in the battle is locked on.
function applyMega(snap, enemy) {
  const info = megaInfo(snap.gen, enemy.species);
  if (!info.formes.length) return { enemy, info, chosen: '', locked: false, key: '' };
  const key = `${snap.roomid}|${enemy.species}`;
  if (info.isMega) return { enemy, info, chosen: enemy.species, locked: true, key };
  const chosen = state.mega.get(key) || '';
  if (!chosen) return { enemy, info, chosen, locked: false, key };
  // The Mega forme brings its own ability, so drop the base forme's.
  return { enemy: { ...enemy, species: chosen, spriteid: undefined, ability: '' }, info, chosen, locked: false, key };
}

function megaButtons(m) {
  if (!m.info.formes.length) return '';
  const buttons = m.info.formes
    .map((f) => {
      const label = `Mega ${f.replace(/^.*?-Mega-?/, '')}`.trim();
      return `<button type="button" class="smh-mega" data-key="${esc(m.key)}" data-forme="${esc(f)}" aria-pressed="${m.chosen === f}"${m.locked ? ' disabled' : ''} title="${m.locked ? 'Already Mega evolved' : 'Show this Pokémon as its Mega form'}">${esc(label)}</button>`;
    })
    .join('');
  return `<div class="smh-megas">${buttons}</div>`;
}

body.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button.smh-mega');
  if (!btn || btn.disabled) return;
  const { key, forme } = btn.dataset;
  if (state.mega.get(key) === forme) state.mega.delete(key);
  else state.mega.set(key, forme);
  render();
});

function renderCard(snap, baseEnemy, member) {
  const m = applyMega(snap, baseEnemy);
  const enemy = m.enemy;
  const usage = requestUsage(snap, enemy.species);
  let rows;
  let src = ''; // shows which Pikalytics format was used when it isn't the battle's own
  if (usage.status === 'loading') {
    // The sheet's five rows, ruled and empty, until Pikalytics answers.
    const ghost = '<div class="smh-move"><span class="smh-ticon"></span></div>';
    rows = `<div class="smh-moves smh-skel" aria-busy="true"><div class="smh-move"><span class="smh-ticon"></span><span class="smh-note">Fetching Pikalytics…</span></div>${ghost.repeat(4)}</div>`;
  } else if (usage.status !== 'ok') {
    rows = `<div class="smh-note">${
      usage.status === 'orphaned' ? 'Showdown Helper was updated. Reload this tab to see moves again.' : usage.status === 'error' ? 'Pikalytics unavailable' : `No usage data for ${esc(snap.format || 'this format')}`
    }</div>`;
  } else {
    if (usage.data.format !== snap.format) src = `<span class="smh-src">(${esc(usage.data.format)})</span>`;
    rows = `<div class="smh-moves">${usage.data.moves.map((m) => renderMove(snap, enemy, member, m)).join('')}</div>`;
  }
  const chips = stageChips(enemy.boosts, ['atk', 'spa']);
  const stages = chips ? `<span class="smh-stages">${chips}</span>` : '';
  return `<div class="smh-card">
    <div class="smh-chead">
      ${spriteImg('smh-sprite', enemy, snap.gen)}
      <div class="smh-name"><span>${esc(enemy.species)}</span>${src}${stages}</div>
      ${megaButtons(m)}
    </div>
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
