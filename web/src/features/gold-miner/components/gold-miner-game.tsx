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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { drawGame, type GoldMinerCopy } from '../lib/draw-game'
import { GOLD_MINER_ASSET_SCALE, loadGoldMinerAssets } from '../lib/game-assets'
import { getGameDisplayMetrics } from '../lib/game-display'
import {
  activateMenuSelection,
  advanceGame,
  buySelectedShopItem,
  continueFromResult,
  createGameState,
  detonateCaughtEntity,
  finishShopping,
  GAME_HEIGHT,
  GAME_WIDTH,
  launchHook,
  moveMenuSelection,
  moveShopSelection,
  returnToMenu,
  skipCompletedLevel,
  snapshotGameState,
  type GameState,
} from '../lib/game-engine'

const HIGH_SCORE_STORAGE_KEY = 'gold-miner-high-score'

type StoredHighScore = {
  score: number
  level: number
}

type GoldMinerGameProps = {
  autoStart?: boolean
}

function readStoredHighScore(): StoredHighScore {
  try {
    const stored = window.localStorage.getItem(HIGH_SCORE_STORAGE_KEY)
    if (!stored) return { score: 0, level: 1 }
    const parsed = JSON.parse(stored) as Partial<StoredHighScore>
    if (
      typeof parsed.score !== 'number' ||
      typeof parsed.level !== 'number' ||
      parsed.score < 0 ||
      parsed.level < 1
    ) {
      return { score: 0, level: 1 }
    }
    return { score: parsed.score, level: parsed.level }
  } catch {
    return { score: 0, level: 1 }
  }
}

function createInitialState(): GameState {
  const stored = readStoredHighScore()
  return createGameState(stored.score, stored.level)
}

