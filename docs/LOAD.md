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
## 2026-10-21T14:33:53.614Z — `7430fb4`

`2026-10-21T14:33:53.614Z 7430fb4: 200 writers, 40 connections, 4 lots, 10 s + soft close: 82620 ledger rows in 15.9 s = 5203 bids/s; placeBid p50 6.4 / p95 17.2 / p99 25.6 ms; end to end p50 35.7 / p95 50.1 / p99 95.5 ms; max lock wait 487.0 ms; 0 timeouts; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- ` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 82620 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Outcomes: ACCEPTED_LEAD 4483, ACCEPTED_OUTBID 466, ACCEPTED_RAISE 58, REJECTED_BELOW_MINIMUM 77389, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 24.
- Bids per second: 5203.4 over 15.88 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 6.4 ms, p95 17.2 ms, p99 25.6 ms, max 505.9 ms, n = 82620.
- Latency end to end including the wait for one of the 40 pooled connections: p50 35.7 ms, p95 50.1 ms, p99 95.5 ms.
- Max lock wait seen: 487.0 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 20645/1254/20775000/510, 20628/1253/20625000/508, 20651/1252/20727000/487, 20696/1248/20675000/496; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 7430fb4; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 4 lots (4 settled), V1–V9
- Task 3.6 (D-53): every leader change also writes one `Outbox` row under the lot lock (one INSERT … SELECT joining Bidder → User and Lot). This run wrote 4479 outbid rows, equal to the rows with `leaderBeforeId` set and changed, and 4 won rows at settlement. Against the 1ad8c4f line (same hardware, same command) throughput and p95 are better and max lock wait is worse; the write's cost is inside run-to-run variance, not a measured saving.
## 2026-10-21T15:20:18.335Z — `8d713eb`

`2026-10-21T15:20:18.335Z 8d713eb: HTTP, 200 writers, server Prisma pool connection_limit=10, 4 lots, 10 s + soft close: 16164 ledger rows in 15.9 s = 1016 bids/s; HTTP round trip p50 168.0 / p95 354.5 / p99 477.0 ms; max lock wait 43.8 ms; 0 timeouts (503); Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --http http://localhost:6100` → writers 200, lots 4, seconds 10, against `npm run e2e:server` (production build, same .env.test database); soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 16164 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Outcomes: ACCEPTED_LEAD 792, ACCEPTED_OUTBID 87, ACCEPTED_RAISE 26, REJECTED_BELOW_MINIMUM 15052, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 7.
- Bids per second: 1016.3 over 15.91 s from the first attempt's start to the last attempt's end.
- Latency is the HTTP round trip of POST /api/lots/[id]/bids (session cookie → requireUser → placeBid under the lock → JSON), one keep-alive socket per writer, the server's Prisma pool capped at connection_limit=10: p50 168.0 / p95 354.5 / p99 477.0 ms, max 528.2 ms, n = 16164.
- Beside it, the latest in-process line (same hardware, no HTTP): `2026-10-21T14:33:53.614Z 7430fb4: 200 writers, 40 connections, 4 lots, 10 s + soft close: 82620 ledger rows in 15.9 s = 5203 bids/s; placeBid p50 6.4 / p95 17.2 / p99 25.6 ms; end to end p50 35.7 / p95 50.1 / p99 95.5 ms; max lock wait 487.0 ms; 0 timeouts; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`
- Max lock wait seen: 43.8 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 4043/226/347500/80, 4041/230/345000/86, 4042/226/342500/85, 4038/223/340100/82; settled 8.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 8d713eb; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 10 lots (8 settled), V1–V9
## 2026-10-21T20:51:50.357Z — `31910a5`

