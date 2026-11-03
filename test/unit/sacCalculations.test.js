"use strict";
const {
  semesterOfMonth,
  semesterBounds,
  sacLabel,
  sacAdjustmentLabel,
  computableDays,
  monthlyRemuneration,
  calculateSac,
  sacDifference,
} = require("../../helpers/sacCalculations");

const entry = (month, period_type, gross_amount, extra = {}) => ({ month, year: 2026, period_type, gross_amount, ...extra });
const amountOf = (monthly, month) => monthly.find((m) => m.month === month).amount;

describe("semestres", () => {
  it("ubica cada mes en su semestre", () => {
    expect(semesterOfMonth(1)).toBe(1);
    expect(semesterOfMonth(6)).toBe(1);
    expect(semesterOfMonth(7)).toBe(2);
    expect(semesterOfMonth(12)).toBe(2);
  });

  it("el 1er semestre tiene 181 días, 182 en año bisiesto, y el 2do siempre 184", () => {
    expect(semesterBounds(2026, 1).days).toBe(181);
    expect(semesterBounds(2028, 1).days).toBe(182);
    expect(semesterBounds(2026, 2).days).toBe(184);
    expect(semesterBounds(2028, 2).days).toBe(184);
  });

  it("devuelve fechas y meses del semestre", () => {
    expect(semesterBounds(2026, 2)).toMatchObject({ start: "2026-07-01", end: "2026-12-31", months: [7, 8, 9, 10, 11, 12] });
  });

  it("arma los labels de las líneas", () => {
    expect(sacLabel(2026, 1)).toBe("SAC 1er semestre 2026");
    expect(sacLabel(2026, 2)).toBe("SAC 2do semestre 2026");
    expect(sacAdjustmentLabel(2026, 1)).toBe("Diferencia SAC 1er sem. 2026");
  });
});

describe("computableDays", () => {
  it("semestre completo si ingresó antes del semestre", () => {
    expect(computableDays("2020-03-10", 2026, 2)).toBe(184);
  });

  it("ingreso a mitad de semestre cuenta desde la fecha de ingreso inclusive", () => {
    expect(computableDays("2026-10-01", 2026, 2)).toBe(92); // oct 31 + nov 30 + dic 31
    expect(computableDays("2026-12-31", 2026, 2)).toBe(1);
  });

  it("ingreso el primer día del semestre cuenta todo", () => {
    expect(computableDays("2026-07-01", 2026, 2)).toBe(184);
  });

  it("ingreso posterior al semestre no cuenta días", () => {
    expect(computableDays("2027-01-05", 2026, 2)).toBe(0);
  });

  it("año bisiesto: el 1er semestre completo son 182 días", () => {
    expect(computableDays("2020-01-01", 2028, 1)).toBe(182);
  });

  it("acepta un Date y una fecha de egreso", () => {
    expect(computableDays(new Date("2026-10-01T00:00:00Z"), 2026, 2)).toBe(92);
    expect(computableDays("2020-01-01", 2026, 2, "2026-08-31")).toBe(62); // jul 31 + ago 31
  });
});

describe("monthlyRemuneration", () => {
  it("jornalizado: suma la 1Q y la 2Q del mes", () => {
    const monthly = monthlyRemuneration([
      entry(5, "first_half", 400000),
      entry(5, "second_half", 450000),
    ], 2026, 1);
    expect(amountOf(monthly, 5)).toBe(850000);
    expect(amountOf(monthly, 4)).toBe(0);
  });

  it("mensualizado: alcanza con la entry de la 2Q", () => {
    const monthly = monthlyRemuneration([entry(3, "second_half", 900000)], 2026, 1);
    expect(amountOf(monthly, 3)).toBe(900000);
  });

  it("devuelve un item por cada mes del semestre", () => {
    expect(monthlyRemuneration([], 2026, 2).map((m) => m.month)).toEqual([7, 8, 9, 10, 11, 12]);
  });

  it("excluye los premios no remunerativos y deja los remunerativos", () => {
    const monthly = monthlyRemuneration([
      entry(6, "second_half", 1000000, {
        adjustments: [
          { type: "bonus", amount: "100000", is_remunerative: false },
          { type: "bonus", amount: "50000", is_remunerative: true },
          { type: "bonus", amount: "20000" },
          { type: "deduction", amount: "30000", is_remunerative: false },
        ],
      }),
    ], 2026, 1);
    expect(amountOf(monthly, 6)).toBe(900000);
    expect(monthly.find((m) => m.month === 6).nonRemunerative).toBe(100000);
  });

  it("excluye las líneas sac_adjustment: el SAC no integra su propia base", () => {
    const monthly = monthlyRemuneration([
      entry(8, "first_half", 500000, { lines: [{ line_type: "regular", subtotal: 400000 }, { line_type: "sac_adjustment", subtotal: 100000 }] }),
    ], 2026, 2);
    expect(amountOf(monthly, 8)).toBe(400000);
  });

  it("ignora por completo las entries de un período sac", () => {
    const monthly = monthlyRemuneration([
      entry(6, "second_half", 800000),
      entry(6, "sac", 400000, { adjustments: [{ type: "bonus", amount: 50000, is_remunerative: true }] }),
    ], 2026, 1);
    expect(amountOf(monthly, 6)).toBe(800000);
  });

  it("re-imputa un retroactivo al mes devengado, no al que se pagó", () => {
    const monthly = monthlyRemuneration([
      entry(4, "second_half", 800000),
      // En la 1Q de agosto se cobra un retroactivo de abril
      entry(8, "first_half", 500000, {
        lines: [
          { line_type: "regular", subtotal: 400000 },
          { line_type: "retroactive", subtotal: 100000, source_month: 4, source_year: 2026 },
        ],
      }),
    ], 2026, 1);
    expect(amountOf(monthly, 4)).toBe(900000);
    expect(monthly.find((m) => m.month === 4).retroAdded).toBe(100000);
  });

  it("el retroactivo pagado dentro del mismo semestre se saca del mes de pago y vuelve al de origen", () => {
    const monthly = monthlyRemuneration([
      entry(2, "second_half", 700000),
      entry(5, "second_half", 800000, {
        lines: [
          { line_type: "regular", subtotal: 700000 },
          { line_type: "retroactive", subtotal: 100000, source_month: 2, source_year: 2026 },
        ],
      }),
    ], 2026, 1);
    expect(amountOf(monthly, 5)).toBe(700000);
    expect(amountOf(monthly, 2)).toBe(800000);
  });

  it("un retroactivo cuyo origen cae en otro semestre no suma a este", () => {
    const monthly = monthlyRemuneration([
      entry(8, "first_half", 500000, {
        lines: [
          { line_type: "regular", subtotal: 400000 },
          { line_type: "retroactive", subtotal: 100000, source_month: 4, source_year: 2026 },
        ],
      }),
    ], 2026, 2);
    expect(amountOf(monthly, 8)).toBe(400000);
    expect(monthly.reduce((s, m) => s + m.retroAdded, 0)).toBe(0);
  });

  it("no mezcla años: una entry de otro año no cae en el semestre", () => {
    const monthly = monthlyRemuneration([{ month: 5, year: 2025, period_type: "second_half", gross_amount: 999999 }], 2026, 1);
    expect(amountOf(monthly, 5)).toBe(0);
  });
});

