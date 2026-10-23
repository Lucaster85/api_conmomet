"use strict";
// Ajuste de liquidación tipo "Recibo / Depósito" (FLOWS.md §42): resta del neto igual que un
// descuento, pero queda identificado aparte para la columna "Depósito" de la planilla.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

async function createEntry(gross = 100000) {
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
  return db.PayrollEntry.create({
    employee_id: employee.id,
    pay_period_id: period.id,
    status: "draft",
    // recalculateEntry rearma el bruto desde las líneas o, si no hay, desde regular_amount + extras.
    regular_amount: gross,
    overtime_50_amount: 0,
    overtime_100_amount: 0,
    gross_amount: gross,
    net_amount: gross,
    advances_deducted: 0,
    loan_installments_deducted: 0,
  });
}

describe("POST /payroll-adjustments — tipo deposit", () => {
  it("un depósito baja el neto pero no el bruto", async () => {
    const entry = await createEntry(100000);
    const actor = await createActor({ permissions: ["payroll_adjustments_write"] });

    const res = await as(actor).post("/payroll-adjustments").send({
      payroll_entry_id: entry.id, label: "Depósito banco", amount: 30000, type: "deposit",
    });
    expect(res.status).toBeLessThan(300);

    await entry.reload();
    expect(Number(entry.gross_amount)).toBe(100000);
    expect(Number(entry.net_amount)).toBe(70000);
  });

  it("depósito y descuento se restan los dos del neto", async () => {
    const entry = await createEntry(100000);
    const actor = await createActor({ permissions: ["payroll_adjustments_write"] });

    await as(actor).post("/payroll-adjustments").send({ payroll_entry_id: entry.id, label: "Dep", amount: 30000, type: "deposit" });
    await as(actor).post("/payroll-adjustments").send({ payroll_entry_id: entry.id, label: "Desc", amount: 5000, type: "deduction" });

    await entry.reload();
    expect(Number(entry.net_amount)).toBe(65000);
  });

  it("400 con un type inválido", async () => {
    const entry = await createEntry();
    const actor = await createActor({ permissions: ["payroll_adjustments_write"] });

    const res = await as(actor).post("/payroll-adjustments").send({
      payroll_entry_id: entry.id, label: "X", amount: 1, type: "otro",
    });
    expect(res.status).toBe(400);
  });

  // 401 y no 403: es lo que devuelve authPermission en este repo cuando falta el permiso.
  it("401 sin el permiso", async () => {
    const entry = await createEntry();
    const actor = await createActor();

    const res = await as(actor).post("/payroll-adjustments").send({
      payroll_entry_id: entry.id, label: "X", amount: 1, type: "deposit",
    });
    expect(res.status).toBe(401);
  });
});
