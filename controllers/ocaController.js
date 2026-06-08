const { Op } = require("sequelize");
const db = require("../models");
const { uploadToR2 } = require("../helpers");

/**
 * Auto-generates a unique OCA number like OCA-2026-001
 */
async function generateOcaNumber() {
  const year = new Date().getFullYear();
  const prefix = `OCA-${year}-`;

  const lastOca = await db.Oca.findOne({
    where: { number: { [Op.like]: `${prefix}%` } },
    order: [["number", "DESC"]],
    paranoid: false,
  });

  let seq = 1;
  if (lastOca && lastOca.number) {
    const lastSeq = parseInt(lastOca.number.replace(prefix, ""), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(3, "0")}`;
}

module.exports = {
  getAll: async (req, res) => {
    try {
      const { client_id, supervisor_id, project_id, status, type } = req.query;
      const where = {};

      if (client_id) where.client_id = client_id;
      if (supervisor_id) where.supervisor_id = supervisor_id;
      if (project_id) where.project_id = project_id;
      if (status) where.status = status;
      if (type) where.type = type;

      const ocas = await db.Oca.findAll({
        where,
        include: [
          { model: db.Client, as: "client", attributes: ["id", "razonSocial"] },
          { model: db.ClientSupervisor, as: "supervisor", attributes: ["id", "name", "lastname", "email", "phone"] },
          { model: db.Project, as: "project", attributes: ["id", "name", "code", "plant_id"], include: [{ model: db.Plant, as: "plant", attributes: ["id", "name", "address"] }] },
          {
            model: db.OcaLine,
            as: "lines",
            include: [
              { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
              { model: db.Vehicle, as: "vehicle", attributes: ["id", "brand", "model", "plate", "type"] },
              { model: db.Project, as: "project", attributes: ["id", "name", "code"], include: [{ model: db.Plant, as: "plant", attributes: ["id", "name"] }] },
            ],
          },
          {
            model: db.OcaStatusLog,
            as: "logs",
            include: [{ model: db.User, as: "changedByUser", attributes: ["id", "name", "lastname"] }],
          },
        ],
        order: [["created_at", "DESC"]],
      });

      return res.status(200).json({ count: ocas.length, data: ocas });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  getPendingEntries: async (req, res) => {
    try {
      const { client_id, type } = req.query;

      if (!client_id) {
        return res.status(400).json({ error: "El client_id es requerido." });
      }
      if (!type || !["man_hours", "crane_hours"].includes(type)) {
        return res.status(400).json({ error: "El tipo de OCA (type: man_hours|crane_hours) es requerido y debe ser válido." });
      }

      // We want to fetch approved TimeEntries that belong to projects of the client
      // where is_plant_hours = true and oca_id is null
      const isCraneType = type === "crane_hours";

      const conceptInclude = {
        model: db.PayrollConcept,
        as: "concept",
        attributes: ["id", "name", "code", "is_crane_hours"],
      };

      if (isCraneType) {
        conceptInclude.where = { is_crane_hours: true };
        conceptInclude.required = true;
      } else {
        conceptInclude.required = false;
      }

      const entries = await db.TimeEntry.findAll({
        where: {
          is_plant_hours: true,
          generates_oca: true,
          oca_id: null,
          status: "approved",
        },
        include: [
          {
            model: db.Project,
            as: "project",
            where: { client_id },
            attributes: ["id", "name", "code", "plant_id"],
            include: [{ model: db.Plant, as: "plant", attributes: ["id", "name"] }],
          },
          conceptInclude,
          { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
          { model: db.ClientSupervisor, as: "supervisor", attributes: ["id", "name", "lastname"] },
          { model: db.Vehicle, as: "vehicle", attributes: ["id", "brand", "model", "plate", "type"] },
        ],
        order: [["date", "ASC"], ["check_in", "ASC"]],
      });

      return res.status(200).json({ count: entries.length, data: entries });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const { type, client_id, time_entry_ids, notes } = req.body;

    if (!type || !["man_hours", "crane_hours"].includes(type)) {
      return res.status(400).json({ error: "Tipo de OCA inválido." });
    }
    if (!client_id) {
      return res.status(400).json({ error: "client_id es requerido." });
    }
    if (!time_entry_ids || !Array.isArray(time_entry_ids) || time_entry_ids.length === 0) {
      return res.status(400).json({ error: "Debe seleccionar al menos un registro de horas." });
    }

    const transaction = await db.sequelize.transaction();

    try {
      // 1. Fetch and validate TimeEntries
      const entries = await db.TimeEntry.findAll({
        where: {
          id: { [Op.in]: time_entry_ids },
        },
        include: [
          { model: db.Project, as: "project", attributes: ["id", "client_id", "plant_id"] },
          { model: db.PayrollConcept, as: "concept", attributes: ["id", "is_crane_hours"] },
        ],
        transaction,
      });

      if (entries.length !== time_entry_ids.length) {
        await transaction.rollback();
        return res.status(400).json({ error: "Uno o más registros de horas seleccionados no existen." });
      }

      let supervisor_id = null;
      let project_id = null;

      for (const entry of entries) {
        if (!entry.project || entry.project.client_id !== parseInt(client_id)) {
          await transaction.rollback();
          return res.status(400).json({ error: "Uno o más registros de horas no pertenecen al cliente seleccionado." });
        }
        if (entry.status !== "approved") {
          await transaction.rollback();
          return res.status(400).json({ error: "Solo se pueden facturar registros de horas aprobados." });
        }
        if (entry.oca_id) {
          await transaction.rollback();
          return res.status(400).json({ error: "Uno o más registros de horas ya están asignados a otra OCA." });
        }
        if (!entry.is_plant_hours || !entry.generates_oca || !entry.supervisor_id) {
          await transaction.rollback();
          return res.status(400).json({ error: "Los registros seleccionados deben estar marcados como Horas en Planta con generación de OCA habilitada y tener un supervisor asignado." });
        }

        const isCraneConcept = entry.concept && entry.concept.is_crane_hours;
        if (type === "crane_hours" && !isCraneConcept) {
          await transaction.rollback();
          return res.status(400).json({ error: "Para una OCA de grúa, todos los registros deben corresponder a horas de grúa." });
        }

        // Grouping Validations
        if (type === "man_hours") {
          if (supervisor_id === null) {
            supervisor_id = entry.supervisor_id;
          } else if (supervisor_id !== entry.supervisor_id) {
            await transaction.rollback();
            return res.status(400).json({ error: "Todos los registros de horas seleccionados deben pertenecer al mismo Supervisor para agrupar por horas hombre." });
          }
        } else if (type === "crane_hours") {
          if (project_id === null) {
            project_id = entry.project_id;
          } else if (project_id !== entry.project_id) {
            await transaction.rollback();
            return res.status(400).json({ error: "Todos los registros de grúa seleccionados deben pertenecer al mismo Proyecto para agrupar por horas grúa." });
          }
        }
      }

      // If crane_hours, we can set supervisor_id to the supervisor of the first entry (it's optional but nice)
      if (type === "crane_hours") {
        supervisor_id = entries[0].supervisor_id;
      }

      // 2. Generate OCA number
      const number = await generateOcaNumber();

      // 3. Create Oca
      const oca = await db.Oca.create(
        {
          number,
          type,
          date: new Date(),
          client_id,
          supervisor_id,
          project_id,
          status: "pendiente",
          notes,
        },
        { transaction }
      );

      // 4. Create OcaLines (snapshots) and update TimeEntries bypassing PayPeriod guard
      for (const entry of entries) {
        await db.OcaLine.create(
          {
            oca_id: oca.id,
            time_entry_id: entry.id,
            employee_id: entry.employee_id,
            project_id: entry.project_id,
            vehicle_id: entry.vehicle_id,
            date: entry.date,
            check_in: entry.check_in,
            check_out: entry.check_out,
            regular_hours: entry.regular_hours,
            overtime_50_hours: entry.overtime_50_hours,
            overtime_100_hours: entry.overtime_100_hours,
            type,
            notes: entry.notes,
          },
          { transaction }
        );

        // Bypass any timeEntry update logic / hooks using direct query
        await db.TimeEntry.update(
          { oca_id: oca.id },
          { where: { id: entry.id }, transaction }
        );
      }

      // 5. Create Status Log
      await db.OcaStatusLog.create(
        {
          oca_id: oca.id,
          from_status: null,
          to_status: "pendiente",
          changed_by: req.user.id,
          notes: "Creación de OCA",
        },
        { transaction }
      );

      await transaction.commit();
      
      const fullOca = await db.Oca.findByPk(oca.id, {
        include: [
          { model: db.Client, as: "client", attributes: ["id", "razonSocial"] },
          { model: db.ClientSupervisor, as: "supervisor", attributes: ["id", "name", "lastname"] },
          { model: db.Project, as: "project", attributes: ["id", "name", "code"] },
          { model: db.OcaLine, as: "lines" },
        ],
      });

      return res.status(201).json({ data: fullOca });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  present: async (req, res) => {
    const { id } = req.params;
    try {
      const oca = await db.Oca.findByPk(id);
      if (!oca) return res.status(404).json({ error: "OCA no encontrada." });
      if (oca.status !== "pendiente") {
        return res.status(400).json({ error: "Solo se pueden presentar OCAs en estado pendiente." });
      }

      await db.sequelize.transaction(async (transaction) => {
        await oca.update({ status: "presentado" }, { transaction });
        await db.OcaStatusLog.create(
          {
            oca_id: oca.id,
            from_status: "pendiente",
            to_status: "presentado",
            changed_by: req.user.id,
            notes: "OCA presentada al supervisor",
          },
          { transaction }
        );
      });

      return res.status(200).json({ message: "OCA presentada correctamente.", status: "presentado" });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  approve: async (req, res) => {
    const { id } = req.params;
    const file = req.file;

    try {
      const oca = await db.Oca.findByPk(id);
      if (!oca) return res.status(404).json({ error: "OCA no encontrada." });
      if (oca.status !== "presentado") {
        return res.status(400).json({ error: "Solo se pueden aprobar OCAs presentadas." });
      }

      let approved_img_url = null;
      if (file) {
        const folder = `ocas/${oca.id}`;
        approved_img_url = await uploadToR2(file, folder);
      }

      await db.sequelize.transaction(async (transaction) => {
        await oca.update(
          {
            status: "aprobado",
            approved_img_url,
            approved_at: new Date(),
            approved_by: req.user.id,
          },
          { transaction }
        );

        await db.OcaStatusLog.create(
          {
            oca_id: oca.id,
            from_status: "presentado",
            to_status: "aprobado",
            changed_by: req.user.id,
            notes: "OCA aprobada con firma digital/física",
          },
          { transaction }
        );
      });

      return res.status(200).json({ message: "OCA aprobada correctamente.", status: "aprobado", approved_img_url });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  reject: async (req, res) => {
    const { id } = req.params;
    const { rejection_reason } = req.body;

    if (!rejection_reason) {
      return res.status(400).json({ error: "El motivo del rechazo es obligatorio." });
    }

    try {
      const oca = await db.Oca.findByPk(id);
      if (!oca) return res.status(404).json({ error: "OCA no encontrada." });
      if (oca.status !== "presentado") {
        return res.status(400).json({ error: "Solo se pueden rechazar OCAs presentadas." });
      }

      await db.sequelize.transaction(async (transaction) => {
        await oca.update(
          {
            status: "rechazado",
            rejected_at: new Date(),
            rejected_by: req.user.id,
            rejection_reason,
          },
          { transaction }
        );

        await db.OcaStatusLog.create(
          {
            oca_id: oca.id,
            from_status: "presentado",
            to_status: "rechazado",
            changed_by: req.user.id,
            notes: `OCA rechazada. Motivo: ${rejection_reason}`,
          },
          { transaction }
        );
      });

      return res.status(200).json({ message: "OCA rechazada correctamente.", status: "rechazado" });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  correct: async (req, res) => {
    const { id } = req.params;
    const transaction = await db.sequelize.transaction();

    try {
      const rejectedOca = await db.Oca.findByPk(id, {
        include: [{ model: db.OcaLine, as: "lines" }],
        transaction,
      });

      if (!rejectedOca) {
        await transaction.rollback();
        return res.status(404).json({ error: "OCA no encontrada." });
      }
      if (rejectedOca.status !== "rechazado") {
        await transaction.rollback();
        return res.status(400).json({ error: "Solo se pueden corregir OCAs que se encuentren en estado rechazado." });
      }

      // 1. Create a new OCA (Corrected duplicate)
      const newNumber = await generateOcaNumber();
      const newOca = await db.Oca.create(
        {
          number: newNumber,
          type: rejectedOca.type,
          date: new Date(),
          client_id: rejectedOca.client_id,
          supervisor_id: rejectedOca.supervisor_id,
          project_id: rejectedOca.project_id,
          status: "pendiente",
          source_oca_id: rejectedOca.id,
          notes: `Corrección de OCA rechazada: ${rejectedOca.number}`,
        },
        { transaction }
      );

      // 2. Duplicate lines desassociated (time_entry_id = null)
      for (const line of rejectedOca.lines) {
        await db.OcaLine.create(
          {
            oca_id: newOca.id,
            time_entry_id: null, // Fully desassociated, allows free editing!
            employee_id: line.employee_id,
            project_id: line.project_id,
            vehicle_id: line.vehicle_id,
            date: line.date,
            check_in: line.check_in,
            check_out: line.check_out,
            regular_hours: line.regular_hours,
            overtime_50_hours: line.overtime_50_hours,
            overtime_100_hours: line.overtime_100_hours,
            type: line.type,
            task: line.task,
            notes: line.notes,
          },
          { transaction }
        );
      }

      // 3. Free up original TimeEntries associated with the rejected OCA
      await db.TimeEntry.update(
        { oca_id: null },
        {
          where: { oca_id: rejectedOca.id },
          transaction,
        }
      );

      // 4. Mark rejected OCA as corrected/anulada by editing notes or keeping it as is
      await rejectedOca.update(
        { notes: `${rejectedOca.notes || ""}\n[Corregida y reemplazada por ${newOca.number}]` },
        { transaction }
      );

      // 5. Create audit logs
      await db.OcaStatusLog.create(
        {
          oca_id: rejectedOca.id,
          from_status: "rechazado",
          to_status: "rechazado",
          changed_by: req.user.id,
          notes: `OCA corregida por nueva OCA: ${newOca.number}`,
        },
        { transaction }
      );

      await db.OcaStatusLog.create(
        {
          oca_id: newOca.id,
          from_status: null,
          to_status: "pendiente",
          changed_by: req.user.id,
          notes: `Creada como duplicado corregido de ${rejectedOca.number}. Horas desvinculadas para edición.`,
        },
        { transaction }
      );

      await transaction.commit();

      const fullOca = await db.Oca.findByPk(newOca.id, {
        include: [
          { model: db.Client, as: "client", attributes: ["id", "razonSocial"] },
          { model: db.ClientSupervisor, as: "supervisor", attributes: ["id", "name", "lastname"] },
          { model: db.OcaLine, as: "lines" },
        ],
      });

      return res.status(201).json({
        message: "OCA duplicada y desvinculada para libre corrección.",
        data: fullOca,
      });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  updateLines: async (req, res) => {
    const { id } = req.params;
    const { lines } = req.body;

    if (!Array.isArray(lines)) {
      return res.status(400).json({ error: "lines debe ser un array." });
    }

    try {
      const oca = await db.Oca.findByPk(id);
      if (!oca) return res.status(404).json({ error: "OCA no encontrada." });
      if (oca.status !== "pendiente") {
        return res.status(400).json({ error: "Solo se pueden editar líneas de una OCA en estado pendiente." });
      }

      await db.sequelize.transaction(async (transaction) => {
        for (const lineUpdate of lines) {
          const { id: lineId, task, regular_hours, overtime_50_hours, overtime_100_hours, check_in, check_out, date } = lineUpdate;
          const ocaLine = await db.OcaLine.findOne({
            where: { id: lineId, oca_id: oca.id },
            transaction,
          });

          if (ocaLine) {
            const updates = {};
            if (task !== undefined) updates.task = task;
            
            // Allow full editing of hours/times ONLY if the line has no time_entry_id (i.e. is corrected/desassociated)
            if (!ocaLine.time_entry_id) {
              if (regular_hours !== undefined) updates.regular_hours = regular_hours;
              if (overtime_50_hours !== undefined) updates.overtime_50_hours = overtime_50_hours;
              if (overtime_100_hours !== undefined) updates.overtime_100_hours = overtime_100_hours;
              if (check_in !== undefined) updates.check_in = check_in;
              if (check_out !== undefined) updates.check_out = check_out;
              if (date !== undefined) updates.date = date;
            }

            await ocaLine.update(updates, { transaction });
          }
        }
      });

      const updatedOca = await db.Oca.findByPk(oca.id, {
        include: [
          {
            model: db.OcaLine,
            as: "lines",
            include: [
              { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
              { model: db.Vehicle, as: "vehicle", attributes: ["id", "brand", "model", "plate"] },
            ],
          },
        ],
      });

      return res.status(200).json({ message: "Líneas actualizadas correctamente.", data: updatedOca });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  addEntries: async (req, res) => {
    const { id } = req.params;
    const { time_entry_ids } = req.body;

    if (!Array.isArray(time_entry_ids) || time_entry_ids.length === 0) {
      return res.status(400).json({ error: "Debe proveer un array time_entry_ids." });
    }

    const transaction = await db.sequelize.transaction();

    try {
      const oca = await db.Oca.findByPk(id, { transaction });
      if (!oca) {
        await transaction.rollback();
        return res.status(404).json({ error: "OCA no encontrada." });
      }
      if (oca.status !== "pendiente") {
        await transaction.rollback();
        return res.status(400).json({ error: "Solo se pueden agregar registros a una OCA en estado pendiente." });
      }
      // Permite agregar registros tanto en OCAs normales como corregidas

      const entries = await db.TimeEntry.findAll({
        where: { id: { [Op.in]: time_entry_ids } },
        include: [
          { model: db.Project, as: "project", attributes: ["id", "client_id"] },
          { model: db.PayrollConcept, as: "concept", attributes: ["id", "is_crane_hours"] },
        ],
        transaction,
      });

      for (const entry of entries) {
        if (entry.project.client_id !== oca.client_id) {
          await transaction.rollback();
          return res.status(400).json({ error: `El registro de horas ${entry.id} no pertenece al cliente de la OCA.` });
        }
        if (entry.oca_id) {
          await transaction.rollback();
          return res.status(400).json({ error: `El registro de horas ${entry.id} ya está asignado a otra OCA.` });
        }
        if (entry.status !== "approved") {
          await transaction.rollback();
          return res.status(400).json({ error: `El registro de horas ${entry.id} no está aprobado.` });
        }

        const isCraneConcept = entry.concept && entry.concept.is_crane_hours;
        if (oca.type === "man_hours") {
          if (entry.supervisor_id !== oca.supervisor_id) {
            await transaction.rollback();
            return res.status(400).json({ error: "El registro no coincide con el supervisor de la OCA." });
          }
        } else if (oca.type === "crane_hours") {
          if (entry.project_id !== oca.project_id) {
            await transaction.rollback();
            return res.status(400).json({ error: "El registro no coincide con el proyecto de la OCA de grúa." });
          }
          if (!isCraneConcept) {
            await transaction.rollback();
            return res.status(400).json({ error: "No se pueden agregar horas hombre a una OCA de grúas." });
          }
        }

        await db.OcaLine.create(
          {
            oca_id: oca.id,
            time_entry_id: entry.id,
            employee_id: entry.employee_id,
            project_id: entry.project_id,
            vehicle_id: entry.vehicle_id,
            date: entry.date,
            check_in: entry.check_in,
            check_out: entry.check_out,
            regular_hours: entry.regular_hours,
            overtime_50_hours: entry.overtime_50_hours,
            overtime_100_hours: entry.overtime_100_hours,
            type: oca.type,
            notes: entry.notes,
          },
          { transaction }
        );

        await db.TimeEntry.update(
          { oca_id: oca.id },
          { where: { id: entry.id }, transaction }
        );
      }

      await transaction.commit();

      const updatedOca = await db.Oca.findByPk(oca.id, {
        include: [{ model: db.OcaLine, as: "lines" }],
      });

      return res.status(200).json({ message: "Registros agregados correctamente.", data: updatedOca });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  removeEntries: async (req, res) => {
    const { id } = req.params;
    const { time_entry_ids } = req.body;

    if (!Array.isArray(time_entry_ids) || time_entry_ids.length === 0) {
      return res.status(400).json({ error: "Debe proveer un array time_entry_ids." });
    }

    const transaction = await db.sequelize.transaction();

    try {
      const oca = await db.Oca.findByPk(id, { transaction });
      if (!oca) {
        await transaction.rollback();
        return res.status(404).json({ error: "OCA no encontrada." });
      }
      if (oca.status !== "pendiente") {
        await transaction.rollback();
        return res.status(400).json({ error: "Solo se pueden quitar registros de una OCA en estado pendiente." });
      }
      // Permite quitar registros tanto en OCAs normales como corregidas

      // Check if they are actually in this OCA
      const count = await db.OcaLine.count({
        where: {
          oca_id: oca.id,
          time_entry_id: { [Op.in]: time_entry_ids },
        },
        transaction,
      });

      if (count !== time_entry_ids.length) {
        await transaction.rollback();
        return res.status(400).json({ error: "Uno o más registros seleccionados no pertenecen a esta OCA." });
      }

      // 1. Delete OcaLines
      await db.OcaLine.destroy({
        where: {
          oca_id: oca.id,
          time_entry_id: { [Op.in]: time_entry_ids },
        },
        transaction,
      });

      // 2. Clear oca_id in TimeEntries
      await db.TimeEntry.update(
        { oca_id: null },
        {
          where: { id: { [Op.in]: time_entry_ids } },
          transaction,
        }
      );

      await transaction.commit();

      const updatedOca = await db.Oca.findByPk(oca.id, {
        include: [{ model: db.OcaLine, as: "lines" }],
      });

      return res.status(200).json({ message: "Registros eliminados correctamente.", data: updatedOca });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  addLine: async (req, res) => {
    const { id } = req.params;
    const {
      employee_id,
      project_id,
      vehicle_id,
      date,
      check_in,
      check_out,
      regular_hours,
      overtime_50_hours,
      overtime_100_hours,
      task,
      notes
    } = req.body;

    const transaction = await db.sequelize.transaction();
    try {
      const oca = await db.Oca.findByPk(id, { transaction });
      if (!oca) {
        await transaction.rollback();
        return res.status(404).json({ error: "OCA no encontrada." });
      }
      if (oca.status !== "pendiente") {
        await transaction.rollback();
        return res.status(400).json({ error: "Solo se pueden agregar líneas a una OCA en estado pendiente." });
      }

      // Validate project_id is provided (required for OcaLine)
      const resolvedProjectId = project_id || oca.project_id;
      if (!resolvedProjectId) {
        await transaction.rollback();
        return res.status(400).json({ error: "Debe seleccionar un proyecto para la línea." });
      }

      // Create new OcaLine
      const newLine = await db.OcaLine.create(
        {
          oca_id: oca.id,
          time_entry_id: null, // manual line
          employee_id: employee_id || null,
          project_id: resolvedProjectId,
          vehicle_id: vehicle_id || null,
          date,
          check_in: check_in || null,
          check_out: check_out || null,
          regular_hours: regular_hours || 0,
          overtime_50_hours: overtime_50_hours || 0,
          overtime_100_hours: overtime_100_hours || 0,
          type: oca.type,
          task: task || null,
          notes: notes || null,
        },
        { transaction }
      );

      await transaction.commit();

      const updatedOca = await db.Oca.findByPk(oca.id, {
        include: [
          {
            model: db.OcaLine,
            as: "lines",
            include: [
              { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
              { model: db.Vehicle, as: "vehicle", attributes: ["id", "brand", "model", "plate"] },
            ],
          }
        ],
      });

      return res.status(201).json({ message: "Línea agregada correctamente.", data: updatedOca });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  removeLine: async (req, res) => {
    const { id, lineId } = req.params;
    const transaction = await db.sequelize.transaction();
    try {
      const oca = await db.Oca.findByPk(id, { transaction });
      if (!oca) {
        await transaction.rollback();
        return res.status(404).json({ error: "OCA no encontrada." });
      }
      if (oca.status !== "pendiente") {
        await transaction.rollback();
        return res.status(400).json({ error: "Solo se pueden quitar líneas de una OCA en estado pendiente." });
      }

      const line = await db.OcaLine.findOne({
        where: { id: lineId, oca_id: oca.id },
        transaction,
      });

      if (!line) {
        await transaction.rollback();
        return res.status(404).json({ error: "Línea de OCA no encontrada." });
      }

      // If it has a time_entry_id, free the TimeEntry
      if (line.time_entry_id) {
        await db.TimeEntry.update(
          { oca_id: null },
          { where: { id: line.time_entry_id }, transaction }
        );
      }

      await line.destroy({ transaction });

      await transaction.commit();

      const updatedOca = await db.Oca.findByPk(oca.id, {
        include: [
          {
            model: db.OcaLine,
            as: "lines",
            include: [
              { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
              { model: db.Vehicle, as: "vehicle", attributes: ["id", "brand", "model", "plate"] },
            ],
          }
        ],
      });

      return res.status(200).json({ message: "Línea eliminada correctamente.", data: updatedOca });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },
};
