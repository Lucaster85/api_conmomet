/**
 * Helpers de diff para el historial de Presupuestos (ver FLOWS.md §35, Etapa 3). Construyen el
 * `context` que se guarda en AuditLogs — todo el valor, sin pelar nada: el pelado por permiso
 * (material_costs_read/budget_prices_read) pasa recién al LEER el historial
 * (helpers/budgetTotals.js#peelAuditContext), nunca al escribirlo.
 *
 * El diff de líneas matchea por `id` — confiable desde la Etapa 1 (upsert, no destroy+recreate):
 * antes de eso, toda línea "sobrevivía" a un guardado con un id nuevo, así que comparar por id
 * hubiera marcado como added+removed lo que en realidad no cambió.
 */

// Snapshot plano de los campos indicados de un modelo/objeto — para comparar antes/después.
function snapshotFields(obj, fields) {
  const snapshot = {};
  for (const field of fields) {
    snapshot[field] = obj[field] ?? null;
  }
  return snapshot;
}

// Diferencia dos snapshots (mismos campos) y devuelve solo los que cambiaron.
function diffFields(before, after, fields) {
  const changes = [];
  for (const field of fields) {
    const beforeValue = before[field] ?? null;
    const afterValue = after[field] ?? null;
    if (String(beforeValue) !== String(afterValue)) {
      changes.push({ field, before: beforeValue, after: afterValue });
    }
  }
  return changes;
}

/**
 * Diferencia dos listas de líneas (BudgetLaborLine o BudgetMaterialItem) por `id`.
 * `describeLine(line)` convierte una línea en el objeto plano que se guarda en el historial —
 * cada tipo de línea define el suyo (ver budgetController.js/additionalController.js).
 */
function diffLines(previousLines, currentLines, describeLine) {
  const previousById = new Map(previousLines.map((l) => [l.id, l]));
  const currentById = new Map(currentLines.map((l) => [l.id, l]));

  const added = currentLines
    .filter((l) => !previousById.has(l.id))
    .map(describeLine);

  const removed = previousLines
    .filter((l) => !currentById.has(l.id))
    .map(describeLine);

  const changed = [];
  for (const line of currentLines) {
    const previousLine = previousById.get(line.id);
    if (!previousLine) continue;
    const before = describeLine(previousLine);
    const after = describeLine(line);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changed.push({ before, after });
    }
  }

  return { added, removed, changed };
}

// true si el diff no tiene nada — para no escribir una fila de AuditLog vacía.
function isEmptyDiff(diff) {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}

module.exports = { snapshotFields, diffFields, diffLines, isEmptyDiff };
