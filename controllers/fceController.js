const { Op } = require("sequelize");
const db = require("../models");
const { sendServerError } = require("../helpers/httpErrors");
const { todayInArgentina } = require("../helpers/argentinaDate");
const { getArcaConfig } = require("../services/arca/credentials");
const { ArcaError } = require("../services/arca/errors");
const { CBTE_TIPO, FCE_TIPOS } = require("../services/arca/codes");
const fceSync = require("../services/arca/fceSync");

/**
 * Seguimiento de FCE con ARCA (wsfecred, FLOWS.md §77). Todo cuelga de /invoices: ver la pestaña es invoices_read y sincronizar (un POST) es invoices_write,
 * lo resuelve el path en middlewares/auth.js.
 */

const STATE_GROUPS = ["pending", "accepted", "rejected", "informed", "cancelled"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toNum = (v) => (v === null || v === undefined ? null : Number(v));

const sendError = (res, error) => {
  if (error instanceof ArcaError) {
    return res.status(error.code === "disabled" || error.code === "config" ? 409 : 502).json({ error: error.message, code: `arca_${error.code}` });
  }
  if (!error.status) return sendServerError(res, error);
  return res.status(error.status).json({ error: error.message });
};

// Días que le quedan al cliente para aceptar (negativo si ya venció), con el "hoy" de Argentina. null sin fecha.
function daysUntil(dateString, today) {
  if (!dateString) return null;
  return Math.round((new Date(`${String(dateString).slice(0, 10)}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
}

// Una FCE sin carpeta que mostrar (anulada en la app, cancelada totalmente o ya informada al ADC) queda fuera del listado salvo que se pida incluirla.
const isClosed = (inv, group) => inv.status === "cancelled" || group === "informed" || group === "cancelled";

function serializeRow(inv, notes, today) {
  const group = fceSync.stateGroup(inv);
  const manual = inv.manual_recipient;
  const annulmentNote = notes.find((n) => n.kind === "credit_note" && n.fce_annulment && n.status !== "cancelled" && n.arca_status === "authorized");
  return {
    id: inv.id,
    cbte_tipo: inv.cbte_tipo,
    pos_number: inv.pos_number,
    number: inv.number,
    issue_date: inv.issue_date,
    due_date: inv.due_date,
    currency: inv.currency,
    total_amount: toNum(inv.total_amount),
    status: inv.status,
    client: inv.client ? { id: inv.client.id, razonSocial: inv.client.razonSocial, cuit: inv.client.cuit } : manual ? { id: null, razonSocial: manual.legal_name, cuit: manual.cuit } : null,
    transfer_option: inv.fce_transfer_option,
    fce_acceptance: inv.fce_acceptance,
    fce_acceptance_at: inv.fce_acceptance_at,
    fce_cmp_state: inv.fce_cmp_state,
    fce_account_state: inv.fce_account_state,
    fce_account_code: toNum(inv.fce_account_code),
    fce_acceptance_type: inv.fce_acceptance_type,
    fce_available_at: inv.fce_available_at,
    fce_acceptance_due: inv.fce_acceptance_due,
    acceptance_days_left: inv.fce_acceptance_due && ["pending"].includes(group) ? daysUntil(inv.fce_acceptance_due, today) : null,
    fce_rejection_reasons: inv.fce_rejection_reasons || [],
    fce_balance: toNum(inv.fce_balance),
    fce_accepted_balance: toNum(inv.fce_accepted_balance),
    fce_synced_at: inv.fce_synced_at,
    group,
    adc_pending: group === "accepted" && inv.fce_transfer_option === "ADC" && inv.fce_account_state === "Aceptada",
    // El aviso de una rechazada se va solo cuando se emite la nota de crédito de anulación.
    annulment_note: annulmentNote ? { id: annulmentNote.id, number: annulmentNote.number, arca_status: annulmentNote.arca_status } : null,
    notes: notes.map((n) => ({
      id: n.id, kind: n.kind, cbte_tipo: n.cbte_tipo, pos_number: n.pos_number, number: n.number, total_amount: toNum(n.total_amount),
      fce_cmp_state: n.fce_cmp_state, status: n.status, arca_status: n.arca_status, fce_annulment: !!n.fce_annulment,
    })),
  };
}

module.exports = {
  // GET /invoices/fce — FCE emitidas por ARCA con su seguimiento. Filtros: client_id, state (pending|accepted|rejected|informed|cancelled), transfer_option, date_from, date_to,
  // include_closed. `summary` cuenta por grupo sin mirar el filtro `state` (así los chips siguen mostrando todo).
  list: async (req, res) => {
    try {
      const { client_id, state, transfer_option, date_from, date_to, include_closed } = req.query;
      if (state && !STATE_GROUPS.includes(state)) return res.status(400).json({ error: "El estado no es válido." });
      if (transfer_option && !["SCA", "ADC"].includes(transfer_option)) return res.status(400).json({ error: "La opción de transferencia no es válida." });
      for (const date of [date_from, date_to]) {
        if (date && !DATE_RE.test(date)) return res.status(400).json({ error: "La fecha no es válida." });
      }

      const config = getArcaConfig();
      const where = { source: "arca", arca_status: "authorized", kind: "invoice", cbte_tipo: CBTE_TIPO.FCE_A_FACTURA };
      if (client_id) where.client_id = client_id;
      if (transfer_option) where.fce_transfer_option = transfer_option;
      if (date_from || date_to) {
        where.issue_date = {};
        if (date_from) where.issue_date[Op.gte] = date_from;
        if (date_to) where.issue_date[Op.lte] = date_to;
      }

      const invoices = await db.Invoice.findAll({
        where,
        include: [{ model: db.Client, as: "client", attributes: ["id", "razonSocial", "cuit"] }],
        order: [["issue_date", "DESC"], ["id", "DESC"]],
      });
      const notes = invoices.length === 0 ? [] : await db.Invoice.findAll({
        where: { associated_invoice_id: { [Op.in]: invoices.map((inv) => inv.id) }, cbte_tipo: { [Op.in]: FCE_TIPOS }, source: "arca" },
        order: [["id", "ASC"]],
      });
      const notesByInvoice = new Map();
      notes.forEach((n) => notesByInvoice.set(n.associated_invoice_id, [...(notesByInvoice.get(n.associated_invoice_id) || []), n]));

      const today = todayInArgentina();
      const rows = invoices.map((inv) => serializeRow(inv, notesByInvoice.get(inv.id) || [], today));
      // Una factura anulada en la app no cuenta ni se muestra salvo que se pida incluir las cerradas.
      const visible = rows.filter((row) => include_closed === "true" || !isClosed(row, row.group));
      const summary = { pending: 0, accepted: 0, rejected: 0, informed: 0, cancelled: 0, adc_pending: 0, total: visible.length };
      visible.forEach((row) => {
        summary[row.group] += 1;
        if (row.adc_pending) summary.adc_pending += 1;
      });

      // Con un estado elegido a propósito se muestran también las cerradas de ese estado (igual que `status` en /invoices).
      const data = state ? rows.filter((row) => row.group === state && (include_closed === "true" || row.status !== "cancelled")) : visible;

      const setting = await db.SystemSetting.findByPk(1, { attributes: ["last_fce_sync_at"] });
      return res.status(200).json({ data, summary, last_sync_at: setting ? setting.last_fce_sync_at : null, arca_enabled: config.enabled });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // POST /invoices/fce/sync — sincroniza todas las FCE que todavía pueden cambiar.
  syncAll: async (req, res) => {
    try {
      const result = await fceSync.syncAll(req.user);
      return res.status(200).json({ data: result });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // POST /invoices/:id/fce/sync — sincroniza una sola (y sus notas).
  syncOne: async (req, res) => {
    try {
      const result = await fceSync.syncOne(req.params.id, req.user);
      return res.status(200).json({ data: result });
    } catch (error) {
      return sendError(res, error);
    }
  },

  // GET /invoices/:id/fce/history — historial de estados del comprobante y de su cuenta corriente, pedido a ARCA en el momento.
  history: async (req, res) => {
    try {
      return res.status(200).json({ data: await fceSync.history(req.params.id) });
    } catch (error) {
      return sendError(res, error);
    }
  },
};
