import { useMemo } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useRows, useTable } from './useData'

/** Resolves the linked patient / doctor record of the signed-in user (one indexed lookup, not the whole table). */
export function useMe() {
  const { user } = useAuth()
  const isPatient = user?.role === 'patient'
  const patients = useRows('patients', { where: [['profile_id', 'eq', user?.id ?? '']] }, { enabled: isPatient })
  const doctors = useTable('doctors')
  return useMemo(() => ({
    user,
    patient: isPatient ? patients.data?.rows[0] ?? null : null,
    doctor: user?.role === 'doctor' ? doctors.data?.find((d) => d.profile_id === user.id) ?? null : null,
    loading: (isPatient && patients.isLoading) || doctors.isLoading,
  }), [user, isPatient, patients.data, doctors.data, patients.isLoading, doctors.isLoading])
}
