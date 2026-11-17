"use strict";
// Lo ya facturado de un presupuesto (PLAN_ARCA.md §8, B9): cómo suman las facturas y cómo restan y no restan las notas.
const { sumBilled } = require("../../services/billingMath");

let id = 0;
const line = (concept, net) => ({ concept, net_amount: net });
const invoice = (over = {}) => ({
  id: ++id, kind: "invoice", status: "pending", arca_status: "authorized", currency: "ARS", associated_invoice_id: null,
  lines: [line("materials", 1000), line("labor", 4000)], ...over,
});
const note = (original, over = {}) => invoice({ kind: "credit_note", associated_invoice_id: original.id, lines: [line("labor", 1500)], ...over });

describe("sumBilled", () => {
  it("suma las líneas de las facturas por moneda y concepto", () => {
    const a = invoice();
    const b = invoice({ currency: "USD", lines: [line("labor", 200)] });
    expect(sumBilled([a, b])).toEqual({ ARS: { materials: 1000, labor: 4000 }, USD: { materials: 0, labor: 200 } });
  });

  it("una factura anulada no suma (por eso anular libera el saldo)", () => {
    expect(sumBilled([invoice({ status: "cancelled" }), invoice()]).ARS).toEqual({ materials: 1000, labor: 4000 });
  });

  it("los borradores de factura sí ocupan saldo", () => {
    expect(sumBilled([invoice({ arca_status: "draft" })]).ARS.labor).toBe(4000);
  });

  it("una nota de crédito EMITIDA resta lo que acredita", () => {
    const original = invoice();
    expect(sumBilled([original, note(original)]).ARS).toEqual({ materials: 1000, labor: 2500 });
  });

  it("una nota de crédito en borrador, rechazada o 'autorizando' NO libera saldo", () => {
    const original = invoice();
    for (const arca_status of ["draft", "rejected", "authorizing"]) {
      expect(sumBilled([original, note(original, { arca_status })]).ARS.labor).toBe(4000);
    }
  });

  it("una nota de crédito anulada (descartada) no resta", () => {
    const original = invoice();
    expect(sumBilled([original, note(original, { status: "cancelled" })]).ARS.labor).toBe(4000);
  });

  it("varias notas se acumulan", () => {
    const original = invoice();
    expect(sumBilled([original, note(original), note(original, { lines: [line("labor", 500), line("materials", 250)] })]).ARS).toEqual({ materials: 750, labor: 2000 });
  });

  it("no se descuenta dos veces: si la original quedó anulada (NC total), ni ella ni su nota cuentan", () => {
    const original = invoice({ status: "cancelled" });
    const total = note(original, { lines: [line("materials", 1000), line("labor", 4000)] });
    expect(sumBilled([original, total]).ARS).toEqual({ materials: 0, labor: 0 });
  });

  it("una nota cuya original no está en la lista se ignora", () => {
    const stray = note({ id: 99999 });
    expect(sumBilled([stray]).ARS).toEqual({ materials: 0, labor: 0 });
  });

  it("una nota de débito no toca el saldo del presupuesto", () => {
    const original = invoice();
    const debit = invoice({ kind: "debit_note", associated_invoice_id: original.id, lines: [{ concept: "other", net_amount: 300 }] });
    expect(sumBilled([original, debit]).ARS).toEqual({ materials: 1000, labor: 4000 });
  });

  it("las líneas de otros conceptos ('other') no suman en ningún concepto del presupuesto", () => {
    expect(sumBilled([invoice({ lines: [{ concept: "other", net_amount: 999 }] })]).ARS).toEqual({ materials: 0, labor: 0 });
  });

  it("una factura sin 'kind' (datos viejos) se trata como factura", () => {
    expect(sumBilled([{ id: 1, status: "pending", currency: "ARS", lines: [line("labor", 10)] }]).ARS.labor).toBe(10);
  });

  it("redondea a centavos sin arrastrar error de punto flotante", () => {
    const a = invoice({ lines: [line("labor", 0.1)] });
    const b = invoice({ lines: [line("labor", 0.2)] });
    expect(sumBilled([a, b]).ARS.labor).toBe(0.3);
  });
});
