package common

import (
	"io"

	"github.com/QuantumNous/new-api/common"
)

// NewOutboundJSONBody wraps the already-marshaled upstream request body into a
// BodyStorage. When disk cache is enabled and the payload exceeds the configured
// threshold, the data is written to a temp file and the original []byte can be
// GC'd, significantly reducing the heap residency while waiting for the
// upstream provider to respond (the dominant cost for large base64 payloads).
//
// In memory mode the underlying memoryStorage reuses the same backing array,
// so this is equivalent to bytes.NewReader(data) in terms of memory usage.
//
// Storage is released as soon as the transport consumes the complete body.
// The caller MUST also defer closer.Close() for rejected or interrupted sends.
//
// The returned reader is wrapped with common.ReaderOnly to prevent the HTTP
// transport from prematurely closing the underlying BodyStorage. The returned
// size is meant to be propagated to http.Request.ContentLength because the
// type-erased io.Reader prevents net/http from auto-detecting it.
func NewOutboundJSONBody(data []byte) (body io.Reader, size int64, closer io.Closer, err error) {
	storage, err := common.CreateBodyStorage(data)
	if err != nil {
		return nil, 0, nil, err
	}
	return &outboundJSONReader{storage: storage, remaining: storage.Size()}, storage.Size(), storage, nil
}

// The HTTP transport may stop at Content-Length without reading EOF. Release
// on the last byte, not on response headers: an upstream can start its response
// while it is still reading the request. This reader deliberately has no Close
// method, so early response handling cannot truncate an unfinished upload.
type outboundJSONReader struct {
	storage   common.BodyStorage
	remaining int64
}

func (r *outboundJSONReader) Read(p []byte) (int, error) {
	if r.remaining == 0 {
		_ = r.storage.Close()
		return 0, io.EOF
	}
	n, err := r.storage.Read(p)
	r.remaining -= int64(n)
	if r.remaining == 0 {
		_ = r.storage.Close()
	}
	return n, err
}
