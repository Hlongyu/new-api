package model

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/cachex"
	rankengine "github.com/QuantumNous/new-api/pkg/rank"
	"github.com/samber/hot"
	"gorm.io/gorm"
)

const (
	CouponStatusUnused  = 1
	CouponStatusActive  = 2
	CouponStatusRevoked = 3

	CouponEffectiveStatusAvailable = "available"
	CouponEffectiveStatusActive    = "active"
	CouponEffectiveStatusExpired   = "expired"
	CouponEffectiveStatusEnded     = "ended"
	CouponEffectiveStatusRevoked   = "revoked"

	couponCacheNamespace = "new-api:active_coupon:v2"

	MaxCouponUsers                 = 1000
	MaxCouponRPM                   = 60_000
	MaxCouponValidForSeconds       = int64(10 * 365 * 24 * 60 * 60)
	MaxCouponActiveDurationSeconds = int64(365 * 24 * 60 * 60)

	CouponRecipientScopeSelected = "selected"
	CouponRecipientScopeAll      = "all"
	CouponRecipientScopeRank     = "rank"
)

var (
	ErrCouponNotFound            = errors.New("coupon not found")
	ErrCouponExpired             = errors.New("coupon activation period has expired")
	ErrCouponAlreadyActivated    = errors.New("coupon has already been activated")
	ErrCouponActiveConflict      = errors.New("another coupon is already active for this group")
	ErrCouponRevoked             = errors.New("coupon has been revoked")
	ErrCouponIdempotencyConflict = errors.New("coupon issuance idempotency key is incomplete")
)

type Coupon struct {
	Id                    int    `json:"id"`
	UserId                int    `json:"user_id" gorm:"index;uniqueIndex:idx_coupon_issue_idempotency"`
	Name                  string `json:"name" gorm:"type:varchar(64)"`
	ApplicableGroup       string `json:"applicable_group" gorm:"type:varchar(64);index:idx_coupon_active_lookup"`
	RatioPPM              int    `json:"ratio_ppm"`
	IssuedAt              int64  `json:"issued_at" gorm:"bigint;index"`
	ActivateBefore        int64  `json:"activate_before" gorm:"bigint"`
	ActiveDurationSeconds int64  `json:"active_duration_seconds" gorm:"bigint"`
	ActivatedAt           int64  `json:"activated_at" gorm:"bigint"`
	ActiveUntil           int64  `json:"active_until" gorm:"bigint;index:idx_coupon_active_lookup"`
	Status                int    `json:"status" gorm:"index:idx_coupon_active_lookup"`
	IssuerId              int    `json:"issuer_id"`
	RevokerId             int    `json:"revoker_id"`
	RevokedAt             int64  `json:"revoked_at" gorm:"bigint"`
	IssueBatchId          string `json:"issue_batch_id" gorm:"type:char(32);index"`
	IdempotencyKey        string `json:"-" gorm:"type:varchar(64);uniqueIndex:idx_coupon_issue_idempotency"`
	RecipientScope        string `json:"recipient_scope" gorm:"type:varchar(16)"`
	RankMin               string `json:"rank_min,omitempty" gorm:"type:varchar(32)"`
	RankMax               string `json:"rank_max,omitempty" gorm:"type:varchar(32)"`
	RPMLimit              int    `json:"rpm_limit"`
	Username              string `json:"username,omitempty" gorm:"->;-:migration"`
	EffectiveStatus       string `json:"effective_status" gorm:"-"`
}

type IssueCouponParams struct {
	UserIds               []int
	AllUsers              bool
	RecipientScope        string
	RankMin               string
	RankMax               string
	Name                  string
	ApplicableGroup       string
	RatioPPM              int
	RPMLimit              int
	ActivateBefore        int64
	ValidForSeconds       int64
	ActiveDurationSeconds int64
	IssuerId              int
	IssueBatchId          string
	IdempotencyKey        string
	Now                   int64
}

type activeCouponCacheEntry struct {
	Found  bool   `json:"found"`
	Coupon Coupon `json:"coupon"`
}

var (
	activeCouponCacheOnce sync.Once
	activeCouponCache     *cachex.HybridCache[activeCouponCacheEntry]
)

