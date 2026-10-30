import { closesIn } from '@/auction/time-left';
/** R21: relative on the page, exact UTC in the title and dateTime, for the catalog and Your bids. Server-rendered: it is as fresh as the page load. */
export function ClosesAt({ at, nowMs }: { at: Date; nowMs: number }) {
  const iso = at.toISOString();
  return <time dateTime={iso} title={`${iso.slice(0, 16).replace('T', ' ')} UTC`}>{closesIn(Math.max(0, Math.ceil((at.getTime() - nowMs) / 1000)))}</time>;
}
