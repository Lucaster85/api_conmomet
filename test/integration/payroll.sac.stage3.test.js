"use strict";
// Etapa 3 del SAC (PLAN_SAC.md §9): diferencias de aguinaldo en `generate`.
//  - disparador "siguiente liquidación" (§5.2): 1Q de julio/enero (2Q para mensualizados)
//  - disparador "retroactivo de un semestre ya liquidado" (§5.3)
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

const quincenaCache = {};
async function quincena(year, month, type) {
  const key = `${year}-${month}-${type}`;
  if (quincenaCache[key]) return db.PayPeriod.findByPk(quincenaCache[key]);
  const first = type === "first_half";
  const mm = String(month).padStart(2, "0");
  const period = await db.PayPeriod.create({
    start_date: `${year}-${mm}-${first ? "01" : "16"}`,
    end_date: `${year}-${mm}-${first ? "15" : "28"}`,
    type, month, year,
  });
  quincenaCache[key] = period.id;
  return period;
}
beforeEach(() => { for (const k of Object.keys(quincenaCache)) delete quincenaCache[k]; });

async function entry(employee, period, gross, status = "confirmed", { lineLabel } = {}) {
  const e = await db.PayrollEntry.create({
    employee_id: employee.id, pay_period_id: period.id, status,
    regular_amount: gross, overtime_50_amount: 0, overtime_100_amount: 0,
    gross_amount: gross, net_amount: gross, advances_deducted: 0, loan_installments_deducted: 0,
  });
  if (lineLabel) {
    await db.PayrollLine.create({ payroll_entry_id: e.id, label: lineLabel, quantity: 1, rate: gross, subtotal: gross, line_type: "regular" });
  }
  return e;
}

// SAC del 1er semestre 2026 ya liquidado (confirmed/paid) por `amount`.
async function liquidatedSac(employee, amount, status = "paid") {
  const sacPeriod = await db.PayPeriod.create({ start_date: "2026-01-01", end_date: "2026-06-30", type: "sac", month: 6, year: 2026 });
  const e = await entry(employee, sacPeriod, amount, status);
  await db.PayrollLine.create({ payroll_entry_id: e.id, label: "SAC 1er semestre 2026", quantity: 1, rate: amount, subtotal: amount, line_type: "sac" });
  return { sacPeriod, sacEntry: e };
}

const generate = (actor, period) => as(actor).post(`/payroll/${period.id}/generate`).send({});
const adjustmentLines = (entryId) => db.PayrollLine.findAll({ where: { payroll_entry_id: entryId, line_type: "sac_adjustment" } });
const entryOf = (employee, period) => db.PayrollEntry.findOne({ where: { employee_id: employee.id, pay_period_id: period.id } });

