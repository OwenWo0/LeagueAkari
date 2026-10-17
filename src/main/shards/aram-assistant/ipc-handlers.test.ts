import { describe, expect, it, vi } from 'vitest'

import { ARAM_ASSISTANT_MAIN_NAMESPACE } from './context'
import { AramAssistantIpcHandlers } from './ipc-handlers'

describe('ARAM assistant IPC frame guard', () => {
  it('allows only the main window main frame to call assistant handlers', () => {
    const callbacks = new Map<string, (...args: any[]) => unknown>()
    const ipc = {
      onCall: vi.fn((namespace: string, name: string, callback: (...args: any[]) => unknown) => {
        callbacks.set(`${namespace}:${name}`, callback)
      })
    }
    const subFrame = {}
    const mainFrame = {}
    const webContents = { mainFrame }
    const controller = { getCatalog: vi.fn(() => ({ cardCount: 216 })) }
    const handlers = new AramAssistantIpcHandlers(
      ipc as never,
      { mainWindow: { window: { webContents } } } as never,
      controller as never
    )
    handlers.register()
    const getCatalog = callbacks.get(`${ARAM_ASSISTANT_MAIN_NAMESPACE}:getCatalog`)
    if (!getCatalog) throw new Error('Handler was not registered.')

    expect(getCatalog({ sender: webContents, senderFrame: mainFrame })).toEqual({ cardCount: 216 })
    expect(() => getCatalog({ sender: webContents, senderFrame: subFrame })).toThrow(
      'ARAM_ASSISTANT_UNAUTHORIZED'
    )
    expect(() => getCatalog({ sender: {}, senderFrame: mainFrame })).toThrow(
      'ARAM_ASSISTANT_UNAUTHORIZED'
    )
    expect(controller.getCatalog).toHaveBeenCalledTimes(1)
  })
})
