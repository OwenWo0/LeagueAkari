import type { ProviderProtocol } from '@shared/types/aram-assistant'

export const PROVIDER_MAX_IMAGE_BYTES = 4 * 1024 * 1024
export const PROVIDER_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
export const PROVIDER_MAX_OUTPUT_TOKENS = 4096
export const PROVIDER_MAX_TEXT_CHARS = 20_000

export type { ProviderProtocol } from '@shared/types/aram-assistant'
export type ProviderCode =
  | 'INVALID_PROTOCOL'
  | 'INVALID_BASE_URL'
  | 'INVALID_IMAGE'
  | 'IMAGE_TOO_LARGE'
  | 'CONFIG_ERROR'
  | 'INVALID_INPUT'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'REDIRECT_BLOCKED'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'INVALID_RESPONSE'
  | 'RESPONSE_TOO_LARGE'
  | 'EMPTY_RESPONSE'
  | 'BLOCKED_RESPONSE'
  | 'OUTPUT_TRUNCATED'
  | 'SCREEN_PERMISSION_DENIED'
  | 'SCREEN_PERMISSION_REQUIRED'
  | 'SCREEN_PERMISSION_RESTRICTED'
  | 'SCREEN_CAPTURE_FAILED'
  | 'CREDENTIAL_STORAGE_FAILED'

export class ProviderError extends Error {
  readonly code: ProviderCode

  constructor(code: ProviderCode, message: string) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
  }
}

export interface ProviderImage {
  bytes: Uint8Array
  mimeType: 'image/png' | 'image/jpeg'
}

export interface ProviderRequestOptions {
  temperature?: number
  maxOutputTokens?: number
}

export type ProviderFetch = (input: string, init: RequestInit) => Promise<Response>

export interface VisionProviderConfig {
  protocol: ProviderProtocol
  baseUrl: string
  model: string
  apiKey?: string
  fetchImpl?: ProviderFetch
}

