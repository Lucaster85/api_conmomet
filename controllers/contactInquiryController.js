const { sendServerError } = require("../helpers/httpErrors");
const { Op } = require("sequelize");
const db = require("../models");

// Bandeja interna de las consultas que entran por el formulario de contacto (ver FLOWS.md §58).
// Se crean solo desde POST /public/contact; acá se listan, se toman, se cierran y se borran.

const REASONS = ["budget_request", "general", "supplier", "other"];
const STATUSES = ["new", "in_progress", "closed"];

const userInclude = (as) => ({ model: db.User, as, attributes: ["id", "name", "lastname"] });
const detailInclude = [userInclude("handledByUser"), userInclude("closedByUser")];

module.exports = {
  // GET /contact-inquiries?reason=&status=&q=&include_closed=
  // Mismo criterio que el resto de los listados (FLOWS.md §52): las cerradas se ocultan salvo que
  // se pidan, y un `status` explícito le gana al "ocultar cerradas".
  list: async (req, res) => {
    try {
      const { reason, status, q, include_closed } = req.query;
      const where = {};
      if (reason && REASONS.includes(reason)) where.reason = reason;
      if (status && STATUSES.includes(status)) where.status = status;
      else if (include_closed !== "true") where.status = { [Op.ne]: "closed" };
      if (q) {
        const like = `%${q}%`;
        where[Op.or] = [
          { name: { [Op.like]: like } },
          { company: { [Op.like]: like } },
          { email: { [Op.like]: like } },
          { phone: { [Op.like]: like } },
          { message: { [Op.like]: like } },
        ];
      }

      const inquiries = await db.ContactInquiry.findAll({
        where,
        include: detailInclude,
        order: [["created_at", "DESC"], ["id", "DESC"]],
      });
      return res.status(200).json({ data: inquiries });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  getById: async (req, res) => {
    try {
      const inquiry = await db.ContactInquiry.findByPk(req.params.id, { include: detailInclude });
      if (!inquiry) return res.status(404).json({ error: "Consulta no encontrada." });
      return res.status(200).json({ data: inquiry });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  // PUT /contact-inquiries/:id — estado y notas internas. Lo que llegó del visitante no se edita.
  // Pasar a "in_progress" registra quién la tomó; cerrar registra quién y cuándo. Reabrir limpia el
  // cierre, así la ficha nunca queda diciendo "cerrada por X" con la consulta otra vez abierta.
  update: async (req, res) => {
    try {
      const inquiry = await db.ContactInquiry.findByPk(req.params.id);
      if (!inquiry) return res.status(404).json({ error: "Consulta no encontrada." });

      const { status, internal_notes } = req.body || {};
      const patch = {};

      if (internal_notes !== undefined) {
        const notes = internal_notes === null ? "" : String(internal_notes).trim();
        patch.internal_notes = notes || null;
      }

      if (status !== undefined) {
        if (!STATUSES.includes(status)) {
          return res.status(400).json({ error: "Estado inválido." });
        }
        if (status !== inquiry.status) {
          const now = new Date();
          patch.status = status;
          if (status === "new") {
            patch.handled_by = null;
            patch.handled_at = null;
            patch.closed_by = null;
            patch.closed_at = null;
          } else if (status === "in_progress") {
            if (!inquiry.handled_by) {
              patch.handled_by = req.user.id;
              patch.handled_at = now;
            }
            patch.closed_by = null;
            patch.closed_at = null;
          } else if (status === "closed") {
            // Cerrarla sin haberla tomado antes cuenta como tomarla: si no, quedaría cerrada sin responsable.
            if (!inquiry.handled_by) {
              patch.handled_by = req.user.id;
              patch.handled_at = now;
            }
            patch.closed_by = req.user.id;
            patch.closed_at = now;
          }
        }
      }

      if (Object.keys(patch).length > 0) await inquiry.update(patch);

      const updated = await db.ContactInquiry.findByPk(inquiry.id, { include: detailInclude });
      return res.status(200).json({ data: updated });
    } catch (error) {
      return sendServerError(res, error);
    }
  },

  destroy: async (req, res) => {
    try {
      const inquiry = await db.ContactInquiry.findByPk(req.params.id);
      if (!inquiry) return res.status(404).json({ error: "Consulta no encontrada." });
      await inquiry.destroy();
      return res.status(200).json({ message: "Consulta eliminada." });
    } catch (error) {
      return sendServerError(res, error);
    }
  },
};
