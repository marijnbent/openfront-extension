"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, constants, fn } = ns;
  const BOAT_OVERRIDE_WINDOW_MS = 1500;
  let sharedAudioContext = null;
  let audioUnlocked = false;
  let audioUnlockInitialized = false;

  function setGamePhase(newPhase) {
    const oldPhase = state.gamePhase;
    if (oldPhase === newPhase) return;
    state.gamePhase = newPhase;
    for (const cb of ns._phaseListeners) {
      try { cb(oldPhase, newPhase); } catch (_) {}
    }
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
      // Small ready cue before the match starts.
      playTone({ type: "sine", frequency: 392, duration: 0.1, gain: 0.08, release: 0.09 });
      playTone({ type: "triangle", frequency: 493.88, start: 0.09, duration: 0.16, gain: 0.11, release: 0.14 });
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
      boatDestroyed: playBoatDestroyedChime,
      warshipDestroyed: playWarshipDestroyedChime,
      neighborSleeping: playNeighborSleepingAlert,
      neighborTraitor: playNeighborTraitorAlert,
      nukeInbound: playNukeInboundAlarm,
      hydrogenInbound: playHydrogenInboundAlarm,
      mirvInbound: playMirvInboundAlarm,
    };

    return previews[key] || null;
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

  function maybePlayGameSounds(gu) {
    if (!gu || gu.tick == null) {
      return;
    }
    if (!state.myClientID) return;
    if (!anySoundsEnabled()) return;

    const myPID = Number(state.clientIDToPlayerID[state.myClientID]);
    if (!Number.isFinite(myPID) || myPID <= 0) return;

    const updates = gu.updates;
    if (!updates) return;

    let ownTransportDeactivations = 0;
    let ownTransportDestroyedEvents = 0;
    let ownWarshipDestroyedEvents = 0;
    let mirvInboundEvents = 0;
    let nukeInboundEvents = 0;
    let hydrogenInboundEvents = 0;

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
      }
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

      if (entry.messageType === constants.MESSAGE_TYPE.MIRV_INBOUND) {
        mirvInboundEvents += 1;
      } else if (entry.messageType === constants.MESSAGE_TYPE.NUKE_INBOUND) {
        nukeInboundEvents += 1;
      } else if (entry.messageType === constants.MESSAGE_TYPE.HYDROGEN_BOMB_INBOUND) {
        hydrogenInboundEvents += 1;
      }
    }

    if (
      !ownTransportDeactivations &&
      !ownTransportDestroyedEvents &&
      !ownWarshipDestroyedEvents &&
      !mirvInboundEvents &&
      !nukeInboundEvents &&
      !hydrogenInboundEvents
    ) {
      return;
    }

    if (
      ownTransportDestroyedEvents > 0 &&
      gu.tick !== state.lastBoatDestroyedSoundTick
    ) {
      state.lastBoatDestroyedSoundTick = gu.tick;
      playBoatDestroyedChime();
    }

    if (
      ownTransportDeactivations > ownTransportDestroyedEvents &&
      gu.tick !== state.lastBoatLandingSoundTick
    ) {
      state.lastBoatLandingSoundTick = gu.tick;
      playBoatLandingChime();
    }

    if (
      ownWarshipDestroyedEvents > 0 &&
      gu.tick !== state.lastWarshipDestroyedSoundTick
    ) {
      state.lastWarshipDestroyedSoundTick = gu.tick;
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

  function collectOwnedTilesFromLiveGame() {
    const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
    if (!game) return null;
    if (
      typeof game.width !== "function" ||
      typeof game.height !== "function" ||
      typeof game.ownerID !== "function" ||
      typeof game.myPlayer !== "function"
    ) {
      return null;
    }

    const me = game.myPlayer();
    if (!me || typeof me.smallID !== "function") return null;
    const mySmallID = Number(me.smallID());
    if (!Number.isFinite(mySmallID) || mySmallID <= 0) return null;

    const width = Number(game.width());
    const height = Number(game.height());
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }

    const myTilesSet = new Set();
    const hasRefFn = typeof game.ref === "function";
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const ref = hasRefFn ? game.ref(x, y) : row + x;
        if (Number(game.ownerID(ref)) === mySmallID) {
          myTilesSet.add(ref);
        }
      }
    }

    return { width, height, myTilesSet };
  }

  function computeConnectedComponents(width, height, tilesSet) {
    if (!tilesSet.size) return [];
    const visited = new Set();
    const components = [];

    for (const ref of tilesSet) {
      if (visited.has(ref)) continue;
      const component = [];
      const queue = [ref];
      visited.add(ref);

      while (queue.length) {
        const cur = queue.pop();
        component.push(cur);
        const cx = cur % width;
        const neighbors = [];
        if (cx > 0) neighbors.push(cur - 1);
        if (cx < width - 1) neighbors.push(cur + 1);
        if (cur >= width) neighbors.push(cur - width);
        if (cur + width < width * height) neighbors.push(cur + width);
        for (const n of neighbors) {
          if (tilesSet.has(n) && !visited.has(n)) {
            visited.add(n);
            queue.push(n);
          }
        }
      }

      let sx = 0, sy = 0;
      for (const r of component) {
        sx += r % width;
        sy += Math.floor(r / width);
      }
      components.push({
        size: component.length,
        centroidX: Math.round(sx / component.length),
        centroidY: Math.round(sy / component.length),
      });
    }

    components.sort((a, b) => b.size - a.size);
    return components;
  }

  function navigateToPosition(x, y, instant = false) {
    const buildMenu = document.querySelector("build-menu");
    if (!buildMenu || !buildMenu.transformHandler) return;
    const th = buildMenu.transformHandler;
    if (!instant && typeof th.onGoToPosition === "function") {
      // TransformHandler onGoToPosition expects world/tile coordinates.
      th.onGoToPosition({ x, y });
      return;
    }

    if (typeof th.override === "function" && typeof th.boundingRect === "function") {
      // Fallback for older handler shapes: convert world center into offset space.
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
  }

  async function fetchMapDimensions(gameMap, mapSize) {
    try {
      const fileName = gameMap.replace(/\s/g, "").toLowerCase();
      const resp = await fetch(`/maps/${fileName}/manifest.json`);
      if (!resp.ok) return;
      const manifest = await resp.json();
      const meta = mapSize === "Compact" ? manifest.map4x : manifest.map;
      state.mapWidth = meta.width;
      state.mapHeight = meta.height;
    } catch (_) {}
  }

  function updateFromGameUpdate(gu) {
    if (!gu || typeof gu !== "object" || !gu.updates) {
      return;
    }

    if (gu.tick != null && gu.tick <= 3) {
      for (const k in state.playerTypeById) delete state.playerTypeById[k];
      for (const k in state.playerTroopsById) delete state.playerTroopsById[k];
      for (const k in state.clientIDToPlayerID) delete state.clientIDToPlayerID[k];
      state.myTilesSet.clear();
      state.neighborStatusById = {};
      setGamePhase("spawn");
    }

    if (state.gamePhase === "spawn") {
      const game = fn.getAnyGameView ? fn.getAnyGameView() : null;
      if (game && typeof game.inSpawnPhase === "function" && !game.inSpawnPhase()) {
        setGamePhase("playing");
      }
    }

    const updates = gu.updates;
    if (updates) {
      for (const key in updates) {
        const arr = updates[key];
        if (!Array.isArray(arr)) continue;
        for (const entry of arr) {
          if (entry.id == null) continue;
          if (entry.playerType) state.playerTypeById[entry.id] = entry.playerType;
          if (entry.troops != null) state.playerTroopsById[entry.id] = entry.troops;
          if (entry.clientID != null) {
            const smallID =
              entry.smallID != null && Number.isFinite(Number(entry.smallID))
                ? Number(entry.smallID)
                : Number(entry.id);
            if (Number.isFinite(smallID)) {
              state.clientIDToPlayerID[entry.clientID] = smallID;
            }
          }
        }
      }
    }

    maybePlayGameSounds(gu);

    if (state.myClientID && state.clientIDToPlayerID[state.myClientID]) {
      const myPID = state.clientIDToPlayerID[state.myClientID];
      if (state.playerTroopsById[myPID] != null) {
        state.myPlayerTroops = state.playerTroopsById[myPID];
      }
    }

    const nameData = gu.playerNameViewData;
    if (nameData) {
      const nations = {};
      for (const pid in nameData) {
        if (state.playerTypeById[pid] !== "NATION") continue;
        const d = nameData[pid];
        nations[pid] = { x: d.x, y: d.y };
      }
      document.documentElement.setAttribute("data-ofe-nations", JSON.stringify(nations));
    }

    try {
      const packed = gu.packedTileUpdates;
      if (packed && packed.length > 0 && state.myClientID) {
        const myPID = Number(state.clientIDToPlayerID[state.myClientID]);
        if (myPID) {
          for (let i = 0; i < packed.length; i++) {
            const tu = packed[i];
            const tileRef = Number(tu >> 16n);
            const playerId = Number(tu & 0xfffn);
            if (playerId === myPID) {
              state.myTilesSet.add(tileRef);
            } else {
              state.myTilesSet.delete(tileRef);
            }
          }
        }
      }
    } catch (_) {}
  }

  fn.triggerTerritoryCycle = () => {
    const live = collectOwnedTilesFromLiveGame();
    if (!live) {
      fn.pushBottomRightLog("No game data available.");
      return;
    }

    const { width, height, myTilesSet } = live;
    const components = computeConnectedComponents(width, height, myTilesSet);
    const smallComponents = components.filter((component) => component.size <= 100);

    if (components.length <= 1) {
      fn.pushBottomRightLog("Territory is connected.");
      return;
    }

    if (!smallComponents.length) {
      fn.pushBottomRightLog("No mini territories.");
      return;
    }

    state.territoryCycleIndex =
      (state.territoryCycleIndex + 1) % smallComponents.length;
    const target = smallComponents[state.territoryCycleIndex];
    navigateToPosition(target.centroidX, target.centroidY, true);
    console.log(
      `[OFE] Switched to territory ${state.territoryCycleIndex + 1}/${smallComponents.length} (${target.size} tiles)`,
    );
    fn.pushBottomRightLog("Mini Territories");
  };

  function getLiveMyPlayerTroops() {
    const sources = [
      "control-panel",
      "player-panel",
      "events-display",
      "chat-modal",
      "emoji-table",
    ];

    for (const selector of sources) {
      const el = document.querySelector(selector);
      if (!el) continue;
      const game = el.game || el.g;
      if (!game || typeof game.myPlayer !== "function") continue;
      const me = game.myPlayer();
      if (!me || typeof me.troops !== "function") continue;
      const troops = Number(me.troops());
      if (Number.isFinite(troops) && troops > 0) return troops;
    }

    if (Number.isFinite(state.myPlayerTroops) && state.myPlayerTroops > 0) {
      return state.myPlayerTroops;
    }

    return 0;
  }

  function getBoatOnePercentTroops() {
    const troops = getLiveMyPlayerTroops();
    return Math.max(1, Math.floor(troops * 0.01));
  }

  function readCurrentAttackRatio() {
    const controlPanel = document.querySelector("control-panel");
    if (controlPanel && Number.isFinite(controlPanel.attackRatio)) {
      return Math.min(1, Math.max(0.01, Number(controlPanel.attackRatio)));
    }

    try {
      const raw = Number(localStorage.getItem("settings.attackRatio") || "0.2");
      if (Number.isFinite(raw)) return Math.min(1, Math.max(0.01, raw));
    } catch (_) {}

    return null;
  }

  function applyAttackRatio(ratio) {
    const clamped = Math.min(1, Math.max(0.01, Number(ratio)));
    let updated = false;

    const controlPanel = document.querySelector("control-panel");
    if (controlPanel) {
      if (Number.isFinite(controlPanel.attackRatio)) {
        try {
          controlPanel.attackRatio = clamped;
          updated = true;
        } catch (_) {}
      }

      if (typeof controlPanel.onAttackRatioChange === "function") {
        try {
          controlPanel.onAttackRatioChange(clamped);
          updated = true;
        } catch (_) {}
      }

      if (typeof controlPanel.requestUpdate === "function") {
        try {
          controlPanel.requestUpdate();
        } catch (_) {}
      }
    }

    const slider =
      document.querySelector("control-panel input[type='range']") ||
      document.getElementById("attack-ratio");
    if (slider && slider.tagName === "INPUT") {
      try {
        slider.value = String(Math.round(clamped * 100));
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        updated = true;
      } catch (_) {}
    }

    if (updated) {
      try {
        localStorage.setItem("settings.attackRatio", String(clamped));
      } catch (_) {}
    }

    return updated;
  }

  fn.initWorkerHooks = () => {
    if (state.workerHooksInitialized) return;
    state.workerHooksInitialized = true;

    const origAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, ...rest) {
      if (
        type === "message" &&
        this instanceof Worker &&
        typeof listener === "function"
      ) {
        const originalListener = listener;
        const wrapped = function (event) {
          try {
            const msg = event.data;
            if (msg && msg.type === "game_update" && msg.gameUpdate) {
              updateFromGameUpdate(msg.gameUpdate);
            } else if (
              msg &&
              msg.type === "game_update_batch" &&
              Array.isArray(msg.gameUpdates)
            ) {
              for (const gameUpdate of msg.gameUpdates) {
                updateFromGameUpdate(gameUpdate);
              }
            }
          } catch (_) {}
          return originalListener.apply(this, arguments);
        };

        listener._ofeWrapped = wrapped;
        return origAdd.call(this, type, wrapped, ...rest);
      }

      return origAdd.call(this, type, listener, ...rest);
    };

    const origRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.removeEventListener = function (type, listener, ...rest) {
      if (listener && listener._ofeWrapped) {
        return origRemove.call(this, type, listener._ofeWrapped, ...rest);
      }
      return origRemove.call(this, type, listener, ...rest);
    };

    const origPostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (msg, ...rest) {
      try {
        if (msg && msg.type === "init") {
          setGamePhase("none");
          if (msg.clientID) {
            state.myClientID = msg.clientID;
          }
          const config = msg.gameStartInfo && msg.gameStartInfo.config;
          if (config && config.gameMap) {
            fetchMapDimensions(config.gameMap, config.gameMapSize || "Normal");
          }
        }
      } catch (_) {}

      return origPostMessage.call(this, msg, ...rest);
    };
  };

  fn.triggerBoatOnePercentAttack = () => {
    if (state.boatDispatching) return;
    if (fn.ensureEventBusHooks) fn.ensureEventBusHooks();

    state.overrideNextBoat = true;
    const attackKey = fn.getBoatAttackKey ? fn.getBoatAttackKey() : "KeyB";
    const previousRatio = readCurrentAttackRatio();
    const ratioTemporarilySet =
      previousRatio != null &&
      Math.abs(previousRatio - 0.01) > 0.0001 &&
      applyAttackRatio(0.01);

    state.boatDispatching = true;
    window.dispatchEvent(new KeyboardEvent("keyup", { code: attackKey, bubbles: true }));
    state.boatDispatching = false;

    if (ratioTemporarilySet && previousRatio != null) {
      setTimeout(() => {
        applyAttackRatio(previousRatio);
      }, 220);
    }

    setTimeout(() => {
      state.overrideNextBoat = false;
    }, BOAT_OVERRIDE_WINDOW_MS);
  };

  function isBoatAttackIntentEvent(event) {
    if (!event || typeof event !== "object") return false;
    if (typeof event.troops !== "number") return false;

    if (event.constructor && event.constructor.name === "SendBoatAttackIntentEvent") {
      return true;
    }

    return Object.prototype.hasOwnProperty.call(event, "dst");
  }

  function wrapEventBusEmit(eventBus) {
    if (!eventBus || typeof eventBus.emit !== "function") return;
    if (eventBus.__ofeEmitWrapped) return;

    const originalEmit = eventBus.emit.bind(eventBus);
    eventBus.emit = function (event) {
      if (state.overrideNextBoat && isBoatAttackIntentEvent(event)) {
        try {
          event.troops = getBoatOnePercentTroops();
          state.overrideNextBoat = false;
        } catch (_) {}
      }
      return originalEmit(event);
    };

    eventBus.__ofeEmitWrapped = true;
  }

  function findEventBus() {
    const selectors = [
      "events-display",
      "player-panel",
      "chat-modal",
      "emoji-table",
    ];
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (!el) continue;
      if (el.eventBus && typeof el.eventBus.emit === "function") {
        return el.eventBus;
      }
    }
    return null;
  }

  fn.ensureEventBusHooks = () => {
    const bus = findEventBus();
    if (!bus) return false;
    wrapEventBusEmit(bus);
    return true;
  };

  fn.initSocketHooks = () => {
    if (state.socketHooksInitialized) return;
    state.socketHooksInitialized = true;

    const eventBusScan = setInterval(() => {
      if (fn.ensureEventBusHooks && fn.ensureEventBusHooks()) {
        clearInterval(eventBusScan);
      }
    }, 1000);

    const origWsSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string") {
        try {
          const msg = JSON.parse(data);
          if (
            msg &&
            (msg.type === "intent" ||
              msg.type === "join" ||
              msg.type === "rejoin" ||
              msg.type === "ping")
          ) {
            state.latestGameSocket = this;
          }
        } catch (_) {}
      }

      if (state.overrideNextBoat && typeof data === "string") {
        try {
          const msg = JSON.parse(data);
          if (msg.type === "intent" && msg.intent && msg.intent.type === "boat") {
            msg.intent.troops = getBoatOnePercentTroops();
            state.overrideNextBoat = false;
            return origWsSend.call(this, JSON.stringify(msg));
          }
        } catch (_) {}
      }

      return origWsSend.call(this, data);
    };
  };

  fn.onGamePhaseChange((oldPhase, newPhase) => {
    if (oldPhase !== "spawn" && newPhase === "spawn") {
      playSpawnEntryChime();
    }
    if (oldPhase === "spawn" && newPhase === "playing") {
      playGameStartChime();
    }
  });

  initAudioUnlock();
})();
