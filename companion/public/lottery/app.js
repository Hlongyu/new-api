import * as THREE from './vendor/three.module.js'
import {
  AuthenticationError,
  authenticatedFetch,
  redirectToSignIn,
} from './auth-client.js?v=2'
import { buildTierMap, createWishScene, tierFor } from './wish-scene.js?v=6'
import { createWishOverlay } from './wish-overlay.js?v=8'

const appBase = new URL('./', window.location.href)
const themeStorageKey = 'lottery_theme'
const themes = {
  gothic: {
    label: '暗黑', title: '暗夜祈愿', subtitle: '七日契约', mark: 'IV', themeColor: '#090807',
  },
  starlight: {
    label: '明亮', title: '星辉祈愿', subtitle: '七日星约', mark: '✦', themeColor: '#162541',
  },
}

function savedTheme() {
  try {
    const theme = window.localStorage.getItem(themeStorageKey)
    return themes[theme] ? theme : 'starlight'
  } catch {
    return 'starlight'
  }
}

const state = {
  status: null,
  campaignId: '',
  theme: savedTheme(),
  busy: false,
  sceneReady: false,
}

const elements = Object.fromEntries([
  'scene', 'brandLink', 'brandMark', 'brandName', 'brandSubtitle',
  'rulesButton', 'historyButton', 'themeSwitcher', 'themeButton', 'themeMenu',
  'resultField', 'settlement', 'settlementLabel', 'settlementAmount',
  'balance', 'singleDrawButton', 'singleDrawButtonText',
  'tenDrawButton', 'tenDrawButtonText',
  'redemptionProgressSection', 'redemptionProgress', 'redemptionDraws',
  'redemptionValue', 'redemptionNeeded', 'redemptionBar',
  'historyDialog', 'historyList', 'rulesDialog', 'ruleExpected',
  'oddsList', 'toast',
  'wishStage', 'wishTap', 'wishCard', 'wishOrdinal', 'wishRarity', 'wishAmount',
  'wishStars', 'wishSummary', 'wishSummaryHead', 'wishGrid',
].map((id) => [id, document.getElementById(id)]))

document.documentElement.dataset.theme = state.theme

