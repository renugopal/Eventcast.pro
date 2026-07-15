import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  authenticateMediaAgentRequest,
  parseBearerToken,
  validateMediaAgentAuthStructure,
  verifyMediaNodeCredential,
  type MediaAgentAuthHeaders,
} from '@/lib/media-agent/nodeAuth';

// ── Deterministic, fake test-only fixtures. No production-like secrets. ────
const PEPPER = 'unit-test-pepper-fixture';
const TOKEN_SLOT_1 = 'unit-test-token-slot-1';
const TOKEN_SLOT_2 = 'unit-test-token-slot-2';
const TOKEN_WRONG = 'unit-test-token-wrong';

async function computeDigest(pepper: string, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const NODE_ID = 'gcp-asia-south1-01';
const REQUEST_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'; // exactly 32 lowercase hex
const TIMESTAMP = '2026-07-15T10:00:00.000Z';
const NOW = new Date(TIMESTAMP);
const TOLERANCE_MS = 5 * 60 * 1000; // 5 minutes, matches the design's proposed default

function makeHeaders(overrides: Partial<MediaAgentAuthHeaders> = {}): MediaAgentAuthHeaders {
  return {
    authorization: `Bearer ${TOKEN_SLOT_1}`,
    nodeId: NODE_ID,
    requestId: REQUEST_ID,
    idempotencyKey: REQUEST_ID,
    timestamp: TIMESTAMP,
    ...overrides,
  };
}

// ── Shared, cross-language node-auth header contract fixture ───────────────
// The same testdata/node_auth_header_contract.json the Go control-plane
// client's test suite (client_test.go) reads. It is the single documented
// source of truth for the header-shape contract (required header names,
// request-id/node-id format, idempotency-key equality, timestamp
// tolerance) — this file does not hardcode a second, independent copy of
// those rules; every example below is driven through the real, exported
// `validateMediaAgentAuthStructure` production function. Per the fixture's
// own "scope" field, this proves structural request-shape compatibility
// only — never HMAC credential-digest verification, real pepper handling,
// Supabase-backed behavior, or integration with a real deployed route.
interface NodeAuthFixtureExample {
  name: string;
  description?: string;
  authorization: string | null;
  node_id: string | null;
  request_id: string | null;
  idempotency_key: string | null;
  timestamp_offset_ms: number;
  expect_valid: boolean;
}

interface NodeAuthHeaderContractFixture {
  required_headers: string[];
  structural_rules: {
    timestamp_tolerance_ms: number;
  };
  reference_time: string;
  examples: NodeAuthFixtureExample[];
}

const NODE_AUTH_FIXTURE_PATH = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'livestream-infra',
  'services',
  'media-agent',
  'internal',
  'controlplane',
  'testdata',
  'node_auth_header_contract.json'
);

function loadNodeAuthHeaderContractFixture(): NodeAuthHeaderContractFixture {
  if (!existsSync(NODE_AUTH_FIXTURE_PATH)) {
    throw new Error(
      `shared node-auth header contract fixture not found at ${NODE_AUTH_FIXTURE_PATH}`
    );
  }
  return JSON.parse(readFileSync(NODE_AUTH_FIXTURE_PATH, 'utf8')) as NodeAuthHeaderContractFixture;
}

describe('parseBearerToken', () => {
  it('extracts the token from a well-formed header', () => {
    expect(parseBearerToken('Bearer abc123')).toBe('abc123');
  });

  it('returns null for a missing header', () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
  });

  it('returns null for the wrong auth scheme', () => {
    expect(parseBearerToken('Basic abc123')).toBeNull();
  });

  it('returns null for an empty bearer token', () => {
    expect(parseBearerToken('Bearer ')).toBeNull();
  });
});

