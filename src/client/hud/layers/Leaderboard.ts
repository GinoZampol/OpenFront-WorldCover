import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import {
  renderTroops,
  renderWorldCoverTroops,
  renderWorldCoverValue,
  translateText,
} from "../../../client/Utils";
import { EventBus } from "../../../core/EventBus";
import { GameMapType } from "../../../core/game/Game";
import { UserSettings } from "../../../core/game/UserSettings";
import { WORLD_COVER_CLASSES } from "../../../core/game/WorldCover";
import { Controller } from "../../Controller";
import { GoToPlayerEvent } from "../../TransformHandler";
import { formatPercentage, renderNumber } from "../../Utils";
import { GameView, PlayerView } from "../../view";

interface Entry {
  name: string;
  position: number;
  score: string;
  gold: string;
  maxTroops: string;
  isMyPlayer: boolean;
  isOnSameTeam: boolean;
  player: PlayerView;
}

@customElement("leader-board")
export class Leaderboard extends LitElement implements Controller {
  private readonly userSettings = new UserSettings();
  public game: GameView | null = null;
  public eventBus: EventBus | null = null;

  players: Entry[] = [];

  @property({ type: Boolean }) visible = false;
  private showTopFive = true;

  @state()
  private terrainLegendExpanded = true;

  @state()
  private _sortKey: "tiles" | "gold" | "maxtroops" = "tiles";

  @state()
  private _sortOrder: "asc" | "desc" = "desc";

  createRenderRoot() {
    return this; // use light DOM for Tailwind support
  }

  init() {}

  willUpdate(changed: Map<string, unknown>) {
    if (changed.has("visible") && this.visible) {
      this.updateLeaderboard();
    }
  }

  getTickIntervalMs() {
    return 1000;
  }

  tick() {
    if (this.game === null) throw new Error("Not initialized");
    if (!this.visible) return;
    this.updateLeaderboard();
  }

  private setSort(key: "tiles" | "gold" | "maxtroops") {
    if (this._sortKey === key) {
      this._sortOrder = this._sortOrder === "asc" ? "desc" : "asc";
    } else {
      this._sortKey = key;
      this._sortOrder = "desc";
    }
    this.updateLeaderboard();
  }

  private updateLeaderboard() {
    if (this.game === null) throw new Error("Not initialized");
    const myPlayer = this.game.myPlayer();

    interface PlayerViewTroopsCache {
      pv: PlayerView;
      maxTroops: number;
    }

    const compare = (a: number, b: number) =>
      this._sortOrder === "asc" ? a - b : b - a;

    const maxTroops = (p: PlayerView) => this.game!.config().maxTroops(p);
    const weightedLand =
      this.game.config().gameConfig().gameMap === GameMapType.WorldCover;
    const landScore = (p: PlayerView) =>
      weightedLand ? p.landValue() : p.numTilesOwned();

    const sorted: PlayerViewTroopsCache[] = this.game
      .playerViews()
      .map((p) => ({ pv: p, maxTroops: maxTroops(p) }));

    switch (this._sortKey) {
      case "gold":
        sorted.sort((a, b) =>
          compare(Number(a.pv.gold()), Number(b.pv.gold())),
        );
        break;
      case "maxtroops":
        sorted.sort((a, b) => compare(a.maxTroops, b.maxTroops));
        break;
      default:
        sorted.sort((a, b) => compare(landScore(a.pv), landScore(b.pv)));
    }

    const numTilesWithoutFallout =
      this.game.numLandTiles() - this.game.numTilesWithFallout();

    const alivePlayers = sorted.filter((player) => player.pv.isAlive());
    const playersToShow = this.showTopFive
      ? alivePlayers.slice(0, 5)
      : alivePlayers;

    this.players = playersToShow.map((playerCache, index) => {
      const player = playerCache.pv;
      const maxTroops = playerCache.maxTroops;
      return {
        name: player.displayName(),
        position: index + 1,
        score: weightedLand
          ? renderWorldCoverValue(player.landValue())
          : formatPercentage(player.numTilesOwned() / numTilesWithoutFallout),
        gold: renderNumber(player.gold()),
        maxTroops: weightedLand
          ? renderWorldCoverTroops(maxTroops)
          : renderTroops(maxTroops),
        isMyPlayer: player === myPlayer,
        isOnSameTeam:
          myPlayer !== null &&
          (player === myPlayer || player.isOnSameTeam(myPlayer)),
        player: player,
      };
    });

    if (
      myPlayer !== null &&
      this.players.find((p) => p.isMyPlayer) === undefined
    ) {
      let place = 0;
      for (const p of sorted) {
        place++;
        if (p.pv === myPlayer) {
          break;
        }
      }

      if (myPlayer.isAlive()) {
        const myPlayerMaxTroops = this.game!.config().maxTroops(myPlayer);
        this.players.pop();
        this.players.push({
          name: myPlayer.displayName(),
          position: place,
          score: weightedLand
            ? renderWorldCoverValue(myPlayer.landValue())
            : formatPercentage(
                myPlayer.numTilesOwned() / this.game.numLandTiles(),
              ),
          gold: renderNumber(myPlayer.gold()),
          maxTroops: weightedLand
            ? renderWorldCoverTroops(myPlayerMaxTroops)
            : renderTroops(myPlayerMaxTroops),
          isMyPlayer: true,
          isOnSameTeam: true,
          player: myPlayer,
        });
      }
    }

    this.requestUpdate();
  }

