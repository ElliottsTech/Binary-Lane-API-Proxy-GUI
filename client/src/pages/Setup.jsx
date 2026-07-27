import { startRegistration } from '@simplewebauthn/browser';
import { useState } from 'react';
import { post } from '../api.js';

export default function Setup({ onDone }) {
  const [token, setToken] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [step, setStep] = useState(1);     // 1 = form, 2 = enroll passkey
  const [regOpts, setRegOpts] = useState(null);
  const [userId, setUserId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submitForm(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const res = await post('/bootstrap/setup', { token, username, displayName });
      setUserId(res.userId);
      setRegOpts(res.registrationOptions);
      setStep(2);
    } catch (e) {
      setErr(e.message || 'Setup failed');
    } finally {
      setBusy(false);
    }
  }

  async function enrollPasskey(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const credential = await startRegistration({ optionsJSON: regOpts });
      await post('/webauthn/register/finish', { credential });
      onDone();
    } catch (e) {
      setErr(e.message || 'Passkey enrollment failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centered">
      <div className="card">
        <h1>Admin setup</h1>
        {step === 1 && (
          <form onSubmit={submitForm}>
            <p className="muted">First-time administrator enrollment.</p>
            <label>Setup token
              <input value={token} onChange={e => setToken(e.target.value)}
                     placeholder="from .env ADMIN_BOOTSTRAP_TOKEN" required />
            </label>
            <label>Username
              <input value={username} onChange={e => setUsername(e.target.value)}
                     placeholder="e.g. admin" required />
            </label>
            <label>Display name
              <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                     placeholder="Administrator" />
            </label>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? 'Verifying…' : 'Continue'}
            </button>
            {err && <p className="error">{err}</p>}
          </form>
        )}
        {step === 2 && (
          <form onSubmit={enrollPasskey}>
            <p>Admin user <strong>{username}</strong> created.</p>
            <p className="muted">Now enroll a passkey to secure this account.</p>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? 'Waiting for passkey…' : '🔑 Create passkey'}
            </button>
            {err && <p className="error">{err}</p>}
          </form>
        )}
      </div>
    </div>
  );
}
