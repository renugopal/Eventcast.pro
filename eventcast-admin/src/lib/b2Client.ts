import { S3Client } from '@aws-sdk/client-s3';

/**
 * Local B2 client boundary — the clean application boundary that can be
 * implemented without credentials or remote infrastructure mutation.
 *
 * B2 exposes an S3-compatible API, and `@aws-sdk/client-s3` is already an
 * existing repository dependency (used by `scripts/archive-vod-to-r2.ts`
 * and `scripts/vod-uploader/` against R2, which is also S3-compatible) — so
 * no new package is required for this boundary.
 *
 * This module never reads a secret VALUE. `B2Config` names the environment
 * variables it expects; `loadB2ConfigFromEnv()` reads those variable NAMES
 * from `process.env` at call time (never hardcoded, never logged, never
 * returned to a client) and is only ever invoked server-side. No test in
 * this repository exercises a real B2 client — `createB2Client()` is never
 * called against real infrastructure in this pass.
 */
export interface B2Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const B2_ENV_VAR_NAMES = {
  endpoint: 'B2_S3_ENDPOINT',
  region: 'B2_REGION',
  bucket: 'B2_BUCKET_NAME',
  accessKeyId: 'B2_ACCESS_KEY_ID',
  secretAccessKey: 'B2_SECRET_ACCESS_KEY',
} as const;

/**
 * Reads B2 configuration from environment variables by name only. Returns
 * `null` if any required variable is unset — this repository has no B2
 * credentials configured today, so this is expected to return `null` in
 * every current environment. Never throws, never logs a value.
 */
export function loadB2ConfigFromEnv(): B2Config | null {
  const endpoint = process.env[B2_ENV_VAR_NAMES.endpoint];
  const region = process.env[B2_ENV_VAR_NAMES.region];
  const bucket = process.env[B2_ENV_VAR_NAMES.bucket];
  const accessKeyId = process.env[B2_ENV_VAR_NAMES.accessKeyId];
  const secretAccessKey = process.env[B2_ENV_VAR_NAMES.secretAccessKey];

  if (!endpoint || !region || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return { endpoint, region, bucket, accessKeyId, secretAccessKey };
}

/**
 * Constructs an S3-compatible client for B2 from an already-resolved
 * config. Callers are responsible for obtaining `config` (typically via
 * `loadB2ConfigFromEnv()`) — this function never reads `process.env`
 * itself, so it stays trivially testable without environment mutation.
 *
 * Not called anywhere in this pass: no finalization/upload pipeline exists
 * yet, and no B2 credentials are configured in this repository. This is the
 * boundary a future finalization task calls into once real credentials and
 * an upload path are approved.
 */
export function createB2Client(config: B2Config): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}
