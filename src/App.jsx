import { useState, useEffect, useRef } from 'react'
import './App.css'

const DEVICE_MODEL_NAMES = {
  originalv2: 'Stream Deck Original V2',
  mk2:        'Stream Deck MK.2',
  original:   'Stream Deck Original',
  xl:         'Stream Deck XL',
  mini:       'Stream Deck Mini',
  plus:       'Stream Deck +',
  neo:        'Stream Deck Neo',
  pedal:      'Stream Deck Pedal',
}

const ACTION_CATEGORIES = [
  {
    id: 'streamdeck',
    name: 'Stream Deck',
    actions: [
      { id: 'switch-profile', name: 'Switch Profile',  icon: '⇄' },
      { id: 'back-folder',    name: 'Back to Folder',  icon: '↩' },
      { id: 'create-folder',  name: 'Create Folder',   icon: '▣' },
    ],
  },
  {
    id: 'system',
    name: 'System',
    actions: [
      { id: 'hotkey',       name: 'Hotkey',            icon: '⌨' },
      { id: 'open-app',     name: 'Open Application',  icon: '⎈' },
      { id: 'open-url',     name: 'Open URL',           icon: '⊕' },
      { id: 'run-cmd',      name: 'Run Command',        icon: '›_' },
      { id: 'multi-action', name: 'Multi Action',       icon: '▶▶' },
    ],
  },
]

// ─── Profile Dropdown ───────────────────────────────────────
function ProfileDropdown({ profile }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [open])

  return (
    <div className={`profile-dropdown${open ? ' open' : ''}`}>
      <button
        className="profile-btn"
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
      >
        <svg className="profile-grid-icon" viewBox="0 0 14 14" fill="currentColor">
          <rect x="0" y="0" width="5.5" height="5.5" rx="1" />
          <rect x="8.5" y="0" width="5.5" height="5.5" rx="1" />
          <rect x="0" y="8.5" width="5.5" height="5.5" rx="1" />
          <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" />
        </svg>
        <span className="profile-name">{profile}</span>
        <svg className="profile-chevron" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="profile-menu" onClick={e => e.stopPropagation()}>
          <button className="profile-menu-item active">
            <span>Default Profile</span>
            <svg viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="2" width="12">
              <polyline points="1,5 4.5,9 11,1" />
            </svg>
          </button>
          <div className="profile-menu-divider" />
          <button className="profile-menu-item">New Profile…</button>
          <button className="profile-menu-item">Duplicate Profile</button>
        </div>
      )}
    </div>
  )
}

