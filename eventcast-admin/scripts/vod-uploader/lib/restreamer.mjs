const RESTREAMER_URL = (process.env.RESTREAMER_URL || 'https://media.eventcast.pro').replace(/\/$/, '');

let cachedToken = null;
let tokenExpiresAt = 0;

export async function getRestreamerToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const res = await fetch(`${RESTREAMER_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.RESTREAMER_USERNAME,
      password: process.env.RESTREAMER_PASSWORD,
    }),
  });

  if (!res.ok) throw new Error(`Restreamer login failed: ${res.status}`);
  const data = await res.json();
  cachedToken = `Bearer ${data.access_token}`;
  tokenExpiresAt = Date.now() + 50 * 60 * 1000;
  return cachedToken;
}

export async function listProcesses() {
  const token = await getRestreamerToken();
  const res = await fetch(`${RESTREAMER_URL}/api/v3/process`, {
    headers: { Authorization: token },
  });
  if (!res.ok) throw new Error(`listProcesses failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function listDiskDir(relativePath) {
  const token = await getRestreamerToken();
  const encoded = encodeURIComponent(relativePath);
  const res = await fetch(`${RESTREAMER_URL}/api/v3/fs/disk/${encoded}`, {
    headers: { Authorization: token },
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`listDiskDir ${relativePath}: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export async function downloadDiskFile(relativePath) {
  const token = await getRestreamerToken();
  const encoded = encodeURIComponent(relativePath);
  const res = await fetch(`${RESTREAMER_URL}/api/v3/fs/disk/${encoded}`, {
    headers: { Authorization: token },
  });
  if (!res.ok) throw new Error(`download ${relativePath}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function deleteDiskFile(relativePath) {
  const token = await getRestreamerToken();
  const encoded = encodeURIComponent(relativePath);
  const res = await fetch(`${RESTREAMER_URL}/api/v3/fs/disk/${encoded}`, {
    method: 'DELETE',
    headers: { Authorization: token },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`delete ${relativePath}: ${res.status}`);
  }
  return true;
}

export function archiveDir(slug) {
  return `recordings/${slug}`;
}
