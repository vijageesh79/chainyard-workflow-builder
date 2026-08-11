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

function isLocalAuthUrl(url: string) {
  return /localhost|127\.0\.0\.1/.test(url);
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
    }
    setReady(true);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const json = await loginViaBridge(email, password);
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

async function loginViaBridge(email: string, password: string) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || 'Login failed');
  return json as { accessToken: string; user: AuthUser };
}

function NhostAuthInner({ children }: { children: ReactNode }) {
  const client = useNhostClient();
  const userData = useUserData();
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ org?: string; role?: string }>({});
  const [fallbackUser, setFallbackUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setAccessToken(client.auth.getAccessToken() || null);
    const unsub = client.auth.onAuthStateChanged((_event, session) => {
      if (session?.accessToken) {
        setFallbackUser(null);
        setAccessToken(session.accessToken);
      }
    });
    return () => {
      unsub();
    };
  }, [client]);

  const user: AuthUser | null =
    fallbackUser ||
    (isAuthenticated && userData
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
      : null);

  const login = useCallback(
    async (email: string, password: string) => {
      let nhostError: string | null = null;
      try {
        const { error, session } = await client.auth.signIn({
          email,
          password,
        });
        if (!error && session) {
          setFallbackUser(null);
          setAccessToken(session.accessToken);
          try {
            const hints = JSON.parse(
              localStorage.getItem('wf_user_hints') || '{}'
            ) as Record<string, { org?: string; role?: string }>;
            const hint = hints[email.toLowerCase()];
            if (hint) setMeta(hint);
          } catch {
          }
          return;
        }
        nhostError = error?.message || null;
      } catch (err) {
        nhostError = err instanceof Error ? err.message : 'nhost sign-in failed';
      }

      try {
        const json = await loginViaBridge(email, password);
        localStorage.setItem(TOKEN_KEY, json.accessToken);
        localStorage.setItem(USER_KEY, JSON.stringify(json.user));
        setAccessToken(json.accessToken);
        setFallbackUser(json.user);
      } catch {
        throw new Error(nhostError || 'Invalid credentials');
      }
    },
    [client]
  );

  const logout = useCallback(async () => {
    await client.auth.signOut();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setAccessToken(null);
    setMeta({});
    setFallbackUser(null);
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

export function Providers({ children }: { children: ReactNode }) {
  const preferNhost =
    process.env.NEXT_PUBLIC_USE_NHOST_AUTH !== 'false' &&
    !isLocalAuthUrl(getAuthUrl());
  const [mode, setMode] = useState<'nhost' | 'bridge' | 'detect'>(
    preferNhost ? 'nhost' : 'bridge'
  );

  useEffect(() => {
    if (!preferNhost) {
      setMode('bridge');
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 1500);
    fetch(`${getAuthUrl().replace(/\/v1\/?$/, '')}/healthz`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) setMode('bridge');
      })
      .catch(() => setMode('bridge'))
      .finally(() => window.clearTimeout(timer));

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [preferNhost]);

  if (mode === 'bridge') {
    return <BridgeAuthProvider>{children}</BridgeAuthProvider>;
  }

  return (
    <NhostProvider nhost={nhost}>
      <NhostAuthInner>{children}</NhostAuthInner>
    </NhostProvider>
  );
}
