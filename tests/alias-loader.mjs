import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import fs from 'node:fs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const exts = ['.ts', '.js', '.mjs', '.json', '.vue']

function resolveWithExtensions(base) {
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base

  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of exts) {
      const indexFile = path.join(base, `index${ext}`)
      if (fs.existsSync(indexFile)) return indexFile
    }
  }

  for (const ext of exts) {
    const withExt = base + ext
    if (fs.existsSync(withExt)) return withExt
  }

  return base
}

function resolveAliasToFile(specifier) {
  // specifier: "@/foo/bar"
  const base = path.join(projectRoot, 'src', specifier.slice(2))
  return resolveWithExtensions(base)
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const fsPath = resolveAliasToFile(specifier)
    return nextResolve(pathToFileURL(fsPath).href, context)
  }

  // Resolve extensionless relative imports in TS sources (Vite-style) for Node ESM tests.
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && path.extname(specifier) === '') {
    const parentURL = context.parentURL
    if (parentURL && parentURL.startsWith('file://')) {
      const parentPath = fileURLToPath(parentURL)
      const baseDir = path.dirname(parentPath)
      const absBase = path.resolve(baseDir, specifier)
      const fsPath = resolveWithExtensions(absBase)
      return nextResolve(pathToFileURL(fsPath).href, context)
    }
  }

  return nextResolve(specifier, context)
}
