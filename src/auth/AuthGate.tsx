import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Github, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { liveblocksAuthMode } from '@/store/client';
import { AuthContext, type AuthStatus } from './AuthContext';
import './auth.css';

interface AuthGateProps { children: ReactNode }
interface SessionResponse { authenticated?: boolean; login?: string; userId?: string }

export default function AuthGate({ children }: AuthGateProps) {
  const enabled = liveblocksAuthMode === 'authenticated';
  const [status, setStatus] = useState<AuthStatus>(enabled ? 'loading' : 'authenticated');
  const [login, setLogin] = useState<string>();
  const [userId, setUserId] = useState<string>();

  const checkSession = useCallback(async () => {
    if (!enabled) return;
    setStatus('loading');
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
      const body = await response.json() as SessionResponse;
      if (response.ok && body.authenticated) {
        setLogin(body.login);
        setUserId(body.userId);
        setStatus('authenticated');
      } else {
        setLogin(undefined);
        setUserId(undefined);
        setStatus('unauthenticated');
      }
    } catch {
      setStatus('error');
    }
  }, [enabled]);

  useEffect(() => { void checkSession(); }, [checkSession]);

  const logout = useCallback(async () => {
    if (!enabled) return;
    const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok) throw new Error('退出登录失败');
    setLogin(undefined);
    setUserId(undefined);
    setStatus('unauthenticated');
  }, [enabled]);

  const context = useMemo(() => ({ enabled, login, userId, logout, retry: checkSession, status }), [checkSession, enabled, login, logout, status, userId]);

  if (status === 'authenticated') return <AuthContext.Provider value={context}>{children}</AuthContext.Provider>;

  const authFailed = new URLSearchParams(window.location.search).get('auth') === 'error';
  return (
    <AuthContext.Provider value={context}>
      <main className="auth-page">
        <section className="auth-card" aria-live="polite">
          <div className="auth-logo"><ShieldCheck size={28} /></div>
          <h1>SmartLine</h1>
          {status === 'loading' && <><LoaderCircle className="auth-spin" /><p>正在验证登录状态…</p></>}
          {status === 'unauthenticated' && <>
            <p>{authFailed ? 'GitHub 登录未完成或账号不在允许名单中。' : '登录后才能进入你的学习工作台。'}</p>
            <a className="auth-primary" href="/api/auth/github/start"><Github size={19} />使用 GitHub 登录</a>
            <small>登录只用于确认身份，不会修改或迁移现有学习数据。</small>
          </>}
          {status === 'error' && <>
            <p>暂时无法验证登录状态，请检查网络后重试。</p>
            <button className="auth-primary" type="button" onClick={() => void checkSession()}><RefreshCw size={18} />重新检查</button>
          </>}
        </section>
      </main>
    </AuthContext.Provider>
  );
}
