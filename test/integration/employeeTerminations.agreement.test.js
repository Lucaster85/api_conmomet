"use strict";
// Etapa 4 de egresos (PLAN_EGRESOS.md §7, §11): acuerdo de pago de la indemnización en cuotas fijas.
// Con un acuerdo activo la indemnización sale de la liquidación final y se paga cuota por cuota; el
// egreso pasa a `settled` cuando la final está pagada y todas las cuotas.
jest.mock("../../helpers/r2Storage", () => ({
  uploadToR2: jest.fn(async (file, folder) => `${process.env.STORAGE_PUBLIC_URL}/${folder}/${file.originalname}`),
  deleteFromR2: jest.fn(async () => {}),
}));

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

async function confirmedTermination({ type = "dismissal_without_cause", terminationExtra = {} } = {}) {
  const employee = await createEmployee();
  for (const m of [7, 8, 9]) await paidMonth(employee, 2026, m, 900000);
  const draft = await db.EmployeeTermination.create({
    employee_id: employee.id, type, termination_date: "2026-10-20", notice_given: "none", status: "draft", ...terminationExtra,
  });
  const actor = await admin();
  expect((await as(actor).put(`/employee-terminations/${draft.id}/confirm`)).status).toBe(200);
  return { employee, termination: await db.EmployeeTermination.findByPk(draft.id), actor };
}

const generateFinal = (termination, actor) => as(actor).post(`/employee-terminations/${termination.id}/final-payroll`);
const agreementUrl = (termination) => `/employee-terminations/${termination.id}/agreement`;
const body = (extra = {}) => ({
  total_amount: 6000000,
  agreement_date: "2026-10-25",
  homologated: true,
  notes: "Homologado en SECLO",
  installments: [
    { due_date: "2026-11-30", amount: 2000000 },
    { due_date: "2026-12-30", amount: 2000000 },
    { due_date: "2027-01-30", amount: 2000000 },
  ],
  ...extra,
});
const lineKeys = (detail) => detail.final_payroll.lines.map((l) => l.item_key);

