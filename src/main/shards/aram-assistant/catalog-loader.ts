import type {
  AugmentCatalog,
  AugmentCatalogEntry,
  BilingualText,
  CatalogSearchOptions
} from '@shared/types/aram-assistant'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export type {
  AugmentCatalog,
  AugmentCatalogEntry,
  BilingualText,
  CatalogSearchOptions
} from '@shared/types/aram-assistant'

export const CATALOG_URL = 'https://hexaram.lol/data/mayhem/augment-catalog.json'
export const CATALOG_PAGE_URL = 'https://hexaram.lol/zh/augments/'
export const CATALOG_MODE = 'aram-mayhem'
export const CATALOG_MAX_BYTES = 2 * 1024 * 1024
export const CATALOG_MIN_ENTRIES = 100

const ALLOWED_RARITIES = new Set(['silver', 'gold', 'prismatic'])
const ALLOWED_KINDS = new Set(['standard', 'ability', 'quest', 'special'])
const ALLOWED_SCOPES = new Set(['aram', 'shared'])
const ALLOWED_TEXT_STATUS = new Set(['verified', 'dynamic'])
const ALLOWED_PATCH_CHANGES = new Set(['unchanged', 'changed'])

export class CatalogError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'CatalogError'
    this.code = code
  }
}

export type CatalogFetch = (
  input: string,
  init: RequestInit & { redirect: 'error' }
) => Promise<Response>

export function validateCatalog(input: unknown): asserts input is AugmentCatalog {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CatalogError('INVALID_SCHEMA', 'Catalog must be an object.')
  }
  const catalog = input as Partial<AugmentCatalog>
  if (catalog.schemaVersion !== 1 || catalog.mode !== CATALOG_MODE) {
    throw new CatalogError('INVALID_SCHEMA', 'Catalog schema or mode is not supported.')
  }
  if (typeof catalog.sourceName !== 'string' || !catalog.sourceName.trim()) {
    throw new CatalogError('MISSING_FIELD', 'Catalog source name is required.')
  }
  if (
    !Number.isSafeInteger(catalog.sourceSchemaVersion) ||
    (catalog.sourceSchemaVersion ?? 0) < 1
  ) {
    throw new CatalogError('INVALID_SCHEMA', 'Source schema version must be a positive integer.')
  }
  if (!isHttpsUrl(catalog.sourceUrl) || !isHttpsUrl(catalog.sourcePageUrl)) {
    throw new CatalogError('MISSING_FIELD', 'Catalog source URLs must use HTTPS.')
  }
  if (!isPatch(catalog.sourcePatch)) {
    throw new CatalogError('INVALID_PATCH', 'Catalog patch must use a numeric major.minor value.')
  }
  if (typeof catalog.fetchedAt !== 'string' || !Number.isFinite(Date.parse(catalog.fetchedAt))) {
    throw new CatalogError('MISSING_FIELD', 'Catalog fetch time is required.')
  }
  if (!/^[a-f0-9]{64}$/.test(catalog.rawSha256 || '')) {
    throw new CatalogError('INVALID_SOURCE_HASH', 'Catalog source hash must be a SHA-256 digest.')
  }
  if (catalog.patchVerified !== false || catalog.remoteIconsOmitted !== true) {
    throw new CatalogError('INVALID_SCHEMA', 'Catalog provenance flags are invalid.')
  }
  if (!Array.isArray(catalog.entries) || catalog.entries.length < CATALOG_MIN_ENTRIES) {
    throw new CatalogError(
      'TOO_FEW_CARDS',
      `Catalog must contain at least ${CATALOG_MIN_ENTRIES} entries.`
    )
  }
  if (catalog.cardCount !== catalog.entries.length) {
    throw new CatalogError('COUNT_MISMATCH', 'Catalog count does not match its entries.')
  }
  if (
    catalog.sourceBatchSize !== null &&
    (!Number.isSafeInteger(catalog.sourceBatchSize) || (catalog.sourceBatchSize ?? -1) < 0)
  ) {
    throw new CatalogError(
      'INVALID_SCHEMA',
      'Source batch size must be a non-negative integer or null.'
    )
  }
  if (
    typeof catalog.licenseStatus !== 'string' ||
    !catalog.licenseStatus.trim() ||
    catalog.licenseStatus.length > 128
  ) {
    throw new CatalogError('MISSING_FIELD', 'Catalog license status is required.')
  }

  const ids = new Set<string>()
  for (const entry of catalog.entries) {
    validateEntry(entry)
    if (ids.has(entry.id))
      throw new CatalogError('DUPLICATE_ID', 'Catalog contains duplicate card identifiers.')
    ids.add(entry.id)
  }
}

