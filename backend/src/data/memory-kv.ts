import type { IndexName, Item, KvStore, PutOptions, QueryOptions, UpdateOptions } from './kv';
import { ConditionFailedError } from './kv';

export type ChangeListener = (before: Item | undefined, after: Item | undefined) => void;

const keyOf = (pk: string, sk: string) => `${pk}\u0000${sk}`;
const clone = <T>(v: T): T => structuredClone(v);

function matches(sk: unknown, opts: QueryOptions): boolean {
  if (typeof sk !== 'string') return false;
  if (opts.skPrefix !== undefined && !sk.startsWith(opts.skPrefix)) return false;
  if (opts.skFrom !== undefined && sk < opts.skFrom) return false;
  if (opts.skTo !== undefined && sk > opts.skTo) return false;
  return true;
}

function finish<T>(items: Item[], skAttr: string, opts: QueryOptions): T[] {
  const sorted = items.sort((a, b) => String(a[skAttr]).localeCompare(String(b[skAttr])));
  if (opts.reverse) sorted.reverse();
  const limited = opts.limit ? sorted.slice(0, opts.limit) : sorted;
  return limited.map((i) => clone(i)) as unknown as T[];
}

/** In-memory single table with DynamoDB-like semantics and a change feed (like Streams). */
export class MemoryKv implements KvStore {
  private items = new Map<string, Item>();
  private listeners: ChangeListener[] = [];

  onChange(listener: ChangeListener): void {
    this.listeners.push(listener);
  }

  private emit(before: Item | undefined, after: Item | undefined) {
    for (const l of this.listeners) l(before && clone(before), after && clone(after));
  }

  async get<T = Item>(pk: string, sk: string): Promise<T | undefined> {
    const item = this.items.get(keyOf(pk, sk));
    return item ? (clone(item) as unknown as T) : undefined;
  }

  async put(item: Item, opts?: PutOptions): Promise<void> {
    const k = keyOf(item.pk, item.sk);
    const before = this.items.get(k);
    if (opts?.ifNotExists && before) {
      const allowed =
        opts.orIfEquals && Object.entries(opts.orIfEquals).every(([a, v]) => before[a] === v);
      if (!allowed) throw new ConditionFailedError();
    }
    const stored = clone(item);
    this.items.set(k, stored);
    this.emit(before, stored);
  }

  async update<T = Item>(
    pk: string,
    sk: string,
    patch: Record<string, unknown>,
    opts?: UpdateOptions,
  ): Promise<T> {
    const k = keyOf(pk, sk);
    const before = this.items.get(k);
    if (!before) throw new ConditionFailedError('Item does not exist');
    for (const [attr, value] of Object.entries(opts?.expect ?? {})) {
      if (before[attr] !== value)
        throw new ConditionFailedError(`Expected ${attr}=${String(value)}`);
    }
    const after: Item = { ...clone(before) };
    for (const [attr, value] of Object.entries(patch)) {
      if (value !== undefined) after[attr] = clone(value);
    }
    for (const attr of opts?.remove ?? []) delete after[attr];
    this.items.set(k, after);
    this.emit(before, after);
    return clone(after) as unknown as T;
  }

  async delete(pk: string, sk: string): Promise<void> {
    const k = keyOf(pk, sk);
    const before = this.items.get(k);
    this.items.delete(k);
    if (before) this.emit(before, undefined);
  }

  async query<T = Item>(pk: string, opts: QueryOptions = {}): Promise<T[]> {
    const found = [...this.items.values()].filter((i) => i.pk === pk && matches(i.sk, opts));
    return finish<T>(found, 'sk', opts);
  }

  async queryIndex<T = Item>(index: IndexName, pk: string, opts: QueryOptions = {}): Promise<T[]> {
    const pkAttr = `${index}pk`;
    const skAttr = `${index}sk`;
    const found = [...this.items.values()].filter(
      (i) => i[pkAttr] === pk && matches(i[skAttr], opts),
    );
    return finish<T>(found, skAttr, opts);
  }

  async batchPut(items: Item[]): Promise<void> {
    for (const item of items) await this.put(item);
  }

  /** Test helper. */
  size(): number {
    return this.items.size;
  }
}
