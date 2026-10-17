import { i18next } from '@main/i18n'
import type { ChampionDataDetails, ChampionDataSourceId } from '@shared/data-adapter/champion-data'
import type {
  AramAnalysisInput,
  AramCredentialStatus,
  AramPendingResult,
  AramProviderPreference,
  AramVisionProbeResult
} from '@shared/types/aram-assistant'
import type { Augment } from '@shared/types/league-client/game-data'
import { nativeImage } from 'electron'
import { runInAction } from 'mobx'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  type AugmentCatalog,
  type AugmentCatalogEntry,
  CatalogError,
  type CatalogSearchOptions,
  assertUpdateAllowed,
  fetchCatalog,
  loadCatalog,
  recommendationCandidates,
  searchCatalog,
  writeCatalogAtomically
} from './catalog-loader'
import type { AramAssistantMainContext } from './context'
import { AramCredentialStore, type CredentialStorageMode } from './credential-store'
import {
  type AramMatchContext,
  deriveAramMatchContext,
  isChampSelectGameHandoff,
  isReadyForAutomaticGuide,
  shouldResetMatch
} from './match-context'
import {
  ProviderError,
  type ProviderImage,
  type ProviderProtocol,
  createVisionProvider,
  normalizeBaseUrl,
  providerCredentialScope
} from './provider'
import { AramScreenshotController } from './screenshot-controller'

export type { AramAnalysisInput } from '@shared/types/aram-assistant'

interface ActiveAnalysis {
  generation: number
  manual: boolean
  signature: string | null
  controller: AbortController
}

interface InFlightChampionStats {
  signal: AbortSignal
  promise: Promise<ChampionDataDetails | null>
}

const MAX_HISTORY = 20
const ALLOWED_PROTOCOLS: ProviderProtocol[] = ['gemini', 'openai']

export interface AramCredentialStorePort {
  get(scope: string): Promise<string | null>
  has(scope: string): Promise<boolean>
  getStorageMode(scope: string): CredentialStorageMode
  set(scope: string, value: string): Promise<void>
}

export interface AramScreenshotPort {
  listDisplays(): Promise<Array<{ sourceId: string; name: string; displayId: string | null }>>
  prepareDesktopScreenshot(
    sourceId: string
  ): Promise<{ token: string; previewDataUrl: string; width: number; height: number }>
  chooseImageFile(): Promise<{
    token: string
    previewDataUrl: string
    width: number
    height: number
  } | null>
  consume(token: string): ProviderImage
  discard(token: string): void
  clear(): void
}

export interface AramAssistantControllerOptions {
  credentials?: AramCredentialStorePort
  screenshot?: AramScreenshotPort
}

export class AramAssistantController {
  readonly screenshot: AramScreenshotPort

  private readonly _credentials: AramCredentialStorePort
  private readonly _overlayPath: string
  private readonly _statsCache = new Map<string, ChampionDataDetails | null>()
  private readonly _statsInFlight = new Map<string, InFlightChampionStats>()
  private _catalogUpdateAbortController: AbortController | null = null
  private _catalogUpdatePromise: Promise<ReturnType<typeof catalogMetadata>> | null = null
  private _identityContext: AramMatchContext | null = null
  private _manualChampionOverride: number | null = null
  private _active: ActiveAnalysis | null = null
  private _generation = 0
  private _autoAttemptedSignature: string | null = null
  private _deferredAutomaticSignature: string | null = null
  private _reaction: (() => void) | null = null
  private _disposed = false

  constructor(
    private readonly _context: AramAssistantMainContext,
    options: AramAssistantControllerOptions = {}
  ) {
    this._overlayPath = path.join(_context.userDataPath, 'aram-assistant', 'catalog-overlay.json')
    this._credentials =
      options.credentials ??
      new AramCredentialStore({
        folderPath: path.join(_context.userDataPath, 'aram-assistant', 'credentials')
      })
    this.screenshot = options.screenshot ?? new AramScreenshotController(_context.windowManager)
  }

  async initialize() {
    const loaded = await loadCatalog({
      bundledPath: this._context.bundledCatalogPath,
      overlayPath: this._overlayPath
    })
    runInAction(() => {
      this._context.state.catalog = loaded.catalog
      this._context.state.catalogSource = loaded.source
      this._context.state.catalogFallbackCode = loaded.fallbackCode ?? null
    })
    if (loaded.fallbackCode) {
      this._context.logger.warn(
        'ARAM assistant catalog overlay was rejected; using bundled catalog',
        {
          code: loaded.fallbackCode
        }
      )
    }
    await this.refreshCredentialStatuses()
    this._watchLeagueContext()
  }

