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
import type { LeaderboardEntry } from '../types'

/** Shared by the podium, desktop rows, and mobile cards. */
export function EntryCosmetics(props: { entry: LeaderboardEntry }) {
  return (
    <>
      {props.entry.avatarImage && (
        <img
          src={props.entry.avatarImage}
          alt=''
          loading='lazy'
          className='size-8 shrink-0 rounded-full object-cover'
        />
      )}
      {props.entry.customTitle && (
        <span
          className='text-primary max-w-32 truncate text-xs font-medium'
          title={props.entry.customTitle}
        >
          {props.entry.customTitle}
        </span>
      )}
    </>
  )
}