export function normalizeBaseUrl(protocol: ProviderProtocol, input: string): string {
  if (protocol !== 'gemini' && protocol !== 'openai') {
    throw new ProviderError('INVALID_PROTOCOL', 'Choose a supported provider protocol.')
  }
  if (typeof input !== 'string' || input.trim().length === 0 || input.length > 2048) {
    throw new ProviderError('INVALID_BASE_URL', 'A provider base URL is required.')
  }
  const value = input.trim()
  if (/[?#]/.test(value) || /%(?![0-9a-f]{2})/i.test(value)) {
    throw new ProviderError(
      'INVALID_BASE_URL',
      'The provider base URL contains an invalid path, query, or escape.'
    )
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ProviderError('INVALID_BASE_URL', 'The provider base URL is invalid.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ProviderError('INVALID_BASE_URL', 'Only HTTP and HTTPS provider URLs are supported.')
  }
  const authority = value.slice(value.indexOf('://') + 3).split(/[/?#]/, 1)[0]
  if (authority.includes('@') || url.username || url.password || url.search || url.hash) {
    throw new ProviderError(
      'INVALID_BASE_URL',
      'Credentials, query strings, and fragments are not allowed in a base URL.'
    )
  }
  const hostname = url.hostname.toLowerCase()
  if (url.protocol === 'http:' && hostname !== '127.0.0.1' && hostname !== '[::1]') {
    throw new ProviderError(
      'INVALID_BASE_URL',
      'Plain HTTP is allowed only for literal loopback addresses.'
    )
  }
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(url.pathname).toLowerCase().replace(/\/+$/, '')
  } catch {
    throw new ProviderError('INVALID_BASE_URL', 'The provider base URL path is invalid.')
  }
  if (
    /\/chat\/completions$/.test(decodedPath) ||
    /\/models\/[^/]+:generatecontent$/.test(decodedPath)
  ) {
    throw new ProviderError(
      'INVALID_BASE_URL',
      'Enter the versioned protocol root, without a request endpoint.'
    )
  }
  url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.toString().replace(/\/+$/, '')
}

export function providerCredentialScope(protocol: ProviderProtocol, baseUrl: string): string {
  return `${protocol}\n${normalizeBaseUrl(protocol, baseUrl)}`
}

export function validateProviderImage(image: ProviderImage): ProviderImage {
  if (!image || !(image.bytes instanceof Uint8Array) || image.bytes.byteLength === 0) {
    throw new ProviderError('INVALID_IMAGE', 'Image data is invalid.')
  }
  if (image.bytes.byteLength > PROVIDER_MAX_IMAGE_BYTES) {
    throw new ProviderError('IMAGE_TOO_LARGE', 'Prepared image exceeds 4 MB.')
  }
  const bytes = Buffer.from(image.bytes)
  const isPng =
    bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if ((image.mimeType !== 'image/png' || !isPng) && (image.mimeType !== 'image/jpeg' || !isJpeg)) {
    throw new ProviderError('INVALID_IMAGE', 'Image content must match PNG or JPEG MIME type.')
  }
  return { bytes, mimeType: image.mimeType }
}

export function createVisionProvider(config: VisionProviderConfig) {
  const baseUrl = normalizeBaseUrl(config.protocol, config.baseUrl)
  const fetchImpl = config.fetchImpl ?? globalThis.fetch
  const model = cleanModel(config.model)
  const apiKey = typeof config.apiKey === 'string' ? config.apiKey : ''
  if (typeof fetchImpl !== 'function') {
    throw new ProviderError('CONFIG_ERROR', 'HTTP transport is unavailable.')
  }

  return {
    baseUrl,
    protocol: config.protocol,
    async generate(input: {
      prompt: string
      image?: ProviderImage
      signal?: AbortSignal
      timeoutMs?: number
      options?: ProviderRequestOptions
    }): Promise<string> {
      if (!model) throw new ProviderError('CONFIG_ERROR', 'Configure a model name before analysis.')
      if (config.protocol === 'gemini' && !apiKey) {
        throw new ProviderError('CONFIG_ERROR', 'Configure an API key before using Gemini.')
      }
      if (
        typeof input.prompt !== 'string' ||
        !input.prompt.trim() ||
        input.prompt.length > 50_000
      ) {
        throw new ProviderError('INVALID_INPUT', 'Prompt is empty or too long.')
      }
      if (input.signal?.aborted) throw new ProviderError('CANCELLED', 'Analysis was cancelled.')
      const timeoutMs = validateTimeout(input.timeoutMs ?? 30_000)
      const image = input.image ? validateProviderImage(input.image) : undefined
      const request = buildRequest(
        config.protocol,
        baseUrl,
        model,
        apiKey,
        input.prompt,
        image,
        input.options
      )
      return runRequest(fetchImpl, request, {
        timeoutMs,
        signal: input.signal,
        parse: (text) =>
          config.protocol === 'gemini' ? parseGeminiResponse(text) : parseOpenAiResponse(text)
      })
    }
  }
}

export function parseGeminiResponse(text: string): string {
  const data = parseJsonObject(text)
  const promptFeedback = asRecord(data.promptFeedback)
  if (
    typeof promptFeedback?.blockReason === 'string' &&
    promptFeedback.blockReason !== 'BLOCKED_REASON_UNSPECIFIED'
  ) {
    throw new ProviderError('BLOCKED_RESPONSE', 'The provider blocked this request.')
  }
  const candidates = data.candidates
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new ProviderError('EMPTY_RESPONSE', 'The provider returned no response text.')
  }
  const candidate = asRecord(candidates[0])
  if (!candidate) throw new ProviderError('INVALID_RESPONSE', 'The provider response was invalid.')
  const finishReason = candidate.finishReason
  if (finishReason === 'MAX_TOKENS') {
    throw new ProviderError('OUTPUT_TRUNCATED', 'The provider response reached its output limit.')
  }
  if (finishReason !== 'STOP') {
    throw new ProviderError('BLOCKED_RESPONSE', 'The provider did not complete this response.')
  }
  const content = asRecord(candidate.content)
  const parts = content?.parts
  if (!Array.isArray(parts))
    throw new ProviderError('EMPTY_RESPONSE', 'The provider returned no response text.')
  const output = parts
    .filter((part) => {
      const item = asRecord(part)
      return item && item.thought !== true && typeof item.text === 'string'
    })
    .map((part) => (part as Record<string, unknown>).text as string)
    .join('')
    .trim()
  return boundedOutput(output)
}

export function parseOpenAiResponse(text: string): string {
  const data = parseJsonObject(text)
  const choices = data.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ProviderError('EMPTY_RESPONSE', 'The provider returned no response text.')
  }
  const choice = asRecord(choices[0])
  const message = asRecord(choice?.message)
  if (!message) throw new ProviderError('INVALID_RESPONSE', 'The provider response was invalid.')
  if (typeof message.refusal === 'string' && message.refusal.trim()) {
    throw new ProviderError('BLOCKED_RESPONSE', 'The provider declined this request.')
  }
  if (choice?.finish_reason === 'length') {
    throw new ProviderError('OUTPUT_TRUNCATED', 'The provider response reached its output limit.')
  }
  if (choice?.finish_reason === 'content_filter') {
    throw new ProviderError('BLOCKED_RESPONSE', 'The provider blocked this response.')
  }
  let output = ''
  if (typeof message.content === 'string') {
    output = message.content
  } else if (Array.isArray(message.content)) {
    output = message.content
      .map((part) => {
        const item = asRecord(part)
        return item &&
          (item.type === 'text' || item.type === 'output_text') &&
          typeof item.text === 'string'
          ? item.text
          : ''
      })
      .join('')
  } else if (message.content !== null) {
    throw new ProviderError('INVALID_RESPONSE', 'The provider response was invalid.')
  }
  return boundedOutput(output.trim())
}

interface RequestBuild {
  url: string
  headers: Record<string, string>
  body: string
}

function buildRequest(
  protocol: ProviderProtocol,
  baseUrl: string,
  model: string,
  apiKey: string,
  prompt: string,
  image: ProviderImage | undefined,
  options: ProviderRequestOptions = {}
): RequestBuild {
  const temperature = clamp(Number.isFinite(options.temperature) ? options.temperature! : 0.3, 0, 1)
  const maxOutputTokens = Math.round(
    clamp(options.maxOutputTokens ?? PROVIDER_MAX_OUTPUT_TOKENS, 1, PROVIDER_MAX_OUTPUT_TOKENS)
  )
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (protocol === 'gemini') {
    headers['x-goog-api-key'] = apiKey
    const parts: Record<string, unknown>[] = [{ text: prompt }]
    if (image) {
      parts.push({
        inline_data: {
          mime_type: image.mimeType,
          data: Buffer.from(image.bytes).toString('base64')
        }
      })
    }
    return {
      url: `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
      headers,
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature, maxOutputTokens }
      })
    }
  }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const content: Record<string, unknown>[] = [{ type: 'text', text: prompt }]
  if (image) {
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${image.mimeType};base64,${Buffer.from(image.bytes).toString('base64')}`
      }
    })
  }
  return {
    url: `${baseUrl}/chat/completions`,
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content }],
      temperature,
      max_tokens: maxOutputTokens
    })
  }
}

