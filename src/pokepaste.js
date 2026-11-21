// Pokepaste import: link validation and Showdown-export parsing.

const STAT_KEYS = { hp: 'hp', atk: 'atk', def: 'def', spa: 'spa', spd: 'spd', spe: 'spe', spatk: 'spa', spdef: 'spd', speed: 'spe' };

// Accepts https://pokepast.es/<id> (optionally with /raw or a query/hash). Returns the raw URL or null.
export function rawPasteUrl(input) {
  let u;
  try {
    u = new URL(String(input || '').trim());
  } catch (e) {
    return null;
  }
  if (u.protocol !== 'https:' || !/^(www\.)?pokepast\.es$/.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/([A-Za-z0-9]+)(?:\/(?:raw|json))?\/?$/);
  return m ? `https://pokepast.es/${m[1]}/raw` : null;
}

function parseSpread(text, max) {
  const out = {};
  for (const part of text.split('/')) {
    const m = part.trim().match(/^(\d+)\s+([A-Za-z]+)$/);
    const key = m && STAT_KEYS[m[2].toLowerCase()];
    if (key) out[key] = Math.min(+m[1], max);
  }
  return out;
}

function parseHeader(line) {
  let name = line;
  let item;
  const at = name.indexOf(' @ ');
  if (at >= 0) {
    item = name.slice(at + 3).trim();
    name = name.slice(0, at);
  }
  name = name.trim().replace(/\s+\((M|F)\)$/, '');
  const nick = name.match(/^.+\(([^()]+)\)$/); // "Nickname (Species)"
  if (nick) name = nick[1];
  return { species: name.trim(), item };
}

// Parses a Showdown export into [{species,item,ability,level,tera,nature,evs,ivs,moves}].
export function parsePaste(text) {
  const sets = [];
  const blocks = String(text || '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const { species, item } = parseHeader(lines[0]);
    if (!species || /^(Ability|Level|EVs|IVs|Tera Type|Shiny|- )/.test(lines[0])) continue;
    const set = { species, item, ability: undefined, level: undefined, tera: undefined, nature: undefined, evs: {}, ivs: {}, moves: [] };
    for (const line of lines.slice(1)) {
      let m;
      if ((m = line.match(/^Ability:\s*(.+)$/i))) set.ability = m[1].trim();
      else if ((m = line.match(/^Level:\s*(\d+)/i))) set.level = Math.min(Math.max(+m[1], 1), 100);
      else if ((m = line.match(/^Tera Type:\s*(.+)$/i))) set.tera = m[1].trim();
      else if ((m = line.match(/^EVs:\s*(.+)$/i))) set.evs = parseSpread(m[1], 252);
      else if ((m = line.match(/^IVs:\s*(.+)$/i))) set.ivs = parseSpread(m[1], 31);
      else if ((m = line.match(/^(\w+)\s+Nature$/i))) set.nature = m[1];
      else if (line.startsWith('-')) set.moves.push(line.replace(/^-\s*/, ''));
    }
    sets.push(set);
  }
  return sets.slice(0, 6);
}