func (coupon *Coupon) PopulateEffectiveStatus(now int64) {
	switch {
	case coupon.Status == CouponStatusRevoked:
		coupon.EffectiveStatus = CouponEffectiveStatusRevoked
	case coupon.Status == CouponStatusActive && coupon.ActiveUntil > now:
		coupon.EffectiveStatus = CouponEffectiveStatusActive
	case coupon.Status == CouponStatusActive:
		coupon.EffectiveStatus = CouponEffectiveStatusEnded
	case coupon.ActivateBefore <= now:
		coupon.EffectiveStatus = CouponEffectiveStatusExpired
	default:
		coupon.EffectiveStatus = CouponEffectiveStatusAvailable
	}
}

func (coupon Coupon) Ratio() float64 {
	return float64(coupon.RatioPPM) / 1_000_000
}

func getActiveCouponCache() *cachex.HybridCache[activeCouponCacheEntry] {
	activeCouponCacheOnce.Do(func() {
		activeCouponCache = cachex.NewHybridCache[activeCouponCacheEntry](cachex.HybridCacheConfig[activeCouponCacheEntry]{
			Namespace: cachex.Namespace(couponCacheNamespace),
			Redis:     common.RDB,
			RedisEnabled: func() bool {
				return common.RedisEnabled && common.RDB != nil
			},
			RedisCodec: cachex.JSONCodec[activeCouponCacheEntry]{},
			Memory: func() *hot.HotCache[string, activeCouponCacheEntry] {
				return hot.NewHotCache[string, activeCouponCacheEntry](hot.LRU, 10000).
					WithTTL(30 * time.Second).
					WithJanitor().
					Build()
			},
		})
	})
	return activeCouponCache
}

func activeCouponCacheKey(userId int, group string) string {
	if userId <= 0 || group == "" {
		return ""
	}
	return strconv.Itoa(userId) + ":" + group
}

func invalidateActiveCouponCache(userId int, group string) {
	key := activeCouponCacheKey(userId, group)
	if key == "" {
		return
	}
	if _, err := getActiveCouponCache().DeleteMany([]string{key}); err != nil {
		common.SysError("failed to invalidate active coupon cache: " + err.Error())
	}
}

func setActiveCouponCache(coupon Coupon, now int64) {
	key := activeCouponCacheKey(coupon.UserId, coupon.ApplicableGroup)
	if key == "" || coupon.ActiveUntil <= now {
		return
	}
	ttlSeconds := coupon.ActiveUntil - now
	if ttlSeconds > 30 {
		ttlSeconds = 30
	}
	ttl := time.Duration(ttlSeconds) * time.Second
	if err := getActiveCouponCache().SetWithTTL(key, activeCouponCacheEntry{Found: true, Coupon: coupon}, ttl); err != nil {
		common.SysError("failed to cache active coupon: " + err.Error())
	}
}

