package console_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAnnouncementRequireReadValidation(t *testing.T) {
	for _, test := range []struct {
		name  string
		field string
		valid bool
	}{
		{"legacy", "", true},
		{"required", `,"requireRead":true`, true},
		{"ordinary", `,"requireRead":false`, true},
		{"string rejected", `,"requireRead":"true"`, false},
		{"null rejected", `,"requireRead":null`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := ValidateConsoleSettings(`[{"content":"Update","publishDate":"2020-01-01T00:00:00Z"`+test.field+`}]`, "Announcements")
			if test.valid {
				assert.NoError(t, err)
			} else {
				assert.Error(t, err)
			}
		})
	}
}
