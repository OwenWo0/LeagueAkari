import type { ChampionDataSourceId } from '@shared/data-adapter/champion-data'

export interface BilingualText {
  zh: string
  en: string
}

export interface AugmentCatalogEntry {
  id: string
  slug: string
  name: BilingualText
  effect: BilingualText
  tier: BilingualText
  rarity: 'silver' | 'gold' | 'prismatic'
  kind: 'standard' | 'ability' | 'quest' | 'special'
  scope: 'aram' | 'shared'
  textStatus: 'verified' | 'dynamic'
  tags: string[]
  currentPatchChange: 'unchanged' | 'changed'
  sourceUrl: string | null
}

export interface AugmentCatalog {
  schemaVersion: 1
  sourceSchemaVersion: number
  mode: 'aram-mayhem'
  sourceName: string
  sourceUrl: string
  sourcePageUrl: string
  fetchedAt: string
  sourcePatch: string
  patchVerified: false
  rawSha256: string
  sourceBatchSize: number | null
  licenseStatus: string
  remoteIconsOmitted: true
  cardCount: number
  entries: AugmentCatalogEntry[]
}

export interface CatalogSearchOptions {
  query?: string
  rarity?: 'all' | AugmentCatalogEntry['rarity']
  kind?: 'all' | AugmentCatalogEntry['kind']
  scope?: 'all' | AugmentCatalogEntry['scope']
}

export type ProviderProtocol = 'gemini' | 'openai'

export interface AramProviderPreference {
  baseUrl: string
  model: string
}

export interface AramAnalysisInput {
  kind: 'lineup-guide' | 'augment-advice'
  mode?: 'aram' | 'aram_mayhem'
  screenshotToken?: string
  cardIds?: string[]
  championId?: number | null
}

export type AramMode = 'aram' | 'aram_mayhem' | 'other'
export type AramConnection = 'connected' | 'connecting' | 'disconnected'

export interface AramChampionRef {
  championId: number | null
  name: string | null
}

export interface AramMatchContext {
  connection: AramConnection
  phase: string | null
  queueId: number | null
  mode: AramMode
  mapId: number | null
  gameId: number | null
  selfChampion: AramChampionRef | null
  allies: AramChampionRef[]
  enemies: AramChampionRef[]
  champSelectSessionId: string | null
}

export interface AramHistoryItem {
  id: string
  cardId: string
  name: BilingualText
  confirmedAt: string
}

export interface AramAugmentStatComparison {
  cardId: string
  name: BilingualText
  effect: BilingualText
  rarity: string
  tierName?: string
  performanceScore: number | null
  rank: number | null
  popularity: number | null
  isRecommended: boolean
}

export interface AramItemBuildItem {
  id: number
  name: string
}

export interface AramItemBuildRecommendation {
  starterItems: AramItemBuildItem[]
  starterWinRate: number | null
  coreItems: AramItemBuildItem[]
  coreWinRate: number | null
  lastItems: AramItemBuildItem[]
}

export interface AramStructuredAdvice {
  recommendedCardId: string
  candidates: AramAugmentStatComparison[]
  build?: AramItemBuildRecommendation
}

export interface AramPendingResult {
  id: string
  output: string
  kind: 'lineup-guide' | 'augment-advice'
  mode: 'aram' | 'aram_mayhem'
  championName: string | null
  structuredAdvice?: AramStructuredAdvice
}

export interface AramCredentialStatus {
  configured: boolean
  storageMode: 'empty' | 'encrypted-file' | 'memory-only' | 'storage-error'
}

export type AramVisionProbeImageId = 'probe-a' | 'probe-b'

export interface AramVisionProbeImageResult {
  id: AramVisionProbeImageId
  ok: boolean
  output?: string
  errorCode?: string
  /** Short transport/provider message for failed probes; omit on success. */
  errorDetail?: string
}

export interface AramVisionProbeResult {
  protocol: ProviderProtocol
  model: string
  results: AramVisionProbeImageResult[]
}

export interface AramAssistantPreferences {
  activeProvider: ProviderProtocol
  providers: Record<ProviderProtocol, AramProviderPreference>
  automaticGuide: boolean
  /** When true, Mayhem InProgress automatically captures and analyzes the opening augment pick. */
  automaticAugmentCapture: boolean
  automaticContext: boolean
  requestTimeoutMs: number
  statsSource: ChampionDataSourceId
}
