import { timingSafeEqual } from 'node:crypto';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { jsonError } from '@/lib/http';
import { NextResponse } from 'next/server';

export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!secret || !provided) return false;
  const expected = Buffer.from(secret); const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request: Request) {
  if (!authorized(request)) return jsonError('No autorizado.', 401);
  const admin = createAdminSupabaseClient();
  const { data: expired, error } = await admin.rpc('claim_expired_uploads', { p_limit: 20 });
  if (error) return jsonError(error.message, 500);
  const completed: string[] = [];
  const failures: Array<{ uploadId: string; message: string }> = [];
  for (const item of expired ?? []) {
    try {
      const paths = [item.panel_object_path, item.invoice_object_path].filter((path): path is string => Boolean(path));
      if (paths.length) {
        const { error: storageError } = await admin.storage.from('pqm-private').remove(paths);
        if (storageError) throw storageError;
      }
      const { error: finalizeError } = await admin.rpc('finalize_upload_retention', { p_upload_id: item.upload_id });
      if (finalizeError) throw finalizeError;
      completed.push(item.upload_id);
    } catch (cause) {
      failures.push({ uploadId: item.upload_id, message: cause instanceof Error ? cause.message : 'Error de retención' });
    }
  }
  const twelveMonthsAgo = new Date(); twelveMonthsAgo.setUTCFullYear(twelveMonthsAgo.getUTCFullYear() - 1);
  await admin.from('audit_events').delete().lt('occurred_at', twelveMonthsAgo.toISOString());
  await admin.from('daily_productivity').delete().lt('activity_date', twelveMonthsAgo.toISOString().slice(0, 10));
  return NextResponse.json({ ok: failures.length === 0, completed, failures });
}
