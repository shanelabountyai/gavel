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
## 2026-10-22T15:55:20.518Z — `05f024f`

`2026-10-22T15:55:20.518Z 05f024f: lock=row, 200 writers, 40 connections, 4 lots, 10 s + soft close: 80068 ledger rows in 15.9 s = 5038 bids/s; placeBid p50 5.0 / p95 22.1 / p99 35.2 ms; end to end p50 37.1 / p95 56.8 / p99 72.4 ms; max lock wait 64.2 ms; 0 timeouts; 1.000 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock row` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 80068 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Lock strategy: row; judgements 80068 for 80068 ledger rows (1.000 per row); conflicts 0.
- Outcomes: ACCEPTED_LEAD 4427, ACCEPTED_OUTBID 424, ACCEPTED_RAISE 43, REJECTED_BELOW_MINIMUM 74945, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 29.
- Bids per second: 5037.7 over 15.89 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 5.0 ms, p95 22.1 ms, p99 35.2 ms, max 108.6 ms, n = 80068.
- Latency end to end including the wait for one of the 40 pooled connections: p50 37.1 ms, p95 56.8 ms, p99 72.4 ms.
- Max lock wait seen: 64.2 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 20022/1220/19900000/437, 20001/1219/20050000/454, 20014/1232/20075000/456, 20031/1223/19950000/455; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 05f024f; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 88 lots (88 settled), V1–V9
## 2026-10-22T15:55:51.542Z — `05f024f`

`2026-10-22T15:55:51.542Z 05f024f: lock=advisory, 200 writers, 40 connections, 4 lots, 10 s + soft close: 75152 ledger rows in 15.9 s = 4723 bids/s; placeBid p50 8.4 / p95 10.3 / p99 13.2 ms; end to end p50 42.5 / p95 49.4 / p99 61.0 ms; max lock wait 12.3 ms; 0 timeouts; 1.000 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock advisory` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 75152 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Lock strategy: advisory; judgements 75152 for 75152 ledger rows (1.000 per row); conflicts 0.
- Outcomes: ACCEPTED_LEAD 4056, ACCEPTED_OUTBID 210, ACCEPTED_RAISE 31, REJECTED_BELOW_MINIMUM 70644, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 11.
- Bids per second: 4722.9 over 15.91 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 8.4 ms, p95 10.3 ms, p99 13.2 ms, max 73.0 ms, n = 75152.
- Latency end to end including the wait for one of the 40 pooled connections: p50 42.5 ms, p95 49.4 ms, p99 61.0 ms.
- Max lock wait seen: 12.3 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 18794/1081/15950000/395, 18782/1070/15851000/394, 18796/1074/15875000/395, 18780/1072/15925000/393; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 05f024f; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 92 lots (92 settled), V1–V9
## 2026-10-22T15:56:52.544Z — `05f024f`

`2026-10-22T15:56:52.544Z 05f024f: lock=version, 200 writers, 40 connections, 4 lots, 10 s + soft close: 62416 ledger rows in 15.9 s = 3925 bids/s; placeBid p50 10.1 / p95 12.9 / p99 17.3 ms; end to end p50 51.3 / p95 60.1 / p99 70.4 ms; max lock wait 18.4 ms; 0 timeouts; 2.449 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock version` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 62416 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Lock strategy: version; judgements 152862 for 62416 ledger rows (2.449 per row); version conflicts (guarded UPDATE matched 0 rows) 90446.
- Outcomes: ACCEPTED_LEAD 3359, ACCEPTED_OUTBID 190, ACCEPTED_RAISE 28, REJECTED_BELOW_MINIMUM 58628, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 11.
- Bids per second: 3925.2 over 15.90 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 10.1 ms, p95 12.9 ms, p99 17.3 ms, max 65.8 ms, n = 62416.
- Latency end to end including the wait for one of the 40 pooled connections: p50 51.3 ms, p95 60.1 ms, p99 70.4 ms.
- Max lock wait seen: 18.4 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 15604/895/11475000/326, 15611/895/11450000/326, 15613/893/11375000/324, 15588/894/11400000/327; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 05f024f; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 96 lots (96 settled), V1–V9
## 2026-10-22T15:57:33.608Z — `05f024f`

