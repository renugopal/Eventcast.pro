package srs

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
)

func testLogger(buf *bytes.Buffer) *slog.Logger {
	return logging.New(buf, slog.LevelInfo)
}

func TestOnPublishHandlerSuccess(t *testing.T) {
	var buf bytes.Buffer
	h := NewOnPublishHandler(testLogger(&buf))

	body := `{"action":"on_publish","client_id":"abc123","ip":"127.0.0.1","vhost":"__defaultVhost__","app":"live","stream":"teststream","param":"?token=super-secret-token"}`
	req := httptest.NewRequest(http.MethodPost, "/internal/srs/on-publish", strings.NewReader(body))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}

	var resp successResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON body: %v (raw: %s)", err, rec.Body.String())
	}
	if resp.Code != 0 {
		t.Errorf("Code = %d, want 0", resp.Code)
	}

	if strings.Contains(buf.String(), "super-secret-token") {
		t.Fatalf("secret token leaked into log output: %s", buf.String())
	}
}

func TestOnHLSHandlerSuccess(t *testing.T) {
	var buf bytes.Buffer
	h := NewOnHLSHandler(testLogger(&buf))

	body := `{"action":"on_hls","stream":"teststream","app":"live","file":"./objs/nginx/html/live/teststream/1-1.ts","url":"live/teststream/1-1.ts","m3u8":"live/teststream.m3u8","duration":10.0,"seq_no":1}`
	req := httptest.NewRequest(http.MethodPost, "/internal/srs/on-hls", strings.NewReader(body))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestOnUnpublishHandlerSuccess(t *testing.T) {
	var buf bytes.Buffer
	h := NewOnUnpublishHandler(testLogger(&buf))

	body := `{"action":"on_unpublish","stream":"teststream","app":"live"}`
	req := httptest.NewRequest(http.MethodPost, "/internal/srs/on-unpublish", strings.NewReader(body))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusOK, rec.Body.String())
	}
}

func TestHandlerRejectsNonPOST(t *testing.T) {
	var buf bytes.Buffer
	h := NewOnPublishHandler(testLogger(&buf))

	req := httptest.NewRequest(http.MethodGet, "/internal/srs/on-publish", nil)
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusMethodNotAllowed)
	}
	if allow := rec.Header().Get("Allow"); allow != http.MethodPost {
		t.Errorf("Allow header = %q, want %q", allow, http.MethodPost)
	}
}

func TestHandlerRejectsMalformedJSON(t *testing.T) {
	var buf bytes.Buffer
	h := NewOnPublishHandler(testLogger(&buf))

	req := httptest.NewRequest(http.MethodPost, "/internal/srs/on-publish", strings.NewReader(`{"action":`))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusBadRequest, rec.Body.String())
	}

	var resp errorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid JSON error body: %v (raw: %s)", err, rec.Body.String())
	}
	if resp.Error == "" {
		t.Error("Error = \"\", want non-empty")
	}
}

func TestHandlerRejectsOversizedBody(t *testing.T) {
	var buf bytes.Buffer
	h := NewOnPublishHandler(testLogger(&buf))

	oversized := `{"action":"on_publish","stream":"` + strings.Repeat("a", MaxCallbackBodyBytes+1) + `"}`
	req := httptest.NewRequest(http.MethodPost, "/internal/srs/on-publish", strings.NewReader(oversized))
	rec := httptest.NewRecorder()

	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusRequestEntityTooLarge, rec.Body.String())
	}
}

func TestHandlerRejectsMissingRequiredFields(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"missing action", `{"stream":"teststream"}`},
		{"missing stream", `{"action":"on_publish"}`},
		{"empty object", `{}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var buf bytes.Buffer
			h := NewOnPublishHandler(testLogger(&buf))

			req := httptest.NewRequest(http.MethodPost, "/internal/srs/on-publish", strings.NewReader(tc.body))
			rec := httptest.NewRecorder()

			h.ServeHTTP(rec, req)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d (body: %s)", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}
}
