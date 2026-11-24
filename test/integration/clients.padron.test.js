"use strict";
// Consulta de CUIT en el padrón A13 de ARCA desde el alta de clientes (FLOWS.md §73). El servicio de ARCA está simulado.
jest.mock("../../services/arca/padron", () => ({ getPersona: jest.fn() }));

const padron = require("../../services/arca/padron");
const { ArcaError } = require("../../services/arca/errors");
const { createActor, as } = require("../helpers/auth");
const { createClient } = require("../factories/budget");

const VALID_CUIT = "30716396653";
const PERSON = {
  cuit: VALID_CUIT, legal_name: "CONMOMET S.A.", person_type: "JURIDICA", status: "ACTIVO", tax_condition: "responsable_inscripto",
  fiscal_street: "CALLE 578 1682", fiscal_locality: "QUEQUEN", fiscal_province: "BUENOS AIRES", postal_code: "7631",
};

beforeEach(() => jest.clearAllMocks());

describe("GET /clients/padron/:cuit", () => {
  it("devuelve los datos del padrón", async () => {
    const actor = await createActor({ permissions: ["clients_write"] });
    padron.getPersona.mockResolvedValue(PERSON);
    const res = await as(actor).get(`/clients/padron/${VALID_CUIT}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ legal_name: "CONMOMET S.A.", fiscal_locality: "QUEQUEN", tax_condition: "responsable_inscripto", existing_client: null });
    expect(padron.getPersona).toHaveBeenCalledWith(VALID_CUIT);
  });

  it("acepta el CUIT con guiones y avisa si ya hay un cliente con ese CUIT", async () => {
    const actor = await createActor({ permissions: ["clients_write"] });
    const client = await createClient({ cuit: VALID_CUIT });
    padron.getPersona.mockResolvedValue(PERSON);
    const res = await as(actor).get("/clients/padron/30-71639665-3");
    expect(res.status).toBe(200);
    expect(res.body.data.existing_client).toEqual({ id: client.id, razonSocial: client.razonSocial });
    expect(padron.getPersona).toHaveBeenCalledWith(VALID_CUIT);
  });

  it("rechaza un CUIT inválido sin consultar a ARCA", async () => {
    const actor = await createActor({ permissions: ["clients_write"] });
    const res = await as(actor).get("/clients/padron/30716396650");
    expect(res.status).toBe(400);
    expect(padron.getPersona).not.toHaveBeenCalled();
  });

  it("traduce los errores de ARCA: apagada -> 409, sin autorización o sin respuesta -> 502, sin datos -> 502 con el motivo", async () => {
    const actor = await createActor({ permissions: ["clients_write"] });
    padron.getPersona.mockRejectedValueOnce(new ArcaError("disabled", "La integración con ARCA está apagada."));
    expect((await as(actor).get(`/clients/padron/${VALID_CUIT}`)).status).toBe(409);
    padron.getPersona.mockRejectedValueOnce(new ArcaError("afip", 'El CEE no posee autorización. Autorizá el servicio "ws_sr_padron_a13".'));
    const unauthorized = await as(actor).get(`/clients/padron/${VALID_CUIT}`);
    expect(unauthorized.status).toBe(502);
    expect(unauthorized.body).toMatchObject({ code: "arca_afip" });
    expect(unauthorized.body.error).toMatch(/ws_sr_padron_a13/);
  });

  it("pide clients_write (no alcanza con clients_read)", async () => {
    const reader = await createActor({ permissions: ["clients_read"] });
    const writer = await createActor({ permissions: ["clients_write"] });
    const admin = await createActor({ role: "admin" });
    padron.getPersona.mockResolvedValue(PERSON);
    expect((await as(reader).get(`/clients/padron/${VALID_CUIT}`)).status).toBe(401);
    expect((await as(writer).get(`/clients/padron/${VALID_CUIT}`)).status).toBe(200);
    expect((await as(admin).get(`/clients/padron/${VALID_CUIT}`)).status).toBe(200);
  });
});
