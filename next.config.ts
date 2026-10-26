import type { NextConfig } from 'next';

// INV-15: on every response. HSTS is inert over http (localhost) and enforced in production.
const securityHeaders = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const config: NextConfig = {
  // The generated Prisma client and the pg driver stay on the server.
  serverExternalPackages: ['@prisma/client', 'pg'],
  // D-64: load-rules.ts reads rules/auction.v1.json at runtime, which the tracer cannot see; without this the
  // deployed functions have no rules file and every bid, lot and settlement throws ENOENT.
  outputFileTracingIncludes: { '/**': ['rules/auction.v1.json'] },
  poweredByHeader: false,
  headers: async () => [
    { source: '/:path*', headers: securityHeaders },
    // Share pages (spec §7c). Listed last, so its Referrer-Policy overrides the global one:
    // the token in the URL must never leave in a Referer header.
    {
      source: '/s/:path*',
      headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
      ],
    },
  ],
};

export default config;
