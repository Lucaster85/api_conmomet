"use strict";
const {
  STAGES,
  OPEN_STAGES,
  TRANSITIONS,
  REJECTION_REASONS,
  canTransition,
  isOpenStage,
} = require("../../helpers/candidateStages");

describe("mapa de transiciones de postulaciones", () => {
  it("define destinos para todas las etapas", () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...STAGES].sort());
  });

  it.each([
    ["new", "screening"],
    ["new", "interview"],
    ["new", "rejected"],
    ["new", "withdrawn"],
    ["screening", "interview"],
    ["screening", "offer"],
    ["interview", "offer"],
    ["offer", "rejected"],
    ["rejected", "screening"],
    ["withdrawn", "screening"],
  ])("permite pasar de %s a %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["new", "offer"],
    ["interview", "screening"],
    ["interview", "new"],
    ["rejected", "interview"],
    ["rejected", "withdrawn"],
    ["withdrawn", "rejected"],
    ["screening", "screening"],
  ])("rechaza pasar de %s a %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it("rechaza pedir 'hired' a mano aunque el mapa lo prevea desde 'offer'", () => {
    expect(TRANSITIONS.offer).toContain("hired");
    expect(canTransition("offer", "hired")).toBe(false);
  });

  it("'hired' es final: no sale de ahí", () => {
    for (const to of STAGES) expect(canTransition("hired", to)).toBe(false);
  });

  it("una etapa desconocida no tiene transiciones", () => {
    expect(canTransition("inexistente", "screening")).toBe(false);
  });
});

describe("etapas abiertas", () => {
  it("son las que no son un resultado final", () => {
    expect(OPEN_STAGES).toEqual(["new", "screening", "interview", "offer"]);
    expect(isOpenStage("interview")).toBe(true);
    expect(isOpenStage("rejected")).toBe(false);
    expect(isOpenStage("hired")).toBe(false);
    expect(isOpenStage("withdrawn")).toBe(false);
  });

  it("los motivos de rechazo incluyen 'other'", () => {
    expect(REJECTION_REASONS).toContain("other");
  });
});
