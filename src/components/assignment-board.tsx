'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  calculateInitialValidatorSelection,
  calculateSelectedValidatorLoads,
  normalizeSelectedValidatorIds,
} from '@/lib/assignment-selection';

interface Validator {
  userId: string;
  name: string;
  username: string;
  mustChangePin: boolean;
}

interface Block {
  id: string;
  blockKey: string;
  alertCount: number;
  memberCount: number;
  invoiceCount: number;
  weight: number;
  assignedTo: string | null;
  version: number;
}

type AssignmentMode = 'initial' | 'redistribute';

interface AssignmentBoardProps {
  uploadId: string;
  mode: AssignmentMode;
  initialAssignmentVersion: number;
  initialBlocks: Block[];
  initialProposalReady: boolean;
  expectedBlockCount: number;
  pendingTaskCount: number;
  completedBlockCount: number;
  inactiveAssignmentCount: number;
  validators: Validator[];
}

interface AssignmentSnapshot {
  block_id?: string;
  assigned_to?: string;
  version?: number;
  remaining_weight?: number | string;
}

function getInitialValidatorIds(
  mode: AssignmentMode,
  initialProposalReady: boolean,
  blocks: Block[],
  validators: Validator[],
) {
  return calculateInitialValidatorSelection({
    mode: mode === 'redistribute' || initialProposalReady ? 'redistribute' : 'initial',
    validators,
    blocks,
  });
}

