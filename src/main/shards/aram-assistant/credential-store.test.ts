import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CredentialEncryption } from './credential-store'
import { AramCredentialStore } from './credential-store'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString()
  }
}))

const folders: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(
    folders.splice(0).map((folder) => fs.rm(folder, { recursive: true, force: true }))
  )
})

describe('AramCredentialStore', () => {
  it('keeps a credential in memory when OS encryption throws and reports that mode', async () => {
    const folder = await createFolder()
    const encryption: CredentialEncryption = {
      isEncryptionAvailable: () => true,
      encryptString: () => {
        throw new Error('OS keychain is unavailable')
      },
      decryptString: (value) => value.toString()
    }
    const store = new AramCredentialStore({
      folderPath: path.join(folder, 'credentials'),
      encryption
    })

    await store.set('gemini\nhttps://example.invalid/v1', ' secret-key ')

    expect(await store.get('gemini\nhttps://example.invalid/v1')).toBe('secret-key')
    expect(await store.has('gemini\nhttps://example.invalid/v1')).toBe(true)
    expect(store.getStorageMode('gemini\nhttps://example.invalid/v1')).toBe('memory-only')
    await expect(fs.stat(path.join(folder, 'credentials'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })

  it('fails clearly when deleting an encrypted credential fails', async () => {
    const folder = await createFolder()
    const store = new AramCredentialStore({
      folderPath: folder,
      encryption: {
        isEncryptionAvailable: () => true,
        encryptString: (value) => Buffer.from(value),
        decryptString: (value) => value.toString()
      }
    })
    const scope = 'openai\nhttps://example.invalid/v1'
    await store.set(scope, 'credential')
    const credentialPath = path.join(
      folder,
      `${await import('node:crypto').then(({ createHash }) => createHash('sha256').update(scope).digest('hex'))}.credential`
    )
    const remove = vi.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('disk is read only'))

    await expect(store.clear(scope)).rejects.toMatchObject({ code: 'CREDENTIAL_STORAGE_FAILED' })
    expect(store.getStorageMode(scope)).toBe('storage-error')
    expect(remove).toHaveBeenCalledWith(credentialPath, { force: true })
    await expect(fs.stat(credentialPath)).resolves.toBeTruthy()
  })
})

async function createFolder() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'akari-aram-credential-'))
  folders.push(folder)
  return folder
}
