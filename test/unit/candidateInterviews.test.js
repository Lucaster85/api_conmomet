"use strict";
const { parseScheduleBody, parseResultBody } = require("../../helpers/candidateInterviews");

describe("parseScheduleBody", () => {
  const ok = { scheduled_at: "2026-12-01T13:00:00.000Z", duration_minutes: "45", modality: "video", location: "  https://meet.test/x  " };

  it("normaliza los datos de agenda", () => {
    const { data } = parseScheduleBody(ok);
    expect(data.scheduled_at.toISOString()).toBe("2026-12-01T13:00:00.000Z");
    expect(data).toMatchObject({ duration_minutes: 45, modality: "video", location: "https://meet.test/x" });
  });

  it("usa 60 minutos y presencial como defecto cuando no vienen (solo en el alta)", () => {
    const { data } = parseScheduleBody({ scheduled_at: ok.scheduled_at });
    expect(data.duration_minutes).toBe(60);
    expect(data.modality).toBeUndefined();
  });

  it.each([
    [{ scheduled_at: "" }, /fecha y hora/],
    [{ scheduled_at: "no-es-fecha" }, /fecha y hora/],
    [{ scheduled_at: "2026-12-01T10:00:00Z", duration_minutes: 1 }, /duración/],
    [{ scheduled_at: "2026-12-01T10:00:00Z", duration_minutes: 9999 }, /duración/],
    [{ scheduled_at: "2026-12-01T10:00:00Z", duration_minutes: 30.5 }, /duración/],
    [{ scheduled_at: "2026-12-01T10:00:00Z", modality: "telepatia" }, /modalidad/],
  ])("rechaza datos inválidos %#", (body, message) => {
    expect(parseScheduleBody(body).error).toMatch(message);
  });

  it("en edición parcial solo valida lo que vino", () => {
    expect(parseScheduleBody({}, { partial: true }).data).toEqual({});
    expect(parseScheduleBody({ location: "Oficina" }, { partial: true }).data).toEqual({ location: "Oficina" });
    expect(parseScheduleBody({ duration_minutes: 2 }, { partial: true }).error).toMatch(/duración/);
  });
});

describe("parseResultBody", () => {
  it("acepta puntaje 1 a 5, recomendación y devolución opcional", () => {
    expect(parseResultBody({ rating: "4", recommendation: "advance", feedback: " Muy bien " }).data).toEqual({ rating: 4, recommendation: "advance", feedback: "Muy bien" });
    expect(parseResultBody({ rating: 1, recommendation: "reject" }).data.feedback).toBeNull();
  });

  it.each([[0], [6], [3.5], ["x"], [undefined]])("rechaza el puntaje %p", (rating) => {
    expect(parseResultBody({ rating, recommendation: "hold" }).error).toMatch(/puntaje/);
  });

  it("rechaza una recomendación inexistente o ausente", () => {
    expect(parseResultBody({ rating: 3, recommendation: "ni idea" }).error).toMatch(/recomendación/);
    expect(parseResultBody({ rating: 3 }).error).toMatch(/recomendación/);
  });
});
