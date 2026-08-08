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
  LEVEL_DATA,
  type EntityDirection,
  type EntityType,
  type LevelTheme,
} from './level-data'

export const GAME_WIDTH = 320
export const GAME_HEIGHT = 240
export const GAME_SCALE = 3
export const HOOK_ORIGIN_X = 158
export const HOOK_ORIGIN_Y = 30
export const HOOK_MIN_ANGLE = -75
export const HOOK_MAX_ANGLE = 75
export const HOOK_MAX_LENGTH = 230

const HOOK_ROTATE_SPEED = 65
const HOOK_GRAB_SPEED = 100
const HOOK_COLLISION_RADIUS = 6
const ROUND_DURATION = 61
const GOAL_SCREEN_DURATION = 2.6
const MADE_GOAL_DURATION = 2.1
const SHOP_FINISH_DURATION = 1.5
const EXPLOSION_DURATION = 0.5
const EXPLOSION_RADIUS = 50

export type GamePhase =
  | 'menu'
  | 'high-score'
  | 'new-high-score'
  | 'goal'
  | 'playing'
  | 'made-goal'
  | 'shop'
  | 'game-over'

export type HookMode = 'swinging' | 'extending' | 'retracting' | 'bonus'
export type MenuSelection = 'start' | 'high-score'
export type GoalKind = 'first' | 'next'
export type ShopItemId =
  | 'Dynamite'
  | 'StrengthDrink'
  | 'LuckyClover'
  | 'RockCollectorsBook'
  | 'GemPolish'

export type MineEntity = {
  id: string
  type: EntityType
  x: number
  y: number
  width: number
  height: number
  mass: number
  bonus: number
  active: boolean
  attached: boolean
  direction?: EntityDirection
  movementDirection: -1 | 1
  movementStartX: number
  extraEffectChance?: number
}

export type ShopItem = {
  id: ShopItemId
  price: number
  slot: number
}

export type Explosion = {
  id: number
  x: number
  y: number
  timeLeft: number
}

export type HookState = {
  angle: number
  rotateRight: boolean
  length: number
  mode: HookMode
  attachedItemId: string | null
  bonusTimer: number
  pendingDisplayValue: number
}

export type GameState = {
  phase: GamePhase
  menuSelection: MenuSelection
  goalKind: GoalKind
  screenTimer: number
  level: number
  realLevelId: string
  theme: LevelTheme
  goal: number
  goalAddOn: number
  money: number
  moneyDisplay: number
  highScore: number
  highLevel: number
  timeLeft: number
  strength: number
  dynamite: number
  hasStrengthDrink: boolean
  hasLuckyClover: boolean
  hasRockCollectorsBook: boolean
  hasGemPolish: boolean
  currentBonus: number | null
  strengthMessageTimer: number
  items: MineEntity[]
  hook: HookState
  shopItems: ShopItem[]
  shopSelection: number
  shopFinishing: boolean
  shopBoughtAnything: boolean
  shopMessage: 'default' | 'poor' | 'thanks' | 'sad'
  explosions: Explosion[]
  randomSeed: number
  nextExplosionId: number
  hasShownFirstGoal: boolean
}

export type GameSnapshot = Pick<
  GameState,
  | 'phase'
  | 'menuSelection'
  | 'goalKind'
  | 'level'
  | 'goal'
  | 'money'
  | 'moneyDisplay'
  | 'highScore'
  | 'highLevel'
  | 'dynamite'
  | 'shopItems'
  | 'shopSelection'
  | 'shopFinishing'
> & {
  timeLeft: number
  canLaunch: boolean
  canUseDynamite: boolean
}

type EntityConfig = {
  width: number
  height: number
  mass: number
  bonus: number
}

