import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  genTerrainFromBin,
  MapManifest,
} from "../../../src/core/game/TerrainMapLoader";

describe("WorldCover map assets", () => {
  it("loads the generated map and keeps every named spawn on land", async () => {
    const root = path.join(process.cwd(), "resources/maps/worldcover");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
    ) as MapManifest;
    const data = fs.readFileSync(path.join(root, "map.bin"));
    const map = await genTerrainFromBin(
      manifest.map,
      data,
      manifest.land_value_mode,
    );

    expect(manifest.land_value_mode).toBe("worldcover");
    expect(manifest.map.width).toBe(6400);
    expect(manifest.map.height).toBe(2576);
    expect(data.length).toBe(manifest.map.width * manifest.map.height);
    expect(map.numLandTiles()).toBe(manifest.map.num_land_tiles);
    expect(
      data.some(
        (byte) =>
          (byte & 0x80) !== 0 && ((byte & 0x1f) === 5 || (byte & 0x1f) === 6),
      ),
    ).toBe(false);
    expect(map.totalLandValue()).toBe(6_559_923.2);
    expect(manifest.tiny_water_cleanup).toEqual({
      max_component_size: 2,
      components_filled: 24_446,
      pixels_filled: 29_561,
    });

    for (const nation of manifest.nations) {
      expect(nation.coordinates, nation.name).toBeDefined();
      const [x, y] = nation.coordinates!;
      expect(map.isLand(map.ref(x, y)), nation.name).toBe(true);
    }
  });

  it("loads the 8K playfield and scales named spawns onto land", async () => {
    const root = path.join(process.cwd(), "resources/maps/worldcover");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
    ) as MapManifest;
    const metadata = manifest.map8k;
    expect(metadata).toBeDefined();
    expect(manifest.map8k4x).toEqual({
      width: 4000,
      height: 1610,
      num_land_tiles: 1_824_226,
    });
    expect(manifest.tiny_water_cleanup_8k).toEqual({
      max_component_size: 2,
      components_filled: 35_662,
      pixels_filled: 43_617,
    });

    const data = fs.readFileSync(path.join(root, "map8k.bin"));
    const map = await genTerrainFromBin(
      metadata!,
      data,
      manifest.land_value_mode,
    );
    expect(metadata).toEqual({
      width: 8000,
      height: 3220,
      num_land_tiles: 7_398_527,
    });
    expect(data.length).toBe(8000 * 3220);
    expect(map.numLandTiles()).toBe(metadata!.num_land_tiles);
    expect(map.totalLandValue()).toBeGreaterThan(6_559_923.2);

    const scale = metadata!.width / manifest.map.width;
    for (const nation of manifest.nations) {
      expect(nation.coordinates, nation.name).toBeDefined();
      const [x, y] = nation.coordinates!;
      const scaledX = Math.floor(x * scale);
      const scaledY = Math.floor(y * scale);
      expect(map.isLand(map.ref(scaledX, scaledY)), nation.name).toBe(true);
    }
  });

  it("loads the 10K local playfield and scales named spawns onto land", async () => {
    const root = path.join(process.cwd(), "resources/maps/worldcover");
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
    ) as MapManifest;
    const metadata = manifest.map10k;
    expect(metadata).toEqual({
      width: 10_000,
      height: 4_024,
      num_land_tiles: 11_633_142,
    });
    expect(manifest.map10k4x).toEqual({
      width: 5_000,
      height: 2_012,
      num_land_tiles: 2_882_263,
    });
    expect(manifest.tiny_water_cleanup_10k).toEqual({
      max_component_size: 2,
      components_filled: 47_716,
      pixels_filled: 58_307,
    });

    const data = fs.readFileSync(path.join(root, "map10k.bin"));
    const map = await genTerrainFromBin(
      metadata!,
      data,
      manifest.land_value_mode,
    );
    expect(data.length).toBe(10_000 * 4_024);
    expect(map.numLandTiles()).toBe(metadata!.num_land_tiles);

    const scale = metadata!.width / manifest.map.width;
    for (const nation of manifest.nations) {
      expect(nation.coordinates, nation.name).toBeDefined();
      const [x, y] = nation.coordinates!;
      const scaledX = Math.floor(x * scale);
      const scaledY = Math.floor(y * scale);
      expect(map.isLand(map.ref(scaledX, scaledY)), nation.name).toBe(true);
    }
  });
});
