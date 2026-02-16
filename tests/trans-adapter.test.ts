import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

import { transClient } from '../src/api/trans-client.ts'
import { TransAdapter } from '../src/adapter/trans/index.ts'

test('Transmission legacy: fetchList should map torrent list + labels + trackerStats', async () => {
  const adapter = new TransAdapter()

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.method, 'torrent-get')
      assert.ok(Array.isArray(payload.arguments?.fields))
      assert.ok(payload.arguments.fields.includes('hashString'))
      assert.ok(payload.arguments.fields.includes('trackerStats'))
      assert.ok(payload.arguments.fields.includes('labels'))

      return {
        data: {
          result: 'success',
          arguments: {
            torrents: [
              {
                hashString: 'h1',
                name: 'T1',
                status: 4,
                error: 0,
                percentDone: 0.5,
                totalSize: 100,
                rateDownload: 10,
                rateUpload: 20,
                eta: 60,
                uploadRatio: 0.1,
                addedDate: 1,
                downloadDir: '/d',
                labels: ['cat', 't2'],
                trackerStats: [{ seederCount: 7, leecherCount: 8 }],
              },
            ],
          },
        },
      }
    })

    const res = await adapter.fetchList()
    const t = res.torrents.get('h1')!
    assert.equal(t.id, 'h1')
    assert.equal(t.name, 'T1')
    assert.equal(t.state, 'downloading')
    assert.equal(t.category, 'cat')
    assert.deepEqual(t.tags, ['cat', 't2'])
    assert.equal(t.totalSeeds, 7)
    assert.equal(t.totalPeers, 8)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: fetchDetail should map files/trackers/peers and speed limits', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })
  const hash = 'h2'

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.jsonrpc, '2.0')
      assert.equal(payload.method, 'torrent_get')
      assert.deepEqual(payload.params?.ids, [hash])
      assert.ok(Array.isArray(payload.params?.fields))
      assert.ok(payload.params.fields.includes('hash_string'))
      assert.ok(payload.params.fields.includes('labels'))
      assert.ok(payload.params.fields.includes('tracker_stats'))

      return {
        status: 200,
        data: {
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            torrents: [
              {
                hash_string: hash,
                name: 'T2',
                total_size: 1000,
                downloaded_ever: 200,
                uploaded_ever: 300,
                download_limited: true,
                download_limit: 12, // kB/s
                upload_limited: false,
                upload_limit: 34,
                seconds_seeding: 10,
                added_date: 1,
                done_date: 2,
                download_dir: '/x',
                labels: ['catA', 'tagB'],
                peers_connected: 2,
                peers: [
                  { address: '1.1.1.1', port: 1, client_name: 'c', progress: 1, rate_to_client: 0, rate_to_peer: 1 },
                  { address: '2.2.2.2', port: 2, client_name: 'c2', progress: 0.5, rate_to_client: 2, rate_to_peer: 0 },
                ],
                files: [
                  { name: 'a.bin', length: 100, bytes_completed: 100 },
                  { name: 'b.bin', length: 200, bytes_completed: 0 },
                ],
                priorities: [1, 0],
                wanted: [true, false],
                trackers: [{ announce: 'udp://tracker', tier: 0 }],
                tracker_stats: [{
                  announce: 'udp://tracker',
                  tier: 0,
                  announce_state: 0,
                  has_announced: true,
                  last_announce_succeeded: true,
                  last_announce_result: 'ok',
                  last_announce_peer_count: 11,
                  seeder_count: 50,
                  leecher_count: 60,
                }],
              },
            ],
          },
        },
      }
    })

    const detail = await adapter.fetchDetail(hash)
    assert.equal(detail.hash, hash)
    assert.equal(detail.name, 'T2')
    assert.equal(detail.size, 1000)
    assert.equal(detail.completed, 200)
    assert.equal(detail.uploaded, 300)
    assert.equal(detail.dlLimit, 12 * 1024)
    assert.equal(detail.upLimit, -1)
    assert.equal(detail.category, 'catA')
    assert.deepEqual(detail.tags, ['catA', 'tagB'])
    assert.equal(detail.numSeeds, 1)
    assert.equal(detail.numLeechers, 1)
    assert.equal(detail.totalSeeds, 50)
    assert.equal(detail.totalLeechers, 60)
    assert.equal(detail.files[0]?.priority, 'high')
    assert.equal(detail.files[1]?.priority, 'do_not_download')
    assert.equal(detail.trackers[0]?.status, 'working')
  } finally {
    mock.restoreAll()
  }
})

test('Transmission legacy: fetchList should retry without labels when unsupported', async () => {
  const adapter = new TransAdapter()

  let callCount = 0
  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      callCount++

      if (callCount === 1) {
        assert.ok(payload.arguments.fields.includes('labels'))
        return { data: { result: 'invalid argument' } }
      }

      assert.ok(!payload.arguments.fields.includes('labels'))
      return {
        data: {
          result: 'success',
          arguments: {
            torrents: [
              {
                hashString: 'h3',
                name: 'T3',
                status: 0,
                error: 0,
                percentDone: 0,
                totalSize: 0,
                rateDownload: 0,
                rateUpload: 0,
                eta: -1,
                uploadRatio: 0,
                addedDate: 0,
                downloadDir: '/d',
                trackerStats: [],
              },
            ],
          },
        },
      }
    })

    const res = await adapter.fetchList()
    const t = res.torrents.get('h3')!
    assert.equal(t.category, '')
    assert.deepEqual(t.tags, [])
    assert.equal(callCount, 2)
  } finally {
    mock.restoreAll()
  }
})

