// The handful of single-table operations CleanLoop needs. DynamoKv runs in AWS;
// MemoryKv backs local development and tests with the same semantics.

export type Item = Record<string, unknown> & { pk: string; sk: string };

export type IndexName = 'gsi1' | 'gsi2';

export interface QueryOptions {
  skPrefix?: string;
  /** Inclusive lower bound on the sort key. */
  skFrom?: string;
  /** Inclusive upper bound on the sort key. */
  skTo?: string;
  limit?: number;
  /** Newest/highest sort key first. */
  reverse?: boolean;
}

export interface UpdateOptions {
  /** Every listed attribute must currently hold exactly this value. */
  expect?: Record<string, unknown>;
  /** Attributes to remove. */
  remove?: string[];
}

export interface PutOptions {
  ifNotExists?: boolean;
  orIfEquals?: Record<string, unknown>;
}

export class ConditionFailedError extends Error {
  constructor(message = 'Condition check failed') {
    super(message);
    this.name = 'ConditionFailedError';
  }
}

export interface KvStore {
  get<T = Item>(pk: string, sk: string): Promise<T | undefined>;
  /**
   * With `ifNotExists`, throws ConditionFailedError if the key is taken, unless
   * `orIfEquals` is given and the existing item matches it (insert-or-replace-if).
   */
  put(item: Item, opts?: PutOptions): Promise<void>;
  /** Patches an existing item (throws ConditionFailedError if it does not exist). */
  update<T = Item>(
    pk: string,
    sk: string,
    patch: Record<string, unknown>,
    opts?: UpdateOptions,
  ): Promise<T>;
  delete(pk: string, sk: string): Promise<void>;
  query<T = Item>(pk: string, opts?: QueryOptions): Promise<T[]>;
  queryIndex<T = Item>(index: IndexName, pk: string, opts?: QueryOptions): Promise<T[]>;
  batchPut(items: Item[]): Promise<void>;
}

export const KEY_ATTRIBUTES = [
  'pk',
  'sk',
  'gsi1pk',
  'gsi1sk',
  'gsi2pk',
  'gsi2sk',
  'entity',
  'expiresAt',
] as const;

/** Strips storage keys so only the domain object is returned to callers. */
export function stripKeys<T>(item: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...item };
  for (const k of KEY_ATTRIBUTES) delete out[k];
  return out as T;
}
