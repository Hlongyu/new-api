package common

import (
	"io"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestOutboundJSONBodyReleasesStorageAfterTransmission(t *testing.T) {
	oldConfig := common.GetDiskCacheConfig()
	t.Cleanup(func() { common.SetDiskCacheConfig(oldConfig) })
	for _, disk := range []bool{false, true} {
		name := "memory"
		if disk {
			name = "disk"
		}
		t.Run(name, func(t *testing.T) {
			common.SetDiskCacheConfig(common.DiskCacheConfig{Enabled: disk, ThresholdMB: 0, MaxSizeMB: 1, Path: t.TempDir()})
			before := common.GetDiskCacheStats()
			payload := []byte(`{"input":"complete request"}`)
			body, size, closer, err := NewOutboundJSONBody(payload)
			require.NoError(t, err)
			t.Cleanup(func() { _ = closer.Close() })
			req, err := http.NewRequest(http.MethodPost, "http://upstream.example/v1/responses", body)
			require.NoError(t, err)
			first := make([]byte, 5)
			_, err = io.ReadFull(req.Body, first)
			require.NoError(t, err)
			// Existing relay handling closes req.Body when response headers arrive.
			// Providers may send headers before they have consumed the upload.
			require.NoError(t, req.Body.Close())
			rest := make([]byte, size-int64(len(first)))
			_, err = io.ReadFull(req.Body, rest)
			require.NoError(t, err)
			assert.Equal(t, payload, append(first, rest...))
			// A Content-Length-limited transport need not read EOF to release it.
			after := common.GetDiskCacheStats()
			assert.Equal(t, before.ActiveMemoryBuffers, after.ActiveMemoryBuffers)
			assert.Equal(t, before.ActiveDiskFiles, after.ActiveDiskFiles)
			_, err = req.Body.Read(make([]byte, 1))
			assert.ErrorIs(t, err, io.EOF)
			require.NoError(t, closer.Close())
		})
	}
}
