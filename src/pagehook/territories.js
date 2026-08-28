"use strict";

(() => {
  const ns = window.__OFE;
  if (!ns) return;

  const { fn } = ns;

  function collectOwnedTiles(game, mySmallID) {
    const width = Number(game.width());
    const height = Number(game.height());
    if (!Number.isFinite(width) || !Number.isFinite(height)) return [];

    const owned = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const tile = game.ref(x, y);
        if (Number(game.ownerID(tile)) === mySmallID) owned.push(tile);
      }
    }
    return owned;
  }

  function markerPosition(game, tiles) {
    let averageX = 0;
    let averageY = 0;
    for (const tile of tiles) {
      averageX += Number(game.x(tile));
      averageY += Number(game.y(tile));
    }
    averageX /= tiles.length;
    averageY /= tiles.length;

    let markerTile = tiles[0];
    let nearestDistance = Infinity;
    for (const tile of tiles) {
      const dx = Number(game.x(tile)) - averageX;
      const dy = Number(game.y(tile)) - averageY;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        markerTile = tile;
        nearestDistance = distance;
      }
    }

    return { x: Number(game.x(markerTile)), y: Number(game.y(markerTile)) };
  }

  function findMiniTerritories(game, maximumSize = 40) {
    if (
      !game ||
      typeof game.myPlayer !== "function" ||
      typeof game.width !== "function" ||
      typeof game.height !== "function" ||
      typeof game.ref !== "function" ||
      typeof game.ownerID !== "function" ||
      typeof game.neighbors !== "function" ||
      typeof game.x !== "function" ||
      typeof game.y !== "function"
    ) {
      return null;
    }

    const me = game.myPlayer();
    const mySmallID = Number(me?.smallID?.());
    if (!Number.isFinite(mySmallID) || mySmallID <= 0) return null;

    const ownedTiles = collectOwnedTiles(game, mySmallID);
    const owned = new Set(ownedTiles);
    const visited = new Set();
    const components = [];

    for (const start of ownedTiles) {
      if (visited.has(start)) continue;

      const tiles = [];
      const pending = [start];
      visited.add(start);

      while (pending.length) {
        const tile = pending.pop();
        tiles.push(tile);
        for (const neighbor of game.neighbors(tile)) {
          if (owned.has(neighbor) && !visited.has(neighbor)) {
            visited.add(neighbor);
            pending.push(neighbor);
          }
        }
      }

      components.push(tiles);
    }

    components.sort((a, b) => b.length - a.length);
    return components
      .slice(1)
      .filter((tiles) => tiles.length <= maximumSize)
      .map((tiles) => ({
        size: tiles.length,
        ...markerPosition(game, tiles),
      }));
  }

  fn.findMiniTerritories = findMiniTerritories;
})();
