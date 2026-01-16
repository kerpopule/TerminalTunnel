/**
 * Hash a PIN using SHA-256
 */
export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verify a PIN against a stored hash
 */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
  const pinHash = await hashPin(pin);
  return pinHash === storedHash;
}

/**
 * Validate PIN format (must be exactly 6 digits)
 */
export function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}
