import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

import axios from 'axios'
import { detectBackendTypeOnly } from '../src/adapter/detect.ts'

test('backend detection: VITE_BACKEND_TYPE forces backend type (overrides cache) and bypasses probing', async () => {
  // If forced backend works, axios.create should never be called.
  let createCalled = 0
  mock.method(axios as any, 'create', () => {
    createCalled++
    throw new Error('axios.create should not be called when VITE_BACKEND_TYPE is set')
  })

  try {
    process.env.VITE_BACKEND_TYPE = 'qbit'
    const first = await detectBackendTypeOnly(10)
    assert.equal(first, 'qbit')

    process.env.VITE_BACKEND_TYPE = 'trans'
    const second = await detectBackendTypeOnly(10)
    assert.equal(second, 'trans')

    assert.equal(createCalled, 0)
  } finally {
    delete process.env.VITE_BACKEND_TYPE
    mock.restoreAll()
  }
})

