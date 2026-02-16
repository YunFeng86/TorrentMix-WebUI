import test from 'node:test'
import assert from 'node:assert/strict'

import { formatBytes, formatSpeed, formatDuration } from '../src/utils/format.ts'

test('format: formatBytes should be stable for small/invalid numbers', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(0.5), '0 B')
  assert.equal(formatBytes(1), '1 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(-1), '--')
  assert.equal(formatBytes(Number.NaN), '--')
  assert.equal(formatBytes(Number.POSITIVE_INFINITY), '--')
})

test('format: formatSpeed should not append /s for invalid bytes', () => {
  assert.equal(formatSpeed(0), '0 B/s')
  assert.equal(formatSpeed(1024), '1.0 KB/s')
  assert.equal(formatSpeed(Number.NaN), '--')
})

test('format: formatDuration should be stable for invalid/negative seconds', () => {
  assert.equal(formatDuration(-1), '∞')
  assert.equal(formatDuration(0), '0s')
  assert.equal(formatDuration(59), '59s')
  assert.equal(formatDuration(60), '1m 0s')
  assert.equal(formatDuration(3600), '1h 0m')
  assert.equal(formatDuration(-5), '--')
  assert.equal(formatDuration(Number.NaN), '--')
})

