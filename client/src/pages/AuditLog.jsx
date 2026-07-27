import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function AuditLog() {
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/audit').then(d => setEntries(d.entries)).catch(e => setErr(e.message));
  }, []);

  if (err) return <p className="error">{err}</p>;
  if (!entries) return <p>Loading…</p>;

  return (
    <div>
      <h2>Audit log</h2>
      <table className="grid">
        <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id}>
              <td className="mono">{e.ts}</td>
              <td>{e.username || '—'}</td>
              <td><span className="badge">{e.action}</span></td>
              <td className="mono small">{e.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
