"use strict";
// Etapa 2 del SAC (PLAN_SAC.md §9): alta automática del período, liquidación (generate sobre un
// período `sac`), detalle con desglose, Resumen de costos y portal del empleado.
//
// Los casos de liquidación usan el 1er semestre de 2026 (la 2Q de junio ya pasó, así que "Generar"
// está habilitado); el de "antes del día 16" usa un semestre futuro.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

let seq = 0;
async function createEmployee(extra = {}) {
  seq += 1;
  const n = Math.floor(Math.random() * 900000) + seq;
  return db.Employee.create({
    name: "Juan",
    lastname: `Pérez${seq}`,
    dni: String(30000000 + n),
    cuil: String(20300000000 + n),
    hire_date: "2020-01-01",
    hourly_rate: 1000,
    status: "active",
    ...extra,
  });
}

const monthPeriods = {};
async function quincena(year, month, type) {
  const key = `${year}-${month}-${type}`;
  if (monthPeriods[key]) return db.PayPeriod.findByPk(monthPeriods[key]);
  const first = type === "first_half";
  const period = await db.PayPeriod.create({
    start_date: `${year}-${String(month).padStart(2, "0")}-${first ? "01" : "16"}`,
    end_date: `${year}-${String(month).padStart(2, "0")}-${first ? "15" : "28"}`,
    type,
    month,
    year,
  });
  monthPeriods[key] = period.id;
  return period;
}

async function confirmedEntry(employee, year, month, type, gross, status = "confirmed") {
  const period = await quincena(year, month, type);
  return db.PayrollEntry.create({
    employee_id: employee.id,
    pay_period_id: period.id,
    status,
    regular_amount: gross,
    overtime_50_amount: 0,
    overtime_100_amount: 0,
    gross_amount: gross,
    net_amount: gross,
    advances_deducted: 0,
    loan_installments_deducted: 0,
  });
}

const sacPeriod = (year, month) =>
  db.PayPeriod.create({
    start_date: month === 6 ? `${year}-01-01` : `${year}-07-01`,
    end_date: month === 6 ? `${year}-06-30` : `${year}-12-31`,
    type: "sac",
    month,
    year,
  });

beforeEach(() => {
  for (const k of Object.keys(monthPeriods)) delete monthPeriods[k];
});

describe("alta automática del período SAC", () => {
  it("crear la 2Q de diciembre crea también el aguinaldo del 2do semestre", async () => {
    const actor = await createActor({ role: "admin" });
    const res = await as(actor).post("/pay-periods").send({ month: 12, year: 2026, type: "second_half" });
    expect(res.status).toBe(201);
    expect(res.body.sac_period).toMatchObject({ type: "sac", month: 12, year: 2026, start_date: "2026-07-01", end_date: "2026-12-31" });
    expect(await db.PayPeriod.count({ where: { type: "sac" } })).toBe(1);
  });

  it("la 2Q de junio crea el del 1er semestre, y una 1Q o una 2Q de otro mes no crean nada", async () => {
    const actor = await createActor({ role: "admin" });
    await as(actor).post("/pay-periods").send({ month: 6, year: 2027, type: "first_half" });
    await as(actor).post("/pay-periods").send({ month: 5, year: 2027, type: "second_half" });
    expect(await db.PayPeriod.count({ where: { type: "sac" } })).toBe(0);

    await as(actor).post("/pay-periods").send({ month: 6, year: 2027, type: "second_half" });
    const sac = await db.PayPeriod.findOne({ where: { type: "sac" } });
    expect(sac).toMatchObject({ month: 6, year: 2027, start_date: "2027-01-01", end_date: "2027-06-30" });
  });

  it("es idempotente: si el aguinaldo ya existía no se duplica", async () => {
    await sacPeriod(2027, 12);
    const actor = await createActor({ role: "admin" });
    const res = await as(actor).post("/pay-periods").send({ month: 12, year: 2027, type: "second_half" });
    expect(res.status).toBe(201);
    expect(await db.PayPeriod.count({ where: { type: "sac", year: 2027 } })).toBe(1);
  });

  it("POST /pay-periods/sac crea el que falta para una 2Q ya existente y rechaza el duplicado", async () => {
    await quincena(2027, 12, "second_half");
    const actor = await createActor({ role: "admin" });

    const first = await as(actor).post("/pay-periods/sac").send({ year: 2027, semester: 2 });
    expect(first.status).toBe(201);
    const again = await as(actor).post("/pay-periods/sac").send({ year: 2027, semester: 2 });
    expect(again.status).toBe(400);
  });

  it("POST /pay-periods/sac exige que exista la 2Q de ese mes", async () => {
    const actor = await createActor({ role: "admin" });
    const res = await as(actor).post("/pay-periods/sac").send({ year: 2027, semester: 1 });
    expect(res.status).toBe(400);
    expect(await db.PayPeriod.count({ where: { type: "sac" } })).toBe(0);
  });

  it("401 sin el permiso", async () => {
    const actor = await createActor();
    const res = await as(actor).post("/pay-periods/sac").send({ year: 2027, semester: 1 });
    expect(res.status).toBe(401);
  });
});

