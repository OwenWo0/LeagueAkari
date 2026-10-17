import { describe, expect, it, vi } from 'vitest'

import { fetchNetworkSession } from './fetch'

describe('NetworkMain fetch adapter', () => {
  it('waits for proxy configuration and always rejects redirects', async () => {
    const order: string[] = []
    const waitUntilConfigured = vi.fn(async () => {
      order.push('proxy-ready')
    })
    const fetch = vi.fn(async () => new Response('ok'))
    const electronSession = { fetch } as never

    await fetchNetworkSession(
      electronSession,
      waitUntilConfigured,
      new URL('https://provider.example/v1/chat/completions'),
      { method: 'POST', redirect: 'follow' }
    )

    expect(order).toEqual(['proxy-ready'])
    expect(waitUntilConfigured).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith('https://provider.example/v1/chat/completions', {
      method: 'POST',
      redirect: 'error'
    })
  })
})
