"use strict";
// Domicilio comercial fiscal del cliente (PLAN_ARCA.md §4): opcional, sale en el bloque del receptor de la factura.
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

const base = { razonSocial: "Bunge Argentina S.A.", email: "compras@bunge.test" };

describe("clientes — domicilio fiscal", () => {
  it("se guarda al crear, con los espacios recortados", async () => {
    const actor = await createActor({ permissions: ["clients_write"] });
    const res = await as(actor).post("/clients").send({ ...base, fiscal_street: "  Ruta 8 km 500  ", fiscal_locality: "Tancacha", fiscal_province: "Córdoba" });
    expect(res.status).toBe(200);
    const saved = await db.Client.findByPk(res.body.client.id);
    expect(saved).toMatchObject({ fiscal_street: "Ruta 8 km 500", fiscal_locality: "Tancacha", fiscal_province: "Córdoba" });
  });

  it("es opcional: un cliente sin domicilio queda con null", async () => {
    const actor = await createActor({ permissions: ["clients_write"] });
    const res = await as(actor).post("/clients").send(base);
    const saved = await db.Client.findByPk(res.body.client.id);
    expect(saved.fiscal_street).toBeNull();
    expect(saved.fiscal_locality).toBeNull();
  });

  it("una actualización parcial no borra el domicilio, y un valor vacío lo limpia", async () => {
    const actor = await createActor({ permissions: ["clients_write", "clients_update"] });
    const created = await as(actor).post("/clients").send({ ...base, fiscal_street: "Ruta 8", fiscal_locality: "Tancacha", fiscal_province: "Córdoba" });
    const id = created.body.client.id;

    await as(actor).put(`/clients/${id}`).send({ is_active: false });
    expect(await db.Client.findByPk(id, { paranoid: false })).toMatchObject({ fiscal_street: "Ruta 8", fiscal_locality: "Tancacha", is_active: false });

    await as(actor).put(`/clients/${id}`).send({ fiscal_street: "", fiscal_locality: "Quequén" });
    const after = await db.Client.findByPk(id);
    expect(after.fiscal_street).toBeNull();
    expect(after.fiscal_locality).toBe("Quequén");
    expect(after.fiscal_province).toBe("Córdoba");
  });

  it("corta los textos al largo máximo en lugar de romper", async () => {
    const actor = await createActor({ permissions: ["clients_write"] });
    const res = await as(actor).post("/clients").send({ ...base, fiscal_province: "x".repeat(300) });
    expect(res.status).toBe(200);
    expect((await db.Client.findByPk(res.body.client.id)).fiscal_province).toHaveLength(100);
  });
});
