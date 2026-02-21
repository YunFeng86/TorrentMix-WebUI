import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const LATEST_URL = String(process.env.LATEST_URL || '').trim()
const TARGET_DIR = String(process.env.TARGET_DIR || '/target').trim()
const CHECK_INTERVAL_SEC = Number.parseInt(String(process.env.CHECK_INTERVAL_SEC || '3600'), 10)

const MARKER_FILE = '.webui-version.json'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

async function download(url, outPath, timeoutMs = 60000) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { cache: 'no-store', signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const arrayBuffer = await res.arrayBuffer()
    const buf = Buffer.from(arrayBuffer)
    await fs.writeFile(outPath, buf)
    return buf
  } finally {
    clearTimeout(t)
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function emptyDir(dir) {
  await ensureDir(dir)
  const entries = await fs.readdir(dir)
  await Promise.all(entries.map(name => fs.rm(path.join(dir, name), { recursive: true, force: true })))
}

async function copyDir(src, dest) {
  await fs.cp(src, dest, { recursive: true })
}

function unzip(zipPath, destDir) {
  const res = spawnSync('unzip', ['-q', '-o', zipPath, '-d', destDir], { stdio: 'inherit' })
  if (res.status !== 0) throw new Error('unzip failed')
}

async function readInstalledMarker() {
  try {
    const raw = await fs.readFile(path.join(TARGET_DIR, MARKER_FILE), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeInstalledMarker(marker) {
  await fs.writeFile(path.join(TARGET_DIR, MARKER_FILE), JSON.stringify(marker, null, 2) + '\n', 'utf8')
}

function resolveZipUrl(latestUrl, latestJson) {
  if (latestJson?.release?.distZip) {
    return new URL(String(latestJson.release.distZip), latestUrl).toString()
  }
  // 兼容：直接给了 publish 目录下的 manifest.json（没有 zip 信息）
  return null
}

async function installOnce() {
  if (!LATEST_URL) {
    throw new Error('LATEST_URL is required (points to latest.json)')
  }

  console.log(`[sidecar] checking ${LATEST_URL}`)
  const latest = await fetchJson(LATEST_URL)

  const version = String(latest?.version || 'unknown')
  const zipUrl = resolveZipUrl(LATEST_URL, latest)
  const expectedZipSha256 = String(latest?.release?.distZipSha256 || '').trim().toLowerCase()

  if (!zipUrl) {
    throw new Error('latest.json does not contain release.distZip; cannot sidecar-install')
  }

  const installed = await readInstalledMarker()
  if (installed?.version === version && installed?.zipUrl === zipUrl && (!expectedZipSha256 || installed?.zipSha256 === expectedZipSha256)) {
    console.log(`[sidecar] up-to-date: ${version}`)
    return
  }

  console.log(`[sidecar] downloading ${zipUrl}`)
  const tmpRoot = '/tmp/webui-sidecar'
  const zipPath = path.join(tmpRoot, 'full-dist.zip')
  const extractDir = path.join(tmpRoot, 'extract')
  await ensureDir(tmpRoot)
  await fs.rm(extractDir, { recursive: true, force: true })

  const zipBuf = await download(zipUrl, zipPath)
  const zipSha256 = sha256Hex(zipBuf)
  if (expectedZipSha256 && zipSha256 !== expectedZipSha256) {
    throw new Error(`zip sha256 mismatch: expected=${expectedZipSha256}, got=${zipSha256}`)
  }

  console.log('[sidecar] extracting…')
  unzip(zipPath, extractDir)

  // 解压后的结构：根目录应包含 index.html
  try {
    const stat = await fs.stat(path.join(extractDir, 'index.html'))
    if (!stat.isFile()) throw new Error('index.html is not a file')
  } catch {
    throw new Error('invalid zip: index.html not found at root')
  }

  console.log(`[sidecar] installing to ${TARGET_DIR}`)
  await emptyDir(TARGET_DIR)
  await copyDir(extractDir, TARGET_DIR)

  await writeInstalledMarker({
    version,
    zipUrl,
    zipSha256,
    installedAt: new Date().toISOString(),
  })

  console.log(`[sidecar] installed: ${version}`)
}

async function main() {
  await ensureDir(TARGET_DIR)

  if (!Number.isFinite(CHECK_INTERVAL_SEC) || CHECK_INTERVAL_SEC <= 0) {
    await installOnce()
    return
  }

  while (true) {
    try {
      await installOnce()
    } catch (err) {
      console.error('[sidecar] update failed:', err?.stack || err?.message || err)
    }

    await sleep(CHECK_INTERVAL_SEC * 1000)
  }
}

await main()

