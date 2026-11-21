# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Both newer and experienced VGC (Pokémon doubles) players on Pokémon Showdown, newer players first. They use it mid-battle, glancing at a docked panel to see what the opponent's active Pokémon can do and how hard it hits their own Pokémon.

## Product Purpose
A Chrome (Manifest V3) extension for play.pokemonshowdown.com. For each of the opponent's active Pokémon it shows the 5 most used moves from Pikalytics, each with its type and an estimated damage range against a Pokémon of the player's own team. Success is that the player never leaves the battle to look up moves or open a separate damage calculator.

## Positioning
Pikalytics usage data and Smogon-calc damage in one live panel beside the battle, with no tab switching. It shows only the opponent's active Pokémon, deliberately less than a full calculator.

## Operating Context
Runs inside the Showdown battle page, docked to the right quarter of the screen so the battle and the turn log stay fully visible. It updates after each move animation finishes. The battle format picks the Pikalytics data; current VGC Regulation F data is the doubles fallback.

## Capabilities and Constraints
- Damage is an estimate with the opponent at max Attack or Special Attack (252 EVs, boosting nature). The opponent's real spread, item and Tera type are unknown and must not be implied.
- The damage target is picked from a dropdown. By default it uses the player's real battle stats; spectating uses a neutral spread.
- A move whose max roll can KO the target shows its percentage in red.
- Planned (confirmed by the user): an option in the dropdown to import the player's team from a Pokepaste link, so damage is calculated against the actual stats from that paste.
- Not on the Chrome Web Store: loaded unpacked, Chrome-based browsers only.

## Brand Commitments
Name: "Showdown Helper" (repo name; the manifest name is "Showdown Enemy Moves Helper").

## Evidence on Hand
Real data only: Pikalytics usage, @smogon/calc damage, Showdown sprites. No testimonials, user counts or ratings exist; none may be invented.

## Product Principles
1. Never cover the battle: the panel stays beside it, never over it.
2. No invented data: every number comes from Pikalytics, the battle itself, or @smogon/calc.
3. Say what the estimate assumes: max-offense damage, unknown opponent spread.
4. Glanceable over complete: the active Pokémon only, five moves, one number per move.
