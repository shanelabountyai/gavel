// public: the landing page
import Link from 'next/link';
import { demoEnabled } from '@/core/auth/demo';

export const dynamic = 'force-dynamic'; // reads DEMO_MODE per request, never baked in at build

export default function Home() {
  return (
    <main>
      <h1>Gavel</h1>
      <p>Timed online auctions for estates and equipment: proxy bidding, soft close, every bid judged under one row lock and kept in an append-only ledger.</p>
      <p>Learning project, synthetic data only. Every auction house, estate, lot, bidder and bid is generated from a seed. No real sale, consignor, buyer or money. Nothing is paid: settlement produces a mock invoice and stops. The bid rules are one house&apos;s conventions written down as data, not an industry standard, and no claim is made about any state&apos;s auction law.</p>
      <Link href="/login">Sign in</Link>
      {demoEnabled() && <> · <Link href="/demo">Demo accounts</Link></>}
      <footer>
        <Link href="/legal/privacy">Privacy</Link> · <Link href="/legal/terms">Terms</Link>
      </footer>
    </main>
  );
}
