/* ============================================================
   Secure random helpers
   ============================================================ */

export function generateOTP(): string {
  const arr = crypto.getRandomValues(new Uint8Array(4))
  const num = (arr[0] << 24 | arr[1] << 16 | arr[2] << 8 | arr[3]) >>> 0
  return (num % 1_000_000).toString().padStart(6, '0')
}

export function generateApiKeyPlain(): string {
  const arr = crypto.getRandomValues(new Uint8Array(24))
  return 'sk_live_' + Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function hashApiKey(plainKey: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(plainKey)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * OTP codes are salted with the email so identical codes for different
 * users don't collide, and never stored in plaintext.
 */
export async function hashOtp(email: string, code: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(`otp:${email.toLowerCase()}:${code}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}