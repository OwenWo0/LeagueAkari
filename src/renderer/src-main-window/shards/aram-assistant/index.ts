import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { PiniaMobxUtilsRenderer } from '@renderer-shared/shards/pinia-mobx-utils'
import { Dep, IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import type { ChampionDataSourceId } from '@shared/data-adapter/champion-data'
import type {
  AramAnalysisInput,
  AramCredentialStatus,
  AramProviderPreference,
  AramVisionProbeResult,
  AugmentCatalog,
  AugmentCatalogEntry,
  CatalogSearchOptions,
  ProviderProtocol
} from '@shared/types/aram-assistant'

import { ARAM_ASSISTANT_MAIN_NAMESPACE, type AramAssistantRendererContext } from './context'
import { useAramAssistantStore } from './store'

@Shard(AramAssistantRenderer.id)
export class AramAssistantRenderer implements IAkariShardInitDispose {
  static id = 'aram-assistant-renderer'
  private readonly _context: AramAssistantRendererContext

  constructor(
    @Dep(AkariIpcRenderer) ipc: AkariIpcRenderer,
    @Dep(PiniaMobxUtilsRenderer) piniaMobxUtils: PiniaMobxUtilsRenderer
  ) {
    this._context = { ipc, piniaMobxUtils }
  }

  getCatalog() {
    return this._context.ipc.call<AugmentCatalog>(ARAM_ASSISTANT_MAIN_NAMESPACE, 'getCatalog')
  }

  searchCards(options: CatalogSearchOptions) {
    return this._context.ipc.call<AugmentCatalogEntry[]>(
      ARAM_ASSISTANT_MAIN_NAMESPACE,
      'searchCards',
      options
    )
  }

  getChampionChoices() {
    return this._context.ipc.call<Array<{ id: number; name: string }>>(
      ARAM_ASSISTANT_MAIN_NAMESPACE,
      'getChampionChoices'
    )
  }

  getManualChampionOverride() {
    return this._context.ipc.call<number | null>(
      ARAM_ASSISTANT_MAIN_NAMESPACE,
      'getManualChampionOverride'
    )
  }

  setManualChampionOverride(championId: number | null) {
    return this._context.ipc.call(
      ARAM_ASSISTANT_MAIN_NAMESPACE,
      'setManualChampionOverride',
      championId
    )
  }

  setProviderSettings(protocol: ProviderProtocol, settings: AramProviderPreference) {
    return this._context.ipc.call(
      ARAM_ASSISTANT_MAIN_NAMESPACE,
      'setProviderSettings',
      protocol,
      settings
    )
  }

  setActiveProvider(protocol: ProviderProtocol) {
    return this._context.ipc.call(ARAM_ASSISTANT_MAIN_NAMESPACE, 'setActiveProvider', protocol)
  }

  setCredential(protocol: ProviderProtocol, key: string) {
    return this._context.ipc.call(ARAM_ASSISTANT_MAIN_NAMESPACE, 'setCredential', protocol, key)
  }

  refreshCredentialStatuses() {
    return this._context.ipc.call<Record<ProviderProtocol, AramCredentialStatus>>(
      ARAM_ASSISTANT_MAIN_NAMESPACE,
      'refreshCredentialStatuses'
    )
  }

  setAutomaticGuide(enabled: boolean) {
    return this._context.ipc.call(ARAM_ASSISTANT_MAIN_NAMESPACE, 'setAutomaticGuide', enabled)
  }

  setAutomaticAugmentCapture(enabled: boolean) {
    return this._context.ipc.call(
      ARAM_ASSISTANT_MAIN_NAMESPACE,
      'setAutomaticAugmentCapture',
      enabled
    )
  }

  setAutomaticContext(enabled: boolean) {
    return this._context.ipc.call(ARAM_ASSISTANT_MAIN_NAMESPACE, 'setAutomaticContext', enabled)
  }

  setRequestTimeout(timeoutMs: number) {
    return this._context.ipc.call(ARAM_ASSISTANT_MAIN_NAMESPACE, 'setRequestTimeout', timeoutMs)
  }

  setStatsSource(source: ChampionDataSourceId) {
    return this._context.ipc.call(ARAM_ASSISTANT_MAIN_NAMESPACE, 'setStatsSource', source)
  }

  listDisplays() {
    return this._context.ipc.call<
      Array<{ sourceId: string; name: string; displayId: string | null }>
    >(ARAM_ASSISTANT_MAIN_NAMESPACE, 'listDisplays')
  }

  prepareDesktopScreenshot(sourceId: string) {
    return this._context.ipc.call<{
      token: string
      previewDataUrl: string
      width: number
      height: number
    }>(ARAM_ASSISTANT_MAIN_NAMESPACE, 'prepareDesktopScreenshot', sourceId)
  }

  chooseImageFile() {
    return this._context.ipc.call<{
      token: string
      previewDataUrl: string
      width: number
      height: number
    } | null>(ARAM_ASSISTANT_MAIN_NAMESPACE, 'chooseImageFile')
  }

  discardScreenshot(token: string) {
    return this._context.ipc.call(ARAM_ASSISTANT_MAIN_NAMESPACE, 'discardScreenshot', token)
  }

  updateCatalog() {
    return this._context.ipc.call(ARAM_ASSISTANT_MAIN_NAMESPACE, 'updateCatalog')
  }

  analyze(input: AramAnalysisInput) {
    return this._context.ipc.call(ARAM_ASSISTANT_MAIN_NAMESPACE, 'analyze', input)
  }

  probeVisionProvider() {
    return this._context.ipc.call<AramVisionProbeResult>(
      ARAM_ASSISTANT_MAIN_NAMESPACE,
      'probeVisionProvider'
    )
  }

  cancelAnalysis() {
    return this._context.ipc.call(ARAM_ASSISTANT_MAIN_NAMESPACE, 'cancelAnalysis')
  }

  confirmAugment(cardId: string) {
    return this._context.ipc.call(ARAM_ASSISTANT_MAIN_NAMESPACE, 'confirmAugment', cardId)
  }

  undoConfirmedAugment() {
    return this._context.ipc.call(ARAM_ASSISTANT_MAIN_NAMESPACE, 'undoConfirmedAugment')
  }

  async onInit() {
    const store = useAramAssistantStore()
    await this._context.piniaMobxUtils.sync(
      ARAM_ASSISTANT_MAIN_NAMESPACE,
      'settings',
      store.settings
    )
    await this._context.piniaMobxUtils.sync(ARAM_ASSISTANT_MAIN_NAMESPACE, 'state', store.state)
  }

  async onDispose() {}
}
