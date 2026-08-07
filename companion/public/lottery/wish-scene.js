// Wish sequence for the starlight theme: a procedural recreation of the
// Genshin-style ten-pull choreography. The page rests on a painted cloud
// vortex; drawing dives the camera through its star gate, one meteor per drawn
// reward pours out in that reward's own tier colour, they land in a burst keyed
// to the best tier in the pull, then each reward is revealed on its own
// medallion before the whole pull is laid out as a summary grid.
//
// Apart from the one painted sky plate (assets/starlight-wish-sky.png),
// everything here is generated in code — canvas textures plus primitive
// geometry. The module owns its own THREE.Scene and PerspectiveCamera so the
// orthographic gothic scene in app.js is untouched.

import * as THREE from './vendor/three.module.js'

// The five-step quality ladder: white, green, blue, purple, gold.
// The backend only stores four rarity tiers (the lottery_prizes CHECK
// constraint), and the default pool spends `epic` on two different prizes, so
// rarity alone cannot fill five steps. Instead a prize's tier comes from where
// its amount ranks inside its own campaign — see buildTierMap.
export const tierStyles = [
  { stars: 1, sides: 4, label: '普通', primary: '#e8eef5' },
  { stars: 2, sides: 6, label: '精良', primary: '#7fd18a' },
  { stars: 3, sides: 8, label: '稀有', primary: '#5fa8e8' },
  { stars: 4, sides: 10, label: '史诗', primary: '#a97cf0' },
  { stars: 5, sides: 12, label: '传说', primary: '#ffd45f' },
]

// Maps each distinct prize amount in a campaign to a rung of the ladder,
// anchored at the top: the biggest prize is always gold, the next purple, and
// so on. A pool with fewer than five prizes therefore uses the top colours
// only, and anything below the fifth rung from the top stays white.
export function buildTierMap(prizes) {
  const amounts = [...new Set((prizes || []).map((prize) => Number(prize.amountUsd)))]
    .filter((amount) => Number.isFinite(amount))
    .sort((left, right) => left - right)
  const map = new Map()
  amounts.forEach((amount, index) => {
    const rankFromTop = amounts.length - 1 - index
    map.set(amount, tierStyles[4 - Math.min(4, rankFromTop)])
  })
  return map
}

// Falls back to the bottom rung deliberately. An unknown amount means the tier
// map is empty or stale; defaulting to gold there would read as a jackpot and
// would also flip topTierIndex, firing the grand treatment on every pull.
export function tierFor(tierMap, amountUsd) {
  return tierMap?.get(Number(amountUsd)) || tierStyles[0]
}

export function tierIndexOf(style) {
  const index = tierStyles.indexOf(style)
  return index < 0 ? 0 : index
}

// The highest rung any reward in this pull reached. Drives the burst colour and
// ray count, and whether the pull gets the grand gold treatment.
export function topTierIndex(data, tierMap) {
  return (data?.items || []).reduce(
    (best, item) => Math.max(best, tierIndexOf(tierFor(tierMap, item.amountUsd))),
    0,
  )
}

