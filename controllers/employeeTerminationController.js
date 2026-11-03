const { Op } = require("sequelize");
const db = require("../models");
const { uploadToR2, deleteFromR2, userHasPermission } = require("../helpers");
const { recordAudit } = require("../services/auditLogService");
const { findCurrentTermination } = require("../services/terminationGuards");
const { calculateTermination } = require("../services/terminationCalculationService");
const {
  FinalPayrollError, INDEMNITY_LINE_TYPES, ensureFinalPeriod, loadFinalEntry, generateFinalPayroll, editFinalLine,
  discardDraftFinalPayroll, computePendingDebt, resolveDebt,
} = require("../services/finalPayrollService");
const {
  normalizeTerminationFields,
  buildWarnings,
  paymentDeadline,
  art80Deadline,
} = require("../helpers/terminationRules");

// Fecha local (no UTC): de noche en Argentina toISOString() ya devuelve el día siguiente.
const todayIso = () => new Date().toLocaleDateString("en-CA");

// cct_cap_amount es un monto: se oculta sin employee_salaries_read, mismo criterio que
// employeeController#stripSalaryFields (ver FLOWS.md §34).
const stripAmounts = (json) => {
  const { cct_cap_amount, ...rest } = json;
  return rest;
};

const serialize = (termination, req) => {
  const json = termination.toJSON ? termination.toJSON() : termination;
  return userHasPermission(req.user, "employee_salaries_read") ? json : stripAmounts(json);
};

const employeeAttributes = ["id", "name", "lastname", "dni", "hire_date", "status", "termination_date", "pay_type"];

const loadTermination = (id) =>
  db.EmployeeTermination.findByPk(id, {
    include: [
      { model: db.Employee, as: "employee", attributes: employeeAttributes },
      { model: db.User, as: "createdBy", attributes: ["id", "name", "lastname"] },
      { model: db.User, as: "confirmedBy", attributes: ["id", "name", "lastname"] },
      { model: db.User, as: "cancelledBy", attributes: ["id", "name", "lastname"] },
    ],
  });

const loadDocuments = (terminationId) =>
  db.EntityDocument.findAll({
    where: { employee_termination_id: terminationId },
    include: [
      { model: db.User, as: "uploader", attributes: ["id", "name", "lastname"] },
      { model: db.DocumentCategory, as: "documentCategory", attributes: ["id", "name"] },
    ],
    order: [["created_at", "DESC"]],
  });

const holidayDates = async () => {
  const holidays = await db.Holiday.findAll({ attributes: ["date"] });
  return new Set(holidays.map((h) => h.date));
};

/**
 * Motivos por los que un borrador todavía no se puede confirmar. Hoy: una liquidación en borrador
 * en una quincena que alcanza o supera la fecha de egreso (se liquidaría dos veces con la final
 * y pagaría días posteriores al egreso). Hay que borrarla antes de confirmar (PLAN_EGRESOS §9).
 */
const getConfirmBlockers = async (termination, transaction) => {
  const blockers = [];

  // Confirmar deja al empleado inactivo y lo saca de las quincenas: con una fecha futura (ej: un
  // preaviso que se trabaja) dejaría de liquidarse hoy. El borrador sirve justamente para eso.
  if (termination.termination_date > todayIso()) {
    blockers.push(
      `La fecha de egreso (${termination.termination_date}) todavía no llegó. Confirmá el egreso a partir de esa fecha: hasta entonces el empleado sigue activo y se liquida con normalidad.`
    );
  }

  const draftEntries = await db.PayrollEntry.findAll({
    where: { employee_id: termination.employee_id, status: "draft" },
    include: [
      {
        model: db.PayPeriod,
        as: "payPeriod",
        required: true,
        attributes: ["id", "type", "year", "month", "start_date", "end_date"],
        where: {
          type: { [Op.notIn]: ["sac", "final"] },
          end_date: { [Op.gte]: termination.termination_date },
        },
      },
    ],
    transaction,
  });
  for (const entry of draftEntries) {
    const p = entry.payPeriod;
    blockers.push(
      `Tiene una liquidación en borrador en la quincena ${p.start_date} – ${p.end_date}. Eliminala antes de confirmar el egreso: los haberes hasta la fecha de egreso se pagan en la liquidación final.`
    );
  }
  return blockers;
};

