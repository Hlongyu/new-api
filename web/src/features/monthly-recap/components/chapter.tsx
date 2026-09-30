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
import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function Chapter(props: {
  id: string
  number: string
  label: string
  children: ReactNode
  className?: string
}) {
  const reduced = useReducedMotion()
  return (
    <motion.section
      id={props.id}
      className={cn('recap-chapter', props.className)}
      initial={reduced ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.08 }}
      transition={{ duration: 0.5 }}
      aria-labelledby={`${props.id}-heading`}
    >
      <div className='recap-eyebrow'>
        <span>{props.number}</span>
        <span>{props.label}</span>
      </div>
      {props.children}
    </motion.section>
  )
}
