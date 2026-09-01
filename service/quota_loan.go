package service

import (
	"errors"
	"math"
	"sort"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
)

var ErrQuotaLoanUnavailable = errors.New("当前段位暂未开放先用后付")

type QuotaLoanPayload struct {
	Id                string  `json:"id"`
	TierKey           string  `json:"tierKey"`
	TierName          string  `json:"tierName"`
	CreditAmount      int     `json:"creditAmount"`
	QuotaAmount       int     `json:"quotaAmount"`
	OutstandingAmount float64 `json:"outstandingAmount"`
	Status            string  `json:"status"`
	CreatedAt         int64   `json:"createdAt"`
	UpdatedAt         int64   `json:"updatedAt"`
	DueAt             int64   `json:"dueAt"`
	CompletedAt       int64   `json:"completedAt"`
	ErrorMessage      string  `json:"errorMessage,omitempty"`
	UserId            int     `json:"userId,omitempty"`
	DisplayName       string  `json:"displayName,omitempty"`
}

type QuotaLoanEventPayload struct {
	Id                string  `json:"id"`
	LoanId            string  `json:"grantId"`
	Type              string  `json:"type"`
	RedemptionId      int     `json:"redemptionId"`
	RedemptionTime    int64   `json:"redemptionTime"`
	Amount            float64 `json:"amount"`
	OutstandingBefore float64 `json:"outstandingBefore"`
	OutstandingAfter  float64 `json:"outstandingAfter"`
	Status            string  `json:"status"`
	ErrorMessage      string  `json:"errorMessage"`
	CreatedAt         int64   `json:"createdAt"`
	UpdatedAt         int64   `json:"updatedAt"`
	UserId            int     `json:"userId,omitempty"`
	DisplayName       string  `json:"displayName,omitempty"`
	TierName          string  `json:"tierName,omitempty"`
}

type QuotaLoanContext struct {
	Configured         bool                    `json:"configured"`
	UserId             int                     `json:"userId"`
	CreditLimit        int                     `json:"creditLimit"`
	AvailableCredit    int                     `json:"availableCredit"`
	OutstandingAmount  float64                 `json:"outstandingAmount"`
	NextDueAt          int64                   `json:"nextDueAt"`
	ApplicationPending bool                    `json:"applicationPending"`
	CanApply           bool                    `json:"canApply"`
	ActiveGrant        *QuotaLoanPayload       `json:"activeGrant"`
	OpenGrants         []QuotaLoanPayload      `json:"openGrants"`
	Grants             []QuotaLoanPayload      `json:"grants"`
	Events             []QuotaLoanEventPayload `json:"events"`
	IsRoot             bool                    `json:"isRoot"`
}

type QuotaLoanAdminView struct {
	State struct {
		Configured    bool   `json:"configured"`
		Running       bool   `json:"running"`
		LastSyncAt    int64  `json:"lastSyncAt"`
		LastSyncError string `json:"lastSyncError"`
	} `json:"state"`
	Summary struct {
		GrantCount        int     `json:"grantCount"`
		UserCount         int     `json:"userCount"`
		OutstandingAmount float64 `json:"outstandingAmount"`
		OverdueAmount     float64 `json:"overdueAmount"`
		GrantedAmount     float64 `json:"grantedAmount"`
		RepaidAmount      float64 `json:"repaidAmount"`
	} `json:"summary"`
	Grants []QuotaLoanPayload      `json:"grants"`
	Events []QuotaLoanEventPayload `json:"events"`
}

func quotaLoanCreditForRank(tierKey string, division string) int {
	if tierKey == "iron" {
		if division == "III" || division == "II" || division == "I" {
			return 10
		}
		return 0
	}
	return map[string]int{
		"bronze": 50, "silver": 100, "gold": 200, "platinum": 350,
		"diamond": 500, "master": 750, "grandmaster": 1_100, "challenger": 1_500,
	}[tierKey]
}

