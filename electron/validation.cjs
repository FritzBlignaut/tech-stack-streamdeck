'use strict'

/** Allowlisted playerctl commands */
const PLAYERCTL_COMMANDS = new Set(['play', 'pause', 'play-pause', 'next', 'previous', 'stop'])

/**
 * Hotkey string must be non-empty and contain only safe xdotool key characters.
 * @param {*} keys
 * @returns {boolean}
 */
function isValidHotkey(keys) {
  return !!(keys && /^[a-zA-Z0-9+_-]+$/.test(keys))
}

/**
 * URL must start with http://, https://, or ftp://.
 * @param {*} url
 * @returns {boolean}
 */
function isValidUrl(url) {
  if (!url?.trim()) return false
  const safe = url.trim()
  return /^https?:\/\//i.test(safe) || /^ftp:\/\//i.test(safe)
}

/**
 * pactl argument array: all elements must match the allowed character set.
 * @param {*} args
 * @returns {boolean}
 */
function isValidPactlArgs(args) {
  if (!Array.isArray(args)) return false
  return args.every(a => /^[@A-Za-z0-9_.+%:-]+$/.test(String(a)))
}

/**
 * PulseAudio sink name character set (subset — no + or %).
 * @param {*} sink
 * @returns {boolean}
 */
function isValidSinkName(sink) {
  if (typeof sink !== 'string') return false
  return /^[@A-Za-z0-9_.:-]+$/.test(sink)
}

/**
 * playerctl command must be in the allowlist.
 * @param {*} command
 * @returns {boolean}
 */
function isValidPlayerctlCommand(command) {
  return PLAYERCTL_COMMANDS.has(command)
}

/**
 * Player name for playerctl (includes %any and MPRIS player names).
 * @param {*} player
 * @returns {boolean}
 */
function isValidPlayerName(player) {
  if (typeof player !== 'string') return false
  return /^[a-zA-Z0-9_.%@-]+$/.test(player)
}

/**
 * Strip filesystem-unsafe characters from a profile name.
 * Returns the sanitized string, or null if the result is empty / input is invalid.
 * @param {*} name
 * @returns {string|null}
 */
function sanitizeProfileName(name) {
  if (!name || typeof name !== 'string') return null
  const safe = name.trim().replace(/[/\\:*?"<>|]/g, '')
  return safe || null
}

module.exports = {
  PLAYERCTL_COMMANDS,
  isValidHotkey,
  isValidUrl,
  isValidPactlArgs,
  isValidSinkName,
  isValidPlayerctlCommand,
  isValidPlayerName,
  sanitizeProfileName,
}
