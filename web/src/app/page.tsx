'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/providers';

type DemoUser = {
  email: string;
  password: string;
  displayName: string;
  org: string;
  role: string;
};

export default function HomePage() {
  const { user, login, ready } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('owner-a@acme.test');
  const [password, setPassword] = useState('password');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [demoUsers, setDemoUsers] = useState<DemoUser[]>([]);

  useEffect(() => {
    if (ready && user) router.replace('/app');
  }, [ready, user, router]);

  useEffect(() => {
    fetch('/api/auth/login')
      .then((r) => r.json())
      .then((d) => setDemoUsers(d.users || []))
      .catch(() => undefined);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      router.push('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand">
            Chain<span>yard</span>
          </div>
          <p className="muted" style={{ margin: '8px 0 0' }}>
            Build and run company-scoped AI workflows
          </p>
        </div>
      </header>

      <section
        className="grid-2"
        style={{ alignItems: 'stretch', minHeight: '70vh' }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            animation: 'rise 0.7s ease both',
          }}
        >
          <h1 className="h1">
            Chain agents.
            <br />
            Gate them properly.
          </h1>
          <p className="muted" style={{ maxWidth: 460, fontSize: '1.05rem', lineHeight: 1.55 }}>
            Chain an AI call, an HTTP request, a branch, and a human approval.
            People in another company cannot see or run your workflows.
          </p>
        </div>

        <div className="panel" style={{ padding: 28, alignSelf: 'center' }}>
          <h2 className="h2">Sign in</h2>
          <form onSubmit={onSubmit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            {error ? (
              <p style={{ color: 'var(--coral)', marginTop: 0 }}>{error}</p>
            ) : null}
            <button className="btn" type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Enter workspace'}
            </button>
          </form>

          <div style={{ marginTop: 24 }}>
            <p className="muted" style={{ fontSize: '0.85rem', marginBottom: 10 }}>
              Demo accounts (password: <code>password</code>)
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              {demoUsers.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  className="btn btn-ghost"
                  style={{
                    borderRadius: 10,
                    textAlign: 'left',
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                  onClick={() => {
                    setEmail(u.email);
                    setPassword('password');
                  }}
                >
                  <span>{u.displayName}</span>
                  <span className="chip">{u.role}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
