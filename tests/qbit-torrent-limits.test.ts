import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

import { apiClient } from '../src/api/client.ts'
import { QbitAdapter, DEFAULT_QBIT_FEATURES } from '../src/adapter/qbit/adapter.ts'

test('qB torrent limits: setDownloadLimitBatch should map <= 0 to 0 for API', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)

  try {
    mock.method(apiClient as any, 'post', async (url: string, _body?: any, config?: any) => {
      assert.equal(url, '/api/v2/torrents/setDownloadLimit')
      assert.equal(config?.params?.hashes, 'a|b')
      assert.equal(config?.params?.limit, '0')
      return { data: '' }
    })

    await adapter.setDownloadLimitBatch(['a', 'b'], -1)
  } finally {
    mock.restoreAll()
  }
})

test('qB torrent limits: setUploadLimitBatch should map <= 0 to 0 for API', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)

  try {
    mock.method(apiClient as any, 'post', async (url: string, _body?: any, config?: any) => {
      assert.equal(url, '/api/v2/torrents/setUploadLimit')
      assert.equal(config?.params?.hashes, 'abc')
      assert.equal(config?.params?.limit, '0')
      return { data: '' }
    })

    await adapter.setUploadLimitBatch(['abc'], 0)
  } finally {
    mock.restoreAll()
  }
})

