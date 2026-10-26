"use strict";
// Selección de cuotas de préstamo a descontar en una liquidación (services/loanInstallmentDue.js).
const db = require("../../models");
const { findDueLoanInstallments } = require("../../services/loanInstallmentDue");

let seq = 0;
async function createEmployee() {
  seq += 1;
  const n = 500000 + seq + Math.floor(Math.random() * 400000);
  return db.Employee.create({
    name: "Ana", lastname: "Gómez", dni: String(30000000 + n), cuil: String(20300000000 + n),
    hire_date: "2024-01-01", hourly_rate: 1000,
  });
}

async function createLoan(employee, { status = "active", planType = "fixed_installments", due = [] } = {}) {
  const loan = await db.Loan.create({
    employee_id: employee.id, plan_type: planType, currency: "ARS", amount: 100000,
    num_installments: due.length || 1, monthly_interest_percent: 0, installment_frequency: "biweekly",
    remaining_balance: 100000, start_date: "2026-01-10", status,
  });
  const installments = await db.LoanInstallment.bulkCreate(due.map(([year, month, half, instStatus], i) => ({
    loan_id: loan.id, installment_number: i + 1, due_year: year, due_month: month, due_period_type: half,
    principal_amount: 10000, interest_amount: 0, total_amount: 10000, remaining_principal_after: 0,
    status: instStatus || "scheduled",
  })));
  return { loan, installments };
}

const createPeriod = (month, type, year = 2026) =>
  db.PayPeriod.create({
    start_date: `${year}-${String(month).padStart(2, "0")}-${type === "first_half" ? "01" : "16"}`,
    end_date: `${year}-${String(month).padStart(2, "0")}-${type === "first_half" ? "15" : "28"}`,
    type, month, year,
  });

describe("findDueLoanInstallments", () => {
  it("trae la cuota de la quincena y las atrasadas, ordenadas por número", async () => {
    const employee = await createEmployee();
    const { installments } = await createLoan(employee, {
      due: [[2026, 9, "second_half"], [2026, 10, "first_half"], [2026, 10, "second_half"]],
    });
    const period = await createPeriod(10, "second_half");

    const due = await findDueLoanInstallments({ employeeId: employee.id, period });

    expect(due.map((i) => i.id)).toEqual(installments.map((i) => i.id));
  });

  it("no trae las cuotas de quincenas futuras", async () => {
    const employee = await createEmployee();
    await createLoan(employee, { due: [[2026, 10, "first_half"], [2026, 10, "second_half"], [2026, 11, "first_half"]] });
    const period = await createPeriod(10, "first_half");

    const due = await findDueLoanInstallments({ employeeId: employee.id, period });

    expect(due.map((i) => i.installment_number)).toEqual([1]);
  });

  it("a un período de 2ª quincena le suma la cuota que vencía en la 1ª del mismo mes", async () => {
    const employee = await createEmployee();
    await createLoan(employee, { due: [[2026, 10, "first_half"]] });
    const period = await createPeriod(10, "second_half");

    const due = await findDueLoanInstallments({ employeeId: employee.id, period });

    expect(due).toHaveLength(1);
  });

  it("no trae las cuotas de un préstamo aprobado sin entregar", async () => {
    const employee = await createEmployee();
    await createLoan(employee, { status: "approved", due: [[2026, 10, "first_half"]] });
    const period = await createPeriod(10, "first_half");

    expect(await findDueLoanInstallments({ employeeId: employee.id, period })).toEqual([]);
  });

  it("no trae cuotas de un préstamo discretionary ni de otro empleado", async () => {
    const employee = await createEmployee();
    const other = await createEmployee();
    await createLoan(employee, { planType: "discretionary", due: [[2026, 10, "first_half"]] });
    await createLoan(other, { due: [[2026, 10, "first_half"]] });
    const period = await createPeriod(10, "first_half");

    expect(await findDueLoanInstallments({ employeeId: employee.id, period })).toEqual([]);
  });

  it("no trae cuotas ya descontadas en otra liquidación", async () => {
    const employee = await createEmployee();
    await createLoan(employee, { due: [[2026, 9, "first_half", "deducted"]] });
    const period = await createPeriod(10, "first_half");

    expect(await findDueLoanInstallments({ employeeId: employee.id, period })).toEqual([]);
  });

  it("al regenerar trae las cuotas ya vinculadas a esa liquidación", async () => {
    const employee = await createEmployee();
    const { installments } = await createLoan(employee, { due: [[2026, 10, "first_half"]] });
    const period = await createPeriod(10, "first_half");
    const entry = await db.PayrollEntry.create({ employee_id: employee.id, pay_period_id: period.id, status: "draft" });
    await installments[0].update({ status: "deducted", payroll_entry_id: entry.id });

    const due = await findDueLoanInstallments({ employeeId: employee.id, period, existingEntryId: entry.id });

    expect(due.map((i) => i.id)).toEqual([installments[0].id]);
  });
});
