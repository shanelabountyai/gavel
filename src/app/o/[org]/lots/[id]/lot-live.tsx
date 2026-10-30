'use client';
import { useEffect, useRef, useState } from 'react';
import { formatCents } from '@/auction/engine/money';
import type { LotView } from '@/auction/lot-view';
import { BidForm, type BidOk } from './bid-form';

type View = Omit<LotView, 'etag'>;
/** Who is looking (UX-03, UX-04): a bidder gets the form, a member without a paddle the register button, a bidder who has
 * not accepted the sale's terms the terms (D-72), staff none of these. */
export type Viewer = { kind: 'bidder'; paddle: number } | { kind: 'register' } | { kind: 'terms' } | { kind: 'staff'; historyHref: string | null; canWithdraw: boolean };
const NEAR_CLOSE_MS = 60_000; // D-47: poll every 1 s near the close, 2 s otherwise

// Polls /api/lots/[id]/state with the ETag. The countdown is closesAt minus the server's clock: the offset between the
// two clocks is measured from X-Server-Time on every response, so the client's own clock only ticks, it never decides.
export function LotLive({ slug, lotId, initial, etag: firstEtag, serverNowMs, viewer, children }: { slug: string; lotId: string; initial: View; etag: string; serverNowMs: number; viewer: Viewer; children?: React.ReactNode }) {
  const [view, setView] = useState(initial);
  const offset = useRef(0); // server clock minus client clock, ms; measured on every response
  const [serverNow, setServerNow] = useState(serverNowMs); // best estimate of the server's clock, advanced by the ticker
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let etag = firstEtag;
    let timer: ReturnType<typeof setTimeout>;
    let closesAt = Date.parse(initial.closesAt);
    let stop = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return; // UX-13: a visibilitychange during a poll lets that poll answer
      inFlight = true;
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
      inFlight = false;
      clearTimeout(timer);
      if (!stop) timer = setTimeout(poll, closesAt - (Date.now() + offset.current) < NEAR_CLOSE_MS ? 1000 : 2000);
    };
    // UX-13: a phone back from the lock screen asks now, not when its throttled timer gets around to it
    const onVisible = () => { if (document.visibilityState === 'visible') { clearTimeout(timer); void poll(); } };
    document.addEventListener('visibilitychange', onVisible);
    timer = setTimeout(poll, 1000);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the loop owns its state; it starts once
  }, [lotId]);

  useEffect(() => {
    offset.current = serverNowMs - Date.now();
    const t = setInterval(() => setServerNow(Date.now() + offset.current), 250);
    return () => clearInterval(t);
  }, [serverNowMs]);

  const closed = view.status === 'CLOSED';
  const scheduled = view.status === 'SCHEDULED';
  const withdrawn = view.withdrawnAt !== null; // D-73: closed from the withdrawal, never sold
  // A scheduled lot counts to its open, not its close (UX-02).
  const left = Math.max(0, Math.ceil((Date.parse(scheduled ? view.opensAt : view.closesAt) - serverNow) / 1000));
  const noBids = view.bidCount === 0;
  // A later closesAt than the last one seen means a late bid extended the lot; say so for a few seconds.
  const lastClose = useRef(Date.parse(initial.closesAt));
  const [extended, setExtended] = useState<{ ms: number; at: number } | null>(null);
  const [extCount, setExtCount] = useState(0); // extensions seen since the page opened (the view carries no count, D-50)
  // UX-12: one polite live region, one sentence per event, never a tick. The countdown itself is not live.
  const [announce, setAnnounce] = useState('');
  const said = useRef({ minute: false, closed: initial.status === 'CLOSED' }); // a lot opened closed is not an event
  useEffect(() => {
    const c = Date.parse(view.closesAt);
    if (c > lastClose.current) {
      setExtended({ ms: c - lastClose.current, at: c });
      setExtCount((n) => n + 1);
      setAnnounce(`Extended by a late bid; now closes in ${formatLeft(Math.max(0, Math.ceil((c - (Date.now() + offset.current)) / 1000)))}`);
    }
    lastClose.current = c;
  }, [view.closesAt]);
  useEffect(() => {
    if (!closed && !scheduled && left < 60 && !said.current.minute) { said.current.minute = true; setAnnounce('Under one minute left'); }
    if (closed && !said.current.closed) { said.current.closed = true; setAnnounce('Bidding has closed'); }
  }, [left, closed, scheduled]);
  useEffect(() => {
    if (!extended) return;
    const t = setTimeout(() => setExtended(null), 8000);
    return () => clearTimeout(t);
  }, [extended]);

  // UX-14: a judged bid's numbers go on the board at once. Status is left alone: a REJECTED_LOT_CLOSED answer means the
  // next poll will say closed. After any accepted bid the caller has a row, so `you` is always one of the two.
  const applyResult = (r: BidOk, sent: number) => setView((v) => ({
    ...v,
    priceCents: r.priceCents,
    minNextCents: r.minNextCents,
    bidCount: r.accepted ? v.bidCount + 1 : v.bidCount,
    you: r.accepted || v.you ? (r.youLead ? 'LEADING' : 'OUTBID') : v.you,
    yourMaxCents: r.accepted ? Math.max(v.yourMaxCents ?? 0, sent) : r.yourMaxCents ?? v.yourMaxCents,
  }));
  const utc = (iso: string) => `${iso.slice(0, 19).replace('T', ' ')} UTC`;
  return (
    <section className="board" data-phase={!closed && !scheduled && left < 60 ? 'final' : undefined} data-stale={stale || undefined} aria-label="Live lot">
      <p className="sr-only" role="status" aria-live="polite" data-testid="announce">{announce}</p>
      {stale && <p role="alert" className="callout" data-tone="warn"><span className="badge" data-tone="warn">Connection problem</span> Retrying; the numbers below may be out of date. You can still bid: the server judges the time.</p>}
      {closed && view.result && (
        <p className="board-you" data-result={view.result} data-testid="result" aria-live="polite">
          {view.result === 'WON' ? `You won this lot at ${formatCents(view.priceCents)}.` : view.result === 'NOT_WON' ? 'You did not win. This lot sold to another bidder.' : withdrawn ? 'This lot was withdrawn from the sale by the auction house. Your bids on it are void and nothing is owed.' : view.reserveMet ? 'You did not win. This lot closed unsold.' : 'You did not win: the reserve was not met.'}
          {!view.final && <span className="board-you-note">Final once the sale is settled.</span>}
        </p>
      )}
      {!closed && view.you && (
        <p className="board-you" data-you={view.you} aria-live="polite">
          <span data-testid="you">{view.you === 'LEADING' ? 'You are the high bidder.' : 'You have been outbid.'}</span>
          {view.yourMaxCents !== null && (
            <span className="board-you-note" data-testid="your-max">
              {view.you === 'LEADING' ? `Your maximum: ${formatCents(view.yourMaxCents)}.` : `Your maximum ${formatCents(view.yourMaxCents)} was exceeded.`}
            </span>
          )}
        </p>
      )}
      <div className="board-main">
        <p className="board-price">
          <span className="board-label">{noBids ? (closed ? 'No bids' : 'Opening bid') : closed ? 'Final price' : 'Current price'}</span>
          {/* AX-01, DS R-17: with no accepted bid the big number is the opening bid, never the state's 0 */}
          <b data-testid="price" aria-live="polite">{noBids ? (closed ? '—' : formatCents(view.minNextCents)) : formatCents(view.priceCents)}</b>
        </p>
        <p className="board-clock">
          <span className="board-label">{closed ? 'Status' : scheduled ? 'Opens in' : left < 60 ? 'Final minute' : 'Time left'}</span>
          {closed ? <b data-testid="status">{withdrawn ? 'Withdrawn' : 'Closed'}</b> : <b data-testid="countdown" data-seconds={left}>{formatLeft(left)}</b>}
          {stale && !closed && <span className="board-reconnect" data-testid="reconnecting">Reconnecting…</span>}
          {extended && <span key={extended.at} className="board-extended">Extended by a late bid, +{formatLeft(Math.round(extended.ms / 1000))}</span>}
          {!extended && extCount > 0 && <span className="board-extended board-ext-count" data-testid="ext-count">Extended {extCount === 1 ? 'once' : `${extCount} times`} since you opened this page</span>}
        </p>
      </div>
      {!closed && viewer.kind === 'bidder' && <BidForm slug={slug} lotId={lotId} view={view} paddle={viewer.paddle} disabledReason={scheduled ? `Bidding opens at ${utc(view.opensAt)}.` : undefined} onResult={applyResult} />}
      {!closed && (viewer.kind === 'register' || viewer.kind === 'terms') && <div className="board-panel" data-testid={viewer.kind === 'terms' ? 'terms-panel' : undefined}>{children}</div>}
      {viewer.kind === 'staff' && (
        <p className="board-panel" data-testid="staff-view">
          Staff view: staff accounts do not bid.{viewer.historyHref && <> <a href={viewer.historyHref}>Bid history</a></>}
        </p>
      )}
      {!closed && viewer.kind === 'staff' && viewer.canWithdraw && <div className="board-panel" data-testid="withdraw-panel">{children}</div>}
      {closed && viewer.kind !== 'staff' && <p className="board-panel">{withdrawn ? 'This lot was withdrawn from the sale.' : 'Bidding has closed on this lot.'}</p>}
      <dl className="board-facts">
        {!closed && <div><dt>Status</dt><dd data-testid="status">{scheduled ? 'Scheduled' : 'Open'}</dd></div>}
        <div><dt>Bids</dt><dd data-testid="bid-count">{view.bidCount}</dd></div>
        <div><dt>Reserve</dt><dd>{view.reserveMet ? 'Met' : 'Not met'}</dd></div>
        {scheduled && <div><dt>Opens</dt><dd><time dateTime={view.opensAt}>{utc(view.opensAt)}</time></dd></div>}
        <div><dt>{closed ? 'Closed' : 'Closes'}</dt><dd><time dateTime={view.closesAt} data-testid="closes-at">{utc(view.closesAt)}</time></dd></div>
        {withdrawn && <div><dt>Withdrawn</dt><dd><time dateTime={view.withdrawnAt!} data-testid="withdrawn-at">{utc(view.withdrawnAt!)}</time></dd></div>}
      </dl>
    </section>
  );
}

/** 0:42 under an hour, then 1 h 12 m, then 3 d 4 h. */
function formatLeft(s: number) {
  if (s >= 86_400) return `${Math.floor(s / 86_400)} d ${Math.floor((s % 86_400) / 3600)} h`;
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
