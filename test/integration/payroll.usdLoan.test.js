"use strict";
// Descuento en la liquidación de cuotas de préstamo en USD y congelamiento de la cotización al
// cerrar la quincena (ver ~/.claude/plans "Reponer préstamos en dólares con cotización por
// quincena", Etapa 3). DOLAR_HISTORY_API_URL/DOLAR_API_URL apuntan a hosts falsos — exchangeRateService
// los lee una sola vez al cargar el módulo, así que tienen que estar seteados ANTES del primer
// require de app/controllers (ver exchangeRateService.js).
process.env.DOLAR_HISTORY_API_URL = "https://history.test/dolares";
process.env.DOLAR_API_URL = "https://current.test/dolares";

const db = require("../../models");
const { createActor, as } = require("../helpers/auth");
const { round2 } = require("../../helpers/payrollCalculations");

let seq = 0;
async function createEmployee(overrides = {}) {
  seq += 1;
  const n = 700000 + seq + Math.floor(Math.random() * 200000);
  return db.Employee.create({
    name: "Carla", lastname: "Núñez", dni: String(30000000 + n), cuil: String(20300000000 + n),
    hire_date: "2024-01-01", hourly_rate: 1000,
    ...overrides,
  });
}

async function createUsdLoan(employee, { due = [], exchangeRateAtOrigin = 1500, amount = 600 } = {}) {
  const loan = await db.Loan.create({
    employee_id: employee.id, plan_type: "fixed_installments", currency: "USD",
    exchange_rate_at_origin: exchangeRateAtOrigin, amount_ars_at_origin: round2(amount * exchangeRateAtOrigin),
    amount, num_installments: due.length || 1, monthly_interest_percent: 0,
    installment_frequency: "biweekly", remaining_balance: amount, start_date: "2026-01-10", status: "active",
  });
  const installments = await db.LoanInstallment.bulkCreate(due.map(([year, month, half, instStatus], i) => ({
    loan_id: loan.id, installment_number: i + 1, due_year: year, due_month: month, due_period_type: half,
    principal_amount: 100, interest_amount: 0, total_amount: 100, remaining_principal_after: amount - 100 * (i + 1),
    status: instStatus || "scheduled",
  })));
  return { loan, installments };
}

const lastDayOfMonth = (year, month) => new Date(year, month, 0).getDate();
const createPeriod = (month, type, year = 2026) => {
  const lastDay = lastDayOfMonth(year, month);
  return db.PayPeriod.create({
    start_date: `${year}-${String(month).padStart(2, "0")}-${type === "first_half" ? "01" : "16"}`,
    end_date: `${year}-${String(month).padStart(2, "0")}-${type === "first_half" ? "15" : String(lastDay).padStart(2, "0")}`,
    type, month, year,
  });
};

const generateActor = () => createActor({ permissions: ["payroll_write"] });
const closeActor = () => createActor({ permissions: ["pay_periods_update"] });

const historical = (venta, fecha) => ({ casa: "oficial", compra: venta - 50, venta, fecha });
const current = (venta) => ({ moneda: "USD", casa: "oficial", nombre: "Oficial", compra: venta - 50, venta, fechaActualizacion: new Date().toISOString() });

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

function mockFetch({ historicalResponse = null, currentResponse = null } = {}) {
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    if (href.startsWith("https://history.test")) {
      if (!historicalResponse) return { ok: false, status: 404 };
      return { ok: true, json: async () => historicalResponse };
    }
    if (href.startsWith("https://current.test")) {
      if (!currentResponse) return { ok: false, status: 404 };
      return { ok: true, json: async () => currentResponse };
    }
    return { ok: false, status: 404 };
  });
}

const loanPaymentsOf = (loanId) => db.LoanPayment.findAll({ where: { loan_id: loanId }, order: [["loan_installment_id", "ASC"]] });

