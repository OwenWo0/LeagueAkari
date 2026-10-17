import { safeStorage } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export interface CredentialEncryption {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface CredentialStoreOptions {
  folderPath: string
  encryption?: CredentialEncryption
}

export type CredentialStorageMode = 'empty' | 'encrypted-file' | 'memory-only' | 'storage-error'

export class CredentialStoreError extends Error {
  readonly code = 'CREDENTIAL_STORAGE_FAILED'

  constructor() {
    super('Provider credential storage could not be cleared safely.')
    this.name = 'CredentialStoreError'
  }
}

/** Keeps provider credentials outside SettingFactory and renderer synchronization. */
export class AramCredentialStore {
  private readonly _memory = new Map<string, string>()
  private readonly _modes = new Map<string, CredentialStorageMode>()
  private readonly _encryption: CredentialEncryption

  constructor(private readonly _options: CredentialStoreOptions) {
    this._encryption = _options.encryption ?? safeStorage
  }

  async has(scope: string): Promise<boolean> {
    if (this._memory.has(scope)) return Boolean(this._memory.get(scope))
    try {
      if (!this._encryption.isEncryptionAvailable()) {
        this._modes.set(scope, 'storage-error')
        return false
      }
      const encrypted = await fs.readFile(this._filePath(scope))
      const found = Boolean(this._encryption.decryptString(encrypted))
      this._modes.set(scope, found ? 'encrypted-file' : 'storage-error')
      return found
    } catch (error) {
      this._modes.set(scope, isMissingFile(error) ? 'empty' : 'storage-error')
      return false
    }
  }

  async get(scope: string): Promise<string | null> {
    const memoryValue = this._memory.get(scope)
    if (memoryValue) return memoryValue
    try {
      if (!this._encryption.isEncryptionAvailable()) {
        this._modes.set(scope, 'storage-error')
        return null
      }
      const encrypted = await fs.readFile(this._filePath(scope))
      const value = this._encryption.decryptString(encrypted)
      this._modes.set(scope, value ? 'encrypted-file' : 'storage-error')
      return value || null
    } catch (error) {
      this._modes.set(scope, isMissingFile(error) ? 'empty' : 'storage-error')
      return null
    }
  }

  getStorageMode(scope: string): CredentialStorageMode {
    return this._modes.get(scope) ?? 'empty'
  }

  async set(scope: string, value: string): Promise<void> {
    const normalized = value.trim()
    if (!normalized) {
      await this.clear(scope)
      return
    }

    const folder = this._options.folderPath
    const filePath = this._filePath(scope)
    const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined
    try {
      if (!this._encryption.isEncryptionAvailable())
        throw new Error('Secure storage is unavailable.')
      const encrypted = this._encryption.encryptString(normalized)
      await fs.mkdir(folder, { recursive: true, mode: 0o700 })
      handle = await fs.open(tempPath, 'wx', 0o600)
      await handle.writeFile(encrypted)
      await handle.sync()
      await handle.close()
      handle = undefined
      await fs.rename(tempPath, filePath)
      this._memory.delete(scope)
      this._modes.set(scope, 'encrypted-file')
    } catch {
      if (handle) await handle.close().catch(() => {})
      await fs.rm(tempPath, { force: true }).catch(() => {})
      this._memory.set(scope, normalized)
      try {
        // Remove a prior encrypted value so it cannot reappear after a later restart.
        await fs.rm(filePath, { force: true })
        this._modes.set(scope, 'memory-only')
      } catch {
        this._modes.set(scope, 'storage-error')
        throw new CredentialStoreError()
      }
    }
  }

  async clear(scope: string): Promise<void> {
    this._memory.delete(scope)
    try {
      await fs.rm(this._filePath(scope), { force: true })
      this._modes.set(scope, 'empty')
    } catch {
      this._modes.set(scope, 'storage-error')
      throw new CredentialStoreError()
    }
  }

  private _filePath(scope: string) {
    const id = crypto.createHash('sha256').update(scope).digest('hex')
    return path.join(this._options.folderPath, `${id}.credential`)
  }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
