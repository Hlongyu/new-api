package service

import (
	"errors"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	rankengine "github.com/QuantumNous/new-api/pkg/rank"
)

const (
	RenameCardPriceCny = 1
)

type LeaderboardVisibility struct {
	ParticipateDay   bool `json:"participateDay"`
	ParticipateWeek  bool `json:"participateWeek"`
	ParticipateMonth bool `json:"participateMonth"`
	ParticipateAll   bool `json:"participateAll"`
	ParticipateRank  bool `json:"participateRank"`
	ShowRankBadge    bool `json:"showRankBadge"`
}

type LeaderboardMeEntry struct {
	DisplayName   string                `json:"displayName"`
	CurrentName   string                `json:"currentName"`
	AnonymousName string                `json:"anonymousName"`
	IsNamePublic  bool                  `json:"isNamePublic"`
	Visibility    LeaderboardVisibility `json:"visibility"`
}

type RenameInfo struct {
	PeriodKey     string `json:"periodKey"`
	FreeAvailable bool   `json:"freeAvailable"`
	FreeUsed      bool   `json:"freeUsed"`
	CardBalance   int    `json:"cardBalance"`
	CardPriceCny  int    `json:"cardPriceCny"`
}

type LeaderboardMe struct {
	Id           int                 `json:"id"`
	Username     string              `json:"username"`
	IdentityName string              `json:"identityName"`
	Quota        int                 `json:"quota"`
	BalanceUsd   float64             `json:"balanceUsd"`
	IsRoot       bool                `json:"isRoot"`
	Entry        LeaderboardMeEntry  `json:"entry"`
	Rename       RenameInfo          `json:"rename"`
	RankProgress rankengine.Progress `json:"rankProgress"`
}

type LeaderboardProfilePatch struct {
	DisplayName  *string
	IsNamePublic *bool
	Visibility   struct {
		ParticipateDay   *bool
		ParticipateWeek  *bool
		ParticipateMonth *bool
		ParticipateAll   *bool
		ParticipateRank  *bool
		ShowRankBadge    *bool
	}
}

