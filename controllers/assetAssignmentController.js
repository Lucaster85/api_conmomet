const { Op } = require("sequelize");
const db = require("../models");

const assignmentIncludes = [
  { model: db.Tool, as: "tool", include: [{ model: db.ToolType, as: "toolType" }] },
  { model: db.Vehicle, as: "vehicle" },
  { model: db.Project, as: "project", attributes: ["id", "name", "code"] },
  { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname"] },
  { model: db.User, as: "deliveredBy", attributes: ["id", "name", "lastname"] },
  { model: db.User, as: "receivedBy", attributes: ["id", "name", "lastname"] },
];

function loadAssignment(id) {
  return db.AssetAssignment.findByPk(id, { include: assignmentIncludes });
}

// Resuelve a qué activo (Tool o Vehicle) pertenece una asignación ya creada — exactamente
// uno de tool_id/vehicle_id está seteado (ver assetAssignment.js).
async function resolveAsset(assignment) {
  if (assignment.tool_id) {
    return { kind: "tool", asset: await db.Tool.findByPk(assignment.tool_id) };
  }
  return { kind: "vehicle", asset: await db.Vehicle.findByPk(assignment.vehicle_id) };
}

// Aplica el nuevo estado al activo y deja rastro en su log correspondiente — mismo criterio
// que toolController.js#changeStatus, pero disparado automáticamente por el flujo de
// asignación en vez de una acción manual.
async function applyAssetStatus(kind, asset, toStatus, userId, notes) {
  const LogModel = kind === "tool" ? db.ToolStatusLog : db.VehicleStatusLog;
  const fkField = kind === "tool" ? "tool_id" : "vehicle_id";
  await LogModel.create({
    [fkField]: asset.id,
    from_status: asset.status,
    to_status: toStatus,
    changed_by: userId,
    notes: notes || null,
  });
  await asset.update({ status: toStatus });
}

const todayStr = () => new Date().toISOString().split("T")[0];

module.exports = {
  getAll: async (req, res) => {
    try {
      const { tool_id, vehicle_id, employee_id, project_id, status, active } = req.query;
      const where = {};
      if (tool_id) where.tool_id = tool_id;
      if (vehicle_id) where.vehicle_id = vehicle_id;
      if (employee_id) where.employee_id = employee_id;
      if (project_id) where.project_id = project_id;
      if (status) where.status = status;
      if (active === "true") where.status = { [Op.ne]: "returned" };

      const items = await db.AssetAssignment.findAll({
        where,
        include: assignmentIncludes,
        order: [["created_at", "DESC"]],
      });
      return res.status(200).json({ data: items });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Sin delivered_date → queda como "reserved" (reclamada, todavía no entregada físicamente).
  // Con delivered_date → nace directamente "delivered".
  create: async (req, res) => {
    try {
      const {
        tool_id, vehicle_id, project_id, employee_id,
        delivered_date, delivery_condition, delivery_completeness, delivery_notes,
      } = req.body;

      if ((tool_id && vehicle_id) || (!tool_id && !vehicle_id)) {
        return res.status(400).json({ error: "Debe indicar una herramienta o una grúa/vehículo, no ambas ni ninguna." });
      }

      const kind = tool_id ? "tool" : "vehicle";
      const asset = kind === "tool" ? await db.Tool.findByPk(tool_id) : await db.Vehicle.findByPk(vehicle_id);
      if (!asset) {
        return res.status(404).json({ error: kind === "tool" ? "Herramienta no encontrada." : "Vehículo no encontrado." });
      }
      if (kind === "tool" && !employee_id) {
        return res.status(400).json({ error: "El responsable es obligatorio para asignar una herramienta." });
      }
      if (asset.status !== "available") {
        return res.status(400).json({ error: `No está disponible (estado actual: ${asset.status}).` });
      }

      const isDelivery = !!delivered_date;
      if (isDelivery && (!delivery_condition || !delivery_completeness)) {
        return res.status(400).json({ error: "Condición y completitud de entrega son obligatorias." });
      }

      const assignment = await db.AssetAssignment.create({
        tool_id: tool_id || null,
        vehicle_id: vehicle_id || null,
        project_id: project_id || null,
        employee_id: employee_id || null,
        status: isDelivery ? "delivered" : "reserved",
        delivered_date: isDelivery ? delivered_date : null,
        delivery_condition: isDelivery ? delivery_condition : null,
        delivery_completeness: isDelivery ? delivery_completeness : null,
        delivery_notes: isDelivery ? (delivery_notes || null) : null,
        delivered_by: isDelivery ? req.user.id : null,
      });

      await applyAssetStatus(kind, asset, isDelivery ? "delivered" : "reserved", req.user.id,
        isDelivery ? "Entrega directa." : "Reservada para asignación.");

      return res.status(201).json({ data: await loadAssignment(assignment.id) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Confirma la entrega física de una reserva pendiente.
  deliver: async (req, res) => {
    try {
      const assignment = await db.AssetAssignment.findByPk(req.params.id);
      if (!assignment) return res.status(404).json({ error: "Asignación no encontrada." });
      if (assignment.status !== "reserved") {
        return res.status(400).json({ error: "Solo se puede confirmar entrega de una reserva pendiente." });
      }

      const { delivery_condition, delivery_completeness, delivery_notes, delivered_date } = req.body;
      if (!delivery_condition || !delivery_completeness) {
        return res.status(400).json({ error: "Condición y completitud de entrega son obligatorias." });
      }

      await assignment.update({
        status: "delivered",
        delivered_date: delivered_date || todayStr(),
        delivery_condition,
        delivery_completeness,
        delivery_notes: delivery_notes || null,
        delivered_by: req.user.id,
      });

      const { kind, asset } = await resolveAsset(assignment);
      await applyAssetStatus(kind, asset, "delivered", req.user.id, "Confirmación de reserva.");

      return res.status(200).json({ data: await loadAssignment(assignment.id) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // Registra la devolución y, en el mismo paso, el estado resultante del activo
  // (disponible o en reparación) — evita una segunda acción manual para el caso común.
  returnAssignment: async (req, res) => {
    try {
      const assignment = await db.AssetAssignment.findByPk(req.params.id);
      if (!assignment) return res.status(404).json({ error: "Asignación no encontrada." });
      if (assignment.status !== "delivered") {
        return res.status(400).json({ error: "Solo se puede registrar devolución de una asignación entregada." });
      }

      const { return_condition, return_completeness, return_notes, returned_date, resulting_status } = req.body;
      if (!return_condition || !return_completeness) {
        return res.status(400).json({ error: "Condición y completitud de devolución son obligatorias." });
      }
      const finalStatus = resulting_status || "available";
      if (!["available", "in_repair"].includes(finalStatus)) {
        return res.status(400).json({ error: "El estado resultante debe ser 'available' o 'in_repair'." });
      }

      await assignment.update({
        status: "returned",
        returned_date: returned_date || todayStr(),
        return_condition,
        return_completeness,
        return_notes: return_notes || null,
        received_by: req.user.id,
      });

      const { kind, asset } = await resolveAsset(assignment);
      await applyAssetStatus(kind, asset, finalStatus, req.user.id, "Devolución registrada.");

      return res.status(200).json({ data: await loadAssignment(assignment.id) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  // "Cancelar" solo aplica a reservas todavía no entregadas — una entrega confirmada se
  // cierra con la devolución, no se borra.
  destroy: async (req, res) => {
    try {
      const assignment = await db.AssetAssignment.findByPk(req.params.id);
      if (!assignment) return res.status(404).json({ error: "Asignación no encontrada." });
      if (assignment.status !== "reserved") {
        return res.status(400).json({ error: "Solo se pueden cancelar reservas pendientes — una entrega ya confirmada se cierra con la devolución." });
      }

      const { kind, asset } = await resolveAsset(assignment);
      await assignment.destroy();
      await applyAssetStatus(kind, asset, "available", req.user.id, "Reserva cancelada.");

      return res.status(200).json({ message: "Reserva cancelada." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
