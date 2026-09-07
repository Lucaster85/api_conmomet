/**
 * Amortización francesa para préstamos `plan_type: 'fixed_installments'`.
 *
 * Cada cuota separa capital e interés (interés sobre el saldo restante) a propósito: es lo que
 * permite la cancelación anticipada sin recalcular nada — "no cobrar el interés" de una cuota es
 * simplemente no incluirlo en el pago (ver loanController.prepayInstallments).
 *
 * Ojo: esta misma fórmula está reimplementada en el frontend
 * (conmomet-app/src/utils/loanAmortization.ts) solo para mostrar un preview en vivo en el
 * formulario de alta — no comparten paquete. Si se cambia la fórmula acá, hay que cambiarla ahí
 * también.
 */

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Calcula la tabla de amortización francesa completa.
 * @param {object} params
 * @param {number} params.amount - Capital original del préstamo.
 * @param {number} params.monthlyInterestPercent - Tasa mensual nominal (puede ser 0).
 * @param {number} params.numInstallments - Cantidad de cuotas (entero > 0).
 * @returns {{ installmentAmount: number, rows: Array<{installment_number:number, principal_amount:number, interest_amount:number, total_amount:number, remaining_principal_after:number}> }}
 */
function computeFrenchSchedule({ amount, monthlyInterestPercent, numInstallments }) {
  const P = Number(amount);
  const n = Number(numInstallments);
  const i = Number(monthlyInterestPercent || 0) / 100;

  if (!(P > 0)) throw new Error("El monto debe ser mayor a cero.");
  if (!Number.isInteger(n) || n <= 0) throw new Error("La cantidad de cuotas debe ser un entero mayor a cero.");

  const installmentAmount = i > 0
    ? round2((P * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1))
    : round2(P / n);

  const rows = [];
  let balance = P;

  for (let k = 1; k <= n; k++) {
    const interestAmount = round2(balance * i);
    // La última cuota cierra el saldo exacto, absorbiendo el arrastre de redondeo de las
    // anteriores — práctica estándar de amortización francesa.
    const principalAmount = k < n ? round2(installmentAmount - interestAmount) : balance;
    const totalAmount = round2(principalAmount + interestAmount);
    balance = round2(balance - principalAmount);

    rows.push({
      installment_number: k,
      principal_amount: principalAmount,
      interest_amount: interestAmount,
      total_amount: totalAmount,
      remaining_principal_after: balance,
    });
  }

  return { installmentAmount, rows };
}

/** ≤15 → primera quincena del mes, si no → segunda. */
function resolveDuePeriodType(startDate) {
  const day = new Date(`${startDate}T00:00:00`).getDate();
  return day <= 15 ? "first_half" : "second_half";
}

/**
 * Arma los registros completos de `LoanInstallment` (schedule + a qué mes/quincena vence cada
 * una), listos para `LoanInstallment.bulkCreate`. La cuota 1 vence el MES SIGUIENTE al de
 * `start_date` — nunca el mismo mes en que se entrega el préstamo.
 * @param {object} params
 * @param {number} params.loanId
 * @param {string} params.startDate - 'YYYY-MM-DD'
 * @param {number} params.amount
 * @param {number} params.monthlyInterestPercent
 * @param {number} params.numInstallments
 * @returns {{ installmentAmount: number, duePeriodType: 'first_half'|'second_half', records: Array<object> }}
 */
function buildInstallmentRecords({ loanId, startDate, amount, monthlyInterestPercent, numInstallments }) {
  const { installmentAmount, rows } = computeFrenchSchedule({ amount, monthlyInterestPercent, numInstallments });
  const duePeriodType = resolveDuePeriodType(startDate);

  const start = new Date(`${startDate}T00:00:00`);
  let month = start.getMonth() + 1; // 1-12
  let year = start.getFullYear();
  // Arranca en el mes siguiente al de start_date.
  month += 1;
  if (month > 12) { month = 1; year += 1; }

  const records = rows.map((row) => {
    const record = {
      loan_id: loanId,
      due_month: month,
      due_year: year,
      due_period_type: duePeriodType,
      status: "scheduled",
      ...row,
    };
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    return record;
  });

  return { installmentAmount, duePeriodType, records };
}

module.exports = { round2, computeFrenchSchedule, resolveDuePeriodType, buildInstallmentRecords };
