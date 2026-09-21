"use strict";

(() => {
  const ns = (window.__OFE = window.__OFE || {});

  ns.constants = ns.constants || {};
  ns.fn = ns.fn || {};

  if (!ns.state) {
    ns.state = {
      // Native OpenFront runtime
      nativeGame: null,
      lastNativeTick: null,
      nativeTickListeners: new Set(),
      nativeGameChangeListeners: new Set(),

      // Pointer position for hover-driven shortcuts
      lastMouseX: window.innerWidth / 2,
      lastMouseY: window.innerHeight / 2,

      // Search overlays
      chatSearchState: null,
      chatSearchWatch: null,
      emojiSearchState: null,
      emojiSearchWatch: null,

      boatDispatching: false,
      seenIncomingBoatUnitIds: new Set(),
      boatInboundAlertTickByAttacker: new Map(),
      groundAttackTrackingReady: false,
      seenIncomingGroundAttackIds: new Set(),
      groundAttackInboundAlertTickByAttacker: new Map(),
      lastBoatLandingSoundTick: -1,
      seenBoatLandingIndicatorUnitIds: new Set(),
      boatLandingIndicators: [],
      boatLandingIndicatorSequence: 0,
      lastBoatInboundSoundTick: -1,
      lastBoatDestroyedSoundTick: -1,
      lastGroundAttackInboundSoundTick: -1,
      lastWarshipDestroyedSoundTick: -1,
      lastMirvInboundSoundTick: -1,
      lastNukeInboundSoundTick: -1,
      lastHydrogenInboundSoundTick: -1,

      // Info panel
      shortcutPanelState: null,
      alliancePanelState: null,
      allianceExtensionPendingById: new Map(),
      incomingBombs: [],
      eventsPanelState: null,
      eventsPanelInitialized: false,
      lastOfeAlertTarget: null,
      lastOfeAlertSequence: 0,
      lastOfeAlertJumpSequence: 0,
      lastOfeAlertReturnTarget: null,
      extensionSettingsTabActive: false,
      extensionSettingsCache: null,

      // Neighbor status monitor
      neighborWatchInitialized: false,
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
