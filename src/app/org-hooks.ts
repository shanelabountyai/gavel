
// Clone-owned, like cron-jobs.ts: what must happen before an org is deleted. Throwing stops the
// deletion. Removing the billing module deletes the lines marked `// billing`.
// FR-05: a deleted org must not keep charging.
export async function beforeOrgDelete(orgId: string): Promise<void> {
}
