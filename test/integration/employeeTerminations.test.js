"use strict";
// Etapa 1 de egresos (PLAN_EGRESOS.md §3, §9, §11): el egreso como trámite con su legajo, su
// ciclo draft → confirmed → cancelled y las guardas que rechazan operar sobre un egresado.
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
    name: "Juan",
    lastname: "Pérez",
    dni: String(30000000 + n),
    cuil: String(20300000000 + n),
    hire_date: "2024-01-01",
    hourly_rate: 1000,
    ...extra,
  });
}

const PAST = "2026-10-15";

const draftBody = (employee, extra = {}) => ({
  employee_id: employee.id,
  type: "resignation",
  termination_date: PAST,
  ...extra,
});

const createDraft = async (employee, extra = {}) => {
  const actor = await createActor({ permissions: ["employee_terminations_write"] });
  const res = await as(actor).post("/employee-terminations").send(draftBody(employee, extra));
  expect(res.status).toBe(201);
  return res.body.data;
};

const manager = () =>
  createActor({ permissions: ["employee_terminations_read", "employee_terminations_write", "employee_terminations_confirm"] });

const confirmTermination = async (id) => {
  const actor = await createActor({ permissions: ["employee_terminations_confirm"] });
  const res = await as(actor).put(`/employee-terminations/${id}/confirm`);
  expect(res.status).toBe(200);
  return res.body.data;
};

describe("POST /employee-terminations", () => {
  it("crea el egreso en borrador y deja al empleado activo", async () => {
    const employee = await createEmployee();
    const actor = await createActor({ permissions: ["employee_terminations_write"] });

    const res = await as(actor).post("/employee-terminations").send(draftBody(employee, { notice_date: "2026-10-01" }));

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "draft", type: "resignation", termination_date: PAST });
    await employee.reload();
    expect(employee.status).toBe("active");
    expect(employee.termination_date).toBeNull();
  });

  it("exige la causa en un despido con causa", async () => {
    const employee = await createEmployee();
    const actor = await createActor({ permissions: ["employee_terminations_write"] });

    const res = await as(actor).post("/employee-terminations").send(draftBody(employee, { type: "dismissal_with_cause" }));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/causa/);
  });

  it("rechaza un segundo egreso vigente para el mismo empleado", async () => {
    const employee = await createEmployee();
    await createDraft(employee);
    const actor = await createActor({ permissions: ["employee_terminations_write"] });

    const res = await as(actor).post("/employee-terminations").send(draftBody(employee));

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/egreso en curso/);
  });

  it("devuelve avisos de documentación faltante y los plazos legales", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);

    expect(termination.warnings.map((w) => w.code)).toEqual(["missing_resignation_letter"]);
    expect(termination.payment_deadline).toBe("2026-10-21"); // jueves 15 + 4 hábiles
    expect(termination.art80_deadline).toBe("2026-11-14");
  });

  it("sin el permiso exacto responde 401, con el permiso 201 y con admin_granted 201", async () => {
    const employee = await createEmployee();
    const sin = await createActor({ permissions: ["employee_terminations_read"] });
    expect((await as(sin).post("/employee-terminations").send(draftBody(employee))).status).toBe(401);

    const exacto = await createActor({ permissions: ["employee_terminations_write"] });
    expect((await as(exacto).post("/employee-terminations").send(draftBody(employee))).status).toBe(201);

    const other = await createEmployee();
    const admin = await createActor({ role: "admin" });
    expect((await as(admin).post("/employee-terminations").send(draftBody(other))).status).toBe(201);
  });
});

