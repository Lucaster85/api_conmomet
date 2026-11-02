"use strict";
// Etapa 1 del SAC (PLAN_SAC.md §9): premios no remunerativos y guardas para que un período `sac`
// nunca caiga en los flujos pensados para quincenas (generate, adelantos, préstamos).
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

let seq = 0;
async function createEmployee(extra = {}) {
  seq += 1;
  const n = Math.floor(Math.random() * 900000) + seq;
  return db.Employee.create({
    name: "Juan",
    lastname: "Pérez",
    dni: String(30000000 + n),
    cuil: String(20300000000 + n),
    hire_date: "2026-01-01",
    hourly_rate: 1000,
    ...extra,
  });
}

const createPeriod = (extra = {}) =>
  db.PayPeriod.create({
    start_date: "2026-10-01",
    end_date: "2026-10-15",
    type: "first_half",
    month: 10,
    year: 2026,
    ...extra,
  });

const createEntry = (employee, period, extra = {}) =>
  db.PayrollEntry.create({
    employee_id: employee.id,
    pay_period_id: period.id,
    status: "draft",
    regular_amount: 100000,
    overtime_50_amount: 0,
    overtime_100_amount: 0,
    gross_amount: 100000,
    net_amount: 100000,
    advances_deducted: 0,
    loan_installments_deducted: 0,
    ...extra,
  });

describe("POST /payroll-adjustments — is_remunerative", () => {
  it("un premio sin el campo queda remunerativo", async () => {
    const entry = await createEntry(await createEmployee(), await createPeriod());
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).post("/payroll-adjustments").send({
      payroll_entry_id: entry.id, label: "Premio", amount: 5000, type: "bonus",
    });
    expect(res.status).toBe(201);
    expect(res.body.is_remunerative).toBe(true);
  });

  it("un premio marcado no remunerativo se guarda así y sigue sumando al bruto", async () => {
    const entry = await createEntry(await createEmployee(), await createPeriod());
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).post("/payroll-adjustments").send({
      payroll_entry_id: entry.id, label: "Viáticos", amount: 5000, type: "bonus", is_remunerative: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.is_remunerative).toBe(false);

    await entry.reload();
    expect(Number(entry.gross_amount)).toBe(105000);
    expect(Number(entry.net_amount)).toBe(105000);
  });

  it("un descuento ignora is_remunerative: siempre queda en true", async () => {
    const entry = await createEntry(await createEmployee(), await createPeriod());
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).post("/payroll-adjustments").send({
      payroll_entry_id: entry.id, label: "Desc", amount: 1000, type: "deduction", is_remunerative: false,
    });
    expect(res.status).toBe(201);
    expect(res.body.is_remunerative).toBe(true);
  });
});

describe("PUT /payroll-adjustments/:id — is_remunerative", () => {
  const createBonus = (entry, extra = {}) =>
    db.PayrollAdjustment.create({
      payroll_entry_id: entry.id, label: "Premio", amount: 5000, type: "bonus", is_auto: false, ...extra,
    });

  it("alterna el flag con la liquidación en borrador y deja registro en la auditoría", async () => {
    const entry = await createEntry(await createEmployee(), await createPeriod());
    const bonus = await createBonus(entry);
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).put(`/payroll-adjustments/${bonus.id}`).send({ is_remunerative: false });
    expect(res.status).toBe(200);
    expect(res.body.is_remunerative).toBe(false);

    const log = await db.AuditLog.findOne({ where: { entity_type: "PayrollAdjustment", entity_id: bonus.id, field_changed: "is_remunerative" } });
    expect(log).not.toBeNull();
    expect(log.previous_value).toBe("true");
    expect(log.new_value).toBe("false");
  });

  it("400 si la liquidación ya está confirmada", async () => {
    const entry = await createEntry(await createEmployee(), await createPeriod(), { status: "confirmed" });
    const bonus = await createBonus(entry);
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).put(`/payroll-adjustments/${bonus.id}`).send({ is_remunerative: false });
    expect(res.status).toBe(400);
    await bonus.reload();
    expect(bonus.is_remunerative).toBe(true);
  });

  it("editar solo el monto de un premio no remunerativo no toca el flag", async () => {
    const entry = await createEntry(await createEmployee(), await createPeriod());
    const bonus = await createBonus(entry, { is_remunerative: false });
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).put(`/payroll-adjustments/${bonus.id}`).send({ amount: 7000 });
    expect(res.status).toBe(200);
    expect(res.body.is_remunerative).toBe(false);
  });

  it("si el ajuste deja de ser premio, vuelve a remunerativo", async () => {
    const entry = await createEntry(await createEmployee(), await createPeriod());
    const bonus = await createBonus(entry, { is_remunerative: false });
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).put(`/payroll-adjustments/${bonus.id}`).send({ type: "deduction" });
    expect(res.status).toBe(200);
    expect(res.body.is_remunerative).toBe(true);
  });
});

