"use strict";
// Un empleado nunca se elimina (se da de baja con un egreso, PLAN_EGRESOS.md): la ruta DELETE no existe,
// ni siquiera para admin_granted, y el empleado sigue ahí con todo su historial.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

describe("DELETE /employees/:id", () => {
  it("no existe: responde 404 aun con admin_granted y no borra al empleado", async () => {
    const employee = await db.Employee.create({
      name: "Juan", lastname: "Pérez", dni: "30111222", cuil: "20301112229", hire_date: "2024-01-01", hourly_rate: 1000,
    });
    const admin = await createActor({ role: "admin" });
    const withPermission = await createActor({ permissions: ["employees_delete"] });

    expect((await as(admin).delete(`/employees/${employee.id}`)).status).toBe(404);
    expect((await as(withPermission).delete(`/employees/${employee.id}`)).status).toBe(404);
    expect(await db.Employee.findByPk(employee.id)).not.toBeNull();
  });
});