describe("POST /payroll/:id/generate sobre un período sac", () => {
  it("rechaza generar antes del día 16 de la 2Q de cierre", async () => {
    const period = await sacPeriod(2099, 12);
    const actor = await createActor({ role: "admin" });
    const res = await as(actor).post(`/payroll/${period.id}/generate`).send({});
    expect(res.status).toBe(400);
    expect(await db.PayrollEntry.count({ where: { pay_period_id: period.id } })).toBe(0);
  });

  it("liquida la mitad del mejor mes del semestre, en una línea sac", async () => {
    const emp = await createEmployee({ pay_type: "monthly", monthly_salary: 900000 });
    await confirmedEntry(emp, 2026, 3, "second_half", 800000);
    await confirmedEntry(emp, 2026, 6, "second_half", 900000, "paid");
    const period = await sacPeriod(2026, 6);
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).post(`/payroll/${period.id}/generate`).send({});
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(1);

    const entry = await db.PayrollEntry.findOne({ where: { pay_period_id: period.id, employee_id: emp.id } });
    expect(Number(entry.gross_amount)).toBe(450000);
    expect(Number(entry.net_amount)).toBe(450000);
    expect(entry.status).toBe("draft");

    const lines = await db.PayrollLine.findAll({ where: { payroll_entry_id: entry.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ line_type: "sac", label: "SAC 1er semestre 2026" });
    expect(Number(lines[0].subtotal)).toBe(450000);
  });

  it("jornalizado: el mejor mes suma las dos quincenas", async () => {
    const emp = await createEmployee();
    await confirmedEntry(emp, 2026, 5, "first_half", 400000);
    await confirmedEntry(emp, 2026, 5, "second_half", 450000);
    await confirmedEntry(emp, 2026, 6, "first_half", 300000);
    const period = await sacPeriod(2026, 6);
    const actor = await createActor({ role: "admin" });

    await as(actor).post(`/payroll/${period.id}/generate`).send({});
    const entry = await db.PayrollEntry.findOne({ where: { pay_period_id: period.id, employee_id: emp.id } });
    expect(Number(entry.gross_amount)).toBe(425000); // (400000 + 450000) / 2
  });

  it("ingreso a mitad de semestre es proporcional a los días", async () => {
    const emp = await createEmployee({ hire_date: "2026-04-01" });
    await confirmedEntry(emp, 2026, 6, "second_half", 1810000);
    const period = await sacPeriod(2026, 6);
    const actor = await createActor({ role: "admin" });

    await as(actor).post(`/payroll/${period.id}/generate`).send({});
    const entry = await db.PayrollEntry.findOne({ where: { pay_period_id: period.id, employee_id: emp.id } });
    expect(Number(entry.gross_amount)).toBe(455000); // 1810000 / 2 × 91 / 181
  });

  it("un premio no remunerativo queda fuera de la base", async () => {
    const emp = await createEmployee();
    const entry = await confirmedEntry(emp, 2026, 6, "second_half", 1000000);
    await db.PayrollAdjustment.create({ payroll_entry_id: entry.id, label: "Viáticos", amount: 100000, type: "bonus", is_remunerative: false });
    await db.PayrollAdjustment.create({ payroll_entry_id: entry.id, label: "Premio", amount: 50000, type: "bonus" });
    const period = await sacPeriod(2026, 6);
    const actor = await createActor({ role: "admin" });

    await as(actor).post(`/payroll/${period.id}/generate`).send({});
    const sac = await db.PayrollEntry.findOne({ where: { pay_period_id: period.id, employee_id: emp.id } });
    expect(Number(sac.gross_amount)).toBe(450000); // (1000000 - 100000) / 2
  });

  it("no liquida a quien no tuvo liquidaciones en el semestre ni a los inactivos", async () => {
    const sinLiquidaciones = await createEmployee();
    const inactivo = await createEmployee({ status: "inactive" });
    await confirmedEntry(inactivo, 2026, 6, "second_half", 900000);
    const period = await sacPeriod(2026, 6);
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).post(`/payroll/${period.id}/generate`).send({});
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(0);
    expect(await db.PayrollEntry.count({ where: { pay_period_id: period.id, employee_id: [sinLiquidaciones.id, inactivo.id] } })).toBe(0);
  });

  it("ignora las liquidaciones en borrador: solo cuentan las confirmadas o pagadas", async () => {
    const emp = await createEmployee();
    await confirmedEntry(emp, 2026, 6, "second_half", 900000, "draft");
    const period = await sacPeriod(2026, 6);
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).post(`/payroll/${period.id}/generate`).send({});
    expect(res.body.count).toBe(0);
  });

  it("nunca toca adelantos ni préstamos", async () => {
    const emp = await createEmployee();
    await confirmedEntry(emp, 2026, 6, "second_half", 900000);
    const advance = await db.SalaryAdvance.create({
      employee_id: emp.id, amount: 100000, date: "2026-06-20", status: "approved", payment_method: "efectivo", paid_at: new Date(),
    });
    const loan = await db.Loan.create({
      employee_id: emp.id, amount: 200000, remaining_balance: 200000, currency: "ARS", status: "active", start_date: "2026-05-01",
    });
    const period = await sacPeriod(2026, 6);
    const actor = await createActor({ role: "admin" });

    await as(actor).post(`/payroll/${period.id}/generate`).send({});

    const entry = await db.PayrollEntry.findOne({ where: { pay_period_id: period.id, employee_id: emp.id } });
    expect(Number(entry.advances_deducted)).toBe(0);
    expect(Number(entry.loan_installments_deducted)).toBe(0);
    expect(Number(entry.net_amount)).toBe(450000);
    await advance.reload();
    expect(advance.pay_period_id).toBeNull();
    await loan.reload();
    expect(Number(loan.remaining_balance)).toBe(200000);
  });

  it("regenerar en borrador conserva los ajustes y no duplica la línea; una entry confirmada no se toca", async () => {
    const emp = await createEmployee();
    await confirmedEntry(emp, 2026, 6, "second_half", 900000);
    const period = await sacPeriod(2026, 6);
    const actor = await createActor({ role: "admin" });

    await as(actor).post(`/payroll/${period.id}/generate`).send({});
    const entry = await db.PayrollEntry.findOne({ where: { pay_period_id: period.id, employee_id: emp.id } });
    await as(actor).post("/payroll-adjustments").send({ payroll_entry_id: entry.id, label: "Premio SAC", amount: 10000, type: "bonus" });

    await as(actor).post(`/payroll/${period.id}/generate`).send({});
    await entry.reload();
    expect(Number(entry.gross_amount)).toBe(460000);
    expect(await db.PayrollLine.count({ where: { payroll_entry_id: entry.id } })).toBe(1);
    expect(await db.PayrollAdjustment.count({ where: { payroll_entry_id: entry.id } })).toBe(1);

    await entry.update({ status: "confirmed" });
    await db.PayrollEntry.update({ gross_amount: 1 }, { where: { id: entry.id } });
    await as(actor).post(`/payroll/${period.id}/generate`).send({});
    await entry.reload();
    expect(Number(entry.gross_amount)).toBe(1);
  });

  it("las liquidaciones del propio aguinaldo no integran la base de ningún SAC", async () => {
    const emp = await createEmployee();
    await confirmedEntry(emp, 2026, 6, "second_half", 900000);
    const period = await sacPeriod(2026, 6);
    const sacEntry = await db.PayrollEntry.create({
      employee_id: emp.id, pay_period_id: period.id, status: "confirmed",
      regular_amount: 0, overtime_50_amount: 0, overtime_100_amount: 0, gross_amount: 950000, net_amount: 950000,
      advances_deducted: 0, loan_installments_deducted: 0,
    });
    await db.PayrollAdjustment.create({ payroll_entry_id: sacEntry.id, label: "Premio", amount: 500000, type: "bonus" });

    const { loadSemesterEntries } = require("../../services/sacService");
    const entries = await loadSemesterEntries({ year: 2026, semester: 1, employeeIds: [emp.id] });
    expect(entries.get(emp.id)).toHaveLength(1);
    expect(entries.get(emp.id)[0].period_type).toBe("second_half");
  });
});

