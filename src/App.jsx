import { useState, useEffect, useRef } from 'react'
import { parseGIF, decompressFrames } from 'gifuct-js'
import OBSWebSocket from 'obs-websocket-js'
import './App.css'
import { getButtonsAt, immutableSetButton, formatClock } from './utils.js'

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

// ─── Folder navigation helpers + clock formatter are imported from ./utils.js ──

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
  {
    id: 'widgets',
    name: 'Widgets',
    actions: [
      { id: 'clock',          name: 'Clock / Date',   icon: '🕐' },
      { id: 'system-monitor', name: 'CPU / RAM',       icon: '📊' },
      { id: 'volume',         name: 'Volume',          icon: '🔊' },
      { id: 'media',          name: 'Media Control',   icon: '🎵' },
    ],
  },
  {
    id: 'obs',
    name: 'OBS Studio',
    actions: [
      { id: 'obs-record',           name: 'Record',           icon: '⏺' },
      { id: 'obs-record-pause',     name: 'Pause Recording',  icon: '⏸' },
      { id: 'obs-stream',           name: 'Stream',           icon: '📡' },
      { id: 'obs-replay-buffer',    name: 'Replay Buffer',    icon: '⏮' },
      { id: 'obs-save-replay',      name: 'Save Replay',      icon: '💾' },
      { id: 'obs-scene',            name: 'Scene',            icon: '🎬' },
      { id: 'obs-scene-collection', name: 'Scene Collection', icon: '📁' },
      { id: 'obs-source',           name: 'Source Visibility',icon: '👁' },
      { id: 'obs-mute',             name: 'Mute',             icon: '🔇' },
      { id: 'obs-media',            name: 'Media Control',    icon: '🎞' },
      { id: 'obs-studio-mode',      name: 'Studio Mode',      icon: '🖥' },
      { id: 'obs-preview-scene',    name: 'Push to Program',  icon: '▶' },
      { id: 'obs-filter',           name: 'Source Filter',    icon: '🔧' },
      { id: 'obs-screenshot',       name: 'Screenshot',       icon: '📷' },
      { id: 'obs-transition',       name: 'Transition',       icon: '⇢' },
      { id: 'obs-chapter-marker',   name: 'Chapter Marker',   icon: '🔖' },
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
function ActionsPanel({ pluginManifests = [] }) {
  const [search, setSearch]     = useState('')
  const [expanded, setExpanded] = useState({ streamdeck: true })

  const toggle = id => setExpanded(prev => ({ ...prev, [id]: !prev[id] }))

  const pluginCategories = pluginManifests.map(p => ({
    id:      p.UUID,
    name:    p.Category || p.Name,
    actions: (p.Actions || []).map(a => ({ id: a.UUID, name: a.Name, icon: '🔌' })),
  }))

  const allCategories = [...ACTION_CATEGORIES, ...pluginCategories]

  const filtered = allCategories
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
                  // Plugin actions (reverse-DNS UUID) are always available
                  const isPlugin = action.id.includes('.')
                  const enabled  = isPlugin || ENABLED_ACTIONS.has(action.id)
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
export function ButtonGrid({ rows, cols, selectedKey, pressedKey, toggledButtons = {}, onSelectKey, buttonConfigs, onContextMenu, onDropAction, onMoveButton, livePreviews = {} }) {
  const [dragOverIndex, setDragOverIndex] = useState(null)
  const [draggingFrom,  setDraggingFrom]  = useState(null)

  return (
    <div className="button-grid" style={{ '--cols': cols }}>
      {Array.from({ length: rows * cols }, (_, i) => {
        const cfg        = buttonConfigs?.[i]
        const hasContent = !!(cfg?.action || cfg?.title || cfg?.iconDataUrl)
        // While physically held, show pressed icon. Otherwise, show toggled icon if latched.
        const isPhysicallyPressed = pressedKey === i
        const isLatched           = !!toggledButtons[i]
        const activeSrc  = (isPhysicallyPressed || isLatched) ? (cfg?.pressedIconDataUrl ?? cfg?.iconDataUrl) : cfg?.iconDataUrl
        const previewSrc = livePreviews[i] ?? activeSrc ?? null
        const isLive     = !!livePreviews[i]
        return (
          <button
            key={i}
            className={[
              'deck-btn',
              selectedKey   === i ? 'selected'     : '',
              pressedKey    === i ? 'pressed'      : '',
              dragOverIndex === i && draggingFrom !== i ? 'drag-over' : '',
              draggingFrom  === i ? 'drag-source'  : '',
              previewSrc                     ? 'has-icon'  : '',
              cfg?.action?.type === 'folder' ? 'is-folder' : '',
            ].join(' ').trim()}
            style={{
              backgroundImage: previewSrc ? `url(${previewSrc})` : 'none',
              backgroundColor: previewSrc ? 'transparent' : (cfg?.bgColor ?? '#262626'),
            }}
            draggable={hasContent}
            onDragStart={e => {
              if (!hasContent) { e.preventDefault(); return }
              e.dataTransfer.setData('application/stream-deck-button-move', String(i))
              e.dataTransfer.effectAllowed = 'move'
              setDraggingFrom(i)
            }}
            onDragEnd={() => { setDraggingFrom(null); setDragOverIndex(null) }}
            onClick={() => onSelectKey(i)}
            onContextMenu={e => { e.preventDefault(); onContextMenu(e, i) }}
            onDragOver={e => {
              const isActionDrop = e.dataTransfer.types.includes('application/stream-deck-action')
              const isButtonMove = e.dataTransfer.types.includes('application/stream-deck-button-move')
              if (!isActionDrop && !isButtonMove) return
              if (isButtonMove && draggingFrom === i) return // can't drop on self
              e.preventDefault()
              e.dataTransfer.dropEffect = isButtonMove ? 'move' : 'copy'
              setDragOverIndex(i)
            }}
            onDragLeave={e => {
              if (e.currentTarget.contains(e.relatedTarget)) return
              setDragOverIndex(null)
            }}
            onDrop={e => {
              e.preventDefault()
              setDragOverIndex(null)
              setDraggingFrom(null)
              const actionId = e.dataTransfer.getData('application/stream-deck-action')
              if (actionId) { onDropAction?.(i, actionId); return }
              const fromStr = e.dataTransfer.getData('application/stream-deck-button-move')
              if (fromStr !== '') {
                const fromIndex = Number(fromStr)
                if (!isNaN(fromIndex) && fromIndex !== i) onMoveButton?.(fromIndex, i)
              }
            }}
            aria-label={`Button ${i + 1}`}
          >
            {!previewSrc && <span className="deck-btn-index">{i + 1}</span>}
            {cfg?.title && !isLive && <span className="deck-btn-title">{cfg.title}</span>}
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
const ENABLED_ACTIONS = new Set(['hotkey', 'open-app', 'open-url', 'run-cmd', 'sleep-toggle', 'multi-action', 'switch-profile', 'page-switcher', 'create-folder', 'back-folder', 'clock', 'system-monitor', 'volume', 'media', 'obs-record', 'obs-record-pause', 'obs-stream', 'obs-replay-buffer', 'obs-save-replay', 'obs-scene', 'obs-scene-collection', 'obs-source', 'obs-mute', 'obs-media', 'obs-studio-mode', 'obs-preview-scene', 'obs-filter', 'obs-screenshot', 'obs-transition', 'obs-chapter-marker'])

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
  // Widgets
  'clock':          { type: 'clock',          format: 'HH:MM', bgColor: '#000000', textColor: '#ffffff' },
  'system-monitor': { type: 'system-monitor', bgColor: '#000000', textColor: '#00ff88', showCpu: true, showRam: true },
  'volume':         { type: 'volume',         operation: 'display-only', step: 5, sink: '@DEFAULT_SINK@', bgColor: '#000000', textColor: '#00aaff' },
  'media':          { type: 'media',          command: 'play-pause', player: '%any', bgColor: '#000000', textColor: '#ffffff' },
  // OBS Studio
  'obs-record':           { type: 'obs-record' },
  'obs-record-pause':     { type: 'obs-record-pause' },
  'obs-stream':           { type: 'obs-stream' },
  'obs-replay-buffer':    { type: 'obs-replay-buffer' },
  'obs-save-replay':      { type: 'obs-save-replay' },
  'obs-scene':            { type: 'obs-scene',            sceneName: '' },
  'obs-scene-collection': { type: 'obs-scene-collection', collectionName: '' },
  'obs-source':           { type: 'obs-source',           sceneName: '', sceneItemId: null, sourceName: '' },
  'obs-mute':             { type: 'obs-mute',             inputName: '' },
  'obs-media':            { type: 'obs-media',            inputName: '', mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE' },
  'obs-studio-mode':      { type: 'obs-studio-mode' },
  'obs-preview-scene':    { type: 'obs-preview-scene' },
  'obs-filter':           { type: 'obs-filter',           sourceName: '', filterName: '' },
  'obs-screenshot':       { type: 'obs-screenshot',       sourceName: '', imageFilePath: '' },
  'obs-transition':       { type: 'obs-transition',       transitionName: '' },
  'obs-chapter-marker':   { type: 'obs-chapter-marker',  captionText: '' },
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

export function ActionSection({ action, onChange, profiles = [], pageCount = 1, onEnterFolder, obsScenes = [], obsInputs = [], obsTransitions = [], obsSceneCollections = [], pluginManifests = [] }) {
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

  // ── assigned: clock ──
  if (action?.type === 'clock') {
    const CLOCK_PRESETS = [
      { label: 'HH:MM',             value: 'HH:MM'         },
      { label: 'HH:MM:SS',          value: 'HH:MM:SS'      },
      { label: 'hh:MM A',           value: 'hh:MM A'       },
      { label: 'HH:MM  |  DD/mo',   value: 'HH:MM|DD/mo'   },
      { label: 'HH:MM  |  ddd DD',  value: 'HH:MM|ddd DD'  },
      { label: 'HH:MM:SS  |  DD/mo',value: 'HH:MM:SS|DD/mo'},
      { label: 'ddd  |  HH:MM',     value: 'ddd|HH:MM'     },
    ]
    return (
      <div className="assigned-action">
        <div className="action-chip">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M8 5v3.2l2.4 1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Clock / Date</span>
          <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <span className="prop-label-sm">Format</span>
        <select
          className="prop-input"
          value={action.format ?? 'HH:MM'}
          onChange={e => onChange({ action: { ...action, format: e.target.value } })}
        >
          {CLOCK_PRESETS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <div className="prop-row" style={{ marginTop: 8 }}>
          <label className="prop-field-label">Background</label>
          <input
            type="color"
            className="prop-color"
            value={action.bgColor ?? '#000000'}
            onChange={e => onChange({ action: { ...action, bgColor: e.target.value } })}
          />
        </div>
        <div className="prop-row">
          <label className="prop-field-label">Text colour</label>
          <input
            type="color"
            className="prop-color"
            value={action.textColor ?? '#ffffff'}
            onChange={e => onChange({ action: { ...action, textColor: e.target.value } })}
          />
        </div>
      </div>
    )
  }

  // ── assigned: system-monitor ──
  if (action?.type === 'system-monitor') {
    return (
      <div className="assigned-action">
        <div className="action-chip">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
            <rect x="1" y="3" width="14" height="10" rx="1.5" />
            <path d="M3 11l2.5-4 2 2.5 2-4 2.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>CPU / RAM</span>
          <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <div className="prop-row" style={{ marginTop: 8 }}>
          <label className="prop-field-label">Background</label>
          <input type="color" className="prop-color" value={action.bgColor ?? '#000000'}
            onChange={e => onChange({ action: { ...action, bgColor: e.target.value } })} />
        </div>
        <div className="prop-row">
          <label className="prop-field-label">Text colour</label>
          <input type="color" className="prop-color" value={action.textColor ?? '#00ff88'}
            onChange={e => onChange({ action: { ...action, textColor: e.target.value } })} />
        </div>
        <div className="prop-row" style={{ gap: 10, marginTop: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={action.showCpu !== false}
              onChange={e => onChange({ action: { ...action, showCpu: e.target.checked } })} />
            CPU
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={action.showRam !== false}
              onChange={e => onChange({ action: { ...action, showRam: e.target.checked } })} />
            RAM
          </label>
        </div>
        <p className="action-hint">Updates every 2 s. Display-only — no action on press.</p>
      </div>
    )
  }

  // ── assigned: volume ──
  if (action?.type === 'volume') {
    return (
      <div className="assigned-action">
        <div className="action-chip">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
            <path d="M3 6H1v4h2l4 3V3L3 6z" fill="currentColor" stroke="none" />
            <path d="M10 5.5a3.5 3.5 0 0 1 0 5M12.5 3a6.5 6.5 0 0 1 0 10" strokeLinecap="round" />
          </svg>
          <span>Volume</span>
          <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <span className="prop-label-sm">Action on press</span>
        <select className="prop-input" value={action.operation ?? 'display-only'}
          onChange={e => onChange({ action: { ...action, operation: e.target.value } })}>
          <option value="display-only">Display only</option>
          <option value="raise">Raise volume</option>
          <option value="lower">Lower volume</option>
          <option value="mute-toggle">Mute / unmute</option>
        </select>
        {(action.operation === 'raise' || action.operation === 'lower') && (
          <>
            <span className="prop-label-sm">Step (%)</span>
            <input type="number" className="prop-input" min="1" max="50"
              value={action.step ?? 5}
              onChange={e => onChange({ action: { ...action, step: Number(e.target.value) } })} />
          </>
        )}
        <div className="prop-row" style={{ marginTop: 8 }}>
          <label className="prop-field-label">Background</label>
          <input type="color" className="prop-color" value={action.bgColor ?? '#000000'}
            onChange={e => onChange({ action: { ...action, bgColor: e.target.value } })} />
        </div>
        <div className="prop-row">
          <label className="prop-field-label">Bar colour</label>
          <input type="color" className="prop-color" value={action.textColor ?? '#00aaff'}
            onChange={e => onChange({ action: { ...action, textColor: e.target.value } })} />
        </div>
      </div>
    )
  }

  // ── assigned: media ──
  if (action?.type === 'media') {
    return (
      <div className="assigned-action">
        <div className="action-chip">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M6 5.5l5 2.5-5 2.5V5.5z" fill="currentColor" stroke="none" />
          </svg>
          <span>Media Control</span>
          <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>
        <span className="prop-label-sm">Command on press</span>
        <select className="prop-input" value={action.command ?? 'play-pause'}
          onChange={e => onChange({ action: { ...action, command: e.target.value } })}>
          <option value="display-only">Display track info (no action)</option>
          <option value="play-pause">Play / Pause</option>
          <option value="next">Next track</option>
          <option value="previous">Previous track</option>
          <option value="stop">Stop</option>
        </select>
        <span className="prop-label-sm">Player (leave blank for any)</span>
        <input className="prop-input" type="text" placeholder="%any"
          value={action.player ?? ''}
          onChange={e => onChange({ action: { ...action, player: e.target.value || '%any' } })} />
        <div className="prop-row" style={{ marginTop: 8 }}>
          <label className="prop-field-label">Background</label>
          <input type="color" className="prop-color" value={action.bgColor ?? '#000000'}
            onChange={e => onChange({ action: { ...action, bgColor: e.target.value } })} />
        </div>
        <p className="action-hint">{action.command === 'display-only' ? 'Shows current track · artist · play state. No action on press.' : 'Fires the selected playerctl command on press. Requires playerctl.'}</p>
      </div>
    )
  }

  // ── OBS: shared chip helper ──
  const obsChip = (label) => (
    <div className="action-chip">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
        <circle cx="8" cy="8" r="6.5" />
        <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
      </svg>
      <span>{label}</span>
      <button className="action-remove" onClick={() => onChange({ action: null })} title="Remove action">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="9" height="9">
          <path d="M1 1l10 10M11 1L1 11" />
        </svg>
      </button>
    </div>
  )
  const obsHint = <p className="action-hint">Auto-connects to OBS at localhost:4455. Enable WebSocket in OBS → Tools → WebSocket Server Settings.</p>

  // ── assigned: obs-record ──
  if (action?.type === 'obs-record') {
    return (
      <div className="assigned-action">
        {obsChip('Record')}
        <p className="action-hint">Toggles OBS recording on / off when pressed.</p>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-record-pause ──
  if (action?.type === 'obs-record-pause') {
    return (
      <div className="assigned-action">
        {obsChip('Pause Recording')}
        <p className="action-hint">Pauses or resumes an active OBS recording.</p>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-stream ──
  if (action?.type === 'obs-stream') {
    return (
      <div className="assigned-action">
        {obsChip('Stream')}
        <p className="action-hint">Starts or stops the OBS stream when pressed.</p>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-replay-buffer ──
  if (action?.type === 'obs-replay-buffer') {
    return (
      <div className="assigned-action">
        {obsChip('Replay Buffer')}
        <p className="action-hint">Starts or stops the OBS replay buffer.</p>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-save-replay ──
  if (action?.type === 'obs-save-replay') {
    return (
      <div className="assigned-action">
        {obsChip('Save Replay')}
        <p className="action-hint">Saves the current replay buffer to disk.</p>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-studio-mode ──
  if (action?.type === 'obs-studio-mode') {
    return (
      <div className="assigned-action">
        {obsChip('Studio Mode')}
        <p className="action-hint">Toggles OBS Studio Mode on / off.</p>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-preview-scene ──
  if (action?.type === 'obs-preview-scene') {
    return (
      <div className="assigned-action">
        {obsChip('Push to Program')}
        <p className="action-hint">Pushes the current preview scene to program (Studio Mode only).</p>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-scene ──
  if (action?.type === 'obs-scene') {
    return (
      <div className="assigned-action">
        {obsChip('Scene')}
        <span className="prop-label-sm">Scene</span>
        {obsScenes.length > 0
          ? <select className="prop-input" value={action.sceneName ?? ''}
              onChange={e => onChange({ action: { ...action, sceneName: e.target.value } })}>
              <option value="">— select scene —</option>
              {obsScenes.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          : <input className="prop-input" type="text" placeholder="Scene name (connect OBS to pick)"
              value={action.sceneName ?? ''}
              onChange={e => onChange({ action: { ...action, sceneName: e.target.value } })} />
        }
        <p className="action-hint">Switches OBS to this scene when pressed.</p>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-scene-collection ──
  if (action?.type === 'obs-scene-collection') {
    return (
      <div className="assigned-action">
        {obsChip('Scene Collection')}
        <span className="prop-label-sm">Scene Collection</span>
        {obsSceneCollections.length > 0
          ? <select className="prop-input" value={action.collectionName ?? ''}
              onChange={e => onChange({ action: { ...action, collectionName: e.target.value } })}>
              <option value="">— select collection —</option>
              {obsSceneCollections.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          : <input className="prop-input" type="text" placeholder="Collection name (connect OBS to pick)"
              value={action.collectionName ?? ''}
              onChange={e => onChange({ action: { ...action, collectionName: e.target.value } })} />
        }
        <p className="action-hint">Switches to this scene collection when pressed.</p>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-mute ──
  if (action?.type === 'obs-mute') {
    return (
      <div className="assigned-action">
        {obsChip('Mute')}
        <span className="prop-label-sm">Audio source</span>
        {obsInputs.length > 0
          ? <select className="prop-input" value={action.inputName ?? ''}
              onChange={e => onChange({ action: { ...action, inputName: e.target.value } })}>
              <option value="">— select source —</option>
              {obsInputs.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          : <input className="prop-input" type="text" placeholder="Source name (connect OBS to pick)"
              value={action.inputName ?? ''}
              onChange={e => onChange({ action: { ...action, inputName: e.target.value } })} />
        }
        <p className="action-hint">Toggles mute on this audio source when pressed.</p>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-media ──
  if (action?.type === 'obs-media') {
    return (
      <div className="assigned-action">
        {obsChip('Media Control')}
        <span className="prop-label-sm">Media source</span>
        {obsInputs.length > 0
          ? <select className="prop-input" value={action.inputName ?? ''}
              onChange={e => onChange({ action: { ...action, inputName: e.target.value } })}>
              <option value="">— select source —</option>
              {obsInputs.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          : <input className="prop-input" type="text" placeholder="Media source name (connect OBS to pick)"
              value={action.inputName ?? ''}
              onChange={e => onChange({ action: { ...action, inputName: e.target.value } })} />
        }
        <span className="prop-label-sm">Action</span>
        <select className="prop-input" value={action.mediaAction ?? 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE'}
          onChange={e => onChange({ action: { ...action, mediaAction: e.target.value } })}>
          <option value="OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY">Play</option>
          <option value="OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE">Pause</option>
          <option value="OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP">Stop</option>
          <option value="OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART">Restart</option>
          <option value="OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT">Next</option>
          <option value="OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS">Previous</option>
        </select>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-source ──
  if (action?.type === 'obs-source') {
    return (
      <div className="assigned-action">
        {obsChip('Source Visibility')}
        <span className="prop-label-sm">Scene</span>
        {obsScenes.length > 0
          ? <select className="prop-input" value={action.sceneName ?? ''}
              onChange={e => onChange({ action: { ...action, sceneName: e.target.value } })}>
              <option value="">— select scene —</option>
              {obsScenes.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          : <input className="prop-input" type="text" placeholder="Scene name (connect OBS to pick)"
              value={action.sceneName ?? ''}
              onChange={e => onChange({ action: { ...action, sceneName: e.target.value } })} />
        }
        <span className="prop-label-sm">Source name</span>
        <input className="prop-input" type="text" placeholder="Exact source name in OBS"
          value={action.sourceName ?? ''}
          onChange={e => onChange({ action: { ...action, sourceName: e.target.value } })} />
        <p className="action-hint">Toggles visibility of this source when pressed.</p>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-filter ──
  if (action?.type === 'obs-filter') {
    return (
      <div className="assigned-action">
        {obsChip('Source Filter')}
        <span className="prop-label-sm">Source</span>
        {obsInputs.length > 0
          ? <select className="prop-input" value={action.sourceName ?? ''}
              onChange={e => onChange({ action: { ...action, sourceName: e.target.value } })}>
              <option value="">— select source —</option>
              {obsInputs.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          : <input className="prop-input" type="text" placeholder="Source name (connect OBS to pick)"
              value={action.sourceName ?? ''}
              onChange={e => onChange({ action: { ...action, sourceName: e.target.value } })} />
        }
        <span className="prop-label-sm">Filter name</span>
        <input className="prop-input" type="text" placeholder="Exact filter name in OBS"
          value={action.filterName ?? ''}
          onChange={e => onChange({ action: { ...action, filterName: e.target.value } })} />
        <p className="action-hint">Toggles this filter on / off when pressed.</p>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-screenshot ──
  if (action?.type === 'obs-screenshot') {
    return (
      <div className="assigned-action">
        {obsChip('Screenshot')}
        <span className="prop-label-sm">Source</span>
        {obsInputs.length > 0
          ? <select className="prop-input" value={action.sourceName ?? ''}
              onChange={e => onChange({ action: { ...action, sourceName: e.target.value } })}>
              <option value="">— select source —</option>
              {obsInputs.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          : <input className="prop-input" type="text" placeholder="Source name (connect OBS to pick)"
              value={action.sourceName ?? ''}
              onChange={e => onChange({ action: { ...action, sourceName: e.target.value } })} />
        }
        <span className="prop-label-sm">Save to path</span>
        <input className="prop-input" type="text" placeholder="/home/user/screenshot.png"
          value={action.imageFilePath ?? ''}
          onChange={e => onChange({ action: { ...action, imageFilePath: e.target.value } })} />
        <p className="action-hint">Takes a screenshot of this source and saves it to the specified path.</p>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-transition ──
  if (action?.type === 'obs-transition') {
    return (
      <div className="assigned-action">
        {obsChip('Transition')}
        <span className="prop-label-sm">Transition</span>
        {obsTransitions.length > 0
          ? <select className="prop-input" value={action.transitionName ?? ''}
              onChange={e => onChange({ action: { ...action, transitionName: e.target.value } })}>
              <option value="">— select transition —</option>
              {obsTransitions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          : <input className="prop-input" type="text" placeholder="Transition name (connect OBS to pick)"
              value={action.transitionName ?? ''}
              onChange={e => onChange({ action: { ...action, transitionName: e.target.value } })} />
        }
        <p className="action-hint">Sets this as the active scene transition when pressed.</p>
        {obsHint}
      </div>
    )
  }

  // ── assigned: obs-chapter-marker ──
  if (action?.type === 'obs-chapter-marker') {
    return (
      <div className="assigned-action">
        {obsChip('Chapter Marker')}
        <span className="prop-label-sm">Caption text</span>
        <input className="prop-input" type="text" placeholder="e.g. Chapter 1"
          value={action.captionText ?? ''}
          onChange={e => onChange({ action: { ...action, captionText: e.target.value } })} />
        <p className="action-hint">Inserts a caption/chapter marker into the active recording.</p>
        {obsHint}
      </div>
    )
  }

  // ── unassigned ──
  const pluginCategories = pluginManifests.map(p => ({
    id:      p.UUID,
    name:    p.Category || p.Name,
    actions: (p.Actions || []).map(a => ({ id: a.UUID, name: a.Name, icon: '🔌' })),
  }))
  const allCategories = [...ACTION_CATEGORIES, ...pluginCategories]

  return (
    <div className="unassigned-action">
      {picking ? (
        <div className="action-type-list">
          {allCategories.map(cat => (
            <div key={cat.id}>
              <div className="action-category-header">{cat.name}</div>
              {cat.actions.map(a => {
                const isPlugin = a.id.includes('.')
                const enabled  = isPlugin || ENABLED_ACTIONS.has(a.id)
                return (
                  <button
                    key={a.id}
                    className={`action-type-item${!enabled ? ' disabled' : ''}`}
                    onClick={() => {
                      if (!enabled) return
                      if (isPlugin) {
                        const plugin = pluginManifests.find(p =>
                          (p.Actions || []).some(act => act.UUID === a.id)
                        )
                        if (plugin) onChange({ action: { type: a.id, pluginUUID: plugin.UUID } })
                      } else {
                        onChange({ action: ACTION_DEFAULTS[a.id] ?? { type: a.id } })
                      }
                      setPicking(false)
                    }}
                  >
                    <span className="action-type-icon">{a.icon}</span>
                    <span>{a.name}</span>
                    {!enabled && <span className="action-type-soon">soon</span>}
                  </button>
                )
              })}
            </div>
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

// ─── Plugin Property Inspector ──────────────────────────────
function PluginInspector({ action, onChange, pluginManifests = [] }) {
  const iframeRef  = useRef(null)
  const pluginUUID = action?.pluginUUID
  const actionUUID = action?.type

  // Find the action definition to get its PropertyInspectorPath
  const pluginData    = pluginManifests.find(p => p.UUID === pluginUUID)
  const actionDef     = pluginData?.Actions?.find(a => a.UUID === actionUUID)
  const inspectorPath = actionDef?.PropertyInspectorPath ?? pluginData?.PropertyInspectorPath ?? 'ui/inspector.html'
  const inspectorSrc  = pluginUUID ? `plugin://${pluginUUID}/${inspectorPath}` : null

  // Send current settings to the iframe once it loads
  const handleLoad = () => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'sdpi:settings', payload: { ...action } },
      '*'
    )
  }

  // Bridge: iframe <-> host (settings) + plugin process <-> inspector (sendToPropertyInspector)
  useEffect(() => {
    const msgHandler = e => {
      if (e.source !== iframeRef.current?.contentWindow) return
      if (!e.data?.type) return
      if (e.data.type === 'sdpi:setSettings') {
        onChange({ action: { ...action, ...e.data.payload } })
      } else if (e.data.type === 'sdpi:getSettings') {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'sdpi:settings', payload: { ...action } },
          '*'
        )
      } else if (e.data.type === 'sdpi:sendToPlugin') {
        window.streamDeck?.sendToPlugin?.(pluginUUID, actionUUID, 'sendToPropertyInspector', e.data.payload, null)
      }
    }
    const piHandler = e => {
      if (e.detail?.event === 'sendToPropertyInspector' && e.detail.actionUUID === actionUUID) {
        iframeRef.current?.contentWindow?.postMessage(
          { type: 'sdpi:sendToPropertyInspector', payload: e.detail.payload },
          '*'
        )
      }
    }
    window.addEventListener('message', msgHandler)
    window.addEventListener('plugin:toInspector', piHandler)
    return () => {
      window.removeEventListener('message', msgHandler)
      window.removeEventListener('plugin:toInspector', piHandler)
    }
  }, [action, onChange, pluginUUID, actionUUID]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!inspectorSrc) {
    return (
      <div className="assigned-action">
        <p className="action-hint">Plugin action — no inspector path configured.</p>
        <button className="action-remove" onClick={() => onChange({ action: null })}>Remove</button>
      </div>
    )
  }

  return (
    <div className="plugin-inspector-wrap">
      <iframe
        ref={iframeRef}
        src={inspectorSrc}
        title="Plugin Inspector"
        className="plugin-inspector-frame"
        sandbox="allow-scripts allow-same-origin allow-forms"
        onLoad={handleLoad}
      />
      <button
        className="plugin-inspector-remove"
        onClick={() => onChange({ action: null })}
        title="Remove action"
      >Remove action</button>
    </div>
  )
}

function PropertiesPanel({ keyIndex, onClose, config, onChange, iconSize, profiles, pageCount, onEnterFolder, obsScenes = [], obsInputs = [], obsTransitions = [], obsSceneCollections = [], pluginManifests = [] }) {
  const fileInputRef        = useRef(null)
  const pressedFileInputRef = useRef(null)
  const [libraryTarget, setLibraryTarget] = useState(null) // 'default' | 'pressed' | null

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

  const handlePressedIconSelect = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      onChange({ pressedIconDataUrl: ev.target.result })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const removeIcon        = () => onChange({ iconDataUrl: null })
  const removePressedIcon = () => onChange({ pressedIconDataUrl: null })

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
          {config?.action?.type?.includes('.') ? (
            <PluginInspector action={config.action} onChange={onChange} pluginManifests={pluginManifests} />
          ) : (
            <ActionSection action={config?.action} onChange={onChange} profiles={profiles} pageCount={pageCount} onEnterFolder={onEnterFolder} obsScenes={obsScenes} obsInputs={obsInputs} obsTransitions={obsTransitions} obsSceneCollections={obsSceneCollections} pluginManifests={pluginManifests} />
          )}
        </div>

        <div className="prop-section">
          <span className="prop-label">Icon</span>

          <span className="prop-label-sm">Default</span>
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
            <button className="icon-lib-open-btn" onClick={() => setLibraryTarget('default')}>
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

          <span className="prop-label-sm" style={{ marginTop: 10 }}>Pressed</span>
          <div className="icon-picker-area" onClick={() => pressedFileInputRef.current?.click()}>
            {config?.pressedIconDataUrl ? (
              <img src={config.pressedIconDataUrl} className="icon-preview" alt="Pressed icon" />
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
            <button className="icon-lib-open-btn" onClick={() => setLibraryTarget('pressed')}>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="13" height="13">
                <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 2H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3.5A1.5 1.5 0 0 1 2 11.5v-7z" />
              </svg>
              Icon Library
            </button>
            {config?.pressedIconDataUrl && (
              <button className="icon-remove-btn" onClick={removePressedIcon}>Remove</button>
            )}
          </div>
          <input
            ref={pressedFileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handlePressedIconSelect}
          />

          {libraryTarget && (
            <IconLibraryModal
              onSelect={dataUrl => {
                if (libraryTarget === 'default') onChange({ iconDataUrl: dataUrl })
                else onChange({ pressedIconDataUrl: dataUrl })
                setLibraryTarget(null)
              }}
              onClose={() => setLibraryTarget(null)}
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

// ─── Plugin Browser ─────────────────────────────────────────
function PluginBrowser({ pluginManifests, onInstall, onUninstall, onClose }) {
  const [installing, setInstalling] = useState(false)
  const [error,      setError]      = useState('')

  const handleInstall = async () => {
    setError('')
    const sourcePath = await window.streamDeck?.browsePluginDir?.()
    if (!sourcePath) return
    setInstalling(true)
    const res = await window.streamDeck?.installPlugin?.(sourcePath)
    setInstalling(false)
    if (res?.ok) {
      onInstall?.()
    } else {
      setError(res?.error ?? 'Install failed')
    }
  }

  const handleUninstall = async (uuid) => {
    if (!window.confirm('Uninstall this plugin? This cannot be undone.')) return
    const res = await window.streamDeck?.uninstallPlugin?.(uuid)
    if (res?.ok) onInstall?.()  // refresh list
    else setError(res?.error ?? 'Uninstall failed')
  }

  return (
    <div className="plugin-browser-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="plugin-browser">
        <div className="plugin-browser-header">
          <h2>Plugins</h2>
          <button className="plugin-browser-close" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" width="12" height="12">
              <path d="M1 1l10 10M11 1L1 11" />
            </svg>
          </button>
        </div>

        {error && <p className="plugin-browser-error">{error}</p>}

        {pluginManifests.length === 0 ? (
          <p className="plugin-browser-empty">No plugins installed.</p>
        ) : (
          <div className="plugin-cards">
            {pluginManifests.map(p => (
              <div key={p.UUID} className="plugin-card">
                <div className="plugin-card-info">
                  <span className="plugin-card-name">{p.Name}</span>
                  <span className="plugin-card-meta">v{p.Version} · {p.Author}</span>
                  {p.Description && <span className="plugin-card-desc">{p.Description}</span>}
                </div>
                <button
                  className="plugin-card-uninstall"
                  onClick={() => handleUninstall(p.UUID)}
                  title="Uninstall plugin"
                >Uninstall</button>
              </div>
            ))}
          </div>
        )}

        <button
          className="plugin-install-btn"
          onClick={handleInstall}
          disabled={installing}
        >
          {installing ? 'Installing…' : '+ Install from folder…'}
        </button>
      </div>
    </div>
  )
}

// ─── App ────────────────────────────────────────────────────
export default function App() {
  const [device,        setDevice]        = useState(null)
  const [selectedKey,   setSelectedKey]   = useState(null)
  const [pressedKey,    setPressedKey]    = useState(null)
  const [toggledButtons, setToggledButtons] = useState({}) // { [index]: true } = icon2 latched on
  const [sleeping,      setSleeping]      = useState(false)
  // Incremented on every wake event. Keying the redraw useEffect on this counter
  // avoids a React 18 batching bug: when sleep→wake→sleep→wake happens faster
  // than a render cycle, setSleeping net-equals its previous value so the old
  // useEffect([sleeping]) never fires and hardware buttons are never redrawn.
  const [wakeRevision,  setWakeRevision]  = useState(0)
  // Ref that mirrors 'sleeping' — synchronously readable inside closures/callbacks
  // without stale-closure risk. Updated alongside setSleeping().
  const sleepingRef = useRef(false)
  const [pages,         setPages]         = useState([{}])   // array of page button-config objects
  const [currentPage,   setCurrentPage]   = useState(0)
  const [folderPath,    setFolderPath]    = useState([])     // indices into nested folders
  const [iconSize,      setIconSize]      = useState(72)
  const [contextMenu,   setContextMenu]   = useState(null)
  const [clipboard,     setClipboard]     = useState(null)
  const [activeProfile, setActiveProfile] = useState('Default Profile')
  const [profiles,      setProfiles]      = useState(['Default Profile'])
  const [livePreviews,         setLivePreviews]         = useState({})   // canvas snapshots for dynamic buttons
  const [obsScenes,            setObsScenes]            = useState([])    // scene names fetched from OBS
  const [obsSceneCollections,  setObsSceneCollections]  = useState([])    // scene collection names
  const [obsInputs,            setObsInputs]            = useState([])    // audio/media input names
  const [obsTransitions,       setObsTransitions]       = useState([])    // scene transition names
  const [appVersion,           setAppVersion]           = useState('')
  const [pluginManifests,      setPluginManifests]      = useState([])    // installed .sdPlugin manifests
  const [showPluginBrowser,    setShowPluginBrowser]    = useState(false) // plugin browser modal

  // Fetch app version once on mount
  useEffect(() => {
    window.streamDeck?.getAppVersion().then(v => { if (v) setAppVersion(v) })
  }, [])

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

  // Keeps toggledButtons accessible inside event handlers without re-registering them
  const toggledButtonsRef  = useRef({})
  useEffect(() => { toggledButtonsRef.current = toggledButtons }, [toggledButtons])

  // Tracks in-flight pressed-icon draws so keyUp can sequence after them
  const pressedIconDrawRef = useRef({})

  // OBS WebSocket refs (renderer-side connection — no IPC needed)
  const obsRef               = useRef(null)
  const obsConnectedRef      = useRef(false)
  const obsReconnectTimerRef = useRef(null)
  const obsConnectFnRef      = useRef(null)

  // Composite icon + title on canvas → send RGBA to hardware
  const drawHardwareButton = async (index, config) => {
    if (!window.streamDeck?.setButtonIcon || !iconSize) return
    stopGifAnimation(index)                              // always cancel existing animation
    stopDynamicButton(index)                             // always cancel dynamic ticker
    const { iconDataUrl, title, bgColor } = config || {}

    // Dynamic display button → hand off to live ticker
    if (config?.action?.type === 'clock')          { startClockButton(index, config);         return }
    if (config?.action?.type === 'system-monitor') { startSystemMonitorButton(index, config); return }
    if (config?.action?.type === 'volume' && config?.action?.operation === 'display-only') { startVolumeDisplay(index, config); return }
    if (config?.action?.type === 'volume' && config?.action?.operation === 'mute-toggle')  { startMuteDisplay(index, config);  return }
    if (config?.action?.type === 'volume' && (config?.action?.operation === 'raise' || config?.action?.operation === 'lower')) {
      // Static one-shot draw — no polling loop needed
      if (iconDataUrl || title) { /* fall through to normal static draw below */ }
      else {
        const op = config.action.operation
        const { bgColor: bg = '#000000', textColor: tc = '#00aaff' } = config.action
        const cvs = document.createElement('canvas')
        cvs.width = cvs.height = iconSize
        const c = cvs.getContext('2d')
        c.fillStyle = bg; c.fillRect(0, 0, iconSize, iconSize)
        c.textAlign = 'center'; c.textBaseline = 'middle'
        c.font = `${Math.round(iconSize * 0.40)}px sans-serif`
        c.fillText(op === 'raise' ? '🔊' : '🔈', iconSize / 2, Math.round(iconSize * 0.38))
        c.font = `bold ${Math.round(iconSize * 0.19)}px -apple-system, sans-serif`
        c.fillStyle = tc
        c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 4
        c.fillText(op === 'raise' ? 'VOL +' : 'VOL -', iconSize / 2, Math.round(iconSize * 0.76))
        setLivePreviews(prev => ({ ...prev, [index]: cvs.toDataURL() }))
        const { data } = c.getImageData(0, 0, iconSize, iconSize)
        window.streamDeck?.setButtonIcon(index, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
        return
      }
    }
    if (config?.action?.type === 'media' && config?.action?.command === 'display-only') { startMediaDisplay(index, config); return }
    if (config?.action?.type === 'media' && config?.action?.command && config.action.command !== 'display-only') {
      if (iconDataUrl || title) { /* fall through to normal static draw below */ }
      else {
        const cmd = config.action.command
        const { bgColor: bg = '#000000', textColor: tc = '#ffffff' } = config.action
        const MEDIA_ICONS = { 'play-pause': '⏯', next: '⏭', previous: '⏮', stop: '⏹' }
        const MEDIA_LABELS = { 'play-pause': 'PLAY/PAUSE', next: 'NEXT', previous: 'PREV', stop: 'STOP' }
        const cvs = document.createElement('canvas')
        cvs.width = cvs.height = iconSize
        const c = cvs.getContext('2d')
        c.fillStyle = bg; c.fillRect(0, 0, iconSize, iconSize)
        c.textAlign = 'center'; c.textBaseline = 'middle'
        c.font = `${Math.round(iconSize * 0.44)}px sans-serif`
        c.fillText(MEDIA_ICONS[cmd] ?? '🎵', iconSize / 2, Math.round(iconSize * 0.40))
        c.font = `bold ${Math.round(iconSize * 0.16)}px -apple-system, sans-serif`
        c.fillStyle = tc; c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 4
        c.fillText(MEDIA_LABELS[cmd] ?? cmd.toUpperCase(), iconSize / 2, Math.round(iconSize * 0.78))
        setLivePreviews(prev => ({ ...prev, [index]: cvs.toDataURL() }))
        const { data } = c.getImageData(0, 0, iconSize, iconSize)
        window.streamDeck?.setButtonIcon(index, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
        return
      }
    }
    if (config?.action?.type === 'obs') {
      if (iconDataUrl || title) { /* fall through to normal static draw */ }
      else if (config.action.operation === 'switch-scene') {
        // Static one-shot draw for scene-switch buttons — no polling needed
        const scene = config.action.sceneName || 'Scene'
        const { bgColor: bg = '#000000', textColor: tc = '#ffffff' } = config.action
        const cvs = document.createElement('canvas')
        cvs.width = cvs.height = iconSize
        const c = cvs.getContext('2d')
        c.fillStyle = bg; c.fillRect(0, 0, iconSize, iconSize)
        c.textAlign = 'center'; c.textBaseline = 'middle'
        c.font = `${Math.round(iconSize * 0.36)}px sans-serif`
        c.fillText('🎬', iconSize / 2, Math.round(iconSize * 0.38))
        c.font = `bold ${Math.round(iconSize * 0.14)}px -apple-system, sans-serif`
        c.fillStyle = tc; c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 4
        const label = scene.length > 8 ? scene.slice(0, 7) + '\u2026' : scene
        c.fillText(label, iconSize / 2, Math.round(iconSize * 0.78))
        setLivePreviews(prev => ({ ...prev, [index]: cvs.toDataURL() }))
        const { data } = c.getImageData(0, 0, iconSize, iconSize)
        window.streamDeck?.setButtonIcon(index, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
        return
      } else {
        startObsStatusDisplay(index, config); return
      }
    }

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
      if (sleepingRef.current) return   // sleep fired while image was decoding — discard stale draw
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
    window.streamDeck.setButtonIcon(index, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
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

  // ── Dynamic button manager (clock, CPU, media, OBS) ──────────
  // dynamicButtonsRef: { [buttonIndex]: { token: object, timer: number|null } }
  const dynamicButtonsRef = useRef({})

  const stopDynamicButton = (index) => {
    const d = dynamicButtonsRef.current[index]
    if (d) {
      if (d.timer != null) clearTimeout(d.timer)
      delete dynamicButtonsRef.current[index]
    }
    setLivePreviews(prev => {
      if (!prev[index]) return prev
      const next = { ...prev }
      delete next[index]
      return next
    })
  }

  const stopAllDynamicButtons = () => {
    for (const d of Object.values(dynamicButtonsRef.current)) {
      if (d?.timer != null) clearTimeout(d.timer)
    }
    dynamicButtonsRef.current = {}
    setLivePreviews({})
  }

  const stopAllDynamicButtonsRef = useRef(null)
  stopAllDynamicButtonsRef.current = stopAllDynamicButtons

  // ── Plugin 1: Clock / Date display ───────────────────────────
  const startClockButton = (index, config) => {
    const token = {}
    dynamicButtonsRef.current[index] = { token, timer: null }
    const { format = 'HH:MM', bgColor = '#000000', textColor = '#ffffff' } = config?.action ?? {}

    // One canvas/ctx per button instance — reused every tick to avoid GPU context churn
    const canvas = document.createElement('canvas')
    canvas.width  = iconSize
    canvas.height = iconSize
    const ctx = canvas.getContext('2d')

    const drawClock = () => {
      if (dynamicButtonsRef.current[index]?.token !== token) return

      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, iconSize, iconSize)

      const lines = formatClock(new Date(), format)
      const lineCount = lines.length || 1
      const fontSize = Math.round(iconSize * (lineCount > 1 ? 0.20 : 0.26))
      ctx.font         = `bold ${fontSize}px -apple-system, sans-serif`
      ctx.fillStyle    = textColor
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor  = 'rgba(0,0,0,0.7)'
      ctx.shadowBlur   = 4

      const lineHeight = iconSize / (lineCount + 1)
      lines.forEach((line, i) => {
        ctx.fillText(line, iconSize / 2, lineHeight * (i + 1))
      })

      const { data } = ctx.getImageData(0, 0, iconSize, iconSize)
      if (!sleepingRef.current) setLivePreviews(prev => ({ ...prev, [index]: canvas.toDataURL() }))
      window.streamDeck?.setButtonIcon(index, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))

      // Align tick to the next second boundary
      const msToNext = 1000 - (Date.now() % 1000)
      dynamicButtonsRef.current[index].timer = setTimeout(drawClock, msToNext)
    }

    drawClock()
  }

  // ── Plugin 2: CPU / RAM display ───────────────────────────────
  const startSystemMonitorButton = (index, config) => {
    const token = {}
    dynamicButtonsRef.current[index] = { token, timer: null }
    const { bgColor = '#000000', textColor = '#00ff88', showCpu = true, showRam = true } = config?.action ?? {}

    // One canvas/ctx per button instance — reused every tick to avoid GPU context churn
    const canvas = document.createElement('canvas')
    canvas.width  = iconSize
    canvas.height = iconSize
    const ctx = canvas.getContext('2d')

    const draw = async () => {
      if (dynamicButtonsRef.current[index]?.token !== token) return
      const stats = await window.streamDeck?.getSystemStats?.() ?? {}
      if (dynamicButtonsRef.current[index]?.token !== token) return

      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, iconSize, iconSize)

      const lines = []
      if (showCpu) lines.push(`CPU ${stats.cpuPercent ?? 0}%`)
      if (showRam) lines.push(`RAM ${stats.ramPercent ?? 0}%`)
      if (!lines.length) lines.push('—')

      const lineCount = lines.length
      const fontSize  = Math.round(iconSize * (lineCount > 1 ? 0.20 : 0.26))
      ctx.font         = `bold ${fontSize}px -apple-system, sans-serif`
      ctx.fillStyle    = textColor
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor  = 'rgba(0,0,0,0.7)'
      ctx.shadowBlur   = 4
      const lineHeight = iconSize / (lineCount + 1)
      lines.forEach((line, i) => ctx.fillText(line, iconSize / 2, lineHeight * (i + 1)))

      const { data } = ctx.getImageData(0, 0, iconSize, iconSize)
      if (!sleepingRef.current) setLivePreviews(prev => ({ ...prev, [index]: canvas.toDataURL() }))
      window.streamDeck?.setButtonIcon(index, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      dynamicButtonsRef.current[index].timer = setTimeout(draw, 2000)
    }

    draw()
  }

  // ── Plugin 3: Volume display ──────────────────────────────────
  const startVolumeDisplay = (index, config) => {
    const token = {}
    dynamicButtonsRef.current[index] = { token, timer: null }
    const { bgColor = '#000000', textColor = '#00aaff', sink = '@DEFAULT_SINK@' } = config?.action ?? {}

    // One canvas/ctx per button instance — reused every tick to avoid GPU context churn
    const canvas = document.createElement('canvas')
    canvas.width  = iconSize
    canvas.height = iconSize
    const ctx = canvas.getContext('2d')

    const draw = async () => {
      if (dynamicButtonsRef.current[index]?.token !== token) return
      const result = await window.streamDeck?.getVolume?.(sink) ?? {}
      if (dynamicButtonsRef.current[index]?.token !== token) return

      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, iconSize, iconSize)

      const pct = result.percent ?? 0

      // Percentage text
      const fontSize = Math.round(iconSize * 0.26)
      ctx.font         = `bold ${fontSize}px -apple-system, sans-serif`
      ctx.fillStyle    = textColor
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor  = 'rgba(0,0,0,0.7)'
      ctx.shadowBlur   = 4
      ctx.fillText(`${pct}%`, iconSize / 2, Math.round(iconSize * 0.40))

      // Bar background
      const barW = Math.round(iconSize * 0.70)
      const barH = Math.round(iconSize * 0.10)
      const barX = (iconSize - barW) / 2
      const barY = Math.round(iconSize * 0.62)
      ctx.fillStyle = 'rgba(255,255,255,0.15)'
      ctx.fillRect(barX, barY, barW, barH)
      ctx.fillStyle = textColor
      ctx.fillRect(barX, barY, Math.round(barW * pct / 100), barH)

      const { data } = ctx.getImageData(0, 0, iconSize, iconSize)
      if (!sleepingRef.current) setLivePreviews(prev => ({ ...prev, [index]: canvas.toDataURL() }))
      window.streamDeck?.setButtonIcon(index, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      dynamicButtonsRef.current[index].timer = setTimeout(draw, 2000)
    }

    draw()
  }

  // ── Plugin 3b: Mute indicator display ────────────────────────
  const startMuteDisplay = (index, config) => {
    const token = {}
    dynamicButtonsRef.current[index] = { token, timer: null }
    const { bgColor = '#000000', sink = '@DEFAULT_SINK@' } = config?.action ?? {}

    // One canvas/ctx per button instance — reused every tick to avoid GPU context churn
    const canvas = document.createElement('canvas')
    canvas.width  = iconSize
    canvas.height = iconSize
    const ctx = canvas.getContext('2d')

    const draw = async () => {
      if (dynamicButtonsRef.current[index]?.token !== token) return
      const result = await window.streamDeck?.getMute?.(sink) ?? {}
      if (dynamicButtonsRef.current[index]?.token !== token) return

      const muted = result.muted ?? false

      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, iconSize, iconSize)

      // Speaker emoji — large, centred
      ctx.font         = `${Math.round(iconSize * 0.52)}px sans-serif`
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(muted ? '🔇' : '🔊', iconSize / 2, Math.round(iconSize * 0.43))

      // Status label below
      const fs = Math.round(iconSize * 0.16)
      ctx.font      = `bold ${fs}px -apple-system, sans-serif`
      ctx.fillStyle = muted ? '#ff4444' : '#00aaff'
      ctx.shadowColor = 'rgba(0,0,0,0.9)'
      ctx.shadowBlur  = 4
      ctx.fillText(muted ? 'MUTED' : 'SOUND ON', iconSize / 2, Math.round(iconSize * 0.82))

      const { data } = ctx.getImageData(0, 0, iconSize, iconSize)
      if (!sleepingRef.current) setLivePreviews(prev => ({ ...prev, [index]: canvas.toDataURL() }))
      window.streamDeck?.setButtonIcon(index, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      dynamicButtonsRef.current[index].timer = setTimeout(draw, 1000)
    }

    draw()
  }

  // ── Plugin 4: Media display ───────────────────────────────────
  const startMediaDisplay = (index, config) => {
    const token = {}
    dynamicButtonsRef.current[index] = { token, timer: null }
    const { bgColor = '#000000', textColor = '#ffffff', player = '%any' } = config?.action ?? {}

    // One canvas/ctx per button instance — reused every tick to avoid GPU context churn
    const canvas = document.createElement('canvas')
    canvas.width  = iconSize
    canvas.height = iconSize
    const ctx = canvas.getContext('2d')

    const draw = async () => {
      if (dynamicButtonsRef.current[index]?.token !== token) return
      const info = await window.streamDeck?.playerctlStatus?.(player) ?? null
      if (dynamicButtonsRef.current[index]?.token !== token) return

      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, iconSize, iconSize)

      if (!info) {
        // No active player
        ctx.fillStyle = 'rgba(255,255,255,0.25)'
        ctx.font = `${Math.round(iconSize * 0.30)}px sans-serif`
        ctx.textAlign    = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('⏹', iconSize / 2, iconSize / 2)
      } else {
        const isPlaying = info.status === 'Playing'

        // Status icon top-centre
        ctx.font = `${Math.round(iconSize * 0.22)}px sans-serif`
        ctx.fillStyle    = isPlaying ? '#1db954' : 'rgba(255,255,255,0.45)'
        ctx.textAlign    = 'center'
        ctx.textBaseline = 'top'
        ctx.fillText(isPlaying ? '▶' : '⏸', iconSize / 2, Math.round(iconSize * 0.06))

        // Truncate helper
        const truncate = (s, maxPx) => {
          if (!s) return ''
          if (ctx.measureText(s).width <= maxPx) return s
          let t = s
          while (t.length > 1 && ctx.measureText(t + '…').width > maxPx) t = t.slice(0, -1)
          return t + '…'
        }

        const maxW = iconSize * 0.90
        ctx.shadowColor = 'rgba(0,0,0,0.9)'
        ctx.shadowBlur  = 4

        // Title
        const fs1 = Math.round(iconSize * 0.16)
        ctx.font = `bold ${fs1}px -apple-system, sans-serif`
        ctx.fillStyle    = textColor
        ctx.textBaseline = 'middle'
        ctx.fillText(truncate(info.title || '—', maxW), iconSize / 2, Math.round(iconSize * 0.52))

        // Artist
        const fs2 = Math.round(iconSize * 0.13)
        ctx.font = `${fs2}px -apple-system, sans-serif`
        ctx.fillStyle = 'rgba(255,255,255,0.55)'
        if (info.artist) ctx.fillText(truncate(info.artist, maxW), iconSize / 2, Math.round(iconSize * 0.72))
      }

      const { data } = ctx.getImageData(0, 0, iconSize, iconSize)
      if (!sleepingRef.current) setLivePreviews(prev => ({ ...prev, [index]: canvas.toDataURL() }))
      window.streamDeck?.setButtonIcon(index, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      dynamicButtonsRef.current[index].timer = setTimeout(draw, 3000)
    }

    draw()
  }

  // ── Plugin 5: OBS WebSocket status display ────────────────────
  const startObsStatusDisplay = (index, config) => {
    const token = {}
    dynamicButtonsRef.current[index] = { token, timer: null }
    const { bgColor = '#000000' } = config?.action ?? {}

    // One canvas/ctx per button instance — reused every tick to avoid GPU context churn
    const canvas = document.createElement('canvas')
    canvas.width  = iconSize
    canvas.height = iconSize
    const ctx = canvas.getContext('2d')

    const draw = async () => {
      if (dynamicButtonsRef.current[index]?.token !== token) return

      let isRecording  = false
      let isStreaming  = false
      let isConnected  = obsConnectedRef.current

      if (isConnected && obsRef.current) {
        try {
          // Wrap each call in a 5-second timeout so a stale connection that
          // never fires ConnectionClosed doesn't freeze the draw loop.
          const withTimeout = (p) => {
            let t
            const tPromise = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('OBS call timeout')), 5000) })
            return Promise.race([p, tPromise]).finally(() => clearTimeout(t))
          }
          const [recStatus, streamStatus] = await Promise.all([
            withTimeout(obsRef.current.call('GetRecordStatus')),
            withTimeout(obsRef.current.call('GetStreamStatus')),
          ])
          isRecording = recStatus?.outputActive  ?? false
          isStreaming = streamStatus?.outputActive ?? false
        } catch {
          isConnected = false
        }
      }

      if (dynamicButtonsRef.current[index]?.token !== token) return

      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, iconSize, iconSize)

      // Status dot
      const dotR = Math.round(iconSize * 0.12)
      const dotX = iconSize / 2
      const dotY = Math.round(iconSize * 0.30)
      ctx.beginPath()
      ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2)
      ctx.fillStyle = !isConnected ? '#555555' : isRecording ? '#ff2020' : isStreaming ? '#ff6600' : '#22aa22'
      ctx.fill()

      // Status label
      const label   = !isConnected ? 'OBS OFF' : isRecording ? 'REC' : isStreaming ? 'LIVE' : 'READY'
      const fontSize = Math.round(iconSize * 0.17)
      ctx.font = `bold ${fontSize}px -apple-system, sans-serif`
      ctx.fillStyle    = '#ffffff'
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.shadowColor  = 'rgba(0,0,0,0.8)'
      ctx.shadowBlur   = 4
      ctx.fillText(label, iconSize / 2, Math.round(iconSize * 0.64))

      const { data } = ctx.getImageData(0, 0, iconSize, iconSize)
      if (!sleepingRef.current) setLivePreviews(prev => ({ ...prev, [index]: canvas.toDataURL() }))
      window.streamDeck?.setButtonIcon(index, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      dynamicButtonsRef.current[index].timer = setTimeout(draw, 3000)
    }

    draw()
  }

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
    setToggledButtons({})
    toggledButtonsRef.current = {}
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
    setToggledButtons({})
    toggledButtonsRef.current = {}
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
    setToggledButtons({})
    toggledButtonsRef.current = {}
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
    setToggledButtons({})
    toggledButtonsRef.current = {}
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
    setToggledButtons({})
    toggledButtonsRef.current = {}
    const rows  = deviceRef.current?.rows ?? 3
    const cols  = deviceRef.current?.cols ?? 5
    for (let i = 0; i < rows * cols; i++) drawHardwareButtonRef.current(i, newButtons[i])
  }
  const exitFolderRef = useRef(null)
  exitFolderRef.current = exitFolder
  // ─────────────────────────────────────────────────────────────

  const updateConfig = (index, updates) => {
    const currentButtons = getButtonsAt(pagesRef.current, currentPage, folderPath)
    const next = { title: '', iconDataUrl: null, bgColor: '#262626', ...currentButtons[index], ...updates }
    drawHardwareButton(index, next)
    setPages(prev => immutableSetButton(prev, currentPage, folderPath, index, next))
  }

  // Swap two button configs within the current page/folder (used by grid drag-and-drop)
  const moveButton = (fromIndex, toIndex) => {
    const currentButtons = getButtonsAt(pagesRef.current, currentPageRef.current, folderPathRef.current)
    const fromConfig = currentButtons[fromIndex] ?? null
    const toConfig   = currentButtons[toIndex]   ?? null
    setPages(prev => {
      const step1 = immutableSetButton(prev, currentPageRef.current, folderPathRef.current, toIndex,   fromConfig)
      return          immutableSetButton(step1, currentPageRef.current, folderPathRef.current, fromIndex, toConfig)
    })
    drawHardwareButton(fromIndex, toConfig)
    drawHardwareButton(toIndex,   fromConfig)
    // Keep the selection tracking the button that moved
    setSelectedKey(prev => {
      if (prev === fromIndex) return toIndex
      if (prev === toIndex)   return fromIndex
      return prev
    })
  }

  const clearButton = (index) => {
    drawHardwareButton(index, null)
    setPages(prev => immutableSetButton(prev, currentPage, folderPath, index, null))
    if (toggledButtonsRef.current[index]) {
      delete toggledButtonsRef.current[index]
      setToggledButtons(prev => {
        const next = { ...prev }
        delete next[index]
        return next
      })
    }
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
    // Load installed plugins
    window.streamDeck.listPlugins?.().then(list => {
      if (Array.isArray(list)) setPluginManifests(list)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle messages relayed from plugin child processes (setSettings, sendToPropertyInspector)
  useEffect(() => {
    if (!window.streamDeck?.onPluginMessage) return
    return window.streamDeck.onPluginMessage(msg => {
      if (msg.event === 'sendToPropertyInspector') {
        window.dispatchEvent(new CustomEvent('plugin:toInspector', { detail: msg }))
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-connect to OBS WebSocket (localhost:4455, no password) on mount
  useEffect(() => {
    const connect = async () => {
      if (obsConnectedRef.current) return
      // Declare obs before try so the catch block can call obs.disconnect()
      // on the newly-created (but failed) instance — not the stale obsRef.current.
      let obs = null
      try {
        obs = new OBSWebSocket()
        obs.on('ConnectionClosed', () => {
          // Guard: only act if this specific obs instance is the one we stored.
          // For a failed initial connect obs is never stored in obsRef, so this
          // returns early and avoids creating a second (duplicate) retry timer.
          if (obsRef.current !== obs) return
          obsConnectedRef.current = false
          obsRef.current = null
          setObsScenes([])
          if (obsReconnectTimerRef.current != null) clearTimeout(obsReconnectTimerRef.current)
          obsReconnectTimerRef.current = setTimeout(() => obsConnectFnRef.current?.(), 5000)
        })
        // Race the connect against a 3-second timeout so a firewalled / slow port
        // doesn't block for the OS TCP-timeout period (30–60 s).
        let connectTimeout
        const timeoutPromise = new Promise((_, reject) => {
          connectTimeout = setTimeout(() => reject(new Error('OBS connect timeout')), 3000)
        })
        await Promise.race([obs.connect('ws://localhost:4455', undefined), timeoutPromise])
          .finally(() => clearTimeout(connectTimeout))
        if (obsReconnectTimerRef.current != null) {
          clearTimeout(obsReconnectTimerRef.current)
          obsReconnectTimerRef.current = null
        }
        obsRef.current = obs
        obsConnectedRef.current = true
        // Fetch all OBS data and keep lists up to date
        const sortScenes = (scenes = []) =>
          [...scenes].sort((a, b) => (b.sceneIndex ?? 0) - (a.sceneIndex ?? 0)).map(s => s.sceneName).filter(Boolean)
        try { const { scenes } = await obs.call('GetSceneList'); setObsScenes(sortScenes(scenes)) } catch {}
        try { const { sceneCollections } = await obs.call('GetSceneCollectionList'); setObsSceneCollections((sceneCollections ?? []).map(c => c.sceneCollectionName ?? c).filter(Boolean)) } catch {}
        try { const { inputs } = await obs.call('GetInputList'); setObsInputs((inputs ?? []).map(i => i.inputName).filter(Boolean)) } catch {}
        try { const { transitions } = await obs.call('GetSceneTransitionList'); setObsTransitions((transitions ?? []).map(t => t.transitionName).filter(Boolean)) } catch {}
        obs.on('SceneListChanged',           (data) => setObsScenes(sortScenes(data?.scenes)))
        obs.on('SceneCollectionListChanged', (data) => setObsSceneCollections((data?.sceneCollections ?? []).map(c => c.sceneCollectionName ?? c).filter(Boolean)))
        obs.on('InputCreated',               ()     => obs.call('GetInputList').then(r => setObsInputs((r.inputs ?? []).map(i => i.inputName).filter(Boolean))).catch(() => {}))
        obs.on('InputRemoved',               ()     => obs.call('GetInputList').then(r => setObsInputs((r.inputs ?? []).map(i => i.inputName).filter(Boolean))).catch(() => {}))
      } catch {
        // OBS not running / not reachable — will retry after 5 s.
        // Disconnect the new obs instance (not obsRef.current which is null here).
        try { obs?.disconnect() } catch {}
        obs = null
        obsRef.current = null
        setObsScenes([])
        setObsSceneCollections([])
        setObsInputs([])
        setObsTransitions([])
        if (obsReconnectTimerRef.current != null) clearTimeout(obsReconnectTimerRef.current)
        obsReconnectTimerRef.current = setTimeout(() => obsConnectFnRef.current?.(), 5000)
      }
    }
    obsConnectFnRef.current = connect
    connect()
    return () => {
      if (obsReconnectTimerRef.current != null) clearTimeout(obsReconnectTimerRef.current)
      obsRef.current?.disconnect()
      obsConnectedRef.current = false
    }
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
      // If a pressed icon is configured, flash it on the hardware button.
      // Store the promise so the keyUp handler can wait for it before
      // restoring the default icon — prevents the two async draws racing.
      const config = buttonConfigsRef.current[index]
      if (config?.pressedIconDataUrl) {
        pressedIconDrawRef.current[index] = drawHardwareButtonRef.current(
          index,
          { ...config, iconDataUrl: config.pressedIconDataUrl }
        )
      }
      const action = config?.action
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
      } else if (action?.type === 'volume' && action.operation && action.operation !== 'display-only') {
        const step = action.step ?? 5
        const sink = action.sink || '@DEFAULT_SINK@'
        if (action.operation === 'raise') {
          window.streamDeck.pactlCommand(['set-sink-volume', sink, `+${step}%`])
        } else if (action.operation === 'lower') {
          window.streamDeck.pactlCommand(['set-sink-volume', sink, `-${step}%`])
        } else if (action.operation === 'mute-toggle') {
          window.streamDeck.pactlCommand(['set-sink-mute', sink, 'toggle'])
        }
      } else if (action?.type === 'media' && action.command && action.command !== 'display-only') {
        window.streamDeck.playerctlCommand(action.command, action.player || '%any')
      } else if (action?.type?.startsWith('obs-') && obsConnectedRef.current && obsRef.current) {
        const obs = obsRef.current
        ;(async () => {
          try {
            if (action.type === 'obs-record') {
              await obs.call('ToggleRecord')
            } else if (action.type === 'obs-record-pause') {
              await obs.call('ToggleRecordPause')
            } else if (action.type === 'obs-stream') {
              await obs.call('ToggleStream')
            } else if (action.type === 'obs-replay-buffer') {
              await obs.call('ToggleReplayBuffer')
            } else if (action.type === 'obs-save-replay') {
              await obs.call('SaveReplayBuffer')
            } else if (action.type === 'obs-studio-mode') {
              await obs.call('ToggleStudioMode')
            } else if (action.type === 'obs-preview-scene') {
              await obs.call('TriggerStudioModeTransition')
            } else if (action.type === 'obs-scene' && action.sceneName) {
              await obs.call('SetCurrentProgramScene', { sceneName: action.sceneName })
            } else if (action.type === 'obs-scene-collection' && action.collectionName) {
              await obs.call('SetCurrentSceneCollection', { sceneCollectionName: action.collectionName })
            } else if (action.type === 'obs-mute' && action.inputName) {
              await obs.call('ToggleInputMute', { inputName: action.inputName })
            } else if (action.type === 'obs-media' && action.inputName) {
              await obs.call('TriggerMediaInputAction', { inputName: action.inputName, mediaAction: action.mediaAction ?? 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE' })
            } else if (action.type === 'obs-source' && action.sceneName && action.sourceName) {
              // Fetch current visibility then toggle
              const { sceneItems } = await obs.call('GetSceneItemList', { sceneName: action.sceneName })
              const item = sceneItems?.find(i => i.sourceName === action.sourceName)
              if (item != null) {
                await obs.call('SetSceneItemEnabled', { sceneName: action.sceneName, sceneItemId: item.sceneItemId, sceneItemEnabled: !item.sceneItemEnabled })
              }
            } else if (action.type === 'obs-filter' && action.sourceName && action.filterName) {
              // Fetch current enabled state then toggle
              const { filterEnabled } = await obs.call('GetSourceFilter', { sourceName: action.sourceName, filterName: action.filterName })
              await obs.call('SetSourceFilterEnabled', { sourceName: action.sourceName, filterName: action.filterName, filterEnabled: !filterEnabled })
            } else if (action.type === 'obs-screenshot' && action.sourceName) {
              const filePath = action.imageFilePath || `/tmp/obs-screenshot-${Date.now()}.png`
              await obs.call('SaveSourceScreenshot', { sourceName: action.sourceName, imageFormat: 'png', imageFilePath: filePath })
            } else if (action.type === 'obs-transition' && action.transitionName) {
              await obs.call('SetCurrentSceneTransitionOverride', { transitionName: action.transitionName })
            } else if (action.type === 'obs-chapter-marker') {
              await obs.call('SendStreamCaption', { captionText: action.captionText ?? '' })
            } else if (action.type?.includes('.')) {
              // Plugin action — dispatch keyDown to plugin process
              const context = JSON.stringify({ index, actionUUID: action.type, pluginUUID: action.pluginUUID })
              window.streamDeck?.sendToPlugin?.(action.pluginUUID, action.type, 'keyDown', { ...action }, context)
            }
          } catch (err) {
            console.warn('[OBS] action failed:', err.message)
          }
        })()
      }
    })
    const offUp = window.streamDeck.onKeyUp(({ index }) => {
      setPressedKey(p => p === index ? null : p)
      const config = buttonConfigsRef.current[index]
      // Forward keyUp to plugin processes (needed for Push-to-Talk / Push-to-Mute)
      if (config?.type?.includes('.')) {
        const context = JSON.stringify({ index, actionUUID: config.type, pluginUUID: config.pluginUUID })
        window.streamDeck?.sendToPlugin?.(config.pluginUUID, config.type, 'keyUp', { ...config }, context)
      }

      if (config?.pressedIconDataUrl) {
        // Toggle: flip latch state and draw the newly-active icon
        const wasLatched = toggledButtonsRef.current[index]
        const nowLatched = !wasLatched
        toggledButtonsRef.current[index] = nowLatched
        setToggledButtons(prev => ({ ...prev, [index]: nowLatched }))

        const targetUrl  = nowLatched ? config.pressedIconDataUrl : config.iconDataUrl
        const restore    = () => drawHardwareButton(index, { ...config, iconDataUrl: targetUrl })
        const pending    = pressedIconDrawRef.current[index]
        if (pending) {
          pressedIconDrawRef.current[index] = null
          Promise.resolve(pending).then(restore, restore)
        } else {
          restore()
        }
      } else {
        // No pressed icon configured — just redraw the default
        const restore = () => drawHardwareButton(index, config)
        const pending = pressedIconDrawRef.current[index]
        if (pending) {
          pressedIconDrawRef.current[index] = null
          Promise.resolve(pending).then(restore, restore)
        } else {
          restore()
        }
      }
    })
    const offSleep       = window.streamDeck.onSleep(() => { console.log('[Renderer] Sleep received'); sleepingRef.current = true;  stopAllGifAnimationsRef.current?.(); stopAllDynamicButtonsRef.current?.(); setSleeping(true); setSelectedKey(null) })
    const offWake        = window.streamDeck.onWake(()  => { console.log('[Renderer] Wake received');  sleepingRef.current = false; setSleeping(false); setWakeRevision(r => r + 1) })
    const offDisconnect  = window.streamDeck.onDisconnect?.(() => {
      stopAllGifAnimationsRef.current?.()
      stopAllDynamicButtonsRef.current?.()
      setDevice(null)
      sleepingRef.current = false
      setSleeping(false)
    })
    return () => { offInfo(); offDown(); offUp(); offSleep(); offWake(); offDisconnect?.() }
  }, [])

  // When waking, re-draw every hardware button with the stored config.
  // Keyed on wakeRevision (not sleeping) so it fires even when rapid
  // sleep/wake cycles cause React to batch sleeping back to its previous value.
  useEffect(() => {
    const entries = Object.entries(buttonConfigsRef.current)
    console.log(`[Renderer] Wake redraw rev=${wakeRevision} — ${entries.length} button(s)`)
    entries.forEach(([idx, cfg]) => {
      drawHardwareButton(Number(idx), cfg)
    })
  }, [wakeRevision]) // eslint-disable-line react-hooks/exhaustive-deps

  // On reconnect: hardware is dark — redraw all buttons from current config
  useEffect(() => {
    if (!device) return
    const entries = Object.entries(buttonConfigsRef.current)
    if (!entries.length) return  // first startup: profile-load effect handles drawing
    const total = (device.rows ?? 3) * (device.cols ?? 5)
    for (let i = 0; i < total; i++) {
      drawHardwareButtonRef.current(i, buttonConfigsRef.current[i])
    }
  }, [device]) // eslint-disable-line react-hooks/exhaustive-deps

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
          <img src="./tss.png" className="app-logo" alt="TSS" />
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

          <button className="icon-btn" title="Plugins" onClick={() => setShowPluginBrowser(true)}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" width="16" height="16">
              <rect x="2" y="2" width="5.5" height="5.5" rx="1" />
              <rect x="8.5" y="2" width="5.5" height="5.5" rx="1" />
              <rect x="2" y="8.5" width="5.5" height="5.5" rx="1" />
              <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" />
            </svg>
          </button>

          <button className="icon-btn" title="Settings">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="8" cy="8" r="2.5" />
              <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.27 1.27M11.33 11.33l1.27 1.27M3.4 12.6l1.27-1.27M11.33 4.67l1.27-1.27" />
            </svg>
          </button>
          {appVersion && <span className="app-version">v{appVersion}-{__GIT_HASH__}</span>}
        </div>
      </header>

      {/* ── Workspace ── */}
      <div className="workspace">
        <ActionsPanel pluginManifests={pluginManifests} />

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
                  toggledButtons={toggledButtons}
                  onSelectKey={handleSelect}
                  buttonConfigs={buttonConfigs}
                  livePreviews={livePreviews}
                  onContextMenu={(e, i) => setContextMenu({ x: e.clientX, y: e.clientY, keyIndex: i })}
                  onMoveButton={moveButton}
                  onDropAction={(index, actionId) => {
                    const action = ACTION_DEFAULTS[actionId]
                    if (action) {
                      updateConfig(index, { action })
                      setSelectedKey(index)
                      return
                    }
                    // Plugin actions have a dot in their UUID (reverse-DNS)
                    if (actionId.includes('.')) {
                      const plugin = pluginManifests.find(p =>
                        (p.Actions || []).some(a => a.UUID === actionId)
                      )
                      if (!plugin) return
                      updateConfig(index, { action: { type: actionId, pluginUUID: plugin.UUID } })
                      setSelectedKey(index)
                    }
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
            obsScenes={obsScenes}
            obsInputs={obsInputs}
            obsTransitions={obsTransitions}
            obsSceneCollections={obsSceneCollections}
            pluginManifests={pluginManifests}
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

      {showPluginBrowser && (
        <PluginBrowser
          pluginManifests={pluginManifests}
          onInstall={() => window.streamDeck?.listPlugins?.().then(list => { if (Array.isArray(list)) setPluginManifests(list) })}
          onClose={() => setShowPluginBrowser(false)}
        />
      )}
    </div>
  )
}

