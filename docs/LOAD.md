# LOAD

Every throughput number Gavel quotes comes from `npm run load:bids` (D-19, D-24) and is appended here by the script with the hardware it ran on. Nothing in this file is typed by hand. Newest run last.

## 2026-10-20T01:50:26.585Z — `1ad8c4f`

`2026-10-20T01:50:26.585Z 1ad8c4f: 200 writers, 40 connections, 4 lots, 10 s + soft close: 68360 ledger rows in 15.9 s = 4293 bids/s; placeBid p50 5.1 / p95 28.9 / p99 68.7 ms; end to end p50 41.7 / p95 77.1 / p99 113.2 ms; max lock wait 204.4 ms; 0 timeouts; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- ` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 68360 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Outcomes: ACCEPTED_LEAD 3887, ACCEPTED_OUTBID 321, ACCEPTED_RAISE 23, REJECTED_BELOW_MINIMUM 63919, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 10.
- Bids per second: 4292.9 over 15.92 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 5.1 ms, p95 28.9 ms, p99 68.7 ms, max 212.7 ms, n = 68360.
- Latency end to end including the wait for one of the 40 pooled connections: p50 41.7 ms, p95 77.1 ms, p99 113.2 ms.
- Max lock wait seen: 204.4 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 17059/1064/15651000/401, 17120/1054/15675000/396, 17102/1061/15700000/401, 17079/1052/15576000/398; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 1ad8c4f; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 42 lots (42 settled), V1–V9
