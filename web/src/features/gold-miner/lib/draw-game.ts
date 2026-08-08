import { GOLD_MINER_ASSET_SCALE, type GoldMinerAssets } from './game-assets'
import {
  GAME_HEIGHT,
  GAME_WIDTH,
  HOOK_ORIGIN_X,
  HOOK_ORIGIN_Y,
  hookCollisionCenter,
  hookTip,
  type GameState,
  type MineEntity,
  type ShopItemId,
} from './game-engine'
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
import type { EntityType } from './level-data'

export type GoldMinerCopy = {
  startGame: string
  highScore: string
  referenceCredit: string
  firstGoal: string
  nextGoal: string
  madeGoal: string
  money: string
  goal: string
  time: string
  level: string
  skip: string
  gameOver: string
  newHighScore: string
  atLevel: string
  shopDefault: string
  shopPoor: string
  shopThanks: string
  shopSad: string
  shopDescriptions: Record<ShopItemId, string>
}

type TextOptions = {
  color?: string
  size?: number
  family?: 'game' | 'info' | 'ui'
  align?: CanvasTextAlign
}

const YELLOW = '#ffd621'
const ORANGE = '#ef6c00'
const DEEP_ORANGE = '#c28804'
const GREEN = '#43a047'
const BLACK = '#000000'

function assetWidth(image: HTMLImageElement): number {
  return image.naturalWidth / GOLD_MINER_ASSET_SCALE
}

function assetHeight(image: HTMLImageElement): number {
  return image.naturalHeight / GOLD_MINER_ASSET_SCALE
}

function drawAsset(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width = assetWidth(image),
  height = assetHeight(image)
): void {
  ctx.drawImage(image, x, y, width, height)
}

function drawText(
  ctx: CanvasRenderingContext2D,
  content: string,
  x: number,
  y: number,
  options: TextOptions = {}
): void {
  const family = options.family ?? 'game'
  let fontFamily = 'GoldMinerGame'
  if (family === 'ui') fontFamily = 'GoldMinerUI'
  else if (family === 'info') fontFamily = 'GoldMinerInfo'
  ctx.save()
  ctx.font = `${options.size ?? 10}px "${fontFamily}", monospace`
  ctx.textAlign = options.align ?? 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = options.color ?? YELLOW
  ctx.fillText(content, x, y)
  ctx.restore()
}

function drawMultilineText(
  ctx: CanvasRenderingContext2D,
  content: string,
  x: number,
  y: number,
  options: TextOptions & { lineHeight?: number } = {}
): void {
  const lineHeight = options.lineHeight ?? (options.size ?? 10) + 1
  for (const [index, line] of content.split('\n').entries()) {
    drawText(ctx, line, x, y + index * lineHeight, options)
  }
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  frameWidth: number,
  frameHeight: number,
  frameIndex: number,
  x: number,
  y: number,
  options: {
    rotation?: number
    originX?: number
    originY?: number
    flipX?: boolean
  } = {}
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(options.rotation ?? 0)
  ctx.scale(options.flipX ? -1 : 1, 1)
  ctx.drawImage(
    image,
    frameIndex * frameWidth * GOLD_MINER_ASSET_SCALE,
    0,
    frameWidth * GOLD_MINER_ASSET_SCALE,
    frameHeight * GOLD_MINER_ASSET_SCALE,
    -(options.originX ?? 0),
    -(options.originY ?? 0),
    frameWidth,
    frameHeight
  )
  ctx.restore()
}

function drawMenu(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  copy: GoldMinerCopy,
  assets: GoldMinerAssets
): void {
  drawAsset(ctx, assets.bgStartMenu, 0, 0)
  const arrowY = state.menuSelection === 'start' ? 152 : 172
  drawAsset(ctx, assets.menuArrow, 0, arrowY)
  drawText(ctx, copy.startGame, 30, 150, {
    color: YELLOW,
    size: 20,
    family: 'ui',
  })
  drawText(ctx, copy.highScore, 30, 170, {
    color: YELLOW,
    size: 20,
    family: 'ui',
  })
  drawText(ctx, copy.referenceCredit, 75, 225, {
    color: YELLOW,
    size: 10,
    family: 'info',
  })
}

