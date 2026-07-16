import { html, LitElement, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import {
  GameMapType,
  PlayerProfile,
  PlayerType,
  Relation,
  Unit,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { AllianceView } from "../../../core/game/GameUpdates";
import { UserSettings } from "../../../core/game/UserSettings";
import {
  WORLD_COVER_CLASSES,
  WORLD_COVER_STARTING_LAND_VALUE,
} from "../../../core/game/WorldCover";
import { Controller } from "../../Controller";
import {
  ContextMenuEvent,
  MouseMoveEvent,
  TouchEvent,
} from "../../InputHandler";
import { themeProvider } from "../../theme/ThemeProvider";
import { TransformHandler } from "../../TransformHandler";
import {
  getTranslatedPlayerTeamLabel,
  renderDuration,
  renderNumber,
  renderTroops,
  renderWorldCoverTroops,
  renderWorldCoverValue,
  translateText,
} from "../../Utils";
import { GameView, PlayerView, UnitView } from "../../view";
import {
  EMOJI_ICON_KIND,
  getFirstPlacePlayer,
  getPlayerIcons,
  IMAGE_ICON_KIND,
} from "../PlayerIcons";
import { ImmunityBarVisibleEvent } from "./ImmunityTimer";
import { CloseRadialMenuEvent } from "./RadialMenu";
import "./RelationSmiley";
import { SpawnBarVisibleEvent } from "./SpawnTimer";
const soldierIconAquarius = assetUrl("images/SoldierIconAquarius.svg");
const allianceIcon = assetUrl("images/AllianceIcon.svg");
const warshipIcon = assetUrl("images/BattleshipIconWhite.svg");
const cityIcon = assetUrl("images/CityIconWhite.svg");
const factoryIcon = assetUrl("images/FactoryIconWhite.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const missileSiloIcon = assetUrl("images/MissileSiloIconWhite.svg");
const portIcon = assetUrl("images/PortIcon.svg");
const samLauncherIcon = assetUrl("images/SamLauncherIconWhite.svg");
const soldierIcon = assetUrl("images/SoldierIcon.svg");

function euclideanDistWorld(
  coord: { x: number; y: number },
  tileRef: TileRef,
  game: GameView,
): number {
  const x = game.x(tileRef);
  const y = game.y(tileRef);
  const dx = coord.x - x;
  const dy = coord.y - y;
  return Math.sqrt(dx * dx + dy * dy);
}

function distSortUnitWorld(coord: { x: number; y: number }, game: GameView) {
  return (a: Unit | UnitView, b: Unit | UnitView) => {
    const distA = euclideanDistWorld(coord, a.tile(), game);
    const distB = euclideanDistWorld(coord, b.tile(), game);
    return distA - distB;
  };
}

@customElement("player-info-overlay")
export class PlayerInfoOverlay extends LitElement implements Controller {
  private readonly userSettings = new UserSettings();

  @property({ type: Object })
  public game!: GameView;

  @property({ type: Object })
  public eventBus!: EventBus;

  @property({ type: Object })
  public transform!: TransformHandler;

  @state()
  private player: PlayerView | null = null;

  @state()
  private playerProfile: PlayerProfile | null = null;

  @state()
  private unit: UnitView | null = null;

  @state()
  private _isInfoVisible: boolean = false;

  @state()
  private spawnBarVisible = false;
  @state()
  private immunityBarVisible = false;

  private _isActive = false;

  private get barOffset(): number {
    return (this.spawnBarVisible ? 7 : 0) + (this.immunityBarVisible ? 7 : 0);
  }

  private lastMouseUpdate = 0;

  init() {
    this.eventBus.on(MouseMoveEvent, (e: MouseMoveEvent) =>
      this.onMouseEvent(e),
    );
    this.eventBus.on(ContextMenuEvent, (e: ContextMenuEvent) =>
      this.maybeShow(e.x, e.y),
    );
    this.eventBus.on(TouchEvent, (e: TouchEvent) => this.maybeShow(e.x, e.y));
    this.eventBus.on(CloseRadialMenuEvent, () => this.hide());
    this.eventBus.on(SpawnBarVisibleEvent, (e) => {
      this.spawnBarVisible = e.visible;
    });
    this.eventBus.on(ImmunityBarVisibleEvent, (e) => {
      this.immunityBarVisible = e.visible;
    });
    this._isActive = true;
  }

  private onMouseEvent(event: MouseMoveEvent) {
    const now = Date.now();
    if (now - this.lastMouseUpdate < 100) {
      return;
    }
    this.lastMouseUpdate = now;
    this.maybeShow(event.x, event.y);
  }

  public hide() {
    this.setVisible(false);
    this.unit = null;
    this.player = null;
  }

  private handleOverlayClick(event: MouseEvent) {
    if ((event.target as HTMLElement).closest("button") !== null) return;
    this.hide();
  }

  public maybeShow(x: number, y: number) {
    this.hide();
    const worldCoord = this.transform.screenToWorldCoordinates(x, y);
    if (!this.game.isValidCoord(worldCoord.x, worldCoord.y)) {
      return;
    }

    const tile = this.game.ref(worldCoord.x, worldCoord.y);
    if (!tile) return;

    const owner = this.game.owner(tile);

    if (owner && owner.isPlayer()) {
      this.player = owner as PlayerView;
      this.player.profile().then((p) => {
        this.playerProfile = p;
      });
      this.setVisible(true);
    } else if (!this.game.isLand(tile)) {
      const units = this.game
        .units(UnitType.Warship, UnitType.TradeShip, UnitType.TransportShip)
        .filter((u) => euclideanDistWorld(worldCoord, u.tile(), this.game) < 50)
        .sort(distSortUnitWorld(worldCoord, this.game));

      if (units.length > 0) {
        this.unit = units[0];
        this.setVisible(true);
      }
    }
  }

  tick() {
    this.requestUpdate();
  }

  setVisible(visible: boolean) {
    this._isInfoVisible = visible;
    this.requestUpdate();
  }

  private getPlayerNameColor(isFriendly: boolean): string {
    if (isFriendly) return "text-green-500";
    return "text-white";
  }

  private getRelationSmiley(
    player: PlayerView,
    myPlayer: PlayerView | null | undefined,
  ): TemplateResult | string {
    if (!myPlayer || myPlayer === player || player.type() !== PlayerType.Nation)
      return "";
    const relation =
      this.playerProfile?.relations[myPlayer.smallID()] ?? Relation.Neutral;
    if (relation === Relation.Neutral) return "";
    return html`<relation-smiley .relation=${relation}></relation-smiley>`;
  }

  private getRelationName(relation: Relation): string {
    switch (relation) {
      case Relation.Hostile:
        return translateText("relation.hostile");
      case Relation.Distrustful:
        return translateText("relation.distrustful");
      case Relation.Neutral:
        return translateText("relation.neutral");
      case Relation.Friendly:
        return translateText("relation.friendly");
      default:
        return translateText("relation.default");
    }
  }

  private displayUnitCount(player: PlayerView, type: UnitType, icon: string) {
    return !this.game.config().isUnitDisabled(type)
      ? html`<div
          class="flex items-center justify-center gap-0.5 lg:gap-1 p-0.5 lg:p-1 border rounded-md border-gray-500 text-[10px] lg:text-xs w-9 lg:w-12 h-6 lg:h-7"
          translate="no"
        >
          <img
            src=${icon}
            class="w-3 h-3 lg:w-4 lg:h-4 object-contain shrink-0"
          />
          <span>${player.totalUnitLevels(type)}</span>
        </div>`
      : "";
  }

  private allianceExpirationText(alliance: AllianceView) {
    const { expiresAt } = alliance;
    const remainingTicks = expiresAt - this.game.ticks();
    let remainingSeconds = 0;
    if (remainingTicks > 0) {
      remainingSeconds = Math.max(0, Math.floor(remainingTicks / 10)); // 10 ticks per second
    }
    return renderDuration(remainingSeconds);
  }

  private renderPlayerNameIcons(player: PlayerView) {
    const firstPlace = getFirstPlacePlayer(this.game);
    const icons = getPlayerIcons({
      game: this.game,
      player,
      // Because we already show the alliance icon next to the alliance expiration timer, we don't need to show it a second time in this render
      includeAllianceIcon: false,
      firstPlace,
      alliancesDisabled: this.game.config().disableAlliances(),
    });

    if (icons.length === 0) {
      return html``;
    }

    return html`<span class="flex items-center gap-1 ml-1 shrink-0">
      ${icons.map((icon) =>
        icon.kind === EMOJI_ICON_KIND && icon.text
          ? html`<span class="text-sm shrink-0" translate="no"
              >${icon.text}</span
            >`
          : icon.kind === IMAGE_ICON_KIND && icon.src
            ? html`<img src=${icon.src} alt="" class="w-4 h-4 shrink-0" />`
            : html``,
      )}
    </span>`;
  }

  private renderPlayerInfo(player: PlayerView) {
    const myPlayer = this.game.myPlayer();
    const isFriendly = myPlayer?.isFriendly(player);
    const isAllied = myPlayer?.isAlliedWith(player);
    let allianceHtml: TemplateResult | null = null;
    const maxTroops = this.game.config().maxTroops(player);
    const attackingTroops = player
      .outgoingAttacks()
      .map((a) => a.troops)
      .reduce((a, b) => a + b, 0);
    const totalTroops = player.troops();

    if (isAllied) {
      const alliance = myPlayer
        ?.alliances()
        .find((alliance) => alliance.other === player.id());
      if (alliance !== undefined) {
        allianceHtml = html` <div
          class="flex items-center ml-auto mr-0 gap-1 text-sm font-bold leading-tight"
        >
          <img src=${allianceIcon} width="20" height="20" />
          ${this.allianceExpirationText(alliance)}
        </div>`;
      }
    }
    let playerType = "";
    switch (player.type()) {
      case PlayerType.Bot:
        playerType = translateText("player_type.bot");
        break;
      case PlayerType.Nation:
        playerType = translateText("player_type.nation");
        break;
      case PlayerType.Human:
        playerType = translateText("player_type.player");
        break;
    }
    const playerTeam = getTranslatedPlayerTeamLabel(player.team());

    const worldCover =
      this.game.config().gameConfig().gameMap === GameMapType.WorldCover;
    const renderPlayerTroops = worldCover
      ? renderWorldCoverTroops
      : renderTroops;

    return html`
      <div>
        <div class="flex items-start gap-1 lg:gap-2 p-1 lg:p-1.5">
          <!-- Left: Gold & Troop bar -->
          <div class="flex flex-col gap-1 shrink-0 w-28 md:w-36">
            <div class="flex items-center gap-1">
              <div
                class="flex items-center justify-center px-1 py-0.5 border rounded-md border-yellow-400 font-bold text-yellow-400 text-sm lg:gap-1"
                translate="no"
              >
                <img src=${goldCoinIcon} width="13" height="13" />
                <span class="px-0.5">${renderNumber(player.gold())}</span>
              </div>
              <div
                class="flex flex-1 flex-col items-center justify-center text-xs font-bold ${
                  attackingTroops > 0 ? "text-aquarius" : "text-white/40"
                } drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
                translate="no"
              >
                <span class="flex items-center gap-px leading-none text-xs"
                  ><img
                    class="w-2.5 h-2.5 inline-block ${
                      attackingTroops > 0
                        ? ""
                        : "brightness-0 invert opacity-40"
                    }"
                    src=${attackingTroops > 0 ? soldierIconAquarius : soldierIcon}
                    alt=""
                    aria-hidden="true"
                  />↑</span
                >
                <span class="tabular-nums leading-none text-sm mt-0.5"
                  >${renderPlayerTroops(attackingTroops)}</span
                >
              </div>
            </div>
            <div class="w-28 md:w-36" translate="no">
              ${this.renderTroopBar(
                totalTroops,
                attackingTroops,
                maxTroops,
                renderPlayerTroops,
              )}
            </div>
          </div>
          <!-- Right: Player identity + Units below -->
          <div class="flex flex-col justify-between self-stretch">
            <div
              class="flex items-center gap-2 font-bold text-sm lg:text-lg ${this.getPlayerNameColor(
                isFriendly ?? false,
              )}"
            >
              ${
                player.cosmetics.flag
                  ? html`<img
                      class="h-6 object-contain"
                      src=${assetUrl(player.cosmetics.flag!)}
                    />`
                  : html``
              }
              <span>${player.displayName()}</span>
              ${this.getRelationSmiley(player, myPlayer)}
              ${
                playerTeam !== "" && player.type() !== PlayerType.Bot
                  ? html`<div class="flex flex-col leading-tight">
                      <span class="text-gray-400 text-xs font-normal"
                        >${playerType}</span
                      >
                      <span class="text-xs font-normal text-gray-400"
                        >[<span
                          style="color: ${themeProvider
                            .current()
                            .teamColor(player.team()!)
                            .toHex()}"
                          >${playerTeam}</span
                        >]</span
                      >
                    </div>`
                  : html`<span class="text-gray-400 text-xs font-normal"
                      >${playerType}</span
                    >`
              }
              ${this.renderPlayerNameIcons(player)} ${allianceHtml ?? ""}
            </div>
            <div class="flex gap-0.5 lg:gap-1 items-center mt-0.5">
              ${this.displayUnitCount(player, UnitType.City, cityIcon)}
              ${this.displayUnitCount(player, UnitType.Factory, factoryIcon)}
              ${this.displayUnitCount(player, UnitType.Port, portIcon)}
              ${this.displayUnitCount(
                player,
                UnitType.MissileSilo,
                missileSiloIcon,
              )}
              ${this.displayUnitCount(
                player,
                UnitType.SAMLauncher,
                samLauncherIcon,
              )}
              ${this.displayUnitCount(player, UnitType.Warship, warshipIcon)}
            </div>
          </div>
        </div>
        ${
          worldCover && this.userSettings.landValueStats()
            ? this.renderLandValueStats(player)
            : null
        }
      </div>
    `;
  }

  private renderLandValueStats(player: PlayerView) {
    const expanded = this.userSettings.landValueStatsExpanded();
    const breakdown = this.game.worldCoverLandValueBreakdown(player);
    const landValue = Math.max(player.landValue(), 0);
    const contributionPercent = (value: number) =>
      landValue === 0 ? "0.0%" : `${((value / landValue) * 100).toFixed(1)}%`;
    const valuedTerrain = WORLD_COVER_CLASSES.map((terrain, index) => ({
      terrain,
      index,
    })).filter(({ terrain }) => terrain.value > 0);

    return html`
      <div class="border-t border-slate-600/80 bg-slate-900/45 px-2 py-1.5">
        <div class="flex items-center justify-between gap-3 text-xs">
          <div class="font-bold text-slate-100">
            Terrain contribution
            <span class="ml-1 font-normal text-slate-300">
              Total: ${renderWorldCoverValue(player.landValue())}
            </span>
          </div>
          <button
            class="rounded border border-slate-500 px-1.5 text-slate-200 hover:bg-white/10"
            title=${expanded ? "Minimize land statistics" : "Expand land statistics"}
            @click=${(event: MouseEvent) => {
              event.stopPropagation();
              this.userSettings.toggleLandValueStatsExpanded();
              this.requestUpdate();
            }}
          >
            ${expanded ? "−" : "+"}
          </button>
        </div>
        ${
          expanded
            ? html`
                <div
                  class="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] leading-tight"
                  translate="no"
                >
                  <div class="flex items-center gap-1.5 text-slate-300">
                    <span
                      class="h-2.5 w-2.5 rounded-sm border border-white/30 bg-slate-500"
                    ></span>
                    <span>Starting base</span>
                    <span class="ml-auto text-slate-400"
                      >${contributionPercent(
                        WORLD_COVER_STARTING_LAND_VALUE,
                      )}</span
                    >
                    <strong class="text-white"
                      >${renderWorldCoverValue(
                        WORLD_COVER_STARTING_LAND_VALUE,
                      )}</strong
                    >
                  </div>
                  ${valuedTerrain.map(
                    ({ terrain, index }) => html`
                      <div
                        class="flex min-w-0 items-center gap-1.5 text-slate-300"
                      >
                        <span
                          class="h-2.5 w-2.5 shrink-0 rounded-sm border border-white/30"
                          style=${`background: rgb(${terrain.color.join(",")})`}
                        ></span>
                        <span class="truncate">${terrain.name}</span>
                        <span class="ml-auto whitespace-nowrap text-slate-400"
                          >${terrain.value}/tile ·
                          ${contributionPercent(breakdown[index] ?? 0)}</span
                        >
                        <strong class="whitespace-nowrap text-white"
                          >${renderWorldCoverValue(breakdown[index] ?? 0)}</strong
                        >
                      </div>
                    `,
                  )}
                  <div
                    class="col-span-2 flex min-w-0 items-center gap-1.5 text-slate-300"
                  >
                    <span
                      class="h-2.5 w-2.5 shrink-0 rounded-sm border border-white/30 bg-slate-500"
                    ></span>
                    <span class="truncate"
                      >Shrubland, wetland, bare & snow</span
                    >
                    <span class="ml-auto whitespace-nowrap text-slate-400"
                      >0/tile · 0.0%</span
                    >
                    <strong class="whitespace-nowrap text-white"
                      >${renderWorldCoverValue(0)}</strong
                    >
                  </div>
                </div>
              `
            : null
        }
      </div>
    `;
  }

  private renderTroopBar(
    totalTroops: number,
    attackingTroops: number,
    maxTroops: number,
    formatTroops: (troops: number) => string = renderTroops,
  ) {
    const base = Math.max(maxTroops, 1);
    const greenPercentRaw = (totalTroops / base) * 100;
    const orangePercentRaw = (attackingTroops / base) * 100;

    const greenPercent = Math.max(0, Math.min(100, greenPercentRaw));
    const orangePercent = Math.max(
      0,
      Math.min(100 - greenPercent, orangePercentRaw),
    );

    return html`
      <div
        class="w-full h-5 lg:h-6 border border-gray-600 rounded-md bg-gray-900/60 overflow-hidden relative"
      >
        <div class="relative h-full">
          <div
            class="absolute inset-y-0 left-0 w-full origin-left bg-sky-700 transition-transform duration-200 ease-out"
            style="transform: scaleX(${greenPercent / 100});"
          ></div>
          <div
            class="absolute inset-y-0 left-0 w-full origin-left bg-malibu-blue transition-transform duration-200 ease-out"
            style="transform: translateX(${greenPercent}%) scaleX(${
              orangePercent / 100
            });"
          ></div>
        </div>
        <div
          class="absolute inset-0 flex items-center justify-between px-1.5 text-sm font-bold leading-none pointer-events-none"
          translate="no"
        >
          <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >${formatTroops(totalTroops)}</span
          >
          <span class="text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]"
            >${formatTroops(maxTroops)}</span
          >
        </div>
        <img
          src=${soldierIcon}
          alt=""
          aria-hidden="true"
          width="14"
          height="14"
          class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 brightness-0 invert drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)] pointer-events-none"
        />
      </div>
    `;
  }

  private renderUnitInfo(unit: UnitView) {
    const isAlly =
      (unit.owner() === this.game.myPlayer() ||
        this.game.myPlayer()?.isFriendly(unit.owner())) ??
      false;

    return html`
      <div class="p-2">
        <div class="font-bold mb-1 ${isAlly ? "text-green-500" : "text-white"}">
          ${unit.owner().displayName()}
        </div>
        <div class="mt-1">
          <div class="text-sm opacity-80">${unit.type()}</div>
          ${
            unit.hasHealth()
              ? html` <div class="text-sm">Health: ${unit.health()}</div> `
              : ""
          }
          ${
            unit.type() === UnitType.TransportShip
              ? html`
                  <div class="text-sm">
                    Troops:
                    ${
                      this.game.config().gameConfig().gameMap ===
                      GameMapType.WorldCover
                        ? renderWorldCoverTroops(unit.troops())
                        : renderTroops(unit.troops())
                    }
                  </div>
                `
              : ""
          }
        </div>
      </div>
    `;
  }

  render() {
    if (!this._isActive) {
      return html``;
    }

    const containerClasses = this._isInfoVisible
      ? "opacity-100 visible"
      : "opacity-0 invisible pointer-events-none";
    const statsVisible =
      this.player !== null &&
      this.game.config().gameConfig().gameMap === GameMapType.WorldCover &&
      this.userSettings.landValueStats();

    return html`
      <div
        class="fixed top-0 left-0 right-0 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 z-[1001]"
        style="margin-top: ${this.barOffset}px;"
        @click=${this.handleOverlayClick}
        @contextmenu=${(e: MouseEvent) => e.preventDefault()}
      >
        <div
          class="bg-gray-800/92 backdrop-blur-sm shadow-xs min-[1200px]:rounded-lg sm:rounded-b-lg shadow-lg text-white text-lg lg:text-base w-full ${
            statsVisible ? "sm:w-[650px]" : "sm:w-[500px]"
          } overflow-hidden ${containerClasses}"
        >
          ${this.player !== null ? this.renderPlayerInfo(this.player) : ""}
          ${this.unit !== null ? this.renderUnitInfo(this.unit) : ""}
        </div>
      </div>
    `;
  }

  createRenderRoot() {
    return this; // Disable shadow DOM to allow Tailwind styles
  }
}
