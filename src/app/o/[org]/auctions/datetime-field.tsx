'use client';
import { useId, useState } from 'react';

/** UX-15 (D-79): a datetime-local field that is read as UTC (the actions append `:00Z`), with the instant and its
 * distance from the server's clock under it, so a picker showing local time cannot mislead. Nothing here decides time:
 * the server parses the value; this only previews it. */
export function DateTimeUtc({ name, label, serverNowMs, defaultValue = '', required, future, past }: { name: string; label: string; serverNowMs: number; defaultValue?: string; required?: boolean; future: string; past: string }) {
  const [v, setV] = useState(defaultValue);
  const id = useId();
  const t = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? Date.parse(`${v}:00Z`) : NaN;
  const hint = Number.isNaN(t) ? 'Read as UTC. Your picker shows local time.' : `= ${v.replace('T', ' ')} UTC, ${t >= serverNowMs ? `${future} ${span(t - serverNowMs)}` : `${past} ${span(serverNowMs - t)} ago`}`;
  return (
    <div className="field">
      <label>{label} <input name={name} type="datetime-local" required={required} value={v} aria-describedby={id} onChange={(e) => setV(e.target.value)} /></label>
      <span id={id} className="form-hint" data-testid={`${name}-utc`}>{hint}</span>
    </div>
  );
}

function span(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} m`;
  return `${Math.floor(s / 86_400)} d ${Math.floor((s % 86_400) / 3600)} h`;
}
