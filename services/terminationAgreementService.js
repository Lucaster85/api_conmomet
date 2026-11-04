"use strict";
// Acuerdo de pago de la indemnización de un egreso (PLAN_EGRESOS.md §7): cuotas de monto fijo, sin
// actualización por inflación ni intereses. Con un acuerdo activo, preaviso, integración, art. 245
// y la gratificación pactada salen de la liquidación final (quedan como referencia en el cálculo) y
// se pagan cuota por cuota. El egreso pasa a `settled` cuando la final está pagada y todas las cuotas.
const { Op } = require("sequelize");
const db = require("../models");
const { uploadToR2 } = require("../helpers");
const { round2 } = require("../helpers/payrollCalculations");
const { isIsoDate } = require("../helpers/terminationRules");
const { recordAudit } = require("./auditLogService");
const {
  FinalPayrollError, INDEMNITY_LINE_TYPES, loadFinalEntry, generateFinalPayroll, trySettleTermination,
} = require("./finalPayrollService");

const todayLocal = () => new Date().toLocaleDateString("en-CA");

const INCLUDE_INSTALLMENTS = [{
  model: db.TerminationAgreementInstallment,
  as: "installments",
}];

const findActiveAgreement = (terminationId, transaction) =>
  db.TerminationAgreement.findOne({
    where: { termination_id: terminationId, status: "active" },
    include: INCLUDE_INSTALLMENTS,
    order: [[{ model: db.TerminationAgreementInstallment, as: "installments" }, "installment_number", "ASC"]],
    transaction,
  });

/**
 * Valida el plan de cuotas y lo normaliza: ordenado por vencimiento y numerado. La suma tiene que dar
 * exactamente el total pactado (cuotas fijas, sin actualización ni intereses).
 * @returns {Array<{ installment_number: number, due_date: string, amount: number }>}
 */
function normalizeInstallments(installments, totalAmount) {
  if (!Array.isArray(installments) || installments.length === 0) {
    throw new FinalPayrollError("El acuerdo necesita al menos una cuota.");
  }
  const rows = installments.map((i) => {
    const amount = round2(Number(i.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new FinalPayrollError("Cada cuota tiene que tener un monto mayor a cero.");
    if (!isIsoDate(i.due_date)) throw new FinalPayrollError("Cada cuota necesita una fecha de vencimiento válida.");
    return { due_date: i.due_date, amount };
  });
  rows.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0));
  const sum = round2(rows.reduce((s, r) => s + r.amount, 0));
  if (Math.abs(sum - round2(totalAmount)) > 0.009) {
    throw new FinalPayrollError(`Las cuotas suman ${sum} y el total pactado es ${round2(totalAmount)}: tienen que coincidir.`);
  }
  return rows.map((r, idx) => ({ ...r, installment_number: idx + 1 }));
}

function validateAgreementFields({ total_amount, agreement_date }) {
  const total = Number(total_amount);
  if (!Number.isFinite(total) || total <= 0) throw new FinalPayrollError("El monto pactado tiene que ser mayor a cero.");
  if (!isIsoDate(agreement_date)) throw new FinalPayrollError("La fecha del acuerdo es obligatoria.");
  return round2(total);
}

/** Si la liquidación final ya confirmada/pagada llevó la indemnización, no se puede pactar de nuevo. */
async function assertIndemnityNotPaidInFinal(termination) {
  const entry = await loadFinalEntry(termination);
  if (!entry || entry.status === "draft") return;
  const paidIndemnity = entry.lines.some((l) => INDEMNITY_LINE_TYPES.includes(l.line_type) && Number(l.subtotal) !== 0);
  if (paidIndemnity) {
    throw new FinalPayrollError("La indemnización ya se liquidó contado en la liquidación final confirmada: no se puede pactar en cuotas.");
  }
}

/** Con la final en borrador hay que regenerarla: las líneas indemnizatorias entran o salen según haya acuerdo. */
async function regenerateFinalIfDraft(termination, userId) {
  const entry = termination.final_payroll_entry_id ? await db.PayrollEntry.findByPk(termination.final_payroll_entry_id) : null;
  if (entry && entry.status === "draft") await generateFinalPayroll(termination, { userId });
}

