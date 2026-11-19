const { sendServerError } = require("../helpers/httpErrors");
const { liveInvoicesByOca } = require("../services/ocaBillingService");

/**
 * Una OCA que ya tiene una factura vigente no se modifica (FLOWS.md §74): la factura congela su importe, y cambiar las horas, el valor hora o el estado de
 * la OCA después dejaría la OCA y la factura diciendo cosas distintas. Para tocarla primero se anula la factura (eso libera la OCA). Va en las rutas de
 * OCA que cambian horas, precio o estado, después de authPermission.
 */
module.exports = async function blockIfOcaBilled(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return next();
    const billed = await liveInvoicesByOca([id]);
    if (billed.has(id)) {
      return res.status(409).json({ error: "La OCA ya está facturada: anulá la factura para poder modificarla.", code: "oca_billed" });
    }
    return next();
  } catch (error) {
    return sendServerError(res, error);
  }
};
