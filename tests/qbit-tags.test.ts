import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

import { apiClient } from '../src/api/client.ts'
import { QbitAdapter, DEFAULT_QBIT_FEATURES } from '../src/adapter/qbit/adapter.ts'

test('qB tags: setTagsBatch(set) with empty tags should remove all current tags via torrents/info', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)
  const hashes = ['h1', 'h2']

  let infoCalls = 0
  let removeCalls = 0

  try {
    mock.method(apiClient as any, 'get', async (url: string, config?: any) => {
      if (url === '/api/v2/torrents/info') {
        infoCalls++
        assert.equal(config?.params?.hashes, 'h1|h2')
        return {
          data: [
            { hash: 'h1', name: 'T1', tags: 'a, b' },
            { hash: 'h2', name: 'T2', tags: 'b, c' },
          ],
        }
      }
      throw new Error(`unexpected GET: ${url}`)
    })

    mock.method(apiClient as any, 'post', async (url: string, _body?: any, config?: any) => {
      if (url === '/api/v2/torrents/removeTags') {
        removeCalls++
        assert.equal(config?.params?.hashes, 'h1|h2')
        assert.equal(config?.params?.tags, 'a,b,c')
        return { data: '' }
      }
      throw new Error(`unexpected POST: ${url}`)
    })

    await adapter.setTagsBatch(hashes, [], 'set')

    assert.equal(infoCalls, 1)
    assert.equal(removeCalls, 1)
  } finally {
    mock.restoreAll()
  }
})

