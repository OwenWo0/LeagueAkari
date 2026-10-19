import type { AugmentCatalog, AugmentCatalogEntry } from '@shared/types/aram-assistant'
import { describe, expect, it, vi } from 'vitest'

import { LocalOcrExecutor } from './local-ocr-executor'

function createMockCatalog(): AugmentCatalog {
  const cards: AugmentCatalogEntry[] = [
    {
      id: 'adapt',
      slug: 'adapt',
      name: { zh: '物理转魔法', en: 'ADAPt' },
      effect: { zh: '造成物理伤害转为魔法伤害', en: 'Converts physical damage to magic damage' },
      tier: { zh: '黄金', en: 'Gold' },
      rarity: 'gold',
      kind: 'standard',
      scope: 'aram',
      textStatus: 'verified',
      tags: ['damage'],
      currentPatchChange: 'unchanged',
      sourceUrl: null
    },
    {
      id: 'all-for-you',
      slug: 'all-for-you',
      name: { zh: '全心为你', en: 'All For You' },
      effect: { zh: '治疗效果提升', en: 'Increased healing' },
      tier: { zh: '黄金', en: 'Gold' },
      rarity: 'gold',
      kind: 'standard',
      scope: 'aram',
      textStatus: 'verified',
      tags: ['support'],
      currentPatchChange: 'unchanged',
      sourceUrl: null
    }
  ]

  return {
    schemaVersion: 1,
    sourceSchemaVersion: 1,
    mode: 'aram-mayhem',
    sourceName: 'Test',
    sourceUrl: 'https://test',
    sourcePageUrl: 'https://test',
    fetchedAt: '2026-01-01',
    sourcePatch: '15.1',
    patchVerified: false,
    rawSha256: 'mock',
    sourceBatchSize: null,
    licenseStatus: 'ok',
    remoteIconsOmitted: true,
    cardCount: cards.length,
    entries: cards
  }
}

describe('LocalOcrExecutor', () => {
  it('returns empty array when model files do not exist', async () => {
    const logger = { warn: vi.fn(), info: vi.fn() } as any
    const executor = new LocalOcrExecutor({
      detPath: '/non/existent/det.onnx',
      recPath: '/non/existent/rec.onnx',
      dictPath: '/non/existent/dict.txt',
      logger
    })

    const catalog = createMockCatalog()
    const result = await executor.recognizeCandidates(new Uint8Array([1, 2, 3]), catalog)
    expect(result).toEqual([])
    expect(logger.warn).toHaveBeenCalled()
    await executor.dispose()
  })

  it('matches recognized text lines against catalog with bounding boxes', async () => {
    const logger = { warn: vi.fn(), info: vi.fn() } as any
    const executor = new LocalOcrExecutor({
      detPath: '',
      recPath: '',
      dictPath: '',
      logger
    })

    // Mock internal service
    const mockService = {
      recognize: vi.fn().mockResolvedValue({
        text: '物理转魔法 全心为你',
        lines: [
          [
            {
              text: '物理转魔法',
              box: { x: 100, y: 200, width: 150, height: 40 },
              confidence: 0.98
            },
            {
              text: '全心为你',
              box: { x: 400, y: 200, width: 140, height: 40 },
              confidence: 0.99
            }
          ]
        ]
      }),
      destroy: vi.fn().mockResolvedValue(undefined)
    }

    ;(executor as any)._service = mockService

    const catalog = createMockCatalog()
    const candidates = await executor.recognizeCandidates(new Uint8Array([1, 2, 3]), catalog)

    expect(candidates).toHaveLength(2)
    expect(candidates[0].card.id).toBe('adapt')
    expect(candidates[0].box).toEqual({ x: 100, y: 200, width: 150, height: 40 })
    expect(candidates[1].card.id).toBe('all-for-you')
    expect(candidates[1].box).toEqual({ x: 400, y: 200, width: 140, height: 40 })

    await executor.dispose()
    expect(mockService.destroy).toHaveBeenCalled()
  })
})
