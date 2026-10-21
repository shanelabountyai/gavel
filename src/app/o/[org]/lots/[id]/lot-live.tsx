'use client';
import { useEffect, useRef, useState } from 'react';
import { formatCents } from '@/auction/engine/money';
import type { LotView } from '@/auction/lot-view';
import { BidForm } from './bid-form';

type View = Omit<LotView, 'etag'>;
const NEAR_CLOSE_MS = 60_000; // D-47: poll every 1 s near the close, 2 s otherwise

// Polls /api/lots/[id]/state with the ETag. The countdown is closesAt minus the server's clock: the offset between the
// two clocks is measured from X-Server-Time on every response, so the client's own clock only ticks, it never decides.
export function LotLive({ slug, lotId, initial, etag: firstEtag, serverNowMs }: { slug: string; lotId: string; initial: View; etag: string; serverNowMs: number }) {
  const [view, setView] = useState(initial);
  const offset = useRef(0); // server clock minus client clock, ms; measured on every response
  const [serverNow, setServerNow] = useState(serverNowMs); // best estimate of the server's clock, advanced by the ticker
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let etag = firstEtag;
    let timer: ReturnType<typeof setTimeout>;
    let closesAt = Date.parse(initial.closesAt);
    let stop = false;
    const poll = async () => {
      try {
        const r = await fetch(`/api/lots/${lotId}/state`, { headers: { 'If-None-Match': etag }, cache: 'no-store' });
        const server = Number(r.headers.get('x-server-time'));
        if (server) offset.current = server - Date.now();
        if (r.status === 200) {
          const v: View = await r.json();
          etag = r.headers.get('etag') ?? etag;
          closesAt = Date.parse(v.closesAt);
          setView(v);
        }
        setStale(r.status !== 200 && r.status !== 304);
      } catch {
        setStale(true);
      }
      if (!stop) timer = setTimeout(poll, closesAt - (Date.now() + offset.current) < NEAR_CLOSE_MS ? 1000 : 2000);
    };
    timer = setTimeout(poll, 1000);
    return () => { stop = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the loop owns its state; it starts once
  }, [lotId]);

  useEffect(() => {
    offset.current = serverNowMs - Date.now();
    const t = setInterval(() => setServerNow(Date.now() + offset.current), 250);
    return () => clearInterval(t);
  }, [serverNowMs]);

  const left = Math.max(0, Math.ceil((Date.parse(view.closesAt) - serverNow) / 1000));
  const closed = view.status === 'CLOSED';
  return (
    <section aria-live="polite">
      {stale && <p role="alert">Connection problem; retrying.</p>}
      <p>Status: <span data-testid="status">{view.status}</span></p>
      <p>Current price: <span data-testid="price">{view.bidCount === 0 ? 'No bids' : formatCents(view.priceCents)}</span></p>
      {!closed && <p>Next minimum bid: <span data-testid="min-next">{formatCents(view.minNextCents)}</span></p>}
      <p>Bids: <span data-testid="bid-count">{view.bidCount}</span></p>
      <p>Reserve: {view.reserveMet ? 'met' : 'not met'}</p>
      {view.you && <p data-testid="you">{view.you === 'LEADING' ? 'You are the high bidder.' : 'You have been outbid.'}</p>}
      <p>{closed ? 'Closed' : <>Time left: <span data-testid="countdown">{left}</span> s</>}</p>
      {!closed && <BidForm slug={slug} lotId={lotId} view={view} />}
      <p>Closes (UTC): <span data-testid="closes-at">{view.closesAt}</span></p>
    </section>
  );
}
