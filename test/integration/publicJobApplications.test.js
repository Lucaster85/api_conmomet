"use strict";
// POST /public/job-applications — "Trabajá con nosotros" (ver FLOWS.md §60). Sin usuario. El bucket
// se mockea; el rate limit tiene su propio archivo (el contador vive en memoria del proceso).
jest.mock("../../helpers/r2Storage", () => ({
  ...jest.requireActual("../../helpers/r2Storage"),
  uploadToR2: jest.fn(),
  deleteFromR2: jest.fn(),
}));

const db = require("../../models");
const { uploadToR2, deleteFromR2 } = require("../../helpers/r2Storage");
const { createActor, request, app } = require("../helpers/auth");

let uploadCounter = 0;
beforeAll(() => { process.env.PUBLIC_FORM_RATE_LIMIT_MAX = "1000"; });
afterAll(() => { delete process.env.PUBLIC_FORM_RATE_LIMIT_MAX; });
beforeEach(async () => {
  // ConsentTexts se trunca entre tests: cada uno parte con la versión 1 del texto de privacidad.
  await db.ConsentText.create({ kind: "job_application", version: 1, content: "Texto de privacidad v1" });
  uploadToR2.mockReset();
  deleteFromR2.mockReset();
  uploadToR2.mockImplementation(async (file, folder) => {
    uploadCounter += 1;
    return `https://files.test/${folder}/${uploadCounter}.pdf`;
  });
  deleteFromR2.mockResolvedValue(undefined);
});

const PDF = Buffer.from("%PDF-1.4 contenido");
const FIELDS = {
  name: "María",
  lastname: "López",
  dni: "30123456",
  email: "maria@mail.test",
  phone: "2262456789",
  birth_date: "1990-05-10",
  locality: "Necochea",
  trade: "Soldador",
  years_experience: "8",
  has_driver_license: "true",
  cover_letter: "Tengo experiencia en planta.",
  consent: "true",
  consent_version: "1",
};

// Arma el envío multipart. `files`: [{ name, kind }]; por defecto un solo CV.
function submit(fields = {}, files = [{ name: "cv.pdf", kind: "cv" }]) {
  let req = request(app).post("/public/job-applications");
  for (const [key, value] of Object.entries({ ...FIELDS, ...fields })) {
    if (value !== undefined) req = req.field(key, value);
  }
  req = req.field("file_kinds", JSON.stringify(files.map((f) => f.kind)));
  for (const f of files) req = req.attach("files", PDF, { filename: f.name, contentType: "application/pdf" });
  return req;
}

async function waitFor(check, { tries = 40, delay = 25 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, delay));
  }
  return check();
}

describe("persona nueva", () => {
  it("crea el candidato con origen web, su postulación, el historial, el consentimiento y el CV", async () => {
    const res = await submit();

    expect(res.status).toBe(200);
    const candidate = await db.Candidate.findOne({ where: { dni: "30123456" } });
    expect(candidate).toMatchObject({
      name: "María", lastname: "López", email: "maria@mail.test", locality: "Necochea", trade: "Soldador",
      years_experience: 8, has_driver_license: true, source: "web", created_by: null, consent_version: "1",
    });
    expect(candidate.consent_accepted_at).not.toBeNull();
    expect(candidate.consent_ip).toBeTruthy();

    const applications = await db.CandidateApplication.findAll({ where: { candidate_id: candidate.id } });
    expect(applications).toHaveLength(1);
    expect(applications[0]).toMatchObject({ stage: "new", source: "web", position_of_interest: "Soldador", cover_letter: "Tengo experiencia en planta.", created_by: null });
    expect(applications[0].submitted_data).toMatchObject({ dni: "30123456", name: "María", files: [{ name: "cv.pdf", kind: "cv" }] });

    const logs = await db.CandidateApplicationLog.findAll({ where: { application_id: applications[0].id } });
    expect(logs.map((l) => [l.event, l.changed_by])).toEqual([["created", null]]);

    const files = await db.CandidateFile.findAll({ where: { candidate_id: candidate.id } });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ kind: "cv", file_name: "cv.pdf", uploaded_by: null, application_id: applications[0].id });
  });

  it("acepta una carta adjunta además del CV, con su tipo", async () => {
    const res = await submit({}, [{ name: "cv.pdf", kind: "cv" }, { name: "carta.pdf", kind: "cover_letter" }]);

    expect(res.status).toBe(200);
    const files = await db.CandidateFile.findAll({ order: [["id", "ASC"]] });
    expect(files.map((f) => f.kind)).toEqual(["cv", "cover_letter"]);
  });

  it("un tipo de archivo que la web no ofrece cae en 'other'", async () => {
    await submit({}, [{ name: "cv.pdf", kind: "cv" }, { name: "x.pdf", kind: "certificate" }]);
    const files = await db.CandidateFile.findAll({ order: [["id", "ASC"]] });
    expect(files.map((f) => f.kind)).toEqual(["cv", "other"]);
  });

  it("ignora los campos que el formulario público no decide (origen, categoría, notas, recomendado)", async () => {
    const category = await db.Category.create({ name: "Oficial", guild_hourly_rate: 1000 });

    const res = await submit({ source: "referral", category_id: String(category.id), notes: "interno", referred_by_employee_id: "1", stage: "offer", employee_id: "1" });

    expect(res.status).toBe(200);
    const candidate = await db.Candidate.findOne();
    expect(candidate).toMatchObject({ source: "web", category_id: null, notes: null, referred_by_employee_id: null, employee_id: null });
    expect((await db.CandidateApplication.findOne()).stage).toBe("new");
  });

  it("responde un texto de éxito genérico", async () => {
    const res = await submit();
    expect(res.body.message).toMatch(/Recibimos tu postulación/);
  });
});

