"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;
  state.seenBoatLandingIndicatorUnitIds =
    state.seenBoatLandingIndicatorUnitIds || new Set();
  state.boatLandingIndicators = state.boatLandingIndicators || [];
  state.boatLandingIndicatorSequence =
    state.boatLandingIndicatorSequence || 0;
  const BOAT_LANDING_INDICATOR_MS = 4000;
  const MINI_TERRITORY_MARKER_MS = 3000;
  const MARKER_PUBLISH_INTERVAL_MS = 250;
  const INBOUND_ATTACK_ALERT_COOLDOWN_TICKS = 100;
  const GROUND_ATTACK_ALERT_MIN_RATIO = 0.15;
  const BUILDING_STACK_MIN_LEVEL = 10;
  const STRUCTURE_UNIT_TYPES = new Set([
    "City",
    "Defense Post",
    "SAM Launcher",
    "Missile Silo",
    "Port",
    "Factory",
  ]);
  let sharedAudioContext = null;
  let audioUnlocked = false;
  let audioUnlockInitialized = false;
  let spawnEntryAlertPlayed = false;
  let lastMarkerPublishAt = -Infinity;

  function writeAttribute(name, value) {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (document.documentElement.getAttribute(name) === serialized) return;
    document.documentElement.setAttribute(name, serialized);
  }

  function writeGamePhaseAttribute(phase) {
    try {
      writeAttribute("data-ofe-game-phase", phase);
      if (phase === "none") {
        document.documentElement.removeAttribute("data-ofe-nations");
        document.documentElement.removeAttribute("data-ofe-building-stacks");
        document.documentElement.removeAttribute("data-ofe-transport-ships");
        document.documentElement.removeAttribute("data-ofe-boat-landings");
        document.documentElement.removeAttribute("data-ofe-mini-territories");
        document.documentElement.removeAttribute("data-ofe-map-transform");
      }
    } catch (_) {}
  }

  function setGamePhase(newPhase) {
    const oldPhase = state.gamePhase;
    if (oldPhase === newPhase) {
      writeGamePhaseAttribute(newPhase);
      return;
    }
    state.gamePhase = newPhase;
    writeGamePhaseAttribute(newPhase);
    for (const cb of ns._phaseListeners) {
      try { cb(oldPhase, newPhase); } catch (_) {}
    }
  }

  setGamePhase(state.gamePhase || "none");

  function syncGamePhase(game) {
    if (!game || typeof game.inSpawnPhase !== "function") return;
    setGamePhase(game.inSpawnPhase() ? "spawn" : "playing");
  }

  fn.onGamePhaseChange = (callback) => {
    if (typeof callback === "function") {
      ns._phaseListeners.push(callback);
    }
  };

  function soundEnabled(key) {
    return fn.extensionSoundEnabled ? fn.extensionSoundEnabled(key) : true;
  }

  function anySoundsEnabled() {
    return fn.anyExtensionSoundsEnabled ? fn.anyExtensionSoundsEnabled() : true;
  }

  function getAudioContext(options = {}) {
    const { createIfNeeded = false } = options;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioUnlocked && !createIfNeeded) return null;
    if (!sharedAudioContext || sharedAudioContext.state === "closed") {
      sharedAudioContext = new Ctx();
    }
    if (sharedAudioContext.state === "suspended" && (audioUnlocked || createIfNeeded)) {
      sharedAudioContext.resume().catch(() => {});
    }
    return sharedAudioContext;
  }

  function unlockAudio() {
    audioUnlocked = true;
    const ctx = getAudioContext({ createIfNeeded: true });
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return ctx;
  }

  function initAudioUnlock() {
    if (audioUnlockInitialized) return;
    audioUnlockInitialized = true;

    const unlock = () => {
      unlockAudio();

      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("touchstart", unlock, true);
    };

    window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
    window.addEventListener("keydown", unlock, true);
    window.addEventListener("touchstart", unlock, { capture: true, passive: true });
  }

  function playTone(options) {
    const ctx = getAudioContext();
    if (!ctx) return;

    const {
      type = "sine",
      start = 0,
      duration = 0.2,
      gain = 0.14,
      attack = 0.01,
      release = duration,
      frequency,
      sweepTo,
    } = options;

    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const at = ctx.currentTime + start;
    const off = at + duration;

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, at);
    if (sweepTo != null) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(1, sweepTo),
        off,
      );
    }

    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, gain),
      at + Math.max(0.005, attack),
    );
    amp.gain.exponentialRampToValueAtTime(
      0.0001,
      at + Math.max(Math.max(attack, 0.01), release),
    );

    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(at);
    osc.stop(off);
  }

  function playGameStartChime(force = false) {
    if (!force && !soundEnabled("gameStart")) return;
    try {
      // Bright three-note start cue.
      playTone({ type: "triangle", frequency: 523.25, duration: 0.12, gain: 0.12, release: 0.11 });
      playTone({ type: "triangle", frequency: 659.25, start: 0.11, duration: 0.14, gain: 0.14, release: 0.13 });
      playTone({ type: "triangle", frequency: 783.99, start: 0.24, duration: 0.22, gain: 0.17, release: 0.2 });
    } catch (_) {}
  }

  function playSpawnEntryChime(force = false) {
    if (!force && !soundEnabled("spawnEntry")) return;
    try {
      // Strong two-pulse ready cue, distinct from the rising match-start chime.
      playTone({ type: "triangle", frequency: 392, duration: 0.2, gain: 0.16, release: 0.18 });
      playTone({ type: "triangle", frequency: 523.25, start: 0.16, duration: 0.22, gain: 0.18, release: 0.2 });
      playTone({ type: "triangle", frequency: 392, start: 0.4, duration: 0.24, gain: 0.18, release: 0.22 });
    } catch (_) {}
  }

  function playBoatLandingChime(force = false) {
    if (!force && !soundEnabled("boatLanding")) return;
    try {
      // Soft harbor bell: one clean ding with a lighter overtone.
      playTone({ type: "triangle", frequency: 698.46, duration: 0.26, gain: 0.1, attack: 0.008, release: 0.24 });
      playTone({ type: "sine", frequency: 1046.5, start: 0.04, duration: 0.18, gain: 0.045, release: 0.17 });
    } catch (_) {}
  }

  function playBoatInboundAlert(force = false) {
    if (!force && !soundEnabled("boatInbound")) return;
    try {
      // Extra-loud naval warning: heavy horn pulses with bright sonar pings.
      playTone({
        type: "sawtooth",
        frequency: 196,
        sweepTo: 233.08,
        duration: 0.24,
        gain: 0.17,
        attack: 0.003,
        release: 0.22,
      });
      playTone({
        type: "triangle",
        frequency: 392,
        sweepTo: 493.88,
        start: 0.03,
        duration: 0.19,
        gain: 0.095,
        attack: 0.003,
        release: 0.17,
      });
      playTone({
        type: "sine",
        frequency: 783.99,
        start: 0.15,
        duration: 0.08,
        gain: 0.07,
        attack: 0.002,
        release: 0.07,
      });
      playTone({
        type: "triangle",
        frequency: 98,
        sweepTo: 87.31,
        start: 0.02,
        duration: 0.26,
        gain: 0.055,
        attack: 0.004,
        release: 0.23,
      });
      playTone({
        type: "sawtooth",
        frequency: 220,
        sweepTo: 261.63,
        start: 0.28,
        duration: 0.24,
        gain: 0.165,
        attack: 0.003,
        release: 0.22,
      });
      playTone({
        type: "triangle",
        frequency: 440,
        sweepTo: 523.25,
        start: 0.31,
        duration: 0.19,
        gain: 0.09,
        attack: 0.003,
        release: 0.17,
      });
      playTone({
        type: "sine",
        frequency: 987.77,
        start: 0.43,
        duration: 0.08,
        gain: 0.075,
        attack: 0.002,
        release: 0.07,
      });
      playTone({
        type: "triangle",
        frequency: 110,
        sweepTo: 98,
        start: 0.3,
        duration: 0.26,
        gain: 0.05,
        attack: 0.004,
        release: 0.23,
      });
    } catch (_) {}
  }

  function playBoatDestroyedChime(force = false) {
    if (!force && !soundEnabled("boatDestroyed")) return;
    try {
      // Short sinking drop.
      playTone({
        type: "sine",
        frequency: 349.23,
        sweepTo: 174.61,
        duration: 0.2,
        gain: 0.09,
        release: 0.18,
      });
      playTone({
        type: "triangle",
        frequency: 233.08,
        sweepTo: 130.81,
        start: 0.05,
        duration: 0.16,
        gain: 0.055,
        release: 0.14,
      });
    } catch (_) {}
  }

  function playGroundAttackInboundAlert(force = false) {
    if (!force && !soundEnabled("groundAttackInbound")) return;
    try {
      // Urgent land-attack klaxon: sharp marching pulses with a heavy low body.
      playTone({
        type: "square",
        frequency: 311.13,
        duration: 0.09,
        gain: 0.14,
        attack: 0.002,
        release: 0.07,
      });
      playTone({
        type: "square",
        frequency: 415.3,
        start: 0.11,
        duration: 0.09,
        gain: 0.14,
        attack: 0.002,
        release: 0.07,
      });
      playTone({
        type: "square",
        frequency: 311.13,
        start: 0.22,
        duration: 0.09,
        gain: 0.14,
        attack: 0.002,
        release: 0.07,
      });
      playTone({
        type: "square",
        frequency: 415.3,
        start: 0.33,
        duration: 0.09,
        gain: 0.14,
        attack: 0.002,
        release: 0.07,
      });
      playTone({
        type: "sawtooth",
        frequency: 123.47,
        sweepTo: 110,
        start: 0.01,
        duration: 0.48,
        gain: 0.06,
        attack: 0.004,
        release: 0.44,
      });
      playTone({
        type: "triangle",
        frequency: 155.56,
        sweepTo: 146.83,
        start: 0.02,
        duration: 0.45,
        gain: 0.04,
        attack: 0.004,
        release: 0.4,
      });
    } catch (_) {}
  }

  function playWarshipDestroyedChime(force = false) {
    if (!force && !soundEnabled("warshipDestroyed")) return;
    try {
      // Heavy double horn.
      playTone({
        type: "square",
        frequency: 164.81,
        sweepTo: 146.83,
        duration: 0.24,
        gain: 0.12,
        attack: 0.015,
        release: 0.22,
      });
      playTone({
        type: "triangle",
        frequency: 82.41,
        sweepTo: 73.42,
        duration: 0.26,
        gain: 0.055,
        attack: 0.02,
        release: 0.24,
      });
      playTone({
        type: "square",
        frequency: 146.83,
        sweepTo: 130.81,
        start: 0.17,
        duration: 0.24,
        gain: 0.1,
        attack: 0.015,
        release: 0.22,
      });
    } catch (_) {}
  }

  function playNeighborSleepingAlert(force = false) {
    if (!force && !soundEnabled("neighborSleeping")) return;
    try {
      // Gentle sleepy droop.
      playTone({
        type: "sine",
        frequency: 349.23,
        sweepTo: 293.66,
        duration: 0.14,
        gain: 0.08,
        release: 0.13,
      });
      playTone({
        type: "triangle",
        frequency: 261.63,
        sweepTo: 196,
        start: 0.12,
        duration: 0.22,
        gain: 0.065,
        release: 0.2,
      });
    } catch (_) {}
  }

  function playNeighborTraitorAlert(force = false) {
    if (!force && !soundEnabled("neighborTraitor")) return;
    try {
      // Sharp hostile flip warning.
      playTone({
        type: "square",
        frequency: 698.46,
        duration: 0.12,
        gain: 0.13,
        release: 0.1,
      });
      playTone({
        type: "square",
        frequency: 587.33,
        start: 0.13,
        duration: 0.12,
        gain: 0.12,
        release: 0.1,
      });
      playTone({
        type: "triangle",
        frequency: 174.61,
        start: 0.02,
        duration: 0.28,
        gain: 0.05,
        release: 0.24,
      });
    } catch (_) {}
  }

  function playNukeInboundAlarm(force = false) {
    if (!force && !soundEnabled("nukeInbound")) return;
    try {
      // Simple two-step siren.
      playTone({
        type: "triangle",
        frequency: 440,
        sweepTo: 587.33,
        duration: 0.18,
        gain: 0.1,
        release: 0.16,
      });
      playTone({
        type: "triangle",
        frequency: 587.33,
        sweepTo: 440,
        start: 0.2,
        duration: 0.18,
        gain: 0.1,
        release: 0.16,
      });
      playTone({
        type: "triangle",
        frequency: 440,
        sweepTo: 587.33,
        start: 0.4,
        duration: 0.18,
        gain: 0.1,
        release: 0.16,
      });
    } catch (_) {}
  }

  function playHydrogenInboundAlarm(force = false) {
    if (!force && !soundEnabled("hydrogenInbound")) return;
    try {
      // Slower, deeper bunker-style siren.
      playTone({
        type: "sawtooth",
        frequency: 146.83,
        sweepTo: 220,
        duration: 0.28,
        gain: 0.11,
        release: 0.26,
      });
      playTone({
        type: "sawtooth",
        frequency: 220,
        sweepTo: 146.83,
        start: 0.3,
        duration: 0.28,
        gain: 0.11,
        release: 0.26,
      });
      playTone({
        type: "triangle",
        frequency: 73.42,
        start: 0.02,
        duration: 0.62,
        gain: 0.045,
        release: 0.54,
      });
      playTone({
        type: "sawtooth",
        frequency: 146.83,
        sweepTo: 220,
        start: 0.6,
        duration: 0.28,
        gain: 0.11,
        release: 0.26,
      });
    } catch (_) {}
  }

  function playMirvInboundAlarm(force = false) {
    if (!force && !soundEnabled("mirvInbound")) return;
    try {
      // Highest-urgency alarm: three brutal pulses with a deep body and harsh edge.
      const pulses = [0, 0.19, 0.38];
      const bodyFrequencies = [
        [123.47, 92.5],
        [116.54, 87.31],
        [110, 82.41],
      ];
      const edgeFrequencies = [
        [659.25, 622.25],
        [698.46, 659.25],
        [739.99, 698.46],
      ];

      pulses.forEach((start, index) => {
        const [bodyHigh, bodyLow] = bodyFrequencies[index];
        const [edgeHigh, edgeLow] = edgeFrequencies[index];

        playTone({
          type: "sawtooth",
          frequency: bodyHigh,
          sweepTo: bodyLow,
          start,
          duration: 0.18,
          gain: 0.105,
          attack: 0.003,
          release: 0.16,
        });
        playTone({
          type: "square",
          frequency: bodyLow * 1.03,
          sweepTo: Math.max(1, bodyLow * 0.94),
          start: start + 0.006,
          duration: 0.17,
          gain: 0.075,
          attack: 0.002,
          release: 0.15,
        });
        playTone({
          type: "triangle",
          frequency: edgeHigh,
          sweepTo: edgeLow,
          start: start + 0.008,
          duration: 0.08,
          gain: 0.068,
          attack: 0.001,
          release: 0.06,
        });
        playTone({
          type: "square",
          frequency: edgeHigh * 1.5,
          sweepTo: edgeLow * 1.35,
          start: start + 0.012,
          duration: 0.05,
          gain: 0.032,
          attack: 0.001,
          release: 0.04,
        });
      });

      playTone({
        type: "sine",
        frequency: 61.74,
        sweepTo: 51.91,
        start: 0.01,
        duration: 0.62,
        gain: 0.03,
        attack: 0.01,
        release: 0.5,
      });
    } catch (_) {}
  }

  function getExtensionSoundPlayer(key) {
    const previews = {
      spawnEntry: playSpawnEntryChime,
      gameStart: playGameStartChime,
      boatLanding: playBoatLandingChime,
      boatInbound: playBoatInboundAlert,
      boatDestroyed: playBoatDestroyedChime,
      groundAttackInbound: playGroundAttackInboundAlert,
      warshipDestroyed: playWarshipDestroyedChime,
      neighborSleeping: playNeighborSleepingAlert,
      neighborTraitor: playNeighborTraitorAlert,
      nukeInbound: playNukeInboundAlarm,
      hydrogenInbound: playHydrogenInboundAlarm,
      mirvInbound: playMirvInboundAlarm,
    };

    return previews[key] || null;
  }

  function pushSoundFeedEvent(description, options = {}) {
    if (!description || !fn.pushBottomRightEvent) return;
    fn.pushBottomRightEvent({
      description,
      type: constants.MESSAGE_TYPE.CHAT,
      unsafeDescription: false,
      highlight: options.highlight !== false,
      duration: options.duration != null ? options.duration : 900,
      focusID: options.focusID,
      unitID: options.unitID,
      x: options.x,
      y: options.y,
    });
  }

  function getIncomingBombSender(game, entry) {
    const message = String(entry?.message || "").trim();
    let name = "Unknown player";
    const separatorIndex = message.indexOf(" - ");
    if (separatorIndex > 0) {
      name = message.slice(0, separatorIndex).replaceAll("⚠️", "").trim() || name;
    }

    let owner = null;
    try {
      owner = game?.unit?.(Number(entry?.unitID))?.owner?.() || null;
    } catch (_) {}

    return {
      name: fn.getPlayerDisplayName?.(owner) || name,
      playerID: fn.resolvePlayerSmallID?.(owner),
    };
  }

  function publishIncomingBombs(game, updates) {
    const myPID = Number(game?.myPlayer?.()?.smallID?.());
    if (!Number.isFinite(myPID) || myPID <= 0) return;
    const incoming = Array.isArray(updates?.[constants.GAME_UPDATE_TYPE.UNIT_INCOMING])
      ? updates[constants.GAME_UPDATE_TYPE.UNIT_INCOMING]
      : [];
    const bombs = [];
    for (const entry of incoming) {
      const kind =
        entry?.messageType === constants.MESSAGE_TYPE.NUKE_INBOUND
          ? "atom"
          : entry?.messageType === constants.MESSAGE_TYPE.HYDROGEN_BOMB_INBOUND
            ? "hydrogen"
            : entry?.messageType === constants.MESSAGE_TYPE.MIRV_INBOUND
              ? "mirv"
              : null;
      if (
        !entry ||
        Number(entry.playerID) !== myPID ||
        !kind
      ) {
        continue;
      }
      const sender = getIncomingBombSender(game, entry);
      bombs.push({
        kind,
        unitID: Number(entry.unitID),
        senderID: sender.playerID,
        senderName: sender.name,
        createdAt: Date.now(),
      });
    }
    if (bombs.length) fn.noteIncomingBombs?.(bombs);
  }

  function getMyFocusID() {
    const game = fn.getAnyGameView?.();
    const mySmallID = Number(game?.myPlayer?.()?.smallID?.());
    return Number.isFinite(mySmallID) ? mySmallID : null;
  }

  function announceSpawnPhaseStart() {
    if (spawnEntryAlertPlayed) return;
    spawnEntryAlertPlayed = true;
    pushSoundFeedEvent("Spawn phase started", {
      duration: 700,
      focusID: getMyFocusID(),
    });
    playSpawnEntryChime();
  }

  function getWorldPositionFromTile(tileRef) {
    const numericTile = Number(tileRef);
    if (!Number.isFinite(numericTile)) return null;

    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (!game || typeof game.x !== "function" || typeof game.y !== "function") {
      return null;
    }

    try {
      const x = Number(game.x(numericTile));
      const y = Number(game.y(numericTile));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    } catch (_) {
      return null;
    }
  }

  function publishBoatLandingIndicators(game, updates) {
    if (!game || !updates) return;
    const myPID = Number(game.myPlayer?.()?.smallID?.());
    if (!Number.isFinite(myPID) || myPID <= 0) return;

    const unitUpdates = Array.isArray(
      updates[constants.GAME_UPDATE_TYPE.UNIT],
    )
      ? updates[constants.GAME_UPDATE_TYPE.UNIT]
      : [];
    const landedTransports = unitUpdates.filter(
      (entry) =>
        entry &&
        entry.unitType === "Transport" &&
        Number(entry.ownerID) === myPID &&
        entry.isActive === false &&
        entry.targetTile != null &&
        Number(entry.pos) === Number(entry.targetTile),
    );
    if (!landedTransports.length) return;

    const now = Date.now();
    state.boatLandingIndicators = state.boatLandingIndicators.filter(
      (indicator) => indicator.expiresAt > now,
    );

    for (const entry of landedTransports) {
      const unitID = Number(entry.id);
      if (
        Number.isFinite(unitID) &&
        state.seenBoatLandingIndicatorUnitIds.has(unitID)
      ) {
        continue;
      }

      const position = getWorldPositionFromTile(
        entry.pos != null ? entry.pos : entry.lastPos,
      );
      if (!position) continue;

      if (Number.isFinite(unitID)) {
        state.seenBoatLandingIndicatorUnitIds.add(unitID);
      }
      state.boatLandingIndicatorSequence += 1;
      state.boatLandingIndicators.push({
        id: state.boatLandingIndicatorSequence,
        unitID: Number.isFinite(unitID) ? unitID : null,
        x: position.x,
        y: position.y,
        expiresAt: now + BOAT_LANDING_INDICATOR_MS,
      });
    }

    writeAttribute("data-ofe-boat-landings", state.boatLandingIndicators);
  }

  fn.playExtensionSound = (key, force = false) => {
    const preview = getExtensionSoundPlayer(key);
    if (!preview) return false;

    try {
      preview(Boolean(force));
      return true;
    } catch (_) {
      return false;
    }
  };

  fn.previewExtensionSound = (key) => {
    unlockAudio();
    return fn.playExtensionSound(key, true);
  };

  function pruneAlertCooldownMap(map, tick) {
    if (!(map instanceof Map)) return;
    const cutoff = tick - INBOUND_ATTACK_ALERT_COOLDOWN_TICKS;
    for (const [key, lastTick] of map.entries()) {
      if (!Number.isFinite(lastTick) || lastTick < cutoff) {
        map.delete(key);
      }
    }
  }

  function inboundAlertAllowed(map, key, tick) {
    if (!(map instanceof Map) || key == null) return true;
    const lastTick = map.get(key);
    return !Number.isFinite(lastTick) || tick - lastTick >= INBOUND_ATTACK_ALERT_COOLDOWN_TICKS;
  }

  function markInboundAlertTick(map, keys, tick) {
    if (!(map instanceof Map)) return;
    for (const key of keys) {
      if (key == null) continue;
      map.set(key, tick);
    }
  }

  function isHostilePlayerSmallId(playerSmallId, myPID) {
    const numericPlayerSmallId = Number(playerSmallId);
    if (!Number.isFinite(numericPlayerSmallId) || numericPlayerSmallId <= 0) {
      return false;
    }

    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (
      !game ||
      typeof game.myPlayer !== "function" ||
      typeof game.playerBySmallID !== "function"
    ) {
      return numericPlayerSmallId !== Number(myPID);
    }

    try {
      const me = game.myPlayer();
      const other = game.playerBySmallID(numericPlayerSmallId);
      if (
        !me ||
        !other ||
        typeof other.smallID !== "function" ||
        other.smallID() === Number(myPID)
      ) {
        return false;
      }
      if (typeof me.isFriendly === "function" && me.isFriendly(other)) {
        return false;
      }
      return true;
    } catch (_) {}

    return numericPlayerSmallId !== Number(myPID);
  }

  function currentOrUpdateTick(game, fallbackTick) {
    let tick = Number(fallbackTick);
    if (!Number.isFinite(tick)) tick = 0;

    if (game && typeof game.ticks === "function") {
      try {
        const currentTick = Number(game.ticks());
        if (Number.isFinite(currentTick) && currentTick > tick) {
          tick = currentTick;
        }
      } catch (_) {}
    }

    return tick;
  }

  function playerTypeBySmallId(playerSmallId, game = null) {
    const numericPlayerSmallId = Number(playerSmallId);
    if (!Number.isFinite(numericPlayerSmallId) || numericPlayerSmallId <= 0) {
      return null;
    }

    const view = game || (fn.getAnyGameView ? fn.getAnyGameView() : null);
    if (view && typeof view.playerBySmallID === "function") {
      try {
        const player = view.playerBySmallID(numericPlayerSmallId);
        if (player && typeof player.type === "function") {
          return player.type();
        }
      } catch (_) {}
    }

    return null;
  }

  function isBotPlayerSmallId(playerSmallId, game = null) {
    return playerTypeBySmallId(playerSmallId, game) === "BOT";
  }

  function isActiveInboundTransport(unit) {
    if (!unit || typeof unit.isActive !== "function" || !unit.isActive()) {
      return false;
    }
    if (typeof unit.type !== "function" || unit.type() !== "Transport") {
      return false;
    }
    if (typeof unit.retreating === "function") {
      try {
        if (unit.retreating()) return false;
      } catch (_) {}
    }
    return true;
  }

  function scheduleBoatInboundAlert(unitIds, myPID, tick) {
    if (!Array.isArray(unitIds) || !unitIds.length) return;

    window.setTimeout(() => {
      if (state.lastBoatInboundSoundTick === tick) return;

      const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
      if (
        !game ||
        typeof game.myPlayer !== "function" ||
        typeof game.unit !== "function"
      ) {
        return;
      }

      const me = game.myPlayer();
      if (!me || (typeof me.isAlive === "function" && !me.isAlive())) {
        return;
      }
      const alertTick = currentOrUpdateTick(game, tick);
      if (state.lastBoatInboundSoundTick === alertTick) return;

      pruneAlertCooldownMap(state.boatInboundAlertTickByAttacker, alertTick);

      const eligibleBoatInboundAlertKeys = new Set();
      let alertUnitID = null;
      for (const unitId of unitIds) {
        const numericId = Number(unitId);
        if (!Number.isFinite(numericId)) continue;

        let owner = null;
        let unit = null;
        try {
          unit = game.unit(numericId);
          owner = unit && typeof unit.owner === "function" ? unit.owner() : null;
        } catch (_) {
          owner = null;
        }
        if (!isActiveInboundTransport(unit)) continue;
        if (!owner || typeof owner.smallID !== "function") continue;

        const attackerSmallId = Number(owner.smallID());
        if (!Number.isFinite(attackerSmallId) || attackerSmallId <= 0) continue;
        if (!isHostilePlayerSmallId(attackerSmallId, myPID)) continue;

        const attackerKey = `player:${attackerSmallId}`;
        if (
          inboundAlertAllowed(
            state.boatInboundAlertTickByAttacker,
            attackerKey,
            alertTick,
          )
        ) {
          eligibleBoatInboundAlertKeys.add(attackerKey);
          if (alertUnitID == null) {
            alertUnitID = numericId;
          }
        }
      }

      if (!eligibleBoatInboundAlertKeys.size) return;

      state.lastBoatInboundSoundTick = alertTick;
      markInboundAlertTick(
        state.boatInboundAlertTickByAttacker,
        eligibleBoatInboundAlertKeys,
        alertTick,
      );
      pushSoundFeedEvent("Enemy boat inbound", {
        unitID: alertUnitID,
      });
      playBoatInboundAlert();
    }, 0);
  }

  function scheduleGroundAttackInboundAlert(attacks, myPID, tick) {
    if (!Array.isArray(attacks) || !attacks.length) return;

    window.setTimeout(() => {
      const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
      if (!game || typeof game.myPlayer !== "function") {
        return;
      }

      const me = game.myPlayer();
      if (!me || (typeof me.isAlive === "function" && !me.isAlive())) {
        return;
      }

      const alertTick = currentOrUpdateTick(game, tick);
      if (state.lastGroundAttackInboundSoundTick === alertTick) return;

      let currentIncomingAttacks = [];
      if (typeof me.incomingAttacks === "function") {
        try {
          currentIncomingAttacks = me.incomingAttacks();
        } catch (_) {
          currentIncomingAttacks = [];
        }
      }
      if (!Array.isArray(currentIncomingAttacks) || !currentIncomingAttacks.length) {
        return;
      }

      const pendingAttackIds = new Set();
      for (const attack of attacks) {
        if (attack && attack.id != null) {
          pendingAttackIds.add(String(attack.id));
        }
      }
      if (!pendingAttackIds.size) return;

      const myTroopsNow = Number(me.troops?.());
      const minAlertTroops = Number.isFinite(myTroopsNow) && myTroopsNow > 0
        ? myTroopsNow * GROUND_ATTACK_ALERT_MIN_RATIO
        : NaN;
      if (!Number.isFinite(minAlertTroops)) return;

      pruneAlertCooldownMap(state.groundAttackInboundAlertTickByAttacker, alertTick);

      const eligibleGroundInboundAlertKeys = new Set();
      let groundAttackFocusID = null;
      for (const attack of currentIncomingAttacks) {
        if (!attack || attack.retreating || attack.id == null) continue;
        if (!pendingAttackIds.has(String(attack.id))) continue;

        const attackTroops = Number(attack.troops);
        const attackerSmallId = Number(attack.attackerID);
        if (
          !Number.isFinite(attackerSmallId) ||
          attackerSmallId <= 0 ||
          isBotPlayerSmallId(attackerSmallId, game)
        ) {
          continue;
        }

        const attackerKey = `player:${attackerSmallId}`;
        if (
          Number.isFinite(attackTroops) &&
          attackTroops >= minAlertTroops &&
          isHostilePlayerSmallId(attackerSmallId, myPID) &&
          inboundAlertAllowed(
            state.groundAttackInboundAlertTickByAttacker,
            attackerKey,
            alertTick,
          )
        ) {
          eligibleGroundInboundAlertKeys.add(attackerKey);
          if (groundAttackFocusID == null) {
            groundAttackFocusID = attackerSmallId;
          }
        }
      }

      if (!eligibleGroundInboundAlertKeys.size) return;

      state.lastGroundAttackInboundSoundTick = alertTick;
      markInboundAlertTick(
        state.groundAttackInboundAlertTickByAttacker,
        eligibleGroundInboundAlertKeys,
        alertTick,
      );
      pushSoundFeedEvent("Ground attack inbound", {
        focusID: groundAttackFocusID,
      });
      playGroundAttackInboundAlert();
    }, 0);
  }

  function maybePlayGameSounds(game, gu) {
    if (!gu || gu.tick == null) {
      return;
    }
    if (!anySoundsEnabled()) return;

    const myPID = Number(game?.myPlayer?.()?.smallID?.());
    if (!Number.isFinite(myPID) || myPID <= 0) return;

    const updates = gu.updates;
    if (!updates) return;

    let ownTransportDeactivations = 0;
    let boatInboundEvents = 0;
    let ownTransportDestroyedEvents = 0;
    let groundAttackInboundEvents = 0;
    let ownWarshipDestroyedEvents = 0;
    let mirvInboundEvents = 0;
    let nukeInboundEvents = 0;
    let hydrogenInboundEvents = 0;
    const boatInboundUnitIds = [];
    const landedTransportUnitIds = [];
    const landedTransportPositions = [];
    const ownWarshipInactiveUnitIds = [];
    const ownWarshipInactivePositions = [];
    const groundAttackInboundCandidates = [];

    pruneAlertCooldownMap(state.boatInboundAlertTickByAttacker, gu.tick);
    pruneAlertCooldownMap(state.groundAttackInboundAlertTickByAttacker, gu.tick);

    const unitUpdates = Array.isArray(updates[constants.GAME_UPDATE_TYPE.UNIT])
      ? updates[constants.GAME_UPDATE_TYPE.UNIT]
      : [];
    for (const entry of unitUpdates) {
      if (
        entry &&
        entry.unitType === "Transport" &&
        Number(entry.ownerID) === myPID &&
        entry.isActive === false
      ) {
        ownTransportDeactivations += 1;
        if (entry.id != null) {
          landedTransportUnitIds.push(Number(entry.id));
        }
        landedTransportPositions.push(
          getWorldPositionFromTile(entry.pos != null ? entry.pos : entry.lastPos),
        );
      } else if (
        entry &&
        entry.unitType === "Warship" &&
        Number(entry.ownerID) === myPID &&
        entry.isActive === false &&
        entry.id != null
      ) {
        ownWarshipInactiveUnitIds.push(Number(entry.id));
        ownWarshipInactivePositions.push(
          getWorldPositionFromTile(entry.pos != null ? entry.pos : entry.lastPos),
        );
      }
    }

    const playerUpdates = Array.isArray(updates[constants.GAME_UPDATE_TYPE.PLAYER])
      ? updates[constants.GAME_UPDATE_TYPE.PLAYER]
      : [];
    let nextIncomingGroundAttackIds = null;
    for (const entry of playerUpdates) {
      if (!entry || !Array.isArray(entry.incomingAttacks)) continue;
      const playerId = Number(
        entry.smallID != null ? entry.smallID : entry.id,
      );
      if (playerId !== myPID) continue;

      const activeIds = nextIncomingGroundAttackIds || new Set();
      for (const attack of entry.incomingAttacks) {
        if (!attack || attack.retreating || attack.id == null) continue;
        const attackId = String(attack.id);
        if (activeIds.has(attackId)) continue;
        activeIds.add(attackId);
        if (
          state.groundAttackTrackingReady &&
          !state.seenIncomingGroundAttackIds.has(attackId)
        ) {
          groundAttackInboundEvents += 1;
          groundAttackInboundCandidates.push({ id: attackId });
        }
      }
      nextIncomingGroundAttackIds = activeIds;
    }
    if (nextIncomingGroundAttackIds) {
      state.seenIncomingGroundAttackIds = nextIncomingGroundAttackIds;
      state.groundAttackTrackingReady = true;
    }

    const displayUpdates = Array.isArray(updates[constants.GAME_UPDATE_TYPE.DISPLAY_EVENT])
      ? updates[constants.GAME_UPDATE_TYPE.DISPLAY_EVENT]
      : [];
    for (const entry of displayUpdates) {
      if (
        !entry ||
        entry.messageType !== constants.MESSAGE_TYPE.UNIT_DESTROYED ||
        Number(entry.playerID) !== myPID ||
        !entry.params
      ) {
        continue;
      }

      if (entry.params.unit === "Transport") {
        ownTransportDestroyedEvents += 1;
      } else if (entry.params.unit === "Warship") {
        ownWarshipDestroyedEvents += 1;
      }
    }

    const incomingUpdates = Array.isArray(updates[constants.GAME_UPDATE_TYPE.UNIT_INCOMING])
      ? updates[constants.GAME_UPDATE_TYPE.UNIT_INCOMING]
      : [];
    for (const entry of incomingUpdates) {
      if (!entry || Number(entry.playerID) !== myPID) continue;

      if (entry.messageType === constants.MESSAGE_TYPE.NAVAL_INVASION_INBOUND) {
        const unitId = Number(entry.unitID);
        if (
          Number.isFinite(unitId) &&
          !state.seenIncomingBoatUnitIds.has(unitId)
        ) {
          state.seenIncomingBoatUnitIds.add(unitId);
          boatInboundEvents += 1;
          boatInboundUnitIds.push(unitId);
        }
      } else if (entry.messageType === constants.MESSAGE_TYPE.MIRV_INBOUND) {
        mirvInboundEvents += 1;
      } else if (entry.messageType === constants.MESSAGE_TYPE.NUKE_INBOUND) {
        nukeInboundEvents += 1;
      } else if (entry.messageType === constants.MESSAGE_TYPE.HYDROGEN_BOMB_INBOUND) {
        hydrogenInboundEvents += 1;
      }
    }

    if (
      !ownTransportDeactivations &&
      !boatInboundEvents &&
      !ownTransportDestroyedEvents &&
      !groundAttackInboundEvents &&
      !ownWarshipDestroyedEvents &&
      !mirvInboundEvents &&
      !nukeInboundEvents &&
      !hydrogenInboundEvents
    ) {
      return;
    }

    if (
      boatInboundEvents > 0 &&
      gu.tick !== state.lastBoatInboundSoundTick
    ) {
      scheduleBoatInboundAlert(boatInboundUnitIds, myPID, gu.tick);
    }

    if (
      ownTransportDestroyedEvents > 0 &&
      gu.tick !== state.lastBoatDestroyedSoundTick
    ) {
      state.lastBoatDestroyedSoundTick = gu.tick;
      const destroyedTransportPosition = landedTransportPositions[0];
      pushSoundFeedEvent("Transport ship destroyed", {
        unitID: landedTransportUnitIds[0],
        focusID: getMyFocusID(),
        x: destroyedTransportPosition && destroyedTransportPosition.x,
        y: destroyedTransportPosition && destroyedTransportPosition.y,
      });
      playBoatDestroyedChime();
    }

    if (
      ownTransportDeactivations > ownTransportDestroyedEvents &&
      gu.tick !== state.lastBoatLandingSoundTick
    ) {
      state.lastBoatLandingSoundTick = gu.tick;
      const landedTransportPosition = landedTransportPositions[0];
      pushSoundFeedEvent("Transport ship landed", {
        unitID: landedTransportUnitIds[0],
        focusID: getMyFocusID(),
        x: landedTransportPosition && landedTransportPosition.x,
        y: landedTransportPosition && landedTransportPosition.y,
      });
      playBoatLandingChime();
    }

    if (
      groundAttackInboundEvents > 0 &&
      gu.tick !== state.lastGroundAttackInboundSoundTick
    ) {
      scheduleGroundAttackInboundAlert(groundAttackInboundCandidates, myPID, gu.tick);
    }

    if (
      ownWarshipDestroyedEvents > 0 &&
      gu.tick !== state.lastWarshipDestroyedSoundTick
    ) {
      state.lastWarshipDestroyedSoundTick = gu.tick;
      const destroyedWarshipPosition = ownWarshipInactivePositions[0];
      pushSoundFeedEvent("Warship destroyed", {
        unitID: ownWarshipInactiveUnitIds[0],
        focusID: getMyFocusID(),
        x: destroyedWarshipPosition && destroyedWarshipPosition.x,
        y: destroyedWarshipPosition && destroyedWarshipPosition.y,
      });
      playWarshipDestroyedChime();
    }

    if (mirvInboundEvents > 0 && gu.tick !== state.lastMirvInboundSoundTick) {
      state.lastMirvInboundSoundTick = gu.tick;
      playMirvInboundAlarm();
    }

    if (nukeInboundEvents > 0 && gu.tick !== state.lastNukeInboundSoundTick) {
      state.lastNukeInboundSoundTick = gu.tick;
      playNukeInboundAlarm();
    }

    if (
      hydrogenInboundEvents > 0 &&
      gu.tick !== state.lastHydrogenInboundSoundTick
    ) {
      state.lastHydrogenInboundSoundTick = gu.tick;
      playHydrogenInboundAlarm();
    }
  }

  function navigateToPosition(x, y) {
    const transformHandler = fn.getNativeContext?.()?.transformHandler;
    if (typeof transformHandler?.onGoToPosition !== "function") return false;
    transformHandler.onGoToPosition({ x, y });
    return true;
  }

  fn.navigateToPosition = navigateToPosition;

  function publishMarkerTransform() {
    const transformHandler = fn.getNativeContext?.()?.transformHandler;
    if (
      !transformHandler ||
      typeof transformHandler.worldToScreenCoordinates !== "function"
    ) {
      return;
    }

    try {
      const origin = transformHandler.worldToScreenCoordinates({ x: 0, y: 0 });
      const scale = Number(transformHandler.scale);
      if (
        !origin ||
        !Number.isFinite(Number(origin.x)) ||
        !Number.isFinite(Number(origin.y)) ||
        !Number.isFinite(scale) ||
        scale <= 0
      ) {
        return;
      }

      writeAttribute("data-ofe-map-transform", {
        x: Number(origin.x) - window.innerWidth / 2,
        y: Number(origin.y) - window.innerHeight / 2,
        scale,
      });
    } catch (_) {}
  }

  function publishNationMarkers(game) {
    const nations = {};

    if (game && typeof game.playerViews === "function") {
      try {
        for (const player of game.playerViews()) {
          if (!player || typeof player.type !== "function" || player.type() !== "NATION") {
            continue;
          }
          if (typeof player.isAlive === "function" && !player.isAlive()) {
            continue;
          }
          if (typeof player.nameLocation !== "function") {
            continue;
          }

          const location = player.nameLocation();
          if (
            !location ||
            !Number.isFinite(Number(location.x)) ||
            !Number.isFinite(Number(location.y))
          ) {
            continue;
          }

          const markerId =
            typeof player.smallID === "function" ? player.smallID() :
            typeof player.id === "function" ? player.id() :
            null;
          if (markerId == null) continue;

          nations[markerId] = { x: Number(location.x), y: Number(location.y) };
        }

        writeAttribute("data-ofe-nations", nations);
      } catch (_) {}
    }
  }

  function publishBuildingStackMarkers(game, units) {
    if (
      !game ||
      typeof game.x !== "function" ||
      typeof game.y !== "function"
    ) {
      return;
    }

    const stacks = {};
    for (const unit of units) {
      try {
        const type = typeof unit.type === "function" ? unit.type() : null;
        if (!STRUCTURE_UNIT_TYPES.has(type)) continue;
        if (typeof unit.isUnderConstruction === "function" && unit.isUnderConstruction()) {
          continue;
        }

        const level = typeof unit.level === "function" ? Number(unit.level()) : NaN;
        if (!Number.isFinite(level) || level <= BUILDING_STACK_MIN_LEVEL) continue;

        const tile = typeof unit.tile === "function" ? unit.tile() : null;
        const x = Number(game.x(tile));
        const y = Number(game.y(tile));
        const id = typeof unit.id === "function" ? Number(unit.id()) : null;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(id)) {
          continue;
        }

        stacks[id] = { x, y, level, type };
      } catch (_) {}
    }

    writeAttribute("data-ofe-building-stacks", stacks);
  }

  function publishTransportShipMarkers(game, units) {
    if (
      !game ||
      typeof game.myPlayer !== "function" ||
      typeof game.x !== "function" ||
      typeof game.y !== "function"
    ) {
      return;
    }

    let me = null;
    try {
      me = game.myPlayer();
    } catch (_) {
      return;
    }
    if (!me) return;

    const ships = {};
    for (const unit of units) {
      try {
        if (typeof unit.type !== "function" || unit.type() !== "Transport") {
          continue;
        }
        if (typeof unit.isActive !== "function" || !unit.isActive()) continue;
        if (typeof unit.owner !== "function" || unit.owner() !== me) continue;

        const tile = typeof unit.tile === "function" ? unit.tile() : null;
        const id = typeof unit.id === "function" ? Number(unit.id()) : NaN;
        const x = Number(game.x(tile));
        const y = Number(game.y(tile));
        if (!Number.isFinite(id) || !Number.isFinite(x) || !Number.isFinite(y)) {
          continue;
        }
        ships[id] = { x, y };
      } catch (_) {}
    }

    writeAttribute("data-ofe-transport-ships", ships);
  }

  function publishGameMarkers(game) {
    const now = performance.now();
    if (now - lastMarkerPublishAt < MARKER_PUBLISH_INTERVAL_MS) return;
    lastMarkerPublishAt = now;

    let units = [];
    try {
      units = typeof game.units === "function" ? game.units() : [];
    } catch (_) {}

    publishNationMarkers(game);
    publishBuildingStackMarkers(game, units);
    publishTransportShipMarkers(game, units);
    publishMarkerTransform();
  }

  function resetPerGameState() {
    lastMarkerPublishAt = -Infinity;
    state.seenIncomingBoatUnitIds.clear();
    state.seenBoatLandingIndicatorUnitIds.clear();
    state.boatLandingIndicators = [];
    state.boatLandingIndicatorSequence = 0;
    state.boatInboundAlertTickByAttacker.clear();
    state.groundAttackTrackingReady = false;
    state.seenIncomingGroundAttackIds.clear();
    state.groundAttackInboundAlertTickByAttacker.clear();
    state.neighborStatusById = {};
    state.lastBoatLandingSoundTick = -1;
    state.lastBoatInboundSoundTick = -1;
    state.lastBoatDestroyedSoundTick = -1;
    state.lastGroundAttackInboundSoundTick = -1;
    state.lastWarshipDestroyedSoundTick = -1;
    state.lastMirvInboundSoundTick = -1;
    state.lastNukeInboundSoundTick = -1;
    state.lastHydrogenInboundSoundTick = -1;
    state.incomingBombs = [];
    state.allianceExtensionPendingById?.clear?.();
    setGamePhase("none");
  }

  function processNativeGameTick({ game, tick, updates }) {
    syncGamePhase(game);
    if (!updates) return;

    const allianceExtensions = Array.isArray(
      updates[constants.GAME_UPDATE_TYPE.ALLIANCE_EXTENSION],
    )
      ? updates[constants.GAME_UPDATE_TYPE.ALLIANCE_EXTENSION]
      : [];
    for (const update of allianceExtensions) {
      if (update?.allianceID == null) continue;
      fn.noteAllianceExtensionUpdate?.(
        Number(update.allianceID),
        update.playerID,
      );
    }

    publishBoatLandingIndicators(game, updates);
    publishIncomingBombs(game, updates);
    maybePlayGameSounds(game, { tick, updates });
    publishGameMarkers(game);
  }

  fn.triggerShowMiniTerritories = () => {
    const game = fn.getAnyGameView?.();
    const minis = fn.findMiniTerritories?.(game, 40);
    if (!minis) {
      fn.pushBottomRightLog("No game data available.", undefined, {
        focusID: getMyFocusID(),
      });
      return;
    }

    if (!minis.length) {
      document.documentElement.removeAttribute("data-ofe-mini-territories");
      fn.pushBottomRightLog("No mini territories.", undefined, {
        focusID: getMyFocusID(),
      });
      return;
    }

    const expiresAt = Date.now() + MINI_TERRITORY_MARKER_MS;
    writeAttribute(
      "data-ofe-mini-territories",
      minis.map((mini, index) => ({
        id: index + 1,
        ...mini,
        expiresAt,
      })),
    );
  };

  fn.initGameHooks = () => {
    if (state.gameHooksInitialized) return;
    state.gameHooksInitialized = true;
    fn.onNativeGameChange?.(() => resetPerGameState());
    fn.onNativeGameTick?.(processNativeGameTick);
  };

  document.addEventListener("game-starting", () => {
    // OpenFront emits this before map and worker initialization, so a hidden
    // tab gets its alert before tick processing can fall behind.
    spawnEntryAlertPlayed = false;
    announceSpawnPhaseStart();
  });

  fn.onGamePhaseChange((oldPhase, newPhase) => {
    if (oldPhase !== "spawn" && newPhase === "spawn") {
      // Keep tick detection as a fallback for game versions that do not emit
      // the early lifecycle event.
      announceSpawnPhaseStart();
    }
    if (oldPhase === "spawn" && newPhase === "playing") {
      pushSoundFeedEvent("Match started", {
        duration: 700,
        focusID: getMyFocusID(),
      });
      playGameStartChime();
      spawnEntryAlertPlayed = false;
    }
  });

  initAudioUnlock();
})();