function canvasTexture(width, height, paint) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  paint(canvas.getContext('2d'), width, height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

// A round soft dot, tinted per use through additive material colour.
function buildSoftDot() {
  return canvasTexture(64, 64, (context) => {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(.32, 'rgba(255,255,255,.72)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, 64, 64)
  })
}

// Comet trail: bright feathered head at the bottom fading out along +y,
// pinched horizontally so the stretched quad reads as a tapered streak.
function buildTrail() {
  return canvasTexture(64, 256, (context) => {
    const vertical = context.createLinearGradient(0, 256, 0, 0)
    vertical.addColorStop(0, 'rgba(255,255,255,1)')
    vertical.addColorStop(.12, 'rgba(255,255,255,.86)')
    vertical.addColorStop(.38, 'rgba(255,255,255,.34)')
    vertical.addColorStop(.74, 'rgba(255,255,255,.09)')
    vertical.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = vertical
    context.fillRect(0, 0, 64, 256)
    context.globalCompositeOperation = 'destination-in'
    const horizontal = context.createLinearGradient(0, 0, 64, 0)
    horizontal.addColorStop(0, 'rgba(0,0,0,0)')
    horizontal.addColorStop(.5, 'rgba(0,0,0,1)')
    horizontal.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = horizontal
    context.fillRect(0, 0, 64, 256)
  })
}

// Horizontal ribbon with transparent edges, used for the legendary auroras.
function buildRibbon() {
  return canvasTexture(512, 128, (context) => {
    const vertical = context.createLinearGradient(0, 0, 0, 128)
    vertical.addColorStop(0, 'rgba(255,255,255,0)')
    vertical.addColorStop(.5, 'rgba(255,255,255,.88)')
    vertical.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = vertical
    context.fillRect(0, 0, 512, 128)
    context.globalCompositeOperation = 'destination-in'
    const horizontal = context.createLinearGradient(0, 0, 512, 0)
    horizontal.addColorStop(0, 'rgba(0,0,0,0)')
    horizontal.addColorStop(.5, 'rgba(0,0,0,1)')
    horizontal.addColorStop(1, 'rgba(0,0,0,0)')
    context.fillStyle = horizontal
    context.fillRect(0, 0, 512, 128)
  })
}

// Irregular soft puff for the parallax cloud layers the star falls through.
function buildPuff(seed) {
  return canvasTexture(256, 256, (context) => {
    // Deterministic pseudo-random so the three layers differ but stay stable.
    let value = seed * 9301 + 49297
    const random = () => {
      value = (value * 9301 + 49297) % 233280
      return value / 233280
    }
    for (let index = 0; index < 22; index += 1) {
      const x = 40 + random() * 176
      const y = 60 + random() * 136
      const radius = 26 + random() * 62
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
      gradient.addColorStop(0, `rgba(255,255,255,${.05 + random() * .07})`)
      gradient.addColorStop(1, 'rgba(255,255,255,0)')
      context.fillStyle = gradient
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
    }
  })
}

// The wish void: deep indigo gradient, drifting nebula blooms, baked stars.
// Kept dark on purpose — three additive cloud sheets and the colour grade all
// stack on top of this, and a bright base washes the whole scene to grey.
function buildNebula() {
  return canvasTexture(1024, 512, (context, width, height) => {
    const base = context.createLinearGradient(0, 0, 0, height)
    base.addColorStop(0, '#02030a')
    base.addColorStop(.45, '#070d1f')
    base.addColorStop(1, '#03050e')
    context.fillStyle = base
    context.fillRect(0, 0, width, height)

    let value = 20250730
    const random = () => {
      value = (value * 9301 + 49297) % 233280
      return value / 233280
    }
    const hues = ['70,120,220', '150,110,235', '60,180,220', '215,175,110']
    for (let index = 0; index < 46; index += 1) {
      const x = random() * width
      const y = random() * height
      const radius = 70 + random() * 230
      const hue = hues[Math.floor(random() * hues.length)]
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
      gradient.addColorStop(0, `rgba(${hue},${.03 + random() * .06})`)
      gradient.addColorStop(1, `rgba(${hue},0)`)
      context.fillStyle = gradient
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
    }
    for (let index = 0; index < 420; index += 1) {
      const x = random() * width
      const y = random() * height
      const radius = random() * 1.4 + .25
      context.fillStyle = `rgba(255,255,255,${.14 + random() * .5})`
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
    }
  })
}

// The medallion emblem standing in for item art: an N-pointed sigil inside
// engraved rings. Points scale with rarity so higher tiers read as more ornate.
function buildSigil(sides) {
  return canvasTexture(512, 512, (context, size) => {
    const mid = size / 2
    context.translate(mid, mid)
    context.strokeStyle = 'rgba(255,255,255,.92)'
    context.fillStyle = 'rgba(255,255,255,.9)'

    context.lineWidth = 5
    context.beginPath()
    context.arc(0, 0, 196, 0, Math.PI * 2)
    context.stroke()
    context.lineWidth = 2
    context.beginPath()
    context.arc(0, 0, 176, 0, Math.PI * 2)
    context.stroke()

    // Radial tick marks between the outer rings.
    for (let index = 0; index < sides * 2; index += 1) {
      const angle = (index / (sides * 2)) * Math.PI * 2
      context.save()
      context.rotate(angle)
      context.fillRect(-1.5, -196, 3, index % 2 === 0 ? 20 : 11)
      context.restore()
    }

    // The N-pointed star: alternating long and short radii.
    context.beginPath()
    for (let index = 0; index < sides * 2; index += 1) {
      const angle = (index / (sides * 2)) * Math.PI * 2 - Math.PI / 2
      const radius = index % 2 === 0 ? 150 : 62
      const x = Math.cos(angle) * radius
      const y = Math.sin(angle) * radius
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.closePath()
    context.lineWidth = 4
    context.stroke()

    const core = context.createRadialGradient(0, 0, 0, 0, 0, 96)
    core.addColorStop(0, 'rgba(255,255,255,.95)')
    core.addColorStop(.55, 'rgba(255,255,255,.34)')
    core.addColorStop(1, 'rgba(255,255,255,0)')
    context.fillStyle = core
    context.beginPath()
    context.arc(0, 0, 96, 0, Math.PI * 2)
    context.fill()
  })
}

// A narrow quad that tapers from `bottomWidth` at y=0 to `topWidth` at y=1,
// used for every light ray and the rising column. UVs are included so the
// column can carry a feathered texture instead of reading as a hard rectangle.
function rayGeometry(bottomWidth, topWidth) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -bottomWidth, 0, 0,
    bottomWidth, 0, 0,
    -topWidth, 1, 0,
    topWidth, 1, 0,
  ], 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    0, 1,
    1, 1,
  ], 2))
  geometry.setIndex([0, 1, 2, 2, 1, 3])
  return geometry
}

function additive(color, opacity = 0, extra = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    ...extra,
  })
}

const easeOut = (t) => 1 - (1 - t) * (1 - t)
// Standard easeOutBack constants, so the medallion overshoots but still
// starts at exactly 0 (a scale of 0.2 on frame one would pop visibly).
const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2)
const clamp01 = (value) => Math.min(1, Math.max(0, value))

