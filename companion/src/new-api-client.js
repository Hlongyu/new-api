export class NewApiError extends Error {
  constructor(message, status = 502, details = null) {
    super(message)
    this.name = 'NewApiError'
    this.status = status
    this.details = details
  }
}

export class NewApiClient {
  constructor({ baseUrl, timeoutMs = 12_000 }) {
    this.baseUrl = baseUrl
    this.timeoutMs = timeoutMs
  }

  async request(path, options = {}) {
    if (!this.baseUrl) throw new NewApiError('尚未配置 New API 地址', 503)
    const requestOptions = (
      'method' in options || 'headers' in options || 'body' in options
    ) ? options : { headers: options }
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: requestOptions.method || 'GET',
        headers: { Accept: 'application/json', ...(requestOptions.headers || {}) },
        body: requestOptions.body === undefined
          ? undefined
          : JSON.stringify(requestOptions.body),
        redirect: 'error',
        signal: controller.signal,
      })
      const text = await response.text()
      let body
      try {
        body = text ? JSON.parse(text) : {}
      } catch {
        throw new NewApiError('New API 返回了无法解析的数据', 502)
      }
      if (!response.ok) {
        throw new NewApiError(
          body?.message || `New API 请求失败 (${response.status})`,
          response.status === 401 || response.status === 403 ? 401 : 502,
          body,
        )
      }
      return body
    } catch (error) {
      if (error instanceof NewApiError) throw error
      if (error?.name === 'AbortError') {
        throw new NewApiError('New API 请求超时', 504)
      }
      throw new NewApiError(`无法连接 New API：${error.message}`, 502)
    } finally {
      clearTimeout(timeout)
    }
  }

  userHeaders(userId, accessToken) {
    return {
      Authorization: accessToken,
      'New-Api-User': String(userId),
    }
  }

  async getSessionUser(authorizationHeader) {
    const authorization = String(authorizationHeader || '').trim()
    if (!/^Bearer\s+\S+$/.test(authorization)) {
      throw new NewApiError('请先登录主站', 401)
    }
    const body = await this.request('/api/user/self', {
      headers: { Authorization: authorization },
    })
    if (!body?.success || !Number.isInteger(Number(body?.data?.id))) {
      throw new NewApiError(body?.message || '登录状态已失效', 401)
    }
    return body.data
  }

  sessionHeaders(authorizationHeader) {
    const authorization = String(authorizationHeader || '').trim()
    if (!/^Bearer\s+\S+$/.test(authorization)) {
      throw new NewApiError('请先登录主站', 401)
    }
    return { Authorization: authorization }
  }

  async getPerfMetricsSummary(authorizationHeader) {
    const body = await this.request('/api/perf-metrics/summary', {
      headers: this.sessionHeaders(authorizationHeader),
    })
    if (!body?.success || !Array.isArray(body?.data?.models)) {
      throw new NewApiError(body?.message || '无法读取模型性能总览', 502, body)
    }
    return body.data
  }

  async getPerfMetrics({ model, group = '' }, authorizationHeader) {
    const modelName = String(model || '').trim()
    if (!modelName) {
      const error = new NewApiError('模型名称不能为空', 400)
      error.status = 400
      throw error
    }
    const query = new URLSearchParams({ model: modelName })
    const groupName = String(group || '').trim()
    if (groupName) query.set('group', groupName)
    const body = await this.request(`/api/perf-metrics?${query}`, {
      headers: this.sessionHeaders(authorizationHeader),
    })
    if (!body?.success || !body?.data || !Array.isArray(body.data.groups)) {
      throw new NewApiError(body?.message || '无法读取模型性能详情', 502, body)
    }
    return body.data
  }

  async getUsers(rootUserId, rootAccessToken) {
    const users = []
    const pageSize = 100
    let total = Infinity

    for (let page = 1; users.length < total; page += 1) {
      const query = new URLSearchParams({
        p: String(page),
        page_size: String(pageSize),
      })
    const body = await this.request(
        `/api/user/?${query}`,
        { headers: this.userHeaders(rootUserId, rootAccessToken) },
      )
      const items = body?.data?.items
      if (!body?.success || !Array.isArray(items)) {
        throw new NewApiError(body?.message || '无法读取用户列表', 502)
      }
      total = Number(body.data.total)
      if (!Number.isFinite(total) || total < 0) total = users.length + items.length
      users.push(...items)
      if (items.length === 0) break
    }

    return users
  }

  async listRedeemedCodes(rootUserId, rootAccessToken) {
    const redemptions = []
    const pageSize = 100
    let total = Infinity

    for (let page = 1; redemptions.length < total; page += 1) {
      const query = new URLSearchParams({
        p: String(page),
        page_size: String(pageSize),
      })
      const body = await this.request(
        `/api/redemption/?${query}`,
        { headers: this.userHeaders(rootUserId, rootAccessToken) },
      )
      const items = body?.data?.items
      if (!body?.success || !Array.isArray(items)) {
        throw new NewApiError(body?.message || '无法读取兑换记录', 502, body)
      }
      total = Number(body.data.total)
      if (!Number.isFinite(total) || total < 0) total = redemptions.length + items.length
      redemptions.push(...items)
      if (items.length === 0) break
    }

    return redemptions
      .filter((item) => {
        const usedUserId = Number(item?.used_user_id)
        const redeemedTime = Number(item?.redeemed_time)
        const quota = Number(item?.quota)
        return Number.isSafeInteger(usedUserId) && usedUserId > 0 &&
          Number.isSafeInteger(redeemedTime) && redeemedTime > 0 &&
          Number.isSafeInteger(quota) && quota > 0
      })
      .map((item) => ({
        id: Number(item.id),
        usedUserId: Number(item.used_user_id),
        redeemedTime: Number(item.redeemed_time),
        quota: Number(item.quota),
      }))
  }

  async listRedeemedCodesForUser(userId, rootUserId, rootAccessToken) {
    const redemptions = await this.listRedeemedCodes(rootUserId, rootAccessToken)
    return redemptions.filter((item) => item.usedUserId === Number(userId))
  }

  async getFlow(start, end, rootUserId, rootAccessToken) {
    const query = new URLSearchParams({
      start_timestamp: String(start),
      end_timestamp: String(end),
    })
      const body = await this.request(
      `/api/data/flow?${query}`,
      { headers: this.userHeaders(rootUserId, rootAccessToken) },
    )
    if (!body?.success || !Array.isArray(body.data)) {
      throw new NewApiError(body?.message || '无法读取用量数据', 502)
    }
    return body.data
  }

  async getUser(userId, rootUserId, rootAccessToken) {
    try {
      const body = await this.request(`/api/user/${userId}`, {
        headers: this.userHeaders(rootUserId, rootAccessToken),
      })
      if (body?.success && Number(body?.data?.id) === Number(userId)) return body.data
    } catch (error) {
      if (error.status === 401) throw error
    }
    const users = await this.getUsers(rootUserId, rootAccessToken)
    const user = users.find((item) => Number(item.id) === Number(userId))
    if (!user) throw new NewApiError('用户不存在', 404)
    return user
  }

  async decreaseUserQuota(userId, quota, rootUserId, rootAccessToken) {
    const headers = {
      ...this.userHeaders(rootUserId, rootAccessToken),
      'Content-Type': 'application/json',
    }
    const body = await this.request('/api/user/manage', {
      method: 'POST',
      headers,
      body: {
        id: userId,
        action: 'add_quota',
        mode: 'subtract',
        value: quota,
      },
    })
    if (!body?.success) {
      throw new NewApiError(body?.message || '扣减额度失败', 502, body)
    }
    return body.data
  }

  async increaseUserQuota(userId, quota, rootUserId, rootAccessToken) {
    const headers = {
      ...this.userHeaders(rootUserId, rootAccessToken),
      'Content-Type': 'application/json',
    }
    const body = await this.request('/api/user/manage', {
      method: 'POST',
      headers,
      body: {
        id: userId,
        action: 'add_quota',
        mode: 'add',
        value: quota,
      },
    })
    if (!body?.success) {
      throw new NewApiError(body?.message || '发放额度失败', 502, body)
    }
    return body.data
  }

  async listSubscriptionPlans(rootUserId, rootAccessToken) {
    const body = await this.request('/api/subscription/admin/plans', {
      headers: this.userHeaders(rootUserId, rootAccessToken),
    })
    if (!body?.success || !Array.isArray(body?.data)) {
      throw new NewApiError(body?.message || '无法读取订阅套餐', 502, body)
    }
    return body.data.map((item) => item?.plan || item).filter(Boolean)
  }

  async createSubscriptionPlan(plan, rootUserId, rootAccessToken) {
    const body = await this.request('/api/subscription/admin/plans', {
      method: 'POST',
      headers: {
        ...this.userHeaders(rootUserId, rootAccessToken),
        'Content-Type': 'application/json',
      },
      body: { plan },
    })
    if (!body?.success || !Number.isInteger(Number(body?.data?.id))) {
      throw new NewApiError(body?.message || '无法创建抽奖订阅套餐', 502, body)
    }
    return body.data
  }

  async updateSubscriptionPlan(planId, plan, rootUserId, rootAccessToken) {
    const body = await this.request(`/api/subscription/admin/plans/${planId}`, {
      method: 'PUT',
      headers: {
        ...this.userHeaders(rootUserId, rootAccessToken),
        'Content-Type': 'application/json',
      },
      body: { plan },
    })
    if (!body?.success) {
      throw new NewApiError(body?.message || '无法校正抽奖订阅套餐', 502, body)
    }
    return body.data
  }

  async listUserSubscriptions(userId, rootUserId, rootAccessToken) {
    const body = await this.request(
      `/api/subscription/admin/users/${userId}/subscriptions`,
      { headers: this.userHeaders(rootUserId, rootAccessToken) },
    )
    if (!body?.success || !Array.isArray(body?.data)) {
      throw new NewApiError(body?.message || '无法读取用户订阅', 502, body)
    }
    return body.data
  }

  async createUserSubscription(userId, planId, rootUserId, rootAccessToken) {
    const body = await this.request(
      `/api/subscription/admin/users/${userId}/subscriptions`,
      {
        method: 'POST',
        headers: {
          ...this.userHeaders(rootUserId, rootAccessToken),
          'Content-Type': 'application/json',
        },
        body: { plan_id: planId },
      },
    )
    if (!body?.success) {
      throw new NewApiError(body?.message || '无法发放抽奖订阅', 502, body)
    }
    return body.data
  }

}
