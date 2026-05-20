/**
 * Tests for electron/stats.cjs — parseSystemStats()
 *
 * parseSystemStats(statContent, memContent, lastCpuTimes) is a pure function
 * that parses the text of /proc/stat and /proc/meminfo into system metrics.
 */
import { createRequire } from 'module'
import { describe, it, expect } from 'vitest'

const require = createRequire(import.meta.url)
const { parseSystemStats } = require('../../electron/stats.cjs')

// ─── Helpers to build realistic /proc/stat lines ──────────────────────────────
// Format: cpu  user nice system idle iowait irq softirq steal guest guest_nice

function buildStatLine({ user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0 } = {}) {
  return `cpu  ${user} ${nice} ${system} ${idle} ${iowait} ${irq} ${softirq} ${steal}\ncpu0 0 0 0 0 0 0 0 0\n`
}

function buildMeminfo({ total = 16000000, avail = 8000000 } = {}) {
  return `MemTotal:       ${total} kB\nMemFree:        4000000 kB\nMemAvailable:   ${avail} kB\n`
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('parseSystemStats', () => {
  describe('on the first call (lastCpuTimes = null)', () => {
    it('returns cpuPercent = 0 because there is no previous snapshot', () => {
      const stat = buildStatLine({ user: 1000, system: 200, idle: 3800 })
      const mem  = buildMeminfo()
      const result = parseSystemStats(stat, mem, null)
      expect(result.cpuPercent).toBe(0)
    })

    it('returns newCpuTimes for use in the next call', () => {
      // user=1000 system=200 idle=3800 iowait=0  → total=5000, idle=3800, active=1200
      const stat = buildStatLine({ user: 1000, system: 200, idle: 3800 })
      const mem  = buildMeminfo()
      const result = parseSystemStats(stat, mem, null)
      expect(result.newCpuTimes.total).toBe(5000)
      expect(result.newCpuTimes.active).toBe(1200)
    })
  })

  describe('on subsequent calls (delta computation)', () => {
    it('computes correct CPU percentage from a known delta', () => {
      // First snapshot: total=5000, active=1200
      // Second snapshot: user += 300, system += 100, idle += 400 → total=5800, active=1600
      // dTotal = 800, dActive = 400 → 50%
      const last = { total: 5000, active: 1200 }
      const stat = buildStatLine({ user: 1300, system: 300, idle: 4200 })
      const mem  = buildMeminfo()
      const result = parseSystemStats(stat, mem, last)
      expect(result.cpuPercent).toBe(50)
    })

    it('returns 0% when dTotal is zero (no time has elapsed)', () => {
      const snap = { total: 5000, active: 1200 }
      const stat = buildStatLine({ user: 1000, system: 200, idle: 3800 }) // same as snap
      const mem  = buildMeminfo()
      const result = parseSystemStats(stat, mem, snap)
      expect(result.cpuPercent).toBe(0)
    })

    it('clamps to 0% when CPU appears idle (active delta = 0)', () => {
      const last = { total: 5000, active: 1200 }
      const stat = buildStatLine({ user: 1000, system: 200, idle: 4600 }) // only idle grew
      const mem  = buildMeminfo()
      const result = parseSystemStats(stat, mem, last)
      expect(result.cpuPercent).toBe(0)
    })

    it('rounds fractional percentages', () => {
      // dTotal = 1003-1000 = 3, dActive = 501-500 = 1 → 33.33% → rounds to 33
      const last = { total: 1000, active: 500 }
      const stat = buildStatLine({ user: 501, idle: 502 }) // total=1003, active=501
      const mem  = buildMeminfo()
      const result = parseSystemStats(stat, mem, last)
      expect(result.cpuPercent).toBe(33)
    })

    it('updates newCpuTimes to the current snapshot values', () => {
      const last = { total: 5000, active: 1200 }
      const stat = buildStatLine({ user: 1300, system: 300, idle: 4200 })
      const mem  = buildMeminfo()
      const result = parseSystemStats(stat, mem, last)
      expect(result.newCpuTimes.total).toBe(5800)
      expect(result.newCpuTimes.active).toBe(1600)
    })
  })

  describe('iowait is counted as idle time', () => {
    it('iowait time lowers active percentage', () => {
      // Without iowait: user=800 system=200 idle=400 → active=1000/1400 = ~71%
      // With    iowait: user=800 system=200 idle=400 iowait=400 → active=1000/1800 = ~56%
      const lastNoWait = { total: 0, active: 0 }
      const statWith   = buildStatLine({ user: 800, system: 200, idle: 400, iowait: 400 })
      const mem        = buildMeminfo()
      const result = parseSystemStats(statWith, mem, lastNoWait)
      // dTotal = 1800, dActive = 1000 → 55.5...% → 56
      expect(result.cpuPercent).toBe(56)
    })
  })

  describe('RAM metrics', () => {
    it('computes ramPercent correctly', () => {
      // total=16000000 kB, avail=4000000 kB → used=12000000 → 75%
      const stat = buildStatLine({ idle: 10000 })
      const mem  = buildMeminfo({ total: 16000000, avail: 4000000 })
      const result = parseSystemStats(stat, mem, null)
      expect(result.ramPercent).toBe(75)
    })

    it('computes ramUsedMB and ramTotalMB in mebibytes', () => {
      // total=8388608 kB = 8192 MiB; avail=4194304 kB = 4096 MiB; used=4096 MiB
      const stat = buildStatLine({ idle: 10000 })
      const mem  = buildMeminfo({ total: 8388608, avail: 4194304 })
      const result = parseSystemStats(stat, mem, null)
      expect(result.ramTotalMB).toBe(8192)
      expect(result.ramUsedMB).toBe(4096)
    })

    it('returns 0 ramPercent when MemTotal is 0 (guards against division by zero)', () => {
      const stat = buildStatLine({ idle: 10000 })
      const mem  = buildMeminfo({ total: 0, avail: 0 })
      const result = parseSystemStats(stat, mem, null)
      expect(result.ramPercent).toBe(0)
    })

    it('returns 100% when all RAM is used', () => {
      const stat = buildStatLine({ idle: 10000 })
      const mem  = buildMeminfo({ total: 8000000, avail: 0 })
      const result = parseSystemStats(stat, mem, null)
      expect(result.ramPercent).toBe(100)
    })
  })

  describe('parsing edge cases', () => {
    it('handles extra whitespace on the cpu line', () => {
      const stat = 'cpu   500  100  200  1200  50  0  0  0\n'
      const mem  = buildMeminfo()
      const result = parseSystemStats(stat, mem, null)
      expect(result.newCpuTimes.total).toBe(2050)
    })

    it('returns 0 for all RAM fields when meminfo lines are absent', () => {
      const stat = buildStatLine({ idle: 1000 })
      const mem  = 'MemFree: 1000 kB\n' // no MemTotal or MemAvailable
      const result = parseSystemStats(stat, mem, null)
      expect(result.ramPercent).toBe(0)
      expect(result.ramUsedMB).toBe(0)
      expect(result.ramTotalMB).toBe(0)
    })
  })
})