  dispose() {
    this._disposed = true
    this._reaction?.()
    this._reaction = null
    this._catalogUpdateAbortController?.abort()
    this.cancelAnalysis(false)
    this.screenshot.clear()
    this._statsCache.clear()
    this._statsInFlight.clear()
  }

  getCatalog(): AugmentCatalog {
    return this._requireCatalog()
  }

  searchCards(options: CatalogSearchOptions = {}) {
    if (
      options.query !== undefined &&
      (typeof options.query !== 'string' || options.query.length > 160)
    ) {
      throw new ProviderError('INVALID_INPUT', 'Search text is too long.')
    }
    const result = searchCatalog(this._requireCatalog(), options)
    runInAction(
      () =>
        (this._context.state.latestCandidates = recommendationCandidates(this._requireCatalog()))
    )
    return result
  }

  getChampionChoices() {
    return Object.values(this._context.leagueClient.data.gameData.champions)
      .map(({ id, name }) => ({
        id,
        name: cleanLabel(name, 100)
      }))
      .filter((champion) => Number.isSafeInteger(champion.id) && champion.id > 0 && champion.name)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 250)
  }

  getManualChampionOverride() {
    return this._manualChampionOverride
  }

  setManualChampionOverride(championId: number | null) {
    if (
      championId !== null &&
      !this.getChampionChoices().some((champion) => champion.id === championId)
    ) {
      throw new ProviderError('INVALID_INPUT', 'Choose a champion from the local champion list.')
    }
    this._manualChampionOverride = championId
    runInAction(() => (this._context.state.manualChampionOverrideId = championId))
    return championId
  }

  async setProviderSettings(protocol: ProviderProtocol, value: AramProviderPreference) {
    this._assertProtocol(protocol)
    if (!value || typeof value !== 'object')
      throw new ProviderError('INVALID_INPUT', 'Provider settings are invalid.')
    const model = cleanModel(value.model)
    if (!model) throw new ProviderError('INVALID_INPUT', 'A model name is required.')
    const baseUrl = normalizeBaseUrl(protocol, value.baseUrl)
    const providers = { ...this._context.settings.providers, [protocol]: { baseUrl, model } }
    await this._context.settingService.set('providers', providers)
    await this.refreshCredentialStatuses()
    return this._context.settings.providers[protocol]
  }

  async setActiveProvider(protocol: ProviderProtocol) {
    this._assertProtocol(protocol)
    await this._context.settingService.set('activeProvider', protocol)
  }

  async setAutomaticGuide(enabled: boolean) {
    if (typeof enabled !== 'boolean')
      throw new ProviderError('INVALID_INPUT', 'Automatic guide setting is invalid.')
    await this._context.settingService.set('automaticGuide', enabled)
    if (!enabled) this._deferredAutomaticSignature = null
  }

  async setAutomaticContext(enabled: boolean) {
    if (typeof enabled !== 'boolean')
      throw new ProviderError('INVALID_INPUT', 'Automatic context setting is invalid.')
    await this._context.settingService.set('automaticContext', enabled)
  }

  async setRequestTimeout(timeoutMs: number) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > 120_000) {
      throw new ProviderError('INVALID_INPUT', 'Timeout must be between 5 and 120 seconds.')
    }
    await this._context.settingService.set('requestTimeoutMs', timeoutMs)
  }

  async setStatsSource(source: ChampionDataSourceId) {
    if (source !== 'opgg' && source !== 'qq101')
      throw new ProviderError('INVALID_INPUT', 'Choose a supported statistics source.')
    await this._context.settingService.set('statsSource', source)
  }

  async setCredential(protocol: ProviderProtocol, apiKey: string) {
    this._assertProtocol(protocol)
    if (
      typeof apiKey !== 'string' ||
      apiKey.length > 4096 ||
      /[\u0000-\u001f\u007f]/.test(apiKey)
    ) {
      throw new ProviderError('INVALID_INPUT', 'Credential is invalid or too long.')
    }
    const scope = this._scope(protocol)
    try {
      await this._credentials.set(scope, apiKey)
    } finally {
      await this.refreshCredentialStatuses()
    }
  }

  async refreshCredentialStatuses(): Promise<Record<ProviderProtocol, AramCredentialStatus>> {
    const statuses = {} as Record<ProviderProtocol, AramCredentialStatus>
    for (const protocol of ALLOWED_PROTOCOLS) {
      const scope = this._scope(protocol)
      statuses[protocol] = {
        configured: await this._credentials.has(scope),
        storageMode: this._credentials.getStorageMode(scope) as CredentialStorageMode
      }
    }
    runInAction(() => (this._context.state.credentialStatus = statuses))
    return statuses
  }

  async listDisplays() {
    return this.screenshot.listDisplays()
  }

  async prepareDesktopScreenshot(sourceId: string) {
    return this.screenshot.prepareDesktopScreenshot(sourceId)
  }

  async chooseImageFile() {
    return this.screenshot.chooseImageFile()
  }

  discardScreenshot(token: string) {
    this.screenshot.discard(token)
  }

  async updateCatalog() {
    if (this._disposed) throw new CatalogError('CANCELLED', 'Catalog update was cancelled.')
    if (this._catalogUpdatePromise) return this._catalogUpdatePromise

    const abortController = new AbortController()
    this._catalogUpdateAbortController = abortController
    const updatePromise = this._performCatalogUpdate(abortController)
    this._catalogUpdatePromise = updatePromise
    try {
      return await updatePromise
    } finally {
      if (this._catalogUpdatePromise === updatePromise) this._catalogUpdatePromise = null
      if (this._catalogUpdateAbortController === abortController) {
        this._catalogUpdateAbortController = null
      }
    }
  }

  private async _performCatalogUpdate(abortController: AbortController) {
    const current = this._requireCatalog()
    const next = await fetchCatalog({
      fetchImpl: (input, init) => this._context.network.fetch(input, init),
      signal: abortController.signal
    })
    this._assertCatalogUpdateActive(abortController)
    assertUpdateAllowed(current, next)
    await writeCatalogAtomically(this._overlayPath, next, current)
    this._assertCatalogUpdateActive(abortController)
    runInAction(() => {
      this._context.state.catalog = next
      this._context.state.catalogSource = 'user'
      this._context.state.catalogFallbackCode = null
    })
    this._statsCache.clear()
    return catalogMetadata(next, 'user')
  }

  async analyze(input: AramAnalysisInput): Promise<AramPendingResult> {
    const normalized = this._validateAnalysisInput(input)
    const result = await this._startAnalysis(normalized, true, null)
    if (!result) throw new ProviderError('CANCELLED', 'Analysis was cancelled.')
    return result
  }

  /**
   * Sends the two bundled probe JPEGs to the active vision provider.
   * Does not write analysis history or latestResult; used only for connectivity checks.
   */
  async probeVisionProvider(): Promise<AramVisionProbeResult> {
    if (this._active) {
      throw new ProviderError(
        'INVALID_INPUT',
        'Finish or cancel the current analysis before probing.'
      )
    }
    const protocol = this._context.settings.activeProvider
    const providerSettings = this._context.settings.providers[protocol]
    const apiKey = (await this._credentials.get(this._scope(protocol))) ?? ''
    if (!apiKey.trim()) {
      throw new ProviderError('CONFIG_ERROR', 'Configure a provider API key before probing.')
    }
    const fixtures = this._context.bundledProbeImagePaths
    if (!fixtures.length) {
      throw new ProviderError('CONFIG_ERROR', 'Bundled probe images are missing.')
    }
    const provider = createVisionProvider({
      protocol,
      baseUrl: providerSettings.baseUrl,
      model: providerSettings.model,
      apiKey,
      fetchImpl: (url, init) => this._context.network.fetch(url, init)
    })
    const controller = new AbortController()
    const results: AramVisionProbeResult['results'] = []
    for (const fixture of fixtures) {
      try {
        const image = await this._loadProbeImage(fixture.path)
        const output = await provider.generate({
          prompt:
            'This is a League Akari vision connectivity probe. Reply with exactly PROBE_OK, then one short English word describing the image. No other text.',
          image,
          timeoutMs: Math.min(this._context.settings.requestTimeoutMs, 30_000),
          signal: controller.signal
        })
        results.push({ id: fixture.id, ok: true, output })
      } catch (error) {
        const code =
          error instanceof ProviderError
            ? error.code
            : error instanceof Error && 'code' in error
              ? String((error as { code: unknown }).code)
              : 'NETWORK_ERROR'
        results.push({ id: fixture.id, ok: false, errorCode: safeErrorCode(code) })
      }
    }
    return {
      protocol,
      model: providerSettings.model,
      results
    }
  }

  private async _loadProbeImage(filePath: string): Promise<ProviderImage> {
    const input = await fs.readFile(filePath)
    if (input.length > 8 * 1024 * 1024) {
      throw new ProviderError('IMAGE_TOO_LARGE', 'Probe image exceeds 8 MB.')
    }
    const decoded = nativeImage.createFromBuffer(input)
    if (decoded.isEmpty()) {
      throw new ProviderError('INVALID_IMAGE', 'The probe image could not be decoded.')
    }
    const sourceSize = decoded.getSize()
    const scale = Math.min(1, 1280 / Math.max(sourceSize.width, sourceSize.height))
    const width = Math.max(1, Math.round(sourceSize.width * scale))
    const height = Math.max(1, Math.round(sourceSize.height * scale))
    const jpeg = decoded.resize({ width, height, quality: 'good' }).toJPEG(86)
    if (!jpeg.length || jpeg.length > 4 * 1024 * 1024) {
      throw new ProviderError('IMAGE_TOO_LARGE', 'Prepared probe image exceeds 4 MB.')
    }
    return { bytes: jpeg, mimeType: 'image/jpeg' }
  }

  cancelAnalysis(runDeferredGuide = true) {
    const active = this._active
    if (!active) {
      if (!runDeferredGuide) this._deferredAutomaticSignature = null
      return
    }
    this._generation += 1
    active.controller.abort()
    this._active = null
    if (!runDeferredGuide) this._deferredAutomaticSignature = null
    this.screenshot.clear()
    runInAction(() => {
      this._context.state.active = false
      if (runDeferredGuide) {
        this._context.state.latestResult = null
        this._context.state.lastErrorCode = 'CANCELLED'
      }
    })
    if (runDeferredGuide) this._runDeferredGuideIfReady()
  }

  confirmAugment(cardId: string) {
    if (typeof cardId !== 'string' || cardId.length > 256) {
      throw new ProviderError('INVALID_INPUT', 'Choose a card from the local catalog.')
    }
    const entry = this._requireCatalog().entries.find((card) => card.id === cardId)
    if (!entry) throw new ProviderError('INVALID_INPUT', 'Choose a card from the local catalog.')
    if (this._context.state.history.some((item) => item.cardId === cardId)) {
      throw new ProviderError(
        'INVALID_INPUT',
        'This augment is already recorded for the current match.'
      )
    }
    const item = {
      id: crypto.randomUUID(),
      cardId,
      name: entry.name,
      confirmedAt: new Date().toISOString()
    }
    runInAction(() => {
      this._context.state.history = [...this._context.state.history, item].slice(-MAX_HISTORY)
    })
    return item
  }

  undoConfirmedAugment() {
    const history = this._context.state.history
    if (!history.length) return null
    const removed = history[history.length - 1]
    runInAction(() => (this._context.state.history = history.slice(0, -1)))
    return removed
  }

  private _watchLeagueContext() {
    const league = this._context.leagueClient
    this._reaction = this._context.mobxUtils.reaction(
      () => {
        const source = {
          connection: league.state.connectionState,
          phase: league.data.gameflow.phase ?? league.data.gameflow.session?.phase ?? null,
          gameflowSession: league.data.gameflow.session,
          champSelectSession: league.data.champSelect.session,
          currentSummoner: league.data.summoner.me,
          champions: league.data.gameData.champions,
          queues: league.data.gameData.queues
        }
        return {
          context: deriveAramMatchContext(source),
          automaticGuide: this._context.settings.automaticGuide,
          automaticContext: this._context.settings.automaticContext
        }
      },
      ({ context }) => this._onMatchContext(context),
      { fireImmediately: true }
    )
  }

  private _onMatchContext(next: AramMatchContext) {
    let visibleContext = next
    if (next.connection === 'connected') {
      const identity = this._identityContext
      if (identity && isChampSelectGameHandoff(identity, next)) {
        this._migrateAutomaticSignature(identity, next)
      }
      if (
        identity &&
        shouldResetMatch({ previous: identity, next, previousPhase: identity.phase })
      ) {
        this._resetMatch()
      }
      if (
        identity &&
        next.gameId === null &&
        next.champSelectSessionId === null &&
        !next.selfChampion &&
        next.allies.length === 0 &&
        next.phase === null
      ) {
        visibleContext = { ...identity, connection: 'connected' }
      }
      if (visibleContext.gameId !== null || visibleContext.champSelectSessionId) {
        this._identityContext = visibleContext
      } else if (identity) {
        this._identityContext = {
          ...identity,
          phase: visibleContext.phase ?? identity.phase,
          connection: 'connected'
        }
      }
    } else if (this._identityContext) {
      // LCU clears its snapshots on disconnect. Keep the last positive identity and only expose the new connection state.
      visibleContext = { ...this._identityContext, connection: next.connection }
    }
    runInAction(() => (this._context.state.matchContext = visibleContext))
    // Also run when a provider-backed champion name arrives or automatic guide is enabled mid-match.
    this._considerAutomaticGuide(visibleContext)
  }

  private _considerAutomaticGuide(context: AramMatchContext) {
    if (!this._context.settings.automaticGuide) return
    if (!isReadyForAutomaticGuide(context)) return
    const signature = String(context.gameId)
    if (signature === this._autoAttemptedSignature) return
    this._autoAttemptedSignature = signature
    if (this._active?.manual) {
      this._deferredAutomaticSignature = signature
      return
    }
    void this._startAnalysis(
      { kind: 'lineup-guide', mode: context.mode as 'aram' | 'aram_mayhem' },
      false,
      signature
    ).catch(() => {})
  }

  private async _startAnalysis(
    input: AramAnalysisInput,
    manual: boolean,
    signature: string | null
  ): Promise<AramPendingResult | null> {
    if (this._active) {
      if (!manual) {
        if (this._active.manual) this._deferredAutomaticSignature = signature
        return null
      }
      this._active.controller.abort()
      this._active = null
    }
    const protocol = this._context.settings.activeProvider
    const providerSettings = this._context.settings.providers[protocol]
    const credentialScope = this._scope(protocol)
    const active: ActiveAnalysis = {
      generation: ++this._generation,
      manual,
      signature,
      controller: new AbortController()
    }
    this._active = active
    runInAction(() => {
      this._context.state.active = true
      this._context.state.latestResult = null
      this._context.state.lastErrorCode = null
    })
    try {
      const apiKey = (await this._credentials.get(credentialScope)) ?? ''
      this._assertActive(active)
      const image = input.screenshotToken
        ? this.screenshot.consume(input.screenshotToken)
        : undefined
      if (!input.screenshotToken) this.screenshot.clear()
      const mode = this._resolveMode(input.mode)
      const context = this._context.settings.automaticContext
        ? this._context.state.matchContext
        : null
      const championId = this._resolveChampionId(input.championId, context)
      const championName = championId ? this._championName(championId) : null
      const cards =
        input.kind === 'augment-advice' && input.cardIds ? this._resolveCards(input.cardIds) : []
      const confirmedCards = this._getConfirmedAugments()
      const stats =
        mode === 'aram_mayhem' && championId
          ? await this._getMayhemStats(
              championId,
              this._context.settings.statsSource,
              active.controller.signal
            )
          : null
      this._assertActive(active)
      const prompt = this._buildPrompt({
        input,
        mode,
        context,
        championName,
        cards,
        confirmedCards,
        stats
      })
      const provider = createVisionProvider({
        protocol,
        baseUrl: providerSettings.baseUrl,
        model: providerSettings.model,
        apiKey,
        fetchImpl: (url, init) => this._context.network.fetch(url, init)
      })
      const output = await provider.generate({
        prompt,
        image,
        timeoutMs: this._context.settings.requestTimeoutMs,
        signal: active.controller.signal
      })
      this._assertActive(active)
      const pending: AramPendingResult = {
        id: crypto.randomUUID(),
        output,
        kind: input.kind,
        mode,
        championName
      }
      runInAction(() => {
        this._context.state.latestResult = pending
        this._context.state.lastErrorCode = null
      })
      return pending
    } catch (error) {
      if (this._isCurrent(active)) {
        const code =
          error instanceof ProviderError
            ? error.code
            : error instanceof Error && 'code' in error
              ? String(error.code)
              : 'ANALYSIS_FAILED'
        runInAction(() => {
          this._context.state.lastErrorCode = safeErrorCode(code)
          this._context.state.latestResult = null
        })
      }
      if (!manual) return null
      throw error instanceof ProviderError
        ? error
        : new ProviderError('NETWORK_ERROR', 'Analysis could not be completed.')
    } finally {
      if (this._isCurrent(active)) {
        this._active = null
        runInAction(() => (this._context.state.active = false))
        this._runDeferredGuideIfReady()
      }
    }
  }

  private _runDeferredGuideIfReady() {
    const signature = this._deferredAutomaticSignature
    this._deferredAutomaticSignature = null
    const context = this._context.state.matchContext
    if (
      !signature ||
      !this._context.settings.automaticGuide ||
      signature !== String(context.gameId) ||
      !isReadyForAutomaticGuide(context)
    )
      return
    void this._startAnalysis(
      { kind: 'lineup-guide', mode: context.mode as 'aram' | 'aram_mayhem' },
      false,
      signature
    ).catch(() => {})
  }

  private _validateAnalysisInput(input: AramAnalysisInput): AramAnalysisInput {
    if (
      !input ||
      typeof input !== 'object' ||
      !['lineup-guide', 'augment-advice'].includes(input.kind)
    ) {
      throw new ProviderError('INVALID_INPUT', 'Analysis request is invalid.')
    }
    if (input.kind === 'augment-advice') {
      const hasImage =
        typeof input.screenshotToken === 'string' && input.screenshotToken.length <= 64
      const hasCards = Array.isArray(input.cardIds)
      if (hasImage === hasCards) {
        throw new ProviderError(
          'INVALID_INPUT',
          'Choose one screenshot or exactly three local cards.'
        )
      }
      if (hasCards && (input.cardIds!.length !== 3 || new Set(input.cardIds).size !== 3)) {
        throw new ProviderError(
          'INVALID_INPUT',
          'Text analysis requires exactly three distinct cards.'
        )
      }
      if (hasCards && input.cardIds!.some((id) => typeof id !== 'string' || id.length > 256)) {
        throw new ProviderError('INVALID_INPUT', 'Selected card identifiers are invalid.')
      }
    } else if (input.screenshotToken || input.cardIds?.length) {
      throw new ProviderError('INVALID_INPUT', 'Lineup guide does not accept augment input.')
    }
    if (input.mode !== undefined && input.mode !== 'aram' && input.mode !== 'aram_mayhem') {
      throw new ProviderError('INVALID_INPUT', 'Choose ARAM or ARAM Mayhem mode.')
    }
    return input
  }

  private _resolveMode(explicitMode?: 'aram' | 'aram_mayhem'): 'aram' | 'aram_mayhem' {
    const automaticContext = this._context.settings.automaticContext
      ? this._context.state.matchContext
      : null
    if (automaticContext?.mode === 'aram' || automaticContext?.mode === 'aram_mayhem')
      return automaticContext.mode
    return explicitMode ?? 'aram_mayhem'
  }

  private _resolveChampionId(
    championId: number | null | undefined,
    context: AramMatchContext | null
  ) {
    const resolved =
      championId ?? this._manualChampionOverride ?? context?.selfChampion?.championId ?? null
    if (resolved === null) return null
    if (!Number.isSafeInteger(resolved) || resolved <= 0 || !this._championName(resolved)) {
      throw new ProviderError('INVALID_INPUT', 'Choose a champion available in local game data.')
    }
    return resolved
  }

  private _resolveCards(cardIds?: string[]): AugmentCatalogEntry[] {
    if (!cardIds || cardIds.length !== 3 || new Set(cardIds).size !== 3) {
      throw new ProviderError(
        'INVALID_INPUT',
        'Text analysis requires exactly three distinct cards.'
      )
    }
    const candidates = new Map(
      recommendationCandidates(this._requireCatalog()).map((entry) => [entry.id, entry])
    )
    const entries = cardIds.map((id) => candidates.get(id))
    if (entries.some((entry) => !entry)) {
      throw new ProviderError(
        'INVALID_INPUT',
        'Selected cards must be verified local recommendations.'
      )
    }
    return entries as AugmentCatalogEntry[]
  }

  private async _getMayhemStats(
    championId: number,
    source: ChampionDataSourceId,
    signal: AbortSignal
  ): Promise<ChampionDataDetails | null> {
    const key = `${source}:aram_mayhem:${championId}`
    const cached = this._statsCache.get(key)
    if (cached !== undefined) return cached
    const inFlight = this._statsInFlight.get(key)
    if (inFlight && !inFlight.signal.aborted) return inFlight.promise
    if (inFlight) this._statsInFlight.delete(key)
    const record: InFlightChampionStats = { signal, promise: Promise.resolve(null) }
    record.promise = this._context.championData
      .loadDetails({ source, mode: 'aram_mayhem', position: 'all' }, championId, { signal })
      .then((result) => {
        const data =
          result.status === 'success' &&
          result.effectiveSource === source &&
          result.data.metadata.source === source &&
          result.data.metadata.mode === 'aram_mayhem' &&
          result.data.championId === championId
            ? result.data
            : null
        if (!signal.aborted) this._statsCache.set(key, data)
        return data
      })
      .catch((error) => {
        if (signal.aborted) throw error
        this._statsCache.set(key, null)
        return null
      })
      .finally(() => {
        if (this._statsInFlight.get(key) === record) this._statsInFlight.delete(key)
      })
    this._statsInFlight.set(key, record)
    return record.promise
  }

  private _buildPrompt(options: {
    input: AramAnalysisInput
    mode: 'aram' | 'aram_mayhem'
    context: AramMatchContext | null
    championName: string | null
    cards: AugmentCatalogEntry[]
    confirmedCards: AugmentCatalogEntry[]
    stats: ChampionDataDetails | null
  }) {
    const catalog = this._requireCatalog()
    const locale = i18next.language.startsWith('zh') ? 'zh' : 'en'
    const localized = (text: { zh: string; en: string }) => text[locale]
    const contextText = options.context
      ? [
          `Mode: ${options.context.mode}`,
          options.context.phase ? `Phase: ${options.context.phase}` : null,
          options.championName ? `Selected champion: ${options.championName}` : null,
          options.context.allies.length
            ? `Allies: ${options.context.allies
                .map((c) => c.name)
                .filter(Boolean)
                .join(', ')}`
            : null,
          options.context.enemies.length
            ? `Visible enemies: ${options.context.enemies
                .map((c) => c.name)
                .filter(Boolean)
                .join(', ')}`
            : null
        ]
          .filter(Boolean)
          .join('\n')
      : options.championName
        ? `Selected champion: ${options.championName}`
        : 'No live match context was shared.'
    const cardText = options.cards
      .map(
        (card, index) =>
          `${index + 1}. ${localized(card.name)} (${card.rarity}, ${card.kind}, ${card.scope}; text ${card.textStatus}; patch status ${card.currentPatchChange})\nEffect: ${localized(card.effect)}`
      )
      .join('\n\n')
    const confirmedText = options.confirmedCards
      .map(
        (card) =>
          `- ${localized(card.name)} (${card.rarity}, ${card.kind}; ${card.textStatus} text)\nEffect: ${localized(card.effect)}`
      )
      .join('\n\n')
    const mayhemStats = this._formatMayhemStats(options.stats)
    const sourceNote = `Offline card dataset: ${catalog.sourceName}; source patch ${catalog.sourcePatch} (not verified against the live game patch); ${catalog.cardCount} records include dynamic and special entries and are not all selectable. Source: ${catalog.sourcePageUrl}. Dataset SHA-256: ${catalog.rawSha256}.`
    const purpose =
      options.input.kind === 'lineup-guide'
        ? 'Give a concise ARAM lineup guide for champion role, team needs, and practical play priorities. Do not invent match results or augment synergy data.'
        : options.input.screenshotToken
          ? 'Identify only the augment names and effects that are visibly legible in the supplied screenshot, then compare those options for this champion and team. If any card text is unclear, say so and ask the player to retake the screenshot or choose three local cards; do not guess missing text.'
          : 'Compare the effects of exactly the three supplied local cards for the selected champion and team context. Clearly state uncertainty and do not invent card text or synergies.'
    return [
      'You are a League of Legends ARAM Mayhem assistant. Return plain text only, in the user interface language. Keep advice practical and label evidence versus inference.',
      purpose,
      `Mode: ${options.mode}`,
      `Match context (only the fields below were shared):\n${contextText}`,
      cardText ? `Selected local cards:\n${cardText}` : '',
      confirmedText
        ? `Augments the player explicitly confirmed as already selected this match:\n${confirmedText}`
        : '',
      mayhemStats,
      sourceNote,
      'Never claim that the catalog patch was verified against a live game. Do not invent synergies. Do not call performanceScore, rank, or popularity a win rate. Do not infer game-wide champion win rates from augment data.'
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  private _formatMayhemStats(details: ChampionDataDetails | null): string {
    if (!details || details.metadata.mode !== 'aram_mayhem')
      return 'No compatible Mayhem champion statistics were available; continue without them.'
    const lcuAugments = this._context.leagueClient.data.gameData.augments
    const mapped = mapAugmentStats(details, lcuAugments, this._requireCatalog())
    if (!mapped.length)
      return 'No uniquely name-mapped Mayhem augment statistics were available; continue without them.'
    const sourceLabel = details.metadata.source === 'opgg' ? 'OP.GG' : 'QQ101'
    const attribution = `${sourceLabel} ChampionData, mode ${details.metadata.mode}, patch ${details.metadata.patch ?? 'unspecified'}, data date ${details.metadata.dataDate ?? 'unspecified'}. This source data is shown as attributed augment performance and rank only.`
    return `Attributed Mayhem augment data:\n${attribution}\n${mapped
      .map((row) => {
        const measures = [
          row.performanceScore !== null ? `performance score ${row.performanceScore}` : null,
          row.rank !== null ? `rank ${row.rank}` : null,
          row.popularity !== null ? `popularity ${row.popularity}` : null,
          row.games !== null ? `${row.games} games` : null
        ]
          .filter(Boolean)
          .join(', ')
        return `- ${row.name}: ${measures || 'no numeric measures available'}`
      })
      .join('\n')}`
  }

  private _requireCatalog(): AugmentCatalog {
    const catalog = this._context.state.catalog
    if (!catalog) throw new ProviderError('CONFIG_ERROR', 'Offline augment catalog is not ready.')
    return catalog
  }

  private _getConfirmedAugments(): AugmentCatalogEntry[] {
    const entries = new Map(this._requireCatalog().entries.map((entry) => [entry.id, entry]))
    return this._context.state.history.flatMap((item) => {
      const entry = entries.get(item.cardId)
      return entry ? [entry] : []
    })
  }

  private _championName(championId: number) {
    const value = this._context.leagueClient.data.gameData.champions[championId]?.name
    return value ? cleanLabel(value, 100) : null
  }

  private _scope(protocol: ProviderProtocol) {
    const config = this._context.settings.providers[protocol]
    return providerCredentialScope(protocol, config.baseUrl)
  }

  private _assertProtocol(protocol: ProviderProtocol): asserts protocol is ProviderProtocol {
    if (!ALLOWED_PROTOCOLS.includes(protocol))
      throw new ProviderError('INVALID_PROTOCOL', 'Choose a supported provider protocol.')
  }

  private _isCurrent(active: ActiveAnalysis) {
    return (
      this._active === active &&
      this._generation === active.generation &&
      !active.controller.signal.aborted
    )
  }

  private _assertActive(active: ActiveAnalysis) {
    if (!this._isCurrent(active)) throw new ProviderError('CANCELLED', 'Analysis was cancelled.')
  }

  private _assertCatalogUpdateActive(abortController: AbortController) {
    if (this._disposed || abortController.signal.aborted) {
      throw new CatalogError('CANCELLED', 'Catalog update was cancelled.')
    }
  }

  private _migrateAutomaticSignature(previous: AramMatchContext, next: AramMatchContext) {
    const previousSignature = String(previous.gameId)
    const nextSignature = String(next.gameId)
    if (this._autoAttemptedSignature === previousSignature) {
      this._autoAttemptedSignature = nextSignature
    }
    if (this._deferredAutomaticSignature === previousSignature) {
      this._deferredAutomaticSignature = nextSignature
    }
  }

  private _resetMatch() {
    this._generation += 1
    this._active?.controller.abort()
    this._active = null
    this._manualChampionOverride = null
    this._autoAttemptedSignature = null
    this._deferredAutomaticSignature = null
    this.screenshot.clear()
    runInAction(() => {
      this._context.state.history = []
      this._context.state.latestResult = null
      this._context.state.active = false
      this._context.state.lastErrorCode = null
      this._context.state.manualChampionOverrideId = null
      this._context.state.matchGeneration += 1
    })
  }
}

export function mapAugmentStats(
  details: ChampionDataDetails,
  lcuAugments: Record<number, Augment>,
  catalog: AugmentCatalog
) {
  if (details.metadata.mode !== 'aram_mayhem') return []
  const names = new Map<string, Set<string>>()
  for (const entry of catalog.entries) {
    for (const name of [entry.name.zh, entry.name.en]) {
      const normalized = normalizeName(name)
      if (!normalized) continue
      const ids = names.get(normalized) ?? new Set<string>()
      ids.add(entry.id)
      names.set(normalized, ids)
    }
  }
  const rows: Array<{
    name: string
    performanceScore: number | null
    rank: number | null
    popularity: number | null
    games: number | null
  }> = []
  for (const statistic of details.sections.augments ?? []) {
    const lcuName = lcuAugments[statistic.augmentId]?.nameTRA
    const ids = lcuName ? names.get(normalizeName(lcuName)) : undefined
    if (!ids || ids.size !== 1) continue
    const card = catalog.entries.find((entry) => entry.id === [...ids][0])
    if (!card) continue
    rows.push({
      name: card.name.en,
      performanceScore: finite(statistic.performanceScore),
      rank: finite(statistic.rank),
      popularity: finite(statistic.popularity),
      games: finite(statistic.performance.games)
    })
  }
  return rows.slice(0, 30)
}

function catalogMetadata(catalog: AugmentCatalog, source: 'bundled' | 'user') {
  return {
    source,
    sourceName: catalog.sourceName,
    sourceUrl: catalog.sourceUrl,
    sourcePageUrl: catalog.sourcePageUrl,
    sourcePatch: catalog.sourcePatch,
    rawSha256: catalog.rawSha256,
    fetchedAt: catalog.fetchedAt,
    cardCount: catalog.cardCount
  }
}

function cleanLabel(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, maxLength)
}

function cleanModel(value: unknown): string {
  const model = cleanLabel(value, 256)
  return model && !/[\u0000-\u001f\u007f]/.test(model) ? model : ''
}

function normalizeName(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safeErrorCode(code: string) {
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'ANALYSIS_FAILED'
}