describe('validateMediaAgentAuthStructure', () => {
  it('accepts a fully well-formed header set', () => {
    expect(validateMediaAgentAuthStructure(makeHeaders(), NOW, TOLERANCE_MS)).toBe(true);
  });

  it('rejects a missing node ID', () => {
    expect(
      validateMediaAgentAuthStructure(makeHeaders({ nodeId: null }), NOW, TOLERANCE_MS)
    ).toBe(false);
  });

  it('rejects invalid node-ID characters', () => {
    expect(
      validateMediaAgentAuthStructure(makeHeaders({ nodeId: 'bad node!' }), NOW, TOLERANCE_MS)
    ).toBe(false);
  });

  it('rejects a node ID longer than 128 characters', () => {
    expect(
      validateMediaAgentAuthStructure(makeHeaders({ nodeId: 'a'.repeat(129) }), NOW, TOLERANCE_MS)
    ).toBe(false);
  });

  it('accepts a node ID at exactly 128 characters', () => {
    expect(
      validateMediaAgentAuthStructure(makeHeaders({ nodeId: 'a'.repeat(128) }), NOW, TOLERANCE_MS)
    ).toBe(true);
  });

  it('rejects a missing request ID', () => {
    expect(
      validateMediaAgentAuthStructure(
        makeHeaders({ requestId: null, idempotencyKey: null }),
        NOW,
        TOLERANCE_MS
      )
    ).toBe(false);
  });

  it('rejects a request ID that is not exactly 32 lowercase hex characters', () => {
    expect(
      validateMediaAgentAuthStructure(
        makeHeaders({ requestId: 'tooshort', idempotencyKey: 'tooshort' }),
        NOW,
        TOLERANCE_MS
      )
    ).toBe(false);
  });

  it('rejects an uppercase request ID', () => {
    const upper = REQUEST_ID.toUpperCase();
    expect(
      validateMediaAgentAuthStructure(
        makeHeaders({ requestId: upper, idempotencyKey: upper }),
        NOW,
        TOLERANCE_MS
      )
    ).toBe(false);
  });

  it('rejects an idempotency-key mismatch', () => {
    const otherId = 'ffffffffffffffffffffffffffffffff';
    expect(
      validateMediaAgentAuthStructure(
        makeHeaders({ idempotencyKey: otherId }),
        NOW,
        TOLERANCE_MS
      )
    ).toBe(false);
  });

  it('rejects a missing timestamp', () => {
    expect(
      validateMediaAgentAuthStructure(makeHeaders({ timestamp: null }), NOW, TOLERANCE_MS)
    ).toBe(false);
  });

  it('rejects an invalid (unparseable) timestamp', () => {
    expect(
      validateMediaAgentAuthStructure(makeHeaders({ timestamp: 'not-a-date' }), NOW, TOLERANCE_MS)
    ).toBe(false);
  });

  it('rejects an expired (too-far-past) timestamp', () => {
    const past = new Date(NOW.getTime() - TOLERANCE_MS - 1).toISOString();
    expect(
      validateMediaAgentAuthStructure(makeHeaders({ timestamp: past }), NOW, TOLERANCE_MS)
    ).toBe(false);
  });

  it('rejects a future-skewed timestamp', () => {
    const future = new Date(NOW.getTime() + TOLERANCE_MS + 1).toISOString();
    expect(
      validateMediaAgentAuthStructure(makeHeaders({ timestamp: future }), NOW, TOLERANCE_MS)
    ).toBe(false);
  });

  it('accepts a timestamp exactly at both tolerance boundaries', () => {
    const lowerBoundary = new Date(NOW.getTime() - TOLERANCE_MS).toISOString();
    const upperBoundary = new Date(NOW.getTime() + TOLERANCE_MS).toISOString();
    expect(
      validateMediaAgentAuthStructure(makeHeaders({ timestamp: lowerBoundary }), NOW, TOLERANCE_MS)
    ).toBe(true);
    expect(
      validateMediaAgentAuthStructure(makeHeaders({ timestamp: upperBoundary }), NOW, TOLERANCE_MS)
    ).toBe(true);
  });

  it('rejects a missing Authorization header', () => {
    expect(
      validateMediaAgentAuthStructure(makeHeaders({ authorization: null }), NOW, TOLERANCE_MS)
    ).toBe(false);
  });

  it('rejects the wrong auth scheme', () => {
    expect(
      validateMediaAgentAuthStructure(
        makeHeaders({ authorization: `Basic ${TOKEN_SLOT_1}` }),
        NOW,
        TOLERANCE_MS
      )
    ).toBe(false);
  });

  it('rejects an empty bearer token', () => {
    expect(
      validateMediaAgentAuthStructure(makeHeaders({ authorization: 'Bearer ' }), NOW, TOLERANCE_MS)
    ).toBe(false);
  });
});

describe('verifyMediaNodeCredential — fixed two-slot verification', () => {
  it('accepts a valid slot-1 credential', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    expect(await verifyMediaNodeCredential(PEPPER, TOKEN_SLOT_1, digest1, null)).toBe(true);
  });

  it('accepts a valid slot-2 credential', async () => {
    const digest2 = await computeDigest(PEPPER, TOKEN_SLOT_2);
    expect(await verifyMediaNodeCredential(PEPPER, TOKEN_SLOT_2, null, digest2)).toBe(true);
  });

  it('rejects when both slots are missing', async () => {
    expect(await verifyMediaNodeCredential(PEPPER, TOKEN_SLOT_1, null, null)).toBe(false);
  });

  it('rejects the wrong token against real active digests', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const digest2 = await computeDigest(PEPPER, TOKEN_SLOT_2);
    expect(await verifyMediaNodeCredential(PEPPER, TOKEN_WRONG, digest1, digest2)).toBe(false);
  });

  it('handles malformed digest input fail-closed, without throwing', async () => {
    await expect(
      verifyMediaNodeCredential(PEPPER, TOKEN_SLOT_1, 'not-a-valid-hex-digest', null)
    ).resolves.toBe(false);
    await expect(
      verifyMediaNodeCredential(PEPPER, TOKEN_SLOT_1, 'deadbeef', 'zz'.repeat(32))
    ).resolves.toBe(false);
  });

  it('executes both subtle.verify calls when slot 1 succeeds (no early exit)', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const verifySpy = vi.spyOn(crypto.subtle, 'verify');
    try {
      const result = await verifyMediaNodeCredential(PEPPER, TOKEN_SLOT_1, digest1, null);
      expect(result).toBe(true);
      expect(verifySpy).toHaveBeenCalledTimes(2);
    } finally {
      verifySpy.mockRestore();
    }
  });

  it('executes both subtle.verify calls when both slots fail', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const digest2 = await computeDigest(PEPPER, TOKEN_SLOT_2);
    const verifySpy = vi.spyOn(crypto.subtle, 'verify');
    try {
      const result = await verifyMediaNodeCredential(PEPPER, TOKEN_WRONG, digest1, digest2);
      expect(result).toBe(false);
      expect(verifySpy).toHaveBeenCalledTimes(2);
    } finally {
      verifySpy.mockRestore();
    }
  });
});

