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
const ASSET_ROOT = '/gold-miner/assets'
const IMAGE_ASSET_ROOT = '/gold-miner/assets-hd-v3'

export const GOLD_MINER_ASSET_SCALE = 4

const ASSET_FILES = {
  bgGoal: 'bg_goal.png',
  bgLevelA: 'bg_level_A.png',
  bgLevelB: 'bg_level_B.png',
  bgLevelC: 'bg_level_C.png',
  bgLevelD: 'bg_level_D.png',
  bgLevelE: 'bg_level_E.png',
  bgShop: 'bg_shop.png',
  bgStartMenu: 'bg_start_menu.png',
  bgTop: 'bg_top.png',
  biggerExplosion: 'bigger_explosive_fx_sheet.png',
  bone: 'bone.png',
  diamond: 'diamond.png',
  dynamite: 'dynamite.png',
  explosion: 'explosive_fx_sheet.png',
  gemPolish: 'gem_polish.png',
  goldBig: 'gold_big.png',
  goldBigEffect: 'gold_big_fx_sheet.png',
  goldMini: 'gold_mini.png',
  goldNormal: 'gold_normal.png',
  goldNormalPlus: 'gold_normal_plus.png',
  hookSheet: 'hook_sheet.png',
  luckyClover: 'lucky_clover.png',
  menuArrow: 'menu_arrow.png',
  minerSheet: 'miner_sheet.png',
  moleSheet: 'mole_sheet.png',
  moleWithDiamondSheet: 'mole_with_diamond_sheet.png',
  panel: 'panel.png',
  questionBag: 'question_bag.png',
  rockBig: 'rock_big.png',
  rockCollectorsBook: 'rock_collectors_book.png',
  rockMini: 'rock_mini.png',
  rockNormal: 'rock_normal.png',
  shopTable: 'shop_table.png',
  shopkeeperSheet: 'shopkeeper_sheet.png',
  skull: 'skull.png',
  strengthDrink: 'strength_drink.png',
  title: 'text_goldminer.png',
  strengthText: 'text_strength.png',
  tnt: 'tnt.png',
  tntDestroyed: 'tnt_destroyed.png',
  dialogueBubble: 'ui_dialogue_bubble.png',
  dynamiteUi: 'ui_dynamite.png',
  selector: 'ui_selector.png',
} as const

export type GoldMinerAssets = Record<keyof typeof ASSET_FILES, HTMLImageElement>

let assetPromise: Promise<GoldMinerAssets> | undefined

function loadImage(file: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image), { once: true })
    image.addEventListener(
      'error',
      () => reject(new Error(`Unable to load ${file}`)),
      {
        once: true,
      }
    )
    image.src = `${IMAGE_ASSET_ROOT}/${file}`
  })
}

export function loadGoldMinerAssets(): Promise<GoldMinerAssets> {
  if (assetPromise) return assetPromise

  assetPromise = Promise.all([
    new FontFace(
      'GoldMinerInfo',
      `url(${ASSET_ROOT}/fonts/Pixel-Square-10-1.ttf)`
    ).load(),
    new FontFace('GoldMinerUI', `url(${ASSET_ROOT}/fonts/Kurland.ttf)`).load(),
    new FontFace(
      'GoldMinerGame',
      `url(${ASSET_ROOT}/fonts/visitor1.ttf)`
    ).load(),
    Promise.all(
      Object.entries(ASSET_FILES).map(async ([key, file]) => {
        const image = await loadImage(file)
        return [key, image] as const
      })
    ),
  ]).then(([infoFont, uiFont, gameFont, entries]) => {
    document.fonts.add(infoFont)
    document.fonts.add(uiFont)
    document.fonts.add(gameFont)
    return Object.fromEntries(entries) as GoldMinerAssets
  })

  return assetPromise
}
