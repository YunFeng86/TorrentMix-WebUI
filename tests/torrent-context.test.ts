import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'

import { useBackendStore } from '../src/store/backend.ts'
import { useTorrentStore } from '../src/store/torrent.ts'
import { useTorrentContext } from '../src/composables/useTorrentContext.ts'

function makeTorrent(id: string, name: string) {
  return {
    id,
    name,
    state: 'paused',
    progress: 0,
    size: 100,
    dlspeed: 0,
    upspeed: 0,
    eta: -1,
    ratio: 0,
    addedTime: 0,
    savePath: '',
  } as any
}

test('torrent context: refreshList updates torrentStore + backend global data', async () => {
  setActivePinia(createPinia())

  const backend = useBackendStore()
  const torrents = new Map([['a', makeTorrent('a', 'A')]])
  const categories = new Map([['c1', { name: 'c1', savePath: '/x' }]])
  const tags = ['t1']

  let fetchListCalled = 0
  backend.setAdapter(
    {
      fetchList: async () => {
        fetchListCalled++
        return {
          torrents,
          categories,
          tags,
          serverState: { dlInfoSpeed: 1, upInfoSpeed: 2 } as any,
        }
      },
    } as any,
    { type: 'qbit', version: '5.0.0', major: 5, minor: 0, patch: 0 } as any
  )

  const ctx = useTorrentContext()
  await ctx.refreshList()

  const torrentStore = useTorrentStore()
  assert.equal(fetchListCalled, 1)
  assert.equal(torrentStore.torrents.get('a')?.name, 'A')
  assert.equal(backend.categories.get('c1')?.name, 'c1')
  assert.deepEqual(backend.tags, ['t1'])
})

test('torrent context: runTorrentAction pause/resume/delete calls adapter and can clear selection', async () => {
  setActivePinia(createPinia())

  // Provide browser-like globals used by delete confirmation.
  const confirmCalls: boolean[] = []
  ;(globalThis as any).confirm = (v?: any) => {
    void v
    const next = confirmCalls.shift()
    if (next === undefined) throw new Error('confirm not seeded')
    return next
  }

  const backend = useBackendStore()
  const torrentStore = useTorrentStore()
  torrentStore.updateTorrents(new Map([['a', makeTorrent('a', 'Alpha')]]))

  let fetchListCalled = 0
  let pauseCalled: string[] | null = null
  let resumeCalled: string[] | null = null
  let deleteCalled: { hashes: string[]; deleteFiles: boolean } | null = null

  backend.setAdapter(
    {
      fetchList: async () => {
        fetchListCalled++
        return { torrents: torrentStore.torrents }
      },
      pause: async (hashes: string[]) => { pauseCalled = hashes },
      resume: async (hashes: string[]) => { resumeCalled = hashes },
      delete: async (hashes: string[], deleteFiles: boolean) => { deleteCalled = { hashes, deleteFiles } },
      recheck: async () => {},
      recheckBatch: async () => {},
      reannounce: async () => {},
      reannounceBatch: async () => {},
      forceStart: async () => {},
      forceStartBatch: async () => {},
    } as any,
    { type: 'qbit', version: '5.0.0', major: 5, minor: 0, patch: 0 } as any
  )

  const ctx = useTorrentContext()

  ctx.uiState.selection.add('a')
  await ctx.runTorrentAction('pause', ['a'], { clearSelection: true })
  assert.deepEqual(pauseCalled, ['a'])
  assert.equal(ctx.uiState.selection.size, 0)

  ctx.uiState.selection.add('a')
  await ctx.runTorrentAction('resume', ['a'], { clearSelection: true })
  assert.deepEqual(resumeCalled, ['a'])
  assert.equal(ctx.uiState.selection.size, 0)

  // Delete: first confirm -> deleteFiles? false; second confirm -> ok.
  confirmCalls.push(false, true)
  ctx.uiState.selection.add('a')
  await ctx.runTorrentAction('delete', ['a'], { clearSelection: true })
  assert.deepEqual(deleteCalled, { hashes: ['a'], deleteFiles: false })
  assert.equal(ctx.uiState.selection.size, 0)

  // refreshList runs for each action
  assert.ok(fetchListCalled >= 3)
})
