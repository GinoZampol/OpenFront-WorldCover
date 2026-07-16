export interface WorldCoverClass {
  magnitude: number;
  name: string;
  value: number;
  color: readonly [number, number, number];
  resistance: "plains" | "highland" | "mountain";
}

/** Permanent economic floor granted to every player on the WorldCover map. */
export const WORLD_COVER_STARTING_LAND_VALUE = 1_000;

/**
 * Single source of truth for the imported WorldCover gameplay classes.
 * The map generator writes `magnitude`; economy, rendering, and UI consume
 * the remaining fields so a class cannot silently look different from its
 * gameplay meaning.
 */
export const WORLD_COVER_CLASSES: readonly WorldCoverClass[] = [
  {
    magnitude: 0,
    name: "Built-up",
    value: 150,
    color: [20, 22, 26],
    resistance: "plains",
  },
  {
    magnitude: 1,
    name: "Cropland",
    value: 5,
    color: [174, 176, 109],
    resistance: "plains",
  },
  {
    magnitude: 2,
    name: "Grassland",
    value: 0.2,
    color: [120, 166, 107],
    resistance: "plains",
  },
  {
    magnitude: 3,
    name: "Shrubland",
    value: 0,
    color: [167, 122, 92],
    resistance: "plains",
  },
  {
    magnitude: 4,
    name: "Wetland / mangrove / moss",
    value: 0,
    color: [99, 169, 168],
    resistance: "plains",
  },
  {
    magnitude: 10,
    name: "Deep forest",
    value: 0.1,
    color: [63, 104, 75],
    resistance: "highland",
  },
  {
    magnitude: 21,
    name: "Bare / rocky",
    value: 0,
    color: [185, 184, 180],
    resistance: "mountain",
  },
  {
    magnitude: 22,
    name: "Snow / ice",
    value: 0,
    color: [226, 232, 233],
    resistance: "mountain",
  },
];

export const WORLD_COVER_CLASS_BY_MAGNITUDE: Readonly<
  Record<number, WorldCoverClass>
> = Object.freeze(
  Object.fromEntries(
    WORLD_COVER_CLASSES.map((entry) => [entry.magnitude, entry]),
  ),
);

/** Magnitude-to-array-index lookup used by the client-side value breakdown. */
export const WORLD_COVER_CLASS_INDEX_BY_MAGNITUDE: Readonly<
  Record<number, number>
> = Object.freeze(
  Object.fromEntries(
    WORLD_COVER_CLASSES.map((entry, index) => [entry.magnitude, index]),
  ),
);

export const WORLD_COVER_TERRAIN_COLORS: Readonly<
  Record<number, readonly [number, number, number]>
> = Object.freeze(
  Object.fromEntries(
    WORLD_COVER_CLASSES.map((entry) => [entry.magnitude, entry.color]),
  ),
);

export const WORLD_COVER_DEEP_WATER_COLOR = [53, 86, 110] as const;
export const WORLD_COVER_COASTAL_WATER_COLOR = [102, 138, 155] as const;
