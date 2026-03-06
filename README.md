# OpenFront Enhanced

Chrome extension that adds quality-of-life improvements to [openfront.io](https://openfront.io).

## Features

- Red dot markers on nations during spawn selection, visible at any zoom level
- Markers are removed automatically when the game starts

## Installation

1. Download or clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `extension/` directory

The extension will activate automatically when you visit openfront.io.

## How It Works

A page-level script hooks into the game's Worker messages to identify player types (bot, human, nation). During the spawn phase, the content script reads player name positions from the DOM and renders red dot markers at the correct screen coordinates, independent of zoom level. All markers are cleaned up when spawn ends.

## Contributing

Found a bug or have a feature idea? [Open an issue](../../issues/new/choose).
