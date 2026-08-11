'use client';

import {
  ApolloClient,
  ApolloProvider,
  HttpLink,
  InMemoryCache,
  split,
} from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import { NhostClient, NhostProvider, useAuthenticationStatus, useNhostClient, useUserData } from '@nhost/nextjs';
import { createClient } from 'graphql-ws';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  org?: string;
  role?: string;
};

type AuthState = {
  user: AuthUser | null;
  accessToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  ready: boolean;
  authMode: 'nhost' | 'bridge';
};

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = 'wf_access_token';
const USER_KEY = 'wf_user';

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}

function getGraphqlHttp() {
  return (
    process.env.NEXT_PUBLIC_HASURA_GRAPHQL_URL ||
    'http://localhost:8080/v1/graphql'
  );
}

function getGraphqlWs() {
  return (
    process.env.NEXT_PUBLIC_HASURA_WS_URL ||
    'ws://localhost:8080/v1/graphql'
  );
}

function getAuthUrl() {
  return (
    process.env.NEXT_PUBLIC_NHOST_AUTH_URL ||
    'http://localhost:4000/v1'
  );
}

/** True when using dedicated auth service URLs (nhost/hasura-auth). */
export function isNhostAuthConfigured() {
  if (typeof window === 'undefined') {
    return Boolean(
      process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN ||
        process.env.NEXT_PUBLIC_NHOST_AUTH_URL ||
        process.env.NEXT_PUBLIC_USE_NHOST_AUTH === 'true'
    );
  }
  return (
    process.env.NEXT_PUBLIC_USE_NHOST_AUTH !== 'false' &&
    Boolean(
      process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN ||
        process.env.NEXT_PUBLIC_NHOST_AUTH_URL ||
        process.env.NEXT_PUBLIC_USE_NHOST_AUTH === 'true' ||
        true // local default: try nhost auth on :4000
    )
  );
}

export const nhost = new NhostClient({
  ...(process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN
    ? {
        subdomain: process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN,
        region: process.env.NEXT_PUBLIC_NHOST_REGION || '',
      }
    : {
        authUrl: getAuthUrl(),
        graphqlUrl: getGraphqlHttp(),
        storageUrl: `${getAuthUrl().replace(/\/v1\/?$/, '')}/v1/storage`,
        functionsUrl: 'http://localhost:3000/v1',
      }),
});

function BridgeAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const t = localStorage.getItem(TOKEN_KEY);
      const u = localStorage.getItem(USER_KEY);
      if (t && u) {
        setAccessToken(t);
        setUser(JSON.parse(u));
      }
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Login failed');
    localStorage.setItem(TOKEN_KEY, json.accessToken);
    localStorage.setItem(USER_KEY, JSON.stringify(json.user));
    setAccessToken(json.accessToken);
    setUser(json.user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setAccessToken(null);
    setUser(null);
  }, []);

  return (
    <AuthShell
      user={user}
      accessToken={accessToken}
      login={login}
      logout={logout}
      ready={ready}
      authMode="bridge"
    >
      {children}
    </AuthShell>
  );
}

function NhostAuthInner({ children }: { children: ReactNode }) {
  const client = useNhostClient();
  const userData = useUserData();
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ org?: string; role?: string }>({});

  useEffect(() => {
    setAccessToken(client.auth.getAccessToken() || null);
    const unsub = client.auth.onAuthStateChanged((_event, session) => {
      setAccessToken(session?.accessToken || null);
    });
    return () => {
      unsub();
    };
  }, [client]);

  const user: AuthUser | null =
    isAuthenticated && userData
      ? {
          id: userData.id,
          email: userData.email || '',
          displayName:
            userData.displayName ||
            userData.email?.split('@')[0] ||
            'User',
          org: meta.org,
          role: meta.role,
        }
      : null;

  const login = useCallback(
    async (email: string, password: string) => {
      const { error, session } = await client.auth.signIn({
        email,
        password,
      });
      if (error) throw new Error(error.message);
      if (!session) throw new Error('No session returned from nhost auth');
      setAccessToken(session.accessToken);
      // Optional display hints from provision script
      try {
        const hints = JSON.parse(
          localStorage.getItem('wf_user_hints') || '{}'
        ) as Record<string, { org?: string; role?: string }>;
        const hint = hints[email.toLowerCase()];
        if (hint) setMeta(hint);
      } catch {
        /* ignore */
      }
    },
    [client]
  );

  const logout = useCallback(async () => {
    await client.auth.signOut();
    setAccessToken(null);
    setMeta({});
  }, [client]);

  return (
    <AuthShell
      user={user}
      accessToken={accessToken}
      login={login}
      logout={() => {
        void logout();
      }}
      ready={!isLoading}
      authMode="nhost"
    >
      {children}
    </AuthShell>
  );
}

function AuthShell({
  children,
  user,
  accessToken,
  login,
  logout,
  ready,
  authMode,
}: AuthState & { children: ReactNode }) {
  const apollo = useMemo(() => {
    const httpLink = new HttpLink({
      uri: getGraphqlHttp(),
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : {},
    });

    const wsLink =
      typeof window !== 'undefined'
        ? new GraphQLWsLink(
            createClient({
              url: getGraphqlWs(),
              connectionParams: () =>
                accessToken
                  ? { headers: { Authorization: `Bearer ${accessToken}` } }
                  : {},
            })
          )
        : null;

    const link =
      wsLink != null
        ? split(
            ({ query }) => {
              const def = getMainDefinition(query);
              return (
                def.kind === 'OperationDefinition' &&
                def.operation === 'subscription'
              );
            },
            wsLink,
            httpLink
          )
        : httpLink;

    return new ApolloClient({
      link,
      cache: new InMemoryCache(),
      defaultOptions: {
        watchQuery: { fetchPolicy: 'cache-and-network' },
      },
    });
  }, [accessToken]);

  const authValue = useMemo(
    () => ({ user, accessToken, login, logout, ready, authMode }),
    [user, accessToken, login, logout, ready, authMode]
  );

  return (
    <AuthContext.Provider value={authValue}>
      <ApolloProvider client={apollo}>{children}</ApolloProvider>
    </AuthContext.Provider>
  );
}

/**
 * Primary path: nhost/hasura-auth via @nhost/nextjs.
 * Fallback: local JWT bridge if auth service is unreachable at first paint
 * (still Hasura-compatible claims).
 */
export function Providers({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<'nhost' | 'bridge' | 'detect'>('detect');

  useEffect(() => {
    const forceBridge = process.env.NEXT_PUBLIC_USE_NHOST_AUTH === 'false';
    if (forceBridge) {
      setMode('bridge');
      return;
    }
    // Prefer nhost auth; fall back to bridge if /healthz fails
    fetch(`${getAuthUrl().replace(/\/v1\/?$/, '')}/healthz`)
      .then((r) => setMode(r.ok ? 'nhost' : 'bridge'))
      .catch(() =>
        fetch(getAuthUrl())
          .then((r) => setMode(r.ok || r.status === 404 ? 'nhost' : 'bridge'))
          .catch(() => setMode('bridge'))
      );
  }, []);

  if (mode === 'detect') {
    return <main className="app-shell">Connecting to auth…</main>;
  }

  if (mode === 'bridge') {
    return <BridgeAuthProvider>{children}</BridgeAuthProvider>;
  }

  return (
    <NhostProvider nhost={nhost}>
      <NhostAuthInner>{children}</NhostAuthInner>
    </NhostProvider>
  );
}
