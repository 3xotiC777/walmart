'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { CheckIcon, UploadCloudIcon } from './icons';
import { buildIngestionPlan } from '@/lib/ingestion';
import { resumableUpload, sha256File } from '@/lib/storage-upload';
import type { WorkerMessage, WorkerRequest, WorkerResult } from '@/lib/types';

type Phase = 'select' | 'validating' | 'uploading' | 'saving' | 'done' | 'error';
const MAX_SIZE = 150 * 1024 * 1024;

function FileDrop({ title, description, file, onChange }: { title: string; description: string; file: File | null; onChange: (file: File | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  function select(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    event.target.value = '';
    onChange(selected);
  }
  return (
    <div aria-label={title} className={`file-drop ${file ? 'selected' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onChange(event.dataTransfer.files[0] ?? null); }} role="group">
      {file ? <CheckIcon /> : <UploadCloudIcon />}
      <strong>{title}</strong><p>{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB` : description}</p>
      <button className="button button-secondary" onClick={(event) => { event.preventDefault(); input.current?.click(); }} type="button">{file ? 'Cambiar archivo' : 'Seleccionar .xlsx'}</button>
      <input aria-label={`Archivo para ${title}`} ref={input} tabIndex={-1} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={select} />
    </div>
  );
}

async function analyze(panel: File, invoices: File, onProgress: (message: string, percent: number) => void): Promise<WorkerResult> {
  const [sourceBuffer, invoiceBuffer] = await Promise.all([panel.arrayBuffer(), invoices.arrayBuffer()]);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/validator.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === 'progress') { onProgress(message.message, Math.round(message.progress * .28)); return; }
      worker.terminate();
      if (message.type === 'error') reject(new Error(message.message));
      else resolve(message.payload);
    };
    worker.onerror = () => { worker.terminate(); reject(new Error('El navegador no pudo completar el análisis.')); };
    const request: WorkerRequest = { sourceBuffer, sourceFileName: panel.name, invoiceBuffer, invoiceFileName: invoices.name };
    worker.postMessage(request, [sourceBuffer, invoiceBuffer]);
  });
}

async function postJson(url: string, body: unknown, attempts = 3) {
  let lastError = new Error('No fue posible guardar el avance.');
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (response.ok) return result;
    lastError = new Error(result.message ?? lastError.message);
    if (response.status < 500 && response.status !== 429) break;
    await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw lastError;
}

