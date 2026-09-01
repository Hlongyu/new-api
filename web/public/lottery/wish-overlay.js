// DOM layer for the wish sequence: the per-reward card (ordinal, rarity, amount,
// star row), the ten-pull summary grid, and the full-frame tap target that
// advances the reveal. WebGL draws the light; this draws the type.
//
// The scene canvas cannot render crisp responsive text, so everything
// typographic lives here and is tinted from the shared rarity table via CSS
// custom properties. CSP forbids `style` attributes in markup, but CSSOM
// writes (element.style.setProperty) are unaffected.

import { tierFor } from './wish-scene.js?v=6'

// The tier ladder is ranked by amount, so the pull's best reward is simply its
// largest one.
function topAmount(data) {
  return (data.items || []).reduce((best, item) => Math.max(best, Number(item.amountUsd)), 0)
}

export function createWishOverlay(elements) {
  const {
    wishStage, wishTap, wishCard, wishOrdinal, wishRarity, wishAmount,
    wishStars, wishSummary, wishSummaryHead, wishGrid,
  } = elements

  function setTint(primary) {
    wishStage.style.setProperty('--wish-primary', primary)
    // A translucent companion for tile fills, borders and halos.
    wishStage.style.setProperty('--wish-soft', `${primary}38`)
    wishStage.style.setProperty('--wish-line', `${primary}6b`)
    wishStage.style.setProperty('--wish-fill', `${primary}1f`)
  }

  function setTapEnabled(enabled, label) {
    wishTap.hidden = !enabled
    if (enabled && label) wishTap.setAttribute('aria-label', label)
  }

  function starRow(count) {
    return Array.from({ length: count }, (unused, index) => {
      const star = document.createElement('i')
      star.style.setProperty('--i', String(index))
      return star
    })
  }

  // Re-trigger the entry animations on an element that is already in the DOM.
  function restart(element) {
    element.classList.remove('is-in')
    void element.offsetWidth
    element.classList.add('is-in')
  }

  function showCard(stage, data, tierMap) {
    const style = tierFor(tierMap, stage.item.amountUsd)
    setTint(style.primary)
    wishSummary.hidden = true
    wishCard.hidden = false
    wishCard.dataset.single = String(data.drawCount === 1)
    wishOrdinal.textContent = data.drawCount > 1
      ? `${stage.index + 1} / ${data.drawCount}`
      : ''
    wishRarity.textContent = style.label
    wishAmount.textContent = `$${stage.item.amountUsd}`
    wishStars.replaceChildren(...starRow(style.stars))
    restart(wishCard)
  }

  function showSummary(data, tierMap) {
    const style = tierFor(tierMap, topAmount(data))
    setTint(style.primary)
    wishCard.hidden = true
    wishSummary.hidden = false
    wishSummaryHead.textContent = '本次祈愿'
    wishGrid.dataset.count = String(data.drawCount)

    // Highlight only the first tile that reached the pull's best tier.
    const best = topAmount(data)
    const topIndex = data.items.findIndex((item) => Number(item.amountUsd) === best)
    wishGrid.replaceChildren(...data.items.map((item, index) => {
      const itemStyle = tierFor(tierMap, item.amountUsd)
      const tile = document.createElement('li')
      tile.style.setProperty('--i', String(index))
      tile.style.setProperty('--tile-line', `${itemStyle.primary}6b`)
      tile.style.setProperty('--tile-fill', `${itemStyle.primary}1f`)
      tile.style.setProperty('--tile-ink', itemStyle.primary)
      if (index === topIndex) tile.dataset.top = 'true'
      const amount = document.createElement('b')
      amount.textContent = `$${item.amountUsd}`
      const stars = document.createElement('span')
      stars.textContent = '★'.repeat(itemStyle.stars)
      tile.append(amount, stars)
      return tile
    }))
    restart(wishSummary)
  }

  return {
    // Called by the WebGL stage machine on every stage transition.
    enterStage(stage, data, tierMap) {
      wishStage.hidden = false
      if (stage.kind === 'gate' || stage.kind === 'descent' || stage.kind === 'burst') {
        wishCard.hidden = true
        wishSummary.hidden = true
        setTapEnabled(true, '快进祈愿演出')
        return
      }
      if (stage.kind === 'item') {
        showCard(stage, data, tierMap)
        const last = data.drawCount === 1
        setTapEnabled(true, last ? '结束祈愿' : '展示下一项奖励')
        return
      }
      showSummary(data, tierMap)
      setTapEnabled(true, '结束祈愿')
    },

    reset() {
      wishStage.hidden = true
      wishCard.hidden = true
      wishSummary.hidden = true
      wishTap.hidden = true
      wishGrid.replaceChildren()
      wishStars.replaceChildren()
      delete wishCard.dataset.single
      delete wishGrid.dataset.count
    },
  }
}
