import { startAuthentication } from '@simplewebauthn/browser';
import { useState } from 'react';
import { post } from '../api.js';

export default function Login({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function doLogin() {
    setBusy(true); setErr('');
    try {
      const opts = await post('/webauthn/auth/start');
      const credential = await startAuthentication({ optionsJSON: opts });
      await post('/webauthn/auth/finish', { credential });
      onDone();
    } catch (e) {
      setErr(e.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="centered">
      <div className="card">
        <h1>BL Proxy Admin</h1>
        <p className="muted">Sign in with your passkey</p>
        <button onClick={doLogin} disabled={busy} className="btn-primary">
          {busy ? 'Waiting for passkey…' : '🔑 Sign in with passkey'}
        </button>
        {err && <p className="error">{err}</p>}
      </div>
    </div>
  );
}