const buildDetail = async (termination, req) => {
  const [documents, holidays] = await Promise.all([loadDocuments(termination.id), holidayDates()]);
  const plainDocs = documents.map((d) => {
    const json = d.toJSON();
    json.created_at = json.created_at || json.createdAt;
    json.category_name = json.documentCategory?.name || null;
    return json;
  });

  const detail = serialize(termination, req);
  detail.documents = plainDocs;
  detail.payment_deadline = paymentDeadline(termination.termination_date, holidays);
  detail.art80_deadline = art80Deadline(termination.termination_date);
  detail.warnings = buildWarnings({
    termination: termination.toJSON(),
    documents: plainDocs,
    today: todayIso(),
  });
  detail.confirm_blockers = termination.status === "draft" ? await getConfirmBlockers(termination) : [];

  // Liquidación final y deuda pendiente: son montos, así que sin employee_salaries_read solo viaja
  // el estado de la liquidación.
  const canSeeAmounts = userHasPermission(req.user, "employee_salaries_read");
  const entry = await loadFinalEntry(termination);
  detail.final_payroll = entry ? serializeFinalEntry(entry, canSeeAmounts) : null;
  detail.pending_debt = canSeeAmounts && (termination.status === "confirmed" || termination.status === "settled")
    ? await computePendingDebt(termination)
    : null;
  detail.debt_resolution = termination.debt_resolution
    ? {
      resolution: termination.debt_resolution,
      amount: canSeeAmounts ? termination.debt_resolved_amount : null,
      resolved_at: termination.debt_resolved_at,
      payment_method: termination.debt_payment_method,
      notes: termination.debt_resolution_notes,
    }
    : null;
  return detail;
};

const serializeFinalEntry = (entry, canSeeAmounts) => {
  const base = { id: entry.id, status: entry.status, pay_period_id: entry.pay_period_id, paid_at: entry.paid_at, signed_at: entry.signed_at };
  if (!canSeeAmounts) return base;
  const lines = entry.lines.map((l) => ({
    id: l.id,
    item_key: l.item_key,
    label: l.label,
    line_type: l.line_type,
    group: INDEMNITY_LINE_TYPES.includes(l.line_type) ? "indemnity" : "remunerative",
    amount: Number(l.subtotal),
    suggested_amount: l.suggested_amount != null ? Number(l.suggested_amount) : null,
    edit_reason: l.edit_reason,
  }));
  const sum = (group) => Math.round(lines.filter((l) => l.group === group).reduce((s, l) => s + l.amount, 0) * 100) / 100;
  return {
    ...base,
    gross_amount: Number(entry.gross_amount),
    advances_deducted: Number(entry.advances_deducted),
    loan_installments_deducted: Number(entry.loan_installments_deducted),
    net_amount: Number(entry.net_amount),
    remunerative_total: sum("remunerative"),
    indemnity_total: sum("indemnity"),
    lines,
  };
};

const sendError = (res, error) => {
  if (error instanceof FinalPayrollError) return res.status(error.status).json({ error: error.message });
  return res.status(500).json({ error: error.message });
};