describe("POST /employee-terminations/:id/agreement", () => {
  it("crea el acuerdo con sus cuotas y saca la indemnización de la liquidación final en borrador", async () => {
    const { termination, actor } = await confirmedTermination();
    const before = await generateFinal(termination, actor);
    expect(lineKeys(before.body.data)).toEqual(expect.arrayContaining(["notice_pay", "severance"]));

    const res = await as(actor).post(agreementUrl(termination)).send(body());

    expect(res.status).toBe(201);
    const agreement = res.body.data.agreement;
    expect(agreement).toMatchObject({ total_amount: 6000000, homologated: true, status: "active", pending_total: 6000000, paid_total: 0 });
    expect(agreement.installments.map((i) => i.installment_number)).toEqual([1, 2, 3]);
    expect(lineKeys(res.body.data)).not.toEqual(expect.arrayContaining(["notice_pay"]));
    expect(lineKeys(res.body.data)).not.toEqual(expect.arrayContaining(["severance"]));
    expect(lineKeys(res.body.data)).toContain("wages");
    expect(res.body.data.final_payroll.indemnity_total).toBe(0);
  });

  it("ordena las cuotas por vencimiento y las numera", async () => {
    const { termination, actor } = await confirmedTermination();

    const res = await as(actor).post(agreementUrl(termination)).send(body({
      installments: [
        { due_date: "2027-01-30", amount: 1000000 },
        { due_date: "2026-11-30", amount: 5000000 },
      ],
    }));

    expect(res.status).toBe(201);
    expect(res.body.data.agreement.installments.map((i) => [i.installment_number, i.due_date])).toEqual([[1, "2026-11-30"], [2, "2027-01-30"]]);
  });

  it("exige que las cuotas sumen el total, montos positivos, fechas válidas y al menos una cuota", async () => {
    const { termination, actor } = await confirmedTermination();
    const post = (b) => as(actor).post(agreementUrl(termination)).send(b);

    expect((await post(body({ total_amount: 5000000 }))).body.error).toMatch(/tienen que coincidir/);
    expect((await post(body({ installments: [] }))).status).toBe(400);
    expect((await post(body({ installments: [{ due_date: "2026-11-30", amount: 0 }, { due_date: "2026-12-30", amount: 6000000 }] }))).status).toBe(400);
    expect((await post(body({ installments: [{ due_date: "30/11/2026", amount: 6000000 }] }))).status).toBe(400);
    expect((await post(body({ total_amount: 0 }))).status).toBe(400);
    expect((await post(body({ agreement_date: "" }))).status).toBe(400);
    expect(await db.TerminationAgreement.count()).toBe(0);
  });

  it("rechaza un segundo acuerdo activo", async () => {
    const { termination, actor } = await confirmedTermination();
    await as(actor).post(agreementUrl(termination)).send(body());

    const res = await as(actor).post(agreementUrl(termination)).send(body());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ya tiene un acuerdo/);
  });

  it("exige el egreso confirmado", async () => {
    const employee = await createEmployee();
    const draft = await db.EmployeeTermination.create({ employee_id: employee.id, type: "dismissal_without_cause", termination_date: "2026-10-20", status: "draft" });

    const res = await as(await admin()).post(agreementUrl(draft)).send(body());

    expect(res.status).toBe(400);
  });

  it("no se puede pactar en cuotas una indemnización que ya se liquidó contado en la final confirmada", async () => {
    const { termination, actor } = await confirmedTermination();
    const gen = await generateFinal(termination, actor);
    await as(actor).put(`/payroll/${gen.body.data.final_payroll.id}/confirm`);

    const res = await as(actor).post(agreementUrl(termination)).send(body());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contado/);
  });

  it("un reclamo posterior a un despido con causa ya liquidado reabre el egreso hasta pagar las cuotas", async () => {
    const { termination, actor } = await confirmedTermination({ type: "dismissal_with_cause", terminationExtra: { cause_description: "Abandono" } });
    const gen = await generateFinal(termination, actor);
    const entryId = gen.body.data.final_payroll.id;
    await as(actor).put(`/payroll/${entryId}/confirm`);
    await as(actor).put(`/payroll/${entryId}/pay`);
    expect((await db.EmployeeTermination.findByPk(termination.id)).status).toBe("settled");

    const res = await as(actor).post(agreementUrl(termination)).send(body({ total_amount: 1000000, installments: [{ due_date: "2027-01-30", amount: 1000000 }] }));

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("confirmed");
    await as(actor).put(`${agreementUrl(termination)}/installments/1/pay`).field("payment_method", "transferencia");
    expect((await db.EmployeeTermination.findByPk(termination.id)).status).toBe("settled");
  });

  it("exige termination_agreements_write y ver sueldos", async () => {
    const { termination } = await confirmedTermination();
    const sinPermiso = await createActor({ permissions: ["employee_salaries_read"] });
    const sinSueldos = await createActor({ permissions: ["termination_agreements_write"] });
    const ok = await createActor({ permissions: ["termination_agreements_write", "employee_salaries_read"] });

    expect((await as(sinPermiso).post(agreementUrl(termination)).send(body())).status).toBe(401);
    expect((await as(sinSueldos).post(agreementUrl(termination)).send(body())).status).toBe(401);
    expect((await as(ok).post(agreementUrl(termination)).send(body())).status).toBe(201);
  });
});

describe("el cálculo con acuerdo", () => {
  it("la indemnización queda como referencia y no suma al bruto", async () => {
    const { termination, actor } = await confirmedTermination();
    await as(actor).post(agreementUrl(termination)).send(body());

    const res = await as(actor).get(`/employee-terminations/${termination.id}/calculation`);

    const sev = res.body.data.items.find((i) => i.key === "severance");
    expect(sev.reference_only).toBe(true);
    expect(res.body.data.indemnity_total).toBe(0);
    expect(res.body.data.agreement).toMatchObject({ total_amount: 6000000 });
  });

  it("en el mutuo acuerdo la gratificación pactada es el total del acuerdo y no va en la final", async () => {
    const { termination, actor } = await confirmedTermination({ type: "mutual_agreement" });
    const before = await generateFinal(termination, actor);
    expect(lineKeys(before.body.data)).toContain("severance_agreed");

    const res = await as(actor).post(agreementUrl(termination)).send(body());

    expect(lineKeys(res.body.data)).not.toContain("severance_agreed");
    const calc = await as(actor).get(`/employee-terminations/${termination.id}/calculation`);
    const agreed = calc.body.data.items.find((i) => i.key === "severance_agreed");
    expect(agreed).toMatchObject({ amount: 6000000, reference_only: true, applies: true });
  });
});

describe("PUT /employee-terminations/:id/agreement (editar)", () => {
  it("cambia el plan mientras no haya cuotas pagadas", async () => {
    const { termination, actor } = await confirmedTermination();
    await as(actor).post(agreementUrl(termination)).send(body());

    const res = await as(actor).put(agreementUrl(termination)).send(body({
      total_amount: 3000000, homologated: false,
      installments: [{ due_date: "2026-12-15", amount: 1500000 }, { due_date: "2027-01-15", amount: 1500000 }],
    }));

    expect(res.status).toBe(200);
    expect(res.body.data.agreement).toMatchObject({ total_amount: 3000000, homologated: false });
    expect(res.body.data.agreement.installments).toHaveLength(2);
    expect(await db.TerminationAgreementInstallment.count()).toBe(2);
  });

  it("no se puede editar con cuotas pagadas", async () => {
    const { termination, actor } = await confirmedTermination();
    await as(actor).post(agreementUrl(termination)).send(body());
    await as(actor).put(`${agreementUrl(termination)}/installments/1/pay`).field("payment_method", "efectivo");

    const res = await as(actor).put(agreementUrl(termination)).send(body());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cuotas pagadas/);
  });
});

