import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config')>();
  return { ...actual, config: { ...actual.config, authMode: 'cognito', clientId: 'client-123' } };
});

const { getIdToken, loadSession, saveSession } = await import('./auth');

function expiredSession() {
  saveSession({
    mode: 'cognito',
    idToken: 'old.token.sig',
    refreshToken: 'refresh-abc',
    expiresAt: Date.now() - 1000,
    user: { userId: 'u1', role: 'resident', name: 'Heer' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('token refresh', () => {
  it('keeps the session when the refresh fails because the phone is offline', async () => {
    expiredSession();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await getIdToken()).toBeNull();
    expect(loadSession()?.refreshToken).toBe('refresh-abc');
  });

  it('ends the session when Cognito rejects the refresh token', async () => {
    expiredSession();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            __type: 'NotAuthorizedException',
            message: 'Refresh Token has expired',
          }),
          {
            status: 400,
          },
        ),
      ),
    );
    expect(await getIdToken()).toBeNull();
    expect(loadSession()).toBeNull();
  });
});
