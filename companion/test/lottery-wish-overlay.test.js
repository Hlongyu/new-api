import assert from 'node:assert/strict'
import test from 'node:test'

import { createWishOverlay } from '../public/lottery/wish-overlay.js'

function element() {
  const attributes = new Map()
  return {
    hidden: true,
    dataset: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {} },
    offsetWidth: 0,
    textContent: '',
    children: [],
    setAttribute(name, value) {
      attributes.set(name, value)
    },
    getAttribute(name) {
      return attributes.get(name) ?? null
    },
    replaceChildren(...children) {
      this.children = children
    },
    append(...children) {
      this.children.push(...children)
    },
  }
}

test('真实单抽结束后提供无可见提示的全屏结束操作', () => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  globalThis.document = { createElement: () => element() }
  globalThis.window = {
    clearTimeout() {},
    setTimeout(callback) {
      callback()
      return 1
    },
  }

  try {
    const elements = {
      wishStage: element(),
      wishTap: element(),
      wishCard: element(),
      wishOrdinal: element(),
      wishRarity: element(),
      wishAmount: element(),
      wishStars: element(),
      wishSummary: element(),
      wishSummaryHead: element(),
      wishGrid: element(),
    }
    const overlay = createWishOverlay(elements)

    overlay.enterStage(
      { kind: 'item', index: 0, item: { amountUsd: 1 } },
      { drawCount: 1, items: [{ amountUsd: 1 }] },
      new Map(),
    )

    assert.equal(elements.wishTap.hidden, false)
    assert.equal(elements.wishTap.getAttribute('aria-label'), '结束祈愿')
  } finally {
    if (previousDocument === undefined) delete globalThis.document
    else globalThis.document = previousDocument
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
