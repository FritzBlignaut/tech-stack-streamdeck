# Tech Stack Stream Deck — Installation Guide

> **Platform:** Linux only (Ubuntu 24.04 / Linux Mint 22.x or compatible Ubuntu-based distros)  
> **Hardware:** Elgato Stream Deck (tested on Original V2)  
> **Install method:** Pre-built `.deb` package — no programming knowledge required

This guide walks you through installing the Tech Stack Stream Deck application from the downloadable `.deb` package, setting up all the tools it needs to work, and verifying that your Stream Deck is recognised.

---

## Before You Start

Make sure you have the following ready:

- [ ] Your Elgato Stream Deck plugged in via USB
- [ ] A working internet connection (to download the package and install tools)
- [ ] Ubuntu 24.04, Linux Mint 22.x, or a compatible Ubuntu-based distro
- [ ] Access to a terminal — press **Ctrl + Alt + T** to open one

> **Not sure which distro you have?** Open a terminal and run `lsb_release -d`. The output will say something like `Ubuntu 24.04.1 LTS` or `Linux Mint 22.3`.

---

## Step 1 — Install Required Tools

The application relies on a handful of command-line tools that handle hotkeys, media control, and volume. These need to be installed **before** you launch the app for the first time — otherwise those button types will silently do nothing.

Open a terminal (**Ctrl + Alt + T**) and run:

```bash
sudo apt install xdotool playerctl pulseaudio-utils
```

**What this does:**
- `sudo` — runs the command with administrator privileges (you will be asked for your password)
- `apt install` — downloads and installs the listed packages from Ubuntu's software servers
- `xdotool` — lets the app simulate keyboard shortcuts on your computer (used by Hotkey buttons)
- `playerctl` — lets the app control music and video players like Spotify, VLC, and Firefox (used by Media Control buttons)
- `pulseaudio-utils` — provides `pactl`, the tool that adjusts your system volume (used by Volume buttons)

> **Note:** `xdg-open` and `gtk-launch` (used for Open URL and Open Application buttons) are already included in standard Ubuntu/Mint desktop installations — you don't need to install them separately.

After the installation finishes, you can verify the tools are available by running:

```bash
xdotool --version
playerctl --version
pactl --version
```

Each command should print a version number. If any of them prints `command not found`, re-run the `apt install` command above.

> [Screenshot: terminal showing the `apt install` command running and completing with "0 upgraded, 3 newly installed"]

---

## Step 2 — Download the `.deb` Package

1. Open your web browser and go to the **Releases** page:  
   **https://github.com/tech-stack-studios/tech-stack-streamdeck/releases**

2. Click on the **latest release** (at the top of the list).

3. Scroll down to the **Assets** section and click the file ending in `_amd64.deb` to download it.  
   The filename will look something like `tech-stack-streamdeck_0.0.1_amd64.deb`.

> [Screenshot: GitHub Releases page with the latest release expanded, showing the Assets section and the .deb file highlighted]

4. Your browser will save the file to your **Downloads** folder (`~/Downloads`).

> [Screenshot: file manager showing the downloaded .deb file in the Downloads folder]

---

## Step 3 — Install the Package

You can install the `.deb` file either through the graphical interface or the terminal. Choose whichever feels more comfortable.

### Method A — Graphical (recommended for beginners)

1. Open your **Files** app (file manager).
2. Navigate to your **Downloads** folder.
3. **Double-click** the `.deb` file.
4. The **Software Manager** (or GDebi) will open, showing the application name and description.
5. Click **Install**, then enter your password when prompted.
6. Wait for the progress bar to complete. The application is now installed.

> [Screenshot: Software Manager showing the Tech Stack Stream Deck package with the Install button]

### Method B — Terminal

Open a terminal and run:

```bash
cd ~/Downloads
sudo dpkg -i tech-stack-streamdeck_*.deb
```

**What this does:**
- `cd ~/Downloads` — moves you into your Downloads folder where the file was saved
- `sudo dpkg -i` — installs the `.deb` package with administrator privileges
- The `*` wildcard matches the filename automatically so you don't have to type the exact version number

