"use strict";
const {
  seniority,
  severanceSeries,
  severanceBase,
  severance,
  noticeMonths,
  noticePay,
  monthIntegration,
  vacationDailyRate,
  unusedVacation,
  sacOn,
  unliquidatedRange,
  prorateFixedSalary,
  assembleConcepts,
} = require("../../helpers/terminationCalculations");

describe("seniority", () => {
  it("cuenta el último día trabajado y devuelve años, meses y días", () => {
    const s = seniority("2024-01-01", "2026-10-31");
    expect(s).toMatchObject({ years: 2, months: 10, days: 0, total_months: 34 });
  });

  it("suma un año al de la indemnización cuando la fracción supera 3 meses", () => {
    expect(seniority("2024-01-01", "2026-04-30")).toMatchObject({ years: 2, months: 4, fraction_over_three_months: true, years_for_severance: 3 });
  });

  it("3 meses justos no suman año; 3 meses y un día sí", () => {
    expect(seniority("2024-01-01", "2026-03-31")).toMatchObject({ years: 2, months: 3, days: 0, years_for_severance: 2 });
    expect(seniority("2024-01-01", "2026-04-01")).toMatchObject({ years: 2, months: 3, days: 1, years_for_severance: 3 });
  });

  it("resuelve el préstamo de días cuando el día de egreso es menor al de ingreso", () => {
    expect(seniority("2025-01-20", "2026-03-09")).toMatchObject({ years: 1, months: 1, days: 18 });
  });

  it("marca el período de prueba por debajo de los 6 meses", () => {
    expect(seniority("2026-06-01", "2026-10-31").in_probation).toBe(true); // 5 meses
    expect(seniority("2026-05-01", "2026-10-31").in_probation).toBe(false); // 6 meses justos
    expect(seniority("2026-06-01", "2026-10-31", { probationMonths: 3 }).in_probation).toBe(false);
  });
});

describe("base de la indemnización", () => {
  const entry = (month, gross, extra = {}) => ({ year: 2026, month, period_type: "second_half", gross_amount: gross, adjustments: [], lines: [], ...extra });

  it("arma 12 meses hacia atrás cruzando el año, con 0 donde no hay liquidaciones", () => {
    const series = severanceSeries([entry(10, 500000)], 2026, 3);
    expect(series).toHaveLength(12);
    expect(series[0]).toMatchObject({ year: 2025, month: 4 });
    expect(series[11]).toMatchObject({ year: 2026, month: 3, amount: 0 });
  });

  it("toma el mejor mes de los últimos 12", () => {
    const series = severanceSeries([entry(7, 400000), entry(9, 650000), entry(10, 500000)], 2026, 10);
    expect(severanceBase(series)).toEqual({ base: 650000, year: 2026, month: 9 });
  });

  it("excluye SAC, premios no remunerativos y vacaciones de la base", () => {
    const series = severanceSeries([
      entry(9, 1000000, {
        adjustments: [{ type: "bonus", amount: 100000, is_remunerative: false }],
        lines: [
          { line_type: "sac_adjustment", subtotal: 50000 },
          { line_type: "vacation", subtotal: 150000 },
          { line_type: "fixed", subtotal: 700000 },
        ],
      }),
      entry(12, 900000, { period_type: "sac", lines: [{ line_type: "sac", subtotal: 900000 }] }),
    ], 2026, 12);
    const sept = series.find((m) => m.month === 9);
    expect(sept.amount).toBe(700000);
    expect(series.find((m) => m.month === 12).amount).toBe(0); // el período SAC no cuenta
  });

  it("sin remuneraciones la base es 0", () => {
    expect(severanceBase(severanceSeries([], 2026, 10))).toEqual({ base: 0, year: null, month: null });
  });
});

