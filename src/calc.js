import { calculate, Generations, Pokemon, Move, Field } from '@smogon/calc';

const WEATHER = {
  sunnyday: 'Sun',
  raindance: 'Rain',
  sandstorm: 'Sand',
  hail: 'Hail',
  snow: 'Snow',
  snowscape: 'Snow',
  desolateland: 'Harsh Sunshine',
  primordialsea: 'Heavy Rain',
  deltastream: 'Strong Winds',
};

const TERRAIN = {
  electricterrain: 'Electric',
  grassyterrain: 'Grassy',
  psychicterrain: 'Psychic',
  mistyterrain: 'Misty',
};

const STATUSES = new Set(['slp', 'psn', 'brn', 'frz', 'par', 'tox']);
const BOOST_KEYS = ['atk', 'def', 'spa', 'spd', 'spe'];

const toID = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function getGen(num) {
  const n = Math.min(Math.max(num || 9, 1), 9);
  return Generations.get(n);
}

// Showdown requests carry item/ability ids ("assaultvest"); calc compares display
// names ("Assault Vest"), so normalise everything through the calc's own dex.
function itemName(gen, item) {
  if (!item) return undefined;
  const it = gen.items.get(toID(item));
  return it ? it.name : undefined;
}
function abilityName(gen, ability) {
  if (!ability) return undefined;
  const ab = gen.abilities.get(toID(ability));
  return ab ? ab.name : undefined;
}
function typeName(gen, type) {
  if (!type) return undefined;
  const t = gen.types.get(toID(type));
  return t ? t.name : undefined;
}
const status = (s) => (STATUSES.has(s) ? s : undefined);
function boosts(b) {
  const out = {};
  for (const k of BOOST_KEYS) if (b && Number.isFinite(b[k]) && b[k]) out[k] = b[k];
  return out;
}

// Showdown sprite id for a species name (mirrors battle-dex-data.ts Species.spriteid):
// "Ho-Oh" -> "hooh", "Urshifu-Rapid-Strike" -> "urshifu-rapidstrike".
export function spriteIdFor(species, genNum = 9) {
  const id = toID(species);
  try {
    const s = getGen(genNum).species.get(id);
    if (s && s.baseSpecies && toID(s.baseSpecies) !== id) {
      const base = toID(s.baseSpecies);
      const forme = s.name.slice(s.baseSpecies.length).replace(/^-/, '');
      return `${base}-${toID(forme)}`;
    }
    if (s) return id;
  } catch (e) {
    /* fall through */
  }
  // Unknown to the calc: assume "Base-Forme" naming.
  const [base, ...rest] = String(species).split('-');
  return rest.length ? `${toID(base)}-${toID(rest.join(''))}` : id;
}

// Move info (type + category) without needing a defender.
export function moveInfo(genNum, moveName) {
  try {
    const m = new Move(getGen(genNum), moveName);
    if (!m.type) throw new Error('unknown move');
    return { name: m.name, type: m.type, category: m.category };
  } catch (e) {
    return { name: moveName, type: '???', category: 'Status' };
  }
}

function buildDefender(gen, member) {
  const p = new Pokemon(gen, member.species, {
    level: member.level,
    item: itemName(gen, member.item),
    ability: abilityName(gen, member.ability),
    status: status(member.status),
    teraType: typeName(gen, member.tera),
  });
  if (member.stats) {
    // Real final stats from the battle request override the neutral spread.
    for (const k of Object.keys(p.rawStats)) {
      if (member.stats[k]) {
        p.rawStats[k] = member.stats[k];
        p.stats[k] = member.stats[k];
      }
    }
    p.originalCurHP = member.curHP > 0 ? Math.min(member.curHP, p.rawStats.hp) : p.rawStats.hp;
  }
  return p;
}

// Estimate damage of `moveName` from `enemy` (max offense) onto `member`.
// Returns { name, type, category, text, ko } — text is "min–max%", "—" for status moves.
export function estimateDamage(snap, enemy, moveName, member) {
  const genNum = snap.gen || 9;
  const info = moveInfo(genNum, moveName);
  if (info.category === 'Status') return { ...info, text: '—', ko: '' };
  if (!member) return { ...info, text: '', ko: '' };

  try {
    const gen = getGen(genNum);
    const physical = info.category === 'Physical';
    const attacker = new Pokemon(gen, enemy.species, {
      level: enemy.level,
      nature: physical ? 'Adamant' : 'Modest',
      evs: physical ? { atk: 252 } : { spa: 252 },
      ability: abilityName(gen, enemy.ability),
      item: itemName(gen, enemy.item),
      status: status(enemy.status),
      boosts: boosts(enemy.boosts),
      teraType: typeName(gen, enemy.tera),
    });
    const defender = buildDefender(gen, member);
    const field = new Field({
      gameType: /doubles|triples|multi|freeforall/.test(snap.gameType || '') ? 'Doubles' : 'Singles',
      weather: WEATHER[toID(snap.weather)],
      terrain: TERRAIN[toID(snap.terrain)],
    });
    const result = calculate(gen, attacker, defender, new Move(gen, moveName), field);
    const [min, max] = result.range();
    const hp = defender.maxHP();
    // Whole percents keep the big number short enough to fit its box; <10% keeps a decimal.
    const pct = (n) => {
      const v = (n / hp) * 100;
      return v >= 10 ? String(Math.round(v)) : v.toFixed(1);
    };
    let ko = '';
    try {
      ko = max > 0 ? result.kochance().text : '';
    } catch (e) {
      ko = '';
    }
    // Can this move KO the target (some roll >= its current HP)?
    const canKO = max > 0 && max >= defender.curHP();
    return { ...info, text: max > 0 ? `${pct(min)}–${pct(max)}%` : '0%', ko, canKO };
  } catch (e) {
    return { ...info, text: 'n/a', ko: '' };
  }
}
