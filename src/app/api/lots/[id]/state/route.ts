import { lotView } from '@/auction/lot-view';
import { requireUser } from '@/core/authz/guards';

export const dynamic = 'force-dynamic';

// Task 3.3. Polled every 1-2 s (D-47); 304 when the ETag still matches. `private`: the body has a per-caller field.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await requireUser();
  const v = await lotView(s.userId, (await ctx.params).id);
  if (!v) return Response.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const headers = { ETag: v.etag, 'Cache-Control': 'private, no-cache' };
  const sent = req.headers.get('if-none-match')?.split(',').map((t) => t.trim().replace(/^W\//, ''));
  if (sent?.includes(v.etag)) return new Response(null, { status: 304, headers });
  return Response.json({ ...v, etag: undefined }, { headers }); // JSON drops the undefined key
}
