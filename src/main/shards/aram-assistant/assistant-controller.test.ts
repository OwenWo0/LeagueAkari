import { action, observable, reaction, runInAction } from 'mobx'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  AramAssistantController,
  type AramCredentialStorePort,
  type AramScreenshotPort
} from './assistant-controller'
import { readCatalogFile, recommendationCandidates } from './catalog-loader'
import type { AramAssistantMainContext } from './context'
import { AramAssistantSettings, AramAssistantState } from './state'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  },
  desktopCapturer: { getSources: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  nativeImage: {
    createFromBuffer: vi.fn(() => ({
      isEmpty: () => false,
      getSize: () => ({ width: 32, height: 24 }),
      resize: () => ({
        toJPEG: () => Buffer.from([0xff, 0xd8, 0xff, 0xd9])
      })
    }))
  },
  systemPreferences: { getMediaAccessStatus: () => 'granted' }
}))
vi.mock('@main/i18n', () => ({ i18next: { language: 'en' } }))

const catalogPath = path.resolve('resources/aram-assistant/augment-catalog.json')
const tempFolders: string[] = []

afterEach(async () => {
  await Promise.all(
    tempFolders.splice(0).map((folder) => fs.rm(folder, { recursive: true, force: true }))
  )
  vi.restoreAllMocks()
})

