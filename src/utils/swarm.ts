import type { UnifiedTorrent } from '@/adapter/types'

function hasValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasConnected(torrent: UnifiedTorrent): boolean {
  return hasValue(torrent.connectedSeeds) || hasValue(torrent.connectedPeers)
}

function hasTotal(torrent: UnifiedTorrent): boolean {
  return hasValue(torrent.totalSeeds) || hasValue(torrent.totalPeers)
}

export function getSwarmTitle(torrent: UnifiedTorrent): string {
  const connected = hasConnected(torrent)
  const total = hasTotal(torrent)
  if (connected && total) return '做种/下载：连接数(总数)'
  if (total) return '做种/下载：总数'
  if (connected) return '做种/下载：连接数'
  return '做种/下载：--'
}

export function getSwarmTexts(torrent: UnifiedTorrent): { seeds: string; peers: string } {
  const connected = hasConnected(torrent)
  const total = hasTotal(torrent)

  // 两种都存在：2(12)/10(34)
  if (connected && total) {
    const cs = torrent.connectedSeeds ?? 0
    const cp = torrent.connectedPeers ?? 0
    const ts = torrent.totalSeeds ?? torrent.numSeeds ?? 0
    const tp = torrent.totalPeers ?? torrent.numPeers ?? 0
    return { seeds: `${cs}(${ts})`, peers: `${cp}(${tp})` }
  }

  // 只有一种：优先 total，其次 numSeeds/numPeers（兼容旧数据 / adapter best 值）
  const seeds = torrent.totalSeeds ?? torrent.numSeeds
  const peers = torrent.totalPeers ?? torrent.numPeers
  if (seeds === undefined && peers === undefined) return { seeds: '--', peers: '--' }
  return { seeds: String(seeds ?? 0), peers: String(peers ?? 0) }
}

