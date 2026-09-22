package telemetry

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The exact response shape Step 0 observed against the pinned SRS build
// while a synthetic H.264/AAC publish was active.
const step0ActiveResponse = `{"code":0,"server":"vid-94a561y","service":"0n2y2u0q","pid":"1","streams":[{"id":"vid-6385218","name":"step0stream","vhost":"vid-n806190","app":"live","tcUrl":"rtmp://eventcast-step0-srs:1935/live","url":"/live/step0stream","live_ms":1790085298078,"clients":1,"frames":1212,"send_bytes":4387,"recv_bytes":1820224,"kbps":{"recv_30s":298,"send_30s":0},"publish":{"active":true,"cid":"h409f966"},"video":{"codec":"H264","profile":"Main","level":"2","width":320,"height":240},"audio":{"codec":"AAC","sample_rate":44100,"channel":2,"profile":"LC"}}]}`

// The exact response shape Step 0 observed after unpublish - the stream
// entry disappears entirely, it is not left present-but-inactive.
const step0PostStreamResponse = `{"code":0,"server":"vid-94a561y","service":"0n2y2u0q","pid":"1","streams":[]}`

func newSRSTestServer(t *testing.T, path string, status int, body string) (*httptest.Server, *SRSClient) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != path {
			t.Errorf("unexpected request path %q, want %q", r.URL.Path, path)
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv, NewSRSClient(srv.URL, srv.Client())
}

func TestFetchStreamsParsesStep0ActiveEvidenceExactly(t *testing.T) {
	_, client := newSRSTestServer(t, "/api/v1/streams/", http.StatusOK, step0ActiveResponse)

	streams, err := client.FetchStreams(context.Background())
	if err != nil {
		t.Fatalf("FetchStreams() error: %v", err)
	}
	if len(streams) != 1 {
		t.Fatalf("streams = %d, want 1", len(streams))
	}
	s := streams[0]

	if s.Name != "step0stream" {
		t.Errorf("Name = %q, want %q", s.Name, "step0stream")
	}
	if !s.Publish.Active {
		t.Error("Publish.Active = false, want true")
	}
	if s.Kbps.RecvSec30 != 298 {
		t.Errorf("Kbps.RecvSec30 = %d, want 298", s.Kbps.RecvSec30)
	}
	if s.RecvBytes != 1820224 {
		t.Errorf("RecvBytes = %d, want 1820224", s.RecvBytes)
	}
	if s.Video == nil {
		t.Fatal("Video = nil, want present")
	}
	if s.Video.Width != 320 || s.Video.Height != 240 {
		t.Errorf("Video dims = %dx%d, want 320x240", s.Video.Width, s.Video.Height)
	}
	if s.Video.Codec != "H264" {
		t.Errorf("Video.Codec = %q, want H264", s.Video.Codec)
	}
	if s.Audio == nil {
		t.Fatal("Audio = nil, want present")
	}
	if s.Audio.Codec != "AAC" {
		t.Errorf("Audio.Codec = %q, want AAC", s.Audio.Codec)
	}
}

// Proves the stream simply vanishes from the array on unpublish - never a
// present-but-stale/inactive entry - matching Step 0's directly observed
// post-unpublish behaviour exactly.
func TestFetchStreamsReturnsEmptyAfterUnpublish(t *testing.T) {
	_, client := newSRSTestServer(t, "/api/v1/streams/", http.StatusOK, step0PostStreamResponse)

	streams, err := client.FetchStreams(context.Background())
	if err != nil {
		t.Fatalf("FetchStreams() error: %v", err)
	}
	if len(streams) != 0 {
		t.Fatalf("streams = %d, want 0", len(streams))
	}
}

func TestFetchStreamsRejectsMalformedJSON(t *testing.T) {
	_, client := newSRSTestServer(t, "/api/v1/streams/", http.StatusOK, `{"code":0,"streams":[`)

	if _, err := client.FetchStreams(context.Background()); err == nil {
		t.Fatal("FetchStreams() error = nil, want a parse error")
	}
}

func TestFetchStreamsRejectsNonZeroCode(t *testing.T) {
	_, client := newSRSTestServer(t, "/api/v1/streams/", http.StatusOK, `{"code":1,"streams":[]}`)

	if _, err := client.FetchStreams(context.Background()); err == nil {
		t.Fatal("FetchStreams() error = nil, want a non-zero-code error")
	}
}

func TestFetchStreamsRejectsNonOKStatus(t *testing.T) {
	_, client := newSRSTestServer(t, "/api/v1/streams/", http.StatusInternalServerError, `{"code":0,"streams":[]}`)

	if _, err := client.FetchStreams(context.Background()); err == nil {
		t.Fatal("FetchStreams() error = nil, want an unexpected-status error")
	}
}

// A stream entry with no "video"/"audio" object at all (e.g. a
// video-only or audio-only publish, or a different SRS state this
// package has not directly observed) must parse without error and leave
// Video/Audio nil rather than a zero-value struct - the distinction
// between "absent" and "zeroed" matters to every caller downstream.
func TestFetchStreamsToleratesMissingVideoAndAudio(t *testing.T) {
	body := `{"code":0,"streams":[{"name":"partial","publish":{"active":true},"kbps":{"recv_30s":0,"send_30s":0}}]}`
	_, client := newSRSTestServer(t, "/api/v1/streams/", http.StatusOK, body)

	streams, err := client.FetchStreams(context.Background())
	if err != nil {
		t.Fatalf("FetchStreams() error: %v", err)
	}
	if len(streams) != 1 {
		t.Fatalf("streams = %d, want 1", len(streams))
	}
	if streams[0].Video != nil {
		t.Error("Video != nil for a response with no video object")
	}
	if streams[0].Audio != nil {
		t.Error("Audio != nil for a response with no audio object")
	}
}

func TestFetchStreamsRejectsOversizedResponse(t *testing.T) {
	huge := `{"code":0,"streams":[` + strings.Repeat(`{"name":"x"},`, 500000) + `{"name":"y"}]}`
	_, client := newSRSTestServer(t, "/api/v1/streams/", http.StatusOK, huge)

	if _, err := client.FetchStreams(context.Background()); err == nil {
		t.Fatal("FetchStreams() error = nil, want an oversized-response error")
	}
}

func TestFetchStreamsRequestsTrailingSlashDirectly(t *testing.T) {
	// SRS 301-redirects /api/v1/streams to /api/v1/streams/ (observed in
	// Step 0). Requesting the trailing-slash path directly avoids a
	// redirect on every sample.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/streams" {
			t.Error("client requested the non-redirected path; must request the trailing-slash path directly")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":0,"streams":[]}`))
	}))
	defer srv.Close()

	client := NewSRSClient(srv.URL, srv.Client())
	if _, err := client.FetchStreams(context.Background()); err != nil {
		t.Fatalf("FetchStreams() error: %v", err)
	}
}

func TestFindByNameMatchesAndMisses(t *testing.T) {
	streams := []SRSStream{{Name: "a"}, {Name: "b"}}

	if _, found := FindByName(streams, "a"); !found {
		t.Error("FindByName(a) found = false, want true")
	}
	if _, found := FindByName(streams, "missing"); found {
		t.Error("FindByName(missing) found = true, want false")
	}
	if _, found := FindByName(nil, "a"); found {
		t.Error("FindByName(nil, a) found = true, want false")
	}
}
