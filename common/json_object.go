package common

import (
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"unsafe"

	"github.com/tidwall/gjson"
)

// WriteJSONObject rewrites top-level fields without decoding or copying nested
// values. A nil override removes a field. Duplicate keys use the last value,
// matching Unmarshal into a map; this also keeps validation and forwarding in
// agreement. Neither data nor overrides may be modified until this returns.
func WriteJSONObject(w io.Writer, data []byte, overrides map[string]json.RawMessage) error {
	if !gjson.ValidBytes(data) {
		return fmt.Errorf("invalid JSON object")
	}
	// The read-only view stays within this call. ParseBytes would duplicate the
	// whole conversation before we can stream its original value slices.
	object := gjson.Parse(unsafe.String(unsafe.SliceData(data), len(data)))
	if !object.IsObject() {
		return fmt.Errorf("expected JSON object")
	}
	fields := make(map[string]json.RawMessage)
	object.ForEach(func(key, value gjson.Result) bool {
		fields[key.Str] = data[value.Index : value.Index+len(value.Raw)]
		return true
	})
	for key, value := range overrides {
		if value == nil {
			delete(fields, key)
			continue
		}
		if !gjson.ValidBytes(value) {
			return fmt.Errorf("invalid JSON override for %q", key)
		}
		fields[key] = value
	}
	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if _, err := io.WriteString(w, "{"); err != nil {
		return err
	}
	for i, key := range keys {
		prefix, err := Marshal(key)
		if err != nil {
			return err
		}
		if i > 0 {
			prefix = append([]byte{','}, prefix...)
		}
		prefix = append(prefix, ':')
		if _, err := w.Write(prefix); err != nil {
			return err
		}
		if _, err := w.Write(fields[key]); err != nil {
			return err
		}
	}
	_, err := io.WriteString(w, "}")
	return err
}
