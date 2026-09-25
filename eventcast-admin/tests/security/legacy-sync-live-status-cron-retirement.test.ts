import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Legacy platform-channel YouTube cron retirement (2026-09-25). The 48
 * legacy YouTube broadcasts are the broader historical population; the
 * cron's own remaining relevant subset was the stale historical `upcoming`
 * rows it never successfully transitioned. All of them have `event_date`
 * already in the past (latest 2026-09-06); no current or upcoming EventCast
 * event depended on this cron. It was the last active production code path
 * reading the legacy platform-owned Google OAuth credential
 * (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REFRESH_TOKEN`) —
 * `GOOGLE_CLIENT_ID` is a non-secret public identifier, but
 * `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN` must now be treated as
 * compromised credential material (see `docs/project-state/WORKLOG.md`,
 * finding S1). These tests pin the retirement: the route is gone, the
 * schedule/job are gone from the workflow, no active application file still
 * references the three legacy env names, and the unrelated
 * `event-lifecycle-sweep` job's schedule/job-key/critical `if` condition are
 * still present — the definitive proof that its body was not modified is a
 * `git diff` review of this change, not a byte-for-byte fixture comparison
 * (a fixture would itself need updating on every future legitimate edit to
 * that job).
 */

const eventcastAdminRoot = path.resolve(__dirname, '..', '..');
const repoRoot = path.resolve(eventcastAdminRoot, '..');
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'cron-jobs.yml');
const retiredRoutePath = path.join(
  eventcastAdminRoot,
  'src',
  'app',
  'api',
  'cron',
  'sync-live-status',
  'route.ts',
);

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('Legacy sync-live-status cron retirement', () => {
  it('the retired route file no longer exists', () => {
    expect(existsSync(retiredRoutePath)).toBe(false);
  });

  it('no source file still calls /api/cron/sync-live-status', () => {
    const offenders = listSourceFiles(path.join(eventcastAdminRoot, 'src')).filter((file) =>
      /['"`]\/api\/cron\/sync-live-status['"`?]/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('no active application source file references the legacy platform Google OAuth env names', () => {
    const pattern = /\bGOOGLE_CLIENT_ID\b|\bGOOGLE_CLIENT_SECRET\b|\bGOOGLE_REFRESH_TOKEN\b/;
    const offenders = listSourceFiles(path.join(eventcastAdminRoot, 'src')).filter((file) =>
      pattern.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  describe('.github/workflows/cron-jobs.yml', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    it('no longer has the sync-live-status 15-minute schedule entry', () => {
      expect(workflow).not.toMatch(/\*\/15 \* \* \* \*/);
    });

    it('no longer has a sync-live-status job key', () => {
      expect(workflow).not.toMatch(/^\s*sync-live-status:/m);
    });

    it('no longer actively calls the retired endpoint (a non-comment mention is allowed — the header explains the retirement)', () => {
      const activeLines = workflow
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'));
      expect(activeLines.join('\n')).not.toMatch(/\/api\/cron\/sync-live-status/);
    });

    it('still has the unrelated event-lifecycle-sweep daily schedule', () => {
      expect(workflow).toMatch(/-\s*cron:\s*'0 3 \* \* \*'/);
    });

    it('still has the event-lifecycle-sweep job key', () => {
      expect(workflow).toMatch(/^\s*event-lifecycle-sweep:/m);
    });

    it('still has event-lifecycle-sweep\'s critical if-condition, unmodified', () => {
      expect(workflow).toMatch(
        /\(github\.event_name == 'workflow_dispatch' && \(github\.event\.inputs\.job == 'event-lifecycle-sweep' \|\| github\.event\.inputs\.job == 'both'\)\) \|\|\s*\n\s*\(github\.event_name == 'schedule' && github\.event\.schedule == '0 3 \* \* \*'\)/,
      );
    });

    it('still calls the event-lifecycle-sweep endpoint', () => {
      expect(workflow).toMatch(/\/api\/cron\/event-lifecycle-sweep/);
    });
  });
});
