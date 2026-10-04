const { Op } = require("sequelize");
const db = require("../models");
const { uploadToR2, deleteFromR2, userHasPermission, resolveUserIdsByPermission, sendPushToUsers } = require("../helpers");
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

// Línea de tiempo append-only del ida y vuelta del PC (ver FLOWS.md flujo 27g). Nunca puede
// romper la operación que ya se aplicó — mismo criterio que sendPushToUsers — así que absorbe
// cualquier error y solo lo loguea. No se espera (fire-and-forget), igual que los pushes de
// este controller: la respuesta no depende de que esta escritura termine.
async function writeStatusLog({ quoteRequestId, event, fromStatus, toStatus, changedBy, comment, recipientIds }) {
  try {
    const log = await db.QuoteRequestStatusLog.create({
      quote_request_id: quoteRequestId,
      event,
      from_status: fromStatus || null,
      to_status: toStatus,
      changed_by: changedBy,
      comment: comment ? String(comment).trim() : null,
    });
    if (recipientIds && recipientIds.length > 0) {
      await log.setRecipients(recipientIds);
    }
  } catch (error) {
    console.error(`[quote-request-log] error registrando evento "${event}" del PC ${quoteRequestId}:`, error.message);
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
  { model: db.Budget, as: "budgets", attributes: ["id", "number", "status", "title", "created_by"] },
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

      // Último comentario dirigido a MÍ, para el aviso del tablero (ver FLOWS.md flujo 27g) —
      // liviano a propósito, el hilo completo se pide aparte vía /history. Una sola query para
      // todo el listado (no N+1): se filtra por `recipients` = usuario actual, se ordena por
      // fecha y se toma la primera ocurrencia por PC.
      const qrIds = quoteRequests.map((qr) => qr.id);
      const lastCommentByQr = {};
      if (qrIds.length > 0) {
        const recentLogs = await db.QuoteRequestStatusLog.findAll({
          where: { quote_request_id: qrIds, comment: { [Op.ne]: null } },
          include: [
            { model: db.User, as: "recipients", attributes: [], where: { id: req.user.id }, required: true, through: { attributes: [] } },
            { model: db.User, as: "changedByUser", attributes: ["id", "name", "lastname"] },
          ],
          order: [["changed_at", "DESC"]],
        });
        for (const log of recentLogs) {
          if (!lastCommentByQr[log.quote_request_id]) {
            lastCommentByQr[log.quote_request_id] = {
              comment: log.comment,
              at: log.changed_at,
              from: log.changedByUser
                ? { name: log.changedByUser.name, lastname: log.changedByUser.lastname }
                : { name: "", lastname: "" },
            };
          }
        }
      }

      const result = quoteRequests.map((qr) => {
        const plain = qr.toJSON();
        plain.last_comment = lastCommentByQr[qr.id] || null;
        return plain;
      });

      return res.status(200).json({ data: result });
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

  // Línea de tiempo unificada PC + Presupuesto (ver FLOWS.md flujo 27g): un solo hilo ordenado
  // para que el frontend solo renderice. Los eventos del PC vienen del log append-only; los del
  // Presupuesto se SINTETIZAN de sus columnas de estado (sent_at/approved_at/rejected_at) — no
  // hay tabla nueva para eso. Deriva quote_requests_read solamente, igual que GET /:id.
  history: async (req, res) => {
    const { id } = req.params;
    try {
      const quoteRequest = await db.QuoteRequest.findByPk(id);
      if (!quoteRequest) return res.status(404).json({ error: "Pedido de Cotización no encontrado." });

      const logs = await db.QuoteRequestStatusLog.findAll({
        where: { quote_request_id: id },
        include: [
          { model: db.User, as: "changedByUser", attributes: ["id", "name", "lastname"] },
          { model: db.User, as: "recipients", attributes: ["id", "name", "lastname"], through: { attributes: [] } },
        ],
      });

      const budgets = await db.Budget.findAll({
        where: { quote_request_id: id },
        attributes: ["id", "number", "status", "sent_at", "approved_at", "rejected_at", "rejection_reason"],
        include: [{ model: db.User, as: "approvedBy", attributes: ["id", "name", "lastname"] }],
      });

      const toUserRef = (u) => (u ? { id: u.id, name: u.name, lastname: u.lastname } : null);

      const entries = logs.map((log) => ({
        id: `qr-${log.id}`,
        source: "quote_request",
        event: log.event,
        at: log.changed_at,
        actor: toUserRef(log.changedByUser),
        recipients: (log.recipients || []).map(toUserRef),
        comment: log.comment,
        from_status: log.from_status,
        to_status: log.to_status,
        budget: null,
      }));

      // Cada presupuesto aporta sus propios eventos de forma independiente — si hay varios
      // (ej. uno rechazado y su reemplazo), cada uno tiene su propia fila de sent/approved/
      // rejected. Dentro de un mismo presupuesto, si se reenvía, sent_at se pisa y solo queda
      // el último envío: es un límite de usar columnas de estado en vez de un log (ver plan
      // §2.6) — aceptado porque no justifica una tabla nueva.
      for (const budget of budgets) {
        const budgetRef = { id: budget.id, number: budget.number };
        if (budget.sent_at) {
          entries.push({
            id: `budget-${budget.id}-sent`, source: "budget", event: "budget_sent", at: budget.sent_at,
            actor: null, recipients: [], comment: null, from_status: null, to_status: "sent", budget: budgetRef,
          });
        }
        if (budget.approved_at) {
          entries.push({
            id: `budget-${budget.id}-approved`, source: "budget", event: "budget_approved", at: budget.approved_at,
            actor: toUserRef(budget.approvedBy), recipients: [], comment: null, from_status: "sent", to_status: "approved", budget: budgetRef,
          });
        }
        if (budget.rejected_at) {
          entries.push({
            id: `budget-${budget.id}-rejected`, source: "budget", event: "budget_rejected", at: budget.rejected_at,
            actor: null, recipients: [], comment: budget.rejection_reason, from_status: "sent", to_status: "rejected", budget: budgetRef,
          });
        }
      }

      entries.sort((a, b) => new Date(b.at) - new Date(a.at));

      return res.status(200).json({ data: entries });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    if (!userHasPermission(req.user, "quote_requests_assign")) {
      return res.status(403).json({ error: "No tenés permiso para cargar Pedidos de Cotización." });
    }

    const { title, client_id, plant_id, description, received_at, due_date, notes, client_quote_number, comment } = req.body;
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

      // Push "te asignaron un PC" — después del commit, nunca puede romper el alta (ver
      // FLOWS.md flujo 28). Al propio creador no le llega aunque se auto-asigne.
      if (assigneeIds.length > 0) {
        sendPushToUsers(assigneeIds, {
          title: "Nuevo Pedido de Cotización",
          body: comment ? `${quoteRequest.number}: ${comment}` : `Te asignaron ${quoteRequest.number} — ${quoteRequest.title}`,
          url: `/dashboard/quote-requests?view=${quoteRequest.id}`,
          tag: `quote-request-${quoteRequest.id}`,
          excludeUserId: req.user.id,
        });
      }

      if (assigneeIds.length > 0 || comment) {
        writeStatusLog({
          quoteRequestId: quoteRequest.id,
          event: "assigned",
          fromStatus: null,
          toStatus: quoteRequest.status,
          changedBy: req.user.id,
          comment,
          recipientIds: assigneeIds,
        });
      }

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
    const { title, client_id, plant_id, description, received_at, due_date, notes, client_quote_number, comment } = req.body;

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
      // explícito entre el responsable y gerencia en cada paso del flujo. Se captura el set
      // ANTES de reemplazar para poder notificar solo a los que se suman — si no, editar
      // cualquier campo del PC re-notificaría a todos los que ya estaban (ver FLOWS.md 28).
      if (req.body.assignee_ids !== undefined) {
        const before = (await quoteRequest.getAssignees()).map((u) => u.id);
        const assigneeIds = parseAssigneeIds(req.body.assignee_ids);
        await quoteRequest.setAssignees(assigneeIds);

        const added = assigneeIds.filter((uid) => !before.includes(uid));
        if (added.length > 0) {
          sendPushToUsers(added, {
            title: "Nuevo Pedido de Cotización",
            body: comment ? `${quoteRequest.number}: ${comment}` : `Te asignaron ${quoteRequest.number} — ${quoteRequest.title}`,
            url: `/dashboard/quote-requests?view=${quoteRequest.id}`,
            tag: `quote-request-${quoteRequest.id}`,
            excludeUserId: req.user.id,
          });
        }

        if (added.length > 0 || comment) {
          writeStatusLog({
            quoteRequestId: quoteRequest.id,
            event: "reassigned",
            fromStatus: quoteRequest.status,
            toStatus: quoteRequest.status,
            changedBy: req.user.id,
            comment,
            recipientIds: added,
          });
        }
      }

      const full = await db.QuoteRequest.findByPk(id, { include: quoteRequestDetailInclude });
      return res.status(200).json({ data: full });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  changeStatus: async (req, res) => {
    const { id } = req.params;
    const { status, assignee_ids, comment } = req.body;

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
      const isReturnToResponsible = quoteRequest.status === "pending_review" && status === "in_progress";
      const canManage = userHasPermission(req.user, "quote_requests_assign");
      const canDeliver = userHasPermission(req.user, "quote_requests_deliver");
      if (!canManage && !(isDelivery && canDeliver)) {
        return res.status(403).json({
          error: isDelivery
            ? "No tenés permiso para entregar presupuestos a gerencia."
            : "No tenés permiso para cambiar el estado de un Pedido de Cotización.",
        });
      }

      // Devolver sin explicar por qué es justo el caso que esto existe para evitar — mismo
      // criterio que budgetController#changeStatus exige rejection_reason al rechazar (ver
      // FLOWS.md flujo 27g). Va antes de cualquier escritura.
      if (isReturnToResponsible && (!comment || !String(comment).trim())) {
        return res.status(400).json({ error: "Contale al responsable por qué se lo devolvés." });
      }

      const previousStatus = quoteRequest.status;
      await quoteRequest.update({ status });

      // El handoff entre responsable y gerencia reasigna al mismo tiempo que cambia de estado
      // (ver plan: "un solo set de asignados que se reemplaza en cada handoff").
      if (assignee_ids !== undefined) {
        await quoteRequest.setAssignees(parseAssigneeIds(assignee_ids));
      }

      // Push de los dos eventos del ida y vuelta (ver FLOWS.md flujo 28):
      // - Entregado a gerencia: el diálogo del responsable viene PRE-CARGADO con él mismo como
      //   asignado (quote-requests/page.tsx), así que notificar por el set de assignees casi
      //   siempre no le avisaría a nadie. Se notifica por PERMISO (quote_requests_assign), no
      //   por asignación.
      // - Devuelto al responsable: ahí sí el set de assignees es el correcto — gerencia elige
      //   explícitamente a quién.
      if (isDelivery) {
        const managers = await resolveUserIdsByPermission("quote_requests_assign");
        sendPushToUsers(managers, {
          title: "Presupuesto para validar",
          body: comment ? `${quoteRequest.number}: ${comment}` : `Te entregaron ${quoteRequest.number} — ${quoteRequest.title}`,
          url: `/dashboard/quote-requests?view=${quoteRequest.id}`,
          tag: `quote-request-${quoteRequest.id}`,
          excludeUserId: req.user.id,
        });
        writeStatusLog({
          quoteRequestId: quoteRequest.id,
          event: "delivered",
          fromStatus: previousStatus,
          toStatus: status,
          changedBy: req.user.id,
          comment,
          recipientIds: assignee_ids !== undefined ? parseAssigneeIds(assignee_ids) : [],
        });
      } else if (isReturnToResponsible && assignee_ids !== undefined) {
        const responsibles = parseAssigneeIds(assignee_ids);
        // El comentario va primero en el cuerpo: es lo único que el usuario realmente necesita
        // leer, así que si el truncado a 150 chars de sendPushToUsers corta algo, que corte el
        // final del comentario y no el comentario entero (ver FLOWS.md flujo 28/27g).
        sendPushToUsers(responsibles, {
          title: "Presupuesto devuelto",
          body: `${quoteRequest.number}: ${comment}`,
          url: `/dashboard/quote-requests?view=${quoteRequest.id}`,
          tag: `quote-request-${quoteRequest.id}`,
          excludeUserId: req.user.id,
        });
        writeStatusLog({
          quoteRequestId: quoteRequest.id,
          event: "returned",
          fromStatus: previousStatus,
          toStatus: status,
          changedBy: req.user.id,
          comment,
          recipientIds: responsibles,
        });
      } else if (status === "cancelled" || status === "pending") {
        writeStatusLog({
          quoteRequestId: quoteRequest.id,
          event: status === "cancelled" ? "cancelled" : "reopened",
          fromStatus: previousStatus,
          toStatus: status,
          changedBy: req.user.id,
          comment,
          recipientIds: [],
        });
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
