import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, setUnauthorizedHandler } from './api';
import { clearSession, loadSession, type Session } from './auth';
import { hasChosenLang, useI18n } from './i18n';

interface SessionContext {
  session: Session | null;
  start: (session: Session) => void;
  signOut: () => void;
}

const Ctx = createContext<SessionContext | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession);
  const { setLang } = useI18n();

  const signOut = useCallback(() => {
    clearSession();
    setSession(null);
  }, []);

  useEffect(() => setUnauthorizedHandler(signOut), [signOut]);

  const start = useCallback(
    (next: Session) => {
      setSession(next);
      // Use the language saved on the profile unless this device already chose one.
      if (!hasChosenLang()) {
        api
          .me()
          .then((p) => p.lang && setLang(p.lang))
          .catch(() => undefined);
      }
    },
    [setLang],
  );

  const value = useMemo(() => ({ session, start, signOut }), [session, start, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}
