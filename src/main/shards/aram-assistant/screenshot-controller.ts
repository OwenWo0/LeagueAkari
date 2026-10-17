import { desktopCapturer, dialog, nativeImage, systemPreferences } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'

import type { WindowManagerMain } from '../window-manager'
import { ProviderError, type ProviderImage } from './provider'

const MAX_INPUT_BYTES = 8 * 1024 * 1024
const MAX_PREVIEW_AGE_MS = 10 * 60 * 1000

interface PreparedScreenshot extends ProviderImage {
  token: string
  previewDataUrl: string
  width: number
  height: number
}

interface StoredPreview {
  image: ProviderImage
  createdAt: number
}

export class AramScreenshotController {
  private readonly _previews = new Map<string, StoredPreview>()

  constructor(private readonly _windows: WindowManagerMain) {}

  async listDisplays() {
    this._assertScreenPermission()
    const sources = await this._getScreenSources({ width: 1, height: 1 })
    return sources.map((source, index) => ({
      sourceId: source.id,
      name: cleanLabel(source.name) || `Display ${index + 1}`,
      displayId: source.display_id || null
    }))
  }

  async prepareDesktopScreenshot(sourceId: string): Promise<PreparedScreenshot> {
    this.clear()
    if (typeof sourceId !== 'string' || sourceId.length > 512 || !sourceId.startsWith('screen:')) {
      throw new ProviderError('INVALID_IMAGE', 'Choose a valid display.')
    }
    this._assertScreenPermission()
    return this._withToolWindowsHidden(async () => {
      const sources = await this._getScreenSources({ width: 1920, height: 1920 })
      const source = sources.find((entry) => entry.id === sourceId)
      if (!source || source.thumbnail.isEmpty()) {
        throw new ProviderError('INVALID_IMAGE', 'The selected display could not be captured.')
      }
      return this._prepare(source.thumbnail.toPNG())
    })
  }

  async chooseImageFile(): Promise<PreparedScreenshot | null> {
    this.clear()
    const window = this._windows.mainWindow.window
    const options: Electron.OpenDialogOptions = {
      title: 'Choose an ARAM screenshot',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }]
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    const filePath = result.filePaths[0]
    if (result.canceled || !filePath) return null
    const stat = await fs.stat(filePath)
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_INPUT_BYTES) {
      throw new ProviderError('IMAGE_TOO_LARGE', 'Choose a PNG or JPEG image up to 8 MB.')
    }
    const bytes = await fs.readFile(filePath)
    return this._prepare(bytes)
  }

  consume(token: string): ProviderImage {
    const preview = this._getPreview(token)
    this._previews.delete(token)
    return preview.image
  }

  discard(token: string): void {
    if (typeof token === 'string') this._previews.delete(token)
  }

  clear(): void {
    this._previews.clear()
  }

  private _prepare(input: Buffer): PreparedScreenshot {
    if (input.length > MAX_INPUT_BYTES) {
      throw new ProviderError('IMAGE_TOO_LARGE', 'Choose an image up to 8 MB.')
    }
    const inputMime = detectMime(input)
    if (!inputMime) throw new ProviderError('INVALID_IMAGE', 'Image content must be PNG or JPEG.')
    const decoded = nativeImage.createFromBuffer(input)
    if (decoded.isEmpty())
      throw new ProviderError('INVALID_IMAGE', 'The image could not be decoded.')
    const sourceSize = decoded.getSize()
    if (sourceSize.width <= 0 || sourceSize.height <= 0) {
      throw new ProviderError('INVALID_IMAGE', 'The image dimensions are invalid.')
    }
    const scale = Math.min(1, 1280 / Math.max(sourceSize.width, sourceSize.height))
    const width = Math.max(1, Math.round(sourceSize.width * scale))
    const height = Math.max(1, Math.round(sourceSize.height * scale))
    const jpeg = decoded.resize({ width, height, quality: 'good' }).toJPEG(86)
    if (!jpeg.length || jpeg.length > 4 * 1024 * 1024) {
      throw new ProviderError('IMAGE_TOO_LARGE', 'Prepared screenshot exceeds 4 MB.')
    }
    const image: ProviderImage = { bytes: jpeg, mimeType: 'image/jpeg' }
    const token = crypto.randomUUID()
    this.clear()
    this._previews.set(token, { image, createdAt: Date.now() })
    return {
      ...image,
      token,
      previewDataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
      width,
      height
    }
  }

  private _getPreview(token: string) {
    if (typeof token !== 'string' || token.length > 64) {
      throw new ProviderError('INVALID_INPUT', 'Screenshot preview expired.')
    }
    const preview = this._previews.get(token)
    if (!preview || Date.now() - preview.createdAt > MAX_PREVIEW_AGE_MS) {
      this._previews.delete(token)
      throw new ProviderError('INVALID_INPUT', 'Screenshot preview expired.')
    }
    return preview
  }

  private _assertScreenPermission() {
    if (process.platform !== 'darwin') return
    let status: ReturnType<typeof systemPreferences.getMediaAccessStatus>
    try {
      status = systemPreferences.getMediaAccessStatus('screen')
    } catch {
      throw new ProviderError(
        'SCREEN_CAPTURE_FAILED',
        'macOS screen recording permission status could not be checked.'
      )
    }
    if (status === 'denied') {
      throw new ProviderError(
        'SCREEN_PERMISSION_DENIED',
        'Allow League Akari to record the screen in macOS Privacy & Security settings.'
      )
    }
    if (status === 'restricted') {
      throw new ProviderError(
        'SCREEN_PERMISSION_RESTRICTED',
        'Screen recording is restricted by macOS.'
      )
    }
    if (status === 'not-determined') {
      throw new ProviderError(
        'SCREEN_PERMISSION_REQUIRED',
        'Allow screen recording for League Akari in macOS Privacy & Security settings, then try again.'
      )
    }
  }

  private async _getScreenSources(thumbnailSize: Electron.Size) {
    try {
      return await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize,
        fetchWindowIcons: false
      })
    } catch {
      throw new ProviderError(
        'SCREEN_CAPTURE_FAILED',
        'macOS screen recording permission or capture failed.'
      )
    }
  }

  private async _withToolWindowsHidden<T>(work: () => Promise<T>): Promise<T> {
    const windows = [
      this._windows.mainWindow,
      this._windows.auxWindow,
      this._windows.opggWindow,
      this._windows.ongoingGameWindow,
      this._windows.cdTimerWindow
    ]
    const visible = windows.flatMap((managed) => {
      const native = managed.window
      return native && !native.isDestroyed() && native.isVisible() ? [{ managed, native }] : []
    })
    try {
      visible.forEach(({ managed }) => managed.hide())
      await new Promise((resolve) => setTimeout(resolve, 120))
      return await work()
    } finally {
      visible.forEach(({ managed, native }) => {
        try {
          if (managed.window === native && !native.isDestroyed()) managed.show(true)
        } catch {
          // A window may close while the screen capture is being prepared.
        }
      })
    }
  }
}

function detectMime(bytes: Uint8Array): ProviderImage['mimeType'] | null {
  if (
    bytes.byteLength >= 8 &&
    Buffer.from(bytes)
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return 'image/png'
  }
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  return null
}

function cleanLabel(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120)
}
