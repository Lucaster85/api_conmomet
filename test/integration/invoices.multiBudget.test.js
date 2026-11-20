"use strict";
// Factura de varios presupuestos y varias OC del mismo cliente (PLAN_ARCA.md etapa 7, FLOWS.md §70). R2 simulado.
jest.mock("../../helpers/r2Storage", () => ({
  ...jest.requireActual("../../helpers/r2Storage"),
  uploadToR2: jest.fn(async (file, folder) => `https://files.test/${folder}/${file.originalname}`),
  deleteFromR2: jest.fn(async () => {}),
}));

const db = require("../../models");
const { todayInArgentina } = require("../../helpers/argentinaDate");
const { createActor, as } = require("../helpers/auth");
const { createClient, createBudget, createBudgetItemType, createMaterialUnit } = require("../factories/budget");

const TODAY = todayInArgentina();
const PERMS = ["invoices_read", "invoices_write", "invoices_update", "invoices_delete", "invoices_correct"];
let invoiceNumber = 0;

async function addBase(budget, { labor = 100000, materials = 20000, currency = "ARS" } = {}) {
  const itemType = await createBudgetItemType();
  const unit = await createMaterialUnit();
  if (labor) await db.BudgetLaborLine.create({ budget_id: budget.id, budget_item_type_id: itemType.id, quantity: 10, unit_price: labor / 10, estimated_total: labor, currency });
  if (materials) await db.BudgetMaterialItem.create({ budget_id: budget.id, description: "Caños", quantity: 1, material_unit_id: unit.id, unit_price: materials, total_price: materials, currency });
}

async function setup() {
  const actor = await createActor({ permissions: PERMS });
  const client = await createClient();
  const make = async (overrides = {}, base = {}) => {
    const budget = await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "approved", approved_at: new Date(), ...overrides });
    await addBase(budget, base);
    return budget;
  };
  const a = await make();
  const b = await make();
  return { actor, client, a, b, make };
}

const post = (actor, body) => as(actor).post("/invoices").send({
  voucher_type: "A", pos_number: 1, number: ++invoiceNumber, issue_date: TODAY, currency: "ARS", iva_rate: 21, ...body,
});
const line = (budget, concept, extra = {}) => ({ budget_id: budget.id, concept, ...extra });
const order = (actor, budget, overrides = {}) =>
  as(actor).post("/invoices/purchase-orders").send({ budget_id: budget.id, number: `OC-${budget.id}`, date: "2026-11-10", ...overrides }).then((r) => r.body.data);
const detail = (actor, budget) => as(actor).get(`/invoices/billables/${budget.id}`).then((r) => r.body.data);

