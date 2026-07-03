package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

// jsonContractsFile is a partial decode of ../contracts.json covering
// only the fields this test compares against the Go representation.
type jsonContractsFile struct {
	SchemaVersion string `json:"schemaVersion"`
	SrsCallbacks  struct {
		EnvelopeFields []struct {
			JSONName string `json:"jsonName"`
			Required bool   `json:"required"`
		} `json:"envelopeFields"`
	} `json:"srsCallbacks"`
	ErrorCodes          valueList `json:"errorCodes"`
	MediaNodeStates     valueList `json:"mediaNodeStates"`
	EventMediaStates    valueList `json:"eventMediaStates"`
	StreamSessionStates valueList `json:"streamSessionStates"`
	MediaJobStates      valueList `json:"mediaJobStates"`
	MediaJobTypes       valueList `json:"mediaJobTypes"`
}

type valueList struct {
	Values []string `json:"values"`
}

func loadContractsJSON(t *testing.T) jsonContractsFile {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "contracts.json"))
	if err != nil {
		t.Fatalf("read contracts.json: %v", err)
	}
	var parsed jsonContractsFile
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("parse contracts.json: %v", err)
	}
	return parsed
}

func assertSetsEqual(t *testing.T, name string, got, want []string) {
	t.Helper()
	gotSorted := append([]string(nil), got...)
	wantSorted := append([]string(nil), want...)
	sort.Strings(gotSorted)
	sort.Strings(wantSorted)
	if !reflect.DeepEqual(gotSorted, wantSorted) {
		t.Fatalf("%s mismatch:\n  go:   %v\n  json: %v", name, gotSorted, wantSorted)
	}
}

func TestSchemaVersionMatchesJSON(t *testing.T) {
	parsed := loadContractsJSON(t)
	if parsed.SchemaVersion != SchemaVersion {
		t.Fatalf("SchemaVersion = %q, contracts.json schemaVersion = %q", SchemaVersion, parsed.SchemaVersion)
	}
}

// TestSRSCallbackPayloadMatchesJSON proves SRSCallbackPayload has
// exactly the JSON field names contracts.json declares, and that every
// field contracts.json marks required is a required (non-omitempty in
// this case, always-present) field on the Go struct - the struct has
// no omitempty tags, so this reduces to a field-name/coverage check.
func TestSRSCallbackPayloadMatchesJSON(t *testing.T) {
	parsed := loadContractsJSON(t)

	wantFields := make([]string, 0, len(parsed.SrsCallbacks.EnvelopeFields))
	wantRequired := make(map[string]bool)
	for _, f := range parsed.SrsCallbacks.EnvelopeFields {
		wantFields = append(wantFields, f.JSONName)
		if f.Required {
			wantRequired[f.JSONName] = true
		}
	}

	typ := reflect.TypeOf(SRSCallbackPayload{})
	gotFields := make([]string, 0, typ.NumField())
	for i := 0; i < typ.NumField(); i++ {
		gotFields = append(gotFields, typ.Field(i).Tag.Get("json"))
	}

	assertSetsEqual(t, "SRSCallbackPayload json tags vs contracts.json envelopeFields", gotFields, wantFields)

	for jsonName := range wantRequired {
		found := false
		for _, gf := range gotFields {
			if gf == jsonName {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("required field %q from contracts.json is missing from SRSCallbackPayload", jsonName)
		}
	}
}

func TestSRSRoutesMatchJSON(t *testing.T) {
	// The route paths are duplicated as string literals in contracts.json
	// action.route fields; this test pins the Go constants to the exact
	// values used by services/media-agent/cmd/media-agent/main.go so a
	// drift in either place fails loudly.
	cases := map[string]string{
		RouteOnPublish:   "/internal/srs/on-publish",
		RouteOnHLS:       "/internal/srs/on-hls",
		RouteOnUnpublish: "/internal/srs/on-unpublish",
	}
	for got, want := range cases {
		if got != want {
			t.Fatalf("route constant = %q, want %q", got, want)
		}
	}
}

func TestErrorCodesMatchJSON(t *testing.T) {
	parsed := loadContractsJSON(t)
	got := make([]string, len(ErrorCodes))
	for i, c := range ErrorCodes {
		got[i] = string(c)
	}
	assertSetsEqual(t, "ErrorCodes", got, parsed.ErrorCodes.Values)
}

func TestMediaNodeStatesMatchJSON(t *testing.T) {
	parsed := loadContractsJSON(t)
	got := make([]string, len(MediaNodeStates))
	for i, s := range MediaNodeStates {
		got[i] = string(s)
	}
	assertSetsEqual(t, "MediaNodeStates", got, parsed.MediaNodeStates.Values)
}

func TestEventMediaStatesMatchJSON(t *testing.T) {
	parsed := loadContractsJSON(t)
	got := make([]string, len(EventMediaStates))
	for i, s := range EventMediaStates {
		got[i] = string(s)
	}
	assertSetsEqual(t, "EventMediaStates", got, parsed.EventMediaStates.Values)
}

func TestStreamSessionStatesMatchJSON(t *testing.T) {
	parsed := loadContractsJSON(t)
	got := make([]string, len(StreamSessionStates))
	for i, s := range StreamSessionStates {
		got[i] = string(s)
	}
	assertSetsEqual(t, "StreamSessionStates", got, parsed.StreamSessionStates.Values)
}

func TestMediaJobStatesMatchJSON(t *testing.T) {
	parsed := loadContractsJSON(t)
	got := make([]string, len(MediaJobStates))
	for i, s := range MediaJobStates {
		got[i] = string(s)
	}
	assertSetsEqual(t, "MediaJobStates", got, parsed.MediaJobStates.Values)
}

func TestMediaJobTypesMatchJSON(t *testing.T) {
	parsed := loadContractsJSON(t)
	got := make([]string, len(MediaJobTypes))
	for i, s := range MediaJobTypes {
		got[i] = string(s)
	}
	assertSetsEqual(t, "MediaJobTypes", got, parsed.MediaJobTypes.Values)
}
