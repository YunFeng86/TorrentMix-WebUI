import { QbitAdapter } from './adapter'
import type { QbitFeatures } from '../detect'

/**
 * @deprecated 使用 QbitAdapter 替代，此类仅为向后兼容保留
 */
export class QbitV4Adapter extends QbitAdapter {
  constructor() {
    const v4Features: QbitFeatures = {
      pauseEndpoint: 'pause',
      resumeEndpoint: 'resume',
      hasTorrentRename: true,   // v4.1+ 支持
      hasFileRename: true,      // v4.1+ 支持
      hasReannounceField: true, // v4.1+ 支持
      hasShareLimit: true,      // v4.1+ 支持
      isLegacy: true
    }
    super(v4Features)
  }
}