const ENTITY_CONFIG: Record<EntityType, EntityConfig> = {
  MiniGold: { width: 10, height: 8, mass: 2, bonus: 50 },
  NormalGold: { width: 15, height: 13, mass: 3.5, bonus: 100 },
  NormalGoldPlus: { width: 20, height: 18, mass: 5, bonus: 250 },
  BigGold: { width: 32, height: 29, mass: 7, bonus: 500 },
  MiniRock: { width: 15, height: 11, mass: 5.5, bonus: 11 },
  NormalRock: { width: 22, height: 19, mass: 7, bonus: 20 },
  BigRock: { width: 32, height: 28, mass: 10, bonus: 100 },
  Diamond: { width: 10, height: 8, mass: 1.5, bonus: 600 },
  QuestionBag: { width: 20, height: 23, mass: 1, bonus: 50 },
  Mole: { width: 18, height: 13, mass: 1.5, bonus: 2 },
  MoleWithDiamond: { width: 18, height: 13, mass: 1.5, bonus: 602 },
  Skull: { width: 18, height: 17, mass: 2, bonus: 20 },
  Bone: { width: 20, height: 13, mass: 3, bonus: 7 },
  TNT: { width: 26, height: 33, mass: 1, bonus: 2 },
}

export const SHOP_ITEM_IDS: readonly ShopItemId[] = [
  'Dynamite',
  'StrengthDrink',
  'LuckyClover',
  'RockCollectorsBook',
  'GemPolish',
]

function random(state: GameState): number {
  state.randomSeed = (Math.imul(state.randomSeed, 1664525) + 1013904223) >>> 0
  return state.randomSeed / 4294967296
}

function randomInt(state: GameState, maximum: number): number {
  return Math.floor(random(state) * maximum) + 1
}

function resetHook(state: GameState): void {
  state.hook.angle = HOOK_MAX_ANGLE
  state.hook.rotateRight = true
  state.hook.length = 0
  state.hook.mode = 'swinging'
  state.hook.attachedItemId = null
  state.hook.bonusTimer = 1
  state.hook.pendingDisplayValue = 0
  state.currentBonus = null
}

function clearRoundBoosts(state: GameState): void {
  state.strength = 1
  state.hasStrengthDrink = false
  state.hasLuckyClover = false
  state.hasRockCollectorsBook = false
  state.hasGemPolish = false
}

function entityCenter(entity: MineEntity): { x: number; y: number } {
  return {
    x: entity.x + entity.width / 2,
    y: entity.y + entity.height / 2,
  }
}

function entityRadius(entity: MineEntity): number {
  return (entity.width / 2 + entity.height / 2) / 2
}

function createEntity(
  state: GameState,
  type: EntityType,
  x: number,
  y: number,
  direction: EntityDirection | undefined,
  index: number
): MineEntity {
  const config = ENTITY_CONFIG[type]
  const entity: MineEntity = {
    id: `${state.realLevelId}-${index}-${type}`,
    type,
    x,
    y,
    width: config.width,
    height: config.height,
    mass: config.mass,
    bonus: config.bonus,
    active: true,
    attached: false,
    direction,
    movementDirection: direction === 'Left' ? -1 : 1,
    movementStartX: x,
  }

  if (type === 'QuestionBag') {
    entity.mass = randomInt(state, 9)
    entity.bonus = randomInt(state, 16) * 50
    entity.extraEffectChance = 0.2
  }
  return entity
}

function loadCurrentLevel(state: GameState): void {
  const definition = LEVEL_DATA[state.realLevelId] ?? LEVEL_DATA.L1_1
  state.theme = definition.theme
  state.items = definition.items.map(([type, x, y, direction], index) =>
    createEntity(state, type, x, y, direction, index)
  )
}

function updateGoal(state: GameState): void {
  if (state.level > 1 && state.level <= 9) state.goalAddOn += 270
  state.goal += state.goalAddOn
}

function enterGoal(state: GameState): void {
  state.phase = 'goal'
  state.goalKind = state.hasShownFirstGoal ? 'next' : 'first'
  state.hasShownFirstGoal = true
  updateGoal(state)
  state.screenTimer = GOAL_SCREEN_DURATION
}

