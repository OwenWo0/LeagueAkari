import catalogAssetPath from '@resources/aram-assistant/augment-catalog.json?asset&asarUnpack'
import ocrDetPath from '@resources/aram-assistant/ocr/det.onnx?asset&asarUnpack'
import ocrDictPath from '@resources/aram-assistant/ocr/dict.txt?asset&asarUnpack'
import ocrRecPath from '@resources/aram-assistant/ocr/rec.onnx?asset&asarUnpack'
import probeAPath from '@resources/aram-assistant/probe/probe-a.jpg?asset&asarUnpack'
import probeBPath from '@resources/aram-assistant/probe/probe-b.jpg?asset&asarUnpack'
import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import type { ChampionDataSourceId } from '@shared/data-adapter/champion-data'
import { app } from 'electron'
import { z } from 'zod'

import { ChampionDataMain } from '../champion-data'
import { AkariIpcMain } from '../ipc'
import { LeagueClientMain } from '../league-client'
import { type AkariLogger, LoggerFactoryMain } from '../logger-factory'
import { MobxUtilsMain } from '../mobx-utils'
import { NetworkMain } from '../network'
import { SettingFactoryMain } from '../setting-factory'
import { type SetterSettingService } from '../setting-factory/setter-setting-service'
import { WindowManagerMain } from '../window-manager'
import { AramAssistantController } from './assistant-controller'
import { ARAM_ASSISTANT_MAIN_NAMESPACE, type AramAssistantMainContext } from './context'
import { AramAssistantIpcHandlers } from './ipc-handlers'
import { type ProviderProtocol, normalizeBaseUrl } from './provider'
import { AramAssistantSettings, AramAssistantState, type AramProviderPreference } from './state'

function providerPreferenceSchema(protocol: ProviderProtocol) {
  return z.object({
    baseUrl: z
      .string()
      .max(2048)
      .transform((value) => normalizeBaseUrl(protocol, value)),
    model: z.string().trim().min(1).max(256)
  })
}

@Shard(AramAssistantMain.id)
export class AramAssistantMain implements IAkariShardInitDispose {
  static id = ARAM_ASSISTANT_MAIN_NAMESPACE

  readonly settings = new AramAssistantSettings()
  readonly state = new AramAssistantState()

  private readonly _settingService: SetterSettingService<AramAssistantSettings>
  private readonly _logger: AkariLogger
  private readonly _controller: AramAssistantController
  private readonly _ipcHandlers: AramAssistantIpcHandlers

  constructor(
    private readonly _ipc: AkariIpcMain,
    private readonly _mobxUtils: MobxUtilsMain,
    private readonly _leagueClient: LeagueClientMain,
    private readonly _network: NetworkMain,
    private readonly _championData: ChampionDataMain,
    private readonly _windowManager: WindowManagerMain,
    settingFactory: SettingFactoryMain,
    loggerFactory: LoggerFactoryMain
  ) {
    this._logger = loggerFactory.create(AramAssistantMain.id)
    this._settingService = settingFactory.register<AramAssistantSettings>(
      AramAssistantMain.id,
      {
        activeProvider: {
          default: this.settings.activeProvider,
          schema: z.enum(['gemini', 'openai'])
        },
        providers: {
          default: this.settings.providers,
          schema: z.object({
            gemini: providerPreferenceSchema('gemini'),
            openai: providerPreferenceSchema('openai')
          })
        },
        automaticGuide: { default: this.settings.automaticGuide, schema: z.boolean() },
        automaticAugmentCapture: {
          default: this.settings.automaticAugmentCapture,
          schema: z.boolean()
        },
        automaticContext: { default: this.settings.automaticContext, schema: z.boolean() },
        requestTimeoutMs: {
          default: this.settings.requestTimeoutMs,
          schema: z.number().int().min(5_000).max(120_000)
        },
        statsSource: { default: this.settings.statsSource, schema: z.enum(['opgg', 'qq101']) }
      },
      this.settings
    )
    const context: AramAssistantMainContext = {
      mobxUtils: this._mobxUtils,
      leagueClient: this._leagueClient,
      network: this._network,
      championData: this._championData,
      windowManager: this._windowManager,
      settingService: this._settingService,
      settings: this.settings,
      state: this.state,
      logger: this._logger,
      bundledCatalogPath: catalogAssetPath,
      bundledProbeImagePaths: [
        { id: 'probe-a', path: probeAPath },
        { id: 'probe-b', path: probeBPath }
      ],
      bundledOcrPaths: {
        detPath: ocrDetPath,
        recPath: ocrRecPath,
        dictPath: ocrDictPath
      },
      userDataPath: app.getPath('userData')
    }
    this._controller = new AramAssistantController(context)
    this._ipcHandlers = new AramAssistantIpcHandlers(
      this._ipc,
      this._windowManager,
      this._controller
    )
  }

  async onInit() {
    await this._settingService.applyToState()
    this._mobxUtils.propSync(AramAssistantMain.id, 'settings', this.settings, [
      'activeProvider',
      'providers',
      'automaticGuide',
      'automaticAugmentCapture',
      'automaticContext',
      'requestTimeoutMs',
      'statsSource'
    ])
    this._mobxUtils.propSync(AramAssistantMain.id, 'state', this.state, [
      'matchContext',
      'history',
      'active',
      'lastErrorCode',
      'manualChampionOverrideId',
      'matchGeneration',
      'catalogSource',
      'catalogFallbackCode',
      'credentialStatus',
      'latestResult'
    ])
    await this._controller.initialize()
    this._ipcHandlers.register()
  }

  async onDispose() {
    this._controller.dispose()
  }
}

export type { AramProviderPreference, ChampionDataSourceId }