export function normalizeCatalog(
  source: Buffer | unknown,
  options: { sourceUrl?: string; sourcePageUrl?: string; fetchedAt?: string } = {}
): AugmentCatalog {
  const rawBytes = Buffer.isBuffer(source) ? source : Buffer.from(JSON.stringify(source))
  if (rawBytes.length > CATALOG_MAX_BYTES) {
    throw new CatalogError('TOO_LARGE', 'Catalog source exceeds the allowed size.')
  }
  let raw: unknown
  try {
    raw = Buffer.isBuffer(source) ? JSON.parse(source.toString('utf8')) : source
  } catch {
    throw new CatalogError('INVALID_JSON', 'Source response is not valid JSON.')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CatalogError('INVALID_SCHEMA', 'Source catalog schema is not supported.')
  }
  const sourceCatalog = raw as {
    schemaVersion?: unknown
    entries?: unknown
    riotPatch?: unknown
    batchSize?: unknown
  }
  if (sourceCatalog.schemaVersion !== 1 || !Array.isArray(sourceCatalog.entries)) {
    throw new CatalogError('INVALID_SCHEMA', 'Source catalog schema is not supported.')
  }
  if (!isPatch(sourceCatalog.riotPatch)) {
    throw new CatalogError('INVALID_PATCH', 'Source patch is missing or invalid.')
  }
  const entries = sourceCatalog.entries.map((value: unknown, index): AugmentCatalogEntry => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new CatalogError('INVALID_SCHEMA', `Source entry ${index} must be an object.`)
    }
    const entry = value as Record<string, unknown>
    const slug = cleanText(entry.slug, 256)
    const name = cleanBilingual(entry.name, 1000)
    const effect = cleanBilingual(entry.effect, 100_000)
    const tier = cleanBilingual(entry.rarityLabel, 256)
    const tags = Array.isArray(entry.tags) ? entry.tags.map((tag) => cleanText(tag, 1024)) : null
    if (!slug || !tags || !entry.currentPatchChange) {
      throw new CatalogError('MISSING_FIELD', `Source entry ${index} is missing required fields.`)
    }
    return {
      id: slug,
      slug,
      name,
      effect,
      tier,
      rarity: entry.rarity as AugmentCatalogEntry['rarity'],
      kind: entry.kind as AugmentCatalogEntry['kind'],
      scope: entry.scope as AugmentCatalogEntry['scope'],
      textStatus: entry.textStatus as AugmentCatalogEntry['textStatus'],
      tags,
      currentPatchChange: entry.currentPatchChange as AugmentCatalogEntry['currentPatchChange'],
      sourceUrl: entry.sourceUrl == null ? null : (entry.sourceUrl as string)
    }
  })
  const catalog: AugmentCatalog = {
    schemaVersion: 1,
    sourceSchemaVersion: 1,
    mode: CATALOG_MODE,
    sourceName: 'HexARAM Mayhem catalog',
    sourceUrl: options.sourceUrl || CATALOG_URL,
    sourcePageUrl: options.sourcePageUrl || CATALOG_PAGE_URL,
    fetchedAt: options.fetchedAt || new Date().toISOString(),
    sourcePatch: sourceCatalog.riotPatch,
    patchVerified: false,
    rawSha256: crypto.createHash('sha256').update(rawBytes).digest('hex'),
    sourceBatchSize:
      typeof sourceCatalog.batchSize === 'number' && Number.isInteger(sourceCatalog.batchSize)
        ? sourceCatalog.batchSize
        : null,
    licenseStatus: 'unverified',
    remoteIconsOmitted: true,
    cardCount: entries.length,
    entries
  }
  validateCatalog(catalog)
  return catalog
}

