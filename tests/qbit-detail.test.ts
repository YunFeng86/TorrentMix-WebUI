import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

import { apiClient } from '../src/api/client.ts'
import { QbitAdapter, DEFAULT_QBIT_FEATURES } from '../src/adapter/qbit/adapter.ts'

test('qB detail: fetchDetail must merge torrents/info with generic properties', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)
  const hash = 'abc'

  try {
    mock.method(apiClient as any, 'get', async (url: string, config?: any) => {
      if (url === '/api/v2/torrents/info') {
        assert.equal(config?.params?.hashes, hash)
        return {
          data: [
            {
              hash,
              name: 'My Torrent',
              size: 100,
              progress: 0.4,
              completed: 40,
              uploaded: 12,
              dl_limit: -1,
              up_limit: 2048,
              seeding_time: 10,
              added_on: 1,
              completion_on: 2,
              save_path: '/downloads',
              category: 'cat',
              tags: 't1, t2,',
              num_seeds: 5,
              num_leechs: 6,
              // unknown swarm stats should fall back to /torrents/properties
              num_complete: -1,
              num_incomplete: -1,
            },
          ],
        }
      }

      if (url === '/api/v2/torrents/properties') {
        assert.equal(config?.params?.hash, hash)
        return {
          data: {
            save_path: '/downloads',
            addition_date: 1,
            completion_date: 2,
            total_downloaded: 40,
            total_uploaded: 12,
            dl_limit: -1,
            up_limit: 2048,
            seeding_time: 10,
            nb_connections: 99,
            seeds_total: 50,
            peers_total: 60,
            seeds: 5,
            peers: 6,
            total_size: 100,
          },
        }
      }

      if (url === '/api/v2/torrents/files') return { data: [] }
      if (url === '/api/v2/torrents/trackers') return { data: [] }
      if (url === '/api/v2/sync/torrentPeers') return { data: { peers: {} } }

      throw new Error(`unexpected call: ${url}`)
    })

    const detail = await adapter.fetchDetail(hash)
    assert.equal(detail.hash, hash)
    assert.equal(detail.name, 'My Torrent')
    assert.equal(detail.size, 100)
    assert.equal(detail.completed, 40)
    assert.equal(detail.uploaded, 12)
    assert.equal(detail.dlLimit, -1)
    assert.equal(detail.upLimit, 2048)
    assert.equal(detail.seedingTime, 10)
    assert.equal(detail.addedTime, 1)
    assert.equal(detail.completionOn, 2)
    assert.equal(detail.savePath, '/downloads')
    assert.equal(detail.category, 'cat')
    assert.deepEqual(detail.tags, ['t1', 't2'])
    assert.equal(detail.connections, 99)
    assert.equal(detail.numSeeds, 5)
    assert.equal(detail.numLeechers, 6)
    assert.equal(detail.totalSeeds, 50)
    assert.equal(detail.totalLeechers, 60)
  } finally {
    mock.restoreAll()
  }
})

test('qB detail: fetchDetail falls back when torrents/info is unavailable (partial detail)', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)
  const hash = 'abc'

  ;(adapter as any).currentMap.set(hash, {
    id: hash,
    name: 'Cached Torrent',
    state: 'paused',
    progress: 0.5,
    size: 100,
    dlspeed: 0,
    upspeed: 0,
    eta: 10,
    ratio: 0.3,
    addedTime: 1,
    savePath: '/cached',
    category: 'cat',
    tags: ['t1', 't2'],
    connectedSeeds: 2,
    connectedPeers: 3,
    totalSeeds: 20,
    totalPeers: 30,
  })

  try {
    mock.method(apiClient as any, 'get', async (url: string, config?: any) => {
      if (url === '/api/v2/torrents/info') {
        assert.equal(config?.params?.hashes, hash)
        const err: any = new Error('blocked by proxy')
        err.response = { status: 404 }
        throw err
      }

      if (url === '/api/v2/torrents/properties') {
        assert.equal(config?.params?.hash, hash)
        return {
          data: {
            save_path: '/downloads',
            addition_date: 1,
            completion_date: 0,
            total_downloaded: 40,
            total_uploaded: 12,
            dl_limit: -1,
            up_limit: 2048,
            seeding_time: 10,
            nb_connections: 99,
            seeds: 5,
            peers: 6,
            seeds_total: 50,
            peers_total: 60,
            total_size: 100,
          },
        }
      }

      if (url === '/api/v2/torrents/files') return { data: [] }
      if (url === '/api/v2/torrents/trackers') return { data: [] }
      if (url === '/api/v2/sync/torrentPeers') return { data: { peers: {} } }

      throw new Error(`unexpected call: ${url}`)
    })

    const detail = await adapter.fetchDetail(hash)
    assert.equal(detail.partial, true)
    assert.equal(detail.hash, hash)
    assert.equal(detail.name, 'Cached Torrent')
    assert.equal(detail.size, 100)
    assert.equal(detail.completed, 40)
    assert.equal(detail.uploaded, 12)
    assert.equal(detail.dlLimit, -1)
    assert.equal(detail.upLimit, 2048)
    assert.equal(detail.savePath, '/downloads')
    assert.equal(detail.category, 'cat')
    assert.deepEqual(detail.tags, ['t1', 't2'])
    assert.equal(detail.connections, 99)
    assert.equal(detail.numSeeds, 5)
    assert.equal(detail.numLeechers, 6)
    assert.equal(detail.totalSeeds, 50)
    assert.equal(detail.totalLeechers, 60)
  } finally {
    mock.restoreAll()
  }
})
