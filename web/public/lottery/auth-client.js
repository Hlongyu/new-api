const refreshPath = '/api/user/auth/refresh'
const refreshRaceDelays = [80, 200, 500]
const authChannelName = 'new-api-companion-auth-v1'
const refreshLockName = 'new-api-companion-auth-refresh-v1'
const fallbackRateLimitSeconds = 60

export class AuthenticationError extends Error {
  constructor(message = '登录状态已失效') {
    super(message)
    this.name = 'AuthenticationError'
    this.status = 401
  }
}

export class AuthenticationRateLimitError extends Error {
  constructor(message = '认证请求过于频繁，请稍后重试', retryAt = 0) {
    super(message)
    this.name = 'AuthenticationRateLimitError'
    this.status = 429
    this.retryAt = retryAt
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object'
}

function validSession(session) {
  return isObject(session) && typeof session.sid === 'string' && session.sid.length > 0
}

function parseBundle(value) {
  if (!isObject(value) || typeof value.access_token !== 'string' ||
      value.access_token.length === 0 || value.token_type !== 'Bearer' ||
      !Number.isFinite(Number(value.access_expires_at)) ||
      !isObject(value.user) || !Number.isInteger(Number(value.user.id)) ||
      Number(value.user.id) <= 0 || !validSession(value.session)) return null
  return value
}

function authenticationError(payload) {
  return new AuthenticationError(payload?.message || '登录状态已失效')
}

function responseError(response, payload) {
  const error = new Error(payload?.message || '认证刷新失败')
  error.status = response.status
  error.code = typeof payload?.code === 'string' ? payload.code : ''
  return error
}

function bundleAuthorization(bundle) {
  return bundle ? `${bundle.token_type} ${bundle.access_token}` : ''
}

function retryAfterTime(response, currentTime, fallbackSeconds) {
  const value = response.headers.get('Retry-After')?.trim() || ''
  if (/^\d+$/.test(value)) return currentTime + Number(value) * 1000
  const parsedDate = Date.parse(value)
  if (Number.isFinite(parsedDate) && parsedDate > currentTime) return parsedDate
  return currentTime + fallbackSeconds * 1000
}

function previewAuthorization(location) {
  if (!location || !['localhost', '127.0.0.1'].includes(location.hostname)) return ''
  const previewUserId = new URL(location.href).searchParams.get('preview_user_id') || ''
  return /^\d+$/.test(previewUserId) && Number(previewUserId) > 0
    ? `Preview ${previewUserId}`
    : ''
}

export function createAuthClient({
  fetchImpl = (...args) => globalThis.fetch(...args),
  getLocation = () => globalThis.location,
  now = () => Math.floor(Date.now() / 1000),
  nowMs = () => Date.now(),
  wait = (milliseconds) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)),
  createChannel = (name) => {
    const Channel = globalThis.window?.BroadcastChannel
    return typeof Channel === 'function' ? new Channel(name) : null
  },
  getLocks = () => globalThis.navigator?.locks || null,
  peerWaitMs = 60,
} = {}) {
  let bundle = null
  let bundleUpdatedAt = 0
  let refreshPromise = null
  let channel = null
  let channelInitialized = false
  let cooldownUntil = 0
  let cooldownMessage = '认证请求过于频繁，请稍后重试'
  let rateLimitAttempts = 0
  const sourceId = globalThis.crypto?.randomUUID?.() ||
    `${Math.random().toString(36).slice(2)}-${nowMs()}`

  function hasUsableBundle(rejectedAuthorization = '') {
    return Boolean(bundle) && Number(bundle.access_expires_at) > now() + 30 &&
      bundleAuthorization(bundle) !== rejectedAuthorization
  }

  function postMessage(message) {
    channel?.postMessage({ ...message, source: sourceId })
  }

  function acceptBundle(nextBundle, updatedAt = nowMs(), broadcast = false) {
    if (!nextBundle || updatedAt < bundleUpdatedAt) return false
    bundle = nextBundle
    bundleUpdatedAt = updatedAt
    if (broadcast) postMessage({ type: 'bundle', bundle, updatedAt: bundleUpdatedAt })
    return true
  }

  function setCooldown(until, message, broadcast = false) {
    if (!Number.isFinite(until) || until <= cooldownUntil) return
    cooldownUntil = until
    cooldownMessage = message || '认证请求过于频繁，请稍后重试'
    if (broadcast) postMessage({ type: 'cooldown', until, message: cooldownMessage })
  }

  function ensureChannel() {
    if (channelInitialized) return channel
    channelInitialized = true
    channel = createChannel(authChannelName)
    if (!channel) return null
    channel.addEventListener('message', (event) => {
      const message = event?.data
      if (!isObject(message) || message.source === sourceId) return
      if (message.type === 'bundle') {
        const sharedBundle = parseBundle(message.bundle)
        if (sharedBundle && Number(sharedBundle.access_expires_at) > now() + 30) {
          acceptBundle(sharedBundle, Number(message.updatedAt) || 0)
        }
        return
      }
      if (message.type === 'bundle-request') {
        if (hasUsableBundle(message.rejectedAuthorization || '')) {
          postMessage({ type: 'bundle', bundle, updatedAt: bundleUpdatedAt })
        }
        if (cooldownUntil > nowMs()) {
          postMessage({ type: 'cooldown', until: cooldownUntil, message: cooldownMessage })
        }
        return
      }
      if (message.type === 'cooldown') {
        setCooldown(Number(message.until), message.message)
      }
    })
    return channel
  }

  function rateLimitError() {
    return new AuthenticationRateLimitError(cooldownMessage, cooldownUntil)
  }

  function assertRefreshAllowed() {
    if (cooldownUntil > nowMs()) throw rateLimitError()
    cooldownUntil = 0
  }

  async function requestPeerBundle(rejectedAuthorization) {
    if (!ensureChannel()) return null
    postMessage({ type: 'bundle-request', rejectedAuthorization })
    await wait(peerWaitMs)
    return hasUsableBundle(rejectedAuthorization) ? bundle : null
  }

  async function withRefreshLock(callback) {
    const locks = getLocks()
    if (!locks || typeof locks.request !== 'function') return callback()
    return locks.request(refreshLockName, { mode: 'exclusive' }, callback)
  }

  async function requestRefresh(expectedSessionId = '', raceAttempt = 0, retryMismatch = true) {
    assertRefreshAllowed()
    const headers = { Accept: 'application/json' }
    if (expectedSessionId) headers['X-Auth-Session'] = expectedSessionId
    const response = await fetchImpl(refreshPath, {
      method: 'POST',
      headers,
      credentials: 'include',
      cache: 'no-store',
    })
    const payload = await response.json().catch(() => ({}))
    const nextBundle = payload?.success === true ? parseBundle(payload.data) : null
    if (response.ok && nextBundle) {
      rateLimitAttempts = 0
      cooldownUntil = 0
      acceptBundle(nextBundle, nowMs(), true)
      return nextBundle
    }

    const code = typeof payload?.code === 'string' ? payload.code : ''
    if (response.status === 409 && code === 'AUTH_REFRESH_RACE' &&
        raceAttempt < refreshRaceDelays.length) {
      await wait(refreshRaceDelays[raceAttempt])
      return requestRefresh(expectedSessionId, raceAttempt + 1, retryMismatch)
    }
    if (response.status === 409 && code === 'AUTH_SESSION_MISMATCH' && retryMismatch) {
      bundle = null
      return requestRefresh('', 0, false)
    }
    if (response.status === 401) {
      bundle = null
      bundleUpdatedAt = 0
      throw authenticationError(payload)
    }
    if (response.status === 429) {
      const fallbackSeconds = Math.min(
        fallbackRateLimitSeconds * (2 ** rateLimitAttempts),
        300,
      )
      rateLimitAttempts += 1
      const until = retryAfterTime(response, nowMs(), fallbackSeconds)
      setCooldown(until, '认证请求过于频繁，请稍后重试', true)
      throw rateLimitError()
    }
    throw responseError(response, payload)
  }

  async function refresh(force = false, rejectedAuthorization = '') {
    const preview = previewAuthorization(getLocation())
    if (preview) return { authorization: preview }
    if (!force && hasUsableBundle()) return bundle
    if (refreshPromise) return refreshPromise
    const staleAuthorization = rejectedAuthorization ||
      (force ? bundleAuthorization(bundle) : '')
    ensureChannel()
    refreshPromise = withRefreshLock(async () => {
      if (hasUsableBundle(staleAuthorization)) return bundle
      const peerBundle = await requestPeerBundle(staleAuthorization)
      if (peerBundle) return peerBundle
      assertRefreshAllowed()
      const expectedSessionId = validSession(bundle?.session) ? bundle.session.sid : ''
      return requestRefresh(expectedSessionId)
    }).finally(() => {
      refreshPromise = null
    })
    return refreshPromise
  }

  async function authorization(force = false, rejectedAuthorization = '') {
    const preview = previewAuthorization(getLocation())
    if (preview) return preview
    const current = await refresh(force, rejectedAuthorization)
    return bundleAuthorization(current)
  }

  async function authenticatedFetch(input, init = {}) {
    const preview = previewAuthorization(getLocation())
    let currentAuthorization = await authorization(false)
    const send = () => {
      const headers = new Headers(init.headers || {})
      headers.set('Authorization', currentAuthorization)
      return fetchImpl(input, {
        ...init,
        headers,
        credentials: 'omit',
      })
    }
    let response = await send()
    if (response.status !== 401 || preview) return response
    currentAuthorization = await authorization(true, currentAuthorization)
    response = await send()
    return response
  }

  return {
    fetch: authenticatedFetch,
    refresh: () => refresh(true),
    clear() {
      bundle = null
      bundleUpdatedAt = 0
    },
  }
}

const authClient = createAuthClient()

export const authenticatedFetch = (...args) => authClient.fetch(...args)

export function redirectToSignIn() {
  const signInUrl = new URL('/sign-in', window.location.origin)
  signInUrl.searchParams.set(
    'redirect',
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  )
  window.location.replace(signInUrl)
}
