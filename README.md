# OpenFront Enhanced

![Screenshot of spawn phase with nation markers and shortcut panel](screenshot.png)

Chrome extension that adds quality-of-life improvements to [openfront.io](https://openfront.io).

## Features

### Spawn phase
- **Nation markers** — Red dots on nations during spawn selection, visible at any zoom level. Removed when the game starts.
- **Sound notifications** — A chime plays when the spawn phase begins and another when the game starts, so you don't have to stare at the screen.

### Keyboard shortcuts

All shortcuts are rebindable in the extension's settings panel.

| Default key | Action | Description |
|---|---|---|
| `Z` | Chat Search | Opens chat directed at the hovered player with search |
| `X` | Emoji Search | Opens emoji selector with keyword search |
| `V` | Alliance Request | Sends an alliance request to the hovered player |
| `N` | Boat 1% | Sends a boat attack using only 1% of your troops |
| `L` | Cycle Territories | Jumps camera between your disconnected territories |

### Neighbor alerts
Notifications appear in the bottom-right when a neighboring player:
- **Falls asleep** (disconnects)
- **Betrays** an alliance and becomes a traitor

### Other
- **Emoji priority & keyword search** — Frequently used emojis are boosted to the top, and all emojis are searchable by keyword.

## Installation

1. Download or clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked**
5. Select the `extension/` directory

The extension will activate automatically when you visit openfront.io.

## Contributing

Found a bug or have a feature idea? [Open an issue](../../issues/new/choose).
