'use client';
import { useEffect, useRef, useState } from 'react';
import { formatCents } from '@/auction/engine/money';
import type { LotView } from '@/auction/lot-view';
import { outcomeLabel } from '@/auction/outcome-labels';
import { placeBidAction } from './actions';

const FAT_FINGER = 10; // O-7: a max above 10× the current price asks first; the engine caps nothing
const DOLLARS = /^(\d{1,7})(?:\.(\d{1,2}))?$/;

// One idempotency key per submission: kept across a double click and across a BID_TIMED_OUT retry, replaced once the
// server has answered for good. Dollars are parsed as text into integer cents, never through a float.
// DS-05: each result has a badge word and a tone, so leading, outbid, refused and a connection problem tell apart in greyscale.
type Tone = 'lead' | 'outbid' | 'refused' | 'warn';
type Msg = { badge: string; tone: Tone; text: string; retry: boolean; code?: string };
const BADGE: Record<Tone, string> = { lead: 'Leading', outbid: 'Outbid', refused: 'Not accepted', warn: 'Try again' };
const say = (tone: Tone, text: string, retry = false, code?: string): Msg => ({ badge: BADGE[tone], tone, text, retry, code });
/** The bidder-safe answer to a judged bid, as the action returns it. */
export type BidOk = { ok: true; outcome: string; accepted: boolean; priceCents: number; minNextCents: number; youLead: boolean; yourMaxCents: number | null };

export function BidForm({ slug, lotId, view, paddle, disabledReason, onResult }: { slug: string; lotId: string; view: LotView | Omit<LotView, 'etag'>; paddle: number; disabledReason?: string; onResult?: (r: BidOk, sentMaxCents: number) => void }) {
  const key = useRef(crypto.randomUUID());
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<number | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  // R22: the confirm is a real dialog for the keyboard: focus lands on Yes when it opens, returns to the input on cancel
  const input = useRef<HTMLInputElement>(null);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirm !== null) yes.current?.focus(); }, [confirm]);
  const cancel = () => { setConfirm(null); input.current?.focus(); };

  const send = async (maxCents: number) => {
    if (busy || disabledReason) return;
    setBusy(true);
    setConfirm(null);
    setMsg(null);
    try {
      const r = (await placeBidAction(slug, { lotId, maxCents, idempotencyKey: key.current })) as { error: string; code?: string; retryable?: boolean } | BidOk;
      if (!('ok' in r)) {
        const retry = !!r.retryable;
        setMsg(say(retry ? 'warn' : 'refused', r.error, retry, r.code));
        if (!retry) key.current = crypto.randomUUID();
      } else {
        onResult?.(r, maxCents); // UX-14: the board takes the judged numbers now; the next poll confirms them
        setMsg(r.yourMaxCents !== null ? say('refused', `Your maximum is already ${formatCents(r.yourMaxCents)}; enter more to raise it.`, false, r.outcome)
          : !r.accepted ? say('refused', `${outcomeLabel(r.outcome)}. The minimum next bid is ${formatCents(r.minNextCents)}.`, false, r.outcome)
          : r.youLead ? say('lead', `Bid accepted. You lead at ${formatCents(r.priceCents)}.`, false, r.outcome)
          : say('outbid', `Bid accepted, but another bidder's maximum is higher (${formatCents(r.priceCents)}).`, false, r.outcome));
        key.current = crypto.randomUUID();
        setText('');
      }
    } catch {
      setMsg(say('warn', 'Connection problem. Press Bid again to resend the same bid.', true));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const m = DOLLARS.exec(text.trim());
    if (!m) return setMsg(say('refused', 'Enter a whole-cent amount such as 250 or 250.50.', false, 'INVALID_AMOUNT'));
    const maxCents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
    if (maxCents <= 0) return setMsg(say('refused', 'The amount must be above zero.', false, 'INVALID_AMOUNT'));
    const ref = view.bidCount === 0 ? view.minNextCents : view.priceCents;
    if (maxCents > FAT_FINGER * ref) return setConfirm(maxCents);
    void send(maxCents);
  };

  const invalid = msg?.code === 'INVALID_AMOUNT';
  const min = formatCents(view.minNextCents);
  return (
    <form onSubmit={submit} aria-label="Place a bid">
      <p className="form-hint">Minimum next bid <b data-testid="min-next">{min}</b> · paddle {paddle}</p>
      <label>Your maximum ($) <input ref={input} name="max" inputMode="decimal" autoComplete="off" value={text} placeholder={min.slice(1)} aria-invalid={invalid || undefined} disabled={!!disabledReason} onChange={(e) => { setText(e.target.value); setConfirm(null); key.current = crypto.randomUUID(); }} /></label>
      <button type="submit" disabled={busy || !!disabledReason}>{busy ? 'Sending…' : 'Bid'}</button>
      {/* UX-08: one tap bids the minimum; the same key guards a double tap, as for the typed form (D-52 b) */}
      <button type="button" data-testid="bid-min" disabled={busy || !!disabledReason} onClick={() => void send(view.minNextCents)}>Bid {min}</button>
      <p className="form-hint form-explain">Enter the most you will pay. We bid for you, one step at a time, only as high as needed.</p>
      {disabledReason && <p className="form-hint" data-testid="bid-disabled">{disabledReason}</p>}
      {confirm !== null && (
        <div role="alertdialog" aria-labelledby="confirm-text" data-testid="confirm" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } }}>
          <p id="confirm-text">{formatCents(confirm)} is more than {FAT_FINGER}× the current price. Bid it?</p>
          <button ref={yes} type="button" onClick={() => void send(confirm)} disabled={busy}>Yes, bid {formatCents(confirm)}</button>{' '}
          <button type="button" onClick={cancel}>Cancel</button>
        </div>
      )}
      {/* A lead the poll has since overturned is stale; the board's outbid banner says what is true now. */}
      {msg && !(msg.tone === 'lead' && view.you === 'OUTBID') && (
        <p role="status" data-testid="bid-msg" className="callout" data-tone={msg.tone} data-code={msg.code}>
          <span className="badge" data-tone={msg.tone}>{msg.badge}</span> {msg.text}
        </p>
      )}
    </form>
  );
}