describe("versión del texto de privacidad", () => {
  it("guarda la versión que la persona vio, aunque ya haya una más nueva", async () => {
    await db.ConsentText.create({ kind: "job_application", version: 2, content: "Texto de privacidad v2" });

    const res = await submit({ consent_version: "1" });

    expect(res.status).toBe(200);
    expect((await db.Candidate.findOne()).consent_version).toBe("1");
  });

  it("guarda la versión nueva cuando la persona vio la nueva", async () => {
    await db.ConsentText.create({ kind: "job_application", version: 2, content: "Texto de privacidad v2" });

    await submit({ consent_version: "2" });

    expect((await db.Candidate.findOne()).consent_version).toBe("2");
  });

  it("un reenvío actualiza el consentimiento a la versión que aceptó ahora", async () => {
    await submit({ consent_version: "1" });
    await db.ConsentText.create({ kind: "job_application", version: 2, content: "Texto de privacidad v2" });

    await submit({ consent_version: "2" });

    expect((await db.Candidate.findOne()).consent_version).toBe("2");
  });

  it.each([
    ["sin versión", { consent_version: undefined }],
    ["con una versión que no existe", { consent_version: "99" }],
    ["con una versión que no es un número", { consent_version: "abc" }],
  ])("rechaza con 400 %s y no guarda nada", async (_label, fields) => {
    const res = await submit(fields);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Recargá la página/);
    expect(await db.Candidate.count()).toBe(0);
    expect(uploadToR2).not.toHaveBeenCalled();
  });
});

