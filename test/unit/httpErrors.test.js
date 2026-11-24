"use strict";
const { Sequelize } = require("sequelize");
const { sendServerError } = require("../../helpers/httpErrors");
const { EmailServiceError } = require("../../helpers/emailService");

const fakeRes = () => {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
};

describe("sendServerError", () => {
  let spy;
  beforeEach(() => { spy = jest.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => spy.mockRestore());

  it("deja pasar el mensaje de un error de negocio (Error plano)", () => {
    const res = fakeRes();
    sendServerError(res, new Error("El saldo no alcanza."));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "El saldo no alcanza." });
    expect(spy).not.toHaveBeenCalled();
  });

  it("deja pasar un fail(msg, status) (Error plano con status)", () => {
    const res = fakeRes();
    sendServerError(res, Object.assign(new Error("Falta el cliente."), { status: 400 }));
    expect(res.body).toEqual({ error: "Falta el cliente." });
  });

  it("enmascara un error de Sequelize y no filtra el SQL", () => {
    const res = fakeRes();
    const err = new Sequelize.DatabaseError(Object.assign(new Error("Table 'x.Secret' doesn't exist"), { sql: "SELECT * FROM Secret" }));
    sendServerError(res, err);
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe("internal_error");
    expect(JSON.stringify(res.body)).not.toMatch(/Secret|SELECT/);
    expect(res.body.error).toMatch(/ref\. [0-9a-f]{8}/);
  });

  it("enmascara TypeError, errores del SDK ($metadata) y EmailServiceError", () => {
    for (const err of [
      new TypeError("Cannot read properties of undefined (reading 'x')"),
      Object.assign(new Error("AccessDenied: bucket-privado"), { $metadata: { httpStatusCode: 403 } }),
      new EmailServiceError("Email service error 401: token abc123"),
    ]) {
      const res = fakeRes();
      sendServerError(res, err);
      expect(res.body.code).toBe("internal_error");
      expect(JSON.stringify(res.body)).not.toMatch(/undefined|bucket|abc123/);
    }
  });

  it("loguea el error completo con la misma referencia que devuelve", () => {
    const res = fakeRes();
    const err = new TypeError("boom");
    sendServerError(res, err);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toContain(`ref=${res.body.ref}`);
    expect(spy.mock.calls[0][1]).toBe(err);
  });
});
