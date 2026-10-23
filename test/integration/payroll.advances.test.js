"use strict";
// Qué adelantos cuentan como "descuento" en la liquidación. Desde que anular un adelanto pagado
// deja la fila con status "cancelled" (en vez de destroy), toda consulta de SalaryAdvance sin
// filtro de estado volvía a traerlo: el detalle (GET /payroll/:payPeriodId) mostraba el anulado
// como línea de descuento aunque el neto ya no lo contaba. Criterio único en
// helpers/salaryAdvanceScope.js.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

async function createPeriodWithEntry() {
  const n = Math.floor(Math.random() * 900000);
  const employee = await db.Employee.create({
    name: "Juan",
    lastname: "Pérez",
    dni: String(30000000 + n),
    cuil: String(20300000000 + n),
    hire_date: "2026-01-01",
    hourly_rate: 1000,
  });
  const period = await db.PayPeriod.create({
    start_date: "2026-10-01",
    end_date: "2026-10-15",
    type: "first_half",
    month: 10,
    year: 2026,
  });
  const entry = await db.PayrollEntry.create({
    employee_id: employee.id,
    pay_period_id: period.id,
    status: "draft",
  });
  return { employee, period, entry };
}

const createAdvance = (employee, period, overrides = {}) =>
  db.SalaryAdvance.create({
    employee_id: employee.id,
    pay_period_id: period.id,
    amount: 10000,
    date: "2026-10-05",
    payment_method: "efectivo",
    status: "approved",
    paid_at: new Date(),
    ...overrides,
  });

describe("GET /payroll/:payPeriodId — adelantos del detalle", () => {
  it("no lista un adelanto anulado, solo el vigente", async () => {
    const { employee, period } = await createPeriodWithEntry();
    const anulado = await createAdvance(employee, period, { amount: 5000, status: "cancelled" });
    const vigente = await createAdvance(employee, period, { amount: 8000 });
    const actor = await createActor({ permissions: ["payroll_read"] });

    const res = await as(actor).get(`/payroll/${period.id}`);
    expect(res.status).toBe(200);
    const ids = res.body.data[0].advances.map((a) => a.id);
    expect(ids).toEqual([vigente.id]);
    expect(ids).not.toContain(anulado.id);
  });

  it("no lista adelantos pendientes, rechazados ni aprobados sin pagar", async () => {
    const { employee, period } = await createPeriodWithEntry();
    await createAdvance(employee, period, { status: "pending", paid_at: null });
    await createAdvance(employee, period, { status: "rejected", paid_at: null });
    await createAdvance(employee, period, { status: "approved", paid_at: null });
    const actor = await createActor({ permissions: ["payroll_read"] });

    const res = await as(actor).get(`/payroll/${period.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data[0].advances).toEqual([]);
  });

  it("401 sin el permiso", async () => {
    const { period } = await createPeriodWithEntry();
    const actor = await createActor();

    const res = await as(actor).get(`/payroll/${period.id}`);
    expect(res.status).toBe(401);
  });
});

describe("GET /expense-summary/monthly — total informativo de adelantos", () => {
  it("suma solo los adelantos vigentes, no los anulados ni los no pagados", async () => {
    const { employee, period } = await createPeriodWithEntry();
    await createAdvance(employee, period, { amount: 5000, status: "cancelled" });
    await createAdvance(employee, period, { amount: 7000, status: "approved", paid_at: null });
    await createAdvance(employee, period, { amount: 8000 });
    const actor = await createActor({ permissions: ["expense_summary_read"] });

    const res = await as(actor).get("/expense-summary/monthly?year=2026&month=10");
    expect(res.status).toBe(200);
    expect(res.body.info.advances.total).toBe(8000);
    expect(res.body.info.advances.count).toBe(1);
  });
});
