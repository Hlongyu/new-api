package common

import (
	"io"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetBodyStorageAdoptsInternalBodyAndCleansUp(t *testing.T) {
	storage := newMemoryStorage([]byte(`{"input":"hello"}`))
	t.Cleanup(func() { _ = storage.Close() })
	_, err := storage.Seek(4, io.SeekStart)
	require.NoError(t, err)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/responses", storage)
	adopted, err := GetBodyStorage(c)
	require.NoError(t, err)
	assert.Same(t, storage, adopted)
	data, err := io.ReadAll(adopted)
	require.NoError(t, err)
	assert.JSONEq(t, `{"input":"hello"}`, string(data))
	CleanupBodyStorage(c)
	_, err = storage.Bytes()
	assert.ErrorIs(t, err, ErrStorageClosed)
	_, err = storage.Read(make([]byte, 1))
	assert.ErrorIs(t, err, ErrStorageClosed)
	require.NoError(t, storage.Close())
}

func TestGetBodyStorageRejectsOversizedInternalBody(t *testing.T) {
	oldLimit := constant.MaxRequestBodyMB
	constant.MaxRequestBodyMB = 1
	t.Cleanup(func() { constant.MaxRequestBodyMB = oldLimit })
	storage := newMemoryStorage(make([]byte, (1<<20)+1))
	t.Cleanup(func() { _ = storage.Close() })
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest("POST", "/v1/responses", storage)
	_, err := GetBodyStorage(c)
	assert.ErrorIs(t, err, ErrRequestBodyTooLarge)
}
