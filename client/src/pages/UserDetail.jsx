import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, post, put, del } from '../api.js';

export default function UserDetail({ me }) {
  const { username } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState([]);
  const [jwt, setJwt] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    setErr('');
    try {
      const all = await api('/consumers');
      const consumer = all.consumers.find(c => c.username === username);
      setData({ consumer, roles: all.roles });
      setSelected(consumer?.roles || []);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [username]);

  async function toggleRole(name) {
    setSelected(s => s.includes(name) ? s.filter(r => r !== name) : [...s, name]);
  }

  async function saveRoles() {
    setBusy(true); setErr('');
    try { await put(`/consumers/${username}/roles`, { roles: selected }); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function mintJwt() {
    setBusy(true); setErr(''); setJwt(null);
    try { setJwt(await post(`/consumers/${username}/jwt`, { ttl: 3600 })); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function remove() {
    if (!confirm(`Delete consumer ${username}? This removes their JWT identity and role assignment.`)) return;
    setBusy(true); setErr('');
    try { await del(`/consumers/${username}`); navigate('/users'); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!data) return <p>Loading…</p>;
  const c = data.consumer;

  return (
    <div>
      <Link to="/users">← Users</Link>
      <h2>{username}</h2>
      {err && <p className="error">{err}</p>}

      {me.isAdmin ? (
        <>
          <section>
            <h3>Roles</h3>
            <div className="role-grid">
              {data.roles.map(r => (
                <label key={r.name} className="role-opt">
                  <input type="checkbox" checked={selected.includes(r.name)} onChange={() => toggleRole(r.name)} />
                  <span><strong>{r.name}</strong><br /><span className="muted">{r.description}</span></span>
                </label>
              ))}
            </div>
            <button onClick={saveRoles} disabled={busy} className="btn-primary">Save roles</button>
          </section>

          <section>
            <h3>Test JWT</h3>
            <button onClick={mintJwt} disabled={busy} className="btn">Mint 1-hour JWT</button>
            {jwt && (
              <div className="callout">
                <code>{jwt.jwt}</code>
                <button onClick={() => navigator.clipboard.writeText(jwt.jwt)}>Copy</button>
              </div>
            )}
          </section>

          <section>
            <h3>Danger zone</h3>
            <button onClick={remove} disabled={busy} className="btn-danger">Delete consumer</button>
          </section>
        </>
      ) : (
        <p>Roles: {c?.roles.map(r => <span key={r} className="badge">{r}</span>)}</p>
      )}
    </div>
  );
}
