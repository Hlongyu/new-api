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
import { GAME_HEIGHT, GAME_WIDTH } from './game-engine'

const MAX_DEVICE_PIXEL_RATIO = 2

export type GameDisplayMetrics = {
  cssWidth: number
  cssHeight: number
  pixelWidth: number
  pixelHeight: number
}

export function getGameDisplayMetrics(
  containerWidth: number,
  containerHeight: number,
  devicePixelRatio: number
): GameDisplayMetrics {
  const safeWidth = Math.max(1, Math.floor(containerWidth))
  const safeHeight = Math.max(1, Math.floor(containerHeight))
  const scale = Math.min(safeWidth / GAME_WIDTH, safeHeight / GAME_HEIGHT)
  const cssWidth = Math.max(1, Math.floor(GAME_WIDTH * scale))
  const cssHeight = Math.max(1, Math.floor(GAME_HEIGHT * scale))
  const safePixelRatio = Number.isFinite(devicePixelRatio)
    ? Math.max(1, Math.min(MAX_DEVICE_PIXEL_RATIO, devicePixelRatio))
    : 1

  return {
    cssWidth,
    cssHeight,
    pixelWidth: Math.max(1, Math.round(cssWidth * safePixelRatio)),
    pixelHeight: Math.max(1, Math.round(cssHeight * safePixelRatio)),
  }
}
