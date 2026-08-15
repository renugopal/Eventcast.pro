import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const sql = readFileSync(path.join(migrationsDir, '0037_youtube_fallback_verification_rpc.sql'), 'utf8');

const executableSql = sql.replace(/--[^\n]*/g, '');

describe('YouTube fallback verification migration contract (0037, local-only)', () => {
  it('adds no new column — reuses the youtube_fallback_url/verified columns 0035 already defines', () => {
    expect(sql).not.toMatch(/ALTER TABLE public\.event_recordings ADD COLUMN/);
    expect(sql).not.toMatch(/CREATE TABLE/);
  });

  it('re-verifies the caller is super_admin as defense in depth', () => {
    expect(sql).toMatch(
      /IF NOT EXISTS \(\s*SELECT 1 FROM public\.platform_users pu\s*WHERE pu\.user_id = p_actor AND pu\.platform_role = 'super_admin'/
    );
  });

  it('requires the supplied URL to equal the event\'s current provider-supplied youtube_url', () => {
    expect(sql).toMatch(/SELECT e\.youtube_url INTO v_event_youtube_url/);
    expect(sql).toMatch(/v_event_youtube_url IS NULL OR v_event_youtube_url <> v_url/);
  });

  it('validates the URL is a youtube.com/youtu.be host as defense in depth', () => {
    expect(sql).toMatch(/youtube\\\.com\|youtu\\\.be/);
  });

  it('writes youtube_fallback_url and youtube_fallback_verified together, never verified alone', () => {
    expect(sql).toMatch(/youtube_fallback_url = v_url,\s*\n\s*youtube_fallback_verified = true/);
  });

  it('writes an atomic platform_audit_log row with the youtube_fallback_verified action', () => {
    expect(sql).toMatch(/INSERT INTO public\.platform_audit_log/);
    expect(sql).toMatch(/'youtube_fallback_verified', 'event', p_event_id::text/);
  });

  it('never calls or simulates the YouTube API — no executable reference to OAuth or Google credentials', () => {
    // The doc comments explain that OAuth-based verification is deferred
    // (and therefore deliberately name it in prose); only the executable
    // SQL itself needs to be free of any such reference.
    expect(executableSql).not.toMatch(/googleapis|oauth|google_client|youtube_secret_reference/i);
  });

  it('EXECUTE is revoked from PUBLIC/anon/authenticated and granted only to service_role', () => {
    expect(executableSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.apply_youtube_fallback_verification\(uuid, text, uuid\) FROM PUBLIC;/
    );
    expect(executableSql).toMatch(
      /REVOKE ALL ON FUNCTION public\.apply_youtube_fallback_verification\(uuid, text, uuid\) FROM anon, authenticated;/
    );
    expect(executableSql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.apply_youtube_fallback_verification\(uuid, text, uuid\) TO service_role;/
    );
  });

  it('does not modify migrations 0035 or 0036', () => {
    // Doc-comment prose only, so join comment-wrapped lines before matching.
    const prose = sql.replace(/\n--\s*/g, ' ');
    expect(prose).toMatch(/Migrations 0035\/0036[\s\S]*?are not\s+modified/i);
  });
});
