import { describe, it, expect } from 'vitest'
import { getButtonsAt, immutableSetButton, formatClock } from '../utils.js'

// ─── formatClock ─────────────────────────────────────────────────────────────

describe('formatClock', () => {
  // Fixed reference date: 2024-03-15 (Friday), 14:05:09
  const d = new Date(2024, 2, 15, 14, 5, 9) // month is 0-indexed

  it('formats 24-hour time HH:MM:SS', () => {
    expect(formatClock(d, 'HH:MM:SS')).toEqual(['14:05:09'])
  })

  it('formats 12-hour time hh:MM A', () => {
    expect(formatClock(d, 'hh:MM A')).toEqual(['02:05 PM'])
  })

  it('returns AM for hour < 12', () => {
    const morning = new Date(2024, 2, 15, 9, 30, 0)
    expect(formatClock(morning, 'hh:MM A')).toEqual(['09:30 AM'])
  })

  it('handles midnight correctly (12-hour = 12, AM)', () => {
    const midnight = new Date(2024, 2, 15, 0, 0, 0)
    expect(formatClock(midnight, 'hh A')).toEqual(['12 AM'])
  })

  it('handles noon correctly (12-hour = 12, PM)', () => {
    const noon = new Date(2024, 2, 15, 12, 0, 0)
    expect(formatClock(noon, 'hh A')).toEqual(['12 PM'])
  })

  it('formats DD/mo/YYYY date tokens', () => {
    expect(formatClock(d, 'DD/mo/YYYY')).toEqual(['15/03/2024'])
  })

  it('formats ddd weekday abbreviation', () => {
    expect(formatClock(d, 'ddd')).toEqual(['Fri'])
  })

  it('formats MMM month abbreviation', () => {
    expect(formatClock(d, 'MMM')).toEqual(['Mar'])
  })

  it('MMM is resolved before MM to avoid partial replacement', () => {
    // "MMM" contains "MM" — make sure we get "Mar" not "Mar05" or similar
    expect(formatClock(d, 'MMM YYYY')).toEqual(['Mar 2024'])
  })

  it('splits output on | into multiple lines', () => {
    expect(formatClock(d, 'HH:MM|ddd DD')).toEqual(['14:05', 'Fri 15'])
  })

  it('trims whitespace around | separators', () => {
    // tokens are replaced first, THEN split and trimmed
    expect(formatClock(d, ' HH:MM | ddd ')).toEqual(['14:05', 'Fri'])
  })

  it('filters out empty segments after splitting', () => {
    expect(formatClock(d, '|HH:MM|')).toEqual(['14:05'])
  })

  it('pads single-digit values with leading zeros', () => {
    const early = new Date(2024, 0, 5, 3, 7, 8) // Jan 5, 03:07:08
    expect(formatClock(early, 'HH:MM:SS DD/mo')).toEqual(['03:07:08 05/01'])
  })

  it('returns all 12 month abbreviations correctly', () => {
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    months.forEach((name, i) => {
      const date = new Date(2024, i, 1)
      expect(formatClock(date, 'MMM')).toEqual([name])
    })
  })

  it('returns all 7 weekday abbreviations correctly', () => {
    // 2024-03-17 is a Sunday; 2024-03-16 is Saturday, etc.
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    // 2024-03-17 = Sunday (day 0)
    days.forEach((name, i) => {
      const date = new Date(2024, 2, 17 + i) // Sun Mar 17 + offset
      expect(formatClock(date, 'ddd')).toEqual([name])
    })
  })
})

// ─── getButtonsAt ─────────────────────────────────────────────────────────────

