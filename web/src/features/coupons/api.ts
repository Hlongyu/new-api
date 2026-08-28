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
import { api } from '@/lib/api'

import type {
  Coupon,
  CouponApiResponse,
  CouponPageData,
  IssueCouponsPayload,
  IssueCouponsResult,
} from './types'

const businessErrorConfig = {
  skipBusinessError: true,
} as Record<string, unknown>

export async function getSelfCoupons(): Promise<CouponApiResponse<Coupon[]>> {
  const response = await api.get('/api/coupon/self')
  return response.data
}

export async function activateCoupon(
  couponId: number
): Promise<CouponApiResponse<Coupon>> {
  const response = await api.post(
    `/api/coupon/${couponId}/activate`,
    {},
    businessErrorConfig
  )
  return response.data
}

export async function getAdminUserCoupons(
  userId: number
): Promise<CouponApiResponse<Coupon[]>> {
  const response = await api.get(`/api/coupon/admin/users/${userId}`)
  return response.data
}

export async function issueCoupons(
  payload: IssueCouponsPayload
): Promise<CouponApiResponse<IssueCouponsResult>> {
  const response = await api.post(
    '/api/coupon/admin/grants',
    payload,
    businessErrorConfig
  )
  return response.data
}

export async function getAdminCoupons(params: {
  p: number
  page_size: number
  keyword?: string
}): Promise<CouponApiResponse<CouponPageData>> {
  const response = await api.get('/api/coupon/admin/', { params })
  return response.data
}

export async function revokeCoupon(
  couponId: number
): Promise<CouponApiResponse<Coupon>> {
  const response = await api.post(
    `/api/coupon/admin/${couponId}/revoke`,
    {},
    businessErrorConfig
  )
  return response.data
}