export function parsePatch(value: unknown): number {
  if (!isPatch(value)) throw new CatalogError('INVALID_PATCH', 'Patch is not parseable.')
  const [major, minor] = value.split('.').map(Number)
  return major * 10_000 + minor
}

export function assertUpdateAllowed(
  currentCatalog: AugmentCatalog,
  nextCatalog: AugmentCatalog
): true {
  validateCatalog(currentCatalog)
  validateCatalog(nextCatalog)
  const currentPatch = parsePatch(currentCatalog.sourcePatch)
  const nextPatch = parsePatch(nextCatalog.sourcePatch)
  if (nextPatch < currentPatch) {
    throw new CatalogError('PATCH_ROLLBACK', 'An older patch catalog cannot replace current data.')
  }
  if (
    nextPatch === currentPatch &&
    nextCatalog.cardCount < Math.ceil(currentCatalog.cardCount * 0.8)
  ) {
    throw new CatalogError('SUDDEN_DROP', 'A same-patch catalog lost more than 20% of its entries.')
  }
  return true
}

export function searchCatalog(
  catalog: AugmentCatalog,
  { query = '', rarity = 'all', kind = 'all', scope = 'all' }: CatalogSearchOptions = {}
): AugmentCatalogEntry[] {
  validateCatalog(catalog)
  const normalizedQuery = normalizeSearch(query)
  return catalog.entries.filter((entry) => {
    if (rarity !== 'all' && entry.rarity !== rarity) return false
    if (kind !== 'all' && entry.kind !== kind) return false
    if (scope !== 'all' && entry.scope !== scope) return false
    if (!normalizedQuery) return true
    return normalizeSearch(
      [
        entry.id,
        entry.name.zh,
        entry.name.en,
        entry.effect.zh,
        entry.effect.en,
        ...entry.tags
      ].join(' ')
    ).includes(normalizedQuery)
  })
}

export function recommendationCandidates(catalog: AugmentCatalog): AugmentCatalogEntry[] {
  validateCatalog(catalog)
  return catalog.entries.filter(
    (entry) => entry.kind !== 'special' && entry.textStatus === 'verified'
  )
}

export async function readCatalogFile(filePath: string): Promise<AugmentCatalog> {
  const stat = await fs.stat(filePath)
  if (stat.size > CATALOG_MAX_BYTES) {
    throw new CatalogError('TOO_LARGE', 'Catalog file exceeds the allowed size.')
  }
  const contents = await fs.readFile(filePath, 'utf8')
  let catalog: unknown
  try {
    catalog = JSON.parse(contents)
  } catch {
    throw new CatalogError('INVALID_JSON', 'Catalog file is invalid.')
  }
  validateCatalog(catalog)
  return catalog
}

export async function loadCatalog(options: {
  bundledPath: string
  overlayPath?: string
}): Promise<{ catalog: AugmentCatalog; source: 'bundled' | 'user'; fallbackCode?: string }> {
  const bundled = await readCatalogFile(options.bundledPath)
  if (!options.overlayPath) return { catalog: bundled, source: 'bundled' }
  try {
    const overlay = await readCatalogFile(options.overlayPath)
    assertUpdateAllowed(bundled, overlay)
    return { catalog: overlay, source: 'user' }
  } catch (error) {
    if (isMissingFile(error)) return { catalog: bundled, source: 'bundled' }
    if (!(error instanceof CatalogError)) throw error
    return {
      catalog: bundled,
      source: 'bundled',
      fallbackCode: error.code
    }
  }
}

