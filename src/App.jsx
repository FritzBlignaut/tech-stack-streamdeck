import { useState, useEffect, useRef } from 'react'
import { parseGIF, decompressFrames } from 'gifuct-js'
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

// ─── GIF frame extractor (module-level, no React) ──────────
// Returns [{ rgbaData: number[], delay: number }] or null if not an animated GIF
async function extractGifFrames(dataUrl, iconSize, title) {
  try {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const binary = atob(base64)
    const bytes  = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    const gif    = parseGIF(bytes.buffer)
    const frames = decompressFrames(gif, true)
    if (frames.length < 2) return null   // single frame — no animation needed

    const gw = gif.lsd.width
    const gh = gif.lsd.height

    // Native-size composite canvas
    const native    = document.createElement('canvas')
    native.width    = gw
    native.height   = gh
    const nativeCtx = native.getContext('2d')

    // Output canvas scaled to iconSize
    const out    = document.createElement('canvas')
    out.width    = iconSize
    out.height   = iconSize
    const outCtx = out.getContext('2d')

    // Scratch canvas for patching
    const patch    = document.createElement('canvas')
    const patchCtx = patch.getContext('2d')

    const result = []
    let prevSnap = null

    for (const frame of frames) {
      const { dims, patch: px, delay, disposalType } = frame

      if (disposalType === 3) prevSnap = nativeCtx.getImageData(0, 0, gw, gh)

      patch.width  = dims.width
      patch.height = dims.height
      patchCtx.putImageData(new ImageData(new Uint8ClampedArray(px), dims.width, dims.height), 0, 0)
      nativeCtx.drawImage(patch, dims.left, dims.top)

      outCtx.clearRect(0, 0, iconSize, iconSize)
      outCtx.drawImage(native, 0, 0, iconSize, iconSize)

      if (title) {
        const fs = Math.round(iconSize * 0.15)
        outCtx.font          = `bold ${fs}px -apple-system, sans-serif`
        outCtx.fillStyle     = '#ffffff'
        outCtx.textAlign     = 'center'
        outCtx.textBaseline  = 'bottom'
        outCtx.shadowColor   = 'rgba(0,0,0,0.95)'
        outCtx.shadowBlur    = 5
        outCtx.shadowOffsetY = 1
        outCtx.fillText(title, iconSize / 2, iconSize - Math.round(iconSize * 0.04))
        outCtx.shadowColor   = 'transparent'
        outCtx.shadowBlur    = 0
        outCtx.shadowOffsetY = 0
      }

      result.push({
        rgbaData: Array.from(outCtx.getImageData(0, 0, iconSize, iconSize).data),
        delay:    Math.max((delay || 10) * 10, 50),   // centiseconds → ms, min 50ms
      })

      if (disposalType === 2) {
        nativeCtx.clearRect(dims.left, dims.top, dims.width, dims.height)
      } else if (disposalType === 3 && prevSnap) {
        nativeCtx.putImageData(prevSnap, 0, 0)
        prevSnap = null
      }
    }
    return result
  } catch (e) {
    console.error('GIF decode error:', e)
    return null
  }
}

// ─── Folder navigation helpers (pure, module-level) ─────────
// Return the buttons object at the given folder path within pages
function getButtonsAt(pages, pageIndex, folderPath) {
  let buttons = pages[pageIndex] ?? {}
  for (const idx of folderPath) {
    buttons = buttons[idx]?.action?.buttons ?? {}
  }
  return buttons
}

// Deep-immutable update of a single button inside pages.
// config === null removes the button; otherwise it sets it.
function immutableSetButton(pages, pageIndex, folderPath, buttonIndex, config) {
  const newPages = [...pages]
  function update(buttons, path) {
    if (path.length === 0) {
      if (config === null) {
        const { [buttonIndex]: _gone, ...rest } = buttons
        return rest
      }
      return { ...buttons, [buttonIndex]: config }
    }
    const [head, ...tail] = path
    const btn = buttons[head] ?? {}
    const inner = update(btn.action?.buttons ?? {}, tail)
    return { ...buttons, [head]: { ...btn, action: { ...btn.action, type: 'folder', buttons: inner } } }
  }
  newPages[pageIndex] = update(newPages[pageIndex] ?? {}, folderPath)
  return newPages
}