describe("severance (art. 245)", () => {
  it("base × años", () => {
    const r = severance(1000000, 3);
    expect(r.amount).toBe(3000000);
    expect(r.breakdown).toMatchObject({ cap_applied: false, minimum_applied: false });
  });

  it("aplica el tope del convenio sobre la base", () => {
    const r = severance(1000000, 3, 800000);
    expect(r.amount).toBe(2400000);
    expect(r.breakdown.cap_applied).toBe(true);
  });

  it("un tope mayor a la base no se aplica", () => {
    const r = severance(1000000, 2, 5000000);
    expect(r.amount).toBe(2000000);
    expect(r.breakdown.cap_applied).toBe(false);
  });

  it("garantiza un mes de sueldo aunque la antigüedad sea menor al año", () => {
    const r = severance(1000000, 0);
    expect(r.amount).toBe(1000000);
    expect(r.breakdown.minimum_applied).toBe(true);
  });

  it("el mínimo se calcula sobre la base sin tope", () => {
    expect(severance(1000000, 1, 300000).amount).toBe(1000000);
  });

  it("en período de prueba no corresponde", () => {
    expect(severance(1000000, 1, null, true).amount).toBe(0);
  });
});

describe("noticePay (arts. 231/232)", () => {
  const under5 = seniority("2024-01-01", "2026-10-31");
  const over5 = seniority("2019-01-01", "2026-10-31");

  it("1 mes hasta 5 años, 2 meses si supera los 5", () => {
    expect(noticeMonths(seniority("2021-11-01", "2026-10-31"))).toBe(1); // 5 años justos
    expect(noticeMonths(seniority("2021-10-31", "2026-10-31"))).toBe(2); // 5 años y un día
    expect(noticePay(1000000, under5, "none", "dismissal_without_cause").amount).toBe(1000000);
    expect(noticePay(1000000, over5, "none", "dismissal_without_cause").amount).toBe(2000000);
  });

  it("no corresponde si la empresa preavisó completo", () => {
    const r = noticePay(1000000, under5, "full", "dismissal_without_cause");
    expect(r.amount).toBe(0);
    expect(r.breakdown.applies).toBe(false);
  });

  it("paga la parte no otorgada de un preaviso parcial, en proporción a los días", () => {
    // 15 de 30 días otorgados → la mitad
    const r = noticePay(1000000, under5, "partial", "dismissal_without_cause", { start: "2026-10-01", end: "2026-10-15" });
    expect(r.amount).toBe(500000);
    expect(r.breakdown).toMatchObject({ given_days: 15, entitled_days: 30 });
  });

  it("un preaviso parcial sin fechas no inventa un monto", () => {
    const r = noticePay(1000000, under5, "partial", "dismissal_without_cause");
    expect(r.amount).toBe(0);
    expect(r.breakdown.reason).toMatch(/fechas/);
  });

  it("en período de prueba y fuera del despido sin causa es 0", () => {
    expect(noticePay(1000000, seniority("2026-06-01", "2026-10-31"), "none", "dismissal_without_cause").amount).toBe(0);
    expect(noticePay(1000000, under5, "none", "resignation").amount).toBe(0);
  });
});

describe("monthIntegration (art. 233)", () => {
  it("base / días del mes × días que faltan", () => {
    // octubre: 31 días; egreso el 20 → faltan 11
    const r = monthIntegration(3100000, "2026-10-20", "none", "dismissal_without_cause");
    expect(r.amount).toBe(1100000);
    expect(r.breakdown).toMatchObject({ month_days: 31, remaining_days: 11 });
  });

  it("es 0 si el egreso es el último día del mes", () => {
    const r = monthIntegration(3100000, "2026-10-31", "none", "dismissal_without_cause");
    expect(r.amount).toBe(0);
    expect(r.breakdown.applies).toBe(false);
  });

  it("es 0 si hubo preaviso (completo o parcial) o en período de prueba", () => {
    expect(monthIntegration(3100000, "2026-10-20", "full", "dismissal_without_cause").amount).toBe(0);
    expect(monthIntegration(3100000, "2026-10-20", "partial", "dismissal_without_cause").amount).toBe(0);
    expect(monthIntegration(3100000, "2026-10-20", "none", "dismissal_without_cause", true).amount).toBe(0);
  });

  it("febrero usa sus propios días", () => {
    expect(monthIntegration(2800000, "2027-02-14", "none", "dismissal_without_cause").amount).toBe(1400000);
  });
});

