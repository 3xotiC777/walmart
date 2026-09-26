'use client';

import { useEffect, useState } from 'react';
import { parseLexiconWorkbook, type LexiconEntry } from '@/lib/orthography-lexicon';

export function OrthographyTraining() {
  const [correctFile, setCorrectFile] = useState<File | null>(null);
  const [incorrectFile, setIncorrectFile] = useState<File | null>(null);
  const [counts, setCounts] = useState({ correct: 0, incorrect: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function refresh() {
    const response = await fetch('/api/orthography-terms', { cache: 'no-store' });
    if (!response.ok) throw new Error('No fue posible consultar el vocabulario.');
    const result = await response.json() as { entries: LexiconEntry[] };
    setCounts({
      correct: result.entries.filter((entry) => entry.classification === 'correct').length,
      incorrect: result.entries.filter((entry) => entry.classification === 'incorrect').length,
    });
  }

  useEffect(() => { void refresh().catch(() => setError('No fue posible consultar el vocabulario.')); }, []);

  async function save() {
    setBusy(true); setError(''); setMessage('Leyendo las palabras…');
    try {
      const [correct, incorrect] = await Promise.all([
        correctFile ? correctFile.arrayBuffer().then((buffer) => parseLexiconWorkbook(buffer, 'correct')) : Promise.resolve([]),
        incorrectFile ? incorrectFile.arrayBuffer().then((buffer) => parseLexiconWorkbook(buffer, 'incorrect')) : Promise.resolve([]),
      ]);
      const entries = [...new Map([...correct, ...incorrect].map((entry) => [entry.word, entry])).values()];
      if (!entries.length) throw new Error('Los archivos no contienen palabras para aprender; no se cambió el vocabulario actual.');
      for (let index = 0; index < entries.length; index += 500) {
        setMessage(`Guardando ${Math.min(entries.length, index + 500)} de ${entries.length} palabras…`);
        const response = await fetch('/api/orthography-terms', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ entries: entries.slice(index, index + 500) }),
        });
        if (!response.ok) throw new Error((await response.json() as { message?: string }).message || 'No fue posible guardar las palabras.');
      }
      await refresh();
      setMessage(`${entries.length} palabras aprendidas. Se aplicarán a los próximos análisis.`);
      setCorrectFile(null); setIncorrectFile(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible aprender las palabras.');
      setMessage('');
    } finally { setBusy(false); }
  }

  return <section className="panel"><div className="panel-header"><div><h2>Vocabulario del equipo</h2><p>{counts.correct} correctas · {counts.incorrect} incorrectas aprendidas. Subir otra lista agrega o actualiza palabras; no borra las anteriores.</p></div></div>
    <div className="panel-body"><div className="drop-grid">
      <label className={`file-drop tool-file-drop ${correctFile ? 'selected' : ''}`}><strong>Palabras correctas</strong><p>Columna “Palabras Correctas”.</p><span className="tool-file-action">{correctFile ? correctFile.name : 'Seleccionar Excel'}</span><input accept=".xlsx" disabled={busy} onChange={(event) => setCorrectFile(event.target.files?.[0] ?? null)} type="file" /></label>
      <label className={`file-drop tool-file-drop ${incorrectFile ? 'selected' : ''}`}><strong>Palabras incorrectas</strong><p>Columnas “Palabra Erronea” y “Palabra Correcta”.</p><span className="tool-file-action">{incorrectFile ? incorrectFile.name : 'Seleccionar Excel'}</span><input accept=".xlsx" disabled={busy} onChange={(event) => setIncorrectFile(event.target.files?.[0] ?? null)} type="file" /></label>
    </div><p>Una palabra incorrecta sin reemplazo genera revisión manual. Con reemplazo, la plataforma lo propondrá sin cambiar la base automáticamente.</p>
    {message && <p className="form-notice" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    <button className="button button-primary" disabled={busy || (!correctFile && !incorrectFile)} onClick={() => void save()} type="button">{busy ? 'Aprendiendo…' : 'Guardar vocabulario'}</button></div></section>;
}
