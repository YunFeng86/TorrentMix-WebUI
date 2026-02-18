export interface FolderTreeNode {
  name: string
  path: string
  children: FolderTreeNode[]
}

export interface FolderTree {
  hasRoot: boolean
  nodes: FolderTreeNode[]
}

/**
 * 虚拟根节点：用于表达“非默认下载目录”之类的逻辑分组，避免与真实目录名冲突。
 *
 * 注意：这是内部 key，不应直接展示给用户（UI 层应做翻译/图标提示）。
 */
export const VIRTUAL_ROOT_EXTERNAL = '<EXTERNAL>' as const
export const VIRTUAL_ROOT_EXTERNAL_PREFIX = `${VIRTUAL_ROOT_EXTERNAL}/` as const

export function isVirtualExternalPath(path: string): boolean {
  return path === VIRTUAL_ROOT_EXTERNAL || path.startsWith(VIRTUAL_ROOT_EXTERNAL_PREFIX)
}

export function stripVirtualExternalPrefix(path: string): string {
  if (path === VIRTUAL_ROOT_EXTERNAL) return ''
  if (path.startsWith(VIRTUAL_ROOT_EXTERNAL_PREFIX)) return path.slice(VIRTUAL_ROOT_EXTERNAL_PREFIX.length)
  return path
}

function normalizeFolderPath(path: string): string {
  return String(path ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
}

type MutableNode = {
  name: string
  path: string
  children: Map<string, MutableNode>
}

function toSortedNodes(children: Map<string, MutableNode>): FolderTreeNode[] {
  return Array.from(children.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((node) => ({
      name: node.name,
      path: node.path,
      children: toSortedNodes(node.children),
    }))
}

export function buildFolderTree(paths: string[]): FolderTree {
  const root: MutableNode = { name: '', path: '', children: new Map() }
  let hasRoot = false

  for (const raw of paths) {
    const normalized = normalizeFolderPath(raw)
    if (!normalized) {
      hasRoot = true
      continue
    }

    const parts = normalized.split('/').filter(Boolean)
    let parent = root
    let currentPath = ''
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      let child = parent.children.get(part)
      if (!child) {
        child = { name: part, path: currentPath, children: new Map() }
        parent.children.set(part, child)
      }
      parent = child
    }
  }

  return {
    hasRoot,
    nodes: toSortedNodes(root.children),
  }
}
