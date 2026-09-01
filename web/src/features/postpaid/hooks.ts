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

import { applyPostpaid, getPostpaidAdminView, getPostpaidContext } from './api'
import {
  POSTPAID_ERROR_KEY,
  POSTPAID_POLL_INTERVAL_MS,
  POSTPAID_STALE_TIME_MS,
  POSTPAID_TERMINAL_STATUSES,
} from './constants'
import type { PostpaidGrant } from './types'

const CONTEXT_KEY = ['postpaid', 'context'] as const
const ADMIN_KEY = ['postpaid', 'admin'] as const

export type PostpaidOutcome =
  | { kind: 'idle' }
  /** Quota granted, or a replayed key resolved to an existing grant. */
  | { kind: 'completed'; grant: PostpaidGrant }
  /** 202: New API timed out and the grant may or may not have landed. */
  | { kind: 'unverified'; grant: PostpaidGrant }
  /** The key is still usable, so retrying is safe and idempotent. */
  | { kind: 'retryable'; messageKey: string }
  /** Retrying would fail identically; the key has been discarded. */
  | { kind: 'terminal'; messageKey: string }

const GENERIC_ERROR_KEY = 'Credit could not be granted'

/**
 * The caller's credit standing.
 *
 * Polls only while an application is mid-flight. Repayments happen in the
 * redemption transaction, so the redemption flow's normal wallet refresh is
 * sufficient and indebted users do not need a standing poll.
 */
export function usePostpaidContext() {
  return useQuery({
    queryKey: CONTEXT_KEY,
    queryFn: getPostpaidContext,
    staleTime: POSTPAID_STALE_TIME_MS,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.applicationPending ? POSTPAID_POLL_INTERVAL_MS : false,
  })
}

/** Root only. Guard on `isRoot` at the call site to avoid a certain 403. */
export function usePostpaidAdminView(enabled: boolean) {
  return useQuery({
    queryKey: ADMIN_KEY,
    queryFn: getPostpaidAdminView,
    staleTime: POSTPAID_STALE_TIME_MS,
    enabled,
    retry: false,
  })
}

export function usePostpaidApply(userId: number, onGranted?: () => void) {
  const queryClient = useQueryClient()
  const [outcome, setOutcome] = useState<PostpaidOutcome>({ kind: 'idle' })

  const mutation = useMutation({
    mutationFn: async (amount: number) => {
      const pending = resolveRequestKey('postpaid', userId, amount, Date.now())
      return applyPostpaid({
        requestKey: pending.requestKey,
        amount: pending.amount,
      })
    },
    onSuccess: (result) => {
      // Either way the grant now exists server-side, so the key has done its
      // job; replaying it would only return the same idempotent drawdown.
      clearPendingCharge('postpaid')
      setOutcome(
        result.pending
          ? { kind: 'unverified', grant: result.grant }
          : { kind: 'completed', grant: result.grant }
      )
      queryClient.invalidateQueries({ queryKey: CONTEXT_KEY })
      queryClient.invalidateQueries({ queryKey: ADMIN_KEY })
      // A settled grant has already moved the New API balance, so the wallet's
      // own figures are stale the moment this resolves.
      if (!result.pending) onGranted?.()
    },
    onError: (error) => {
      const status = isAxiosError(error) ? error.response?.status : undefined
      const messageKey = status
        ? (POSTPAID_ERROR_KEY[status] ?? GENERIC_ERROR_KEY)
        : GENERIC_ERROR_KEY

      const isTerminal =
        status !== undefined &&
        (POSTPAID_TERMINAL_STATUSES as readonly number[]).includes(status)

      if (isTerminal) {
        clearPendingCharge('postpaid')
        setOutcome({ kind: 'terminal', messageKey })
      } else {
        setOutcome({ kind: 'retryable', messageKey })
      }
      queryClient.invalidateQueries({ queryKey: CONTEXT_KEY })
    },
  })

  const discardPending = useCallback(() => {
    clearPendingCharge('postpaid')
    setOutcome({ kind: 'idle' })
    mutation.reset()
  }, [mutation])

  return {
    apply: mutation.mutate,
    isApplying: mutation.isPending,
    outcome,
    discardPending,
    /** Set when a previous attempt was interrupted and can still be resolved. */
    pendingCharge: readPendingCharge('postpaid'),
  }
}