describe("POST /categories/:id/apply-bonus", () => {
  it("la suma no remunerativa por categoría se crea marcada como no remunerativa", async () => {
    const category = await db.Category.create({ name: "Oficial", guild_hourly_rate: 1000 });
    const employee = await createEmployee({ category_id: category.id, pay_type: "hourly", status: "active" });
    const period = await createPeriod();
    const entry = await createEntry(employee, period);
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).post(`/categories/${category.id}/apply-bonus`).send({
      pay_period_id: period.id, amount: 20000, label: "Suma no remunerativa",
    });
    expect(res.status).toBe(200);

    const adjustment = await db.PayrollAdjustment.findOne({ where: { payroll_entry_id: entry.id } });
    expect(adjustment.type).toBe("bonus");
    expect(adjustment.is_remunerative).toBe(false);
  });
});

describe("guardas para un período sac", () => {
  const createSacPeriod = () =>
    createPeriod({ start_date: "2026-07-01", end_date: "2026-12-31", type: "sac", month: 12 });

  it("POST /pay-periods rechaza type sac: el aguinaldo no se crea a mano", async () => {
    const actor = await createActor({ role: "admin" });
    const res = await as(actor).post("/pay-periods").send({ month: 12, year: 2026, type: "sac" });
    expect(res.status).toBe(400);
    expect(await db.PayPeriod.count({ where: { type: "sac" } })).toBe(0);
  });

  it("generate no corre sobre un período sac", async () => {
    const period = await createSacPeriod();
    const actor = await createActor({ role: "admin" });
    const res = await as(actor).post(`/payroll/${period.id}/generate`).send({});
    expect(res.status).toBe(400);
    expect(await db.PayrollEntry.count({ where: { pay_period_id: period.id } })).toBe(0);
  });

  it("un adelanto no se puede vincular a un período sac", async () => {
    const period = await createSacPeriod();
    const employee = await createEmployee();
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).post("/salary-advances").send({
      employee_id: employee.id, amount: 10000, date: "2026-12-10", payment_method: "efectivo", pay_period_id: period.id,
    });
    expect(res.status).toBe(400);
    expect(await db.SalaryAdvance.count()).toBe(0);
  });

  it("un descuento de cuota de préstamo no se puede cargar en una liquidación sac", async () => {
    const period = await createSacPeriod();
    const employee = await createEmployee();
    const entry = await createEntry(employee, period);
    const loan = await db.Loan.create({
      employee_id: employee.id, amount: 100000, remaining_balance: 100000, currency: "ARS", status: "active", start_date: "2026-11-01",
    });
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).post("/loan-payments").send({
      loan_id: loan.id, payroll_entry_id: entry.id, amount: 10000, date: "2026-12-10",
    });
    expect(res.status).toBe(400);
    expect(await db.LoanPayment.count()).toBe(0);
  });
});
