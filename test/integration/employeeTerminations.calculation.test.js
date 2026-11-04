"use strict";
// Etapa 2 de egresos (PLAN_EGRESOS.md §5, §11): GET /employee-terminations/:id/calculation arma el
// desglose de la liquidación — solo lectura — y /loans/:id/settle comparte la regla con el egreso.
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
    hire_date: "2020-03-01",
    hourly_rate: 0,
    pay_type: "monthly",
    monthly_salary: 900000,
    ...extra,
  });
}

// Liquidación confirmada de un mes (2Q del mes), con el bruto indicado.
async function paidMonth(employee, year, month, gross, { status = "paid", entryExtra = {} } = {}) {
  const lastDay = new Date(year, month, 0).getDate();
  const period = await db.PayPeriod.create({
    start_date: `${year}-${String(month).padStart(2, "0")}-16`,
    end_date: `${year}-${String(month).padStart(2, "0")}-${lastDay}`,
    type: "second_half",
    month,
    year,
  });
  return db.PayrollEntry.create({
    employee_id: employee.id,
    pay_period_id: period.id,
    status,
    regular_amount: gross,
    gross_amount: gross,
    net_amount: gross,
    ...entryExtra,
  });
}

const reader = () => createActor({ permissions: ["employee_terminations_read", "employee_salaries_read"] });

async function createTermination(employee, extra = {}) {
  return db.EmployeeTermination.create({
    employee_id: employee.id,
    type: "dismissal_without_cause",
    termination_date: "2026-10-20",
    notice_given: "none",
    status: "draft",
    ...extra,
  });
}

const calc = async (termination, actor) => {
  const res = await as(actor || (await reader())).get(`/employee-terminations/${termination.id}/calculation`);
  expect(res.status).toBe(200);
  return res.body.data;
};
const item = (data, key) => data.items.find((i) => i.key === key);

describe("GET /employee-terminations/:id/calculation — despido sin causa", () => {
  it("calcula antigüedad, base, preaviso, integración y art. 245 con la mejor remuneración de 12 meses", async () => {
    const employee = await createEmployee({ hire_date: "2020-03-01" });
    await paidMonth(employee, 2026, 7, 800000);
    await paidMonth(employee, 2026, 8, 1000000);
    await paidMonth(employee, 2026, 9, 900000);
    const termination = await createTermination(employee, { termination_date: "2026-10-20" });

    const data = await calc(termination);

    // 1/3/2020 → 20/10/2026 = 6 años, 7 meses, 20 días → 7 años de indemnización
    expect(data.seniority).toMatchObject({ years: 6, months: 7, years_for_severance: 7, in_probation: false });
    expect(data.severance_base).toMatchObject({ base: 1000000, year: 2026, month: 8 });
    expect(data.severance_base.series).toHaveLength(12);
    expect(item(data, "severance").amount).toBe(7000000);
    expect(item(data, "notice_pay").amount).toBe(2000000); // más de 5 años: 2 meses
    expect(item(data, "month_integration").amount).toBe(354838.71); // 1.000.000 / 31 × 11
    expect(item(data, "notice_pay_sac").amount).toBe(166666.67);
    expect(data.indemnity_total).toBeGreaterThan(9000000);
    expect(data.gross_total).toBe(data.remunerative_total + data.indemnity_total);
  });

  it("aplica el tope del convenio cargado en el egreso", async () => {
    const employee = await createEmployee();
    await paidMonth(employee, 2026, 9, 1000000);
    const termination = await createTermination(employee, { cct_cap_amount: 600000 });

    const data = await calc(termination);

    expect(item(data, "severance").amount).toBe(600000 * 7);
    expect(item(data, "severance").breakdown.cap_applied).toBe(true);
  });

  it("no cuenta SAC, premios no remunerativos ni vacaciones en la base", async () => {
    const employee = await createEmployee();
    const entry = await paidMonth(employee, 2026, 9, 1000000);
    await db.PayrollLine.create({ payroll_entry_id: entry.id, label: "Vacaciones", quantity: 1, rate: 200000, subtotal: 200000, line_type: "vacation" });
    await db.PayrollAdjustment.create({ payroll_entry_id: entry.id, type: "bonus", label: "Premio", amount: 100000, is_remunerative: false });
    const termination = await createTermination(employee);

    const data = await calc(termination);

    expect(data.severance_base.base).toBe(700000);
  });

  it("con preaviso completo no hay preaviso ni integración", async () => {
    const employee = await createEmployee();
    await paidMonth(employee, 2026, 9, 1000000);
    const termination = await createTermination(employee, { notice_given: "full" });

    const data = await calc(termination);

    expect(item(data, "notice_pay").applies).toBe(false);
    expect(item(data, "month_integration").applies).toBe(false);
    expect(data.indemnity_total).toBe(7000000);
  });

  it("en período de prueba no corresponde preaviso, integración ni indemnización", async () => {
    const employee = await createEmployee({ hire_date: "2026-07-01" });
    await paidMonth(employee, 2026, 9, 900000);
    const termination = await createTermination(employee, { termination_date: "2026-10-20" });

    const data = await calc(termination);

    expect(data.seniority.in_probation).toBe(true);
    expect(data.indemnity_total).toBe(0);
  });
});

