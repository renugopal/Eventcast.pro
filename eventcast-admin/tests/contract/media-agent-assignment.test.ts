import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  BROWSER_SAFE_ASSIGNMENT_KEYS,
  MEDIA_AGENT_ASSIGNMENT_WIRE_KEYS,
  MEDIA_AGENT_ASSIGNMENTS_RESPONSE_KEYS,
  type MediaAgentAssignmentSource,
  type MediaAgentAssignmentsResponseSource,
} from '@/lib/media-agent/contracts';
import {
  toBrowserSafeAssignment,
  toMediaAgentAssignmentWire,
  toMediaAgentAssignmentsResponseWire,
} from '@/lib/media-agent/assignmentAdapter';

// ── Fake, test-only values. No real credentials, keys, hashes, or URLs. ──────
const FAKE_SECRET_HASH = 'a'.repeat(64); // shape only: 64 hex chars
const FAKE_YT_KEY = 'fake-youtube-stream-key-DO-NOT-USE';
const FAKE_YT_URL = 'rtmp://rtmp.example.test/live2';

function makeSource(
  overrides: Partial<MediaAgentAssignmentSource> = {},
): MediaAgentAssignmentSource {
  return {
    ingestId: 'ingest-fake-1',
    eventId: 'event-fake-1',
    playbackId: 'pb-fake-1',
    streamSecretHash: FAKE_SECRET_HASH,
    enabled: true,
    publishWindowStartAt: '2026-01-01T00:00:00Z',
    publishWindowEndAt: '2026-01-01T04:00:00Z',
    configVersion: '42',
    updatedAt: '2026-01-01T00:00:00Z',
    youtubeEnabled: true,
    youtubeDestinationBaseUrl: FAKE_YT_URL,
    youtubeStreamKey: FAKE_YT_KEY,
    ...overrides,
  };
}

// Exact snake_case wire key set the current Media Agent Assignment struct
// carries (store/assignments.go JSON tags), asserted directly here rather than
// only through the exported constant so a drift in either is caught.
const EXPECTED_WIRE_KEYS = [
  'ingest_id',
  'event_id',
  'playback_id',
  'stream_secret_hash',
  'enabled',
  'publish_window_start_at',
  'publish_window_end_at',
  'config_version',
  'updated_at',
  'youtube_enabled',
  'youtube_destination_base_url',
  'youtube_stream_key',
].sort();

const EXPECTED_ENVELOPE_KEYS = ['assignments', 'config_version', 'generated_at'];