describe('getButtonsAt', () => {
  const pages = [
    {
      0: { label: 'btn0' },
      1: { label: 'btn1', action: { type: 'folder', buttons: {
        0: { label: 'inner0' },
        1: { label: 'inner1', action: { type: 'folder', buttons: {
          0: { label: 'deep0' }
        }}}
      }}},
    },
    {
      5: { label: 'page1btn5' }
    }
  ]

  it('returns root buttons at top-level (empty folderPath)', () => {
    expect(getButtonsAt(pages, 0, [])).toEqual(pages[0])
  })

  it('returns buttons inside a first-level folder', () => {
    expect(getButtonsAt(pages, 0, [1])).toEqual({
      0: { label: 'inner0' },
      1: { label: 'inner1', action: { type: 'folder', buttons: { 0: { label: 'deep0' } } } },
    })
  })

  it('returns buttons inside a second-level folder', () => {
    expect(getButtonsAt(pages, 0, [1, 1])).toEqual({ 0: { label: 'deep0' } })
  })

  it('returns correct buttons for a non-zero page', () => {
    expect(getButtonsAt(pages, 1, [])).toEqual(pages[1])
  })

  it('returns empty object for a missing page index', () => {
    expect(getButtonsAt(pages, 99, [])).toEqual({})
  })

  it('returns empty object when folder path leads to a button without nested buttons', () => {
    expect(getButtonsAt(pages, 0, [0])).toEqual({})
  })

  it('returns empty object when path leads to a non-existent button index', () => {
    expect(getButtonsAt(pages, 0, [99])).toEqual({})
  })
})

// ─── immutableSetButton ───────────────────────────────────────────────────────

describe('immutableSetButton', () => {
  const BASE = [{ 0: { label: 'existing' } }]

  it('adds a button at root level', () => {
    const result = immutableSetButton(BASE, 0, [], 1, { label: 'new' })
    expect(result[0][1]).toEqual({ label: 'new' })
  })

  it('overwrites an existing button', () => {
    const result = immutableSetButton(BASE, 0, [], 0, { label: 'updated' })
    expect(result[0][0]).toEqual({ label: 'updated' })
  })

  it('removes a button when config is null', () => {
    const result = immutableSetButton(BASE, 0, [], 0, null)
    expect(result[0][0]).toBeUndefined()
  })

  it('does not mutate the original pages array', () => {
    const original = [{ 0: { label: 'orig' } }]
    immutableSetButton(original, 0, [], 0, { label: 'changed' })
    expect(original[0][0]).toEqual({ label: 'orig' })
  })

  it('does not mutate the original page object', () => {
    const page = { 0: { label: 'orig' } }
    const pages = [page]
    const result = immutableSetButton(pages, 0, [], 1, { label: 'new' })
    expect(page).toEqual({ 0: { label: 'orig' } })
    expect(result[0]).not.toBe(page)
  })

  it('creates a folder wrapper for a nested path', () => {
    const pages = [{}]
    const result = immutableSetButton(pages, 0, [3], 5, { label: 'nested' })
    expect(result[0][3].action.type).toBe('folder')
    expect(result[0][3].action.buttons[5]).toEqual({ label: 'nested' })
  })

  it('preserves other buttons when setting one in a folder', () => {
    const pages = [{
      3: { action: { type: 'folder', buttons: { 0: { label: 'keep' } } } }
    }]
    const result = immutableSetButton(pages, 0, [3], 1, { label: 'added' })
    expect(result[0][3].action.buttons[0]).toEqual({ label: 'keep' })
    expect(result[0][3].action.buttons[1]).toEqual({ label: 'added' })
  })

  it('sets button in a second page without affecting the first', () => {
    const pages = [{ 0: { label: 'p0' } }, {}]
    const result = immutableSetButton(pages, 1, [], 7, { label: 'p1b7' })
    expect(result[0]).toEqual(pages[0])
    expect(result[1][7]).toEqual({ label: 'p1b7' })
  })

  it('removes a nested button when config is null', () => {
    const pages = [{
      2: { action: { type: 'folder', buttons: { 9: { label: 'del' } } } }
    }]
    const result = immutableSetButton(pages, 0, [2], 9, null)
    expect(result[0][2].action.buttons[9]).toBeUndefined()
  })

  it('handles a missing page index gracefully (creates the page entry)', () => {
    const pages = []
    const result = immutableSetButton(pages, 0, [], 0, { label: 'x' })
    expect(result[0][0]).toEqual({ label: 'x' })
  })
})
