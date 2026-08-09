const { Op } = require("sequelize");
const ExcelJS = require("exceljs");
const db = require("../models");
const { createProjectFromBudget } = require("../services/projectFactory");
const { uploadToR2, userHasPermission, computeTotalsByCurrency } = require("../helpers");

/**
 * Si la línea trae material_id, resuelve el costo real del Material y lo "fotografía" en
 * la línea (material_cost_snapshot/currency) — no se recalcula después aunque el costo del
 * material cambie. Sin permiso material_costs_read no se puede vincular costo (el material
 * queda igual vinculado, solo que sin snapshot).
 */
async function resolveMaterialCostSnapshot(materialId, user, transaction) {
  if (!materialId || !userHasPermission(user, "material_costs_read")) {
    return { material_cost_snapshot: null, material_cost_currency: null };
  }
  const material = await db.Material.findByPk(materialId, { transaction });
  if (!material) return { material_cost_snapshot: null, material_cost_currency: null };
  return {
    material_cost_snapshot: material.current_cost,
    material_cost_currency: material.currency,
  };
}

/**
 * Auto-generates a budget number like PRES-2026-001
 */
async function generateBudgetNumber() {
  const year = new Date().getFullYear();
  const prefix = `PRES-${year}-`;

  const lastBudget = await db.Budget.findOne({
    where: { number: { [Op.like]: `${prefix}%` } },
    order: [["number", "DESC"]],
    paranoid: false,
  });

  let seq = 1;
  if (lastBudget && lastBudget.number) {
    const lastSeq = parseInt(lastBudget.number.replace(prefix, ""), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(3, "0")}`;
}

/**
 * Resuelve a qué proyecto queda atado un presupuesto según lo que mandó el usuario:
 * - parent_project_id: "adicional de" — al aprobar genera un SUBPROYECTO nuevo hijo de este.
 * - existing_project_id: "vincular a" — al aprobar NO crea nada, reusa este proyecto raíz
 *   directamente y le sobreescribe budgeted_hours.
 * - ninguno: presupuesto para un proyecto totalmente nuevo.
 * Son mutuamente excluyentes. En los dos primeros casos, cliente/planta se fuerzan desde el
 * proyecto elegido — el valor que haya mandado el body se ignora, para que no puedan quedar
 * inconsistentes (el frontend ya los deshabilita, esto es el resguardo server-side).
 */
async function resolveProjectLinkage({ parent_project_id, existing_project_id, client_id, plant_id, excludeBudgetId }, transaction) {
  if (parent_project_id && existing_project_id) {
    throw new Error("Un presupuesto no puede ser 'adicional de' y 'vinculado a' un proyecto al mismo tiempo.");
  }

  if (parent_project_id) {
    const parentProject = await db.Project.findByPk(parent_project_id, { transaction });
    if (!parentProject) throw new Error("El proyecto padre indicado no existe.");
    if (parentProject.parent_id) throw new Error("El proyecto seleccionado ya es un subproyecto — no se admiten más de 2 niveles.");
    return {
      parent_project_id: parentProject.id,
      existing_project_id: null,
      client_id: parentProject.client_id,
      plant_id: parentProject.plant_id || null,
    };
  }

  if (existing_project_id) {
    const project = await db.Project.findByPk(existing_project_id, { transaction });
    if (!project) throw new Error("El proyecto indicado no existe.");
    if (project.parent_id) throw new Error("Solo se puede vincular presupuestos a proyectos raíz (no a subproyectos).");

    const claimWhere = {
      status: { [Op.ne]: "rejected" },
      [Op.or]: [{ project_id: project.id }, { existing_project_id: project.id }],
    };
    if (excludeBudgetId) claimWhere.id = { [Op.ne]: excludeBudgetId };
    const alreadyClaimed = await db.Budget.findOne({ where: claimWhere, transaction });
    if (alreadyClaimed) throw new Error("Ese proyecto ya tiene un presupuesto vinculado o pendiente de aprobación.");

    return {
      parent_project_id: null,
      existing_project_id: project.id,
      client_id: project.client_id,
      plant_id: project.plant_id || null,
    };
  }

  return { parent_project_id: null, existing_project_id: null, client_id, plant_id: plant_id || null };
}

const budgetDetailInclude = [
  { model: db.Client, as: "client", attributes: ["id", "razonSocial"] },
  { model: db.Plant, as: "plant", attributes: ["id", "name"] },
  { model: db.Project, as: "parentProject", attributes: ["id", "name", "code"] },
  { model: db.Project, as: "existingProject", attributes: ["id", "name", "code"] },
  { model: db.Project, as: "project", attributes: ["id", "name", "code"] },
  { model: db.User, as: "createdBy", attributes: ["id", "name", "lastname"] },
  { model: db.User, as: "approvedBy", attributes: ["id", "name", "lastname"] },
  { model: db.ClientSupervisor, as: "approvedBySupervisor", attributes: ["id", "name", "lastname", "email", "phone"] },
  { model: db.BudgetLaborLine, as: "laborLines", include: [{ model: db.BudgetItemType, as: "itemType" }] },
  {
    model: db.BudgetMaterialItem, as: "materialItems",
    include: [
      { model: db.MaterialUnit, as: "materialUnit" },
      { model: db.Material, as: "material", include: [{ model: db.MaterialUnit, as: "materialUnit" }] },
    ],
  },
];

// El costo/margen es más sensible que el precio de venta — se gatea con material_costs_read,
// un permiso aparte de budgets_read (ver FLOWS.md).
function withTotals(budgetInstance, user) {
  const data = budgetInstance.toJSON();
  data.totals_by_currency = computeTotalsByCurrency(data, data.laborLines || [], data.materialItems || []);

  if (!userHasPermission(user, "material_costs_read")) {
    data.materialItems = (data.materialItems || []).map((item) => {
      const { material_cost_snapshot, material_cost_currency, ...rest } = item;
      if (rest.material) {
        const { current_cost, currency, ...materialRest } = rest.material;
        rest.material = materialRest;
      }
      return rest;
    });
  }

  return data;
}

module.exports = {
  getAll: async (req, res) => {
    try {
      const { status, client_id } = req.query;
      const where = {};
      if (status) where.status = status;
      if (client_id) where.client_id = client_id;

      const budgets = await db.Budget.findAll({
        where,
        include: budgetDetailInclude,
        order: [["created_at", "DESC"]],
      });

      return res.status(200).json({ data: budgets.map((b) => withTotals(b, req.user)) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const budget = await db.Budget.findByPk(req.params.id, { include: budgetDetailInclude });
      if (!budget) return res.status(404).json({ error: "Presupuesto no encontrado." });
      return res.status(200).json({ data: withTotals(budget, req.user) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const {
      title, client_id, plant_id, currency, parent_project_id, existing_project_id,
      description, notes, start_date, end_date, validity_days, laborLines, materialItems,
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: "El título es obligatorio." });
    }

    const transaction = await db.sequelize.transaction();
    try {
      let linkage;
      try {
        linkage = await resolveProjectLinkage({ parent_project_id, existing_project_id, client_id, plant_id }, transaction);
      } catch (linkageError) {
        await transaction.rollback();
        return res.status(400).json({ error: linkageError.message });
      }

      if (!linkage.client_id) {
        await transaction.rollback();
        return res.status(400).json({ error: "Cliente es obligatorio." });
      }

      const number = await generateBudgetNumber();

      const budget = await db.Budget.create({
        number,
        title,
        client_id: linkage.client_id,
        plant_id: linkage.plant_id,
        currency: currency || "ARS",
        parent_project_id: linkage.parent_project_id,
        existing_project_id: linkage.existing_project_id,
        description: description || null,
        start_date: start_date || null,
        end_date: end_date || null,
        validity_days: validity_days !== undefined && validity_days !== null ? validity_days : 15,
        notes: notes || null,
        created_by: req.user.id,
      }, { transaction });

      if (Array.isArray(laborLines)) {
        for (const line of laborLines) {
          const quantity = parseFloat(line.quantity || 0);
          const unitPrice = parseFloat(line.unit_price || 0);
          await db.BudgetLaborLine.create({
            budget_id: budget.id,
            budget_item_type_id: line.budget_item_type_id,
            quantity,
            unit_price: unitPrice,
            currency: line.currency || null,
            estimated_total: quantity * unitPrice,
            notes: line.notes || null,
          }, { transaction });
        }
      }

      if (Array.isArray(materialItems)) {
        for (const item of materialItems) {
          const quantity = parseFloat(item.quantity || 0);
          const unitPrice = parseFloat(item.unit_price || 0);
          const costSnapshot = await resolveMaterialCostSnapshot(item.material_id, req.user, transaction);
          await db.BudgetMaterialItem.create({
            budget_id: budget.id,
            material_id: item.material_id || null,
            description: item.description,
            quantity,
            material_unit_id: item.material_unit_id,
            unit_price: unitPrice,
            currency: item.currency || null,
            total_price: quantity * unitPrice,
            notes: item.notes || null,
            ...costSnapshot,
          }, { transaction });
        }
      }

      await transaction.commit();

      const fullBudget = await db.Budget.findByPk(budget.id, { include: budgetDetailInclude });
      return res.status(201).json({ data: withTotals(fullBudget, req.user) });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    const { id } = req.params;
    const {
      title, client_id, plant_id, currency, parent_project_id, existing_project_id,
      description, notes, start_date, end_date, validity_days, laborLines, materialItems,
    } = req.body;

    const transaction = await db.sequelize.transaction();
    try {
      const budget = await db.Budget.findByPk(id, { transaction });
      if (!budget) {
        await transaction.rollback();
        return res.status(404).json({ error: "Presupuesto no encontrado." });
      }
      if (budget.status !== "draft") {
        await transaction.rollback();
        return res.status(400).json({ error: "Solo se pueden editar presupuestos en estado borrador." });
      }

      const linkageChanged = parent_project_id !== undefined || existing_project_id !== undefined;
      let linkage = {
        parent_project_id: budget.parent_project_id,
        existing_project_id: budget.existing_project_id,
        client_id: client_id !== undefined ? client_id : budget.client_id,
        plant_id: plant_id !== undefined ? (plant_id || null) : budget.plant_id,
      };
      if (linkageChanged) {
        try {
          linkage = await resolveProjectLinkage({
            parent_project_id: parent_project_id !== undefined ? parent_project_id : budget.parent_project_id,
            existing_project_id: existing_project_id !== undefined ? existing_project_id : budget.existing_project_id,
            client_id: client_id !== undefined ? client_id : budget.client_id,
            plant_id: plant_id !== undefined ? plant_id : budget.plant_id,
            excludeBudgetId: budget.id,
          }, transaction);
        } catch (linkageError) {
          await transaction.rollback();
          return res.status(400).json({ error: linkageError.message });
        }
      }

      await budget.update({
        title: title !== undefined ? title : budget.title,
        client_id: linkage.client_id,
        plant_id: linkage.plant_id,
        currency: currency !== undefined ? currency : budget.currency,
        parent_project_id: linkage.parent_project_id,
        existing_project_id: linkage.existing_project_id,
        description: description !== undefined ? description : budget.description,
        start_date: start_date !== undefined ? (start_date || null) : budget.start_date,
        end_date: end_date !== undefined ? (end_date || null) : budget.end_date,
        validity_days: validity_days !== undefined ? validity_days : budget.validity_days,
        notes: notes !== undefined ? notes : budget.notes,
      }, { transaction });

      if (Array.isArray(laborLines)) {
        // force: true (hard delete) — si fuera soft-delete, la fila borrada seguiría
        // chocando con el índice único (budget_id, budget_item_type_id) al recrear la
        // misma línea, y Sequelize devuelve un UniqueConstraintError ("Validation error").
        await db.BudgetLaborLine.destroy({ where: { budget_id: budget.id }, transaction, force: true });
        for (const line of laborLines) {
          const quantity = parseFloat(line.quantity || 0);
          const unitPrice = parseFloat(line.unit_price || 0);
          await db.BudgetLaborLine.create({
            budget_id: budget.id,
            budget_item_type_id: line.budget_item_type_id,
            quantity,
            unit_price: unitPrice,
            currency: line.currency || null,
            estimated_total: quantity * unitPrice,
            notes: line.notes || null,
          }, { transaction });
        }
      }

      if (Array.isArray(materialItems)) {
        // Antes de destruir, guardamos cómo estaba cada línea — para poder PRESERVAR el
        // material_cost_snapshot de las que no cambiaron de material en esta edición. Sin
        // esto, destruir+recrear en cada guardado terminaba re-resolviendo el costo VIGENTE
        // de todas las líneas (incluidas las que no tocaste) cada vez que se guardaba el
        // presupuesto por cualquier motivo — bug real detectado en uso, ver FLOWS.md.
        const existingItems = await db.BudgetMaterialItem.findAll({
          where: { budget_id: budget.id },
          attributes: ["id", "material_id", "material_cost_snapshot", "material_cost_currency"],
          transaction,
        });
        const existingById = new Map(existingItems.map((i) => [i.id, i]));

        await db.BudgetMaterialItem.destroy({ where: { budget_id: budget.id }, transaction, force: true });
        for (const item of materialItems) {
          const quantity = parseFloat(item.quantity || 0);
          const unitPrice = parseFloat(item.unit_price || 0);

          const existing = item.id ? existingById.get(item.id) : null;
          const materialUnchanged = existing && (existing.material_id || null) === (item.material_id || null);

          // Línea ya existente sin cambio de material → se preserva la foto tal cual estaba.
          // Línea nueva, o existente con el material recién vinculado/cambiado → vinculación
          // deliberada, se resuelve el costo vigente en este momento.
          const costSnapshot = materialUnchanged
            ? { material_cost_snapshot: existing.material_cost_snapshot, material_cost_currency: existing.material_cost_currency }
            : await resolveMaterialCostSnapshot(item.material_id, req.user, transaction);

          await db.BudgetMaterialItem.create({
            budget_id: budget.id,
            material_id: item.material_id || null,
            description: item.description,
            quantity,
            material_unit_id: item.material_unit_id,
            unit_price: unitPrice,
            currency: item.currency || null,
            total_price: quantity * unitPrice,
            notes: item.notes || null,
            ...costSnapshot,
          }, { transaction });
        }
      }

      await transaction.commit();

      const fullBudget = await db.Budget.findByPk(budget.id, { include: budgetDetailInclude });
      return res.status(200).json({ data: withTotals(fullBudget, req.user) });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const budget = await db.Budget.findByPk(req.params.id);
      if (!budget) return res.status(404).json({ error: "Presupuesto no encontrado." });
      if (budget.status !== "draft") {
        return res.status(400).json({ error: "Solo se pueden eliminar presupuestos en estado borrador." });
      }
      await budget.destroy();
      return res.status(200).json({ message: "Presupuesto eliminado." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  changeStatus: async (req, res) => {
    const { id } = req.params;
    const { status, rejection_reason, approved_by_supervisor_id } = req.body;
    const file = req.file;

    const validTransitions = {
      draft: ["sent"],
      sent: ["approved", "rejected"],
      // "approved" -> "approved" no es una transición real: permite volver a llamar este
      // mismo endpoint solo para subir/reemplazar el documento firmado, igual que
      // ocaController.approve permite re-aprobar una OCA ya aprobada para actualizar la imagen.
      approved: ["approved"],
    };

    try {
      const budget = await db.Budget.findByPk(id);
      if (!budget) return res.status(404).json({ error: "Presupuesto no encontrado." });

      const allowed = validTransitions[budget.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: `No se puede cambiar el estado de "${budget.status}" a "${status}".` });
      }

      if (status === "rejected" && !rejection_reason) {
        return res.status(400).json({ error: "El motivo de rechazo es obligatorio." });
      }

      const updates = { status };
      if (status === "sent") updates.sent_at = new Date();
      if (status === "rejected") {
        updates.rejected_at = new Date();
        updates.rejection_reason = rejection_reason;
      }
      if (status === "approved") {
        // Documento firmado y supervisor externo son opcionales — se puede aprobar sin
        // completarlos y volver a llamar este mismo endpoint después para agregarlos.
        updates.approved_at = budget.approved_at || new Date();
        // approved_by: quién cargó la aprobación en el sistema (usuario interno).
        updates.approved_by = budget.approved_by || req.user.id;
        // approved_by_supervisor_id: quién aprobó del lado del cliente (contacto externo,
        // distinto del usuario interno de arriba).
        if (approved_by_supervisor_id) {
          updates.approved_by_supervisor_id = approved_by_supervisor_id;
        }
        if (file) {
          updates.approved_document_url = await uploadToR2(file, `budgets/${budget.id}`);
        }
      }

      await budget.update(updates);

      const fullBudget = await db.Budget.findByPk(budget.id, { include: budgetDetailInclude });
      return res.status(200).json({ data: withTotals(fullBudget, req.user) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  generateProject: async (req, res) => {
    const { id } = req.params;
    const transaction = await db.sequelize.transaction();

    try {
      const budget = await db.Budget.findByPk(id, { transaction });
      if (!budget) {
        await transaction.rollback();
        return res.status(404).json({ error: "Presupuesto no encontrado." });
      }
      if (budget.status !== "approved") {
        await transaction.rollback();
        return res.status(400).json({ error: "Solo se puede generar el proyecto desde un presupuesto aprobado." });
      }
      if (budget.project_id) {
        await transaction.rollback();
        return res.status(400).json({ error: "Este presupuesto ya generó un proyecto." });
      }

      const project = await createProjectFromBudget(budget, transaction);
      await budget.update({ project_id: project.id }, { transaction });

      await transaction.commit();

      const fullBudget = await db.Budget.findByPk(budget.id, { include: budgetDetailInclude });
      return res.status(200).json({ message: "Proyecto generado correctamente.", data: withTotals(fullBudget, req.user) });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  duplicate: async (req, res) => {
    const { id } = req.params;
    const transaction = await db.sequelize.transaction();

    try {
      const original = await db.Budget.findByPk(id, {
        include: [
          { model: db.BudgetLaborLine, as: "laborLines" },
          { model: db.BudgetMaterialItem, as: "materialItems" },
        ],
        transaction,
      });
      if (!original) {
        await transaction.rollback();
        return res.status(404).json({ error: "Presupuesto no encontrado." });
      }

      const number = await generateBudgetNumber();
      const copy = await db.Budget.create({
        number,
        title: `${original.title} (copia)`,
        client_id: original.client_id,
        plant_id: original.plant_id,
        currency: original.currency,
        parent_project_id: original.parent_project_id,
        // existing_project_id NO se copia a propósito: si el original quedó vinculado (o
        // pendiente de vincularse) a un proyecto existente, duplicar y dejar el mismo
        // vínculo crearía dos borradores compitiendo por el mismo proyecto.
        existing_project_id: null,
        description: original.description,
        start_date: original.start_date,
        end_date: original.end_date,
        validity_days: original.validity_days,
        notes: original.notes,
        status: "draft",
        created_by: req.user.id,
      }, { transaction });

      for (const line of original.laborLines) {
        await db.BudgetLaborLine.create({
          budget_id: copy.id,
          budget_item_type_id: line.budget_item_type_id,
          quantity: line.quantity,
          unit_price: line.unit_price,
          currency: line.currency,
          estimated_total: line.estimated_total,
          notes: line.notes,
        }, { transaction });
      }

      for (const item of original.materialItems) {
        await db.BudgetMaterialItem.create({
          budget_id: copy.id,
          material_id: item.material_id,
          description: item.description,
          quantity: item.quantity,
          material_unit_id: item.material_unit_id,
          unit_price: item.unit_price,
          currency: item.currency,
          total_price: item.total_price,
          material_cost_snapshot: item.material_cost_snapshot,
          material_cost_currency: item.material_cost_currency,
          notes: item.notes,
        }, { transaction });
      }

      await transaction.commit();

      const fullBudget = await db.Budget.findByPk(copy.id, { include: budgetDetailInclude });
      return res.status(201).json({ message: "Presupuesto duplicado como borrador.", data: withTotals(fullBudget, req.user) });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  // Parseo "stateless" de un Excel de materiales — no persiste nada, solo devuelve
  // filas de previsualización para que el frontend las agregue al form (nuevo o existente).
  importMaterials: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Debe subir un archivo .xlsx/.xls." });
      }

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      // Se busca la hoja "Materiales" por nombre, no por posición: herramientas como Numbers
      // agregan una hoja "Export Summary" primera al exportar a .xlsx, y tomar worksheets[0]
      // a ciegas terminaba leyendo esa hoja en vez de los datos reales.
      const worksheet = workbook.worksheets.find(
        (ws) => ws.name.trim().toLowerCase() === "materiales"
      ) || workbook.worksheets[0];
      if (!worksheet) {
        return res.status(400).json({ error: "El archivo no tiene hojas." });
      }

      const headers = [];
      worksheet.getRow(1).eachCell((cell, colNumber) => {
        headers[colNumber] = cell.value != null ? String(cell.value) : "";
      });

      const rawRows = [];
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // header
        const rowObj = {};
        row.eachCell((cell, colNumber) => {
          if (headers[colNumber]) rowObj[headers[colNumber]] = cell.value;
        });
        if (Object.keys(rowObj).length > 0) rawRows.push(rowObj);
      });

      const normalizeKey = (key) => key
        .toString()
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");

      // "cost" acá es a propósito, no "unit_price": esta columna del Excel representa el
      // costo real del material (lo que sale comprarlo), no lo que se le cobra al cliente
      // — ver FLOWS.md. Nunca se autocompleta unit_price con este valor.
      const COLUMN_ALIASES = {
        description: ["material", "descripcion", "detalle", "item", "producto"],
        quantity: ["cantidad", "cant", "qty"],
        unit: ["unidad", "u", "um"],
        cost: ["costo", "precio unitario", "precio por cantidad", "precio unit", "pu", "costo unitario"],
        total_price: ["precio total", "total", "importe"],
      };

      const rows = rawRows.map((rawRow) => {
        const normalizedRow = {};
        for (const [key, value] of Object.entries(rawRow)) {
          normalizedRow[normalizeKey(key)] = value;
        }

        const findValue = (aliases) => {
          for (const alias of aliases) {
            if (normalizedRow[alias] !== undefined) return normalizedRow[alias];
          }
          return null;
        };

        const quantity = parseFloat(findValue(COLUMN_ALIASES.quantity)) || 0;
        const cost = parseFloat(findValue(COLUMN_ALIASES.cost)) || 0;
        const totalPriceRaw = findValue(COLUMN_ALIASES.total_price);
        const totalPrice = totalPriceRaw !== null ? parseFloat(totalPriceRaw) || 0 : quantity * cost;

        return {
          description: findValue(COLUMN_ALIASES.description) || "",
          quantity,
          unit: findValue(COLUMN_ALIASES.unit) || "u",
          cost,
          total_price: totalPrice,
        };
      }).filter((row) => row.description);

      return res.status(200).json({ data: rows });
    } catch (error) {
      return res.status(500).json({ error: `No se pudo leer el archivo: ${error.message}` });
    }
  },
};