describe("diferencia de SAC en la siguiente liquidación (§5.2)", () => {
  it("la 1Q de julio de un jornalizado suma la diferencia cuando junio terminó siendo el mejor mes", async () => {
    const emp = await createEmployee();
    await entry(emp, await quincena(2026, 6, "first_half"), 400000);
    await entry(emp, await quincena(2026, 6, "second_half"), 500000); // mejor mes: 900000
    const { sacPeriod } = await liquidatedSac(emp, 400000); // se liquidó antes de que cerrara junio
    const july1 = await quincena(2026, 7, "first_half");
    const actor = await createActor({ role: "admin" });

    const res = await generate(actor, july1);
    expect(res.status).toBe(201);

    const e = await entryOf(emp, july1);
    const lines = await adjustmentLines(e.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ label: "Diferencia SAC 1er sem. 2026", source_period_id: sacPeriod.id });
    expect(Number(lines[0].subtotal)).toBe(50000); // 900000 / 2 - 400000
    expect(Number(e.gross_amount)).toBe(50000);
    expect(Number(e.net_amount)).toBe(50000);
  });

  it("es idempotente: regenerar en borrador deja una sola línea con el mismo monto", async () => {
    const emp = await createEmployee();
    await entry(emp, await quincena(2026, 6, "second_half"), 900000);
    await liquidatedSac(emp, 400000);
    const july1 = await quincena(2026, 7, "first_half");
    const actor = await createActor({ role: "admin" });

    await generate(actor, july1);
    await generate(actor, july1);

    const e = await entryOf(emp, july1);
    const lines = await adjustmentLines(e.id);
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].subtotal)).toBe(50000);
    expect(Number(e.gross_amount)).toBe(50000);
  });

  it("si el SAC liquidado ya era correcto no se hace nada", async () => {
    const emp = await createEmployee();
    await entry(emp, await quincena(2026, 6, "second_half"), 900000);
    await liquidatedSac(emp, 450000);
    const july1 = await quincena(2026, 7, "first_half");
    const actor = await createActor({ role: "admin" });

    await generate(actor, july1);
    const e = await entryOf(emp, july1);
    expect(await adjustmentLines(e.id)).toHaveLength(0);
  });

  it("si el SAC se liquidó de más no genera nada (solo a favor del empleado)", async () => {
    const emp = await createEmployee();
    await entry(emp, await quincena(2026, 6, "second_half"), 900000);
    await liquidatedSac(emp, 500000);
    const july1 = await quincena(2026, 7, "first_half");
    const actor = await createActor({ role: "admin" });

    await generate(actor, july1);
    const e = await entryOf(emp, july1);
    expect(await adjustmentLines(e.id)).toHaveLength(0);
  });

  it("descuenta las diferencias que ya se habían cargado de ese SAC", async () => {
    const emp = await createEmployee();
    await entry(emp, await quincena(2026, 6, "second_half"), 900000);
    const { sacPeriod } = await liquidatedSac(emp, 400000);
    // Ya se pagaron 20000 de diferencia en otra liquidación
    const earlier = await entry(emp, await quincena(2026, 5, "first_half"), 20000, "paid");
    await db.PayrollLine.create({
      payroll_entry_id: earlier.id, label: "Diferencia SAC 1er sem. 2026", quantity: 1, rate: 20000, subtotal: 20000,
      line_type: "sac_adjustment", source_period_id: sacPeriod.id,
    });
    const july1 = await quincena(2026, 7, "first_half");
    const actor = await createActor({ role: "admin" });

    await generate(actor, july1);
    const lines = await adjustmentLines((await entryOf(emp, july1)).id);
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].subtotal)).toBe(30000); // 450000 - 400000 - 20000
  });

  it("un SAC todavía en borrador no genera diferencia: se regenera, no se ajusta", async () => {
    const emp = await createEmployee();
    await entry(emp, await quincena(2026, 6, "second_half"), 900000);
    await liquidatedSac(emp, 400000, "draft");
    const july1 = await quincena(2026, 7, "first_half");
    const actor = await createActor({ role: "admin" });

    await generate(actor, july1);
    expect(await adjustmentLines((await entryOf(emp, july1)).id)).toHaveLength(0);
  });

  it("sin período SAC en ese semestre no hay diferencia", async () => {
    const emp = await createEmployee();
    await entry(emp, await quincena(2026, 6, "second_half"), 900000);
    const july1 = await quincena(2026, 7, "first_half");
    const actor = await createActor({ role: "admin" });

    await generate(actor, july1);
    expect(await adjustmentLines((await entryOf(emp, july1)).id)).toHaveLength(0);
  });

  it("para un jornalizado solo la 1Q dispara el cálculo, no la 2Q de julio", async () => {
    const emp = await createEmployee();
    await entry(emp, await quincena(2026, 6, "second_half"), 900000);
    await liquidatedSac(emp, 400000);
    const july2 = await quincena(2026, 7, "second_half");
    const actor = await createActor({ role: "admin" });

    await generate(actor, july2);
    expect(await adjustmentLines((await entryOf(emp, july2)).id)).toHaveLength(0);
  });

  it("para un mensualizado la diferencia sale en la 2Q de julio", async () => {
    const emp = await createEmployee({ pay_type: "monthly", monthly_salary: 900000 });
    await entry(emp, await quincena(2026, 6, "second_half"), 900000);
    await liquidatedSac(emp, 400000);
    const july2 = await quincena(2026, 7, "second_half");
    const actor = await createActor({ role: "admin" });

    await generate(actor, july2);
    const lines = await adjustmentLines((await entryOf(emp, july2)).id);
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].subtotal)).toBe(50000);
  });

  it("la 1Q de enero revisa el 2do semestre del año anterior", async () => {
    const emp = await createEmployee();
    await entry(emp, await quincena(2026, 12, "second_half"), 1000000);
    const sacPeriod = await db.PayPeriod.create({ start_date: "2026-07-01", end_date: "2026-12-31", type: "sac", month: 12, year: 2026 });
    const sacEntry = await entry(emp, sacPeriod, 300000, "paid");
    await db.PayrollLine.create({ payroll_entry_id: sacEntry.id, label: "SAC 2do semestre 2026", quantity: 1, rate: 300000, subtotal: 300000, line_type: "sac" });
    const january1 = await quincena(2027, 1, "first_half");
    const actor = await createActor({ role: "admin" });

    await generate(actor, january1);
    const lines = await adjustmentLines((await entryOf(emp, january1)).id);
    expect(lines).toHaveLength(1);
    expect(lines[0].label).toBe("Diferencia SAC 2do sem. 2026");
    expect(Number(lines[0].subtotal)).toBe(200000);
  });

  it("la diferencia del aguinaldo no integra la base del propio aguinaldo", async () => {
    const emp = await createEmployee();
    const july1 = await quincena(2026, 7, "first_half");
    await entry(emp, await quincena(2026, 6, "second_half"), 900000);
    await liquidatedSac(emp, 400000);
    const actor = await createActor({ role: "admin" });
    await generate(actor, july1);

    // Confirmada la liquidación con la diferencia, el SAC recalculado sigue siendo el mismo
    const e = await entryOf(emp, july1);
    await e.update({ status: "confirmed" });
    const { loadSemesterEntries, computeEmployeeSac } = require("../../services/sacService");
    const entries = (await loadSemesterEntries({ year: 2026, semester: 1, employeeIds: [emp.id] })).get(emp.id);
    expect(computeEmployeeSac({ entries, hireDate: emp.hire_date, year: 2026, semester: 1 }).amount).toBe(450000);
  });
});

