"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;
  const UNIT = "Defense Post";
  const INTERVAL_KEY = "ofe.defensePaint.interval";
  const TIMEOUT_MS = 3000;
  let interval = 80;
  let active = false;
  let generation = 0;
  let timer = null;
  let request = null;
  let sessionGame = null;
  let pending = null;
  let lastPlacement = null;
  let pointerRevision = 0;
  let pointerOnMap = false;
  let pointerDown = false;
  let paused = false;
  let ended = false;
  let lastTick = null;
  let lastTickAt = 0;

  function validInterval(value) {
    return Number.isFinite(value) && value >= 20 && value <= 2000;
  }

  try {
    const saved = Number(localStorage.getItem(INTERVAL_KEY));
    if (validInterval(saved)) interval = Math.round(saved);
  } catch (_) {}

  function updateControls() {
    fn.renderBuildControls?.();
    fn.renderShortcutPanel?.();
  }

  function stop(message) {
    const wasActive = active;
    active = false;
    generation += 1;
    clearTimeout(timer);
    timer = null;
    if (request) clearTimeout(request.timeout);
    request = null;
    if (wasActive) updateControls();
    if (message) fn.pushBottomRightLog?.(message);
  }

  function getContext() {
    const context = fn.getNativeContext?.();
    const game = context?.game;
    const menu = document.querySelector("build-menu");
    const player = game?.myPlayer?.();
    if (
      !game || !player?.isAlive?.() || game.inSpawnPhase() ||
      game.config().isReplay() || game.isCatchingUp?.() || paused || ended ||
      !document.hasFocus() || document.visibilityState === "hidden" ||
      !document.getElementById("game-input-overlay")?.isConnected ||
      menu?.game !== game || typeof menu.sendBuildOrUpgrade !== "function" ||
      typeof player.buildables !== "function" || !context.transformHandler
    ) return null;
    return { ...context, menu, player };
  }

  function getCursorTile(context) {
    if (!pointerOnMap || pointerDown || fn.isTextInput(document.activeElement)) return null;
    if (context.uiState?.ghostStructure != null) return null;
    const target = document.elementFromPoint(state.lastMouseX, state.lastMouseY);
    if (target?.id !== "game-input-overlay") return null;
    const position = context.transformHandler.screenToWorldCoordinates(state.lastMouseX, state.lastMouseY);
    if (!context.game.isValidCoord(position.x, position.y)) return null;
    return context.game.ref(position.x, position.y);
  }

  function near(game, a, b) {
    const distance = game.config().structureMinDist();
    return (game.x(a) - game.x(b)) ** 2 + (game.y(a) - game.y(b)) ** 2 < distance ** 2;
  }

  function pendingReady(context) {
    if (!pending) return true;
    const confirmed = context.player.units(UNIT).some(
      (unit) => !pending.knownIds.has(unit.id()) && near(context.game, unit.tile(), pending.tile),
    );
    if (confirmed) {
      pending = null;
      fn.playExtensionSound?.("defensePaint");
      return true;
    }
    if (performance.now() - pending.at >= TIMEOUT_MS) {
      pending = null;
      stop("Defense paint stopped: placement was not confirmed.");
    }
    return false;
  }

  function schedule() {
    if (active && timer === null) timer = setTimeout(attempt, interval);
  }

  function attempt() {
    timer = null;
    if (!active) return;
    schedule();
    try {
      const context = getContext();
      if (!context || context.game !== sessionGame) return stop();
      if (context.uiState?.ghostStructure != null) return stop();
      const tick = context.game.ticks();
      if (tick !== lastTick) {
        lastTick = tick;
        lastTickAt = performance.now();
      }
      if (performance.now() - lastTickAt >= TIMEOUT_MS) return stop();
      if (request || !pendingReady(context)) return;
      const tile = getCursorTile(context);
      if (tile === null || (lastPlacement !== null && near(context.game, tile, lastPlacement))) return;

      const token = { generation, revision: pointerRevision, timeout: null };
      request = token;
      token.timeout = setTimeout(() => {
        if (request === token) stop("Defense paint stopped: build check timed out.");
      }, TIMEOUT_MS);
      Promise.resolve(context.player.buildables(tile, [UNIT])).then((units) => {
        if (!active || request !== token || generation !== token.generation) return;
        const current = getContext();
        if (!current || current.game !== context.game) return stop();
        if (current.uiState?.ghostStructure != null) return stop();
        if (pointerRevision !== token.revision || getCursorTile(current) !== tile) return;
        const unit = units.find((item) => item.type === UNIT);
        if (
          !unit || unit.canUpgrade !== false ||
          !Number.isInteger(unit.canBuild) || !current.game.isValidRef(unit.canBuild) ||
          typeof unit.cost !== "bigint" || current.player.gold() < unit.cost
        ) return;

        const destination = unit.canBuild;
        pending = {
          tile: destination,
          at: performance.now(),
          knownIds: new Set(current.player.units(UNIT).map((post) => post.id())),
        };
        lastPlacement = tile;
        current.menu.sendBuildOrUpgrade({ ...unit, canUpgrade: false }, destination);
      }).catch(() => {
        if (request === token) stop("Defense paint stopped: build check failed.");
      }).finally(() => {
        clearTimeout(token.timeout);
        if (request === token) request = null;
      });
    } catch (_) {
      stop("Defense paint is unavailable in this game.");
    }
  }

  fn.getDefensePaintInterval = () => interval;
  fn.setDefensePaintInterval = (value) => {
    if (!validInterval(value)) return false;
    interval = Math.round(value);
    try { localStorage.setItem(INTERVAL_KEY, String(interval)); } catch (_) {}
    clearTimeout(timer);
    timer = null;
    schedule();
    updateControls();
    return true;
  };
  fn.isDefensePaintActive = () => active;
  fn.stopDefensePaint = () => stop();
  fn.toggleDefensePaint = () => {
    if (active) return stop();
    try {
      const context = getContext();
      if (!context || fn.isTextInput(document.activeElement)) {
        fn.pushBottomRightLog?.("Defense paint is available during an active game.");
        return;
      }
      if (sessionGame !== context.game) {
        pending = null;
        lastPlacement = null;
      }
      sessionGame = context.game;
      if (!pendingReady(context)) return;
      context.uiState.ghostStructure = null;
      active = true;
      generation += 1;
      lastTick = context.game.ticks();
      lastTickAt = performance.now();
      updateControls();
      schedule();
    } catch (_) {
      stop("Defense paint is unavailable in this game.");
    }
  };

  fn.renderDefensePaintButton = (container, compact = false) => {
    let button = container.querySelector("[data-ofe-defense-paint]");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-ofe-defense-paint", "");
      button.style.cssText =
        "order:1;border:1px solid #475569;border-radius:4px;padding:3px 5px;cursor:pointer;white-space:nowrap;" +
        (compact ? "width:100%;font-size:8px;margin-bottom:3px;" :
          "display:inline-flex;align-items:center;justify-content:center;width:28px;min-width:28px;padding:3px;");
      if (!compact) {
        button.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M5 3h4v4h6V3h4v8l-2 2v8H7v-8l-2-2z"/><path d="M10 21v-5h4v5"/></svg>';
      }
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        fn.toggleDefensePaint();
      });
      container.appendChild(button);
    }
    const code = fn.getEffectiveExtensionBindings?.().defensePaint || "";
    const key = code === "Null" ? "" : code.replace(/Key|Digit/g, "");
    const label = `${compact && key ? `${key} · ` : ""}Defense ${active ? "ON" : "OFF"}`;
    if (compact && button.textContent !== label) button.textContent = label;
    button.setAttribute("aria-label", `Defense paint ${active ? "on" : "off"}`);
    button.setAttribute("aria-pressed", String(active));
    button.title = `Defense paint · ${interval} ms${key ? ` · ${key}` : ""} · Escape stops`;
    button.style.background = active ? "#166534" : "rgba(30,58,95,0.65)";
    button.style.borderColor = active ? "#4ade80" : "rgba(96,165,250,0.4)";
    button.style.color = active ? "#dcfce7" : "#bfdbfe";
  };

  fn.initDefensePaint = () => {
    if (state.defensePaintInitialized) return;
    state.defensePaintInitialized = true;
    window.addEventListener("pointermove", (event) => {
      const onMap = event.target?.id === "game-input-overlay" && event.pointerType !== "touch";
      if (onMap !== pointerOnMap) pointerRevision += 1;
      pointerOnMap = onMap;
    }, true);
    window.addEventListener("pointerdown", () => { pointerDown = true; pointerRevision += 1; }, true);
    window.addEventListener("pointerup", () => { pointerDown = false; pointerRevision += 1; }, true);
    window.addEventListener("pointercancel", () => { pointerDown = false; stop(); }, true);
    window.addEventListener("blur", () => { pointerDown = false; pointerOnMap = false; stop(); });
    window.addEventListener("pagehide", () => stop());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") stop();
    });
    document.addEventListener("focusin", (event) => {
      if (fn.isTextInput(event.target)) stop();
    });
    document.addEventListener("pointerleave", () => { pointerOnMap = false; pointerRevision += 1; });
    window.addEventListener("keydown", (event) => {
      if (!active) return;
      const bindings = fn.getEffectiveGameKeybinds?.() || {};
      if (
        event.key === "Escape" || fn.isTextInput(event.target) ||
        Object.entries(bindings).some(([action, binding]) =>
          (action.startsWith("build") || action === "pauseGame") && fn.keybindMatchesEvent(event, binding),
        )
      ) stop();
    }, true);
    fn.onNativeGameChange?.(() => {
      stop();
      sessionGame = null;
      pending = null;
      lastPlacement = null;
      paused = false;
      ended = false;
    });
    fn.onNativeGameTick?.(({ updates }) => {
      if (updates?.[constants.GAME_UPDATE_TYPE.WIN]?.length) ended = true;
      for (const update of updates?.[constants.GAME_UPDATE_TYPE.GAME_PAUSED] || []) paused = update.paused;
      if (ended || paused) stop();
    });
    fn.renderBuildControls?.();
  };
})();
