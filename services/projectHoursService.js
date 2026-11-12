const { Op, fn, col } = require("sequelize");
const db = require("../models");

// Horas de empleados (TimeEntry aprobadas) por proyecto Y por rubro (budget_item_type_id null =
// "Generales") — devuelve Map<project_id, Map<budget_item_type_id|null, horas>>.
async function sumTimeEntryHoursByType(projectIds) {
  if (projectIds.length === 0) return new Map();
  const rows = await db.TimeEntry.findAll({
    where: { project_id: { [Op.in]: projectIds }, status: "approved" },
    attributes: [
      "project_id",
      "budget_item_type_id",
      [fn("SUM", col("regular_hours")), "total_regular"],
      [fn("SUM", col("overtime_50_hours")), "total_50"],
      [fn("SUM", col("overtime_100_hours")), "total_100"],
    ],
    group: ["project_id", "budget_item_type_id"],
  });

  const map = new Map();
  for (const row of rows) {
    const reg = parseFloat(row.getDataValue("total_regular") || 0);
    const ot50 = parseFloat(row.getDataValue("total_50") || 0);
    const ot100 = parseFloat(row.getDataValue("total_100") || 0);
    const hours = reg + ot50 * 0.5 + ot100 * 1.0;
    if (!map.has(row.project_id)) map.set(row.project_id, new Map());
    map.get(row.project_id).set(row.budget_item_type_id, hours);
  }
  return map;
}

// Horas manuales activas (ProjectManualHour, FLOWS.md §56) — mismo formato que
// sumTimeEntryHoursByType. Las anuladas no cuentan.
async function sumManualHoursByType(projectIds) {
  if (projectIds.length === 0) return new Map();
  const rows = await db.ProjectManualHour.findAll({
    where: { project_id: { [Op.in]: projectIds }, status: "active" },
    attributes: ["project_id", "budget_item_type_id", [fn("SUM", col("hours")), "total_hours"]],
    group: ["project_id", "budget_item_type_id"],
  });

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.project_id)) map.set(row.project_id, new Map());
    map.get(row.project_id).set(row.budget_item_type_id, parseFloat(row.getDataValue("total_hours") || 0));
  }
  return map;
}

// Suma dos mapas Map<project_id, Map<typeId|null, horas>> en uno nuevo.
function mergeHourMaps(a, b) {
  const merged = new Map();
  for (const source of [a, b]) {
    for (const [projectId, typeMap] of source) {
      if (!merged.has(projectId)) merged.set(projectId, new Map());
      const target = merged.get(projectId);
      for (const [typeId, hours] of typeMap) target.set(typeId, (target.get(typeId) || 0) + hours);
    }
  }
  return merged;
}

// Horas consumidas por proyecto Y por rubro = empleados + manuales. Es el único punto por el que pasa
// todo lo que muestra "consumido" (listado y ficha de proyectos, adicionales, "Ya cargado en el
// proyecto" del presupuesto, facturación), así que sumar acá cubre todo de una vez.
async function sumConsumedHoursByType(projectIds) {
  const [fromEntries, fromManual] = await Promise.all([
    sumTimeEntryHoursByType(projectIds),
    sumManualHoursByType(projectIds),
  ]);
  return mergeHourMaps(fromEntries, fromManual);
}

// Arma, para cada proyecto, la lista de bolsas de horas por rubro (incluida "Generales") con
// presupuestado + consumido, más los totales — reemplaza al único Project.budgeted_hours.
async function buildHourBuckets(projectIds) {
  if (projectIds.length === 0) return new Map();

  const [budgetRows, employeeByType, manualByType] = await Promise.all([
    db.ProjectHourBudget.findAll({
      where: { project_id: { [Op.in]: projectIds } },
    }),
    sumTimeEntryHoursByType(projectIds),
    sumManualHoursByType(projectIds),
  ]);

  const typeIds = new Set();
  budgetRows.forEach((r) => { if (r.budget_item_type_id) typeIds.add(r.budget_item_type_id); });
  [employeeByType, manualByType].forEach((byType) => {
    byType.forEach((typeMap) => {
      typeMap.forEach((_, typeId) => { if (typeId) typeIds.add(typeId); });
    });
  });

  const itemTypes = typeIds.size > 0
    ? await db.BudgetItemType.findAll({ where: { id: { [Op.in]: [...typeIds] } }, attributes: ["id", "name"], paranoid: false })
    : [];
  const nameById = new Map(itemTypes.map((it) => [it.id, it.name]));

  const keyFor = (typeId) => (typeId === null || typeId === undefined ? "general" : String(typeId));

  const result = new Map();
  for (const projectId of projectIds) {
    result.set(projectId, new Map());
  }

  budgetRows.forEach((row) => {
    const buckets = result.get(row.project_id);
    buckets.set(keyFor(row.budget_item_type_id), {
      budget_item_type_id: row.budget_item_type_id,
      item_type_name: row.budget_item_type_id ? (nameById.get(row.budget_item_type_id) || "—") : "Generales",
      budgeted_hours: parseFloat(row.budgeted_hours || 0),
      consumed_hours: 0,
      consumed_hours_manual: 0,
    });
  });

  // `consumed_hours` es el total (empleados + manuales); `consumed_hours_manual` es la parte manual,
  // para mostrar el desglose. Un rubro con horas pero sin bolsa aparece con budgeted_hours: 0.
  const addConsumed = (byType, isManual) => {
    for (const [projectId, typeMap] of byType) {
      const buckets = result.get(projectId);
      if (!buckets) continue;
      for (const [typeId, hours] of typeMap) {
        const key = keyFor(typeId);
        if (!buckets.has(key)) {
          buckets.set(key, {
            budget_item_type_id: typeId,
            item_type_name: typeId ? (nameById.get(typeId) || "—") : "Generales",
            budgeted_hours: 0,
            consumed_hours: 0,
            consumed_hours_manual: 0,
          });
        }
        const bucket = buckets.get(key);
        bucket.consumed_hours += hours;
        if (isManual) bucket.consumed_hours_manual += hours;
      }
    }
  };
  addConsumed(employeeByType, false);
  addConsumed(manualByType, true);

  const finalResult = new Map();
  for (const [projectId, buckets] of result) {
    const list = Array.from(buckets.values()).sort((a, b) => {
      if (a.budget_item_type_id === null) return 1;
      if (b.budget_item_type_id === null) return -1;
      return a.item_type_name.localeCompare(b.item_type_name);
    });
    const budgeted_hours_total = list.reduce((sum, b) => sum + b.budgeted_hours, 0);
    const consumed_hours_total = list.reduce((sum, b) => sum + b.consumed_hours, 0);
    const consumed_hours_manual_total = list.reduce((sum, b) => sum + b.consumed_hours_manual, 0);
    finalResult.set(projectId, { hour_buckets: list, budgeted_hours_total, consumed_hours_total, consumed_hours_manual_total });
  }
  return finalResult;
}

module.exports = { sumConsumedHoursByType, sumTimeEntryHoursByType, sumManualHoursByType, buildHourBuckets };
