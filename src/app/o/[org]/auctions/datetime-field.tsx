'use client';
import { useId, useState } from 'react';
import { fromLocalInput, inZone } from '@/auction/house-time';

/** UX-15 (D-79), R-12 (D-84): a datetime-local field read in the house's zone (the actions call fromLocalInput with the same
 * zone), with the instant it names and its distance from the server's clock under it, so a picker showing the viewer's own
 * zone cannot mislead. Nothing here decides time: the server parses the value; this only previews it. */
export function DateTimeField({ name, label, tz, serverNowMs, defaultValue = '', required, future, past }: { name: string; label: string; tz: string; serverNowMs: number; defaultValue?: string; required?: boolean; future: string; past: string }) {
  const [v, setV] = useState(defaultValue);
  const id = useId();
  const t = fromLocalInput(v, tz)?.getTime() ?? NaN;
  const hint = Number.isNaN(t) ? `Read as ${tz} time; your picker may show your own zone.` : `= ${inZone(t, tz)}, ${t >= serverNowMs ? `${future} ${span(t - serverNowMs)}` : `${past} ${span(serverNowMs - t)} ago`}`;
  return (
    <div className="field">
      <label>{label} <input name={name} type="datetime-local" required={required} value={v} aria-describedby={id} onChange={(e) => setV(e.target.value)} /></label>
      <span id={id} className="form-hint" data-testid={`${name}-hint`}>{hint}</span>
    </div>
  );
}

function span(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} m`;
  return `${Math.floor(s / 86_400)} d ${Math.floor((s % 86_400) / 3600)} h`;
}