describe('AramAssistantController flows', () => {
  it('sends the explicitly previewed image without requiring three text cards', async () => {
    const requests: CapturedProviderRequest[] = []
    const fetch = createProviderFetch(requests)
    const screenshot = createScreenshotPort()
    const { controller, settings } = await createController({ screenshot, fetch })
    configureOpenAi(settings, 'http://127.0.0.1:1/v1')

    const result = await controller.analyze({
      kind: 'augment-advice',
      mode: 'aram',
      screenshotToken: 'preview-one'
    })

    expect(result.output).toBe('Local simulation response')
    expect(screenshot.consume).toHaveBeenCalledTimes(1)
    expect(screenshot.clear).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
    const content = requests[0].body.messages[0].content
    expect(content[1]).toMatchObject({ type: 'image_url' })
    expect(content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/)
    expect(content[0].text).not.toContain('Selected local cards:')
  })

  it('rejects an invalid provider URL before persisting settings', async () => {
    const { controller, context } = await createController()

    await expect(
      controller.setProviderSettings('openai', {
        baseUrl: 'https://api.example.com/v1/chat/completions',
        model: 'test-model'
      })
    ).rejects.toMatchObject({ code: 'INVALID_BASE_URL' })

    expect(context.settingService.set).not.toHaveBeenCalled()
  })

  it('records only a chosen local augment and includes it in future prompts until undo', async () => {
    const requests: CapturedProviderRequest[] = []
    const fetch = createProviderFetch(requests)
    const { controller, settings } = await createController({ fetch })
    configureOpenAi(settings, 'http://127.0.0.1:1/v1')
    const candidates = recommendationCandidates(controller.getCatalog())
    const chosen = candidates.slice(0, 3)

    expect(() => controller.confirmAugment('model-output-is-not-a-card')).toThrowError()
    controller.confirmAugment(chosen[0].id)
    await controller.analyze({
      kind: 'augment-advice',
      mode: 'aram',
      cardIds: chosen.map((entry) => entry.id)
    })
    const firstPrompt = requests[0].body.messages[0].content[0].text as string
    expect(firstPrompt).toContain(
      'Augments the player explicitly confirmed as already selected this match:'
    )
    expect(firstPrompt).toContain(chosen[0].name.en)

    expect(controller.undoConfirmedAugment()?.cardId).toBe(chosen[0].id)
    await controller.analyze({
      kind: 'augment-advice',
      mode: 'aram',
      cardIds: chosen.map((entry) => entry.id)
    })
    const secondPrompt = requests[1].body.messages[0].content[0].text as string
    expect(secondPrompt).not.toContain(
      'Augments the player explicitly confirmed as already selected this match:'
    )
    await expect(
      controller.analyze({
        kind: 'augment-advice',
        mode: 'aram',
        cardIds: chosen.slice(0, 2).map((entry) => entry.id)
      })
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(requests).toHaveLength(2)
  })

  it('cancels an active generation while credentials are still loading', async () => {
    let releaseCredential!: (value: string | null) => void
    const credentials = createCredentialPort(
      () => new Promise((resolve) => (releaseCredential = resolve))
    )
    const fetch = vi.fn(async () => new Response('{}'))
    const { controller, settings } = await createController({ credentials, fetch })
    configureOpenAi(settings, 'http://127.0.0.1:1/v1')

    const request = controller.analyze({ kind: 'lineup-guide', mode: 'aram' })
    await vi.waitFor(() => expect(releaseCredential).toBeTypeOf('function'))
    controller.cancelAnalysis()
    releaseCredential('secret')

    await expect(request).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(fetch).not.toHaveBeenCalled()
    expect(controller.getCatalog()).toBeTruthy()
  })

  it('runs the one deferred automatic guide when a manual analysis is cancelled', async () => {
    let releaseManualCredential!: (value: string | null) => void
    let credentialReads = 0
    const credentials = createCredentialPort(() => {
      credentialReads += 1
      if (credentialReads > 1) return Promise.resolve('local-secret')
      return new Promise((resolve) => (releaseManualCredential = resolve))
    })
    const fetch = vi.fn(async () => jsonResponse('Automatic guide'))
    const { controller, settings, league, state } = await createController({
      credentials,
      fetch,
      league: createReadyLeague()
    })
    configureOpenAi(settings, 'http://127.0.0.1:1/v1')

    const manual = controller.analyze({ kind: 'lineup-guide', mode: 'aram' })
    await vi.waitFor(() => expect(releaseManualCredential).toBeTypeOf('function'))
    await controller.setAutomaticGuide(true)
    expect(fetch).not.toHaveBeenCalled()

    controller.cancelAnalysis()

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    releaseManualCredential('local-secret')
    await expect(manual).rejects.toMatchObject({ code: 'CANCELLED' })
    await vi.waitFor(() => expect(state.latestResult?.output).toBe('Automatic guide'))
    expect(league.state.connectionState).toBe('connected')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('requests only the chosen ChampionData source and attributes uniquely mapped Mayhem statistics', async () => {
    const requests: CapturedProviderRequest[] = []
    const fetch = createProviderFetch(requests)
    const loadDetails = vi.fn(async () => ({
      status: 'success',
      effectiveSource: 'opgg',
      data: {
        metadata: { source: 'opgg', mode: 'aram_mayhem', patch: '16.20', dataDate: '2026-10-01' },
        championId: 1,
        summary: {},
        sections: {
          augments: [
            {
              augmentId: 42,
              performanceScore: 78.2,
              rank: 4,
              popularity: 0.23,
              performance: { games: 900 }
            },
            {
              augmentId: 43,
              performanceScore: 99,
              rank: 1,
              popularity: 0.5,
              performance: { games: 999 }
            },
            {
              augmentId: 44,
              performanceScore: 100,
              rank: 1,
              popularity: 0.9,
              performance: { games: 5000 }
            }
          ]
        }
      }
    }))
    const { controller, settings, context, league } = await createController({
      fetch,
      championData: { loadDetails }
    })
    configureOpenAi(settings, 'http://127.0.0.1:1/v1')
    const card = recommendationCandidates(controller.getCatalog())[0]
    const duplicateName = controller.getCatalog().entries.find((entry) => entry.id !== card.id)!
    const duplicateNameCopy = controller
      .getCatalog()
      .entries.find((entry) => entry.id !== card.id && entry.id !== duplicateName.id)!
    duplicateNameCopy.name.en = duplicateName.name.en
    runInAction(() => {
      league.data.gameData.augments[42] = { id: 42, nameTRA: card.name.en }
      league.data.gameData.augments[43] = { id: 43, nameTRA: duplicateName.name.en }
      league.data.gameData.augments[44] = { id: 44, nameTRA: 'Unknown local fixture augment' }
    })

    await controller.analyze({ kind: 'lineup-guide', mode: 'aram_mayhem', championId: 1 })

    expect(loadDetails).toHaveBeenCalledTimes(1)
    expect(loadDetails).toHaveBeenCalledWith(
      { source: 'opgg', mode: 'aram_mayhem', position: 'all' },
      1,
      { signal: expect.any(AbortSignal) }
    )
    const prompt = requests[0].body.messages[0].content[0].text as string
    expect(prompt).toContain('OP.GG ChampionData, mode aram_mayhem')
    expect(prompt).toContain(
      `${card.name.en}: performance score 78.2, rank 4, popularity 0.23, 900 games`
    )
    expect(prompt).not.toContain('999 games')
    expect(prompt).not.toContain('5000 games')
    expect(prompt).not.toContain('Champion win rate: 78.2')
    expect(context.championData.loadDetails).toBe(loadDetails)
  })

  it('considers delayed champion data and settings changes, then attempts once across ChampSelect handoff', async () => {
    const fetch = vi.fn(async () => jsonResponse('Automatic guide'))
    const league = createReadyChampSelectLeague({ includeChampionNames: false, gameId: 8042 })
    const { controller, settings } = await createController({ league, fetch })
    configureOpenAi(settings, 'http://127.0.0.1:1/v1')
    expect(fetch).not.toHaveBeenCalled()

    action(() => {
      Object.assign(league.data.gameData.champions, championNames())
    })()
    await controller.setAutomaticGuide(true)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    action(() => {
      league.data.gameflow.phase = 'InProgress'
      league.data.gameflow.session = gameflowSession(8043)
    })()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('preserves history and avoids a second automatic charge when ChampSelect gameId drifts', async () => {
    const fetch = vi.fn(async () => jsonResponse('Automatic guide'))
    const league = createReadyChampSelectLeague({ gameId: 8042 })
    const { controller, settings, state } = await createController({ league, fetch })
    configureOpenAi(settings, 'http://127.0.0.1:1/v1')
    await controller.setAutomaticGuide(true)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(state.latestResult?.output).toBe('Automatic guide'))

    const card = recommendationCandidates(controller.getCatalog())[0]
    controller.confirmAugment(card.id)
    const matchGeneration = state.matchGeneration

    action(() => {
      league.data.gameflow.phase = 'InProgress'
      league.data.champSelect.session = null
      league.data.gameflow.session = gameflowSession(8043)
    })()

    expect(state.matchContext.gameId).toBe(8043)
    expect(state.matchGeneration).toBe(matchGeneration)
    expect(state.history).toHaveLength(1)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps the match identity and confirmed cards through disconnect, then clears them for a new game', async () => {
    const league = createReadyLeague()
    const { controller, settings, state } = await createController({ league })
    settings.automaticGuide = false
    const card = recommendationCandidates(controller.getCatalog())[0]
    controller.confirmAugment(card.id)
    await controller.setManualChampionOverride(1)

    action(() => {
      league.state.connectionState = 'disconnected'
      league.data.gameflow.session = null
      league.data.gameflow.phase = null
      league.data.champSelect.session = null
      league.data.summoner.me = null
    })()
    expect(state.matchContext.connection).toBe('disconnected')
    expect(state.matchContext.gameId).toBe(8042)
    expect(state.history).toHaveLength(1)

    action(() => {
      league.state.connectionState = 'connected'
    })()
    expect(state.matchContext.gameId).toBe(8042)
    expect(state.history).toHaveLength(1)

    action(() => {
      league.data.gameflow.session = gameflowSession(8043)
      league.data.gameflow.phase = 'InProgress'
      league.data.summoner.me = { puuid: 'player-puuid', summonerId: 1 }
    })()
    expect(state.matchContext.gameId).toBe(8043)
    expect(state.history).toHaveLength(0)
    expect(state.manualChampionOverrideId).toBeNull()
  })

  it('clears history and retries automatic guidance after a new ChampSelect session reuses the game id', async () => {
    const fetch = vi.fn(async () => jsonResponse('Automatic guide'))
    const league = createReadyLeague()
    const { controller, settings, state } = await createController({ league, fetch })
    configureOpenAi(settings, 'http://127.0.0.1:1/v1')
    await controller.setAutomaticGuide(true)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(state.latestResult?.output).toBe('Automatic guide'))

    const card = recommendationCandidates(controller.getCatalog())[0]
    controller.confirmAugment(card.id)
    const before = state.matchGeneration

    action(() => {
      league.data.gameflow.phase = 'ChampSelect'
      league.data.champSelect.session = champSelectSession('new-select-session', 8042)
    })()

    expect(state.matchGeneration).toBe(before + 1)
    expect(state.history).toHaveLength(0)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  })

  it('probes the active vision provider with both bundled sample images', async () => {
    const requests: CapturedProviderRequest[] = []
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const headers: Record<string, string> = {}
      new Headers(init?.headers).forEach((value, key) => (headers[key] = value))
      requests.push({
        url,
        body: JSON.parse(String(init?.body)) as Record<string, any>,
        headers
      })
      return jsonResponse('PROBE_OK landscape')
    })
    const { controller, settings } = await createController({ fetch })
    configureOpenAi(settings, 'http://127.0.0.1:1/v1')
    await controller.setCredential('openai', 'probe-key')

    const result = await controller.probeVisionProvider()

    expect(result.protocol).toBe('openai')
    expect(result.results).toEqual([
      { id: 'probe-a', ok: true, output: 'PROBE_OK landscape' },
      { id: 'probe-b', ok: true, output: 'PROBE_OK landscape' }
    ])
    expect(requests).toHaveLength(2)
    expect(
      requests.every((entry) =>
        entry.body.messages[0].content.some((part: { type: string }) => part.type === 'image_url')
      )
    ).toBe(true)
  })

  it('shares one catalog update among concurrent callers', async () => {
    const source = await catalogUpdateSource()
    let releaseFetch!: (response: Response) => void
    const fetch = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Promise<Response>((resolve) => (releaseFetch = resolve))
    )
    const { controller, state } = await createController({ fetch })
    const rename = vi.spyOn(fs, 'rename')

    const first = controller.updateCatalog()
    await vi.waitFor(() => expect(releaseFetch).toBeTypeOf('function'))
    const second = controller.updateCatalog()

    expect(fetch).toHaveBeenCalledTimes(1)
    releaseFetch(catalogUpdateResponse(source))
    const [firstResult, secondResult] = await Promise.all([first, second])

    expect(firstResult).toEqual(secondResult)
    expect(state.catalogSource).toBe('user')
    expect(rename).toHaveBeenCalledTimes(1)
  })

  it('aborts catalog loading on dispose and keeps state and overlay untouched', async () => {
    let requestSignal: AbortSignal | undefined
    const fetch = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal as AbortSignal
          requestSignal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true
          })
        })
    )
    const { controller, context, state } = await createController({ fetch })
    const originalCatalog = state.catalog
    const update = controller.updateCatalog()
    await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal))

    controller.dispose()

    expect(requestSignal?.aborted).toBe(true)
    await expect(update).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(state.catalog).toBe(originalCatalog)
    expect(state.catalogSource).toBe('bundled')
    await expect(
      fs.stat(path.join(context.userDataPath, 'aram-assistant', 'catalog-overlay.json'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('leaves a completed result and prior error unchanged when cancelled while idle', async () => {
    const { controller, state } = await createController()
    const previousResult = {
      id: 'completed-result',
      output: 'Already completed',
      kind: 'lineup-guide' as const,
      mode: 'aram' as const,
      championName: null
    }
    runInAction(() => {
      state.latestResult = previousResult
      state.lastErrorCode = 'UPSTREAM_ERROR'
    })

    controller.cancelAnalysis()

    expect(state.latestResult).toBe(previousResult)
    expect(state.lastErrorCode).toBe('UPSTREAM_ERROR')
  })

  it('disposes an active analysis without publishing a cancellation error', async () => {
    let releaseCredential!: (value: string | null) => void
    const credentials = createCredentialPort(
      () => new Promise((resolve) => (releaseCredential = resolve))
    )
    const { controller, settings, state } = await createController({ credentials })
    configureOpenAi(settings, 'http://127.0.0.1:1/v1')
    const request = controller.analyze({ kind: 'lineup-guide', mode: 'aram' })
    await vi.waitFor(() => expect(releaseCredential).toBeTypeOf('function'))

    controller.dispose()
    releaseCredential('secret')

    await expect(request).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(state.active).toBe(false)
    expect(state.lastErrorCode).toBeNull()
  })
})

async function createController(
  options: {
    credentials?: AramCredentialStorePort
    screenshot?: AramScreenshotPort
    fetch?: (input: string, init?: RequestInit) => Promise<Response>
    league?: ReturnType<typeof createReadyLeague>
    championData?: { loadDetails: (...args: any[]) => Promise<unknown> }
  } = {}
) {
  const settings = new AramAssistantSettings()
  const state = new AramAssistantState()
  const leagueClient = options.league ?? createReadyLeague({ connected: false })
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'akari-aram-controller-'))
  tempFolders.push(folder)
  const probeDir = path.resolve('resources/aram-assistant/probe')
  const context = {
    settings,
    state,
    userDataPath: folder,
    bundledCatalogPath: catalogPath,
    bundledProbeImagePaths: [
      { id: 'probe-a' as const, path: path.join(probeDir, 'probe-a.jpg') },
      { id: 'probe-b' as const, path: path.join(probeDir, 'probe-b.jpg') }
    ],
    leagueClient,
    network: {
      fetch: options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init))
    },
    championData: options.championData ?? {
      loadDetails: vi.fn(async () => ({ status: 'unavailable' }))
    },
    settingService: {
      set: vi.fn(async (key: keyof AramAssistantSettings, value: unknown) => {
        runInAction(() => Object.assign(settings, { [key]: value }))
      })
    },
    mobxUtils: {
      reaction: (expression: any, effect: any, reactionOptions: any) =>
        reaction(expression, effect, reactionOptions)
    },
    logger: { warn: vi.fn() },
    windowManager: {}
  } as unknown as AramAssistantMainContext
  const controller = new AramAssistantController(context, {
    credentials: options.credentials ?? createCredentialPort(),
    screenshot: options.screenshot ?? createScreenshotPort()
  })
  await controller.initialize()
  return { controller, context, settings, state, league: leagueClient }
}