async function runRequest(
  fetchImpl: ProviderFetch,
  request: RequestBuild,
  options: { timeoutMs: number; signal?: AbortSignal; parse: (text: string) => string }
): Promise<string> {
  const controller = new AbortController()
  let timedOut = false
  const abortParent = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', abortParent, { once: true })
  if (options.signal?.aborted) abortParent()
  const deadline = Date.now() + options.timeoutMs
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs)

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (controller.signal.aborted) throw abortReason(timedOut, options.signal)
      try {
        const response = await fetchImpl(request.url, {
          method: 'POST',
          headers: request.headers,
          body: request.body,
          redirect: 'error',
          signal: controller.signal
        })
        if (!response.ok) {
          await response.body?.cancel().catch(() => {})
          const error = httpError(response.status)
          if (attempt === 0 && isRetryableStatus(response.status)) {
            const remaining = deadline - Date.now()
            const waitMs = retryAfterMs(response.headers.get('retry-after'))
            if (remaining > waitMs + 50) {
              await wait(waitMs, controller.signal)
              continue
            }
          }
          throw error
        }
        const responseText = await readResponse(response, controller.signal)
        return options.parse(responseText)
      } catch (error) {
        if (error instanceof ProviderError) throw error
        if (controller.signal.aborted) throw abortReason(timedOut, options.signal)
        if (isRedirectError(error)) {
          throw new ProviderError('REDIRECT_BLOCKED', 'Provider redirects are not allowed.')
        }
        if (attempt === 0 && Date.now() + 100 < deadline) {
          await wait(100, controller.signal)
          continue
        }
        throw new ProviderError('NETWORK_ERROR', networkErrorMessage(error))
      }
    }
    throw new ProviderError('NETWORK_ERROR', 'The provider could not be reached.')
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortParent)
  }
}

