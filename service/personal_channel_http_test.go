package service

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPersonalChannelHTTPRejectsPrivateAndMetadataTargets(t *testing.T) {
	client := GetPersonalChannelHTTPClient()
	for _, target := range []string{"https://127.0.0.1:443", "https://[::1]:443", "https://169.254.169.254/latest/meta-data", "https://10.0.0.1:443"} {
		t.Run(target, func(t *testing.T) {
			request, err := http.NewRequest(http.MethodGet, target, nil)
			require.NoError(t, err)
			response, err := client.Do(request)
			require.Error(t, err)
			assert.Nil(t, response)
			assert.Contains(t, err.Error(), "private IP address not allowed")
		})
	}
}
