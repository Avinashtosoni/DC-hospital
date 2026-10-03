import { describe, expect, it } from 'vitest'
import { isIndianMobile } from '../src/lib/validation'

describe('isIndianMobile', () => {
  it.each(['9812345678', '+91 98123 45678', '+919812345678', '09812345678', '98123-45678', '6000000000'])('accepts %s', (p) => expect(isIndianMobile(p)).toBe(true))
  it.each(['', '12345', '5812345678', '98123456789', '+1 415 555 0100', 'abc9812345678', '+91 11 4000 2100'])('rejects %s', (p) => expect(isIndianMobile(p)).toBe(false))
})