func IssueCoupons(params IssueCouponParams) ([]Coupon, error) {
	params.Name = strings.TrimSpace(params.Name)
	params.ApplicableGroup = strings.TrimSpace(params.ApplicableGroup)
	params.IdempotencyKey = strings.TrimSpace(params.IdempotencyKey)
	params.RecipientScope = strings.TrimSpace(params.RecipientScope)
	params.RankMin = strings.TrimSpace(params.RankMin)
	params.RankMax = strings.TrimSpace(params.RankMax)
	if params.Now <= 0 {
		params.Now = GetDBTimestamp()
	}
	if params.ActivateBefore == 0 && params.ValidForSeconds > 0 && params.ValidForSeconds <= MaxCouponValidForSeconds {
		params.ActivateBefore = params.Now + params.ValidForSeconds
	}
	if params.RecipientScope == "" {
		if params.AllUsers {
			params.RecipientScope = CouponRecipientScopeAll
		} else {
			params.RecipientScope = CouponRecipientScopeSelected
		}
	}
	minRankPosition, minRankValid := rankengine.ParseTierKey(params.RankMin)
	maxRankPosition, maxRankValid := rankengine.ParseTierKey(params.RankMax)
	switch {
	case params.RecipientScope != CouponRecipientScopeSelected && params.RecipientScope != CouponRecipientScopeAll && params.RecipientScope != CouponRecipientScopeRank:
		return nil, errors.New("coupon recipient scope is invalid")
	case params.RecipientScope == CouponRecipientScopeAll && len(params.UserIds) > 0:
		return nil, errors.New("coupon recipient scope is ambiguous")
	case params.RecipientScope == CouponRecipientScopeSelected && (len(params.UserIds) == 0 || len(params.UserIds) > MaxCouponUsers):
		return nil, errors.New("coupon recipient count is out of range")
	case params.RecipientScope == CouponRecipientScopeRank && len(params.UserIds) == 0:
		return nil, errors.New("no coupon recipients found")
	case params.RecipientScope == CouponRecipientScopeRank && (!minRankValid || !maxRankValid || minRankPosition > maxRankPosition):
		return nil, errors.New("coupon rank range is invalid")
	case utf8.RuneCountInString(params.Name) == 0 || utf8.RuneCountInString(params.Name) > 64:
		return nil, errors.New("coupon name is out of range")
	case params.ApplicableGroup == "":
		return nil, errors.New("coupon applicable group is required")
	case params.RatioPPM <= 0 || params.RatioPPM > 1_000_000:
		return nil, errors.New("coupon ratio is out of range")
	case params.RPMLimit < 0 || params.RPMLimit > MaxCouponRPM:
		return nil, errors.New("coupon RPM limit is out of range")
	case params.ActivateBefore <= params.Now || params.ActivateBefore > params.Now+MaxCouponValidForSeconds:
		return nil, errors.New("coupon activation deadline is out of range")
	case params.ActiveDurationSeconds <= 0 || params.ActiveDurationSeconds > MaxCouponActiveDurationSeconds:
		return nil, errors.New("coupon active duration is out of range")
	case len(params.IdempotencyKey) > 64:
		return nil, errors.New("coupon idempotency key is too long")
	}
	userIds := make([]int, 0, len(params.UserIds))
	params.AllUsers = params.RecipientScope == CouponRecipientScopeAll
	if !params.AllUsers {
		uniqueIds := make(map[int]struct{}, len(params.UserIds))
		for _, userId := range params.UserIds {
			if userId <= 0 {
				return nil, errors.New("invalid user id")
			}
			uniqueIds[userId] = struct{}{}
		}
		for userId := range uniqueIds {
			userIds = append(userIds, userId)
		}
		sort.Ints(userIds)
	}

	var coupons []Coupon
	err := DB.Transaction(func(tx *gorm.DB) error {
		if params.AllUsers {
			if err := tx.Model(&User{}).Order("id ASC").Pluck("id", &userIds).Error; err != nil {
				return err
			}
			if len(userIds) == 0 {
				return errors.New("no coupon recipients found")
			}
		}

		if params.IdempotencyKey != "" {
			var existing []Coupon
			for start := 0; start < len(userIds); start += 500 {
				end := start + 500
				if end > len(userIds) {
					end = len(userIds)
				}
				var batch []Coupon
				if err := tx.Where("idempotency_key = ? AND user_id IN ?", params.IdempotencyKey, userIds[start:end]).Find(&batch).Error; err != nil {
					return err
				}
				existing = append(existing, batch...)
			}
			if len(existing) > 0 {
				if len(existing) != len(userIds) {
					return ErrCouponIdempotencyConflict
				}
				coupons = existing
				return nil
			}
		}

		if !params.AllUsers {
			var userCount int64
			for start := 0; start < len(userIds); start += 500 {
				end := start + 500
				if end > len(userIds) {
					end = len(userIds)
				}
				var batchCount int64
				if err := tx.Model(&User{}).Where("id IN ?", userIds[start:end]).Count(&batchCount).Error; err != nil {
					return err
				}
				userCount += batchCount
			}
			if userCount != int64(len(userIds)) {
				return errors.New("one or more users do not exist")
			}
		}

		coupons = make([]Coupon, 0, len(userIds))
		for _, userId := range userIds {
			coupons = append(coupons, Coupon{
				UserId:                userId,
				Name:                  params.Name,
				ApplicableGroup:       params.ApplicableGroup,
				RatioPPM:              params.RatioPPM,
				IssuedAt:              params.Now,
				ActivateBefore:        params.ActivateBefore,
				ActiveDurationSeconds: params.ActiveDurationSeconds,
				Status:                CouponStatusUnused,
				IssuerId:              params.IssuerId,
				IssueBatchId:          params.IssueBatchId,
				IdempotencyKey:        params.IdempotencyKey,
				RecipientScope:        params.RecipientScope,
				RankMin:               params.RankMin,
				RankMax:               params.RankMax,
				RPMLimit:              params.RPMLimit,
			})
		}
		return tx.CreateInBatches(&coupons, 100).Error
	})
	if err != nil {
		if params.IdempotencyKey != "" {
			var existing []Coupon
			var queryErr error
			for start := 0; start < len(userIds); start += 500 {
				end := start + 500
				if end > len(userIds) {
					end = len(userIds)
				}
				var batch []Coupon
				queryErr = DB.Where("idempotency_key = ? AND user_id IN ?", params.IdempotencyKey, userIds[start:end]).Find(&batch).Error
				if queryErr != nil {
					break
				}
				existing = append(existing, batch...)
			}
			if queryErr == nil && len(existing) == len(userIds) {
				coupons = existing
				err = nil
			}
		}
	}
	if err != nil {
		return nil, err
	}
	for i := range coupons {
		coupons[i].PopulateEffectiveStatus(params.Now)
	}
	return coupons, nil
}

