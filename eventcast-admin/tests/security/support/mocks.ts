import { vi } from 'vitest';
import type { Mock } from 'vitest';
import type { NextResponse } from 'next/server';

export type QueryResult = { data?: unknown; error?: unknown };

export interface MockQueryBuilder extends PromiseLike<QueryResult> {
  select: Mock<(columns: string) => MockQueryBuilder>;
  eq: Mock<(column: string, value: unknown) => MockQueryBuilder>;
  neq: Mock<(column: string, value: unknown) => MockQueryBuilder>;
  ilike: Mock<(column: string, value: unknown) => MockQueryBuilder>;
  limit: Mock<(count: number) => MockQueryBuilder>;
  order: Mock<(column: string, opts?: unknown) => MockQueryBuilder>;
  upsert: Mock<(values: unknown) => MockQueryBuilder>;
  insert: Mock<(values: unknown) => MockQueryBuilder>;
  update: Mock<(values: unknown) => MockQueryBuilder>;
  delete: Mock<() => MockQueryBuilder>;
  single: Mock<() => Promise<QueryResult>>;
  maybeSingle: Mock<() => Promise<QueryResult>>;
}

export function makeQueryBuilder(result: QueryResult): MockQueryBuilder {
  const builder: MockQueryBuilder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn(() => builder),
    ilike: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    order: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (onfulfilled, onrejected) => Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return builder;
}

/**
 * Builds a `.from(table)` mock. Every configured response is consumed exactly
 * once, in call order; calling `.from()` for a table with no configured
 * response, or more times than responses were configured for that table,
 * throws immediately instead of silently returning an empty result. Every
 * database call a test expects a route to make must be represented
 * explicitly in `tableResponses`.
 */
export function createFromMock(
  tableResponses: Record<string, QueryResult | QueryResult[]>
): Mock<(table: string) => MockQueryBuilder> {
  const queues = new Map<string, QueryResult[]>();
  for (const [table, value] of Object.entries(tableResponses)) {
    queues.set(table, Array.isArray(value) ? [...value] : [value]);
  }
  return vi.fn((table: string): MockQueryBuilder => {
    const queue = queues.get(table);
    if (!queue) {
      throw new Error(
        `Unexpected call to .from('${table}') — no response was configured for this table.`
      );
    }
    if (queue.length === 0) {
      throw new Error(
        `Unexpected extra call to .from('${table}') — its configured response queue is exhausted.`
      );
    }
    return makeQueryBuilder(queue.shift()!);
  });
}

export interface AuthSuccess {
  userId: string;
  studioId: string;
  studioSlug: string;
  platformRole: 'super_admin' | 'live_streamer' | 'reseller';
  isSuperAdmin: boolean;
}

export type AuthResult = AuthSuccess | NextResponse;

export function authSuccess(overrides: Partial<AuthSuccess> = {}): AuthSuccess {
  return {
    userId: 'user-1',
    studioId: 'studio-a',
    studioSlug: 'studio-a-slug',
    platformRole: 'live_streamer',
    isSuperAdmin: false,
    ...overrides,
  };
}

export interface MockRestreamerInstance {
  setupChannel: Mock<(slug: string, youtubeKey?: string) => Promise<unknown>>;
  restartChannel: Mock<(slug: string) => Promise<boolean>>;
  toggleOutput: Mock<(slug: string, outputId: string, enabled: boolean, outputConfig?: unknown) => Promise<boolean>>;
  deleteChannel: Mock<(slug: string) => Promise<unknown>>;
  deleteChannelFiles: Mock<(slug: string) => Promise<{ deleted: number; errors: number }>>;
}
