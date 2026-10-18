import type { AkariIpcMain } from '../ipc'
import type { WindowManagerMain } from '../window-manager'
import type { AramAnalysisInput, AramAssistantController } from './assistant-controller'
import type { CatalogSearchOptions } from './catalog-loader'
import { ARAM_ASSISTANT_MAIN_NAMESPACE } from './context'
import type { ProviderProtocol } from './provider'

export class AramAssistantIpcHandlers {
  constructor(
    private readonly _ipc: AkariIpcMain,
    private readonly _windows: WindowManagerMain,
    private readonly _controller: AramAssistantController
  ) {}

  register() {
    const namespace = ARAM_ASSISTANT_MAIN_NAMESPACE
    this._ipc.onCall(namespace, 'getCatalog', (event) => {
      this._assertMainFrame(event)
      return this._controller.getCatalog()
    })
    this._ipc.onCall(namespace, 'searchCards', (event, options: CatalogSearchOptions) => {
      this._assertMainFrame(event)
      return this._controller.searchCards(options)
    })
    this._ipc.onCall(namespace, 'getChampionChoices', (event) => {
      this._assertMainFrame(event)
      return this._controller.getChampionChoices()
    })
    this._ipc.onCall(namespace, 'getManualChampionOverride', (event) => {
      this._assertMainFrame(event)
      return this._controller.getManualChampionOverride()
    })
    this._ipc.onCall(namespace, 'setManualChampionOverride', (event, championId: number | null) => {
      this._assertMainFrame(event)
      return this._controller.setManualChampionOverride(championId)
    })
    this._ipc.onCall(
      namespace,
      'setProviderSettings',
      (event, protocol: ProviderProtocol, settings) => {
        this._assertMainFrame(event)
        return this._controller.setProviderSettings(protocol, settings)
      }
    )
    this._ipc.onCall(namespace, 'setActiveProvider', (event, protocol: ProviderProtocol) => {
      this._assertMainFrame(event)
      return this._controller.setActiveProvider(protocol)
    })
    this._ipc.onCall(
      namespace,
      'setCredential',
      (event, protocol: ProviderProtocol, key: string) => {
        this._assertMainFrame(event)
        return this._controller.setCredential(protocol, key)
      }
    )
    this._ipc.onCall(namespace, 'refreshCredentialStatuses', (event) => {
      this._assertMainFrame(event)
      return this._controller.refreshCredentialStatuses()
    })
    this._ipc.onCall(namespace, 'setAutomaticGuide', (event, enabled: boolean) => {
      this._assertMainFrame(event)
      return this._controller.setAutomaticGuide(enabled)
    })
    this._ipc.onCall(namespace, 'setAutomaticAugmentCapture', (event, enabled: boolean) => {
      this._assertMainFrame(event)
      return this._controller.setAutomaticAugmentCapture(enabled)
    })
    this._ipc.onCall(namespace, 'setAutomaticContext', (event, enabled: boolean) => {
      this._assertMainFrame(event)
      return this._controller.setAutomaticContext(enabled)
    })
    this._ipc.onCall(namespace, 'setRequestTimeout', (event, timeoutMs: number) => {
      this._assertMainFrame(event)
      return this._controller.setRequestTimeout(timeoutMs)
    })
    this._ipc.onCall(namespace, 'setStatsSource', (event, source) => {
      this._assertMainFrame(event)
      return this._controller.setStatsSource(source)
    })
    this._ipc.onCall(namespace, 'listDisplays', (event) => {
      this._assertMainFrame(event)
      return this._controller.listDisplays()
    })
    this._ipc.onCall(namespace, 'prepareDesktopScreenshot', (event, sourceId: string) => {
      this._assertMainFrame(event)
      return this._controller.prepareDesktopScreenshot(sourceId)
    })
    this._ipc.onCall(namespace, 'chooseImageFile', (event) => {
      this._assertMainFrame(event)
      return this._controller.chooseImageFile()
    })
    this._ipc.onCall(namespace, 'discardScreenshot', (event, token: string) => {
      this._assertMainFrame(event)
      return this._controller.discardScreenshot(token)
    })
    this._ipc.onCall(namespace, 'updateCatalog', (event) => {
      this._assertMainFrame(event)
      return this._controller.updateCatalog()
    })
    this._ipc.onCall(namespace, 'analyze', (event, input: AramAnalysisInput) => {
      this._assertMainFrame(event)
      return this._controller.analyze(input)
    })
    this._ipc.onCall(namespace, 'probeVisionProvider', (event) => {
      this._assertMainFrame(event)
      return this._controller.probeVisionProvider()
    })
    this._ipc.onCall(namespace, 'cancelAnalysis', (event) => {
      this._assertMainFrame(event)
      return this._controller.cancelAnalysis()
    })
    this._ipc.onCall(namespace, 'confirmAugment', (event, cardId: string) => {
      this._assertMainFrame(event)
      return this._controller.confirmAugment(cardId)
    })
    this._ipc.onCall(namespace, 'undoConfirmedAugment', (event) => {
      this._assertMainFrame(event)
      return this._controller.undoConfirmedAugment()
    })
  }

  private _assertMainFrame(event: Electron.IpcMainInvokeEvent) {
    const contents = this._windows.mainWindow.window?.webContents
    if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) {
      throw new Error('ARAM_ASSISTANT_UNAUTHORIZED')
    }
  }
}
