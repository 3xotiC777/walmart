import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseLexiconWorkbook, entriesToLexicon } from './orthography-lexicon';
import { generateOrthographyAlerts } from './orthography';
import { makeDataset } from './testHelpers';

function excel(rows: unknown[][]): ArrayBuffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('vocabulario aprendido', () => {
  it('lee ambas plantillas por encabezado', () => {
    const correct = parseLexiconWorkbook(excel([['Palabras Correctas'], ['PENNE']]), 'correct');
    const incorrect = parseLexiconWorkbook(excel([['Palabra Erronea', 'Palabra Correcta'], ['MARCIAA', 'MARCIA']]), 'incorrect');
    expect(entriesToLexicon([...correct, ...incorrect])).toEqual({ correct: ['PENNE'], incorrect: { MARCIAA: 'MARCIA' } });
  });

  it('alerta una palabra incorrecta incluso si aparece repetida y propone su reemplazo', () => {
    const dataset = makeDataset(Array.from({ length: 4 }, () => ({ Descripcion: 'PASTA MARCIAA 500GR' })));
    const alerts = generateOrthographyAlerts(dataset, 'Descripcion', { correct: [], incorrect: { MARCIAA: 'MARCIA' } });
    expect(alerts).toHaveLength(4);
    expect(alerts[0].correctedDescription).toBe('PASTA MARCIA 500GR');
    expect(alerts[0].confidence).toBe('high');
  });

  it('reconoce una palabra aprobada sin generar una alerta de palabra desconocida', () => {
    const dataset = makeDataset([{ Descripcion: 'PENNE' }]);
    expect(generateOrthographyAlerts(dataset, 'Descripcion', { correct: ['PENNE'], incorrect: {} })).toHaveLength(0);
  });
});
