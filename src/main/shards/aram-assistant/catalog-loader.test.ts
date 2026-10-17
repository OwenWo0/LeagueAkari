import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  assertUpdateAllowed,
  fetchCatalog,
  loadCatalog,
  readCatalogFile,
  recommendationCandidates,
  writeCatalogAtomically
} from './catalog-loader'

describe('ARAM catalog loader', () => {
  it('loads the verified offline snapshot and keeps dynamic and special records out of suggestions', async () => {
    const catalog = await readCatalogFile(
      path.resolve('resources/aram-assistant/augment-catalog.json')
    )

    expect(catalog).toMatchObject({
      cardCount: 216,
      sourcePatch: '26.20',
      rawSha256: 'aac125ef54cf23e47967a5884b9ca710590287f3117587adaa64cdf3d0984987',
      patchVerified: false,
      remoteIconsOmitted: true
    })
    expect(catalog.entries.filter((entry) => entry.textStatus === 'dynamic')).toHaveLength(36)
    expect(catalog.entries.filter((entry) => entry.kind === 'special')).toHaveLength(4)
    expect(recommendationCandidates(catalog).length).toBeLessThan(catalog.cardCount)
  })

  it('rejects patch rollback and same-patch losses over twenty percent', async () => {
    const current = await readCatalogFile(
      path.resolve('resources/aram-assistant/augment-catalog.json')
    )
    const older = { ...current, sourcePatch: '26.19' }
    const suddenDropEntries = current.entries.slice(0, 172)
    const suddenDrop = {
      ...current,
      entries: suddenDropEntries,
      cardCount: suddenDropEntries.length
    }

    expect(() => assertUpdateAllowed(current, older)).toThrowError()
    expect(() => assertUpdateAllowed(current, suddenDrop)).toThrowError()
  })

  it('loads a saved overlay, then falls back to bundled data when the overlay is damaged', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'akari-aram-catalog-'))
    const bundledPath = path.resolve('resources/aram-assistant/augment-catalog.json')
    const overlayPath = path.join(folder, 'catalog-overlay.json')
    const bundled = await readCatalogFile(bundledPath)
    try {
      expect(await loadCatalog({ bundledPath, overlayPath })).toEqual({
        catalog: bundled,
        source: 'bundled'
      })

      await writeCatalogAtomically(overlayPath, bundled, bundled)
      expect(await loadCatalog({ bundledPath, overlayPath })).toMatchObject({
        source: 'user',
        catalog: { cardCount: 216 }
      })
      await fs.writeFile(overlayPath, '{')
      expect(await loadCatalog({ bundledPath, overlayPath })).toMatchObject({
        source: 'bundled',
        fallbackCode: 'INVALID_JSON',
        catalog: { cardCount: 216 }
      })
    } finally {
      await fs.rm(folder, { recursive: true, force: true })
    }
  })

  it('preserves an existing overlay when atomic replacement fails', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'akari-aram-catalog-write-'))
    const overlayPath = path.join(folder, 'catalog-overlay.json')
    const current = await readCatalogFile(
      path.resolve('resources/aram-assistant/augment-catalog.json')
    )
    try {
      await writeCatalogAtomically(overlayPath, current, current)
      vi.spyOn(fs, 'rename').mockRejectedValue(new Error('fixture rename failure'))

      await expect(writeCatalogAtomically(overlayPath, current, current)).rejects.toMatchObject({
        code: 'ATOMIC_WRITE_FAILED'
      })
      expect((await readCatalogFile(overlayPath)).rawSha256).toBe(current.rawSha256)
    } finally {
      vi.restoreAllMocks()
      await fs.rm(folder, { recursive: true, force: true })
    }
  })

  it('cancels an HTTP error body before its one retry', async () => {
    const catalog = await readCatalogFile(
      path.resolve('resources/aram-assistant/augment-catalog.json')
    )
    const source = {
      schemaVersion: 1,
      riotPatch: catalog.sourcePatch,
      batchSize: catalog.sourceBatchSize,
      entries: catalog.entries.map((entry) => ({
        slug: entry.slug,
        name: entry.name,
        effect: entry.effect,
        rarityLabel: entry.tier,
        rarity: entry.rarity,
        kind: entry.kind,
        scope: entry.scope,
        textStatus: entry.textStatus,
        tags: entry.tags,
        currentPatchChange: entry.currentPatchChange,
        sourceUrl: entry.sourceUrl
      }))
    }
    let cancelled = false
    const fetchImpl = vi
      .fn(
        async (_url: string, _init: RequestInit & { redirect: 'error' }) =>
          new Response(JSON.stringify(source), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          })
      )
      .mockImplementationOnce(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{"error":"fixture"}'))
              },
              cancel() {
                cancelled = true
              }
            }),
            { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '0' } }
          )
      )

    const result = await fetchCatalog({ fetchImpl })

    expect(cancelled).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: 'error' })
    expect(result.cardCount).toBe(216)
  })
})
