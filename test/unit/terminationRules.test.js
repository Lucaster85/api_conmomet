"use strict";
const {
  addBusinessDays,
  paymentDeadline,
  art80Deadline,
  normalizeTerminationFields,
  buildWarnings,
  TERMINATION_DOCUMENT_CATEGORIES,
} = require("../../helpers/terminationRules");

describe("plazos legales", () => {
  it("suma días hábiles salteando fin de semana", () => {
    // 2026-11-05 es jueves: +4 hábiles = vie 6, lun 9, mar 10, mié 11
    expect(addBusinessDays("2026-11-05", 4)).toBe("2026-11-11");
  });

  it("saltea feriados", () => {
    expect(addBusinessDays("2026-11-05", 4, ["2026-11-09"])).toBe("2026-11-12");
  });

  it("arranca a contar desde el día siguiente aunque el egreso caiga en fin de semana", () => {
    // sábado 7: lun 9, mar 10, mié 11, jue 12
    expect(paymentDeadline("2026-11-07", [])).toBe("2026-11-12");
  });

  it("el certificado del art. 80 vence a los 30 días corridos", () => {
    expect(art80Deadline("2026-11-02")).toBe("2026-12-02");
    expect(art80Deadline("2026-12-20")).toBe("2027-01-19");
  });
});

describe("normalizeTerminationFields", () => {
  const base = { type: "resignation", termination_date: "2026-10-31" };

  it("acepta una renuncia mínima", () => {
    const { errors, values } = normalizeTerminationFields(base, { hireDate: "2024-01-01" });
    expect(errors).toEqual([]);
    expect(values).toMatchObject({ type: "resignation", termination_date: "2026-10-31", notice_given: "none" });
  });

  it("exige tipo válido y fecha de egreso", () => {
    expect(normalizeTerminationFields({}, {}).errors.length).toBeGreaterThanOrEqual(2);
    expect(normalizeTerminationFields({ type: "otro", termination_date: "2026-10-31" }, {}).errors).toHaveLength(1);
  });

  it("rechaza fechas inválidas y egreso anterior al ingreso", () => {
    expect(normalizeTerminationFields({ ...base, termination_date: "31/10/2026" }, {}).errors[0]).toMatch(/fecha válida/);
    expect(normalizeTerminationFields({ ...base, termination_date: "2026-02-30" }, {}).errors[0]).toMatch(/fecha válida/);
    expect(normalizeTerminationFields(base, { hireDate: "2026-11-01" }).errors[0]).toMatch(/anterior a la fecha de ingreso/);
  });

  it("el despido con causa exige la causa", () => {
    const input = { type: "dismissal_with_cause", termination_date: "2026-10-31", cause_description: "   " };
    expect(normalizeTerminationFields(input, {}).errors[0]).toMatch(/causa/);
    expect(normalizeTerminationFields({ ...input, cause_description: "Abandono de tareas" }, {}).errors).toEqual([]);
  });

  it("el preaviso de la empresa solo aplica al despido sin causa", () => {
    const resignation = normalizeTerminationFields(
      { ...base, notice_given: "full", notice_start_date: "2026-10-01", notice_end_date: "2026-10-31" },
      {}
    );
    expect(resignation.values).toMatchObject({ notice_given: "none", notice_start_date: null, notice_end_date: null });

    const dismissal = normalizeTerminationFields(
      { type: "dismissal_without_cause", termination_date: "2026-10-31", notice_given: "full", notice_start_date: "2026-10-01", notice_end_date: "2026-10-31" },
      {}
    );
    expect(dismissal.errors).toEqual([]);
    expect(dismissal.values).toMatchObject({ notice_given: "full", notice_start_date: "2026-10-01", notice_end_date: "2026-10-31" });
  });

  it("rechaza un preaviso que termina antes de empezar", () => {
    const { errors } = normalizeTerminationFields(
      { type: "dismissal_without_cause", termination_date: "2026-10-31", notice_given: "partial", notice_start_date: "2026-10-20", notice_end_date: "2026-10-10" },
      {}
    );
    expect(errors[0]).toMatch(/fin del preaviso/);
  });

  it("el preaviso omitido del trabajador solo aplica a la renuncia", () => {
    expect(normalizeTerminationFields({ ...base, employee_notice_omitted: true }, {}).values.employee_notice_omitted).toBe(true);
    expect(
      normalizeTerminationFields({ type: "mutual_agreement", termination_date: "2026-10-31", employee_notice_omitted: true }, {}).values
        .employee_notice_omitted
    ).toBe(false);
  });

  it("el tope del convenio solo se guarda en despido sin causa o mutuo acuerdo, y no puede ser negativo", () => {
    expect(normalizeTerminationFields({ ...base, cct_cap_amount: 5000000 }, {}).values.cct_cap_amount).toBeNull();
    const dismissal = { type: "dismissal_without_cause", termination_date: "2026-10-31" };
    expect(normalizeTerminationFields({ ...dismissal, cct_cap_amount: "5000000" }, {}).values.cct_cap_amount).toBe(5000000);
    expect(normalizeTerminationFields({ ...dismissal, cct_cap_amount: -1 }, {}).errors[0]).toMatch(/tope/);
  });
});

describe("buildWarnings", () => {
  const doc = (category_name) => ({ category_name });

  it("avisa de la renuncia sin telegrama y deja de avisar al cargarlo", () => {
    const termination = { type: "resignation", status: "draft", termination_date: "2026-10-31" };
    expect(buildWarnings({ termination, documents: [], today: "2026-11-02" }).map((w) => w.code)).toEqual(["missing_resignation_letter"]);
    expect(
      buildWarnings({ termination, documents: [doc(TERMINATION_DOCUMENT_CATEGORIES.resignation)], today: "2026-11-02" })
    ).toEqual([]);
  });

  it("avisa del despido con causa sin carta documento y del mutuo acuerdo sin acta", () => {
    expect(
      buildWarnings({ termination: { type: "dismissal_with_cause", status: "draft", termination_date: "2026-10-31" }, documents: [], today: "2026-11-02" })[0].code
    ).toBe("missing_dismissal_letter");
    expect(
      buildWarnings({ termination: { type: "mutual_agreement", status: "draft", termination_date: "2026-10-31" }, documents: [], today: "2026-11-02" })[0].code
    ).toBe("missing_mutual_agreement_act");
  });

  it("el despido sin causa no pide un papel puntual", () => {
    expect(
      buildWarnings({ termination: { type: "dismissal_without_cause", status: "draft", termination_date: "2026-10-31" }, documents: [], today: "2026-11-02" })
    ).toEqual([]);
  });

  it("avisa del certificado del art. 80 solo con el egreso vigente y pasados los 30 días", () => {
    const confirmed = { type: "dismissal_without_cause", status: "confirmed", termination_date: "2026-10-01", art80_delivered_at: null };
    expect(buildWarnings({ termination: confirmed, documents: [], today: "2026-10-31" })).toEqual([]);
    expect(buildWarnings({ termination: confirmed, documents: [], today: "2026-11-01" })[0].code).toBe("art80_overdue");
    expect(buildWarnings({ termination: { ...confirmed, art80_delivered_at: "2026-10-20" }, documents: [], today: "2026-11-15" })).toEqual([]);
    expect(buildWarnings({ termination: { ...confirmed, status: "draft" }, documents: [], today: "2026-11-15" })).toEqual([]);
  });

  it("un egreso anulado no genera avisos", () => {
    expect(buildWarnings({ termination: { type: "resignation", status: "cancelled", termination_date: "2026-10-31" }, documents: [], today: "2026-11-02" })).toEqual([]);
  });
});
