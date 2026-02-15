import type { Component as VueComponent } from 'vue'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BarChart3,
  CheckCircle,
  ChevronLeft,
  ChevronUp,
  Clock,
  Columns3,
  Download,
  DownloadCloud,
  Edit2,
  File,
  Folder,
  FolderOpen,
  Gauge,
  HelpCircle,
  Inbox,
  List,
  Loader2,
  LogOut,
  MoreHorizontal,
  MousePointerClick,
  PanelLeft,
  Pause,
  PauseCircle,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Server,
  Settings,
  Sliders,
  SquareCheck,
  SquareX,
  Tag,
  Trash2,
  TrendingUp,
  UploadCloud,
  Users,
  Wifi,
  X,
  Zap,
} from 'lucide-vue-next'

/**
 * 显式注册项目使用到的图标，避免 `import * as Icons` 导致整包被打进 bundle。
 *
 * key 使用 lucide 的 kebab-case 命名（与 <Icon name="..."/> 传参保持一致）。
 */
export const iconRegistry = {
  'activity': Activity,
  'alert-circle': AlertCircle,
  'alert-triangle': AlertTriangle,
  'bar-chart-3': BarChart3,
  'check-circle': CheckCircle,
  'chevron-left': ChevronLeft,
  'chevron-up': ChevronUp,
  'clock': Clock,
  'columns-3': Columns3,
  'download': Download,
  'download-cloud': DownloadCloud,
  'edit-2': Edit2,
  'file': File,
  'folder': Folder,
  'folder-open': FolderOpen,
  'gauge': Gauge,
  'inbox': Inbox,
  'list': List,
  'loader-2': Loader2,
  'log-out': LogOut,
  'more-horizontal': MoreHorizontal,
  'mouse-pointer-click': MousePointerClick,
  'panel-left': PanelLeft,
  'pause': Pause,
  'pause-circle': PauseCircle,
  'play': Play,
  'plus': Plus,
  'radio': Radio,
  'refresh-cw': RefreshCw,
  'search': Search,
  'server': Server,
  'settings': Settings,
  'sliders': Sliders,
  'square-check': SquareCheck,
  'square-x': SquareX,
  'tag': Tag,
  'trash-2': Trash2,
  'trending-up': TrendingUp,
  'upload-cloud': UploadCloud,
  'users': Users,
  'wifi': Wifi,
  'x': X,
  'zap': Zap,
} as const satisfies Record<string, VueComponent>

export type RegistryIconName = keyof typeof iconRegistry
export type IconName = RegistryIconName

export const fallbackIcon: VueComponent = HelpCircle

const warnedMissingIconNames = new Set<string>()

function isDev(): boolean {
  // Vite replaces `import.meta.env` at build-time; guard for non-Vite runtimes (e.g. Node tests).
  return (import.meta as any).env?.DEV === true
}

export function getIconComponent(name: string): VueComponent {
  const icon = (iconRegistry as Record<string, VueComponent>)[name]
  if (icon) return icon

  if (isDev() && !warnedMissingIconNames.has(name)) {
    warnedMissingIconNames.add(name)
    console.warn(`[Icon] Unknown icon "${name}". Add it to src/components/icons/registry.ts`)
  }

  return fallbackIcon
}
