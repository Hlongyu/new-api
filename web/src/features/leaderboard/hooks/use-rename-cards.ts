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
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { useCallback, useState } from 'react'

import { buyRenameCards } from '../api'
import {
  RENAME_CARD_ERROR_KEY,
  RENAME_CARD_TERMINAL_STATUSES,
} from '../constants'
import {
  clearPendingCharge,
  readPendingCharge,
  resolveRequestKey,
} from '../lib/request-key'
import type { RenameCardOrder } from '../types'

export type PurchaseOutcome =
  | { kind: 'idle' }
  /** Charge succeeded, or an earlier identical request already succeeded. */
  | { kind: 'completed'; order: RenameCardOrder }
  /** 202: the charge is in flight with an unknown result. Never auto-retry. */
  | { kind: 'unverified'; order: RenameCardOrder }
  /** The request key is still valid, so retrying is safe and idempotent. */
  | { kind: 'retryable'; messageKey: string }
  /** Retrying would fail the same way; the key has been discarded. */
  | { kind: 'terminal'; messageKey: string }

const GENERIC_ERROR_KEY = 'Charge failed'

/**
 * Purchase rename cards with an idempotent request key.
 *
 * The service deduplicates on the key, so a lost response can be resolved by
 * replaying the same request rather than charging again. The key is therefore
 * kept until an outcome is known to be final.
 */
export function useRenameCardPurchase(userId: number) {
  const queryClient = useQueryClient()
  const [outcome, setOutcome] = useState<PurchaseOutcome>({ kind: 'idle' })

  const mutation = useMutation({
    mutationFn: async (quantity: number) => {
      const pending = resolveRequestKey('rename-card', userId, quantity, Date.now())
      return buyRenameCards({
        requestKey: pending.requestKey,
        quantity: pending.amount,
      })
    },
    onSuccess: (result) => {
      if (result.pending) {
        // The order exists server-side; replaying would only hit the
        // one-order-per-user guard, so retire the key and let the user refresh.
        clearPendingCharge('rename-card')
        setOutcome({ kind: 'unverified', order: result.order })
      } else {
        clearPendingCharge('rename-card')
        setOutcome({ kind: 'completed', order: result.order })
      }
      queryClient.invalidateQueries({ queryKey: ['leaderboard', 'me'] })
    },
    onError: (error) => {
      const status = isAxiosError(error) ? error.response?.status : undefined
      const messageKey = status
        ? (RENAME_CARD_ERROR_KEY[status] ?? GENERIC_ERROR_KEY)
        : GENERIC_ERROR_KEY

      const isTerminal =
        status !== undefined &&
        (RENAME_CARD_TERMINAL_STATUSES as readonly number[]).includes(status)

      if (isTerminal) {
        clearPendingCharge('rename-card')
        setOutcome({ kind: 'terminal', messageKey })
      } else {
        // Network failures, 5xx, 409 and 429 all leave the key usable.
        setOutcome({ kind: 'retryable', messageKey })
      }
      queryClient.invalidateQueries({ queryKey: ['leaderboard', 'me'] })
    },
  })

  const reset = useCallback(() => {
    setOutcome({ kind: 'idle' })
    mutation.reset()
  }, [mutation])

  const discardPending = useCallback(() => {
    clearPendingCharge('rename-card')
    setOutcome({ kind: 'idle' })
    mutation.reset()
  }, [mutation])

  return {
    purchase: mutation.mutate,
    isPurchasing: mutation.isPending,
    outcome,
    reset,
    discardPending,
    /** Set when a previous attempt was interrupted and can still be resolved. */
    pendingPurchase: readPendingCharge('rename-card'),
  }
}
