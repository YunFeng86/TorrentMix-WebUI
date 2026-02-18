import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

import { apiClient } from '../src/api/client.ts'
import { transClient } from '../src/api/trans-client.ts'
import { QbitAdapter, DEFAULT_QBIT_FEATURES } from '../src/adapter/qbit/adapter.ts'
import { TransAdapter } from '../src/adapter/trans/index.ts'

test('qB preferences: getPreferences should normalize raw preferences', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)

  try {
    mock.method(apiClient as any, 'get', async (url: string) => {
      assert.equal(url, '/api/v2/app/preferences')
      return {
        data: {
          // 连接（混合主键/备用键）
          connection_limit: 111,
          max_connections_per_torrent: 11,

          // 队列
          queueing_enabled: true,
          max_active_downloads: 2,
          max_active_uploads: 3,

          // 端口
          listen_port: 51413,
          random_port: false,
          upnp_enabled: true,

          // 协议
          dht: true,
          pex: false,
          lsd: true,
          encryption: 1,

          // 做种限制（备用键）
          share_ratio_limit: 2.5,
          share_ratio_limit_enabled: true,
          max_seeding_time_minutes: 30,
          max_seeding_time_enabled: false,

          // 路径（备用键）
          save_path: '/downloads',
          temp_path_enabled: true,
          incomplete_dir: '/incomplete',
          incomplete_files_ext: true,
          subcategory_enabled: false,
        },
      }
    })

    const prefs = await adapter.getPreferences()
    assert.equal(prefs.maxConnections, 111)
    assert.equal(prefs.maxConnectionsPerTorrent, 11)
    assert.equal(prefs.queueDownloadEnabled, true)
    assert.equal(prefs.queueSeedEnabled, true)
    assert.equal(prefs.queueDownloadMax, 2)
    assert.equal(prefs.queueSeedMax, 3)
    assert.equal(prefs.listenPort, 51413)
    assert.equal(prefs.randomPort, false)
    assert.equal(prefs.upnpEnabled, true)
    assert.equal(prefs.dhtEnabled, true)
    assert.equal(prefs.pexEnabled, false)
    assert.equal(prefs.lsdEnabled, true)
    assert.equal(prefs.encryption, 'require')
    assert.equal(prefs.shareRatioLimit, 2.5)
    assert.equal(prefs.shareRatioLimited, true)
    assert.equal(prefs.seedingTimeLimit, 30)
    assert.equal(prefs.seedingTimeLimited, false)
    assert.equal(prefs.savePath, '/downloads')
    assert.equal(prefs.incompleteDirEnabled, true)
    assert.equal(prefs.incompleteDir, '/incomplete')
    assert.equal(prefs.incompleteFilesSuffix, true)
    assert.equal(prefs.createSubfolderEnabled, false)
  } finally {
    mock.restoreAll()
  }
})

test('qB preferences: setPreferences should patch via app/setPreferences', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)

  try {
    mock.method(apiClient as any, 'post', async (url: string, body?: any) => {
      assert.equal(url, '/api/v2/app/setPreferences')
      const raw = body?.get?.('json')
      assert.ok(typeof raw === 'string' && raw.length > 0)

      const payload = JSON.parse(raw) as Record<string, unknown>
      assert.deepEqual(payload, {
        max_connec: 200,
        queueing_enabled: false,
        listen_port: 12345,
        upnp: false,
        encryption: 2,
        max_ratio: 3,
        max_ratio_enabled: true,
        save_path: '/x',
        temp_path_enabled: false,
        temp_path: '/tmp',
        incomplete_files_ext: true,
        create_subfolder_enabled: true,
      })

      return { data: '' }
    })

    await adapter.setPreferences({
      maxConnections: 200,
      queueSeedEnabled: false,
      listenPort: 12345,
      upnpEnabled: false,
      encryption: 'disable',
      shareRatioLimit: 3,
      shareRatioLimited: true,
      savePath: '/x',
      incompleteDirEnabled: false,
      incompleteDir: '/tmp',
      incompleteFilesSuffix: true,
      createSubfolderEnabled: true,
    })
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: getPreferences should normalize session-get (snake_case)', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.jsonrpc, '2.0')
      assert.equal(payload.method, 'session_get')
      return {
        status: 200,
        data: {
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            peer_limit_global: 500,
            peer_limit_per_torrent: 50,
            download_queue_enabled: true,
            download_queue_size: 3,
            seed_queue_enabled: false,
            seed_queue_size: 2,
            queue_stalled_enabled: true,
            queue_stalled_minutes: 30,
            peer_port: 51413,
            peer_port_random_on_start: false,
            port_forwarding_enabled: true,
            dht_enabled: true,
            pex_enabled: false,
            lpd_enabled: true,
            encryption: 'preferred',
            seed_ratio_limit: 2,
            seed_ratio_limited: true,
            seed_idle_limit: 10,
            seed_idle_limited: true,
            download_dir: '/downloads',
            incomplete_dir_enabled: true,
            incomplete_dir: '/incomplete',
            rename_partial_files: true,
          },
        },
      }
    })

    const prefs = await adapter.getPreferences()
    assert.equal(prefs.maxConnections, 500)
    assert.equal(prefs.maxConnectionsPerTorrent, 50)
    assert.equal(prefs.queueDownloadEnabled, true)
    assert.equal(prefs.queueDownloadMax, 3)
    assert.equal(prefs.queueSeedEnabled, false)
    assert.equal(prefs.queueSeedMax, 2)
    assert.equal(prefs.queueStalledEnabled, true)
    assert.equal(prefs.queueStalledMinutes, 30)
    assert.equal(prefs.listenPort, 51413)
    assert.equal(prefs.randomPort, false)
    assert.equal(prefs.upnpEnabled, true)
    assert.equal(prefs.dhtEnabled, true)
    assert.equal(prefs.pexEnabled, false)
    assert.equal(prefs.lsdEnabled, true)
    assert.equal(prefs.encryption, 'prefer')
    assert.equal(prefs.shareRatioLimit, 2)
    assert.equal(prefs.shareRatioLimited, true)
    assert.equal(prefs.seedingTimeLimit, 10)
    assert.equal(prefs.seedingTimeLimited, true)
    assert.equal(prefs.savePath, '/downloads')
    assert.equal(prefs.incompleteDirEnabled, true)
    assert.equal(prefs.incompleteDir, '/incomplete')
    assert.equal(prefs.incompleteFilesSuffix, true)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission json-rpc2: setPreferences should patch via session-set (snake_case)', async () => {
  const adapter = new TransAdapter({ rpcSemver: '6.0.0' })

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.jsonrpc, '2.0')
      assert.equal(payload.method, 'session_set')
      assert.deepEqual(payload.params, {
        peer_limit_global: 111,
        download_queue_enabled: false,
        lpd_enabled: false,
        encryption: 'required',
        seed_ratio_limit: 3,
        incomplete_dir_enabled: false,
        rename_partial_files: false,
      })

      return {
        status: 200,
        data: { jsonrpc: '2.0', id: payload.id, result: {} },
      }
    })

    await adapter.setPreferences({
      maxConnections: 111,
      queueDownloadEnabled: false,
      lsdEnabled: false,
      encryption: 'require',
      shareRatioLimit: 3,
      incompleteDirEnabled: false,
      incompleteFilesSuffix: false,
    })
  } finally {
    mock.restoreAll()
  }
})

