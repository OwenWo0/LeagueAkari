import type { ChampionDataMain } from '../champion-data'
import type { LeagueClientMain } from '../league-client'
import type { AkariLogger } from '../logger-factory'
import type { MobxUtilsMain } from '../mobx-utils'
import type { NetworkMain } from '../network'
import type { SetterSettingService } from '../setting-factory/setter-setting-service'
import type { WindowManagerMain } from '../window-manager'
import type { AramAssistantSettings, AramAssistantState } from './state'

export const ARAM_ASSISTANT_MAIN_NAMESPACE = 'aram-assistant-main'

export interface AramAssistantMainContext {
  mobxUtils: MobxUtilsMain
  leagueClient: LeagueClientMain
  network: NetworkMain
  championData: ChampionDataMain
  windowManager: WindowManagerMain
  settingService: SetterSettingService<AramAssistantSettings>
  settings: AramAssistantSettings
  state: AramAssistantState
  logger: AkariLogger
  bundledCatalogPath: string
  bundledProbeImagePaths: ReadonlyArray<{ id: 'probe-a' | 'probe-b'; path: string }>
  userDataPath: string
}
