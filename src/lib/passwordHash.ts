import { createHash } from 'crypto'

export function hashPassword(raw: string) {
  return createHash('sha256').update(raw).digest('hex')
}

export const hashAccountPassword = hashPassword
export const hashEditPassword = hashPassword