async function api(path, options = {}) {
  const method = options.method || 'GET'
  const headers = { ...(options.headers || {}) }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (!['GET', 'HEAD'].includes(method)) headers['X-Leaderboard-Request'] = '1'
  let response
  try {
    response = await authenticatedFetch(new URL(path.replace(/^\/+/, ''), appBase), {
      ...options,
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch (error) {
    if (error instanceof AuthenticationError) redirectToSignIn()
    throw error
  }
  const payload = await response.json().catch(() => ({}))
  if (response.status === 401) {
    redirectToSignIn()
    throw new Error('登录状态已失效')
  }
  if (!response.ok || payload.success === false) throw new Error(payload.message || '请求失败')
  return payload.data
}

function showToast(message) {
  elements.toast.textContent = message
  elements.toast.classList.add('show')
  window.clearTimeout(showToast.timer)
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove('show'), 2600)
}

function formatDate(timestamp) {
  if (!timestamp) return '--'
  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

function formatStatus(status) {
  return {
    pending: '发放中', processing: '发放中', unknown: '核对中',
    completed: '已到账', failed: '需要处理',
  }[status] || status
}

function formatUsd(value) {
  const amount = Number(value || 0)
  return `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`
}

function randomKey() {
  return `${Date.now().toString(36)}_${crypto.randomUUID().replaceAll('-', '')}`
}

function renderRules() {
  const campaign = state.status?.campaign
  elements.oddsList.replaceChildren()
  if (!campaign) return
  const tierMap = buildTierMap(campaign.prizes)
  elements.ruleExpected.textContent = `$${campaign.expectedValue.toFixed(2)} / 抽`
  for (const prize of campaign.prizes) {
    const item = document.createElement('div')
    item.className = 'odds-item'
    const amount = document.createElement('strong')
    amount.textContent = `$${prize.amountUsd}`
    const rarity = document.createElement('span')
    rarity.textContent = tierFor(tierMap, prize.amountUsd).label
    const odds = document.createElement('b')
    odds.textContent = `${(prize.probability * 100).toFixed(2)}%`
    item.append(amount, rarity, odds)
    elements.oddsList.append(item)
  }
}

function renderHistory() {
  const history = state.status?.history || []
  elements.historyList.replaceChildren()
  if (history.length === 0) {
    const empty = document.createElement('p')
    empty.textContent = '暂无真实开奖记录'
    empty.style.color = 'var(--muted)'
    elements.historyList.append(empty)
    return
  }
  for (const draw of history) {
    const item = document.createElement('div')
    item.className = 'history-item'
    const meta = document.createElement('div')
    const title = document.createElement('strong')
    title.textContent = `$${draw.totalAmountUsd}`
    const detail = document.createElement('small')
    detail.textContent = `${draw.drawCount} 抽 · ${formatDate(draw.createdAt)}${draw.expiresAt ? ` · ${formatDate(draw.expiresAt)} 到期` : ''}`
    meta.append(title, detail)
    const status = document.createElement('span')
    status.className = draw.status
    status.textContent = formatStatus(draw.status)
    item.append(meta, status)
    elements.historyList.append(item)
  }
}

function updateControls() {
  const campaign = state.status?.campaign
  const active = campaign?.phase === 'active'
  const balance = Number(state.status?.balance || 0)
  elements.balance.textContent = String(state.status?.balance ?? '--')
  elements.themeButton.disabled = state.busy
  if (state.busy) {
    elements.themeMenu.hidden = true
    elements.themeButton.setAttribute('aria-expanded', 'false')
  }
  elements.singleDrawButton.disabled = state.busy || !active || balance < 1
  elements.tenDrawButton.disabled = state.busy || !active || balance < 10
  elements.singleDrawButtonText.textContent = '单次祈愿'
  elements.tenDrawButtonText.textContent = '十连祈愿'
}

function renderRedemptionProgress() {
  const progress = state.status?.redemptionProgress
  const visible = Boolean(progress)
  elements.redemptionProgressSection.hidden = !visible
  if (!visible) return

  const ratio = Math.max(0, Math.min(1, Number(progress.progressRatio || 0)))
  elements.redemptionDraws.textContent = String(progress.grantedDraws || 0)
  elements.redemptionValue.textContent =
    `本轮 ${formatUsd(progress.remainderUsd)} / ${formatUsd(progress.thresholdUsd)}`
  elements.redemptionNeeded.textContent = `还差 ${formatUsd(progress.remainingUsd)}`
  elements.redemptionBar.style.width = `${ratio * 100}%`
  elements.redemptionProgress.title =
    `通过兑换码累计兑换 ${formatUsd(progress.observedUsd)} · ${progress.redemptionCount || 0} 条记录`
}

function renderStatus() {
  const { campaign } = state.status
  state.campaignId = campaign?.id || ''
  if (state.status.mainSiteUrl) {
    elements.brandLink.href = new URL('/dashboard', state.status.mainSiteUrl).href
  }
  renderRedemptionProgress()
  renderRules()
  renderHistory()
  updateControls()
}

function applyTheme(theme, persist = true) {
  if (!themes[theme] || (state.busy && theme !== state.theme)) return
  state.theme = theme
  const config = themes[theme]
  document.documentElement.dataset.theme = theme
  document.title = config.title
  document.querySelector('meta[name="theme-color"]').content = config.themeColor
  elements.themeButton.setAttribute('aria-label', `风格切换，当前为${config.label}`)
  elements.themeMenu.querySelectorAll('[data-theme-option]').forEach((button) => {
    button.setAttribute('aria-checked', String(button.dataset.themeOption === theme))
  })
  elements.brandMark.textContent = config.mark
  elements.brandName.textContent = config.title
  elements.brandSubtitle.textContent = config.subtitle
  elements.brandLink.setAttribute('aria-label', '返回 New API 控制台')
  if (persist) {
    try { window.localStorage.setItem(themeStorageKey, theme) } catch { /* storage can be unavailable */ }
  }
  resetResultPresentation()
  applySceneTheme()
  if (state.status) renderStatus()
  else updateControls()
}

// Colour and star rating come from where a prize's amount ranks inside the
// active campaign, not from its four-value rarity field. See buildTierMap.
function currentTierMap() {
  return buildTierMap(state.status?.campaign?.prizes)
}

function revealResults(data) {
  elements.resultField.replaceChildren()
  elements.resultField.setAttribute(
    'aria-label',
    `开奖结果：${data.items.map((reward) => `${reward.amountUsd} 美元`).join('，')}`,
  )
  elements.settlement.hidden = data.drawCount === 1
  if (data.drawCount === 1) return
  elements.settlementLabel.textContent = '本次获得'
  elements.settlementAmount.textContent = `$${data.totalAmountUsd}`
}

let renderer
let scene
let camera
let chestClosed
let chestOpen
let chestGlow
let innerLight
let screenFlash
let particles
let beams = []
let burstBars = []
let animationMode = null
let animationStart = 0
let activePlayback = null
// The starlight theme is rendered by a separate scene and camera (wish-scene.js).
// The overlay is pure DOM, so build it eagerly — it is the fallback presentation
// when WebGL is unavailable and initScene() never completes.
let wish = null
const wishOverlay = createWishOverlay(elements)

const beamPalette = [
  0xffd45f, 0x65e6ff, 0xff5b5f, 0x72f0a0, 0xb58cff,
  0xff8ed6, 0xff964a, 0x70a2ff, 0xdfff68, 0xfff4dc,
]
const rarityPower = { common: 1, rare: 1.22, epic: 1.55, legendary: 2.05 }
const rarityBurstCount = { common: 0, rare: 12, epic: 30, legendary: 48 }

function amountCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 192
  return canvas
}

function paintAmount(beam, amount, locked = false) {
  const context = beam.canvas.getContext('2d')
  const color = `#${beam.color.getHexString()}`
  context.clearRect(0, 0, beam.canvas.width, beam.canvas.height)
  context.fillStyle = 'rgba(6, 4, 4, .78)'
  context.beginPath()
  context.roundRect(38, 22, 436, 148, 10)
  context.fill()
  context.lineWidth = locked ? 7 : 4
  context.strokeStyle = color
  context.shadowColor = color
  context.shadowBlur = locked ? 26 : 12
  context.stroke()
  context.shadowBlur = 0
  context.fillStyle = color
  context.fillRect(58, 40, 42, 4)
  context.fillRect(412, 40, 42, 4)
  context.fillRect(58, 148, 42, 4)
  context.fillRect(412, 148, 42, 4)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = '900 96px Impact, "Arial Black", sans-serif'
  context.lineWidth = 10
  context.strokeStyle = 'rgba(3, 2, 2, .9)'
  context.shadowColor = color
  context.shadowBlur = locked ? 38 : 18
  context.strokeText(`$${amount}`, 256, 100)
  context.fillStyle = locked ? '#fff8dc' : color
  context.fillText(`$${amount}`, 256, 100)
  context.shadowBlur = 0
  beam.texture.needsUpdate = true
}

function makeRayGeometry(bottomWidth = .12, topWidth = .5) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -bottomWidth, 0, 0,
    bottomWidth, 0, 0,
    -topWidth, 1, 0,
    topWidth, 1, 0,
  ], 3))
  geometry.setIndex([0, 1, 2, 2, 1, 3])
  return geometry
}