function drawGoalScreen(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  copy: GoldMinerCopy,
  assets: GoldMinerAssets
): void {
  drawAsset(ctx, assets.bgGoal, 0, 0)
  drawAsset(ctx, assets.title, (GAME_WIDTH - assetWidth(assets.title)) / 2, 20)
  drawAsset(ctx, assets.panel, (GAME_WIDTH - assetWidth(assets.panel)) / 2, 80)

  if (state.phase === 'made-goal') {
    drawMultilineText(ctx, copy.madeGoal, 90, 110, {
      color: YELLOW,
      size: 20,
      family: 'ui',
      lineHeight: 21,
    })
    return
  }
  if (state.phase === 'game-over') {
    drawText(ctx, copy.gameOver, 50, 130, {
      color: YELLOW,
      size: 20,
      family: 'ui',
    })
    return
  }
  if (state.phase === 'high-score' || state.phase === 'new-high-score') {
    const heading =
      state.phase === 'new-high-score' ? copy.newHighScore : copy.highScore
    drawText(ctx, heading, 70, 100, {
      color: YELLOW,
      size: 20,
      family: 'ui',
    })
    drawText(ctx, `$${Math.round(state.highScore)}`, 70, 140, {
      color: GREEN,
      size: 20,
      family: 'ui',
    })
    drawText(ctx, `${copy.atLevel} ${state.highLevel}`, 130, 140, {
      color: YELLOW,
      size: 20,
      family: 'ui',
    })
    return
  }

  const heading = state.goalKind === 'first' ? copy.firstGoal : copy.nextGoal
  drawText(ctx, heading, 70, 100, {
    color: YELLOW,
    size: 20,
    family: 'ui',
  })
  drawText(ctx, `$${Math.round(state.goal)}`, 70, 140, {
    color: GREEN,
    size: 20,
    family: 'ui',
  })
}

function levelBackground(
  state: GameState,
  assets: GoldMinerAssets
): HTMLImageElement {
  if (state.theme === 'LevelA') return assets.bgLevelA
  if (state.theme === 'LevelB') return assets.bgLevelB
  if (state.theme === 'LevelC') return assets.bgLevelC
  if (state.theme === 'LevelD') return assets.bgLevelD
  return assets.bgLevelE
}

function entityImage(
  type: EntityType,
  assets: GoldMinerAssets
): HTMLImageElement | undefined {
  if (type === 'MiniGold') return assets.goldMini
  if (type === 'NormalGold') return assets.goldNormal
  if (type === 'NormalGoldPlus') return assets.goldNormalPlus
  if (type === 'BigGold') return assets.goldBig
  if (type === 'MiniRock') return assets.rockMini
  if (type === 'NormalRock') return assets.rockNormal
  if (type === 'BigRock') return assets.rockBig
  if (type === 'Diamond') return assets.diamond
  if (type === 'QuestionBag') return assets.questionBag
  if (type === 'Skull') return assets.skull
  if (type === 'Bone') return assets.bone
  if (type === 'TNT') return assets.tnt
  return undefined
}