async function readResponse(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body)
    throw new ProviderError('INVALID_RESPONSE', 'The provider returned an empty response.')
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      if (signal.aborted) throw new ProviderError('CANCELLED', 'Analysis was cancelled.')
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > PROVIDER_MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {})
        throw new ProviderError('RESPONSE_TOO_LARGE', 'Provider response exceeds the allowed size.')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total).toString('utf8')
}

function parseJsonObject(text: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new ProviderError('INVALID_RESPONSE', 'The provider returned invalid JSON.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderError('INVALID_RESPONSE', 'The provider response was invalid.')
  }
  return value as Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function boundedOutput(text: string): string {
  if (!text) throw new ProviderError('EMPTY_RESPONSE', 'The provider returned no response text.')
  if (text.length > PROVIDER_MAX_TEXT_CHARS) {
    throw new ProviderError('RESPONSE_TOO_LARGE', 'Provider response exceeds the display limit.')
  }
  return text
}

function cleanModel(value: string): string {
  if (typeof value !== 'string') return ''
  const model = value.trim()
  if (!model || model.length > 256 || /[\u0000-\u001f\u007f]/.test(model)) return ''
  return model
}

function validateTimeout(value: number): number {
  if (!Number.isInteger(value) || value < 5_000 || value > 120_000) {
    throw new ProviderError('INVALID_INPUT', 'Timeout must be between 5 and 120 seconds.')
  }
  return value
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function httpError(status: number): ProviderError {
  if (status === 401 || status === 403)
    return new ProviderError('AUTH_ERROR', 'Provider credentials were rejected.')
  if (status === 429)
    return new ProviderError('RATE_LIMITED', 'The provider is rate limiting requests.')
  return new ProviderError('UPSTREAM_ERROR', 'The provider returned an error.')
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599 && status !== 501)
}

function retryAfterMs(value: string | null): number {
  if (!value) return 150
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(2_000, seconds * 1000))
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, Math.min(2_000, date - Date.now())) : 150
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(new ProviderError('CANCELLED', 'Analysis was cancelled.'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

function abortReason(timedOut: boolean, parentSignal?: AbortSignal): ProviderError {
  if (parentSignal?.aborted) return new ProviderError('CANCELLED', 'Analysis was cancelled.')
  return new ProviderError(
    timedOut ? 'TIMEOUT' : 'CANCELLED',
    timedOut ? 'The request exceeded its time limit.' : 'Analysis was cancelled.'
  )
}

function isRedirectError(error: unknown): boolean {
  const message =
    error instanceof Error ? `${error.message} ${String(error.cause || '')}` : String(error)
  return /redirect/i.test(message)
}

function networkErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? [
          error.message,
          error.cause instanceof Error ? error.cause.message : String(error.cause || '')
        ]
          .filter(Boolean)
          .join(' ')
      : String(error)
  const compact = raw.replace(/\s+/g, ' ').trim()
  if (!compact) return 'The provider could not be reached.'
  // Chromium session.fetch surfaces codes like net::ERR_CONNECTION_REFUSED.
  const netCode = compact.match(/net::ERR_[A-Z0-9_]+/)?.[0]
  if (netCode) return `The provider could not be reached (${netCode}).`
  return `The provider could not be reached (${compact.slice(0, 160)}).`
}
