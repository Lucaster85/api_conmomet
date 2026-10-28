"use strict";
// Préstamos de cuota fija con cuotas quincenales o mensuales (default quincenal). Ver FLOWS.md §43.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");
const { quincenaOfDate, quincenaIndex } = require("../../services/loanAmortizationService");

let seq = 0;
async function createEmployee(overrides = {}) {
  seq += 1;
  const n = 100000 + seq + Math.floor(Math.random() * 800000);
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

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const loanActor = (perms = ["loans_write", "loans_update"]) => createActor({ permissions: perms });

const installmentsOf = (loanId) =>
  db.LoanInstallment.findAll({ where: { loan_id: loanId }, order: [["installment_number", "ASC"]] });

const dues = (rows) => rows.map((r) => `${r.due_year}-${r.due_month}-${r.due_period_type}`);

describe("POST /loans — frecuencia de cuotas", () => {
  it("un jornalizado entregado sin elegir frecuencia queda quincenal con cuotas alternadas", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10",
      num_installments: 4, monthly_interest_percent: 4, mark_as_paid: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.installment_frequency).toBe("biweekly");
    expect(res.body.due_period_type).toBeNull();
    const rows = await installmentsOf(res.body.id);
    expect(dues(rows)).toEqual([
      "2026-11-second_half", "2026-12-first_half", "2026-12-second_half", "2027-1-first_half",
    ]);
    expect(Number(rows[0].interest_amount)).toBe(2000);
  });

  it("respeta la frecuencia mensual pedida para un jornalizado", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10",
      num_installments: 3, monthly_interest_percent: 4, installment_frequency: "monthly", mark_as_paid: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.installment_frequency).toBe("monthly");
    const rows = await installmentsOf(res.body.id);
    expect(dues(rows)).toEqual(["2026-12-first_half", "2027-1-first_half", "2027-2-first_half"]);
    expect(Number(rows[0].interest_amount)).toBe(4000);
  });

  it("un mensualizado que pide quincenal queda mensual con vencimiento en 2ª quincena", async () => {
    const employee = await createEmployee({ pay_type: "monthly", monthly_salary: 900000 });
    const actor = await loanActor();

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10",
      num_installments: 3, monthly_interest_percent: 4, installment_frequency: "biweekly", mark_as_paid: true,
    });

    expect(res.status).toBe(201);
    expect(res.body.installment_frequency).toBe("monthly");
    expect(res.body.due_period_type).toBe("second_half");
    const rows = await installmentsOf(res.body.id);
    expect(dues(rows)).toEqual(["2026-12-second_half", "2027-1-second_half", "2027-2-second_half"]);
  });

  it("400 con una frecuencia inválida", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10",
      num_installments: 3, installment_frequency: "weekly", mark_as_paid: true,
    });

    expect(res.status).toBe(400);
    expect(await db.Loan.count()).toBe(0);
  });

  it("sin entregar queda aprobado y sin cuotas", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10",
      num_installments: 4, mark_as_paid: false,
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("approved");
    expect(res.body.installment_frequency).toBe("biweekly");
    expect(await installmentsOf(res.body.id)).toHaveLength(0);
  });

  it("401 sin el permiso", async () => {
    const employee = await createEmployee();
    const actor = await createActor();

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10", num_installments: 3,
    });
    expect(res.status).toBe(401);
  });

  it("201 con admin_granted (bypass)", async () => {
    const employee = await createEmployee();
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10", num_installments: 3,
    });
    expect(res.status).toBe(201);
  });
});

