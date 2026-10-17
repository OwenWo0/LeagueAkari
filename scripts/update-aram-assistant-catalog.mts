import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertUpdateAllowed,
  fetchCatalog,
  readCatalogFile,
  writeCatalogAtomically
} from '../src/main/shards/aram-assistant/catalog-loader.ts'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')
const catalogPath = path.join(repositoryRoot, 'resources/aram-assistant/augment-catalog.json')

if (process.argv.includes('--help')) {
  console.log('Fetch and atomically replace the bundled ARAM Mayhem augment catalog.')
  console.log('Run with: yarn update:aram-catalog')
} else {
  const currentCatalog = await readCatalogFile(catalogPath)
  const nextCatalog = await fetchCatalog()
  assertUpdateAllowed(currentCatalog, nextCatalog)
  await writeCatalogAtomically(catalogPath, nextCatalog, currentCatalog)
  console.log(
    `Updated ARAM Mayhem catalog to source patch ${nextCatalog.sourcePatch} (${nextCatalog.cardCount} records, SHA-256 ${nextCatalog.rawSha256}).`
  )
}