export function createWishScene({ renderer, skyTexture = null, hooks = {} }) {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(52, 16 / 9, .1, 500)
  const cameraRig = new THREE.Group()
  scene.add(cameraRig)
  cameraRig.add(camera)

  const softDot = buildSoftDot()
  const trailTexture = buildTrail()
  const ribbonTexture = buildRibbon()
  const nebulaTexture = buildNebula()

  // ---------------------------------------------------------------- backdrop
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: nebulaTexture, depthWrite: false, depthTest: false }),
  )
  backdrop.position.z = -240
  scene.add(backdrop)

  // Three cloud sheets at increasing depth: they stream toward the camera
  // during the descent, which is what sells the sense of falling.
  const cloudLayers = [0, 1, 2].map((index) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: buildPuff(index + 3),
        transparent: true,
        opacity: .1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    )
    mesh.userData.baseZ = -170 + index * 52
    mesh.position.z = mesh.userData.baseZ
    scene.add(mesh)
    return mesh
  })

  // Deep starfield filling the volume the star travels through.
  const starCount = 900
  const starPositions = new Float32Array(starCount * 3)
  for (let index = 0; index < starCount; index += 1) {
    starPositions[index * 3] = (Math.random() - .5) * 150
    starPositions[index * 3 + 1] = (Math.random() - .5) * 100
    starPositions[index * 3 + 2] = -220 + Math.random() * 216
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
  const starField = new THREE.Points(starGeometry, new THREE.PointsMaterial({
    map: softDot,
    color: 0xdfeaff,
    size: .8,
    sizeAttenuation: true,
    transparent: true,
    opacity: .45,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }))
  scene.add(starField)

  // ------------------------------------------------------- sky illustration
  // The painted cloud vortex is the resting state of the page. Its dark centre
  // is the star gate: pressing draw dives the camera at it, the plate blows up
  // past the lens, and the meteors pour out of the void behind it.
  // HOLE_FROM_TOP is where that centre sits in the artwork, as a fraction of
  // image height — everything about the dive is aimed at that point.
  const SKY_Z = -60
  const HOLE_FROM_TOP = .22
  const skyMesh = skyTexture
    ? new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: skyTexture, transparent: true, opacity: 1, depthWrite: false, depthTest: false,
      }),
    )
    : null
  if (skyMesh) {
    skyMesh.position.z = SKY_Z
    skyMesh.renderOrder = -1
    scene.add(skyMesh)
  }
  let holeY = 18

  // A soft ring that breathes inside the painted vortex, so the resting page
  // reads as a live gate rather than a still image.
  const gateRing = new THREE.Mesh(new THREE.RingGeometry(3.1, 3.5, 96), additive(0xdfeaff))
  gateRing.position.set(0, holeY, SKY_Z + 3)
  scene.add(gateRing)
  const gateGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDot, color: 0xcfe4ff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  }))
  gateGlow.position.copy(gateRing.position)
  gateGlow.scale.setScalar(16)
  scene.add(gateGlow)

  // ---------------------------------------------------------------- meteors
  // One meteor per drawn reward, each tinted by that reward's own rarity.
  const shedPerMeteor = 44

  function makeMeteor() {
    const group = new THREE.Group()
    group.visible = false
    scene.add(group)

    const trail = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: trailTexture, color: 0xffffff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
        side: THREE.DoubleSide,
      }),
    )
    trail.position.y = .5
    group.add(trail)

    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDot, color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }))
    group.add(halo)

    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDot, color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }))
    group.add(core)

    // Sparks shed along the flight path, kept in world space so they lag.
    const shedPositions = new Float32Array(shedPerMeteor * 3)
    const shedColors = new Float32Array(shedPerMeteor * 3)
    const shedGeometry = new THREE.BufferGeometry()
    shedGeometry.setAttribute('position', new THREE.BufferAttribute(shedPositions, 3))
    shedGeometry.setAttribute('color', new THREE.BufferAttribute(shedColors, 3))
    const shed = new THREE.Points(shedGeometry, new THREE.PointsMaterial({
      map: softDot, size: 1.3, sizeAttenuation: true, vertexColors: true,
      transparent: true, opacity: .95, blending: THREE.AdditiveBlending, depthWrite: false,
    }))
    shed.visible = false
    scene.add(shed)

    // Flare left behind where the meteor lands.
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDot, color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }))
    flare.visible = false
    scene.add(flare)

    return {
      group, trail, halo, core, shed, shedGeometry, shedPositions, shedColors, flare,
      color: new THREE.Color(0xffffff),
      shedCursor: 0, shedLastAt: 0,
      startAt: 0, travel: 0, scale: 1, top: false,
      from: new THREE.Vector3(), to: new THREE.Vector3(),
    }
  }

  const meteors = Array.from({ length: 10 }, makeMeteor)

  // ------------------------------------------------------------------ burst
  const burstGroup = new THREE.Group()
  burstGroup.position.z = -6
  burstGroup.visible = false
  scene.add(burstGroup)

  const burstRays = Array.from({ length: 64 }, (unused, index) => {
    const holder = new THREE.Group()
    holder.rotation.z = (index / 64) * Math.PI * 2
    // Textured so 64 overlapping rays feather instead of stacking into slabs.
    const mesh = new THREE.Mesh(
      rayGeometry(.05, .2),
      additive(0xffffff, 0, { map: ribbonTexture }),
    )
    holder.add(mesh)
    burstGroup.add(holder)
    return { holder, mesh, reach: .55 + (index % 7) * .12, thin: index % 2 === 0 }
  })

  const shockwaves = [0, 1, 2].map((index) => {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(.86, 1, 128), additive(0xffffff))
    mesh.userData.delay = index * 130
    burstGroup.add(mesh)
    return mesh
  })

  const auroras = [0, 1].map((index) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: ribbonTexture,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    )
    mesh.scale.set(90, index === 0 ? 15 : 11, 1)
    mesh.position.set(0, index === 0 ? 6 : -9, -40)
    mesh.rotation.z = index === 0 ? .07 : -.05
    mesh.visible = false
    scene.add(mesh)
    return mesh
  })

  // ----------------------------------------------------------- item reveal
  const revealGroup = new THREE.Group()
  revealGroup.position.z = -7
  revealGroup.visible = false
  scene.add(revealGroup)

  const revealRayHub = new THREE.Group()
  revealGroup.add(revealRayHub)
  const revealRays = Array.from({ length: 40 }, (unused, index) => {
    const holder = new THREE.Group()
    holder.rotation.z = (index / 40) * Math.PI * 2
    const mesh = new THREE.Mesh(
      rayGeometry(.07, .015),
      additive(0xffffff, 0, { map: ribbonTexture }),
    )
    mesh.scale.set(1, 7.5 + (index % 5) * 1.6, 1)
    holder.add(mesh)
    revealRayHub.add(holder)
    return { holder, mesh }
  })

  // Textured so the column feathers at its edges and crown rather than
  // reading as a lit rectangle.
  const revealColumn = new THREE.Mesh(
    rayGeometry(.55, 1.15),
    additive(0xffffff, 0, { map: ribbonTexture }),
  )
  revealColumn.position.y = -5.5
  revealColumn.scale.set(1, 11, 1)
  revealGroup.add(revealColumn)

  const revealHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDot, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  }))
  revealHalo.scale.setScalar(7)
  revealGroup.add(revealHalo)

  // One medallion sprite per rarity tier, swapped in as items are revealed.
  const medallionGroup = new THREE.Group()
  revealGroup.add(medallionGroup)
  const sigils = tierStyles.map((style) => {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: buildSigil(style.sides),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    }))
    sprite.visible = false
    medallionGroup.add(sprite)
    return sprite
  })

  // Sized against the ~7.8 world-unit frustum height at the reveal distance, so
  // the medallion reads large but still leaves room for the DOM plate below it.
  const medallionRing = new THREE.Mesh(new THREE.RingGeometry(1.44, 1.52, 96), additive(0xffffff))
  medallionGroup.add(medallionRing)

  // Motes drifting upward around the medallion.
  const moteCount = 120
  const motePositions = new Float32Array(moteCount * 3)
  const moteSeeds = new Float32Array(moteCount)
  for (let index = 0; index < moteCount; index += 1) {
    motePositions[index * 3] = (Math.random() - .5) * 16
    motePositions[index * 3 + 1] = (Math.random() - .5) * 12
    motePositions[index * 3 + 2] = (Math.random() - .5) * 4
    moteSeeds[index] = Math.random() * 100
  }
  const moteGeometry = new THREE.BufferGeometry()
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3))
  const motes = new THREE.Points(moteGeometry, new THREE.PointsMaterial({
    map: softDot, size: .42, sizeAttenuation: true, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }))
  revealGroup.add(motes)

  // Soft wash sitting behind the DOM summary grid.
  const summaryGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDot, color: 0x8fbfff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
  }))
  summaryGlow.scale.setScalar(46)
  summaryGlow.position.z = -12
  summaryGlow.visible = false
  scene.add(summaryGlow)

  // Camera-parented full-frame planes: a white flash and a rarity colour wash.
  // Explicit renderOrder: these are the closest objects to the camera but they
  // are added to the graph first, so leave nothing to sort order.
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), additive(0xffffff))
  flash.position.z = -1
  flash.renderOrder = 999
  camera.add(flash)
  const grade = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), additive(0xffffff))
  grade.position.z = -1.02
  grade.renderOrder = 998
  camera.add(grade)

  // ----------------------------------------------------------- state machine
  let active = false
  let viewWidth = 16
  let viewHeight = 9
  let run = null
  // Pending deferred total reveal; cleared on reset so a torn-down run cannot
  // pop the settlement back open after the overlay is gone.
  let revealTimer = 0

  function resize(width, height) {
    viewWidth = width
    viewHeight = height
    camera.aspect = width / height
    camera.updateProjectionMatrix()

    // Scale the camera-parented planes to exactly cover the frustum at z=-1.
    const planeHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    const planeWidth = planeHeight * camera.aspect
    flash.scale.set(planeWidth * 1.05, planeHeight * 1.05, 1)
    grade.scale.copy(flash.scale)

    // Cover the backdrop and cloud sheets at their depths.
    const cover = (mesh, distance) => {
      const h = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance
      mesh.scale.set(h * camera.aspect * 1.18, h * 1.18, 1)
    }
    cover(backdrop, 248)
    cloudLayers.forEach((mesh) => cover(mesh, Math.abs(mesh.position.z) + 12))

    // The illustration covers the frame at its depth; the gate sits at the
    // artwork's vortex centre, which is above the image midline.
    if (skyMesh) {
      const distance = Math.abs(SKY_Z) + 8
      const frustumHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * distance
      const frustumWidth = frustumHeight * camera.aspect
      const imageAspect = (skyTexture.image?.width || 16) / (skyTexture.image?.height || 9)
      // Cover: overshoot on whichever axis would otherwise letterbox.
      const useWidth = frustumWidth / frustumHeight > imageAspect
      const drawHeight = useWidth ? frustumWidth / imageAspect : frustumHeight
      const drawWidth = useWidth ? frustumWidth : frustumHeight * imageAspect
      skyMesh.scale.set(drawWidth, drawHeight, 1)
      holeY = (.5 - HOLE_FROM_TOP) * drawHeight
      gateRing.position.y = holeY
      gateGlow.position.y = holeY
      const gateScale = drawHeight / 66
      gateRing.scale.setScalar(gateScale)
      gateGlow.scale.setScalar(16 * gateScale)
    }
  }

  function setActive(value) {
    active = value
    if (!value) reset()
  }

  function hideAll() {
    meteors.forEach((meteor) => {
      meteor.group.visible = false
      meteor.shed.visible = false
      meteor.flare.visible = false
      meteor.trail.material.opacity = 0
      meteor.halo.material.opacity = 0
      meteor.core.material.opacity = 0
      meteor.shedColors.fill(0)
      meteor.shedGeometry.attributes.color.needsUpdate = true
    })
    burstGroup.visible = false
    revealGroup.visible = false
    summaryGlow.visible = false
    auroras.forEach((mesh) => { mesh.visible = false; mesh.material.opacity = 0 })
    flash.material.opacity = 0
    grade.material.opacity = 0
    Object.values(sigils).forEach((sprite) => { sprite.visible = false; sprite.material.opacity = 0 })
  }

  function reset() {
    window.clearTimeout(revealTimer)
    if (run) {
      window.clearTimeout(run.autoTimer)
      run = null
    }
    hideAll()
    cameraRig.position.set(0, 0, 0)
    cameraRig.rotation.set(0, 0, 0)
    camera.position.set(0, 0, 8)
    camera.rotation.set(0, 0, 0)
    starField.position.z = 0
    medallionGroup.scale.setScalar(1)
    medallionGroup.rotation.z = 0
    cloudLayers.forEach((mesh) => { mesh.position.z = mesh.userData.baseZ })
    // Back to the resting illustration.
    if (skyMesh) {
      skyMesh.visible = true
      skyMesh.material.opacity = 1
      skyMesh.scale.z = 1
    }
    gateRing.visible = true
    gateGlow.visible = true
  }

  // Stage list. `duration` is the auto-advance delay; the final stage never
  // auto-advances and is where the playback promise resolves.
  function buildStages(data, quick, tierMap) {
    const grand = topTierIndex(data, tierMap) === 4
    const stages = []
    if (quick) {
      stages.push({ kind: 'gate', duration: 420 })
      stages.push({ kind: 'descent', duration: 620 })
      stages.push({ kind: 'burst', duration: 420 })
      stages.push({ kind: 'summary', duration: 0 })
      return stages
    }
    stages.push({ kind: 'gate', duration: 1150 })
    stages.push({ kind: 'descent', duration: grand ? 3200 : 2400 })
    stages.push({ kind: 'burst', duration: grand ? 1600 : 950 })
    data.items.forEach((item, index) => {
      stages.push({ kind: 'item', index, item, duration: 4200 })
    })
    // A single pull ends on its own item card, matching Genshin.
    if (data.drawCount > 1) stages.push({ kind: 'summary', duration: 0 })
    return stages
  }

  // Where each meteor comes to rest, spread across the lower frame.
  function landingSpots(count) {
    if (count === 1) return [{ x: 0, y: -.5 }]
    if (count === 5) {
      return [-9, -4.5, 0, 4.5, 9].map((x, index) => ({ x, y: index % 2 === 0 ? -1 : -3.4 }))
    }
    return [
      { x: -10.5, y: 1.8 }, { x: -5.2, y: .4 }, { x: 0, y: 1.8 },
      { x: 5.2, y: .4 }, { x: 10.5, y: 1.8 },
      { x: -10.5, y: -4.4 }, { x: -5.2, y: -5.6 }, { x: 0, y: -4.4 },
      { x: 5.2, y: -5.6 }, { x: 10.5, y: -4.4 },
    ]
  }

  // One meteor per reward, tinted by that reward's own rarity. The top-rarity
  // one is scaled up and lands last so it reads as the prize of the pull.
  function configureMeteors(data, span) {
    const spots = landingSpots(data.drawCount)
    const best = topTierIndex(data, run.tierMap)
    const topIndex = data.items.findIndex(
      (item) => tierIndexOf(tierFor(run.tierMap, item.amountUsd)) === best,
    )
    const stagger = data.drawCount === 1 ? 0 : span * .46 / data.drawCount

    meteors.forEach((meteor, index) => {
      const item = data.items[index]
      meteor.active = index < data.drawCount
      meteor.group.visible = false
      meteor.shed.visible = false
      meteor.flare.visible = false
      meteor.shedCursor = 0
      meteor.shedLastAt = 0
      meteor.shedColors.fill(0)
      meteor.shedGeometry.attributes.color.needsUpdate = true
      if (!meteor.active) return

      const spot = spots[index]
      const style = tierFor(run.tierMap, item.amountUsd)
      meteor.top = index === topIndex
      meteor.color.set(style.primary)
      meteor.scale = meteor.top ? 1.45 : 1
      // The prize meteor leaves last, so the eye finishes on it.
      meteor.startAt = meteor.top ? span * .4 : index * stagger
      meteor.travel = span * (meteor.top ? .55 : .5)
      // Streak diagonally DOWN ACROSS the frame rather than straight at the
      // lens. A path that is mostly depth keeps every meteor pinned near the
      // vanishing point as a tiny dot until it suddenly swells — which reads as
      // one cluster, not ten falling stars. Launching high and wide, from a
      // depth close to the landing plane, keeps all ten legible and separate.
      meteor.from.set(
        spot.x * 2.1 + (Math.random() - .5) * 6,
        24 + Math.random() * 9,
        -88 - Math.random() * 22,
      )
      meteor.to.set(spot.x, spot.y, -10)
      meteor.arc = (index % 2 === 0 ? 1 : -1) * (2 + (index % 3) * 2)

      meteor.trail.material.color.copy(meteor.color)
      meteor.halo.material.color.copy(meteor.color)
      meteor.flare.material.color.copy(meteor.color)
    })
  }

  function enterStage(index) {
    if (!run) return
    const target = Math.min(index, run.stages.length - 1)
    if (target <= run.cursor && run.entered) return
    run.cursor = target
    run.entered = true
    const stage = run.stages[target]
    stage.enteredAt = performance.now()
    run.stage = stage

    if (stage.kind === 'descent') configureMeteors(run.data, stage.duration)
    if (stage.kind === 'item') {
      const style = tierFor(run.tierMap, stage.item.amountUsd)
      const color = new THREE.Color(style.primary)
      revealRays.forEach(({ mesh }) => mesh.material.color.copy(color))
      revealColumn.material.color.copy(color)
      revealHalo.material.color.copy(color)
      medallionRing.material.color.copy(color)
      const tier = tierIndexOf(style)
      sigils.forEach((sprite, index) => {
        sprite.visible = index === tier
        sprite.material.opacity = 0
        sprite.material.color.copy(color).lerp(new THREE.Color(0xffffff), .5)
      })
      motes.material.color.copy(color)
    }
    if (stage.kind === 'summary') {
      const style = tierStyles[topTierIndex(run.data, run.tierMap)]
      summaryGlow.material.color.set(style.primary)
    }

    hooks.onStage?.(stage, run.data, run.tierMap)

    window.clearTimeout(run.autoTimer)
    const last = target === run.stages.length - 1
    if (last) finish()
    else if (stage.duration > 0) {
      // Timing out plays the NEXT stage. This must not go through advance(),
      // which is the user-tap path and deliberately skips the cinematic.
      run.autoTimer = window.setTimeout(() => enterStage(run ? run.cursor + 1 : 0), stage.duration)
    }
  }

  // User-initiated. Tapping during the cinematic jumps to the first reward;
  // tapping on a card moves to the next one.
  function advance() {
    if (!run) return
    const stage = run.stage
    if (!stage) return
    if (stage.kind === 'gate' || stage.kind === 'descent' || stage.kind === 'burst') {
      const first = run.stages.findIndex((item) => item.kind === 'item' || item.kind === 'summary')
      enterStage(first)
      return
    }
    enterStage(run.cursor + 1)
  }

  function finish() {
    if (!run || run.finished) return
    run.finished = true
    window.clearTimeout(run.autoTimer)
    // The total is withheld until the sequence is over, and then given its own
    // beat: the summary tiles stagger in over ~820ms, and on a single pull the
    // card needs to land before its amount is echoed underneath.
    window.clearTimeout(revealTimer)
    const data = run.data
    revealTimer = window.setTimeout(() => hooks.onReveal?.(data), 900)
    hooks.onFinish?.(run.data)
    run.resolve()
  }

  function play(data, { quick = false, reducedMotion = false, tierMap = new Map() } = {}) {
    reset()
    const stages = buildStages(data, quick, tierMap)
    return new Promise((resolve) => {
      run = {
        data,
        stages,
        quick,
        reducedMotion,
        tierMap,
        grand: topTierIndex(data, tierMap) === 4,
        cursor: -1,
        entered: false,
        stage: null,
        finished: false,
        resolve,
        autoTimer: 0,
        startedAt: performance.now(),
      }
      enterStage(0)
    })
  }

  // ---------------------------------------------------------------- per-frame

  function updateIdle(time) {
    starField.rotation.z = time * .000012
    backdrop.position.x = Math.sin(time * .00007) * 3
    cloudLayers.forEach((mesh, index) => {
      mesh.position.x = Math.sin(time * .00005 + index) * 8
      mesh.material.opacity = .07 + Math.sin(time * .0004 + index * 1.7) * .03
    })
    // The resting illustration breathes at the gate so it is not a still frame.
    if (gateRing.visible) {
      gateRing.rotation.z = time * .00007
      gateRing.material.opacity = .16 + Math.sin(time * .0013) * .07
      gateGlow.material.opacity = .1 + Math.sin(time * .0011) * .045
    }
    if (skyMesh?.visible) skyMesh.position.x = Math.sin(time * .00004) * .7
  }

  // Pressing draw dives at the vortex: the plate rushes past the lens and a
  // white flash cuts to the void the meteors fall through.
  function updateGate(time, stage) {
    const local = time - stage.enteredAt
    const linear = clamp01(local / Math.max(1, stage.duration))
    const push = Math.pow(linear, 2.4)

    meteors.forEach((meteor) => { meteor.group.visible = false; meteor.shed.visible = false })
    burstGroup.visible = false
    revealGroup.visible = false

    if (skyMesh) {
      skyMesh.visible = push < .97
      // Fade only at the very end, so the artwork stays legible while it grows.
      skyMesh.material.opacity = 1 - clamp01((linear - .72) / .28)
    }
    gateRing.visible = push < .9
    gateGlow.visible = gateRing.visible
    gateRing.material.opacity = (.16 + push * .5) * (1 - clamp01((linear - .7) / .3))
    gateGlow.material.opacity = (.1 + push * .55) * (1 - clamp01((linear - .7) / .3))

    if (!run.reducedMotion) {
      // Aim the lens at the gate while closing on it.
      cameraRig.position.set(0, holeY * push, -(Math.abs(SKY_Z) + 2) * push)
      cameraRig.rotation.z = push * .06
    } else {
      cameraRig.position.set(0, 0, 0)
    }

    flash.material.color.set(0xffffff)
    flash.material.opacity = Math.pow(clamp01((linear - .78) / .22), 2)
    grade.material.opacity = 0
  }

  const WHITE = new THREE.Color(0xffffff)
  const scratchAt = new THREE.Vector3()
  const scratchPrev = new THREE.Vector3()

  function meteorPath(meteor, progress, out) {
    out.copy(meteor.from).lerp(meteor.to, progress)
    // Bow the path so each meteor sweeps rather than tracking a straight line.
    const bow = Math.sin(progress * Math.PI)
    out.x += bow * meteor.arc
    out.y += bow * 4.5
    return out
  }

  // Every drawn reward gets its own meteor, on its own clock, in its own
  // rarity colour, landing at its own spot.
  function updateDescent(time, stage) {
    const local = time - stage.enteredAt
    const span = Math.max(1, stage.duration)
    const linear = clamp01(local / span)
    const style = tierStyles[topTierIndex(run.data, run.tierMap)]

    if (skyMesh) skyMesh.visible = false
    gateRing.visible = false
    gateGlow.visible = false
    burstGroup.visible = false
    revealGroup.visible = false

    meteors.forEach((meteor) => {
      if (!meteor.active) return
      const raw = clamp01((local - meteor.startAt) / Math.max(1, meteor.travel))
      let travel = Math.pow(raw, 2.05)
      // The prize meteor holds a beat before its final dash on a gold pull.
      if (meteor.top && run.grand) {
        const hitch = clamp01((raw - .5) / .2)
        travel = travel * (1 - hitch * .32) + Math.pow(raw, 5) * hitch * .32
      }
      const started = local >= meteor.startAt
      const landed = started && raw >= 1
      meteor.group.visible = started && !landed
      meteor.shed.visible = started

      if (started && !landed) {
        meteorPath(meteor, travel, scratchAt)
        meteor.group.position.copy(scratchAt)
        meteorPath(meteor, Math.max(0, travel - .014), scratchPrev)
        // The trail extends along local +y, so map that axis onto -heading.
        meteor.group.rotation.z = Math.atan2(
          scratchAt.x - scratchPrev.x,
          -(scratchAt.y - scratchPrev.y),
        )

        // Size and trail length are normalised by camera distance. In world
        // units a fixed-length trail would be magnified ~5x over the flight and
        // end up longer than the screen; scaling by depth keeps the on-screen
        // streak roughly constant, growing only slightly as it closes in.
        const depth = Math.max(6, camera.position.z + cameraRig.position.z - scratchAt.z)
        const grow = .7 + travel * .6
        const size = depth * .021 * grow * meteor.scale
        meteor.core.scale.setScalar(size)
        meteor.halo.scale.setScalar(size * 2.3)
        meteor.core.material.color.copy(meteor.color).lerp(WHITE, .6)
        const fadeIn = clamp01((local - meteor.startAt) / 130)
        meteor.core.material.opacity = fadeIn * .9
        meteor.halo.material.opacity = fadeIn * .4
        meteor.trail.material.opacity = fadeIn * .7
        const trailLength = depth * .17 * grow * meteor.scale
        meteor.trail.scale.set(size * 1.6, trailLength, 1)
        meteor.trail.position.y = trailLength / 2

        // Shed a spark every ~30ms into a world-space ring buffer so it lags.
        if (time - meteor.shedLastAt > 30) {
          meteor.shedLastAt = time
          const cursor = meteor.shedCursor % shedPerMeteor
          meteor.shedPositions[cursor * 3] = scratchAt.x
          meteor.shedPositions[cursor * 3 + 1] = scratchAt.y
          meteor.shedPositions[cursor * 3 + 2] = scratchAt.z
          meteor.shedColors[cursor * 3] = meteor.color.r
          meteor.shedColors[cursor * 3 + 1] = meteor.color.g
          meteor.shedColors[cursor * 3 + 2] = meteor.color.b
          meteor.shedCursor += 1
          meteor.shedGeometry.attributes.position.needsUpdate = true
        }
      }

      // Landing flare: bright on impact, then settling to an ember.
      if (landed) {
        const since = (local - meteor.startAt) - meteor.travel
        const pop = clamp01(since / 200)
        const settle = Math.max(.18, 1 - clamp01((since - 200) / 900) * .82)
        meteor.flare.visible = true
        meteor.flare.position.copy(meteor.to)
        meteor.flare.scale.setScalar((1.6 + easeOut(pop) * 3.4) * meteor.scale)
        meteor.flare.material.opacity = easeOut(pop) * settle * .45
      } else {
        meteor.flare.visible = false
      }

      for (let index = 0; index < shedPerMeteor; index += 1) {
        meteor.shedColors[index * 3] *= .952
        meteor.shedColors[index * 3 + 1] *= .952
        meteor.shedColors[index * 3 + 2] *= .952
      }
      meteor.shedGeometry.attributes.color.needsUpdate = true
    })

    // Clouds rush past; the lens settles out of the gate dive.
    cloudLayers.forEach((mesh, index) => {
      mesh.position.z = mesh.userData.baseZ + linear * (150 + index * 26)
      mesh.material.opacity = .13 * (1 - linear * .5)
    })
    if (!run.reducedMotion) {
      const settleIn = easeOut(clamp01(local / 700))
      cameraRig.position.set(0, holeY * (1 - settleIn) * .18, 0)
      cameraRig.rotation.z = (1 - settleIn) * .05 + Math.sin(time * .0004) * .006
      camera.position.z = 8 - linear * 1.2
    }
    starField.position.z = linear * 40

    grade.material.color.set(style.primary)
    grade.material.opacity = linear * (run.grand ? .18 : .08)
    flash.material.color.set(0xffffff)
    // Bloom out just before the collective burst.
    flash.material.opacity = Math.pow(clamp01((linear - .9) / .1), 2) * .8
  }

  function updateBurst(time, stage) {
    const local = time - stage.enteredAt
    const span = Math.max(1, stage.duration)
    const linear = clamp01(local / span)
    const style = tierStyles[topTierIndex(run.data, run.tierMap)]
    const color = new THREE.Color(style.primary)
    const rays = [22, 28, 34, 48, 64][topTierIndex(run.data, run.tierMap)]

    if (skyMesh) skyMesh.visible = false
    gateRing.visible = false
    gateGlow.visible = false
    burstGroup.visible = true

    // Meteors are down; their sparks and landing embers keep decaying.
    meteors.forEach((meteor) => {
      meteor.group.visible = false
      if (!meteor.active) return
      meteor.shed.visible = true
      for (let index = 0; index < shedPerMeteor; index += 1) {
        meteor.shedColors[index * 3] *= .93
        meteor.shedColors[index * 3 + 1] *= .93
        meteor.shedColors[index * 3 + 2] *= .93
      }
      meteor.shedGeometry.attributes.color.needsUpdate = true
      meteor.flare.material.opacity *= .94
      meteor.flare.visible = meteor.flare.material.opacity > .01
    })

    const grow = easeOut(clamp01(linear / .42))
    const fade = 1 - Math.pow(clamp01((linear - .46) / .54), 1.5)
    burstGroup.rotation.z = linear * .34
    burstRays.forEach((ray, index) => {
      const on = index < rays
      ray.holder.visible = on
      if (!on) return
      const stagger = clamp01((linear - (index % 9) * .012) / .42)
      // Reach is bounded to the frame: the frustum is ~15 units tall here, so
      // 20-unit rays just wash the screen instead of reading as rays.
      const length = (3 + ray.reach * 8.5) * easeOut(stagger)
      ray.mesh.scale.set(ray.thin ? .6 : 1.1, length, 1)
      ray.mesh.material.color.copy(ray.thin ? WHITE : color)
      ray.mesh.material.opacity = easeOut(stagger) * fade * (ray.thin ? .34 : .24)
    })

    shockwaves.forEach((mesh, index) => {
      const shockLocal = clamp01((local - mesh.userData.delay) / (span * .8))
      const size = easeOut(shockLocal) * (7 + index * 3.5)
      mesh.scale.setScalar(Math.max(.001, size))
      mesh.material.color.copy(index === 1 ? WHITE : color)
      mesh.material.opacity = (1 - shockLocal) * .22
    })

    flash.material.color.set(0xffffff)
    flash.material.opacity = Math.pow(1 - clamp01(linear / .22), 2) * .5
    grade.material.color.copy(color)
    grade.material.opacity = (run.grand ? .16 : .08) * fade

    if (run.grand && !run.reducedMotion) {
      auroras.forEach((mesh, index) => {
        mesh.visible = true
        mesh.material.color.copy(color)
        mesh.material.opacity = grow * fade * (index === 0 ? .3 : .2)
        mesh.position.x = Math.sin(time * .00022 + index * 2.1) * 12
      })
    }
    if (!run.reducedMotion) {
      // Recoil kick on impact.
      const kick = Math.pow(1 - clamp01(linear / .25), 2)
      cameraRig.position.x = Math.sin(time * .09) * .5 * kick
      cameraRig.position.y = Math.cos(time * .11) * .4 * kick
      cameraRig.rotation.z = Math.sin(time * .07) * .02 * kick
    }
  }

  function updateItem(time, stage) {
    const local = time - stage.enteredAt
    const style = tierFor(run.tierMap, stage.item.amountUsd)
    const color = new THREE.Color(style.primary)
    const intro = clamp01(local / 620)

    revealGroup.visible = true
    burstGroup.visible = false
    meteors.forEach((meteor) => {
      meteor.group.visible = false
      meteor.shed.visible = false
      meteor.flare.visible = false
    })
    if (skyMesh) skyMesh.visible = false
    gateRing.visible = false
    gateGlow.visible = false
    summaryGlow.visible = false
    auroras.forEach((mesh) => { mesh.visible = false })

    revealRayHub.rotation.z = time * .00013
    revealRays.forEach(({ mesh }, index) => {
      mesh.material.opacity = intro * (.1 + (index % 3) * .05)
    })

    const columnRise = easeOut(clamp01(local / 520))
    revealColumn.material.opacity = columnRise * .3 * (1 - clamp01((local - 2600) / 2600) * .5)
    revealColumn.scale.set(1, 11 * columnRise, 1)

    revealHalo.material.opacity = intro * .26 + Math.sin(time * .0016) * .03
    revealHalo.scale.setScalar(6.6 + Math.sin(time * .0013) * .4)

    const pop = clamp01(local / 480)
    const medallionScale = run.reducedMotion ? 1 : easeOutBack(pop)
    medallionGroup.scale.setScalar(Math.max(.001, medallionScale))
    medallionGroup.rotation.z = run.reducedMotion ? 0 : time * .00007
    const sprite = sigils[tierIndexOf(tierFor(run.tierMap, stage.item.amountUsd))]
    sprite.scale.setScalar(3.5)
    sprite.material.opacity = intro
    medallionRing.material.opacity = intro * .55 + Math.sin(time * .0022) * .05
    medallionRing.scale.setScalar(1 + Math.sin(time * .0018) * .012)

    motes.material.opacity = intro * .5
    const moteAttribute = motes.geometry.attributes.position
    for (let index = 0; index < moteCount; index += 1) {
      const drift = ((time * .00022 + moteSeeds[index]) % 1)
      moteAttribute.array[index * 3 + 1] = -6 + drift * 12
    }
    moteAttribute.needsUpdate = true

    grade.material.color.copy(color)
    grade.material.opacity = .07
    // Quick wipe on entry so consecutive items feel cut, not cross-faded.
    flash.material.color.copy(color).lerp(new THREE.Color(0xffffff), .6)
    flash.material.opacity = Math.pow(1 - clamp01(local / 260), 2) * .55

    if (!run.reducedMotion) {
      cameraRig.position.x = Math.sin(time * .00035) * .18
      cameraRig.position.y = Math.cos(time * .0003) * .12
      cameraRig.rotation.z = 0
      camera.position.z = 8 - easeOut(clamp01(local / 900)) * .5
    }
  }

  function updateSummary(time, stage) {
    const local = time - stage.enteredAt
    const intro = clamp01(local / 640)
    const style = tierStyles[topTierIndex(run.data, run.tierMap)]

    revealGroup.visible = false
    burstGroup.visible = false
    meteors.forEach((meteor) => {
      meteor.group.visible = false
      meteor.shed.visible = false
      meteor.flare.visible = false
    })
    if (skyMesh) skyMesh.visible = false
    gateRing.visible = false
    gateGlow.visible = false
    summaryGlow.visible = true
    summaryGlow.material.opacity = intro * .18 + Math.sin(time * .0012) * .015
    summaryGlow.scale.setScalar(30 + Math.sin(time * .0009) * 1.2)
    auroras.forEach((mesh, index) => {
      const on = run.grand && !run.reducedMotion
      mesh.visible = on
      if (!on) return
      mesh.material.color.set(style.primary)
      mesh.material.opacity = intro * (index === 0 ? .18 : .12)
      mesh.position.x = Math.sin(time * .00018 + index * 2.1) * 14
    })

    grade.material.color.set(style.primary)
    // Kept low: a full-frame additive gold over the navy void turns brown fast.
    grade.material.opacity = .03
    flash.material.opacity = Math.pow(1 - clamp01(local / 300), 2) * .4
    if (!run.reducedMotion) {
      // Ease back so the grid has air around it.
      camera.position.z = 8 + easeOut(clamp01(local / 700)) * 1.4
      cameraRig.position.set(0, 0, 0)
      cameraRig.rotation.z = 0
    }
  }

  function update(time) {
    if (!active) return
    updateIdle(time)
    const stage = run?.stage
    if (!stage) {
      hideAll()
      return
    }
    if (stage.kind === 'gate') updateGate(time, stage)
    else if (stage.kind === 'descent') updateDescent(time, stage)
    else if (stage.kind === 'burst') updateBurst(time, stage)
    else if (stage.kind === 'item') updateItem(time, stage)
    else if (stage.kind === 'summary') updateSummary(time, stage)
  }

  function render() {
    renderer.render(scene, camera)
  }

  resize(viewWidth, viewHeight)
  reset()

  return {
    scene,
    camera,
    isActive: () => active,
    isPlaying: () => Boolean(run && !run.finished),
    setActive,
    resize,
    update,
    render,
    play,
    advance,
    reset,
  }
}
