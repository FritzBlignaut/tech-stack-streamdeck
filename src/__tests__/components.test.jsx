// @vitest-environment jsdom
/**
 * Component tests for ButtonGrid and ActionSection.
 *
 * obs-websocket-js and gifuct-js are mocked at the top so that importing
 * App.jsx doesn't require a real WebSocket connection or GIF decoder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'

// ── Module mocks (must come before the imports that trigger them) ──────────────

vi.mock('obs-websocket-js', () => ({
  default: class OBSWebSocket {
    connect()    { return Promise.resolve() }
    disconnect() {}
    call()       { return Promise.resolve({}) }
    on()         {}
    off()        {}
  },
}))

vi.mock('gifuct-js', () => ({
  parseGIF:        () => ({ lsd: { width: 72, height: 72 } }),
  decompressFrames: () => [],
}))

// Stub window.streamDeck so useEffect hooks in App don't throw
beforeEach(() => {
  global.window.streamDeck = {
    onDeckKey:      vi.fn(() => () => {}),
    onDeckWake:     vi.fn(() => () => {}),
    onDeckSleep:    vi.fn(() => () => {}),
    onDeckConnect:  vi.fn(() => () => {}),
    onDeckDisconnect: vi.fn(() => () => {}),
    loadProfile:    vi.fn(() => Promise.resolve(null)),
    saveProfile:    vi.fn(() => Promise.resolve()),
    listProfiles:   vi.fn(() => Promise.resolve(['Default Profile'])),
    getActiveProfile: vi.fn(() => Promise.resolve('Default Profile')),
    getSystemStats: vi.fn(() => Promise.resolve({ cpuPercent: 0, ramPercent: 0, ramUsedMB: 0, ramTotalMB: 0 })),
    setButtonIcon:  vi.fn(() => Promise.resolve()),
  }
})

import { ButtonGrid, ActionSection } from '../App.jsx'

// ─── ButtonGrid ───────────────────────────────────────────────────────────────

describe('ButtonGrid', () => {
  const noop = () => {}

  it('renders rows × cols buttons', () => {
    render(
      <ButtonGrid
        rows={3} cols={5}
        selectedKey={null} pressedKey={null}
        onSelectKey={noop}
        buttonConfigs={{}}
        onContextMenu={noop}
      />
    )
    const buttons = screen.getAllByRole('button')
    expect(buttons).toHaveLength(15)
  })

  it('labels every button with its 1-based position', () => {
    render(
      <ButtonGrid
        rows={2} cols={2}
        selectedKey={null} pressedKey={null}
        onSelectKey={noop}
        buttonConfigs={{}}
        onContextMenu={noop}
      />
    )
    expect(screen.getByLabelText('Button 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Button 4')).toBeInTheDocument()
  })

  it('adds "selected" class to the selected button', () => {
    render(
      <ButtonGrid
        rows={1} cols={5}
        selectedKey={2} pressedKey={null}
        onSelectKey={noop}
        buttonConfigs={{}}
        onContextMenu={noop}
      />
    )
    expect(screen.getByLabelText('Button 3')).toHaveClass('selected')
    expect(screen.getByLabelText('Button 1')).not.toHaveClass('selected')
  })

  it('adds "pressed" class to the pressed button', () => {
    render(
      <ButtonGrid
        rows={1} cols={5}
        selectedKey={null} pressedKey={0}
        onSelectKey={noop}
        buttonConfigs={{}}
        onContextMenu={noop}
      />
    )
    expect(screen.getByLabelText('Button 1')).toHaveClass('pressed')
  })

  it('calls onSelectKey with the button index when clicked', () => {
    const onSelectKey = vi.fn()
    render(
      <ButtonGrid
        rows={1} cols={3}
        selectedKey={null} pressedKey={null}
        onSelectKey={onSelectKey}
        buttonConfigs={{}}
        onContextMenu={noop}
      />
    )
    fireEvent.click(screen.getByLabelText('Button 2'))
    expect(onSelectKey).toHaveBeenCalledWith(1) // 0-indexed
  })

  it('shows button title from buttonConfigs', () => {
    render(
      <ButtonGrid
        rows={1} cols={3}
        selectedKey={null} pressedKey={null}
        onSelectKey={noop}
        buttonConfigs={{ 1: { title: 'My Button', bgColor: '#ff0000' } }}
        onContextMenu={noop}
      />
    )
    expect(screen.getByText('My Button')).toBeInTheDocument()
  })

  it('adds "is-folder" class when button action type is folder', () => {
    render(
      <ButtonGrid
        rows={1} cols={3}
        selectedKey={null} pressedKey={null}
        onSelectKey={noop}
        buttonConfigs={{ 0: { action: { type: 'folder', buttons: {} } } }}
        onContextMenu={noop}
      />
    )
    expect(screen.getByLabelText('Button 1')).toHaveClass('is-folder')
  })

  it('live preview overrides button icon when provided', () => {
    const previewUrl = 'data:image/png;base64,abc123'
    render(
      <ButtonGrid
        rows={1} cols={3}
        selectedKey={null} pressedKey={null}
        onSelectKey={noop}
        buttonConfigs={{}}
        onContextMenu={noop}
        livePreviews={{ 0: previewUrl }}
      />
    )
    const btn = screen.getByLabelText('Button 1')
    // jsdom may wrap the URL in quotes inside url(...)
    expect(btn.style.backgroundImage).toMatch(previewUrl)
  })
})

// ─── ActionSection — OBS ─────────────────────────────────────────────────────

describe('ActionSection — OBS action', () => {
  const obsAction = { type: 'obs', operation: 'toggle-record' }
  const noop = () => {}

  it('renders the OBS Studio action chip', () => {
    render(<ActionSection action={obsAction} onChange={noop} />)
    expect(screen.getByText('OBS Studio')).toBeInTheDocument()
  })

  it('renders the operation select dropdown', () => {
    render(<ActionSection action={obsAction} onChange={noop} />)
    expect(screen.getByDisplayValue('Toggle record')).toBeInTheDocument()
  })

  it('does not show the scene picker when operation is not switch-scene', () => {
    render(<ActionSection action={obsAction} onChange={noop} />)
    expect(screen.queryByText('Scene name')).not.toBeInTheDocument()
  })

  it('shows a text input for scene name when operation=switch-scene and obsScenes=[]', () => {
    const action = { type: 'obs', operation: 'switch-scene', sceneName: '' }
    render(<ActionSection action={action} onChange={noop} obsScenes={[]} />)
    expect(screen.getByText('Scene name')).toBeInTheDocument()
    // should render an <input type="text">, not a <select>
    expect(screen.getByPlaceholderText(/connect OBS to pick/i)).toBeInTheDocument()
  })

  it('shows a <select> dropdown when obsScenes has entries', () => {
    const action = { type: 'obs', operation: 'switch-scene', sceneName: 'Gaming' }
    const scenes = ['Gaming', 'Just Chatting', 'BRB']
    render(<ActionSection action={action} onChange={noop} obsScenes={scenes} />)

    const selects = screen.getAllByRole('combobox')
    // The last select should be the scene picker
    const scenePicker = selects[selects.length - 1]
    expect(scenePicker).toBeInTheDocument()
    expect(screen.getByText('Gaming')).toBeInTheDocument()
    expect(screen.getByText('Just Chatting')).toBeInTheDocument()
    expect(screen.getByText('BRB')).toBeInTheDocument()
  })

  it('includes all four OBS operations in the select', () => {
    render(<ActionSection action={obsAction} onChange={noop} />)
    const select = screen.getByRole('combobox')
    const options = [...select.querySelectorAll('option')].map(o => o.value)
    expect(options).toContain('toggle-record')
    expect(options).toContain('toggle-stream')
    expect(options).toContain('toggle-pause-record')
    expect(options).toContain('switch-scene')
  })

  it('calls onChange with updated operation when user selects one', () => {
    const onChange = vi.fn()
    render(<ActionSection action={obsAction} onChange={onChange} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'toggle-stream' } })
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: expect.objectContaining({ operation: 'toggle-stream' }) })
    )
  })

  it('renders the remove button', () => {
    render(<ActionSection action={obsAction} onChange={noop} />)
    expect(screen.getByTitle('Remove action')).toBeInTheDocument()
  })

  it('calls onChange with action:null when remove button is clicked', () => {
    const onChange = vi.fn()
    render(<ActionSection action={obsAction} onChange={onChange} />)
    fireEvent.click(screen.getByTitle('Remove action'))
    expect(onChange).toHaveBeenCalledWith({ action: null })
  })
})

// ─── ActionSection — unassigned ──────────────────────────────────────────────

describe('ActionSection — unassigned (no action)', () => {
  it('shows the assign button when no action is set', () => {
    render(<ActionSection action={null} onChange={() => {}} />)
    expect(screen.getByText(/assign an action/i)).toBeInTheDocument()
  })
})

// ─── ActionSection — folder ──────────────────────────────────────────────────

describe('ActionSection — folder action', () => {
  it('renders the Folder action chip', () => {
    render(<ActionSection action={{ type: 'folder', buttons: {} }} onChange={() => {}} />)
    expect(screen.getByText('Folder')).toBeInTheDocument()
  })

  it('shows the Open Folder button when onEnterFolder is provided', () => {
    render(
      <ActionSection
        action={{ type: 'folder', buttons: {} }}
        onChange={() => {}}
        onEnterFolder={() => {}}
      />
    )
    expect(screen.getByText('Open Folder')).toBeInTheDocument()
  })

  it('hides the Open Folder button when onEnterFolder is not provided', () => {
    render(<ActionSection action={{ type: 'folder', buttons: {} }} onChange={() => {}} />)
    expect(screen.queryByText('Open Folder')).not.toBeInTheDocument()
  })
})
