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
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'

import { useMediaQuery } from '@/hooks/use-media-query'

import './announcement-celebration.css'

const confettiPieces = Array.from({ length: 48 }, (_, index) => {
  const direction = index % 2 === 0 ? 1 : -1
  return {
    id: `confetti-${index}`,
    style: {
      left: direction === 1 ? '22%' : '78%',
      width: `${4 + (index % 4)}px`,
      height: `${7 + (index % 5)}px`,
      backgroundColor: ['#e8b64f', '#f5d98d', '#c94842', '#fff0c3'][index % 4],
      borderRadius: index % 3 === 0 ? '50%' : '1px',
      '--confetti-apex-x': `${direction * (8 + ((index * 17) % 31))}vw`,
      '--confetti-apex-y': `${-26 - ((index * 7) % 17)}vh`,
      '--confetti-end-x': `${direction * (((index * 13) % 76) - 22)}vw`,
      '--confetti-spin': `${direction * (360 + ((index * 41) % 540))}deg`,
      '--confetti-delay': `${index * 6}ms`,
    } as CSSProperties,
  }
})

export function AnnouncementCelebration() {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  if (reducedMotion) return null

  return createPortal(
    <div aria-hidden='true' className='announcement-celebration'>
      {confettiPieces.map((piece) => (
        <span
          key={piece.id}
          className='announcement-celebration-piece'
          style={piece.style}
        />
      ))}
    </div>,
    document.body
  )
}