async function createAgreement(termination, data, { userId } = {}) {
  if (!["confirmed", "settled"].includes(termination.status)) {
    throw new FinalPayrollError("El egreso tiene que estar confirmado para pactar un acuerdo de pago.");
  }
  if (await findActiveAgreement(termination.id)) throw new FinalPayrollError("El egreso ya tiene un acuerdo de pago activo.");
  const total = validateAgreementFields(data);
  const rows = normalizeInstallments(data.installments, total);
  await assertIndemnityNotPaidInFinal(termination);

  const t = await db.sequelize.transaction();
  try {
    const agreement = await db.TerminationAgreement.create({
      termination_id: termination.id,
      total_amount: total,
      agreement_date: data.agreement_date,
      homologated: data.homologated === true || data.homologated === "true",
      notes: typeof data.notes === "string" && data.notes.trim() ? data.notes.trim() : null,
      created_by: userId,
    }, { transaction: t });
    await db.TerminationAgreementInstallment.bulkCreate(rows.map((r) => ({ ...r, agreement_id: agreement.id })), { transaction: t });

    // Un reclamo posterior reabre un egreso ya liquidado hasta que se paguen las cuotas.
    if (termination.status === "settled") {
      await termination.update({ status: "confirmed" }, { transaction: t });
      await recordAudit({
        entityType: "EmployeeTermination", entityId: termination.id, action: "update", fieldChanged: "status",
        previousValue: "settled", newValue: "confirmed", context: { employee_id: termination.employee_id, trigger: "agreement_created" }, userId,
      }, t);
    }
    await recordAudit({
      entityType: "TerminationAgreement", entityId: agreement.id, action: "create", fieldChanged: "total_amount",
      newValue: total, amount: total,
      context: { employee_id: termination.employee_id, termination_id: termination.id, installments: rows.length },
      userId,
    }, t);
    await t.commit();
  } catch (error) {
    await t.rollback();
    throw error;
  }

  await regenerateFinalIfDraft(await db.EmployeeTermination.findByPk(termination.id), userId);
  return findActiveAgreement(termination.id);
}

/** Edita el acuerdo (total, fecha, homologación, notas y plan de cuotas) mientras no haya cuotas pagadas. */
async function updateAgreement(termination, data, { userId } = {}) {
  const agreement = await findActiveAgreement(termination.id);
  if (!agreement) throw new FinalPayrollError("El egreso no tiene un acuerdo de pago activo.", 404);
  if (agreement.installments.some((i) => i.paid_at)) {
    throw new FinalPayrollError("Ya hay cuotas pagadas: el acuerdo no se puede modificar.");
  }
  const total = validateAgreementFields(data);
  const rows = normalizeInstallments(data.installments, total);

  const t = await db.sequelize.transaction();
  try {
    const previousTotal = agreement.total_amount;
    await agreement.update({
      total_amount: total,
      agreement_date: data.agreement_date,
      homologated: data.homologated === true || data.homologated === "true",
      notes: typeof data.notes === "string" && data.notes.trim() ? data.notes.trim() : null,
    }, { transaction: t });
    await db.TerminationAgreementInstallment.destroy({ where: { agreement_id: agreement.id }, transaction: t });
    await db.TerminationAgreementInstallment.bulkCreate(rows.map((r) => ({ ...r, agreement_id: agreement.id })), { transaction: t });
    await recordAudit({
      entityType: "TerminationAgreement", entityId: agreement.id, action: "update", fieldChanged: "total_amount",
      previousValue: previousTotal, newValue: total, amount: total,
      context: { employee_id: termination.employee_id, termination_id: termination.id, installments: rows.length }, userId,
    }, t);
    await t.commit();
  } catch (error) {
    await t.rollback();
    throw error;
  }
  return findActiveAgreement(termination.id);
}

/** Anula el acuerdo (sin cuotas pagadas). Si la final sigue en borrador, la indemnización vuelve a ella. */
async function cancelAgreement(termination, { reason }, { userId } = {}) {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (!trimmed) throw new FinalPayrollError("El motivo de la anulación es obligatorio.");
  const agreement = await findActiveAgreement(termination.id);
  if (!agreement) throw new FinalPayrollError("El egreso no tiene un acuerdo de pago activo.", 404);
  if (agreement.installments.some((i) => i.paid_at)) {
    throw new FinalPayrollError("Ya hay cuotas pagadas: el acuerdo no se puede anular.");
  }

  const t = await db.sequelize.transaction();
  try {
    await agreement.update({ status: "cancelled", cancelled_at: new Date(), cancelled_by: userId, cancellation_reason: trimmed }, { transaction: t });
    await recordAudit({
      entityType: "TerminationAgreement", entityId: agreement.id, action: "update", fieldChanged: "status",
      previousValue: "active", newValue: "cancelled", amount: agreement.total_amount,
      context: { employee_id: termination.employee_id, termination_id: termination.id }, userId, notes: trimmed,
    }, t);
    await t.commit();
  } catch (error) {
    await t.rollback();
    throw error;
  }
  await regenerateFinalIfDraft(await db.EmployeeTermination.findByPk(termination.id), userId);
  // Sin acuerdo, un egreso con la final ya pagada puede quedar liquidado.
  await trySettleTermination(termination, { userId });
}