describe("POST /payroll/:payPeriodId/generate — cuota de préstamo en USD", () => {
  it("con cotización definitiva disponible: descuento en pesos, saldo baja en USD, locked_at null", async () => {
    const employee = await createEmployee();
    const { loan } = await createUsdLoan(employee, { due: [[2026, 10, "first_half"]] });
    const period = await createPeriod(10, "first_half");
    const actor = await generateActor();
    mockFetch({ historicalResponse: historical(1550, "2026-10-16") });

    const res = await as(actor).post(`/payroll/${period.id}/generate`);

    expect(res.status).toBe(201);
    const entry = res.body.data.find((e) => e.employee_id === employee.id);
    expect(Number(entry.loan_installments_deducted)).toBe(155000);

    const [payment] = await loanPaymentsOf(loan.id);
    expect(Number(payment.amount)).toBe(100);
    expect(Number(payment.exchange_rate)).toBe(1550);
    expect(Number(payment.amount_ars)).toBe(155000);
    expect(payment.notes).toMatch(/USD 100(\.00)? \(Cot: \$1550\)/);

    expect(Number((await loan.reload()).remaining_balance)).toBe(500);

    const updatedPeriod = await period.reload();
    expect(Number(updatedPeriod.usd_exchange_rate)).toBe(1550);
    expect(updatedPeriod.usd_exchange_rate_source).toBe("api");
    expect(updatedPeriod.usd_exchange_rate_date).toBe("2026-10-16");
    expect(updatedPeriod.usd_exchange_rate_locked_at).toBeNull();
  });

  it("antes de la fecha de la regla (404 histórica): usa la del día como provisoria", async () => {
    const employee = await createEmployee();
    await createUsdLoan(employee, { due: [[2026, 10, "first_half"]] });
    const period = await createPeriod(10, "first_half");
    const actor = await generateActor();
    mockFetch({ currentResponse: current(1480) });

    const res = await as(actor).post(`/payroll/${period.id}/generate`);

    expect(res.status).toBe(201);
    const updatedPeriod = await period.reload();
    expect(Number(updatedPeriod.usd_exchange_rate)).toBe(1480);
    expect(updatedPeriod.usd_exchange_rate_source).toBe("api");
    expect(updatedPeriod.usd_exchange_rate_date).toBe("2026-10-16");
  });

  it("sin ninguna cotización disponible: 400 y no se descuenta nada", async () => {
    const employee = await createEmployee();
    const { installments } = await createUsdLoan(employee, { due: [[2026, 10, "first_half"]] });
    const period = await createPeriod(10, "first_half");
    const actor = await generateActor();
    mockFetch();

    const res = await as(actor).post(`/payroll/${period.id}/generate`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cotización del dólar/i);
    expect((await installments[0].reload()).status).toBe("scheduled");
    expect(await db.PayrollEntry.count({ where: { pay_period_id: period.id } })).toBe(0);
  });

  it("cuota atrasada: usa la cotización de la quincena donde se descuenta, no la de su vencimiento", async () => {
    const employee = await createEmployee();
    const { loan } = await createUsdLoan(employee, { due: [[2026, 9, "second_half"]] }); // vencía en septiembre
    const period = await createPeriod(10, "first_half"); // se descuenta en la 1ª de octubre
    const actor = await generateActor();
    mockFetch({ historicalResponse: historical(1555, "2026-10-16") });

    const res = await as(actor).post(`/payroll/${period.id}/generate`);

    expect(res.status).toBe(201);
    const [payment] = await loanPaymentsOf(loan.id);
    expect(Number(payment.exchange_rate)).toBe(1555);
  });

  it("mensualizado: dos cuotas del mes (una atrasada) comparten la misma cotización", async () => {
    const employee = await createEmployee({ pay_type: "monthly", monthly_salary: 500000 });
    const { loan } = await createUsdLoan(employee, {
      amount: 1200,
      due: [[2026, 9, "second_half"], [2026, 10, "second_half"]],
    });
    const period = await createPeriod(10, "second_half");
    const actor = await generateActor();
    mockFetch({ historicalResponse: historical(1600, "2026-11-01") });

    const res = await as(actor).post(`/payroll/${period.id}/generate`);

    expect(res.status).toBe(201);
    const entry = res.body.data.find((e) => e.employee_id === employee.id);
    expect(Number(entry.loan_installments_deducted)).toBe(320000); // (100+100) USD x 1600

    const payments = await loanPaymentsOf(loan.id);
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => Number(p.exchange_rate) === 1600)).toBe(true);
  });
});