describe("vacaciones no gozadas (art. 156)", () => {
  it("valor del día: sueldo/25 para fijos, 8 h × valor hora para jornalizados", () => {
    expect(vacationDailyRate({ pay_type: "monthly", monthly_salary: 1000000 })).toBe(40000);
    expect(vacationDailyRate({ pay_type: "biweekly_fixed", monthly_salary: 500000 })).toBe(40000);
    expect(vacationDailyRate({ pay_type: "hourly", hourly_rate: 5000 })).toBe(40000);
  });

  it("proporcional a los días trabajados del año menos los gozados", () => {
    // 14 días × 365/365 = 14; gozó 4 → 10 días
    const r = unusedVacation({ correspondingDays: 14, takenDays: 4, hireDate: "2020-01-01", terminationDate: "2026-12-31", dailyRate: 40000 });
    expect(r.breakdown).toMatchObject({ worked_days_in_year: 365, earned_days: 14, unused_days: 10 });
    expect(r.amount).toBe(400000);
  });

  it("a mitad de año solo devenga la parte trabajada", () => {
    // 1/1 al 30/6 = 181 días → 28 × 181/365 = 13.88
    const r = unusedVacation({ correspondingDays: 28, takenDays: 0, hireDate: "2000-01-01", terminationDate: "2026-06-30", dailyRate: 10000 });
    expect(r.breakdown.worked_days_in_year).toBe(181);
    expect(r.breakdown.unused_days).toBe(13.88);
  });

  it("si ingresó en el año cuenta desde el ingreso", () => {
    const r = unusedVacation({ correspondingDays: 14, takenDays: 0, hireDate: "2026-07-01", terminationDate: "2026-12-31", dailyRate: 1000 });
    expect(r.breakdown.worked_days_in_year).toBe(184);
  });

  it("nunca da negativo si gozó de más", () => {
    const r = unusedVacation({ correspondingDays: 14, takenDays: 14, hireDate: "2020-01-01", terminationDate: "2026-03-31", dailyRate: 40000 });
    expect(r.breakdown.unused_days).toBe(0);
    expect(r.amount).toBe(0);
  });
});

describe("sacOn", () => {
  it("monto / 12", () => {
    expect(sacOn(1200000)).toBe(100000);
    expect(sacOn(0)).toBe(0);
  });
});

describe("haberes del período no liquidado", () => {
  it("el rango arranca el día siguiente a la última quincena liquidada", () => {
    expect(unliquidatedRange({ lastPaidEndDate: "2026-10-15", hireDate: "2024-01-01", terminationDate: "2026-10-20" }))
      .toEqual({ from: "2026-10-16", to: "2026-10-20", days: 5, overpaid: false });
  });

  it("sin liquidaciones previas arranca en el ingreso", () => {
    expect(unliquidatedRange({ lastPaidEndDate: null, hireDate: "2026-10-10", terminationDate: "2026-10-20" }).days).toBe(11);
  });

  it("si la última quincena termina después del egreso, devuelve lo pagado de más", () => {
    expect(unliquidatedRange({ lastPaidEndDate: "2026-10-31", hireDate: "2024-01-01", terminationDate: "2026-10-20" }))
      .toEqual({ from: "2026-10-21", to: "2026-10-31", days: 11, overpaid: true });
  });

  it("prorratea un mensualizado: sueldo/30 × días", () => {
    const r = prorateFixedSalary(900000, "2026-11-01", "2026-11-12");
    expect(r.days).toBe(12);
    expect(r.amount).toBe(360000);
  });

  it("un mes completo vale el sueldo entero aunque tenga 31 días", () => {
    expect(prorateFixedSalary(900000, "2026-10-01", "2026-10-31").amount).toBe(900000);
    expect(prorateFixedSalary(900000, "2026-02-01", "2026-02-28").amount).toBe(840000); // 28 días reales de 30
  });

  it("cruza meses sumando cada tramo", () => {
    const r = prorateFixedSalary(900000, "2026-10-16", "2026-11-12");
    expect(r.months).toEqual([
      { year: 2026, month: 10, days: 16, counted_days: 16 },
      { year: 2026, month: 11, days: 12, counted_days: 12 },
    ]);
    expect(r.amount).toBe(840000);
  });

  it("el quincenal fijo entra con su sueldo mensual equivalente", () => {
    // quincenal 450000 → mensual equivalente 900000; 15 días = 450000
    expect(prorateFixedSalary(450000 * 2, "2026-11-01", "2026-11-15").amount).toBe(450000);
  });
});

