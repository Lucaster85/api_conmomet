"use strict";
const {
  computeFrenchSchedule,
  periodicInterestPercent,
  quincenaIndex,
  quincenaOfDate,
  buildInstallmentRecords,
} = require("../../services/loanAmortizationService");

const base = { loanId: 1, amount: 100000, monthlyInterestPercent: 4, numInstallments: 4 };
const dues = (records) => records.map((r) => `${r.due_year}-${r.due_month}-${r.due_period_type}`);

describe("periodicInterestPercent", () => {
  it("devuelve la tasa mensual tal cual en cuotas mensuales", () => {
    expect(periodicInterestPercent(4, "monthly")).toBe(4);
  });

  it("devuelve la mitad de la tasa mensual en cuotas quincenales", () => {
    expect(periodicInterestPercent(4, "biweekly")).toBe(2);
  });

  it("trata una tasa vacía como 0", () => {
    expect(periodicInterestPercent(undefined, "biweekly")).toBe(0);
    expect(periodicInterestPercent(null, "monthly")).toBe(0);
  });
});

describe("quincenaIndex", () => {
  it("ordena las quincenas cronológicamente, también al cruzar de año", () => {
    const seq = [
      quincenaIndex(2026, 12, "first_half"),
      quincenaIndex(2026, 12, "second_half"),
      quincenaIndex(2027, 1, "first_half"),
      quincenaIndex(2027, 1, "second_half"),
    ];
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
    expect(new Set(seq).size).toBe(4);
    expect(seq[2] - seq[1]).toBe(1);
  });

  it("acepta strings numéricos (columnas DECIMAL/INT de Sequelize)", () => {
    expect(quincenaIndex("2026", "10", "first_half")).toBe(quincenaIndex(2026, 10, "first_half"));
  });
});

describe("quincenaOfDate", () => {
  it("el día 15 es primera quincena y el 16 segunda", () => {
    expect(quincenaOfDate("2026-11-15").half).toBe("first_half");
    expect(quincenaOfDate("2026-11-16")).toEqual({ year: 2026, month: 11, half: "second_half" });
  });
});

describe("buildInstallmentRecords — quincenal", () => {
  it("cobra la mitad de la tasa mensual en cada cuota", () => {
    const { records } = buildInstallmentRecords({ ...base, startDate: "2026-11-10", frequency: "biweekly" });
    expect(records[0].interest_amount).toBe(2000); // 2% de 100000
  });

  it("con interés 0 divide el capital en partes iguales", () => {
    const { installmentAmount, records } = buildInstallmentRecords({
      ...base, monthlyInterestPercent: 0, startDate: "2026-11-10", frequency: "biweekly",
    });
    expect(installmentAmount).toBe(25000);
    expect(records.every((r) => r.total_amount === 25000 && r.interest_amount === 0)).toBe(true);
  });

  it("entregado el día 10: la 1ª cuota vence en la 2ª quincena del mismo mes y después alternan", () => {
    const { records, duePeriodType } = buildInstallmentRecords({ ...base, startDate: "2026-11-10", frequency: "biweekly" });
    expect(dues(records)).toEqual([
      "2026-11-second_half", "2026-12-first_half", "2026-12-second_half", "2027-1-first_half",
    ]);
    expect(duePeriodType).toBeNull();
  });

  it("entregado el día 20: la 1ª cuota vence en la 1ª quincena del mes siguiente", () => {
    const { records } = buildInstallmentRecords({ ...base, startDate: "2026-11-20", frequency: "biweekly" });
    expect(dues(records)[0]).toBe("2026-12-first_half");
    expect(dues(records)[1]).toBe("2026-12-second_half");
  });

  it("cruza de diciembre a enero", () => {
    const { records } = buildInstallmentRecords({ ...base, startDate: "2026-12-20", frequency: "biweekly" });
    expect(dues(records)).toEqual([
      "2027-1-first_half", "2027-1-second_half", "2027-2-first_half", "2027-2-second_half",
    ]);
  });

  it("la suma de capital cierra exacto el monto prestado", () => {
    const { records } = buildInstallmentRecords({ ...base, startDate: "2026-11-10", frequency: "biweekly" });
    const capital = records.reduce((s, r) => s + r.principal_amount, 0);
    expect(Math.round(capital * 100) / 100).toBe(100000);
    expect(records[records.length - 1].remaining_principal_after).toBe(0);
  });
});

describe("buildInstallmentRecords — mensual", () => {
  it("sin frecuencia explícita se comporta como antes: mes siguiente, quincena del día de entrega", () => {
    const { records, duePeriodType } = buildInstallmentRecords({ ...base, startDate: "2026-11-10" });
    expect(dues(records)).toEqual([
      "2026-12-first_half", "2027-1-first_half", "2027-2-first_half", "2027-3-first_half",
    ]);
    expect(duePeriodType).toBe("first_half");
  });

  it("cobra la tasa mensual completa por cuota", () => {
    const { records } = buildInstallmentRecords({ ...base, startDate: "2026-11-10", frequency: "monthly" });
    expect(records[0].interest_amount).toBe(4000);
  });

  it("entregado el día 20 vence en 2ª quincena", () => {
    const { records } = buildInstallmentRecords({ ...base, startDate: "2026-11-20", frequency: "monthly" });
    expect(records.every((r) => r.due_period_type === "second_half")).toBe(true);
  });

  it("forceSecondHalf fuerza la 2ª quincena aunque se entregue el día 10", () => {
    const { records, duePeriodType } = buildInstallmentRecords({
      ...base, startDate: "2026-11-10", frequency: "monthly", forceSecondHalf: true,
    });
    expect(duePeriodType).toBe("second_half");
    expect(dues(records)[0]).toBe("2026-12-second_half");
  });
});

describe("buildInstallmentRecords — validaciones", () => {
  it("rechaza una frecuencia desconocida", () => {
    expect(() => buildInstallmentRecords({ ...base, startDate: "2026-11-10", frequency: "weekly" }))
      .toThrow("Frecuencia de cuotas inválida");
  });
});

describe("computeFrenchSchedule", () => {
  it("rechaza monto cero", () => {
    expect(() => computeFrenchSchedule({ amount: 0, monthlyInterestPercent: 2, numInstallments: 3 })).toThrow();
  });
});