describe("PUT /loans/:id/mark-paid — el plan se arma al entregar", () => {
  it("arma el plan quincenal desde hoy y pisa el start_date", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();
    const created = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-01-10",
      num_installments: 4, mark_as_paid: false,
    });

    const res = await as(actor).put(`/loans/${created.body.id}/mark-paid`).send({ payment_method: "efectivo" });

    expect(res.status).toBe(200);
    const loan = await db.Loan.findByPk(created.body.id);
    expect(loan.status).toBe("active");
    expect(loan.start_date).toBe(todayStr());
    const rows = await installmentsOf(loan.id);
    expect(rows).toHaveLength(4);
    const today = quincenaOfDate(todayStr());
    expect(quincenaIndex(rows[0].due_year, rows[0].due_month, rows[0].due_period_type))
      .toBe(quincenaIndex(today.year, today.month, today.half) + 1);
  });

  it("rearma un plan viejo con todas las cuotas sin descontar", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();
    const loan = await db.Loan.create({
      employee_id: employee.id, plan_type: "fixed_installments", currency: "ARS", amount: 90000,
      num_installments: 3, monthly_interest_percent: 0, installment_frequency: "monthly",
      remaining_balance: 90000, start_date: "2026-01-10", status: "approved",
    });
    await db.LoanInstallment.bulkCreate([1, 2, 3].map((k) => ({
      loan_id: loan.id, installment_number: k, due_month: k + 1, due_year: 2026, due_period_type: "first_half",
      principal_amount: 30000, interest_amount: 0, total_amount: 30000, remaining_principal_after: 90000 - 30000 * k,
      status: "scheduled",
    })));

    const res = await as(actor).put(`/loans/${loan.id}/mark-paid`).send({ payment_method: "efectivo" });

    expect(res.status).toBe(200);
    const rows = await installmentsOf(loan.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "scheduled" && r.due_year >= Number(todayStr().slice(0, 4)))).toBe(true);
    expect((await db.Loan.findByPk(loan.id)).start_date).toBe(todayStr());
  });

  it("no toca el plan si alguna cuota ya se descontó", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();
    const loan = await db.Loan.create({
      employee_id: employee.id, plan_type: "fixed_installments", currency: "ARS", amount: 60000,
      num_installments: 2, monthly_interest_percent: 0, installment_frequency: "monthly",
      remaining_balance: 30000, start_date: "2026-01-10", status: "approved",
    });
    await db.LoanInstallment.bulkCreate([
      { loan_id: loan.id, installment_number: 1, due_month: 2, due_year: 2026, due_period_type: "first_half", principal_amount: 30000, interest_amount: 0, total_amount: 30000, remaining_principal_after: 30000, status: "deducted" },
      { loan_id: loan.id, installment_number: 2, due_month: 3, due_year: 2026, due_period_type: "first_half", principal_amount: 30000, interest_amount: 0, total_amount: 30000, remaining_principal_after: 0, status: "scheduled" },
    ]);

    const res = await as(actor).put(`/loans/${loan.id}/mark-paid`).send({ payment_method: "efectivo" });

    expect(res.status).toBe(200);
    const rows = await installmentsOf(loan.id);
    expect(rows.map((r) => r.status)).toEqual(["deducted", "scheduled"]);
    expect((await db.Loan.findByPk(loan.id)).start_date).toBe("2026-01-10");
  });

  it("un discretionary aprobado se marca pagado sin cuotas y sin tocar start_date", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();
    const loan = await db.Loan.create({
      employee_id: employee.id, plan_type: "discretionary", currency: "ARS", amount: 50000,
      remaining_balance: 50000, start_date: "2026-01-10", status: "approved",
    });

    const res = await as(actor).put(`/loans/${loan.id}/mark-paid`).send({ payment_method: "efectivo" });

    expect(res.status).toBe(200);
    const after = await db.Loan.findByPk(loan.id);
    expect(after.status).toBe("active");
    expect(after.start_date).toBe("2026-01-10");
    expect(after.installment_frequency).toBeNull();
    expect(await installmentsOf(loan.id)).toHaveLength(0);
  });

  it("401 sin el permiso", async () => {
    const actor = await createActor();
    const res = await as(actor).put("/loans/1/mark-paid").send({ payment_method: "efectivo" });
    expect(res.status).toBe(401);
  });
});

describe("POST /loans/:id/apply-interest", () => {
  it("400 sobre un préstamo de cuota fija", async () => {
    const employee = await createEmployee();
    const actor = await loanActor(["loans_write"]);
    const created = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10", num_installments: 3, mark_as_paid: true,
    });

    const res = await as(actor).post(`/loans/${created.body.id}/apply-interest`).send({ rate_percent: 5 });

    expect(res.status).toBe(400);
    expect(Number((await db.Loan.findByPk(created.body.id)).remaining_balance)).toBe(100000);
  });

  it("sigue funcionando en un discretionary activo", async () => {
    const employee = await createEmployee();
    const actor = await loanActor(["loans_write"]);
    const loan = await db.Loan.create({
      employee_id: employee.id, plan_type: "discretionary", currency: "ARS", amount: 100000,
      remaining_balance: 100000, start_date: "2026-01-10", status: "active",
    });

    const res = await as(actor).post(`/loans/${loan.id}/apply-interest`).send({ rate_percent: 5 });

    expect(res.status).toBe(200);
    expect(Number((await db.Loan.findByPk(loan.id)).remaining_balance)).toBe(105000);
  });
});

