import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { liveblocksAuthMode } from './config';
import { AuthContext, type AuthStatus } from './AuthContext';
import './auth.css';

interface AuthGateProps { children: ReactNode }
interface SessionResponse { authenticated?: boolean; login?: string; userId?: string }
interface CachedSession extends SessionResponse { cachedAt: number }
const AUTH_SESSION_CACHE_KEY = 'smartline-auth-session-v1';
const AUTH_SESSION_CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const AUTH_SESSION_TIMEOUT_MS = 5000;

function readCachedSession(): SessionResponse | null {
  try {
    const cached = JSON.parse(localStorage.getItem(AUTH_SESSION_CACHE_KEY) ?? 'null') as CachedSession | null;
    if (
      !cached?.authenticated
      || !cached.userId
      || !Number.isFinite(cached.cachedAt)
      || Date.now() - cached.cachedAt > AUTH_SESSION_CACHE_MAX_AGE
    ) {
      localStorage.removeItem(AUTH_SESSION_CACHE_KEY);
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

function writeCachedSession(session: SessionResponse | null) {
  try {
    if (session) {
      localStorage.setItem(AUTH_SESSION_CACHE_KEY, JSON.stringify({ ...session, cachedAt: Date.now() }));
    }
    else localStorage.removeItem(AUTH_SESSION_CACHE_KEY);
  } catch {
    // Authentication still works when storage is unavailable.
  }
}

function BrandIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" width="30" height="30">
      <rect x="6" y="7" width="36" height="34" rx="9" fill="currentColor" opacity=".14" />
      <path d="M15 29.5V20a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="m17 27 5-5 4 4 5-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13 33h22" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function LoadingIndicator() {
  return <span className="auth-spin" aria-hidden="true" />;
}

export default function AuthGate({ children }: AuthGateProps) {
  const enabled = liveblocksAuthMode === 'authenticated';
  const [status, setStatus] = useState<AuthStatus>(enabled ? 'loading' : 'authenticated');
  const [login, setLogin] = useState<string>();
  const [userId, setUserId] = useState<string>();
  const [usingCachedSession, setUsingCachedSession] = useState(false);
  const sessionRequestIdRef = useRef(0);
  const sessionControllerRef = useRef<AbortController | null>(null);

  const checkSession = useCallback(async () => {
    if (!enabled) return;
    sessionControllerRef.current?.abort();
    const requestId = ++sessionRequestIdRef.current;
    setStatus('loading');
    const controller = new AbortController();
    sessionControllerRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), AUTH_SESSION_TIMEOUT_MS);
    try {
      const response = await fetch('/api/auth/session', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
      });
      const body = await response.json() as SessionResponse;
      if (requestId !== sessionRequestIdRef.current) return;
      if (response.ok && body.authenticated && body.userId) {
        setLogin(body.login);
        setUserId(body.userId);
        writeCachedSession({ authenticated: true, login: body.login, userId: body.userId });
        setUsingCachedSession(false);
        setStatus('authenticated');
      } else if (response.status === 401 || response.status === 403 || (response.ok && !body.authenticated)) {
        setLogin(undefined);
        setUserId(undefined);
        writeCachedSession(null);
        setUsingCachedSession(false);
        setStatus('unauthenticated');
      } else {
        setUsingCachedSession(false);
        setStatus('error');
      }
    } catch (error) {
      if (requestId !== sessionRequestIdRef.current) return;
      const unavailable = error instanceof TypeError
        || (error instanceof DOMException && error.name === 'AbortError');
      const cached = unavailable ? readCachedSession() : null;
      if (unavailable && cached) {
        setLogin(cached.login);
        setUserId(cached.userId);
        setUsingCachedSession(true);
        setStatus('authenticated');
      } else {
        setUsingCachedSession(false);
        setStatus('error');
      }
    } finally {
      window.clearTimeout(timeout);
      if (sessionControllerRef.current === controller) sessionControllerRef.current = null;
    }
  }, [enabled]);

  useEffect(() => { void checkSession(); }, [checkSession]);
  useEffect(() => () => sessionControllerRef.current?.abort(), []);
  useEffect(() => {
    if (!enabled) return;
    const revalidate = () => { void checkSession(); };
    window.addEventListener('online', revalidate);
    return () => window.removeEventListener('online', revalidate);
  }, [checkSession, enabled]);

  const logout = useCallback(async () => {
    if (!enabled) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), AUTH_SESSION_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
        signal: controller.signal,
      });
    } catch (error) {
      throw new Error(error instanceof DOMException && error.name === 'AbortError'
        ? '退出登录超时，请检查网络后重试。'
        : '退出登录失败，请检查网络后重试。');
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) throw new Error('退出登录失败，请稍后重试。');
    sessionControllerRef.current?.abort();
    sessionRequestIdRef.current += 1;
    setLogin(undefined);
    setUserId(undefined);
    setUsingCachedSession(false);
    writeCachedSession(null);
    setStatus('unauthenticated');
  }, [enabled]);

  const context = useMemo(() => ({ enabled, login, userId, logout, retry: checkSession, status }), [checkSession, enabled, login, logout, status, userId]);

  if (status === 'authenticated') {
    return (
      <AuthContext.Provider value={context}>
        {usingCachedSession && (
          <div className="auth-offline-notice" role="status">
            当前为离线模式；联网后会自动重新验证身份并恢复同步。
          </div>
        )}
        {children}
      </AuthContext.Provider>
    );
  }

  const authFailed = new URLSearchParams(window.location.search).get('auth') === 'error';
  return (
    <AuthContext.Provider value={context}>
      <main className="auth-page">
        <section className="auth-card" aria-live="polite">
          <div className="auth-logo"><BrandIcon /></div>
          <h1>SmartLine</h1>
          {status === 'loading' && <><LoadingIndicator /><p>正在验证登录状态…</p></>}
          {status === 'unauthenticated' && <>
            <p>{authFailed ? 'GitHub 登录未完成或账号不在允许名单中。' : '登录后才能进入你的学习工作台。'}</p>
            <a className="auth-primary" href="/api/auth/github/start">使用 GitHub 登录</a>
            <small>登录只用于确认身份，不会修改或迁移现有学习数据。</small>
          </>}
          {status === 'error' && <>
            <p>暂时无法验证登录状态，请检查网络后重试。</p>
            <button className="auth-primary" type="button" onClick={() => void checkSession()}>重新检查</button>
          </>}
        </section>
      </main>
    </AuthContext.Provider>
  );
}
