"use strict";
// Vacaciones por antigüedad (art. 150) y proporcional del año de ingreso (arts. 151 a 153).
// 2026: 313 días de lunes a sábado y 261 de lunes a viernes (365 días, 52 domingos y 52 sábados).
const { calculateVacationDays, calculateVacationEntitlement, countWorkdays } = require("../../helpers/vacationDays");

describe("countWorkdays", () => {
  it("cuenta lunes a sábado en el año 2026", () => {
    expect(countWorkdays("2026-01-01", "2026-12-31", "mon_sat")).toBe(313);
  });

  it("cuenta lunes a viernes en el año 2026", () => {
    expect(countWorkdays("2026-01-01", "2026-12-31", "mon_fri")).toBe(261);
  });

  it("no cuenta los domingos", () => {
    // 2026-11-01 es domingo
    expect(countWorkdays("2026-11-01", "2026-11-01", "mon_sat")).toBe(0);
    expect(countWorkdays("2026-11-02", "2026-11-07", "mon_sat")).toBe(6);
  });

  it("el sábado cuenta solo en lunes a sábado", () => {
    // 2026-11-07 es sábado
    expect(countWorkdays("2026-11-07", "2026-11-07", "mon_sat")).toBe(1);
    expect(countWorkdays("2026-11-07", "2026-11-07", "mon_fri")).toBe(0);
  });

  it("devuelve 0 si la fecha final es anterior a la inicial", () => {
    expect(countWorkdays("2026-12-31", "2026-01-01")).toBe(0);
  });
});

describe("calculateVacationDays (antigüedad al 31/12)", () => {
  it("14 días hasta 5 años, 21 hasta 10, 28 hasta 20 y 35 de ahí en adelante", () => {
    expect(calculateVacationDays("2024-03-01", 2026)).toBe(14);
    expect(calculateVacationDays("2019-03-01", 2026)).toBe(21);
    expect(calculateVacationDays("2012-03-01", 2026)).toBe(28);
    expect(calculateVacationDays("2000-03-01", 2026)).toBe(35);
  });

  it("devuelve 0 sin fecha de ingreso", () => {
    expect(calculateVacationDays(null, 2026)).toBe(0);
  });
});

describe("calculateVacationEntitlement", () => {
  it("el que ingresó antes del año tiene los días completos por antigüedad", () => {
    const r = calculateVacationEntitlement({ hireDate: "2020-03-01", year: 2026 });

    expect(r.days).toBe(21);
    expect(r.is_proportional).toBe(false);
  });

  it("el que ingresó el 1/1 trabaja el año entero y tiene los 14 días", () => {
    const r = calculateVacationEntitlement({ hireDate: "2026-01-01", year: 2026 });

    expect(r.days).toBe(14);
    expect(r.is_proportional).toBe(false);
  });

  it("si trabaja la mitad o más de los días hábiles del año, tiene los 14 días", () => {
    // Desde el 1/6 hasta el 31/12 hay 184 días hábiles (lunes a sábado): más que la mitad (157).
    const r = calculateVacationEntitlement({ hireDate: "2026-06-01", year: 2026 });

    expect(r.days).toBe(14);
    expect(r.is_proportional).toBe(false);
    expect(r.worked_days).toBe(184);
    expect(r.required_days).toBe(157);
  });

  it("si no llega a la mitad, 1 día cada 20 trabajados, hacia abajo", () => {
    // Desde el 1/8 hay 131 días hábiles: 131 / 20 = 6,55 → 6 días.
    const r = calculateVacationEntitlement({ hireDate: "2026-08-01", year: 2026 });

    expect(r.days).toBe(6);
    expect(r.full_days).toBe(14);
    expect(r.is_proportional).toBe(true);
    expect(r.worked_days).toBe(131);
  });

  it("justo en la mitad tiene los días completos y un día hábil menos queda proporcional", () => {
    // Para 313 días hábiles se necesitan 157: desde el 2/7 hay 157 y desde el 3/7 hay 156.
    const atHalf = calculateVacationEntitlement({ hireDate: "2026-07-02", year: 2026 });
    expect(atHalf.worked_days).toBe(157);
    expect(atHalf.is_proportional).toBe(false);
    expect(atHalf.days).toBe(14);

    const justBelow = calculateVacationEntitlement({ hireDate: "2026-07-03", year: 2026 });
    expect(justBelow.worked_days).toBe(156);
    expect(justBelow.is_proportional).toBe(true);
    expect(justBelow.days).toBe(7);
  });

  it("de lunes a viernes la mitad es menor (131 días) y los días hábiles cambian", () => {
    const r = calculateVacationEntitlement({ hireDate: "2026-08-01", year: 2026, workWeek: "mon_fri" });

    expect(r.year_workdays).toBe(261);
    expect(r.required_days).toBe(131);
    expect(r.is_proportional).toBe(true);
  });

  it("las faltas injustificadas no cuentan como trabajadas", () => {
    // Desde el 1/6 son 184 días hábiles; con 30 faltas quedan 154, menos que 157, y pasa a proporcional.
    const r = calculateVacationEntitlement({ hireDate: "2026-06-01", year: 2026, unjustifiedAbsenceDays: 30 });

    expect(r.worked_days).toBe(154);
    expect(r.is_proportional).toBe(true);
    expect(r.days).toBe(7);
  });

  it("si ingresa en un año posterior todavía no le corresponde nada", () => {
    const r = calculateVacationEntitlement({ hireDate: "2027-02-01", year: 2026 });

    expect(r.days).toBe(0);
  });

  it("devuelve 0 sin fecha de ingreso", () => {
    expect(calculateVacationEntitlement({ hireDate: null, year: 2026 }).days).toBe(0);
  });
});
