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

const FREQUENCIES = ["monthly", "biweekly"];
const DEFAULT_FREQUENCY = "biweekly";

/**
 * Tasa que se cobra en CADA cuota. El interés se carga siempre como "mensual"; en cuotas
 * quincenales cada cuota cobra la mitad sobre el saldo.
 * @param {number} monthlyPercent
 * @param {'monthly'|'biweekly'} frequency
 */
function periodicInterestPercent(monthlyPercent, frequency) {
  const monthly = Number(monthlyPercent || 0);
  return frequency === "biweekly" ? monthly / 2 : monthly;
}

/**
 * Posición absoluta de una quincena en el tiempo: permite ordenar y comparar quincenas
 * (vencimiento de una cuota vs. período de liquidación vs. hoy) con un solo número.
 * @param {number} year
 * @param {number} month - 1-12
 * @param {'first_half'|'second_half'} half
 */
function quincenaIndex(year, month, half) {
  return Number(year) * 24 + (Number(month) - 1) * 2 + (half === "second_half" ? 1 : 0);
}

/** Quincena (año, mes, mitad) en la que cae una fecha 'YYYY-MM-DD'. */
function quincenaOfDate(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return { year: d.getFullYear(), month: d.getMonth() + 1, half: d.getDate() <= 15 ? "first_half" : "second_half" };
}

/**
 * Arma los registros completos de `LoanInstallment` (schedule + a qué mes/quincena vence cada
 * una), listos para `LoanInstallment.bulkCreate`.
 *
 * - Mensual: la cuota 1 vence el MES SIGUIENTE al de `start_date`, en la quincena del día de
 *   entrega (o siempre en la 2ª con `forceSecondHalf`, para mensualizados).
 * - Quincenal: la cuota 1 vence la QUINCENA SIGUIENTE a la de `start_date`; después alternan
 *   1ª/2ª pasando de mes y de año.
 * @param {object} params
 * @param {number} params.loanId
 * @param {string} params.startDate - 'YYYY-MM-DD'
 * @param {number} params.amount
 * @param {number} params.monthlyInterestPercent - siempre mensual; se convierte según `frequency`
 * @param {number} params.numInstallments
 * @param {'monthly'|'biweekly'} [params.frequency='monthly']
 * @param {boolean} [params.forceSecondHalf=false] - solo mensual
 * @returns {{ installmentAmount: number, duePeriodType: 'first_half'|'second_half'|null, records: Array<object> }}
 *   `duePeriodType` es null en quincenal (cada cuota trae el suyo).
 */
function buildInstallmentRecords({
  loanId, startDate, amount, monthlyInterestPercent, numInstallments,
  frequency = "monthly", forceSecondHalf = false,
}) {
  if (!FREQUENCIES.includes(frequency)) throw new Error("Frecuencia de cuotas inválida.");

  const { installmentAmount, rows } = computeFrenchSchedule({
    amount,
    monthlyInterestPercent: periodicInterestPercent(monthlyInterestPercent, frequency),
    numInstallments,
  });

  const start = new Date(`${startDate}T00:00:00`);
  let month = start.getMonth() + 1; // 1-12
  let year = start.getFullYear();

  if (frequency === "biweekly") {
    // Arranca en la quincena siguiente a la de entrega.
    let half = resolveDuePeriodType(startDate);
    const advance = () => {
      if (half === "first_half") {
        half = "second_half";
      } else {
        half = "first_half";
        month += 1;
        if (month > 12) { month = 1; year += 1; }
      }
    };
    advance();
    const records = rows.map((row) => {
      const record = { loan_id: loanId, due_month: month, due_year: year, due_period_type: half, status: "scheduled", ...row };
      advance();
      return record;
    });
    return { installmentAmount, duePeriodType: null, records };
  }

  const duePeriodType = forceSecondHalf ? "second_half" : resolveDuePeriodType(startDate);
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

module.exports = {
  round2,
  computeFrenchSchedule,
  resolveDuePeriodType,
  periodicInterestPercent,
  quincenaIndex,
  quincenaOfDate,
  buildInstallmentRecords,
  FREQUENCIES,
  DEFAULT_FREQUENCY,
};
