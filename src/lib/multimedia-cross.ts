import type {
  CombinedMultimediaSubject,
  InterviewDataCatalog,
  MultimediaCatalog,
} from './multimedia';

export function normalizeSubjectIdKey(value: string): string {
  const text = value.trim();
  if (/^\d+(?:\.0+)?$/.test(text)) {
    const integer = text.replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
    return integer || '0';
  }
  return text.toLocaleUpperCase('es');
}

export function combineMultimediaCatalogs(
  multimedia: MultimediaCatalog,
  interviewData: InterviewDataCatalog,
): CombinedMultimediaSubject[] {
  const combined = new Map<string, CombinedMultimediaSubject>();
  for (const group of multimedia.groups) {
    const subjectKey = normalizeSubjectIdKey(group.subjectId);
    const current = combined.get(subjectKey);
    if (current) {
      current.images.push(...group.images);
      current.audios.push(...group.audios);
      current.unavailableCount += group.unavailableCount;
      if (group.timestampSort > current.timestampSort) {
        current.timestamp = group.timestamp;
        current.timestampSort = group.timestampSort;
      }
      continue;
    }
    combined.set(subjectKey, {
      subjectKey,
      subjectId: group.subjectId,
      timestamp: group.timestamp,
      timestampSort: group.timestampSort,
      images: [...group.images],
      audios: [...group.audios],
      unavailableCount: group.unavailableCount,
      dataRows: [],
    });
  }
  for (const group of interviewData.groups) {
    const current = combined.get(group.subjectKey);
    if (current) {
      current.dataRows.push(...group.rows);
      continue;
    }
    combined.set(group.subjectKey, {
      subjectKey: group.subjectKey,
      subjectId: group.subjectId,
      timestamp: 'Sin fecha multimedia',
      timestampSort: 0,
      images: [],
      audios: [],
      unavailableCount: 0,
      dataRows: [...group.rows],
    });
  }
  return [...combined.values()].sort((left, right) => (
    right.timestampSort - left.timestampSort
    || left.subjectId.localeCompare(right.subjectId, 'es', { numeric: true })
  ));
}
