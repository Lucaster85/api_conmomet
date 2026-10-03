const { Op } = require("sequelize");
const db = require("../models");
const { uploadToR2, deleteFromR2, userHasPermission } = require("../helpers");
const { recordAudit } = require("../services/auditLogService");

/**
 * Auto-generates a quote request number like PC-2026-001 — mismo esquema que
 * budgetController#generateBudgetNumber.
 */
async function generateQuoteRequestNumber() {
  const year = new Date().getFullYear();
  const prefix = `PC-${year}-`;

  const last = await db.QuoteRequest.findOne({
    where: { number: { [Op.like]: `${prefix}%` } },
    order: [["number", "DESC"]],
    paranoid: false,
  });

  let seq = 1;
  if (last && last.number) {
    const lastSeq = parseInt(last.number.replace(prefix, ""), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(3, "0")}`;
}

function parseAssigneeIds(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id)) : [];
  } catch {
    return [];
  }
}

const quoteRequestDetailInclude = [
  { model: db.Client, as: "client", attributes: ["id", "razonSocial"] },
  { model: db.Plant, as: "plant", attributes: ["id", "name"] },
  { model: db.User, as: "createdBy", attributes: ["id", "name", "lastname"] },
  { model: db.User, as: "assignees", attributes: ["id", "name", "lastname"], through: { attributes: [] } },
  {
    model: db.QuoteRequestFile, as: "files",
    include: [{ model: db.User, as: "uploader", attributes: ["id", "name", "lastname"] }],
  },
  { model: db.Budget, as: "budgets", attributes: ["id", "number", "status", "title"] },
];

// "quoted" NO es una transición que se pida desde acá: se alcanza únicamente de forma
// automática cuando el Presupuesto vinculado pasa a "sent" (ver budgetController#changeStatus).
// Dejarlo como acción manual permitía marcar el PC como cotizado con el presupuesto todavía en
// borrador — el PC desaparecía de los avisos y el cliente nunca recibía nada, con el vencimiento
// corriendo. Si al final no se cotiza, el camino es "cancelled" (ver FLOWS.md flujo 27e).
const validTransitions = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["pending_review", "cancelled"],
  pending_review: ["in_progress", "cancelled"],
  quoted: [],
  cancelled: ["pending"],
};

module.exports = {
  getAll: async (req, res) => {
    try {
      const { status, client_id, assigned_to_me } = req.query;
      const where = {};
      if (status) where.status = status;
      if (client_id) where.client_id = client_id;

      const include = quoteRequestDetailInclude.map((assoc) =>
        assigned_to_me === "true" && assoc.as === "assignees"
          ? { ...assoc, where: { id: req.user.id }, required: true }
          : assoc
      );

      const quoteRequests = await db.QuoteRequest.findAll({
        where,
        include,
        order: [["due_date", "ASC"]],
      });

      return res.status(200).json({ data: quoteRequests });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const quoteRequest = await db.QuoteRequest.findByPk(req.params.id, { include: quoteRequestDetailInclude });
      if (!quoteRequest) return res.status(404).json({ error: "Pedido de Cotización no encontrado." });
      return res.status(200).json({ data: quoteRequest });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    if (!userHasPermission(req.user, "quote_requests_assign")) {
      return res.status(403).json({ error: "No tenés permiso para cargar Pedidos de Cotización." });
    }

    const { title, client_id, plant_id, description, received_at, due_date, notes, client_quote_number } = req.body;
    const assigneeIds = parseAssigneeIds(req.body.assignee_ids);
    const files = req.files || [];

    if (!title) return res.status(400).json({ error: "El título es obligatorio." });
    if (!client_id) return res.status(400).json({ error: "El cliente es obligatorio." });
    if (!due_date) return res.status(400).json({ error: "El vencimiento de presentación es obligatorio." });
    if (!client_quote_number || !String(client_quote_number).trim()) {
      return res.status(400).json({ error: "El número de cotización del cliente es obligatorio." });
    }

    const transaction = await db.sequelize.transaction();
    try {
      const number = await generateQuoteRequestNumber();

      const quoteRequest = await db.QuoteRequest.create({
        number,
        title,
        client_quote_number: String(client_quote_number).trim(),
        client_id,
        plant_id: plant_id || null,
        description: description || null,
        received_at: received_at || null,
        due_date,
        notes: notes || null,
        created_by: req.user.id,
      }, { transaction });

      if (assigneeIds.length > 0) {
        await quoteRequest.setAssignees(assigneeIds, { transaction });
      }

      for (const file of files) {
        const fileUrl = await uploadToR2(file, `quote-requests/${quoteRequest.id}`);
        const fileKey = fileUrl.replace(`${process.env.STORAGE_PUBLIC_URL}/`, "");
        await db.QuoteRequestFile.create({
          quote_request_id: quoteRequest.id,
          file_url: fileUrl,
          file_key: fileKey,
          file_name: file.originalname,
          mime_type: file.mimetype,
          size_bytes: file.size,
          uploaded_by: req.user.id,
        }, { transaction });
      }

      await transaction.commit();

      const full = await db.QuoteRequest.findByPk(quoteRequest.id, { include: quoteRequestDetailInclude });
      return res.status(201).json({ data: full });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    // Editar los datos del PC (título, vencimiento, cliente, responsables) es de gerencia. El
    // responsable que cotiza llega hasta acá por el permiso de ruta quote_requests_update, pero
    // no debe poder cambiarse el vencimiento ni reasignarse — su única acción sobre el PC es
    // entregarlo, vía changeStatus (ver FLOWS.md flujo 27d).
    if (!userHasPermission(req.user, "quote_requests_assign")) {
      return res.status(403).json({ error: "No tenés permiso para editar Pedidos de Cotización." });
    }

    const { id } = req.params;
    const { title, client_id, plant_id, description, received_at, due_date, notes, client_quote_number } = req.body;

    try {
      const quoteRequest = await db.QuoteRequest.findByPk(id);
      if (!quoteRequest) return res.status(404).json({ error: "Pedido de Cotización no encontrado." });

      if (client_quote_number !== undefined && !String(client_quote_number).trim()) {
        return res.status(400).json({ error: "El número de cotización del cliente es obligatorio." });
      }

      await quoteRequest.update({
        title: title !== undefined ? title : quoteRequest.title,
        client_quote_number: client_quote_number !== undefined ? String(client_quote_number).trim() : quoteRequest.client_quote_number,
        client_id: client_id !== undefined ? client_id : quoteRequest.client_id,
        plant_id: plant_id !== undefined ? (plant_id || null) : quoteRequest.plant_id,
        description: description !== undefined ? description : quoteRequest.description,
        received_at: received_at !== undefined ? received_at : quoteRequest.received_at,
        due_date: due_date !== undefined ? due_date : quoteRequest.due_date,
        notes: notes !== undefined ? notes : quoteRequest.notes,
      });

      // Reasignación: reemplazo total del set de responsables, no merge — refleja el handoff
      // explícito entre el responsable y gerencia en cada paso del flujo.
      if (req.body.assignee_ids !== undefined) {
        const assigneeIds = parseAssigneeIds(req.body.assignee_ids);
        await quoteRequest.setAssignees(assigneeIds);
      }

      const full = await db.QuoteRequest.findByPk(id, { include: quoteRequestDetailInclude });
      return res.status(200).json({ data: full });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  changeStatus: async (req, res) => {
    const { id } = req.params;
    const { status, assignee_ids } = req.body;

    try {
      const quoteRequest = await db.QuoteRequest.findByPk(id);
      if (!quoteRequest) return res.status(404).json({ error: "Pedido de Cotización no encontrado." });

      const allowed = validTransitions[quoteRequest.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: `No se puede cambiar el estado de "${quoteRequest.status}" a "${status}".` });
      }

      // Entregar a gerencia (in_progress -> pending_review) es LA acción del responsable que
      // cotiza, y es la única del PC que puede hacer: alcanza con quote_requests_deliver.
      // El resto de las transiciones (devolver al responsable, marcar cotizado, cancelar,
      // reabrir) son de gerencia y piden quote_requests_assign (ver FLOWS.md flujo 27d).
      const isDelivery = quoteRequest.status === "in_progress" && status === "pending_review";
      const canManage = userHasPermission(req.user, "quote_requests_assign");
      const canDeliver = userHasPermission(req.user, "quote_requests_deliver");
      if (!canManage && !(isDelivery && canDeliver)) {
        return res.status(403).json({
          error: isDelivery
            ? "No tenés permiso para entregar presupuestos a gerencia."
            : "No tenés permiso para cambiar el estado de un Pedido de Cotización.",
        });
      }

      await quoteRequest.update({ status });

      // El handoff entre responsable y gerencia reasigna al mismo tiempo que cambia de estado
      // (ver plan: "un solo set de asignados que se reemplaza en cada handoff").
      if (assignee_ids !== undefined) {
        await quoteRequest.setAssignees(parseAssigneeIds(assignee_ids));
      }

      await recordAudit({
        entityType: "QuoteRequest",
        entityId: quoteRequest.id,
        action: "update",
        fieldChanged: "status",
        newValue: status,
        userId: req.user?.id,
      });

      const full = await db.QuoteRequest.findByPk(id, { include: quoteRequestDetailInclude });
      return res.status(200).json({ data: full });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  addFiles: async (req, res) => {
    const { id } = req.params;
    const files = req.files || [];

    try {
      const quoteRequest = await db.QuoteRequest.findByPk(id);
      if (!quoteRequest) return res.status(404).json({ error: "Pedido de Cotización no encontrado." });

      for (const file of files) {
        const fileUrl = await uploadToR2(file, `quote-requests/${quoteRequest.id}`);
        const fileKey = fileUrl.replace(`${process.env.STORAGE_PUBLIC_URL}/`, "");
        await db.QuoteRequestFile.create({
          quote_request_id: quoteRequest.id,
          file_url: fileUrl,
          file_key: fileKey,
          file_name: file.originalname,
          mime_type: file.mimetype,
          size_bytes: file.size,
          uploaded_by: req.user.id,
        });
      }

      const full = await db.QuoteRequest.findByPk(id, { include: quoteRequestDetailInclude });
      return res.status(200).json({ data: full });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  removeFile: async (req, res) => {
    const { id, fileId } = req.params;

    try {
      const file = await db.QuoteRequestFile.findOne({ where: { id: fileId, quote_request_id: id } });
      if (!file) return res.status(404).json({ error: "Archivo no encontrado." });

      await deleteFromR2(file.file_url);
      await file.destroy();

      const full = await db.QuoteRequest.findByPk(id, { include: quoteRequestDetailInclude });
      return res.status(200).json({ data: full });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const quoteRequest = await db.QuoteRequest.findByPk(req.params.id);
      if (!quoteRequest) return res.status(404).json({ error: "Pedido de Cotización no encontrado." });

      await quoteRequest.destroy();
      return res.status(200).json({ message: "Pedido de Cotización eliminado." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
