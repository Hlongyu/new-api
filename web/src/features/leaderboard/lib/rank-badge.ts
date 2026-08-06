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
import {
  DIVISION_SUFFIX,
  TIER_BADGE_PREFIX,
  TIER_LABEL_KEY,
  TIER_NAME_TO_KEY,
} from '../constants'
import type { TierDivision, TierKey } from '../types'

// ----------------------------------------------------------------------------
// Tier badge resolution
// ----------------------------------------------------------------------------
//
// The leaderboard service exposes a tier two different ways:
//   - board rows carry only `rankLabel`, a Chinese string like "黄金 I"
//   - the personal payload carries structured `tierKey` + `division`
//
// Both have to land on the same artwork, so this resolves either form. When a
// tier cannot be resolved (a new tier shipped server-side, a malformed label)
// callers fall back to rendering the raw label as text.

export type ResolvedTierBadge = {
  src: string
  tierKey: TierKey
  division: TierDivision
  /** i18n key for the tier name, e.g. 'Gold'. */
  tierLabelKey: string
}

function badgeSrc(tierKey: TierKey, division: TierDivision): string {
  return `/rank-badges/${TIER_BADGE_PREFIX[tierKey]}-${DIVISION_SUFFIX[division]}.png`
}

function isTierDivision(value: string): value is TierDivision {
  return value in DIVISION_SUFFIX
}

/**
 * Split a service label such as "黄金 I" into its tier and division.
 *
 * Whitespace is collapsed defensively: the label is assembled server-side from
 * a template, so a stray double space must not break the badge.
 */
function parseRankLabel(
  label: string
): { tierKey: TierKey; division: TierDivision } | null {
  const parts = label.trim().split(/\s+/)
  if (parts.length !== 2) return null

  const tierKey = TIER_NAME_TO_KEY[parts[0]]
  if (!tierKey) return null
  if (!isTierDivision(parts[1])) return null

  return { tierKey, division: parts[1] }
}

export function resolveTierBadge(input: {
  label?: string | null
  tierKey?: string | null
  division?: string | null
}): ResolvedTierBadge | null {
  // Structured fields win when present: they need no parsing at all.
  if (input.tierKey && input.division) {
    const tierKey = input.tierKey as TierKey
    if (TIER_BADGE_PREFIX[tierKey] && isTierDivision(input.division)) {
      return {
        src: badgeSrc(tierKey, input.division),
        tierKey,
        division: input.division,
        tierLabelKey: TIER_LABEL_KEY[tierKey],
      }
    }
    return null
  }

  if (!input.label) return null

  const parsed = parseRankLabel(input.label)
  if (!parsed) return null

  return {
    src: badgeSrc(parsed.tierKey, parsed.division),
    tierKey: parsed.tierKey,
    division: parsed.division,
    tierLabelKey: TIER_LABEL_KEY[parsed.tierKey],
  }
}

/**
 * Whether a row opted into showing its badge.
 *
 * Legacy rows omit the field entirely and the service treats those as opted in,
 * so only an explicit `false` hides the badge.
 */
export function showsTierBadge(showRankBadge?: boolean): boolean {
  return showRankBadge !== false
}
