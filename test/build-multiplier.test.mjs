import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../src/pagehook/build-multiplier.js", import.meta.url),
  "utf8",
);

class UpgradeIntent {
  constructor(amount) {
    this.unitId = 42;
    this.unitType = "City";
    this.amount = amount;
  }
}

class BuildIntent {
  constructor(unit, amount) {
    this.unit = unit;
    this.tile = 123;
    this.rocketDirectionUp = false;
    this.amount = amount;
  }
}

function createHarness() {
  const sent = [];
  const uiState = {};
  const context = { eventBus: createBus() };
  const gameChangeListeners = [];
  const fn = {
    getNativeContext: () => context,
    onNativeGameChange: listener => gameChangeListeners.push(listener),
  };
  function createBus() {
    return { emit(event) { sent.push({ event, bus: this }); } };
  }
  vm.runInNewContext(source, {
    window: { __OFE: { state: {}, fn }, addEventListener() {} },
    document: {
      head: null,
      querySelector: selector => selector === "control-panel" ? { uiState } : null,
    },
    customElements: { whenDefined: () => Promise.resolve() },
  });
  fn.initBuildMultiplier();
  return { fn, sent, uiState, context, createBus, gameChangeListeners };
}

test("multiplier cycles through 100 with native requests and previews capped at ten", () => {
  const { fn, uiState } = createHarness();
  for (const amount of [5, 10, 100, 1]) {
    fn.toggleBuildMultiplier();
    assert.equal(fn.getBuildMultiplier(), amount);
    assert.equal(uiState.upgradeMultiplier, Math.min(amount, 10));
  }
});

test("100 sends ten native batches of ten for upgrades and atom bombs", () => {
  for (const original of [new UpgradeIntent(10), new BuildIntent("Atom Bomb", 10)]) {
    const { fn, sent, context } = createHarness();
    fn.setBuildMultiplier(100);
    context.eventBus.emit(original);
    assert.equal(sent.length, 10);
    assert.equal(new Set(sent.map(({ event }) => event)).size, 10);
    for (const { event, bus } of sent) {
      assert.equal(bus, context.eventBus);
      assert.equal(Object.getPrototypeOf(event), Object.getPrototypeOf(original));
      assert.deepEqual({ ...event }, { ...original, amount: 10 });
    }
    assert.equal(original.amount, 10);
  }
});

test("normal multipliers, placements, defense painting and unrelated events pass through once", () => {
  const { fn, sent, context } = createHarness();
  for (const amount of [1, 5, 10]) {
    fn.setBuildMultiplier(amount);
    for (const event of [new UpgradeIntent(amount), new BuildIntent("Atom Bomb", amount)]) {
      sent.length = 0;
      context.eventBus.emit(event);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].event, event);
    }
  }
  fn.setBuildMultiplier(100);
  for (const event of [
    new BuildIntent("City"),
    new BuildIntent("Defense Post"),
    new BuildIntent("Hydrogen Bomb"),
    new UpgradeIntent(1),
    { dst: 123, troops: 100 },
    { amount: 10 },
  ]) {
    sent.length = 0;
    context.eventBus.emit(event);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].event, event);
  }
});

test("repeated installation and new games do not multiply batches again", () => {
  const { fn, sent, context, createBus, gameChangeListeners } = createHarness();
  fn.setBuildMultiplier(100);
  fn.setBuildMultiplier(100);
  gameChangeListeners[0]();
  context.eventBus.emit(new UpgradeIntent(10));
  assert.equal(sent.length, 10);
  sent.length = 0;
  context.eventBus = createBus();
  gameChangeListeners[0]();
  context.eventBus.emit(new UpgradeIntent(10));
  assert.equal(sent.length, 10);
});
