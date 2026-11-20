"use strict";
// "Datos de mi empresa" y conexión con ARCA (PLAN_ARCA.md §3.0, FLOWS.md §64).
const db = require("../../models");
const { createActor, as } = require("../helpers/auth");

const VALID_CUIT = "20123456786";
const VALID_CBU = "0170099220000067797370";

let savedArcaEnv;
beforeAll(() => {
  // El .env del dev puede traer ARCA_ENV (dotenv lo carga): los tests nunca tienen que hablar con ARCA.
  savedArcaEnv = process.env.ARCA_ENV;
  delete process.env.ARCA_ENV;
});
afterAll(() => {
  if (savedArcaEnv !== undefined) process.env.ARCA_ENV = savedArcaEnv;
});

// CompanyProfiles no se trunca entre tests (fila única sembrada, como SystemSettings): cada test parte de un perfil vacío.
beforeEach(async () => {
  await db.CompanyProfile.update(
    {
      legal_name: null, display_name: null, cuit: null, address_street: null, address_number: null, address_locality: null,
      address_province: null, vat_condition: "responsable_inscripto", iibb_number: null, activity_start_date: null,
      email: null, phone: null, fce_transfer_option: "SCA",
    },
    { where: { id: 1 } }
  );
});

const admin = () => createActor({ role: "admin" });
const withPermission = () => createActor({ permissions: ["company_settings_update"] });

describe("permisos de /company-settings", () => {
  const endpoints = [
    ["get", "/company-settings"],
    ["put", "/company-settings/profile"],
    ["post", "/company-settings/points-of-sale"],
    ["post", "/company-settings/bank-accounts"],
    ["post", "/company-settings/arca/test"],
    ["post", "/company-settings/arca/validate-points-of-sale"],
  ];

  it.each(endpoints)("%s %s sin company_settings_update responde 401", async (method, path) => {
    const actor = await createActor({ permissions: ["system_settings_update", "invoices_write"] });
    const res = await as(actor)[method](path).send({});
    expect(res.status).toBe(401);
  });

  it("con company_settings_update puede leer", async () => {
    const res = await as(await withPermission()).get("/company-settings");
    expect(res.status).toBe(200);
    expect(res.body.data.profile).toBeTruthy();
    expect(res.body.data.arca.enabled).toBe(false);
  });

  it("con admin_granted (bypass) puede leer", async () => {
    const res = await as(await admin()).get("/company-settings");
    expect(res.status).toBe(200);
  });

  it("sin token responde 401", async () => {
    const request = require("supertest");
    const { app } = require("../helpers/auth");
    const res = await request(app).get("/company-settings");
    expect(res.status).toBe(401);
  });
});