describe("POST /loans/:id/settle — liquidación por baja", () => {
  // Cuotas armadas a mano contra la quincena real de hoy: la 1ª vence en la quincena actual y la
  // 2ª en la siguiente (que puede ser del mismo mes o del siguiente).
  async function loanWithCurrentAndNextInstallment(frequency) {
    const employee = await createEmployee();
    const loan = await db.Loan.create({
      employee_id: employee.id, plan_type: "fixed_installments", currency: "ARS", amount: 100000,
      num_installments: 2, monthly_interest_percent: 4, installment_frequency: frequency,
      remaining_balance: 100000, start_date: "2026-01-10", status: "active",
    });
    const today = quincenaOfDate(todayStr());
    const next = today.half === "first_half"
      ? { year: today.year, month: today.month, half: "second_half" }
      : { year: today.month === 12 ? today.year + 1 : today.year, month: today.month === 12 ? 1 : today.month + 1, half: "first_half" };
    await db.LoanInstallment.bulkCreate([
      { loan_id: loan.id, installment_number: 1, due_month: today.month, due_year: today.year, due_period_type: today.half, principal_amount: 50000, interest_amount: 2000, total_amount: 52000, remaining_principal_after: 50000, status: "scheduled" },
      { loan_id: loan.id, installment_number: 2, due_month: next.month, due_year: next.year, due_period_type: next.half, principal_amount: 50000, interest_amount: 1000, total_amount: 51000, remaining_principal_after: 0, status: "scheduled" },
    ]);
    return { loan, next, today };
  }

  it("quincenal: cobra completa la cuota de la quincena actual y solo capital la siguiente", async () => {
    const { loan } = await loanWithCurrentAndNextInstallment("biweekly");
    const actor = await loanActor(["loans_write"]);

    const res = await as(actor).post(`/loans/${loan.id}/settle`).send({ reason: "resignation" });

    expect(res.status).toBe(200);
    expect(res.body.total_charged).toBe(52000 + 50000);
    expect((await db.Loan.findByPk(loan.id)).status).toBe("completed");
  });

  it("mensual: la cuota del mes en curso se cobra completa aunque su quincena no haya llegado", async () => {
    const { loan, next, today } = await loanWithCurrentAndNextInstallment("monthly");
    const actor = await loanActor(["loans_write"]);

    const res = await as(actor).post(`/loans/${loan.id}/settle`).send({});

    expect(res.status).toBe(200);
    const sameMonth = next.month === today.month && next.year === today.year;
    expect(res.body.total_charged).toBe(sameMonth ? 52000 + 51000 : 52000 + 50000);
  });

  it("401 sin el permiso", async () => {
    const actor = await createActor();
    const res = await as(actor).post("/loans/1/settle").send({});
    expect(res.status).toBe(401);
  });
});

