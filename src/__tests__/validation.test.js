/**
 * Tests for electron/validation.cjs
 *
 * Because that file is CommonJS and the test runner is ESM (package.json
 * has "type": "module"), we use createRequire to load it.
 */
import { createRequire } from 'module'
import { describe, it, expect } from 'vitest'

const require = createRequire(import.meta.url)
const {
  PLAYERCTL_COMMANDS,
  isValidHotkey,
  isValidUrl,
  isValidPactlArgs,
  isValidSinkName,
  isValidPlayerctlCommand,
  isValidPlayerName,
  sanitizeProfileName,
} = require('../../electron/validation.cjs')

// ─── PLAYERCTL_COMMANDS ───────────────────────────────────────────────────────

describe('PLAYERCTL_COMMANDS', () => {
  it('contains the six allowed commands', () => {
    expect([...PLAYERCTL_COMMANDS]).toEqual(
      expect.arrayContaining(['play', 'pause', 'play-pause', 'next', 'previous', 'stop'])
    )
    expect(PLAYERCTL_COMMANDS.size).toBe(6)
  })
})

// ─── isValidHotkey ────────────────────────────────────────────────────────────

describe('isValidHotkey', () => {
  it('accepts a simple letter key', () => {
    expect(isValidHotkey('a')).toBe(true)
  })

  it('accepts combined keys with +', () => {
    expect(isValidHotkey('ctrl+shift+t')).toBe(true)
  })

  it('accepts digits', () => {
    expect(isValidHotkey('F5')).toBe(true)
  })

  it('accepts underscores and hyphens', () => {
    expect(isValidHotkey('alt_L')).toBe(true)
    expect(isValidHotkey('super-space')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidHotkey('')).toBe(false)
  })

  it('rejects null / undefined', () => {
    expect(isValidHotkey(null)).toBe(false)
    expect(isValidHotkey(undefined)).toBe(false)
  })

  it('rejects spaces', () => {
    expect(isValidHotkey('ctrl shift')).toBe(false)
  })

  it('rejects shell-special characters', () => {
    expect(isValidHotkey('ctrl+$(whoami)')).toBe(false)
    expect(isValidHotkey('ctrl+`ls`')).toBe(false)
  })
})

// ─── isValidUrl ───────────────────────────────────────────────────────────────