describe("validaciones", () => {
  it.each([
    ["sin aceptar el consentimiento", { consent: undefined }, /aceptar/],
    ["con el consentimiento en false", { consent: "false" }, /aceptar/],
    ["sin DNI", { dni: "" }, /DNI es obligatorio/],
    ["con un DNI inválido", { dni: "123" }, /DNI/],
    ["sin nombre", { name: "" }, /nombre/i],
    ["sin teléfono ni email", { phone: "", email: "" }, /teléfono o un email/],
    ["con un email mal formado", { email: "nope" }, /email/i],
    ["con una fecha de nacimiento futura", { birth_date: "2999-01-01" }, /nacimiento/i],
  ])("rechaza con 400 %s y no guarda nada", async (_label, fields, message) => {
    const res = await submit(fields);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(await db.Candidate.count()).toBe(0);
    expect(uploadToR2).not.toHaveBeenCalled();
  });

  it("rechaza con 400 si no hay CV", async () => {
    const res = await submit({}, [{ name: "carta.pdf", kind: "cover_letter" }]);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/CV/);
    expect(await db.Candidate.count()).toBe(0);
  });

  it("rechaza con 400 si no se adjunta ningún archivo", async () => {
    const res = await submit({}, []);
    expect(res.status).toBe(400);
    expect(await db.Candidate.count()).toBe(0);
  });

  it("rechaza con 400 un archivo de formato no permitido", async () => {
    const res = await request(app)
      .post("/public/job-applications")
      .field("name", "A").field("lastname", "B").field("dni", "30123456").field("phone", "2262456789").field("consent", "true")
      .field("file_kinds", JSON.stringify(["cv"]))
      .attach("files", Buffer.from("x"), { filename: "cv.exe", contentType: "application/octet-stream" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Formato no permitido/);
    expect(await db.Candidate.count()).toBe(0);
  });

  it("rechaza con 400 un archivo de más de 10 MB", async () => {
    const res = await request(app)
      .post("/public/job-applications")
      .field("name", "A").field("lastname", "B").field("dni", "30123456").field("phone", "2262456789").field("consent", "true")
      .field("file_kinds", JSON.stringify(["cv"]))
      .attach("files", Buffer.alloc(10 * 1024 * 1024 + 1), { filename: "cv.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/10 MB/);
  });

  it("campo trampa completo: responde 200 igual pero no guarda ni sube ni avisa", async () => {
    const res = await submit({ website: "http://spam.example" });

    expect(res.status).toBe(200);
    expect(await db.Candidate.count()).toBe(0);
    expect(uploadToR2).not.toHaveBeenCalled();
    expect(await db.Notification.count()).toBe(0);
  });

  it("si falla la subida del CV, no deja nada a medias en la base", async () => {
    uploadToR2.mockReset();
    uploadToR2.mockResolvedValueOnce("https://files.test/candidates/1/a.pdf").mockRejectedValueOnce(new Error("R2 caído"));
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const res = await submit({}, [{ name: "cv.pdf", kind: "cv" }, { name: "carta.pdf", kind: "cover_letter" }]);

    expect(res.status).toBe(500);
    expect(await db.Candidate.count({ paranoid: false })).toBe(0);
    expect(await db.CandidateApplication.count()).toBe(0);
    expect(await db.CandidateFile.count({ paranoid: false })).toBe(0);
    expect(deleteFromR2).toHaveBeenCalledWith("https://files.test/candidates/1/a.pdf");
    errorSpy.mockRestore();
  });
});

describe("deduplicación", () => {
  it("con el mismo DNI no crea otro candidato: suma una postulación y completa SOLO los datos vacíos", async () => {
    const existing = await db.Candidate.create({ name: "María", lastname: "López", dni: "30123456", phone: "1100000000", trade: "Pintora", source: "in_person" });
    await db.CandidateApplication.create({ candidate_id: existing.id, stage: "rejected", rejection_reason: "other", source: "in_person", applied_at: new Date() });

    const res = await submit({ phone: "2262456789", trade: "Soldador", locality: "Necochea", name: "OTRO NOMBRE" });

    expect(res.status).toBe(200);
    expect(await db.Candidate.count()).toBe(1);
    const row = await db.Candidate.findByPk(existing.id);
    // No se pisa lo que ya había...
    expect(row).toMatchObject({ name: "María", phone: "1100000000", trade: "Pintora", source: "in_person" });
    // ...y se completa lo que faltaba.
    expect(row).toMatchObject({ email: "maria@mail.test", locality: "Necochea", years_experience: 8 });
    // Lo enviado igual queda en la postulación.
    const applications = await db.CandidateApplication.findAll({ where: { candidate_id: existing.id }, order: [["id", "ASC"]] });
    expect(applications).toHaveLength(2);
    expect(applications[1]).toMatchObject({ stage: "new", source: "web", position_of_interest: "Soldador" });
    expect(applications[1].submitted_data).toMatchObject({ phone: "2262456789", trade: "Soldador" });
  });

  it("si ya tiene una postulación abierta, le suma los archivos con un log 'resubmitted' y no crea otra", async () => {
    const existing = await db.Candidate.create({ name: "María", lastname: "López", dni: "30123456", source: "in_person" });
    const open = await db.CandidateApplication.create({ candidate_id: existing.id, stage: "interview", source: "in_person", applied_at: new Date() });

    const res = await submit({}, [{ name: "cv-nuevo.pdf", kind: "cv" }]);

    expect(res.status).toBe(200);
    expect(await db.CandidateApplication.count()).toBe(1);
    expect((await db.CandidateApplication.findByPk(open.id)).stage).toBe("interview");
    const files = await db.CandidateFile.findAll({ where: { candidate_id: existing.id } });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ file_name: "cv-nuevo.pdf", application_id: open.id, uploaded_by: null });
    const logs = await db.CandidateApplicationLog.findAll({ where: { application_id: open.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: "resubmitted", to_stage: "interview", changed_by: null });
    expect((await db.CandidateApplication.findByPk(open.id)).submitted_data.resubmissions).toHaveLength(1);
  });

  it("reenviar dos veces seguidas con el mismo DNI nunca duplica al candidato ni la postulación", async () => {
    await submit();
    await submit();

    expect(await db.Candidate.count()).toBe(1);
    expect(await db.CandidateApplication.count()).toBe(1);
    expect(await db.CandidateFile.count()).toBe(2);
    expect(await db.CandidateApplicationLog.count({ where: { event: "resubmitted" } })).toBe(1);
  });

  it("con el mismo email o teléfono de alguien cargado a mano SIN DNI, lo completa en vez de duplicar", async () => {
    const byEmail = await db.Candidate.create({ name: "María", lastname: "López", dni: null, email: "maria@mail.test", source: "in_person" });

    await submit({ phone: "1155550000" });

    expect(await db.Candidate.count()).toBe(1);
    expect((await db.Candidate.findByPk(byEmail.id)).dni).toBe("30123456");
  });

  it("encuentra al cargado sin DNI por teléfono escrito de otra forma", async () => {
    const byPhone = await db.Candidate.create({ name: "María", lastname: "López", dni: null, phone: "02262 45-6789", source: "in_person" });

    await submit({ email: "otra@mail.test", phone: "+54 9 2262 456789" });

    expect(await db.Candidate.count()).toBe(1);
    expect((await db.Candidate.findByPk(byPhone.id)).dni).toBe("30123456");
  });

  it("NO fusiona por email o teléfono si el existente ya tiene OTRO DNI: son personas distintas", async () => {
    await db.Candidate.create({ name: "Hermano", lastname: "López", dni: "29000111", email: "maria@mail.test", phone: "2262456789", source: "in_person" });

    await submit();

    expect(await db.Candidate.count()).toBe(2);
    expect((await db.Candidate.findOne({ where: { dni: "29000111" } })).name).toBe("Hermano");
  });

  it("si el DNI ya es de alguien dado de alta como empleado, no crea nada ni avisa, pero responde igual", async () => {
    const employee = await db.Employee.create({ name: "L", lastname: "G", dni: "31000111", cuil: "20310001119", hire_date: "2026-01-01", hourly_rate: 1000 });
    await db.Candidate.create({ name: "María", lastname: "López", dni: "30123456", employee_id: employee.id, source: "in_person" });
    await createActor({ permissions: ["candidates_read"] });

    const res = await submit();

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Recibimos tu postulación/);
    expect(await db.CandidateApplication.count()).toBe(0);
    expect(await db.CandidateFile.count()).toBe(0);
    expect(uploadToR2).not.toHaveBeenCalled();
    expect(await db.Notification.count()).toBe(0);
  });

  it("la respuesta es la misma para una persona nueva y para una que ya existía", async () => {
    const first = await submit();
    const second = await submit();
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
  });
});