const EXPECTED_BROWSER_SAFE_KEYS = [
  'ingestId',
  'eventId',
  'playbackId',
  'enabled',
  'publishWindowStartAt',
  'publishWindowEndAt',
  'configVersion',
  'updatedAt',
  'youtubeEnabled',
].sort();

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('Media Agent assignment wire contract', () => {
  it('emits exactly the current Media Agent assignment fields, in snake_case (1,2,3)', () => {
    const wire = toMediaAgentAssignmentWire(makeSource());

    // Exact key set — no missing, no unexpected fields.
    expect(Object.keys(wire).sort()).toEqual(EXPECTED_WIRE_KEYS);
    // Exact snake_case names present.
    for (const key of EXPECTED_WIRE_KEYS) {
      expect(wire).toHaveProperty(key);
    }
    // The exported key list stays in lockstep with the actual output.
    expect([...MEDIA_AGENT_ASSIGNMENT_WIRE_KEYS].sort()).toEqual(EXPECTED_WIRE_KEYS);
  });

  it('serializes (JSON round-trip) to exactly the expected snake_case key set (3)', () => {
    const serialized = JSON.parse(JSON.stringify(toMediaAgentAssignmentWire(makeSource())));
    expect(Object.keys(serialized).sort()).toEqual(EXPECTED_WIRE_KEYS);
  });

  it('maps each camelCase source field to its exact wire value', () => {
    const wire = toMediaAgentAssignmentWire(makeSource());
    expect(wire).toEqual({
      ingest_id: 'ingest-fake-1',
      event_id: 'event-fake-1',
      playback_id: 'pb-fake-1',
      stream_secret_hash: FAKE_SECRET_HASH,
      enabled: true,
      publish_window_start_at: '2026-01-01T00:00:00Z',
      publish_window_end_at: '2026-01-01T04:00:00Z',
      config_version: '42',
      updated_at: '2026-01-01T00:00:00Z',
      youtube_enabled: true,
      youtube_destination_base_url: FAKE_YT_URL,
      youtube_stream_key: FAKE_YT_KEY,
    });
  });

  it('produces a response envelope with exactly config_version, generated_at, assignments (4)', () => {
    const resp = toMediaAgentAssignmentsResponseWire({
      configVersion: '42',
      generatedAt: '2026-01-01T00:00:00Z',
      assignments: [makeSource()],
    });

    expect(Object.keys(resp).sort()).toEqual(EXPECTED_ENVELOPE_KEYS);
    expect([...MEDIA_AGENT_ASSIGNMENTS_RESPONSE_KEYS].sort()).toEqual(EXPECTED_ENVELOPE_KEYS);
    expect(Array.isArray(resp.assignments)).toBe(true);
    expect(resp.assignments).toHaveLength(1);
    // Nested assignments carry exactly the wire key set too.
    expect(Object.keys(resp.assignments[0]).sort()).toEqual(EXPECTED_WIRE_KEYS);
  });

  it('preserves config_version as an opaque string — no parsing or normalization (5)', () => {
    const opaque = 'etag/"v-00123-xYz"';
    const wire = toMediaAgentAssignmentWire(makeSource({ configVersion: opaque }));
    expect(wire.config_version).toBe(opaque);

    const resp = toMediaAgentAssignmentsResponseWire({
      configVersion: opaque,
      generatedAt: '2026-01-01T00:00:00Z',
      assignments: [],
    });
    expect(resp.config_version).toBe(opaque);
    expect(resp.assignments).toEqual([]);
  });

  it('preserves enabled and youtube_enabled with no invented defaults (6)', () => {
    const wireOff = toMediaAgentAssignmentWire(
      makeSource({
        enabled: false,
        youtubeEnabled: false,
        // YouTube disabled → empty strings on the wire (Go emits "" not
        // null/omitted, since the structs carry no omitempty).
        youtubeDestinationBaseUrl: '',
        youtubeStreamKey: '',
      }),
    );
    expect(wireOff.enabled).toBe(false);
    expect(wireOff.youtube_enabled).toBe(false);
    expect(wireOff.youtube_destination_base_url).toBe('');
    expect(wireOff.youtube_stream_key).toBe('');

    const wireOn = toMediaAgentAssignmentWire(makeSource({ enabled: true, youtubeEnabled: true }));
    expect(wireOn.enabled).toBe(true);
    expect(wireOn.youtube_enabled).toBe(true);
  });

  it('preserves publish-window and updated_at timestamps exactly (7)', () => {
    const start = '2026-07-15T08:00:00Z';
    const end = '2026-07-15T18:30:00.123456789Z'; // fractional seconds preserved
    const updated = '2026-07-14T23:59:59.5Z';
    const wire = toMediaAgentAssignmentWire(
      makeSource({ publishWindowStartAt: start, publishWindowEndAt: end, updatedAt: updated }),
    );
    expect(wire.publish_window_start_at).toBe(start);
    expect(wire.publish_window_end_at).toBe(end);
    expect(wire.updated_at).toBe(updated);
  });

  it('is deterministic for identical input (8)', () => {
    const source = makeSource();
    expect(toMediaAgentAssignmentWire(source)).toEqual(toMediaAgentAssignmentWire(source));
    expect(JSON.stringify(toMediaAgentAssignmentWire(source))).toBe(
      JSON.stringify(toMediaAgentAssignmentWire(source)),
    );

    const respSource: MediaAgentAssignmentsResponseSource = {
      configVersion: '7',
      generatedAt: '2026-01-01T00:00:00Z',
      assignments: [makeSource(), makeSource({ ingestId: 'ingest-fake-2' })],
    };
    expect(JSON.stringify(toMediaAgentAssignmentsResponseWire(respSource))).toBe(
      JSON.stringify(toMediaAgentAssignmentsResponseWire(respSource)),
    );
  });

  it('emits every wire field as a present, non-null value — Go structs carry no omitempty (11)', () => {
    const wire = toMediaAgentAssignmentWire(makeSource());
    for (const key of MEDIA_AGENT_ASSIGNMENT_WIRE_KEYS) {
      expect(wire).toHaveProperty(key);
      const value = (wire as unknown as Record<string, unknown>)[key];
      expect(value).not.toBeNull();
      expect(value).not.toBeUndefined();
    }
    // The wire contract never uses JSON null anywhere.
    expect(JSON.stringify(wire)).not.toContain('null');
  });

  it('contains no Restreamer or Wasabi concepts anywhere in the contract (12)', () => {
    const wire = toMediaAgentAssignmentWire(makeSource());
    const safe = toBrowserSafeAssignment(makeSource());
    const resp = toMediaAgentAssignmentsResponseWire({
      configVersion: '1',
      generatedAt: '2026-01-01T00:00:00Z',
      assignments: [makeSource()],
    });

    const blob = JSON.stringify({ wire, safe, resp }).toLowerCase();
    for (const banned of ['restreamer', 'wasabi', 'datarhei', 'memfs', 'archive_to_wasabi']) {
      expect(blob).not.toContain(banned);
    }

    const allKeys = [
      ...MEDIA_AGENT_ASSIGNMENT_WIRE_KEYS,
      ...MEDIA_AGENT_ASSIGNMENTS_RESPONSE_KEYS,
      ...BROWSER_SAFE_ASSIGNMENT_KEYS,
    ]
      .join(' ')
      .toLowerCase();
    expect(allKeys).not.toContain('restreamer');
    expect(allKeys).not.toContain('wasabi');
  });
});

