import type { Role } from '@cleanloop/shared';
import { ROLES } from '@cleanloop/shared';
import type { AuthUser } from '../domain/common';

/**
 * Local auth: the frontend's demo login sends "Bearer local.<base64url JSON>".
 * Only this dev server accepts it; in AWS, Cognito JWTs are verified by API Gateway.
 */
export function userFromLocalToken(header: string | undefined): AuthUser | undefined {
  const token = header?.replace(/^Bearer\s+/i, '');
  if (!token?.startsWith('local.')) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(token.slice(6), 'base64url').toString('utf8')) as {
      sub?: string;
      role?: string;
      name?: string;
      email?: string;
    };
    if (!claims.sub || !ROLES.includes(claims.role as Role)) return undefined;
    return {
      userId: claims.sub,
      role: claims.role as Role,
      name: claims.name,
      email: claims.email,
    };
  } catch {
    return undefined;
  }
}