func GetQuotaLoanContext(userId int, isRoot bool) (*QuotaLoanContext, error) {
	now := common.GetTimestamp()
	if err := model.MarkQuotaLoansOverdue(now); err != nil {
		return nil, err
	}
	progress, err := GetRankProgress(userId)
	if err != nil {
		return nil, err
	}
	loans, err := model.ListUserQuotaLoans(userId, 20)
	if err != nil {
		return nil, err
	}
	events, err := model.ListUserQuotaLoanEvents(userId, 50)
	if err != nil {
		return nil, err
	}
	limit := quotaLoanCreditForRank(progress.TierKey, progress.Division)
	quotaPerUnit := common.QuotaPerUnit
	if quotaPerUnit <= 0 {
		return nil, errors.New("quota per unit must be positive")
	}
	outstandingQuota := int64(0)
	context := &QuotaLoanContext{
		Configured: true, UserId: userId, CreditLimit: limit, IsRoot: isRoot,
		OpenGrants: make([]QuotaLoanPayload, 0), Grants: make([]QuotaLoanPayload, 0, len(loans)),
		Events: make([]QuotaLoanEventPayload, 0, len(events)),
	}
	loanById := make(map[string]model.QuotaLoan, len(loans))
	for _, loan := range loans {
		loanById[loan.Id] = loan
		payload := quotaLoanPayload(loan, quotaPerUnit)
		context.Grants = append(context.Grants, payload)
		if loan.Status == model.QuotaLoanActive || loan.Status == model.QuotaLoanOverdue || loan.Status == model.LeaderboardOrderProcessing || loan.Status == model.LeaderboardOrderUnknown {
			context.OpenGrants = append(context.OpenGrants, payload)
			outstandingQuota += int64(max(loan.OutstandingQuota, 0))
			if loan.Status == model.LeaderboardOrderProcessing || loan.Status == model.LeaderboardOrderUnknown {
				context.ApplicationPending = true
			}
		}
	}
	sort.Slice(context.OpenGrants, func(left int, right int) bool {
		if context.OpenGrants[left].DueAt != context.OpenGrants[right].DueAt {
			return context.OpenGrants[left].DueAt < context.OpenGrants[right].DueAt
		}
		if context.OpenGrants[left].CreatedAt != context.OpenGrants[right].CreatedAt {
			return context.OpenGrants[left].CreatedAt < context.OpenGrants[right].CreatedAt
		}
		return context.OpenGrants[left].Id < context.OpenGrants[right].Id
	})
	for index := range context.OpenGrants {
		grant := &context.OpenGrants[index]
		if grant.Status != model.QuotaLoanActive && grant.Status != model.QuotaLoanOverdue {
			continue
		}
		if context.NextDueAt == 0 || grant.DueAt < context.NextDueAt {
			context.NextDueAt = grant.DueAt
		}
		if context.ActiveGrant == nil {
			copyPayload := *grant
			context.ActiveGrant = &copyPayload
		}
	}
	if context.ActiveGrant == nil && len(context.OpenGrants) > 0 {
		copyPayload := context.OpenGrants[0]
		context.ActiveGrant = &copyPayload
	}
	context.OutstandingAmount = float64(outstandingQuota) / quotaPerUnit
	context.AvailableCredit = quotaLoanAvailableCredit(limit, outstandingQuota, quotaPerUnit)
	context.CanApply = context.AvailableCredit > 0 && !context.ApplicationPending
	for _, event := range events {
		context.Events = append(context.Events, quotaLoanEventPayload(event, loanById[event.LoanId], quotaPerUnit))
	}
	return context, nil
}

func ApplyQuotaLoan(requestKey string, userId int, amount *int) (*QuotaLoanPayload, error) {
	progress, err := GetRankProgress(userId)
	if err != nil {
		return nil, err
	}
	limit := quotaLoanCreditForRank(progress.TierKey, progress.Division)
	if limit <= 0 {
		return nil, ErrQuotaLoanUnavailable
	}
	quotaPerUnit := common.QuotaPerUnit
	if quotaPerUnit <= 0 {
		return nil, errors.New("quota per unit must be positive")
	}
	exposure, err := model.GetQuotaLoanExposure(userId)
	if err != nil {
		return nil, err
	}
	available := quotaLoanAvailableCredit(limit, exposure, quotaPerUnit)
	creditAmount := available
	if amount != nil {
		creditAmount = *amount
	}
	if creditAmount <= 0 || creditAmount > available {
		return nil, errors.New("本次申请额度超过当前可用额度")
	}
	quotaAmount, err := common.QuotaFromFloatStrict(float64(creditAmount) * common.QuotaPerUnit)
	if err != nil {
		return nil, err
	}
	creditLimitQuota, err := common.QuotaFromFloatStrict(float64(limit) * common.QuotaPerUnit)
	if err != nil {
		return nil, err
	}
	entry, err := EnsureLeaderboardProfile(userId)
	if err != nil {
		return nil, err
	}
	now := common.GetTimestamp()
	loan, err := model.CreateQuotaLoan(
		requestKey, userId, entry.Id, progress.TierKey, progress.TierName,
		creditAmount, quotaAmount, creditLimitQuota, quotaLoanDueAt(now), now,
	)
	if err != nil {
		return nil, err
	}
	payload := quotaLoanPayload(*loan, quotaPerUnit)
	return &payload, nil
}