function enterPlaying(state: GameState): void {
  state.phase = 'playing'
  state.timeLeft = ROUND_DURATION
  state.moneyDisplay = state.money
  state.currentBonus = null
  state.strengthMessageTimer = 0
  state.explosions = []
  resetHook(state)
  loadCurrentLevel(state)
}

function shopPrice(state: GameState, itemId: ShopItemId): number {
  if (itemId === 'Dynamite') return randomInt(state, 300) + 1 + state.level * 2
  if (itemId === 'StrengthDrink') return randomInt(state, 300) + 100
  if (itemId === 'LuckyClover') {
    return randomInt(state, state.level * 50) + 1 + state.level * 2
  }
  if (itemId === 'RockCollectorsBook') return randomInt(state, 150) + 1
  return randomInt(state, state.level * 100) + 201
}

function enterShop(state: GameState): void {
  state.phase = 'shop'
  state.shopItems = []
  for (let index = 0; index < SHOP_ITEM_IDS.length; index += 1) {
    const itemId = SHOP_ITEM_IDS[index]
    const price = shopPrice(state, itemId)
    if (randomInt(state, 3) >= 2) {
      state.shopItems.push({ id: itemId, price, slot: index })
    }
  }
  if (state.shopItems.length === 0) {
    state.shopItems.push({
      id: 'Dynamite',
      price: shopPrice(state, 'Dynamite'),
      slot: 0,
    })
  }
  state.shopSelection = 0
  state.shopFinishing = false
  state.shopBoughtAnything = false
  state.shopMessage = 'default'
  state.screenTimer = SHOP_FINISH_DURATION
}

function enterMadeGoal(state: GameState): void {
  clearRoundBoosts(state)
  state.phase = 'made-goal'
  state.level += 1
  const realLevel = state.level <= 3 ? state.level : ((state.level - 3) % 7) + 3
  state.realLevelId = `L${realLevel}_${randomInt(state, 3)}`
  state.screenTimer = MADE_GOAL_DURATION
}

function enterGameOver(state: GameState): void {
  clearRoundBoosts(state)
  state.phase = 'game-over'
  state.timeLeft = 0
  resetHook(state)
}

function attachedEntity(state: GameState): MineEntity | undefined {
  const attachedItemId = state.hook.attachedItemId
  if (!attachedItemId) return undefined
  return state.items.find((item) => item.id === attachedItemId)
}

function applyCatchEffects(state: GameState, entity: MineEntity): void {
  if (state.hasStrengthDrink) entity.mass /= 1.5
  if (state.hasLuckyClover && entity.type === 'QuestionBag') {
    entity.extraEffectChance = (entity.extraEffectChance ?? 0.2) * 2
  }
  if (
    state.hasRockCollectorsBook &&
    (entity.type === 'MiniRock' ||
      entity.type === 'NormalRock' ||
      entity.type === 'BigRock')
  ) {
    entity.bonus *= 3
  }
  if (state.hasGemPolish && entity.type === 'Diamond') entity.bonus *= 1.5
  if (state.hasGemPolish && entity.type === 'MoleWithDiamond') {
    entity.bonus = (entity.bonus - ENTITY_CONFIG.Mole.bonus) * 1.5 + 2
  }
}

function addExplosion(state: GameState, x: number, y: number): void {
  state.explosions.push({
    id: state.nextExplosionId,
    x,
    y,
    timeLeft: EXPLOSION_DURATION,
  })
  state.nextExplosionId += 1
}

function explodeAround(
  state: GameState,
  source: MineEntity,
  centerX: number,
  centerY: number
): void {
  const pendingCenters = [{ x: centerX, y: centerY }]
  const explodedTntIds = new Set<string>([source.id])

  while (pendingCenters.length > 0) {
    const center = pendingCenters.shift()
    if (!center) break
    addExplosion(state, center.x, center.y)

    for (const entity of state.items) {
      if (!entity.active || entity.id === source.id) continue
      const candidateCenter = entityCenter(entity)
      const xDistance = candidateCenter.x - center.x
      const yDistance = candidateCenter.y - center.y
      const catchDistance = EXPLOSION_RADIUS + entityRadius(entity)
      if (xDistance * xDistance + yDistance * yDistance > catchDistance ** 2) {
        continue
      }

      entity.active = false
      if (entity.type === 'TNT' && !explodedTntIds.has(entity.id)) {
        explodedTntIds.add(entity.id)
        pendingCenters.push(candidateCenter)
      }
    }
  }
}