export async function writeCatalogAtomically(
  targetPath: string,
  nextCatalog: AugmentCatalog,
  currentCatalog?: AugmentCatalog
): Promise<void> {
  validateCatalog(nextCatalog)
  if (currentCatalog) assertUpdateAllowed(currentCatalog, nextCatalog)
  const folder = path.dirname(targetPath)
  await fs.mkdir(folder, { recursive: true, mode: 0o700 })
  const tempPath = path.join(
    folder,
    `${path.basename(targetPath)}.tmp-${process.pid}-${crypto.randomUUID()}`
  )
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    handle = await fs.open(tempPath, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(nextCatalog, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await renameWithRetry(tempPath, targetPath)
  } catch (error) {
    if (handle) await handle.close().catch(() => {})
    await fs.rm(tempPath, { force: true }).catch(() => {})
    if (error instanceof CatalogError) throw error
    throw new CatalogError('ATOMIC_WRITE_FAILED', 'Catalog could not be saved safely.')
  }
}

export async function fetchCatalog({
  fetchImpl = globalThis.fetch,
  url = CATALOG_URL,
  timeoutMs = 15_000,
  signal: parentSignal
}: {
  fetchImpl?: CatalogFetch
  url?: string
  timeoutMs?: number
  signal?: AbortSignal
} = {}): Promise<AugmentCatalog> {
  if (typeof fetchImpl !== 'function') {
    throw new CatalogError('NETWORK_ERROR', 'Network transport is unavailable.')
  }
  const controller = new AbortController()
  let timedOut = false
  const abortFromParent = () => controller.abort(parentSignal?.reason)
  parentSignal?.addEventListener('abort', abortFromParent, { once: true })
  if (parentSignal?.aborted) abortFromParent()
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const deadline = Date.now() + timeoutMs
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (controller.signal.aborted) throw updateAbortError(timedOut, parentSignal)
      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          redirect: 'error',
          signal: controller.signal
        })
        if (!response.ok) {
          await response.body?.cancel().catch(() => {})
          const error = new CatalogError('HTTP_STATUS', 'Catalog source returned an error.')
          if (
            attempt === 0 &&
            response.status !== 501 &&
            (response.status === 429 || response.status >= 500)
          ) {
            const remaining = deadline - Date.now()
            if (remaining > 100) {
              await delay(
                Math.min(retryDelay(response.headers.get('retry-after')), remaining - 50),
                controller.signal
              )
              continue
            }
          }
          throw error
        }
        const contentType = response.headers.get('content-type') || ''
        if (!/^application\/(?:[a-z0-9.+-]*\+)?json\b/i.test(contentType)) {
          await response.body?.cancel().catch(() => {})
          throw new CatalogError('SOURCE_HTML', 'Catalog source did not return JSON.')
        }
        const bytes = await readLimitedBody(response, CATALOG_MAX_BYTES, controller.signal)
        return normalizeCatalog(bytes, { sourceUrl: url, sourcePageUrl: CATALOG_PAGE_URL })
      } catch (error) {
        if (error instanceof CatalogError) throw error
        if (controller.signal.aborted) throw updateAbortError(timedOut, parentSignal)
        if (isRedirectError(error)) {
          throw new CatalogError('REDIRECT_BLOCKED', 'Catalog redirects are not allowed.')
        }
        if (attempt === 0 && deadline - Date.now() > 100) {
          await delay(Math.min(150, deadline - Date.now() - 50), controller.signal)
          continue
        }
        throw new CatalogError('NETWORK_ERROR', 'Catalog source could not be reached.')
      }
    }
    throw new CatalogError('NETWORK_ERROR', 'Catalog source could not be reached.')
  } finally {
    clearTimeout(timer)
    parentSignal?.removeEventListener('abort', abortFromParent)
  }
}

