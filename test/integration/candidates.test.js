"use strict";
// Postulantes — carga interna (ver FLOWS.md §59). Permisos derivados por authPermission del primer
// segmento de la ruta: candidates_read / _write / _update / _delete. El bucket se mockea.
jest.mock("../../helpers/r2Storage", () => ({
  ...jest.requireActual("../../helpers/r2Storage"),
  uploadToR2: jest.fn(),
  deleteFromR2: jest.fn(),
}));

const db = require("../../models");
const { uploadToR2, deleteFromR2 } = require("../../helpers/r2Storage");
const { createActor, as } = require("../helpers/auth");

let uploadCounter = 0;
beforeEach(() => {
  uploadToR2.mockReset();
  deleteFromR2.mockReset();
  uploadToR2.mockImplementation(async (file, folder) => {
    uploadCounter += 1;
    return `https://files.test/${folder}/${uploadCounter}.pdf`;
  });
  deleteFromR2.mockResolvedValue(undefined);
});

const pdf = (name = "cv.pdf") => ({ buffer: Buffer.from("%PDF-1.4 contenido"), filename: name, contentType: "application/pdf" });

let dniCounter = 20000000;
const nextDni = () => String((dniCounter += 1));

async function createCandidate(overrides = {}) {
  return db.Candidate.create({ name: "Juan", lastname: "Pérez", dni: nextDni(), source: "in_person", ...overrides });
}

async function createApplication(candidate, overrides = {}) {
  return db.CandidateApplication.create({ candidate_id: candidate.id, stage: "new", source: "in_person", applied_at: new Date(), ...overrides });
}

async function createEmployee(overrides = {}) {
  const n = Math.floor(Math.random() * 900000);
  return db.Employee.create({
    name: "Luis",
    lastname: "Gómez",
    dni: String(30000000 + n),
    cuil: String(20300000000 + n),
    hire_date: "2024-01-01",
    hourly_rate: 1000,
    ...overrides,
  });
}

const WRITE = ["candidates_write"];

