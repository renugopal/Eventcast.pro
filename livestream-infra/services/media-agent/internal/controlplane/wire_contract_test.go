package controlplane

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/renugopal/Eventcast.pro/livestream-infra/services/media-agent/internal/store"
)

// Go<->TypeScript wire-contract parity: rather than importing across the
// packages/contracts/go and services/media-agent Go modules (which the
// internal/ package boundary and packages/contracts' own module isolation
// both deliberately prevent), this test and its TypeScript counterpart
// (eventcast-admin/tests/contract/media-agent-assignment.test.ts) each
// independently assert their own struct's/interface's JSON key set against
// the single shared source of truth, packages/contracts/contracts.json's
// mediaAgentAssignmentWire/mediaAgentAssignmentsResponseWire sections. If
// either side's shape drifts from that file, that side's own test fails —
// closing the loop between two representations that cannot directly import
// one another.

type wireKeysFile struct {
	MediaAgentAssignmentWire struct {
		Keys []string `json:"keys"`
	} `json:"mediaAgentAssignmentWire"`
	MediaAgentAssignmentsResponseWire struct {
		Keys []string `json:"keys"`
	} `json:"mediaAgentAssignmentsResponseWire"`
}

func loadWireContractKeys(t *testing.T) wireKeysFile {
	t.Helper()
	path := filepath.Join("..", "..", "..", "..", "packages", "contracts", "contracts.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	var parsed wireKeysFile
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	return parsed
}

// jsonTagKeys returns v's exported fields' `json:"..."` tag names, in
// struct declaration order — the same order encoding/json marshals them
// in, and the exact order this repo's ordered-key contract lists assert
// against.
func jsonTagKeys(t *testing.T, v any) []string {
	t.Helper()
	rt := reflect.TypeOf(v)
	keys := make([]string, 0, rt.NumField())
	for i := 0; i < rt.NumField(); i++ {
		tag := rt.Field(i).Tag.Get("json")
		if tag == "" || tag == "-" {
			t.Fatalf("field %s has no usable json tag", rt.Field(i).Name)
		}
		name, _, _ := strings.Cut(tag, ",")
		keys = append(keys, name)
	}
	return keys
}

func TestAssignmentWireContractMatchesSharedContractsJSON(t *testing.T) {
	want := loadWireContractKeys(t).MediaAgentAssignmentWire.Keys
	got := jsonTagKeys(t, store.Assignment{})

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("store.Assignment JSON key order/set does not match contracts.json mediaAgentAssignmentWire.keys:\n  go:   %v\n  json: %v", got, want)
	}
}

func TestAssignmentsResponseWireContractMatchesSharedContractsJSON(t *testing.T) {
	want := loadWireContractKeys(t).MediaAgentAssignmentsResponseWire.Keys
	got := jsonTagKeys(t, AssignmentsResponse{})

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("controlplane.AssignmentsResponse JSON key order/set does not match contracts.json mediaAgentAssignmentsResponseWire.keys:\n  go:   %v\n  json: %v", got, want)
	}
}
