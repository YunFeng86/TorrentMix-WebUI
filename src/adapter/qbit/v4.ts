import { apiClient } from '@/api/client'
import { QbitBaseAdapter } from './base'

export class QbitV4Adapter extends QbitBaseAdapter {
  async pause(hashes: string[]): Promise<void> {
    const params = new URLSearchParams()
    params.append('hashes', hashes.join('|') || 'all')
    await apiClient.post('/api/v2/torrents/pause', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  async resume(hashes: string[]): Promise<void> {
    const params = new URLSearchParams()
    params.append('hashes', hashes.join('|') || 'all')
    await apiClient.post('/api/v2/torrents/resume', params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }
}