describe("GET /payroll/:id de un período sac", () => {
  it("devuelve el desglose al vuelo: mejor mes, días y premios que cuentan y excluidos", async () => {
    const emp = await createEmployee({ hire_date: "2026-04-01" });
    const entry = await confirmedEntry(emp, 2026, 6, "second_half", 1000000);
    await db.PayrollAdjustment.create({ payroll_entry_id: entry.id, label: "Viáticos", amount: 100000, type: "bonus", is_remunerative: false });
    await db.PayrollAdjustment.create({ payroll_entry_id: entry.id, label: "Premio", amount: 50000, type: "bonus" });
    const period = await sacPeriod(2026, 6);
    const actor = await createActor({ role: "admin" });
    await as(actor).post(`/payroll/${period.id}/generate`).send({});

    const res = await as(actor).get(`/payroll/${period.id}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    const breakdown = res.body.data[0].sac_breakdown;
    expect(breakdown).toMatchObject({ best_month: 6, best_amount: 900000, computable_days: 91, semester_days: 181, label: "SAC 1er semestre 2026" });
    expect(breakdown.bonuses).toEqual([
      { month: 6, label: "Viáticos", amount: 100000, is_remunerative: false },
      { month: 6, label: "Premio", amount: 50000, is_remunerative: true },
    ]);
    expect(breakdown.monthly).toHaveLength(6);
  });
});

describe("Resumen de costos", () => {
  it("el bruto del SAC entra en su mes y tiene su propio renglón en el detalle", async () => {
    const emp = await createEmployee();
    const period = await sacPeriod(2026, 6);
    await db.PayrollEntry.create({
      employee_id: emp.id, pay_period_id: period.id, status: "confirmed",
      regular_amount: 0, overtime_50_amount: 0, overtime_100_amount: 0, gross_amount: 450000, net_amount: 450000,
      advances_deducted: 0, loan_installments_deducted: 0,
    });
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).get("/expense-summary/monthly?year=2026&month=6");
    expect(res.status).toBe(200);
    expect(res.body.expenses.payroll_gross.total).toBe(450000);
    expect(res.body.expenses.payroll_gross.detail).toMatchObject({ sac: 450000, first_half: 0, second_half: 0 });
  });
});

describe("GET /me/payroll", () => {
  it("no devuelve is_remunerative en los ajustes de la liquidación", async () => {
    const actor = await createActor();
    const emp = await createEmployee({ user_id: actor.user.id });
    const period = await sacPeriod(2026, 6);
    const entry = await db.PayrollEntry.create({
      employee_id: emp.id, pay_period_id: period.id, status: "confirmed",
      regular_amount: 0, overtime_50_amount: 0, overtime_100_amount: 0, gross_amount: 460000, net_amount: 460000,
      advances_deducted: 0, loan_installments_deducted: 0,
    });
    await db.PayrollAdjustment.create({ payroll_entry_id: entry.id, label: "Viáticos", amount: 10000, type: "bonus", is_remunerative: false });

    const res = await as(actor).get("/me/payroll");
    expect(res.status).toBe(200);
    const adjustment = res.body.data[0].adjustments[0];
    expect(Object.keys(adjustment).sort()).toEqual(["amount", "id", "label", "type"]);
    expect(res.body.data[0].sac_breakdown).toBeUndefined();
  });
});

describe("lookup de quincenas", () => {
  it("GET /lookup/pay-periods no incluye el aguinaldo (bloquearía la carga de horas de todo el semestre)", async () => {
    await sacPeriod(2026, 6);
    await quincena(2026, 6, "second_half");
    const actor = await createActor();
    const res = await as(actor).get("/lookup/pay-periods");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});