export function UploadWorkspace() {
  const router = useRouter();
  const [panel, setPanel] = useState<File | null>(null);
  const [invoices, setInvoices] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>('select');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [metrics, setMetrics] = useState<WorkerResult['collaboration']['metrics'] | null>(null);
  const busy = ['validating', 'uploading', 'saving'].includes(phase);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!busy) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  function validateFile(file: File | null, setFile: (value: File | null) => void) {
    setError('');
    if (!file) { setFile(null); return; }
    if (!file.name.toLowerCase().endsWith('.xlsx')) { setError('Selecciona únicamente archivos .xlsx.'); return; }
    if (file.size > MAX_SIZE) { setError('El archivo supera el máximo de 150 MB.'); return; }
    setFile(file);
  }

  async function start() {
    if (!panel || !invoices || busy) return;
    let uploadId: string | null = null;
    try {
      setError(''); setPhase('validating'); setProgress(2); setMessage('Validando hojas, columnas y reglas…');
      const result = await analyze(panel, invoices, (next, value) => { setMessage(next); setProgress(value); });
      setMetrics(result.collaboration.metrics);
      setMessage('Verificando que los archivos sean únicos…'); setProgress(30);
      const [panelHash, invoiceHash] = await Promise.all([sha256File(panel), sha256File(invoices)]);
      const created = await postJson('/api/uploads', {
        panelName: panel.name, invoiceName: invoices.name, displayName: panel.name,
        panelHash, invoiceHash, panelSize: panel.size, invoiceSize: invoices.size,
        headers: result.dataset.headers,
      });
      uploadId = created.uploadId;

      setPhase('uploading');
      setMessage(created.resumed ? 'Retomando la carga privada del panel…' : 'Subiendo el panel de forma privada…');
      setProgress(34);
      await resumableUpload(panel, created.panelPath, (value) => setProgress(34 + value * .16));
      setMessage('Subiendo las referencias de facturas…');
      await resumableUpload(invoices, created.invoicePath, (value) => setProgress(50 + value * .08));

      setPhase('saving'); setMessage('Preparando tareas, relacionados y sugerencias…'); setProgress(59);
      const plan = await buildIngestionPlan(result.dataset, result.collaboration, result.invoiceCatalog);
      for (let index = 0; index < plan.batches.length; index += 1) {
        const item = plan.batches[index];
        setMessage(`Guardando lote ${index + 1} de ${plan.batches.length}…`);
        await postJson(`/api/uploads/${uploadId}/ingest`, { batchKey: item.key, payload: item.payload });
        setProgress(60 + ((index + 1) / plan.batches.length) * 35);
      }
      setMessage('Comprobando conteos y cerrando la jornada…');
      await postJson(`/api/uploads/${uploadId}/finalize`, {
        sourceTotalRows: result.dataset.records.length,
        storedRowCount: plan.storedRowCount,
        taskCount: plan.taskCount,
        alertCount: plan.alertCount,
        batchCount: plan.batches.length,
        manifestHash: plan.manifestHash,
      });
      setProgress(100); setPhase('done'); setMessage('Jornada lista para repartir.');
      router.push(`/workspace/reparto/${uploadId}`); router.refresh();
    } catch (cause) {
      const failure = cause instanceof Error ? cause.message : 'La carga no pudo completarse.';
      if (uploadId) void postJson(`/api/uploads/${uploadId}/fail`, { message: failure }, 1).catch(() => undefined);
      setError(failure); setPhase('error'); setMessage('');
    }
  }

  const step = phase === 'select' || phase === 'validating' ? 1 : phase === 'uploading' ? 2 : 3;
  return (
    <>
      <div className="upload-steps" aria-label="Etapas de la carga">
        {[['1', 'Validar', 'Estructura y reglas'], ['2', 'Proteger', 'Storage privado'], ['3', 'Preparar', 'Tareas y reparto']].map(([number, title, copy], index) => <div className={`upload-step ${step === index + 1 ? 'active' : step > index + 1 ? 'done' : ''}`} key={number}><span>{step > index + 1 ? '✓' : number}</span><div><strong>{title}</strong><small>{copy}</small></div></div>)}
      </div>
      <section className="panel"><div className="panel-header"><div><h2>Archivos de la jornada</h2><p>Primero se validan localmente; después se guardan cifrados en el espacio privado.</p></div></div><div className="panel-body">
        <div className="drop-grid">
          <FileDrop title="Panel maestro PQM" description="Hoja pqm consolidado con la estructura habitual." file={panel} onChange={(file) => validateFile(file, setPanel)} />
          <FileDrop title="Referencias de facturas" description="Hoja Data con RefID_STG y URL_DN." file={invoices} onChange={(file) => validateFile(file, setInvoices)} />
        </div>
        {(busy || phase === 'done') && <div className="upload-progress" aria-live="polite"><header><strong>{message}</strong><span>{Math.round(progress)}%</span></header><div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div>{metrics && <p>{metrics.reviewTasks.toLocaleString('es-CO')} tareas · {metrics.alertEvents.toLocaleString('es-CO')} eventos · {metrics.orthographyAlerts.toLocaleString('es-CO')} de ortografía</p>}</div>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="decision-actions"><button className="button button-primary" disabled={!panel || !invoices || busy} onClick={() => void start()} type="button">{busy ? 'Preparando jornada…' : phase === 'error' ? 'Intentar nuevamente' : 'Validar y crear jornada'} <UploadCloudIcon /></button></div>
      </div></section>
    </>
  );
}
