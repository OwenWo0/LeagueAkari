import type {
  AramCardBoundingBox,
  AugmentCatalog,
  AugmentCatalogEntry
} from '@shared/types/aram-assistant'
import fs from 'node:fs'
import { PaddleOcrService } from 'ppu-paddle-ocr'

import type { AkariLogger } from '../logger-factory'
import { matchCardFromCatalog } from './catalog-loader'

export interface CardWithBoundingBox {
  card: AugmentCatalogEntry
  box?: AramCardBoundingBox
  confidence: number
}

export interface LocalOcrExecutorOptions {
  detPath: string
  recPath: string
  dictPath: string
  logger: AkariLogger
}

export class LocalOcrExecutor {
  private _service: PaddleOcrService | null = null
  private _initPromise: Promise<void> | null = null

  constructor(private readonly _options: LocalOcrExecutorOptions) {}

  async initialize(): Promise<void> {
    if (this._service) return
    if (this._initPromise) return this._initPromise

    this._initPromise = (async () => {
      try {
        if (
          !this._options.detPath ||
          !this._options.recPath ||
          !this._options.dictPath ||
          !fs.existsSync(this._options.detPath) ||
          !fs.existsSync(this._options.recPath) ||
          !fs.existsSync(this._options.dictPath)
        ) {
          this._options.logger.warn(
            'Local OCR model files not found on disk; skipping ONNX initialization'
          )
          return
        }

        const executionProviders = process.platform === 'win32' ? ['directml', 'cpu'] : ['cpu']

        this._service = new PaddleOcrService({
          model: {
            detection: this._options.detPath,
            recognition: this._options.recPath,
            charactersDictionary: this._options.dictPath
          },
          session: {
            executionProviders
          }
        })
        await this._service.initialize()
        this._options.logger.info('Local ONNX OCR engine initialized successfully')
      } catch (err) {
        this._options.logger.warn('Failed to initialize local ONNX OCR engine', err)
        this._service = null
        throw err
      } finally {
        this._initPromise = null
      }
    })()

    return this._initPromise
  }

  async recognizeCandidates(
    imageBytes: Uint8Array,
    catalog: AugmentCatalog
  ): Promise<CardWithBoundingBox[]> {
    try {
      if (!this._service) {
        await this.initialize()
      }
      if (!this._service) {
        return []
      }

      const arrayBuffer = imageBytes.buffer.slice(
        imageBytes.byteOffset,
        imageBytes.byteOffset + imageBytes.byteLength
      )

      const result = await this._service.recognize(arrayBuffer as ArrayBuffer)
      if (!result || !Array.isArray(result.lines)) {
        return []
      }

      const matchedCards: CardWithBoundingBox[] = []
      const seenCardIds = new Set<string>()

      for (const line of result.lines) {
        if (!Array.isArray(line)) continue
        for (const item of line) {
          const text = item.text?.trim()
          if (!text || text.length < 2) continue

          const matched = matchCardFromCatalog(text, catalog)
          if (matched && !seenCardIds.has(matched.id)) {
            seenCardIds.add(matched.id)
            matchedCards.push({
              card: matched,
              box: item.box
                ? {
                    x: Math.round(item.box.x),
                    y: Math.round(item.box.y),
                    width: Math.round(item.box.width),
                    height: Math.round(item.box.height)
                  }
                : undefined,
              confidence: item.confidence ?? 1
            })
          }
        }
      }

      return matchedCards
    } catch (err) {
      this._options.logger.warn('Local ONNX OCR recognition failed', err)
      return []
    }
  }

  async dispose(): Promise<void> {
    if (this._service) {
      try {
        await this._service.destroy()
      } catch {
        // ignore cleanup errors
      }
      this._service = null
    }
  }
}
