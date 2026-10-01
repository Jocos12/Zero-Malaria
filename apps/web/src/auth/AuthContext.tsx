import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, type AuthUser, type LoginResponse, type PasswordPromptStatus } from '../api/client';
import { isDemoModeEnabled } from './demoMode';
import { normalizeRole, type UserRole } from './roles';

export type { UserRole };
export { isDemoModeEnabled };

const SESSION_KEY = 'zm_session';
const POLICY_KEY = 'zm_password_policy';
const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionPayload = {
  access_token: string;
  refresh_token?: string;
  user: AuthUser;
  offline_until?: number;
};

function normalizeUser(user: AuthUser): AuthUser {
  const status = (user.password_prompt_status ||
    (user.must_change_password ? 'pending' : 'changed')) as PasswordPromptStatus;
  return {
    ...user,
    role: normalizeRole(user.role),
    permissions: user.permissions ?? [],
    must_change_password: user.must_change_password ?? false,
    password_prompt_status: status,
  };
}

function readSession(): SessionPayload | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as SessionPayload;
    if (!navigator.onLine && session.offline_until && Date.now() > session.offline_until) {
      return null;
    }
    if (session.user) {
      session.user = normalizeUser(session.user);
    }
    return session;
  } catch {
    return null;
  }
}

function writeSession(session: SessionPayload | null) {
  if (!session) {
    sessionStorage.removeItem(SESSION_KEY);
    return;
  }
  const payload: SessionPayload = {
    ...session,
    user: normalizeUser(session.user),
    offline_until: session.offline_until ?? Date.now() + OFFLINE_GRACE_MS,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload));
}

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  demoModeEnabled: boolean;
  passwordChangePolicy: 'prompt' | 'enforce';
  login: (username: string, password: string) => Promise<AuthUser>;
  quickDemoLogin?: (role: UserRole) => Promise<AuthUser>;
  logout: () => Promise<void>;
  switchRole: (role: UserRole) => Promise<AuthUser>;
  refreshMe: () => Promise<void>;
  setPasswordPromptStatus: (status: PasswordPromptStatus) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function applyLoginResponse(data: LoginResponse): AuthUser {
  const user = normalizeUser({
    ...data.user,
    password_prompt_status: data.password_prompt_status || data.user.password_prompt_status,
  });
  const prevRefresh = (() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return data.refresh_token;
      return (JSON.parse(raw) as SessionPayload).refresh_token || data.refresh_token;
    } catch {
      return data.refresh_token;
    }
  })();
  const session: SessionPayload = {
    access_token: data.access_token,
    refresh_token: data.refresh_token || prevRefresh,
    user,
    offline_until: Date.now() + OFFLINE_GRACE_MS,
  };
  writeSession(session);
  try {
    const pol = data.password_change_policy === 'enforce' ? 'enforce' : 'prompt';
    sessionStorage.setItem(POLICY_KEY, pol);
  } catch {
    /* ignore */
  }
  return user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => readSession()?.user ?? null);
  const [token, setToken] = useState<string | null>(() => readSession()?.access_token ?? null);
  const [loading, setLoading] = useState(true);
  const [passwordChangePolicy, setPasswordChangePolicy] = useState<'prompt' | 'enforce'>(() => {
    try {
      return sessionStorage.getItem(POLICY_KEY) === 'enforce' ? 'enforce' : 'prompt';
    } catch {
      return 'prompt';
    }
  });

  useEffect(() => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* migrated to sessionStorage */
    }
    const s = readSession();
    if (!s?.access_token) {
      setLoading(false);
      return;
    }
    if (!navigator.onLine) {
      setUser(s.user);
      setToken(s.access_token);
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const me = normalizeUser(await api.me());
        setUser(me);
        writeSession({
          access_token: s.access_token,
          refresh_token: s.refresh_token,
          user: me,
          offline_until: s.offline_until,
        });
        setToken(s.access_token);
      } catch {
        writeSession(null);
        setUser(null);
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.login(username, password);
    const u = applyLoginResponse(data);
    setUser(u);
    setToken(data.access_token);
    setPasswordChangePolicy(data.password_change_policy === 'enforce' ? 'enforce' : 'prompt');
    return u;
  }, []);

  const quickDemoLogin = useCallback(
    async (role: UserRole) => {
      if (!isDemoModeEnabled) {
        throw new Error('Demo login is not enabled in this build');
      }
      const data = await api.demoLogin(role);
      const u = applyLoginResponse(data);
      setUser(u);
      setToken(data.access_token);
      setPasswordChangePolicy(data.password_change_policy === 'enforce' ? 'enforce' : 'prompt');
      return u;
    },
    [],
  );

  const setPasswordPromptStatus = useCallback((status: PasswordPromptStatus) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = normalizeUser({ ...prev, password_prompt_status: status, must_change_password: false });
      const s = readSession();
      if (s?.access_token) {
        writeSession({ access_token: s.access_token, user: next, offline_until: s.offline_until });
      }
      return next;
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      if (navigator.onLine && token) await api.logout();
    } catch {
      /* ignore offline / expired token */
    }
    writeSession(null);
    setUser(null);
    setToken(null);
  }, [token]);

  const switchRole = useCallback(
    async (role: UserRole) => {
      const isDemo = user?.username?.endsWith('.demo') || user?.username === 'health.center' || user?.username === 'super.admin' || user?.username === 'rbc.admin';
      if (!isDemo || !isDemoModeEnabled) {
        throw new Error('Role switch is only available for demo presenter sessions');
      }
      return quickDemoLogin(role);
    },
    [quickDemoLogin, user?.username],
  );

  const refreshMe = useCallback(async () => {
    if (!token) return;
    if (!navigator.onLine) return;
    try {
      const me = normalizeUser(await api.me());
      setUser(me);
      const s = readSession();
      writeSession({ access_token: token, user: me, offline_until: s?.offline_until });
    } catch {
      await logout();
    }
  }, [logout, token]);

  const value = useMemo((): AuthContextValue => {
    const base: AuthContextValue = {
      user,
      token,
      loading,
      demoModeEnabled: isDemoModeEnabled,
      passwordChangePolicy,
      login,
      logout,
      switchRole,
      refreshMe,
      setPasswordPromptStatus,
    };
    if (isDemoModeEnabled) {
      base.quickDemoLogin = quickDemoLogin;
    }
    return base;
  }, [
    user,
    token,
    loading,
    passwordChangePolicy,
    login,
    quickDemoLogin,
    logout,
    switchRole,
    refreshMe,
    setPasswordPromptStatus,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { SESSION_KEY };
