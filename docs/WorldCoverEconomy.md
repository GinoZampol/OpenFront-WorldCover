# WorldCover Economy map

`WorldCover Economy` is an OpenFront variant generated from the ESA WorldCover
2021 v200 RGB preview. It preserves normal OpenFront rules while replacing the
uniform territory contribution to army capacity with a land-cover value score.
On this map, the displayed maximum troops are exactly the player's weighted land
value, including a permanent 1,000-point starting value for every player.
OpenFront stores troops internally in tenths, so the engine converts land
value to internal troop units by multiplying by 10; the normal UI conversion
then displays the original land-value number. Cities, difficulty, player type,
and the normal nonlinear territory formula do not add another capacity modifier.

## Value model

The score uses fixed-point units where a built-up tile is 150. The
supplied preview contains 46,052 built-up pixels and 1,058,523 cropland pixels.
Under the requested example assumption that four billion people are assigned to
each class, that is 86,858 people per built-up pixel and 3,778 per cropland
pixel, or 22.99:1. The final gameplay tuning gives built-up land 150 and
productive cropland 5, while reducing grassland to 0.5, deep forest to 0.2, and
all other natural land-cover classes to 0.1.

| ESA WorldCover class                    | Value | OpenFront resistance |
| --------------------------------------- | ----: | -------------------- |
| Built-up                                |   150 | Plains               |
| Grassland / ranch land                  |   0.5 | Plains               |
| Shrubland                               |   0.1 | Plains               |
| Wetland / mangrove / moss               |   0.1 | Plains               |
| Cropland                                |     5 | Plains               |
| Tree cover / deep forest                |   0.2 | Highland / hill      |
| Bare / sparse (gray)                    |   0.1 | Mountain             |
| Snow and ice                            |   0.1 | Mountain             |
| Permanent water and black preview ocean |     0 | Water                |

Deep forest uses OpenFront's highland/hill combat rules. Gray bare land and snow
use mountain combat rules, increasing attacker losses and slowing conquest.
Water remains unownable.

## Visual feedback

The WorldCover map opts into a land-cover terrain profile instead of being
flattened into OpenFront's generic plains colors. Built-up areas are near-black,
cropland is a light olive-gold (`#AEB06D`), grassland is a lush natural green,
shrubland is muted earthy rust, the merged wet class is soft turquoise, deep
forest is a lighter pine green, bare terrain is light stone gray, snow is
blue-white, and water uses desaturated navy/coastal blue. The
normal player leaderboard's **Owned** column becomes **Land value** on this map
and shows the raw weighted score, making every conquest's economic effect
visible. Other OpenFront maps keep their original palette and
territory-percentage leaderboard.

## Regeneration

```bash
python3 scripts/generate-worldcover-map.py /path/to/ESA_WorldCover_preview.tif
cd map-generator
go run . --maps=worldcover
```

Other maps remain byte-for-byte compatible with the original uniform value of
100 per tile because the feature is opt-in through `land_value_mode`.

The supplied 10,000×5,000 preview has its empty top 3.5% and bottom 16% removed,
leaving a 10,000×4,025 source region. That region is converted to 6,400×2,576,
or about 16.5 million gameplay cells. Conversion uses categorical area voting
instead of sampling a single source pixel, and full-map cleanup is disabled so
it does not delete islands or broadly fill lakes. A final conservative cleanup
fills only enclosed water components of one or two pixels, using the majority
land class surrounding each gap. Boundary-connected water and components of
three or more pixels are preserved.
