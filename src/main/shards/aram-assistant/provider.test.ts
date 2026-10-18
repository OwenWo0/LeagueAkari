import { describe, expect, it, vi } from 'vitest'

import { createVisionProvider, normalizeBaseUrl, providerCredentialScope } from './provider'

describe('vision provider HTTP handling', () => {
  it('keeps credentials isolated by protocol and complete normalized base URL', () => {
    expect(providerCredentialScope('openai', 'https://provider.example/v1/')).toBe(
      'openai\nhttps://provider.example/v1'
    )
    expect(providerCredentialScope('openai', 'https://provider.example/v2')).not.toBe(
      providerCredentialScope('openai', 'https://provider.example/v1')
    )
    expect(providerCredentialScope('gemini', 'https://provider.example/v1')).not.toBe(
      providerCredentialScope('openai', 'https://provider.example/v1')
    )
  })

  it('rejects credential-bearing, queried, malformed, and non-loopback HTTP base URLs', () => {
    for (const value of [
      'https://user:password@provider.example/v1',
      'https://provider.example/v1?key=secret',
      'https://provider.example/%ZZ',
      'http://provider.example/v1',
      'https://provider.example/v1/chat/completions'
    ]) {
      expect(() => normalizeBaseUrl('openai', value)).toThrowError()
    }
    expect(normalizeBaseUrl('openai', 'http://127.0.0.1:4010/v1/')).toBe('http://127.0.0.1:4010/v1')
  })

  it('cancels a retryable error body before retrying once', async () => {
    let cancelled = false
    const fetchImpl = vi
      .fn(async (_url: string, _init: RequestInit) => new Response())
      .mockImplementationOnce(async () => responseWithCancellation(503, () => (cancelled = true)))
      .mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Advice' }, finish_reason: 'stop' }]
            }),
            { headers: { 'Content-Type': 'application/json' } }
          )
      )
    const provider = createVisionProvider({
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'test-model',
      fetchImpl
    })

    await expect(provider.generate({ prompt: 'test', timeoutMs: 5_000 })).resolves.toBe('Advice')
    expect(cancelled).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
    const body = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))
    expect(body.max_tokens).toBeUndefined()
    expect(body.temperature).toBe(0.3)
    expect(body.reasoning_effort).toBe('low')
  })

  it('omits max_tokens by default, sends low thinking, and honors explicit overrides', async () => {
    const fetchImpl = vi.fn(
      async (_url?: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }]
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
    )
    const provider = createVisionProvider({
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'test-model',
      fetchImpl
    })
    await provider.generate({ prompt: 'short', timeoutMs: 5_000 })
    const defaultBody = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(defaultBody.max_tokens).toBeUndefined()
    expect(defaultBody.reasoning_effort).toBe('low')

    await provider.generate({
      prompt: 'short',
      timeoutMs: 5_000,
      options: { maxOutputTokens: 1200, thinkingEffort: 'off' }
    })
    const overrideBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))
    expect(overrideBody.max_tokens).toBe(1200)
    expect(overrideBody.reasoning_effort).toBeUndefined()
  })

  it('sends a low Gemini thinking budget and hides thoughts by default', async () => {
    const fetchImpl = vi.fn(
      async (_url?: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'STOP',
                content: { parts: [{ text: 'ok' }] }
              }
            ]
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
    )
    const provider = createVisionProvider({
      protocol: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash',
      apiKey: 'local-test-key',
      fetchImpl
    })
    await provider.generate({ prompt: 'short', timeoutMs: 5_000 })
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.generationConfig.thinkingConfig).toEqual({
      includeThoughts: false,
      thinkingBudget: 512
    })
  })

  it('cancels an authorization error body and does not retry', async () => {
    let cancelled = false
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) =>
      responseWithCancellation(401, () => (cancelled = true))
    )
    const provider = createVisionProvider({
      protocol: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'test-model',
      apiKey: 'local-test-key',
      fetchImpl
    })

    await expect(provider.generate({ prompt: 'test', timeoutMs: 5_000 })).rejects.toMatchObject({
      code: 'AUTH_ERROR'
    })
    expect(cancelled).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).not.toContain('local-test-key')
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'local-test-key' })
  })

  it('maps an abort to a timeout and caller cancellation without retry', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
    )
    const provider = createVisionProvider({
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'test-model',
      fetchImpl
    })
    vi.useFakeTimers()
    try {
      const timeoutRequest = provider.generate({ prompt: 'test', timeoutMs: 5_000 })
      const timeoutExpectation = expect(timeoutRequest).rejects.toMatchObject({ code: 'TIMEOUT' })
      await vi.advanceTimersByTimeAsync(5_000)
      await timeoutExpectation

      const cancellation = new AbortController()
      const cancelledRequest = provider.generate({
        prompt: 'test',
        timeoutMs: 5_000,
        signal: cancellation.signal
      })
      const cancellationExpectation = expect(cancelledRequest).rejects.toMatchObject({
        code: 'CANCELLED'
      })
      cancellation.abort()
      await cancellationExpectation
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces Chromium net error codes on transport failure', async () => {
    const fetchImpl = vi
      .fn(async () => {
        throw new Error('net::ERR_CONNECTION_REFUSED')
      })
      .mockName('refused-fetch')
    const provider = createVisionProvider({
      protocol: 'openai',
      baseUrl: 'http://127.0.0.1:9/v1',
      model: 'test-model',
      apiKey: 'k',
      fetchImpl
    })
    await expect(provider.generate({ prompt: 'test', timeoutMs: 5_000 })).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: expect.stringContaining('net::ERR_CONNECTION_REFUSED')
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('retries one 429 response and does not retry malformed or oversized output', async () => {
    const retryFetch = vi
      .fn(async (_url: string, _init: RequestInit) => new Response('{}'))
      .mockImplementationOnce(
        async () =>
          new Response('rate limited', {
            status: 429,
            headers: { 'Retry-After': '0' }
          })
      )
      .mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'Recovered' }, finish_reason: 'stop' }]
            }),
            { headers: { 'Content-Type': 'application/json' } }
          )
      )
    const retryProvider = createVisionProvider({
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'test-model',
      fetchImpl: retryFetch
    })
    await expect(retryProvider.generate({ prompt: 'test', timeoutMs: 5_000 })).resolves.toBe(
      'Recovered'
    )
    expect(retryFetch).toHaveBeenCalledTimes(2)

    const malformedFetch = vi.fn(async () => new Response('null'))
    const malformedProvider = createVisionProvider({
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'test-model',
      fetchImpl: malformedFetch
    })
    await expect(
      malformedProvider.generate({ prompt: 'test', timeoutMs: 5_000 })
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(malformedFetch).toHaveBeenCalledTimes(1)

    const oversizedFetch = vi.fn(async () => new Response(' '.repeat(2 * 1024 * 1024 + 1)))
    const oversizedProvider = createVisionProvider({
      protocol: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'test-model',
      fetchImpl: oversizedFetch
    })
    await expect(
      oversizedProvider.generate({ prompt: 'test', timeoutMs: 5_000 })
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
    expect(oversizedFetch).toHaveBeenCalledTimes(1)
  })
})

function responseWithCancellation(status: number, onCancel: () => void) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"error":"fixture"}'))
    },
    cancel() {
      onCancel()
    }
  })
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } })
}