describe("notificaciones", () => {
  it("avisa solo a quienes tienen candidates_read (permiso directo o admin_granted)", async () => {
    const withPermission = await createActor({ permissions: ["candidates_read"] });
    const admin = await createActor({ role: "admin" });
    const without = await createActor({ permissions: ["contact_inquiries_read"] });

    await submit();

    const candidate = await db.Candidate.findOne();
    await waitFor(async () => (await db.Notification.count()) >= 2);
    const forPermission = await db.Notification.findAll({ where: { user_id: withPermission.user.id } });
    expect(forPermission).toHaveLength(1);
    expect(await db.Notification.count({ where: { user_id: admin.user.id } })).toBe(1);
    expect(await db.Notification.count({ where: { user_id: without.user.id } })).toBe(0);
    expect(forPermission[0]).toMatchObject({
      type: "job_application_received", title: "Nueva postulación web", entity_type: "candidate", entity_id: candidate.id,
      url: `/dashboard/candidates/${candidate.id}`,
    });
    expect(forPermission[0].body).toContain("María López");
  });

  it("un reenvío avisa con un título distinto", async () => {
    const actor = await createActor({ permissions: ["candidates_read"] });
    await submit();
    await waitFor(async () => (await db.Notification.count()) >= 1);
    await submit();
    await waitFor(async () => (await db.Notification.count()) >= 2);

    const titles = (await db.Notification.findAll({ where: { user_id: actor.user.id }, order: [["id", "ASC"]] })).map((n) => n.title);
    expect(titles).toEqual(["Nueva postulación web", "Postulante volvió a enviar su CV"]);
  });

  it("la postulación se guarda y responde 200 aunque no haya nadie a quien avisar", async () => {
    const res = await submit();
    expect(res.status).toBe(200);
    expect(await db.Candidate.count()).toBe(1);
  });
});
