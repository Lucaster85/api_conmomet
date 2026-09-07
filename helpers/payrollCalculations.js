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

module.exports = { round2, computeNetAmount };
