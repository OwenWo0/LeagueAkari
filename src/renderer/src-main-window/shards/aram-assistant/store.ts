import type { ChampionDataSourceId } from '@shared/data-adapter/champion-data'
import type {
  AramCredentialStatus,
  AramHistoryItem,
  AramMatchContext,
  AramPendingResult,
  AramProviderPreference,
  ProviderProtocol
} from '@shared/types/aram-assistant'
import { defineStore } from 'pinia'
import { reactive } from 'vue'

export const useAramAssistantStore = defineStore('main-window:aram-assistant', () => {
  const settings = reactive({
    activeProvider: 'gemini' as ProviderProtocol,
    providers: {
      gemini: {
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        model: 'gemini-2.5-flash'
      },
      openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }
    } as Record<ProviderProtocol, AramProviderPreference>,
    automaticGuide: false,
    automaticContext: true,
    requestTimeoutMs: 30_000,
    statsSource: 'opgg' as ChampionDataSourceId
  })
  const state = reactive({
    matchContext: {
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
    } as AramMatchContext,
    history: [] as AramHistoryItem[],
    active: false,
    lastErrorCode: null as string | null,
    manualChampionOverrideId: null as number | null,
    matchGeneration: 0,
    catalogSource: 'bundled' as 'bundled' | 'user',
    catalogFallbackCode: null as string | null,
    credentialStatus: {
      gemini: { configured: false, storageMode: 'empty' },
      openai: { configured: false, storageMode: 'empty' }
    } as Record<ProviderProtocol, AramCredentialStatus>,
    latestResult: null as AramPendingResult | null
  })

  return { settings, state }
})
