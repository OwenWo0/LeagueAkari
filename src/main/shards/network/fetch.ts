import type { Session } from 'electron'

export async function fetchNetworkSession(
  electronSession: Pick<Session, 'fetch'>,
  waitUntilConfigured: () => Promise<void>,
  input: string | URL,
  init: RequestInit = {}
): Promise<Response> {
  await waitUntilConfigured()
  return electronSession.fetch(typeof input === 'string' ? input : input.toString(), {
    ...init,
    redirect: 'error'
  })
}
