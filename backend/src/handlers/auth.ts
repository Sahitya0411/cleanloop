import type { Role } from '@cleanloop/shared';
import type { AuthUser } from '../domain/common';

type Claims = Record<string, string | number | boolean | string[]>;

// Most-privileged group wins if a user is somehow in several.
const ROLE_PRIORITY: Role[] = ['officer', 'driver', 'recycler', 'resident'];

/** API Gateway serialises array claims as "[a b]" (or "[a, b]"); accept every shape. */
export function parseGroups(value: Claims[string] | undefined): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string') return [];
  return value
    .replace(/^\[|\]$/g, '')
    .split(/[\s,]+/)
    .map((g) => g.trim())
    .filter(Boolean);
}

/** Cognito ID-token claims (already verified by the API Gateway JWT authorizer). */
export function userFromClaims(claims: Claims | undefined): AuthUser | undefined {
  if (!claims || typeof claims.sub !== 'string') return undefined;
  const groups = parseGroups(claims['cognito:groups']);
  const role = ROLE_PRIORITY.find((r) => groups.includes(r)) ?? 'resident';
  const str = (k: string) => (typeof claims[k] === 'string' ? (claims[k] as string) : undefined);
  return {
    userId: claims.sub,
    role,
    email: str('email'),
    name: str('name'),
    phone: str('phone_number'),
  };
}