test('Transmission legacy: getPreferences should normalize session-get (kebab-case)', async () => {
  const adapter = new TransAdapter()

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.method, 'session-get')
      return {
        data: {
          result: 'success',
          arguments: {
            'peer-limit-global': 100,
            'peer-limit-per-torrent': 10,
            'download-queue-enabled': true,
            'download-queue-size': 1,
            'seed-queue-enabled': true,
            'seed-queue-size': 2,
            'queue-stalled-enabled': false,
            'queue-stalled-minutes': 5,
            'peer-port': 51413,
            'peer-port-random-on-start': true,
            'port-forwarding-enabled': false,
            'dht-enabled': false,
            'pex-enabled': true,
            'lpd-enabled': false,
            encryption: 'tolerated',
            'seed-ratio-limit': 0.5,
            'seed-ratio-limited': true,
            'seed-idle-limit': 15,
            'seed-idle-limited': true,
            'download-dir': '/d',
            'incomplete-dir-enabled': false,
            'incomplete-dir': '/i',
            'rename-partial-files': false,
          },
        },
      }
    })

    const prefs = await adapter.getPreferences()
    assert.equal(prefs.maxConnections, 100)
    assert.equal(prefs.maxConnectionsPerTorrent, 10)
    assert.equal(prefs.queueDownloadEnabled, true)
    assert.equal(prefs.queueDownloadMax, 1)
    assert.equal(prefs.queueSeedEnabled, true)
    assert.equal(prefs.queueSeedMax, 2)
    assert.equal(prefs.queueStalledEnabled, false)
    assert.equal(prefs.queueStalledMinutes, 5)
    assert.equal(prefs.listenPort, 51413)
    assert.equal(prefs.randomPort, true)
    assert.equal(prefs.upnpEnabled, false)
    assert.equal(prefs.dhtEnabled, false)
    assert.equal(prefs.pexEnabled, true)
    assert.equal(prefs.lsdEnabled, false)
    assert.equal(prefs.encryption, 'tolerate')
    assert.equal(prefs.shareRatioLimit, 0.5)
    assert.equal(prefs.shareRatioLimited, true)
    assert.equal(prefs.seedingTimeLimit, 15)
    assert.equal(prefs.seedingTimeLimited, true)
    assert.equal(prefs.savePath, '/d')
    assert.equal(prefs.incompleteDirEnabled, false)
    assert.equal(prefs.incompleteDir, '/i')
    assert.equal(prefs.incompleteFilesSuffix, false)
  } finally {
    mock.restoreAll()
  }
})

test('Transmission legacy: setPreferences should patch via session-set (kebab-case)', async () => {
  const adapter = new TransAdapter()

  try {
    mock.method(transClient as any, 'post', async (_url: string, payload: any) => {
      assert.equal(payload.method, 'session-set')
      assert.deepEqual(payload.arguments, {
        'peer-limit-global': 111,
        'download-queue-enabled': false,
        'lpd-enabled': false,
        encryption: 'required',
        seedRatioLimit: 3,
        'incomplete-dir-enabled': false,
        'rename-partial-files': false,
      })
      return { data: { result: 'success', arguments: {} } }
    })

    await adapter.setPreferences({
      maxConnections: 111,
      queueDownloadEnabled: false,
      lsdEnabled: false,
      encryption: 'require',
      shareRatioLimit: 3,
      incompleteDirEnabled: false,
      incompleteFilesSuffix: false,
    })
  } finally {
    mock.restoreAll()
  }
})