func GetQuotaLoanAdminView() (*QuotaLoanAdminView, error) {
	now := common.GetTimestamp()
	if err := model.MarkQuotaLoansOverdue(now); err != nil {
		return nil, err
	}
	loans, err := model.ListAllQuotaLoans(200)
	if err != nil {
		return nil, err
	}
	events, err := model.ListAllQuotaLoanEvents(400)
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
	quotaPerUnit := common.QuotaPerUnit
	if quotaPerUnit <= 0 {
		return nil, errors.New("quota per unit must be positive")
	}
	view := &QuotaLoanAdminView{Grants: make([]QuotaLoanPayload, 0, len(loans)), Events: make([]QuotaLoanEventPayload, 0, len(events))}
	view.State.Configured = true
	view.State.Running = true
	view.State.LastSyncAt = now
	users := make(map[int]bool)
	loanById := make(map[string]model.QuotaLoan, len(loans))
	for _, loan := range loans {
		loanById[loan.Id] = loan
		users[loan.UserId] = true
		payload := quotaLoanPayload(loan, quotaPerUnit)
		payload.UserId = loan.UserId
		payload.DisplayName = leaderboardDisplayName(entryByUser[loan.UserId])
		view.Grants = append(view.Grants, payload)
		view.Summary.GrantCount++
		if loan.Status == model.QuotaLoanActive || loan.Status == model.QuotaLoanSettled || loan.Status == model.QuotaLoanOverdue {
			view.Summary.GrantedAmount += float64(loan.QuotaAmount) / quotaPerUnit
		}
		if loan.Status == model.QuotaLoanActive || loan.Status == model.QuotaLoanOverdue || loan.Status == model.LeaderboardOrderUnknown {
			view.Summary.OutstandingAmount += float64(loan.OutstandingQuota) / quotaPerUnit
		}
		if loan.Status == model.QuotaLoanOverdue {
			view.Summary.OverdueAmount += float64(loan.OutstandingQuota) / quotaPerUnit
		}
	}
	view.Summary.UserCount = len(users)
	for _, event := range events {
		payload := quotaLoanEventPayload(event, loanById[event.LoanId], quotaPerUnit)
		payload.UserId = event.UserId
		payload.DisplayName = leaderboardDisplayName(entryByUser[event.UserId])
		view.Events = append(view.Events, payload)
		if event.Status == model.LeaderboardOrderCompleted {
			view.Summary.RepaidAmount += float64(event.QuotaAmount) / quotaPerUnit
		}
	}
	return view, nil
}

func quotaLoanPayload(loan model.QuotaLoan, quotaPerUnit float64) QuotaLoanPayload {
	return QuotaLoanPayload{
		Id: loan.Id, TierKey: loan.TierKey, TierName: loan.TierName,
		CreditAmount: loan.CreditAmount, QuotaAmount: loan.QuotaAmount,
		OutstandingAmount: float64(loan.OutstandingQuota) / quotaPerUnit, Status: loan.Status,
		CreatedAt: loan.CreatedAt, UpdatedAt: loan.UpdatedAt, DueAt: loan.DueAt,
		CompletedAt: loan.CompletedAt, ErrorMessage: loan.ErrorMessage,
	}
}

func quotaLoanAvailableCredit(limit int, exposure int64, quotaPerUnit float64) int {
	availableQuota := math.Max(float64(limit)*quotaPerUnit-float64(exposure), 0)
	return int(math.Floor(availableQuota / quotaPerUnit))
}

func quotaLoanEventPayload(event model.QuotaLoanEvent, loan model.QuotaLoan, quotaPerUnit float64) QuotaLoanEventPayload {
	redemptionId := 0
	if event.SourceType == "redemption" {
		redemptionId, _ = strconv.Atoi(event.SourceId)
	}
	return QuotaLoanEventPayload{
		Id: event.Id, LoanId: event.LoanId, Type: event.EventType,
		RedemptionId: redemptionId, RedemptionTime: event.RedemptionTime,
		Amount:            float64(event.QuotaAmount) / quotaPerUnit,
		OutstandingBefore: float64(event.OutstandingBefore) / quotaPerUnit,
		OutstandingAfter:  float64(event.OutstandingAfter) / quotaPerUnit,
		Status:            event.Status, ErrorMessage: event.ErrorMessage,
		CreatedAt: event.CreatedAt, UpdatedAt: event.UpdatedAt,
		TierName: loan.TierName,
	}
}

func quotaLoanDueAt(now int64) int64 {
	location, err := time.LoadLocation(leaderboardTimeZone)
	if err != nil {
		return now
	}
	current := time.Unix(now, 0).In(location)
	due := time.Date(current.Year(), current.Month()+1, 16, 0, 0, 0, 0, location).Add(-time.Second)
	return due.Unix()
}
