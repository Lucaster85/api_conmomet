"use strict";
// Etapa 3 de egresos (PLAN_EGRESOS.md §6, §11): la liquidación final vive en un PayPeriod `final`
// (uno por mes), se genera/regenera desde el egreso, se corrige con motivo, descuenta adelantos y
// préstamos (neto nunca menor a 0 + deuda pendiente) y al pagarse corta el portal y cierra el egreso.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

let seq = 0;
async function createEmployee(extra = {}) {
  seq += 1;
  const n = Math.floor(Math.random() * 900000) + seq;
  return db.Employee.create({
    name: "Juan", lastname: "Pérez", dni: String(30000000 + n), cuil: String(20300000000 + n),
    hire_date: "2020-03-01", hourly_rate: 0, pay_type: "monthly", monthly_salary: 900000, ...extra,
  });
}

async function paidMonth(employee, year, month, gross) {
  const lastDay = new Date(year, month, 0).getDate();
  const period = await db.PayPeriod.create({
    start_date: `${year}-${String(month).padStart(2, "0")}-16`,
    end_date: `${year}-${String(month).padStart(2, "0")}-${lastDay}`,
    type: "second_half", month, year,
  });
  return db.PayrollEntry.create({
    employee_id: employee.id, pay_period_id: period.id, status: "paid", regular_amount: gross, gross_amount: gross, net_amount: gross,
  });
}

const admin = () => createActor({ role: "admin" });

/** Empleado con sueldo, liquidaciones de jul–sep y un egreso confirmado el 20/10/2026. */
async function confirmedTermination({ employeeExtra = {}, terminationExtra = {}, months = [7, 8, 9] } = {}) {
  const employee = await createEmployee(employeeExtra);
  for (const m of months) await paidMonth(employee, 2026, m, 900000);
  const draft = await db.EmployeeTermination.create({
    employee_id: employee.id, type: "resignation", termination_date: "2026-10-20", notice_given: "none", status: "draft", ...terminationExtra,
  });
  const actor = await admin();
  const res = await as(actor).put(`/employee-terminations/${draft.id}/confirm`);
  expect(res.status).toBe(200);
  return { employee, termination: await db.EmployeeTermination.findByPk(draft.id), actor };
}

const generate = (termination, actor) => as(actor).post(`/employee-terminations/${termination.id}/final-payroll`);
const lineOf = (detail, key) => detail.final_payroll.lines.find((l) => l.item_key === key);

describe("período final", () => {
  it("al confirmar el egreso crea el período final del mes, uno solo por mes", async () => {
    await confirmedTermination();
    await confirmedTermination({ months: [] });

    const periods = await db.PayPeriod.findAll({ where: { type: "final" } });
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ year: 2026, month: 10, start_date: "2026-10-01", end_date: "2026-10-31" });
  });

  it("no se genera, cierra ni paga como una quincena", async () => {
    await confirmedTermination();
    const period = await db.PayPeriod.findOne({ where: { type: "final" } });
    const actor = await admin();

    expect((await as(actor).post(`/payroll/${period.id}/generate`)).status).toBe(400);
    expect((await as(actor).put(`/pay-periods/${period.id}/close`)).status).toBe(400);
    expect((await as(actor).put(`/pay-periods/${period.id}/pay`)).status).toBe(400);
  });

  it("no bloquea la carga de horas de nadie en ese mes", async () => {
    await confirmedTermination();
    const other = await createEmployee();
    const actor = await admin();

    const res = await as(actor).post("/time-entries").send({ employee_ids: [other.id], date: "2026-10-05", check_in: "07:00", check_out: "15:00" });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);
  });
});

