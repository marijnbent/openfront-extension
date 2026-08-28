import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../src/pagehook/boat-one-percent.js", import.meta.url),
  "utf8",
);

test("Boat 1% keeps the native ratio until the asynchronous intent is sent", async () => {
  const ratios = [];
  const controlPanel = {
    attackRatio: 0.42,
    onAttackRatioChange(ratio) {
      ratios.push(ratio);
    },
    requestUpdate() {},
  };
  const eventBus = {
    emit() {},
  };
  const namespace = {
    state: { boatDispatching: false },
    fn: {
      getBoatAttackKey: () => "KeyB",
      getNativeContext: () => ({ eventBus }),
    },
  };
  const sandbox = {
    clearTimeout,
    console,
    document: {
      querySelector: (selector) =>
        selector === "control-panel" ? controlPanel : null,
    },
    KeyboardEvent: class KeyboardEvent {
      constructor(type, options) {
        this.type = type;
        Object.assign(this, options);
      }
    },
    setTimeout,
    window: {
      __OFE: namespace,
      dispatchEvent() {},
    },
  };

  vm.runInNewContext(source, sandbox);
  namespace.fn.triggerBoatOnePercentAttack();

  assert.equal(controlPanel.attackRatio, 0.01);
  assert.equal(namespace.state.boatDispatching, true);

  await Promise.resolve();
  eventBus.emit({ dst: 123, troops: 100 });

  assert.deepEqual(ratios, [0.01, 0.42]);
  assert.equal(controlPanel.attackRatio, 0.42);
  assert.equal(namespace.state.boatDispatching, false);
});

test("Boat 1% does not restore for another attack intent", () => {
  const controlPanel = {
    attackRatio: 0.25,
    onAttackRatioChange() {},
    requestUpdate() {},
  };
  const eventBus = { emit() {} };
  const namespace = {
    state: { boatDispatching: false },
    fn: {
      getNativeContext: () => ({ eventBus }),
      getBoatAttackKey: () => "KeyB",
    },
  };
  const sandbox = {
    clearTimeout,
    console,
    document: { querySelector: () => controlPanel },
    KeyboardEvent: class {},
    setTimeout,
    window: { __OFE: namespace, dispatchEvent() {} },
  };

  vm.runInNewContext(source, sandbox);
  namespace.fn.triggerBoatOnePercentAttack();
  eventBus.emit({ targetID: 9, troops: 100 });

  assert.equal(controlPanel.attackRatio, 0.01);
  assert.equal(namespace.state.boatDispatching, true);

  eventBus.emit({ dst: 123, troops: 100 });
  assert.equal(controlPanel.attackRatio, 0.25);
});
