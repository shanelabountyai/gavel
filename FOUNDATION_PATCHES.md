# Foundation patches

Template-owned files that differ from the cloned foundation tag, and why. Delete a row when the clone moves to a foundation release that contains the change.

`src/proxy.ts` `2220637947a4` — shared-password demo gate for the deployed demo (D-64; clone-only file ported from boxloop, not a foundation fix)
`src/app/(public)/demo/signin/route.ts` `770ee13a04e6` — a one-org demo visitor lands inside the org (bidder on the catalog, staff on the auctions) instead of on Your orgs (bcc7df8, D-65; found on the live demo, kept local to Gavel)
