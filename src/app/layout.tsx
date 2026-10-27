// public: the root shell; renders no data
import { Libre_Franklin } from 'next/font/google';
import './globals.css';

export const metadata = { title: { default: 'Gavel', template: '%s · Gavel' } };

const franklin = Libre_Franklin({ subsets: ['latin'], weight: ['400', '600', '700', '800'], variable: '--font-franklin' });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={franklin.variable}>
      <body>
        {children}
        <footer className="scope">
          <p>Scope honesty: learning project, synthetic data only. No real sale, consignor, buyer or money. Nothing is paid: settlement produces a mock invoice and stops. The bid rules are one house&apos;s conventions written down as data, not an industry standard, and no claim is made about any state&apos;s auction law.</p>
        </footer>
      </body>
    </html>
  );
}
