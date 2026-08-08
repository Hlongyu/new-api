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
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { getGameDisplayMetrics } from '../game-display'

describe('gold miner display sizing', () => {
  test('fits a 4:3 canvas inside a width-limited desktop workspace', () => {
    const metrics = getGameDisplayMetrics(900, 900, 1)

    assert.deepEqual(metrics, {
      cssWidth: 900,
      cssHeight: 675,
      pixelWidth: 900,
      pixelHeight: 675,
    })
  })

  test('fits a 4:3 canvas inside a height-limited desktop workspace', () => {
    const metrics = getGameDisplayMetrics(1200, 800, 2)

    assert.deepEqual(metrics, {
      cssWidth: 1066,
      cssHeight: 800,
      pixelWidth: 2132,
      pixelHeight: 1600,
    })
  })

  test('caps the backing store at two device pixels per CSS pixel', () => {
    const metrics = getGameDisplayMetrics(1280, 960, 3)

    assert.equal(metrics.pixelWidth, 2560)
    assert.equal(metrics.pixelHeight, 1920)
  })

  test('falls back to a valid pixel ratio for invalid browser values', () => {
    const metrics = getGameDisplayMetrics(640, 480, Number.NaN)

    assert.equal(metrics.pixelWidth, 640)
    assert.equal(metrics.pixelHeight, 480)
  })
})
