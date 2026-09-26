'use client';

import { useRef, useState } from 'react';

export function AutomaticDescriptionUpload() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const workerRef = useRef<Worker | null>(null);

  async function generate() {
    if (!file) return;
    setBusy(true); setError(''); setMessage('Leyendo el panel y preparando descripciones…');
    try {
      const buffer = await file.arrayBuffer();
      const result = await new Promise<{ buffer: ArrayBuffer; rows: number }>((resolve, reject) => {
        const worker = new Worker(new URL('../workers/automatic-description.worker.ts', import.meta.url), { type: 'module' });
        workerRef.current = worker;
        worker.onmessage = (event: MessageEvent<{ type: string; buffer?: ArrayBuffer; rows?: number; message?: string }>) => {
          worker.terminate(); workerRef.current = null;
          if (event.data.type === 'result' && event.data.buffer) resolve({ buffer: event.data.buffer, rows: event.data.rows ?? 0 });
          else reject(new Error(event.data.message || 'No fue posible generar el Excel.'));
        };
        worker.onerror = () => { worker.terminate(); workerRef.current = null; reject(new Error('El navegador no pudo procesar el Excel.')); };
        worker.postMessage({ buffer, filename: file.name }, [buffer]);
      });
      const blob = new Blob([result.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url;
      anchor.download = `PQM_Descripciones_Sugeridas_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`Excel generado con ${result.rows.toLocaleString('es-CO')} registros. La base original no cambió.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No fue posible generar el Excel.'); }
    finally { setBusy(false); }
  }

  return <section className="panel"><div className="panel-header"><div><h2>Generar descripciones</h2><p>Se procesa en este navegador. El archivo no se sube a Supabase.</p></div></div><div className="panel-body">
    <div className="description-recipe" aria-label="Ejemplo de composición de descripción"><span>Categoría <strong>BEBIDAS</strong></span><b aria-hidden="true">+</b><span>Marca <strong>FONTANA</strong></span><b aria-hidden="true">+</b><span>Gramaje y unidad <strong>1L</strong></span><b aria-hidden="true">→</b><strong>BEBIDAS FONTANA 1L</strong></div>
    <label className={`file-drop tool-file-drop ${file ? 'selected' : ''}`}><strong>Panel maestro PQM</strong><p>Hoja “pqm consolidado”, igual que en una jornada.</p><span className="tool-file-action">{file ? file.name : 'Seleccionar Excel'}</span><input accept=".xlsx" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} type="file" /></label>
    <p>La nueva columna “descripción_sugerida” aparece junto a Descripcion. Combina categoría, marca y gramaje+unidad abreviada. Omite valores vacíos o no especificados; el gramaje y la unidad solo aparecen juntos.</p>
    {message && <p className="form-notice" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    <button className="button button-primary" disabled={!file || busy} onClick={() => void generate()} type="button">{busy ? 'Generando…' : 'Generar y descargar Excel'}</button>
  </div></section>;
}
