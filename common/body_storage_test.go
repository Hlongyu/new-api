package common

import (
	"bytes"
	"errors"
	"io"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBodyStorageSpillsUnknownLengthAndReplays(t *testing.T) {
	oldConfig := GetDiskCacheConfig()
	t.Cleanup(func() { SetDiskCacheConfig(oldConfig) })
	SetDiskCacheConfig(DiskCacheConfig{Enabled: true, ThresholdMB: 1, MaxSizeMB: 32, Path: t.TempDir()})
	for _, test := range []struct {
		name string
		size int
		disk bool
	}{
		{"small body", 128, false},
		{"threshold body", 1 << 20, true},
		{"large body", (1 << 20) + 1, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			data := bytes.Repeat([]byte{'x'}, test.size)
			storage, err := CreateBodyStorageFromReader(bytes.NewReader(data), -1, 2<<20)
			require.NoError(t, err)
			t.Cleanup(func() { _ = storage.Close() })
			assert.Equal(t, test.disk, storage.IsDisk())
			for attempt := 0; attempt < 2; attempt++ {
				_, err = storage.Seek(0, io.SeekStart)
				require.NoError(t, err)
				got, err := io.ReadAll(storage)
				require.NoError(t, err)
				assert.Equal(t, data, got)
			}
			require.NoError(t, storage.Close())
		})
	}
}

func TestBodyStorageSpillFailuresRemovePartialFiles(t *testing.T) {
	oldConfig := GetDiskCacheConfig()
	t.Cleanup(func() { SetDiskCacheConfig(oldConfig) })
	readErr := errors.New("upload interrupted")
	for _, test := range []struct {
		name string
		body io.Reader
		want error
	}{
		{"oversized decoded body", bytes.NewReader(bytes.Repeat([]byte{'x'}, (2<<20)+1)), ErrRequestBodyTooLarge},
		{"interrupted upload", io.MultiReader(bytes.NewReader(bytes.Repeat([]byte{'x'}, 1<<20)), bodyReadError{readErr}), readErr},
	} {
		t.Run(test.name, func(t *testing.T) {
			SetDiskCacheConfig(DiskCacheConfig{Enabled: true, ThresholdMB: 1, MaxSizeMB: 32, Path: t.TempDir()})
			// A compressed Content-Length may be smaller than the decoded body.
			_, err := CreateBodyStorageFromReader(test.body, 128, 2<<20)
			require.ErrorIs(t, err, test.want)
			files, err := os.ReadDir(GetDiskCacheDir())
			require.NoError(t, err)
			assert.Empty(t, files)
		})
	}
}

type bodyReadError struct{ err error }

func (r bodyReadError) Read([]byte) (int, error) { return 0, r.err }
