import type { ChampionDataSourceId } from '@shared/data-adapter/champion-data'
import type {
  AramAssistantPreferences,
  AramCredentialStatus,
  AramHistoryItem,
  AramMatchContext,
  AramPendingResult,
  AramProviderPreference,
  AugmentCatalog,
  AugmentCatalogEntry,
  ProviderProtocol
} from '@shared/types/aram-assistant'
import { makeAutoObservable, observableRef } from 'mobx'

export type {
  AramAssistantPreferences,
  AramCredentialStatus,
  AramHistoryItem,
  AramPendingResult,
  AramProviderPreference
} from '@shared/types/aram-assistant'

export class AramAssistantSettings implements AramAssistantPreferences {
  activeProvider: ProviderProtocol = 'gemini'
  providers: Record<ProviderProtocol, AramProviderPreference> = {
    gemini: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.5-flash'
    },
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
  }
  automaticGuide = false
  automaticAugmentCapture = true
  automaticContext = true
  requestTimeoutMs = 30_000
  statsSource: ChampionDataSourceId = 'opgg'

  constructor() {
    makeAutoObservable(this, { providers: observableRef })
  }
}

export class AramAssistantState {
  matchContext: AramMatchContext = {
    connection: 'disconnected',
    phase: null,
    queueId: null,
    mode: 'other',
    mapId: null,
    gameId: null,
    selfChampion: null,
    allies: [],
    enemies: [],
    champSelectSessionId: null
  }
  catalog: AugmentCatalog | null = null
  catalogSource: 'bundled' | 'user' = 'bundled'
  catalogFallbackCode: string | null = null
  history: AramHistoryItem[] = []
  active = false
  lastErrorCode: string | null = null
  manualChampionOverrideId: number | null = null
  matchGeneration = 0
  credentialStatus: Record<ProviderProtocol, AramCredentialStatus> = {
    gemini: { configured: false, storageMode: 'empty' },
    openai: { configured: false, storageMode: 'empty' }
  }
  latestCandidates: AugmentCatalogEntry[] = []
  latestResult: AramPendingResult | null = null

  constructor() {
    makeAutoObservable(this, {
      matchContext: observableRef,
      catalog: observableRef,
      history: observableRef,
      credentialStatus: observableRef,
      latestCandidates: observableRef,
      latestResult: observableRef
    })
  }
}
