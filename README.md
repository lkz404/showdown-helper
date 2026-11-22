# Showdown Helper

A Chrome extension for [Pokémon Showdown](https://play.pokemonshowdown.com). It docks a panel beside the battle and, for each opposing Pokémon on the field, lists its five most used moves from [Pikalytics](https://www.pikalytics.com), with the damage each one does to the Pokémon you pick.

Landing page: https://github.com/lkz404/showdown-landing

## Install (no Node.js needed)

1. Download **[showdown-helper.zip](https://github.com/lkz404/showdown-helper/releases/latest/download/showdown-helper.zip)** and unzip it.
2. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
3. Choose **Load unpacked** and pick the unzipped `showdown-helper` folder.
4. Start or watch a battle on Pokémon Showdown. The panel docks on the right.

Keep the folder where it is: Chrome runs the extension from it.

### Updating

Unpacked extensions don't update themselves. When a new version is on the [releases page](https://github.com/lkz404/showdown-helper/releases):

1. Download the new zip and unzip it in place of the old folder.
2. Press the reload button on Showdown Helper's card in `chrome://extensions`.
3. Reload any open Showdown tab.

## Build from source

You need Node.js 22 or newer.

```sh
npm install
npm run build
```

Then load this folder (the one with `manifest.json`) with **Load unpacked**.

## Releasing

Bump `version` in `manifest.json` and `package.json`, commit, then push a tag:

```sh
git tag v1.2.0
git push origin v1.2.0
```

The release workflow (`.github/workflows/release.yml`) builds the extension and attaches `showdown-helper.zip` to a new GitHub release.

## Notes

- Damage comes from [@smogon/calc](https://github.com/smogon/damage-calc), with the opponent at maximum Attack or Special Attack and no item or Tera type until Showdown reveals them.
- Chrome and other Chromium browsers only.
- A fan project, not affiliated with Nintendo, Game Freak, Pokémon Showdown or Pikalytics. Type icons by duiker101.
