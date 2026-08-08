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

import {
  activateMenuSelection,
  advanceGame,
  buySelectedShopItem,
  continueFromResult,
  createGameState,
  detonateCaughtEntity,
  finishShopping,
  HOOK_ORIGIN_X,
  HOOK_ORIGIN_Y,
  launchHook,
  skipCompletedLevel,
  type MineEntity,
} from '../game-engine'

function advanceFor(
  state: ReturnType<typeof createGameState>,
  seconds: number
) {
  const stepCount = Math.ceil(seconds / 0.05)
  for (let index = 0; index < stepCount; index += 1) {
    advanceGame(state, 0.05)
  }
}

function miniGold(y: number): MineEntity {
  return {
    id: 'test-gold',
    type: 'MiniGold',
    x: HOOK_ORIGIN_X - 5,
    y,
    width: 10,
    height: 8,
    mass: 2,
    bonus: 50,
    active: true,
    attached: false,
    movementDirection: 1,
    movementStartX: HOOK_ORIGIN_X,
  }
}

describe('gold miner reference game engine', () => {
  test('starts with the original first goal and L1_1 layout', () => {
    const state = createGameState(0, 1, 1)

    activateMenuSelection(state)

    assert.equal(state.phase, 'goal')
    assert.equal(state.goal, 650)
    advanceFor(state, 2.7)
    assert.equal(state.phase, 'playing')
    assert.equal(state.realLevelId, 'L1_1')
    assert.equal(state.items.length, 15)
    assert.equal(state.timeLeft > 60, true)
  })

  test('reels a small gold at the original mass-based speed and credits 50', () => {
    const state = createGameState(0, 1, 1)
    activateMenuSelection(state)
    advanceFor(state, 2.7)
    state.items = [miniGold(HOOK_ORIGIN_Y + 24)]
    state.hook.angle = 0

    launchHook(state)
    advanceFor(state, 0.05)

    assert.equal(state.hook.attachedItemId, 'test-gold')
    assert.equal(state.hook.mode, 'retracting')
    advanceFor(state, 0.15)
    assert.equal(state.money, 50)
    assert.equal(state.hook.mode, 'bonus')
    assert.equal(state.moneyDisplay, 0)
    advanceFor(state, 1.1)
    assert.equal(state.moneyDisplay, 50)
    assert.equal(state.items[0].active, false)
    assert.equal(state.hook.mode, 'swinging')
  })

  test('uses the original cumulative goal progression after a cleared level', () => {
    const state = createGameState(0, 1, 7)
    activateMenuSelection(state)
    advanceFor(state, 2.7)
    state.money = state.goal

    skipCompletedLevel(state)

    assert.equal(state.phase, 'made-goal')
    assert.equal(state.level, 2)
    advanceFor(state, 2.2)
    assert.equal(state.phase, 'shop')
    finishShopping(state)
    advanceFor(state, 1.6)
    assert.equal(state.phase, 'goal')
    assert.equal(state.goal, 1195)
  })

  test('shop purchases deduct the generated price and enable one-level boosts', () => {
    const state = createGameState(0, 1, 4)
    state.phase = 'shop'
    state.money = 500
    state.moneyDisplay = 500
    state.shopItems = [{ id: 'StrengthDrink', price: 225, slot: 1 }]

    const purchased = buySelectedShopItem(state)

    assert.equal(purchased, true)
    assert.equal(state.money, 275)
    assert.equal(state.moneyDisplay, 275)
    assert.equal(state.hasStrengthDrink, true)
    assert.equal(state.shopFinishing, true)
  })

  test('dynamite destroys a held object without awarding its bonus', () => {
    const state = createGameState(0, 1, 1)
    state.phase = 'playing'
    state.dynamite = 1
    const entity = miniGold(HOOK_ORIGIN_Y + 30)
    entity.attached = true
    state.items = [entity]
    state.hook.attachedItemId = entity.id
    state.hook.mode = 'retracting'

    const used = detonateCaughtEntity(state)

    assert.equal(used, true)
    assert.equal(state.dynamite, 0)
    assert.equal(entity.active, false)
    assert.equal(state.money, 0)
  })

  test('records a new high score after a failed run', () => {
    const state = createGameState(100, 2, 1)
    state.phase = 'playing'
    state.money = 300
    state.timeLeft = 0.01

    advanceGame(state, 0.02)
    continueFromResult(state)

    assert.equal(state.phase, 'new-high-score')
    assert.equal(state.highScore, 300)
    assert.equal(state.highLevel, 1)
  })
})