> [Screenshot: terminal showing the output of `dpkg -i` completing successfully with "Setting up tech-stack-streamdeck"]

**If you see an error about missing dependencies**, run this to fix them automatically:

```bash
sudo apt-get install -f
```

This tells `apt` to find and install anything the package needs that isn't on your system yet.

---

## Step 4 — Grant USB Access to the Stream Deck (Required)

This is the most important step. By default, Linux does not allow regular applications to talk directly to USB devices for security reasons. You need to create a single configuration file (called a **udev rule**) that tells the system: *"This application is allowed to access Elgato hardware."*

**Without this step, the application will open but will not detect your Stream Deck.**

The entire process takes about two minutes.

### 4.1 — Create the rule file

In a terminal, run:

```bash
sudo nano /etc/udev/rules.d/50-elgato.rules
```

**What this does:**
- `sudo` — opens the file with administrator privileges so you can write to it
- `nano` — a simple text editor that runs inside the terminal
- `/etc/udev/rules.d/50-elgato.rules` — this is the file being created; the `50-` prefix tells udev to load it in a predictable order

The terminal will change to show the nano text editor with a blank file.

> [Screenshot: terminal showing the nano editor open with an empty file and the filename in the title bar]

### 4.2 — Type the rule

Type (or paste) the following line exactly as shown — spacing and quotation marks matter:

```
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="0fd9", TAG+="uaccess"
```

**What this means:**
- `SUBSYSTEM=="hidraw"` — applies to raw HID USB devices
- `ATTRS{idVendor}=="0fd9"` — matches only Elgato hardware (their vendor ID is `0fd9`)
- `TAG+="uaccess"` — grants access to the currently logged-in user automatically, without needing `sudo` every time

> [Screenshot: nano editor showing the rule line typed in the file]

### 4.3 — Save and exit

1. Press **Ctrl + O** — this saves the file (nano will ask you to confirm the filename; just press **Enter**)
2. Press **Ctrl + X** — this closes the editor and returns you to the normal terminal

### 4.4 — Apply the rule and replug

Tell the system to reload its device rules:

```bash
sudo udevadm control --reload-rules
sudo udevadm trigger
```

Then **unplug your Stream Deck from the USB port and plug it back in**. This causes the system to apply the new rule to the device.

> [Screenshot: Stream Deck cable being plugged into a USB port]

---

## Step 5 — Launch the App and Verify

### Finding the app

After installation, **Tech Stack Stream Deck** will appear in your application menu. Search for it by name:

- **Linux Mint / Cinnamon:** press the **Start** menu button → type `Tech Stack`
- **GNOME:** press the **Super** key → type `Tech Stack`
- **XFCE:** Applications menu → search for `Tech Stack`

> [Screenshot: application launcher showing "Tech Stack Stream Deck" in the search results]

Click the icon to launch it.

### What a successful launch looks like

When your Stream Deck is connected and the udev rule is applied correctly, the application will:

- Show your Stream Deck button grid in the centre of the window
- Display a **green connected indicator** in the top-right corner
- Light up the actual buttons on your Stream Deck hardware

> [Screenshot: Tech Stack Stream Deck application window showing the button grid with the device connected — green indicator visible]

### If the app says "No devices found"

This means either:
- The udev rule wasn't saved correctly — check [Step 4](#step-4--grant-usb-access-to-the-stream-deck-required) and run `cat /etc/udev/rules.d/50-elgato.rules` to verify the file contains the rule
- The device wasn't replugged after the rule was loaded — unplug and replug the Stream Deck
- You are using a Stream Deck model other than the Original V2 (other models may work but are untested)

> [Screenshot: app showing "No devices found" state (disconnected indicator) for comparison]

---

## Step 6 — Configure Your Buttons (Quick Start)

Now that the app is running and your device is connected, here's a quick overview of what works out of the box:

| Button type | Status | Requires |
|---|---|---|
| **Hotkey** | ✅ Ready | `xdotool` (installed in Step 1) |
| **Open URL** | ✅ Ready | `xdg-open` (pre-installed) |
| **Open Application** | ✅ Ready | `gtk-launch` (pre-installed) |
| **Run Command** | ✅ Ready | `bash` (pre-installed) |
| **Volume (raise/lower/mute)** | ✅ Ready | `pactl` (installed in Step 1) |
| **Media Control** | ✅ Ready* | `playerctl` (installed in Step 1) |
| **Clock / Date display** | ✅ Ready | — |
| **CPU / RAM display** | ✅ Ready | — |

> *Media Control requires a running media player with MPRIS support (Spotify, VLC, Firefox, Rhythmbox, etc.).  
> To check that your player is visible, run `playerctl -l` in a terminal — it should list your player by name.

### Closing the app

Clicking the **window's × button** hides the app to the system tray — it keeps running in the background so your button actions still work. To fully quit, **right-click the tray icon** and choose **Quit**.

---

## Optional — Launch on Login

If you want the app to start automatically when you log in:

- **Linux Mint / Cinnamon:** System Settings → **Startup Applications** → Add → command: `tech-stack-streamdeck`
- **GNOME:** Install the **GNOME Tweaks** extension or use **Startup Applications** if available
- **XFCE:** Settings → **Session and Startup** → Application Autostart → Add

> [Screenshot: Startup Applications dialog with Tech Stack Stream Deck added as a startup entry]

---

## Troubleshooting

| Symptom | Most likely cause | Fix |
|---|---|---|
| App opens but shows "No devices found" | udev rule missing or device not replugged | Re-do [Step 4](#step-4--grant-usb-access-to-the-stream-deck-required), then unplug and replug the Stream Deck |
| Hotkey buttons do nothing | `xdotool` not installed | `sudo apt install xdotool` |
| Media control buttons do nothing | `playerctl` not installed, or player has no MPRIS | `sudo apt install playerctl`, then run `playerctl -l` to check your player |
| Volume buttons do nothing | `pactl` not installed | `sudo apt install pulseaudio-utils` |
| "dependency not met" error during install | apt package list is outdated | `sudo apt update` then retry the install |
| App won't launch at all after install | `libudev1` runtime missing | `sudo apt install libudev1` |
| App was working, now shows "No devices found" after a system update | udev rules were cleared | Re-do [Step 4.4](#44--apply-the-rule-and-replug) (`udevadm reload` + replug) |
| Window disappears when I click × | This is intentional — app hides to tray | Right-click the tray icon → **Quit** |

---

## Discord Plugin Hosted Relay Setup (Recommended)

If you use the Discord plugin, configure a hosted OAuth relay to keep the Discord `client_secret` and refresh tokens off the local machine.

1. Open a terminal in the project folder:

```bash
cd discord-relay
wrangler login
wrangler kv namespace create DISCORD_SESSIONS
wrangler kv namespace create DISCORD_SESSIONS --preview
# copy generated KV IDs into discord-relay/wrangler.toml
wrangler secret put DISCORD_CLIENT_SECRET
wrangler secret put RELAY_API_KEY
wrangler deploy
```

2. Install the Discord plugin as usual into `~/.config/tech-stack-streamdeck/plugins/`.
3. In the Discord action inspector, set:
   - `Client ID` — your Discord application client ID
   - `Relay URL` — your deployed Worker URL
   - `Relay API Key` — your relay key if enabled
4. Click **Authorize** and accept the Discord prompt.

In hosted mode, local plugin settings will not keep `client_secret` or `refresh_token`.

---

## Next Steps

- **Install plugins** (OBS Studio, Discord) — see the Plugin Installation Guide in the README
- **Create profiles** — use the profile switcher at the top of the app to create named layouts for different workflows
- **Icon Library** — assign images to your buttons by pointing the app at a local folder of `.png` / `.gif` files via the button editor panel

---

*For more information, visit the [project repository](https://github.com/tech-stack-studios/tech-stack-streamdeck).*