describe("factura de varios presupuestos", () => {
  it("una factura de un solo presupuesto sigue igual: la cabecera y las líneas llevan su presupuesto", async () => {
    const { actor, a } = await setup();
    const res = await post(actor, { budget_id: a.id, lines: [{ concept: "labor", percent: 10 }] });
    expect(res.status).toBe(201);
    expect(res.body.data.budget_id).toBe(a.id);
    expect(res.body.data.lines[0]).toMatchObject({ budget_id: a.id, net_amount: 10000 });
    expect(res.body.data.budgets.map((b) => b.id)).toEqual([a.id]);
  });

  it("cobra dos presupuestos: la cabecera queda sin presupuesto y cada línea descuenta del suyo", async () => {
    const { actor, a, b } = await setup();
    const res = await post(actor, { lines: [line(a, "labor", { percent: 10 }), line(b, "materials", { percent: 50 })] });
    expect(res.status).toBe(201);
    expect(res.body.data.budget_id).toBeNull();
    expect(res.body.data.net_amount).toBe(20000);
    expect(res.body.data.budgets.map((x) => x.id).sort()).toEqual([a.id, b.id].sort());

    const da = await detail(actor, a);
    const db_ = await detail(actor, b);
    expect(da.billing.billed.ARS).toEqual({ materials: 0, labor: 10000 });
    expect(da.billing.balances.ARS).toEqual({ materials: 20000, labor: 90000 });
    expect(db_.billing.billed.ARS).toEqual({ materials: 10000, labor: 0 });
  });

  it("aparece completa en el detalle de cada presupuesto, con la parte que le toca", async () => {
    const { actor, a, b } = await setup();
    const created = (await post(actor, { lines: [line(a, "labor", { percent: 10 }), line(b, "materials", { percent: 50 })] })).body.data;
    const da = await detail(actor, a);
    const db_ = await detail(actor, b);
    expect(da.invoices.map((i) => i.id)).toEqual([created.id]);
    expect(da.invoices[0].lines).toHaveLength(2);
    expect(da.invoices[0].budget_share).toMatchObject({ net_amount: 10000 });
    expect(db_.invoices[0].budget_share).toMatchObject({ net_amount: 10000 });
    // 10000 neto + IVA 21% = 12100 de la parte de cada uno
    expect(da.invoices[0].budget_share.total_amount).toBe(12100);
  });

  it("el filtro por presupuesto del registro encuentra la factura desde cualquiera de los dos", async () => {
    const { actor, a, b, make } = await setup();
    const c = await make();
    const created = (await post(actor, { lines: [line(a, "labor", { percent: 10 }), line(b, "materials", { percent: 50 })] })).body.data;
    for (const budget of [a, b]) {
      const res = await as(actor).get(`/invoices?budget_id=${budget.id}`);
      expect(res.body.data.map((i) => i.id)).toEqual([created.id]);
    }
    expect((await as(actor).get(`/invoices?budget_id=${c.id}`)).body.data).toEqual([]);
    expect((await as(actor).get("/invoices?budget_id=abc")).status).toBe(400);
  });

  it("el pendiente de cobro de cada presupuesto cuenta solo su parte", async () => {
    const { actor, a, b } = await setup();
    await post(actor, { lines: [line(a, "labor", { percent: 10 }), line(b, "materials", { percent: 50 })] });
    const rows = (await as(actor).get("/invoices/billables")).body.data;
    expect(rows.find((r) => r.id === a.id).billing.pending_amount.ARS).toBe(12100);
    expect(rows.find((r) => r.id === b.id).billing.pending_amount.ARS).toBe(12100);
  });

  it("rechaza presupuestos de distintos clientes", async () => {
    const { actor, a } = await setup();
    const other = await createClient();
    const foreign = await createBudget({ clientId: other.id, createdBy: actor.user.id, status: "approved" });
    await addBase(foreign);
    const res = await post(actor, { lines: [line(a, "labor", { percent: 10 }), line(foreign, "labor", { percent: 10 })] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mismo cliente/);
  });

  it("rechaza un presupuesto que no está aprobado o no existe", async () => {
    const { actor, a, client } = await setup();
    const draft = await createBudget({ clientId: client.id, createdBy: actor.user.id, status: "draft" });
    expect((await post(actor, { lines: [line(a, "labor", { percent: 10 }), line(draft, "labor", { percent: 10 })] })).status).toBe(400);
    expect((await post(actor, { lines: [{ budget_id: 999999, concept: "labor", percent: 10 }] })).status).toBe(404);
  });

  it("no deja pasarse del saldo de ninguno de los presupuestos, y no se crea nada", async () => {
    const { actor, a, b } = await setup();
    const res = await post(actor, { lines: [line(a, "labor", { percent: 10 }), line(b, "labor", { percent: 101 })] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/supera el saldo/);
    expect(res.body.error).toContain(b.number);
    expect(await db.Invoice.count()).toBe(0);
  });

  it("las líneas del mismo concepto de presupuestos distintos conviven, la repetida del mismo no", async () => {
    const { actor, a, b } = await setup();
    expect((await post(actor, { lines: [line(a, "labor", { percent: 10 }), line(b, "labor", { percent: 10 })] })).status).toBe(201);
    const dup = await post(actor, { lines: [line(a, "labor", { percent: 10 }), line(a, "labor", { percent: 10 })] });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toMatch(/repetido/);
  });

  it("mezclar líneas con y sin presupuesto es un error", async () => {
    const { actor, a } = await setup();
    const res = await post(actor, { lines: [line(a, "labor", { percent: 10 }), { concept: "other", description: "Libre", net_amount: 100 }] });
    expect(res.status).toBe(400);
  });

  it("el proyecto de la factura es el de sus presupuestos si coinciden y ninguno si son distintos", async () => {
    const { actor, client, make } = await setup();
    const p1 = await db.Project.create({ code: "P-1", name: "Uno", client_id: client.id, created_by: actor.user.id });
    const p2 = await db.Project.create({ code: "P-2", name: "Dos", client_id: client.id, created_by: actor.user.id });
    const x = await make({ project_id: p1.id });
    const y = await make({ project_id: p1.id });
    const z = await make({ project_id: p2.id });
    expect((await post(actor, { lines: [line(x, "labor", { percent: 1 }), line(y, "labor", { percent: 1 })] })).body.data.project_id).toBe(p1.id);
    expect((await post(actor, { lines: [line(x, "labor", { percent: 1 }), line(z, "labor", { percent: 1 })] })).body.data.project_id).toBeNull();
  });

  it("anular la factura libera el saldo de todos los presupuestos", async () => {
    const { actor, a, b } = await setup();
    const created = (await post(actor, { lines: [line(a, "labor", { percent: 10 }), line(b, "materials", { percent: 50 })] })).body.data;
    expect((await as(actor).put(`/invoices/${created.id}/cancel`).send({ reason: "Error" })).status).toBe(200);
    expect((await detail(actor, a)).billing.billed.ARS).toEqual({ materials: 0, labor: 0 });
    expect((await detail(actor, b)).billing.billed.ARS).toEqual({ materials: 0, labor: 0 });
  });

  it("corregir la factura no cuenta contra sí misma y puede cambiar de presupuestos", async () => {
    const { actor, a, b, make } = await setup();
    const c = await make();
    const created = (await post(actor, { lines: [line(a, "labor", { percent: 100 }), line(b, "materials", { percent: 100 })] })).body.data;
    const res = await as(actor).put(`/invoices/${created.id}`).send({
      voucher_type: "A", pos_number: 1, number: created.number, issue_date: TODAY, currency: "ARS", iva_rate: 21,
      lines: [line(a, "labor", { percent: 100 }), line(c, "materials", { percent: 100 })],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.budgets.map((x) => x.id).sort()).toEqual([a.id, c.id].sort());
    expect((await detail(actor, b)).billing.billed.ARS.materials).toBe(0);
    expect((await detail(actor, c)).billing.billed.ARS.materials).toBe(20000);
  });

  it("dos facturas simultáneas sobre los mismos presupuestos no se pasan del saldo juntas", async () => {
    const { actor, a, b } = await setup();
    const results = await Promise.all([
      post(actor, { lines: [line(a, "labor", { percent: 60 }), line(b, "labor", { percent: 60 })] }),
      post(actor, { lines: [line(b, "labor", { percent: 60 }), line(a, "labor", { percent: 60 })] }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect((await detail(actor, a)).billing.billed.ARS.labor).toBe(60000);
  });
});

describe("facturar contra una OC", () => {
  it("la línea queda asociada a la OC y el saldo de la OC baja", async () => {
    const { actor, a } = await setup();
    const oc = await order(actor, a, { amount: 50000 });
    const res = await post(actor, { lines: [line(a, "labor", { percent: 20, purchase_order_id: oc.id })] });
    expect(res.status).toBe(201);
    expect(res.body.data.lines[0].purchase_order_id).toBe(oc.id);
    const d = await detail(actor, a);
    expect(d.purchase_orders[0]).toMatchObject({ billed: 20000, balance: 30000 });
  });

  it("una OC sin monto no limita, pero igual se referencia", async () => {
    const { actor, a } = await setup();
    const oc = await order(actor, a);
    expect((await post(actor, { lines: [line(a, "labor", { percent: 100, purchase_order_id: oc.id })] })).status).toBe(201);
    const d = await detail(actor, a);
    expect(d.purchase_orders[0]).toMatchObject({ billed: 100000, balance: null });
  });

  it("no deja pasarse del saldo de la OC aunque el presupuesto tenga de sobra", async () => {
    const { actor, a } = await setup();
    const oc = await order(actor, a, { amount: 30000 });
    expect((await post(actor, { lines: [line(a, "labor", { percent: 20, purchase_order_id: oc.id })] })).status).toBe(201);
    const res = await post(actor, { lines: [line(a, "labor", { percent: 20, purchase_order_id: oc.id })] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/saldo de la OC/);
  });

  it("varias líneas del mismo concepto contra OC distintas suman contra el saldo del presupuesto", async () => {
    const { actor, a } = await setup();
    const o1 = await order(actor, a, { number: "OC-1" });
    const o2 = await order(actor, a, { number: "OC-2" });
    expect((await post(actor, { lines: [line(a, "labor", { percent: 50, purchase_order_id: o1.id }), line(a, "labor", { percent: 50, purchase_order_id: o2.id })] })).status).toBe(201);
    const res = await post(actor, { lines: [line(a, "labor", { percent: 30, purchase_order_id: o1.id }), line(a, "labor", { percent: 30, purchase_order_id: o2.id })] });
    expect(res.status).toBe(400);
  });

  it("la misma OC y concepto repetidos en una factura se rechazan", async () => {
    const { actor, a } = await setup();
    const oc = await order(actor, a);
    const res = await post(actor, { lines: [line(a, "labor", { percent: 10, purchase_order_id: oc.id }), line(a, "labor", { percent: 10, purchase_order_id: oc.id })] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/repetido/);
  });

  it.each([
    ["de otro presupuesto", async (actor, a, b) => (await order(actor, b)).id, /no pertenece/],
    ["rechazada", async (actor, a) => {
      const oc = await order(actor, a);
      await as(actor).put(`/invoices/purchase-orders/${oc.id}/reject`).send({ reason: "x" });
      return oc.id;
    }, /no está vigente/],
    ["en otra moneda", async (actor, a) => (await order(actor, a, { currency: "USD" })).id, /es en USD/],
    ["solo de materiales, para mano de obra", async (actor, a) => (await order(actor, a, { concept: "materials" })).id, /solo de materiales/],
    ["inexistente", async () => 999999, /no existe/],
  ])("rechaza una OC %s", async (_label, makeOrder, message) => {
    const { actor, a, b } = await setup();
    const id = await makeOrder(actor, a, b);
    const res = await post(actor, { lines: [line(a, "labor", { percent: 10, purchase_order_id: id })] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(message);
  });

  it("anular la factura devuelve el saldo a la OC", async () => {
    const { actor, a } = await setup();
    const oc = await order(actor, a, { amount: 50000 });
    const created = (await post(actor, { lines: [line(a, "labor", { percent: 20, purchase_order_id: oc.id })] })).body.data;
    await as(actor).put(`/invoices/${created.id}/cancel`).send({ reason: "Error" });
    expect((await detail(actor, a)).purchase_orders[0]).toMatchObject({ billed: 0, balance: 50000 });
  });

  it("el listado de facturación trae las OC vigentes con su saldo", async () => {
    const { actor, a } = await setup();
    const oc = await order(actor, a, { amount: 50000, concept: "labor" });
    await post(actor, { lines: [line(a, "labor", { percent: 20, purchase_order_id: oc.id })] });
    const row = (await as(actor).get("/invoices/billables")).body.data.find((r) => r.id === a.id);
    expect(row.purchase_order.orders).toEqual([{ id: oc.id, number: oc.number, concept: "labor", currency: "ARS", amount: 50000, billed: 20000, balance: 30000 }]);
  });

  it("una factura de ARCA en borrador con varias OC se guarda y se imprime con la OC de cada línea", async () => {
    const { actor, a, b } = await setup();
    const o1 = await order(actor, a, { number: "117242" });
    const pos = await db.CompanyPointOfSale.create({ number: 3, usage_description: "Obras", type: "web_service" });
    const res = await as(actor).post("/invoices").send({
      source: "arca", cbte_tipo: 1, point_of_sale_id: pos.id, arca_concept: 1, issue_date: TODAY, currency: "ARS", iva_rate: 21,
      commercial_reference: "117242",
      lines: [line(a, "materials", { percent: 10, purchase_order_id: o1.id }), line(b, "materials", { percent: 10 })],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ arca_status: "draft", budget_id: null, commercial_reference: "117242" });
    expect(res.body.data.lines.map((l) => l.purchaseOrder && l.purchaseOrder.number)).toEqual(["117242", null]);
  });
});

describe("reglas de las OC con facturas (B9)", () => {
  async function invoiced() {
    const ctx = await setup();
    const oc = await order(ctx.actor, ctx.a, { amount: 60000 });
    const invoice = (await post(ctx.actor, { lines: [line(ctx.a, "labor", { percent: 40, purchase_order_id: oc.id })] })).body.data;
    return { ...ctx, oc, invoice };
  }

  it("no se rechaza una OC con facturas vigentes", async () => {
    const { actor, oc } = await invoiced();
    const res = await as(actor).put(`/invoices/purchase-orders/${oc.id}/reject`).send({ reason: "x" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/facturas vigentes/);
  });

  it("sí se rechaza si la factura se anuló", async () => {
    const { actor, oc, invoice } = await invoiced();
    await as(actor).put(`/invoices/${invoice.id}/cancel`).send({ reason: "Error" });
    expect((await as(actor).put(`/invoices/purchase-orders/${oc.id}/reject`).send({ reason: "x" })).status).toBe(200);
  });

  it("reemplazar pasa las facturas vigentes a la OC nueva", async () => {
    const { actor, a, oc, invoice } = await invoiced();
    const res = await as(actor).post(`/invoices/purchase-orders/${oc.id}/replace`).send({ budget_id: a.id, number: "OC-NUEVA", date: "2026-11-12", amount: 80000, reason: "Corrige el monto" });
    expect(res.status).toBe(201);
    const newId = res.body.data.id;
    const reloaded = (await as(actor).get(`/invoices/${invoice.id}`)).body.data;
    expect(reloaded.lines[0].purchase_order_id).toBe(newId);
    const d = await detail(actor, a);
    expect(d.purchase_orders.find((o) => o.id === newId)).toMatchObject({ billed: 40000, balance: 40000 });
    expect(d.purchase_orders.find((o) => o.id === oc.id)).toMatchObject({ status: "replaced", billed: 0 });
  });

  it("no se reemplaza por una OC que no cubre lo ya facturado, ni de otra moneda o concepto", async () => {
    const { actor, a, oc } = await invoiced();
    const body = { budget_id: a.id, number: "OC-NUEVA", date: "2026-11-12", reason: "x" };
    expect((await as(actor).post(`/invoices/purchase-orders/${oc.id}/replace`).send({ ...body, amount: 10000 })).status).toBe(409);
    expect((await as(actor).post(`/invoices/purchase-orders/${oc.id}/replace`).send({ ...body, currency: "USD" })).status).toBe(409);
    expect((await as(actor).post(`/invoices/purchase-orders/${oc.id}/replace`).send({ ...body, concept: "materials" })).status).toBe(409);
    expect((await db.ClientPurchaseOrder.findByPk(oc.id)).status).toBe("active");
  });

  it("no se elimina una OC con facturas", async () => {
    const { actor, oc } = await invoiced();
    expect((await as(actor).delete(`/invoices/purchase-orders/${oc.id}`)).status).toBe(409);
  });

  it("al editar una OC con facturas no se baja el monto de lo facturado ni se cambian moneda o concepto", async () => {
    const { actor, a, oc } = await invoiced();
    const body = { budget_id: a.id, number: oc.number, date: "2026-11-10" };
    expect((await as(actor).put(`/invoices/purchase-orders/${oc.id}`).send({ ...body, amount: 30000 })).status).toBe(409);
    expect((await as(actor).put(`/invoices/purchase-orders/${oc.id}`).send({ ...body, amount: 60000, currency: "USD" })).status).toBe(409);
    expect((await as(actor).put(`/invoices/purchase-orders/${oc.id}`).send({ ...body, amount: 60000, concept: "materials" })).status).toBe(409);
    expect((await as(actor).put(`/invoices/purchase-orders/${oc.id}`).send({ ...body, amount: 90000 })).status).toBe(200);
  });
});

describe("notas de crédito sobre una factura de varios presupuestos", () => {
  // Una factura ya emitida por ARCA (se arma directo: la emisión tiene su propio test).
  async function authorized(actor, lines) {
    const draft = (await as(actor).post("/invoices").send({
      source: "arca", cbte_tipo: 1, point_of_sale_id: (await db.CompanyPointOfSale.create({ number: 3, usage_description: "Obras", type: "web_service" })).id,
      arca_concept: 1, issue_date: TODAY, currency: "ARS", iva_rate: 21, lines,
    })).body.data;
    await db.Invoice.update({ arca_status: "authorized", number: ++invoiceNumber, cae: "76123456789012", pos_number: 3 }, { where: { id: draft.id } });
    return (await as(actor).get(`/invoices/${draft.id}`)).body.data;
  }

  it("las líneas de la nota heredan el presupuesto y la OC de lo que acreditan, y la nota emitida resta de cada uno", async () => {
    const { actor, a, b } = await setup();
    const oc = await order(actor, a, { amount: 50000 });
    const original = await authorized(actor, [line(a, "labor", { percent: 20, purchase_order_id: oc.id }), line(b, "materials", { percent: 50 })]);
    expect(original.budget_id).toBeNull();

    const note = await as(actor).post("/invoices").send({
      source: "arca", kind: "credit_note", associated_invoice_id: original.id, issue_date: TODAY, notes: "Devolución",
      lines: original.lines.map((l) => ({ credits_line_id: l.id, percent: 50 })),
    });
    expect(note.status).toBe(201);
    const byBudget = Object.fromEntries(note.body.data.lines.map((l) => [l.budget_id, l]));
    expect(byBudget[a.id]).toMatchObject({ purchase_order_id: oc.id, net_amount: 10000 });
    expect(byBudget[b.id]).toMatchObject({ purchase_order_id: null, net_amount: 5000 });

    // En borrador la nota no libera saldo; emitida, resta de cada presupuesto y de la OC.
    expect((await detail(actor, a)).billing.billed.ARS.labor).toBe(20000);
    await db.Invoice.update({ arca_status: "authorized", number: ++invoiceNumber, cae: "76123456789013" }, { where: { id: note.body.data.id } });
    expect((await detail(actor, a)).billing.billed.ARS.labor).toBe(10000);
    expect((await detail(actor, b)).billing.billed.ARS.materials).toBe(5000);
    expect((await detail(actor, a)).purchase_orders[0]).toMatchObject({ billed: 10000, balance: 40000 });
  });
});
