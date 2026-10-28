package router

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestPersonalGroupEndpointsRequireAuthentication(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	registerPersonalGroupRoutes(engine.Group("/api"))
	for _, test := range []struct{ method, path string }{
		{http.MethodGet, "/api/personal/groups"},
		{http.MethodGet, "/api/personal/channels"},
		{http.MethodPost, "/api/personal/groups"},
		{http.MethodPut, "/api/personal/groups/1"},
		{http.MethodPost, "/api/personal/channels"},
		{http.MethodPost, "/api/personal/channels/models"},
		{http.MethodPost, "/api/personal/channels/1/submit"},
		{http.MethodGet, "/api/personal-channel-reviews"},
		{http.MethodPost, "/api/personal-channel-reviews/1"},
	} {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, httptest.NewRequest(test.method, test.path, nil))
			assert.Equal(t, http.StatusUnauthorized, response.Code)
		})
	}
}
