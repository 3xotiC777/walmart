import { randomUUID } from 'node:crypto';
import { getViewer } from '@/lib/auth';
import { jsonError } from '@/lib/http';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { findResumableUpload } from '@/lib/upload-resume';
import { NextResponse } from 'next/server';

function safeName(value: string) {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').slice(0, 100) || 'archivo.xlsx';
}

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'leader') return jsonError('Solo un líder puede iniciar una jornada.', 403);
  const body = await request.json().catch(() => ({}));
  const panelName = String(body.panelName ?? 'panel.xlsx');
  const invoiceName = String(body.invoiceName ?? 'facturas.xlsx');
  if (typeof body.hasBarcode !== 'boolean') return jsonError('Indica si este estudio trae código de barras.');
  if (!/^[a-f0-9]{64}$/i.test(body.panelHash) || !/^[a-f0-9]{64}$/i.test(body.invoiceHash)) return jsonError('No fue posible verificar la integridad de los archivos.');
  if (!Number.isInteger(body.panelSize) || !Number.isInteger(body.invoiceSize)) return jsonError('El tamaño de los archivos no es válido.');
  const uploadId = randomUUID();
  const panelPath = `${viewer.workspaceId}/${uploadId}/panel/${safeName(panelName)}`;
  const invoicePath = `${viewer.workspaceId}/${uploadId}/invoices/${safeName(invoiceName)}`;
  const supabase = await createServerSupabaseClient();

  const lookupResumableUpload = async () => {
    const { data: candidates } = await supabase
      .from('uploads')
      .select('id, panel_object_path, invoice_object_path, panel_sha256, invoice_sha256, has_barcode, status')
      .eq('workspace_id', viewer.workspaceId)
      .in('status', ['uploading', 'processing'])
      .order('created_at', { ascending: false })
      .limit(100);
    return findResumableUpload(candidates ?? [], {
      panelHash: body.panelHash,
      invoiceHash: body.invoiceHash,
      hasBarcode: body.hasBarcode,
    });
  };

  const pendingUpload = await lookupResumableUpload();
  if (pendingUpload?.invoice_object_path) {
    return NextResponse.json({
      ok: true,
      resumed: true,
      upload: pendingUpload,
      uploadId: pendingUpload.id,
      panelPath: pendingUpload.panel_object_path,
      invoicePath: pendingUpload.invoice_object_path,
    });
  }

  const { data, error } = await supabase.rpc('create_upload', {
    p_upload_id: uploadId,
    p_workspace_id: viewer.workspaceId,
    p_display_name: String(body.displayName ?? panelName).trim().slice(0, 255),
    p_panel_object_path: panelPath,
    p_panel_sha256_hex: body.panelHash,
    p_panel_size_bytes: body.panelSize,
    p_invoice_object_path: invoicePath,
    p_invoice_sha256_hex: body.invoiceHash,
    p_invoice_size_bytes: body.invoiceSize,
    p_source_headers: Array.isArray(body.headers) ? body.headers : [],
    p_has_barcode: body.hasBarcode,
  });
  if (error) {
    const duplicate = error.code === '23505';
    if (duplicate) {
      // Compatibility while the database migration is rolling out, and a
      // race-safe second lookup when two retries arrive at the same time.
      const resumable = await lookupResumableUpload();
      if (resumable?.invoice_object_path) {
        return NextResponse.json({
          ok: true,
          resumed: true,
          upload: resumable,
          uploadId: resumable.id,
          panelPath: resumable.panel_object_path,
          invoicePath: resumable.invoice_object_path,
        });
      }
    }
    return jsonError(duplicate ? 'No fue posible iniciar otra jornada con este archivo. Intenta nuevamente.' : error.message, duplicate ? 409 : 400);
  }
  return NextResponse.json({ ok: true, resumed: false, upload: data, uploadId, panelPath, invoicePath });
}