const buildFile = async (file, folder) => {
  const url = await uploadToR2(file, folder);
  return { url, key: url.replace(`${process.env.STORAGE_PUBLIC_URL}/`, ""), name: file.originalname };
};

/** Marca una cuota como pagada (medio de pago obligatorio; comprobante y firma opcionales). */
async function payInstallment(termination, installmentNumber, { payment_method, paid_at, proofFile, signatureFile }, { userId } = {}) {
  const agreement = await findActiveAgreement(termination.id);
  if (!agreement) throw new FinalPayrollError("El egreso no tiene un acuerdo de pago activo.", 404);
  const installment = agreement.installments.find((i) => i.installment_number === Number(installmentNumber));
  if (!installment) throw new FinalPayrollError("Cuota no encontrada.", 404);
  if (installment.paid_at) throw new FinalPayrollError("La cuota ya está pagada.");
  if (!["efectivo", "transferencia"].includes(payment_method)) {
    throw new FinalPayrollError("Indicá cómo se pagó la cuota (efectivo o transferencia).");
  }
  const paidAt = paid_at || todayLocal();
  if (!isIsoDate(paidAt)) throw new FinalPayrollError("La fecha de pago no es válida.");

  const proof = proofFile ? await buildFile(proofFile, "payment-proofs/termination-agreements") : null;
  const signature = signatureFile ? await buildFile(signatureFile, "signatures/termination-agreements") : null;

  const t = await db.sequelize.transaction();
  try {
    await installment.update({
      paid_at: paidAt,
      payment_method,
      paid_by: userId,
      ...(proof ? { payment_proof_url: proof.url, payment_proof_key: proof.key, payment_proof_name: proof.name } : {}),
      ...(signature ? { signature_url: signature.url, signature_key: signature.key, signature_name: signature.name } : {}),
    }, { transaction: t });
    await recordAudit({
      entityType: "TerminationAgreementInstallment", entityId: installment.id, action: "update", fieldChanged: "paid_at",
      newValue: paidAt, amount: installment.amount,
      context: { employee_id: termination.employee_id, termination_id: termination.id, agreement_id: agreement.id, installment_number: installment.installment_number, payment_method },
      userId,
    }, t);
    await trySettleTermination(termination, { userId, transaction: t });
    await t.commit();
  } catch (error) {
    await t.rollback();
    throw error;
  }
  return findActiveAgreement(termination.id);
}

/** Cuotas vencidas sin pagar de acuerdos activos, para el aviso del tablero. */
async function findOverdueInstallments(today = todayLocal()) {
  const rows = await db.TerminationAgreementInstallment.findAll({
    where: { paid_at: null, due_date: { [Op.lt]: today } },
    include: [{
      model: db.TerminationAgreement,
      as: "agreement",
      required: true,
      where: { status: "active" },
      include: [{
        model: db.EmployeeTermination,
        as: "termination",
        required: true,
        include: [{ model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] }],
      }],
    }],
    order: [["due_date", "ASC"], ["id", "ASC"]],
  });
  const counts = new Map();
  for (const r of rows) {
    if (!counts.has(r.agreement_id)) {
      counts.set(r.agreement_id, await db.TerminationAgreementInstallment.count({ where: { agreement_id: r.agreement_id } }));
    }
  }
  const dayMs = 24 * 60 * 60 * 1000;
  return rows.map((r) => ({
    id: r.id,
    agreement_id: r.agreement_id,
    termination_id: r.agreement.termination_id,
    employee: r.agreement.termination.employee,
    installment_number: r.installment_number,
    installments_total: counts.get(r.agreement_id),
    due_date: r.due_date,
    amount: Number(r.amount),
    days_overdue: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.due_date}T00:00:00Z`)) / dayMs),
  }));
}

module.exports = {
  findActiveAgreement,
  normalizeInstallments,
  createAgreement,
  updateAgreement,
  cancelAgreement,
  payInstallment,
  findOverdueInstallments,
};
