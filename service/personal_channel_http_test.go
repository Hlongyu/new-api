package service

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPersonalChannelHTTPAllowsCustomHTTPSPorts(t *testing.T) {
	configureSSRFTestFetchSetting(t)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/redirect":
			http.Redirect(w, r, "https://8.8.8.8:9443/final", http.StatusFound)
		case "/private-redirect":
			http.Redirect(w, r, "https://127.0.0.1:9443/final", http.StatusFound)
		default:
			_, _ = io.WriteString(w, "upstream response")
		}
	}))
	t.Cleanup(server.Close)
	personalTransport := GetPersonalChannelHTTPClient().Transport.(*ssrfProtectedRoundTripper)
	var dialed []string
	client := newProtectedFetchHTTPClientWithProxy(nil,
		func(ctx context.Context, network, address string) (net.Conn, error) {
			dialed = append(dialed, address)
			return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
		}, personalTransport.getProtection, personalTransport.proxy)
	t.Cleanup(client.CloseIdleConnections)
	roots := x509.NewCertPool()
	roots.AddCert(server.Certificate())
	client.Transport.(*ssrfProtectedRoundTripper).transportFor(nil).TLSClientConfig = &tls.Config{
		RootCAs: roots, ServerName: "127.0.0.1",
	}
	for _, test := range []struct {
		name     string
		target   string
		wantDial []string
		wantErr  string
	}{
		{"direct", "https://8.8.8.8:9443/models", []string{"8.8.8.8:9443"}, ""},
		{"redirect", "https://8.8.8.8/redirect", []string{"8.8.8.8:443", "8.8.8.8:9443"}, ""},
		{"private redirect", "https://8.8.8.8/private-redirect", []string{"8.8.8.8:443"}, "private IP address not allowed"},
	} {
		t.Run(test.name, func(t *testing.T) {
			client.CloseIdleConnections()
			dialed = nil
			request, err := http.NewRequest(http.MethodGet, test.target, nil)
			require.NoError(t, err)
			response, err := client.Do(request)
			if response != nil {
				defer response.Body.Close()
			}
			if test.wantErr != "" {
				require.ErrorContains(t, err, test.wantErr)
			} else {
				require.NoError(t, err)
				require.NotNil(t, response)
				body, err := io.ReadAll(response.Body)
				require.NoError(t, err)
				assert.Equal(t, http.StatusOK, response.StatusCode)
				assert.Equal(t, "upstream response", string(body))
			}
			assert.Equal(t, test.wantDial, dialed)
		})
	}
	// Resource fetching continues to enforce the administrator's port allowlist.
	require.ErrorContains(t, ValidateSSRFProtectedFetchURL("https://8.8.8.8:9443"), "port 9443 is not allowed")
}

func TestPersonalChannelHTTPRejectsPrivateAndMetadataTargets(t *testing.T) {
	configureSSRFTestFetchSetting(t)
	// A permissive resource-fetch policy cannot disable personal-channel checks.
	fetchSetting := system_setting.GetFetchSetting()
	fetchSetting.EnableSSRFProtection = false
	fetchSetting.AllowPrivateIp = true
	fetchSetting.ApplyIPFilterForDomain = false
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
