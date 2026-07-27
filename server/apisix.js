// APISIX Admin API client.
// Manages consumers (JWT identities) and the scoped route's user->role map.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ADMIN_KEY = process.env.ADMIN_KEY;
const APISIX_ADMIN_URL = process.env.APISIX_ADMIN_URL || 'http://bl-apisix:9180/apisix/admin';
const ROUTE_ID = 'bl-api-proxy';
const UPSTREAM_ID = 'bl-api';
const ROLES_JSON = process.env.ROLES_JSON;
const GENERATOR = process.env.POLICY_GENERATOR;
const BL_API_TOKEN = process.env.BL_API_TOKEN; // injected into route proxy-rewrite header

if (!ADMIN_KEY) {
  console.error('FATAL: ADMIN_KEY env var required (APISIX admin key)');
  process.exit(1);
}
if (!ROLES_JSON || !GENERATOR) {
  console.error('FATAL: ROLES_JSON and POLICY_GENERATOR env vars are required');
  console.error('       (paths to the proxy project\'s roles.json + generate-policy-lua.py,');
  console.error('        typically mounted read-only into this container).');
  process.exit(1);
}

async function adminFetch(p, opts = {}) {
  const url = `${APISIX_ADMIN_URL}${p}`;
  const res = await fetch(url, {
    ...opts,
    headers: { 'X-API-Key': ADMIN_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await res.text();
  let json = null;
  try { json = body ? JSON.parse(body) : null; } catch { /* non-json */ }
  if (!res.ok) {
    const err = new Error(`APISIX ${res.status} ${res.statusText}: ${body.slice(0, 300)}`);
    err.status = res.status; err.body = json;
    throw err;
  }
  return { status: res.status, json };
}

// ---- consumers ----
export async function listConsumers() {
  const { json } = await adminFetch('/consumers');
  return (json?.list || []).map(c => c.value || c).filter(Boolean);
}

export async function getConsumer(username) {
  const { json } = await adminFetch(`/consumers/${encodeURIComponent(username)}`);
  return json?.value || null;
}

export async function createConsumer(username, secret) {
  const body = {
    username,
    plugins: {
      'jwt-auth': { key: username, secret, algorithm: 'HS256' },
    },
  };
  const { json } = await adminFetch(`/consumers/${encodeURIComponent(username)}`, {
    method: 'PUT', body: JSON.stringify(body),
  });
  return json?.value || json;
}

export async function deleteConsumer(username) {
  await adminFetch(`/consumers/${encodeURIComponent(username)}`, { method: 'DELETE' });
}

// ---- route + user->role map ----
export async function getRoute() {
  const { json } = await adminFetch(`/routes/${ROUTE_ID}`);
  return json?.value || null;
}

export async function getUserRoles() {
  const route = await getRoute();
  return route?.plugins?.['serverless-pre-function']?.users || {};
}

async function putRoute(route) {
  const { json } = await adminFetch(`/routes/${ROUTE_ID}`, {
    method: 'PUT', body: JSON.stringify(route),
  });
  return json?.value || json;
}

/** Set a consumer's role list and redeploy the route (keeping the Lua policy intact). */
export async function setConsumerRoles(username, roles) {
  const route = await getRoute();
  if (!route) throw new Error(`Route ${ROUTE_ID} not found`);
  const users = route.plugins['serverless-pre-function'].users || {};
  if (roles && roles.length) {
    users[username] = roles;
  } else {
    delete users[username];
  }
  route.plugins['serverless-pre-function'].users = users;
  return putRoute(route);
}

/** Regenerate the Lua policy from roles.json and redeploy the full route. */
export async function redeployRoute() {
  if (!BL_API_TOKEN) throw new Error('BL_API_TOKEN env var required for redeploy');
  // 1. generate Lua from roles.json using the proxy's generator script
  const lua = execFileSync('python3', [GENERATOR], { cwd: path.dirname(ROLES_JSON), encoding: 'utf8' });
  // 2. read current user map
  const users = await getUserRoles();
  // 3. build + PUT the route
  const route = {
    uri: '/v2/*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    upstream_id: UPSTREAM_ID,
    plugins: {
      'jwt-auth': { key_claim_name: 'sub', claims_to_verify: ['exp'] },
      'serverless-pre-function': {
        phase: 'access',
        functions: [lua],
        policy: {},
        users,
      },
      'proxy-rewrite': { headers: { Authorization: `Bearer ${BL_API_TOKEN}` } },
    },
  };
  return putRoute(route);
}

/** Ensure the upstream exists (idempotent). */
export async function ensureUpstream() {
  const body = { type: 'roundrobin', scheme: 'https', nodes: { 'api.binarylane.com.au:443': 1 } };
  await adminFetch(`/upstreams/${UPSTREAM_ID}`, { method: 'PUT', body: JSON.stringify(body) });
}

// ---- roles catalog (from roles.json) ----
export function listRoleDefinitions() {
  if (!fs.existsSync(ROLES_JSON)) return [];
  const doc = JSON.parse(fs.readFileSync(ROLES_JSON, 'utf8'));
  return Object.entries(doc.roles || {}).map(([name, def]) => ({
    name,
    description: def.description,
    actionCount: (def.actions || []).length,
  }));
}

// ---- JWT minting (mirrors make-jwt.sh) ----
import crypto from 'node:crypto';
export function mintJwt(consumerKey, secret, ttlSeconds = 3600) {
  const b64 = (buf) => buf.toString('base64url').replace(/=+$/, '');
  const header = b64(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64(Buffer.from(JSON.stringify({
    sub: consumerKey,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  })));
  const sig = b64(crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}
