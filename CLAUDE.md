# api_conmomet — Testing

Stack mínimo de tests, agregado para respaldar el trabajo de edición concurrente e historial de
Presupuestos (ver `FLOWS.md` §35 en la raíz del proyecto). Cubre lo que esa feature toca, no
toda la app — `../PLAN_TESTS.md` tiene el plan completo (16 secciones) si se retoma más adelante.

## Preparar la base de test

No hace falta Docker: la suite usa la MISMA instancia local de MySQL que `npm run dev` (la de
`DATABASE_*` en `.env`), en una base separada (`api_conmomet_test`) para poder truncarla y
recrearla sin tocar la de desarrollo.

```bash
npm run db:test:reset   # DROP + CREATE api_conmomet_test + todas las migraciones
```

`LOCAL_TEST_DATABASE_URL` (en `.env`) **tiene que apuntar a localhost** y a un nombre de base
distinto de `DATABASE_NAME`. `scripts/resetTestDb.js` aborta si no es así en cualquiera de los
dos casos — hace `DROP DATABASE`, y comparte servidor con la base de desarrollo.

**No es lo mismo que un `DATABASE_URL_STAGING`** que puedas tener guardado en tu `.env`
personal para mirar el ambiente de Railway que deployea `develop` — son variables distintas a
propósito, para que nunca se confundan entre sí.

`npm run db:test:reset` reconstruye el schema desde las ~185 migraciones (nunca
`sequelize.sync()`): es lo único que garantiza que la suite ejercita el mismo schema que
producción. Corre una sola vez por sesión de trabajo, no antes de cada test.

## Correr las suites

```bash
npm test               # unit + integration
npm run test:unit       # sin DB, rápido — el que corre en pre-push
npm run test:integration # contra la DB de test, en serie (--runInBand)
npm run test:watch      # unit en watch mode
```

`unit` y `integration` son dos *projects* de Jest (`jest.config.js`). `integration` tiene que
correr siempre con `--runInBand`: compart en la misma base, y cada test se aísla con un
`TRUNCATE` global en `afterEach` (`test/setup/truncate.js`) — correrlos en paralelo rompería
ese aislamiento.

## Qué NO se trunca entre tests

`test/setup/truncate.js` deja afuera `Permissions`, `Roles`, `SystemSettings`, `role_permission`
(sembrados una vez por `runSeed` en `test/setup/globalSetup.js`) y tres catálogos que vienen de
migraciones con `bulkInsert` incondicional, no de `runSeed`: `Providers` (la fila `is_system`,
"Sin especificar", la necesita `materialPriceService.js#getUnspecifiedProvider`),
`BudgetItemTypes` y `MaterialUnits`. Si un factory crea filas en esas tres tablas, usá un
sufijo random en cualquier columna `unique` (ver `test/factories/budget.js#createMaterialUnit`)
— no se limpian entre corridas sueltas de `test:integration` sin un `db:test:reset` en el medio.

Todo lo demás (`Users`, `Budgets`, `BudgetLaborLines`, etc.) se trunca después de cada test.
Ningún test debe asumir que el usuario admin del seed existe — minteá tus propios actores con
`test/helpers/auth.js#createActor`.

## Escribir un test nuevo

- `test/unit/<modulo>.test.js` — espejo de `helpers/`/`services/`, sin DB.
- `test/integration/<recurso>.<accion>.test.js` — un `describe` por endpoint, usando
  `test/helpers/auth.js` (`createActor`, `as`) y `test/factories/budget.js`.
- Nombres de `it()` **en español**, describiendo el comportamiento observable, sin "should".
  Ej: `it('omite material_cost_snapshot sin material_costs_read')`.
- Todo endpoint nuevo lleva su test de permisos: con el permiso exacto, sin él, y con
  `admin_granted` (bypass).

## Red de pre-push (opcional, no activada por defecto)

```bash
git config core.hooksPath .githooks
```

Corre `test:unit` antes de cada `git push` (rápido, sin DB). No se activó automáticamente —
es un cambio de configuración de git, y lo corre quien lo quiera.
