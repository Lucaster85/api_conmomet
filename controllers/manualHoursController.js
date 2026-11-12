const db = require("../models");
const { todayInArgentina } = require("../helpers/argentinaDate");

/**
 * Horas manuales de un proyecto/adicional (/time-entries/manual/*). FLOWS.md §56.
 *
 * Son horas SIN empleado ni tarifa, con un detalle, que descuentan de la bolsa de horas del rubro:
 * sirven para registrar y estimar cuánto llevó realmente una obra. Nunca modifican el presupuesto,
 * las horas de empleados, la liquidación, las OCAs ni el costo de mano de obra: lo único que las
 * lee es projectHoursService (lo "consumido" de cada bolsa).
 *
 * Cuelgan de /time-entries/ a propósito: authPermission deriva el permiso del primer segmento de la
 * URL, así que reusan time_entries_read / _write / _update sin código extra. No se editan ni se
 * borran: una carga equivocada se anula con motivo y queda visible.
 */

const MAX_HOURS = 9999;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const round2 = (n) => Math.round(n * 100) / 100;

function isValidIsoDate(value) {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const entryInclude = [
  { model: db.BudgetItemType, as: "itemType", attributes: ["id", "name"], paranoid: false },
  { model: db.User, as: "author", attributes: ["id", "name", "lastname"] },
  { model: db.User, as: "voider", attributes: ["id", "name", "lastname"] },
];

// El modelo es underscored: Sequelize deja los timestamps en camelCase, así que se normalizan acá.
function serialize(row) {
  const { createdAt, updatedAt, ...data } = row.toJSON();
  return { ...data, hours: parseFloat(data.hours), created_at: createdAt, updated_at: updatedAt };
}

module.exports = {
  // GET /time-entries/manual?project_id= — todas (activas y anuladas) del proyecto, las más nuevas primero.
  list: async (req, res) => {
    try {
      const projectId = parseInt(req.query.project_id, 10);
      if (!Number.isInteger(projectId)) return res.status(400).json({ error: "Falta el proyecto." });

      const project = await db.Project.findByPk(projectId, { attributes: ["id"] });
      if (!project) return res.status(404).json({ error: "Proyecto no encontrado." });

      const rows = await db.ProjectManualHour.findAll({
        where: { project_id: projectId },
        include: entryInclude,
        order: [["created_at", "DESC"], ["id", "DESC"]],
      });
      return res.status(200).json({ data: rows.map(serialize) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /time-entries/manual — { project_id, budget_item_type_id, hours, date, description }
  create: async (req, res) => {
    try {
      const { project_id, budget_item_type_id, hours, date, description } = req.body;

      const projectId = parseInt(project_id, 10);
      if (!Number.isInteger(projectId)) return res.status(400).json({ error: "Falta el proyecto." });
      const project = await db.Project.findByPk(projectId, { attributes: ["id", "status"] });
      if (!project) return res.status(404).json({ error: "Proyecto no encontrado." });
      // Misma regla que timeEntryController.create.
      if (project.status === "completed" || project.status === "cancelled") {
        return res.status(400).json({
          error: `No se pueden registrar horas en un proyecto finalizado o cancelado (${project.status === "completed" ? "Completado" : "Cancelado"}).`,
        });
      }

      const hoursNumber = Number(hours);
      if (!Number.isFinite(hoursNumber) || hoursNumber <= 0 || hoursNumber > MAX_HOURS) {
        return res.status(400).json({ error: `Las horas deben ser un número mayor a 0 y hasta ${MAX_HOURS}.` });
      }

      const today = todayInArgentina();
      const finalDate = date || today;
      if (!isValidIsoDate(finalDate)) return res.status(400).json({ error: "La fecha no es válida." });
      if (finalDate > today) return res.status(400).json({ error: "La fecha no puede ser futura." });

      const text = typeof description === "string" ? description.trim() : "";
      if (!text) return res.status(400).json({ error: "El detalle es obligatorio." });

      // Sin rubro = "Generales". Con rubro, tiene que ser una bolsa del proyecto. Pasarse de lo que
      // queda en la bolsa NO bloquea: el formulario avisa, pero deja guardar.
      let typeId = null;
      if (budget_item_type_id !== null && budget_item_type_id !== undefined && budget_item_type_id !== "") {
        typeId = parseInt(budget_item_type_id, 10);
        if (!Number.isInteger(typeId)) return res.status(400).json({ error: "El rubro no es válido." });
        const bucket = await db.ProjectHourBudget.findOne({
          where: { project_id: projectId, budget_item_type_id: typeId },
          attributes: ["id"],
        });
        if (!bucket) return res.status(400).json({ error: "El proyecto no tiene una bolsa de horas para ese rubro." });
      }

      const created = await db.ProjectManualHour.create({
        project_id: projectId,
        budget_item_type_id: typeId,
        hours: round2(hoursNumber),
        date: finalDate,
        description: text,
        created_by: req.user.id,
      });
      const row = await db.ProjectManualHour.findByPk(created.id, { include: entryInclude });
      return res.status(201).json({ data: serialize(row) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // PUT /time-entries/manual/:id/void — { void_reason }. Deja de contar en la bolsa; queda visible.
  void: async (req, res) => {
    try {
      const row = await db.ProjectManualHour.findByPk(req.params.id);
      if (!row) return res.status(404).json({ error: "Registro no encontrado." });
      if (row.status === "voided") return res.status(400).json({ error: "El registro ya está anulado." });

      const reason = typeof req.body.void_reason === "string" ? req.body.void_reason.trim() : "";
      if (!reason) return res.status(400).json({ error: "El motivo de la anulación es obligatorio." });

      await row.update({ status: "voided", voided_by: req.user.id, voided_at: new Date(), void_reason: reason });
      const updated = await db.ProjectManualHour.findByPk(row.id, { include: entryInclude });
      return res.status(200).json({ data: serialize(updated) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
