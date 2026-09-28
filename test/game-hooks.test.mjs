import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../src/pagehook/game-hooks.js", import.meta.url),
  "utf8",
);

function createHarness() {
  const attributes = new Map();
  const alerts = [];
  const bombs = [];
  const tickListeners = [];
  const gameChangeListeners = [];
  const documentListeners = new Map();
  const phaseListeners = [];
  const state = {
    allianceExtensionPendingById: new Map(),
    boatInboundAlertTickByAttacker: new Map(),
    groundAttackInboundAlertTickByAttacker: new Map(),
    neighborStatusById: {},
    seenIncomingBoatUnitIds: new Set(),
    seenIncomingGroundAttackIds: new Set(),
    gamePhase: "playing",
  };
  const constants = {
    GAME_UPDATE_TYPE: {
      UNIT: 1,
      PLAYER: 2,
      DISPLAY_EVENT: 3,
      UNIT_INCOMING: 4,
      ALLIANCE_EXTENSION: 5,
      BROKE_ALLIANCE: 7,
    },
    MESSAGE_TYPE: {
      CHAT: 1,
      UNIT_DESTROYED: 2,
      NAVAL_INVASION_INBOUND: 3,
      MIRV_INBOUND: 4,
      NUKE_INBOUND: 5,
      HYDROGEN_BOMB_INBOUND: 6,
    },
  };
  const myPlayer = {
    isAlive: () => true,
    smallID: () => 7,
  };
  const game = {
    inSpawnPhase: () => false,
    myPlayer: () => myPlayer,
    unit: () => ({
      owner: () => ({
        displayName: () => "EmberFox",
        smallID: () => 23,
      }),
    }),
    units: () => [],
  };
  const fn = {
    anyExtensionSoundsEnabled: () => false,
    extensionSoundEnabled: () => false,
    getAnyGameView: () => game,
    getPlayerDisplayName: (player) => player?.displayName?.() || "",
    noteIncomingBombs: (incoming) => bombs.push(...incoming),
    onNativeGameChange: (listener) => gameChangeListeners.push(listener),
    onNativeGameTick: (listener) => tickListeners.push(listener),
    pushBottomRightEvent: (event) => alerts.push(event),
    resolvePlayerSmallID: (player) => player?.smallID?.() ?? null,
  };
  const namespace = { constants, fn, state, _phaseListeners: phaseListeners };
  const sandbox = {
    clearTimeout,
    console,
    document: {
      addEventListener: (type, listener) => documentListeners.set(type, listener),
      documentElement: {
        getAttribute: (name) => attributes.get(name) ?? null,
        removeAttribute: (name) => attributes.delete(name),
        setAttribute: (name, value) => attributes.set(name, value),
      },
    },
    performance: { now: () => 0 },
    setTimeout,
    window: {
      __OFE: namespace,
      addEventListener() {},
      removeEventListener() {},
      setTimeout,
    },
  };

  vm.runInNewContext(source, sandbox);
  fn.initGameHooks();

  return { alerts, bombs, constants, game, tickListeners, fn, sandbox };
}

test("blocked action sound supports preview, mute, and a short repeat limit", () => {
  const { fn, sandbox } = createHarness();
  const tones = [];
  const parameter = {
    setValueAtTime() {},
    exponentialRampToValueAtTime() {},
  };
  sandbox.window.AudioContext = class {
    state = "running";
    currentTime = 0;
    createOscillator() {
      const oscillator = {
        frequency: parameter,
        connect() {},
        start() { tones.push(oscillator); },
        stop() {},
      };
      return oscillator;
    }
    createGain() { return { gain: parameter, connect() {} }; }
  };

  assert.equal(fn.previewExtensionSound("actionBlocked"), true);
  assert.equal(tones.length, 2);
  sandbox.performance.now = () => 250;
  fn.playExtensionSound("actionBlocked");
  assert.equal(tones.length, 2);
  fn.extensionSoundEnabled = () => true;
  fn.playExtensionSound("actionBlocked");
  assert.equal(tones.length, 4);
  fn.playExtensionSound("actionBlocked");
  assert.equal(tones.length, 4);
  sandbox.performance.now = () => 500;
  fn.playExtensionSound("actionBlocked");
  assert.equal(tones.length, 6);
});

test("all incoming bomb types move to panel data when sounds are disabled", () => {
  const harness = createHarness();
  const updates = {
    [harness.constants.GAME_UPDATE_TYPE.UNIT_INCOMING]: [
      {
        message: "EmberFox - atom bomb inbound",
        messageType: harness.constants.MESSAGE_TYPE.NUKE_INBOUND,
        playerID: 7,
        unitID: 91,
      },
      {
        message: "EmberFox - hydrogen bomb inbound",
        messageType: harness.constants.MESSAGE_TYPE.HYDROGEN_BOMB_INBOUND,
        playerID: 7,
        unitID: 92,
      },
      {
        message: "⚠️⚠️⚠️ EmberFox - MIRV INBOUND ⚠️⚠️⚠️",
        messageType: harness.constants.MESSAGE_TYPE.MIRV_INBOUND,
        playerID: 7,
        unitID: 93,
      },
    ],
  };

  harness.tickListeners[0]({ game: harness.game, tick: 20, updates });

  assert.equal(harness.alerts.length, 0);
  assert.equal(harness.bombs.length, 3);
  assert.equal(harness.bombs[0].kind, "atom");
  assert.equal(harness.bombs[1].kind, "hydrogen");
  assert.equal(harness.bombs[2].kind, "mirv");
  assert.equal(harness.bombs[2].senderName, "EmberFox");
  assert.equal(harness.bombs[2].senderID, 23);
  assert.equal(harness.bombs[2].unitID, 93);
});


test("native alliance breaks reach the panel for distant players with sounds disabled", () => {
  const { fn, game, tickListeners, constants } = createHarness();
  const notices = [];
  const traitor = { smallID: () => 23, displayName: () => "Distant ally" };
  const me = { smallID: () => 7, displayName: () => "Me" };
  const other = { smallID: () => 9, displayName: () => "Other" };
  game.playerBySmallID = (id) => ({ 23: traitor, 7: me, 9: other })[id];
  fn.notePlayerBetrayal = (player, details) => { notices.push({ player, details }); return true; };
  const updates = { [constants.GAME_UPDATE_TYPE.BROKE_ALLIANCE]: [
    { traitorID: 23, betrayedID: 7 },
    { traitorID: 23, betrayedID: 9 },
    { traitorID: 7, betrayedID: 9 },
  ] };
  tickListeners[0]({ game, tick: 20, updates });
  assert.equal(notices.length, 2);
  assert.equal(notices[0].player, traitor);
  assert.equal(notices[0].details.betrayedYou, true);
  assert.equal(notices[1].details.betrayedName, "Other");
  other.isDisconnected = () => true;
  tickListeners[0]({ game, tick: 30, updates: {
    [constants.GAME_UPDATE_TYPE.BROKE_ALLIANCE]: [{ traitorID: 23, betrayedID: 9 }],
  } });
  assert.equal(notices.length, 2);
});