describe("PUT /employee-terminations/:id/agreement/cancel", () => {
  it("exige motivo y devuelve la indemnización a la liquidación final en borrador", async () => {
    const { termination, actor } = await confirmedTermination();
    await generateFinal(termination, actor);
    await as(actor).post(agreementUrl(termination)).send(body());
    const url = `${agreementUrl(termination)}/cancel`;

    expect((await as(actor).put(url).send({})).status).toBe(400);
    const res = await as(actor).put(url).send({ reason: "No se llegó a un acuerdo" });

    expect(res.status).toBe(200);
    expect(res.body.data.agreement).toBeNull();
    expect(lineKeys(res.body.data)).toEqual(expect.arrayContaining(["notice_pay", "severance"]));
    expect((await db.TerminationAgreement.findOne({ where: { termination_id: termination.id } })).status).toBe("cancelled");
  });

  it("no se anula con cuotas pagadas", async () => {
    const { termination, actor } = await confirmedTermination();
    await as(actor).post(agreementUrl(termination)).send(body());
    await as(actor).put(`${agreementUrl(termination)}/installments/1/pay`).field("payment_method", "efectivo");

    const res = await as(actor).put(`${agreementUrl(termination)}/cancel`).send({ reason: "x" });

    expect(res.status).toBe(400);
  });

  it("después de anular se puede pactar uno nuevo", async () => {
    const { termination, actor } = await confirmedTermination();
    await as(actor).post(agreementUrl(termination)).send(body());
    await as(actor).put(`${agreementUrl(termination)}/cancel`).send({ reason: "Cambió el monto" });

    const res = await as(actor).post(agreementUrl(termination)).send(body({ total_amount: 1000000, installments: [{ due_date: "2027-02-01", amount: 1000000 }] }));

    expect(res.status).toBe(201);
  });
});

describe("PUT /employee-terminations/:id/agreement/installments/:number/pay", () => {
  const setup = async (type) => {
    const ctx = await confirmedTermination(type ? { type } : {});
    await as(ctx.actor).post(agreementUrl(ctx.termination)).send(body());
    return ctx;
  };
  const pay = (ctx, number) => as(ctx.actor).put(`${agreementUrl(ctx.termination)}/installments/${number}/pay`);

  it("marca la cuota como pagada con medio de pago, fecha y comprobante", async () => {
    const ctx = await setup();

    const res = await pay(ctx, 1)
      .field("payment_method", "transferencia")
      .field("paid_at", "2026-11-28")
      .attach("file", Buffer.from("pdf"), "comprobante.pdf");

    expect(res.status).toBe(200);
    const inst = res.body.data.agreement.installments[0];
    expect(inst).toMatchObject({ paid_at: "2026-11-28", payment_method: "transferencia", payment_proof_name: "comprobante.pdf" });
    expect(res.body.data.agreement).toMatchObject({ paid_total: 2000000, pending_total: 4000000 });
    expect((await db.AuditLog.findOne({ where: { entity_type: "TerminationAgreementInstallment", entity_id: inst.id } })).amount).toBeDefined();
  });

  it("exige el medio de pago y no permite pagar dos veces la misma cuota", async () => {
    const ctx = await setup();

    expect((await pay(ctx, 1)).status).toBe(400);
    expect((await pay(ctx, 1).field("payment_method", "efectivo")).status).toBe(200);
    const again = await pay(ctx, 1).field("payment_method", "efectivo");
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/ya está pagada/);
    expect((await pay(ctx, 9).field("payment_method", "efectivo")).status).toBe(404);
  });

  it("el egreso se liquida con la última cuota si la final ya está pagada", async () => {
    const ctx = await setup();
    const gen = await generateFinal(ctx.termination, ctx.actor);
    const entryId = gen.body.data.final_payroll.id;
    await as(ctx.actor).put(`/payroll/${entryId}/confirm`);
    await as(ctx.actor).put(`/payroll/${entryId}/pay`);
    expect((await db.EmployeeTermination.findByPk(ctx.termination.id)).status).toBe("confirmed"); // faltan las cuotas

    await pay(ctx, 1).field("payment_method", "efectivo");
    await pay(ctx, 2).field("payment_method", "efectivo");
    expect((await db.EmployeeTermination.findByPk(ctx.termination.id)).status).toBe("confirmed");
    const last = await pay(ctx, 3).field("payment_method", "efectivo");

    expect(last.status).toBe(200);
    expect(last.body.data.status).toBe("settled");
  });

  it("con todas las cuotas pagadas pero la final sin pagar, el egreso sigue confirmado y se liquida al pagar la final", async () => {
    const ctx = await setup();
    const gen = await generateFinal(ctx.termination, ctx.actor);
    const entryId = gen.body.data.final_payroll.id;
    for (const n of [1, 2, 3]) await pay(ctx, n).field("payment_method", "efectivo");
    expect((await db.EmployeeTermination.findByPk(ctx.termination.id)).status).toBe("confirmed");

    await as(ctx.actor).put(`/payroll/${entryId}/confirm`);
    await as(ctx.actor).put(`/payroll/${entryId}/pay`);

    expect((await db.EmployeeTermination.findByPk(ctx.termination.id)).status).toBe("settled");
  });
});