function resolveQuestionBag(state: GameState, entity: MineEntity): boolean {
  if (entity.type !== 'QuestionBag') return false
  if (random(state) > (entity.extraEffectChance ?? 0.2)) return false

  if (random(state) <= 0.2) {
    state.dynamite = Math.min(12, state.dynamite + 1)
  } else {
    state.strength = Math.min(6, state.strength * 1.5 + 1)
    state.strengthMessageTimer = 1
  }
  return true
}

function resolveCaughtEntity(state: GameState, entity: MineEntity): void {
  const hadExtraEffect = resolveQuestionBag(state, entity)
  if (!hadExtraEffect) {
    state.money += entity.bonus
    state.currentBonus = entity.bonus
    state.hook.pendingDisplayValue = entity.bonus
  }
  state.hook.mode = 'bonus'
  state.hook.bonusTimer = 1
}

function updateHook(state: GameState, delta: number): void {
  if (state.hook.mode === 'bonus') {
    state.hook.bonusTimer -= delta
    if (state.hook.bonusTimer > 0) return

    const entity = attachedEntity(state)
    if (entity) entity.active = false
    state.moneyDisplay += state.hook.pendingDisplayValue
    resetHook(state)
    return
  }

  if (state.hook.mode === 'swinging') {
    if (Math.abs(state.hook.angle - HOOK_MAX_ANGLE) < 1) {
      state.hook.rotateRight = true
    }
    if (Math.abs(state.hook.angle - HOOK_MIN_ANGLE) < 1) {
      state.hook.rotateRight = false
    }
    state.hook.angle +=
      (state.hook.rotateRight ? -1 : 1) * HOOK_ROTATE_SPEED * delta
    state.hook.angle = Math.max(
      HOOK_MIN_ANGLE,
      Math.min(HOOK_MAX_ANGLE, state.hook.angle)
    )
    return
  }

  if (state.hook.mode === 'extending') {
    state.hook.length += HOOK_GRAB_SPEED * delta
    if (state.hook.length >= HOOK_MAX_LENGTH) {
      state.hook.length = HOOK_MAX_LENGTH
      state.hook.mode = 'retracting'
    }
    return
  }

  const entity = attachedEntity(state)
  const retractSpeed = entity
    ? (HOOK_GRAB_SPEED * state.strength) / entity.mass
    : HOOK_GRAB_SPEED
  state.hook.length -= retractSpeed * delta
  if (state.hook.length > 0) return

  state.hook.length = 0
  if (entity) {
    resolveCaughtEntity(state, entity)
  } else {
    resetHook(state)
  }
}

function updateEntities(state: GameState, delta: number): void {
  const hookCenter = hookCollisionCenter(state)
  for (const entity of state.items) {
    if (!entity.active) continue

    if (
      !entity.attached &&
      (entity.type === 'Mole' || entity.type === 'MoleWithDiamond')
    ) {
      entity.x += entity.movementDirection * delta
      if (Math.abs(entity.x - entity.movementStartX) >= 135) {
        entity.movementDirection *= -1
      }
    }

    if (entity.attached) continue
    if (state.hook.mode !== 'extending' || state.hook.attachedItemId) continue

    const center = entityCenter(entity)
    const xDistance = center.x - hookCenter.x
    const yDistance = center.y - hookCenter.y
    const catchDistance = entityRadius(entity) + HOOK_COLLISION_RADIUS
    if (xDistance * xDistance + yDistance * yDistance > catchDistance ** 2) {
      continue
    }

    applyCatchEffects(state, entity)
    entity.attached = true
    state.hook.attachedItemId = entity.id
    state.hook.mode = 'retracting'
    if (entity.type === 'TNT') explodeAround(state, entity, center.x, center.y)
  }
}

