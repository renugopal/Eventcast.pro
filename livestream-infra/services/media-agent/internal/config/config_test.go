package config

import (
	"net"
	"testing"
)

func envMap(m map[string]string) func(string) string {
	return func(key string) string {
		return m[key]
	}
}

func TestLoadValidConfig(t *testing.T) {
	getenv := envMap(map[string]string{
		EnvNodeID:   "node-asia-south1-a-01",
		EnvHTTPAddr: "127.0.0.1:9090",
		EnvLogLevel: "debug",
	})

	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.NodeID != "node-asia-south1-a-01" {
		t.Errorf("NodeID = %q, want %q", cfg.NodeID, "node-asia-south1-a-01")
	}
	if cfg.HTTPAddr != "127.0.0.1:9090" {
		t.Errorf("HTTPAddr = %q, want %q", cfg.HTTPAddr, "127.0.0.1:9090")
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q, want %q", cfg.LogLevel, "debug")
	}
}

func TestLoadAppliesDefaults(t *testing.T) {
	getenv := envMap(map[string]string{
		EnvNodeID: "node-1",
	})

	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.HTTPAddr != DefaultHTTPAddr {
		t.Errorf("HTTPAddr = %q, want default %q", cfg.HTTPAddr, DefaultHTTPAddr)
	}
	if cfg.LogLevel != DefaultLogLevel {
		t.Errorf("LogLevel = %q, want default %q", cfg.LogLevel, DefaultLogLevel)
	}
}

func TestLoadDefaultAddrIsLoopback(t *testing.T) {
	getenv := envMap(map[string]string{
		EnvNodeID: "node-1",
	})

	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	host, _, err := net.SplitHostPort(cfg.HTTPAddr)
	if err != nil {
		t.Fatalf("failed to split default HTTPAddr %q: %v", cfg.HTTPAddr, err)
	}
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		t.Errorf("default HTTPAddr host = %q, want a loopback address", host)
	}
}

func TestLoadMissingNodeIDFailsFast(t *testing.T) {
	getenv := envMap(map[string]string{})

	_, err := Load(getenv)
	if err == nil {
		t.Fatal("Load() expected error for missing node id, got nil")
	}
}

func TestLoadWhitespaceOnlyNodeIDFailsFast(t *testing.T) {
	getenv := envMap(map[string]string{
		EnvNodeID: "   ",
	})

	_, err := Load(getenv)
	if err == nil {
		t.Fatal("Load() expected error for whitespace-only node id, got nil")
	}
}

func TestLoadOversizedNodeIDFailsFast(t *testing.T) {
	oversized := make([]byte, maxNodeIDLength+1)
	for i := range oversized {
		oversized[i] = 'a'
	}

	getenv := envMap(map[string]string{
		EnvNodeID: string(oversized),
	})

	_, err := Load(getenv)
	if err == nil {
		t.Fatal("Load() expected error for oversized node id, got nil")
	}
}

func TestLoadInvalidHTTPAddrFailsFast(t *testing.T) {
	cases := []struct {
		name string
		addr string
	}{
		{"no port separator", "not-a-valid-address"},
		{"empty port", "127.0.0.1:"},
		{"non-numeric port", "127.0.0.1:http"},
		{"port zero selects ephemeral port", "127.0.0.1:0"},
		{"port above 65535", "127.0.0.1:70000"},
		{"negative port", "127.0.0.1:-1"},
		{"plus-prefixed port", "127.0.0.1:+8085"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			getenv := envMap(map[string]string{
				EnvNodeID:   "node-1",
				EnvHTTPAddr: tc.addr,
			})

			_, err := Load(getenv)
			if err == nil {
				t.Fatalf("Load() expected error for HTTP address %q, got nil", tc.addr)
			}
		})
	}
}

func TestLoadAcceptsExplicitBindAddresses(t *testing.T) {
	// 0.0.0.0 (and the equivalent empty host) is a deliberate operator
	// choice used by the Compose stack so the SRS container can reach
	// the agent over the private container network.
	cases := []struct {
		name string
		addr string
	}{
		{"all interfaces", "0.0.0.0:8085"},
		{"empty host binds all interfaces", ":8085"},
		{"ipv6 loopback", "[::1]:8085"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			getenv := envMap(map[string]string{
				EnvNodeID:   "node-1",
				EnvHTTPAddr: tc.addr,
			})

			cfg, err := Load(getenv)
			if err != nil {
				t.Fatalf("Load() unexpected error for HTTP address %q: %v", tc.addr, err)
			}
			if cfg.HTTPAddr != tc.addr {
				t.Errorf("HTTPAddr = %q, want %q", cfg.HTTPAddr, tc.addr)
			}
		})
	}
}

func TestLoadRejectsUnsafeNodeIDCharacters(t *testing.T) {
	cases := []struct {
		name   string
		nodeID string
	}{
		{"embedded space", "node 1"},
		{"path separator", "node/1"},
		{"path traversal", "../etc"},
		{"embedded newline", "node\n1"},
		{"non-ascii", "nödé-1"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			getenv := envMap(map[string]string{
				EnvNodeID: tc.nodeID,
			})

			_, err := Load(getenv)
			if err == nil {
				t.Fatalf("Load() expected error for unsafe node id %q, got nil", tc.nodeID)
			}
		})
	}
}

func TestLoadAcceptsSafeNodeIDCharacters(t *testing.T) {
	getenv := envMap(map[string]string{
		EnvNodeID: "media-node_asia.south1-A01",
	})

	cfg, err := Load(getenv)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.NodeID != "media-node_asia.south1-A01" {
		t.Errorf("NodeID = %q, want %q", cfg.NodeID, "media-node_asia.south1-A01")
	}
}

func TestLoadInvalidLogLevelFailsFast(t *testing.T) {
	getenv := envMap(map[string]string{
		EnvNodeID:   "node-1",
		EnvLogLevel: "not-a-level",
	})

	_, err := Load(getenv)
	if err == nil {
		t.Fatal("Load() expected error for invalid log level, got nil")
	}
}

func TestValidateRejectsZeroValueConfig(t *testing.T) {
	var cfg Config
	if err := cfg.Validate(); err == nil {
		t.Fatal("Validate() expected error for zero-value config, got nil")
	}
}
