import type { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import type { PiniaMobxUtilsRenderer } from '@renderer-shared/shards/pinia-mobx-utils'

export const ARAM_ASSISTANT_MAIN_NAMESPACE = 'aram-assistant-main'

export interface AramAssistantRendererContext {
  ipc: AkariIpcRenderer
  piniaMobxUtils: PiniaMobxUtilsRenderer
}