`2026-10-22T15:57:33.608Z 05f024f: lock=serializable, 200 writers, 40 connections, 4 lots, 10 s + soft close: 22418 ledger rows in 16.0 s = 1401 bids/s; placeBid p50 15.5 / p95 71.7 / p99 90.2 ms; end to end p50 120.1 / p95 177.9 / p99 205.2 ms; max lock wait 10.6 ms; 2376 timeouts; 7.492 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock serializable` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 22418 (N attempts, N rows; timeouts resent with the same key: 2376; writer failures: 0).
- Lock strategy: serializable; judgements 167965 for 22418 ledger rows (7.492 per row); 40001 retries 105; seq-index 23505 retries 145442.
- Outcomes: ACCEPTED_LEAD 1350, ACCEPTED_OUTBID 163, ACCEPTED_RAISE 19, REJECTED_BELOW_MINIMUM 20679, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 7.
- Bids per second: 1401.0 over 16.00 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 15.5 ms, p95 71.7 ms, p99 90.2 ms, max 176.9 ms, n = 24794.
- Latency end to end including the wait for one of the 40 pooled connections: p50 120.1 ms, p95 177.9 ms, p99 205.2 ms.
- Max lock wait seen: 10.6 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 5605/385/960000/144, 5597/381/970000/145, 5579/386/970000/145, 5637/380/970000/140; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 05f024f; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 100 lots (100 settled), V1–V9
## 2026-10-22T16:00:35.622Z — `05f024f`

`2026-10-22T16:00:35.622Z 05f024f: lock=row, 200 writers, 40 connections, 4 lots, 10 s + soft close: 71270 ledger rows in 15.9 s = 4482 bids/s; placeBid p50 7.1 / p95 22.9 / p99 39.9 ms; end to end p50 41.4 / p95 69.1 / p99 97.7 ms; max lock wait 129.6 ms; 0 timeouts; 1.000 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock row` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 71270 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Lock strategy: row; judgements 71270 for 71270 ledger rows (1.000 per row); conflicts 0.
- Outcomes: ACCEPTED_LEAD 3924, ACCEPTED_OUTBID 367, ACCEPTED_RAISE 30, REJECTED_BELOW_MINIMUM 66740, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 9.
- Bids per second: 4482.3 over 15.90 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 7.1 ms, p95 22.9 ms, p99 39.9 ms, max 146.7 ms, n = 71270.
- Latency end to end including the wait for one of the 40 pooled connections: p50 41.4 ms, p95 69.1 ms, p99 97.7 ms.
- Max lock wait seen: 129.6 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 17819/1073/16275000/388, 17834/1088/16350000/400, 17819/1089/16225000/400, 17798/1071/16100000/393; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 05f024f; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 104 lots (104 settled), V1–V9
## 2026-10-22T16:02:37.866Z — `05f024f`

`2026-10-22T16:02:37.866Z 05f024f: lock=advisory, 200 writers, 40 connections, 4 lots, 10 s + soft close: 75481 ledger rows in 15.9 s = 4747 bids/s; placeBid p50 8.4 / p95 10.1 / p99 13.1 ms; end to end p50 42.2 / p95 47.5 / p99 66.9 ms; max lock wait 26.0 ms; 0 timeouts; 1.000 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock advisory` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 75481 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Lock strategy: advisory; judgements 75481 for 75481 ledger rows (1.000 per row); conflicts 0.
- Outcomes: ACCEPTED_LEAD 3986, ACCEPTED_OUTBID 262, ACCEPTED_RAISE 42, REJECTED_BELOW_MINIMUM 70964, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 27.
- Bids per second: 4747.4 over 15.90 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 8.4 ms, p95 10.1 ms, p99 13.1 ms, max 69.2 ms, n = 75481.
- Latency end to end including the wait for one of the 40 pooled connections: p50 42.2 ms, p95 47.5 ms, p99 66.9 ms.
- Max lock wait seen: 26.0 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 18842/1076/15975000/390, 18856/1074/15950000/387, 18883/1062/16100000/387, 18900/1078/16100500/384; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 05f024f; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 108 lots (108 settled), V1–V9
## 2026-10-22T16:03:20.976Z — `05f024f`

