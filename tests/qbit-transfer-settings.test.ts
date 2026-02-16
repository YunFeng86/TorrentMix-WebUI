import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

import { apiClient } from '../src/api/client.ts'
import { QbitAdapter, DEFAULT_QBIT_FEATURES } from '../src/adapter/qbit/adapter.ts'

test('qB transfer settings: getTransferSettings reads alt mode + alt limits via documented APIs', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)

  try {
    mock.method(apiClient as any, 'get', async (url: string, config?: any) => {
      if (url === '/api/v2/sync/maindata') {
        assert.equal(config?.params?.rid, 0)
        return {
          data: {
            rid: 1,
            full_update: true,
            torrents: {},
            server_state: {
              dl_rate_limit: 2048,
              up_rate_limit: 1024,
            },
          },
        }
      }

      if (url === '/api/v2/transfer/speedLimitsMode') return { data: '1' }

      if (url === '/api/v2/app/preferences') {
        return { data: { alt_dl_limit: 10, alt_up_limit: 20 } }
      }

      throw new Error(`unexpected GET: ${url}`)
    })

    const settings = await adapter.getTransferSettings()
    assert.equal(settings.downloadLimit, 2048)
    assert.equal(settings.uploadLimit, 1024)
    assert.equal(settings.altEnabled, true)
    assert.equal(settings.altDownloadLimit, 10 * 1024)
    assert.equal(settings.altUploadLimit, 20 * 1024)
  } finally {
    mock.restoreAll()
  }
})

test('qB transfer settings: getTransferSettings falls back to server_state and marks partial when APIs are blocked', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)

  try {
    mock.method(apiClient as any, 'get', async (url: string, config?: any) => {
      if (url === '/api/v2/sync/maindata') {
        assert.equal(config?.params?.rid, 0)
        return {
          data: {
            rid: 1,
            full_update: true,
            torrents: {},
            server_state: {
              use_alt_speed_limits: true,
            },
          },
        }
      }

      if (url === '/api/v2/transfer/speedLimitsMode') {
        const err: any = new Error('forbidden')
        err.response = { status: 403 }
        throw err
      }

      if (url === '/api/v2/app/preferences') {
        const err: any = new Error('forbidden')
        err.response = { status: 403 }
        throw err
      }

      throw new Error(`unexpected GET: ${url}`)
    })

    const settings = await adapter.getTransferSettings()
    assert.equal(settings.altEnabled, true)
    assert.equal(settings.partial, true)
  } finally {
    mock.restoreAll()
  }
})

test('qB transfer settings: setTransferSettings toggles alt mode when setSpeedLimitsMode is unsupported', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)

  let toggled = false

  try {
    mock.method(apiClient as any, 'get', async (url: string) => {
      if (url === '/api/v2/transfer/speedLimitsMode') return { data: 1 } // currently enabled
      throw new Error(`unexpected GET: ${url}`)
    })

    mock.method(apiClient as any, 'post', async (url: string) => {
      if (url === '/api/v2/transfer/setSpeedLimitsMode') {
        const err: any = new Error('not supported')
        err.response = { status: 404 }
        throw err
      }
      if (url === '/api/v2/transfer/toggleSpeedLimitsMode') {
        toggled = true
        return { data: '' }
      }
      throw new Error(`unexpected POST: ${url}`)
    })

    await adapter.setTransferSettings({ altEnabled: false })
    assert.equal(toggled, true)
  } finally {
    mock.restoreAll()
  }
})

test('qB transfer settings: setTransferSettings prefers transfer/setAlternativeSpeedLimits when setting both alt limits', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)

  try {
    mock.method(apiClient as any, 'post', async (url: string, _body?: any, config?: any) => {
      if (url === '/api/v2/transfer/setAlternativeSpeedLimits') {
        assert.equal(config?.params?.downloadLimit, 1024)
        assert.equal(config?.params?.uploadLimit, 2048)
        return { data: '' }
      }
      if (url === '/api/v2/app/setPreferences') {
        throw new Error('should not call app/setPreferences when setAlternativeSpeedLimits succeeds')
      }
      throw new Error(`unexpected POST: ${url}`)
    })

    await adapter.setTransferSettings({ altDownloadLimit: 1024, altUploadLimit: 2048 })
  } finally {
    mock.restoreAll()
  }
})

test('qB transfer settings: setTransferSettings writes alt limits via app/setPreferences (KiB/s)', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)

  try {
    mock.method(apiClient as any, 'post', async (url: string, body?: any) => {
      if (url === '/api/v2/app/setPreferences') {
        const json = body?.get?.('json')
        assert.ok(typeof json === 'string' && json.length > 0)
        const prefs = JSON.parse(json) as Record<string, unknown>
        assert.equal(prefs.alt_dl_limit, 3) // 3072 B/s -> 3 KiB/s
        assert.equal(prefs.alt_up_limit, undefined)
        return { data: '' }
      }
      throw new Error(`unexpected POST: ${url}`)
    })

    await adapter.setTransferSettings({ altDownloadLimit: 3072 })
  } finally {
    mock.restoreAll()
  }
})

test('qB sync: server_state use_alt_speed_limits should map to ServerState.useAltSpeed', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)

  try {
    mock.method(apiClient as any, 'get', async (_url: string) => ({
      data: {
        rid: 1,
        full_update: true,
        torrents: {},
        server_state: {
          connection_status: 'connected',
          use_alt_speed_limits: true,
        },
      },
    }))

    const res = await adapter.fetchList()
    assert.equal(res.serverState?.useAltSpeed, true)
  } finally {
    mock.restoreAll()
  }
})
