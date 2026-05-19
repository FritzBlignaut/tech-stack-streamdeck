# tech-stack-streamdeck

> **An open-source controller for the Elgato Stream Deck, built for Linux** — powered by Electron, React, and Vite.

[![Platform](https://img.shields.io/badge/platform-Linux-blue?logo=linux&logoColor=white)](https://www.linux.org/)
[![Tested On](https://img.shields.io/badge/tested%20on-Linux%20Mint%2022.3-brightgreen?logo=linuxmint&logoColor=white)](https://linuxmint.com/)
[![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Node](https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/licence-Proprietary-red)](#licence)

---

The **official Elgato Stream Deck software does not support Linux**. This project fills that gap — a full-featured, dark-themed desktop controller that mirrors the Elgato software's UI and drives the hardware directly over USB without any proprietary drivers or Wine.

![tech-stack-streamdeck UI](public/tech_stack_streamdeck.png)

> **Platform note:** Developed and tested on **Linux Mint 22.3 (Wilma / Ubuntu 24.04 base)**. Not yet tested on other distributions. See [Gotchas & Known Limitations](#gotchas--known-limitations) before running on a different distro.

---

## Table of Contents

- [Features](#features)
- [What It Cannot Do (Yet)](#what-it-cannot-do-yet)
- [Requirements](#requirements)
- [Installation](#installation)
- [Running the App](#running-the-app)
- [USB Permissions (udev)](#usb-permissions-udev)
- [Gotchas & Known Limitations](#gotchas--known-limitations)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Roadmap](#roadmap)

---

## Features

### Button Actions
| Action | Description |
|--------|-------------|
| **Hotkey** | Simulates a keypress via `xdotool` (e.g. `ctrl+shift+t`) |
| **Open Application** | Launches an app via `gtk-launch` (`.desktop` ID), `xdg-open`, or a direct binary path. Supports Flatpak. |
| **Open URL** | Opens a URL in your default browser via `xdg-open`. Restricted to `http://`, `https://`, and `ftp://`. |
| **Run Command** | Executes an arbitrary shell command via `bash -c`. |
| **Multi Action** | Chains multiple actions together, executed in sequence on a single button press. |
| **Switch Profile** | Swaps the active profile and redraws the hardware buttons immediately. |
| **Sleep / Wake** | Blanks the Stream Deck display. Any button press wakes it. |
| **Page** | Navigates to a different page within the current profile. |
| **Folder** | Enters a nested page scoped to that button. |
| **Back to Folder** | Returns to the parent page from inside a folder. |

### UI & Profiles
- **Dark theme** matching Elgato's aesthetic.
- **Multiple profiles** — create, rename, switch, and delete named profiles. Each profile is stored as a human-readable JSON file.
- **Multiple pages per profile** — add/remove pages with a page navigator at the bottom.
- **Nested folders** — folders can be nested to arbitrary depth.
- **Drag-and-drop** — drag actions from the left panel directly onto buttons.
- **Right-click context menu** — Clear, Copy, and Paste buttons.
- **Button editor panel** — slides in on click; set title, icon, background colour, and action.
- **Icon Library** — point the app at a local folder of images; browse and assign them to buttons.
- **Animated icons (GIF)** — animated GIFs play on the hardware buttons in real time.
- **System tray** — closing the window hides to tray. The app keeps running in the background.
- **Auto-reconnect** — if the Stream Deck is unplugged, the app polls every 2 seconds and reconnects automatically without requiring a restart.
- **Single-instance lock** — launching a second instance focuses the existing window.

### Hardware
- Pixel-accurate rendering to the Stream Deck LCD buttons (72 × 72 px RGBA).
- Brightness control for sleep/wake.
- Flash feedback on button press (blue circle).

---

## What It Cannot Do (Yet)

The following are planned for Phase 5 but are **not yet implemented**:

- **OBS integration** — no WebSocket support yet.
- **Spotify / media control** — no `playerctl` integration yet.
- **Volume control** — no `pactl` integration yet.
- **Dynamic / live buttons** — no clock, CPU, or RAM display buttons yet (buttons are static until you change them manually).
- **Windows / macOS support** — untested and likely broken (`xdotool`, `xdg-open`, and udev are Linux-specific).
- **Non-Original V2 models** — only the Stream Deck Original V2 (5×3) has been tested. Other models (Mini, XL, MK.2, +) may work but are untested.

---

## Requirements

### Hardware
- Elgato Stream Deck (tested: **Original V2**)

### System
- **Linux Mint 22.3** (Ubuntu 24.04 base) — other distros untested
- **Node.js** v18 or later (v24 recommended; managed via [nvm](https://github.com/nvm-sh/nvm))
- **npm** v9 or later

### External CLI Tools

These must be installed and available on your `$PATH`:

| Tool | Purpose | Install |
|------|---------|---------|
| `xdotool` | Hotkey simulation | `sudo apt install xdotool` |
| `xdg-open` | Open URLs and applications | Pre-installed on most desktop distros |
| `gtk-launch` | Launch `.desktop` apps by ID | Pre-installed with GTK (standard on GNOME/Cinnamon) |

> **Note:** If `xdotool` is not installed, the **Hotkey** action will silently fail with no error shown in the UI.

---

## Installation

```bash
# 1. Clone the repo
git clone https://github.com/your-username/tech-stack-streamdeck.git
cd tech-stack-streamdeck

# 2. Install dependencies
npm install

# 3. Rebuild native modules for Electron
npm run rebuild

# 4. Build the renderer
npm run build
```

> **Step 3 is mandatory.** `node-hid` (the USB library that talks to the Stream Deck) is a native Node module and must be compiled against the specific version of Electron you are using. Skipping this step will result in a "Could not load module" error on startup.

---

## Running the App

```bash
# Production mode (requires a completed build)
npx electron .
```

```bash
# Dev mode — hot-reloading renderer + Electron (run in two separate terminals)
npm run dev           # terminal 1: starts the Vite dev server
npm run electron:dev  # terminal 2: starts Electron pointed at the dev server
```

---

## USB Permissions (udev)

On Linux, USB HID devices are not accessible by regular users by default. A udev rule is required to grant access without `sudo`.

**1. Create the rule file:**

```bash
sudo nano /etc/udev/rules.d/50-elgato.rules
```

**2. Add the following line and save:**

```
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0fd9", TAG+="uaccess"
```

**3. Reload udev and replug the device:**

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
# Unplug and replug the Stream Deck
```

> Without this rule the app will start but report "No devices found" in the console and the device indicator in the top-right corner will show as disconnected.

---

## Gotchas & Known Limitations

| # | Issue | Detail |
|---|-------|--------|
| 1 | **udev rule required** | Without it the device is invisible to the app. See [USB Permissions](#usb-permissions-udev) above. |
| 2 | **Native module rebuild required** | Any time you update Electron or run a fresh `npm install`, run `npm run rebuild` or the USB connection will fail to open. |
| 3 | **`xdotool` is not bundled** | Must be installed separately via `apt`. Hotkeys silently do nothing if it is missing. |
| 4 | **Only tested on Linux Mint 22.3** | Other distros — especially non-udev or non-systemd setups — may need different udev rule locations or syntax. |
| 5 | **Only tested on Stream Deck Original V2** | Grid dimensions are detected at runtime so other models *may* work, but icon sizes, row/column counts, and button indexing have not been validated on any other hardware. |
| 6 | **No auto-start on login** | The app does not register a systemd service or `.desktop` autostart entry. You must launch it manually, or configure autostart yourself via your desktop environment's startup applications. |
| 7 | **GIF performance on large files** | Animated GIFs are decoded fully in-memory on the renderer thread. Very large GIFs (many frames or high source resolution) may cause a brief UI stall during the initial decode. |
| 8 | **Profile files are plain JSON** | Stored in `~/.config/tech-stack-streamdeck/`. Manual editing is possible, but the app does not validate the schema on load — a malformed file can silently result in blank buttons. |
| 9 | **Window close button hides, not quits** | By design — it hides to the system tray. Use the tray icon → **Quit** to fully exit the application. |
| 10 | **Flatpak app IDs with `gtk-launch`** | Flatpak `.desktop` IDs (e.g. `com.obsproject.Studio`) work with the default `gtk-launch` mode in Open Application. Use **Direct** mode only for native binary paths. |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Application framework | [Electron](https://www.electronjs.org/) 42 |
| UI | [React](https://react.dev/) 19 + [Vite](https://vite.dev/) 8 |
| Hardware access | [@elgato-stream-deck/node](https://github.com/Julusian/node-elgato-stream-deck) 7 |
| GIF decoding | [gifuct-js](https://github.com/matt-way/gifuct-js) 2 |
| Native USB | [node-hid](https://github.com/node-hid/node-hid) (via `@elgato-stream-deck/node`) |
| Hotkeys | `xdotool` (system dependency) |
| Styling | Plain CSS (no framework) |

---

## Project Structure

```
tech-stack-streamdeck/
├── electron/
│   ├── main.cjs          # Main process — device connection, IPC handlers, tray
│   └── preload.cjs       # contextBridge — exposes IPC to renderer
├── src/
│   ├── App.jsx           # All UI components and application state
│   ├── App.css           # Application styles
│   └── main.jsx          # React entry point
├── public/
│   └── tech_stack_streamdeck.png
├── .github/
│   └── plans/
│       ├── plan.md       # Phase-by-phase build plan
│       └── context.md    # Full technical context reference
├── dist/                 # Built renderer output (generated — do not commit)
├── package.json
└── vite.config.js
```

---

## Roadmap

- [x] Phase 1 — Hardware connection, button press logging, test image rendering
- [x] Phase 2 — Full UI, profiles, hardware icon drawing
- [x] Phase 3 — Actions: Hotkey, Open Application, Open URL, Run Command, Multi Action, Switch Profile
- [x] Phase 4 — Polish: drag-and-drop, context menu, pages, folders, animated icons, system tray, auto-reconnect
- [ ] Phase 5 — Built-in plugins: OBS, Spotify/media, volume, clock, CPU/RAM

---

## Licence

This project is private and unlicensed. All rights reserved.

---

**Trademark notice:** Elgato and Stream Deck are registered trademarks of Corsair Gaming, Inc. This project is not affiliated with, endorsed by, or associated with Corsair or Elgato in any way. The trademarks are used solely to identify the hardware this software is compatible with.

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
