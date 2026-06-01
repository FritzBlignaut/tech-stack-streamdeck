Build Plan — Phase by Phase
Phase 1: Skeleton & Device (Week 1)

Scaffold Electron + React + Vite project
Set up udev rules for Linux USB access
Connect to Stream Deck, log button presses to console
Draw a test image on a button — prove hardware works

Phase 2: Core UI (Week 2–3)

Dark theme layout matching Elgato's aesthetic exactly
Top bar: profile dropdown + device name
Center: button grid (correct layout per model — 5×3, 4×2, 8×4 etc.)
Click a button → editor panel slides in on the right
Set button title + icon (file picker)
Save/load profiles as JSON

Phase 3: Actions (Week 3–4)

Hotkey — use xdotool key to simulate keypresses
Open Application — xdg-open or direct binary path
Open URL — xdg-open https://...
Run Command — bash -c "..." via child_process
Multi Action — array of actions run in sequence
Switch Profile — swap the active JSON profile

Phase 4: Polish to Match Elgato (Week 4–5)

Drag action from left panel onto a button (drag-and-drop)
Right-click a button → context menu (Clear, Copy, Paste)
Multiple profile pages with page-switcher button type
Folder buttons (nested pages)
Animated icons (GIF support)
System tray icon + background mode
Auto-reconnect on USB unplug

Phase 5: Built-in Plugins (Ongoing)

OBS control via OBS WebSocket
Spotify/media via playerctl
Volume control via pactl
Clock / date display (dynamic buttons that update on a timer)
CPU / RAM display

Phase 6: OBS Functionality

Record: Start or stop recording
Record Pause: Pause an active recording
Stream: Start or stop streaming
Replay Buffer: Start or stop the replay buffer
Save Replay: Save a replay of the active buffer
Scene Collection: Switch to a scene collection
Scene: Switch to a scene
Source: Show or hide a source
Mute: Mute or unmute source audio
Media: Control playback for a media source
Studio Mode: Turn Studio Mode on or off
Preview Scene: Push your preview scene live when in Studio Mode
Filter: Show or hide a source filter
Screenshot: Take a screenshot of the output scene
Transition: Switch the active scene transition
Chapter Marker: Insert a chapter marker during an active recording