package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
)

// FetchPersonalChannelModels uses the same fixed-origin, protected transport as
// personal inference. Credentials never appear in URLs or upstream error text.
func FetchPersonalChannelModels(ctx context.Context, config model.PersonalChannelConfig) ([]string, error) {
	config.Name, config.Models = "Model discovery", "discovery"
	if err := config.Validate(); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	client := *GetPersonalChannelHTTPClient()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return fetchPersonalModelPages(ctx, &client, config)
}

func fetchPersonalModelPages(ctx context.Context, client *http.Client, config model.PersonalChannelConfig) ([]string, error) {
	base := strings.TrimRight(config.BaseURL, "/")
	version := "/v1"
	if config.Type == constant.ChannelTypeGemini {
		version = "/v1beta"
	}
	if !strings.HasSuffix(base, version) {
		base += version
	}
	endpoint := base + "/models"
	ids := map[string]bool{}
	cursor := ""
	seenCursors := map[string]bool{}
	for page := 0; page < 20; page++ {
		target, err := url.Parse(endpoint)
		if err != nil {
			return nil, errors.New("Invalid upstream URL")
		}
		query := target.Query()
		if config.Type == constant.ChannelTypeGemini {
			query.Set("pageSize", "1000")
			if cursor != "" {
				query.Set("pageToken", cursor)
			}
		}
		if config.Type == constant.ChannelTypeAnthropic {
			query.Set("limit", "1000")
			if cursor != "" {
				query.Set("after_id", cursor)
			}
		}
		target.RawQuery = query.Encode()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
		if err != nil {
			return nil, errors.New("Invalid upstream request")
		}
		switch config.Type {
		case constant.ChannelTypeAnthropic:
			req.Header.Set("x-api-key", config.Key)
			req.Header.Set("anthropic-version", "2023-06-01")
		case constant.ChannelTypeGemini:
			req.Header.Set("x-goog-api-key", config.Key)
		default:
			req.Header.Set("Authorization", "Bearer "+config.Key)
		}
		response, err := client.Do(req)
		if err != nil {
			return nil, errors.New("Unable to fetch upstream models; check the public HTTPS address and connection")
		}
		body, readErr := io.ReadAll(io.LimitReader(response.Body, (2<<20)+1))
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("Upstream model listing returned HTTP %d", response.StatusCode)
		}
		if readErr != nil || len(body) > 2<<20 {
			return nil, errors.New("Upstream model listing is too large or unreadable")
		}
		var result struct {
			Data *[]struct {
				ID string `json:"id"`
			} `json:"data"`
			Models *[]struct {
				Name string `json:"name"`
			} `json:"models"`
			NextPageToken string `json:"nextPageToken"`
			HasMore       bool   `json:"has_more"`
			LastID        string `json:"last_id"`
		}
		if err := common.Unmarshal(body, &result); err != nil {
			return nil, errors.New("Invalid upstream model listing")
		}
		names := []string{}
		if config.Type == constant.ChannelTypeGemini {
			if result.Models == nil {
				return nil, errors.New("Invalid upstream model listing")
			}
			for _, item := range *result.Models {
				names = append(names, strings.TrimPrefix(item.Name, "models/"))
			}
		} else {
			if result.Data == nil {
				return nil, errors.New("Invalid upstream model listing")
			}
			for _, item := range *result.Data {
				names = append(names, item.ID)
			}
		}
		for _, name := range names {
			name = strings.TrimSpace(name)
			if name != "" && len(name) <= 255 && !strings.ContainsAny(name, ",\r\n") {
				ids[name] = true
			}
		}
		if len(ids) > 10000 {
			return nil, errors.New("Upstream returned too many models")
		}
		cursor = ""
		if config.Type == constant.ChannelTypeGemini {
			cursor = result.NextPageToken
		}
		if config.Type == constant.ChannelTypeAnthropic && result.HasMore {
			if result.LastID == "" {
				return nil, errors.New("Invalid upstream pagination")
			}
			cursor = result.LastID
		}
		if cursor == "" {
			models := make([]string, 0, len(ids))
			for name := range ids {
				models = append(models, name)
			}
			sort.Strings(models)
			return models, nil
		}
		if seenCursors[cursor] {
			return nil, errors.New("Invalid upstream pagination")
		}
		seenCursors[cursor] = true
	}
	return nil, errors.New("Upstream model listing has too many pages")
}