function createCredentialPort(
  get: (scope: string) => Promise<string | null> = async () => 'local-secret'
): AramCredentialStorePort {
  return {
    get,
    has: async () => true,
    getStorageMode: () => 'memory-only',
    set: async () => {}
  }
}

function createScreenshotPort(): AramScreenshotPort {
  return {
    listDisplays: async () => [],
    prepareDesktopScreenshot: async () => ({
      token: 'preview-one',
      previewDataUrl: '',
      width: 1,
      height: 1
    }),
    chooseImageFile: async () => null,
    consume: vi.fn(() => ({
      bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      mimeType: 'image/jpeg' as const
    })),
    discard: vi.fn(),
    clear: vi.fn()
  }
}

function configureOpenAi(settings: AramAssistantSettings, baseUrl: string) {
  runInAction(() => {
    settings.activeProvider = 'openai'
    settings.providers.openai = { baseUrl, model: 'test-model' }
  })
}

interface CapturedProviderRequest {
  url: string
  body: Record<string, any>
  headers: Record<string, string>
}

function createProviderFetch(requests: CapturedProviderRequest[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => (headers[key] = value))
    requests.push({
      url,
      body: JSON.parse(String(init?.body)) as Record<string, any>,
      headers
    })
    return jsonResponse('Local simulation response')
  })
}

