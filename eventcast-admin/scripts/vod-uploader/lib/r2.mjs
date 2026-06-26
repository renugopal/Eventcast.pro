import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';

export function loadConfig() {
  const required = [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
  ];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing env: ${key}`);
  }

  const bucket = process.env.R2_BUCKET_NAME || process.env.R2_BUCKET || 'eventcast-media';
  const publicBase =
    process.env.R2_PUBLIC_URL ||
    process.env.R2_PUBLIC_DOMAIN ||
    process.env.VOD_PUBLIC_URL;

  if (!publicBase) {
    console.warn('Warning: R2_PUBLIC_URL not set — finalize-vod will not produce a public URL');
  }

  return {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket,
    publicBase: publicBase?.replace(/\/$/, '') || '',
    endpoint:
      process.env.R2_S3_ENDPOINT ||
      `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  };
}

export function createS3Client(cfg) {
  return new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

export function vodObjectKey(slug, fileName) {
  return `events/${slug}/vod/${fileName}`;
}

export function vodPublicUrl(cfg, slug) {
  if (!cfg.publicBase) return '';
  return `${cfg.publicBase}/events/${slug}/vod/index.m3u8`;
}

export function contentType(fileName) {
  if (fileName.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (fileName.endsWith('.ts')) return 'video/mp2t';
  if (fileName.endsWith('.mp4')) return 'video/mp4';
  return 'application/octet-stream';
}

export async function uploadBuffer(s3, bucket, key, body, fileName) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType(fileName),
    }),
  );
}

/** Verify object exists and size matches (upload-then-delete safety). */
export async function verifyUploaded(s3, bucket, key, expectedSize) {
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const size = Number(head.ContentLength ?? -1);
  return size === expectedSize;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