describe("POST /candidates", () => {
  it("crea el candidato, su postulación inicial, el historial y los papeles con su tipo", async () => {
    const actor = await createActor({ permissions: WRITE });

    const res = await as(actor)
      .post("/candidates")
      .field("name", "María")
      .field("lastname", "López")
      .field("dni", "30123456")
      .field("trade", "Soldador")
      .field("position_of_interest", "Soldador 6G")
      .field("cover_letter", "Tengo 10 años de experiencia")
      .field("file_kinds", JSON.stringify(["cv", "certificate"]))
      .attach("files", pdf("cv.pdf").buffer, { filename: "cv.pdf", contentType: "application/pdf" })
      .attach("files", pdf("curso.pdf").buffer, { filename: "curso.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    const candidate = await db.Candidate.findOne({ where: { dni: "30123456" } });
    expect(candidate).toMatchObject({ name: "María", lastname: "López", source: "in_person", created_by: actor.user.id });

    const applications = await db.CandidateApplication.findAll({ where: { candidate_id: candidate.id } });
    expect(applications).toHaveLength(1);
    expect(applications[0]).toMatchObject({ stage: "new", position_of_interest: "Soldador 6G", cover_letter: "Tengo 10 años de experiencia", source: "in_person" });

    const logs = await db.CandidateApplicationLog.findAll({ where: { application_id: applications[0].id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ event: "created", to_stage: "new", changed_by: actor.user.id });

    const files = await db.CandidateFile.findAll({ where: { candidate_id: candidate.id }, order: [["id", "ASC"]] });
    expect(files.map((f) => [f.kind, f.file_name, f.application_id, f.uploaded_by])).toEqual([
      ["cv", "cv.pdf", applications[0].id, actor.user.id],
      ["certificate", "curso.pdf", applications[0].id, actor.user.id],
    ]);
    expect(uploadToR2).toHaveBeenCalledWith(expect.anything(), `candidates/${candidate.id}`);
    expect(res.body.data.files).toHaveLength(2);
    expect(res.body.data.applications).toHaveLength(1);
  });

  it("usa el oficio como puesto de interés si no se indica uno", async () => {
    const actor = await createActor({ permissions: WRITE });
    const res = await as(actor).post("/candidates").field("name", "A").field("lastname", "B").field("trade", "Electricista");

    expect(res.status).toBe(201);
    expect(res.body.data.applications[0].position_of_interest).toBe("Electricista");
  });

  it("guarda null en dni y cuil vacíos, así dos postulantes sin DNI conviven", async () => {
    const actor = await createActor({ permissions: WRITE });
    const body = { name: "Sin", lastname: "Documento", dni: "", cuil: "" };

    expect((await as(actor).post("/candidates").send(body)).status).toBe(201);
    expect((await as(actor).post("/candidates").send(body)).status).toBe(201);

    const rows = await db.Candidate.findAll();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.dni === null && r.cuil === null)).toBe(true);
  });

  it("normaliza DNI y CUIL a solo dígitos", async () => {
    const actor = await createActor({ permissions: WRITE });

    const res = await as(actor).post("/candidates").send({ name: "A", lastname: "B", dni: "30.123.456", cuil: "20-30123456-3" });

    expect(res.status).toBe(201);
    expect(res.body.data.dni).toBe("30123456");
    expect(res.body.data.cuil).toBe("20301234563");
  });

  it.each([
    ["sin nombre", { lastname: "B" }, /nombre/i],
    ["sin apellido", { name: "A" }, /apellido/i],
    ["con un DNI de largo inválido", { name: "A", lastname: "B", dni: "123" }, /DNI/],
    ["con un CUIL inválido", { name: "A", lastname: "B", cuil: "20301234560" }, /CUIL/],
    ["con un email mal formado", { name: "A", lastname: "B", email: "nope" }, /email/i],
    ["con un teléfono muy corto", { name: "A", lastname: "B", phone: "123" }, /teléfono/i],
    ["con una fecha de nacimiento futura", { name: "A", lastname: "B", birth_date: "2999-01-01" }, /nacimiento/i],
    ["con años de experiencia negativos", { name: "A", lastname: "B", years_experience: -2 }, /experiencia/i],
    ["con origen web (es solo del formulario público)", { name: "A", lastname: "B", source: "web" }, /origen/i],
    ["con una categoría inexistente", { name: "A", lastname: "B", category_id: 999999 }, /categoría/i],
  ])("rechaza con 400 %s y no guarda nada", async (_label, body, message) => {
    const actor = await createActor({ permissions: WRITE });

    const res = await as(actor).post("/candidates").send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
    expect(await db.Candidate.count()).toBe(0);
  });

  it("con un DNI repetido responde 400, no guarda nada y ni siquiera sube los archivos", async () => {
    const actor = await createActor({ permissions: WRITE });
    await createCandidate({ dni: "30999888" });

    const res = await as(actor)
      .post("/candidates")
      .field("name", "Otro")
      .field("lastname", "Distinto")
      .field("dni", "30999888")
      .attach("files", pdf().buffer, { filename: "cv.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DNI/);
    expect(await db.Candidate.count()).toBe(1);
    expect(await db.CandidateApplication.count()).toBe(0);
    expect(await db.CandidateFile.count()).toBe(0);
    // El índice único corta antes de subir nada: no hay nada que limpiar en el bucket.
    expect(uploadToR2).not.toHaveBeenCalled();
  });

  it("si falla la subida del segundo archivo, deshace todo y borra del bucket el primero", async () => {
    const actor = await createActor({ permissions: WRITE });
    uploadToR2.mockReset();
    uploadToR2
      .mockResolvedValueOnce("https://files.test/candidates/1/primero.pdf")
      .mockRejectedValueOnce(new Error("R2 caído"));

    const res = await as(actor)
      .post("/candidates")
      .field("name", "María")
      .field("lastname", "López")
      .field("dni", "30123456")
      .attach("files", pdf("a.pdf").buffer, { filename: "a.pdf", contentType: "application/pdf" })
      .attach("files", pdf("b.pdf").buffer, { filename: "b.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(500);
    // Nada a medias en la base...
    expect(await db.Candidate.count({ paranoid: false })).toBe(0);
    expect(await db.CandidateApplication.count()).toBe(0);
    expect(await db.CandidateApplicationLog.count()).toBe(0);
    expect(await db.CandidateFile.count({ paranoid: false })).toBe(0);
    // ...ni archivos huérfanos en el bucket: sin esto el primero quedaría subido sin referencia.
    expect(deleteFromR2).toHaveBeenCalledTimes(1);
    expect(deleteFromR2).toHaveBeenCalledWith("https://files.test/candidates/1/primero.pdf");
  });

  it("rechaza con 400 un archivo de un formato no permitido", async () => {
    const actor = await createActor({ permissions: WRITE });

    const res = await as(actor)
      .post("/candidates")
      .field("name", "A")
      .field("lastname", "B")
      .attach("files", Buffer.from("texto"), { filename: "notas.txt", contentType: "text/plain" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Formato no permitido/);
    expect(await db.Candidate.count()).toBe(0);
    expect(uploadToR2).not.toHaveBeenCalled();
  });

  it("rechaza un archivo cuyo tipo declarado no coincide con su extensión", async () => {
    const actor = await createActor({ permissions: WRITE });

    const res = await as(actor)
      .post("/candidates")
      .field("name", "A")
      .field("lastname", "B")
      .attach("files", Buffer.from("x"), { filename: "virus.exe", contentType: "application/pdf" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Formato no permitido/);
  });

  it("rechaza con 400 un archivo de más de 10 MB", async () => {
    const actor = await createActor({ permissions: WRITE });

    const res = await as(actor)
      .post("/candidates")
      .field("name", "A")
      .field("lastname", "B")
      .attach("files", Buffer.alloc(10 * 1024 * 1024 + 1), { filename: "grande.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/10 MB/);
    expect(await db.Candidate.count()).toBe(0);
  });

  it("rechaza con 400 más de 5 archivos", async () => {
    const actor = await createActor({ permissions: WRITE });
    let req = as(actor).post("/candidates").field("name", "A").field("lastname", "B");
    for (let i = 0; i < 6; i += 1) req = req.attach("files", pdf().buffer, { filename: `cv${i}.pdf`, contentType: "application/pdf" });

    const res = await req;

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hasta 5 archivos/);
    expect(await db.Candidate.count()).toBe(0);
  });

  it("devuelve 401 sin el permiso exacto", async () => {
    const actor = await createActor({ permissions: ["candidates_read"] });
    const res = await as(actor).post("/candidates").send({ name: "A", lastname: "B" });
    expect(res.status).toBe(401);
    expect(await db.Candidate.count()).toBe(0);
  });

  it("deja pasar a admin_granted", async () => {
    const actor = await createActor({ role: "admin" });
    const res = await as(actor).post("/candidates").send({ name: "A", lastname: "B" });
    expect(res.status).toBe(201);
  });
});

describe("GET /candidates", () => {
  const READ = ["candidates_read"];

  it("lista los postulantes más nuevos primero con sus postulaciones", async () => {
    const actor = await createActor({ permissions: READ });
    const first = await createCandidate();
    await createApplication(first);
    const second = await createCandidate();
    await createApplication(second, { stage: "screening" });

    const res = await as(actor).get("/candidates");

    expect(res.status).toBe(200);
    expect(res.body.data.map((c) => c.id)).toEqual([second.id, first.id]);
    expect(res.body.data[0].applications[0].stage).toBe("screening");
  });

  it("incluye la cantidad de papeles de cada postulante", async () => {
    const actor = await createActor({ permissions: READ });
    const candidate = await createCandidate();
    await db.CandidateFile.create({ candidate_id: candidate.id, kind: "cv", file_url: "https://files.test/a.pdf" });
    await db.CandidateFile.create({ candidate_id: candidate.id, kind: "other", file_url: "https://files.test/b.pdf" });

    const res = await as(actor).get("/candidates");

    expect(Number(res.body.data[0].files_count)).toBe(2);
  });

  it("oculta por defecto a quien tiene todas sus postulaciones cerradas y lo muestra con include_closed", async () => {
    const actor = await createActor({ permissions: READ });
    const open = await createCandidate();
    await createApplication(open, { stage: "interview" });
    const closed = await createCandidate();
    await createApplication(closed, { stage: "rejected", rejection_reason: "other" });
    const withdrawn = await createCandidate();
    await createApplication(withdrawn, { stage: "withdrawn" });

    const hidden = await as(actor).get("/candidates");
    const shown = await as(actor).get("/candidates?include_closed=true");

    expect(hidden.body.data.map((c) => c.id)).toEqual([open.id]);
    expect(shown.body.data.map((c) => c.id).sort()).toEqual([open.id, closed.id, withdrawn.id].sort());
  });

  it("muestra a quien se reabrió con una postulación nueva aunque tenga otras cerradas", async () => {
    const actor = await createActor({ permissions: READ });
    const candidate = await createCandidate();
    await createApplication(candidate, { stage: "rejected", rejection_reason: "other" });
    await createApplication(candidate, { stage: "new" });

    const res = await as(actor).get("/candidates");

    expect(res.body.data.map((c) => c.id)).toEqual([candidate.id]);
  });

  it("muestra a quien todavía no tiene ninguna postulación", async () => {
    const actor = await createActor({ permissions: READ });
    const candidate = await createCandidate();

    const res = await as(actor).get("/candidates");

    expect(res.body.data.map((c) => c.id)).toEqual([candidate.id]);
  });

  it("una etapa explícita le gana a ocultar cerrados", async () => {
    const actor = await createActor({ permissions: READ });
    const open = await createCandidate();
    await createApplication(open, { stage: "new" });
    const rejected = await createCandidate();
    await createApplication(rejected, { stage: "rejected", rejection_reason: "other" });

    const res = await as(actor).get("/candidates?stage=rejected");

    expect(res.body.data.map((c) => c.id)).toEqual([rejected.id]);
  });

  it("busca por nombre completo, DNI y oficio, y filtra por origen", async () => {
    const actor = await createActor({ permissions: READ });
    const ana = await createCandidate({ name: "Ana", lastname: "Rivas", dni: "31555777", trade: "Plomera", source: "referral" });
    await createCandidate({ name: "Beto", lastname: "Sosa", source: "in_person" });

    const byFullName = await as(actor).get("/candidates?q=" + encodeURIComponent("Ana Rivas"));
    const byDni = await as(actor).get("/candidates?q=31555777");
    const byTrade = await as(actor).get("/candidates?q=Plomera");
    const bySource = await as(actor).get("/candidates?source=referral");

    expect(byFullName.body.data.map((c) => c.id)).toEqual([ana.id]);
    expect(byDni.body.data.map((c) => c.id)).toEqual([ana.id]);
    expect(byTrade.body.data.map((c) => c.id)).toEqual([ana.id]);
    expect(bySource.body.data.map((c) => c.id)).toEqual([ana.id]);
  });

  it("devuelve 401 sin el permiso y deja pasar a admin_granted", async () => {
    const without = await createActor({ permissions: ["candidates_write"] });
    const admin = await createActor({ role: "admin" });

    expect((await as(without).get("/candidates")).status).toBe(401);
    expect((await as(admin).get("/candidates")).status).toBe(200);
  });
});

describe("GET /candidates/:id", () => {
  const READ = ["candidates_read"];

  it("devuelve el detalle con postulaciones, papeles y categoría", async () => {
    const actor = await createActor({ permissions: READ });
    const category = await db.Category.create({ name: "Oficial", guild_hourly_rate: 1000 });
    const candidate = await createCandidate({ category_id: category.id });
    await createApplication(candidate);
    await db.CandidateFile.create({ candidate_id: candidate.id, kind: "cv", file_url: "https://files.test/a.pdf", file_name: "cv.pdf" });

    const res = await as(actor).get(`/candidates/${candidate.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.category.name).toBe("Oficial");
    expect(res.body.data.applications).toHaveLength(1);
    expect(res.body.data.files[0].file_name).toBe("cv.pdf");
    expect(res.body.data.former_employee).toBeNull();
    expect(res.body.data.current_employee).toBeNull();
  });

  it("marca como ex-empleado si el DNI es de un empleado dado de baja", async () => {
    const actor = await createActor({ permissions: READ });
    const employee = await createEmployee({ status: "inactive", termination_date: "2025-06-30" });
    const candidate = await createCandidate({ dni: employee.dni });

    const res = await as(actor).get(`/candidates/${candidate.id}`);

    expect(res.body.data.former_employee).toMatchObject({ id: employee.id });
    expect(res.body.data.current_employee).toBeNull();
  });

  it("marca como ex-empleado si el CUIL es de un empleado con baja lógica", async () => {
    const actor = await createActor({ permissions: READ });
    const employee = await createEmployee();
    await employee.destroy();
    const candidate = await createCandidate({ dni: null, cuil: employee.cuil });

    const res = await as(actor).get(`/candidates/${candidate.id}`);

    expect(res.body.data.former_employee).toMatchObject({ id: employee.id, deleted: true });
  });

  it("marca como empleado actual si el DNI es de un empleado activo", async () => {
    const actor = await createActor({ permissions: READ });
    const employee = await createEmployee({ status: "active" });
    const candidate = await createCandidate({ dni: employee.dni });

    const res = await as(actor).get(`/candidates/${candidate.id}`);

    expect(res.body.data.current_employee).toMatchObject({ id: employee.id });
    expect(res.body.data.former_employee).toBeNull();
  });

  it("no cuenta como empleado actual al empleado al que el propio candidato ya fue convertido", async () => {
    const actor = await createActor({ permissions: READ });
    const employee = await createEmployee({ status: "active" });
    const candidate = await createCandidate({ dni: employee.dni, employee_id: employee.id });

    const res = await as(actor).get(`/candidates/${candidate.id}`);

    expect(res.body.data.current_employee).toBeNull();
    expect(res.body.data.employee).toMatchObject({ id: employee.id });
  });

  it("devuelve 404 si no existe y 401 sin el permiso", async () => {
    const actor = await createActor({ permissions: READ });
    const without = await createActor();
    const candidate = await createCandidate();

    expect((await as(actor).get("/candidates/999999")).status).toBe(404);
    expect((await as(without).get(`/candidates/${candidate.id}`)).status).toBe(401);
  });
});

describe("GET /candidates/check-duplicates", () => {
  const READ = ["candidates_read"];
  const check = (actor, query) => as(actor).get("/candidates/check-duplicates").query(query);

  it("encuentra otro postulante por DNI y por CUIL", async () => {
    const actor = await createActor({ permissions: READ });
    const existing = await createCandidate({ dni: "30111222", cuil: "20301112223" });

    const byDni = await check(actor, { dni: "30.111.222" });
    const byCuil = await check(actor, { cuil: "20-30111222-3" });

    expect(byDni.body.data.candidates.map((c) => [c.id, c.matched_on])).toEqual([[existing.id, ["dni"]]]);
    expect(byCuil.body.data.candidates.map((c) => [c.id, c.matched_on])).toEqual([[existing.id, ["cuil"]]]);
  });

  it("encuentra por email sin distinguir mayúsculas y por teléfono escrito de otra forma", async () => {
    const actor = await createActor({ permissions: READ });
    const existing = await createCandidate({ email: "Maria@Mail.com", phone: "02262 45-6789" });

    const byEmail = await check(actor, { email: "maria@mail.com" });
    const byPhone = await check(actor, { phone: "+54 9 2262 456789" });

    expect(byEmail.body.data.candidates.map((c) => [c.id, c.matched_on])).toEqual([[existing.id, ["email"]]]);
    expect(byPhone.body.data.candidates.map((c) => [c.id, c.matched_on])).toEqual([[existing.id, ["phone"]]]);
  });

  it("no devuelve al propio postulante que se está editando", async () => {
    const actor = await createActor({ permissions: READ });
    const existing = await createCandidate({ dni: "30111222" });

    const res = await check(actor, { dni: "30111222", exclude_id: existing.id });

    expect(res.body.data.candidates).toEqual([]);
  });

  it("separa empleados actuales de ex-empleados por DNI", async () => {
    const actor = await createActor({ permissions: READ });
    const current = await createEmployee({ status: "active" });
    const former = await createEmployee({ status: "inactive", termination_date: "2025-01-31" });

    const resCurrent = await check(actor, { dni: current.dni });
    const resFormer = await check(actor, { dni: former.dni });

    expect(resCurrent.body.data.current_employees.map((e) => e.id)).toEqual([current.id]);
    expect(resCurrent.body.data.former_employees).toEqual([]);
    expect(resFormer.body.data.former_employees.map((e) => e.id)).toEqual([former.id]);
    expect(resFormer.body.data.current_employees).toEqual([]);
  });

  it("no usa el email ni el teléfono para relacionar con empleados", async () => {
    const actor = await createActor({ permissions: READ });
    await createEmployee({ email: "compartido@mail.com", phone: "2262456789" });

    const res = await check(actor, { email: "compartido@mail.com", phone: "2262456789" });

    expect(res.body.data.current_employees).toEqual([]);
    expect(res.body.data.former_employees).toEqual([]);
  });

  it("sin datos devuelve todo vacío", async () => {
    const actor = await createActor({ permissions: READ });
    const res = await check(actor, {});
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ candidates: [], current_employees: [], former_employees: [] });
  });

  it("no se confunde con GET /candidates/:id", async () => {
    const actor = await createActor({ permissions: READ });
    expect((await check(actor, {})).status).toBe(200);
  });

  it("devuelve 401 sin el permiso", async () => {
    const actor = await createActor();
    expect((await check(actor, { dni: "30111222" })).status).toBe(401);
  });
});

describe("PUT /candidates/:id", () => {
  const UPDATE = ["candidates_update"];

  it("actualiza solo los campos enviados", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate({ name: "Juan", trade: "Pintor", phone: "2262111111" });

    const res = await as(actor).put(`/candidates/${candidate.id}`).send({ trade: "Soldador", has_driver_license: true, years_experience: 8 });

    expect(res.status).toBe(200);
    const row = await db.Candidate.findByPk(candidate.id);
    expect(row).toMatchObject({ name: "Juan", trade: "Soldador", phone: "2262111111", has_driver_license: true, years_experience: 8 });
  });

  it("permite vaciar un campo opcional", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate({ email: "a@b.com" });

    await as(actor).put(`/candidates/${candidate.id}`).send({ email: "" });

    expect((await db.Candidate.findByPk(candidate.id)).email).toBeNull();
  });

  it("no deja vaciar el nombre", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const res = await as(actor).put(`/candidates/${candidate.id}`).send({ name: "  " });
    expect(res.status).toBe(400);
  });

  it("rechaza con 400 un DNI que ya es de otro postulante", async () => {
    const actor = await createActor({ permissions: UPDATE });
    await createCandidate({ dni: "30777666" });
    const other = await createCandidate();

    const res = await as(actor).put(`/candidates/${other.id}`).send({ dni: "30777666" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/DNI/);
  });

  it("no cambia la etapa ni el origen web: la etapa va por su endpoint", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const candidate = await createCandidate();
    const application = await createApplication(candidate);

    await as(actor).put(`/candidates/${candidate.id}`).send({ stage: "offer" });

    expect((await db.CandidateApplication.findByPk(application.id)).stage).toBe("new");
  });

  it("devuelve 404 si no existe, 401 con solo _read y deja pasar a admin_granted", async () => {
    const actor = await createActor({ permissions: UPDATE });
    const readOnly = await createActor({ permissions: ["candidates_read"] });
    const admin = await createActor({ role: "admin" });
    const candidate = await createCandidate();

    expect((await as(actor).put("/candidates/999999").send({ trade: "x" })).status).toBe(404);
    expect((await as(readOnly).put(`/candidates/${candidate.id}`).send({ trade: "x" })).status).toBe(401);
    expect((await as(admin).put(`/candidates/${candidate.id}`).send({ trade: "x" })).status).toBe(200);
  });
});

describe("DELETE /candidates/:id", () => {
  const DELETE = ["candidates_delete"];

  it("lo borra de verdad junto con sus postulaciones, historial y papeles, y limpia el bucket", async () => {
    const actor = await createActor({ permissions: DELETE });
    const candidate = await createCandidate({ dni: "30444555" });
    const application = await createApplication(candidate);
    await db.CandidateApplicationLog.create({ application_id: application.id, event: "created", to_stage: "new" });
    await db.CandidateFile.create({ candidate_id: candidate.id, kind: "cv", file_url: "https://files.test/a.pdf" });
    const removed = await db.CandidateFile.create({ candidate_id: candidate.id, kind: "other", file_url: "https://files.test/b.pdf" });
    await removed.destroy();

    const res = await as(actor).delete(`/candidates/${candidate.id}`);

    expect(res.status).toBe(200);
    expect(await db.Candidate.findByPk(candidate.id, { paranoid: false })).toBeNull();
    expect(await db.CandidateApplication.count()).toBe(0);
    expect(await db.CandidateApplicationLog.count()).toBe(0);
    expect(await db.CandidateFile.count({ paranoid: false })).toBe(0);
    expect(deleteFromR2.mock.calls.map((c) => c[0]).sort()).toEqual(["https://files.test/a.pdf", "https://files.test/b.pdf"]);
  });

  it("libera el DNI: la misma persona puede volver a cargarse", async () => {
    const actor = await createActor({ permissions: ["candidates_delete", "candidates_write"] });
    const candidate = await createCandidate({ dni: "30444555" });

    await as(actor).delete(`/candidates/${candidate.id}`);
    const res = await as(actor).post("/candidates").send({ name: "Juan", lastname: "Pérez", dni: "30444555" });

    expect(res.status).toBe(201);
  });

  it("no deja borrar a quien ya fue dado de alta como empleado", async () => {
    const actor = await createActor({ permissions: DELETE });
    const employee = await createEmployee();
    const candidate = await createCandidate({ employee_id: employee.id });

    const res = await as(actor).delete(`/candidates/${candidate.id}`);

    expect(res.status).toBe(400);
    expect(await db.Candidate.findByPk(candidate.id)).not.toBeNull();
    expect(deleteFromR2).not.toHaveBeenCalled();
  });

  it("devuelve 404 si no existe, 401 sin el permiso y deja pasar a admin_granted", async () => {
    const actor = await createActor({ permissions: DELETE });
    const without = await createActor({ permissions: ["candidates_update"] });
    const admin = await createActor({ role: "admin" });
    const candidate = await createCandidate();

    expect((await as(actor).delete("/candidates/999999")).status).toBe(404);
    expect((await as(without).delete(`/candidates/${candidate.id}`)).status).toBe(401);
    expect((await as(admin).delete(`/candidates/${candidate.id}`)).status).toBe(200);
  });
});

describe("POST/DELETE /candidates/:id/files", () => {
  it("suma papeles a un postulante existente con su tipo", async () => {
    const actor = await createActor({ permissions: WRITE });
    const candidate = await createCandidate();

    const res = await as(actor)
      .post(`/candidates/${candidate.id}/files`)
      .field("file_kinds", JSON.stringify(["cover_letter"]))
      .attach("files", pdf("carta.pdf").buffer, { filename: "carta.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(200);
    const files = await db.CandidateFile.findAll({ where: { candidate_id: candidate.id } });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ kind: "cover_letter", file_name: "carta.pdf", uploaded_by: actor.user.id });
  });

  it("un tipo desconocido cae en 'other'", async () => {
    const actor = await createActor({ permissions: WRITE });
    const candidate = await createCandidate();

    await as(actor)
      .post(`/candidates/${candidate.id}/files`)
      .field("file_kinds", JSON.stringify(["lo-que-sea"]))
      .attach("files", pdf().buffer, { filename: "x.pdf", contentType: "application/pdf" });

    expect((await db.CandidateFile.findOne()).kind).toBe("other");
  });

  it("devuelve 400 sin archivos", async () => {
    const actor = await createActor({ permissions: WRITE });
    const candidate = await createCandidate();
    const res = await as(actor).post(`/candidates/${candidate.id}/files`).field("file_kinds", "[]");
    expect(res.status).toBe(400);
  });

  it("devuelve 400 si la postulación indicada es de otro postulante", async () => {
    const actor = await createActor({ permissions: WRITE });
    const candidate = await createCandidate();
    const other = await createCandidate();
    const foreign = await createApplication(other);

    const res = await as(actor)
      .post(`/candidates/${candidate.id}/files`)
      .field("application_id", String(foreign.id))
      .attach("files", pdf().buffer, { filename: "x.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(400);
    expect(await db.CandidateFile.count()).toBe(0);
  });

  it("borra un papel del bucket y de la base con _delete", async () => {
    const actor = await createActor({ permissions: ["candidates_delete"] });
    const candidate = await createCandidate();
    const file = await db.CandidateFile.create({ candidate_id: candidate.id, kind: "cv", file_url: "https://files.test/a.pdf" });

    const res = await as(actor).delete(`/candidates/${candidate.id}/files/${file.id}`);

    expect(res.status).toBe(200);
    expect(deleteFromR2).toHaveBeenCalledWith("https://files.test/a.pdf");
    expect(await db.CandidateFile.findByPk(file.id)).toBeNull();
  });

  it("no borra un papel de otro postulante", async () => {
    const actor = await createActor({ permissions: ["candidates_delete"] });
    const candidate = await createCandidate();
    const other = await createCandidate();
    const file = await db.CandidateFile.create({ candidate_id: other.id, kind: "cv", file_url: "https://files.test/a.pdf" });

    const res = await as(actor).delete(`/candidates/${candidate.id}/files/${file.id}`);

    expect(res.status).toBe(404);
    expect(deleteFromR2).not.toHaveBeenCalled();
  });

  it("agregar exige _write y borrar exige _delete", async () => {
    const readOnly = await createActor({ permissions: ["candidates_read"] });
    const candidate = await createCandidate();
    const file = await db.CandidateFile.create({ candidate_id: candidate.id, kind: "cv", file_url: "https://files.test/a.pdf" });

    const add = await as(readOnly).post(`/candidates/${candidate.id}/files`).attach("files", pdf().buffer, { filename: "x.pdf", contentType: "application/pdf" });
    const remove = await as(readOnly).delete(`/candidates/${candidate.id}/files/${file.id}`);

    expect(add.status).toBe(401);
    expect(remove.status).toBe(401);
  });
});
