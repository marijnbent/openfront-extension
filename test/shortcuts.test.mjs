import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const sources = await Promise.all(
  ["constants", "keybinds", "boat-one-percent", "shortcuts"].map((name) =>
    readFile(new URL(`../src/pagehook/${name}.js`, import.meta.url), "utf8"),
  ),
);

function createHarness() {
  const listeners = new Map();
  const timers = new Map();
  const sounds = [];
  const calls = [];
  const intents = [];
  const storage = new Map([
    ["settings.keybinds", JSON.stringify({ boatAttack: "KeyS", moveDown: "Null" })],
  ]);
  let result = [{ type: "Transport", canBuild: false }];
  let currentGame;
  const player = {
    buildables(...args) {
      assert.equal(this, player);
      calls.push(args);
      return Promise.resolve(result);
    },
    actions(...args) {
      assert.equal(this, player);
      calls.push(args);
      return Promise.resolve(result);
    },
  };
  const game = { myPlayer: () => player };
  currentGame = game;
  const eventBus = { emit: (event) => intents.push(event) };
  const panel = { attackRatio: 0.42, onAttackRatioChange() {} };
  const ns = {
    constants: {},
    state: {},
    fn: {
      getNativeContext: () => ({ game: currentGame, eventBus }),
      isTextInput: (target) => target?.tagName === "INPUT",
      hasCommandModifier: (event) => event.ctrlKey || event.altKey || event.metaKey,
      playExtensionSound: (key) => sounds.push(key),
      maybeNotifyShortcutBlocked() {},
    },
  };
  class KeyboardEvent {
    constructor(type, options) {
      this.type = type;
      Object.assign(this, options);
    }
    stopImmediatePropagation() { this.stopped = true; }
    preventDefault() { this.defaultPrevented = true; }
  }
  function dispatchEvent(event) {
    listeners.get(event.type)?.(event);
    if (event.stopped || event.type !== "keyup" || event.target?.tagName === "INPUT") return;
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const bindings = ns.fn.getEffectiveGameKeybinds();
    if (ns.fn.keybindMatchesEvent(event, bindings.boatAttack)) {
      player.buildables(123, ["Transport"]).then((units) => {
        if ((units.find((unit) => unit.type === "Transport")?.canBuild ?? false) !== false) {
          eventBus.emit({ dst: 123, troops: 1000 * panel.attackRatio });
        }
      });
    } else if (ns.fn.keybindMatchesEvent(event, bindings.groundAttack)) {
      player.actions(123, null).then((actions) => {
        if (actions.canAttack) eventBus.emit({ targetID: 9, troops: 420 });
      });
    }
  }
  const context = vm.createContext({
    window: { __OFE: ns, addEventListener: (type, fn) => listeners.set(type, fn), dispatchEvent },
    document: { querySelector: () => panel },
    navigator: { userAgent: "Mac" },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    KeyboardEvent,
    setTimeout: (fn, delay) => { const id = Symbol(); timers.set(id, { fn, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  });
  for (const source of sources) vm.runInContext(source, context);
  ns.fn.initShortcutHandlers();
  return {
    ns, player, panel, sounds, calls, intents,
    setResult: (value) => { result = value; },
    leaveGame: () => { currentGame = null; },
    key: (code, options = {}) => dispatchEvent(new KeyboardEvent("keyup", { code, ...options })),
    capture: (code) => listeners.get("keyup")(new KeyboardEvent("keyup", { code })),
    flushTimers: () => { for (const { fn } of timers.values()) fn(); timers.clear(); },
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

test("blocked action sound defaults on and can be disabled in settings", () => {
  const { ns } = createHarness();
  assert.equal(ns.fn.extensionSoundEnabled("actionBlocked"), true);
  ns.fn.saveExtensionSetting("actionBlocked", false);
  assert.equal(ns.fn.extensionSoundEnabled("actionBlocked"), false);
});

test("custom boat key plays one blocked sound after the native check rejects the boat", async () => {
  const h = createHarness();
  const original = h.player.buildables;
  let resolve;
  h.setResult(new Promise((done) => { resolve = done; }));
  h.key("KeyS");
  assert.deepEqual(h.sounds, []);
  assert.equal(h.calls.length, 1);
  assert.equal(h.player.buildables, original);
  resolve([{ type: "Transport", canBuild: false }]);
  await settle();
  assert.deepEqual(h.sounds, ["actionBlocked"]);
  assert.deepEqual(h.intents, []);
});

test("ground attack rejection during peace time plays a blocked sound", async () => {
  const h = createHarness();
  h.setResult({ canAttack: false });
  h.key("KeyG");
  await settle();
  assert.deepEqual(h.sounds, ["actionBlocked"]);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.intents, []);
});

test("successful boat and ground attacks stay silent and keep native intents", async () => {
  const h = createHarness();
  h.setResult([{ type: "Transport", canBuild: 0 }]);
  h.key("KeyS");
  await settle();
  h.setResult({ canAttack: true });
  h.key("KeyG");
  await settle();
  assert.deepEqual(h.sounds, []);
  assert.equal(h.intents.length, 2);
});

test("Boat 1% plays one rejection sound and restores the attack ratio", async () => {
  const h = createHarness();
  h.key("KeyN");
  await settle();
  assert.deepEqual(h.sounds, ["actionBlocked"]);
  assert.equal(h.calls.length, 1);
  h.flushTimers();
  assert.equal(h.panel.attackRatio, 0.42);
  assert.equal(h.ns.state.boatDispatching, false);
});

test("successful Boat 1% uses one percent and stays silent", async () => {
  const h = createHarness();
  h.setResult([{ type: "Transport", canBuild: 7 }]);
  h.key("KeyN");
  await settle();
  assert.deepEqual(h.sounds, []);
  assert.equal(h.intents[0].troops, 10);
  assert.equal(h.panel.attackRatio, 0.42);
});

test("typing, modifiers, and keys that do not attack do not start feedback checks", () => {
  const h = createHarness();
  const original = h.player.buildables;
  h.key("KeyS", { target: { tagName: "INPUT" } });
  h.key("KeyS", { ctrlKey: true });
  h.key("KeyS", { shiftKey: true });
  h.key("KeyW");
  assert.equal(h.player.buildables, original);
  assert.deepEqual(h.sounds, []);
  assert.deepEqual(h.calls, []);
});

test("feedback respects shifted custom attack keys", async () => {
  const h = createHarness();
  h.ns.fn.getEffectiveGameKeybinds = () => ({ boatAttack: "Shift+KeyS" });
  h.key("KeyS", { shiftKey: true });
  await settle();
  assert.deepEqual(h.sounds, ["actionBlocked"]);
});

test("unused feedback hooks expire without observing later hover queries", async () => {
  const h = createHarness();
  const original = h.player.buildables;
  h.capture("KeyS");
  await settle();
  assert.notEqual(h.player.buildables, original);
  await h.player.buildables(123, ["City"]);
  assert.deepEqual(h.sounds, []);
  h.flushTimers();
  assert.equal(h.player.buildables, original);
  await h.player.buildables(123, ["Transport"]);
  assert.deepEqual(h.sounds, []);
});

test("pending feedback does not play after leaving the game", async () => {
  const h = createHarness();
  h.key("KeyS");
  h.leaveGame();
  await settle();
  assert.deepEqual(h.sounds, []);
});
