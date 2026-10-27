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
  // A later closesAt than the last one seen means a late bid extended the lot; say so for a few seconds.
  const lastClose = useRef(Date.parse(initial.closesAt));
  const [extended, setExtended] = useState<{ ms: number; at: number } | null>(null);
  useEffect(() => {
    const c = Date.parse(view.closesAt);
    if (c > lastClose.current) setExtended({ ms: c - lastClose.current, at: c });
    lastClose.current = c;
  }, [view.closesAt]);
  useEffect(() => {
    if (!extended) return;
    const t = setTimeout(() => setExtended(null), 8000);
    return () => clearTimeout(t);
  }, [extended]);

  return (
    <section className="board" data-phase={!closed && left < 60 ? 'final' : undefined} aria-label="Live lot">
      {stale && <p role="alert" className="board-closed">Connection problem; retrying.</p>}
      {view.you && (
        <p className="board-you" data-you={view.you} data-testid="you" aria-live="polite">
          {view.you === 'LEADING' ? 'You are the high bidder.' : 'You have been outbid.'}
        </p>
      )}
      <div className="board-main">
        <p className="board-price">
          <span className="board-label">{closed ? 'Final price' : 'Current price'}</span>
          <b data-testid="price" aria-live="polite">{view.bidCount === 0 ? 'No bids' : formatCents(view.priceCents)}</b>
        </p>
        <p className="board-clock">
          <span className="board-label">{closed ? 'Status' : 'Time left'}</span>
          {closed ? <b data-testid="status">Closed</b> : <b data-testid="countdown" data-seconds={left}>{formatLeft(left)}</b>}
          {extended && <span key={extended.at} className="board-extended">Extended by a late bid, +{formatLeft(Math.round(extended.ms / 1000))}</span>}
        </p>
      </div>
      <dl className="board-facts">
        {!closed && <div><dt>Status</dt><dd data-testid="status">{view.status === 'OPEN' ? 'Open' : 'Not open yet'}</dd></div>}
        {!closed && <div><dt>Minimum next bid</dt><dd data-testid="min-next">{formatCents(view.minNextCents)}</dd></div>}
        <div><dt>Bids</dt><dd data-testid="bid-count">{view.bidCount}</dd></div>
        <div><dt>Reserve</dt><dd>{view.reserveMet ? 'Met' : 'Not met'}</dd></div>
        <div><dt>Closes</dt><dd><time dateTime={view.closesAt} data-testid="closes-at">{view.closesAt.slice(0, 19).replace('T', ' ')} UTC</time></dd></div>
      </dl>
      {closed ? <p className="board-closed">Bidding has closed on this lot.</p> : <BidForm slug={slug} lotId={lotId} view={view} />}
    </section>
  );
}

/** 0:42 under an hour, then 1 h 12 m, then 3 d 4 h. */
function formatLeft(s: number) {
  if (s >= 86_400) return `${Math.floor(s / 86_400)} d ${Math.floor((s % 86_400) / 3600)} h`;
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
