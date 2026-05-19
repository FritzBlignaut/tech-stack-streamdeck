# Project Context — tech-stack-streamdeck

Last updated: 19 May 2026

---

## Stack

| Layer | Tech |
|-------|------|
| Runtime | Electron 42.1.0 |
| UI | React 19.2.6 + Vite 8.0.13 |
| GIF decoding | gifuct-js |
| Build | `npx vite build` (outputs to `dist/`) |
| Node | v24.15.0 via nvm |
| OS | Linux Mint, user `fritz` |

**Entry points**
- Main process: `electron/main.cjs`
- Preload (contextBridge): `electron/preload.cjs`
- Renderer root: `src/main.jsx` → `src/App.jsx`
- Styles: `src/App.css`, `src/index.css`

---

## Device

- Model: `originalv2`
- USB path: `/dev/hidraw8` (may change on replug)
- Grid: 5 columns × 3 rows = 15 buttons
- Icon size: 72 × 72 px (`ICON_SIZE=72`)
- Library: `@elgato-stream-deck/node`

---

## Profile storage

```
app.getPath('userData')/<name>.json
```

Schema:
```jsonc
{
  "name": "Default Profile",
  "pages": [
    { "0": { ...buttonConfig }, "3": { ...buttonConfig } }  // index → config
  ]
}
```

A `buttonConfig` object:
```jsonc
{
  "title": "OBS",
  "iconDataUrl": "data:image/png;base64,...",
  "bgColor": "#1a1a2e",
  "action": { "type": "hotkey", "keys": "super+shift+o" }
  // action types: hotkey | open-app | open-url | run-cmd | multi-action
  //               switch-profile | sleep-toggle | page-switcher | folder | enter-folder
}
```

---

## IPC channels

### Main → Renderer (via `sendToRenderer` / `webContents.send`)

| Channel | Payload | When |
|---------|---------|------|
| `deck:info` | `{ model, productName, serialNumber, rows, cols, iconSize }` | On connect / reconnect |
| `deck:down` | `{ index, row, column }` | Button pressed |
| `deck:up` | `{ index, row, column }` | Button released |
| `deck:sleep` | `{}` | Sleep toggled on |
| `deck:wake` | `{}` | Sleep toggled off / button press while sleeping |
| `deck:disconnect` | `{}` | USB error / unplug detected |

### Renderer → Main (`ipcMain.handle`)

| Channel | Args | Returns |
|---------|------|---------|
| `action:hotkey` | `{ keys }` | `{ code }` or `{ error }` |
| `action:open-app` | `{ target, mode }` | `{ code }` or `{ error }` |
| `action:open-url` | `{ url }` | `{ code }` or `{ error }` |
| `action:run-cmd` | `{ command }` | `{ code }` or `{ error }` |
| `action:sleep-toggle` | — | — |
| `dialog:open-file` | — | file path or `null` |
| `profile:save` | data | — |
| `profile:load` | — | data or `null` |
| `profile:list` | — | `string[]` |
| `profile:get-active` | — | `string` |
| `profile:switch` | `{ name }` | `{ ok, data? }` |
| `profile:create` | `{ name }` | `{ ok, name? }` |
| `profile:delete` | `{ name }` | `{ ok }` |
| `button:setIcon` | `{ index, rgbaData }` | — |
| `icons:browse-dir` | — | dir path or `null` |
| `icons:scan-dir` | `{ dir }` | `string[]` of iconlib:// URLs |
| `icons:load-file` | `{ filePath }` | data URL or `null` |

---

## Main process architecture (`electron/main.cjs`)

### Module-level state

```js
let mainWindow        // BrowserWindow
let libraryDir        // path to user icon library folder
let activeProfileName // currently active profile name (string)
let tray              // Tray instance
let isQuitting        // set true by before-quit to allow real close
let deck              // current @elgato-stream-deck/node instance (null when disconnected)
let isSleeping        // hardware sleep state
let reconnectTimer    // setInterval handle for USB reconnect polling
```

### Key functions

| Function | Purpose |
|----------|---------|
| `getProfilePath(name)` | Returns absolute path to `<userData>/<name>.json` |
| `sendToRenderer(channel, payload)` | `mainWindow.webContents.send(...)` with null guard |
| `createWindow()` | Creates `BrowserWindow`, hides on close (tray mode) |
| `createTrayIconPng()` | Returns 22×22 PNG Buffer (zlib-encoded inline) |
| `createTray()` | Creates system tray with Show/Quit menu |
| `registerIpcHandlers()` | Registers **all** `ipcMain.handle` once at startup |
| `connectDeck()` | Opens USB device, wires events, sends `deck:info` |
| `scheduleReconnect()` | Starts 2-second polling until device reappears |
| `initStreamDeck()` | Calls `registerIpcHandlers` + `connectDeck` + reconnect setup |

### Auto-reconnect flow

1. `connectDeck()` assigns `deck = newDeck` and registers events on `newDeck` (local capture).
2. `newDeck.on('error')` fires on USB unplug → sets `deck = null`, sends `deck:disconnect` to renderer, calls `scheduleReconnect()`.
3. `scheduleReconnect()` polls `listStreamDecks()` every 2 s. When a device appears, calls `connectDeck()` again.
4. `connectDeck()` sends `deck:info` → renderer's `onInfo` handler calls `setDevice(info)` → `useEffect([device])` redraws all hardware buttons.
5. IPC handlers always reference the module-level `deck`. No re-registration needed.

### System tray

- Window close hides to tray (sets `isQuitting = false` guard).
- `app.on('window-all-closed')` is a no-op (keeps app alive in tray).
- `app.on('before-quit')` sets `isQuitting = true`.
- Single-instance lock: second instance focuses the existing window and quits.
- `createTray()` called in `app.whenReady`.

