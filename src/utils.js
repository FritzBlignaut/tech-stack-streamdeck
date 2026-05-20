/**
 * Pure utility functions — no React, no browser APIs, no Electron.
 * Shared between App.jsx and unit tests.
 */

/**
 * Return the buttons object at the given folder path within pages.
 * @param {Array}    pages
 * @param {number}   pageIndex
 * @param {number[]} folderPath
 * @returns {object}
 */
export function getButtonsAt(pages, pageIndex, folderPath) {
  let buttons = pages[pageIndex] ?? {}
  for (const idx of folderPath) {
    buttons = buttons[idx]?.action?.buttons ?? {}
  }
  return buttons
}

/**
 * Deep-immutable update of a single button inside pages.
 * config === null removes the button; otherwise it sets it.
 * @param {Array}    pages
 * @param {number}   pageIndex
 * @param {number[]} folderPath
 * @param {number}   buttonIndex
 * @param {object|null} config
 * @returns {Array} new pages array (original is unchanged)
 */
export function immutableSetButton(pages, pageIndex, folderPath, buttonIndex, config) {
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
    const btn   = buttons[head] ?? {}
    const inner = update(btn.action?.buttons ?? {}, tail)
    return { ...buttons, [head]: { ...btn, action: { ...btn.action, type: 'folder', buttons: inner } } }
  }
  newPages[pageIndex] = update(newPages[pageIndex] ?? {}, folderPath)
  return newPages
}

/**
 * Format a Date using a token string for Stream Deck clock buttons.
 *
 * Tokens (longest match takes priority):
 *   YYYY  full 4-digit year
 *   MMM   month abbreviation (Jan … Dec)
 *   ddd   weekday abbreviation (Sun … Sat)
 *   HH    24-hour hours (00–23)
 *   hh    12-hour hours (01–12)
 *   MM    minutes (00–59)
 *   SS    seconds (00–59)
 *   DD    day of month (01–31)
 *   mo    month number (01–12)
 *   A     AM / PM
 *
 * Use | to split output into separate lines.
 *
 * @param {Date}   date
 * @param {string} fmt
 * @returns {string[]} one or more trimmed line strings
 */
export function formatClock(date, fmt) {
  const pad  = n => String(n).padStart(2, '0')
  const h24  = date.getHours()
  const h12  = h24 % 12 || 12
  const ampm = h24 < 12 ? 'AM' : 'PM'

  const result = fmt
    .replaceAll('YYYY', String(date.getFullYear()))
    .replaceAll('MMM',  ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][date.getMonth()])
    .replaceAll('ddd',  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()])
    .replaceAll('HH',   pad(h24))
    .replaceAll('hh',   pad(h12))
    .replaceAll('MM',   pad(date.getMinutes()))
    .replaceAll('SS',   pad(date.getSeconds()))
    .replaceAll('DD',   pad(date.getDate()))
    .replaceAll('mo',   pad(date.getMonth() + 1))
    // Use a regex to match standalone 'A' only (not inside month names like Apr/Aug)
    .replace(/(?<![a-zA-Z])A(?![a-zA-Z])/g, ampm)

  return result.split('|').map(s => s.trim()).filter(Boolean)
}
