# Plataforma colaborativa PQM Walmart

Aplicación interna para detectar, repartir, revisar y corregir alertas del panel PQM. La interfaz usa Next.js App Router y Supabase; el motor R01–R29, EST, JER y ortografía sigue ejecutándose localmente en un Web Worker.

## Flujo operativo

1. Un líder carga el panel y el libro de facturas. Los archivos se guardan en un bucket privado mediante una carga TUS reanudable.
2. El navegador valida el panel y guarda solamente las filas y el contexto necesarios para colaborar; la base completa no se duplica en Postgres.
3. El líder distribuye bloques indivisibles entre validadores. Cada persona solo accede a su asignación.
4. El validador compara evidencia, relacionados y facturas, y puede aplicar una propuesta confiable, editar manualmente o confirmar que el valor original está correcto.
5. El líder descarga un reporte, una base con columnas sugeridas o una copia corregida del libro original.

La copia corregida se genera bajo demanda y aplica un overlay de celdas al OOXML original, sin agregar hojas ni columnas. Las tablas dinámicas, estilos, vínculos, fórmulas no corregidas y cachés se conservan.

## Desarrollo local

Requiere Node.js 22 o superior y pnpm.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm dev
```

Copie `.env.example` como `.env.local` y configure las claves del proyecto. Solo `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` se expone al navegador; `SUPABASE_SECRET_KEY` es exclusiva de las rutas de servidor.

## Base de datos y seguridad

La migración base se encuentra en `supabase/migrations/20260824185702_collaborative_platform.sql`. Incluye RLS para líderes y validadores, Storage privado, bloqueo de PIN, ingestión idempotente, control de versión, auditoría, productividad y retención.

El contrato de funciones y lotes está documentado en `docs/supabase.md`. Los libros de trabajo (`.xlsx`, `.xls`, `.xlsm`) están excluidos de Git y nunca deben añadirse al repositorio.

## Despliegue

Producción se publica en Vercel desde `main`. Las variables requeridas son:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `CRON_SECRET`

El cron diario elimina primero los objetos privados vencidos y después anonimiza o elimina el detalle según la política de retención.
