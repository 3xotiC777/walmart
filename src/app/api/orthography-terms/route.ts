import { NextResponse } from 'next/server';
import { getViewer } from '@/lib/auth';
import { jsonError, readJsonObject } from '@/lib/http';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { entriesToLexicon, type LexiconEntry } from '@/lib/orthography-lexicon';
import { normalizeOrthographyText } from '@/lib/orthography';

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return jsonError('No autorizado.', 401);
  const supabase = await createServerSupabaseClient();
  const entries: LexiconEntry[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('orthography_terms')
      .select('word, classification, replacement')
      .eq('workspace_id', viewer.workspaceId)
      .order('word')
      .range(from, from + 999);
    if (error) return jsonError('No fue posible cargar el vocabulario.', 503);
    entries.push(...(data ?? []) as LexiconEntry[]);
    if (!data || data.length < 1000) break;
  }
  return NextResponse.json({ entries, lexicon: entriesToLexicon(entries) });
}

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'leader') return jsonError('Solo un líder puede enseñar palabras a la alerta.', 403);
  const body = await readJsonObject(request);
  const raw = body?.entries;
  if (!Array.isArray(raw) || raw.length > 1000) return jsonError('Envía un máximo de 1000 palabras por lote.');
  const entries = new Map<string, LexiconEntry>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') return jsonError('Entrada de vocabulario inválida.');
    const entry = item as Record<string, unknown>;
    const word = typeof entry.word === 'string' ? normalizeOrthographyText(entry.word) ?? '' : '';
    if (!word || word.includes(' ') || word.length > 80) return jsonError('Cada entrada debe ser una sola palabra de hasta 80 caracteres.');
    if (entry.classification !== 'correct' && entry.classification !== 'incorrect') return jsonError('Clasificación inválida.');
    const replacement = entry.classification === 'incorrect' && typeof entry.replacement === 'string'
      ? normalizeOrthographyText(entry.replacement) || null
      : null;
    entries.set(word, { word, classification: entry.classification, replacement });
  }
  if (entries.size === 0) return NextResponse.json({ saved: 0 });
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from('orthography_terms').upsert(
    [...entries.values()].map((entry) => ({
      workspace_id: viewer.workspaceId,
      word: entry.word,
      classification: entry.classification,
      replacement: entry.replacement,
      updated_by: viewer.id,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: 'workspace_id,word' },
  );
  if (error) return jsonError('No fue posible guardar las palabras. Intenta nuevamente.', 503);
  return NextResponse.json({ saved: entries.size });
}
