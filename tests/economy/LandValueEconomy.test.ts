import { describe, expect, it } from "vitest";
import {
  renderTroops,
  renderWorldCoverTroops,
  renderWorldCoverValue,
} from "../../src/client/Utils";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  PlayerInfo,
  PlayerType,
} from "../../src/core/game/Game";
import { createGame } from "../../src/core/game/GameImpl";
import { GameMapImpl } from "../../src/core/game/GameMap";
import { UserSettings } from "../../src/core/game/UserSettings";
import { GameConfig } from "../../src/core/Schemas";
import { TestConfig } from "../util/TestConfig";

describe("land-value economy", () => {
  it("tracks value through conquest and uses it for army capacity", () => {
    const terrain = new Uint8Array(16).fill(0x81); // cropland
    terrain[0] = 0x80; // built-up
    const map = new GameMapImpl(4, 4, terrain, 16, "worldcover");
    const mini = new GameMapImpl(
      2,
      2,
      new Uint8Array(4).fill(0x81),
      4,
      "worldcover",
    );
    const gameConfig: GameConfig = {
      gameMap: GameMapType.WorldCover,
      gameMapSize: GameMapSize.Normal,
      gameMode: GameMode.FFA,
      gameType: GameType.Singleplayer,
      difficulty: Difficulty.Medium,
      nations: "default",
      donateGold: false,
      donateTroops: false,
      bots: 0,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
    };
    const config = new TestConfig(gameConfig, new UserSettings(), false);
    const builtInfo = new PlayerInfo("built", PlayerType.Human, null, "built");
    const cropInfo = new PlayerInfo("crop", PlayerType.Human, null, "crop");
    const game = createGame([builtInfo, cropInfo], [], map, mini, config);
    const built = game.player("built");
    const crop = game.player("crop");

    built.conquer(0);
    crop.conquer(1);

    expect(built.landValue()).toBe(1150);
    expect(crop.landValue()).toBe(1005);
    // Troops use tenths internally; these display as 1.15K and 1K respectively.
    expect(config.maxTroops(built)).toBe(11_500);
    expect(config.maxTroops(crop)).toBe(10_050);
    expect(renderTroops(config.maxTroops(built))).toBe("1.15K");
    expect(renderTroops(config.maxTroops(crop))).toBe("1.00K");
    expect(renderWorldCoverTroops(config.maxTroops(built))).toBe("1.15M");
    expect(renderWorldCoverValue(7_000_000)).toBe("7.00B");
    expect(config.troopIncreaseRate(built)).toBe(11_500 - built.troops());
    expect(config.troopIncreaseRate(crop)).toBe(10_050 - crop.troops());

    crop.conquer(0);
    expect(built.landValue()).toBe(1000);
    expect(crop.landValue()).toBe(1155);
    expect(config.maxTroops(built)).toBe(10_000);
    expect(config.maxTroops(crop)).toBe(11_550);
  });
});