describe("POST /employee-terminations/:id/final-payroll", () => {
  it("genera la liquidación en borrador con haberes, SAC y vacaciones", async () => {
    const { termination, actor } = await confirmedTermination();

    const res = await generate(termination, actor);

    expect(res.status).toBe(201);
    const fp = res.body.data.final_payroll;
    expect(fp.status).toBe("draft");
    expect(lineOf(res.body.data, "wages")).toMatchObject({ line_type: "final_days", amount: 600000, group: "remunerative" });
    expect(lineOf(res.body.data, "sac_proportional").amount).toBe(273913.04);
    expect(lineOf(res.body.data, "vacation_unused")).toBeDefined();
    expect(lineOf(res.body.data, "notice_pay")).toBeUndefined();
    expect(fp.gross_amount).toBe(fp.remunerative_total);
    expect(fp.net_amount).toBe(fp.gross_amount);

    const entry = await db.PayrollEntry.findByPk(fp.id, { include: [{ model: db.PayPeriod, as: "payPeriod" }] });
    expect(entry.payPeriod.type).toBe("final");
    expect((await db.EmployeeTermination.findByPk(termination.id)).final_payroll_entry_id).toBe(entry.id);
  });

  it("el despido sin causa suma preaviso, integración y art. 245 en lo indemnizatorio", async () => {
    const { termination, actor } = await confirmedTermination({ terminationExtra: { type: "dismissal_without_cause" } });

    const res = await generate(termination, actor);

    expect(lineOf(res.body.data, "notice_pay")).toMatchObject({ line_type: "notice_pay", group: "indemnity", amount: 1800000 });
    expect(lineOf(res.body.data, "severance")).toMatchObject({ group: "indemnity", amount: 6300000 });
    expect(res.body.data.final_payroll.indemnity_total).toBeGreaterThan(8000000);
  });

  it("el mutuo acuerdo no liquida las referencias y trae la gratificación pactada en cero, editable", async () => {
    const { termination, actor } = await confirmedTermination({ terminationExtra: { type: "mutual_agreement" } });

    const res = await generate(termination, actor);

    expect(lineOf(res.body.data, "severance")).toBeUndefined();
    expect(lineOf(res.body.data, "notice_pay")).toBeUndefined();
    expect(lineOf(res.body.data, "severance_agreed")).toMatchObject({ amount: 0, group: "indemnity" });
  });

  it("la renuncia con preaviso omitido trae el descuento sugerido, apagado", async () => {
    const { termination, actor } = await confirmedTermination({ terminationExtra: { employee_notice_omitted: true } });

    const res = await generate(termination, actor);

    const line = lineOf(res.body.data, "employee_notice_deduction");
    expect(line.amount).toBe(0);
    expect(line.suggested_amount).toBe(-450000); // 15 días de $900.000 / 30
  });

  it("exige el egreso confirmado", async () => {
    const employee = await createEmployee();
    const draft = await db.EmployeeTermination.create({ employee_id: employee.id, type: "resignation", termination_date: "2026-10-20", status: "draft" });

    const res = await generate(draft, await admin());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirmado/);
  });

  it("regenerar deja una sola entry y respeta lo corregido con motivo", async () => {
    const { termination, actor } = await confirmedTermination();
    const first = await generate(termination, actor);
    const wages = lineOf(first.body.data, "wages");
    await as(actor).put(`/employee-terminations/${termination.id}/final-payroll/lines/${wages.id}`).send({ amount: 650000, reason: "Trabajó 2 días más" });

    const second = await generate(termination, actor);

    expect(await db.PayrollEntry.count({ where: { id: second.body.data.final_payroll.id } })).toBe(1);
    expect(second.body.data.final_payroll.id).toBe(first.body.data.final_payroll.id);
    expect(lineOf(second.body.data, "wages")).toMatchObject({ amount: 650000, suggested_amount: 600000, edit_reason: "Trabajó 2 días más" });
  });

  it("exige payroll_write y ver sueldos", async () => {
    const { termination } = await confirmedTermination();
    const sinPayroll = await createActor({ permissions: ["employee_salaries_read"] });
    const sinSueldos = await createActor({ permissions: ["payroll_write"] });
    const ok = await createActor({ permissions: ["payroll_write", "employee_salaries_read"] });

    expect((await generate(termination, sinPayroll)).status).toBe(401);
    expect((await generate(termination, sinSueldos)).status).toBe(401);
    expect((await generate(termination, ok)).status).toBe(201);
  });
});

