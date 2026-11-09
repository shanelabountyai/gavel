# Foundation patches

Template-owned files that differ from the cloned foundation tag, and why. Delete a row when the clone moves to a foundation release that contains the change.

`src/proxy.ts` `2220637947a4` — shared-password demo gate for the deployed demo (D-64; clone-only file ported from boxloop, not a foundation fix)
`src/app/(public)/demo/signin/route.ts` `6e646c943902` — a one-org demo visitor lands inside the org (bidder on the catalog, staff on the auctions) instead of on Your orgs (bcc7df8, D-65); a multi-org visitor lands in the live sale's house (c071c6b, D-81). Kept local to Gavel
`src/app/(public)/demo/page.tsx` `672b86ac6310` — accounts grouped by journey (Bid / Run the sale / other), live house derived from the lots (c071c6b, D-81); keeps v1.4.0's `filterListedOrgs` pass. Kept local to Gavel