describe("diferencia de SAC por un retroactivo de un semestre ya liquidado (§5.3)", () => {
  it("un retroactivo a abril aplicado en la 1Q de agosto reabre el SAC y suma la diferencia", async () => {
    const guild = await db.Guild.create({ name: "UOM", code: "UOM", is_active: true });
    const category = await db.Category.create({ name: "Oficial", guild_hourly_rate: 1000, guild_id: guild.id });
    const emp = await createEmployee({ category_id: category.id });

    const april = await quincena(2026, 4, "second_half");
    const june = await quincena(2026, 6, "second_half");
    await entry(emp, april, 1000000, "paid", { lineLabel: "Horas abril" });
    await entry(emp, june, 900000, "paid", { lineLabel: "Horas junio" });
    const { sacPeriod } = await liquidatedSac(emp, 500000); // mejor mes: abril (1000000)

    const august1 = await quincena(2026, 8, "first_half");
    await db.RateChange.create({
      guild_id: guild.id, concept_id: null, percentage: 10,
      applies_from_period: april.id, applied_in_period: august1.id, status: "pending",
    });
    const actor = await createActor({ role: "admin" });

    const res = await generate(actor, august1);
    expect(res.status).toBe(201);

    const e = await entryOf(emp, august1);
    const retro = await db.PayrollLine.findAll({ where: { payroll_entry_id: e.id, line_type: "retroactive" } });
    expect(retro.length).toBeGreaterThan(0);

    const lines = await adjustmentLines(e.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ label: "Diferencia SAC 1er sem. 2026", source_period_id: sacPeriod.id });
    // Abril pasa de 1.000.000 a 1.100.000 (+10%): 1100000 / 2 - 500000
    expect(Number(lines[0].subtotal)).toBe(50000);
    // El bruto incluye el retroactivo (100000 + 90000) y la diferencia del SAC
    expect(Number(e.gross_amount)).toBe(240000);

    // Regenerar no duplica
    await generate(actor, august1);
    expect(await adjustmentLines(e.id)).toHaveLength(1);
  });

  it("si el SAC liquidado ya incluía el retroactivo no genera diferencia", async () => {
    const guild = await db.Guild.create({ name: "UOM", code: "UOM", is_active: true });
    const category = await db.Category.create({ name: "Oficial", guild_hourly_rate: 1000, guild_id: guild.id });
    const emp = await createEmployee({ category_id: category.id });

    const april = await quincena(2026, 4, "second_half");
    const june = await quincena(2026, 6, "second_half");
    await entry(emp, april, 1000000, "paid", { lineLabel: "Horas abril" });
    await entry(emp, june, 900000, "paid", { lineLabel: "Horas junio" });
    await liquidatedSac(emp, 550000); // ya con abril en 1.100.000

    const august1 = await quincena(2026, 8, "first_half");
    await db.RateChange.create({
      guild_id: guild.id, concept_id: null, percentage: 10,
      applies_from_period: april.id, applied_in_period: august1.id, status: "pending",
    });
    const actor = await createActor({ role: "admin" });

    await generate(actor, august1);
    const e = await entryOf(emp, august1);
    expect(await adjustmentLines(e.id)).toHaveLength(0);
    expect(Number(e.gross_amount)).toBe(190000); // solo los retroactivos
  });
});

