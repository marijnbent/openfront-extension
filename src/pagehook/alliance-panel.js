"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;
  const PANEL_ID = "ofe-alliance-panel";
  const TOGGLE_ID = "ofe-alliance-panel-toggle";
  const HIDDEN_STORAGE_KEY = "ofe.alliance.panel.hidden";
  const MAX_VISIBLE_ROWS = 3;
  const TICKS_PER_SECOND = 10;
  const DEFAULT_EXTENSION_WINDOW_TICKS = 30 * TICKS_PER_SECOND;
  const PREPARE_WARNING_TICKS = 90 * TICKS_PER_SECOND;
  const FLASH_WARNING_TICKS = 10 * TICKS_PER_SECOND;
  const INTERACTION_RELEASE_DELAY_MS = 90;
  const PANEL_Z_INDEX = 190;
  const PANEL_BASE_TOP = 84;
  const PANEL_STACK_GAP = 8;
  const BOMB_VISIBLE_MS = 30000;
  const MAX_TRACKED_BOMBS = 50;
  const BETRAYAL_VISIBLE_MS = 15000;
  const recentBetrayals = new Map();
  const BOMB_ROW_HEIGHTS = { atom: 34, hydrogen: 38, mirv: 40 };
  const lastSeenAlliances = new Map();
  const recentlyExpiredAlliances = new Map();
  const nativeRenewActions = new Map();
  const ignoredRenewals = new Map();
  const animatedBombUnitIDs = new Set();

  function readHiddenSetting() {
    try {
      return localStorage.getItem(HIDDEN_STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function writeHiddenSetting(hidden) {
    try {
      localStorage.setItem(HIDDEN_STORAGE_KEY, hidden ? "1" : "0");
    } catch (_) {}
  }

  function formatTicksAsClock(ticks) {
    const totalSeconds = Math.max(0, Math.ceil(Number(ticks || 0) / TICKS_PER_SECOND));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function getPendingRenewals() {
    if (!(state.allianceExtensionPendingById instanceof Map)) {
      state.allianceExtensionPendingById = new Map();
    }
    return state.allianceExtensionPendingById;
  }

  function syncNativeRenewals() {
    const actionableEvents = document.querySelector("actionable-events");
    if (!actionableEvents || !Array.isArray(actionableEvents.events)) return 0;

    const remainingEvents = [];
    let removedCount = 0;

    for (const event of actionableEvents.events) {
      const allianceId = Number(event?.allianceID);
      if (!Number.isFinite(allianceId)) {
        remainingEvents.push(event);
        continue;
      }

      const renewButton = Array.isArray(event.buttons)
        ? event.buttons.find(
            (button) =>
              button &&
              button.className === "btn" &&
              typeof button.action === "function",
          )
        : null;
      if (renewButton) {
        nativeRenewActions.set(allianceId, renewButton.action);
      }
      removedCount += 1;
    }

    if (removedCount > 0) {
      actionableEvents.events = remainingEvents;
      actionableEvents.requestUpdate?.();
    }

    return removedCount;
  }

  function findNativeRenewAction(allianceId) {
    const actionableEvents = document.querySelector("actionable-events");
    if (!actionableEvents) return null;

    const numericAllianceId = Number(allianceId);
    syncNativeRenewals();
    let action = nativeRenewActions.get(numericAllianceId) || null;
    if (action) return action;

    // A dismissed OpenFront prompt can still be renewed from this panel.
    // Let OpenFront rebuild that prompt so its native transport owns encoding.
    try {
      if (
        actionableEvents.alliancesCheckedAt instanceof Map &&
        typeof actionableEvents.checkForAllianceExpirations === "function"
      ) {
        actionableEvents.alliancesCheckedAt.delete(numericAllianceId);
        actionableEvents.checkForAllianceExpirations();
        syncNativeRenewals();
        action = nativeRenewActions.get(numericAllianceId) || null;
      }
    } catch (_) {}

    return action;
  }

  function getExtensionWindowTicks(game) {
    const config = game && typeof game.config === "function" ? game.config() : null;
    if (config && typeof config.allianceExtensionPromptOffset === "function") {
      const value = Number(config.allianceExtensionPromptOffset());
      if (Number.isFinite(value) && value > 0) return value;
    }
    return DEFAULT_EXTENSION_WINDOW_TICKS;
  }

  function navigateToPosition(x, y, instant = false) {
    const buildMenu = document.querySelector("build-menu");
    if (!buildMenu || !buildMenu.transformHandler) return;
    const th = buildMenu.transformHandler;
    if (!instant && typeof th.onGoToPosition === "function") {
      th.onGoToPosition({ x, y });
      return;
    }

    if (typeof th.override !== "function" || typeof th.boundingRect !== "function") {
      return;
    }

    const rect = th.boundingRect();
    const scale = Number(th.scale) || 1;
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (!game || typeof game.width !== "function" || typeof game.height !== "function") {
      return;
    }

    const gameW = Number(game.width());
    const gameH = Number(game.height());
    const canvasW = Number(rect && rect.width) || gameW;
    const canvasH = Number(rect && rect.height) || gameH;

    const offsetX = x - gameW / 2 - (canvasW - gameW) / (2 * scale);
    const offsetY = y - gameH / 2 - (canvasH - gameH) / (2 * scale);
    th.override(offsetX, offsetY, scale);
  }

  function focusAlliancePlayer(row) {
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (!game || typeof game.player !== "function") return;

    let other = null;
    try {
      other = game.player(row.recipientId);
    } catch (_) {
      other = null;
    }
    if (!other || typeof other.nameLocation !== "function") return;

    const loc = other.nameLocation();
    if (!loc || !Number.isFinite(loc.x) || !Number.isFinite(loc.y)) return;
    navigateToPosition(loc.x, loc.y, true);
  }

  function findLiveAllianceByRecipient(recipientId) {
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (!game || typeof game.myPlayer !== "function") return null;
    const me = game.myPlayer();
    if (!me || typeof me.alliances !== "function") return null;

    const numericRecipientId = Number(recipientId);
    for (const alliance of me.alliances()) {
      if (!alliance || Number(alliance.other) !== numericRecipientId) continue;
      return alliance;
    }

    return null;
  }

  function markAllianceRenewPending(allianceId, recipientId) {
    const numericAllianceId = Number(allianceId);
    if (!Number.isFinite(numericAllianceId)) return false;

    getPendingRenewals().set(numericAllianceId, {
      recipientId: Number.isFinite(Number(recipientId)) ? Number(recipientId) : null,
      at: Date.now(),
    });
    return true;
  }

  function clearAllianceRenewPending(allianceId) {
    getPendingRenewals().delete(Number(allianceId));
  }

  function isAllianceRenewalIgnored(allianceId, expiresAt) {
    const numericAllianceId = Number(allianceId);
    const ignoredExpiresAt = ignoredRenewals.get(numericAllianceId);
    if (ignoredExpiresAt == null) return false;
    if (Number(ignoredExpiresAt) === Number(expiresAt)) return true;
    ignoredRenewals.delete(numericAllianceId);
    return false;
  }

  function ignoreAllianceRenewal(allianceId, expiresAt) {
    const numericAllianceId = Number(allianceId);
    if (!Number.isFinite(numericAllianceId)) return;
    ignoredRenewals.set(numericAllianceId, Number(expiresAt));
    nativeRenewActions.delete(numericAllianceId);
  }

  function sendAllianceExtension(recipientId, allianceId) {
    const nativeRenew = findNativeRenewAction(allianceId);
    if (!nativeRenew) return false;

    try {
      nativeRenew();
      markAllianceRenewPending(allianceId, recipientId);
      return true;
    } catch (_) {
      return false;
    }
  }

  function cleanPendingRenewals(validIds) {
    const pendingRenewals = getPendingRenewals();
    for (const allianceId of pendingRenewals.keys()) {
      if (!validIds.has(allianceId)) {
        pendingRenewals.delete(allianceId);
      }
    }
    for (const allianceId of nativeRenewActions.keys()) {
      if (!validIds.has(allianceId)) nativeRenewActions.delete(allianceId);
    }
    for (const allianceId of ignoredRenewals.keys()) {
      if (!validIds.has(allianceId)) ignoredRenewals.delete(allianceId);
    }
  }

  function cleanExpiredAlliances(nowTick, extensionWindowTicks, activeIds) {
    for (const [allianceId, row] of recentlyExpiredAlliances.entries()) {
      if (activeIds.has(allianceId)) {
        recentlyExpiredAlliances.delete(allianceId);
        continue;
      }
      if (nowTick > row.expiresAt + extensionWindowTicks) {
        recentlyExpiredAlliances.delete(allianceId);
      }
    }
  }

  function buildLiveRow(alliance, other, nowTick, extensionWindowTicks) {
    const remainingTicks = Math.max(0, Number(alliance.expiresAt) - nowTick);
    const inExtensionWindow = remainingTicks <= extensionWindowTicks;
    const prepareStartTicks = extensionWindowTicks + PREPARE_WARNING_TICKS;
    const prepareDurationTicks = Math.max(1, prepareStartTicks - extensionWindowTicks);
    const warmupFraction =
      remainingTicks > extensionWindowTicks && remainingTicks <= prepareStartTicks
        ? 1 - (remainingTicks - extensionWindowTicks) / prepareDurationTicks
        : remainingTicks <= extensionWindowTicks
          ? 1
          : 0;
    const hasExtensionRequest = getPendingRenewals().has(Number(alliance.id));
    const isIgnored = isAllianceRenewalIgnored(alliance.id, alliance.expiresAt);
    const canAsk =
      inExtensionWindow &&
      remainingTicks > 0 &&
      !hasExtensionRequest &&
      !isIgnored;
    const otherName =
      fn.getPlayerDisplayName?.(other) ||
      (typeof other.displayName === "function" ? String(other.displayName() || "") : "") ||
      `#${alliance.other}`;

    const phase =
      remainingTicks <= 0
        ? "expired"
        : inExtensionWindow && !isIgnored
          ? "renew"
          : "normal";
    const fillFraction =
      phase === "renew"
        ? Math.max(0, Math.min(1, remainingTicks / extensionWindowTicks))
        : 0;

    let statusText = `${formatTicksAsClock(remainingTicks)} left`;
    if (hasExtensionRequest && remainingTicks > 0) {
      statusText = `${statusText} · pending`;
    } else if (isIgnored && remainingTicks > 0) {
      statusText = `${statusText} · ignored`;
    } else if (remainingTicks <= 0) {
      statusText = "Expired";
    }

    return {
      allianceId: alliance.id,
      recipientId: alliance.other,
      name: otherName,
      expiresAt: Number(alliance.expiresAt),
      remainingTicks,
      statusText,
      phase,
      fillFraction,
      warmupFraction: isIgnored ? 0 : warmupFraction,
      flashDanger:
        !isIgnored && remainingTicks > 0 && remainingTicks <= FLASH_WARNING_TICKS,
      canAsk,
      hasExtensionRequest,
      isIgnored,
      sortValue: remainingTicks,
    };
  }

  function collectAllianceRows(game) {
    if (!game || typeof game.myPlayer !== "function") return [];
    const me = game.myPlayer();
    if (!me || typeof me.isAlive !== "function" || !me.isAlive()) return [];
    if (typeof me.alliances !== "function") return [];

    const nowTick = typeof game.ticks === "function" ? Number(game.ticks()) : 0;
    const extensionWindowTicks = getExtensionWindowTicks(game);
    const activeIds = new Set();
    const validIds = new Set();
    const rows = [];
    const previousSeen = new Map(lastSeenAlliances);
    lastSeenAlliances.clear();

    for (const alliance of me.alliances()) {
      if (!alliance) continue;
      activeIds.add(alliance.id);
      validIds.add(alliance.id);

      let other = null;
      try {
        other = typeof game.player === "function" ? game.player(alliance.other) : null;
      } catch (_) {
        other = null;
      }
      if (!other || (typeof other.isAlive === "function" && !other.isAlive())) continue;

      const liveRow = buildLiveRow(alliance, other, nowTick, extensionWindowTicks);
      const previousRow = previousSeen.get(alliance.id);
      if (
        previousRow &&
        Number(liveRow.expiresAt) > Number(previousRow.expiresAt)
      ) {
        clearAllianceRenewPending(liveRow.allianceId);
      }
      lastSeenAlliances.set(alliance.id, {
        allianceId: liveRow.allianceId,
        recipientId: liveRow.recipientId,
        name: liveRow.name,
        expiresAt: liveRow.expiresAt,
      });

      if (liveRow.phase === "expired") {
        recentlyExpiredAlliances.set(liveRow.allianceId, {
          allianceId: liveRow.allianceId,
          recipientId: liveRow.recipientId,
          name: liveRow.name,
          expiresAt: liveRow.expiresAt,
        });
      } else {
        recentlyExpiredAlliances.delete(liveRow.allianceId);
        rows.push(liveRow);
      }
    }

    for (const [allianceId, snapshot] of previousSeen.entries()) {
      if (activeIds.has(allianceId)) continue;
      if (nowTick >= snapshot.expiresAt && nowTick <= snapshot.expiresAt + extensionWindowTicks) {
        recentlyExpiredAlliances.set(allianceId, snapshot);
      }
      clearAllianceRenewPending(allianceId);
    }

    cleanPendingRenewals(validIds);
    cleanExpiredAlliances(nowTick, extensionWindowTicks, activeIds);

    for (const row of recentlyExpiredAlliances.values()) {
      if (activeIds.has(row.allianceId)) continue;
      const expiredAgeTicks = Math.max(0, nowTick - row.expiresAt);
      rows.push({
        allianceId: row.allianceId,
        recipientId: row.recipientId,
        name: row.name,
        expiresAt: row.expiresAt,
        remainingTicks: 0,
        statusText: "Expired",
        phase: "expired",
        fillFraction: 1,
        canAsk: false,
        hasExtensionRequest: false,
        sortValue: -1 + expiredAgeTicks / extensionWindowTicks,
      });
    }

    rows.sort((a, b) => a.sortValue - b.sortValue || a.name.localeCompare(b.name));
    return rows;
  }

  function makeRowFill(row) {
    if (row.phase === "normal" || row.phase === "expired") return null;
    const fill = document.createElement("div");
    const percent = `${Math.round(row.fillFraction * 1000) / 10}%`;
    const fillColor =
      row.flashDanger
        ? Math.floor(Date.now() / 450) % 2 === 0
          ? "rgba(220,38,38,0.5)"
          : "rgba(127,29,29,0.3)"
        : row.phase === "expired"
          ? "rgba(127,29,29,0.4)"
          : "rgba(154,52,18,0.42)";

    fill.style.cssText =
      "position:absolute;left:0;top:0;bottom:0;width:" + percent + ";" +
      "pointer-events:none;background:" + fillColor + ";";
    return fill;
  }

  function blendRowColor(from, to, fraction, alpha) {
    const clamped = Math.max(0, Math.min(1, Number(fraction) || 0));
    const red = Math.round(from[0] + (to[0] - from[0]) * clamped);
    const green = Math.round(from[1] + (to[1] - from[1]) * clamped);
    const blue = Math.round(from[2] + (to[2] - from[2]) * clamped);
    return `rgba(${red},${green},${blue},${alpha})`;
  }

  function getRowBackground(row) {
    if (row.phase === "expired") {
      return "rgba(127,29,29,0.38)";
    }

    if (row.flashDanger) {
      const flashOn = Math.floor(Date.now() / 450) % 2 === 0;
      return flashOn ? "rgba(185,28,28,0.76)" : "rgba(120,53,15,0.9)";
    }

    return blendRowColor([7, 12, 20], [154, 52, 18], row.warmupFraction, 0.82);
  }

  function buildActionButtons(row) {
    if (row.phase === "normal" || row.phase === "expired") return null;

    const actions = document.createElement("div");
    actions.style.cssText =
      "position:relative;z-index:1;display:flex;align-items:center;gap:5px;flex:0 0 auto;";

    const action = document.createElement("button");
    action.type = "button";
    action.textContent = row.hasExtensionRequest ? "Pending" : "Renew";
    action.disabled = !row.canAsk;
    action.style.cssText =
      "position:relative;z-index:1;flex:0 0 auto;min-width:58px;height:24px;padding:0 8px;" +
      "border-radius:7px;border:1px solid " +
      (row.canAsk
        ? row.flashDanger
          ? "rgba(254,202,202,0.72)"
          : "rgba(251,146,60,0.65)"
        : "rgba(148,163,184,0.2)") +
      ";background:" +
      (row.canAsk
        ? row.flashDanger
          ? "rgba(153,27,27,0.94)"
          : "rgba(154,52,18,0.94)"
        : "rgba(15,23,42,0.58)") +
      ";color:" +
      (row.canAsk ? "#ffedd5" : "#cbd5e1") +
      ";font-size:11px;font-weight:600;cursor:" +
      (row.canAsk ? "pointer" : "default") + ";";
    action.title = row.canAsk
      ? `Request renewal with ${row.name}`
      : `Renewal already pending for ${row.name}`;
    action.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!row.canAsk) return;
      if (sendAllianceExtension(row.recipientId, row.allianceId)) {
        action.disabled = true;
        action.textContent = "Pending";
        action.style.cursor = "default";
        renderAlliancePanel();
      }
    });

    actions.appendChild(action);
    if (row.canAsk) {
      const ignore = document.createElement("button");
      ignore.type = "button";
      ignore.textContent = "Ignore";
      ignore.title = `Ignore this renewal for ${row.name}`;
      ignore.style.cssText =
        "height:24px;padding:0 7px;border-radius:7px;" +
        "border:1px solid rgba(96,165,250,0.5);background:rgba(30,64,175,0.72);" +
        "color:#dbeafe;font-size:11px;font-weight:600;cursor:pointer;";
      ignore.addEventListener("click", (event) => {
        event.stopPropagation();
        ignoreAllianceRenewal(row.allianceId, row.expiresAt);
        renderAlliancePanel();
      });
      actions.appendChild(ignore);
    }

    return actions;
  }

  function buildRow(row) {
    const item = document.createElement("div");
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.title = `Go to ${row.name}`;
    item.style.cssText =
      "position:relative;display:flex;align-items:center;justify-content:space-between;gap:8px;" +
      "padding:6px 8px;border-top:1px solid rgba(148,163,184,0.14);" +
      "background:" + getRowBackground(row) +
      ";cursor:pointer;overflow:hidden;";

    const fill = makeRowFill(row);
    if (fill) item.appendChild(fill);

    const copy = document.createElement("div");
    copy.style.cssText = "position:relative;z-index:1;min-width:0;flex:1 1 auto;";

    const name = document.createElement("div");
    name.textContent = row.name;
    name.style.cssText =
      "font-size:12px;font-weight:600;color:#f8fafc;line-height:1.2;" +
      "white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

    const meta = document.createElement("div");
    meta.textContent = row.statusText;
    meta.style.cssText =
      "margin-top:2px;font-size:10px;line-height:1.2;color:" +
      (row.phase === "expired"
        ? "#fecaca;"
        : row.flashDanger
          ? "#fee2e2;"
          : row.phase === "renew" || row.warmupFraction > 0
          ? "#fdba74;"
          : "#94a3b8;");

    copy.appendChild(name);
    copy.appendChild(meta);

    const actions = buildActionButtons(row);

    const activateFocus = () => focusAlliancePlayer(row);
    item.addEventListener("click", activateFocus);
    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activateFocus();
    });

    item.appendChild(copy);
    if (actions) item.appendChild(actions);
    return item;
  }

  function getVisibleThreats() {
    const cutoff = Date.now() - BOMB_VISIBLE_MS;
    const bombs = Array.isArray(state.incomingBombs)
      ? state.incomingBombs.filter((bomb) => bomb.createdAt >= cutoff)
      : [];
    state.incomingBombs = bombs.slice(-MAX_TRACKED_BOMBS);
    const visibleUnitIDs = new Set(state.incomingBombs.map((bomb) => Number(bomb.unitID)));
    for (const unitID of animatedBombUnitIDs) {
      if (!visibleUnitIDs.has(unitID)) animatedBombUnitIDs.delete(unitID);
    }
    for (const [playerID, betrayal] of recentBetrayals) {
      if (betrayal.createdAt < Date.now() - BETRAYAL_VISIBLE_MS) {
        recentBetrayals.delete(playerID);
      }
    }
    return [...state.incomingBombs, ...recentBetrayals.values()]
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  function getThreatRowPresentation(kind) {
    if (kind === "traitor") {
      return {
        height: 34,
        label: "Traitor",
        accent: "#f87171",
        badge: "background:rgba(153,27,27,0.82);border-color:rgba(252,165,165,0.3);color:#fee2e2;",
        background: "linear-gradient(90deg,rgba(69,10,10,0.58),rgba(22,14,20,0.96))",
      };
    }
    if (kind === "mirv") {
      return {
        height: BOMB_ROW_HEIGHTS.mirv,
        label: "MIRV",
        accent: "#f87171",
        badge: "background:rgba(220,38,38,0.9);border-color:rgba(254,202,202,0.34);color:#fff;",
        background: "linear-gradient(90deg,rgba(127,29,29,0.72),rgba(30,11,18,0.96))",
      };
    }
    if (kind === "hydrogen") {
      return {
        height: BOMB_ROW_HEIGHTS.hydrogen,
        label: "Hydrogen bomb",
        accent: "#fb923c",
        badge: "background:rgba(194,65,12,0.88);border-color:rgba(254,215,170,0.3);color:#fff;",
        background: "linear-gradient(90deg,rgba(124,45,18,0.68),rgba(30,17,13,0.96))",
      };
    }
    return {
      height: BOMB_ROW_HEIGHTS.atom,
      label: "Atom bomb",
      accent: "#ef4444",
      badge: "background:rgba(153,27,27,0.82);border-color:rgba(252,165,165,0.3);color:#fee2e2;",
      background: "linear-gradient(90deg,rgba(69,10,10,0.58),rgba(22,14,20,0.96))",
    };
  }

  function buildThreatRow(bomb) {
    const presentation = getThreatRowPresentation(bomb.kind);
    const item = document.createElement("button");
    item.type = "button";
    item.className = `ofe-bomb-row ofe-bomb-row--${bomb.kind}`;
    item.style.cssText =
      `position:relative;display:flex;align-items:center;gap:7px;width:100%;height:${presentation.height}px;` +
      `padding:4px 8px 4px 10px;box-sizing:border-box;border:0;border-top:1px solid rgba(248,113,113,0.16);` +
      `background:${presentation.background};color:#fecaca;text-align:left;cursor:pointer;overflow:hidden;` +
      `box-shadow:inset 3px 0 0 ${presentation.accent};`;
    if (bomb.kind !== "traitor" && !animatedBombUnitIDs.has(bomb.unitID)) {
      animatedBombUnitIDs.add(bomb.unitID);
      item.setAttribute("data-ofe-new-bomb", "true");
    }

    const badge = document.createElement("span");
    badge.className = "ofe-bomb-badge";
    badge.style.cssText =
      "flex:0 0 auto;padding:2px 5px;border:1px solid;border-radius:5px;" +
      `font-size:10px;font-weight:800;line-height:1.2;letter-spacing:0.02em;${presentation.badge}`;
    badge.textContent = presentation.label;

    const sender = document.createElement("span");
    sender.className = "ofe-bomb-sender";
    sender.style.cssText =
      "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
      "font-size:11px;font-weight:650;line-height:1.2;color:#f8fafc;";
    sender.textContent = bomb.kind === "traitor" ? bomb.senderName : `from ${bomb.senderName}`;

    item.title = `Go to ${bomb.senderName}`;
    item.setAttribute("aria-label", bomb.kind === "traitor"
      ? `${bomb.senderName} betrayed and is now a traitor. Go to player.`
      : `${presentation.label} from ${bomb.senderName}. Go to player.`);
    item.addEventListener("click", () => {
      fn.focusOfeTarget?.({ focusID: bomb.senderID }, { instant: true });
    });
    item.appendChild(badge);
    item.appendChild(sender);
    return item;
  }

  function buildEmptyState() {
    const empty = document.createElement("div");
    empty.style.cssText =
      "padding:10px 8px;border-top:1px solid rgba(148,163,184,0.14);" +
      "font-size:11px;line-height:1.35;color:#94a3b8;";
    empty.textContent = "No alliances";
    return empty;
  }

  function renderThreatList(panelState, bombs) {
    const renderKey = bombs
      .map((bomb) => `${bomb.unitID}:${bomb.kind}:${bomb.senderID}:${bomb.senderName}:${bomb.createdAt}`)
      .join("|");
    if (renderKey === panelState.bombRenderKey) return;

    panelState.bombRenderKey = renderKey;
    panelState.bombCount.textContent = String(bombs.length);
    panelState.bombList.textContent = "";
    panelState.bombList.style.maxHeight = `${bombs
      .slice(0, 3)
      .reduce((height, bomb) => height + getThreatRowPresentation(bomb.kind).height, 0)}px`;
    for (const bomb of bombs) {
      panelState.bombList.appendChild(buildThreatRow(bomb));
    }
  }

  function updateHiddenUI(hidden, hasRows, inSpawn) {
    const panelState = state.alliancePanelState;
    if (!panelState) return;

    if (hidden) {
      panelState.panel.style.display = "none";
      panelState.toggle.style.display = !inSpawn ? "" : "none";
      return;
    }

    panelState.toggle.style.display = "none";
    if (inSpawn) {
      panelState.panel.style.display = "none";
    }
  }

  function setAlliancePanelHidden(hidden) {
    const panelState = state.alliancePanelState;
    if (!panelState) return;
    panelState.hidden = Boolean(hidden);
    writeHiddenSetting(panelState.hidden);
    renderAlliancePanel();
  }

  function updateAlliancePanelTop() {
    const panelState = state.alliancePanelState;
    if (!panelState) return;

    let top = PANEL_BASE_TOP;
    const sidebar = document.querySelector("game-right-sidebar");
    if (sidebar && typeof sidebar.getBoundingClientRect === "function") {
      const rect = sidebar.getBoundingClientRect();
      const viewportWidth = Number(window.innerWidth) || Infinity;
      const isVisible =
        Number(rect.width) > 0 &&
        Number(rect.height) > 0 &&
        Number(rect.right) > 0 &&
        Number(rect.left) < viewportWidth &&
        Number(rect.bottom) > 0;
      if (isVisible) {
        top = Math.max(top, Math.ceil(Number(rect.bottom) + PANEL_STACK_GAP));
      }
    }

    const value = `${top}px`;
    panelState.panel.style.top = value;
    panelState.toggle.style.top = value;
  }

  function lockAlliancePanelInteraction() {
    const panelState = state.alliancePanelState;
    if (!panelState) return;
    panelState.pointerInteractionActive = true;
    panelState.interactionLockUntil = Date.now() + INTERACTION_RELEASE_DELAY_MS;

    if (panelState.releaseTimer) {
      clearTimeout(panelState.releaseTimer);
      panelState.releaseTimer = null;
    }
  }

  function releaseAlliancePanelInteraction() {
    const panelState = state.alliancePanelState;
    if (!panelState) return;

    panelState.pointerInteractionActive = false;
    panelState.interactionLockUntil = Date.now() + INTERACTION_RELEASE_DELAY_MS;

    if (panelState.releaseTimer) {
      clearTimeout(panelState.releaseTimer);
    }

    panelState.releaseTimer = window.setTimeout(() => {
      const liveState = state.alliancePanelState;
      if (!liveState || liveState !== panelState) return;
      liveState.releaseTimer = null;
      renderAlliancePanel();
    }, INTERACTION_RELEASE_DELAY_MS);
  }

  function renderAlliancePanel() {
    const panelState = state.alliancePanelState;
    if (!panelState) return;

    updateAlliancePanelTop();

    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    const allianceRows = collectAllianceRows(game);
    const bombs = getVisibleThreats();
    const inSpawn =
      game && typeof game.inSpawnPhase === "function"
        ? game.inSpawnPhase()
        : state.gamePhase !== "playing";

    updateHiddenUI(panelState.hidden, allianceRows.length > 0, inSpawn);
    if (panelState.hidden || inSpawn) return;

    panelState.panel.style.display = "";
    if (
      panelState.pointerInteractionActive ||
      Date.now() < Number(panelState.interactionLockUntil || 0)
    ) {
      return;
    }

    const previousScrollTop = panelState.list.scrollTop;
    panelState.count.textContent = String(allianceRows.length);
    panelState.list.textContent = "";
    const rowCount = allianceRows.length;
    panelState.list.style.maxHeight = rowCount
      ? `${Math.min(MAX_VISIBLE_ROWS, rowCount) * 51}px`
      : "42px";

    if (!rowCount) {
      panelState.list.appendChild(buildEmptyState());
    } else {
      for (const row of allianceRows) {
        panelState.list.appendChild(buildRow(row));
      }
    }

    panelState.bombSection.style.display = bombs.length ? "" : "none";
    renderThreatList(panelState, bombs);

    panelState.list.scrollTop = previousScrollTop;
  }

  fn.noteAllianceExtensionIntent = (recipientId, allianceId = null) => {
    let targetAllianceId = Number(allianceId);
    const targetRecipientId = Number(recipientId);
    if (!Number.isFinite(targetAllianceId)) {
      const alliance = findLiveAllianceByRecipient(targetRecipientId);
      targetAllianceId = alliance ? Number(alliance.id) : NaN;
    }
    if (!Number.isFinite(targetAllianceId)) return false;
    markAllianceRenewPending(targetAllianceId, targetRecipientId);
    renderAlliancePanel();
    return true;
  };

  fn.noteAllianceExtensionUpdate = (allianceId, playerId = null) => {
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    const me =
      game && typeof game.myPlayer === "function"
        ? game.myPlayer()
        : null;
    const mySmallId =
      me && typeof me.smallID === "function"
        ? Number(me.smallID())
        : NaN;
    if (
      Number.isFinite(Number(playerId)) &&
      Number.isFinite(mySmallId) &&
      Number(playerId) !== mySmallId
    ) {
      return false;
    }
    if (!Number.isFinite(Number(allianceId))) return false;
    markAllianceRenewPending(Number(allianceId), null);
    renderAlliancePanel();
    return true;
  };

  fn.notePlayerBetrayal = (player) => {
    const senderID = player?.smallID?.();
    if (!Number.isInteger(senderID) || senderID <= 0) return;
    recentBetrayals.delete(senderID);
    recentBetrayals.set(senderID, {
      kind: "traitor",
      senderID,
      senderName: fn.getPlayerDisplayName?.(player) || `#${senderID}`,
      createdAt: Date.now(),
    });
    if (recentBetrayals.size > MAX_TRACKED_BOMBS) {
      recentBetrayals.delete(recentBetrayals.keys().next().value);
    }
    renderAlliancePanel();
  };

  fn.noteIncomingBombs = (incoming) => {
    if (!Array.isArray(incoming) || !incoming.length) return 0;
    const bombsByUnit = new Map(
      (Array.isArray(state.incomingBombs) ? state.incomingBombs : []).map(
        (bomb) => [Number(bomb.unitID), bomb],
      ),
    );
    let added = 0;
    for (const bomb of incoming) {
      const unitID = Number(bomb?.unitID);
      const createdAt = Number(bomb?.createdAt);
      if (!Number.isFinite(unitID) || !Number.isFinite(createdAt)) continue;
      if (bombsByUnit.has(unitID)) continue;
      added += 1;
      bombsByUnit.set(unitID, {
        kind: ["atom", "hydrogen", "mirv"].includes(bomb.kind) ? bomb.kind : "atom",
        unitID,
        senderID: Number.isFinite(Number(bomb.senderID)) ? Number(bomb.senderID) : null,
        senderName: String(bomb.senderName || "Unknown player"),
        createdAt,
      });
    }
    state.incomingBombs = [...bombsByUnit.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-MAX_TRACKED_BOMBS);
    renderAlliancePanel();
    return added;
  };

  fn.initAlliancePanel = () => {
    if (state.alliancePanelState) return;

    const panel = document.createElement("section");
    panel.id = PANEL_ID;
    panel.style.cssText =
      `position:fixed;right:12px;top:${PANEL_BASE_TOP}px;z-index:${PANEL_Z_INDEX};` +
      "width:min(248px,calc(100vw - 24px));" +
      "background:rgba(9,14,24,0.94);border:1px solid rgba(148,163,184,0.22);" +
      "border-radius:10px;color:#e2e8f0;box-shadow:0 8px 24px rgba(0,0,0,0.34);" +
      "backdrop-filter:blur(3px);font-family:ui-sans-serif,system-ui,sans-serif;";

    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;gap:8px;" +
      "padding:7px 8px;border-bottom:1px solid rgba(148,163,184,0.14);";

    const left = document.createElement("div");
    left.style.cssText = "display:flex;align-items:center;gap:8px;min-width:0;";

    const title = document.createElement("div");
    title.textContent = "Alliances";
    title.style.cssText = "font-size:12px;font-weight:700;color:#f8fafc;";

    const count = document.createElement("div");
    count.style.cssText =
      "min-width:18px;height:18px;padding:0 6px;border-radius:6px;" +
      "display:inline-flex;align-items:center;justify-content:center;" +
      "background:rgba(30,41,59,0.92);border:1px solid rgba(148,163,184,0.22);" +
      "font-size:10px;font-weight:700;color:#cbd5e1;";

    const hide = document.createElement("button");
    hide.type = "button";
    hide.textContent = "Hide";
    hide.style.cssText =
      "height:22px;padding:0 8px;border-radius:7px;border:1px solid rgba(148,163,184,0.2);" +
      "background:rgba(15,23,42,0.65);color:#cbd5e1;font-size:11px;font-weight:600;cursor:pointer;";
    hide.addEventListener("click", () => setAlliancePanelHidden(true));

    const list = document.createElement("div");
    list.style.cssText =
      "overflow-y:auto;overscroll-behavior:contain;" +
      "scrollbar-width:thin;scrollbar-color:rgba(148,163,184,0.45) transparent;";

    const bombSection = document.createElement("section");
    bombSection.id = "ofe-bomb-section";
    bombSection.style.cssText = "display:none;border-top:1px solid rgba(248,113,113,0.26);";
    const bombHeader = document.createElement("div");
    bombHeader.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;padding:6px 8px;" +
      "font-size:11px;font-weight:700;color:#fecaca;background:rgba(69,10,10,0.5);";
    const bombTitle = document.createElement("span");
    bombTitle.textContent = "Incoming threats";
    const bombCount = document.createElement("span");
    const bombList = document.createElement("div");
    bombList.id = "ofe-bomb-list";
    bombList.style.cssText =
      "overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;";
    bombHeader.appendChild(bombTitle);
    bombHeader.appendChild(bombCount);
    bombSection.appendChild(bombHeader);
    bombSection.appendChild(bombList);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.id = TOGGLE_ID;
    toggle.textContent = "Alliances";
    toggle.style.cssText =
      `position:fixed;right:12px;top:${PANEL_BASE_TOP}px;z-index:${PANEL_Z_INDEX};` +
      "height:26px;padding:0 10px;" +
      "border-radius:8px;border:1px solid rgba(148,163,184,0.22);" +
      "background:rgba(9,14,24,0.94);color:#e2e8f0;box-shadow:0 8px 24px rgba(0,0,0,0.34);" +
      "backdrop-filter:blur(3px);font-size:11px;font-weight:700;cursor:pointer;display:none;";
    toggle.addEventListener("click", () => setAlliancePanelHidden(false));

    left.appendChild(title);
    left.appendChild(count);
    header.appendChild(left);
    header.appendChild(hide);
    panel.appendChild(header);
    panel.appendChild(list);
    panel.appendChild(bombSection);

    const root = document.body || document.documentElement;
    fn.installOverlayInteractionGuards?.(panel);
    fn.installOverlayInteractionGuards?.(toggle);
    root.appendChild(panel);
    root.appendChild(toggle);

    state.alliancePanelState = {
      panel,
      count,
      list,
      bombSection,
      bombCount,
      bombList,
      bombRenderKey: null,
      toggle,
      hidden: readHiddenSetting(),
      pointerInteractionActive: false,
      interactionLockUntil: 0,
      releaseTimer: null,
    };

    panel.addEventListener("pointerdown", lockAlliancePanelInteraction);
    panel.addEventListener("mousedown", lockAlliancePanelInteraction);
    panel.addEventListener("touchstart", lockAlliancePanelInteraction, { passive: true });
    toggle.addEventListener("pointerdown", lockAlliancePanelInteraction);
    toggle.addEventListener("mousedown", lockAlliancePanelInteraction);
    toggle.addEventListener("touchstart", lockAlliancePanelInteraction, { passive: true });
    window.addEventListener("pointerup", releaseAlliancePanelInteraction, true);
    window.addEventListener("pointercancel", releaseAlliancePanelInteraction, true);
    window.addEventListener("mouseup", releaseAlliancePanelInteraction, true);
    window.addEventListener("touchend", releaseAlliancePanelInteraction, true);
    window.addEventListener("touchcancel", releaseAlliancePanelInteraction, true);
    window.addEventListener("resize", updateAlliancePanelTop);

    syncNativeRenewals();
    renderAlliancePanel();
    fn.onNativeGameTick?.(({ tick }) => {
      // OpenFront adds its renewal card later in the same renderer tick.
      // Remove it before Lit renders the queued update.
      queueMicrotask(syncNativeRenewals);
      if (tick % 5 === 0) renderAlliancePanel();
    });
    fn.onNativeGameChange?.(() => {
      recentBetrayals.clear();
      nativeRenewActions.clear();
      ignoredRenewals.clear();
      renderAlliancePanel();
    });
  };
})();