---

## Renderer architecture (`src/App.jsx`)

### State

| State | Type | Purpose |
|-------|------|---------|
| `device` | object\|null | Info from `deck:info`; null when disconnected |
| `iconSize` | number | Button pixel size (from `deck:info`) |
| `sleeping` | bool | Hardware sleep state |
| `pages` | array | All pages of the active profile |
| `currentPage` | number | Index into `pages` |
| `folderPath` | array | Stack of folder indices (for nested pages) |
| `buttonConfigs` | object | `{ [index]: config }` for the current view |
| `selectedIndex` | number\|null | Which button's editor is open |
| `iconLibrary` | string[] | iconlib:// URLs from scanned folder |

### Key refs

| Ref | Purpose |
|-----|---------|
| `buttonConfigsRef` | Mirror of `buttonConfigs` state, safe for use in effects |
| `drawHardwareButtonRef` | Mirror of `drawHardwareButton`, safe for async callbacks |
| `stopAllGifAnimationsRef` | Called on sleep and disconnect |
| `gifAnimationsRef` | `{ [index]: { token, timer } }` — GIF animation state |

### Key functions

| Function | Purpose |
|----------|---------|
| `getButtonsAt(pages, page, folderPath)` | Resolves current view's button map |
| `immutableSetButton(pages, page, folderPath, index, config)` | Returns new pages with one button changed |
| `enterFolder(index)` / `exitFolder()` | Folder navigation + hardware redraw |
| `drawHardwareButton(index, config)` | Renders one button to hardware (static or GIF) |
| `extractGifFrames(dataUrl, iconSize, title)` | Decodes GIF → `[{ rgbaData, delay }]` or `null` |
| `startGifAnimation(index, config)` | Async GIF loop with cancellation token |
| `stopGifAnimation(index)` / `stopAllGifAnimations()` | Cancel animation timers |

### Effects

| Effect | Deps | What it does |
|--------|------|-------------|
| event subscription | `[]` | Registers `onInfo`, `onDown`, `onUp`, `onSleep`, `onWake`, `onDisconnect` |
| profile load | `[]` | Loads profile + icon library on mount, draws hardware buttons |
| buttonConfigsRef sync | `[buttonConfigs]` | Keeps ref in sync with state |
| drawHardwareButtonRef sync | `[drawHardwareButton]` | Keeps ref in sync with latest closure |
| stopAllGifAnimationsRef sync | `[stopAllGifAnimations]` | Keeps ref in sync |
| wake redraw | `[sleeping]` | When `sleeping` → false, redraws all hardware buttons |
| reconnect redraw | `[device]` | When `device` becomes non-null and configs are loaded, redraws all hardware buttons |

### Disconnect / reconnect lifecycle

1. `deck:disconnect` → `onDisconnect`: stops GIF animations, `setDevice(null)`, `setSleeping(false)`
2. `deck:info` (reconnect) → `onInfo`: `setDevice(info)`, `setIconSize(...)`
3. Re-render completes → `useEffect([device])`: iterates all `rows×cols` buttons, calls `drawHardwareButtonRef.current(i, buttonConfigsRef.current[i])`
4. First-startup guard: if `buttonConfigsRef.current` is empty (profile not yet loaded), the effect is a no-op — the profile-load effect handles initial draw

---

## GIF support

- **Library**: `gifuct-js` (`parseGIF` + `decompressFrames`)
- **`extractGifFrames(dataUrl, iconSize, title)`**:
  1. Converts data URL → ArrayBuffer → gifuct-js
  2. Composites each frame at native GIF size on an offscreen canvas
  3. Scales to `iconSize × iconSize`
  4. Overlays title text
  5. Returns `[{ rgbaData: number[], delay: number }]` or `null` for single-frame GIFs
- **Animation loop** (`startGifAnimation`): uses cancellation tokens + `setTimeout` chain; stores `{ token, timer }` in `gifAnimationsRef`
- **Cancellation**: `stopGifAnimation(index)` increments token, clears timer; `stopAllGifAnimations()` cancels all

---

## Folder / page navigation

- `folderPath` is a stack of button indices: `[]` = root, `[3]` = inside folder at button 3, `[3, 7]` = nested folder
- `getButtonsAt` traverses `pages[currentPage]` through folder nesting
- `enterFolder(index)` pushes to `folderPath`, redraws hardware
- `exitFolder()` pops from `folderPath`, redraws hardware
- "Back" button rendered automatically when `folderPath.length > 0`
- Page-switcher buttons change `currentPage`

---

## Build / run

```bash
# Dev (renderer only, no Electron)
npm run dev

# Build renderer
npx vite build

# Run Electron (after build)
npx electron .

# Syntax-check main process
node --check electron/main.cjs
```

---

## Progress

| Phase | Status |
|-------|--------|
| Phase 1 — Hardware connect, test image, sleep/wake | ✅ Done |
| Phase 2 — Full UI, profiles, hardware drawing | ✅ Done |
| Phase 3 — All actions (hotkey, app, URL, cmd, multi, profile) | ✅ Done |
| Phase 4 — Drag-drop, context menu | ✅ Done |
| Phase 4 — Multiple profile pages + page-switcher | ✅ Done |
| Phase 4 — Folder buttons (nested pages) | ✅ Done |
| Phase 4 — Animated icons (GIF support) | ✅ Done |
| Phase 4 — System tray + background mode | ✅ Done |
| Phase 4 — Auto-reconnect on USB unplug | ✅ Done |
| Phase 5 — OBS, Spotify, volume, clock, CPU/RAM plugins | ❌ Not started |

---

## Branch

`feature/auto-connect` (all Phase 4 work lives here; merge to main when Phase 5 begins)