describe("diferencias de SAC — casos de borde de generate", () => {
  it("un aumento general no genera retroactivo sobre la línea de diferencia de SAC ya pagada", async () => {
    const guild = await db.Guild.create({ name: "UOM", code: "UOM", is_active: true });
    const category = await db.Category.create({ name: "Oficial", guild_hourly_rate: 1000, guild_id: guild.id });
    const emp = await createEmployee({ category_id: category.id });
    await entry(emp, await quincena(2026, 6, "second_half"), 900000);
    await liquidatedSac(emp, 400000);
    const july1 = await quincena(2026, 7, "first_half");
    const july2 = await quincena(2026, 7, "second_half");
    const actor = await createActor({ role: "admin" });
    await generate(actor, july1);
    expect(await adjustmentLines((await entryOf(emp, july1)).id)).toHaveLength(1);

    await db.RateChange.create({
      guild_id: guild.id, concept_id: null, percentage: 10,
      applies_from_period: july1.id, applied_in_period: july2.id, status: "pending",
    });
    const res = await generate(actor, july2);
    expect(res.status).toBe(201);

    const e = await entryOf(emp, july2);
    const retro = await db.PayrollLine.findAll({ where: { payroll_entry_id: e.id, line_type: "retroactive" } });
    expect(retro).toHaveLength(0);
    expect(Number(e.gross_amount)).toBe(0);
  });

  it("los premios de la liquidación en curso se cuentan: no remunerativos se excluyen y remunerativos suman", async () => {
    const guild = await db.Guild.create({ name: "UOM", code: "UOM", is_active: true });
    const category = await db.Category.create({ name: "Oficial", guild_hourly_rate: 1000, guild_id: guild.id });
    const emp = await createEmployee({ category_id: category.id });

    const june1 = await quincena(2026, 6, "first_half");
    const june2 = await quincena(2026, 6, "second_half");
    await entry(emp, june1, 1000000, "paid", { lineLabel: "Horas junio 1Q" });
    const { sacPeriod } = await liquidatedSac(emp, 500000);

    // La 2Q de junio sigue en borrador, con un premio no remunerativo y uno remunerativo
    const draft = await entry(emp, june2, 0, "draft");
    await db.PayrollAdjustment.create({ payroll_entry_id: draft.id, label: "Viáticos", amount: 100000, type: "bonus", is_remunerative: false });
    await db.PayrollAdjustment.create({ payroll_entry_id: draft.id, label: "Premio", amount: 200000, type: "bonus", is_remunerative: true });
    await db.RateChange.create({
      guild_id: guild.id, concept_id: null, percentage: 10,
      applies_from_period: june1.id, applied_in_period: june2.id, status: "pending",
    });
    const actor = await createActor({ role: "admin" });

    const res = await generate(actor, june2);
    expect(res.status).toBe(201);

    const lines = await adjustmentLines(draft.id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ source_period_id: sacPeriod.id });
    // Junio: 1.000.000 + premio remunerativo 200.000 + retroactivo re-imputado 100.000 = 1.300.000
    expect(Number(lines[0].subtotal)).toBe(150000); // 1300000 / 2 - 500000
  });
});

describe("GET /payroll/:id de un período sac — diferencias", () => {
  it("muestra en qué quincena se pagó la diferencia y no marca pendiente lo ya cargado", async () => {
    const emp = await createEmployee();
    await entry(emp, await quincena(2026, 6, "second_half"), 900000);
    const { sacPeriod } = await liquidatedSac(emp, 400000);
    const july1 = await quincena(2026, 7, "first_half");
    const actor = await createActor({ role: "admin" });
    await generate(actor, july1);

    const res = await as(actor).get(`/payroll/${sacPeriod.id}`);
    expect(res.status).toBe(200);
    const diff = res.body.data[0].sac_difference;
    expect(diff.adjustments_total).toBe(50000);
    expect(diff.adjustments).toHaveLength(1);
    expect(diff.adjustments[0].period).toMatchObject({ month: 7, year: 2026, type: "first_half" });
    expect(diff.pending).toBe(0);
  });

  it("marca como pendiente la diferencia que todavía no se cargó en ninguna liquidación", async () => {
    const emp = await createEmployee();
    await entry(emp, await quincena(2026, 6, "second_half"), 900000);
    const { sacPeriod } = await liquidatedSac(emp, 400000);
    const actor = await createActor({ role: "admin" });

    const res = await as(actor).get(`/payroll/${sacPeriod.id}`);
    expect(res.body.data[0].sac_difference).toMatchObject({ adjustments_total: 0, pending: 50000 });
  });
});
