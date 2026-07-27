import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, post } from '../api.js';

export default function Users({ me }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [newUser, setNewUser] = useState('');
  const [createdSecret, setCreatedSecret] = useState(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setErr('');
    try { setData(await api('/consumers')); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function addConsumer(e) {
    e.preventDefault();
    if (!newUser) return;
    setBusy(true); setErr(''); setCreatedSecret(null);
    try {
      const res = await post('/consumers', { username: newUser });
      setCreatedSecret({ username: newUser, secret: res.secret });
      setNewUser('');
      load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function redeploy() {
    if (!confirm('Regenerate the Lua RBAC policy from roles.json and redeploy the route?')) return;
    setBusy(true); setErr('');
    try { await post('/redeploy'); load(); } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (!data) return <p>Loading…</p>;

  return (
    <div>
      <div className="page-head">
        <h2>Users ({data.consumers.length})</h2>
        {me.isAdmin && <button onClick={redeploy} disabled={busy} className="btn">↻ Redeploy policy</button>}
      </div>

      <table className="grid">
        <thead><tr><th>Username</th><th>Role(s)</th></tr></thead>
        <tbody>
          {data.consumers.map(c => (
            <tr key={c.username}>
              <td><Link to={`/users/${c.username}`}>{c.username}</Link></td>
              <td>{c.roles.map(r => <span key={r} className="badge">{r}</span>)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <details className="role-legend">
        <summary>Available roles ({data.roles.length})</summary>
        <ul>
          {data.roles.map(r => <li key={r.name}><strong>{r.name}</strong> — {r.description} <span className="muted">({r.actionCount} actions)</span></li>)}
        </ul>
      </details>

      {me.isAdmin && (
        <form onSubmit={addConsumer} className="inline-form">
          <h3>Add consumer</h3>
          <input value={newUser} onChange={e => setNewUser(e.target.value)} placeholder="username" />
          <button type="submit" disabled={busy}>Add</button>
        </form>
      )}

      {createdSecret && (
        <div className="callout">
          <strong>{createdSecret.username}</strong> created. JWT secret (shown once):
          <code>{createdSecret.secret}</code>
          <button onClick={() => navigator.clipboard.writeText(createdSecret.secret)}>Copy</button>
        </div>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  );
}
