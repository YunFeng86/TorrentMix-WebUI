import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

import axios from 'axios'
import { detectBackendTypeOnly, detectBackendWithVersion } from '../src/adapter/detect.ts'

test('backend detection: VITE_TR_URL is preferred for Transmission probing (type-only + version)', async () => {
  const prev = process.env.VITE_TR_URL
  process.env.VITE_TR_URL = 'https://example.com/transmission/rpc'

  const expected = process.env.VITE_TR_URL
  assert.ok(expected && expected.length > 0)

  const postUrls: string[] = []

  const detector = {
    get: async () => ({ status: 404, data: '', headers: {} }),
    post: async (url: string) => {
      postUrls.push(url)
      assert.equal(url, expected)
      return {
        status: 200,
        data: {
          arguments: {
            version: '4.1.0',
            'rpc-version-semver': '6.0.0',
          },
          result: 'success',
        },
        headers: {},
      }
    },
  }

  try {
    mock.method(axios as any, 'create', () => detector as any)

    const v = await detectBackendWithVersion(1000)
    assert.equal(v.type, 'trans')
    assert.equal(v.version, '4.1.0')
    assert.equal(postUrls.length, 1)

    postUrls.length = 0

    const type = await detectBackendTypeOnly(1000)
    assert.equal(type, 'trans')
    assert.equal(postUrls.length, 1)
  } finally {
    if (prev === undefined) delete process.env.VITE_TR_URL
    else process.env.VITE_TR_URL = prev
    mock.restoreAll()
  }
})

