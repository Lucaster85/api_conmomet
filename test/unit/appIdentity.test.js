"use strict";
const { getAppName, DEFAULT_APP_NAME } = require("../../helpers/appIdentity");

describe("appIdentity.getAppName", () => {
  const saved = { name: process.env.APP_NAME, legal: process.env.APP_LEGAL_NAME };
  afterEach(() => {
    if (saved.name === undefined) delete process.env.APP_NAME; else process.env.APP_NAME = saved.name;
    if (saved.legal === undefined) delete process.env.APP_LEGAL_NAME; else process.env.APP_LEGAL_NAME = saved.legal;
  });

  it("sin variables queda Conmomet (producción no configura nada)", () => {
    delete process.env.APP_NAME;
    delete process.env.APP_LEGAL_NAME;
    expect(getAppName()).toBe("Conmomet");
    expect(DEFAULT_APP_NAME).toBe("Conmomet");
  });

  it("APP_NAME manda, recortado", () => {
    process.env.APP_NAME = "  Tu empresa ";
    process.env.APP_LEGAL_NAME = "Otra S.A.";
    expect(getAppName()).toBe("Tu empresa");
  });

  it("si solo hay APP_LEGAL_NAME, usa ese", () => {
    delete process.env.APP_NAME;
    process.env.APP_LEGAL_NAME = "Otra S.A.";
    expect(getAppName()).toBe("Otra S.A.");
  });

  it("variables vacías o en blanco cuentan como no definidas", () => {
    process.env.APP_NAME = "   ";
    process.env.APP_LEGAL_NAME = "";
    expect(getAppName()).toBe("Conmomet");
  });
});
