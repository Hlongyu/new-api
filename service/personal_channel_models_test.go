package service

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type personalModelsTransport func(*http.Request) (*http.Response, error)

func (f personalModelsTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestPersonalModelsProviderPaginationAndCredentials(t *testing.T) {
	for _, test := range []struct {
		name                      string
		kind                      int
		path, header, value, body string
	}{
		{"openai", 1, "/v1/models", "Authorization", "Bearer secret", `{"data":[{"id":"z"},{"id":"a"},{"id":"z"}]}`},
		{"anthropic", 14, "/v1/models", "x-api-key", "secret", `{"data":[{"id":"a"}],"has_more":true,"last_id":"a"}`},
		{"gemini", 24, "/v1beta/models", "x-goog-api-key", "secret", `{"models":[{"name":"models/a"}],"nextPageToken":"next"}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			count := 0
			client := &http.Client{Transport: personalModelsTransport(func(req *http.Request) (*http.Response, error) {
				count++
				assert.Equal(t, test.path, req.URL.Path)
				assert.Equal(t, test.value, req.Header.Get(test.header))
				assert.NotContains(t, req.URL.String(), "secret")
				body := test.body
				if count == 2 {
					if test.kind == 24 {
						assert.Equal(t, "next", req.URL.Query().Get("pageToken"))
						body = `{"models":[{"name":"models/z"}]}`
					} else {
						assert.Equal(t, "a", req.URL.Query().Get("after_id"))
						body = `{"data":[{"id":"z"}]}`
					}
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
			})}
			ids, err := fetchPersonalModelPages(context.Background(), client, model.PersonalChannelConfig{Type: test.kind, BaseURL: "https://example.com", Key: "secret"})
			require.NoError(t, err)
			assert.Equal(t, []string{"a", "z"}, ids)
		})
	}
}

func TestPersonalModelsDoNotExposeUpstreamErrorOrAcceptInvalidPayload(t *testing.T) {
	for _, test := range []struct {
		status int
		body   string
	}{{401, `{"error":"secret"}`}, {200, `{"error":"secret"}`}, {200, `not-json`}, {200, strings.Repeat("x", (2<<20)+1)}} {
		client := &http.Client{Transport: personalModelsTransport(func(req *http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: test.status, Body: io.NopCloser(strings.NewReader(test.body)), Header: make(http.Header)}, nil
		})}
		_, err := fetchPersonalModelPages(context.Background(), client, model.PersonalChannelConfig{Type: 1, BaseURL: "https://example.com/v1", Key: "secret"})
		require.Error(t, err)
		assert.NotContains(t, err.Error(), "secret")
	}
}