async function readLimitedBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal
): Promise<Buffer> {
  if (!response.body)
    throw new CatalogError('INVALID_RESPONSE', 'Catalog source response has no body.')
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  try {
    while (true) {
      if (signal.aborted) throw new CatalogError('CANCELLED', 'Catalog update was cancelled.')
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new CatalogError('TOO_LARGE', 'Catalog source exceeds the allowed size.')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, total)
}

function validateEntry(entry: unknown): asserts entry is AugmentCatalogEntry {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new CatalogError('INVALID_SCHEMA', 'Catalog entry is invalid.')
  }
  const item = entry as Partial<AugmentCatalogEntry>
  requireText(item.id)
  requireText(item.slug)
  if (item.id !== item.slug)
    throw new CatalogError('INVALID_SCHEMA', 'Card id must equal source slug.')
  requireBilingual(item.name)
  requireBilingual(item.effect)
  requireBilingual(item.tier)
  if (!ALLOWED_RARITIES.has(item.rarity as string)) {
    throw new CatalogError('INVALID_ENUM', 'Unknown card rarity.')
  }
  if (!ALLOWED_KINDS.has(item.kind as string))
    throw new CatalogError('INVALID_ENUM', 'Unknown card kind.')
  if (!ALLOWED_SCOPES.has(item.scope as string))
    throw new CatalogError('INVALID_ENUM', 'Unknown card scope.')
  if (!ALLOWED_TEXT_STATUS.has(item.textStatus as string)) {
    throw new CatalogError('INVALID_ENUM', 'Unknown card text status.')
  }
  if (!ALLOWED_PATCH_CHANGES.has(item.currentPatchChange as string)) {
    throw new CatalogError('INVALID_ENUM', 'Unknown patch change value.')
  }
  if (!Array.isArray(item.tags) || item.tags.some((tag) => typeof tag !== 'string')) {
    throw new CatalogError('MISSING_FIELD', 'Card tags must be a string array.')
  }
  if (item.sourceUrl !== null && !isHttpsUrl(item.sourceUrl)) {
    throw new CatalogError('INVALID_SCHEMA', 'Card source URL must be HTTPS or null.')
  }
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  const cleaned = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  if (cleaned.length > maxLength) {
    throw new CatalogError('FIELD_TOO_LONG', 'A catalog field exceeds its allowed size.')
  }
  return cleaned
}

function cleanBilingual(value: unknown, maxLength: number): BilingualText {
  const text = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const zh = cleanText(text.zh, maxLength)
  const en = cleanText(text.en, maxLength)
  if (!zh || !en)
    throw new CatalogError('MISSING_FIELD', 'Both Chinese and English text are required.')
  return { zh, en }
}

function requireText(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CatalogError('MISSING_FIELD', 'Card text is required.')
  }
}

function requireBilingual(value: unknown): asserts value is BilingualText {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatalogError('MISSING_FIELD', 'Bilingual card text is required.')
  }
  const text = value as Partial<BilingualText>
  requireText(text.zh)
  requireText(text.en)
}

function isHttpsUrl(value: unknown): value is string {
  try {
    return typeof value === 'string' && new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isPatch(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,3}\.\d{1,3}$/.test(value)
}

function normalizeSearch(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\u200b]+/g, ' ')
    .trim()
}

function retryDelay(value: string | null): number {
  if (!value) return 150
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(1000, seconds * 1000))
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, Math.min(1000, date - Date.now())) : 150
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(new CatalogError('CANCELLED', 'Catalog update was cancelled.'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

function updateAbortError(timedOut: boolean, parentSignal?: AbortSignal): CatalogError {
  if (parentSignal?.aborted) return new CatalogError('CANCELLED', 'Catalog update was cancelled.')
  return new CatalogError(timedOut ? 'TIMEOUT' : 'CANCELLED', 'Catalog update was cancelled.')
}

function isRedirectError(error: unknown): boolean {
  const message =
    error instanceof Error ? `${error.message} ${String(error.cause || '')}` : String(error)
  return /redirect/i.test(message)
}

function isMissingFile(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.rename(source, target)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(code || '') || attempt === 3) throw error
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
    }
  }
}
