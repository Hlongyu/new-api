import { createHash, randomBytes } from 'node:crypto'

export function randomToken(prefix = '') {
  return `${prefix}${randomBytes(32).toString('base64url')}`
}

export function hashSecret(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
