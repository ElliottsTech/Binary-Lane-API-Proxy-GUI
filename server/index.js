// BL Proxy Admin — Express app bootstrap.
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { db, audit, Users, Credentials, AuditLog, isAdminBootstrapped, markBootstrapped } from './db.js';
import { getSession, currentUser, loginAs, logout } from './session.js';
import * as auth from './auth.js';
import * as apisix from './apisix.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 7100;

app.use(express.json());
app.use(cookieParser());

// trust the proxy (HAProxy) so req.protocol / secure reflect X-Forwarded-*
app.set('trust proxy', 1);

// ---- health ----
app.get('/health', (_req, res) => res.json({ ok: true }));

// ---- bootstrap / first-admin setup ----
const BOOTSTRAP_TOKEN = process.env.ADMIN_BOOTSTRAP_TOKEN || '';

app.get('/api/bootstrap/status', async (_req, res) => {
  res.json({ bootstrapped: isAdminBootstrapped(), hasToken: !!BOOTSTRAP_TOKEN });
});

// Returns the setup page only when the correct one-time token is presented
// AND no admin has been bootstrapped yet.
app.post('/api/bootstrap/setup', async (req, res) => {
  const { token, username, displayName } = req.body || {};
  if (isAdminBootstrapped()) return res.status(409).json({ error: 'Already bootstrapped' });
  if (!token || !constantTimeEqual(token, BOOTSTRAP_TOKEN)) {
    return res.status(403).json({ error: 'Invalid setup token' });
  }
  if (!username) return res.status(400).json({ error: 'username required' });
  const user = Users.create({ username, display_name: displayName, is_admin: 1 });
  markBootstrapped();
  audit(user.id, 'bootstrap_admin', { username });
  // Log the new admin in immediately so the subsequent register/finish call
  // (which requires a session) can store the credential.
  await loginAs(req, res, user);
  // return registration options for THIS user so the client can enroll immediately
  const options = await auth.startRegistration(user.id);
  res.json({ userId: user.id, registrationOptions: options });
});

function constantTimeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const ba = Buffer.from(a), bb = Buffer.from(b);
  return crypto.timingSafeEqual(ba, bb);
}

// ---- WebAuthn: registration (enroll passkey for logged-in user) ----
app.post('/api/webauthn/register/start', requireLogin, async (req, res) => {
  const session = await currentUser(req, res);
  const options = await auth.startRegistration(session.userId);
  res.json(options);
});

app.post('/api/webauthn/register/finish', requireLogin, async (req, res) => {
  const { credential, nickname } = req.body || {};
  try {
    const result = await auth.finishRegistration(credential, nickname);
    audit(result.userId, 'passkey_enrolled', { nickname });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ---- WebAuthn: authentication (login) ----
app.post('/api/webauthn/auth/start', async (_req, res) => {
  const options = await auth.startAuthentication();
  res.json(options);
});

app.post('/api/webauthn/auth/finish', async (req, res) => {
  const { credential } = req.body || {};
  try {
    const user = await auth.finishAuthentication(credential);
    await loginAs(req, res, user);
    audit(user.id, 'login', { username: user.username });
    res.json({ ok: true, user: { id: user.id, username: user.username, isAdmin: !!user.is_admin } });
  } catch (e) {
    audit(null, 'login_failed', { error: e.message });
    res.status(401).json({ error: e.message });
  }
});

app.post('/api/logout', requireLogin, async (req, res) => {
  const session = await currentUser(req, res);
  audit(session.userId, 'logout');
  await logout(req, res);
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  const session = await currentUser(req, res);
  if (!session) return res.status(401).json({ error: 'not authenticated' });
  res.json({ userId: session.userId, username: session.username, isAdmin: session.isAdmin });
});

// ---- admin actions (require login; some require admin) ----
app.get('/api/consumers', requireLogin, async (_req, res) => {
  try {
    const [consumers, userRoles, roles] = await Promise.all([
      apisix.listConsumers(),
      apisix.getUserRoles(),
      apisix.listRoleDefinitions(),
    ]);
    const out = consumers.map(c => ({
      username: c.username,
      roles: userRoles[c.username] || [],
    }));
    res.json({ consumers: out, roles });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/consumers', requireAdmin, async (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'username required' });
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    await apisix.ensureUpstream();
    await apisix.createConsumer(username, secret);
    const session = await currentUser(req, res);
    audit(session.userId, 'consumer_created', { username });
    res.json({ username, secret }); // shown once to the admin
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.delete('/api/consumers/:username', requireAdmin, async (req, res) => {
  const { username } = req.params;
  try {
    await apisix.deleteConsumer(username);
    // also remove from route's user map
    await apisix.setConsumerRoles(username, []);
    const session = await currentUser(req, res);
    audit(session.userId, 'consumer_deleted', { username });
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.put('/api/consumers/:username/roles', requireAdmin, async (req, res) => {
  const { username } = req.params;
  const { roles } = req.body || {};
  if (!Array.isArray(roles)) return res.status(400).json({ error: 'roles must be an array' });
  try {
    await apisix.setConsumerRoles(username, roles);
    const session = await currentUser(req, res);
    audit(session.userId, 'roles_changed', { username, roles });
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/consumers/:username/jwt', requireAdmin, async (req, res) => {
  const { username } = req.params;
  const { ttl = 3600 } = req.body || {};
  try {
    const c = await apisix.getConsumer(username);
    if (!c) return res.status(404).json({ error: 'consumer not found' });
    const secret = c.plugins?.['jwt-auth']?.secret;
    if (!secret) return res.status(500).json({ error: 'consumer has no jwt secret' });
    const jwt = apisix.mintJwt(username, secret, ttl);
    const session = await currentUser(req, res);
    audit(session.userId, 'jwt_minted', { username, ttl });
    res.json({ jwt, expiresIn: ttl });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/api/redeploy', requireAdmin, async (req, res) => {
  try {
    await apisix.ensureUpstream();
    await apisix.redeployRoute();
    const session = await currentUser(req, res);
    audit(session.userId, 'route_redeployed');
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/audit', requireAdmin, async (_req, res) => {
  res.json({ entries: AuditLog.recent(200) });
});

// ---- SPA static serving (must come last; catches all non-API routes) ----
const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
}

// ---- middleware ----
async function requireLogin(req, res, next) {
  const session = await currentUser(req, res);
  if (!session) return res.status(401).json({ error: 'not authenticated' });
  next();
}
async function requireAdmin(req, res, next) {
  const session = await currentUser(req, res);
  if (!session) return res.status(401).json({ error: 'not authenticated' });
  if (!session.isAdmin) return res.status(403).json({ error: 'admin required' });
  next();
}

// init DB, then start
db();
app.listen(PORT, '0.0.0.0', () => console.log(`bl-api-proxy-admin listening on :${PORT}`));
