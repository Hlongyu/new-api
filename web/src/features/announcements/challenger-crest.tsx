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
import { useId, useState, type CSSProperties } from 'react'

import { useMediaQuery } from '@/hooks/use-media-query'

import { AnnouncementCelebration } from './announcement-celebration'

import './challenger-crest.css'

const crestArtwork = {
  '--crest-art': "url('/rank-badges/challenger-crest.png')",
  '--previous-crest-art': "url('/rank-badges/grandmaster-crest.png')",
} as CSSProperties

// The wing masks follow the feather tiers, leaving the crystal and crown separate.
const crestParts = [
  {
    id: 'left-upper',
    clip: 'polygon(0% 0%, 34% 0%, 34% 32%, 31.43% 50%, 0% 50%)',
    side: -1,
    delay: '3.95s',
  },
  {
    id: 'left-middle',
    clip: 'polygon(0% 50%, 31.43% 50%, 30% 70%, 36% 79%, 0% 79%)',
    side: -1,
    delay: '3.85s',
  },
  {
    id: 'left-lower',
    clip: 'polygon(0% 79%, 36% 79%, 50% 100%, 0% 100%)',
    side: -1,
    delay: '3.75s',
  },
  {
    id: 'right-upper',
    clip: 'polygon(66% 0%, 100% 0%, 100% 50%, 68.57% 50%, 66% 32%)',
    side: 1,
    delay: '3.95s',
  },
  {
    id: 'right-middle',
    clip: 'polygon(68.57% 50%, 100% 50%, 100% 79%, 64% 79%, 70% 70%)',
    side: 1,
    delay: '3.85s',
  },
  {
    id: 'right-lower',
    clip: 'polygon(64% 79%, 100% 79%, 100% 100%, 50% 100%)',
    side: 1,
    delay: '3.75s',
  },
  {
    id: 'core',
    clip: 'polygon(34% 32%, 50% 40%, 66% 32%, 70% 70%, 50% 100%, 30% 70%)',
    side: 0,
    delay: '3.05s',
  },
  {
    id: 'crown',
    clip: 'polygon(34% 0%, 66% 0%, 66% 32%, 50% 40%, 34% 32%)',
    side: 0,
    delay: '4.1s',
  },
]

const forgingTrails = [
  { id: 'upper-left', path: 'M 61 65 C 66 122 117 67 160 130', delay: '2.1s' },
  {
    id: 'upper-right',
    path: 'M 259 65 C 254 122 203 67 160 130',
    delay: '2.1s',
  },
  {
    id: 'middle-left',
    path: 'M 38 132 C 91 187 111 76 160 130',
    delay: '2.25s',
  },
  {
    id: 'middle-right',
    path: 'M 282 132 C 229 187 209 76 160 130',
    delay: '2.25s',
  },
  {
    id: 'lower-left',
    path: 'M 88 198 C 53 113 135 184 160 130',
    delay: '2.4s',
  },
  {
    id: 'lower-right',
    path: 'M 232 198 C 267 113 185 184 160 130',
    delay: '2.4s',
  },
  { id: 'top', path: 'M 160 30 C 207 80 122 90 160 130', delay: '2.05s' },
]

const impactSparks = Array.from({ length: 20 }, (_, index) => ({
  id: `impact-spark-${index}`,
  style: {
    '--spark-angle': `${index * 18 + 9}deg`,
    '--spark-distance': `${106 + (index % 4) * 9}px`,
    '--spark-delay': `${5.2 + (index % 3) * 0.025}s`,
  } as CSSProperties,
}))

export function ChallengerCrest() {
  const effectId = useId()
  const [loaded, setLoaded] = useState(false)
  const [previousLoaded, setPreviousLoaded] = useState(false)
  const [artworkFailed, setArtworkFailed] = useState(false)
  const [entranceFinished, setEntranceFinished] = useState(false)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const animate = loaded && previousLoaded && !reducedMotion && !artworkFailed

  return (
    <div
      aria-hidden='true'
      style={crestArtwork}
      className={`challenger-crest${animate ? ' challenger-crest-assembling' : ''}${reducedMotion || artworkFailed ? ' challenger-crest-static' : ''}`}
    >
      <img
        src='/rank-badges/challenger-crest.png'
        alt=''
        width={128}
        height={128}
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setArtworkFailed(true)}
        className='challenger-crest-image h-full w-auto max-w-full select-none'
      />
      {!reducedMotion && !artworkFailed ? (
        <img
          src='/rank-badges/grandmaster-crest.png'
          alt=''
          width={128}
          height={128}
          draggable={false}
          onLoad={() => setPreviousLoaded(true)}
          onError={() => setArtworkFailed(true)}
          className='challenger-crest-previous-image'
        />
      ) : null}
      {animate ? (
        <>
          <span className='challenger-crest-aura' />
          <span className='challenger-crest-old-energy' />
          <span className='challenger-crest-charge' />
          <svg
            className='challenger-crest-forging'
            viewBox='0 0 320 260'
            focusable='false'
          >
            <defs>
              <linearGradient
                id={`${effectId}-metal`}
                x1='0'
                y1='0'
                x2='1'
                y2='1'
              >
                <stop offset='0%' stopColor='#fff7db' />
                <stop offset='35%' stopColor='#ecd9a6' />
                <stop offset='55%' stopColor='#74562d' />
                <stop offset='100%' stopColor='#fff1c2' />
              </linearGradient>
              <filter
                id={`${effectId}-glow`}
                x='-100%'
                y='-100%'
                width='300%'
                height='300%'
              >
                <feGaussianBlur stdDeviation='2' />
              </filter>
            </defs>
            {forgingTrails.map((trail) => (
              <g
                key={trail.id}
                style={{ '--trail-delay': trail.delay } as CSSProperties}
              >
                <path
                  d={trail.path}
                  pathLength={1}
                  className='crest-energy-haze'
                  filter={`url(#${effectId}-glow)`}
                />
                <path
                  d={trail.path}
                  pathLength={1}
                  className='crest-energy-thread'
                />
                <g className='crest-forging-metal'>
                  <animateMotion
                    path={trail.path}
                    begin={trail.delay}
                    dur='1.25s'
                    rotate='auto'
                    fill='freeze'
                  />
                  <path
                    d='M -9 -3 L 3 -5 L 10 0 L -3 4 Z'
                    fill={`url(#${effectId}-metal)`}
                  />
                  <path d='M -9 -3 L 3 -5 L -3 0 Z' fill='#fff8dd' />
                </g>
              </g>
            ))}
          </svg>
          {crestParts.map((part) => (
            <span
              key={part.id}
              className={`challenger-crest-fragment challenger-crest-${part.id}`}
              style={
                {
                  clipPath: part.clip,
                  '--part-side': part.side,
                  '--part-delay': part.delay,
                } as CSSProperties
              }
            />
          ))}
          <span className='challenger-crest-impact-glow' />
          <span className='challenger-crest-impact-echo' />
          <span className='challenger-crest-impact-flash' />
          {impactSparks.map((spark) => (
            <span
              key={spark.id}
              className='challenger-crest-impact-spark'
              style={spark.style}
            />
          ))}
          <span className='challenger-crest-beam' />
          <span className='challenger-crest-flare' />
          <span className='challenger-crest-shine'>
            <span
              className='challenger-crest-shine-sweep'
              onAnimationEnd={(event) => {
                if (event.animationName === 'crest-shine') {
                  setEntranceFinished(true)
                }
              }}
            />
          </span>
          {entranceFinished ? <AnnouncementCelebration /> : null}
        </>
      ) : null}
    </div>
  )
}