  private handleRowClickPlayer(player: PlayerView) {
    if (this.eventBus === null) return;
    this.eventBus.emit(new GoToPlayerEvent(player));
  }

  render() {
    if (!this.visible) {
      return html``;
    }
    const weightedLand =
      this.game?.config().gameConfig().gameMap === GameMapType.WorldCover;
    return html`
      <div
        class="max-h-[35vh] overflow-y-auto text-white text-xs md:text-xs lg:text-sm md:max-h-[50vh] mt-2 ${
          this.visible ? "" : "hidden"
        }"
        @contextmenu=${(e: Event) => e.preventDefault()}
      >
        ${
          weightedLand
            ? html`
                <div
                  class="mb-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-gray-800/90 p-2 text-[10px] leading-tight"
                >
                  <div
                    class="col-span-2 mb-1 flex items-center justify-between gap-2 font-bold text-white"
                  >
                    <span>WorldCover information</span>
                    <div class="flex items-center gap-1.5">
                      <button
                        class="rounded border px-1.5 py-0.5 ${
                          this.userSettings.landValueStats()
                            ? "border-malibu-blue bg-malibu-blue/20 text-white"
                            : "border-slate-500 text-slate-300"
                        } hover:bg-white/10"
                        title="Show each player's terrain contribution when hovering over their territory"
                        @click=${() => {
                          this.userSettings.toggleLandValueStats();
                          this.requestUpdate();
                        }}
                      >
                        Land value stats:
                        ${this.userSettings.landValueStats() ? "On" : "Off"}
                      </button>
                      <button
                        class="rounded border border-slate-500 px-1.5 text-slate-200 hover:bg-white/10"
                        title=${
                          this.terrainLegendExpanded
                            ? "Minimize WorldCover information"
                            : "Expand WorldCover information"
                        }
                        @click=${() =>
                          (this.terrainLegendExpanded =
                            !this.terrainLegendExpanded)}
                      >
                        ${this.terrainLegendExpanded ? "−" : "+"}
                      </button>
                    </div>
                  </div>
                  ${
                    this.terrainLegendExpanded
                      ? WORLD_COVER_CLASSES.filter((entry) => entry.value > 0)
                          .map(
                            (entry) => html`
                              <div class="flex min-w-0 items-center gap-1.5">
                                <span
                                  class="h-2.5 w-2.5 shrink-0 rounded-sm border border-white/30"
                                  style=${`background: rgb(${entry.color.join(",")})`}
                                ></span>
                                <span class="truncate">${entry.name}</span>
                                <strong class="ml-auto">${entry.value}</strong>
                              </div>
                            `,
                          )
                          .concat(html`
                            <div
                              class="col-span-2 flex min-w-0 items-center gap-1.5 text-slate-300"
                            >
                              <span
                                class="h-2.5 w-2.5 shrink-0 rounded-sm border border-white/30 bg-slate-500"
                              ></span>
                              <span class="truncate"
                                >Shrubland, wetland, bare & snow</span
                              >
                              <strong class="ml-auto">0</strong>
                            </div>
                          `)
                      : null
                  }
                </div>
              `
            : null
        }
        <div
          class="grid bg-gray-800/85 w-full text-xs md:text-xs lg:text-sm rounded-lg overflow-hidden"
          style="grid-template-columns: minmax(24px, 30px) minmax(60px, 100px) minmax(45px, 70px) minmax(40px, 55px) minmax(55px, 105px);"
        >
          <div class="contents font-bold bg-gray-700/60">
            <div class="py-1 md:py-2 text-center border-b border-slate-500">
              #
            </div>
            <div
              class="py-1 md:py-2 text-center border-b border-slate-500 truncate"
            >
              ${translateText("leaderboard.player")}
            </div>
            <div
              class="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate"
              @click=${() => this.setSort("tiles")}
            >
              ${
                weightedLand ? "Land value" : translateText("leaderboard.owned")
              }
              ${
                this._sortKey === "tiles"
                  ? this._sortOrder === "asc"
                    ? "⬆️"
                    : "⬇️"
                  : ""
              }
            </div>
            <div
              class="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate"
              @click=${() => this.setSort("gold")}
            >
              ${translateText("leaderboard.gold")}
              ${
                this._sortKey === "gold"
                  ? this._sortOrder === "asc"
                    ? "⬆️"
                    : "⬇️"
                  : ""
              }
            </div>
            <div
              class="py-1 md:py-2 text-center border-b border-slate-500 cursor-pointer whitespace-nowrap truncate"
              @click=${() => this.setSort("maxtroops")}
            >
              ${translateText("leaderboard.maxtroops")}
              ${
                this._sortKey === "maxtroops"
                  ? this._sortOrder === "asc"
                    ? "⬆️"
                    : "⬇️"
                  : ""
              }
            </div>
          </div>

          ${repeat(
            this.players,
            (p) => p.player.id(),
            (player, index) => html`
              <div
                class="contents hover:bg-slate-600/60 ${
                  player.isOnSameTeam ? "font-bold" : ""
                } cursor-pointer"
                @click=${() => this.handleRowClickPlayer(player.player)}
              >
                <div
                  class="py-1 md:py-2 text-center ${
                    index < this.players.length - 1
                      ? "border-b border-slate-500"
                      : ""
                  }"
                >
                  ${player.position}
                </div>
                <div
                  class="py-1 md:py-2 text-center ${
                    index < this.players.length - 1
                      ? "border-b border-slate-500"
                      : ""
                  } truncate"
                >
                  ${player.name}
                </div>
                <div
                  class="py-1 md:py-2 text-center ${
                    index < this.players.length - 1
                      ? "border-b border-slate-500"
                      : ""
                  }"
                >
                  ${player.score}
                </div>
                <div
                  class="py-1 md:py-2 text-center ${
                    index < this.players.length - 1
                      ? "border-b border-slate-500"
                      : ""
                  }"
                >
                  ${player.gold}
                </div>
                <div
                  class="py-1 md:py-2 text-center ${
                    index < this.players.length - 1
                      ? "border-b border-slate-500"
                      : ""
                  }"
                >
                  ${player.maxTroops}
                </div>
              </div>
            `,
          )}
        </div>
      </div>

      <button
        class="mt-2 p-0.5 px-1.5 md:px-2 text-xs md:text-xs lg:text-sm 
        border rounded-md border-slate-500 transition-colors
        text-white mx-auto block hover:bg-white/10 bg-gray-700/50"
        @click=${() => {
          this.showTopFive = !this.showTopFive;
          this.updateLeaderboard();
        }}
      >
        ${this.showTopFive ? "+" : "-"}
      </button>
    `;
  }
}