function drawEntity(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  entity: MineEntity,
  time: number,
  assets: GoldMinerAssets
): void {
  if (!entity.active) return
  const isMole = entity.type === 'Mole' || entity.type === 'MoleWithDiamond'
  const center = hookCollisionCenter(state)
  const drawX = entity.attached ? center.x : entity.x
  const drawY = entity.attached ? center.y : entity.y
  const rotation = entity.attached ? (state.hook.angle * Math.PI) / 180 : 0
  const originX = entity.attached ? entity.width / 2 : 0
  const originY = entity.attached ? entity.height / 3 : 0

  if (isMole) {
    const sheet =
      entity.type === 'Mole' ? assets.moleSheet : assets.moleWithDiamondSheet
    const frame = Math.floor(time / 150) % 7
    drawFrame(ctx, sheet, 18, 13, frame, drawX, drawY, {
      rotation,
      originX,
      originY,
      flipX: !entity.attached && entity.movementDirection < 0,
    })
    return
  }

  const image = entityImage(entity.type, assets)
  if (!image) return
  ctx.save()
  ctx.translate(drawX, drawY)
  ctx.rotate(rotation)
  drawAsset(ctx, image, -originX, -originY)
  ctx.restore()
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  time: number,
  assets: GoldMinerAssets
): void {
  let frame = 0
  if (state.strengthMessageTimer > 0) frame = 6 + (Math.floor(time / 130) % 2)
  else if (state.hook.mode === 'extending') frame = 2
  else if (state.hook.mode === 'retracting') frame = Math.floor(time / 130) % 3
  else if (state.explosions.length > 0 && !state.hook.attachedItemId) {
    frame = 3 + (Math.floor(time / 130) % 3)
  }
  drawFrame(ctx, assets.minerSheet, 32, 40, frame, 165, 39, {
    originX: 16,
    originY: 40,
  })
}

function drawHook(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  assets: GoldMinerAssets
): void {
  const tip = hookTip(state)
  ctx.save()
  ctx.strokeStyle = '#424242'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(HOOK_ORIGIN_X, HOOK_ORIGIN_Y)
  ctx.lineTo(tip.x, tip.y)
  ctx.stroke()
  ctx.restore()

  let frame = 0
  const entity = state.items.find(
    (item) => item.id === state.hook.attachedItemId
  )
  if (entity) {
    const radius = (entity.width / 2 + entity.height / 2) / 2
    frame = radius < 6 ? 2 : 1
  }
  drawFrame(ctx, assets.hookSheet, 13, 15, frame, tip.x, tip.y, {
    rotation: (state.hook.angle * Math.PI) / 180,
    originX: 6.5,
  })
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  copy: GoldMinerCopy,
  assets: GoldMinerAssets
): void {
  drawText(ctx, copy.money, 5, 5, { color: DEEP_ORANGE })
  drawText(ctx, `$${Math.round(state.moneyDisplay)}`, 37, 5, { color: GREEN })
  drawText(ctx, copy.goal, 11, 15, { color: DEEP_ORANGE })
  drawText(ctx, `$${Math.round(state.goal)}`, 35, 15, { color: GREEN })
  drawText(ctx, `${copy.time}:`, 260, 15, { color: DEEP_ORANGE })
  drawText(ctx, String(Math.max(0, Math.floor(state.timeLeft))), 294, 15, {
    color: ORANGE,
  })
  drawText(ctx, `${copy.level}:`, 250, 25, { color: DEEP_ORANGE })
  drawText(ctx, String(state.level), 292, 25, { color: ORANGE })

  if (state.money >= state.goal) {
    drawText(ctx, copy.skip, 200, 5, { color: ORANGE })
  }
  if (state.currentBonus !== null) {
    drawText(ctx, `$${Math.round(state.currentBonus)}`, 90, 18, {
      color: GREEN,
      size: 16,
      family: 'ui',
    })
  }
  if (state.strengthMessageTimer > 0) {
    drawAsset(ctx, assets.strengthText, 80, 10)
  }
  for (let index = 0; index < state.dynamite; index += 1) {
    const row = index >= 6 ? 0 : 1
    const column = index % 6
    drawAsset(ctx, assets.dynamiteUi, 195 + column * 5, row === 0 ? 12 : 22)
  }
}

