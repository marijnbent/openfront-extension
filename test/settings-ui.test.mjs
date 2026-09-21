import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/pagehook/settings-ui.js", import.meta.url), "utf8");

test("settings tab works for existing and later game modals with separate content", async () => {
  class Element {
    style = {};
    children = [];
    appendChild(child) { this.children.push(child); }
    querySelector() { return null; }
    requestUpdate() { this.updates = (this.updates || 0) + 1; }
  }
  class UserSetting extends Element {
    modalConfig() { return { tabs: [{ key: "gameplay", label: "Gameplay" }] }; }
    renderBody(tab) { return `native:${tab}`; }
  }
  const home = new UserSetting();
  const existingGame = new UserSetting();
  const ns = { state: {}, constants: { EXT_SHORTCUTS: {}, EXT_SOUND_SETTINGS: {} }, fn: {} };
  vm.runInNewContext(source, {
    window: { __OFE: ns },
    Element,
    document: {
      querySelector: () => home,
      querySelectorAll: () => [home, existingGame],
      getElementById: () => null,
      createElement: () => new Element(),
    },
    customElements: { get: () => UserSetting, whenDefined: async () => {} },
    MutationObserver: class { observe() {} disconnect() {} },
  });
  ns.fn.initSettingsIntegration();
  await Promise.resolve();
  const laterGame = new UserSetting();
  for (const modal of [home, existingGame, laterGame]) {
    assert.equal(modal.modalConfig().tabs.filter(tab => tab.key === "ofe-extension").length, 1);
  }
  for (const modal of [home, existingGame, laterGame]) {
    assert.equal(modal.renderBody("gameplay"), "native:gameplay");
    const root = modal.renderBody("ofe-extension");
    assert.equal(root.id, "ofe-extension-settings-root");
    assert.equal(modal.renderBody("ofe-extension"), root);
  }
  assert.notEqual(home.renderBody("ofe-extension"), existingGame.renderBody("ofe-extension"));
  assert.notEqual(existingGame.renderBody("ofe-extension"), laterGame.renderBody("ofe-extension"));
  assert.equal(home.updates, 1);
  assert.equal(existingGame.updates, 1);
});
