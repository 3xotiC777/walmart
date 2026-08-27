import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  combineMultimediaCatalogs,
  MultimediaWorkbookError,
  normalizeSubjectIdKey,
  parseInterviewDataWorkbook,
  parseMultimediaWorkbook,
} from './multimedia';

const HEADERS = [
  'SubjectID', 'QuestionText', 'Name', 'TimeStamp', 'ImageURL',
  'Complete', 'QuestionVariableName', 'Size',
];

function workbookBuffer(rows: unknown[][], headers = HEADERS): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), 'Sheet1');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

function mediaUrl(name: string, id: number) {
  return `https://stg.dooblo.net/WS/Retrieve.aspx?Key=PRUEBA&name=${name}&id=${id}`;
}

describe('lector de multimedia de Dooblo', () => {
  it('agrupa imágenes y audios por SubjectID usando la extensión de Name', () => {
    const catalog = parseMultimediaWorkbook(workbookBuffer([
      [1001, 'Foto frontal', 'foto-1.jpg', 25569.5, mediaUrl('foto-1.jpg', 1), true, 'FOTO', 1200],
      [1001, null, 'audio-1.m4a', 25569.5, mediaUrl('audio-1.m4a', 2), true, null, 800],
      [1002, 'Foto lateral', 'foto-2.webp', 25570, mediaUrl('foto-2.webp', 3), true, 'FOTO', 900],
    ]), 'multimedia.xlsx');

    expect(catalog.groups).toHaveLength(2);
    expect(catalog.totalImages).toBe(2);
    expect(catalog.totalAudios).toBe(1);
    expect(catalog.groups.find((group) => group.subjectId === '1001')?.images[0].timestamp)
      .toBe('01/01/1970, 12:00');
  });

  it('marca como no disponibles los adjuntos incompletos o con tamaño cero', () => {
    const catalog = parseMultimediaWorkbook(workbookBuffer([
      [1001, 'Foto', 'incompleta.jpg', 25569, mediaUrl('incompleta.jpg', 1), false, 'FOTO', 0],
      [1001, null, 'audio.m4a', 25569, mediaUrl('audio.m4a', 2), true, null, 500],
    ]), 'multimedia.xlsx');

    expect(catalog.unavailableItems).toBe(1);
    expect(catalog.groups[0].images[0].available).toBe(false);
    expect(catalog.groups[0].audios[0].available).toBe(true);
  });

  it('ignora extensiones desconocidas y enlaces fuera de Dooblo', () => {
    const catalog = parseMultimediaWorkbook(workbookBuffer([
      [1001, 'Documento', 'notas.pdf', 25569, mediaUrl('notas.pdf', 1), true, null, 100],
      [1001, 'Foto externa', 'foto.jpg', 25569, 'https://example.com/foto.jpg', true, 'FOTO', 100],
      [1001, 'Foto válida', 'foto-ok.jpeg', 25569, mediaUrl('foto-ok.jpeg', 3), true, 'FOTO', 100],
    ]), 'multimedia.xlsx');

    expect(catalog.totalImages).toBe(1);
    expect(catalog.ignoredRows).toBe(2);
  });

  it('rechaza libros sin las columnas requeridas', () => {
    expect(() => parseMultimediaWorkbook(workbookBuffer([], ['SubjectID', 'Name']), 'invalido.xlsx'))
      .toThrow(MultimediaWorkbookError);
  });
});

describe('cruce con datos de entrevista', () => {
  it('solo exige SubjectID y conserva todas las demás columnas dinámicas', () => {
    const catalog = parseInterviewDataWorkbook(workbookBuffer([
      ['001001', 'auditor.ana', 'Approved', 'MARCA A', 'REEMPLAZO B'],
      ['001002', 'auditor.luis', 'Rejected', '', 'REEMPLAZO C'],
    ], ['SubjectID', 'Auditor', 'Estatus', 'Marca Cualquiera_1', 'Reemplazo libre']), 'datos.xlsx');

    expect(catalog.columns.map((column) => column.name)).toEqual([
      'Auditor', 'Estatus', 'Marca Cualquiera_1', 'Reemplazo libre',
    ]);
    expect(catalog.groups).toHaveLength(2);
    expect(catalog.groups[0].subjectId).toBe('001001');
    expect(catalog.groups[0].rows[0].fields.map((field) => field.value)).toEqual([
      'auditor.ana', 'Approved', 'MARCA A', 'REEMPLAZO B',
    ]);
  });

  it('acepta un archivo que únicamente contiene SubjectID y agrupa filas repetidas', () => {
    const catalog = parseInterviewDataWorkbook(workbookBuffer([
      [1001],
      [1001],
    ], ['SubjectID']), 'solo-id.xlsx');

    expect(catalog.columns).toEqual([]);
    expect(catalog.groups).toHaveLength(1);
    expect(catalog.groups[0].rows).toHaveLength(2);
  });

  it('cruza IDs numéricos aunque un archivo conserve ceros iniciales', () => {
    const multimedia = parseMultimediaWorkbook(workbookBuffer([
      ['001001', 'Foto frontal', 'foto.jpg', 25569, mediaUrl('foto.jpg', 1), true, 'FOTO', 100],
    ]), 'adjuntos.xlsx');
    const data = parseInterviewDataWorkbook(workbookBuffer([
      [1001, 'auditor.ana'],
      [2002, 'auditor.luis'],
    ], ['SubjectID', 'Auditor']), 'datos.xlsx');
    const combined = combineMultimediaCatalogs(multimedia, data);

    expect(normalizeSubjectIdKey('001001')).toBe('1001');
    expect(combined).toHaveLength(2);
    expect(combined.find((subject) => subject.subjectKey === '1001')).toMatchObject({
      subjectId: '001001',
      images: [{ name: 'foto.jpg' }],
      dataRows: [{ fields: [{ name: 'Auditor', value: 'auditor.ana' }] }],
    });
    expect(combined.find((subject) => subject.subjectKey === '2002')?.images).toEqual([]);
  });

  it('rechaza datos sin SubjectID aunque tengan otras columnas', () => {
    expect(() => parseInterviewDataWorkbook(workbookBuffer([
      ['auditor.ana'],
    ], ['Auditor']), 'sin-id.xlsx')).toThrow('SubjectID');
  });
});
