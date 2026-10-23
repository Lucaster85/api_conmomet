"use strict";
const { computeNetAmount, sumAdjustments } = require("../../helpers/payrollCalculations");

describe("sumAdjustments", () => {
  it("separa premios, descuentos y depósitos", () => {
    const adjustments = [
      { type: "bonus", amount: "1000.50" },
      { type: "deduction", amount: "200" },
      { type: "deduction", amount: 300 },
      { type: "deposit", amount: "5000" },
    ];
    expect(sumAdjustments(adjustments)).toEqual({ extras: 1000.5, deds: 500, deposits: 5000 });
  });

  it("sin ajustes devuelve todo en cero", () => {
    expect(sumAdjustments([])).toEqual({ extras: 0, deds: 0, deposits: 0 });
    expect(sumAdjustments(undefined)).toEqual({ extras: 0, deds: 0, deposits: 0 });
  });
});

describe("computeNetAmount", () => {
  it("resta descuentos, depósitos, adelantos y cuotas de préstamo del bruto", () => {
    const net = computeNetAmount({
      gross_amount: 1000000,
      deds: 50000,
      deposits: 300000,
      advances_deducted: 200000,
      loan_installments_deducted: 100000,
    });
    expect(net).toBe(350000);
  });

  it("sin depósitos se comporta como antes", () => {
    expect(computeNetAmount({ gross_amount: 1000, deds: 100, advances_deducted: 50 })).toBe(850);
  });
});