export function AssignmentBoard({
  uploadId,
  mode,
  initialAssignmentVersion,
  initialBlocks,
  initialProposalReady,
  expectedBlockCount,
  pendingTaskCount,
  completedBlockCount,
  inactiveAssignmentCount,
  validators,
}: AssignmentBoardProps) {
  const router = useRouter();
  const [blocks, setBlocks] = useState(initialBlocks);
  const [preservedCompletedBlockCount, setPreservedCompletedBlockCount] = useState(completedBlockCount);
  const [assignmentVersion, setAssignmentVersion] = useState(initialAssignmentVersion);
  const [selectedValidatorIds, setSelectedValidatorIds] = useState(() => (
    getInitialValidatorIds(mode, initialProposalReady, initialBlocks, validators)
  ));
  const [proposalReady, setProposalReady] = useState(initialProposalReady);
  const [busyAction, setBusyAction] = useState<'calculate' | 'publish' | null>(null);
  const busyRef = useRef(false);
  const publishMutationIdRef = useRef<string | null>(null);
  const [error, setError] = useState('');

  const redistributing = mode === 'redistribute';
  const busy = busyAction !== null;
  const selectedIdSet = useMemo(() => new Set(selectedValidatorIds), [selectedValidatorIds]);
  const selectedValidators = useMemo(() => (
    validators.filter((validator) => selectedIdSet.has(validator.userId))
  ), [selectedIdSet, validators]);
  const loads = useMemo(() => {
    if (selectedValidatorIds.length === 0) return [];
    const validatorsById = new Map(validators.map((validator) => [validator.userId, validator]));
    return calculateSelectedValidatorLoads(selectedValidatorIds, blocks).map((load) => ({
      ...validatorsById.get(load.validatorId)!,
      blocks: load.blockCount,
      alerts: load.alertCount,
      weight: load.weight,
    }));
  }, [blocks, selectedValidatorIds, validators]);
  const currentBlockCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const block of blocks) {
      if (!block.assignedTo) continue;
      counts.set(block.assignedTo, (counts.get(block.assignedTo) ?? 0) + 1);
    }
    return counts;
  }, [blocks]);
  const originalBlockCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const block of initialBlocks) {
      if (!block.assignedTo) continue;
      counts.set(block.assignedTo, (counts.get(block.assignedTo) ?? 0) + 1);
    }
    return counts;
  }, [initialBlocks]);

  function invalidateProposal(nextIds: string[]) {
    setSelectedValidatorIds(normalizeSelectedValidatorIds(nextIds));
    setProposalReady(false);
    publishMutationIdRef.current = null;
    setError('');
  }

  function toggleValidator(userId: string) {
    const nextIds = selectedIdSet.has(userId)
      ? selectedValidatorIds.filter((id) => id !== userId)
      : [...selectedValidatorIds, userId];
    invalidateProposal(nextIds);
  }

  async function action(body: unknown, operation: 'calculate' | 'publish'): Promise<Record<string, unknown> | null> {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusyAction(operation);
    setError('');
    try {
      const response = await fetch(`/api/uploads/${uploadId}/assign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) {
        const message = typeof result.message === 'string'
          ? result.message
          : 'No fue posible guardar el reparto.';
        if (redistributing && message.includes('no tiene bloques pendientes')) {
          setBlocks([]);
          setProposalReady(false);
          setPreservedCompletedBlockCount((current) => current + blocks.length);
          router.refresh();
        }
        setError(message);
        return null;
      }
      return result;
    } catch {
      setError('No fue posible conectar para guardar el reparto.');
      return null;
    } finally {
      busyRef.current = false;
      setBusyAction(null);
    }
  }

  async function calculate() {
    if (selectedValidatorIds.length === 0) {
      setError('Selecciona al menos un validador para esta jornada.');
      return;
    }

    publishMutationIdRef.current = null;
    const result = await action({
      action: redistributing ? 'preview-redistribution' : 'propose',
      validatorIds: selectedValidatorIds,
      expectedUploadVersion: assignmentVersion,
    }, 'calculate');
    if (!result) return;

    const assignments = Array.isArray(result.assignments)
      ? result.assignments as AssignmentSnapshot[]
      : [];
    const snapshotByBlock = new Map(assignments.map((item) => [item.block_id, item]));
    const returnedIds = assignments
      .map((item) => item.block_id)
      .filter((blockId): blockId is string => typeof blockId === 'string');
    const uniqueReturnedIds = new Set(returnedIds);
    const knownBlockIds = new Set(blocks.map((block) => block.id));
    const invalidSnapshot = assignments.length !== uniqueReturnedIds.size
      || assignments.some((item) => (
        typeof item.block_id !== 'string'
        || !knownBlockIds.has(item.block_id)
        || typeof item.assigned_to !== 'string'
        || !selectedIdSet.has(item.assigned_to)
        || !Number.isInteger(Number(item.version))
      ));
    const returnedBlockCount = Number(result.blockCount);
    const incompleteProposal = returnedBlockCount !== assignments.length || (!redistributing && (
      assignments.length !== expectedBlockCount
      || blocks.some((block) => !snapshotByBlock.has(block.id))
    ));

    if (invalidSnapshot || incompleteProposal) {
      setError('No se cargó una propuesta completa y válida. Actualiza la página antes de publicar.');
      if (!redistributing) router.refresh();
      return;
    }
    if (redistributing && assignments.length === 0) {
      setBlocks([]);
      setProposalReady(false);
      setPreservedCompletedBlockCount((current) => current + blocks.length);
      setError('Ya no quedan bloques pendientes para repartir. Vuelve al tablero para actualizar la jornada.');
      router.refresh();
      return;
    }

    const completedSinceOpen = redistributing
      ? Math.max(0, blocks.length - assignments.length)
      : 0;
    setBlocks((current) => (redistributing ? current.filter((block) => snapshotByBlock.has(block.id)) : current).map((block) => {
      const snapshot = snapshotByBlock.get(block.id);
      return snapshot
        ? {
          ...block,
          assignedTo: snapshot.assigned_to ?? null,
          version: Number(snapshot.version),
          weight: redistributing && Number.isFinite(Number(snapshot.remaining_weight))
            ? Number(snapshot.remaining_weight)
            : block.weight,
        }
        : block;
    }));
    if (completedSinceOpen > 0) {
      setPreservedCompletedBlockCount((current) => current + completedSinceOpen);
    }
    const returnedVersion = Number(redistributing ? result.assignmentVersion : result.uploadVersion);
    if (Number.isInteger(returnedVersion) && returnedVersion > 0) {
      setAssignmentVersion(returnedVersion);
    }
    setProposalReady(true);
  }

  async function publish() {
    const emptyInitialJourney = !redistributing && blocks.length === 0;
    if (!proposalReady && !emptyInitialJourney) {
      setError('Calcula nuevamente la propuesta después de elegir quiénes trabajarán.');
      return;
    }
    if (new Set(blocks.map((block) => block.id)).size !== blocks.length || (
      !redistributing && blocks.length !== expectedBlockCount
    )) {
      setError('La pantalla no contiene todos los bloques pendientes. Actualízala antes de publicar.');
      return;
    }
    if (!emptyInitialJourney && blocks.some((block) => (
      !block.assignedTo || !selectedIdSet.has(block.assignedTo)
    ))) {
      setError('Cada bloque pendiente debe quedar a cargo de un validador seleccionado.');
      return;
    }

    const assignments = blocks.map((block) => ({
      block_id: block.id,
      assigned_to: block.assignedTo,
      expected_version: block.version,
    }));
    const clientMutationId = redistributing
      ? (publishMutationIdRef.current ??= crypto.randomUUID())
      : undefined;
    const result = await action({
      action: redistributing ? 'publish-redistribution' : 'publish',
      assignments,
      validatorIds: selectedValidatorIds,
      expectedUploadVersion: assignmentVersion,
      ...(redistributing ? { clientMutationId } : {}),
    }, 'publish');
    if (!result) return;
    publishMutationIdRef.current = null;

    if (redistributing) {
      router.replace('/workspace?assignment=updated');
    } else {
      router.replace('/workspace/tareas');
    }
    router.refresh();
  }

  if (blocks.length === 0) {
    if (redistributing) {
      return <section className="panel empty-state"><h2>No queda carga por repartir</h2><p>La jornada no tiene bloques pendientes para mover entre validadores.</p></section>;
    }
    return <section className="panel empty-state"><h2>La jornada no tiene alertas</h2><p>Publica el resultado para cerrarla como completada y habilitar sus descargas.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy} onClick={() => void publish()} type="button">Finalizar jornada sin alertas</button></section>;
  }

  return <>
    <section className="panel assignment-participants">
      <fieldset className="assignment-participants-fieldset" disabled={busy}>
        <legend className="assignment-participants-legend">
          <span className="overline">EQUIPO DE ESTA JORNADA</span>
          <strong>¿Quiénes van a trabajar en esta carga?</strong>
          <span id="assignment-participants-help">Las cuentas siguen activas para otras jornadas. Aquí eliges únicamente quién recibe trabajo en esta.</span>
        </legend>
        <div className="assignment-participants-tools">
          <strong aria-live="polite">{selectedValidatorIds.length} de {validators.length} seleccionados</strong>
          <div>
            <button className="text-button" onClick={() => invalidateProposal(validators.map((validator) => validator.userId))} type="button">Seleccionar todos</button>
            <button className="text-button" onClick={() => invalidateProposal([])} type="button">Limpiar</button>
          </div>
        </div>
        <div aria-describedby="assignment-participants-help" className="validator-picker-grid">
          {validators.map((validator) => {
            const checked = selectedIdSet.has(validator.userId);
            return <label className={`validator-picker ${checked ? 'selected' : ''}`} key={validator.userId}>
              <input checked={checked} onChange={() => toggleValidator(validator.userId)} type="checkbox" />
              <span className="validator-picker-mark" aria-hidden="true">{checked ? '✓' : ''}</span>
              <span className="validator-picker-copy">
                <strong>{validator.name}</strong>
                <small>@{validator.username} · {((proposalReady ? currentBlockCounts : originalBlockCounts).get(validator.userId) ?? 0).toLocaleString('es-CO')} {proposalReady ? 'bloques propuestos' : 'bloques actuales'}</small>
                {validator.mustChangePin && <em>Debe completar su primer ingreso</em>}
              </span>
            </label>;
          })}
        </div>
      </fieldset>
      {inactiveAssignmentCount > 0 && <div className="assignment-warning" role="status"><strong>{inactiveAssignmentCount.toLocaleString('es-CO')} bloques pendientes tienen un responsable inactivo.</strong><span>Al calcular el nuevo reparto, se moverán hacia el equipo seleccionado.</span></div>}
      {redistributing && <div className="assignment-history-note"><strong>El trabajo ya realizado no cambia.</strong><span>Las decisiones guardadas, las correcciones y la productividad histórica conservan a su autor. {preservedCompletedBlockCount.toLocaleString('es-CO')} bloques terminados quedan intactos.</span></div>}
    </section>

    {proposalReady && <div className="assignment-load-grid">{loads.map((load) => <article className="assignment-load-card" key={load.userId}><i/><small>{load.name}</small><strong>{redistributing ? load.weight.toFixed(1) : load.alerts.toLocaleString('es-CO')}</strong><span>{redistributing ? `peso pendiente · ${load.blocks} bloques` : `${load.blocks} bloques · peso ${load.weight.toFixed(1)}`}</span></article>)}</div>}

    <section className="panel">
      <div className="panel-header assignment-plan-header">
        <div>
          <h2>{redistributing ? 'Nuevo reparto de bloques pendientes' : 'Propuesta de bloques'}</h2>
          <p>{redistributing
            ? `${pendingTaskCount.toLocaleString('es-CO')} tareas siguen pendientes. Los relacionados permanecen juntos y los bloques terminados conservan su responsable.`
            : `${expectedBlockCount.toLocaleString('es-CO')} bloques cargados. Los relacionados alertados permanecen juntos.`}</p>
        </div>
        <div className="heading-actions">
          <button className="button button-secondary" disabled={busy || selectedValidatorIds.length === 0} onClick={() => void calculate()} type="button">{busyAction === 'calculate' ? 'Calculando…' : redistributing ? 'Calcular nuevo reparto' : 'Calcular reparto'}</button>
          <button className="button button-primary" disabled={busy || !proposalReady || selectedValidatorIds.length === 0} onClick={() => void publish()} type="button">{busyAction === 'publish' ? 'Publicando…' : redistributing ? 'Publicar nuevo reparto' : 'Publicar reparto'}</button>
        </div>
      </div>
      {error && <p className="form-error assignment-error" role="alert">{error}</p>}
      {!proposalReady ? <div className="assignment-plan-placeholder" role="status"><strong>Falta calcular la propuesta.</strong><p>Confirma arriba quiénes trabajarán y calcula el reparto antes de publicarlo.</p></div> : <div className="data-table-wrap"><table className="data-table assignment-plan-table"><thead><tr><th>Bloque</th><th>{redistributing ? 'Alertas originales' : 'Alertas'}</th><th>Registros relacionados</th><th>Facturas</th><th>{redistributing ? 'Peso pendiente' : 'Peso'}</th><th>Responsable</th></tr></thead><tbody>{blocks.map((block) => <tr key={block.id}><td className="mono">{block.blockKey}</td><td>{block.alertCount}</td><td>{block.memberCount}</td><td>{block.invoiceCount}</td><td>{block.weight.toFixed(1)}</td><td><select aria-label={`Responsable del bloque ${block.blockKey}`} className="form-control" disabled={busy} value={block.assignedTo ?? ''} onChange={(event) => { setError(''); publishMutationIdRef.current = null; setBlocks((current) => current.map((item) => item.id === block.id ? { ...item, assignedTo: event.target.value || null } : item)); }}><option value="">Sin asignar</option>{selectedValidators.map((validator) => <option value={validator.userId} key={validator.userId}>{validator.name}</option>)}</select></td></tr>)}</tbody></table></div>}
    </section>
  </>;
}
