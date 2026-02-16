export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '--'
  // bytes 可能来自计算（如 size * progress），会出现 0 < bytes < 1 的浮点数；此时按 0 处理避免单位下标为负
  if (bytes < 1) return '0 B'

  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)))
  const value = bytes / Math.pow(k, i)
  const digits = i === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${sizes[i]}`
}

export function formatSpeed(bytesPerSecond: number): string {
  const formatted = formatBytes(bytesPerSecond)
  return formatted === '--' ? '--' : `${formatted}/s`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--'
  // qBittorrent 用 -1 或 >= 8640000 (100天) 表示无限
  if (seconds === -1 || seconds >= 8640000) return '∞'
  if (seconds < 0) return '--'
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${mins}m`
}
