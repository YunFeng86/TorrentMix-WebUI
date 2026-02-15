import test, { mock } from 'node:test'
import assert from 'node:assert/strict'

import { apiClient } from '../src/api/client.ts'
import { QbitAdapter, DEFAULT_QBIT_FEATURES } from '../src/adapter/qbit/adapter.ts'

test('qB sync: incremental updates must respect empty string category/tags (no ghost data)', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)

  let step = 0
  try {
    mock.method(apiClient as any, 'get', async (_url: string) => {
      step++

      if (step === 1) {
        return {
          data: {
            rid: 1,
            full_update: true,
            torrents: {
              a: {
                name: 'A',
                state: 'pausedDL',
                progress: 0.5,
                size: 100,
                dlspeed: 0,
                upspeed: 0,
                eta: 10,
                ratio: 0,
                added_on: 1,
                save_path: '/x',
                category: 'cat1',
                tags: 't1,t2',
              },
            },
          },
        }
      }

      if (step === 2) {
        // partial update without category/tags: should retain previous values
        return {
          data: {
            rid: 2,
            torrents: {
              a: {
                state: 'pausedDL',
              },
            },
          },
        }
      }

      if (step === 3) {
        // empty string means "clear category"
        return {
          data: {
            rid: 3,
            torrents: {
              a: {
                category: '',
              },
            },
          },
        }
      }

      if (step === 4) {
        // empty string means "clear tags"
        return {
          data: {
            rid: 4,
            torrents: {
              a: {
                tags: '',
              },
            },
          },
        }
      }

      throw new Error('unexpected call')
    })

    const first = await adapter.fetchList()
    assert.equal(first.torrents.get('a')?.category, 'cat1')
    assert.deepEqual(first.torrents.get('a')?.tags, ['t1', 't2'])

    const second = await adapter.fetchList()
    assert.equal(second.torrents.get('a')?.category, 'cat1')
    assert.deepEqual(second.torrents.get('a')?.tags, ['t1', 't2'])

    const third = await adapter.fetchList()
    assert.equal(third.torrents.get('a')?.category, '')
    assert.deepEqual(third.torrents.get('a')?.tags, ['t1', 't2'])

    const fourth = await adapter.fetchList()
    assert.equal(fourth.torrents.get('a')?.category, '')
    assert.deepEqual(fourth.torrents.get('a')?.tags, [])
  } finally {
    mock.restoreAll()
  }
})

test('qB sync: rid reset after consecutive errors must rebuild categories/tags (no stale cache)', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)

  let step = 0
  try {
    mock.method(apiClient as any, 'get', async (_url: string, config?: any) => {
      step++

      // 1) initial success: old categories/tags
      if (step === 1) {
        return {
          data: {
            rid: 1,
            full_update: true,
            torrents: {},
            categories: { oldCat: { savePath: '/old' } },
            tags: ['oldTag'],
          },
        }
      }

      // 2) first failure
      if (step === 2) {
        throw new Error('network wobble')
      }

      // 3) second failure triggers rid reset logic
      if (step === 3) {
        throw new Error('network wobble')
      }

      // 4) rid reset fetch (rid=0)
      if (step === 4) {
        assert.equal(config?.params?.rid, 0)
        return {
          data: {
            rid: 10,
            full_update: true,
            torrents: {},
            categories: { newCat: { savePath: '/new' } },
            tags: ['newTag'],
          },
        }
      }

      throw new Error('unexpected call')
    })

    const first = await adapter.fetchList()
    assert.ok(first.categories?.has('oldCat'))
    assert.deepEqual(first.tags, ['oldTag'])

    await assert.rejects(() => adapter.fetchList())

    const afterReset = await adapter.fetchList()
    assert.ok(afterReset.categories?.has('newCat'))
    assert.equal(afterReset.categories?.has('oldCat'), false)
    assert.deepEqual(afterReset.tags, ['newTag'])
  } finally {
    mock.restoreAll()
  }
})

test('qB sync: full_update missing categories/tags must not clear cached snapshot (defensive)', async () => {
  const adapter = new QbitAdapter(DEFAULT_QBIT_FEATURES)

  let step = 0
  try {
    mock.method(apiClient as any, 'get', async (_url: string) => {
      step++

      if (step === 1) {
        return {
          data: {
            rid: 1,
            full_update: true,
            torrents: {},
            categories: { existing: { savePath: '/x' } },
            tags: ['t1'],
          },
        }
      }

      if (step === 2) {
        // 后端不规范：full_update 但省略 categories/tags 字段；前端不应把缓存误清空
        return {
          data: {
            rid: 2,
            full_update: true,
            torrents: {},
          },
        }
      }

      throw new Error('unexpected call')
    })

    const first = await adapter.fetchList()
    assert.ok(first.categories?.has('existing'))
    assert.deepEqual(first.tags, ['t1'])

    const second = await adapter.fetchList()
    assert.ok(second.categories?.has('existing'))
    assert.deepEqual(second.tags, ['t1'])
  } finally {
    mock.restoreAll()
  }
})