export function GoldMinerGame(props: GoldMinerGameProps) {
  const { t } = useTranslation()
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<GameState>(createInitialState())
  const [snapshot, setSnapshot] = useState(() =>
    snapshotGameState(gameRef.current)
  )

  const copy = useMemo<GoldMinerCopy>(
    () => ({
      startGame: t('Start Game'),
      highScore: t('High Score'),
      referenceCredit: t('Reference: GoldMiner-Rebirth by Lazy_V.'),
      firstGoal: t('Your First Goal is'),
      nextGoal: t('Your Next Goal is'),
      madeGoal: t('You made it to\nthe next Level!'),
      money: t('Money'),
      goal: t('Goal'),
      time: t('Time'),
      level: t('Level'),
      skip: t('Press Space to Skip'),
      gameOver: t("You didn't reach the goal!"),
      newHighScore: t('New High Score:'),
      atLevel: t('at Level'),
      shopDefault: t(
        'Press Left and Right to select.\nPress Enter to buy.\nPress Space when you are ready.'
      ),
      shopPoor: t("You don't seem to have any money\n:("),
      shopThanks: t('Thank you for your patronage!\nGood luck!'),
      shopSad: ':(',
      shopDescriptions: {
        Dynamite: t(
          'After you grab something, press Up to throw dynamite and blow it up.'
        ),
        StrengthDrink: t(
          'The miner reels objects faster on the next level. Lasts one level.'
        ),
        LuckyClover: t(
          'Increases the chance of a good grab bag reward next level.'
        ),
        RockCollectorsBook: t(
          'Rocks are worth three times as much on the next level.'
        ),
        GemPolish: t('Gems and diamonds are worth more on the next level.'),
      },
    }),
    [t]
  )
  const copyRef = useRef(copy)
  copyRef.current = copy

  const syncSnapshot = useCallback(() => {
    const nextSnapshot = snapshotGameState(gameRef.current)
    setSnapshot(nextSnapshot)
    try {
      window.localStorage.setItem(
        HIGH_SCORE_STORAGE_KEY,
        JSON.stringify({
          score: nextSnapshot.highScore,
          level: nextSnapshot.highLevel,
        })
      )
    } catch {
      /* The game remains playable when browser storage is unavailable. */
    }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    const canvas = canvasRef.current
    const displayContext = canvas?.getContext('2d')
    if (!host || !canvas || !displayContext) return

    const gameCanvas = document.createElement('canvas')
    gameCanvas.width = GAME_WIDTH * GOLD_MINER_ASSET_SCALE
    gameCanvas.height = GAME_HEIGHT * GOLD_MINER_ASSET_SCALE
    const gameContext = gameCanvas.getContext('2d')
    if (!gameContext) return
    gameContext.setTransform(
      GOLD_MINER_ASSET_SCALE,
      0,
      0,
      GOLD_MINER_ASSET_SCALE,
      0,
      0
    )

    let frameId = 0
    let cancelled = false
    const presentFrame = () => {
      displayContext.imageSmoothingEnabled = true
      displayContext.imageSmoothingQuality = 'high'
      displayContext.clearRect(0, 0, canvas.width, canvas.height)
      displayContext.drawImage(gameCanvas, 0, 0, canvas.width, canvas.height)
    }
    const resizeCanvas = () => {
      const bounds = host.getBoundingClientRect()
      const metrics = getGameDisplayMetrics(
        bounds.width,
        bounds.height,
        window.devicePixelRatio
      )
      canvas.style.width = `${metrics.cssWidth}px`
      canvas.style.height = `${metrics.cssHeight}px`
      if (
        canvas.width !== metrics.pixelWidth ||
        canvas.height !== metrics.pixelHeight
      ) {
        canvas.width = metrics.pixelWidth
        canvas.height = metrics.pixelHeight
      }
      presentFrame()
    }

    const resizeObserver = new ResizeObserver(resizeCanvas)
    resizeObserver.observe(host)
    window.addEventListener('resize', resizeCanvas)
    resizeCanvas()

    gameContext.fillStyle = '#000000'
    gameContext.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT)
    presentFrame()

    void loadGoldMinerAssets()
      .then((assets) => {
        if (cancelled) return
        if (props.autoStart && gameRef.current.phase === 'menu') {
          activateMenuSelection(gameRef.current)
          syncSnapshot()
        }
        canvas.focus()
        let previousTime = performance.now()
        let previousSnapshotTime = previousTime
        const renderFrame = (time: number) => {
          const previousPhase = gameRef.current.phase
          advanceGame(gameRef.current, (time - previousTime) / 1000)
          previousTime = time
          drawGame(gameContext, gameRef.current, time, copyRef.current, assets)
          presentFrame()

          if (
            previousPhase !== gameRef.current.phase ||
            time - previousSnapshotTime >= 100
          ) {
            previousSnapshotTime = time
            syncSnapshot()
          }
          frameId = requestAnimationFrame(renderFrame)
        }

        drawGame(
          gameContext,
          gameRef.current,
          previousTime,
          copyRef.current,
          assets
        )
        presentFrame()
        frameId = requestAnimationFrame(renderFrame)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      window.removeEventListener('resize', resizeCanvas)
    }
  }, [props.autoStart, syncSnapshot])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      const state = gameRef.current

      if (event.code === 'Escape') {
        event.preventDefault()
        returnToMenu(state)
        syncSnapshot()
        return
      }

      if (state.phase === 'menu') {
        if (event.code === 'ArrowUp' || event.code === 'ArrowDown') {
          event.preventDefault()
          moveMenuSelection(state, event.code === 'ArrowUp' ? -1 : 1)
        } else if (
          event.code === 'Enter' ||
          event.code === 'KeyJ' ||
          event.code === 'KeyK'
        ) {
          event.preventDefault()
          activateMenuSelection(state)
        }
        syncSnapshot()
        return
      }

      if (state.phase === 'playing') {
        if (
          event.code === 'ArrowDown' ||
          event.code === 'KeyJ' ||
          event.code === 'KeyK'
        ) {
          event.preventDefault()
          launchHook(state)
        } else if (
          event.code === 'ArrowUp' ||
          event.code === 'KeyU' ||
          event.code === 'KeyI'
        ) {
          event.preventDefault()
          detonateCaughtEntity(state)
        } else if (event.code === 'Space') {
          event.preventDefault()
          skipCompletedLevel(state)
        }
        syncSnapshot()
        return
      }

      if (state.phase === 'shop') {
        if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
          event.preventDefault()
          moveShopSelection(state, event.code === 'ArrowLeft' ? -1 : 1)
        } else if (
          event.code === 'Enter' ||
          event.code === 'KeyJ' ||
          event.code === 'KeyK'
        ) {
          event.preventDefault()
          buySelectedShopItem(state)
        } else if (event.code === 'Space') {
          event.preventDefault()
          finishShopping(state)
        }
        syncSnapshot()
        return
      }

      if (
        state.phase === 'game-over' ||
        state.phase === 'high-score' ||
        state.phase === 'new-high-score'
      ) {
        event.preventDefault()
        continueFromResult(state)
        syncSnapshot()
      }
    }

    canvas.addEventListener('keydown', handleKeyDown)
    return () => canvas.removeEventListener('keydown', handleKeyDown)
  }, [syncSnapshot])

  const handlePointerDown = () => {
    canvasRef.current?.focus()
    const state = gameRef.current
    if (state.phase === 'menu') activateMenuSelection(state)
    else if (state.phase === 'playing') launchHook(state)
    else if (state.phase === 'shop') buySelectedShopItem(state)
    else if (
      state.phase === 'game-over' ||
      state.phase === 'high-score' ||
      state.phase === 'new-high-score'
    ) {
      continueFromResult(state)
    }
    syncSnapshot()
  }

  return (
    <div
      ref={hostRef}
      className='flex size-full min-h-0 min-w-0 items-center justify-center overflow-hidden bg-black'
      data-testid='gold-miner-game'
    >
      <canvas
        ref={canvasRef}
        width={GAME_WIDTH}
        height={GAME_HEIGHT}
        tabIndex={0}
        aria-label={t('Gold Miner game area')}
        aria-describedby='gold-miner-status'
        onPointerDown={handlePointerDown}
        className='block max-h-full max-w-full cursor-pointer outline-none'
      />
      <span id='gold-miner-status' className='sr-only' aria-live='polite'>
        {t('Level')} {snapshot.level}. {t('Money')} {snapshot.moneyDisplay}.{' '}
        {t('Goal')} {snapshot.goal}. {t('Time')} {snapshot.timeLeft}.
      </span>
    </div>
  )
}
