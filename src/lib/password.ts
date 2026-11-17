/* ============================================================
   Password hashing (PBKDF2 via Web Crypto API)
   ============================================================ */

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const hashBuf = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  const hashArr = Array.from(new Uint8Array(hashBuf))
  const saltArr = Array.from(salt)
  const toHex = (arr: number[]) => arr.map(b => b.toString(16).padStart(2, '0')).join('')
  return `${toHex(saltArr)}.${toHex(hashArr)}`
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split('.')
  if (!saltHex || !hashHex) return false
  const encoder = new TextEncoder()
  const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(plain),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const hashBuf = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    256
  )
  const hashArr = Array.from(new Uint8Array(hashBuf))
  const computed = hashArr.map(b => b.toString(16).padStart(2, '0')).join('')
  return computed === hashHex
}