describe("PUT /loans/:id/reschedule", () => {
  async function createActiveLoan(overrides = {}) {
    const employee = await createEmployee();
    const actor = await loanActor();
    const created = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10",
      num_installments: 3, monthly_interest_percent: 4, installment_frequency: "monthly",
      mark_as_paid: true, ...overrides,
    });
    return { employee, actor, loan: created.body };
  }

  it("pasa de mensual a quincenal y rearma las cuotas", async () => {
    const { actor, loan } = await createActiveLoan();

    const res = await as(actor).put(`/loans/${loan.id}/reschedule`).send({
      amount: 100000, num_installments: 4, monthly_interest_percent: 4,
      installment_frequency: "biweekly", start_date: "2026-11-20", justification: "Pasarlo a quincenal",
    });

    expect(res.status).toBe(200);
    expect(res.body.installment_frequency).toBe("biweekly");
    expect(res.body.num_installments).toBe(4);
    const rows = await installmentsOf(loan.id);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.status === "scheduled")).toBe(true);
    const alert = await db.LoanChangeAlert.findOne({ where: { loan_id: loan.id } });
    expect(alert.action).toBe("rescheduled");
    expect(alert.previous_terms.installment_frequency).toBe("monthly");
    expect(alert.new_terms.installment_frequency).toBe("biweekly");
  });

  it("un mensualizado sigue quedando mensual aunque pida quincenal", async () => {
    const employee = await createEmployee({ pay_type: "monthly", monthly_salary: 900000 });
    const actor = await loanActor();
    const created = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10",
      num_installments: 3, monthly_interest_percent: 4, mark_as_paid: true,
    });

    const res = await as(actor).put(`/loans/${created.body.id}/reschedule`).send({
      amount: 100000, num_installments: 3, monthly_interest_percent: 4,
      installment_frequency: "biweekly", start_date: "2026-11-10", justification: "ajuste",
    });

    expect(res.status).toBe(200);
    expect(res.body.installment_frequency).toBe("monthly");
  });

  it("en approved (sin entregar) cierra los términos sin crear cuotas", async () => {
    const { actor, loan } = await createActiveLoan({ mark_as_paid: false });
    expect(loan.status).toBe("approved");

    const res = await as(actor).put(`/loans/${loan.id}/reschedule`).send({
      amount: 120000, num_installments: 5, monthly_interest_percent: 2,
      installment_frequency: "monthly", start_date: "2026-12-01", justification: "cambio de monto",
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(Number(res.body.amount)).toBe(120000);
    expect(await installmentsOf(loan.id)).toHaveLength(0);
  });

  it("400 si falta la justificación", async () => {
    const { actor, loan } = await createActiveLoan();

    const res = await as(actor).put(`/loans/${loan.id}/reschedule`).send({
      amount: 100000, num_installments: 3, monthly_interest_percent: 4,
      installment_frequency: "monthly", start_date: "2026-11-10",
    });

    expect(res.status).toBe(400);
  });

  it("400 si el monto supera el tope", async () => {
    const { actor, loan } = await createActiveLoan();

    const res = await as(actor).put(`/loans/${loan.id}/reschedule`).send({
      amount: 999999999, num_installments: 3, monthly_interest_percent: 4,
      installment_frequency: "monthly", start_date: "2026-11-10", justification: "x",
    });

    expect(res.status).toBe(400);
  });

  it("400 si alguna cuota ya se descontó", async () => {
    const { actor, loan } = await createActiveLoan();
    const [firstInstallment] = await installmentsOf(loan.id);
    await firstInstallment.update({ status: "deducted" });

    const res = await as(actor).put(`/loans/${loan.id}/reschedule`).send({
      amount: 100000, num_installments: 3, monthly_interest_percent: 4,
      installment_frequency: "monthly", start_date: "2026-11-10", justification: "x",
    });

    expect(res.status).toBe(400);
  });

  it("400 si alguna cuota tiene payroll_entry_id", async () => {
    const { employee, actor, loan } = await createActiveLoan();
    const period = await db.PayPeriod.create({
      start_date: "2026-11-01", end_date: "2026-11-15", type: "first_half", month: 11, year: 2026,
    });
    const entry = await db.PayrollEntry.create({ employee_id: employee.id, pay_period_id: period.id, status: "draft" });
    const [firstInstallment] = await installmentsOf(loan.id);
    await firstInstallment.update({ payroll_entry_id: entry.id });

    const res = await as(actor).put(`/loans/${loan.id}/reschedule`).send({
      amount: 100000, num_installments: 3, monthly_interest_percent: 4,
      installment_frequency: "monthly", start_date: "2026-11-10", justification: "x",
    });

    expect(res.status).toBe(400);
  });

  it("400 si el préstamo tiene un LoanPayment", async () => {
    const { actor, loan } = await createActiveLoan();
    await db.LoanPayment.create({
      loan_id: loan.id, amount: 1000, date: "2026-11-11", notes: "pago manual",
    });

    const res = await as(actor).put(`/loans/${loan.id}/reschedule`).send({
      amount: 100000, num_installments: 3, monthly_interest_percent: 4,
      installment_frequency: "monthly", start_date: "2026-11-10", justification: "x",
    });

    expect(res.status).toBe(400);
  });

  it("401 sin el permiso", async () => {
    const actor = await createActor();
    const res = await as(actor).put("/loans/1/reschedule").send({ justification: "x" });
    expect(res.status).toBe(401);
  });

  it("200 con admin_granted (bypass)", async () => {
    const { loan } = await createActiveLoan();
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).put(`/loans/${loan.id}/reschedule`).send({
      amount: 100000, num_installments: 3, monthly_interest_percent: 4,
      installment_frequency: "monthly", start_date: "2026-11-10", justification: "x",
    });

    expect(res.status).toBe(200);
  });
});

