"use strict";
// Préstamos de cuota fija otorgados en dólares (ver ~/.claude/plans "Reponer préstamos en
// dólares con cotización por quincena", Etapa 2). El plan de cuotas queda en USD; el equivalente
// en pesos de origen es solo informativo (no se usa para descontar).
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

let seq = 0;
async function createEmployee(overrides = {}) {
  seq += 1;
  const n = 200000 + seq + Math.floor(Math.random() * 800000);
  return db.Employee.create({
    name: "Juan",
    lastname: "Pérez",
    dni: String(30000000 + n),
    cuil: String(20300000000 + n),
    hire_date: "2024-01-01",
    hourly_rate: 1000,
    ...overrides,
  });
}

async function createPendingLoan(employeeId, overrides = {}) {
  return db.Loan.create({
    employee_id: employeeId,
    plan_type: "fixed_installments",
    currency: "ARS",
    amount: 500,
    requested_amount: 500,
    requested_num_installments: 6,
    remaining_balance: 500,
    start_date: "2026-11-10",
    status: "pending",
    ...overrides,
  });
}

const loanActor = (perms = ["loans_write", "loans_update"]) => createActor({ permissions: perms });

const installmentsOf = (loanId) =>
  db.LoanInstallment.findAll({ where: { loan_id: loanId }, order: [["installment_number", "ASC"]] });

describe("POST /loans — moneda USD", () => {
  it("crea un préstamo en USD con el equivalente en pesos de origen y cuotas en dólares", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 600, currency: "USD", exchange_rate_at_origin: 1530,
      start_date: "2026-11-10", num_installments: 6, monthly_interest_percent: 5, mark_as_paid: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe("USD");
    expect(Number(res.body.exchange_rate_at_origin)).toBe(1530);
    expect(Number(res.body.amount_ars_at_origin)).toBe(918000);
    expect(Number(res.body.amount)).toBe(600);
    expect(Number(res.body.remaining_balance)).toBe(600);

    const rows = await installmentsOf(res.body.id);
    expect(rows).toHaveLength(6);
    expect(Number(rows[0].total_amount)).toBeGreaterThan(0);
  });

  it("sin moneda explícita sigue quedando en ARS (default)", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10",
      num_installments: 3, mark_as_paid: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.currency).toBe("ARS");
    expect(res.body.exchange_rate_at_origin).toBeNull();
    expect(res.body.amount_ars_at_origin).toBeNull();
  });

  it("400 si pide USD sin cotización de entrega", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 600, currency: "USD",
      start_date: "2026-11-10", num_installments: 6, mark_as_paid: true,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cotización de entrega es obligatoria/i);
    expect(await db.Loan.count()).toBe(0);
  });

  it("400 si la cotización de entrega es cero o negativa", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 600, currency: "USD", exchange_rate_at_origin: 0,
      start_date: "2026-11-10", num_installments: 6, mark_as_paid: true,
    });

    expect(res.status).toBe(400);
  });

  it("400 con una moneda inválida", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 600, currency: "EUR",
      start_date: "2026-11-10", num_installments: 6, mark_as_paid: true,
    });

    expect(res.status).toBe(400);
  });

  it("400 si el equivalente en pesos supera el tope, aunque el monto en USD sea chico", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();

    // 1000 USD x 1530 = 1.530.000 > tope default de 1.000.000
    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 1000, currency: "USD", exchange_rate_at_origin: 1530,
      start_date: "2026-11-10", num_installments: 6, mark_as_paid: true,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/tope máximo/i);
  });

  it("un monto en USD cuyo equivalente entra dentro del tope se acepta", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100, currency: "USD", exchange_rate_at_origin: 1530,
      start_date: "2026-11-10", num_installments: 6, mark_as_paid: true,
    });

    expect(res.status).toBe(201);
  });
});

describe("PUT /loans/:id/approve — moneda USD", () => {
  it("aprueba un pedido (hecho en pesos) otorgándolo en USD", async () => {
    const employee = await createEmployee();
    const pending = await createPendingLoan(employee.id);
    const actor = await loanActor();

    const res = await as(actor).put(`/loans/${pending.id}/approve`).send({
      amount: 600, currency: "USD", exchange_rate_at_origin: 1530,
      num_installments: 6, monthly_interest_percent: 5, mark_as_paid: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("USD");
    expect(Number(res.body.exchange_rate_at_origin)).toBe(1530);
    expect(Number(res.body.amount_ars_at_origin)).toBe(918000);
    const rows = await installmentsOf(pending.id);
    expect(rows).toHaveLength(6);
  });

  it("400 si aprueba en USD sin cotización", async () => {
    const employee = await createEmployee();
    const pending = await createPendingLoan(employee.id);
    const actor = await loanActor();

    const res = await as(actor).put(`/loans/${pending.id}/approve`).send({
      amount: 600, currency: "USD", num_installments: 6, mark_as_paid: true,
    });

    expect(res.status).toBe(400);
    expect((await db.Loan.findByPk(pending.id)).status).toBe("pending");
  });

  it("sin moneda explícita aprueba en ARS (default)", async () => {
    const employee = await createEmployee();
    const pending = await createPendingLoan(employee.id);
    const actor = await loanActor();

    const res = await as(actor).put(`/loans/${pending.id}/approve`).send({
      amount: 500, num_installments: 6, mark_as_paid: true,
    });

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("ARS");
  });
});

describe("PUT /loans/:id/reschedule — moneda fija", () => {
  async function createActiveUsdLoan(overrides = {}) {
    const employee = await createEmployee();
    const actor = await loanActor();
    const created = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 600, currency: "USD", exchange_rate_at_origin: 1530,
      start_date: "2026-11-10", num_installments: 6, monthly_interest_percent: 5,
      mark_as_paid: true, ...overrides,
    });
    return { employee, actor, loan: created.body };
  }

  it("400 si el body trae una moneda distinta a la del préstamo", async () => {
    const { actor, loan } = await createActiveUsdLoan();

    const res = await as(actor).put(`/loans/${loan.id}/reschedule`).send({
      amount: 600, currency: "ARS", num_installments: 6, monthly_interest_percent: 5,
      installment_frequency: "biweekly", start_date: "2026-11-10", justification: "x",
    });

    expect(res.status).toBe(400);
    expect((await db.Loan.findByPk(loan.id)).currency).toBe("USD");
  });

  it("reprogramar sin tocar la moneda recalcula el equivalente en pesos con la misma cotización", async () => {
    const { actor, loan } = await createActiveUsdLoan();

    const res = await as(actor).put(`/loans/${loan.id}/reschedule`).send({
      amount: 650, num_installments: 8, monthly_interest_percent: 5,
      installment_frequency: "biweekly", start_date: "2026-11-10", justification: "ajuste de monto",
    });

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe("USD");
    expect(Number(res.body.amount)).toBe(650);
    expect(Number(res.body.amount_ars_at_origin)).toBe(994500);
  });

  it("mandar la misma moneda que ya tiene el préstamo no rompe nada", async () => {
    const { actor, loan } = await createActiveUsdLoan();

    const res = await as(actor).put(`/loans/${loan.id}/reschedule`).send({
      amount: 600, currency: "USD", num_installments: 6, monthly_interest_percent: 5,
      installment_frequency: "biweekly", start_date: "2026-11-10", justification: "x",
    });

    expect(res.status).toBe(200);
  });
});
