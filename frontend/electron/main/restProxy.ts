/** Thin authorized REST helper for the main process (used by the offline queue). */
import { BACKEND_URL } from './config'
import { getToken } from './store'

export type RestResult = { ok: boolean; status: number; body: unknown }

export async function backendRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<RestResult> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let payload: string | undefined
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${BACKEND_URL}${path}`, { method, headers, body: payload })
  let parsed: unknown = null
  try {
    parsed = await res.json()
  } catch {
    parsed = null
  }
  return { ok: res.ok, status: res.status, body: parsed }
}
