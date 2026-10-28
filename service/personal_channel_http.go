package service

import (
	"net/http"
	"net/url"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

var personalChannelClientOnce sync.Once
var personalChannelClient *http.Client

// Personal endpoints always receive dial-time IP validation, independent of
// administrator fetch settings. Disable proxies so DNS cannot escape the check.
func GetPersonalChannelHTTPClient() *http.Client {
	personalChannelClientOnce.Do(func() {
		personalChannelClient = newProtectedFetchHTTPClientWithProxy(nil, nil,
			func() (*common.SSRFProtection, bool, error) {
				return &common.SSRFProtection{ApplyIPFilterForDomain: true}, true, nil
			},
			func(*http.Request) (*url.URL, error) { return nil, nil },
		)
	})
	return personalChannelClient
}