function updateExplosions(state: GameState, delta: number): void {
  for (const explosion of state.explosions) explosion.timeLeft -= delta
  state.explosions = state.explosions.filter((effect) => effect.timeLeft > 0)
  state.strengthMessageTimer = Math.max(0, state.strengthMessageTimer - delta)
}

function resetRunForMenu(state: GameState): void {
  const nextState = createGameState(
    state.highScore,
    state.highLevel,
    state.randomSeed
  )
  Object.assign(state, nextState)
}

export function createGameState(
  highScore = 0,
  highLevel = 1,
  seed = Date.now()
): GameState {
  return {
    phase: 'menu',
    menuSelection: 'start',
    goalKind: 'first',
    screenTimer: 0,
    level: 1,
    realLevelId: 'L1_1',
    theme: 'LevelB',
    goal: 375,
    goalAddOn: 275,
    money: 0,
    moneyDisplay: 0,
    highScore,
    highLevel,
    timeLeft: ROUND_DURATION,
    strength: 1,
    dynamite: 0,
    hasStrengthDrink: false,
    hasLuckyClover: false,
    hasRockCollectorsBook: false,
    hasGemPolish: false,
    currentBonus: null,
    strengthMessageTimer: 0,
    items: [],
    hook: {
      angle: HOOK_MAX_ANGLE,
      rotateRight: true,
      length: 0,
      mode: 'swinging',
      attachedItemId: null,
      bonusTimer: 1,
      pendingDisplayValue: 0,
    },
    shopItems: [],
    shopSelection: 0,
    shopFinishing: false,
    shopBoughtAnything: false,
    shopMessage: 'default',
    explosions: [],
    randomSeed: seed >>> 0,
    nextExplosionId: 1,
    hasShownFirstGoal: false,
  }
}

export function snapshotGameState(state: GameState): GameSnapshot {
  return {
    phase: state.phase,
    menuSelection: state.menuSelection,
    goalKind: state.goalKind,
    level: state.level,
    goal: state.goal,
    money: state.money,
    moneyDisplay: state.moneyDisplay,
    highScore: state.highScore,
    highLevel: state.highLevel,
    dynamite: state.dynamite,
    shopItems: state.shopItems.map((item) => ({ ...item })),
    shopSelection: state.shopSelection,
    shopFinishing: state.shopFinishing,
    timeLeft: Math.max(0, Math.floor(state.timeLeft)),
    canLaunch: state.phase === 'playing' && state.hook.mode === 'swinging',
    canUseDynamite:
      state.phase === 'playing' &&
      state.dynamite > 0 &&
      state.hook.attachedItemId !== null &&
      state.hook.mode === 'retracting',
  }
}

export function hookTip(state: GameState): { x: number; y: number } {
  const radians = (state.hook.angle * Math.PI) / 180
  return {
    x: HOOK_ORIGIN_X - Math.sin(radians) * state.hook.length,
    y: HOOK_ORIGIN_Y + Math.cos(radians) * state.hook.length,
  }
}

export function hookCollisionCenter(state: GameState): {
  x: number
  y: number
} {
  const radians = (state.hook.angle * Math.PI) / 180
  return {
    x: HOOK_ORIGIN_X - Math.sin(radians) * (state.hook.length + 13),
    y: HOOK_ORIGIN_Y + Math.cos(radians) * (state.hook.length + 13),
  }
}

export function moveMenuSelection(state: GameState, direction: -1 | 1): void {
  if (state.phase !== 'menu') return
  state.menuSelection = direction < 0 ? 'start' : 'high-score'
}

export function activateMenuSelection(state: GameState): void {
  if (state.phase !== 'menu') return
  if (state.menuSelection === 'high-score') {
    state.phase = 'high-score'
    return
  }
  enterGoal(state)
}