describe("PUT /employee-terminations/:id/confirm", () => {
  it("pasa el empleado a inactivo con su fecha de egreso", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);

    const confirmed = await confirmTermination(termination.id);

    expect(confirmed.status).toBe("confirmed");
    await employee.reload();
    expect(employee.status).toBe("inactive");
    expect(employee.termination_date).toBe(PAST);
  });

  it("no confirma con una fecha de egreso futura: el empleado sigue activo", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee, { termination_date: "2099-01-31" });
    const actor = await createActor({ permissions: ["employee_terminations_confirm"] });

    const res = await as(actor).put(`/employee-terminations/${termination.id}/confirm`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/todavía no llegó/);
    await employee.reload();
    expect(employee.status).toBe("active");
  });

  it("no confirma si hay una liquidación en borrador de una quincena que alcanza el egreso", async () => {
    const employee = await createEmployee();
    const period = await db.PayPeriod.create({
      start_date: "2026-10-01", end_date: "2026-10-15", type: "first_half", month: 10, year: 2026,
    });
    await db.PayrollEntry.create({ employee_id: employee.id, pay_period_id: period.id, status: "draft" });
    const termination = await createDraft(employee);
    const actor = await createActor({ permissions: ["employee_terminations_confirm"] });

    const res = await as(actor).put(`/employee-terminations/${termination.id}/confirm`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/liquidación en borrador/);
    await employee.reload();
    expect(employee.status).toBe("active");
  });

  it("una liquidación en borrador de una quincena anterior al egreso no bloquea", async () => {
    const employee = await createEmployee();
    const period = await db.PayPeriod.create({
      start_date: "2026-09-01", end_date: "2026-09-15", type: "first_half", month: 9, year: 2026,
    });
    await db.PayrollEntry.create({ employee_id: employee.id, pay_period_id: period.id, status: "draft" });
    const termination = await createDraft(employee);

    expect((await confirmTermination(termination.id)).status).toBe("confirmed");
  });

  it("no se puede confirmar dos veces", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    await confirmTermination(termination.id);
    const actor = await createActor({ permissions: ["employee_terminations_confirm"] });

    const res = await as(actor).put(`/employee-terminations/${termination.id}/confirm`);

    expect(res.status).toBe(400);
  });

  it("con solo employee_terminations_write responde 401; con admin_granted confirma", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    const writer = await createActor({ permissions: ["employee_terminations_write"] });
    expect((await as(writer).put(`/employee-terminations/${termination.id}/confirm`)).status).toBe(401);

    const admin = await createActor({ role: "admin" });
    expect((await as(admin).put(`/employee-terminations/${termination.id}/confirm`)).status).toBe(200);
  });
});

describe("PUT /employee-terminations/:id/cancel", () => {
  it("anular un egreso confirmado devuelve al empleado a activo y borra la fecha de egreso", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    await confirmTermination(termination.id);
    const actor = await createActor({ permissions: ["employee_terminations_confirm"] });

    const res = await as(actor).put(`/employee-terminations/${termination.id}/cancel`).send({ reason: "Renuncia retractada" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "cancelled", cancellation_reason: "Renuncia retractada" });
    await employee.reload();
    expect(employee.status).toBe("active");
    expect(employee.termination_date).toBeNull();
  });

  it("exige el motivo", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    const actor = await createActor({ permissions: ["employee_terminations_confirm"] });

    const res = await as(actor).put(`/employee-terminations/${termination.id}/cancel`).send({});

    expect(res.status).toBe(400);
  });

  it("no anula un egreso ya liquidado", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    await confirmTermination(termination.id);
    await db.EmployeeTermination.update({ status: "settled" }, { where: { id: termination.id } });
    const actor = await createActor({ permissions: ["employee_terminations_confirm"] });

    const res = await as(actor).put(`/employee-terminations/${termination.id}/cancel`).send({ reason: "x" });

    expect(res.status).toBe(400);
  });

  it("tras anular se puede cargar un egreso nuevo", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    const actor = await manager();
    await as(actor).put(`/employee-terminations/${termination.id}/cancel`).send({ reason: "Error de carga" });

    const res = await as(actor).post("/employee-terminations").send(draftBody(employee, { type: "mutual_agreement" }));

    expect(res.status).toBe(201);
  });

  it("con solo employee_terminations_write responde 401", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    const writer = await createActor({ permissions: ["employee_terminations_write"] });

    const res = await as(writer).put(`/employee-terminations/${termination.id}/cancel`).send({ reason: "x" });

    expect(res.status).toBe(401);
  });
});