describe("GET /employee-terminations/:id/calculation — otros tipos", () => {
  it("la renuncia no trae conceptos indemnizatorios", async () => {
    const employee = await createEmployee();
    await paidMonth(employee, 2026, 9, 1000000);
    const termination = await createTermination(employee, { type: "resignation" });

    const data = await calc(termination);

    expect(data.items.map((i) => i.key)).toEqual(
      expect.not.arrayContaining(["notice_pay", "month_integration", "severance"])
    );
    expect(data.indemnity_total).toBe(0);
  });

  it("el mutuo acuerdo calcula preaviso, integración y art. 245 solo como referencia", async () => {
    const employee = await createEmployee();
    await paidMonth(employee, 2026, 9, 1000000);
    const termination = await createTermination(employee, { type: "mutual_agreement" });

    const data = await calc(termination);

    expect(item(data, "severance").amount).toBe(7000000);
    expect(item(data, "severance").reference_only).toBe(true);
    expect(item(data, "notice_pay").reference_only).toBe(true);
    expect(data.indemnity_total).toBe(0);
  });
});

describe("GET /employee-terminations/:id/calculation — haberes, SAC y vacaciones", () => {
  it("prorratea el sueldo de un mensualizado desde la última liquidación hasta el egreso", async () => {
    const employee = await createEmployee({ monthly_salary: 900000 });
    await paidMonth(employee, 2026, 10, 900000); // termina el 31/10
    const termination = await createTermination(employee, { type: "resignation", termination_date: "2026-11-12" });

    const data = await calc(termination);

    expect(item(data, "wages").amount).toBe(360000); // 12/30
    expect(item(data, "wages").breakdown.method).toBe("prorate_fixed");
  });

  it("un quincenal fijo prorratea con su sueldo mensual equivalente", async () => {
    const employee = await createEmployee({ pay_type: "biweekly_fixed", monthly_salary: 450000 });
    await paidMonth(employee, 2026, 10, 900000);
    const termination = await createTermination(employee, { type: "resignation", termination_date: "2026-11-15" });

    const data = await calc(termination);

    expect(item(data, "wages").amount).toBe(450000);
  });

  it("si la última quincena liquidada pasa el egreso, sugiere descontar lo pagado de más", async () => {
    const employee = await createEmployee({ monthly_salary: 900000 });
    await paidMonth(employee, 2026, 10, 900000); // paga hasta el 31/10
    const termination = await createTermination(employee, { type: "resignation", termination_date: "2026-10-20" });

    const data = await calc(termination);

    expect(item(data, "wages").label).toBe("Haberes pagados de más");
    expect(item(data, "wages").amount).toBe(-330000); // 11 días
    expect(data.warnings.join(" ")).toMatch(/pagados de más/);
  });

  it("un jornalizado cobra las horas aprobadas del período sin liquidar", async () => {
    const actor = await reader();
    const employee = await createEmployee({ pay_type: "hourly", hourly_rate: 5000, monthly_salary: null });
    await paidMonth(employee, 2026, 9, 800000);
    await db.TimeEntry.create({
      employee_id: employee.id, date: "2026-10-05", check_in: "07:00", check_out: "15:00",
      regular_hours: 8, status: "approved", registered_by: actor.user.id,
    });
    const termination = await createTermination(employee, { type: "resignation", termination_date: "2026-10-20" });

    const data = await calc(termination, actor);

    expect(item(data, "wages").breakdown.method).toBe("engine");
    expect(item(data, "wages").amount).toBeGreaterThanOrEqual(40000); // 8 h × $5.000
  });

  it("calcula el SAC proporcional con el mejor mes y los días del semestre hasta el egreso", async () => {
    const employee = await createEmployee({ monthly_salary: 900000 });
    for (const m of [7, 8, 9]) await paidMonth(employee, 2026, m, 900000);
    const termination = await createTermination(employee, { type: "resignation", termination_date: "2026-10-20" });

    const data = await calc(termination);

    // mejor mes 900.000 / 2 × 112 días (1/7 al 20/10) / 184
    expect(item(data, "sac_proportional").amount).toBe(273913.04);
    expect(item(data, "sac_proportional").breakdown).toMatchObject({ computable_days: 112, semester_days: 184, best_month: 7 });
  });

  it("un egreso en enero suma el SAC del 2do semestre si todavía no se liquidó", async () => {
    const employee = await createEmployee({ monthly_salary: 900000 });
    for (const m of [7, 8, 9, 10, 11, 12]) await paidMonth(employee, 2026, m, 900000);
    const termination = await createTermination(employee, { type: "resignation", termination_date: "2027-01-20" });

    const data = await calc(termination);

    const previous = item(data, "sac_previous_2026_2");
    expect(previous.amount).toBe(450000); // semestre completo: 900.000 / 2
    expect(previous.label).toMatch(/sin liquidar/);
  });

  it("si el SAC del semestre anterior ya se liquidó, no lo suma de nuevo", async () => {
    const employee = await createEmployee({ monthly_salary: 900000 });
    for (const m of [7, 8, 9, 10, 11]) await paidMonth(employee, 2026, m, 900000);
    const sacPeriod = await db.PayPeriod.create({ start_date: "2026-07-01", end_date: "2026-12-31", type: "sac", month: 12, year: 2026 });
    const dec = await paidMonth(employee, 2026, 12, 900000);
    const sacEntry = await db.PayrollEntry.create({ employee_id: employee.id, pay_period_id: sacPeriod.id, status: "paid", gross_amount: 450000, net_amount: 450000 });
    await db.PayrollLine.create({ payroll_entry_id: sacEntry.id, label: "SAC", quantity: 1, rate: 450000, subtotal: 450000, line_type: "sac" });
    expect(dec).toBeTruthy();
    const termination = await createTermination(employee, { type: "resignation", termination_date: "2027-01-20" });

    const data = await calc(termination);

    expect(item(data, "sac_previous_2026_2")).toBeUndefined();
  });

  it("calcula las vacaciones no gozadas descontando las ya tomadas del año", async () => {
    const employee = await createEmployee({ monthly_salary: 1000000, hire_date: "2015-01-01" });
    await paidMonth(employee, 2026, 9, 1000000);
    const actor = await reader();
    await db.LeaveRequest.create({
      employee_id: employee.id, leave_type: "vacation", start_date: "2026-02-02", end_date: "2026-02-08",
      total_days: 7, status: "approved", requested_by: actor.user.id,
    });
    const termination = await createTermination(employee, { type: "resignation", termination_date: "2026-12-31" });

    const data = await calc(termination, actor);

    // ingresó en 2015: 12 años al 31/12 → 28 días; todo el año trabajado (365/365) menos los 7 gozados
    const vac = item(data, "vacation_unused");
    expect(vac.breakdown).toMatchObject({ corresponding_days: 28, taken_days: 7, unused_days: 21, daily_rate: 40000 });
    expect(vac.amount).toBe(840000);
    expect(item(data, "vacation_unused_sac").amount).toBe(70000);
  });
});