describe("calculateSac", () => {
  const fullSemester = (amounts) => amounts.map((amount, i) => ({ month: i + 1, amount }));

  it("semestre completo: mitad del mejor mes", () => {
    const sac = calculateSac(fullSemester([800000, 800000, 800000, 800000, 800000, 900000]), "2020-01-01", 2026, 1);
    expect(sac).toEqual({ amount: 450000, bestMonth: 6, bestAmount: 900000, computableDays: 181, semesterDays: 181 });
  });

  it("jornalizado con el mejor mes en junio", () => {
    const monthly = monthlyRemuneration([
      entry(4, "first_half", 400000), entry(4, "second_half", 400000),
      entry(5, "first_half", 420000), entry(5, "second_half", 410000),
      entry(6, "first_half", 500000), entry(6, "second_half", 480000),
    ], 2026, 1);
    const sac = calculateSac(monthly, "2020-01-01", 2026, 1);
    expect(sac.bestMonth).toBe(6);
    expect(sac.amount).toBe(490000);
  });

  it("mensualizado: mitad del mejor sueldo", () => {
    const monthly = monthlyRemuneration([
      entry(7, "second_half", 1000000), entry(8, "second_half", 1000000), entry(9, "second_half", 1200000),
    ], 2026, 2);
    expect(calculateSac(monthly, "2019-05-01", 2026, 2).amount).toBe(600000);
  });

  it("ingreso a mitad de semestre es proporcional a los días computables", () => {
    const monthly = [{ month: 10, amount: 920000 }, { month: 11, amount: 920000 }, { month: 12, amount: 920000 }];
    const sac = calculateSac(monthly, "2026-10-01", 2026, 2);
    expect(sac.computableDays).toBe(92);
    expect(sac.amount).toBe(230000); // 920000 / 2 * 92 / 184
  });

  it("año bisiesto usa 182 días de semestre", () => {
    const sac = calculateSac([{ month: 6, amount: 1820000 }], "2028-04-01", 2028, 1);
    expect(sac.semesterDays).toBe(182);
    expect(sac.computableDays).toBe(91); // abr 30 + may 31 + jun 30
    expect(sac.amount).toBe(455000); // 1820000 / 2 * 91 / 182
  });

  it("redondea a 2 decimales", () => {
    expect(calculateSac([{ month: 1, amount: 100000.01 }], "2020-01-01", 2026, 1).amount).toBe(50000.01);
  });

  it("sin remuneración o sin días el SAC es 0 y no hay mejor mes", () => {
    expect(calculateSac(fullSemester([0, 0, 0, 0, 0, 0]), "2020-01-01", 2026, 1)).toMatchObject({ amount: 0, bestMonth: null });
    expect(calculateSac([{ month: 12, amount: 500000 }], "2027-01-01", 2026, 2).amount).toBe(0);
  });
});

describe("sacDifference", () => {
  it("diferencia a favor del empleado", () => {
    expect(sacDifference(500000, 450000)).toBe(50000);
  });

  it("descuenta los ajustes que ya se pagaron de ese SAC", () => {
    expect(sacDifference(500000, 450000, 30000)).toBe(20000);
  });

  it("cero o negativa no genera nada", () => {
    expect(sacDifference(450000, 450000)).toBe(0);
    expect(sacDifference(400000, 450000)).toBe(0);
    expect(sacDifference(500000, 450000, 50000)).toBe(0);
  });
});
