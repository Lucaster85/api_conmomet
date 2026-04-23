const { Op } = require("sequelize");
const db = require("../models");

/**
 * Calcula horas regulares a partir de check_in y check_out.
 * @param {string} checkIn - "HH:MM"
 * @param {string} checkOut - "HH:MM"
 * @returns {number}
 */
function calculateRegularHours(checkIn, checkOut) {
  const [inH, inM] = checkIn.split(":").map(Number);
  const [outH, outM] = checkOut.split(":").map(Number);
  const inMinutes = inH * 60 + inM;
  const outMinutes = outH * 60 + outM;
  return Math.round(((outMinutes - inMinutes) / 60) * 100) / 100;
}

/**
 * Verifica si dos rangos de tiempo se superponen.
 */
function timesOverlap(aIn, aOut, bIn, bOut) {
  return aIn < bOut && aOut > bIn;
}

module.exports = {
  getAll: async (req, res) => {
    try {
      const { employee_id, project_id, plant_id, date_from, date_to, status } = req.query;
      const where = {};

      if (employee_id) where.employee_id = employee_id;
      if (project_id) where.project_id = project_id;
      if (plant_id) where.plant_id = plant_id;
      if (status) where.status = status;
      if (date_from || date_to) {
        where.date = {};
        if (date_from) where.date[Op.gte] = date_from;
        if (date_to) where.date[Op.lte] = date_to;
      }

      const { count, rows } = await db.TimeEntry.findAndCountAll({
        where,
        include: [
          { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname", "hourly_rate"] },
          { model: db.Plant, as: "plant", attributes: ["id", "name"] },
          { model: db.User, as: "registeredBy", attributes: ["id", "name", "lastname"] },
          { model: db.User, as: "approvedBy", attributes: ["id", "name", "lastname"] },
        ],
        order: [["date", "DESC"], ["check_in", "ASC"]],
      });
      return res.status(200).json({ count, data: rows });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * Carga batch: acepta employee_ids (array) y crea un registro por cada uno.
   */
  create: async (req, res) => {
    const { employee_ids, project_id, plant_id, date, check_in, check_out, overtime_50_hours, overtime_100_hours, is_late, notes } = req.body;

    if (!employee_ids || !Array.isArray(employee_ids) || employee_ids.length === 0) {
      return res.status(400).json({ error: "Debe seleccionar al menos un empleado." });
    }
    if (!date || !check_in || !check_out) {
      return res.status(400).json({ error: "Fecha, hora de ingreso y hora de egreso son obligatorios." });
    }

    const regular_hours = calculateRegularHours(check_in, check_out);
    if (regular_hours <= 0) {
      return res.status(400).json({ error: "La hora de egreso debe ser mayor a la de ingreso." });
    }

    try {
      const created = [];
      const errors = [];

      for (const empId of employee_ids) {
        // Validate employee exists
        const employee = await db.Employee.findByPk(empId);
        if (!employee) {
          errors.push({ employee_id: empId, error: "Empleado no encontrado." });
          continue;
        }

        // Check for overlapping blocks on the same day
        const existing = await db.TimeEntry.findAll({
          where: {
            employee_id: empId,
            date,
            status: { [Op.ne]: "voided" },
          },
        });

        const hasOverlap = existing.some(entry =>
          timesOverlap(check_in, check_out, entry.check_in, entry.check_out)
        );

        if (hasOverlap) {
          errors.push({ employee_id: empId, employee_name: `${employee.name} ${employee.lastname}`, error: "Ya existe un bloque de horas que se superpone en esa fecha." });
          continue;
        }

        // Auto-approval: if registered_by (current user) is not the employee's own user
        const isSupervisor = req.user.id !== employee.user_id;
        const entryStatus = isSupervisor ? "approved" : "pending";

        const entry = await db.TimeEntry.create({
          employee_id: empId,
          project_id: project_id || null,
          plant_id: plant_id || null,
          date,
          check_in,
          check_out,
          regular_hours,
          overtime_50_hours: overtime_50_hours || 0,
          overtime_100_hours: overtime_100_hours || 0,
          is_late: is_late || false,
          notes,
          registered_by: req.user.id,
          approved_by: isSupervisor ? req.user.id : null,
          approved_at: isSupervisor ? new Date() : null,
          status: entryStatus,
        });

        created.push(entry);
      }

      return res.status(201).json({ data: created, errors });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    try {
      const entry = await db.TimeEntry.findByPk(req.params.id);
      if (!entry) return res.status(404).json({ error: "Registro no encontrado." });
      if (entry.status === "voided") return res.status(400).json({ error: "No se puede editar un registro anulado." });

      const { project_id, plant_id, date, check_in, check_out, overtime_50_hours, overtime_100_hours, is_late, notes } = req.body;

      let regular_hours = entry.regular_hours;
      const newCheckIn = check_in || entry.check_in;
      const newCheckOut = check_out || entry.check_out;

      if (check_in || check_out) {
        regular_hours = calculateRegularHours(newCheckIn, newCheckOut);
        if (regular_hours <= 0) {
          return res.status(400).json({ error: "La hora de egreso debe ser mayor a la de ingreso." });
        }
      }

      // Check overlap if date or times changed
      if (date || check_in || check_out) {
        const existing = await db.TimeEntry.findAll({
          where: {
            employee_id: entry.employee_id,
            date: date || entry.date,
            status: { [Op.ne]: "voided" },
            id: { [Op.ne]: entry.id },
          },
        });

        const hasOverlap = existing.some(e =>
          timesOverlap(newCheckIn, newCheckOut, e.check_in, e.check_out)
        );

        if (hasOverlap) {
          return res.status(400).json({ error: "El horario se superpone con otro bloque existente." });
        }
      }

      await entry.update({
        project_id: project_id !== undefined ? project_id : entry.project_id,
        plant_id: plant_id !== undefined ? plant_id : entry.plant_id,
        date: date || entry.date,
        check_in: newCheckIn,
        check_out: newCheckOut,
        regular_hours,
        overtime_50_hours: overtime_50_hours !== undefined ? overtime_50_hours : entry.overtime_50_hours,
        overtime_100_hours: overtime_100_hours !== undefined ? overtime_100_hours : entry.overtime_100_hours,
        is_late: is_late !== undefined ? is_late : entry.is_late,
        notes: notes !== undefined ? notes : entry.notes,
      });

      return res.status(200).json({ data: entry });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * Anular un registro de horas (no se borran, solo se anulan).
   */
  void: async (req, res) => {
    try {
      const entry = await db.TimeEntry.findByPk(req.params.id);
      if (!entry) return res.status(404).json({ error: "Registro no encontrado." });
      if (entry.status === "voided") return res.status(400).json({ error: "El registro ya está anulado." });

      const { reason } = req.body;
      if (!reason) return res.status(400).json({ error: "Debe indicar el motivo de anulación." });

      await entry.update({
        status: "voided",
        voided_by: req.user.id,
        voided_at: new Date(),
        void_reason: reason,
      });

      return res.status(200).json({ data: entry });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  approve: async (req, res) => {
    try {
      const entry = await db.TimeEntry.findByPk(req.params.id);
      if (!entry) return res.status(404).json({ error: "Registro no encontrado." });
      if (entry.status !== "pending") return res.status(400).json({ error: "Solo se pueden aprobar registros pendientes." });

      await entry.update({
        status: "approved",
        approved_by: req.user.id,
        approved_at: new Date(),
      });

      return res.status(200).json({ data: entry });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
