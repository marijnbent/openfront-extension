"use strict";

(() => {
  const ns = (window.__OFE = window.__OFE || {});

  ns.constants = ns.constants || {};
  ns.fn = ns.fn || {};

  if (!ns.state) {
    ns.state = {
      // Worker-derived runtime game state
      playerTypeById: {},
      myPlayerTroops: 0,
      myClientID: null,
      playerTroopsById: {},
      clientIDToPlayerID: {},
      mapWidth: 0,
      mapHeight: 0,
      myTilesSet: new Set(),

      // Pointer position for hover-driven shortcuts
      lastMouseX: window.innerWidth / 2,
      lastMouseY: window.innerHeight / 2,

      // Search overlays
      chatSearchState: null,
      chatSearchWatch: null,
      emojiSearchState: null,
      emojiSearchWatch: null,

      // Network/socket tracking
      latestGameSocket: null,
      overrideNextBoat: false,
      boatDispatching: false,

      // Territory cycle
      territoryCycleIndex: 0,

      // Info panel
      shortcutPanelState: null,
      shortcutPanelWatch: null,

      // Neighbor status monitor
      neighborWatchInterval: null,
      neighborWatchBusy: false,
      neighborStatusById: {},

      // Throttled notifications
      lastShortcutWarnAt: {},

      // Game phase tracking
      gamePhase: "none",
    };
  }

  ns._phaseListeners = ns._phaseListeners || [];
})();