`2026-10-22T16:03:20.976Z 05f024f: lock=version, 200 writers, 40 connections, 4 lots, 10 s + soft close: 61730 ledger rows in 15.9 s = 3881 bids/s; placeBid p50 10.1 / p95 13.3 / p99 18.9 ms; end to end p50 51.5 / p95 60.7 / p99 87.2 ms; max lock wait 39.3 ms; 0 timeouts; 2.444 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock version` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 61730 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Lock strategy: version; judgements 150845 for 61730 ledger rows (2.444 per row); version conflicts (guarded UPDATE matched 0 rows) 89115.
- Outcomes: ACCEPTED_LEAD 3268, ACCEPTED_OUTBID 212, ACCEPTED_RAISE 35, REJECTED_BELOW_MINIMUM 58001, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 14.
- Bids per second: 3881.4 over 15.90 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 10.1 ms, p95 13.3 ms, p99 18.9 ms, max 80.6 ms, n = 61730.
- Latency end to end including the wait for one of the 40 pooled connections: p50 51.5 ms, p95 60.7 ms, p99 87.2 ms.
- Max lock wait seen: 39.3 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 15458/872/11200000/304, 15404/885/11075000/314, 15435/878/11075000/311, 15433/880/11075000/315; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 05f024f; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 112 lots (112 settled), V1–V9
## 2026-10-22T16:05:24.094Z — `05f024f`

`2026-10-22T16:05:24.094Z 05f024f: lock=serializable, 200 writers, 40 connections, 4 lots, 10 s + soft close: 21492 ledger rows in 16.0 s = 1345 bids/s; placeBid p50 16.5 / p95 73.6 / p99 89.1 ms; end to end p50 125.6 / p95 186.8 / p99 213.0 ms; max lock wait 10.9 ms; 2449 timeouts; 7.721 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock serializable` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 21492 (N attempts, N rows; timeouts resent with the same key: 2449; writer failures: 0).
- Lock strategy: serializable; judgements 165945 for 21492 ledger rows (7.721 per row); 40001 retries 0; seq-index 23505 retries 144453.
- Outcomes: ACCEPTED_LEAD 1284, ACCEPTED_OUTBID 146, ACCEPTED_RAISE 23, REJECTED_BELOW_MINIMUM 19833, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 6.
- Bids per second: 1344.8 over 15.98 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 16.5 ms, p95 73.6 ms, p99 89.1 ms, max 175.5 ms, n = 23941.
- Latency end to end including the wait for one of the 40 pooled connections: p50 125.6 ms, p95 186.8 ms, p99 213.0 ms.
- Max lock wait seen: 10.9 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 5367/363/885000/135, 5368/359/885000/136, 5358/366/885000/134, 5399/365/915000/133; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 05f024f; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 116 lots (116 settled), V1–V9
## 2026-10-22T16:06:37.262Z — `05f024f`

`2026-10-22T16:06:37.262Z 05f024f: lock=row, 200 writers, 40 connections, 4 lots, 10 s + soft close: 80884 ledger rows in 15.9 s = 5094 bids/s; placeBid p50 5.1 / p95 21.6 / p99 34.5 ms; end to end p50 37.0 / p95 55.0 / p99 69.3 ms; max lock wait 71.6 ms; 0 timeouts; 1.000 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock row` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 80884 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Lock strategy: row; judgements 80884 for 80884 ledger rows (1.000 per row); conflicts 0.
- Outcomes: ACCEPTED_LEAD 4537, ACCEPTED_OUTBID 383, ACCEPTED_RAISE 36, REJECTED_BELOW_MINIMUM 75711, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 17.
- Bids per second: 5093.7 over 15.88 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 5.1 ms, p95 21.6 ms, p99 34.5 ms, max 83.8 ms, n = 80884.
- Latency end to end including the wait for one of the 40 pooled connections: p50 37.0 ms, p95 55.0 ms, p99 69.3 ms.
- Max lock wait seen: 71.6 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 20218/1238/20325000/463, 20204/1241/20250000/461, 20232/1240/20350000/460, 20230/1237/20200000/454; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 05f024f; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 120 lots (120 settled), V1–V9
## 2026-10-22T16:07:30.769Z — `05f024f`

`2026-10-22T16:07:30.769Z 05f024f: lock=advisory, 200 writers, 40 connections, 4 lots, 10 s + soft close: 74551 ledger rows in 15.9 s = 4690 bids/s; placeBid p50 8.5 / p95 10.3 / p99 13.6 ms; end to end p50 42.7 / p95 48.6 / p99 61.2 ms; max lock wait 36.0 ms; 0 timeouts; 1.000 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock advisory` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 74551 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Lock strategy: advisory; judgements 74551 for 74551 ledger rows (1.000 per row); conflicts 0.
- Outcomes: ACCEPTED_LEAD 3996, ACCEPTED_OUTBID 215, ACCEPTED_RAISE 40, REJECTED_BELOW_MINIMUM 70081, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 19.
- Bids per second: 4689.6 over 15.90 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 8.5 ms, p95 10.3 ms, p99 13.6 ms, max 75.0 ms, n = 74551.
- Latency end to end including the wait for one of the 40 pooled connections: p50 42.7 ms, p95 48.6 ms, p99 61.2 ms.
- Max lock wait seen: 36.0 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 18628/1062/15650000/393, 18647/1066/15700000/397, 18663/1063/15775000/396, 18613/1060/15650000/389; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 05f024f; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 124 lots (124 settled), V1–V9
## 2026-10-22T16:08:04.241Z — `05f024f`

