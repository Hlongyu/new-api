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
import type {
  PostpaidEvent,
  PostpaidEventStatus,
  PostpaidGrant,
  PostpaidGrantStatus,
} from '../types'

export type PostpaidTimelineItem =
  | {
      kind: 'drawdown'
      id: string
      timestamp: number
      amount: number
      dueAt: number
      status: PostpaidGrantStatus
    }
  | {
      kind: 'repayment'
      id: string
      timestamp: number
      amount: number
      status: PostpaidEventStatus
    }

const EVENT_STATUS_PRIORITY: Record<PostpaidEventStatus, number> = {
  completed: 0,
  processing: 1,
  unknown: 2,
  failed: 3,
}

/**
 * Builds the user-visible account ledger.
 *
 * One redemption may repay several internal loan rows. Those allocations are
 * one account transaction to the user, so they are grouped by redemption id.
 */
export function buildPostpaidTimeline(
  grants: PostpaidGrant[],
  events: PostpaidEvent[]
): PostpaidTimelineItem[] {
  const repayments = new Map<
    string,
    Extract<PostpaidTimelineItem, { kind: 'repayment' }>
  >()

  for (const event of events) {
    const groupKey =
      event.redemptionId > 0
        ? `redemption:${event.redemptionId}`
        : `event:${event.id}`
    const timestamp = event.redemptionTime || event.createdAt
    const existing = repayments.get(groupKey)
    if (!existing) {
      repayments.set(groupKey, {
        kind: 'repayment',
        id: groupKey,
        timestamp,
        amount: event.amount,
        status: event.status,
      })
      continue
    }

    existing.amount = Number((existing.amount + event.amount).toFixed(6))
    existing.timestamp = Math.max(existing.timestamp, timestamp)
    if (
      EVENT_STATUS_PRIORITY[event.status] >
      EVENT_STATUS_PRIORITY[existing.status]
    ) {
      existing.status = event.status
    }
  }

  const timeline: PostpaidTimelineItem[] = grants.map((grant) => ({
    kind: 'drawdown',
    id: `drawdown:${grant.id}`,
    timestamp: grant.createdAt,
    amount: grant.creditAmount,
    dueAt: grant.dueAt,
    status: grant.status,
  }))
  timeline.push(...repayments.values())
  timeline.sort(
    (left, right) =>
      right.timestamp - left.timestamp || right.id.localeCompare(left.id)
  )
  return timeline
}
