# Contrato Supabase de la plataforma PQM

La migración base está en `supabase/migrations/20260824185702_collaborative_platform.sql`. No contiene secretos ni crea usuarios Auth. La ruta de servidor crea el usuario Auth y usa las RPC para enlazarlo con el workspace.

## Autenticación

- `issue_bootstrap_token(token_hash_hex, workspace_name, workspace_slug, expires_at)` se ejecuta únicamente con `service_role`. El servidor genera un token aleatorio, persiste solo su SHA-256 hexadecimal y entrega el valor original en el enlace de un solo uso.
- El usuario ya autenticado llama `claim_bootstrap_leader(token, username, display_name)`. El email se toma de `auth.users` y se guarda como `profiles.auth_email`.
- Para altas posteriores, el servidor crea primero el usuario Auth y un líder llama `register_workspace_member(workspace_id, user_id, username, auth_email, display_name, role)`.
- El login username+PIN usa, solo desde servidor, `get_login_identity(username)` antes de `signInWithPassword`, y después `record_login_attempt(username, succeeded)`. Cinco fallos dentro de 15 minutos bloquean 30 minutos.

## Registro de una carga

`create_upload` recibe un UUID generado por el cliente y exige estas rutas:

```text
<workspace_id>/<upload_id>/panel/<archivo.xlsx>
<workspace_id>/<upload_id>/invoices/<archivo.xlsx>
```

Columnas relevantes de `uploads`:

- Identidad: `id`, `workspace_id`, `display_name`, `status`, `version`.
- Storage: `panel_object_path`, `invoice_object_path`, hashes SHA-256 y tamaños.
- Origen: `source_sheet`, `source_headers`, `manifest_hash`.
- Métricas: `total_rows` (toda la hoja), `task_count`, `alert_count`, `orthography_count`, `pending_task_count`, `corrected_cell_count`, `confirmed_correct_count`.
- Ciclo de vida: `ingestion_finalized_at`, `assignments_published_at`, `completed_at`, `delete_after`, `scrubbed_at`.

`total_rows` no es `count(source_rows)`: la tabla `source_rows` contiene solo filas alertadas o necesarias como contexto.
Cada archivo está limitado a 150 MiB tanto en la tabla como en el bucket privado.
En producción, el límite global de Storage del proyecto también debe configurarse en al menos 150 MiB; un límite global menor prevalece sobre el del bucket.

## Lote de ingesta

`ingest_validation_batch(upload_id, batch_key, payload)` admite hasta 1.000 filas y 10.000 alertas por lote. `batch_key` es UUID e idempotente: repetirlo con el mismo JSON no duplica; repetirlo con contenido distinto falla. Los `external_key` son strings estables del cliente y se traducen a UUID/bigint internos.

Ejemplo exacto mínimo:

```json
{
  "rows": [
    {
      "external_key": "row-26",
      "excel_row": 26,
      "row_id": "RID-00025",
      "id_dn_w": "FAC-123",
      "barcode": "09100055",
      "description": "MANDARINA IMPORTADA 1KG-1",
      "field_values": {
        "Categoria_Wm": "FRUTAS",
        "Producto_Wm": "MANDARINA"
      },
      "source_fingerprint_hex": "<64 caracteres hex>"
    }
  ],
  "groups": [
    {
      "external_key": "group-r01-09100055",
      "rule_code": "R01",
      "group_key": "09100055",
      "normalized_key": "09100055",
      "affected_field": "Descripcion",
      "observed_values": [
        {"value": "MANDARINA IMPORTADA 1KG", "count": 34},
        {"value": "MANDARINA IMPORTADA 1KG-1", "count": 1}
      ],
      "affected_row_count": 35,
      "alert_count": 1
    }
  ],
  "group_members": [
    {
      "group_external_key": "group-r01-09100055",
      "row_external_key": "row-26",
      "is_alert": true,
      "is_related_context": true,
      "observed_value": "MANDARINA IMPORTADA 1KG-1",
      "value_frequency": 1
    }
  ],
  "blocks": [
    {
      "external_key": "block-r01-09100055",
      "block_key": "R01:09100055",
      "alert_count": 1,
      "member_count": 35,
      "invoice_count": 4,
      "weight": 6.65,
      "priority": 0
    }
  ],
  "tasks": [
    {
      "external_key": "task-26",
      "row_external_key": "row-26",
      "block_external_key": "block-r01-09100055",
      "is_related_only": false,
      "alert_count": 1
    }
  ],
  "alerts": [
    {
      "event_key": "alert-r01-row-26-descripcion",
      "task_external_key": "task-26",
      "group_external_key": "group-r01-09100055",
      "excel_row": 26,
      "rule_code": "R01",
      "category": "validation",
      "affected_field": "Descripcion",
      "source_column_index": 25,
      "original_value": "MANDARINA IMPORTADA 1KG-1",
      "expected_or_conflicts": "MANDARINA IMPORTADA 1KG (34); MANDARINA IMPORTADA 1KG-1 (1)",
      "detail": "El código tiene dos descripciones.",
      "severity": 2,
      "suggested_column_name": "Descripcion",
      "suggested_column_index": 25,
      "suggested_value": "MANDARINA IMPORTADA 1KG",
      "suggestion_method": "strict_majority",
      "suggestion_confidence": "high",
      "suggestion_evidence": {"winner_count": 34, "total_count": 35},
      "suggestion_alternatives": [
        {"value": "MANDARINA IMPORTADA 1KG-1", "count": 1}
      ],
      "can_auto_apply": true,
      "evidence_fingerprint_hex": "<64 caracteres hex>"
    }
  ],
  "invoices": [
    {
      "row_external_key": "row-26",
      "id_dn_w": "FAC-123",
      "ref_id_stg": "REF-456",
      "external_url": "https://ejemplo.invalid/factura.jpg",
      "storage_object_path": null,
      "metadata": {"page": 1}
    }
  ]
}
```

Las colecciones ausentes se tratan como arreglos vacíos. Después del último lote:

Las alternativas de una alerta se guardan una sola vez en
`conflict_groups.observed_values`. `validation_alerts.suggestion_alternatives`
queda vacío en cargas nuevas y solo se conserva por compatibilidad con jornadas
anteriores; la pantalla de revisión combina ambos formatos transparentemente.

```text
finalize_upload_ingestion(
  upload_id,
  source_total_rows,
  expected_stored_row_count,
  expected_task_count,
  expected_alert_count,
  expected_batch_count,
  manifest_hash_hex
)
```

## Revisión y concurrencia

- `propose_balanced_assignments` prepara un reparto por peso; `publish_assignments` lo publica de forma atómica.
- `resolve_alert` y `reopen_alert` requieren la `version` observada y un `client_mutation_id` UUID. Una versión obsoleta devuelve conflicto SQLSTATE `40001`.
- `add_related_row_to_block` solo agrega una fila sin tarea previa. Si pertenece a otro bloque, falla para que un líder decida mover/fusionar.
- `save_related_cell_resolution` y `confirm_related_task` resuelven tareas creadas desde contexto.
- `cell_resolutions` es el overlay canónico con unicidad `(upload_id, source_row_id, column_index)`.

## Retención

El cron server llama `claim_expired_uploads`, elimina los objetos devueltos mediante Storage API y luego llama `finalize_upload_retention`. A los 90 días se purgan valores de celdas, URLs y evidencia; permanecen métricas y auditoría resumida.