function jsonResponse(output: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: output }, finish_reason: 'stop' }] }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    }
  )
}

function createReadyLeague(
  options: { includeChampionNames?: boolean; connected?: boolean } = {}
): any {
  const championMap = options.includeChampionNames === false ? {} : championNames()
  return observable({
    state: { connectionState: options.connected === false ? 'disconnected' : 'connected' },
    data: {
      gameflow: { phase: 'InProgress', session: gameflowSession(8042) },
      champSelect: { session: null as ReturnType<typeof champSelectSession> | null },
      summoner: { me: { puuid: 'player-puuid', summonerId: 1 } },
      gameData: { champions: championMap, queues: {}, augments: {} }
    }
  })
}

function createReadyChampSelectLeague(options: {
  includeChampionNames?: boolean
  gameId: number
}): any {
  const league = createReadyLeague({ includeChampionNames: options.includeChampionNames })
  action(() => {
    league.data.gameflow.phase = 'ChampSelect'
    league.data.gameflow.session = null
    league.data.champSelect.session = champSelectSession('session-a', options.gameId)
  })()
  return league
}

async function catalogUpdateSource() {
  const catalog = await readCatalogFile(catalogPath)
  return {
    schemaVersion: 1,
    riotPatch: catalog.sourcePatch,
    batchSize: catalog.sourceBatchSize,
    entries: catalog.entries.map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      effect: entry.effect,
      rarityLabel: entry.tier,
      rarity: entry.rarity,
      kind: entry.kind,
      scope: entry.scope,
      textStatus: entry.textStatus,
      tags: entry.tags,
      currentPatchChange: entry.currentPatchChange,
      sourceUrl: entry.sourceUrl
    }))
  }
}

