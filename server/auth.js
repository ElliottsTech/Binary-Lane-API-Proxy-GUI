// WebAuthn (passkey) registration + authentication via @simplewebauthn/server v11.
//
// v11 API notes:
//  - generateRegistrationOptions(): userID must be a Buffer/Uint8Array (not string)
//  - verifyRegistrationResponse() returns registrationInfo.credential = WebAuthnCredential
//    { id, publicKey: Uint8Array, counter, transports } plus credentialDeviceType/BackedUp
//  - verifyAuthenticationResponse() takes credential: WebAuthnCredential (publicKey: Uint8Array)
// We store the WebAuthnCredential as JSON (publicKey as base64) and rehydrate on login.
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { Users, Credentials } from './db.js';

const RP_ID = process.env.RP_ID;
const ORIGIN = process.env.ORIGIN || (RP_ID ? `https://${RP_ID}` : '');
if (!RP_ID || !ORIGIN) {
  console.error('FATAL: RP_ID and ORIGIN env vars are required (WebAuthn relying-party config).');
  console.error('       Set RP_ID to your domain (e.g. bl-api.example.com) and');
  console.error('       ORIGIN to the full HTTPS URL your reverse proxy serves.');
  process.exit(1);
}
if (!ORIGIN.startsWith('https://')) {
  console.error('FATAL: ORIGIN must be https://... (WebAuthn requires a secure context)');
  process.exit(1);
}

// pending challenges (short-lived; single-process)
const pending = new Map();
const TTL = 5 * 60 * 1000;
function remember(challenge, data) {
  pending.set(challenge, { ...data, at: Date.now() });
  for (const [k, v] of pending) if (Date.now() - v.at > TTL) pending.delete(k);
}
function recall(challenge) {
  const v = pending.get(challenge);
  if (!v) return null;
  pending.delete(challenge);
  return v;
}

// ---- helpers: Uint8Array <-> base64url (for storing publicKey) ----
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(s, 'base64url');

// ---- registration ----
export async function startRegistration(userId) {
  const user = Users.byId(userId);
  if (!user) throw new Error('user not found');
  const existing = Credentials.byUserId(userId).map(c => ({
    id: c.id, type: 'public-key', transports: JSON.parse(c.transports || '[]'),
  }));
  const options = await generateRegistrationOptions({
    rpName: 'BL Proxy Admin',
    rpID: RP_ID,
    userID: Buffer.from(String(user.id)),
    userName: user.username,
    userDisplayName: user.display_name || user.username,
    attestationType: 'none',
    excludeCredentials: existing,
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });
  remember(options.challenge, { kind: 'reg', userId });
  return options;
}

export async function finishRegistration(credential, nickname) {
  const clientData = JSON.parse(Buffer.from(credential.response.clientDataJSON, 'base64url').toString());
  const p = recall(clientData.challenge);
  if (!p || p.kind !== 'reg') throw new Error('registration challenge expired or invalid');

  const verification = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge: clientData.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
  });
  if (!verification.verified || !verification.registrationInfo) throw new Error('registration verification failed');

  const info = verification.registrationInfo;
  const cred = info.credential; // WebAuthnCredential { id, publicKey: Uint8Array, counter, transports }
  Credentials.create({
    id: cred.id,
    user_id: p.userId,
    public_key: b64u(cred.publicKey),
    counter: cred.counter,
    device_type: info.credentialDeviceType,
    transports: cred.transports || [],
    nickname: nickname || null,
  });
  return { userId: p.userId };
}

// ---- authentication ----
export async function startAuthentication() {
  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    userVerification: 'preferred',
  });
  remember(options.challenge, { kind: 'auth' });
  return options;
}

export async function finishAuthentication(credential) {
  const clientData = JSON.parse(Buffer.from(credential.response.clientDataJSON, 'base64url').toString());
  const p = recall(clientData.challenge);
  if (!p || p.kind !== 'auth') throw new Error('authentication challenge expired or invalid');

  const record = Credentials.byId(credential.id);
  if (!record) throw new Error('credential not recognised');

  const user = Users.byId(record.user_id);
  if (!user || user.disabled) throw new Error('user disabled or removed');

  // Rehydrate the WebAuthnCredential shape v11 expects (publicKey as Uint8Array)
  const verification = await verifyAuthenticationResponse({
    response: credential,
    expectedChallenge: clientData.challenge,
    expectedOrigin: ORIGIN,
    expectedRPID: RP_ID,
    credential: {
      id: record.id,
      publicKey: new Uint8Array(fromB64u(record.public_key)),
      counter: record.counter,
      transports: JSON.parse(record.transports || '[]'),
    },
  });
  if (!verification.verified) throw new Error('authentication verification failed');

  Credentials.updateCounter(record.id, verification.authenticationInfo.newCounter);
  return user;
}