describe("assembleConcepts", () => {
  const piece = (amount, breakdown = {}) => ({ amount, breakdown });
  const base = {
    wages: piece(300000),
    sacProportional: piece(100000),
    vacation: piece(240000),
    notice: piece(1000000, { applies: true }),
    integration: piece(400000, { applies: true }),
    severance: piece(3000000),
  };
  const amountOf = (r, key) => r.items.find((i) => i.key === key)?.amount;

  it("renuncia: solo conceptos remunerativos, sin preaviso ni art. 245", () => {
    const r = assembleConcepts({ ...base, type: "resignation" });
    expect(r.items.map((i) => i.key)).toEqual(["wages", "sac_proportional", "vacation_unused", "vacation_unused_sac"]);
    expect(r.remunerative_total).toBe(660000);
    expect(r.indemnity_total).toBe(0);
    expect(r.gross_total).toBe(660000);
  });

  it("despido sin causa: suma preaviso, integración, art. 245 y sus SAC en lo indemnizatorio", () => {
    const r = assembleConcepts({ ...base, type: "dismissal_without_cause" });
    expect(amountOf(r, "notice_pay_sac")).toBe(83333.33);
    expect(amountOf(r, "month_integration_sac")).toBe(33333.33);
    expect(r.indemnity_total).toBe(4516666.66);
    expect(r.gross_total).toBe(5176666.66);
  });

  it("los conceptos que no aplican figuran con su motivo pero no suman", () => {
    const r = assembleConcepts({
      ...base, type: "dismissal_without_cause",
      notice: piece(0, { applies: false, reason: "La empresa preavisó." }),
      integration: piece(0, { applies: false, reason: "Hubo preaviso." }),
    });
    expect(r.items.find((i) => i.key === "notice_pay").applies).toBe(false);
    expect(r.indemnity_total).toBe(3000000);
  });

  it("mutuo acuerdo: preaviso, integración y art. 245 solo como referencia", () => {
    const r = assembleConcepts({ ...base, type: "mutual_agreement" });
    for (const key of ["notice_pay", "month_integration", "severance"]) {
      expect(r.items.find((i) => i.key === key).reference_only).toBe(true);
    }
    expect(r.indemnity_total).toBe(0);
    expect(r.gross_total).toBe(660000);
    expect(r.items.find((i) => i.key === "severance_agreed").applies).toBe(false);
  });

  it("mutuo acuerdo con gratificación pactada la suma al total", () => {
    const r = assembleConcepts({ ...base, type: "mutual_agreement", agreedSeverance: 2000000 });
    expect(r.indemnity_total).toBe(2000000);
  });

  it("con un acuerdo de pago, la indemnización de un despido sin causa queda como referencia", () => {
    const r = assembleConcepts({ ...base, type: "dismissal_without_cause", indemnityViaAgreement: true });
    for (const key of ["notice_pay", "notice_pay_sac", "month_integration", "month_integration_sac", "severance"]) {
      expect(r.items.find((i) => i.key === key).reference_only).toBe(true);
    }
    expect(r.indemnity_total).toBe(0);
    expect(r.gross_total).toBe(660000);
  });

  it("con un acuerdo en el mutuo acuerdo, la gratificación pactada figura pero no suma a la final", () => {
    const r = assembleConcepts({ ...base, type: "mutual_agreement", indemnityViaAgreement: true, agreedSeverance: 2000000 });
    const agreed = r.items.find((i) => i.key === "severance_agreed");
    expect(agreed).toMatchObject({ amount: 2000000, applies: true, reference_only: true });
    expect(r.indemnity_total).toBe(0);
  });

  it("los haberes pagados de más restan", () => {
    const r = assembleConcepts({ ...base, type: "resignation", wages: piece(-120000) });
    expect(r.items[0].label).toBe("Haberes pagados de más");
    expect(r.remunerative_total).toBe(240000);
  });

  it("apagar el SAC de un concepto lo saca del desglose", () => {
    const r = assembleConcepts({ ...base, type: "resignation", sacOnFlags: { sac_on_vacation: false } });
    expect(r.items.find((i) => i.key === "vacation_unused_sac")).toBeUndefined();
  });

  it("suma los SAC de semestres anteriores pendientes", () => {
    const r = assembleConcepts({ ...base, type: "resignation", sacPreviousSemesters: [{ year: 2026, semester: 1, label: "SAC 1er semestre 2026", amount: 50000 }] });
    expect(amountOf(r, "sac_previous_2026_1")).toBe(50000);
    expect(r.remunerative_total).toBe(710000);
  });
});