describe('isValidUrl', () => {
  it('accepts http URLs', () => {
    expect(isValidUrl('http://example.com')).toBe(true)
  })

  it('accepts https URLs', () => {
    expect(isValidUrl('https://example.com/path?q=1')).toBe(true)
  })

  it('accepts ftp URLs', () => {
    expect(isValidUrl('ftp://files.example.com')).toBe(true)
  })

  it('is case-insensitive for scheme', () => {
    expect(isValidUrl('HTTPS://EXAMPLE.COM')).toBe(true)
  })

  it('accepts URLs with leading/trailing whitespace', () => {
    expect(isValidUrl('  https://example.com  ')).toBe(true)
  })

  it('rejects javascript: scheme', () => {
    expect(isValidUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects file: scheme', () => {
    expect(isValidUrl('file:///etc/passwd')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidUrl('')).toBe(false)
  })

  it('rejects null / undefined', () => {
    expect(isValidUrl(null)).toBe(false)
    expect(isValidUrl(undefined)).toBe(false)
  })

  it('rejects bare hostnames', () => {
    expect(isValidUrl('example.com')).toBe(false)
  })
})

// ─── isValidPactlArgs ─────────────────────────────────────────────────────────

describe('isValidPactlArgs', () => {
  it('accepts a typical pactl set-sink-volume call', () => {
    expect(isValidPactlArgs(['set-sink-volume', '@DEFAULT_SINK@', '80%'])).toBe(true)
  })

  it('accepts alphanumeric and safe special chars', () => {
    expect(isValidPactlArgs(['set-sink-volume', 'alsa_output.pci-0000_00_1b.0.analog-stereo', '+5%'])).toBe(true)
  })

  it('rejects non-array input', () => {
    expect(isValidPactlArgs('set-sink-volume')).toBe(false)
    expect(isValidPactlArgs(null)).toBe(false)
  })

  it('rejects arguments containing spaces', () => {
    expect(isValidPactlArgs(['set-sink-volume', 'my sink name'])).toBe(false)
  })

  it('rejects arguments containing shell injection characters', () => {
    expect(isValidPactlArgs(['$(rm -rf /)', '80%'])).toBe(false)
    expect(isValidPactlArgs(['set-sink-volume', '`whoami`'])).toBe(false)
  })

  it('accepts an empty array (pactl with no args is safe)', () => {
    expect(isValidPactlArgs([])).toBe(true)
  })
})

// ─── isValidSinkName ──────────────────────────────────────────────────────────

describe('isValidSinkName', () => {
  it('accepts @DEFAULT_SINK@', () => {
    expect(isValidSinkName('@DEFAULT_SINK@')).toBe(true)
  })

  it('accepts a PulseAudio sink name', () => {
    expect(isValidSinkName('alsa_output.pci-0000_00_1f.3.analog-stereo')).toBe(true)
  })

  it('rejects names with spaces', () => {
    expect(isValidSinkName('my sink')).toBe(false)
  })

  it('rejects names with + or %', () => {
    // Note: pactl args allow + and %, but sink names do not
    expect(isValidSinkName('sink+name')).toBe(false)
    expect(isValidSinkName('sink%name')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidSinkName('')).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(isValidSinkName(null)).toBe(false)
    expect(isValidSinkName(42)).toBe(false)
  })
})

// ─── isValidPlayerctlCommand ──────────────────────────────────────────────────

describe('isValidPlayerctlCommand', () => {
  const allowed = ['play', 'pause', 'play-pause', 'next', 'previous', 'stop']
  allowed.forEach(cmd => {
    it(`accepts "${cmd}"`, () => {
      expect(isValidPlayerctlCommand(cmd)).toBe(true)
    })
  })

  it('rejects an arbitrary command string', () => {
    expect(isValidPlayerctlCommand('open')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidPlayerctlCommand('')).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isValidPlayerctlCommand(undefined)).toBe(false)
  })

  it('rejects shell-injection attempt', () => {
    expect(isValidPlayerctlCommand('play; rm -rf /')).toBe(false)
  })
})

// ─── isValidPlayerName ────────────────────────────────────────────────────────

describe('isValidPlayerName', () => {
  it('accepts the default %any wildcard', () => {
    expect(isValidPlayerName('%any')).toBe(true)
  })

  it('accepts a typical MPRIS player name', () => {
    expect(isValidPlayerName('spotify')).toBe(true)
    expect(isValidPlayerName('chromium.instance1')).toBe(true)
  })

  it('accepts names with @ (MPRIS bus names)', () => {
    expect(isValidPlayerName('vlc@1234')).toBe(true)
  })

  it('rejects names with spaces', () => {
    expect(isValidPlayerName('my player')).toBe(false)
  })

  it('rejects shell-injection characters', () => {
    expect(isValidPlayerName('player;whoami')).toBe(false)
    expect(isValidPlayerName('$(id)')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidPlayerName('')).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(isValidPlayerName(null)).toBe(false)
    expect(isValidPlayerName(123)).toBe(false)
  })
})

// ─── sanitizeProfileName ──────────────────────────────────────────────────────

describe('sanitizeProfileName', () => {
  it('returns normal names unchanged', () => {
    expect(sanitizeProfileName('My Profile')).toBe('My Profile')
  })

  it('strips filesystem-unsafe characters', () => {
    expect(sanitizeProfileName('Profile/With\\Bad:Chars')).toBe('ProfileWithBadChars')
  })

  it('strips all forbidden characters: / \\ : * ? " < > |', () => {
    expect(sanitizeProfileName('/\\:*?"<>|')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(sanitizeProfileName('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(sanitizeProfileName('   ')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(sanitizeProfileName(null)).toBeNull()
  })

  it('returns null for non-string input', () => {
    expect(sanitizeProfileName(42)).toBeNull()
  })

  it('trims leading and trailing whitespace', () => {
    expect(sanitizeProfileName('  Profile Name  ')).toBe('Profile Name')
  })

  it('preserves hyphens, underscores, dots, and spaces within name', () => {
    expect(sanitizeProfileName('My-Profile_v2.0')).toBe('My-Profile_v2.0')
  })
})
