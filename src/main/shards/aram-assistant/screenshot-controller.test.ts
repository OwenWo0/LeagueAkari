import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ProviderError } from './provider'
import { AramScreenshotController } from './screenshot-controller'

const electron = vi.hoisted(() => ({
  desktopCapturer: { getSources: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn() },
  systemPreferences: { getMediaAccessStatus: vi.fn((): string => 'granted') }
}))

vi.mock('electron', () => electron)

const folders: string[] = []
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')

beforeEach(() => {
  electron.systemPreferences.getMediaAccessStatus.mockReturnValue('granted')
})

afterEach(async () => {
  vi.restoreAllMocks()
  if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform)
  await Promise.all(
    folders.splice(0).map((folder) => fs.rm(folder, { recursive: true, force: true }))
  )
})

describe('AramScreenshotController', () => {
  it('keeps only the newest image preview and clears it on discard', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'akari-aram-screenshot-'))
    folders.push(folder)
    const firstPath = path.join(folder, 'first.png')
    const secondPath = path.join(folder, 'second.png')
    await fs.writeFile(firstPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    await fs.writeFile(secondPath, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    electron.dialog.showOpenDialog
      .mockResolvedValueOnce({ canceled: false, filePaths: [firstPath] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [secondPath] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [secondPath] })
    electron.nativeImage.createFromBuffer.mockReturnValue({
      isEmpty: () => false,
      getSize: () => ({ width: 1, height: 1 }),
      resize: () => ({ toJPEG: () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]) })
    })
    const controller = new AramScreenshotController(createWindowManager())

    const first = await controller.chooseImageFile()
    const second = await controller.chooseImageFile()
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(() => controller.consume(first!.token)).toThrowError(ProviderError)
    expect(controller.consume(second!.token).mimeType).toBe('image/jpeg')

    const third = await controller.chooseImageFile()
    controller.clear()
    expect(() => controller.consume(third!.token)).toThrowError(ProviderError)
  })

  it('returns a typed macOS permission error when screen permission has not been decided', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    electron.systemPreferences.getMediaAccessStatus.mockReturnValue('not-determined')
    const controller = new AramScreenshotController(createWindowManager())

    await expect(controller.listDisplays()).rejects.toMatchObject({
      name: 'ProviderError',
      code: 'SCREEN_PERMISSION_REQUIRED'
    })
    expect(electron.desktopCapturer.getSources).not.toHaveBeenCalled()
  })

  it('hides visible tools inside the capture try block and restores only surviving windows', async () => {
    const mainWindow = createManagedWindow({
      isDestroyed: vi.fn(() => false),
      isVisible: vi.fn(() => true)
    })
    const closingWindow = createManagedWindow({
      isDestroyed: vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true),
      isVisible: vi.fn(() => true)
    })
    electron.desktopCapturer.getSources.mockRejectedValueOnce(new Error('capture denied'))
    const controller = new AramScreenshotController({
      mainWindow,
      auxWindow: closingWindow,
      opggWindow: { window: null },
      ongoingGameWindow: { window: null },
      cdTimerWindow: { window: null }
    } as never)

    await expect(controller.prepareDesktopScreenshot('screen:0')).rejects.toMatchObject({
      code: 'SCREEN_CAPTURE_FAILED'
    })
    expect(mainWindow.hide).toHaveBeenCalledTimes(1)
    expect(mainWindow.show).toHaveBeenCalledWith(true)
    expect(closingWindow.hide).toHaveBeenCalledTimes(1)
    expect(closingWindow.show).not.toHaveBeenCalled()
  })
})

function createWindowManager() {
  const managedWindow = { window: null, hide: vi.fn(), show: vi.fn() }
  return {
    mainWindow: managedWindow,
    auxWindow: managedWindow,
    opggWindow: managedWindow,
    ongoingGameWindow: managedWindow,
    cdTimerWindow: managedWindow
  } as never
}

function createManagedWindow(native: { isDestroyed: () => boolean; isVisible: () => boolean }) {
  return { window: native, hide: vi.fn(), show: vi.fn() }
}