function catalogUpdateResponse(source: Awaited<ReturnType<typeof catalogUpdateSource>>) {
  return new Response(JSON.stringify(source), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })
}

function gameflowSession(gameId: number) {
  const teamOne = Array.from({ length: 5 }, (_, index) => ({
    puuid: index === 0 ? 'player-puuid' : `ally-${index}`,
    summonerId: index === 0 ? 1 : index + 1,
    championId: index + 1
  }))
  const teamTwo = Array.from({ length: 5 }, (_, index) => ({
    puuid: `enemy-${index}`,
    summonerId: index + 10,
    championId: index + 6
  }))
  return {
    gameData: {
      gameId,
      queue: { id: 2400, gameMode: 'KIWI', mapId: 12 },
      teamOne,
      teamTwo,
      playerChampionSelections: []
    },
    map: { id: 12, gameMode: 'KIWI' }
  }
}

function championNames() {
  return Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => [
      index + 1,
      { id: index + 1, name: `Champion ${index + 1}` }
    ])
  )
}

function champSelectSession(id: string, gameId: number) {
  return {
    id,
    gameId,
    queueId: 2400,
    localPlayerCellId: 0,
    myTeam: Array.from({ length: 5 }, (_, index) => ({ cellId: index, championId: index + 1 })),
    theirTeam: []
  }
}