function makeBeam(index) {
  const color = new THREE.Color(beamPalette[index])
  const group = new THREE.Group()
  group.position.set(0, .42, -.35)
  group.visible = false

  const outerMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const coreColor = color.clone().lerp(new THREE.Color(0xffffff), .72)
  const coreMaterial = outerMaterial.clone()
  coreMaterial.color = coreColor
  const outer = new THREE.Mesh(makeRayGeometry(.1, .56), outerMaterial)
  const core = new THREE.Mesh(makeRayGeometry(.16, .4), coreMaterial)
  group.add(outer, core)

  const ticks = Array.from({ length: 3 }, () => {
    const material = new THREE.MeshBasicMaterial({
      color: coreColor,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
    const tick = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
    group.add(tick)
    return tick
  })

  const canvas = amountCanvas()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  const label = new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
  }))
  label.position.z = 1.2
  scene.add(group, label)

  const beam = {
    index, color, group, outer, core, ticks, canvas, texture, label,
    amount: 0, locked: false, lastRollTick: -1, startAt: 0, lockAt: 0,
    angle: 0, length: 4.6, width: .4, labelDistance: 2,
  }
  paintAmount(beam, '?')
  return beam
}

function makeBurstBar(index) {
  const group = new THREE.Group()
  group.position.set(0, .42, -.18)
  group.rotation.z = index * (Math.PI * 2 / 48)
  group.visible = false
  const material = new THREE.MeshBasicMaterial({
    color: index % 3 === 0 ? 0xffffff : 0xffd45f,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
  group.add(mesh)
  scene.add(group)
  return { group, mesh, material, length: 2.4 + (index % 7) * .38 }
}

function beamAngles(count) {
  if (count === 1) return [0]
  if (count === 5) return [-50, -25, 0, 25, 50]
  return [-68, -38, -8, 23, 53, -53, -23, 8, 38, 68]
}

function rollingAmounts() {
  return state.status?.campaign?.prizes?.map((prize) => prize.amountUsd) || [1, 2, 5, 10, 20]
}

function setBeamColor(beam, colorValue) {
  beam.color.set(colorValue)
  beam.outer.material.color.copy(beam.color)
  const coreColor = beam.color.clone().lerp(new THREE.Color(0xffffff), .76)
  beam.core.material.color.copy(coreColor)
  beam.ticks.forEach((tick) => tick.material.color.copy(coreColor))
}

function configureBeam(beam, reward, index, count, duration, quick) {
  const angles = beamAngles(count)
  const power = rarityPower[reward.rarity] || 1
  const wave = count === 10 && index >= 5 ? 1 : 0
  const waveIndex = wave ? index - 5 : index
  const startAt = quick
    ? 180 + index * 35
    : duration * (wave ? .53 : .24) + waveIndex * 110
  const lockAt = quick
    ? duration * .68 + index * 18
    : duration * (wave ? .82 : count === 10 ? .43 : .69) + waveIndex * 80
  beam.amount = reward.amountUsd
  beam.locked = false
  beam.lastRollTick = -1
  beam.startAt = startAt
  beam.lockAt = lockAt
  setBeamColor(beam, beamPalette[index])
  beam.angle = THREE.MathUtils.degToRad(angles[index])
  beam.length = (count === 1 ? 5.1 : 4.75) * (1 + (power - 1) * .08)
  beam.width = (count === 10 ? .34 : .46) * power
  beam.labelDistance = count === 10
    ? (index < 5 ? 2.35 : 3.75)
    : count === 5 ? 2.35 : 2.15
  beam.group.position.set(0, .42, -.35)
  beam.group.rotation.z = beam.angle
  beam.group.visible = true
  beam.outer.scale.set(beam.width * 1.9, beam.length, 1)
  beam.outer.position.y = beam.length / 2
  beam.core.scale.set(beam.width * .72, beam.length, 1)
  beam.core.position.y = beam.length / 2
  beam.label.scale.set(count === 10 ? 1.24 : 1.72, count === 10 ? .47 : .64, 1)
  beam.label.position.set(
    -Math.sin(beam.angle) * beam.labelDistance,
    Math.min(3.35, .42 + Math.cos(beam.angle) * beam.labelDistance),
    1.2,
  )
  paintAmount(beam, rollingAmounts()[index % rollingAmounts().length])
}

function resetScenePresentation() {
  animationMode = null
  document.body.classList.remove('has-results')
  if (chestClosed) {
    chestClosed.material.opacity = 1
    chestClosed.visible = state.theme === 'gothic'
  }
  if (chestOpen) {
    chestOpen.material.opacity = 0
    chestOpen.visible = false
  }
  if (innerLight) innerLight.material.opacity = 0
  if (screenFlash) screenFlash.material.opacity = 0
  beams.forEach((beam) => {
    beam.group.visible = false
    beam.label.material.opacity = 0
  })
  burstBars.forEach((bar) => { bar.group.visible = false })
  wish?.reset()
  wishOverlay.reset()
}

function resetResultPresentation() {
  elements.settlement.hidden = true
  elements.resultField.replaceChildren()
  elements.resultField.removeAttribute('aria-label')
  resetScenePresentation()
}

function applySceneTheme() {
  if (!renderer || !scene) return
  const starlight = state.theme === 'starlight'
  renderer.setClearColor(starlight ? 0x05070f : 0x090807, 1)
  wish?.setActive(starlight)
  if (!starlight) wishOverlay.reset()
  if (chestClosed) chestClosed.visible = !starlight
  if (chestOpen) chestOpen.visible = false
  if (chestGlow) chestGlow.visible = !starlight
  if (particles) {
    particles.material.color.set(0xb64c35)
    particles.material.size = .035
    particles.material.opacity = .34
  }
  if (innerLight) {
    innerLight.material.color.set(0xffe3a1)
    innerLight.position.set(0, .4, .1)
    innerLight.scale.set(1.8, .55, 1)
  }
  if (screenFlash) screenFlash.material.color.set(0xfff1c9)
  burstBars.forEach((bar) => bar.group.position.set(0, .42, -.18))
  resizeScene()
}

async function initScene() {
  renderer = new THREE.WebGLRenderer({ canvas: elements.scene, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setClearColor(0x090807, 1)
  scene = new THREE.Scene()
  camera = new THREE.OrthographicCamera(-8, 8, 4.5, -4.5, .1, 100)
  camera.position.z = 10

  const loader = new THREE.TextureLoader()
  const [closedTexture, openTexture, wishTexture] = await Promise.all([
    loader.loadAsync('./assets/ritual-chest.png'),
    loader.loadAsync('./assets/ritual-chest-open.png'),
    loader.loadAsync('./assets/starlight-wish-sky.png'),
  ])
  for (const texture of [closedTexture, openTexture]) {
    texture.colorSpace = THREE.SRGBColorSpace
    texture.magFilter = THREE.NearestFilter
    texture.minFilter = THREE.LinearMipmapLinearFilter
  }
  wishTexture.colorSpace = THREE.SRGBColorSpace
  wishTexture.magFilter = THREE.LinearFilter
  wishTexture.minFilter = THREE.LinearMipmapLinearFilter

  chestClosed = new THREE.Sprite(new THREE.SpriteMaterial({
    map: closedTexture, transparent: true, opacity: 1,
  }))
  chestClosed.scale.set(6.2, 6.2, 1)
  chestClosed.position.set(0, -.4, .3)
  scene.add(chestClosed)

  chestOpen = new THREE.Sprite(new THREE.SpriteMaterial({
    map: openTexture, transparent: true, opacity: 0,
  }))
  chestOpen.scale.set(6.05, 6.05, 1)
  chestOpen.position.set(0, -.34, .35)
  chestOpen.visible = false
  scene.add(chestOpen)

  const glowGeometry = new THREE.RingGeometry(1.65, 2.15, 64)
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xa61f24, transparent: true, opacity: .16,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
  })
  chestGlow = new THREE.Mesh(glowGeometry, glowMaterial)
  chestGlow.position.set(0, -.55, -1)
  scene.add(chestGlow)

  innerLight = new THREE.Mesh(
    new THREE.CircleGeometry(1.05, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffe3a1, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  )
  innerLight.position.set(0, .4, .1)
  innerLight.scale.set(1.8, .55, 1)
  scene.add(innerLight)

  screenFlash = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 18),
    new THREE.MeshBasicMaterial({
      color: 0xfff1c9, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  )
  screenFlash.position.z = -1.4
  scene.add(screenFlash)

  const count = 520
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (Math.random() - .5) * 16
    positions[index * 3 + 1] = (Math.random() - .5) * 9
    positions[index * 3 + 2] = -2
  }
  const particleGeometry = new THREE.BufferGeometry()
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  particles = new THREE.Points(particleGeometry, new THREE.PointsMaterial({
    color: 0xb64c35, size: .035, transparent: true, opacity: .34,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }))
  scene.add(particles)

  beams = Array.from({ length: 10 }, (_, index) => makeBeam(index))
  burstBars = Array.from({ length: 48 }, (_, index) => makeBurstBar(index))

  // The starlight theme renders through its own scene/camera pair.
  wish = createWishScene({
    renderer,
    skyTexture: wishTexture,
    hooks: {
      onStage: (stage, data, tierMap) => wishOverlay.enterStage(stage, data, tierMap),
      // Deliberately at the end: the total stays hidden until the whole
      // sequence is over, so it cannot spoil the cards being flipped.
      onReveal: (data) => revealResults(data),
      onFinish: () => {
        document.body.classList.remove('is-opening')
        document.body.classList.add('has-results')
      },
    },
  })

  resizeScene()
  applySceneTheme()
  state.sceneReady = true
  animateScene()
}

function resizeScene() {
  if (!renderer) return
  renderer.setSize(window.innerWidth, window.innerHeight, false)
  const aspect = window.innerWidth / window.innerHeight
  const height = 4.5
  camera.left = -height * aspect
  camera.right = height * aspect
  camera.top = height
  camera.bottom = -height
  camera.updateProjectionMatrix()
  wish?.resize(window.innerWidth, window.innerHeight)
}

function animateScene(time = 0) {
  requestAnimationFrame(animateScene)
  if (!renderer) return
  // The starlight theme owns its own scene and camera; hand the frame over.
  if (wish?.isActive()) {
    wish.update(time)
    wish.render()
    return
  }
  particles.rotation.z = time * .000018
  particles.position.y = Math.sin(time * .00025) * .09
  if (chestGlow.visible) {
    chestGlow.rotation.z = -time * .00016
    chestGlow.material.opacity = .12 + Math.sin(time * .0022) * .05
  }
  if (animationMode) {
    const elapsed = time - animationStart
    const intensity = animationMode.intensity
    const settled = animationMode.settled
    const openProgress = settled ? 1 : THREE.MathUtils.smoothstep(
      elapsed,
      animationMode.openAt,
      animationMode.openAt + (animationMode.quick ? 130 : 380),
    )
    const shake = settled ? 0 : Math.max(0, 1 - openProgress) * intensity
    chestClosed.position.x = Math.sin(time * .075) * .055 * shake
    chestClosed.position.y = -.4 + Math.sin(time * .031) * .028 * shake
    chestClosed.material.opacity = 1 - openProgress
    chestClosed.visible = openProgress < .99
    chestOpen.visible = openProgress > .02
    chestOpen.material.opacity = openProgress
    chestOpen.position.y = -.34 + Math.sin(time * .002) * .018
    innerLight.material.opacity = openProgress * (
      settled ? .46 + Math.sin(time * .006) * .08 : .62 + Math.sin(time * .012) * .2
    )
    innerLight.scale.x = 1.7 + Math.sin(time * .004) * .14

    const options = rollingAmounts()
    beams.forEach((beam, index) => {
      if (index >= animationMode.count) return
      const rise = settled ? 1 : THREE.MathUtils.smoothstep(
        elapsed,
        beam.startAt,
        beam.startAt + (animationMode.quick ? 120 : 440),
      )
      const locked = settled || elapsed >= beam.lockAt
      const rollTick = Math.floor(elapsed / (animationMode.quick ? 55 : 90))
      if (!locked && rise > 0 && rollTick !== beam.lastRollTick) {
        beam.lastRollTick = rollTick
        paintAmount(beam, options[(rollTick + index * 2) % options.length])
      } else if (locked && !beam.locked) {
        beam.locked = true
        paintAmount(beam, beam.amount, true)
      }
      beam.outer.material.opacity = rise * (locked ? .28 : .18 + Math.sin(time * .018 + index) * .08)
      beam.core.material.opacity = rise * (locked ? .72 : .38 + Math.sin(time * .024 + index) * .18)
      beam.label.material.opacity = rise * (locked ? 1 : .68)
      beam.ticks.forEach((tick, tickIndex) => {
        const travel = ((elapsed * .0017 + tickIndex / 3 + index * .09) % 1)
        tick.scale.set(beam.width * 1.45, .035, 1)
        tick.position.y = .35 + travel * (beam.length - .7)
        tick.material.opacity = rise * (locked ? .32 : .72) * Math.sin(travel * Math.PI)
      })
    })

    const burstStart = animationMode.burstAt
    const burstProgress = settled ? 1 : THREE.MathUtils.smoothstep(
      elapsed,
      burstStart,
      burstStart + (animationMode.quick ? 120 : 300),
    )
    const burstFade = settled ? .18 : Math.max(0, 1 - (elapsed - burstStart) / 1600)
    const activeBars = rarityBurstCount[animationMode.rarity] || 0
    burstBars.forEach((bar, index) => {
      const active = index < activeBars && burstProgress > 0
      bar.group.visible = active
      if (!active) return
      const stagger = 1 + (index % 5) * .11
      bar.mesh.scale.set(
        animationMode.rarity === 'legendary' ? .065 : .045,
        bar.length * burstProgress * stagger,
        1,
      )
      bar.mesh.position.y = bar.mesh.scale.y / 2
      bar.material.opacity = burstFade * (.28 + (index % 4) * .12) * intensity
      bar.material.color.set(beamPalette[index % beamPalette.length])
    })
    const flashPeak = settled ? 0 : Math.max(0, 1 - Math.abs(elapsed - animationMode.openAt - 110) / 240)
    const rewardFlash = settled ? 0 : Math.max(0, 1 - Math.abs(elapsed - burstStart) / 180)
    screenFlash.material.opacity =
      flashPeak * .34 + rewardFlash * Math.min(.48, (intensity - 1) * .62)
  } else {
    chestClosed.position.x = 0
    chestClosed.position.y = -.4 + Math.sin(time * .0012) * .035
    chestClosed.material.opacity = 1
    chestClosed.visible = true
    chestOpen.visible = false
    innerLight.material.opacity = 0
    screenFlash.material.opacity = 0
    beams.forEach((beam) => {
      beam.group.visible = false
      beam.label.material.opacity = 0
    })
    burstBars.forEach((bar) => { bar.group.visible = false })
  }
  renderer.render(scene, camera)
}

function playScene(data) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const quick = reducedMotion
  resetResultPresentation()
  document.body.classList.add('is-opening')
  elements.wishStage.hidden = false
  elements.wishTap.hidden = false
  elements.wishTap.setAttribute('aria-label', '快进祈愿演出')

  // The starlight theme runs the wish sequence, which drives its own stage
  // machine and resolves once the player reaches the final card or grid.
  if (state.theme === 'starlight') {
    // No WebGL: still show the grid and the settlement rather than nothing.
    if (!wish) {
      wishOverlay.enterStage({ kind: 'summary' }, data, currentTierMap())
      revealResults(data)
      document.body.classList.remove('is-opening')
      document.body.classList.add('has-results')
      return Promise.resolve()
    }
    return wish.play(data, { quick, reducedMotion, tierMap: currentTierMap() })
  }

  const duration = quick ? 1800 : ({ 1: 6200, 5: 9200, 10: 13200 }[data.drawCount] || 6200)
  const intensity = rarityPower[data.highestRarity] || 1
  data.items.forEach((reward, index) => {
    configureBeam(beams[index], reward, index, data.drawCount, duration, quick)
  })
  const burstAt = quick ? duration * .7 : duration * (data.drawCount === 10 ? .82 : .69)
  animationMode = {
    theme: state.theme,
    count: data.drawCount,
    duration,
    intensity,
    rarity: data.highestRarity,
    quick,
    openAt: quick ? 100 : duration * .16,
    burstAt,
    settled: false,
  }
  animationStart = performance.now()
  return new Promise((resolve) => {
    const playback = {
      data,
      duration,
      revealed: false,
      resolve,
      revealTimer: 0,
      endTimer: 0,
    }
    activePlayback = playback
    const reveal = () => {
      if (playback.revealed) return
      playback.revealed = true
      revealResults(data)
    }
    playback.reveal = reveal
    playback.revealTimer = window.setTimeout(
      reveal,
      quick ? duration * .72 : duration * (data.drawCount === 10 ? .83 : .71),
    )
    playback.endTimer = window.setTimeout(() => finishPlayback(playback), duration)
  })
}

function finishPlayback(playback) {
  if (!playback || activePlayback !== playback) return
  window.clearTimeout(playback.revealTimer)
  window.clearTimeout(playback.endTimer)
  playback.reveal()
  if (animationMode) {
    animationMode.settled = true
    beams.slice(0, animationMode.count).forEach((beam) => {
      if (!beam.locked) {
        beam.locked = true
        paintAmount(beam, beam.amount, true)
      }
    })
  }
  activePlayback = null
  document.body.classList.remove('is-opening')
  document.body.classList.add('has-results')
  playback.resolve()
}

function skipPlayback() {
  if (!activePlayback) return
  finishPlayback(activePlayback)
}

async function runDraw(count) {
  if (state.busy) return
  state.busy = true
  document.body.classList.add('is-opening')
  updateControls()
  try {
    const data = await api('api/draw', {
      method: 'POST',
      body: { count, campaignId: state.campaignId, requestKey: randomKey() },
    })
    await playScene(data)
    state.status = await api(`api/status?campaign_id=${encodeURIComponent(state.campaignId)}`)
    renderStatus()
  } catch (error) {
    document.body.classList.remove('is-opening')
    showToast(error.message)
  } finally {
    state.busy = false
    updateControls()
  }
}

elements.singleDrawButton.addEventListener('click', () => runDraw(1))
elements.tenDrawButton.addEventListener('click', () => runDraw(10))

// Advancing the wish sequence: the full-frame tap target, plus keyboard for
// anyone who cannot click. Both only act while the sequence is playing.
elements.wishTap.addEventListener('click', () => {
  if (document.body.classList.contains('has-results')) {
    resetResultPresentation()
    return
  }
  if (state.theme === 'starlight') wish?.advance()
  else skipPlayback()
})
window.addEventListener('keydown', (event) => {
  if (!wish?.isPlaying() && !activePlayback) return
  if (elements.historyDialog.open || elements.rulesDialog.open) return
  if (!['Enter', ' ', 'Spacebar', 'ArrowRight'].includes(event.key)) return
  // Let the tap and draw buttons handle their own activation keys.
  if ([elements.wishTap, elements.singleDrawButton, elements.tenDrawButton].includes(event.target)) return
  event.preventDefault()
  if (state.theme === 'starlight') wish.advance()
  else skipPlayback()
})
function setThemeMenuOpen(open) {
  elements.themeMenu.hidden = !open
  elements.themeButton.setAttribute('aria-expanded', String(open))
}

elements.themeButton.addEventListener('click', (event) => {
  event.stopPropagation()
  const open = elements.themeMenu.hidden
  setThemeMenuOpen(open)
  if (open) {
    elements.themeMenu.querySelector(`[data-theme-option="${state.theme}"]`)?.focus()
  }
})
elements.themeMenu.addEventListener('click', (event) => {
  const option = event.target.closest('[data-theme-option]')
  if (!option) return
  applyTheme(option.dataset.themeOption)
  setThemeMenuOpen(false)
  elements.themeButton.focus()
})
document.addEventListener('click', (event) => {
  if (!elements.themeSwitcher.contains(event.target)) setThemeMenuOpen(false)
})
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || elements.themeMenu.hidden) return
  setThemeMenuOpen(false)
  elements.themeButton.focus()
})
elements.historyButton.addEventListener('click', () => elements.historyDialog.showModal())
elements.rulesButton.addEventListener('click', () => elements.rulesDialog.showModal())
window.addEventListener('resize', resizeScene)
applyTheme(state.theme, false)

initScene().catch(() => {
  document.body.classList.add('scene-fallback')
  showToast('WebGL 不可用，已切换为简化演出')
})

api('api/status').then((status) => {
  state.status = status
  renderStatus()
}).catch((error) => showToast(error.message))
