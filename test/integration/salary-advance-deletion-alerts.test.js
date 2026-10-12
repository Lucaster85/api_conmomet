"use strict";
// El aviso de adelantos pagados anulados (FLOWS.md §36). Cubre la forma del payload: el
// componente muestra "Anulado por X el <fecha>", y `underscored: true` deja el atributo del
// modelo en `createdAt`, así que sin normalizar en el controller ahí se veía "Invalid Date".
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

async function createAlert(deletedByUserId) {
  const n = Math.floor(Math.random() * 900000);
  const employee = await db.Employee.create({
    name: "Juan",
    lastname: "Pérez",
    dni: String(30000000 + n),
    cuil: String(20300000000 + n),
    hire_date: "2026-01-01",
    hourly_rate: 1000,
  });
  return db.SalaryAdvanceDeletionAlert.create({
    employee_id: employee.id,
    amount: 15000,
    payment_method: "efectivo",
    justification: "se duplicó la carga",
    deleted_by: deletedByUserId,
  });
}

describe("GET /salary-advance-deletion-alerts", () => {
  it("devuelve created_at parseable (el componente lo muestra como fecha)", async () => {
    const actor = await createActor({ permissions: ["salary_advance_deletion_alerts_read"] });
    await createAlert(actor.user.id);

    const res = await as(actor).get("/salary-advance-deletion-alerts");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].created_at).toBeTruthy();
    expect(Number.isNaN(new Date(res.body.data[0].created_at).getTime())).toBe(false);
  });

  // Desde FLOWS.md §36 el descarte lo resuelve el frontend contra UserAlertViews: si el backend
  // volviera a filtrar por dismissed_by, "mostrar los vistos" y "volver a mostrar todo" se
  // quedarían sin nada que mostrar.
  it("no filtra por dismissed_by: devuelve el aviso aunque el usuario ya lo haya descartado", async () => {
    const actor = await createActor({ permissions: ["salary_advance_deletion_alerts_read"] });
    const alert = await createAlert(actor.user.id);
    await alert.update({ dismissed_by: [actor.user.id] });

    const res = await as(actor).get("/salary-advance-deletion-alerts");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  // 401 y no 403: es lo que devuelve authPermission en este repo cuando falta el permiso, igual
  // que esperan budgets.editSession.test.js y budgets.history.test.js. (Que un permiso faltante
  // sea indistinguible de una sesión vencida es un problema conocido y aparte, ver PLAN_TESTS.md.)
  it("401 sin el permiso", async () => {
    const actor = await createActor();
    const res = await as(actor).get("/salary-advance-deletion-alerts");
    expect(res.status).toBe(401);
  });
});