`2026-10-21T20:51:50.357Z 31910a5: HTTP, 200 writers, server Prisma pool connection_limit=40, 4 lots, 10 s + soft close: 14855 ledger rows in 16.0 s = 931 bids/s; HTTP round trip p50 202.4 / p95 282.1 / p99 307.5 ms; max lock wait 26.7 ms; 0 timeouts (503); Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --http http://localhost:6100` → writers 200, lots 4, seconds 10, against `npm run e2e:server` (production build, same .env.test database); soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 14855 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Outcomes: ACCEPTED_LEAD 749, ACCEPTED_OUTBID 71, ACCEPTED_RAISE 21, REJECTED_BELOW_MINIMUM 13807, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 7.
- Bids per second: 931.0 over 15.96 s from the first attempt's start to the last attempt's end.
- Latency is the HTTP round trip of POST /api/lots/[id]/bids (session cookie → requireUser → placeBid under the lock → JSON), one keep-alive socket per writer, the server's Prisma pool capped at connection_limit=40: p50 202.4 / p95 282.1 / p99 307.5 ms, max 435.4 ms, n = 14855.
- Beside it, the latest in-process line (same hardware, no HTTP): `2026-10-21T14:33:53.614Z 7430fb4: 200 writers, 40 connections, 4 lots, 10 s + soft close: 82620 ledger rows in 15.9 s = 5203 bids/s; placeBid p50 6.4 / p95 17.2 / p99 25.6 ms; end to end p50 35.7 / p95 50.1 / p99 95.5 ms; max lock wait 487.0 ms; 0 timeouts; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`
- Beside it, the latest earlier HTTP line: `2026-10-21T15:20:18.335Z 8d713eb: HTTP, 200 writers, server Prisma pool connection_limit=10, 4 lots, 10 s + soft close: 16164 ledger rows in 15.9 s = 1016 bids/s; HTTP round trip p50 168.0 / p95 354.5 / p99 477.0 ms; max lock wait 43.8 ms; 0 timeouts (503); Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`
- Max lock wait seen: 26.7 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 3713/212/307500/86, 3711/208/295100/85, 3717/211/302500/89, 3714/210/300000/87; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 31910a5; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=40).
- auction:verify: OK, 45 lots (45 settled), V1–V9
## 2026-10-22T01:29:35.750Z — `3bac4cf`

`2026-10-22T01:29:35.750Z 3bac4cf: lock=row, 200 writers, 40 connections, 4 lots, 10 s + soft close: 58545 ledger rows in 16.0 s = 3657 bids/s; placeBid p50 5.8 / p95 34.0 / p99 70.1 ms; end to end p50 45.9 / p95 98.8 / p99 198.4 ms; max lock wait 627.6 ms; 0 timeouts; 1.000 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock row` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 58545 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Lock strategy: row; judgements 58545 for 58545 ledger rows (1.000 per row); conflicts 0.
- Outcomes: ACCEPTED_LEAD 3294, ACCEPTED_OUTBID 294, ACCEPTED_RAISE 23, REJECTED_BELOW_MINIMUM 54720, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 14.
- Bids per second: 3656.5 over 16.01 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 5.8 ms, p95 34.0 ms, p99 70.1 ms, max 688.1 ms, n = 58545.
- Latency end to end including the wait for one of the 40 pooled connections: p50 45.9 ms, p95 98.8 ms, p99 198.4 ms.
- Max lock wait seen: 627.6 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 14633/909/11800000/376, 14624/903/11675000/377, 14652/902/11775000/373, 14636/897/11700000/363; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 3bac4cf; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 5 lots (4 settled), V1–V9
## 2026-10-22T01:29:53.206Z — `3bac4cf`

`2026-10-22T01:29:53.206Z 3bac4cf: lock=advisory, 200 writers, 40 connections, 4 lots, 10 s + soft close: 55815 ledger rows in 15.9 s = 3504 bids/s; placeBid p50 10.3 / p95 17.6 / p99 29.7 ms; end to end p50 52.7 / p95 84.7 / p99 125.5 ms; max lock wait 65.9 ms; 0 timeouts; 1.000 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock advisory` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 55815 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Lock strategy: advisory; judgements 55815 for 55815 ledger rows (1.000 per row); conflicts 0.
- Outcomes: ACCEPTED_LEAD 2909, ACCEPTED_OUTBID 213, ACCEPTED_RAISE 50, REJECTED_BELOW_MINIMUM 52431, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 12.
- Bids per second: 3504.2 over 15.93 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 10.3 ms, p95 17.6 ms, p99 29.7 ms, max 93.3 ms, n = 55815.
- Latency end to end including the wait for one of the 40 pooled connections: p50 52.7 ms, p95 84.7 ms, p99 125.5 ms.
- Max lock wait seen: 65.9 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 13954/791/9025000/309, 13964/798/9000000/301, 13947/794/8950000/304, 13950/789/8875000/310; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 3bac4cf; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 9 lots (8 settled), V1–V9
## 2026-10-22T01:30:11.011Z — `3bac4cf`

`2026-10-22T01:30:11.011Z 3bac4cf: lock=version, 200 writers, 40 connections, 4 lots, 10 s + soft close: 43090 ledger rows in 15.9 s = 2705 bids/s; placeBid p50 12.1 / p95 32.9 / p99 60.5 ms; end to end p50 65.8 / p95 116.2 / p99 227.7 ms; max lock wait 141.0 ms; 0 timeouts; 2.439 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock version` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 43090 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Lock strategy: version; judgements 105115 for 43090 ledger rows (2.439 per row); version conflicts (guarded UPDATE matched 0 rows) 62025.
- Outcomes: ACCEPTED_LEAD 2294, ACCEPTED_OUTBID 170, ACCEPTED_RAISE 26, REJECTED_BELOW_MINIMUM 40386, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 14.
- Bids per second: 2705.3 over 15.93 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 12.1 ms, p95 32.9 ms, p99 60.5 ms, max 152.7 ms, n = 43090.
- Latency end to end including the wait for one of the 40 pooled connections: p50 65.8 ms, p95 116.2 ms, p99 227.7 ms.
- Max lock wait seen: 141.0 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 10749/615/4525000/206, 10790/628/4725000/204, 10749/620/4650000/204, 10802/627/4700000/207; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 3bac4cf; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 13 lots (12 settled), V1–V9
## 2026-10-22T01:30:28.894Z — `3bac4cf`

