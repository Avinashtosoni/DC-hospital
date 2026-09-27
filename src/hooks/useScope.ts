import { useMemo } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useTable } from './useData'

/** Resolves the linked patient / doctor / staff record of the signed-in user. */
export function useMe() {
  const { user } = useAuth()
  const patients = useTable('patients')
  const doctors = useTable('doctors')
  return useMemo(() => ({
    user,
    patient: user?.role === 'patient' ? patients.data?.find((p) => p.profile_id === user.id) ?? null : null,
    doctor: user?.role === 'doctor' ? doctors.data?.find((d) => d.profile_id === user.id) ?? null : null,
    loading: patients.isLoading || doctors.isLoading,
  }), [user, patients.data, doctors.data, patients.isLoading, doctors.isLoading])
}