type SponsorOrderPayload struct {
	Id           string `json:"id"`
	AmountCny    int    `json:"amountCny"`
	QuotaAmount  int    `json:"quotaAmount"`
	Message      string `json:"message"`
	Status       string `json:"status"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
	CompletedAt  int64  `json:"completedAt"`
	ErrorMessage string `json:"errorMessage,omitempty"`
	UserId       int    `json:"userId,omitempty"`
	DisplayName  string `json:"displayName,omitempty"`
}

type RenameCardOrderPayload struct {
	Id           string `json:"id"`
	Quantity     int    `json:"quantity"`
	AmountCny    int    `json:"amountCny"`
	QuotaAmount  int    `json:"quotaAmount"`
	Status       string `json:"status"`
	CreatedAt    int64  `json:"createdAt"`
	UpdatedAt    int64  `json:"updatedAt"`
	CompletedAt  int64  `json:"completedAt"`
	ErrorMessage string `json:"errorMessage,omitempty"`
	UserId       int    `json:"userId,omitempty"`
	DisplayName  string `json:"displayName,omitempty"`
}

type RenameEventPayload struct {
	Id        string `json:"id"`
	UserId    int    `json:"userId"`
	OldName   string `json:"oldName"`
	NewName   string `json:"newName"`
	CostType  string `json:"costType"`
	CreatedAt int64  `json:"createdAt"`
}

type SponsorAdminView struct {
	Summary struct {
		TotalAmountCny int `json:"totalAmountCny"`
		CompletedCount int `json:"completedCount"`
		OrderCount     int `json:"orderCount"`
	} `json:"summary"`
	Orders []SponsorOrderPayload `json:"orders"`
}

type RenameCardAdminView struct {
	Summary struct {
		OrderCount       int   `json:"orderCount"`
		CompletedCount   int   `json:"completedCount"`
		CardsSold        int   `json:"cardsSold"`
		TotalAmountCny   int   `json:"totalAmountCny"`
		OutstandingCards int64 `json:"outstandingCards"`
		RenameCount      int   `json:"renameCount"`
		CardRenameCount  int   `json:"cardRenameCount"`
		FreeRenameCount  int   `json:"freeRenameCount"`
	} `json:"summary"`
	Orders []RenameCardOrderPayload `json:"orders"`
	Events []RenameEventPayload     `json:"events"`
}

type LeaderboardAppStatus struct {
	Configured    bool   `json:"configured"`
	Running       bool   `json:"running"`
	LastSyncAt    int64  `json:"lastSyncAt"`
	LastSyncError string `json:"lastSyncError"`
	TimeZone      string `json:"timeZone"`
	MemberCount   int    `json:"memberCount"`
	User          struct {
		LeaderboardMe
		Postpaid     *QuotaLoanContext     `json:"postpaid"`
		Sponsorships []SponsorOrderPayload `json:"sponsorships"`
	} `json:"user"`
	SponsorRules struct {
		MinAmount             int     `json:"minAmount"`
		MaxAmount             int     `json:"maxAmount"`
		QuotaPerUnit          float64 `json:"quotaPerUnit"`
		BadgeActiveDays       int     `json:"badgeActiveDays"`
		SupportStartTimestamp int64   `json:"supportStartTimestamp"`
	} `json:"sponsorRules"`
}

func GetLeaderboardMe(userId int, isRoot bool) (*LeaderboardMe, error) {
	entry, err := EnsureLeaderboardProfile(userId)
	if err != nil {
		return nil, err
	}
	user, err := model.GetUserById(userId, false)
	if err != nil {
		return nil, err
	}
	quota, err := model.GetUserQuota(userId, false)
	if err != nil {
		return nil, err
	}
	progress, err := GetRankProgress(userId)
	if err != nil {
		return nil, err
	}
	_, _, periodKey, err := leaderboardPeriodRange("week", time.Now())
	if err != nil {
		return nil, err
	}
	freeUsed, err := model.HasWeeklyFreeRename(userId, periodKey)
	if err != nil {
		return nil, err
	}
	cardBalance, err := model.GetRenameCardBalance(userId)
	if err != nil {
		return nil, err
	}
	identityName := strings.TrimSpace(user.DisplayName)
	if identityName == "" {
		identityName = user.Username
	}
	currentName := entry.AnonymousName
	if entry.IsNamePublic {
		currentName = entry.DisplayName
	}
	return &LeaderboardMe{
		Id: userId, Username: user.Username, IdentityName: identityName,
		Quota: quota, BalanceUsd: float64(quota) / common.QuotaPerUnit, IsRoot: isRoot,
		Entry: LeaderboardMeEntry{
			DisplayName: entry.DisplayName, CurrentName: currentName,
			AnonymousName: entry.AnonymousName, IsNamePublic: entry.IsNamePublic,
			Visibility: LeaderboardVisibility{
				ParticipateDay: entry.ParticipateDay, ParticipateWeek: entry.ParticipateWeek,
				ParticipateMonth: entry.ParticipateMonth, ParticipateAll: entry.ParticipateAll,
				ParticipateRank: entry.ParticipateRank, ShowRankBadge: entry.ShowRankBadge,
			},
		},
		Rename: RenameInfo{
			PeriodKey: periodKey, FreeAvailable: !freeUsed, FreeUsed: freeUsed,
			CardBalance: cardBalance, CardPriceCny: RenameCardPriceCny,
		},
		RankProgress: progress,
	}, nil
}

func UpdateLeaderboardMe(userId int, isRoot bool, patch LeaderboardProfilePatch) (*LeaderboardMe, error) {
	_, _, periodKey, err := leaderboardPeriodRange("week", time.Now())
	if err != nil {
		return nil, err
	}
	_, err = model.UpdateLeaderboardProfile(userId, model.LeaderboardProfileUpdate{
		DisplayName: patch.DisplayName, IsNamePublic: patch.IsNamePublic,
		ParticipateDay:   patch.Visibility.ParticipateDay,
		ParticipateWeek:  patch.Visibility.ParticipateWeek,
		ParticipateMonth: patch.Visibility.ParticipateMonth,
		ParticipateAll:   patch.Visibility.ParticipateAll,
		ParticipateRank:  patch.Visibility.ParticipateRank,
		ShowRankBadge:    patch.Visibility.ShowRankBadge,
		PeriodKey:        periodKey, Now: common.GetTimestamp(),
	})
	if err != nil {
		return nil, err
	}
	return GetLeaderboardMe(userId, isRoot)
}

func BuyRenameCards(requestKey string, userId int, quantity int) (*RenameCardOrderPayload, error) {
	if quantity <= 0 || quantity > 1_000 {
		return nil, errors.New("改名卡数量无效")
	}
	entry, err := EnsureLeaderboardProfile(userId)
	if err != nil {
		return nil, err
	}
	amountCny := quantity * RenameCardPriceCny
	quotaAmount, err := common.QuotaFromFloatStrict(float64(amountCny) * common.QuotaPerUnit)
	if err != nil {
		return nil, err
	}
	order, err := model.PurchaseRenameCards(requestKey, userId, entry.Id, quantity, amountCny, quotaAmount, common.GetTimestamp())
	if err != nil {
		return nil, err
	}
	invalidateRankReplayCache()
	payload := renameCardOrderPayload(*order)
	return &payload, nil
}

func CreateSponsorship(requestKey string, userId int, amountCny int, message string) (*SponsorOrderPayload, error) {
	if amountCny < common.LeaderboardSponsorMinAmount || amountCny > common.LeaderboardSponsorMaxAmount {
		return nil, errors.New("赞助金额超出允许范围")
	}
	entry, err := EnsureLeaderboardProfile(userId)
	if err != nil {
		return nil, err
	}
	quotaAmount, err := common.QuotaFromFloatStrict(float64(amountCny) * common.QuotaPerUnit)
	if err != nil {
		return nil, err
	}
	order, err := model.CreateSponsorOrder(
		requestKey, userId, entry.Id, amountCny, quotaAmount, !entry.IsNamePublic,
		message, common.GetTimestamp(),
	)
	if err != nil {
		return nil, err
	}
	invalidateRankReplayCache()
	payload := sponsorOrderPayload(*order)
	return &payload, nil
}

func GetLeaderboardAppStatus(userId int, isRoot bool) (*LeaderboardAppStatus, error) {
	me, err := GetLeaderboardMe(userId, isRoot)
	if err != nil {
		return nil, err
	}
	loans, err := GetQuotaLoanContext(userId, isRoot)
	if err != nil {
		return nil, err
	}
	history, err := model.ListSponsorOrders(userId, 30)
	if err != nil {
		return nil, err
	}
	entries, err := model.ListLeaderboardEntries()
	if err != nil {
		return nil, err
	}
	status := &LeaderboardAppStatus{Configured: true, Running: true, TimeZone: leaderboardTimeZone, MemberCount: len(entries)}
	status.User.LeaderboardMe = *me
	status.User.Postpaid = loans
	status.User.Sponsorships = make([]SponsorOrderPayload, 0, len(history))
	for _, order := range history {
		status.User.Sponsorships = append(status.User.Sponsorships, sponsorOrderPayload(order))
		status.LastSyncAt = max(status.LastSyncAt, order.UpdatedAt)
	}
	status.SponsorRules.MinAmount = common.LeaderboardSponsorMinAmount
	status.SponsorRules.MaxAmount = common.LeaderboardSponsorMaxAmount
	status.SponsorRules.QuotaPerUnit = common.QuotaPerUnit
	status.SponsorRules.BadgeActiveDays = 3
	return status, nil
}

func GetSponsorAdminView() (*SponsorAdminView, error) {
	orders, err := model.ListSponsorOrders(0, 500)
	if err != nil {
		return nil, err
	}
	entries, err := model.ListLeaderboardEntries()
	if err != nil {
		return nil, err
	}
	entryByUser := make(map[int]model.LeaderboardEntry, len(entries))
	for _, entry := range entries {
		entryByUser[entry.UserId] = entry
	}
	view := &SponsorAdminView{Orders: make([]SponsorOrderPayload, 0, len(orders))}
	for _, order := range orders {
		payload := sponsorOrderPayload(order)
		payload.UserId = order.UserId
		payload.DisplayName = leaderboardDisplayName(entryByUser[order.UserId])
		view.Orders = append(view.Orders, payload)
		view.Summary.OrderCount++
		if order.Status == model.LeaderboardOrderCompleted {
			view.Summary.CompletedCount++
			view.Summary.TotalAmountCny += order.AmountCny
		}
	}
	return view, nil
}

func GetRenameCardAdminView() (*RenameCardAdminView, error) {
	orders, err := model.ListRenameCardOrders(500)
	if err != nil {
		return nil, err
	}
	events, err := model.ListRenameEvents(1_000)
	if err != nil {
		return nil, err
	}
	outstanding, err := model.GetRenameCardOutstanding()
	if err != nil {
		return nil, err
	}
	entries, err := model.ListLeaderboardEntries()
	if err != nil {
		return nil, err
	}
	entryByUser := make(map[int]model.LeaderboardEntry, len(entries))
	for _, entry := range entries {
		entryByUser[entry.UserId] = entry
	}
	view := &RenameCardAdminView{
		Orders: make([]RenameCardOrderPayload, 0, len(orders)),
		Events: make([]RenameEventPayload, 0, len(events)),
	}
	view.Summary.OutstandingCards = outstanding
	for _, order := range orders {
		payload := renameCardOrderPayload(order)
		payload.UserId = order.UserId
		payload.DisplayName = leaderboardDisplayName(entryByUser[order.UserId])
		view.Orders = append(view.Orders, payload)
		view.Summary.OrderCount++
		if order.Status == model.LeaderboardOrderCompleted {
			view.Summary.CompletedCount++
			view.Summary.CardsSold += order.Quantity
			view.Summary.TotalAmountCny += order.AmountCny
		}
	}
	for _, event := range events {
		view.Events = append(view.Events, RenameEventPayload{
			Id: event.Id, UserId: event.UserId, OldName: event.OldName,
			NewName: event.NewName, CostType: event.CostType, CreatedAt: event.CreatedAt,
		})
		view.Summary.RenameCount++
		if event.CostType == "card" {
			view.Summary.CardRenameCount++
		}
		if event.CostType == "free" {
			view.Summary.FreeRenameCount++
		}
	}
	return view, nil
}

func sponsorOrderPayload(order model.SponsorOrder) SponsorOrderPayload {
	return SponsorOrderPayload{
		Id: order.Id, AmountCny: order.AmountCny, QuotaAmount: order.QuotaAmount,
		Message: order.Message, Status: order.Status, CreatedAt: order.CreatedAt,
		UpdatedAt: order.UpdatedAt, CompletedAt: order.CompletedAt, ErrorMessage: order.ErrorMessage,
	}
}

func renameCardOrderPayload(order model.RenameCardOrder) RenameCardOrderPayload {
	return RenameCardOrderPayload{
		Id: order.Id, Quantity: order.Quantity, AmountCny: order.AmountCny,
		QuotaAmount: order.QuotaAmount, Status: order.Status, CreatedAt: order.CreatedAt,
		UpdatedAt: order.UpdatedAt, CompletedAt: order.CompletedAt, ErrorMessage: order.ErrorMessage,
	}
}