describe("PUT /company-settings/profile", () => {
  it("guarda los datos del emisor y normaliza el CUIT", async () => {
    const actor = await withPermission();
    const res = await as(actor).put("/company-settings/profile").send({
      legal_name: "CONMOMET S.A", cuit: "20-12345678-6", vat_condition: "responsable_inscripto",
      iibb_number: "30716396653", activity_start_date: "2020-02-01", fce_transfer_option: "ADC",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.cuit).toBe(VALID_CUIT);
    expect(res.body.data.fce_transfer_option).toBe("ADC");

    const audit = await db.AuditLog.findOne({ where: { entity_type: "CompanyProfile" } });
    expect(audit.performed_by).toBe(actor.user.id);
  });

  it("rechaza CUIT, condición de IVA, opción FCE, fecha y email inválidos", async () => {
    const actor = await withPermission();
    for (const body of [
      { cuit: "20123456780" }, { vat_condition: "otra" }, { fce_transfer_option: "XXX" },
      { activity_start_date: "ayer" }, { email: "no-es-mail" },
    ]) {
      const res = await as(actor).put("/company-settings/profile").send(body);
      expect(res.status).toBe(400);
    }
  });
});

describe("puntos de venta", () => {
  it("crea, no permite repetir el número y valida el rango", async () => {
    const actor = await withPermission();
    const ok = await as(actor).post("/company-settings/points-of-sale").send({ number: 3, usage_description: "Obras con IIBB", type: "web_service" });
    expect(ok.status).toBe(201);

    const dup = await as(actor).post("/company-settings/points-of-sale").send({ number: 3 });
    expect(dup.status).toBe(409);

    for (const number of [0, 100000, "abc", 2.5]) {
      const bad = await as(actor).post("/company-settings/points-of-sale").send({ number });
      expect(bad.status).toBe(400);
    }
  });

  it("hay un solo predeterminado, y un punto inactivo no puede serlo", async () => {
    const actor = await withPermission();
    const a = (await as(actor).post("/company-settings/points-of-sale").send({ number: 3, is_default: true })).body.data;
    const b = (await as(actor).post("/company-settings/points-of-sale").send({ number: 4, is_default: true })).body.data;

    expect((await db.CompanyPointOfSale.findByPk(a.id)).is_default).toBe(false);
    expect((await db.CompanyPointOfSale.findByPk(b.id)).is_default).toBe(true);

    const res = await as(actor).put(`/company-settings/points-of-sale/${b.id}`).send({ is_active: false, is_default: true });
    expect(res.body.data.is_default).toBe(false);
  });

  it("no deja cambiar el número a uno existente y responde 404 si no existe", async () => {
    const actor = await withPermission();
    await as(actor).post("/company-settings/points-of-sale").send({ number: 3 });
    const b = (await as(actor).post("/company-settings/points-of-sale").send({ number: 4 })).body.data;

    expect((await as(actor).put(`/company-settings/points-of-sale/${b.id}`).send({ number: 3 })).status).toBe(409);
    expect((await as(actor).put("/company-settings/points-of-sale/99999").send({ number: 7 })).status).toBe(404);
    expect((await as(actor).delete("/company-settings/points-of-sale/99999")).status).toBe(404);
  });

  it("elimina uno sin facturas", async () => {
    const actor = await withPermission();
    const pos = (await as(actor).post("/company-settings/points-of-sale").send({ number: 5 })).body.data;
    expect((await as(actor).delete(`/company-settings/points-of-sale/${pos.id}`)).status).toBe(200);
    expect(await db.CompanyPointOfSale.findByPk(pos.id)).toBeNull();
  });
});

describe("cuentas bancarias", () => {
  it("crea con CBU válido, lo guarda normalizado y no permite repetirlo", async () => {
    const actor = await withPermission();
    const ok = await as(actor).post("/company-settings/bank-accounts").send({ bank_name: "Banco X", cbu: "0170 0992 2000 0067 7973 70", alias: "conmomet.cobros", currency: "ARS" });
    expect(ok.status).toBe(201);
    expect(ok.body.data.cbu).toBe(VALID_CBU);

    const dup = await as(actor).post("/company-settings/bank-accounts").send({ bank_name: "Banco X", cbu: VALID_CBU });
    expect(dup.status).toBe(409);
  });

  it("rechaza banco vacío, CBU con dígito verificador mal, largo incorrecto, alias y moneda inválidos", async () => {
    const actor = await withPermission();
    for (const body of [
      { bank_name: "", cbu: VALID_CBU },
      { bank_name: "B", cbu: "0170099320000067797370" },
      { bank_name: "B", cbu: "123" },
      { bank_name: "B", cbu: VALID_CBU, alias: "x" },
      { bank_name: "B", cbu: VALID_CBU, currency: "EUR" },
    ]) {
      const res = await as(actor).post("/company-settings/bank-accounts").send(body);
      expect(res.status).toBe(400);
    }
  });

  it("hay una sola predeterminada y se puede editar y eliminar", async () => {
    const actor = await withPermission();
    const a = (await as(actor).post("/company-settings/bank-accounts").send({ bank_name: "A", cbu: VALID_CBU, is_default: true })).body.data;
    // Segundo CBU válido: se arma con los mismos dígitos de cuenta y el banco 014 (se recalculan los verificadores en el helper).
    const second = buildValidCbu("0140999", "4000000000000");
    const b = (await as(actor).post("/company-settings/bank-accounts").send({ bank_name: "B", cbu: second, is_default: true })).body.data;
    expect((await db.CompanyBankAccount.findByPk(a.id)).is_default).toBe(false);

    const upd = await as(actor).put(`/company-settings/bank-accounts/${b.id}`).send({ alias: "otro.alias.ok" });
    expect(upd.body.data.alias).toBe("otro.alias.ok");

    expect((await as(actor).delete(`/company-settings/bank-accounts/${b.id}`)).status).toBe(200);
  });
});

describe("conexión con ARCA", () => {
  it("con la integración apagada, probar y validar responden 409 con un mensaje claro y sin tocar la red", async () => {
    const actor = await withPermission();
    for (const path of ["/company-settings/arca/test", "/company-settings/arca/validate-points-of-sale"]) {
      const res = await as(actor).post(path).send({});
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("arca_disabled");
    }
  });

  it("el estado nunca incluye certificado ni claves", async () => {
    const res = await as(await withPermission()).get("/company-settings");
    expect(JSON.stringify(res.body)).not.toMatch(/PRIVATE KEY|BEGIN CERTIFICATE|token_encrypted/);
  });
});

describe("ArcaToken", () => {
  it("no serializa el token cifrado", async () => {
    const row = await db.ArcaToken.create({ env: "homologacion", cuit: VALID_CUIT, service: "wsfe", token_encrypted: "secreto", sign_encrypted: "secreto2" });
    const json = JSON.parse(JSON.stringify(row));
    expect(json.token_encrypted).toBeUndefined();
    expect(json.sign_encrypted).toBeUndefined();
    expect(json.env).toBe("homologacion");
  });

  it("no admite dos filas para el mismo ambiente, CUIT y servicio", async () => {
    await db.ArcaToken.create({ env: "homologacion", cuit: VALID_CUIT, service: "wsfe" });
    await expect(db.ArcaToken.create({ env: "homologacion", cuit: VALID_CUIT, service: "wsfe" })).rejects.toThrow();
    await expect(db.ArcaToken.create({ env: "produccion", cuit: VALID_CUIT, service: "wsfe" })).resolves.toBeTruthy();
  });
});

// Arma un CBU válido a partir de los 7 primeros dígitos (banco+sucursal) y los 13 de la cuenta.
function buildValidCbu(block1, account) {
  const dv = (digits, weights) => (10 - (weights.reduce((s, w, i) => s + w * Number(digits[i]), 0) % 10)) % 10;
  return `${block1}${dv(block1, [7, 1, 3, 9, 7, 1, 3])}${account}${dv(account, [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3])}`;
}
