import { GameMapSize, GameMapType, TeamGameSpawnAreas } from "./Game";
import { GameMap, GameMapImpl, LandValueMode } from "./GameMap";
import { GameMapLoader } from "./GameMapLoader";

export type TerrainMapData = {
  nations: Nation[];
  additionalNations: AdditionalNation[];
  gameMap: GameMap;
  miniGameMap: GameMap;
  teamGameSpawnAreas?: TeamGameSpawnAreas;
};

const loadedMaps = new Map<string, TerrainMapData>();

export interface MapMetadata {
  width: number;
  height: number;
  num_land_tiles: number;
}

export interface MapManifest {
  name: string;
  map: MapMetadata;
  map4x: MapMetadata;
  map16x: MapMetadata;
  map8k?: MapMetadata;
  map8k4x?: MapMetadata;
  map10k?: MapMetadata;
  map10k4x?: MapMetadata;
  nations: Nation[];
  // Optional pool of fallback nation names used when a game requests more
  // nations than the manifest defines. Picked at random; if still not enough,
  // the remainder is generated procedurally.
  additionalNations?: AdditionalNation[];
  teamGameSpawnAreas?: TeamGameSpawnAreas;
  land_value_mode?: LandValueMode;
  tiny_water_cleanup?: {
    max_component_size: number;
    components_filled: number;
    pixels_filled: number;
  };
  tiny_water_cleanup_8k?: {
    max_component_size: number;
    components_filled: number;
    pixels_filled: number;
  };
  tiny_water_cleanup_10k?: {
    max_component_size: number;
    components_filled: number;
    pixels_filled: number;
  };
}

export interface Nation {
  color?: string;
  coordinates?: [number, number];
  flag?: string;
  name: string;
}

export interface AdditionalNation {
  color?: string;
  coordinates?: [number, number];
  flag?: string;
  name: string;
}

export async function loadTerrainMap(
  map: GameMapType,
  mapSize: GameMapSize,
  terrainMapFileLoader: GameMapLoader,
): Promise<TerrainMapData> {
  const cacheKey = `${map}:${mapSize}`;
  const cached = loadedMaps.get(cacheKey);
  if (cached !== undefined) return cached;
  const mapFiles = terrainMapFileLoader.getMapData(map);
  const manifest = await mapFiles.manifest();

  let gameMetadata: MapMetadata;
  let miniMapMetadata: MapMetadata;
  let gameBinary: Promise<Uint8Array>;
  let miniMapBinary: Promise<Uint8Array>;
  let coordinateScale = 1;

  switch (mapSize) {
    case GameMapSize.Compact:
      gameMetadata = manifest.map4x;
      miniMapMetadata = manifest.map16x;
      gameBinary = mapFiles.map4xBin();
      miniMapBinary = mapFiles.map16xBin();
      coordinateScale = manifest.map4x.width / manifest.map.width;
      break;
    case GameMapSize.Normal:
      gameMetadata = manifest.map;
      miniMapMetadata = manifest.map4x;
      gameBinary = mapFiles.mapBin();
      miniMapBinary = mapFiles.map4xBin();
      break;
    case GameMapSize.Large:
      if (manifest.map8k === undefined || manifest.map8k4x === undefined) {
        throw new Error(`${manifest.name} does not provide a large map size`);
      }
      gameMetadata = manifest.map8k;
      miniMapMetadata = manifest.map8k4x;
      gameBinary = mapFiles.map8kBin();
      miniMapBinary = mapFiles.map8k4xBin();
      coordinateScale = manifest.map8k.width / manifest.map.width;
      break;
    case GameMapSize.Maximum:
      if (manifest.map10k === undefined || manifest.map10k4x === undefined) {
        throw new Error(`${manifest.name} does not provide a maximum map size`);
      }
      gameMetadata = manifest.map10k;
      miniMapMetadata = manifest.map10k4x;
      gameBinary = mapFiles.map10kBin();
      miniMapBinary = mapFiles.map10k4xBin();
      coordinateScale = manifest.map10k.width / manifest.map.width;
      break;
  }

  const [gameBytes, miniMapBytes] = await Promise.all([
    gameBinary,
    miniMapBinary,
  ]);
  const gameMap = await genTerrainFromBin(
    gameMetadata,
    gameBytes,
    manifest.land_value_mode,
  );
  const miniMap = await genTerrainFromBin(
    miniMapMetadata,
    miniMapBytes,
    manifest.land_value_mode,
  );

  const scaleNation = <T extends Nation | AdditionalNation>(nation: T): T => ({
    ...nation,
    coordinates:
      nation.coordinates === undefined
        ? undefined
        : [
            Math.floor(nation.coordinates[0] * coordinateScale),
            Math.floor(nation.coordinates[1] * coordinateScale),
          ],
  });
  const nations = manifest.nations.map(scaleNation);
  const additionalNations = (manifest.additionalNations ?? []).map(scaleNation);

  // Keep configured spawn regions aligned with whichever terrain resolution
  // the player selected.
  let teamGameSpawnAreas = manifest.teamGameSpawnAreas;
  if (coordinateScale !== 1 && teamGameSpawnAreas) {
    const scaled: TeamGameSpawnAreas = {};
    for (const [key, areas] of Object.entries(teamGameSpawnAreas)) {
      scaled[key] = areas.map((a) => ({
        x: Math.floor(a.x * coordinateScale),
        y: Math.floor(a.y * coordinateScale),
        width: Math.max(1, Math.floor(a.width * coordinateScale)),
        height: Math.max(1, Math.floor(a.height * coordinateScale)),
      }));
    }
    teamGameSpawnAreas = scaled;
  }

  const result = {
    nations,
    additionalNations,
    gameMap: gameMap,
    miniGameMap: miniMap,
    teamGameSpawnAreas,
  };
  loadedMaps.set(cacheKey, result);
  return result;
}

export async function genTerrainFromBin(
  mapData: MapMetadata,
  data: Uint8Array,
  landValueMode: LandValueMode = "uniform",
): Promise<GameMap> {
  if (data.length !== mapData.width * mapData.height) {
    throw new Error(
      `Invalid data: buffer size ${data.length} incorrect for ${mapData.width}x${mapData.height} terrain plus 4 bytes for dimensions.`,
    );
  }

  return new GameMapImpl(
    mapData.width,
    mapData.height,
    data,
    mapData.num_land_tiles,
    landValueMode,
  );
}