function drawExplosions(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  assets: GoldMinerAssets
): void {
  for (const explosion of state.explosions) {
    const progress = 1 - explosion.timeLeft / 0.5
    const frame = Math.max(0, Math.min(11, Math.floor(progress * 3)))
    ctx.drawImage(
      assets.biggerExplosion,
      frame * 100 * GOLD_MINER_ASSET_SCALE,
      0,
      100 * GOLD_MINER_ASSET_SCALE,
      100 * GOLD_MINER_ASSET_SCALE,
      explosion.x - 50,
      explosion.y - 50,
      100,
      100
    )
  }
}

function drawPlaying(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  time: number,
  copy: GoldMinerCopy,
  assets: GoldMinerAssets
): void {
  drawAsset(ctx, assets.bgTop, 0, 0)
  drawAsset(ctx, levelBackground(state, assets), 0, 40)
  drawHud(ctx, state, copy, assets)
  drawPlayer(ctx, state, time, assets)
  for (const entity of state.items) {
    drawEntity(ctx, state, entity, time, assets)
  }
  drawHook(ctx, state, assets)
  drawExplosions(ctx, state, assets)
}

function shopItemImage(
  itemId: ShopItemId,
  assets: GoldMinerAssets
): HTMLImageElement {
  if (itemId === 'Dynamite') return assets.dynamite
  if (itemId === 'StrengthDrink') return assets.strengthDrink
  if (itemId === 'LuckyClover') return assets.luckyClover
  if (itemId === 'RockCollectorsBook') return assets.rockCollectorsBook
  return assets.gemPolish
}

function drawShop(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  copy: GoldMinerCopy,
  assets: GoldMinerAssets
): void {
  drawAsset(ctx, assets.bgShop, 0, 0)
  drawAsset(ctx, assets.title, (GAME_WIDTH - assetWidth(assets.title)) / 2, 5)
  drawAsset(ctx, assets.dialogueBubble, 25, 70)

  let message = copy.shopDefault
  if (state.shopMessage === 'poor') message = copy.shopPoor
  else if (state.shopMessage === 'thanks') message = copy.shopThanks
  else if (state.shopMessage === 'sad') message = copy.shopSad
  drawMultilineText(ctx, message, 30, 75, {
    color: BLACK,
    size: 10,
    family: 'game',
    lineHeight: 10,
  })

  const shopkeeperFrame = state.shopMessage === 'sad' ? 1 : 0
  drawFrame(ctx, assets.shopkeeperSheet, 80, 80, shopkeeperFrame, 220, 100)
  drawAsset(ctx, assets.shopTable, 7, 176)

  for (let index = 0; index < state.shopItems.length; index += 1) {
    const item = state.shopItems[index]
    const image = shopItemImage(item.id, assets)
    const itemX = 30 + item.slot * 42
    const imageWidth = assetWidth(image)
    const imageHeight = assetHeight(image)
    drawAsset(ctx, image, itemX - imageWidth / 2, 176 - imageHeight)
    drawText(ctx, `$${item.price}`, Math.trunc(itemX - imageWidth / 2), 179, {
      color: GREEN,
      size: 10,
      family: 'game',
    })
    if (index === state.shopSelection && !state.shopFinishing) {
      drawAsset(
        ctx,
        assets.selector,
        itemX - assetWidth(assets.selector) / 2,
        116
      )
    }
  }

  const selected = state.shopItems[state.shopSelection]
  if (selected && !state.shopFinishing) {
    drawMultilineText(ctx, copy.shopDescriptions[selected.id], 25, 195, {
      color: YELLOW,
      size: 10,
      family: 'info',
      lineHeight: 10,
    })
  }
}

export function drawGame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  time: number,
  copy: GoldMinerCopy,
  assets: GoldMinerAssets
): void {
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT)

  if (state.phase === 'menu') {
    drawMenu(ctx, state, copy, assets)
    return
  }
  if (state.phase === 'shop') {
    drawShop(ctx, state, copy, assets)
    return
  }
  if (state.phase === 'playing') {
    drawPlaying(ctx, state, time, copy, assets)
    return
  }
  drawGoalScreen(ctx, state, copy, assets)
}
