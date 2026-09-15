// Fórmula única de neto de liquidación — antes estaba duplicada en 5 lugares distintos
// (payrollController.js x2, loanPaymentController.js x2, payrollAdjustmentController.js x1).
// Cualquier descuento automático nuevo (adelantos, cuotas de préstamo, lo que venga después) se
// agrega ACÁ una sola vez, para que ningún lugar quede desactualizado.
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * @param {object} params
 * @param {number} params.gross_amount
 * @param {number} params.deds - Suma de PayrollAdjustment tipo "deduction".
 * @param {number} [params.advances_deducted]
 * @param {number} [params.loan_installments_deducted]
 */
function computeNetAmount({ gross_amount, deds, advances_deducted, loan_installments_deducted }) {
  return round2(
    Number(gross_amount || 0)
    - Number(deds || 0)
    - Number(advances_deducted || 0)
    - Number(loan_installments_deducted || 0)
  );
}

// Fórmula única de horas extra de mensualizados — antes vivía solo inline dentro de
// generateFlexibleLines (payrollController.js). También la usa la generación del adelanto
// automático quincenal (SalaryAdvance source='biweekly_auto'), que necesita el mismo cálculo
// para las horas cargadas hasta el día 15. Cualquier cambio a esta fórmula se hace ACÁ una
// sola vez, para que liquidación real y adelanto automático nunca queden desalineados.
/**
 * @param {number} monthlySalary
 * @param {number} [baseRateExtrasRate] - EmployeeRate.extras_rate (concept_id null) si está configurado manualmente.
 * @param {Array} timeEntries - TimeEntry[] con overtime_50_hours/overtime_100_hours.
 * @returns {{ ot50Hours: number, ot100Hours: number, extrasRate50: number, extrasRate100: number, amount: number }}
 */
function calculateMonthlyOvertimeAmount(monthlySalary, baseRateExtrasRate, timeEntries) {
  const ot50Hours = round2(timeEntries.reduce((sum, te) => sum + parseFloat(te.overtime_50_hours || 0), 0));
  const ot100Hours = round2(timeEntries.reduce((sum, te) => sum + parseFloat(te.overtime_100_hours || 0), 0));

  if (ot50Hours <= 0 && ot100Hours <= 0) {
    return { ot50Hours: 0, ot100Hours: 0, extrasRate50: 0, extrasRate100: 0, amount: 0 };
  }

  const divisor = parseFloat(process.env.OVERTIME_DIVISOR || 200);
  let extrasRate100 = parseFloat(baseRateExtrasRate || 0);
  if (extrasRate100 <= 0 && monthlySalary > 0) {
    extrasRate100 = round2((monthlySalary / divisor) * 2.0);
  }
  if (extrasRate100 <= 0) {
    return { ot50Hours, ot100Hours, extrasRate50: 0, extrasRate100: 0, amount: 0 };
  }

  const extrasRate50 = round2(extrasRate100 * 0.75);
  const amount = round2(ot50Hours * extrasRate50 + ot100Hours * extrasRate100);
  return { ot50Hours, ot100Hours, extrasRate50, extrasRate100, amount };
}

module.exports = { round2, computeNetAmount, calculateMonthlyOvertimeAmount };