// ─── Actions Panel ──────────────────────────────────────────
function ActionsPanel() {
  const [search, setSearch]     = useState('')
  const [expanded, setExpanded] = useState({ streamdeck: true, system: true })

  const toggle = id => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))

  const filtered = ACTION_CATEGORIES
    .map(cat => ({
      ...cat,
      actions: cat.actions.filter(a =>
        a.name.toLowerCase().includes(search.toLowerCase())
      ),
    }))
    .filter(cat => !search || cat.actions.length > 0)

  return (
    <aside className="actions-panel">
      <div className="actions-search">
        <svg className="search-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7" cy="7" r="5" />
          <path d="M11 11l3 3" />
        </svg>
        <input
          type="text"
          placeholder="Search actions…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="action-list">
        {filtered.map(cat => (
          <div key={cat.id} className="action-category">
            <button className="category-header" onClick={() => toggle(cat.id)}>
              <svg
                className={`category-chevron${expanded[cat.id] ? ' open' : ''}`}
                viewBox="0 0 8 5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M1 1l3 3 3-3" />
              </svg>
              <span>{cat.name}</span>
            </button>

            {expanded[cat.id] && (
              <div className="category-actions">
                {cat.actions.map(action => (
                  <div key={action.id} className="action-item" draggable>
                    <div className="action-icon">{action.icon}</div>
                    <span className="action-name">{action.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}

// ─── Button Grid ────────────────────────────────────────────
function ButtonGrid({ rows, cols, selectedKey, pressedKey, onSelectKey, buttonConfigs, onContextMenu }) {
  return (
    <div className="button-grid" style={{ '--cols': cols }}>
      {Array.from({ length: rows * cols }, (_, i) => {
        const cfg = buttonConfigs?.[i]
        return (
          <button
            key={i}
            className={[
              'deck-btn',
              selectedKey === i ? 'selected' : '',
              pressedKey  === i ? 'pressed'  : '',
              cfg?.iconDataUrl   ? 'has-icon'  : '',
            ].join(' ').trim()}
            style={{
              backgroundImage: cfg?.iconDataUrl ? `url(${cfg.iconDataUrl})` : 'none',
              backgroundColor: cfg?.iconDataUrl ? 'transparent' : (cfg?.bgColor ?? '#262626'),
            }}
            onClick={() => onSelectKey(i)}
            onContextMenu={e => { e.preventDefault(); onContextMenu(e, i) }}
            aria-label={`Button ${i + 1}`}
          >
            {!cfg?.iconDataUrl && <span className="deck-btn-index">{i + 1}</span>}
            {cfg?.title && <span className="deck-btn-title">{cfg.title}</span>}
          </button>
        )
      })}
    </div>
  )
}

// ─── Properties Panel ───────────────────────────────────────

// Convert a browser KeyboardEvent to an xdotool key string, e.g. "ctrl+shift+a"
function toXdotoolKey(e) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null // modifier-only press
  const KEY_MAP = {
    ' ': 'space', Enter: 'Return', Escape: 'Escape', Tab: 'Tab',
    Backspace: 'BackSpace', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'Prior', PageDown: 'Next',
    ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
    F1:'F1', F2:'F2', F3:'F3',  F4:'F4',  F5:'F5',  F6:'F6',
    F7:'F7', F8:'F8', F9:'F9', F10:'F10', F11:'F11', F12:'F12',
  }
  const parts = []
  if (e.ctrlKey)  parts.push('ctrl')
  if (e.altKey)   parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  if (e.metaKey)  parts.push('super')
  const keyName = KEY_MAP[e.key] ?? (e.key.length === 1 ? e.key.toLowerCase() : null)
  if (!keyName) return null
  parts.push(keyName)
  return parts.join('+')
}

// ─── Hotkey Recorder ────────────────────────────────────────
function HotkeyEditor({ value, onChange }) {
  const [recording, setRecording] = useState(false)

  const startRecording = () => setRecording(true)

  const handleKeyDown = (e) => {
    if (!recording) return
    e.preventDefault()
    if (e.key === 'Escape') { setRecording(false); return }
    const combo = toXdotoolKey(e)
    if (combo) {
      onChange(combo)
      setRecording(false)
    }
  }

  return (
    <div className="hotkey-editor">
      <div
        className={`hotkey-recorder${recording ? ' recording' : ''}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onBlur={() => setRecording(false)}
        onClick={startRecording}
        role="button"
        aria-label="Record hotkey"
      >
        {recording
          ? <span className="hotkey-hint">Press a key combination…</span>
          : value
            ? <span className="hotkey-keys">{value}</span>
            : <span className="hotkey-hint">Click to record</span>
        }
      </div>
      {value && !recording && (
        <button className="hotkey-clear" onClick={() => onChange('')} title="Clear hotkey">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="10" height="10">
            <path d="M1 1l10 10M11 1L1 11" />
          </svg>
        </button>
      )}
    </div>
  )
}

// ─── Action Picker ───────────────────────────────────────────
const ACTION_TYPE_LABELS = {
  hotkey:   'Hotkey',
}

function ActionSection({ action, onChange }) {
  const [picking, setPicking] = useState(false)

  if (action?.type === 'hotkey') {
    return (
      <div className="assigned-action">
        <div className="action-chip">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
            <rect x="1" y="4" width="14" height="9" rx="1.5" />
            <path d="M4 7h1M7 7h1M10 7h1M4 10h8" strokeLinecap="round" />
          </svg>
          <span>Hotkey</span>
          <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <HotkeyEditor
          value={action.keys ?? ''}
          onChange={keys => onChange({ action: { type: 'hotkey', keys } })}
        />
      </div>
    )
  }

  return (
    <div className="unassigned-action">
      {picking ? (
        <div className="action-type-list">
          {ACTION_CATEGORIES.flatMap(cat => cat.actions).map(a => (
            <button
              key={a.id}
              className={`action-type-item${a.id !== 'hotkey' ? ' disabled' : ''}`}
              onClick={() => {
                if (a.id !== 'hotkey') return
                onChange({ action: { type: 'hotkey', keys: '' } })
                setPicking(false)
              }}
            >
              <span className="action-type-icon">{a.icon}</span>
              <span>{a.name}</span>
              {a.id !== 'hotkey' && <span className="action-type-soon">soon</span>}
            </button>
          ))}
        </div>
      ) : (
        <button className="prop-empty-action" onClick={() => setPicking(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="20">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
          </svg>
          <span>Assign an action</span>
        </button>
      )}
    </div>
  )
}

function PropertiesPanel({ keyIndex, onClose, config, onChange, iconSize }) {
  const fileInputRef = useRef(null)

  const handleIconSelect = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      onChange({ iconDataUrl: ev.target.result })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const removeIcon = () => onChange({ iconDataUrl: null })

  return (
    <aside className="properties-panel">
      <div className="properties-header">
        <span className="properties-title">Button {keyIndex + 1}</span>
        <button className="properties-close" onClick={onClose} aria-label="Close panel">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M1 1l10 10M11 1L1 11" />
          </svg>
        </button>
      </div>

      <div className="properties-body">
        <div className="prop-section">
          <span className="prop-label">Action</span>
          <ActionSection action={config?.action} onChange={onChange} />
        </div>

        <div className="prop-section">
          <span className="prop-label">Icon</span>
          <div className="icon-picker-area" onClick={() => fileInputRef.current?.click()}>
            {config?.iconDataUrl ? (
              <img src={config.iconDataUrl} className="icon-preview" alt="Button icon" />
            ) : (
              <div className="icon-picker-placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="24" height="24">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
                <span>Add image</span>
              </div>
            )}
          </div>
          {config?.iconDataUrl && (
            <button className="icon-remove-btn" onClick={removeIcon}>Remove image</button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleIconSelect}
          />
        </div>

        <div className="prop-section">
          <span className="prop-label">Title</span>
          <div className="prop-row">
            <input
              className="prop-input"
              type="text"
              placeholder="Button title…"
              value={config?.title ?? ''}
              onChange={e => onChange({ title: e.target.value })}
            />
          </div>
        </div>

        <div className="prop-section">
          <span className="prop-label">Style</span>
          <div className="prop-row">
            <label className="prop-field-label">Background colour</label>
            <div className="prop-color-row">
              <input
                type="color"
                className="prop-color"
                value={config?.bgColor ?? '#000000'}
                onChange={e => onChange({ bgColor: e.target.value })}
              />
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}

// ─── Context Menu ───────────────────────────────────────────
function ContextMenu({ x, y, keyIndex, onClear, onClose }) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    // Defer so the right-click event that opened the menu doesn't
    // immediately trigger the window listener and close it again
    let removeListeners = null
    const timer = setTimeout(() => {
      const handle = () => closeRef.current()
      window.addEventListener('mousedown', handle)
      window.addEventListener('contextmenu', handle)
      removeListeners = () => {
        window.removeEventListener('mousedown', handle)
        window.removeEventListener('contextmenu', handle)
      }
    }, 0)
    return () => {
      clearTimeout(timer)
      removeListeners?.()
    }
  }, []) // intentionally run once on mount

  return (
    <div
      className="context-menu"
      style={{ left: x, top: y }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}
    >
      <button className="context-menu-item danger" onClick={() => onClear(keyIndex)}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14">
          <path d="M3 4h10M6 4V2h4v2M5 4l.5 9h5L11 4" />
        </svg>
        Clear button
      </button>
    </div>
  )
}

// ─── App ────────────────────────────────────────────────────
export default function App() {
  const [device,        setDevice]        = useState(null)
  const [selectedKey,   setSelectedKey]   = useState(null)
  const [pressedKey,    setPressedKey]    = useState(null)
  const [sleeping,      setSleeping]      = useState(false)
  const [buttonConfigs, setButtonConfigs] = useState({})
  const [iconSize,      setIconSize]      = useState(72)
  const [contextMenu,   setContextMenu]   = useState(null)

  // Keep a ref so event handlers registered once can always see latest configs
  const buttonConfigsRef = useRef({})
  useEffect(() => { buttonConfigsRef.current = buttonConfigs }, [buttonConfigs])

  // Composite icon + title on canvas → send RGBA to hardware
  const drawHardwareButton = async (index, config) => {
    if (!window.streamDeck?.setButtonIcon || !iconSize) return
    const { iconDataUrl, title, bgColor } = config || {}

    if (!iconDataUrl && !title) {
      window.streamDeck.setButtonIcon(index, null)
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width  = iconSize
    canvas.height = iconSize
    const ctx = canvas.getContext('2d')

    if (iconDataUrl) {
      const img = new Image()
      await new Promise(res => { img.onload = res; img.src = iconDataUrl })
      ctx.drawImage(img, 0, 0, iconSize, iconSize)
    } else {
      ctx.fillStyle = bgColor || '#000000'
      ctx.fillRect(0, 0, iconSize, iconSize)
    }

    if (title) {
      ctx.font = `bold ${Math.round(iconSize * 0.15)}px -apple-system, sans-serif`
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'bottom'
      ctx.shadowColor = 'rgba(0,0,0,0.95)'
      ctx.shadowBlur = 5
      ctx.shadowOffsetY = 1
      ctx.fillText(title, iconSize / 2, iconSize - Math.round(iconSize * 0.04))
    }

    const { data } = ctx.getImageData(0, 0, iconSize, iconSize)
    window.streamDeck.setButtonIcon(index, Array.from(data))
  }

  const updateConfig = (index, updates) => {
    setButtonConfigs(prev => {
      const next = { title: '', iconDataUrl: null, bgColor: '#262626', ...prev[index], ...updates }
      drawHardwareButton(index, next)
      return { ...prev, [index]: next }
    })
  }

  const clearButton = (index) => {
    const next = { title: '', iconDataUrl: null, bgColor: '#262626' }
    drawHardwareButton(index, next)
    setButtonConfigs(prev => ({ ...prev, [index]: next }))
    setContextMenu(null)
  }

  // Load saved profile once on startup and redraw all hardware buttons
  useEffect(() => {
    if (!window.streamDeck?.loadProfile) return
    window.streamDeck.loadProfile().then(saved => {
      if (!saved?.buttons) return
      setButtonConfigs(saved.buttons)
      Object.entries(saved.buttons).forEach(([idx, cfg]) => {
        drawHardwareButton(Number(idx), cfg)
      })
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save whenever buttonConfigs changes (debounced 500ms)
  useEffect(() => {
    if (!window.streamDeck?.saveProfile) return
    const timer = setTimeout(() => {
      window.streamDeck.saveProfile({ name: 'Default Profile', buttons: buttonConfigs })
    }, 500)
    return () => clearTimeout(timer)
  }, [buttonConfigs])

  useEffect(() => {
    if (!window.streamDeck) return
    window.streamDeck.onInfo(info => {
      setDevice(info)
      if (info.iconSize) setIconSize(info.iconSize)
    })
    window.streamDeck.onKeyDown(({ index }) => {
      setPressedKey(index)
      const action = buttonConfigsRef.current[index]?.action
      if (action?.type === 'hotkey' && action.keys) {
        window.streamDeck.executeHotkey(action.keys)
      }
    })
    window.streamDeck.onKeyUp(({ index }) => {
      setPressedKey(p => p === index ? null : p)
      // Redraw the hardware button to restore the user's icon after the press-flash
      drawHardwareButton(index, buttonConfigsRef.current[index])
    })
    window.streamDeck.onSleep(() => setSleeping(true))
    window.streamDeck.onWake(()  => setSleeping(false))
  }, [])

  const rows        = device?.rows ?? 3
  const cols        = device?.cols ?? 5
  const deviceName  = device
    ? (DEVICE_MODEL_NAMES[device.model] ?? device.productName ?? device.model)
    : 'No device'

  const handleSelect = i => setSelectedKey(prev => prev === i ? null : i)

  return (
    <div className="app">
      {/* ── Topbar ── */}
      <header className="topbar">
        <div className="topbar-left">
          <ProfileDropdown profile="Default Profile" />
        </div>

        <div className="topbar-right">
          <span className="device-chip">
            {/* Tiny device icon */}
            <svg className="device-chip-icon" viewBox="0 0 20 12" fill="currentColor">
              <rect x="0" y="0" width="20" height="12" rx="2" />
              <rect x="2"  y="2" width="4" height="3.5" rx="0.5" fill="#111" />
              <rect x="8"  y="2" width="4" height="3.5" rx="0.5" fill="#111" />
              <rect x="14" y="2" width="4" height="3.5" rx="0.5" fill="#111" />
              <rect x="2"  y="7" width="4" height="3"   rx="0.5" fill="#111" />
              <rect x="8"  y="7" width="4" height="3"   rx="0.5" fill="#111" />
              <rect x="14" y="7" width="4" height="3"   rx="0.5" fill="#111" />
            </svg>
            <span>{deviceName}</span>
            <span className={`device-status-dot${device ? ' connected' : ''}`} />
          </span>

          <button className="icon-btn" title="Settings">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="2.5" />
              <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.27 1.27M11.33 11.33l1.27 1.27M3.4 12.6l1.27-1.27M11.33 4.67l1.27-1.27" />
            </svg>
          </button>
        </div>
      </header>

      {/* ── Workspace ── */}
      <div className="workspace">
        <ActionsPanel />

        <main className="device-area">
          {device ? (
            <>
              <div className={`device-frame${sleeping ? ' sleeping' : ''}`}>
                {sleeping && (
                  <div className="sleep-overlay">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
                    </svg>
                    <span>Press any button to wake</span>
                  </div>
                )}
                <ButtonGrid
                  rows={rows}
                  cols={cols}
                  selectedKey={selectedKey}
                  pressedKey={pressedKey}
                  onSelectKey={handleSelect}
                  buttonConfigs={buttonConfigs}
                  onContextMenu={(e, i) => setContextMenu({ x: e.clientX, y: e.clientY, keyIndex: i })}
                />
              </div>

              <div className="page-controls">
                <button className="page-btn" disabled aria-label="Previous page">
                  <svg viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M5 1L1 5l4 4" />
                  </svg>
                </button>
                <span className="page-indicator">Page 1 / 1</span>
                <button className="page-btn" disabled aria-label="Next page">
                  <svg viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M1 1l4 4-4 4" />
                  </svg>
                </button>
              </div>
            </>
          ) : (
            <div className="no-device">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" width="52" height="52">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <rect x="4"  y="7.5" width="3.5" height="3.5" rx="0.5" />
                <rect x="10" y="7.5" width="3.5" height="3.5" rx="0.5" />
                <rect x="16" y="7.5" width="3.5" height="3.5" rx="0.5" />
                <rect x="4"  y="13" width="3.5" height="3.5" rx="0.5" />
                <rect x="10" y="13" width="3.5" height="3.5" rx="0.5" />
                <rect x="16" y="13" width="3.5" height="3.5" rx="0.5" />
              </svg>
              <p>No Stream Deck connected</p>
            </div>
          )}
        </main>

        {selectedKey !== null && (
          <PropertiesPanel
            keyIndex={selectedKey}
            onClose={() => setSelectedKey(null)}
            config={buttonConfigs[selectedKey]}
            onChange={updates => updateConfig(selectedKey, updates)}
            iconSize={iconSize}
          />
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          keyIndex={contextMenu.keyIndex}
          onClear={clearButton}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

