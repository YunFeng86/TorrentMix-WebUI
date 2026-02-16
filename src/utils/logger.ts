const warnedKeys = new Set<string>()

export function warnOnce(key: string, message: string, data?: unknown): void {
  if (warnedKeys.has(key)) return
  warnedKeys.add(key)
  if (data !== undefined) console.warn(`[Adapter Warning] ${message}`, data)
  else console.warn(`[Adapter Warning] ${message}`)
}

