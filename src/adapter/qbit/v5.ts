import { QbitAdapter } from './adapter'
import type { QbitFeatures } from '../detect'

/**
 * @deprecated 使用 QbitAdapter 替代，此类仅为向后兼容保留
 */
export class QbitV5Adapter extends QbitAdapter {
  constructor() {
    const v5Features: QbitFeatures = {
      pauseEndpoint: 'stop',
      resumeEndpoint: 'start',
      hasTorrentRename: true,
      hasFileRename: true,
      hasReannounceField: true,
      hasShareLimit: true,
      isLegacy: false
    }
    super(v5Features)
  }
}
