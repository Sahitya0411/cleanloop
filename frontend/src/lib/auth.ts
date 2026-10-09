import type { Role } from '@cleanloop/shared';
import { ROLES } from '@cleanloop/shared';
import { LOCAL_DEMO_USERS, config } from './config';

export interface SessionUser {
  userId: string;
  role: Role;
  name: string;
  email?: string;
}

export interface Session {
  mode: 'local' | 'cognito';
  idToken: string;
  refreshToken?: string;
  /** Epoch ms when the ID token expires. */
  expiresAt: number;
  user: SessionUser;
}

const STORAGE_KEY = 'cleanloop.session';

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private mode: the session lives for this tab only.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function base64UrlDecode(part: string): string {
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) throw new AuthError('BadToken', 'Invalid token');
  return JSON.parse(base64UrlDecode(payload)) as Record<string, unknown>;
}

const ROLE_PRIORITY: Role[] = ['officer', 'driver', 'recycler', 'resident'];

export function userFromIdToken(idToken: string): SessionUser {
  const claims = decodeJwt(idToken);
  const groups = Array.isArray(claims['cognito:groups'])
    ? (claims['cognito:groups'] as string[])
    : [];
  const role = ROLE_PRIORITY.find((r) => groups.includes(r)) ?? 'resident';
  const email = typeof claims.email === 'string' ? claims.email : undefined;
  return {
    userId: String(claims.sub),
    role,
    name: typeof claims.name === 'string' ? claims.name : (email?.split('@')[0] ?? 'Friend'),
    email,
  };
}

// ---- Local demo mode ---------------------------------------------------------

function base64UrlEncode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function signInLocal(role: Role): Session {
  if (!ROLES.includes(role)) throw new AuthError('BadRole', 'Unknown role');
  const demo = LOCAL_DEMO_USERS[role];
  const token = `local.${base64UrlEncode(JSON.stringify({ sub: demo.userId, role, name: demo.name, email: demo.email }))}`;
  const session: Session = {
    mode: 'local',
    idToken: token,
    expiresAt: Date.now() + 365 * 86_400_000,
    user: { userId: demo.userId, role, name: demo.name, email: demo.email },
  };
  saveSession(session);
  return session;
}

// ---- Amazon Cognito (direct calls to the public user-pool API) -----------------

const FRIENDLY: Record<string, string> = {
  NotAuthorizedException: 'Wrong email or password.',
  UserNotFoundException: 'Wrong email or password.',
  UserNotConfirmedException: 'Please confirm your email first.',
  UsernameExistsException: 'An account with this email already exists. Try signing in.',
  CodeMismatchException: 'That code is not right. Check the email and try again.',
  ExpiredCodeException: 'That code has expired. Ask for a new one.',
  LimitExceededException: 'Too many attempts. Please wait a few minutes.',
  TooManyRequestsException: 'Too many attempts. Please wait a few minutes.',
  InvalidPasswordException: 'Use at least 8 characters with a number and a lowercase letter.',
};

async function cognito<T>(target: string, body: Record<string, unknown>): Promise<T> {
  if (!config.clientId) throw new AuthError('NotConfigured', 'Sign-in is not configured yet.');
  let res: Response;
  try {
    res = await fetch(`https://cognito-idp.${config.region}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
      },
      body: JSON.stringify({ ClientId: config.clientId, ...body }),
    });
  } catch {
    throw new AuthError('Network', 'No internet connection. Please try again.');
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = String(json.__type ?? 'Error')
      .split('#')
      .pop()!;
    throw new AuthError(code, FRIENDLY[code] ?? String(json.message ?? 'Something went wrong.'));
  }
  return json as T;
}

interface AuthResult {
  AuthenticationResult?: { IdToken: string; RefreshToken?: string; ExpiresIn: number };
  ChallengeName?: string;
}

function sessionFrom(result: AuthResult, refreshToken?: string): Session {
  const auth = result.AuthenticationResult;
  if (!auth) {
    throw new AuthError(
      result.ChallengeName ?? 'Challenge',
      'This account needs a new password. Ask your ward admin to reset it.',
    );
  }
  const session: Session = {
    mode: 'cognito',
    idToken: auth.IdToken,
    refreshToken: auth.RefreshToken ?? refreshToken,
    expiresAt: Date.now() + auth.ExpiresIn * 1000,
    user: userFromIdToken(auth.IdToken),
  };
  saveSession(session);
  return session;
}

export async function signIn(email: string, password: string): Promise<Session> {
  const result = await cognito<AuthResult>('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    AuthParameters: { USERNAME: email.trim().toLowerCase(), PASSWORD: password },
  });
  return sessionFrom(result);
}

/** Cognito wants E.164; accept a bare 10-digit Indian mobile number too. */
export function normalizePhone(raw: string | undefined): string | undefined {
  const digits = raw?.replace(/[\s()-]/g, '') ?? '';
  if (!digits) return undefined;
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^0\d{10}$/.test(digits)) return `+91${digits.slice(1)}`;
  return digits;
}

export async function signUp(input: {
  email: string;
  password: string;
  name: string;
  role: 'resident' | 'recycler';
  phone?: string;
}): Promise<void> {
  const attributes = [
    { Name: 'email', Value: input.email.trim().toLowerCase() },
    { Name: 'name', Value: input.name.trim() },
    { Name: 'custom:role', Value: input.role },
  ];
  const phone = normalizePhone(input.phone);
  if (phone) attributes.push({ Name: 'phone_number', Value: phone });
  await cognito('SignUp', {
    Username: input.email.trim().toLowerCase(),
    Password: input.password,
    UserAttributes: attributes,
  });
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  await cognito('ConfirmSignUp', {
    Username: email.trim().toLowerCase(),
    ConfirmationCode: code.trim(),
  });
}

export async function resendCode(email: string): Promise<void> {
  await cognito('ResendConfirmationCode', { Username: email.trim().toLowerCase() });
}

export async function forgotPassword(email: string): Promise<void> {
  await cognito('ForgotPassword', { Username: email.trim().toLowerCase() });
}

export async function confirmForgotPassword(
  email: string,
  code: string,
  password: string,
): Promise<void> {
  await cognito('ConfirmForgotPassword', {
    Username: email.trim().toLowerCase(),
    ConfirmationCode: code.trim(),
    Password: password,
  });
}

let refreshing: Promise<Session | null> | null = null;

/** Current ID token, refreshed shortly before it expires. */
export async function getIdToken(): Promise<string | null> {
  const session = loadSession();
  if (!session) return null;
  if (session.mode === 'local' || session.expiresAt - Date.now() > 60_000) return session.idToken;
  if (!session.refreshToken) return null;
  refreshing ??= cognito<AuthResult>('InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    AuthParameters: { REFRESH_TOKEN: session.refreshToken },
  })
    .then((r) => sessionFrom(r, session.refreshToken))
    .catch((err) => {
      // Only a rejected refresh token ends the session; being offline must not.
      if (err instanceof AuthError && err.code === 'NotAuthorizedException') clearSession();
      return null;
    })
    .finally(() => {
      refreshing = null;
    });
  return (await refreshing)?.idToken ?? null;
}
