import type { Role } from '@cleanloop/shared';
import { ZodError, type z } from 'zod';
import type { AuthUser } from '../domain/common';
import { HttpError, badRequest } from '../domain/common';
import type { AppContext } from '../services/types';

export interface ApiRequest {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  body: unknown;
  user?: AuthUser;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

export interface RouteRequest extends ApiRequest {
  params: Record<string, string>;
  user: AuthUser;
}

type Handler = (req: RouteRequest, ctx: AppContext) => Promise<unknown>;

interface RouteDef {
  method: string;
  pattern: RegExp;
  keys: string[];
  roles: Role[] | 'public';
  handler: Handler;
  status: number;
}

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path
    .split('/')
    .map((part) => {
      if (part.startsWith(':')) {
        keys.push(part.slice(1));
        return '([^/]+)';
      }
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { pattern: new RegExp(`^${source}/?$`), keys };
}

export class Router {
  private routes: RouteDef[] = [];

  add(
    method: string,
    path: string,
    roles: Role[] | 'public',
    handler: Handler,
    status = 200,
  ): this {
    this.routes.push({ method, ...compile(path), roles, handler, status });
    return this;
  }

  async handle(req: ApiRequest, ctx: AppContext): Promise<ApiResponse> {
    try {
      const pathMatches = this.routes.filter((r) => r.pattern.test(req.path));
      if (!pathMatches.length) {
        throw new HttpError(404, 'not_found', `No route for ${req.method} ${req.path}`);
      }
      const route = pathMatches.find((r) => r.method === req.method);
      if (!route) throw new HttpError(405, 'method_not_allowed', `${req.method} not allowed`);

      if (route.roles !== 'public') {
        if (!req.user) throw new HttpError(401, 'unauthorized', 'Please sign in');
        if (!route.roles.includes(req.user.role)) {
          throw new HttpError(
            403,
            'forbidden',
            `Only ${route.roles.join(' or ')} accounts can do this`,
          );
        }
      }
      const match = route.pattern.exec(req.path)!;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(match[i + 1]!)));
      const body = await route.handler(
        { ...req, params, user: req.user ?? { userId: 'anonymous', role: 'resident' } },
        ctx,
      );
      return { status: route.status, body: body ?? { ok: true } };
    } catch (err) {
      return toErrorResponse(err, ctx);
    }
  }
}

export function toErrorResponse(err: unknown, ctx: AppContext): ApiResponse {
  if (err instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: 'validation_failed',
        message: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
        details: err.issues,
      },
    };
  }
  if (err instanceof HttpError) {
    return {
      status: err.status,
      body: { error: err.code, message: err.message, details: err.details },
    };
  }
  ctx.log.error('unhandled error', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  return {
    status: 500,
    body: { error: 'internal', message: 'Something went wrong. Please try again.' },
  };
}

export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  if (value === undefined || value === null) value = {};
  if (typeof value !== 'object') throw badRequest('Expected a JSON body');
  return schema.parse(value);
}
