package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func publishPersonalChannelFixture(t *testing.T) (*PersonalGroup, *PersonalChannelRevision, Channel) {
	t.Helper()
	setupPersonalGroupsDB(t)
	group, err := CreatePersonalGroup(11, "lifecycle", "", 1)
	require.NoError(t, err)
	revision, err := SavePersonalChannelDraft(11, group.Id, 0, 0, personalChannelFixture())
	require.NoError(t, err)
	require.NoError(t, SubmitPersonalChannel(11, revision.PersonalChannelID, revision.Id))
	require.NoError(t, ReviewPersonalChannel(99, revision.PersonalChannelID, revision.Id, true, ""))
	var live Channel
	require.NoError(t, DB.First(&live).Error)
	return group, revision, live
}

func TestPersonalChannelOwnerTogglesOnlyPublishedVersion(t *testing.T) {
	group, revision, live := publishPersonalChannelFixture(t)
	config := personalChannelFixture()
	config.Key, config.Models = "unapproved-secret", "unapproved-model"
	draft, err := SavePersonalChannelDraft(11, group.Id, revision.PersonalChannelID, revision.Id, config)
	require.NoError(t, err)
	require.Error(t, SetPersonalChannelEnabled(22, revision.PersonalChannelID, false))
	require.NoError(t, SetPersonalChannelEnabled(11, revision.PersonalChannelID, false))
	assert.Empty(t, GetGroupEnabledModels(group.Name))
	require.NoError(t, SubmitPersonalChannel(11, draft.PersonalChannelID, draft.Id))
	require.NoError(t, ReviewPersonalChannel(99, draft.PersonalChannelID, draft.Id, true, ""))
	require.NoError(t, DB.First(&live, live.Id).Error)
	assert.Equal(t, common.ChannelStatusManuallyDisabled, live.Status)
	require.NoError(t, SetPersonalChannelEnabled(11, revision.PersonalChannelID, true))
	assert.Equal(t, []string{"unapproved-model"}, GetGroupEnabledModels(group.Name))
	// The unapproved revision cannot be activated before review.
	config.Key, config.Models = "next-secret", "next-model"
	_, err = SavePersonalChannelDraft(11, group.Id, draft.PersonalChannelID, draft.Id, config)
	require.NoError(t, err)
	require.NoError(t, SetPersonalChannelEnabled(11, revision.PersonalChannelID, false))
	require.NoError(t, SetPersonalChannelEnabled(11, revision.PersonalChannelID, true))
	require.NoError(t, DB.First(&live, live.Id).Error)
	assert.Equal(t, "unapproved-secret", live.Key)
	assert.Equal(t, []string{"unapproved-model"}, GetGroupEnabledModels(group.Name))
}