describe("PUT /pay-periods/:id/close — congelamiento de la cotización USD", () => {
  it("congela la definitiva de end_date+1 y recalcula el neto si difería de la provisoria", async () => {
    const employee = await createEmployee();
    const { loan } = await createUsdLoan(employee, { due: [[2026, 10, "first_half"]] });
    const period = await createPeriod(10, "first_half");
    const generator = await generateActor();
    mockFetch({ currentResponse: current(1480) }); // generado antes de que publique la definitiva
    const genRes = await as(generator).post(`/payroll/${period.id}/generate`);
    const entryBefore = genRes.body.data.find((e) => e.employee_id === employee.id);
    expect(Number(entryBefore.loan_installments_deducted)).toBe(148000);

    mockFetch({ historicalResponse: historical(1550, "2026-10-16") }); // ya se publicó
    const closer = await closeActor();
    const res = await as(closer).put(`/pay-periods/${period.id}/close`).send({});

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("closed");
    const updatedPeriod = await period.reload();
    expect(Number(updatedPeriod.usd_exchange_rate)).toBe(1550);
    expect(updatedPeriod.usd_exchange_rate_source).toBe("api");
    expect(updatedPeriod.usd_exchange_rate_locked_at).not.toBeNull();

    const [payment] = await loanPaymentsOf(loan.id);
    expect(Number(payment.exchange_rate)).toBe(1550);
    expect(Number(payment.amount_ars)).toBe(155000);

    const entryAfter = await db.PayrollEntry.findByPk(entryBefore.id);
    expect(Number(entryAfter.loan_installments_deducted)).toBe(155000);
    expect(Number(entryAfter.net_amount)).toBe(Number(entryBefore.net_amount) - 7000);
  });

  it("con cotización manual en el body: source queda 'manual'", async () => {
    const employee = await createEmployee();
    const { loan } = await createUsdLoan(employee, { due: [[2026, 10, "first_half"]] });
    const period = await createPeriod(10, "first_half");
    const generator = await generateActor();
    mockFetch({ historicalResponse: historical(1550, "2026-10-16") });
    await as(generator).post(`/payroll/${period.id}/generate`);

    mockFetch(); // la API no responde al cerrar; igual tiene que priorizar el body manual
    const closer = await closeActor();
    const res = await as(closer).put(`/pay-periods/${period.id}/close`).send({ usd_exchange_rate: 1600 });

    expect(res.status).toBe(200);
    const updatedPeriod = await period.reload();
    expect(Number(updatedPeriod.usd_exchange_rate)).toBe(1600);
    expect(updatedPeriod.usd_exchange_rate_source).toBe("manual");
    const [payment] = await loanPaymentsOf(loan.id);
    expect(Number(payment.exchange_rate)).toBe(1600);
  });

  it("sin cotización publicada, sin provisoria guardada y sin manual: 400", async () => {
    const employee = await createEmployee();
    const { loan } = await createUsdLoan(employee, { due: [[2026, 10, "first_half"]] });
    const period = await createPeriod(10, "first_half");
    // Simula una cuota USD descontada sin pasar por generate() (ej. dato legado), para ejercitar
    // el camino defensivo donde el período nunca tuvo una cotización provisoria guardada.
    const entry = await db.PayrollEntry.create({ employee_id: employee.id, pay_period_id: period.id, status: "draft" });
    await db.LoanPayment.create({
      loan_id: loan.id, payroll_entry_id: entry.id, amount: 100, exchange_rate: 1500, amount_ars: 150000,
      date: period.end_date, notes: "Cuota 1/1 — USD 100 (Cot: $1500)",
    });
    mockFetch();
    const closer = await closeActor();

    const res = await as(closer).put(`/pay-periods/${period.id}/close`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cotización del dólar/i);
    expect((await period.reload()).status).toBe("open");
  });

  it("quincena sin préstamos USD cierra exactamente como antes (regresión)", async () => {
    const period = await createPeriod(10, "first_half");
    const closer = await closeActor();
    mockFetch();

    const res = await as(closer).put(`/pay-periods/${period.id}/close`).send({});

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("closed");
    const updatedPeriod = await period.reload();
    expect(updatedPeriod.usd_exchange_rate).toBeNull();
    expect(updatedPeriod.usd_exchange_rate_locked_at).toBeNull();
    expect(updatedPeriod.closed_by).not.toBeNull();
  });

  it("401 sin el permiso", async () => {
    const period = await createPeriod(10, "first_half");
    const actor = await createActor();
    const res = await as(actor).put(`/pay-periods/${period.id}/close`).send({});
    expect(res.status).toBe(401);
  });
});