describe('authenticateMediaAgentRequest — generic collapsed result', () => {
  it('returns { authorized: true } for a fully valid slot-1 request', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);
    const result = await authenticateMediaAgentRequest(
      makeHeaders(),
      NOW,
      TOLERANCE_MS,
      PEPPER,
      digest1,
      null
    );
    expect(result).toEqual({ authorized: true });
  });

  it('collapses every failure category to the identical generic unauthorized result', async () => {
    const digest1 = await computeDigest(PEPPER, TOKEN_SLOT_1);

    const failureCases: MediaAgentAuthHeaders[] = [
      makeHeaders({ authorization: null }), // missing Authorization
      makeHeaders({ authorization: `Basic ${TOKEN_SLOT_1}` }), // wrong scheme
      makeHeaders({ authorization: 'Bearer ' }), // empty bearer token
      makeHeaders({ authorization: `Bearer ${TOKEN_WRONG}` }), // wrong token
      makeHeaders({ nodeId: null }), // missing node id
      makeHeaders({ nodeId: 'bad node!' }), // invalid node-id charset
      makeHeaders({ nodeId: 'a'.repeat(129) }), // node id too long
      makeHeaders({ requestId: null, idempotencyKey: null }), // missing request id
      makeHeaders({ requestId: 'short', idempotencyKey: 'short' }), // malformed request id
      makeHeaders({ requestId: REQUEST_ID.toUpperCase(), idempotencyKey: REQUEST_ID.toUpperCase() }), // uppercase request id
      makeHeaders({ idempotencyKey: 'ffffffffffffffffffffffffffffffff' }), // idempotency mismatch
      makeHeaders({ timestamp: null }), // missing timestamp
      makeHeaders({ timestamp: 'not-a-date' }), // invalid timestamp
      makeHeaders({ timestamp: new Date(NOW.getTime() - TOLERANCE_MS - 1).toISOString() }), // expired
      makeHeaders({ timestamp: new Date(NOW.getTime() + TOLERANCE_MS + 1).toISOString() }), // future-skewed
    ];

    const results = await Promise.all(
      failureCases.map((headers) =>
        authenticateMediaAgentRequest(headers, NOW, TOLERANCE_MS, PEPPER, digest1, null)
      )
    );

    for (const result of results) {
      expect(result).toEqual({ authorized: false });
    }

    // Every failure category is not just false, but structurally identical
    // (same shape, same keys, same value) — no per-category variation.
    const serialized = results.map((r) => JSON.stringify(r));
    expect(new Set(serialized).size).toBe(1);
    expect(serialized[0]).toBe(JSON.stringify({ authorized: false }));
  });

  it('returns the generic unauthorized result when both slots are missing', async () => {
    const result = await authenticateMediaAgentRequest(
      makeHeaders(),
      NOW,
      TOLERANCE_MS,
      PEPPER,
      null,
      null
    );
    expect(result).toEqual({ authorized: false });
  });
});

describe('validateMediaAgentAuthStructure — shared node-auth header contract fixture', () => {
  // This is an independent protocol-conformance check against a fixture
  // also read by the Go control-plane client's own test suite
  // (client_test.go) — not a proof that a real Go Media Agent process and
  // this deployed Admin route interoperate over a real network. See the
  // fixture's own "scope" field.
  const fixture = loadNodeAuthHeaderContractFixture();
  const referenceNow = new Date(fixture.reference_time);

  it('the fixture declares exactly the five required EventCast headers', () => {
    expect([...fixture.required_headers].sort()).toEqual(
      [
        'Authorization',
        'X-EventCast-Idempotency-Key',
        'X-EventCast-Node-Id',
        'X-EventCast-Request-Id',
        'X-EventCast-Timestamp',
      ].sort()
    );
  });

  for (const example of fixture.examples) {
    it(`${example.name} — real validator returns ${example.expect_valid}`, () => {
      const timestamp = new Date(
        referenceNow.getTime() + example.timestamp_offset_ms
      ).toISOString();

      const headers: MediaAgentAuthHeaders = {
        authorization: example.authorization,
        nodeId: example.node_id,
        requestId: example.request_id,
        idempotencyKey: example.idempotency_key,
        timestamp,
      };

      const result = validateMediaAgentAuthStructure(
        headers,
        referenceNow,
        fixture.structural_rules.timestamp_tolerance_ms
      );
      expect(result).toBe(example.expect_valid);
    });
  }
});
