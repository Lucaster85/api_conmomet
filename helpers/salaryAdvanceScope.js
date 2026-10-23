const { Op } = require("sequelize");

// Criterio único de "adelanto que se le descuenta al empleado": aprobado Y efectivamente
// entregado. Uno pending o approved-sin-pagar todavía no significa que se le haya dado plata, y
// uno rejected/cancelled nunca descuenta.
//
// Existe porque desde que "eliminar" un adelanto pagado pasó a ser anular (status "cancelled", ver
// salaryAdvanceController#delete), el paranoid:true del modelo ya no esconde la fila: toda
// consulta que no filtre por estado vuelve a traer los anulados. Pasó en el detalle de
// liquidación (GET /payroll/:id), que mostraba el adelanto anulado como línea de descuento
// aunque el neto ya no lo contaba.
//
// Usado por: payrollController#getByPeriod (detalle), payrollController#generate (cálculo),
// salaryAdvanceController#syncPeriodAdvancesDeducted (recálculo al anular/reasignar) y
// expenseSummaryController#monthly (total informativo).
const deductibleAdvanceWhere = () => ({
  status: "approved",
  paid_at: { [Op.ne]: null },
});

module.exports = { deductibleAdvanceWhere };