describe("PUT /employee-terminations/:id/final-payroll/lines/:lineId", () => {
  it("corrige el monto con motivo, recalcula la entry y conserva lo sugerido", async () => {
    const { termination, actor } = await confirmedTermination();
    const gen = await generate(termination, actor);
    const vac = lineOf(gen.body.data, "vacation_unused");

    const res = await as(actor).put(`/employee-terminations/${termination.id}/final-payroll/lines/${vac.id}`).send({ amount: 100000, reason: "Acuerdo con el empleado" });

    expect(res.status).toBe(200);
    expect(lineOf(res.body.data, "vacation_unused")).toMatchObject({ amount: 100000, suggested_amount: vac.suggested_amount, edit_reason: "Acuerdo con el empleado" });
    const gross = res.body.data.final_payroll.lines.reduce((s, l) => s + l.amount, 0);
    expect(res.body.data.final_payroll.gross_amount).toBeCloseTo(gross, 2);
    const audit = await db.AuditLog.findOne({ where: { entity_type: "PayrollLine", entity_id: vac.id } });
    expect(audit.notes).toBe("Acuerdo con el empleado");
  });

  it("exige motivo y rechaza montos negativos en líneas que suman", async () => {
    const { termination, actor } = await confirmedTermination();
    const gen = await generate(termination, actor);
    const wages = lineOf(gen.body.data, "wages");
    const url = `/employee-terminations/${termination.id}/final-payroll/lines/${wages.id}`;

    expect((await as(actor).put(url).send({ amount: 1000 })).status).toBe(400);
    expect((await as(actor).put(url).send({ amount: -1, reason: "x" })).status).toBe(400);
  });

  it("el descuento por preaviso omitido se enciende con un monto negativo", async () => {
    const { termination, actor } = await confirmedTermination({ terminationExtra: { employee_notice_omitted: true } });
    const gen = await generate(termination, actor);
    const line = lineOf(gen.body.data, "employee_notice_deduction");
    const url = `/employee-terminations/${termination.id}/final-payroll/lines/${line.id}`;

    expect((await as(actor).put(url).send({ amount: 450000, reason: "x" })).status).toBe(400);
    const res = await as(actor).put(url).send({ amount: -450000, reason: "Se ejerce el derecho de la empresa" });

    expect(res.status).toBe(200);
    expect(lineOf(res.body.data, "employee_notice_deduction").amount).toBe(-450000);
    expect(res.body.data.final_payroll.gross_amount).toBe(res.body.data.final_payroll.remunerative_total);
  });

  it("no se corrige una liquidación ya confirmada", async () => {
    const { termination, actor } = await confirmedTermination();
    const gen = await generate(termination, actor);
    const wages = lineOf(gen.body.data, "wages");
    await as(actor).put(`/payroll/${gen.body.data.final_payroll.id}/confirm`);

    const res = await as(actor).put(`/employee-terminations/${termination.id}/final-payroll/lines/${wages.id}`).send({ amount: 1, reason: "x" });

    expect(res.status).toBe(400);
  });
});

