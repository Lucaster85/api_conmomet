"use strict";
// Saldo de vacaciones (GET /leave-requests/balance/:employeeId), FLOWS.md §55. Lo nuevo es que el
// que ingresó este año no tiene los 14 días desde el primer día: con menos de la mitad de los días
// hábiles del año trabajados, le corresponde 1 día cada 20 (LCT arts. 151 y 153). Como la ley evalúa
// al 31/12, el resultado no depende de qué día se corre el test. Requiere la columna
// SystemSettings.work_week (migración 20261112100001).
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

const YEAR = new Date().getFullYear();
let counter = 0;

const createEmployee = (overrides = {}) => {
  counter += 1;
  return db.Employee.create({
    name: "Ana",
    lastname: `Vac${counter}`,
    dni: String(31000000 + counter),
    cuil: String(20310000000 + counter),
    hire_date: `${YEAR - 3}-03-01`,
    hourly_rate: 1000,
    ...overrides,
  });
};

const balanceOf = async (actor, employee) => {
  const res = await as(actor).get(`/leave-requests/balance/${employee.id}`);
  expect(res.status).toBe(200);
  return res.body.data;
};

describe("GET /leave-requests/balance/:employeeId", () => {
  it("un empleado de años atrás tiene los días completos por antigüedad", async () => {
    const actor = await createActor({ permissions: ["leave_requests_read"] });
    const employee = await createEmployee({ hire_date: `${YEAR - 8}-03-01` });

    const data = await balanceOf(actor, employee);

    expect(data.corresponding_days).toBe(21);
    expect(data.entitlement.is_proportional).toBe(false);
  });

  it("el que ingresó este año a fin de año tiene 1 día cada 20 trabajados", async () => {
    const actor = await createActor({ permissions: ["leave_requests_read"] });
    const employee = await createEmployee({ hire_date: `${YEAR}-11-02` });

    const data = await balanceOf(actor, employee);

    expect(data.entitlement.is_proportional).toBe(true);
    expect(data.entitlement.full_days).toBe(14);
    expect(data.corresponding_days).toBe(Math.floor(data.entitlement.worked_days / 20));
    expect(data.corresponding_days).toBeLessThan(14);
  });

  it("el que ingresó este año al principio ya tiene los 14 días", async () => {
    const actor = await createActor({ permissions: ["leave_requests_read"] });
    const employee = await createEmployee({ hire_date: `${YEAR}-01-02` });

    const data = await balanceOf(actor, employee);

    expect(data.corresponding_days).toBe(14);
    expect(data.entitlement.is_proportional).toBe(false);
  });

  it("el valor cargado a mano en el legajo manda sobre el proporcional", async () => {
    const actor = await createActor({ permissions: ["leave_requests_read"] });
    const employee = await createEmployee({ hire_date: `${YEAR}-11-02`, vacation_days_override: 10 });

    const data = await balanceOf(actor, employee);

    expect(data.corresponding_days).toBe(10);
    expect(data.entitlement.is_override).toBe(true);
    expect(data.entitlement.is_proportional).toBe(false);
  });

  it("el valor a mano también puede ser 0", async () => {
    const actor = await createActor({ permissions: ["leave_requests_read"] });
    const employee = await createEmployee({ vacation_days_override: 0 });

    const data = await balanceOf(actor, employee);

    expect(data.corresponding_days).toBe(0);
  });

  it("las faltas injustificadas del año de ingreso restan días trabajados", async () => {
    const actor = await createActor({ permissions: ["leave_requests_read"] });
    const employee = await createEmployee({ hire_date: `${YEAR}-11-02` });
    const before = await balanceOf(actor, employee);

    await db.Attendance.create({ employee_id: employee.id, date: `${YEAR}-11-05`, status: "absent" });
    await db.Attendance.create({ employee_id: employee.id, date: `${YEAR}-11-06`, status: "absent" });
    const after = await balanceOf(actor, employee);

    expect(after.entitlement.worked_days).toBe(before.entitlement.worked_days - 2);
  });

  it("de lunes a viernes cuenta menos días hábiles que de lunes a sábado", async () => {
    const actor = await createActor({ permissions: ["leave_requests_read"] });
    const employee = await createEmployee({ hire_date: `${YEAR}-11-02` });
    await db.SystemSetting.update({ work_week: "mon_sat" }, { where: { id: 1 } });
    const monSat = await balanceOf(actor, employee);

    await db.SystemSetting.update({ work_week: "mon_fri" }, { where: { id: 1 } });
    const monFri = await balanceOf(actor, employee);
    await db.SystemSetting.update({ work_week: "mon_sat" }, { where: { id: 1 } });

    expect(monFri.entitlement.worked_days).toBeLessThan(monSat.entitlement.worked_days);
  });

  it("descuenta del saldo las vacaciones aprobadas del año", async () => {
    const actor = await createActor({ permissions: ["leave_requests_read"] });
    const employee = await createEmployee({ hire_date: `${YEAR - 8}-03-01` });
    await db.LeaveRequest.create({
      employee_id: employee.id, leave_type: "vacation", status: "approved",
      start_date: `${YEAR}-02-02`, end_date: `${YEAR}-02-08`, total_days: 7,
    });

    const data = await balanceOf(actor, employee);

    expect(data.used_days).toBe(7);
    expect(data.balance).toBe(14);
  });

  it("rechaza sin leave_requests_read", async () => {
    const actor = await createActor();
    const employee = await createEmployee();

    const res = await as(actor).get(`/leave-requests/balance/${employee.id}`);

    expect(res.status).toBe(401); // authPermission responde 401 ("forbidden") cuando falta el permiso
  });

  it("permite al admin (admin_granted)", async () => {
    const actor = await createActor({ role: "admin" });
    const employee = await createEmployee();

    const res = await as(actor).get(`/leave-requests/balance/${employee.id}`);

    expect(res.status).toBe(200);
  });
});

describe("PUT /system-settings (semana laboral)", () => {
  it("guarda mon_fri y rechaza un valor inválido", async () => {
    const actor = await createActor({ role: "admin" });

    const ok = await as(actor).put("/system-settings").send({ work_week: "mon_fri" });
    const bad = await as(actor).put("/system-settings").send({ work_week: "todos" });
    await as(actor).put("/system-settings").send({ work_week: "mon_sat" });

    expect(ok.status).toBe(200);
    expect(ok.body.data.work_week).toBe("mon_fri");
    expect(bad.status).toBe(400);
  });
});