`2026-10-22T01:30:28.894Z 3bac4cf: lock=serializable, 200 writers, 40 connections, 4 lots, 10 s + soft close: 27969 ledger rows in 9.8 s = 2841 bids/s; placeBid p50 1.2 / p95 2.1 / p99 12.1 ms; end to end p50 1.2 / p95 2.1 / p99 23.4 ms; max lock wait 0.0 ms; 0 timeouts; 1.009 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock serializable` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 27969 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 196).
- Lock strategy: serializable; judgements 28226 for 27969 ledger rows (1.009 per row); 40001 retries 61.
- Outcomes: ACCEPTED_LEAD 10, ACCEPTED_OUTBID 2, ACCEPTED_RAISE 10, REJECTED_BELOW_MINIMUM 42, REJECTED_LOT_CLOSED 4, REJECTED_NOT_ABOVE_OWN_MAX 27901.
- Bids per second: 2841.1 over 9.84 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 1.2 ms, p95 2.1 ms, p99 12.1 ms, max 89.5 ms, n = 28165.
- Latency end to end including the wait for one of the 40 pooled connections: p50 1.2 ms, p95 2.1 ms, p99 23.4 ms.
- Max lock wait seen: 0.0 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 7001/6/11500/0, 6989/6/11000/0, 6987/5/11000/0, 6992/5/11500/0; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 3bac4cf; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 17 lots (16 settled), V1–V9
## 2026-10-22T01:31:07.499Z — `2117f5d`

`2026-10-22T01:31:07.499Z 2117f5d: lock=serializable, 200 writers, 40 connections, 4 lots, 10 s + soft close: 20418 ledger rows in 16.1 s = 1272 bids/s; placeBid p50 13.0 / p95 92.1 / p99 171.1 ms; end to end p50 137.1 / p95 226.1 / p99 307.6 ms; max lock wait 165.9 ms; 1667 timeouts; 6.431 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock serializable` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 20418 (N attempts, N rows; timeouts resent with the same key: 1667; writer failures: 0).
- Lock strategy: serializable; judgements 131300 for 20418 ledger rows (6.431 per row); 40001 retries 129; seq-index 23505 retries 110753.
- Outcomes: ACCEPTED_LEAD 1209, ACCEPTED_OUTBID 128, ACCEPTED_RAISE 19, REJECTED_BELOW_MINIMUM 18853, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 9.
- Bids per second: 1271.6 over 16.06 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 13.0 ms, p95 92.1 ms, p99 171.1 ms, max 453.7 ms, n = 22085.
- Latency end to end including the wait for one of the 40 pooled connections: p50 137.1 ms, p95 226.1 ms, p99 307.6 ms.
- Max lock wait seen: 165.9 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 5122/336/775000/138, 5142/347/776000/144, 5123/338/775000/140, 5031/335/765100/137; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 2117f5d; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 21 lots (20 settled), V1–V9
## 2026-10-22T01:31:34.887Z — `2117f5d`

`2026-10-22T01:31:34.887Z 2117f5d: lock=row, 200 writers, 40 connections, 4 lots, 10 s + soft close: 66816 ledger rows in 15.9 s = 4200 bids/s; placeBid p50 5.3 / p95 29.2 / p99 52.6 ms; end to end p50 43.9 / p95 75.1 / p99 100.0 ms; max lock wait 127.2 ms; 0 timeouts; 1.000 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock row` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 66816 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Lock strategy: row; judgements 66816 for 66816 ledger rows (1.000 per row); conflicts 0.
- Outcomes: ACCEPTED_LEAD 3763, ACCEPTED_OUTBID 313, ACCEPTED_RAISE 39, REJECTED_BELOW_MINIMUM 62486, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 15.
- Bids per second: 4199.7 over 15.91 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 5.3 ms, p95 29.2 ms, p99 52.6 ms, max 143.0 ms, n = 66816.
- Latency end to end including the wait for one of the 40 pooled connections: p50 43.9 ms, p95 75.1 ms, p99 100.0 ms.
- Max lock wait seen: 127.2 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 16719/1031/14875000/363, 16713/1018/14900000/359, 16687/1033/15025000/367, 16697/1033/14975000/368; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 2117f5d; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 25 lots (24 settled), V1–V9
