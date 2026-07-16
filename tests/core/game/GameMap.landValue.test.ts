import { describe, expect, it } from "vitest";
import { TerrainType } from "../../../src/core/game/Game";
import { GameMapImpl, LAND_VALUE_SCALE } from "../../../src/core/game/GameMap";

describe("GameMap land value", () => {
  it("keeps existing maps uniform", () => {
    const terrain = new Uint8Array([0x80, 0x81, 0x94, 0x20]);
    const map = new GameMapImpl(4, 1, terrain, 3);

    expect(map.landValue(0)).toBe(LAND_VALUE_SCALE);
    expect(map.landValue(1)).toBe(LAND_VALUE_SCALE);
    expect(map.landValue(2)).toBe(LAND_VALUE_SCALE);
    expect(map.landValue(3)).toBe(0);
    expect(map.totalLandValue()).toBe(3 * LAND_VALUE_SCALE);
  });

  it("decodes WorldCover economic classes and water", () => {
    const terrain = new Uint8Array([
      0x80 | 0, // built-up
      0x80 | 1, // cropland
      0x80 | 2, // grassland
      0x80 | 3, // shrubland
      0x80 | 4, // merged wetland/mangrove/moss
      0x80 | 10, // forest
      0x80 | 21, // bare/sparse
      0x80 | 22, // snow/ice
      0x20, // ocean
    ]);
    const map = new GameMapImpl(9, 1, terrain, 8, "worldcover");

    expect(Array.from(terrain, (_, tile) => map.landValue(tile))).toEqual([
      150, 5, 0.2, 0, 0, 0.2, 0, 0, 0,
    ]);
    expect(map.totalLandValue()).toBe(155.4);
    expect(map.terrainType(0)).toBe(TerrainType.Plains);
    expect(map.terrainType(5)).toBe(TerrainType.Highland);
    expect(map.terrainType(6)).toBe(TerrainType.Mountain);
    expect(map.terrainType(7)).toBe(TerrainType.Mountain);
  });

  it("removes converted land from the total value", () => {
    const terrain = new Uint8Array([0x80, 0x81]);
    const map = new GameMapImpl(2, 1, terrain, 2, "worldcover");

    map.setWater(0);

    expect(map.totalLandValue()).toBe(5);
    expect(map.landValue(0)).toBe(0);
  });
});
