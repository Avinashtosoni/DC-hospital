import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/lib/supabase', () => ({ supabase: null, isSupabaseConfigured: false, tenancyEnabled: () => false, siteTenant: () => null }))
const { friendlyDbError } = await import('../src/data/supabaseAdapter')

describe('friendlyDbError', () => {
  it("shows the database's own sentences as they are", () => {
    for (const [code, message] of [
      ['23514', 'This payment (₹500.00) is more than the balance due on INV-10001 (₹200.00).'],
      ['23505', 'This patient is already admitted. Discharge or transfer the current admission instead.'],
      ['23001', 'Bed G-101 has an admitted patient. Discharge or transfer them first.'],
      ['42501', 'The selected bed belongs to another hospital.'],
    ]) expect(friendlyDbError({ code, message }).message).toBe(message)
  })
  it('still translates raw Postgres errors', () => {
    expect(friendlyDbError({ code: '23505', message: 'duplicate key value violates unique constraint "doctors_email_key"', details: 'Key (email)=(a@b.in) already exists.' }).message).toMatch(/already in use \(email a@b.in\)/)
    expect(friendlyDbError({ code: '42501', message: 'new row violates row-level security policy for table "invoices"' }).message).toMatch(/don't have permission/)
    expect(friendlyDbError({ code: '23503', message: 'update or delete on table "patients" violates foreign key constraint' }, 'delete').message).toMatch(/can't be deleted/)
    expect(friendlyDbError({ code: '23514', message: 'new row for relation "inventory" violates check constraint "inventory_quantity_check"' }).message).toBe('Some values are not valid: inventory quantity check')
  })
})