describe("descuentos de la liquidación final", () => {
  const advanceFor = (employee, amount, date = "2026-10-05") =>
    db.SalaryAdvance.create({ employee_id: employee.id, amount, date, payment_method: "efectivo", status: "approved", paid_at: new Date() });

  it("descuenta los adelantos pagados y los vincula al período final", async () => {
    const { employee, termination, actor } = await confirmedTermination();
    const advance = await advanceFor(employee, 50000);

    const res = await generate(termination, actor);

    const fp = res.body.data.final_payroll;
    expect(fp.advances_deducted).toBe(50000);
    expect(fp.net_amount).toBe(fp.gross_amount - 50000);
    expect((await advance.reload()).pay_period_id).toBe(fp.pay_period_id);
  });

  it("si los descuentos superan lo adeudado el neto es 0 y el adelanto queda como deuda", async () => {
    const { employee, termination, actor } = await confirmedTermination({ employeeExtra: { monthly_salary: 30000, hire_date: "2026-09-01" }, months: [9] });
    const advance = await advanceFor(employee, 5000000);

    const res = await generate(termination, actor);

    const fp = res.body.data.final_payroll;
    expect(fp.advances_deducted).toBe(0);
    expect(fp.net_amount).toBe(fp.gross_amount);
    expect((await advance.reload()).pay_period_id).toBeNull();
    await as(actor).put(`/payroll/${fp.id}/confirm`);
    const detail = await as(actor).get(`/employee-terminations/${termination.id}`);
    expect(detail.body.data.pending_debt.advances.total).toBe(5000000);
    expect(detail.body.data.pending_debt.total_ars).toBe(5000000);
  });

  it("cobra el préstamo de cuota fija al confirmar: cuotas prepaid, pagos vinculados y préstamo completado", async () => {
    const { employee, termination, actor } = await confirmedTermination();
    const lender = await admin();
    await db.EmployeeTermination.update({ status: "draft" }, { where: { id: termination.id } }); // el alta de préstamos se bloquea con el egreso confirmado
    await db.Employee.update({ status: "active" }, { where: { id: employee.id } });
    const loanRes = await as(lender).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-10-01", num_installments: 4, mark_as_paid: true,
    });
    expect(loanRes.status).toBe(201);
    await db.EmployeeTermination.update({ status: "confirmed" }, { where: { id: termination.id } });
    await db.Employee.update({ status: "inactive" }, { where: { id: employee.id } });
    const gen = await generate(termination, actor);
    const fp = gen.body.data.final_payroll;
    expect(fp.loan_installments_deducted).toBeGreaterThan(0);

    const confirm = await as(actor).put(`/payroll/${fp.id}/confirm`);

    expect(confirm.status).toBe(200);
    const loan = await db.Loan.findByPk(loanRes.body.id);
    expect(loan.status).toBe("completed");
    expect(Number(loan.remaining_balance)).toBe(0);
    const installments = await db.LoanInstallment.findAll({ where: { loan_id: loan.id } });
    expect(installments.every((i) => i.status === "prepaid" && i.payroll_entry_id === fp.id)).toBe(true);
    expect(await db.LoanPayment.count({ where: { loan_id: loan.id, payroll_entry_id: fp.id } })).toBe(4);
  });

  it("si no alcanza para todo el préstamo cobra solo las cuotas que entran y el préstamo sigue activo", async () => {
    const { employee, termination, actor } = await confirmedTermination({ employeeExtra: { monthly_salary: 30000, hire_date: "2026-09-01" }, months: [9] });
    await db.EmployeeTermination.update({ status: "draft" }, { where: { id: termination.id } });
    await db.Employee.update({ status: "active" }, { where: { id: employee.id } });
    const loanRes = await as(await admin()).post("/loans").send({
      employee_id: employee.id, amount: 400000, start_date: "2026-10-01", num_installments: 4, mark_as_paid: true,
    });
    expect(loanRes.status).toBe(201);
    await db.EmployeeTermination.update({ status: "confirmed" }, { where: { id: termination.id } });
    await db.Employee.update({ status: "inactive" }, { where: { id: employee.id } });
    const gen = await generate(termination, actor);
    const fp = gen.body.data.final_payroll;

    await as(actor).put(`/payroll/${fp.id}/confirm`);

    const loan = await db.Loan.findByPk(loanRes.body.id);
    expect(loan.status).toBe("active");
    const installments = await db.LoanInstallment.findAll({ where: { loan_id: loan.id }, order: [["installment_number", "ASC"]] });
    const scheduled = installments.filter((i) => i.status === "scheduled");
    expect(scheduled.length).toBeGreaterThan(0);
    expect(scheduled.length).toBeLessThan(4);
    const entry = await db.PayrollEntry.findByPk(fp.id);
    expect(Number(entry.net_amount)).toBeGreaterThanOrEqual(0);
  });

  it("regenerar un borrador no toca los préstamos", async () => {
    const { employee, termination, actor } = await confirmedTermination();
    await db.EmployeeTermination.update({ status: "draft" }, { where: { id: termination.id } });
    await db.Employee.update({ status: "active" }, { where: { id: employee.id } });
    const loanRes = await as(await admin()).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-10-01", num_installments: 4, mark_as_paid: true,
    });
    await db.EmployeeTermination.update({ status: "confirmed" }, { where: { id: termination.id } });
    await db.Employee.update({ status: "inactive" }, { where: { id: employee.id } });

    await generate(termination, actor);
    await generate(termination, actor);

    const loan = await db.Loan.findByPk(loanRes.body.id);
    expect(loan.status).toBe("active");
    expect(await db.LoanPayment.count({ where: { loan_id: loan.id } })).toBe(0);
  });
});

