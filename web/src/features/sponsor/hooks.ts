/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useCallback, useState } from 'react'

import {
  clearPendingCharge,
  readPendingCharge,
  resolveRequestKey,
} from '@/features/leaderboard/lib/request-key'

import { createSponsorOrder, getSponsorAdminView, getSponsorContext } from './api'
import { SPONSOR_ERROR_KEY, SPONSOR_TERMINAL_STATUSES } from './constants'
import type { SponsorOrder } from './types'

const CONTEXT_KEY = ['sponsor', 'context'] as const
const ADMIN_KEY = ['sponsor', 'admin'] as const

export type SponsorOutcome =
  | { kind: 'idle' }
  /** Charge settled, or a replayed key resolved to a settled order. */
  | { kind: 'completed'; order: SponsorOrder }
  /** 202: still resolving. Do not resubmit; re-read instead. */
  | { kind: 'unverified'; order: SponsorOrder }
  /** The key is still usable, so retrying is safe and idempotent. */
  | { kind: 'retryable'; messageKey: string }
  /** Retrying would fail identically; the key has been discarded. */
  | { kind: 'terminal'; messageKey: string }

const GENERIC_ERROR_KEY = 'Sponsorship failed'

export function useSponsorContext() {
  return useQuery({
    queryKey: CONTEXT_KEY,
    queryFn: getSponsorContext,
    staleTime: 30 * 1000,
    retry: false,
  })
}

/** Root only. Guard on `isRoot` at the call site to avoid a certain 403. */
export function useSponsorAdminView(enabled: boolean) {
  return useQuery({
    queryKey: ADMIN_KEY,
    queryFn: getSponsorAdminView,
    staleTime: 30 * 1000,
    enabled,
    retry: false,
  })
}

export function useSponsorOrder(userId: number) {
  const queryClient = useQueryClient()
  const [outcome, setOutcome] = useState<SponsorOutcome>({ kind: 'idle' })

  const mutation = useMutation({
    mutationFn: async (input: { amountCny: number; message: string }) => {
      const pending = resolveRequestKey(
        'sponsor',
        userId,
        input.amountCny,
        Date.now()
      )
      return createSponsorOrder({
        requestKey: pending.requestKey,
        amountCny: pending.amount,
        message: input.message,
      })
    },
    onSuccess: (result) => {
      // Either way the order now exists server-side, so the key has done its
      // job; replaying it would only collide with the one-open-order guard.
      clearPendingCharge('sponsor')
      setOutcome(
        result.pending
          ? { kind: 'unverified', order: result.order }
          : { kind: 'completed', order: result.order }
      )
      queryClient.invalidateQueries({ queryKey: CONTEXT_KEY })
      queryClient.invalidateQueries({ queryKey: ADMIN_KEY })
    },
    onError: (error) => {
      const status = isAxiosError(error) ? error.response?.status : undefined
      const messageKey = status
        ? (SPONSOR_ERROR_KEY[status] ?? GENERIC_ERROR_KEY)
        : GENERIC_ERROR_KEY

      const isTerminal =
        status !== undefined &&
        (SPONSOR_TERMINAL_STATUSES as readonly number[]).includes(status)

      if (isTerminal) {
        clearPendingCharge('sponsor')
        setOutcome({ kind: 'terminal', messageKey })
      } else {
        setOutcome({ kind: 'retryable', messageKey })
      }
      queryClient.invalidateQueries({ queryKey: CONTEXT_KEY })
    },
  })

  const discardPending = useCallback(() => {
    clearPendingCharge('sponsor')
    setOutcome({ kind: 'idle' })
    mutation.reset()
  }, [mutation])

  return {
    submit: mutation.mutate,
    isSubmitting: mutation.isPending,
    outcome,
    discardPending,
    /** Set when a previous attempt was interrupted and can still be resolved. */
    pendingCharge: readPendingCharge('sponsor'),
  }
}
