"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { state, fn } = ns;
  const BOAT_OVERRIDE_WINDOW_MS = 1500;

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

  function playGameStartChime() {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(587, ctx.currentTime);        // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12); // A5
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch (_) {}
  }

  function playSpawnEntryChime() {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, ctx.currentTime);         // A4
      osc.frequency.setValueAtTime(523.25, ctx.currentTime + 0.1); // C5
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.24);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.24);
    } catch (_) {}
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

    if (components.length <= 1) {
      fn.pushBottomRightLog("Territory is connected.");
      return;
    }

    state.territoryCycleIndex = (state.territoryCycleIndex + 1) % components.length;
    const target = components[state.territoryCycleIndex];
    navigateToPosition(target.centroidX, target.centroidY, true);
    fn.pushBottomRightLog(
      `Territory ${state.territoryCycleIndex + 1}/${components.length}`,
    );
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
})();
