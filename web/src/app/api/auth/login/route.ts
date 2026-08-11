import { createHmac } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest, NextResponse } from 'next/server';

type DemoUser = {
  id: string;
  password: string;
  email: string;
  displayName: string;
  org: string;
  role: string;
};

const FALLBACK_USERS: Record<string, DemoUser> = {
  'owner-a@acme.test': {
    id: '11111111-1111-1111-1111-111111111111',
    password: 'password',
    email: 'owner-a@acme.test',
    displayName: 'Ava Owner',
    org: 'Org A',
    role: 'owner',
  },
  'editor-a@acme.test': {
    id: '22222222-2222-2222-2222-222222222222',
    password: 'password',
    email: 'editor-a@acme.test',
    displayName: 'Ed Editor',
    org: 'Org A',
    role: 'editor',
  },
  'viewer-a@acme.test': {
    id: '33333333-3333-3333-3333-333333333333',
    password: 'password',
    email: 'viewer-a@acme.test',
    displayName: 'Vera Viewer',
    org: 'Org A',
    role: 'viewer',
  },
  'owner-b@beta.test': {
    id: '44444444-4444-4444-4444-444444444444',
    password: 'password',
    email: 'owner-b@beta.test',
    displayName: 'Ben Owner',
    org: 'Org B',
    role: 'owner',
  },
};

function loadUsers(): Record<string, DemoUser> {
  try {
    const p = join(process.cwd(), '..', 'scripts', 'demo-users.json');
    const p2 = join(process.cwd(), 'scripts', 'demo-users.json');
    const file = existsSync(p) ? p : existsSync(p2) ? p2 : null;
    if (!file) return FALLBACK_USERS;
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<
      string,
      DemoUser
    >;
    return { ...FALLBACK_USERS, ...raw };
  } catch {
    return FALLBACK_USERS;
  }
}

function b64url(input: Buffer | string) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(userId: string) {
  const key =
    process.env.HASURA_JWT_KEY ||
    'super-secret-jwt-key-at-least-32-characters-long';
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      iat: now,
      exp: now + 60 * 60 * 24 * 7,
      iss: 'hasura-auth',
      'https://hasura.io/jwt/claims': {
        'x-hasura-default-role': 'user',
        'x-hasura-allowed-roles': ['user', 'me'],
        'x-hasura-user-id': userId,
      },
    })
  );
  const data = `${header}.${payload}`;
  const sig = createHmac('sha256', key).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const email = String(body.email || '').toLowerCase().trim();
  const password = String(body.password || '');
  const users = loadUsers();
  const user = users[email];

  if (!user || user.password !== password) {
    return NextResponse.json({ message: 'Invalid credentials' }, { status: 401 });
  }

  const accessToken = signJwt(user.id);
  return NextResponse.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      org: user.org,
      role: user.role,
    },
  });
}

export async function GET() {
  const users = loadUsers();
  return NextResponse.json({
    users: Object.values(users).map((u) => ({
      email: u.email,
      password: process.env.VERCEL ? 'Password123' : 'password',
      displayName: u.displayName,
      org: u.org,
      role: u.role,
    })),
  });
}