`2026-10-22T16:08:04.241Z 05f024f: lock=version, 200 writers, 40 connections, 4 lots, 10 s + soft close: 60889 ledger rows in 15.8 s = 3855 bids/s; placeBid p50 10.1 / p95 12.6 / p99 16.7 ms; end to end p50 51.1 / p95 56.7 / p99 71.7 ms; max lock wait 180.4 ms; 0 timeouts; 2.447 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock version` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 60889 (N attempts, N rows; timeouts resent with the same key: 0; writer failures: 0).
- Lock strategy: version; judgements 149008 for 60889 ledger rows (2.447 per row); version conflicts (guarded UPDATE matched 0 rows) 88119.
- Outcomes: ACCEPTED_LEAD 3243, ACCEPTED_OUTBID 210, ACCEPTED_RAISE 31, REJECTED_BELOW_MINIMUM 57189, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 16.
- Bids per second: 3854.5 over 15.80 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 10.1 ms, p95 12.6 ms, p99 16.7 ms, max 289.2 ms, n = 60889.
- Latency end to end including the wait for one of the 40 pooled connections: p50 51.1 ms, p95 56.7 ms, p99 71.7 ms.
- Max lock wait seen: 180.4 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 15239/866/10825000/324, 15222/875/10875000/333, 15208/876/10825000/336, 15220/867/10800000/328; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 05f024f; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 128 lots (128 settled), V1–V9
## 2026-10-22T16:08:48.629Z — `05f024f`

`2026-10-22T16:08:48.629Z 05f024f: lock=serializable, 200 writers, 40 connections, 4 lots, 10 s + soft close: 17690 ledger rows in 16.0 s = 1105 bids/s; placeBid p50 19.0 / p95 97.3 / p99 107.9 ms; end to end p50 154.5 / p95 234.0 / p99 255.5 ms; max lock wait 2.4 ms; 1761 timeouts; 7.087 judgements per row; Apple M4, 10 cores, 24 GB; Node v26.3.1; PostgreSQL 17.11 (Homebrew)`

- Command: `npm run load:bids -- --lock serializable` → writers 200, lots 4, seconds 10, connections 40; soft-close window 2 s, cap 6 s, start 10000 cents, no reserve.
- Ledger rows: 17690 (N attempts, N rows; timeouts resent with the same key: 1761; writer failures: 0).
- Lock strategy: serializable; judgements 125374 for 17690 ledger rows (7.087 per row); 40001 retries 0; seq-index 23505 retries 107684.
- Outcomes: ACCEPTED_LEAD 1048, ACCEPTED_OUTBID 110, ACCEPTED_RAISE 15, REJECTED_BELOW_MINIMUM 16314, REJECTED_LOT_CLOSED 200, REJECTED_NOT_ABOVE_OWN_MAX 3.
- Bids per second: 1104.7 over 16.01 s from the first attempt's start to the last attempt's end.
- Latency around `placeBid` with a connection in hand (same process as the server code; no HTTP): p50 19.0 ms, p95 97.3 ms, p99 107.9 ms, max 184.1 ms, n = 19451.
- Latency end to end including the wait for one of the 40 pooled connections: p50 154.5 ms, p95 234.0 ms, p99 255.5 ms.
- Max lock wait seen: 2.4 ms (now() − query_start of a backend in wait_event_type = 'Lock', sampled every 100 ms; an upper bound).
- Per lot (bidCount / acceptedCount / price cents / extensions): 4445/288/545000/113, 4378/298/550000/113, 4442/295/535300/115, 4425/292/555000/112; settled 4.
- Hardware: Apple M4, 10 cores, 24 GB RAM; Node v26.3.1; PostgreSQL 17.11 (Homebrew); git 05f024f; Prisma pool for the boundary reads capped by the DATABASE_URL (connection_limit=10).
- auction:verify: OK, 132 lots (132 settled), V1–V9
