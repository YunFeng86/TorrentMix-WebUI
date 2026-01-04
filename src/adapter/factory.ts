import type { BaseAdapter } from './interface'
import type { BackendVersion } from './detect'
import { detectBackendWithVersion } from './detect'
import { QbitV4Adapter } from './qbit/v4'
import { QbitV5Adapter } from './qbit/v5'
import { TransAdapter } from './trans/index'

const VERSION_CACHE_KEY = 'webui_backend_version'

export interface CachedVersion extends BackendVersion {
  timestamp: number
  isUnknown?: boolean  // 是否为未知版本（未认证时）
}

export async function createAdapter(): Promise<{ adapter: BaseAdapter; version: BackendVersion }> {
  let version: BackendVersion & { isUnknown?: boolean }

  // 尝试从缓存加载（但跳过未知版本）
  const cached = loadVersionCache()
  if (cached && !cached.isUnknown && Date.now() - cached.timestamp < 3600000) {
    version = cached
  } else {
    version = await detectBackendWithVersion()
    // 只缓存已知版本
    if (!version.isUnknown) {
      saveVersionCache(version)
    }
  }

  let adapter: BaseAdapter
  if (version.type === 'qbit') {
    adapter = version.major >= 5 ? new QbitV5Adapter() : new QbitV4Adapter()
  } else {
    // Transmission: 传递 rpcSemver 用于协议版本检测
    adapter = new TransAdapter({ rpcSemver: version.rpcSemver })
  }

  return { adapter, version }
}

/**
 * 根据后端类型创建适配器（不检测版本）
 * 用于登录前创建适配器实例
 */
export async function createAdapterByType(
  backendType: import('./detect').BackendType
): Promise<BaseAdapter> {
  if (backendType === 'qbit' || backendType === 'unknown') {
    // qBittorrent v4/v5 的 login API 相同，使用 v4 即可
    return new QbitV4Adapter()
  } else {
    // Transmission
    return new TransAdapter()
  }
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

export function saveVersionCache(version: BackendVersion & { isUnknown?: boolean }): void {
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
