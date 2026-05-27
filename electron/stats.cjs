'use strict'

/**
 * Parse raw /proc/stat and /proc/meminfo content into system-monitor stats.
 *
 * @param {string}      statContent  - full text of /proc/stat
 * @param {string}      memContent   - full text of /proc/meminfo
 * @param {object|null} lastCpuTimes - previous { total, active } snapshot, or null on first call
 * @returns {{
 *   cpuPercent:  number,
 *   newCpuTimes: { total: number, active: number },
 *   ramPercent:  number,
 *   ramUsedMB:   number,
 *   ramTotalMB:  number,
 * }}
 */
function parseSystemStats(statContent, memContent, lastCpuTimes) {
  // CPU: first line of /proc/stat — "cpu  user nice system idle iowait ..."
  const vals   = statContent.split('\n')[0].split(/\s+/).slice(1).map(Number)
  const idle   = vals[3] + (vals[4] ?? 0)  // idle + iowait
  const total  = vals.reduce((a, b) => a + b, 0)
  const active = total - idle

  let cpuPercent = 0
  if (lastCpuTimes) {
    const dTotal  = total  - lastCpuTimes.total
    const dActive = active - lastCpuTimes.active
    cpuPercent = dTotal > 0 ? Math.round((dActive / dTotal) * 100) : 0
  }

  // RAM: MemTotal / MemAvailable from /proc/meminfo (values in kB)
  const memTotal   = parseInt(memContent.match(/MemTotal:\s+(\d+)/)?.[1]     ?? 0)
  const memAvail   = parseInt(memContent.match(/MemAvailable:\s+(\d+)/)?.[1] ?? 0)
  const ramUsedMB  = Math.round((memTotal - memAvail) / 1024)
  const ramTotalMB = Math.round(memTotal / 1024)
  const ramPercent = memTotal > 0 ? Math.round(((memTotal - memAvail) / memTotal) * 100) : 0

  return {
    cpuPercent,
    newCpuTimes: { total, active },
    ramPercent,
    ramUsedMB,
    ramTotalMB,
  }
}

module.exports = { parseSystemStats }