describe('Browser-safe redaction boundary', () => {
  it('excludes every secret and internal field, keeping only the safe allowlist (9)', () => {
    const safe = toBrowserSafeAssignment(makeSource());
    const keys = Object.keys(safe);

    // snake_case wire secret/internal names must never appear.
    expect(keys).not.toContain('stream_secret_hash');
    expect(keys).not.toContain('youtube_stream_key');
    expect(keys).not.toContain('youtube_destination_base_url');
    // nor their camelCase source equivalents.
    expect(keys).not.toContain('streamSecretHash');
    expect(keys).not.toContain('youtubeStreamKey');
    expect(keys).not.toContain('youtubeDestinationBaseUrl');

    // Exactly the browser-safe allowlist, no more.
    expect(keys.sort()).toEqual(EXPECTED_BROWSER_SAFE_KEYS);
    expect([...BROWSER_SAFE_ASSIGNMENT_KEYS].sort()).toEqual(EXPECTED_BROWSER_SAFE_KEYS);
  });

  it('never leaks a secret VALUE anywhere in the serialized browser-safe view (9)', () => {
    const serialized = JSON.stringify(toBrowserSafeAssignment(makeSource()));
    expect(serialized).not.toContain(FAKE_SECRET_HASH);
    expect(serialized).not.toContain(FAKE_YT_KEY);
    expect(serialized).not.toContain(FAKE_YT_URL);
  });
});

describe('Adapter purity', () => {
  it('does not mutate its input (10)', () => {
    const source = makeSource();
    const snapshot = deepClone(source);
    toMediaAgentAssignmentWire(source);
    toBrowserSafeAssignment(source);
    expect(source).toEqual(snapshot);

    const respSource: MediaAgentAssignmentsResponseSource = {
      configVersion: '1',
      generatedAt: '2026-01-01T00:00:00Z',
      assignments: [makeSource()],
    };
    const respSnapshot = deepClone(respSource);
    const out = toMediaAgentAssignmentsResponseWire(respSource);
    expect(respSource).toEqual(respSnapshot);
    // Envelope produces a fresh array, not an alias of the input array.
    expect(out.assignments).not.toBe(respSource.assignments);
  });
});

// ── Go<->TypeScript wire-contract parity ──────────────────────────────────
//
// This module's key lists cannot directly import the Go `store.Assignment`/
// `controlplane.AssignmentsResponse` struct tags they're meant to mirror
// (different language, different repo module). Instead, both this file and
// the Go counterpart test
// (services/media-agent/internal/controlplane/wire_contract_test.go) each
// independently assert their own representation against the single shared
// source of truth: packages/contracts/contracts.json's
// mediaAgentAssignmentWire/mediaAgentAssignmentsResponseWire sections. If
// either side's shape drifts from that file, that side's own test fails —
// this replaces the previous same-repo, self-referential assertion (this
// file only checking itself against its own docblock's claims about the Go
// side) with a real, independently-verifiable shared fixture.
describe('Go<->TypeScript wire-contract parity (via packages/contracts/contracts.json)', () => {
  function loadWireContractKeys(): {
    mediaAgentAssignmentWire: { keys: string[] };
    mediaAgentAssignmentsResponseWire: { keys: string[] };
  } {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const contractsPath = path.join(
      here,
      '../../../livestream-infra/packages/contracts/contracts.json',
    );
    return JSON.parse(readFileSync(contractsPath, 'utf8'));
  }

  it('MEDIA_AGENT_ASSIGNMENT_WIRE_KEYS matches contracts.json mediaAgentAssignmentWire.keys exactly, in order', () => {
    const { mediaAgentAssignmentWire } = loadWireContractKeys();
    expect(MEDIA_AGENT_ASSIGNMENT_WIRE_KEYS).toEqual(mediaAgentAssignmentWire.keys);
  });

  it('MEDIA_AGENT_ASSIGNMENTS_RESPONSE_KEYS matches contracts.json mediaAgentAssignmentsResponseWire.keys exactly, in order', () => {
    const { mediaAgentAssignmentsResponseWire } = loadWireContractKeys();
    expect(MEDIA_AGENT_ASSIGNMENTS_RESPONSE_KEYS).toEqual(mediaAgentAssignmentsResponseWire.keys);
  });
});
