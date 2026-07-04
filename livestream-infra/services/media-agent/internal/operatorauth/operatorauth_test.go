package operatorauth

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/logging"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
}

func TestRequireBearerTokenDisabledWhenEmpty(t *testing.T) {
	h := RequireBearerToken("", testLogger(), okHandler())
	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 when no token is configured", rec.Code)
	}
}

func TestRequireBearerTokenRejectsMissingHeader(t *testing.T) {
	h := RequireBearerToken("secret", testLogger(), okHandler())
	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 with no Authorization header", rec.Code)
	}
}

func TestRequireBearerTokenRejectsWrongToken(t *testing.T) {
	h := RequireBearerToken("secret", testLogger(), okHandler())
	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 with an incorrect token", rec.Code)
	}
}

func TestRequireBearerTokenAcceptsCorrectToken(t *testing.T) {
	h := RequireBearerToken(logging.Secret("secret"), testLogger(), okHandler())
	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200 with the correct token", rec.Code)
	}
}