describe("GET /employee-terminations/:id/calculation — descuentos", () => {
  it("lista los adelantos pagados que no se descontaron y suma el préstamo activo", async () => {
    const employee = await createEmployee();
    await paidMonth(employee, 2026, 9, 1000000);
    await db.SalaryAdvance.create({ employee_id: employee.id, amount: 50000, date: "2026-10-05", payment_method: "efectivo", status: "approved", paid_at: new Date() });
    const lender = await createActor({ permissions: ["loans_write"] });
    const loanRes = await as(lender).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-10-01", num_installments: 4, mark_as_paid: true,
    });
    expect(loanRes.status).toBe(201);
    const termination = await createTermination(employee, { type: "resignation" });

    const data = await calc(termination);

    expect(data.deductions.advances.total).toBe(50000);
    expect(data.deductions.loans.items).toHaveLength(1);
    expect(data.deductions.loans.items[0]).toMatchObject({ kind: "fixed_installments", installments: 4 });
    expect(data.deductions.total).toBe(50000 + data.deductions.loans.total_ars);
  });

  it("el préstamo de cuota fija perdona el interés de las cuotas que todavía no corren", async () => {
    const employee = await createEmployee();
    const lender = await createActor({ permissions: ["loans_write"] });
    const today = new Date();
    const startDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const loanRes = await as(lender).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: startDate, num_installments: 4,
      monthly_interest_percent: 4, mark_as_paid: true,
    });
    expect(loanRes.status).toBe(201);
    const termination = await createTermination(employee, { type: "resignation" });

    const data = await calc(termination);

    // recién entregado: ninguna cuota corre todavía → se cobra solo el capital, sin interés
    expect(data.deductions.loans.items[0].amount).toBe(100000);
    expect(data.deductions.loans.items[0].interest_waived).toBeGreaterThan(0);
  });

  it("no cuenta el adelanto ya descontado en una liquidación confirmada", async () => {
    const employee = await createEmployee();
    const entry = await paidMonth(employee, 2026, 9, 1000000);
    await db.SalaryAdvance.create({
      employee_id: employee.id, amount: 50000, date: "2026-09-20", payment_method: "efectivo", status: "approved",
      paid_at: new Date(), pay_period_id: entry.pay_period_id,
    });
    const termination = await createTermination(employee, { type: "resignation" });

    const data = await calc(termination);

    expect(data.deductions.advances.total).toBe(0);
  });

  it("si los descuentos superan lo adeudado, el neto estimado es 0 y queda la deuda", async () => {
    const employee = await createEmployee({ monthly_salary: 100000, hire_date: "2026-09-01" });
    await paidMonth(employee, 2026, 9, 100000);
    await db.SalaryAdvance.create({ employee_id: employee.id, amount: 900000, date: "2026-10-05", payment_method: "efectivo", status: "approved", paid_at: new Date() });
    const termination = await createTermination(employee, { type: "resignation", termination_date: "2026-10-15" });

    const data = await calc(termination);

    expect(data.net_estimate).toBe(0);
    expect(data.uncovered_debt).toBeGreaterThan(0);
  });
});

