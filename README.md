# solano-heat

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/bdgpride/solano-heat/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/bdgpride/solano-heat/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

Solano Heat is an original open-world crime game that plays in a desktop browser, offline, from static files. Wheelman Nico Vega works the pastel streets of Port Solano — a coastal city of nine-by-nine blocks with live traffic, pedestrians, car stealing, a five-star wanted system and SPPD pursuits — through fixer Marisol Kane's five-mission story chain, with free-roam taxi fares, shootouts, a live minimap and a save that persists in the browser. Built with Three.js (vendored under game/vendor/), procedural art and WebAudio-synthesised sound: no network, no account, no tracking.

## Run it

```sh
node serve.ts
```

Open http://localhost:8080 in a desktop browser; WASD/mouse to play, E to enter cars, Esc to pause, M to mute.

## What's inside

- `game/` — the game itself: `index.html`, the `src/` modules (city, vehicles, people, police, missions, HUD, audio), and `vendor/three.min.js` (Three.js, vendored).
- `screenshots/` — four renders of the game (cover, driving, police chase, mission).
- `main.ts` — hands the game in and writes the dossier.
- `vendor/makefun-game.ts` — the kit's dossier library, unchanged.

## License

MIT — see LICENSE.

---

<sub>Entered on [make.fun](https://make.fun/?ref=2my8wvpk&utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>
