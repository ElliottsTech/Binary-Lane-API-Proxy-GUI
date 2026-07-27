// Encrypted, signed session cookie via iron-session.
// Stores { userId, username, isAdmin } server-side; nothing client-readable.
import { getIronSession } from 'iron-session';

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('FATAL: SESSION_SECRET must be set and >= 32 chars');
  process.exit(1);
}

const COOKIE_NAME = 'bl_admin_session';
const TTL = 60 * 60 * 8; // 8 hours

export async function getSession(req, res) {
  return getIronSession(req, res, {
    cookieName: COOKIE_NAME,
    password: SESSION_SECRET,
    ttl: TTL,
    cookieOptions: {
      httpOnly: true,
      // HAProxy terminates TLS; trust X-Forwarded-Proto
      secure: isSecure(req),
      sameSite: 'lax',
      path: '/',
      maxAge: TTL,
    },
  });
}

// Behind HAProxy, req.protocol may be http even though the client used https.
function isSecure(req) {
  const xfp = req.headers['x-forwarded-proto'];
  return xfp ? xfp.includes('https') : req.secure;
}

export async function currentUser(req, res) {
  const session = await getSession(req, res);
  if (!session.userId) return null;
  return session;
}

export async function loginAs(req, res, user) {
  const session = await getSession(req, res);
  session.userId = user.id;
  session.username = user.username;
  session.isAdmin = !!user.is_admin;
  await session.save();
}

export async function logout(req, res) {
  const session = await getSession(req, res);
  session.destroy();
}