func ActivateCoupon(couponId, userId int, now int64) (*Coupon, error) {
	if couponId <= 0 || userId <= 0 {
		return nil, ErrCouponNotFound
	}
	if now <= 0 {
		now = GetDBTimestamp()
	}
	var coupon Coupon
	err := DB.Transaction(func(tx *gorm.DB) error {
		var user User
		if err := lockForUpdate(tx).Select("id").Where("id = ?", userId).First(&user).Error; err != nil {
			return ErrCouponNotFound
		}
		if err := lockForUpdate(tx).Where("id = ? AND user_id = ?", couponId, userId).First(&coupon).Error; err != nil {
			return ErrCouponNotFound
		}
		if coupon.Status == CouponStatusRevoked {
			return ErrCouponRevoked
		}
		if coupon.Status == CouponStatusActive || coupon.ActivatedAt > 0 {
			return nil
		}
		if coupon.ActivateBefore <= now {
			return ErrCouponExpired
		}

		activeUntil := now + coupon.ActiveDurationSeconds
		result := tx.Model(&Coupon{}).
			Where("id = ? AND user_id = ? AND status = ? AND activated_at = 0", couponId, userId, CouponStatusUnused).
			Updates(map[string]interface{}{
				"activated_at": now,
				"active_until": activeUntil,
				"status":       CouponStatusActive,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrCouponAlreadyActivated
		}
		coupon.ActivatedAt = now
		coupon.ActiveUntil = activeUntil
		coupon.Status = CouponStatusActive
		return nil
	})
	if err != nil {
		return nil, err
	}
	coupon.PopulateEffectiveStatus(now)
	invalidateActiveCouponCache(coupon.UserId, coupon.ApplicableGroup)
	return &coupon, nil
}

func RevokeCoupon(couponId, revokerId int, now int64) (*Coupon, error) {
	if couponId <= 0 {
		return nil, ErrCouponNotFound
	}
	if now <= 0 {
		now = GetDBTimestamp()
	}
	var coupon Coupon
	wasRevoked := false
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockForUpdate(tx).Where("id = ?", couponId).First(&coupon).Error; err != nil {
			return ErrCouponNotFound
		}
		if coupon.Status == CouponStatusRevoked {
			wasRevoked = true
			return nil
		}
		return tx.Model(&Coupon{}).Where("id = ? AND status <> ?", couponId, CouponStatusRevoked).Updates(map[string]interface{}{
			"status":     CouponStatusRevoked,
			"revoked_at": now,
			"revoker_id": revokerId,
		}).Error
	})
	if err != nil {
		return nil, err
	}
	if !wasRevoked {
		coupon.Status = CouponStatusRevoked
		coupon.RevokedAt = now
		coupon.RevokerId = revokerId
	}
	coupon.PopulateEffectiveStatus(now)
	invalidateActiveCouponCache(coupon.UserId, coupon.ApplicableGroup)
	return &coupon, nil
}