describe("confirmar y pagar la liquidación final", () => {
  it("no confirma con un pedido de adelanto sin resolver", async () => {
    const { employee, termination, actor } = await confirmedTermination();
    await db.SalaryAdvance.create({ employee_id: employee.id, amount: 1000, date: "2026-10-05", status: "pending" });
    const gen = await generate(termination, actor);

    const res = await as(actor).put(`/payroll/${gen.body.data.final_payroll.id}/confirm`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/adelanto/);
    expect((await db.PayrollEntry.findByPk(gen.body.data.final_payroll.id)).status).toBe("draft");
  });

  it("al pagar sin deuda el egreso pasa a liquidado y se corta el acceso al portal", async () => {
    const { employee, termination } = await confirmedTermination();
    const portalUser = await createActor({ permissions: [] });
    await employee.update({ user_id: portalUser.user.id });
    const actor = await admin();
    const gen = await generate(termination, actor);
    const entryId = gen.body.data.final_payroll.id;

    expect((await as(actor).put(`/payroll/${entryId}/confirm`)).status).toBe(200);
    // Confirmada pero todavía no pagada: el empleado conserva su acceso.
    expect(await db.User.findByPk(portalUser.user.id)).not.toBeNull();
    expect((await db.EmployeeTermination.findByPk(termination.id)).status).toBe("confirmed");

    expect((await as(actor).put(`/payroll/${entryId}/pay`)).status).toBe(200);

    expect((await db.EmployeeTermination.findByPk(termination.id)).status).toBe("settled");
    expect(await db.User.findByPk(portalUser.user.id)).toBeNull();
  });

  it("el empleado ve su liquidación final confirmada en el portal, sin desglose de cálculo", async () => {
    const { employee, termination } = await confirmedTermination();
    const portalUser = await createActor({ permissions: [] });
    await employee.update({ user_id: portalUser.user.id });
    const actor = await admin();
    const gen = await generate(termination, actor);
    await as(actor).put(`/payroll/${gen.body.data.final_payroll.id}/confirm`);

    const res = await as(portalUser).get("/me/payroll");

    expect(res.status).toBe(200);
    const final = res.body.data.find((e) => e.payPeriod.type === "final");
    expect(final).toBeDefined();
    expect(final.status).toBe("confirmed");
    expect(final).not.toHaveProperty("lines"); // el desglose de cálculo no viaja al empleado
  });

  it("con deuda pendiente el egreso no se liquida hasta resolverla", async () => {
    const { employee, termination, actor } = await confirmedTermination({ employeeExtra: { monthly_salary: 30000, hire_date: "2026-09-01" }, months: [9] });
    await db.SalaryAdvance.create({ employee_id: employee.id, amount: 5000000, date: "2026-10-05", payment_method: "efectivo", status: "approved", paid_at: new Date() });
    const gen = await generate(termination, actor);
    const entryId = gen.body.data.final_payroll.id;
    await as(actor).put(`/payroll/${entryId}/confirm`);

    await as(actor).put(`/payroll/${entryId}/pay`);

    expect((await db.EmployeeTermination.findByPk(termination.id)).status).toBe("confirmed");
  });

  it("condonar la deuda exige motivo, deja el adelanto como costo y liquida el egreso", async () => {
    const { employee, termination, actor } = await confirmedTermination({ employeeExtra: { monthly_salary: 30000, hire_date: "2026-09-01" }, months: [9] });
    const advance = await db.SalaryAdvance.create({ employee_id: employee.id, amount: 5000000, date: "2026-10-05", payment_method: "efectivo", status: "approved", paid_at: new Date() });
    const gen = await generate(termination, actor);
    const entryId = gen.body.data.final_payroll.id;
    await as(actor).put(`/payroll/${entryId}/confirm`);
    await as(actor).put(`/payroll/${entryId}/pay`);
    const url = `/employee-terminations/${termination.id}/debt`;

    expect((await as(actor).post(url).send({ resolution: "condoned" })).status).toBe(400);
    const res = await as(actor).post(url).send({ resolution: "condoned", notes: "Se perdona por acuerdo" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("settled");
    expect(res.body.data.debt_resolution.resolution).toBe("condoned");
    expect((await advance.reload()).status).toBe("approved");
    expect((await as(actor).post(url).send({ resolution: "condoned", notes: "otra vez" })).status).toBe(400);
  });

  it("registrar el pago de la deuda anula el adelanto y liquida los préstamos", async () => {
    const { employee, termination, actor } = await confirmedTermination({ employeeExtra: { monthly_salary: 30000, hire_date: "2026-09-01" }, months: [9] });
    const advance = await db.SalaryAdvance.create({ employee_id: employee.id, amount: 5000000, date: "2026-10-05", payment_method: "efectivo", status: "approved", paid_at: new Date() });
    const gen = await generate(termination, actor);
    const entryId = gen.body.data.final_payroll.id;
    await as(actor).put(`/payroll/${entryId}/confirm`);
    await as(actor).put(`/payroll/${entryId}/pay`);
    const url = `/employee-terminations/${termination.id}/debt`;

    expect((await as(actor).post(url).send({ resolution: "paid" })).status).toBe(400); // falta el medio
    const res = await as(actor).post(url).send({ resolution: "paid", payment_method: "transferencia" });

    expect(res.body.error).toBeUndefined();
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("settled");
    expect((await advance.reload()).status).toBe("cancelled");
  });

  it("resolver la deuda exige employee_terminations_confirm", async () => {
    const { termination } = await confirmedTermination();
    const sin = await createActor({ permissions: ["employee_terminations_write", "employee_salaries_read"] });

    const res = await as(sin).post(`/employee-terminations/${termination.id}/debt`).send({ resolution: "condoned", notes: "x" });

    expect(res.status).toBe(401);
  });
});

describe("anular un egreso con liquidación final", () => {
  it("con la liquidación en borrador la borra y libera los adelantos", async () => {
    const { employee, termination, actor } = await confirmedTermination();
    const advance = await db.SalaryAdvance.create({ employee_id: employee.id, amount: 50000, date: "2026-10-05", payment_method: "efectivo", status: "approved", paid_at: new Date() });
    const gen = await generate(termination, actor);
    const entryId = gen.body.data.final_payroll.id;
    expect((await advance.reload()).pay_period_id).not.toBeNull();

    const res = await as(actor).put(`/employee-terminations/${termination.id}/cancel`).send({ reason: "Retractó la renuncia" });

    expect(res.status).toBe(200);
    expect(await db.PayrollEntry.findByPk(entryId)).toBeNull();
    expect(await db.PayrollLine.count({ where: { payroll_entry_id: entryId } })).toBe(0);
    expect((await advance.reload()).pay_period_id).toBeNull();
    expect((await db.EmployeeTermination.findByPk(termination.id)).final_payroll_entry_id).toBeNull();
    expect((await employee.reload()).status).toBe("active");
  });

  it("con la liquidación confirmada no se puede anular", async () => {
    const { termination, actor } = await confirmedTermination();
    const gen = await generate(termination, actor);
    await as(actor).put(`/payroll/${gen.body.data.final_payroll.id}/confirm`);

    const res = await as(actor).put(`/employee-terminations/${termination.id}/cancel`).send({ reason: "x" });

    expect(res.status).toBe(400);
  });
});

describe("pantalla de Liquidaciones y Resumen de costos", () => {
  it("GET /payroll/:finalPeriodId lista las liquidaciones finales con su egreso y totales por grupo", async () => {
    const { employee, termination, actor } = await confirmedTermination({ terminationExtra: { type: "dismissal_without_cause" } });
    await generate(termination, actor);
    const period = await db.PayPeriod.findOne({ where: { type: "final" } });

    const res = await as(actor).get(`/payroll/${period.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const row = res.body.data[0];
    expect(row.employee.id).toBe(employee.id);
    expect(row.termination).toMatchObject({ id: termination.id, type: "dismissal_without_cause", status: "confirmed" });
    expect(row.indemnity_total).toBeGreaterThan(0);
    expect(row.remunerative_total + row.indemnity_total).toBeCloseTo(Number(row.gross_amount), 2);
  });

  it("el Resumen de costos suma la liquidación final confirmada en su mes", async () => {
    const { termination, actor } = await confirmedTermination();
    const gen = await generate(termination, actor);
    await as(actor).put(`/payroll/${gen.body.data.final_payroll.id}/confirm`);

    const res = await as(actor).get("/expense-summary/monthly?year=2026&month=10");

    expect(res.status).toBe(200);
    expect(res.body.expenses.payroll_gross.detail.final).toBeCloseTo(gen.body.data.final_payroll.gross_amount, 2);
  });

  it("un adelanto no se puede asignar a la liquidación final", async () => {
    const { employee } = await confirmedTermination();
    const other = await createEmployee();
    const period = await db.PayPeriod.findOne({ where: { type: "final" } });
    const actor = await admin();

    const res = await as(actor).post("/salary-advances").send({
      employee_id: other.id, amount: 1000, date: "2026-10-05", payment_method: "efectivo", pay_period_id: period.id, confirm_duplicate: true,
    });

    expect(employee).toBeTruthy();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/liquidación final/);
  });
});
