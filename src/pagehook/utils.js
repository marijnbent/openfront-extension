"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;

  fn.clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  fn.splitTokens = (text) =>
    String(text || "")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

  fn.matchesAllTokens = (haystack, tokens) => {
    if (!tokens.length) return true;
    const normalized = String(haystack || "").toLowerCase();
    return tokens.every((token) => normalized.includes(token));
  };

  fn.hasCommandModifier = (event) =>
    event.ctrlKey || event.metaKey || event.altKey;

  fn.isTextInput = (el) => {
    if (!el) return false;
    if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
    if (el.tagName === "INPUT") {
      return !(el.id === "attack-ratio" && el.type === "range");
    }
    return false;
  };

  fn.getChatModal = () => document.querySelector("chat-modal");
  fn.getEmojiTable = () => document.querySelector("emoji-table");

  fn.getHoveredPlayer = () => {
    const overlay = document.querySelector("player-info-overlay");
    if (!overlay) return null;
    const hovered = overlay.player;
    if (!hovered || typeof hovered.id !== "function") return null;
    return hovered;
  };

  fn.getPlayerDisplayName = (player) => {
    if (!player) return "";
    if (typeof player.displayName === "function") {
      try {
        return String(player.displayName() || "");
      } catch (_) {}
    }
    if (typeof player.name === "function") {
      try {
        return String(player.name() || "");
      } catch (_) {}
    }
    return "";
  };

  fn.pushBottomRightEvent = (event) => {
    const eventsDisplay = document.querySelector("events-display");
    if (!eventsDisplay || !event || !event.description) return;

    const createdAt =
      eventsDisplay.game && typeof eventsDisplay.game.ticks === "function"
        ? eventsDisplay.game.ticks()
        : 0;

    const payload = {
      description: event.description,
      type: event.type != null ? event.type : constants.MESSAGE_TYPE.CHAT,
      highlight: event.highlight !== false,
      createdAt,
      unsafeDescription: Boolean(event.unsafeDescription),
      focusID: event.focusID,
      duration: event.duration,
      priority: event.priority,
    };

    if (typeof eventsDisplay.addEvent === "function") {
      try {
        eventsDisplay.addEvent(payload);
        return;
      } catch (_) {}
    }

    if (Array.isArray(eventsDisplay.events)) {
      try {
        eventsDisplay.events = [...eventsDisplay.events, payload];
        if (typeof eventsDisplay.requestUpdate === "function") {
          eventsDisplay.requestUpdate();
        }
      } catch (_) {}
    }
  };

  fn.pushBottomRightLog = (description, type) => {
    if (!description) return;
    fn.pushBottomRightEvent({
      description,
      type: type != null ? type : constants.MESSAGE_TYPE.CHAT,
      unsafeDescription: false,
    });
  };

  fn.getAnyGameView = () => {
    const eventsDisplay = document.querySelector("events-display");
    if (eventsDisplay && eventsDisplay.game) return eventsDisplay.game;

    const selectors = ["control-panel", "player-panel", "chat-modal", "emoji-table"];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      if (el.game) return el.game;
      if (el.g) return el.g;
    }
    return null;
  };

  fn.initPointerTracking = () => {
    if (state.pointerTrackingInitialized) return;
    state.pointerTrackingInitialized = true;

    window.addEventListener(
      "mousemove",
      (e) => {
        state.lastMouseX = e.clientX;
        state.lastMouseY = e.clientY;
      },
      true,
    );

    window.addEventListener(
      "pointermove",
      (e) => {
        state.lastMouseX = e.clientX;
        state.lastMouseY = e.clientY;
      },
      true,
    );
  };

  fn.maybeNotifyShortcutBlocked = (code) => {
    const now = Date.now();
    const last = state.lastShortcutWarnAt[code] || 0;
    if (now - last < 1800) return;
    state.lastShortcutWarnAt[code] = now;

    if (!fn.getShortcutConflictSummary) return;
    const summary = fn.getShortcutConflictSummary(code);
    if (!summary) return;

    fn.pushBottomRightLog(
      `Shortcut ${summary.label} blocked: ${summary.conflicts.join(", ")}. Configure in Settings > Keybinds > OpenFront Enhanced.`,
      constants.MESSAGE_TYPE.CHAT,
    );
  };
})();