describe("PUT /employee-terminations/:id", () => {
  it("en borrador edita los datos pero no el tipo", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    const actor = await createActor({ permissions: ["employee_terminations_write"] });

    const res = await as(actor)
      .put(`/employee-terminations/${termination.id}`)
      .send({ type: "dismissal_with_cause", termination_date: "2026-10-20", notes: "Corrección" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ type: "resignation", termination_date: "2026-10-20", notes: "Corrección" });
  });

  it("confirmado solo permite marcar el certificado del art. 80 y las notas", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    await confirmTermination(termination.id);
    const actor = await createActor({ permissions: ["employee_terminations_write"] });

    const res = await as(actor)
      .put(`/employee-terminations/${termination.id}`)
      .send({ termination_date: "2026-10-01", art80_delivered_at: "2026-10-20" });

    expect(res.status).toBe(200);
    expect(res.body.data.termination_date).toBe(PAST);
    expect(res.body.data.art80_delivered_at).toBe("2026-10-20");
  });

  it("sin el permiso responde 401", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    const reader = await createActor({ permissions: ["employee_terminations_read"] });

    expect((await as(reader).put(`/employee-terminations/${termination.id}`).send({ notes: "x" })).status).toBe(401);
  });
});

describe("GET /employee-terminations", () => {
  it("lista y filtra por empleado, y exige employee_terminations_read", async () => {
    const a = await createEmployee();
    const b = await createEmployee();
    await createDraft(a);
    await createDraft(b);

    const sin = await createActor({ permissions: [] });
    expect((await as(sin).get("/employee-terminations")).status).toBe(401);

    const reader = await createActor({ permissions: ["employee_terminations_read"] });
    const res = await as(reader).get(`/employee-terminations?employee_id=${a.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].employee_id).toBe(a.id);
  });

  it("oculta el tope del convenio sin employee_salaries_read", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee, { type: "dismissal_without_cause", cct_cap_amount: 5000000 });
    const reader = await createActor({ permissions: ["employee_terminations_read"] });
    const withSalaries = await createActor({ permissions: ["employee_terminations_read", "employee_salaries_read"] });

    const hidden = await as(reader).get(`/employee-terminations/${termination.id}`);
    const visible = await as(withSalaries).get(`/employee-terminations/${termination.id}`);

    expect(hidden.body.data).not.toHaveProperty("cct_cap_amount");
    expect(Number(visible.body.data.cct_cap_amount)).toBe(5000000);
  });
});

describe("documentos del egreso", () => {
  it("el telegrama cargado queda en el egreso y en el legajo, y apaga el aviso", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    const category = await db.DocumentCategory.create({ name: "Telegrama de renuncia", applies_to: "employee" });
    const actor = await manager();

    const upload = await as(actor)
      .post(`/employee-terminations/${termination.id}/documents`)
      .field("title", "Telegrama del 15/10")
      .field("document_category_id", String(category.id))
      .attach("file", Buffer.from("pdf"), "telegrama.pdf");

    expect(upload.status).toBe(201);
    expect(upload.body.data).toMatchObject({
      entity_type: "employee",
      entity_id: employee.id,
      employee_termination_id: termination.id,
      is_renewable: false,
    });

    const detail = await as(actor).get(`/employee-terminations/${termination.id}`);
    expect(detail.body.data.documents).toHaveLength(1);
    expect(detail.body.data.documents[0].category_name).toBe("Telegrama de renuncia");
    expect(detail.body.data.warnings).toEqual([]);

    // Es un documento del empleado como cualquier otro: aparece en "Documentos y Vencimientos".
    const docs = await db.EntityDocument.findAll({ where: { entity_type: "employee", entity_id: employee.id } });
    expect(docs).toHaveLength(1);
  });

  it("se pueden cargar papeles aun con el egreso anulado", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    const actor = await manager();
    await as(actor).put(`/employee-terminations/${termination.id}/cancel`).send({ reason: "Error" });

    const upload = await as(actor)
      .post(`/employee-terminations/${termination.id}/documents`)
      .field("title", "Descargo")
      .attach("file", Buffer.from("pdf"), "descargo.pdf");

    expect(upload.status).toBe(201);
  });

  it("rechaza una categoría que no es de empleados", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    const category = await db.DocumentCategory.create({ name: "VTV", applies_to: "vehicle" });
    const actor = await manager();

    const res = await as(actor)
      .post(`/employee-terminations/${termination.id}/documents`)
      .field("title", "x")
      .field("document_category_id", String(category.id))
      .attach("file", Buffer.from("pdf"), "x.pdf");

    expect(res.status).toBe(400);
  });

  it("elimina un documento del egreso y exige employee_terminations_write", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    const actor = await manager();
    const upload = await as(actor)
      .post(`/employee-terminations/${termination.id}/documents`)
      .field("title", "Prueba")
      .attach("file", Buffer.from("pdf"), "prueba.pdf");
    const docId = upload.body.data.id;

    const reader = await createActor({ permissions: ["employee_terminations_read"] });
    expect((await as(reader).delete(`/employee-terminations/${termination.id}/documents/${docId}`)).status).toBe(401);
    expect((await as(actor).delete(`/employee-terminations/${termination.id}/documents/${docId}`)).status).toBe(200);
  });
});

describe("GET /lookup/employee-document-categories", () => {
  it("lista solo las categorías de empleados, sin exigir document_categories_read", async () => {
    await db.DocumentCategory.create({ name: "Telegrama de renuncia", applies_to: "employee" });
    await db.DocumentCategory.create({ name: "VTV", applies_to: "vehicle" });
    const actor = await createActor({ permissions: [] });

    const res = await as(actor).get("/lookup/employee-document-categories");

    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.name)).toEqual(["Telegrama de renuncia"]);
  });
});

describe("guardas sobre un empleado con egreso confirmado", () => {
  const confirmedEmployee = async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    await confirmTermination(termination.id);
    return employee;
  };

  it("rechaza cargar horas posteriores al egreso pero acepta las anteriores", async () => {
    const employee = await confirmedEmployee();
    const actor = await createActor({ permissions: ["time_entries_write"] });
    const base = { employee_ids: [employee.id], check_in: "07:00", check_out: "15:00" };

    const after = await as(actor).post("/time-entries").send({ ...base, date: "2026-10-16" });
    expect(after.status).toBe(201);
    expect(after.body.data).toHaveLength(0);
    expect(after.body.errors[0].error).toMatch(/egresó el 2026-10-15/);

    const before = await as(actor).post("/time-entries").send({ ...base, date: "2026-10-14" });
    expect(before.body.data).toHaveLength(1);
  });

  it("rechaza mover una carga de horas a una fecha posterior al egreso", async () => {
    const employee = await confirmedEmployee();
    const actor = await createActor({ permissions: ["time_entries_write", "time_entries_update"] });
    const created = await as(actor).post("/time-entries").send({
      employee_ids: [employee.id], date: "2026-10-14", check_in: "07:00", check_out: "15:00",
    });
    const entryId = created.body.data[0].id;

    const res = await as(actor).put(`/time-entries/${entryId}`).send({ date: "2026-10-20" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/egresó el 2026-10-15/);
  });

  it("rechaza otorgar un adelanto", async () => {
    const employee = await confirmedEmployee();
    const actor = await createActor({ permissions: ["salary_advances_write"] });

    const res = await as(actor).post("/salary-advances").send({
      employee_id: employee.id, amount: 1000, date: PAST, payment_method: "efectivo", confirm_duplicate: true,
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/egreso confirmado/);
    expect(await db.SalaryAdvance.count({ where: { employee_id: employee.id } })).toBe(0);
  });

  it("rechaza aprobar un adelanto pendiente", async () => {
    const employee = await createEmployee();
    const advance = await db.SalaryAdvance.create({
      employee_id: employee.id, amount: 1000, date: PAST, status: "pending",
    });
    const termination = await createDraft(employee);
    await confirmTermination(termination.id);
    const actor = await createActor({ permissions: ["salary_advances_update"] });

    const res = await as(actor).put(`/salary-advances/${advance.id}/approve`).send({ confirm_duplicate: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/egreso confirmado/);
  });

  it("rechaza otorgar un préstamo", async () => {
    const employee = await confirmedEmployee();
    const actor = await createActor({ permissions: ["loans_write"] });

    const res = await as(actor).post("/loans").send({
      employee_id: employee.id, amount: 100000, start_date: "2026-11-10", num_installments: 4, mark_as_paid: true,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/egreso confirmado/);
    expect(await db.Loan.count({ where: { employee_id: employee.id } })).toBe(0);
  });

  it("un egreso en borrador no bloquea nada: el empleado sigue operando", async () => {
    const employee = await createEmployee();
    await createDraft(employee);
    const actor = await createActor({ permissions: ["time_entries_write"] });

    const res = await as(actor).post("/time-entries").send({
      employee_ids: [employee.id], date: "2026-10-20", check_in: "07:00", check_out: "15:00",
    });

    expect(res.body.data).toHaveLength(1);
  });

  it("una vez anulado el egreso, vuelve a poder operar", async () => {
    const employee = await createEmployee();
    const termination = await createDraft(employee);
    await confirmTermination(termination.id);
    const admin = await createActor({ role: "admin" });
    await as(admin).put(`/employee-terminations/${termination.id}/cancel`).send({ reason: "Retractó" });

    const res = await as(admin).post("/time-entries").send({
      employee_ids: [employee.id], date: "2026-10-20", check_in: "07:00", check_out: "15:00",
    });

    expect(res.body.data).toHaveLength(1);
  });
});

describe("PUT /employees/:id con un egreso vigente", () => {
  const putBody = (employee, extra = {}) => ({
    name: employee.name, lastname: employee.lastname, dni: employee.dni, cuil: employee.cuil,
    hire_date: employee.hire_date, ...extra,
  });

  it("rechaza cambiar a mano el estado o la fecha de egreso", async () => {
    const employee = await createEmployee();
    await createDraft(employee);
    const actor = await createActor({ permissions: ["employees_update"] });

    const status = await as(actor).put(`/employees/${employee.id}`).send(putBody(employee, { status: "inactive" }));
    expect(status.status).toBe(400);
    expect(status.body.error).toMatch(/pestaña Egreso/);

    const date = await as(actor).put(`/employees/${employee.id}`).send(putBody(employee, { termination_date: "2026-10-31" }));
    expect(date.status).toBe(400);
  });

  it("acepta editar otros datos aunque el formulario reenvíe el estado sin cambios", async () => {
    const employee = await createEmployee();
    await createDraft(employee);
    const actor = await createActor({ permissions: ["employees_update"] });

    const res = await as(actor)
      .put(`/employees/${employee.id}`)
      .send(putBody(employee, { status: "active", termination_date: null, position: "Soldador" }));

    expect(res.status).toBe(200);
    await employee.reload();
    expect(employee.position).toBe("Soldador");
  });

  it("sin egreso vigente el estado se sigue editando a mano", async () => {
    const employee = await createEmployee();
    const actor = await createActor({ permissions: ["employees_update"] });

    const res = await as(actor).put(`/employees/${employee.id}`).send(putBody(employee, { status: "vacation" }));

    expect(res.status).toBe(200);
  });
});
