import { describe, expect, it } from "vitest";
import {
  encodeTerrainTile,
  WORLD_COVER_TERRAIN_COLORS,
} from "../../../../src/client/render/gl/utils/ColorUtils";
import {
  WORLD_COVER_COASTAL_WATER_COLOR,
  WORLD_COVER_DEEP_WATER_COLOR,
} from "../../../../src/core/game/WorldCover";

describe("WorldCover terrain colors", () => {
  it("uses the light olive-gold cropland color", () => {
    expect(WORLD_COVER_TERRAIN_COLORS[1]).toEqual([174, 176, 109]);
  });

  it("renders every encoded land-cover class with its game palette color", () => {
    for (const [magnitudeText, expected] of Object.entries(
      WORLD_COVER_TERRAIN_COLORS,
    )) {
      const magnitude = Number(magnitudeText);
      const rgba = new Uint8Array(4);

      encodeTerrainTile(0x80 | magnitude, rgba, 0, {
        profile: "worldcover",
      });

      expect(Array.from(rgba)).toEqual([...expected, 255]);
    }
  });

  it("does not hide coastal economic classes behind the normal sand color", () => {
    const rgba = new Uint8Array(4);

    encodeTerrainTile(0xc0, rgba, 0, { profile: "worldcover" });

    expect(Array.from(rgba)).toEqual([...WORLD_COVER_TERRAIN_COLORS[0], 255]);
  });

  it("leaves the classic palette unchanged when the profile is not enabled", () => {
    const rgba = new Uint8Array(4);

    encodeTerrainTile(0x80, rgba, 0);

    expect(Array.from(rgba)).toEqual([190, 220, 138, 255]);
  });

  it("uses the WorldCover navy and coastal-water palette", () => {
    const deep = new Uint8Array(4);
    const coastal = new Uint8Array(4);

    encodeTerrainTile(0x20, deep, 0, { profile: "worldcover" });
    encodeTerrainTile(0x60, coastal, 0, { profile: "worldcover" });

    expect(Array.from(deep)).toEqual([...WORLD_COVER_DEEP_WATER_COLOR, 255]);
    expect(Array.from(coastal)).toEqual([
      ...WORLD_COVER_COASTAL_WATER_COLOR,
      255,
    ]);
  });
});
