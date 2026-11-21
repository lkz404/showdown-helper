import { parsePaste, rawPasteUrl } from './pokepaste.js';

const $ = (id) => document.getElementById(id);
const form = $('form');
const url = $('url');
const go = $('go');
const msg = $('msg');
const team = $('team');
const list = $('list');

function say(text, bad) {
  msg.textContent = text;
  msg.classList.toggle('bad', !!bad);
}

function show(paste) {
  team.hidden = !paste;
  list.replaceChildren();
  if (!paste) return;
  for (const s of paste.sets) {
    const li = document.createElement('li');
    li.textContent = s.species;
    list.append(li);
  }
}

chrome.storage.local.get('smh_paste', (r) => show(r && r.smh_paste));

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const link = url.value.trim();
  const raw = rawPasteUrl(link);
  if (!raw) return say('Paste a pokepast.es link.', true);
  go.disabled = true;
  say('Importing…');
  try {
    const res = await fetch(raw);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const sets = parsePaste((await res.text()).slice(0, 50000));
    if (!sets.length) throw new Error('empty');
    const paste = { link, sets };
    await chrome.storage.local.set({ smh_paste: paste });
    show(paste);
    url.value = '';
    say(`Imported ${sets.length} Pokémon.`);
  } catch (e) {
    say('Couldn’t load that paste.', true);
  } finally {
    go.disabled = false;
  }
});

$('clear').addEventListener('click', async () => {
  await chrome.storage.local.remove('smh_paste');
  show(null);
  say('');
});
