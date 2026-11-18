/* ============================================================
   Safe request body parsing
   c.req.json() throws on malformed bodies, which would surface as
   an ugly 500. Returns null so routes can answer a clean 400.
   ============================================================ */

export async function parseJson<T = any>(c: any): Promise<T | null> {
  try {
    return (await c.req.json()) as T
  } catch {
    return null
  }
}