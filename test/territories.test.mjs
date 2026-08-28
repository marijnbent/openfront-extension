import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../src/pagehook/territories.js", import.meta.url),
  "utf8",
);

function loadFinder() {
  const sandbox = { window: { __OFE: { fn: {} } } };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.__OFE.fn.findMiniTerritories;
}

function createGame(ownedRefs) {
  const width = 5;
  const height = 3;
  const owned = new Set(ownedRefs);
  return {
    width: () => width,
    height: () => height,
    ref: (x, y) => y * width + x,
    x: (ref) => ref % width,
    y: (ref) => Math.floor(ref / width),
    ownerID: (ref) => (owned.has(ref) ? 7 : 0),
    myPlayer: () => ({ smallID: () => 7 }),
    neighbors(ref) {
      const x = ref % width;
      const y = Math.floor(ref / width);
      return [
        x > 0 ? ref - 1 : null,
        x < width - 1 ? ref + 1 : null,
        y > 0 ? ref - width : null,
        y < height - 1 ? ref + width : null,
      ].filter((value) => value != null);
    },
  };
}

test("findMiniTerritories excludes the main region", () => {
  const findMiniTerritories = loadFinder();
  const game = createGame([0, 1, 4, 9, 14]);

  const minis = findMiniTerritories(game, 40);

  assert.deepEqual(
    Array.from(minis, ({ size }) => size),
    [2],
  );
  assert.ok(minis.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)));
});

test("findMiniTerritories excludes regions above the limit", () => {
  const findMiniTerritories = loadFinder();
  const game = createGame([0, 1, 2, 4, 9, 14]);

  const minis = findMiniTerritories(game, 2);

  assert.equal(minis.length, 0);
});

test("findMiniTerritories returns no marker for one connected territory", () => {
  const findMiniTerritories = loadFinder();
  const game = createGame([0, 1, 2]);
  assert.equal(findMiniTerritories(game, 40).length, 0);
});

test("findMiniTerritories rejects an unavailable game", () => {
  const findMiniTerritories = loadFinder();
  assert.equal(findMiniTerritories(null), null);
});