export function launchHook(state: GameState): void {
  if (state.phase !== 'playing' || state.hook.mode !== 'swinging') return
  state.hook.mode = 'extending'
}

export function detonateCaughtEntity(state: GameState): boolean {
  if (
    state.phase !== 'playing' ||
    state.dynamite <= 0 ||
    state.hook.mode !== 'retracting'
  ) {
    return false
  }

  const entity = attachedEntity(state)
  if (!entity) return false
  const center = hookCollisionCenter(state)
  entity.active = false
  entity.attached = false
  state.hook.attachedItemId = null
  state.dynamite -= 1
  addExplosion(state, center.x, center.y)
  return true
}

export function skipCompletedLevel(state: GameState): void {
  if (state.phase === 'playing' && state.money >= state.goal) {
    enterMadeGoal(state)
  }
}

export function moveShopSelection(state: GameState, direction: -1 | 1): void {
  if (state.phase !== 'shop' || state.shopFinishing) return
  const lastIndex = Math.max(0, state.shopItems.length - 1)
  state.shopSelection = Math.max(
    0,
    Math.min(lastIndex, state.shopSelection + direction)
  )
  state.shopMessage = 'default'
}

export function buySelectedShopItem(state: GameState): boolean {
  if (state.phase !== 'shop' || state.shopFinishing) return false
  const item = state.shopItems[state.shopSelection]
  if (!item) return false
  if (state.money < item.price) {
    state.shopMessage = 'poor'
    return false
  }

  state.money -= item.price
  state.moneyDisplay -= item.price
  state.shopBoughtAnything = true
  if (item.id === 'Dynamite') state.dynamite = Math.min(12, state.dynamite + 1)
  if (item.id === 'StrengthDrink') state.hasStrengthDrink = true
  if (item.id === 'LuckyClover') state.hasLuckyClover = true
  if (item.id === 'RockCollectorsBook') state.hasRockCollectorsBook = true
  if (item.id === 'GemPolish') state.hasGemPolish = true

  state.shopItems.splice(state.shopSelection, 1)
  state.shopSelection = 0
  state.shopMessage = 'default'
  if (state.shopItems.length === 0) finishShopping(state)
  return true
}

export function finishShopping(state: GameState): void {
  if (state.phase !== 'shop' || state.shopFinishing) return
  state.shopFinishing = true
  state.shopMessage = state.shopBoughtAnything ? 'thanks' : 'sad'
  state.screenTimer = SHOP_FINISH_DURATION
}

export function continueFromResult(state: GameState): void {
  if (state.phase === 'high-score' || state.phase === 'new-high-score') {
    resetRunForMenu(state)
    return
  }
  if (state.phase !== 'game-over') return

  if (state.money > state.highScore) {
    state.highScore = state.money
    state.highLevel = state.level
    state.phase = 'new-high-score'
  } else {
    resetRunForMenu(state)
  }
}

export function returnToMenu(state: GameState): void {
  resetRunForMenu(state)
}

export function advanceGame(state: GameState, deltaSeconds: number): void {
  const delta = Math.max(0, Math.min(0.05, deltaSeconds))
  if (state.phase === 'goal') {
    state.screenTimer -= delta
    if (state.screenTimer <= 0) enterPlaying(state)
    return
  }
  if (state.phase === 'made-goal') {
    state.screenTimer -= delta
    if (state.screenTimer <= 0) enterShop(state)
    return
  }
  if (state.phase === 'shop' && state.shopFinishing) {
    state.screenTimer -= delta
    if (state.screenTimer <= 0) enterGoal(state)
    return
  }
  if (state.phase !== 'playing') return

  state.timeLeft -= delta
  if (state.timeLeft <= 0) {
    if (state.money >= state.goal) enterMadeGoal(state)
    else enterGameOver(state)
    return
  }

  updateHook(state, delta)
  updateEntities(state, delta)
  updateExplosions(state, delta)
}
