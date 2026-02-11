import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

import axios from 'axios'
import { detectBackendWithVersion } from '../src/adapter/detect.ts'

test('version detection: detectBackendWithVersion parses qBittorrent version', async () => {
  const detector = {
    get: async (url: string) => {
      if (url === '/api/v2/app/version') return { status: 200, data: '5.0.4' }
      if (url === '/api/v2/app/webapiVersion') return { status: 200, data: '2.11.0' }
      return { status: 404, data: '' }
    },
    post: async () => ({ status: 404, data: {} }),
  }

  try {
    mock.method(axios as any, 'create', () => detector as any)
    const v = await detectBackendWithVersion(1000)
    assert.equal(v.type, 'qbit')
    assert.equal(v.version, '5.0.4')
    assert.equal(v.major, 5)
    assert.equal(v.minor, 0)
    assert.equal(v.patch, 4)
    assert.equal(v.apiVersion, '2.11.0')
  } finally {
    mock.restoreAll()
  }
})