module.exports = {
  getAll: async (req, res) => {
    try {
      const { employee_id, status } = req.query;
      const where = {};
      if (employee_id) where.employee_id = employee_id;
      if (status) where.status = status;

      const rows = await db.EmployeeTermination.findAll({
        where,
        include: [{ model: db.Employee, as: "employee", attributes: employeeAttributes }],
        order: [["created_at", "DESC"]],
      });
      return res.status(200).json({ count: rows.length, data: rows.map((r) => serialize(r, req)) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const termination = await loadTermination(req.params.id);
      if (!termination) return res.status(404).json({ error: "Egreso no encontrado." });
      return res.status(200).json({ data: await buildDetail(termination, req) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // GET /employee-terminations/:id/calculation — desglose completo de la liquidación del egreso
  // (solo lectura, no genera nada). Es una propuesta: ver helpers/terminationCalculations.js.
  calculation: async (req, res) => {
    try {
      const termination = await db.EmployeeTermination.findByPk(req.params.id);
      if (!termination) return res.status(404).json({ error: "Egreso no encontrado." });
      return res.status(200).json({ data: await calculateTermination(termination) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    try {
      const { employee_id } = req.body;
      if (!employee_id) return res.status(400).json({ error: "El empleado es obligatorio." });

      const employee = await db.Employee.findByPk(employee_id);
      if (!employee) return res.status(404).json({ error: "Empleado no encontrado." });

      const current = await findCurrentTermination(employee.id);
      if (current) {
        return res.status(400).json({ error: "El empleado ya tiene un egreso en curso. Anulalo antes de cargar uno nuevo." });
      }
      if (employee.status === "inactive") {
        return res.status(400).json({ error: "El empleado ya está dado de baja." });
      }

      const { errors, values } = normalizeTerminationFields(req.body, { hireDate: employee.hire_date });
      if (errors.length > 0) return res.status(400).json({ error: errors[0], errors });

      const termination = await db.EmployeeTermination.create({
        ...values,
        employee_id: employee.id,
        status: "draft",
        created_by: req.user.id,
      });

      await recordAudit({
        entityType: "EmployeeTermination",
        entityId: termination.id,
        action: "create",
        fieldChanged: "status",
        newValue: "draft",
        context: { employee_id: employee.id, type: termination.type, termination_date: termination.termination_date },
        userId: req.user.id,
      });

      return res.status(201).json({ data: await buildDetail(await loadTermination(termination.id), req) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // PUT /employee-terminations/:id — en borrador se edita todo; con el egreso ya vigente solo el
  // certificado del art. 80 y las notas (las fechas y el tipo ya movieron al empleado).
  update: async (req, res) => {
    try {
      const termination = await db.EmployeeTermination.findByPk(req.params.id);
      if (!termination) return res.status(404).json({ error: "Egreso no encontrado." });

      if (termination.status === "cancelled") {
        return res.status(400).json({ error: "El egreso está anulado: no se puede editar." });
      }

      if (termination.status !== "draft") {
        const patch = {};
        if (req.body.art80_delivered_at !== undefined) {
          const { errors, values } = normalizeTerminationFields(
            { ...termination.toJSON(), art80_delivered_at: req.body.art80_delivered_at },
          );
          if (errors.length > 0) return res.status(400).json({ error: errors[0], errors });
          patch.art80_delivered_at = values.art80_delivered_at;
        }
        if (req.body.notes !== undefined) patch.notes = req.body.notes || null;
        await termination.update(patch);
        return res.status(200).json({ data: await buildDetail(await loadTermination(termination.id), req) });
      }

      const employee = await db.Employee.findByPk(termination.employee_id);
      const merged = { ...termination.toJSON(), ...req.body };
      // El tipo y el empleado no cambian: para eso se anula y se carga otro.
      merged.type = termination.type;
      const { errors, values } = normalizeTerminationFields(merged, { hireDate: employee.hire_date });
      if (errors.length > 0) return res.status(400).json({ error: errors[0], errors });

      await termination.update(values);
      return res.status(200).json({ data: await buildDetail(await loadTermination(termination.id), req) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // PUT /employee-terminations/:id/confirm — el empleado pasa a inactivo con su fecha de egreso.
  confirm: async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
      const termination = await db.EmployeeTermination.findByPk(req.params.id, { transaction: t });
      if (!termination) {
        await t.rollback();
        return res.status(404).json({ error: "Egreso no encontrado." });
      }
      if (termination.status !== "draft") {
        await t.rollback();
        return res.status(400).json({ error: `No se puede confirmar un egreso en estado: ${termination.status}.` });
      }

      const blockers = await getConfirmBlockers(termination, t);
      if (blockers.length > 0) {
        await t.rollback();
        return res.status(400).json({ error: blockers[0], errors: blockers });
      }

      const employee = await db.Employee.findByPk(termination.employee_id, { transaction: t });
      const previousStatus = employee.status;
      await employee.update({ status: "inactive", termination_date: termination.termination_date }, { transaction: t });

      // La liquidación final del mes del egreso vive en un período `final` (uno por mes, idempotente).
      const [ty, tm] = termination.termination_date.split("-").map(Number);
      await ensureFinalPeriod(ty, tm, t);
      await termination.update(
        { status: "confirmed", confirmed_at: new Date(), confirmed_by: req.user.id },
        { transaction: t }
      );

      await recordAudit(
        {
          entityType: "EmployeeTermination",
          entityId: termination.id,
          action: "update",
          fieldChanged: "status",
          previousValue: "draft",
          newValue: "confirmed",
          context: {
            employee_id: employee.id,
            previous_employee_status: previousStatus,
            termination_date: termination.termination_date,
          },
          userId: req.user.id,
        },
        t
      );

      await t.commit();
      return res.status(200).json({ data: await buildDetail(await loadTermination(termination.id), req) });
    } catch (error) {
      await t.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  // PUT /employee-terminations/:id/cancel — solo mientras no haya liquidación final confirmada
  // ni pagada. Si ya regía, devuelve al empleado a activo.
  cancel: async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
      const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
      if (!reason) {
        await t.rollback();
        return res.status(400).json({ error: "El motivo de la anulación es obligatorio." });
      }

      const termination = await db.EmployeeTermination.findByPk(req.params.id, { transaction: t });
      if (!termination) {
        await t.rollback();
        return res.status(404).json({ error: "Egreso no encontrado." });
      }
      if (termination.status === "cancelled") {
        await t.rollback();
        return res.status(400).json({ error: "El egreso ya está anulado." });
      }
      if (termination.status === "settled") {
        await t.rollback();
        return res.status(400).json({ error: "No se puede anular un egreso ya liquidado y pagado." });
      }
      if (termination.final_payroll_entry_id) {
        const entry = await db.PayrollEntry.findByPk(termination.final_payroll_entry_id, { transaction: t });
        if (entry && entry.status !== "draft") {
          await t.rollback();
          return res.status(400).json({ error: "No se puede anular un egreso con la liquidación final confirmada o pagada." });
        }
      }

      const previousStatus = termination.status;
      await discardDraftFinalPayroll(termination, t);
      if (previousStatus === "confirmed") {
        const employee = await db.Employee.findByPk(termination.employee_id, { transaction: t });
        await employee.update({ status: "active", termination_date: null }, { transaction: t });
      }
      await termination.update(
        { status: "cancelled", cancelled_at: new Date(), cancelled_by: req.user.id, cancellation_reason: reason },
        { transaction: t }
      );

      await recordAudit(
        {
          entityType: "EmployeeTermination",
          entityId: termination.id,
          action: "update",
          fieldChanged: "status",
          previousValue: previousStatus,
          newValue: "cancelled",
          context: { employee_id: termination.employee_id },
          userId: req.user.id,
          notes: reason,
        },
        t
      );

      await t.commit();
      return res.status(200).json({ data: await buildDetail(await loadTermination(termination.id), req) });
    } catch (error) {
      await t.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  // POST /employee-terminations/:id/final-payroll — genera o regenera (en borrador) la liquidación final.
  generateFinalPayroll: async (req, res) => {
    try {
      const termination = await db.EmployeeTermination.findByPk(req.params.id);
      if (!termination) return res.status(404).json({ error: "Egreso no encontrado." });
      await generateFinalPayroll(termination, { userId: req.user.id });
      return res.status(201).json({ data: await buildDetail(await loadTermination(termination.id), req) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // PUT /employee-terminations/:id/final-payroll/lines/:lineId — corrige un monto, con motivo.
  editFinalLine: async (req, res) => {
    try {
      const termination = await db.EmployeeTermination.findByPk(req.params.id);
      if (!termination) return res.status(404).json({ error: "Egreso no encontrado." });
      await editFinalLine(termination, req.params.lineId, req.body, { userId: req.user.id });
      return res.status(200).json({ data: await buildDetail(await loadTermination(termination.id), req) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // POST /employee-terminations/:id/debt — resuelve la deuda pendiente (devuelta o condonada).
  resolveDebt: async (req, res) => {
    try {
      const termination = await db.EmployeeTermination.findByPk(req.params.id);
      if (!termination) return res.status(404).json({ error: "Egreso no encontrado." });
      await resolveDebt(
        termination,
        { resolution: req.body.resolution, paymentMethod: req.body.payment_method, notes: req.body.notes },
        { userId: req.user.id }
      );
      return res.status(200).json({ data: await buildDetail(await loadTermination(termination.id), req) });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // Los papeles se pueden cargar en cualquier estado (incluso settled o cancelled): los de un
  // juicio llegan meses después.
  uploadDocument: async (req, res) => {
    try {
      const termination = await db.EmployeeTermination.findByPk(req.params.id);
      if (!termination) return res.status(404).json({ error: "Egreso no encontrado." });

      const { title, notes, document_category_id } = req.body;
      const file = req.file;
      if (!file) return res.status(400).json({ error: "No se adjuntó ningún archivo." });
      if (!title || !title.trim()) return res.status(400).json({ error: "El título es obligatorio." });

      let categoryId = null;
      if (document_category_id) {
        const category = await db.DocumentCategory.findByPk(document_category_id);
        if (!category || category.applies_to !== "employee") {
          return res.status(400).json({ error: "La categoría de documento no es válida para empleados." });
        }
        categoryId = category.id;
      }

      const folder = `documents/employee/${termination.employee_id}`;
      const file_url = await uploadToR2(file, folder);
      const file_key = file_url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, "");

      const document = await db.EntityDocument.create({
        title: title.trim(),
        notes: notes || null,
        entity_type: "employee",
        entity_id: termination.employee_id,
        employee_termination_id: termination.id,
        document_category_id: categoryId,
        file_url,
        file_key,
        file_name: file.originalname,
        expiration_date: null,
        alert_status: "pending",
        uploaded_by: req.user.id,
        is_renewable: false,
      });

      return res.status(201).json({ data: document });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroyDocument: async (req, res) => {
    try {
      const document = await db.EntityDocument.findOne({
        where: { id: req.params.docId, employee_termination_id: req.params.id },
      });
      if (!document) return res.status(404).json({ error: "Documento no encontrado." });

      if (document.file_url) await deleteFromR2(document.file_url);
      await document.destroy();
      return res.status(200).json({ message: "Documento eliminado correctamente." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
