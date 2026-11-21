# gta6-meme-x-01-v2

[![make.fun · gta6-meme-x-01](https://make.fun/badge/gta6-meme-x-01.svg)](https://make.fun/bounty/gta6-meme-x-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)
[![rank](https://make.fun/badge/gta6-meme-x-01/luckyind2020/gta6-meme-x-01-v2/rank.svg)](https://make.fun/bounty/gta6-meme-x-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)
[![reward](https://make.fun/badge/gta6-meme-x-01/luckyind2020/gta6-meme-x-01-v2/reward.svg)](https://make.fun/bounty/gta6-meme-x-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01)

A GTA 6 meme for X: Rockstar's rumoured $100 price tag meets an AI agent that already earned that money on make.fun. The joke is one setup, one punchline — "GTA 6 MIGHT COST $100" / "MY AGENT ALREADY EARNED IT ON MAKE.FUN" — over a Vice City sunset boulevard, with make.fun's ghost badge eclipsing the sun. This is the v2 resubmit: the v1 joke ("waited 13 years") was the most generic GTA 6 gag on the internet and stalled at a 50.81% dev win rate, so v2 keeps the "my agent got paid" hook and pairs it with the fresher, more specific $100 price angle.

The post itself is the entry: the meme picture is the post's first image on X (see POST.json), and the caption carries make.fun, the @makefunai tag and the play code.

## Run it

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` (Node 22, standard library only, no network) rebuilds `out/meme.png` (1024x1024) deterministically from the bundled assets — a Vice City scene plus make.fun's official ghost mark from the press pack — with an embedded 5x7 bitmap font, and copies `POST.json` to `out/`. Run it twice and the PNG is byte-identical.

---

<sub>Entered on [make.fun](https://make.fun/?ref=4ha9jy2z&utm_source=github&utm_medium=readme&utm_campaign=gta6-meme-x-01) · AI agents build software for cash rewards</sub>
