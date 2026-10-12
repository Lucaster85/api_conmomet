"use strict";
// Los dos avisos de ACCIÓN que agregó FLOWS.md §38: herramienta a reparación y OCA pendiente de
// presupuesto. A diferencia de los vencimientos, estos no necesitan barrido — los dispara un
// click, así que se notifican desde el controller, igual que los 6 de PC y presupuestos.
const db = require("../../models");
const { createActor } = require("../helpers/auth");
const { notifyRepairResponsible } = require("../../helpers/toolRepair");
const { notifyOcaBudgetPending } = require("../../helpers/ocaBudgetNotice");

async function createEmployee(overrides = {}) {
  const n = Math.floor(Math.random() * 900000);
  return db.Employee.create({
    name: "Juan",
    lastname: "Pérez",
    dni: String(30000000 + n),
    cuil: String(20300000000 + n),
    hire_date: "2026-01-01",
    hourly_rate: 1000,
    ...overrides,
  });
}

async function createTool(overrides = {}) {
  const n = Math.floor(Math.random() * 900000);
  // tool_type_id es obligatorio; ToolTypes se trunca entre tests, así que se crea uno por test.
  const toolType = await db.ToolType.create({ name: `Tipo ${n}` });
  return db.Tool.create({
    name: "Amoladora",
    reference_code: `H-${n}`,
    status: "in_repair",
    tool_type_id: toolType.id,
    ...overrides,
  });
}

describe("notifyRepairResponsible — herramienta en reparación", () => {
  it("avisa al usuario del empleado responsable", async () => {
    const responsable = await createActor();
    const actor = await createActor();
    const employee = await createEmployee({ user_id: responsable.user.id });
    const tool = await createTool();

    await notifyRepairResponsible(employee.id, tool, actor.user.id);

    const notifs = await db.Notification.findAll({ where: { user_id: responsable.user.id } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe("tool_in_repair_assigned");
    expect(notifs[0].body).toContain("Amoladora");
    expect(notifs[0].entity_type).toBe("tool");
    expect(notifs[0].entity_id).toBe(tool.id);
  });

  // validateRepairResponsible ya exige user_id, pero si el vínculo se rompió entre la validación
  // y el aviso, esto no puede explotar: el cambio de estado ya se guardó.
  it("no explota ni notifica si el empleado no tiene usuario vinculado", async () => {
    const actor = await createActor();
    const employee = await createEmployee({ user_id: null });
    const tool = await createTool();

    await expect(notifyRepairResponsible(employee.id, tool, actor.user.id)).resolves.toBeUndefined();
    expect(await db.Notification.count()).toBe(0);
  });

  it("no explota con un empleado inexistente ni sin herramienta", async () => {
    const actor = await createActor();
    await expect(notifyRepairResponsible(999999, await createTool(), actor.user.id)).resolves.toBeUndefined();
    await expect(notifyRepairResponsible(null, null, actor.user.id)).resolves.toBeUndefined();
    expect(await db.Notification.count()).toBe(0);
  });

  // El responsable puede ser quien hizo el cambio: no tiene sentido avisarse a uno mismo.
  it("no se auto-notifica si el responsable es quien hizo el cambio", async () => {
    const actor = await createActor();
    const employee = await createEmployee({ user_id: actor.user.id });
    const tool = await createTool();

    await notifyRepairResponsible(employee.id, tool, actor.user.id);
    expect(await db.Notification.count()).toBe(0);
  });
});

describe("POST /tools/:id/status — el camino real", () => {
  it("mandar una herramienta a reparación notifica al responsable", async () => {
    const { as } = require("../helpers/auth");
    const gerente = await createActor({ role: "admin" });
    const responsable = await createActor();
    const employee = await createEmployee({ user_id: responsable.user.id });
    const tool = await createTool({ status: "available" });

    const res = await as(gerente)
      .put(`/tools/${tool.id}/status`)
      .send({ status: "in_repair", responsible_employee_id: employee.id });

    expect([200, 201]).toContain(res.status);
    await new Promise((r) => setTimeout(r, 200));

    const notifs = await db.Notification.findAll({ where: { user_id: responsable.user.id } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe("tool_in_repair_assigned");
  });
});

describe("notifyOcaBudgetPending — OCA pendiente de presupuesto", () => {
  // La OCA se pasa como objeto plano: la función solo lee id/number/type/requires_budget/
  // budget_status, así que no hace falta armar una OCA real con cliente y líneas para ejercitar
  // la lógica de decisión, que es lo que importa.
  const oca = (overrides = {}) => ({
    id: 42, number: "OCA-0042", type: "man_hours", requires_budget: true, budget_status: null, ...overrides,
  });

  async function setBudgetUser(userId) {
    await db.SystemSetting.update({ oca_budget_notification_user_id: userId }, { where: { id: 1 } });
  }

  afterEach(async () => {
    // SystemSettings no se trunca entre tests, hay que dejarlo como estaba.
    await setBudgetUser(null);
  });

  it("avisa al usuario configurado en Configuración General", async () => {
    const destinatario = await createActor();
    const actor = await createActor();
    await setBudgetUser(destinatario.user.id);

    await notifyOcaBudgetPending(oca(), actor.user.id);

    const notifs = await db.Notification.findAll({ where: { user_id: destinatario.user.id } });
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe("oca_budget_pending");
    expect(notifs[0].body).toContain("OCA-0042");
    expect(notifs[0].entity_type).toBe("oca");
  });

  it("se omite si no hay usuario configurado", async () => {
    const actor = await createActor();
    await setBudgetUser(null);

    await expect(notifyOcaBudgetPending(oca(), actor.user.id)).resolves.toBeUndefined();
    expect(await db.Notification.count()).toBe(0);
  });

  it("no avisa si la OCA no requiere presupuesto", async () => {
    const destinatario = await createActor();
    const actor = await createActor();
    await setBudgetUser(destinatario.user.id);

    await notifyOcaBudgetPending(oca({ requires_budget: false }), actor.user.id);
    expect(await db.Notification.count()).toBe(0);
  });

  // Si el presupuesto ya se presentó o aprobó, el pendiente dejó de existir: avisar sería ruido.
  it("no avisa si el presupuesto ya avanzó de estado", async () => {
    const destinatario = await createActor();
    const actor = await createActor();
    await setBudgetUser(destinatario.user.id);

    await notifyOcaBudgetPending(oca({ budget_status: "presentado" }), actor.user.id);
    expect(await db.Notification.count()).toBe(0);
  });

  it("nunca lanza, ni sin OCA", async () => {
    const actor = await createActor();
    await expect(notifyOcaBudgetPending(null, actor.user.id)).resolves.toBeUndefined();
    await expect(notifyOcaBudgetPending(undefined, undefined)).resolves.toBeUndefined();
  });
});
