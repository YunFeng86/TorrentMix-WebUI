import type { BaseAdapter } from './interface'
import type { BackendVersion } from './detect'
import { detectBackendWithVersion } from './detect'
import { QbitV4Adapter } from './qbit/v4'
import { QbitV5Adapter } from './qbit/v5'
import { TransAdapter } from './trans/index'

const VERSION_CACHE_KEY = 'webui_backend_version'

export interface CachedVersion extends BackendVersion {
  timestamp: number
}

export async function createAdapter(): Promise<{ adapter: BaseAdapter; version: BackendVersion }> {
  let version: BackendVersion

  // 尝试从缓存加载
  const cached = loadVersionCache()
  if (cached && Date.now() - cached.timestamp < 3600000) {
    version = cached
  } else {
    version = await detectBackendWithVersion()
    saveVersionCache(version)
  }

  let adapter: BaseAdapter
  if (version.type === 'qbit') {
    adapter = version.major >= 5 ? new QbitV5Adapter() : new QbitV4Adapter()
  } else {
    adapter = new TransAdapter()
  }

  return { adapter, version }
}

export async function refreshVersion(): Promise<BackendVersion> {
  const version = await detectBackendWithVersion()
  saveVersionCache(version)
  return version
}

function loadVersionCache(): CachedVersion | null {
  try {
    const cached = localStorage.getItem(VERSION_CACHE_KEY)
    return cached ? JSON.parse(cached) : null
  } catch {
    return null
  }
}

function saveVersionCache(version: BackendVersion): void {
  try {
    const cached: CachedVersion = { ...version, timestamp: Date.now() }
    localStorage.setItem(VERSION_CACHE_KEY, JSON.stringify(cached))
  } catch {}
}

export function clearVersionCache(): void {
  try {
    localStorage.removeItem(VERSION_CACHE_KEY)
  } catch {}
}