func TestPersonalChannelDraftCannotBeActivatedWithoutApproval(t *testing.T) {
	setupPersonalGroupsDB(t)
	group, err := CreatePersonalGroup(11, "draft", "", 1)
	require.NoError(t, err)
	draft, err := SavePersonalChannelDraft(11, group.Id, 0, 0, personalChannelFixture())
	require.NoError(t, err)
	require.Error(t, SetPersonalChannelEnabled(11, draft.PersonalChannelID, true))
	var count int64
	require.NoError(t, DB.Model(&Channel{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestPersonalChannelDeletionRequiresCurrentApprovalAndPreservesHistory(t *testing.T) {
	group, revision, live := publishPersonalChannelFixture(t)
	log := Log{UserId: 11, Group: group.Name, ChannelId: live.Id, Type: LogTypeConsume, Quota: 10}
	require.NoError(t, createLog(&log))
	_, err := RequestPersonalChannelDeletion(22, revision.PersonalChannelID, revision.Id)
	require.Error(t, err)
	_, err = RequestPersonalChannelDeletion(11, revision.PersonalChannelID, revision.Id+1)
	require.Error(t, err)
	request, err := RequestPersonalChannelDeletion(11, revision.PersonalChannelID, revision.Id)
	require.NoError(t, err)
	assert.Equal(t, PersonalRevisionDeletePending, request.Status)
	assert.Equal(t, []string{"gpt-example"}, GetGroupEnabledModels(group.Name))
	views, total, err := ListPersonalChannels(0, true, 0, 20)
	require.NoError(t, err)
	require.EqualValues(t, 1, total)
	assert.Equal(t, PersonalRevisionDeletePending, views[0].Revision.Status)
	_, err = RequestPersonalChannelDeletion(11, revision.PersonalChannelID, request.Id)
	require.Error(t, err)
	require.Error(t, ReviewPersonalChannel(99, request.PersonalChannelID, request.Id, false, ""))
	require.NoError(t, ReviewPersonalChannel(99, request.PersonalChannelID, request.Id, false, "Keep this channel"))
	require.NoError(t, DB.First(&live, live.Id).Error)
	request, err = RequestPersonalChannelDeletion(11, request.PersonalChannelID, request.Id)
	require.NoError(t, err)
	require.NoError(t, ReviewPersonalChannel(99, request.PersonalChannelID, request.Id, true, ""))
	require.Error(t, ReviewPersonalChannel(99, request.PersonalChannelID, request.Id, true, ""))
	require.ErrorIs(t, DB.First(&Channel{}, live.Id).Error, gorm.ErrRecordNotFound)
	assert.Empty(t, GetGroupEnabledModels(group.Name))
	_, total, err = ListPersonalChannels(11, false, 0, 20)
	require.NoError(t, err)
	assert.Zero(t, total)
	var stored PersonalChannel
	require.NoError(t, DB.First(&stored, request.PersonalChannelID).Error)
	assert.Positive(t, stored.DeletedAt)
	var reviewed PersonalChannelRevision
	require.NoError(t, DB.First(&reviewed, request.Id).Error)
	assert.Equal(t, PersonalRevisionDeleted, reviewed.Status)
	assert.Equal(t, 99, reviewed.ReviewerID)
	assert.Contains(t, reviewed.Payload, "secret-a")
	require.NoError(t, DB.First(&Log{}, log.Id).Error)
	require.Error(t, SetPersonalChannelEnabled(11, request.PersonalChannelID, true))
	_, err = SavePersonalChannelDraft(11, group.Id, stored.Id, reviewed.Id, personalChannelFixture())
	require.Error(t, err)
}

func TestNewDraftSupersedesDeletionRequest(t *testing.T) {
	group, revision, _ := publishPersonalChannelFixture(t)
	request, err := RequestPersonalChannelDeletion(11, revision.PersonalChannelID, revision.Id)
	require.NoError(t, err)
	draft, err := SavePersonalChannelDraft(11, group.Id, request.PersonalChannelID, request.Id, personalChannelFixture())
	require.NoError(t, err)
	require.Error(t, ReviewPersonalChannel(99, request.PersonalChannelID, request.Id, true, ""))
	require.NoError(t, SubmitPersonalChannel(11, draft.PersonalChannelID, draft.Id))
	require.NoError(t, ReviewPersonalChannel(99, draft.PersonalChannelID, draft.Id, true, ""))
	assert.Equal(t, []string{"gpt-example"}, GetGroupEnabledModels(group.Name))
}

func TestPersonalChannelMigrationPreservesExistingRecords(t *testing.T) {
	_, _, _ = publishPersonalChannelFixture(t)
	require.NoError(t, DB.Migrator().DropColumn(&PersonalChannel{}, "deleted_at"))
	require.NoError(t, DB.AutoMigrate(&PersonalChannel{}))
	views, total, err := ListPersonalChannels(11, false, 0, 20)
	require.NoError(t, err)
	assert.EqualValues(t, 1, total)
	require.Len(t, views, 1)
	assert.Zero(t, views[0].DeletedAt)
}

func TestDeletionApprovalCanArchiveAnAlreadyMissingPublishedChannel(t *testing.T) {
	_, revision, live := publishPersonalChannelFixture(t)
	// Reproduce a channel removed by the administrator before deletion review existed.
	require.NoError(t, DB.Delete(&Channel{}, live.Id).Error)
	request, err := RequestPersonalChannelDeletion(11, revision.PersonalChannelID, revision.Id)
	require.NoError(t, err)
	require.NoError(t, ReviewPersonalChannel(99, request.PersonalChannelID, request.Id, true, ""))
	var abilities int64
	require.NoError(t, DB.Model(&Ability{}).Where("channel_id = ?", live.Id).Count(&abilities).Error)
	assert.Zero(t, abilities)
	_, total, err := ListPersonalChannels(11, false, 0, 20)
	require.NoError(t, err)
	assert.Zero(t, total)
}

func TestAdministratorDeletionCannotBypassPersonalChannelReview(t *testing.T) {
	group, revision, live := publishPersonalChannelFixture(t)
	ordinary := Channel{Name: "Admin", Key: "key", Status: common.ChannelStatusManuallyDisabled}
	require.NoError(t, DB.Create(&ordinary).Error)
	require.ErrorIs(t, (&Channel{Id: live.Id}).Delete(), ErrPersonalChannelDeletionRequiresReview)
	_, err := BatchDeleteChannels([]int{ordinary.Id, live.Id})
	require.ErrorIs(t, err, ErrPersonalChannelDeletionRequiresReview)
	require.NoError(t, DB.First(&Channel{}, ordinary.Id).Error)
	require.NoError(t, SetPersonalChannelEnabled(11, revision.PersonalChannelID, false))
	count, err := DeleteDisabledChannel()
	require.NoError(t, err)
	assert.EqualValues(t, 1, count)
	require.NoError(t, DB.First(&live, live.Id).Error)
	assert.Empty(t, GetGroupEnabledModels(group.Name))
}