describe("GET /employee-terminations/:id/calculation — permisos y solo lectura", () => {
  it("no crea liquidaciones ni toca préstamos", async () => {
    const employee = await createEmployee();
    await paidMonth(employee, 2026, 9, 1000000);
    const termination = await createTermination(employee, { type: "resignation" });
    const entriesBefore = await db.PayrollEntry.count();

    await calc(termination);

    expect(await db.PayrollEntry.count()).toBe(entriesBefore);
    expect((await db.EmployeeTermination.findByPk(termination.id)).status).toBe("draft");
  });

  it("exige lectura de egresos y ver sueldos; con admin_granted pasa", async () => {
    const employee = await createEmployee();
    const termination = await createTermination(employee, { type: "resignation" });
    const url = `/employee-terminations/${termination.id}/calculation`;

    const sinLectura = await createActor({ permissions: ["employee_salaries_read"] });
    expect((await as(sinLectura).get(url)).status).toBe(401);

    const sinSueldos = await createActor({ permissions: ["employee_terminations_read"] });
    expect((await as(sinSueldos).get(url)).status).toBe(401);

    const admin = await createActor({ role: "admin" });
    expect((await as(admin).get(url)).status).toBe(200);
  });

  it("responde 404 con un egreso inexistente", async () => {
    const res = await as(await reader()).get("/employee-terminations/9999/calculation");
    expect(res.status).toBe(404);
  });
});