func GetActiveCoupon(userId int, group string, now int64) (*Coupon, error) {
	key := activeCouponCacheKey(userId, group)
	if key == "" {
		return nil, nil
	}
	if now <= 0 {
		now = GetDBTimestamp()
	}
	if cached, found, err := getActiveCouponCache().Get(key); err == nil && found {
		if !cached.Found {
			return nil, nil
		}
		if cached.Coupon.ActiveUntil > now {
			coupon := cached.Coupon
			coupon.PopulateEffectiveStatus(now)
			return &coupon, nil
		}
	}

	var coupon Coupon
	err := DB.Where("user_id = ? AND applicable_group = ? AND status = ? AND active_until > ?", userId, group, CouponStatusActive, now).
		Order("ratio_ppm ASC, activated_at ASC, id ASC").
		First(&coupon).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		_ = getActiveCouponCache().SetWithTTL(key, activeCouponCacheEntry{Found: false}, 15*time.Second)
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query active coupon: %w", err)
	}
	coupon.PopulateEffectiveStatus(now)
	setActiveCouponCache(coupon, now)
	return &coupon, nil
}

func GetUserCoupons(userId int, now int64) ([]Coupon, error) {
	if userId <= 0 {
		return nil, errors.New("invalid user id")
	}
	if now <= 0 {
		now = GetDBTimestamp()
	}
	var coupons []Coupon
	if err := DB.Where("user_id = ?", userId).Order("issued_at DESC, id DESC").Find(&coupons).Error; err != nil {
		return nil, err
	}
	for i := range coupons {
		coupons[i].PopulateEffectiveStatus(now)
	}
	return coupons, nil
}

func GetAdminCoupons(keyword string, effectiveStatus string, startIdx, num int, now int64) ([]Coupon, int64, error) {
	if now <= 0 {
		now = GetDBTimestamp()
	}
	keyword = strings.TrimSpace(keyword)
	effectiveStatus = strings.TrimSpace(effectiveStatus)
	query := DB.Table("coupons").Joins("LEFT JOIN users ON users.id = coupons.user_id")
	switch effectiveStatus {
	case "", "all":
	case CouponEffectiveStatusAvailable:
		query = query.Where("coupons.status = ? AND coupons.activate_before > ?", CouponStatusUnused, now)
	case CouponEffectiveStatusActive:
		query = query.Where("coupons.status = ? AND coupons.active_until > ?", CouponStatusActive, now)
	case CouponEffectiveStatusExpired:
		query = query.Where("coupons.status = ? AND coupons.activate_before <= ?", CouponStatusUnused, now)
	case CouponEffectiveStatusEnded:
		query = query.Where("coupons.status = ? AND coupons.active_until <= ?", CouponStatusActive, now)
	case CouponEffectiveStatusRevoked:
		query = query.Where("coupons.status = ?", CouponStatusRevoked)
	default:
		return nil, 0, errors.New("coupon status filter is invalid")
	}
	if keyword != "" {
		pattern := "%" + keyword + "%"
		if id, err := strconv.Atoi(keyword); err == nil {
			query = query.Where(
				"coupons.id = ? OR coupons.user_id = ? OR users.username LIKE ? OR coupons.name LIKE ? OR coupons.issue_batch_id LIKE ?",
				id, id, pattern, pattern, pattern,
			)
		} else {
			query = query.Where(
				"users.username LIKE ? OR coupons.name LIKE ? OR coupons.issue_batch_id LIKE ?",
				pattern, pattern, pattern,
			)
		}
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var coupons []Coupon
	if err := query.Select("coupons.*, users.username AS username").
		Order("coupons.issued_at DESC, coupons.id DESC").
		Limit(num).
		Offset(startIdx).
		Scan(&coupons).Error; err != nil {
		return nil, 0, err
	}
	for i := range coupons {
		coupons[i].PopulateEffectiveStatus(now)
	}
	return coupons, total, nil
}