const ACTION_CATEGORIES = [
  {
    id: 'streamdeck',
    name: 'Stream Deck',
    actions: [
      { id: 'sleep-toggle',   name: 'Sleep',           icon: '☽' },
      { id: 'switch-profile', name: 'Switch Profile',  icon: '⇄' },
      { id: 'page-switcher',  name: 'Page',            icon: '⊞' },
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

// ─── Profile Switcher ────────────────────────────────────────
function ProfileSwitcher({ activeProfile, profiles, onSwitch, onCreate, onDelete }) {
  const [open,       setOpen]       = useState(false)
  const [creatingNew, setCreatingNew] = useState(false)
  const [newName,    setNewName]    = useState('')
  const containerRef = useRef(null)

  // Close dropdown on outside mousedown
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false); setCreatingNew(false); setNewName('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleCreate = () => {
    const name = newName.trim()
    if (!name) return
    onCreate(name)
    setCreatingNew(false); setNewName(''); setOpen(false)
  }

  return (
    <div className={`profile-dropdown${open ? ' open' : ''}`} ref={containerRef}>
      <button className="profile-btn" onClick={() => setOpen(o => !o)}>
        <svg className="profile-grid-icon" viewBox="0 0 14 14" fill="currentColor">
          <rect x="0" y="0" width="5.5" height="5.5" rx="1" />
          <rect x="8.5" y="0" width="5.5" height="5.5" rx="1" />
          <rect x="0" y="8.5" width="5.5" height="5.5" rx="1" />
          <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" />
        </svg>
        <span className="profile-name">{activeProfile}</span>
        <svg className="profile-chevron" viewBox="0 0 10 6" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M1 1l4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="profile-menu">
          {profiles.map(name => (
            <div key={name} className={`profile-menu-row${name === activeProfile ? ' active' : ''}`}>
              <button
                className="profile-menu-item-name"
                onClick={() => { onSwitch(name); setOpen(false) }}
              >
                <span>{name}</span>
                {name === activeProfile && (
                  <svg viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="2" width="11">
                    <polyline points="1,5 4.5,9 11,1" />
                  </svg>
                )}
              </button>
              {name !== activeProfile && (
                <button
                  className="profile-menu-item-delete"
                  title={`Delete "${name}"`}
                  onClick={() => onDelete(name)}
                >
                  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
                    <path d="M1 1l10 10M11 1L1 11" />
                  </svg>
                </button>
              )}
            </div>
          ))}

          <div className="profile-menu-divider" />

          {creatingNew ? (
            <div className="profile-new-form">
              <input
                className="profile-new-input"
                placeholder="Profile name"
                value={newName}
                maxLength={60}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreate()
                  if (e.key === 'Escape') { setCreatingNew(false); setNewName('') }
                }}
                autoFocus
              />
              <button
                className="profile-new-confirm"
                onClick={handleCreate}
                disabled={!newName.trim()}
                title="Create profile"
              >
                <svg viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="2.5" width="11">
                  <polyline points="1,5 4.5,9 11,1" />
                </svg>
              </button>
            </div>
          ) : (
            <button className="profile-menu-item" onClick={() => setCreatingNew(true)}>
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10">
                <path d="M6 1v10M1 6h10" strokeLinecap="round" />
              </svg>
              New Profile
            </button>
          )}
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
                {cat.actions.map(action => {
                  const enabled = ENABLED_ACTIONS.has(action.id)
                  return (
                    <div
                      key={action.id}
                      className={`action-item${enabled ? '' : ' disabled'}`}
                      draggable={enabled}
                      onDragStart={e => {
                        e.dataTransfer.setData('application/stream-deck-action', action.id)
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                    >
                      <div className="action-icon">{action.icon}</div>
                      <span className="action-name">{action.name}</span>
                      {!enabled && <span className="action-soon-badge">soon</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </aside>
  )
}

// ─── Button Grid ────────────────────────────────────────────
function ButtonGrid({ rows, cols, selectedKey, pressedKey, onSelectKey, buttonConfigs, onContextMenu, onDropAction }) {
  const [dragOverIndex, setDragOverIndex] = useState(null)

  return (
    <div className="button-grid" style={{ '--cols': cols }}>
      {Array.from({ length: rows * cols }, (_, i) => {
        const cfg = buttonConfigs?.[i]
        return (
          <button
            key={i}
            className={[
              'deck-btn',
              selectedKey  === i ? 'selected'  : '',
              pressedKey   === i ? 'pressed'   : '',
              dragOverIndex === i ? 'drag-over' : '',
              cfg?.iconDataUrl              ? 'has-icon'  : '',
              cfg?.action?.type === 'folder' ? 'is-folder'  : '',
            ].join(' ').trim()}
            style={{
              backgroundImage: cfg?.iconDataUrl ? `url(${cfg.iconDataUrl})` : 'none',
              backgroundColor: cfg?.iconDataUrl ? 'transparent' : (cfg?.bgColor ?? '#262626'),
            }}
            onClick={() => onSelectKey(i)}
            onContextMenu={e => { e.preventDefault(); onContextMenu(e, i) }}
            onDragOver={e => {
              if (!e.dataTransfer.types.includes('application/stream-deck-action')) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              setDragOverIndex(i)
            }}
            onDragLeave={e => {
              if (e.currentTarget.contains(e.relatedTarget)) return
              setDragOverIndex(null)
            }}
            onDrop={e => {
              e.preventDefault()
              setDragOverIndex(null)
              const actionId = e.dataTransfer.getData('application/stream-deck-action')
              if (actionId) onDropAction?.(i, actionId)
            }}
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

// ─── Icon Library Modal ─────────────────────────────────────
function IconLibraryModal({ onSelect, onClose }) {
  const [icons, setIcons]           = useState([])
  const [query, setQuery]           = useState('')
  const [category, setCategory]     = useState('all')
  const [loading, setLoading]       = useState(false)
  const [libraryPath, setLibraryPath] = useState(() => localStorage.getItem('iconLibraryPath') ?? '')

  useEffect(() => {
    if (libraryPath) scan(libraryPath)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const scan = async (dirPath) => {
    setLoading(true)
    const result = await window.streamDeck?.scanIconDir(dirPath)
    setLoading(false)
    if (result?.icons) setIcons(result.icons)
  }

  const browse = async () => {
    const dir = await window.streamDeck?.browseIconDir()
    if (!dir) return
    localStorage.setItem('iconLibraryPath', dir)
    setLibraryPath(dir)
    scan(dir)
  }

  const handleSelect = async (icon) => {
    const result = await window.streamDeck?.loadIconFile(icon.path)
    if (result?.dataUrl) onSelect(result.dataUrl)
  }

  const categories = ['all', ...new Set(icons.map(i => i.category).filter(Boolean))]
  const filtered = icons.filter(icon => {
    const q = query.toLowerCase()
    return (!q || icon.name.toLowerCase().includes(q)) &&
           (category === 'all' || icon.category === category)
  })

  return (
    <div className="icon-lib-overlay" onMouseDown={onClose}>
      <div className="icon-lib-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="icon-lib-header">
          <div className="icon-lib-title-row">
            <span className="icon-lib-title">Icon Library</span>
            <button className="icon-lib-folder-btn" onClick={browse}>
              {libraryPath ? 'Change folder' : 'Choose folder'}
            </button>
            <button className="icon-lib-close" onClick={onClose} aria-label="Close">
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="10" height="10">
                <path d="M1 1l10 10M11 1L1 11" />
              </svg>
            </button>
          </div>
          {icons.length > 0 && (
            <input
              className="icon-lib-search"
              type="text"
              placeholder={`Search ${icons.length} icons…`}
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
          )}
          {categories.length > 1 && (
            <div className="icon-lib-cats">
              {categories.slice(0, 24).map(cat => (
                <button
                  key={cat}
                  className={`icon-lib-cat${category === cat ? ' active' : ''}`}
                  onClick={() => setCategory(cat)}
                >
                  {cat === 'all' ? 'All' : cat}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="icon-lib-body">
          {loading && <div className="icon-lib-status">Scanning folder…</div>}

          {!loading && !libraryPath && (
            <div className="icon-lib-empty">
              <svg viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48" opacity="0.3">
                <path d="M6 12A3 3 0 0 1 9 9h10l4 5h16a3 3 0 0 1 3 3v20a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V12z" />
              </svg>
              <p>No folder selected</p>
              <p className="icon-lib-hint">
                Extract an icon pack and point here to the folder.<br />
                Works with any PNG, JPG, SVG or GIF files.
              </p>
              <button className="icon-lib-choose-btn" onClick={browse}>Choose folder</button>
            </div>
          )}

          {!loading && libraryPath && icons.length === 0 && (
            <div className="icon-lib-status">No image files found in this folder.</div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="icon-lib-grid">
              {filtered.map((icon, i) => (
                <button
                  key={i}
                  className="lib-icon-item"
                  title={icon.name}
                  onClick={() => handleSelect(icon)}
                >
                  <img
                    loading="lazy"
                    src={`iconlib://${encodeURIComponent(icon.path)}`}
                    className="lib-icon-thumb"
                    alt={icon.name}
                    draggable={false}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
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

// ─── Open App Editor ────────────────────────────────────────
function OpenAppEditor({ target, mode, onChange }) {
  const browseFile = async () => {
    const file = await window.streamDeck?.browseForFile()
    if (file) onChange({ target: file })
  }

  return (
    <div className="open-app-editor">
      <div className="open-app-input-row">
        <input
          className="prop-input"
          type="text"
          placeholder={
            mode === 'gtk-launch' ? 'e.g. com.obsproject.Studio  or  firefox' :
            mode === 'xdg-open'   ? 'e.g. https://example.com  or  a file path' :
                                    'e.g. /usr/bin/code  or  flatpak run com.X'
          }
          value={target ?? ''}
          onChange={e => onChange({ target: e.target.value })}
        />
        <button className="browse-btn" onClick={browseFile} title="Browse for application">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14">
            <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 2H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3.5A1.5 1.5 0 0 1 2 11.5v-7z" />
          </svg>
        </button>
      </div>
      <div className="open-app-modes">
        {[
          { value: 'gtk-launch', label: 'App ID',     hint: 'Recommended — works for Flatpak & native' },
          { value: 'xdg-open',   label: 'xdg-open',   hint: 'Open files / URLs with default handler' },
          { value: 'direct',     label: 'Command',     hint: 'Run a binary or shell command directly' },
        ].map(opt => (
          <label key={opt.value} className={`open-app-mode-option${mode === opt.value ? ' active' : ''}`}>
            <input
              type="radio"
              name="open-app-mode"
              value={opt.value}
              checked={mode === opt.value}
              onChange={() => onChange({ mode: opt.value })}
            />
            <span className="open-app-mode-label">{opt.label}</span>
            {mode === opt.value && <span className="open-app-mode-hint">{opt.hint}</span>}
          </label>
        ))}
      </div>
    </div>
  )
}

// ─── Sub-Action Row ─────────────────────────────────────────
function SubActionRow({ subAction, onChange, onRemove }) {
  const label = SUB_ACTION_TYPES.find(t => t.id === subAction.type)?.name ?? subAction.type
  return (
    <div className="sub-action-row">
      <div className="sub-action-header">
        <span className="sub-action-label">{label}</span>
        <button className="sub-action-remove" onClick={onRemove} title="Remove">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
            <path d="M1 1l10 10M11 1L1 11" />
          </svg>
        </button>
      </div>
      <div className="sub-action-body">
        {subAction.type === 'hotkey' && (
          <HotkeyEditor
            value={subAction.keys ?? ''}
            onChange={keys => onChange({ ...subAction, keys })}
          />
        )}
        {subAction.type === 'open-app' && (
          <OpenAppEditor
            target={subAction.target ?? ''}
            mode={subAction.mode ?? 'gtk-launch'}
            onChange={updates => onChange({ ...subAction, ...updates })}
          />
        )}
        {subAction.type === 'open-url' && (
          <input
            className="prop-input"
            type="url"
            placeholder="https://example.com"
            value={subAction.url ?? ''}
            onChange={e => onChange({ ...subAction, url: e.target.value })}
          />
        )}
        {subAction.type === 'run-cmd' && (
          <textarea
            className="prop-input run-cmd-input"
            placeholder="bash command…"
            value={subAction.command ?? ''}
            onChange={e => onChange({ ...subAction, command: e.target.value })}
            rows={2}
            spellCheck={false}
          />
        )}
        {subAction.type === 'delay' && (
          <div className="delay-input-row">
            <input
              className="prop-input"
              type="number"
              min="0"
              max="60000"
              step="100"
              value={subAction.ms ?? 500}
              onChange={e => onChange({ ...subAction, ms: Math.max(0, Number(e.target.value)) })}
            />
            <span className="delay-unit">ms</span>
          </div>
        )}
        {subAction.type === 'sleep-toggle' && (
          <p className="action-hint">Puts the deck to sleep.</p>
        )}
      </div>
    </div>
  )
}

// ─── Multi Action Editor ─────────────────────────────────────
function MultiActionEditor({ actions, onChange }) {
  const [addingNew, setAddingNew] = useState(false)

  const addSubAction = (type) => {
    onChange([...actions, { ...SUB_ACTION_DEFAULTS[type] }])
    setAddingNew(false)
  }

  const updateAt = (i, updated) => {
    const next = [...actions]; next[i] = updated; onChange(next)
  }

  const removeAt = (i) => onChange(actions.filter((_, idx) => idx !== i))

  return (
    <div className="multi-action-editor">
      {actions.length === 0 && !addingNew && (
        <p className="action-hint">No steps yet — add one below.</p>
      )}

      {actions.map((sub, i) => (
        <SubActionRow
          key={i}
          subAction={sub}
          onChange={updated => updateAt(i, updated)}
          onRemove={() => removeAt(i)}
        />
      ))}

      {addingNew ? (
        <div className="sub-action-type-picker">
          {SUB_ACTION_TYPES.map(t => (
            <button key={t.id} className="sub-action-type-item" onClick={() => addSubAction(t.id)}>
              <span className="sub-action-type-icon">{t.icon}</span>
              <span>{t.name}</span>
            </button>
          ))}
          <button className="sub-action-cancel" onClick={() => setAddingNew(false)}>Cancel</button>
        </div>
      ) : (
        <button className="multi-action-add-btn" onClick={() => setAddingNew(true)}>
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10">
            <path d="M6 1v10M1 6h10" strokeLinecap="round" />
          </svg>
          Add step
        </button>
      )}
    </div>
  )
}

// ─── Action Picker ───────────────────────────────────────────
const ENABLED_ACTIONS = new Set(['hotkey', 'open-app', 'open-url', 'run-cmd', 'sleep-toggle', 'multi-action', 'switch-profile', 'page-switcher', 'create-folder', 'back-folder'])

// Sub-action types available inside a Multi Action (no nesting)
const SUB_ACTION_TYPES = [
  { id: 'hotkey',       name: 'Hotkey',           icon: '⌫' },
  { id: 'open-app',     name: 'Open Application', icon: '⎈' },
  { id: 'open-url',     name: 'Open URL',         icon: '⊕' },
  { id: 'run-cmd',      name: 'Run Command',      icon: '›_' },
  { id: 'sleep-toggle', name: 'Sleep',            icon: '☽' },
  { id: 'delay',        name: 'Delay',            icon: '⏱' },
]

const SUB_ACTION_DEFAULTS = {
  'hotkey':       { type: 'hotkey',       keys: '' },
  'open-app':     { type: 'open-app',     target: '', mode: 'gtk-launch' },
  'open-url':     { type: 'open-url',     url: '' },
  'run-cmd':      { type: 'run-cmd',      command: '' },
  'sleep-toggle': { type: 'sleep-toggle' },
  'delay':        { type: 'delay',        ms: 500 },
}

// Default configs for top-level button actions (used by drag-and-drop and the picker)
const ACTION_DEFAULTS = {
  'hotkey':         { type: 'hotkey',         keys: '' },
  'open-app':       { type: 'open-app',       target: '', mode: 'gtk-launch' },
  'open-url':       { type: 'open-url',       url: '' },
  'run-cmd':        { type: 'run-cmd',        command: '' },
  'sleep-toggle':   { type: 'sleep-toggle' },
  'multi-action':   { type: 'multi-action',   actions: [] },
  'switch-profile': { type: 'switch-profile', profileName: '' },
  'page-switcher':  { type: 'page-switcher',  targetPage: 0 },
  'create-folder':  { type: 'folder',          buttons: {} },
  'back-folder':    { type: 'back-folder' },
}

// Dispatches a single leaf action — returns a Promise
function dispatchSubAction(sd, act) {
  if (!act || !sd) return Promise.resolve()
  if (act.type === 'hotkey'       && act.keys)    return sd.executeHotkey(act.keys)
  if (act.type === 'open-app'     && act.target)  return sd.openApplication(act.target, act.mode ?? 'gtk-launch')
  if (act.type === 'open-url'     && act.url)     return sd.openUrl(act.url)
  if (act.type === 'run-cmd'      && act.command) return sd.runCommand(act.command)
  if (act.type === 'sleep-toggle')                return sd.sleepToggle()
  if (act.type === 'delay')                       return new Promise(r => setTimeout(r, act.ms ?? 500))
  return Promise.resolve()
}

function ActionSection({ action, onChange, profiles = [], pageCount = 1, onEnterFolder }) {
  const [picking, setPicking] = useState(false)

  // ── assigned: folder ──
  if (action?.type === 'folder') {
    return (
      <div className="assigned-action">
        <div className="action-chip">
          <svg viewBox="0 0 20 16" fill="currentColor" width="13" height="11">
            <path d="M8.5 0H2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H10.5L8.5 0z" />
          </svg>
          <span>Folder</span>
          <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <p className="action-hint">Press the button on hardware to enter the folder. In the editor, use the button below or click the button in the grid.</p>
        {onEnterFolder && (
          <button className="enter-folder-btn" onClick={onEnterFolder}>
            <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" width="12" height="12">
              <path d="M1 7h10M7 3l4 4-4 4" strokeLinecap="round" />
            </svg>
            Open Folder
          </button>
        )}
      </div>
    )
  }

  // ── assigned: back-folder ──
  if (action?.type === 'back-folder') {
    return (
      <div className="assigned-action">
        <div className="action-chip">
          <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" width="13" height="13">
            <path d="M9 2L3 6l6 4" />
          </svg>
          <span>Back</span>
          <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <p className="action-hint">Returns to the parent folder or page when pressed.</p>
      </div>
    )
  }
  if (action?.type === 'sleep-toggle') {
    return (
      <div className="assigned-action">
        <div className="action-chip">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
            <path d="M12.5 10A6 6 0 0 1 6 3.5a6 6 0 0 0 0 9 6 6 0 0 0 6.5-2.5z" />
          </svg>
          <span>Sleep</span>
          <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <p className="action-hint">Puts the deck to sleep. Any button press wakes it.</p>
      </div>
    )
  }

  // ── assigned: run-cmd ──
  if (action?.type === 'run-cmd') {
    return (
      <div className="assigned-action">
        <div className="action-chip">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
            <rect x="1" y="3" width="14" height="10" rx="1.5" />
            <path d="M4 7l2.5 2L4 11" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 11h3" strokeLinecap="round" />
          </svg>
          <span>Run Command</span>
          <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <textarea
          className="prop-input run-cmd-input"
          placeholder={`e.g. mkdir -p ~/Pictures/Screenshots && gnome-screenshot -f ~/Pictures/Screenshots/$(date +%Y%m%d_%H%M%S).png`}
          value={action.command ?? ''}
          onChange={e => onChange({ action: { type: 'run-cmd', command: e.target.value } })}
          rows={3}
          spellCheck={false}
        />
      </div>
    )
  }

  // ── assigned: open-url ──
  if (action?.type === 'open-url') {
    return (
      <div className="assigned-action">
        <div className="action-chip">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
            <circle cx="8" cy="8" r="6" />
            <path d="M2 8h12M8 2c-2 2-3 4-3 6s1 4 3 6M8 2c2 2 3 4 3 6s-1 4-3 6" />
          </svg>
          <span>Open URL</span>
          <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <input
          className="prop-input"
          type="url"
          placeholder="https://example.com"
          value={action.url ?? ''}
          onChange={e => onChange({ action: { type: 'open-url', url: e.target.value } })}
        />
      </div>
    )
  }

  // ── assigned: hotkey ──
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

  // ── assigned: open-app ──
  if (action?.type === 'open-app') {
    return (
      <div className="assigned-action">
        <div className="action-chip">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <path d="M5 7l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Open Application</span>
          <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <OpenAppEditor
          target={action.target ?? ''}
          mode={action.mode ?? 'xdg-open'}
          onChange={updates => onChange({ action: { type: 'open-app', ...action, ...updates } })}
        />
      </div>
    )
  }

  // ── assigned: page-switcher ──
  if (action?.type === 'page-switcher') {
    return (
      <div className="assigned-action">
        <div className="action-chip">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
            <rect x="2" y="2" width="5" height="5" rx="1" />
            <rect x="9" y="2" width="5" height="5" rx="1" />
            <rect x="2" y="9" width="5" height="5" rx="1" />
            <rect x="9" y="9" width="5" height="5" rx="1" />
          </svg>
          <span>Page Switcher</span>
          <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <span className="prop-label-sm">Target page</span>
        <select
          className="prop-input"
          value={action.targetPage ?? 0}
          onChange={e => onChange({ action: { type: 'page-switcher', targetPage: Number(e.target.value) } })}
        >
          {Array.from({ length: pageCount }, (_, i) => (
            <option key={i} value={i}>Page {i + 1}</option>
          ))}
        </select>
      </div>
    )
  }

  // ── assigned: switch-profile ──
  if (action?.type === 'switch-profile') {
    return (
      <div className="assigned-action">
        <div className="action-chip">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
            <path d="M3 8h8M7.5 5l3.5 3-3.5 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Switch Profile</span>
          <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <span className="prop-label-sm">Target profile</span>
        <select
          className="prop-input"
          value={action.profileName ?? ''}
          onChange={e => onChange({ action: { type: 'switch-profile', profileName: e.target.value } })}
        >
          <option value="">— pick a profile —</option>
          {profiles.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        {!action.profileName && (
          <p className="action-hint">Select the profile to switch to when this button is pressed.</p>
        )}
      </div>
    )
  }

  // ── assigned: multi-action ──
  if (action?.type === 'multi-action') {
    return (
      <div className="assigned-action">
        <div className="action-chip">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
            <path d="M3 5l4 3-4 3V5z" fill="currentColor" stroke="none" />
            <path d="M9 5l4 3-4 3V5z" fill="currentColor" stroke="none" />
          </svg>
          <span>Multi Action</span>
          <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <MultiActionEditor
          actions={action.actions ?? []}
          onChange={actions => onChange({ action: { type: 'multi-action', actions } })}
        />
      </div>
    )
  }

  // ── unassigned ──
  return (
    <div className="unassigned-action">
      {picking ? (
        <div className="action-type-list">
          {ACTION_CATEGORIES.flatMap(cat => cat.actions).map(a => (
            <button
              key={a.id}
              className={`action-type-item${!ENABLED_ACTIONS.has(a.id) ? ' disabled' : ''}`}
              onClick={() => {
                if (!ENABLED_ACTIONS.has(a.id)) return
                const defaults = a.id === 'hotkey'
                  ? { type: 'hotkey', keys: '' }
                  : a.id === 'sleep-toggle'
                  ? { type: 'sleep-toggle' }
                  : a.id === 'open-url'
                  ? { type: 'open-url', url: '' }
                  : a.id === 'run-cmd'
                  ? { type: 'run-cmd', command: '' }
                  : a.id === 'multi-action'
                  ? { type: 'multi-action', actions: [] }
                  : a.id === 'switch-profile'
                  ? { type: 'switch-profile', profileName: '' }
                  : a.id === 'page-switcher'
                  ? { type: 'page-switcher', targetPage: 0 }
                  : a.id === 'create-folder'
                  ? { type: 'folder', buttons: {} }
                  : a.id === 'back-folder'
                  ? { type: 'back-folder' }
                  : { type: 'open-app', target: '', mode: 'gtk-launch' }
                onChange({ action: defaults })
                setPicking(false)
              }}
            >
              <span className="action-type-icon">{a.icon}</span>
              <span>{a.name}</span>
              {!ENABLED_ACTIONS.has(a.id) && <span className="action-type-soon">soon</span>}
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

function PropertiesPanel({ keyIndex, onClose, config, onChange, iconSize, profiles, pageCount, onEnterFolder }) {
  const fileInputRef = useRef(null)
  const [showLibrary, setShowLibrary] = useState(false)

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
          <ActionSection action={config?.action} onChange={onChange} profiles={profiles} pageCount={pageCount} onEnterFolder={onEnterFolder} />
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
          <div className="icon-action-row">
            <button className="icon-lib-open-btn" onClick={() => setShowLibrary(true)}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
                <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 2H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3.5A1.5 1.5 0 0 1 2 11.5v-7z" />
              </svg>
              Icon Library
            </button>
            {config?.iconDataUrl && (
              <button className="icon-remove-btn" onClick={removeIcon}>Remove</button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleIconSelect}
          />
          {showLibrary && (
            <IconLibraryModal
              onSelect={dataUrl => { onChange({ iconDataUrl: dataUrl }); setShowLibrary(false) }}
              onClose={() => setShowLibrary(false)}
            />
          )}
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
function ContextMenu({ x, y, keyIndex, onClear, onCopy, onPaste, hasClipboard, hasContent, onClose }) {
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
      <button
        className="context-menu-item"
        disabled={!hasContent}
        onClick={() => { onCopy(keyIndex); onClose() }}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14">
          <rect x="5" y="5" width="8" height="9" rx="1.5" />
          <path d="M3 11V3a1 1 0 0 1 1-1h8" strokeLinecap="round" />
        </svg>
        Copy
      </button>
      <button
        className="context-menu-item"
        disabled={!hasClipboard}
        onClick={() => { onPaste(keyIndex); onClose() }}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14">
          <rect x="3" y="5" width="10" height="9" rx="1.5" />
          <path d="M6 5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1" strokeLinecap="round" />
        </svg>
        Paste
      </button>
      <div className="context-menu-divider" />
      <button className="context-menu-item danger" onClick={() => { onClear(keyIndex); onClose() }}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="14" height="14">
          <path d="M3 4h10M6 4V2h4v2M5 4l.5 9h5L11 4" />
        </svg>
        Clear
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
  const [pages,         setPages]         = useState([{}])   // array of page button-config objects
  const [currentPage,   setCurrentPage]   = useState(0)
  const [folderPath,    setFolderPath]    = useState([])     // indices into nested folders
  const [iconSize,      setIconSize]      = useState(72)
  const [contextMenu,   setContextMenu]   = useState(null)
  const [clipboard,     setClipboard]     = useState(null)
  const [activeProfile, setActiveProfile] = useState('Default Profile')
  const [profiles,      setProfiles]      = useState(['Default Profile'])

  // Visible button configs — current page at current folder depth (derived)
  const buttonConfigs = getButtonsAt(pages, currentPage, folderPath)

  // Keep refs so event handlers registered once always see latest values
  const buttonConfigsRef = useRef({})
  const pagesRef         = useRef([{}])
  const currentPageRef   = useRef(0)
  const folderPathRef    = useRef([])
  const deviceRef        = useRef(null)
  useEffect(() => { buttonConfigsRef.current = buttonConfigs },          [buttonConfigs])
  useEffect(() => { pagesRef.current = pages },                          [pages])
  useEffect(() => { currentPageRef.current = currentPage },              [currentPage])
  useEffect(() => { folderPathRef.current = folderPath },                [folderPath])
  useEffect(() => { deviceRef.current = device },                        [device])

  // Composite icon + title on canvas → send RGBA to hardware
  const drawHardwareButton = async (index, config) => {
    if (!window.streamDeck?.setButtonIcon || !iconSize) return
    stopGifAnimation(index)                              // always cancel existing animation
    const { iconDataUrl, title, bgColor } = config || {}

    if (!iconDataUrl && !title) {
      window.streamDeck.setButtonIcon(index, null)
      return
    }

    // Animated GIF → hand off to the animation loop
    if (iconDataUrl?.startsWith('data:image/gif')) {
      startGifAnimation(index, config)
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

  // Ref always points to the latest drawHardwareButton (captures current iconSize)
  const drawHardwareButtonRef = useRef(null)
  drawHardwareButtonRef.current = drawHardwareButton

  // ── GIF animation manager ──────────────────────────────────
  // gifAnimationsRef: { [buttonIndex]: { token: object, timer: number|null } }
  const gifAnimationsRef = useRef({})

  const stopGifAnimation = (index) => {
    const anim = gifAnimationsRef.current[index]
    if (anim) {
      if (anim.timer != null) clearTimeout(anim.timer)
      delete gifAnimationsRef.current[index]
    }
  }

  const stopAllGifAnimations = () => {
    for (const anim of Object.values(gifAnimationsRef.current)) {
      if (anim?.timer != null) clearTimeout(anim.timer)
    }
    gifAnimationsRef.current = {}
  }
  const stopAllGifAnimationsRef = useRef(null)
  stopAllGifAnimationsRef.current = stopAllGifAnimations

  const startGifAnimation = async (index, config) => {
    const token = {}
    gifAnimationsRef.current[index] = { token, timer: null }

    const frames = await extractGifFrames(config.iconDataUrl, iconSize, config.title ?? '')
    // Bail if animation was stopped or replaced while decoding
    if (gifAnimationsRef.current[index]?.token !== token) return
    if (!frames?.length) { delete gifAnimationsRef.current[index]; return }

    let frameIdx = 0
    const tick = () => {
      if (gifAnimationsRef.current[index]?.token !== token) return
      const frame = frames[frameIdx]
      window.streamDeck?.setButtonIcon(index, frame.rgbaData)
      frameIdx = (frameIdx + 1) % frames.length
      gifAnimationsRef.current[index].timer = setTimeout(tick, frame.delay)
    }
    tick()
  }

  // Helper: load a named profile, update all state, redraw hardware
  const loadProfileData = async (name) => {
    const result = await window.streamDeck?.switchProfile(name)
    if (!result?.ok) return false
    const data        = result.data
    const loadedPages = data?.pages ?? (data?.buttons ? [data.buttons] : [{}])
    const page0       = loadedPages[0] ?? {}
    setActiveProfile(name)
    setPages(loadedPages)
    setCurrentPage(0)
    setFolderPath([])
    setSelectedKey(null)
    const rows  = deviceRef.current?.rows ?? 3
    const cols  = deviceRef.current?.cols ?? 5
    const total = rows * cols
    for (let i = 0; i < total; i++) {
      drawHardwareButtonRef.current(i, page0[i])
    }
    return true
  }
  const loadProfileDataRef = useRef(null)
  loadProfileDataRef.current = loadProfileData

  // ── Page navigation helpers ──────────────────────────────────
  const switchToPage = (pageIndex) => {
    const pg = pagesRef.current
    if (pageIndex < 0 || pageIndex >= pg.length) return
    setCurrentPage(pageIndex)
    setFolderPath([])
    setSelectedKey(null)
    const newPage = pg[pageIndex] ?? {}
    const rows  = deviceRef.current?.rows ?? 3
    const cols  = deviceRef.current?.cols ?? 5
    for (let i = 0; i < rows * cols; i++) drawHardwareButtonRef.current(i, newPage[i])
  }
  const switchToPageRef = useRef(null)
  switchToPageRef.current = switchToPage

  const addPage = () => {
    const newIndex = pagesRef.current.length
    setPages(prev => [...prev, {}])
    setCurrentPage(newIndex)
    setFolderPath([])
    setSelectedKey(null)
    const rows  = deviceRef.current?.rows ?? 3
    const cols  = deviceRef.current?.cols ?? 5
    for (let i = 0; i < rows * cols; i++) drawHardwareButtonRef.current(i, undefined)
  }

  const removePage = (pageIndex) => {
    const pg = pagesRef.current
    if (pg.length <= 1) return
    const newPages       = pg.filter((_, i) => i !== pageIndex)
    const newCurrentPage = Math.min(currentPageRef.current, newPages.length - 1)
    const newPage        = newPages[newCurrentPage] ?? {}
    setPages(newPages)
    setCurrentPage(newCurrentPage)
    setFolderPath([])
    setSelectedKey(null)
    const rows  = deviceRef.current?.rows ?? 3
    const cols  = deviceRef.current?.cols ?? 5
    for (let i = 0; i < rows * cols; i++) drawHardwareButtonRef.current(i, newPage[i])
  }
  // ─────────────────────────────────────────────────────────────

  // ── Folder enter / exit ─────────────────────────────────────
  const enterFolder = (buttonIndex) => {
    const newPath     = [...folderPathRef.current, buttonIndex]
    const newButtons  = getButtonsAt(pagesRef.current, currentPageRef.current, newPath)
    setFolderPath(newPath)
    setSelectedKey(null)
    const rows  = deviceRef.current?.rows ?? 3
    const cols  = deviceRef.current?.cols ?? 5
    for (let i = 0; i < rows * cols; i++) drawHardwareButtonRef.current(i, newButtons[i])
  }
  const enterFolderRef = useRef(null)
  enterFolderRef.current = enterFolder

  const exitFolder = () => {
    const newPath    = folderPathRef.current.slice(0, -1)
    const newButtons = getButtonsAt(pagesRef.current, currentPageRef.current, newPath)
    setFolderPath(newPath)
    setSelectedKey(null)
    const rows  = deviceRef.current?.rows ?? 3
    const cols  = deviceRef.current?.cols ?? 5
    for (let i = 0; i < rows * cols; i++) drawHardwareButtonRef.current(i, newButtons[i])
  }
  const exitFolderRef = useRef(null)
  exitFolderRef.current = exitFolder
  // ─────────────────────────────────────────────────────────────

  const updateConfig = (index, updates) => {
    setPages(prev => {
      const currentButtons = getButtonsAt(prev, currentPage, folderPath)
      const next = { title: '', iconDataUrl: null, bgColor: '#262626', ...currentButtons[index], ...updates }
      drawHardwareButton(index, next)
      return immutableSetButton(prev, currentPage, folderPath, index, next)
    })
  }

  const clearButton = (index) => {
    drawHardwareButton(index, null)
    setPages(prev => immutableSetButton(prev, currentPage, folderPath, index, null))
    setContextMenu(null)
  }

  // Load profiles list + active profile once on startup, then load button configs
  useEffect(() => {
    if (!window.streamDeck) return
    Promise.all([
      window.streamDeck.listProfiles?.(),
      window.streamDeck.getActiveProfile?.(),
      window.streamDeck.loadProfile?.(),
    ]).then(([list, activeName, saved]) => {
      if (list?.length) setProfiles(list)
      if (activeName)   setActiveProfile(activeName)
      if (saved) {
        const loadedPages = saved.pages ?? (saved.buttons ? [saved.buttons] : [{}])
        setPages(loadedPages)
        const page0 = loadedPages[0] ?? {}
        Object.entries(page0).forEach(([idx, cfg]) => {
          drawHardwareButtonRef.current(Number(idx), cfg)
        })
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save whenever pages/profile change (debounced 500ms)
  useEffect(() => {
    if (!window.streamDeck?.saveProfile) return
    const timer = setTimeout(() => {
      window.streamDeck.saveProfile({ name: activeProfile, pages })
    }, 500)
    return () => clearTimeout(timer)
  }, [pages, activeProfile])

  useEffect(() => {
    if (!window.streamDeck) return
    const offInfo  = window.streamDeck.onInfo(info => {
      setDevice(info)
      if (info.iconSize) setIconSize(info.iconSize)
    })
    const offDown = window.streamDeck.onKeyDown(({ index }) => {
      setPressedKey(index)
      const action = buttonConfigsRef.current[index]?.action
      if (action?.type === 'hotkey' && action.keys) {
        window.streamDeck.executeHotkey(action.keys)
      } else if (action?.type === 'open-app' && action.target) {
        window.streamDeck.openApplication(action.target, action.mode ?? 'gtk-launch')
      } else if (action?.type === 'open-url' && action.url) {
        window.streamDeck.openUrl(action.url)
      } else if (action?.type === 'run-cmd' && action.command) {
        window.streamDeck.runCommand(action.command)
      } else if (action?.type === 'sleep-toggle') {
        window.streamDeck.sleepToggle()
      } else if (action?.type === 'switch-profile' && action.profileName) {
        loadProfileDataRef.current(action.profileName).then(ok => {
          if (ok) {
            // Refresh the profiles list (newly created profiles may now appear)
            window.streamDeck.listProfiles?.().then(list => { if (list?.length) setProfiles(list) })
          }
        })
      } else if (action?.type === 'page-switcher') {
        switchToPageRef.current(action.targetPage ?? 0)
      } else if (action?.type === 'folder') {
        enterFolderRef.current(index)
      } else if (action?.type === 'back-folder') {
        exitFolderRef.current()
      } else if (action?.type === 'multi-action' && action.actions?.length) {
        const sd = window.streamDeck
        ;(async () => {
          for (const sub of action.actions) {
            await dispatchSubAction(sd, sub)
          }
        })()
      }
    })
    const offUp = window.streamDeck.onKeyUp(({ index }) => {
      setPressedKey(p => p === index ? null : p)
      // Redraw the hardware button to restore the user's icon after the press-flash
      drawHardwareButton(index, buttonConfigsRef.current[index])
    })
    const offSleep = window.streamDeck.onSleep(() => { stopAllGifAnimationsRef.current?.(); setSleeping(true) })
    const offWake  = window.streamDeck.onWake(()  => setSleeping(false))
    return () => { offInfo(); offDown(); offUp(); offSleep(); offWake() }
  }, [])

  // When waking, re-draw every hardware button with the stored config
  useEffect(() => {
    if (sleeping) return
    Object.entries(buttonConfigsRef.current).forEach(([idx, cfg]) => {
      drawHardwareButton(Number(idx), cfg)
    })
  }, [sleeping]) // eslint-disable-line react-hooks/exhaustive-deps

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
          <ProfileSwitcher
            activeProfile={activeProfile}
            profiles={profiles}
            onSwitch={name => loadProfileDataRef.current(name)}
            onCreate={async name => {
              const result = await window.streamDeck?.createProfile(name)
              if (result?.ok) {
                setProfiles(prev => [...prev, result.name].sort((a, b) => a.localeCompare(b)))
                setActiveProfile(result.name)
                setPages([{}])
                setCurrentPage(0)
                const rows  = deviceRef.current?.rows ?? 3
                const cols  = deviceRef.current?.cols ?? 5
                for (let i = 0; i < rows * cols; i++) drawHardwareButtonRef.current(i, undefined)
              }
            }}
            onDelete={async name => {
              const result = await window.streamDeck?.deleteProfile(name)
              if (result?.ok) {
                setProfiles(prev => prev.filter(p => p !== name))
              }
            }}
          />
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
              {folderPath.length > 0 && (
                <div className="folder-nav">
                  <button className="folder-nav-back" onClick={exitFolder} aria-label="Exit folder">
                    <svg viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" width="6" height="10">
                      <path d="M5 1L1 5l4 4" />
                    </svg>
                    Back
                  </button>
                  <div className="folder-nav-path">
                    {folderPath.map((idx, depth) => {
                      const ancestorButtons = getButtonsAt(pages, currentPage, folderPath.slice(0, depth))
                      const label = ancestorButtons[idx]?.title || `Folder`
                      return (
                        <span key={depth} className="folder-nav-crumb">
                          {depth > 0 && <span className="folder-nav-sep">›</span>}
                          <span>{label}</span>
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}
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
                  onDropAction={(index, actionId) => {
                    const action = ACTION_DEFAULTS[actionId]
                    if (!action) return
                    updateConfig(index, { action })
                    setSelectedKey(index)
                  }}
                />
              </div>

              {folderPath.length === 0 && (
              <div className="page-controls">
                <button
                  className="page-btn"
                  disabled={currentPage === 0}
                  onClick={() => switchToPage(currentPage - 1)}
                  aria-label="Previous page"
                >
                  <svg viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M5 1L1 5l4 4" />
                  </svg>
                </button>
                <span className="page-indicator">Page {currentPage + 1} / {pages.length}</span>
                <button
                  className="page-btn"
                  disabled={currentPage === pages.length - 1}
                  onClick={() => switchToPage(currentPage + 1)}
                  aria-label="Next page"
                >
                  <svg viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M1 1l4 4-4 4" />
                  </svg>
                </button>
                <button
                  className="page-btn page-add-btn"
                  onClick={addPage}
                  title="Add page"
                  aria-label="Add page"
                >
                  <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" width="10" height="10">
                    <path d="M5 1v8M1 5h8" strokeLinecap="round" />
                  </svg>
                </button>
                {pages.length > 1 && (
                  <button
                    className="page-btn page-remove-btn"
                    onClick={() => removePage(currentPage)}
                    title="Remove current page"
                    aria-label="Remove page"
                  >
                    <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" width="10" height="10">
                      <path d="M1 5h8" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
              )}
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
            profiles={profiles}
            pageCount={pages.length}
            onEnterFolder={() => { enterFolder(selectedKey); setSelectedKey(null) }}
          />
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          keyIndex={contextMenu.keyIndex}
          hasContent={!!buttonConfigs[contextMenu.keyIndex] &&
            !!(buttonConfigs[contextMenu.keyIndex].title ||
               buttonConfigs[contextMenu.keyIndex].iconDataUrl ||
               buttonConfigs[contextMenu.keyIndex].action)}
          hasClipboard={!!clipboard}
          onCopy={i => setClipboard({ ...buttonConfigs[i] })}
          onPaste={i => {
            if (!clipboard) return
            updateConfig(i, { ...clipboard })
          }}
          onClear={clearButton}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  )
}

