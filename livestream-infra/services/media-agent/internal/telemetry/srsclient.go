// Package telemetry implements the Media Agent side of Livestream
// Technical Telemetry + Media Node Health Reporting.
//
// The Media Agent is the sole collection boundary: it is the only
// component with network access to the SRS HTTP API (private
// media-node Docker network only - see
// livestream-infra/infra/media-node/srs/srs.conf, "http_api"/"exporter"
// are never published to the host) and it already owns the durable
// session/segment state (internal/store) needed to derive delivered
// bitrate, publish duration, and reconnect counts. Nothing in this
// package opens a new network port, and nothing here blocks or delays
// SRS callback handling, upload, manifest generation, B2 archival, or
// YouTube relay - every failure here is caught and logged, never
// propagated into the ingest path.
//
// Field set and shapes below are exactly what isolated Step 0 evidence
// observed from the pinned SRS build
// (ossrs/srs@sha256:4e293846ad2448ff1a0157aa2c694e7c451fff5046c93b5bc6da0fa0384ef998)
// via GET /api/v1/streams/ against a real synthetic H.264/AAC publish -
// not assumed from SRS documentation. Notably absent: any frame-rate
// (FPS) field. audio.sample_rate was observed present but is
// SRS-reported container metadata that diverged from the actual encoder
// setting in that same evidence run, so it is deliberately not surfaced
// as an authoritative fact anywhere by this package.
package telemetry

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// maxResponseBytes bounds how much of an SRS API response this client
// will read, regardless of what a misbehaving or unexpectedly large
// response returns.
const maxResponseBytes = 4 << 20 // 4 MiB

// SRSVideoInfo mirrors the "video" object Step 0 observed:
// {"codec":"H264","profile":"Main","level":"2","width":320,"height":240}.
// Every field is exactly what SRS reported - no fps field exists here or
// anywhere else in the response; it must never be invented.
type SRSVideoInfo struct {
	Codec   string `json:"codec"`
	Profile string `json:"profile"`
	Level   string `json:"level"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
}

// SRSAudioInfo mirrors the "audio" object Step 0 observed:
// {"codec":"AAC","sample_rate":44100,"channel":2,"profile":"LC"}.
// SampleRate is intentionally unexported from the wire contract this
// package builds (see aggregate.go) - Step 0 observed it diverge from
// the real encoder setting (FLV/AAC container metadata, not the
// authoritative encode rate) and it must never be presented as fact.
type SRSAudioInfo struct {
	Codec      string `json:"codec"`
	SampleRate int    `json:"sample_rate"`
	Channel    int    `json:"channel"`
	Profile    string `json:"profile"`
}

// SRSPublishInfo mirrors the "publish" object: {"active":true,"cid":"..."}.
type SRSPublishInfo struct {
	Active bool   `json:"active"`
	CID    string `json:"cid"`
}

// SRSKbps mirrors the "kbps" object: {"recv_30s":298,"send_30s":0}.
// RecvSec30 is the only genuine ingest-bitrate evidence this package
// treats as authoritative - a real rolling 30-second receive bitrate SRS
// itself computes, not derived or estimated by the Media Agent.
type SRSKbps struct {
	RecvSec30 int `json:"recv_30s"`
	SendSec30 int `json:"send_30s"`
}

// SRSStream is one entry of the "streams" array from GET
// /api/v1/streams/. Video and Audio are pointers because Step 0 observed
// the whole stream entry disappear from the array entirely on
// unpublish - there is no "final" entry with these fields present but
// stale, and this package must never fabricate one; a *SRSStream simply
// stops being found for that ingest name once the publisher disconnects.
type SRSStream struct {
	Name      string         `json:"name"`
	App       string         `json:"app"`
	LiveMs    int64          `json:"live_ms"`
	Clients   int            `json:"clients"`
	Frames    int64          `json:"frames"`
	SendBytes int64          `json:"send_bytes"`
	RecvBytes int64          `json:"recv_bytes"`
	Kbps      SRSKbps        `json:"kbps"`
	Publish   SRSPublishInfo `json:"publish"`
	Video     *SRSVideoInfo  `json:"video"`
	Audio     *SRSAudioInfo  `json:"audio"`
}

// srsStreamsResponse is the exact top-level shape Step 0 observed:
// {"code":0,"server":"...","service":"...","pid":"...","streams":[...]}.
type srsStreamsResponse struct {
	Code    int         `json:"code"`
	Streams []SRSStream `json:"streams"`
}

// SRSClient queries one SRS instance's HTTP API for current per-stream
// technical telemetry. It is read-only and never mutates SRS state.
type SRSClient struct {
	// BaseURL is the SRS HTTP API origin, e.g. "http://srs:1985" - never
	// published beyond the private media-node Docker network (see the
	// package doc above).
	BaseURL    string
	HTTPClient *http.Client
}

// NewSRSClient returns an SRSClient with a bounded-timeout default
// *http.Client if httpClient is nil.
func NewSRSClient(baseURL string, httpClient *http.Client) *SRSClient {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 5 * time.Second}
	}
	return &SRSClient{BaseURL: baseURL, HTTPClient: httpClient}
}

// FetchStreams queries GET {BaseURL}/api/v1/streams/ (the trailing slash
// is deliberate: Step 0 observed the pinned SRS build 301-redirect
// /api/v1/streams to /api/v1/streams/, and following a redirect would
// double the request count on every sample for no benefit) and returns
// every stream entry currently reported. An empty result is a normal,
// expected outcome whenever no session is actively publishing - not an
// error.
func (c *SRSClient) FetchStreams(ctx context.Context) ([]SRSStream, error) {
	url := strings.TrimSuffix(c.BaseURL, "/") + "/api/v1/streams/"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("telemetry: build SRS streams request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("telemetry: SRS streams request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("telemetry: read SRS streams response: %w", err)
	}
	if len(body) > maxResponseBytes {
		return nil, fmt.Errorf("telemetry: SRS streams response exceeded %d bytes", maxResponseBytes)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("telemetry: SRS streams unexpected status %d", resp.StatusCode)
	}

	var parsed srsStreamsResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("telemetry: parse SRS streams response: %w", err)
	}
	if parsed.Code != 0 {
		return nil, fmt.Errorf("telemetry: SRS streams non-zero code %d", parsed.Code)
	}
	return parsed.Streams, nil
}

// FindByName returns the stream entry whose "name" equals ingestID, or
// found=false if the SRS API is not currently reporting one - either
// because nothing is publishing, or (see the FetchStreams doc above)
// because the publisher just disconnected and SRS has already dropped
// the entry. Either way, absence must never be treated as "connected
// with stale data".
func FindByName(streams []SRSStream, ingestID string) (SRSStream, bool) {
	for _, s := range streams {
		if s.Name == ingestID {
			return s, true
		}
	}
	return SRSStream{}, false
}