describe("GET /employee-terminations/agreement-alerts", () => {
  it("lista las cuotas vencidas sin pagar de acuerdos activos y nada más", async () => {
    const { termination, employee, actor } = await confirmedTermination();
    await as(actor).post(agreementUrl(termination)).send(body({
      total_amount: 3000000,
      installments: [
        { due_date: "2026-01-10", amount: 1000000 },
        { due_date: "2026-02-10", amount: 1000000 },
        { due_date: "2099-01-10", amount: 1000000 },
      ],
    }));
    await as(actor).put(`${agreementUrl(termination)}/installments/1/pay`).field("payment_method", "efectivo");

    const res = await as(actor).get("/employee-terminations/agreement-alerts");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      installment_number: 2, installments_total: 3, amount: 1000000, termination_id: termination.id, employee: { id: employee.id },
    });
    expect(res.body.data[0].days_overdue).toBeGreaterThan(0);
  });

  it("un acuerdo anulado no genera aviso", async () => {
    const { termination, actor } = await confirmedTermination();
    await as(actor).post(agreementUrl(termination)).send(body({ total_amount: 1000000, installments: [{ due_date: "2026-01-10", amount: 1000000 }] }));
    await as(actor).put(`${agreementUrl(termination)}/cancel`).send({ reason: "Anulado" });

    const res = await as(actor).get("/employee-terminations/agreement-alerts");

    expect(res.body.data).toHaveLength(0);
  });

  it("exige lectura de egresos y ver sueldos", async () => {
    const sinSueldos = await createActor({ permissions: ["employee_terminations_read"] });
    const sinLectura = await createActor({ permissions: ["employee_salaries_read"] });
    const ok = await createActor({ permissions: ["employee_terminations_read", "employee_salaries_read"] });

    expect((await as(sinSueldos).get("/employee-terminations/agreement-alerts")).status).toBe(401);
    expect((await as(sinLectura).get("/employee-terminations/agreement-alerts")).status).toBe(401);
    expect((await as(ok).get("/employee-terminations/agreement-alerts")).status).toBe(200);
  });
});

describe("Resumen de costos", () => {
  it("cada cuota entra en el mes en que se paga, no en el del egreso, y suma al gasto total", async () => {
    const { termination, actor } = await confirmedTermination();
    await as(actor).post(agreementUrl(termination)).send(body());
    await as(actor).put(`${agreementUrl(termination)}/installments/1/pay`).field("payment_method", "efectivo").field("paid_at", "2026-11-28");
    await as(actor).put(`${agreementUrl(termination)}/installments/2/pay`).field("payment_method", "efectivo").field("paid_at", "2026-12-28");

    const nov = await as(actor).get("/expense-summary/monthly?year=2026&month=11");
    const oct = await as(actor).get("/expense-summary/monthly?year=2026&month=10");

    expect(nov.body.expenses.termination_agreements).toMatchObject({ label: "Indemnizaciones / acuerdos", total: 2000000, count: 1 });
    expect(nov.body.grand_total).toBe(nov.body.expenses.payroll_gross.total + nov.body.expenses.employer_costs.total + 2000000);
    expect(oct.body.expenses.termination_agreements.total).toBe(0);

    const annual = await as(actor).get("/expense-summary/annual?year=2026");
    expect(annual.body.months[10].termination_agreements).toBe(2000000);
    expect(annual.body.months[11].termination_agreements).toBe(2000000);
    expect(annual.body.annual_totals.termination_agreements).toBe(4000000);
  });
});
