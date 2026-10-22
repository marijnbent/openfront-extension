import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sources = await Promise.all(
  ["constants", "keybinds", "defense-paint", "shortcuts"].map((name) =>
    readFile(new URL(`../src/pagehook/${name}.js`, import.meta.url), "utf8"),
  ),
);

function harness(savedInterval) {
  const listeners = new Map();
  const timers = new Map();
  const storage = new Map(savedInterval === undefined ? [] : [["ofe.defensePaint.interval", savedInterval]]);
  const calls = [];
  const intents = [];
  const logs = [];
  const sounds = [];
  let now = 0;
  let tick = 1;
  let nextId = 0;
  let result = null;
  let gameChange;
  let gameTick;
  const map = { id: "game-input-overlay", isConnected: true };
  let hit = map;
  const posts = [];
  const player = {
    isAlive: () => true,
    gold: () => 1000n,
    units: () => posts,
    buildables: (tile, types) => {
      calls.push({ tile, types });
      return result ?? Promise.resolve([{ type: "Defense Post", canUpgrade: false, canBuild: tile, cost: 100n }]);
    },
  };
  const game = {
    myPlayer: () => player,
    ticks: () => tick,
    inSpawnPhase: () => false,
    isCatchingUp: () => false,
    config: () => ({ isReplay: () => false, structureMinDist: () => 15 }),
    isValidCoord: (x, y) => x >= 0 && x < 1000 && y >= 0 && y < 1000,
    ref: (x, y) => y * 1000 + x,
    x: (tile) => tile % 1000,
    y: (tile) => Math.floor(tile / 1000),
    isValidRef: (tile) => Number.isInteger(tile) && tile >= 0 && tile < 1000000,
  };
  let currentGame = game;
  const menu = {
    game,
    sendBuildOrUpgrade: (unit, tile) => intents.push({ unit, tile, at: now }),
  };
  const uiState = { ghostStructure: null, upgradeMultiplier: 10 };
  const document = {
    visibilityState: "visible",
    activeElement: null,
    hasFocus: () => true,
    querySelector: () => menu,
    getElementById: () => map,
    elementFromPoint: () => hit,
    addEventListener: (type, fn) => on(type, fn),
  };
  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  }
  function fire(type, options = {}) {
    const event = {
      type, target: map, pointerType: "mouse", ...options,
      stopImmediatePropagation() { this.stopped = true; },
      preventDefault() {},
    };
    for (const fn of listeners.get(type) || []) {
      fn(event);
      if (event.stopped) break;
    }
  }
  const ns = { constants: {}, state: { lastMouseX: 100, lastMouseY: 100 }, fn: {
    getNativeContext: () => ({ game: currentGame, uiState, transformHandler: { screenToWorldCoordinates: (x, y) => ({ x, y }) } }),
    onNativeGameChange: (fn) => { gameChange = fn; },
    onNativeGameTick: (fn) => { gameTick = fn; },
    isTextInput: (el) => el?.tagName === "INPUT",
    hasCommandModifier: (event) => event.ctrlKey || event.metaKey || event.altKey,
    pushBottomRightLog: (text) => logs.push(text),
    playExtensionSound: (key) => sounds.push(key),
    maybeNotifyShortcutBlocked() {},
  } };
  const context = vm.createContext({
    window: { __OFE: ns, addEventListener: on }, document,
    navigator: { userAgent: "Mac" },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    performance: { now: () => now },
    setTimeout: (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  for (const source of sources) vm.runInContext(source, context);
  ns.fn.initDefensePaint();
  ns.fn.initShortcutHandlers();
  fire("pointermove");
  return {
    ns, game, player, menu, map, document, calls, intents, logs, sounds, posts, storage, uiState, fire,
    setResult: (value) => { result = value; },
    leave: () => { currentGame = null; },
    newGame: () => gameChange({ game }),
    update: (updates) => gameTick({ updates }),
    key: (code, options = {}) => { fire("keydown", { code, ...options }); fire("keyup", { code, ...options }); },
    move: (x, y = 100, target = map) => {
      ns.state.lastMouseX = x;
      ns.state.lastMouseY = y;
      hit = target;
      fire("pointermove", { target });
    },
    confirm: () => {
      const tile = intents.at(-1).tile;
      const id = posts.length + 1;
      posts.push({ id: () => id, tile: () => tile });
    },
    advance: async (duration, ticking = true) => {
      const end = now + duration;
      while (true) {
        const next = [...timers.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [id, task] = next;
        now = task.at;
        if (ticking) tick += 1;
        timers.delete(id);
        task.fn();
        await settle();
      }
      now = end;
    },
  };
}

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

test("V paints once, waits for confirmation, skips stationary positions and ignores the multiplier", async () => {
  const h = harness();
  h.key("KeyV");
  await h.advance(79);
  assert.equal(h.intents.length, 0);
  await h.advance(1);
  assert.equal(h.intents.length, 1);
  assert.equal(h.intents[0].unit.canUpgrade, false);
  assert.equal(h.uiState.upgradeMultiplier, 10);
  h.move(150);
  await h.advance(500);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.sounds, []);
  h.confirm();
  await h.advance(250);
  assert.equal(h.intents.length, 2);
  assert.deepEqual(h.sounds, ["defensePaint"]);
  h.confirm();
  await h.advance(750);
  assert.equal(h.intents.length, 2);
  assert.deepEqual(h.sounds, ["defensePaint", "defensePaint"]);
  h.key("KeyV");
  h.move(200);
  await h.advance(500);
  assert.equal(h.intents.length, 2);
});

test("invalid terrain, upgrade targets, missing fields and insufficient gold never dispatch", async () => {
  for (const patch of [
    { canBuild: false }, { canUpgrade: 5 }, { canUpgrade: undefined },
    { canBuild: undefined }, { canBuild: -1 }, { cost: 2000n },
  ]) {
    const h = harness();
    h.setResult([{ type: "Defense Post", canBuild: 100100, canUpgrade: false, cost: 100n, ...patch }]);
    h.key("KeyV");
    await h.advance(250);
    assert.equal(h.intents.length, 0);
    assert.equal(h.ns.fn.isDefensePaintActive(), true);
  }
});

test("only one validation is in flight and moved cursors discard stale results", async () => {
  const h = harness();
  let resolve;
  h.setResult(new Promise((done) => { resolve = done; }));
  h.key("KeyV");
  await h.advance(750);
  assert.equal(h.calls.length, 1);
  h.move(200);
  resolve([{ type: "Defense Post", canBuild: 100100, canUpgrade: false, cost: 100n }]);
  await settle();
  assert.equal(h.intents.length, 0);
});

test("off then on cannot revive an older validation", async () => {
  const h = harness();
  let resolve;
  h.setResult(new Promise((done) => { resolve = done; }));
  h.key("KeyV");
  await h.advance(250);
  h.key("KeyV");
  h.key("KeyV");
  resolve([{ type: "Defense Post", canBuild: 100100, canUpgrade: false, cost: 100n }]);
  await settle();
  assert.equal(h.intents.length, 0);
});

test("UI, map bounds and dragging suspend placement", async () => {
  const h = harness();
  h.key("KeyV");
  h.move(100, 100, { id: "menu" });
  await h.advance(250);
  h.move(-1);
  await h.advance(250);
  h.move(100);
  h.fire("pointerdown");
  await h.advance(250);
  h.fire("pointerup");
  assert.equal(h.calls.length, 0);
  await h.advance(250);
  assert.equal(h.intents.length, 1);
});

test("Escape, focus, visibility, game transitions, pause and defeat cancel pending validation", async () => {
  const cancellations = [
    (h) => h.key("Escape", { key: "Escape" }),
    (h) => h.fire("blur"),
    (h) => h.fire("focusin", { target: { tagName: "INPUT" } }),
    (h) => { h.document.visibilityState = "hidden"; h.fire("visibilitychange"); },
    (h) => h.newGame(),
    (h) => h.update({ 22: [{ paused: true }] }),
    (h) => h.update({ 12: [{}] }),
    (h) => h.key("Digit4"),
    (h) => { h.uiState.ghostStructure = "City"; },
    (h) => h.leave(),
    (h) => { h.player.isAlive = () => false; },
  ];
  for (const cancel of cancellations) {
    const h = harness();
    let resolve;
    h.setResult(new Promise((done) => { resolve = done; }));
    h.key("KeyV");
    await h.advance(250);
    cancel(h);
    resolve([{ type: "Defense Post", canBuild: 100100, canUpgrade: false, cost: 100n }]);
    await settle();
    assert.equal(h.intents.length, 0);
    assert.equal(h.ns.fn.isDefensePaintActive(), false);
  }
});

test("stalled validation and unconfirmed placements stop instead of retrying sends", async () => {
  const h = harness();
  h.setResult(new Promise(() => {}));
  h.key("KeyV");
  await h.advance(3500);
  assert.equal(h.calls.length, 1);
  assert.equal(h.ns.fn.isDefensePaintActive(), false);
  assert.match(h.logs.at(-1), /timed out/);
  h.setResult(null);
  h.key("KeyV");
  await h.advance(3500);
  assert.equal(h.intents.length, 1);
  assert.equal(h.ns.fn.isDefensePaintActive(), false);
  assert.match(h.logs.at(-1), /not confirmed/);
  h.move(200);
  h.key("KeyV");
  await h.advance(250);
  assert.equal(h.intents.length, 2);
});

test("interval persists, rejects bad values and changes the next attempt delay", async () => {
  const h = harness("500");
  assert.equal(h.ns.fn.getDefensePaintInterval(), 500);
  for (const invalid of [0, 19, 2001, NaN, Infinity, "250"]) {
    assert.equal(h.ns.fn.setDefensePaintInterval(invalid), false);
  }
  h.key("KeyV");
  await h.advance(250);
  assert.equal(h.calls.length, 0);
  h.ns.fn.setDefensePaintInterval(20);
  await h.advance(19);
  assert.equal(h.calls.length, 0);
  await h.advance(1);
  assert.equal(h.calls.length, 1);
  assert.equal(h.storage.get("ofe.defensePaint.interval"), "20");
  assert.equal(harness("20").ns.fn.getDefensePaintInterval(), 20);
  assert.equal(harness("garbage").ns.fn.getDefensePaintInterval(), 80);
  assert.equal(harness("80").ns.fn.getDefensePaintInterval(), 80);
  assert.equal(harness("180").ns.fn.getDefensePaintInterval(), 180);
  assert.equal(h.ns.fn.setDefensePaintInterval(180), true);
  assert.equal(h.storage.get("ofe.defensePaint.interval"), "180");
});

test("typing and conflicting keybinds do not toggle, and a custom binding works", () => {
  const h = harness();
  h.key("KeyV", { target: { tagName: "INPUT" } });
  assert.equal(h.ns.fn.isDefensePaintActive(), false);
  h.storage.set("settings.keybinds", JSON.stringify({ buildCity: "KeyV" }));
  h.key("KeyV");
  assert.equal(h.ns.fn.isDefensePaintActive(), false);
  h.ns.fn.saveExtensionBinding("defensePaint", "Shift+KeyV");
  h.key("KeyV", { shiftKey: true });
  assert.equal(h.ns.fn.isDefensePaintActive(), true);
});