describe("PUT /loans/:id/cancel", () => {
  async function createActiveLoan(overrides = {}) {
    const employee = await createEmployee();
    const actor = await loanActor();
    const created = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10",
      num_installments: 3, monthly_interest_percent: 4, mark_as_paid: true, ...overrides,
    });
    return { employee, actor, loan: created.body };
  }

  it("cancela: cuotas en cancelled, préstamo cancelled con los campos de auditoría, y aviso creado", async () => {
    const { employee, actor, loan } = await createActiveLoan();

    const res = await as(actor).put(`/loans/${loan.id}/cancel`).send({ justification: "Cargado por error" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
    expect(res.body.cancellation_reason).toBe("Cargado por error");
    expect(res.body.cancelled_by).toBe(actor.user.id);
    const rows = await installmentsOf(loan.id);
    expect(rows.every((r) => r.status === "cancelled")).toBe(true);
    const alert = await db.LoanChangeAlert.findOne({ where: { loan_id: loan.id } });
    expect(alert.action).toBe("cancelled");
    expect(alert.employee_id).toBe(employee.id);
    expect(alert.new_terms).toBeNull();
  });

  it("después de cancelar, el empleado puede tomar otro préstamo", async () => {
    const { employee, actor, loan } = await createActiveLoan();
    await as(actor).put(`/loans/${loan.id}/cancel`).send({ justification: "error" });

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 50000, start_date: "2026-11-15",
      num_installments: 2, mark_as_paid: true,
    });

    expect(res.status).toBe(201);
  });

  it("400 si falta la justificación", async () => {
    const { loan, actor } = await createActiveLoan();
    const res = await as(actor).put(`/loans/${loan.id}/cancel`).send({});
    expect(res.status).toBe(400);
  });

  it("400 si alguna cuota ya se descontó", async () => {
    const { loan, actor } = await createActiveLoan();
    const [firstInstallment] = await installmentsOf(loan.id);
    await firstInstallment.update({ status: "deducted" });

    const res = await as(actor).put(`/loans/${loan.id}/cancel`).send({ justification: "x" });

    expect(res.status).toBe(400);
  });

  it("401 sin el permiso", async () => {
    const actor = await createActor();
    const res = await as(actor).put("/loans/1/cancel").send({ justification: "x" });
    expect(res.status).toBe(401);
  });

  it("200 con admin_granted (bypass)", async () => {
    const { loan } = await createActiveLoan();
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).put(`/loans/${loan.id}/cancel`).send({ justification: "x" });

    expect(res.status).toBe(200);
  });
});

describe("GET /loan-change-alerts", () => {
  it("devuelve los avisos con empleado y quien hizo el cambio", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();
    const created = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10",
      num_installments: 3, mark_as_paid: true,
    });
    await as(actor).put(`/loans/${created.body.id}/cancel`).send({ justification: "error de carga" });

    const readerActor = await createActor({ permissions: ["loan_change_alerts_read"] });
    const res = await as(readerActor).get("/loan-change-alerts");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].employee.id).toBe(employee.id);
    expect(res.body.data[0].created_at).toBeTruthy();
  });

  it("401 sin el permiso", async () => {
    const actor = await createActor();
    const res = await as(actor).get("/loan-change-alerts");
    expect(res.status).toBe(401);
  });
});

describe("PUT /loans/:id — ya no acepta status", () => {
  it("ignora un status en el body", async () => {
    const employee = await createEmployee();
    const actor = await loanActor();
    const created = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10",
      num_installments: 3, mark_as_paid: true,
    });

    const res = await as(actor).put(`/loans/${created.body.id}`).send({ status: "cancelled", notes: "nota" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
    expect(res.body.notes).toBe("nota");
  });
});
