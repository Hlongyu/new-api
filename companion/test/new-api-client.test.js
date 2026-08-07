import assert from 'node:assert/strict'
import test from 'node:test'
import { NewApiClient } from '../src/new-api-client.js'

test('分页读取全部 New API 用户', async () => {
  const client = new NewApiClient({ baseUrl: 'https://new-api.example.com' })
  const requestedPages = []
  client.request = async (path) => {
    const page = Number(new URL(path, 'https://new-api.example.com').searchParams.get('p'))
    requestedPages.push(page)
    const items = page === 1
      ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }))
      : [{ id: 101 }]
    return { success: true, data: { total: 101, items } }
  }

  const users = await client.getUsers(1, 'root-token')

  assert.equal(users.length, 101)
  assert.deepEqual(requestedPages, [1, 2])
})

test('分页读取全部已兑换记录且不向调用方暴露兑换码', async () => {
  const client = new NewApiClient({ baseUrl: 'https://new-api.example.com' })
  const requestedPages = []
  client.request = async (path) => {
    const page = Number(new URL(path, 'https://new-api.example.com').searchParams.get('p'))
    requestedPages.push(page)
    const items = page === 1
      ? Array.from({ length: 100 }, (_, index) => ({
          id: index + 1,
          key: `secret-${index + 1}`,
          used_user_id: index === 0 ? 1 : 42,
          redeemed_time: 100,
          quota: 500_000,
        }))
      : [{ id: 101, key: 'secret-101', used_user_id: 1, redeemed_time: 101, quota: 1_000_000 }]
    return { success: true, data: { total: 101, items } }
  }

  const records = await client.listRedeemedCodes(1, 'root-token')

  assert.deepEqual(requestedPages, [1, 2])
  assert.equal(records.length, 101)
  assert.deepEqual(records[0], {
    id: 1, usedUserId: 1, redeemedTime: 100, quota: 500_000,
  })
  assert.deepEqual(records.at(-1), {
    id: 101, usedUserId: 1, redeemedTime: 101, quota: 1_000_000,
  })
  assert.equal(records.some((item) => item.usedUserId === 42), true)
  assert.equal('key' in records[0], false)
})

test('使用浏览器 Bearer Token 验证用户并按管理接口扣减额度', async () => {
  const client = new NewApiClient({ baseUrl: 'https://new-api.example.com' })
  const requests = []
  client.request = async (path, options) => {
    requests.push({ path, options })
    if (path === '/api/user/self') {
      return { success: true, data: { id: 42, username: 'alice' } }
    }
    return { success: true, data: null }
  }

  const user = await client.getSessionUser('Bearer access-token')
  await client.decreaseUserQuota(42, 15_000_000, 1, 'root-token')

  assert.equal(user.id, 42)
  assert.deepEqual(requests[0], {
    path: '/api/user/self',
    options: {
      headers: {
        Authorization: 'Bearer access-token',
      },
    },
  })
  assert.deepEqual(requests[1], {
    path: '/api/user/manage',
    options: {
      method: 'POST',
      headers: {
        Authorization: 'root-token',
        'New-Api-User': '1',
        'Content-Type': 'application/json',
      },
      body: {
        id: 42,
        action: 'add_quota',
        mode: 'subtract',
        value: 15_000_000,
      },
    },
  })
})

test('按 new-api 管理接口创建七天套餐并绑定用户订阅', async () => {
  const client = new NewApiClient({ baseUrl: 'https://new-api.example.com' })
  const requests = []
  client.request = async (path, options) => {
    requests.push({ path, options })
    if (path === '/api/subscription/admin/plans' && !options?.method) {
      return { success: true, data: [{ plan: { id: 8, title: 'existing' } }] }
    }
    if (path === '/api/subscription/admin/plans') {
      return { success: true, data: { id: 9 } }
    }
    if (path === '/api/subscription/admin/plans/9' && options?.method === 'PUT') {
      return { success: true, data: { id: 9 } }
    }
    if (options?.method === 'POST') return { success: true, data: { id: 31 } }
    return { success: true, data: [{ id: 30, plan_id: 8 }] }
  }

  const plan = {
    title: 'LOTTERY_REWARD_7D_USD_5',
    duration_unit: 'day',
    duration_value: 7,
    total_amount: 2_500_000,
  }
  assert.deepEqual(await client.listSubscriptionPlans(1, 'root-token'), [
    { id: 8, title: 'existing' },
  ])
  assert.deepEqual(await client.createSubscriptionPlan(plan, 1, 'root-token'), { id: 9 })
  assert.deepEqual(await client.updateSubscriptionPlan(9, plan, 1, 'root-token'), { id: 9 })
  assert.deepEqual(await client.listUserSubscriptions(42, 1, 'root-token'), [
    { id: 30, plan_id: 8 },
  ])
  assert.deepEqual(await client.createUserSubscription(42, 9, 1, 'root-token'), { id: 31 })

  assert.deepEqual(requests.map((item) => [item.path, item.options?.method || 'GET']), [
    ['/api/subscription/admin/plans', 'GET'],
    ['/api/subscription/admin/plans', 'POST'],
    ['/api/subscription/admin/plans/9', 'PUT'],
    ['/api/subscription/admin/users/42/subscriptions', 'GET'],
    ['/api/subscription/admin/users/42/subscriptions', 'POST'],
  ])
  assert.deepEqual(requests[1].options.body, { plan })
  assert.deepEqual(requests[2].options.body, { plan })
  assert.deepEqual(requests[4].options.body, { plan_id: 9 })
})
