'use client';
import { useRef, useState } from 'react';
import { formatCents } from '@/auction/engine/money';
import type { LotView } from '@/auction/lot-view';
import { outcomeLabel } from '@/auction/outcome-labels';
import { placeBidAction } from './actions';

const FAT_FINGER = 10; // O-7: a max above 10× the current price asks first; the engine caps nothing
const DOLLARS = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

// One idempotency key per submission: kept across a double click and across a BID_TIMED_OUT retry, replaced once the
// server has answered for good. Dollars are parsed as text into integer cents, never through a float.
export function BidForm({ slug, lotId, view }: { slug: string; lotId: string; view: LotView | Omit<LotView, 'etag'> }) {
  const key = useRef(crypto.randomUUID());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ text: string; retry: boolean; lead?: boolean } | null>(null);

  const send = async (maxCents: number) => {
    if (busy) return;
    setBusy(true);
    setConfirm(null);
    setMsg(null);
    try {
      const r = (await placeBidAction(slug, { lotId, maxCents, idempotencyKey: key.current })) as
        | { error: string; retryable?: boolean }
        | { ok: true; outcome: string; accepted: boolean; priceCents: number; minNextCents: number; youLead: boolean };
      if (!('ok' in r)) {
        const retry = !!r.retryable;
        setMsg({ text: r.error, retry });
        if (!retry) key.current = crypto.randomUUID();
      } else {
        setMsg({ text: r.accepted ? (r.youLead ? `Bid accepted. You lead at ${formatCents(r.priceCents)}.` : `Bid accepted, but you are not leading (${formatCents(r.priceCents)}).`) : `Bid not accepted: ${outcomeLabel(r.outcome).toLowerCase()}. The minimum next bid is ${formatCents(r.minNextCents)}.`, retry: false, lead: r.accepted && r.youLead });
        key.current = crypto.randomUUID();
        setText('');
      }
    } catch {
      setMsg({ text: 'Connection problem. Press Bid again to resend the same bid.', retry: true });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const m = DOLLARS.exec(text.trim());
    if (!m) return setMsg({ text: 'Enter a whole-cent amount such as 250 or 250.50.', retry: false });
    const maxCents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
    if (maxCents <= 0) return setMsg({ text: 'The amount must be above zero.', retry: false });
    const ref = view.bidCount === 0 ? view.minNextCents : view.priceCents;
    if (maxCents > FAT_FINGER * ref) return setConfirm(maxCents);
    void send(maxCents);
  };

  return (
    <form onSubmit={submit} aria-label="Place a bid">
      <label>Your maximum ($) <input name="max" inputMode="decimal" autoComplete="off" value={text} onChange={(e) => { setText(e.target.value); setConfirm(null); key.current = crypto.randomUUID(); }} /></label>
      <button type="submit" disabled={busy}>{busy ? 'Sending…' : 'Bid'}</button>
      {confirm !== null && (
        <p role="alertdialog" data-testid="confirm">
          {formatCents(confirm)} is more than {FAT_FINGER}× the current price. Bid it?{' '}
          <button type="button" onClick={() => void send(confirm)} disabled={busy}>Yes, bid {formatCents(confirm)}</button>{' '}
          <button type="button" onClick={() => setConfirm(null)}>Cancel</button>
        </p>
      )}
      {msg && !(msg.lead && view.you === 'OUTBID') && <p role="status" data-testid="bid-msg">{msg.text}</p>}
    </form>
  );
}
