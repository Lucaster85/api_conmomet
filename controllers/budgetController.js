const { Op } = require("sequelize");
const db = require("../models");
const { createProjectFromBudget, buildRubroHoursBreakdown, replaceProjectHourBudgets } = require("../services/projectFactory");
const { uploadToR2, userHasPermission, computeTotalsByCurrency, sendPushToUsers } = require("../helpers");
const { applyPriceVisibility } = require("../helpers/budgetTotals");
const { recordAudit } = require("../services/auditLogService");
const { getUnspecifiedProvider, upsertPrice } = require("../services/materialPriceService");
const { parseMaterialSheet } = require("../helpers/materialSheetParser");
const { sumConsumedHoursByType } = require("./projectController");

/**
 * Retroalimenta el costo real de un Material a partir de una edición hecha en una línea de
 * presupuesto — mismo patrón que syncClientItemRate para mano de obra. El costo es por
 * proveedor: se guarda en el precio de (material, proveedor) de la línea y genera
 * MaterialCostHistory solo si cambió (ver materialPriceService.upsertPrice). Solo se llama cuando
 * ya se determinó que el usuario efectivamente cambió el costo respecto de lo que esa línea
 * tenía guardado antes — no en cada re-guardado del presupuesto sin editar.
 */
async function syncMaterialCost(material, providerId, cost, currency, userId, transaction) {
  if (!material) return null;
  const newVal = parseFloat(cost);
  if (isNaN(newVal) || newVal <= 0) return null;
  const { price } = await upsertPrice({ materialId: material.id, providerId, cost: newVal, currency, userId }, transaction);
  return price;
}

// Proveedor efectivo de una línea: el indicado, o "Sin especificar" si viene material sin proveedor.
async function resolveProviderId(providerId, transaction) {
  if (providerId) return Number(providerId);
  return (await getUnspecifiedProvider(transaction)).id;
}

/**
 * Si la línea trae material_id, resuelve el costo real del Material PARA EL PROVEEDOR de la línea
 * y lo "fotografía" en la línea (material_cost_snapshot/currency) — no se recalcula después
 * aunque el costo del material cambie. Se resuelve siempre, sin importar el permiso de quien
 * guarda: desde que el precio al cliente se calcula como margen % sobre este costo (ver
 * FLOWS.md), el sistema necesita el valor real para poder computar unit_price. La EXPOSICIÓN de
 * este campo en la respuesta sigue gateada por material_costs_read, en withTotals.
 *
 * Si se pasa `edited` (costo distinto al que la línea tenía antes, con permiso de edición),
 * ese valor pasa a ser el nuevo precio de ese proveedor — se sincroniza vía syncMaterialCost.
 * Sin precio para el par (material, proveedor) el snapshot queda null.
 *
 * Devuelve también provider_id (el efectivo) para persistirlo en la línea.
 */
async function resolveMaterialCostSnapshot(materialId, providerId, transaction, edited) {
  if (!materialId) return { material_cost_snapshot: null, material_cost_currency: null, provider_id: providerId || null };
  const material = await db.Material.findByPk(materialId, { transaction });
  if (!material) return { material_cost_snapshot: null, material_cost_currency: null, provider_id: providerId || null };

  const effectiveProviderId = await resolveProviderId(providerId, transaction);

  if (edited) {
    const price = await syncMaterialCost(material, effectiveProviderId, edited.cost, edited.currency, edited.userId, transaction);
    return {
      material_cost_snapshot: parseFloat(edited.cost),
      material_cost_currency: edited.currency || (price && price.currency) || "ARS",
      provider_id: effectiveProviderId,
    };
  }

  const price = await db.MaterialProviderPrice.findOne({
    where: { material_id: material.id, provider_id: effectiveProviderId },
    transaction,
  });
  return {
    material_cost_snapshot: price ? price.cost : null,
    material_cost_currency: price ? price.currency : null,
    provider_id: effectiveProviderId,
  };
}

/**
 * Contracara de la tarifa por cliente: si un usuario con budget_prices_read carga/edita el
 * valor unitario de una línea de mano de obra, ese precio retroalimenta la tarifa vigente del
 * cliente para ese rubro (ClientItemRate) y genera historial (ClientItemRateHistory) — mismo
 * patrón que MaterialCostHistory. Se sincroniza en cada guardado del presupuesto, incluso en
 * borrador (decisión de esta mejora, ver FLOWS.md) — a diferencia del costo real de materiales,
 * que a propósito NO retroalimenta el catálogo al editarse dentro de una línea.
 */
async function syncClientItemRate(clientId, budgetItemTypeId, rate, currency, userId, transaction) {
  if (!clientId || !budgetItemTypeId || !rate || rate <= 0 || !currency) return;

  const existing = await db.ClientItemRate.findOne({
    where: { client_id: clientId, budget_item_type_id: budgetItemTypeId },
    transaction,
  });
  const changed = !existing || parseFloat(existing.current_rate) !== parseFloat(rate) || existing.currency !== currency;
  if (!changed) return;

  await db.ClientItemRateHistory.create({
    client_id: clientId,
    budget_item_type_id: budgetItemTypeId,
    rate,
    currency,
    changed_by: userId,
  }, { transaction });

  if (existing) {
    await existing.update({ current_rate: rate, currency, updated_by: userId }, { transaction });
  } else {
    await db.ClientItemRate.create({
      client_id: clientId,
      budget_item_type_id: budgetItemTypeId,
      current_rate: rate,
      currency,
      updated_by: userId,
    }, { transaction });
  }
}

/**
 * Auto-generates a budget number like PRES-2026-001
 */
async function generateBudgetNumber() {
  const year = new Date().getFullYear();
  const prefix = `PRES-${year}-`;

  const lastBudget = await db.Budget.findOne({
    where: { number: { [Op.like]: `${prefix}%` } },
    order: [["number", "DESC"]],
    paranoid: false,
  });

  let seq = 1;
  if (lastBudget && lastBudget.number) {
    const lastSeq = parseInt(lastBudget.number.replace(prefix, ""), 10);
    if (!isNaN(lastSeq)) seq = lastSeq + 1;
  }

  return `${prefix}${String(seq).padStart(3, "0")}`;
}

/**
 * Resuelve a qué proyecto queda atado un presupuesto según lo que mandó el usuario:
 * - parent_project_id: "adicional de" — al aprobar genera un SUBPROYECTO nuevo hijo de este.
 * - existing_project_id: "vincular a" — al aprobar NO crea nada, reusa este proyecto raíz
 *   directamente y le sobreescribe las bolsas de horas por rubro (ProjectHourBudget).
 * - ninguno: presupuesto para un proyecto totalmente nuevo.
 * Son mutuamente excluyentes. En los dos primeros casos, cliente/planta se fuerzan desde el
 * proyecto elegido — el valor que haya mandado el body se ignora, para que no puedan quedar
 * inconsistentes (el frontend ya los deshabilita, esto es el resguardo server-side).
 */
async function resolveProjectLinkage({ parent_project_id, existing_project_id, client_id, plant_id, excludeBudgetId }, transaction) {
  if (parent_project_id && existing_project_id) {
    throw new Error("Un presupuesto no puede ser 'adicional de' y 'vinculado a' un proyecto al mismo tiempo.");
  }

  if (parent_project_id) {
    const parentProject = await db.Project.findByPk(parent_project_id, { transaction });
    if (!parentProject) throw new Error("El proyecto padre indicado no existe.");
    if (parentProject.parent_id) throw new Error("El proyecto seleccionado ya es un subproyecto — no se admiten más de 2 niveles.");
    return {
      parent_project_id: parentProject.id,
      existing_project_id: null,
      client_id: parentProject.client_id,
      plant_id: parentProject.plant_id || null,
    };
  }

  if (existing_project_id) {
    const project = await db.Project.findByPk(existing_project_id, { transaction });
    if (!project) throw new Error("El proyecto indicado no existe.");
    if (project.parent_id) throw new Error("Solo se puede vincular presupuestos a proyectos raíz (no a subproyectos).");

    const claimWhere = {
      status: { [Op.ne]: "rejected" },
      [Op.or]: [{ project_id: project.id }, { existing_project_id: project.id }],
    };
    if (excludeBudgetId) claimWhere.id = { [Op.ne]: excludeBudgetId };
    const alreadyClaimed = await db.Budget.findOne({ where: claimWhere, transaction });
    if (alreadyClaimed) throw new Error("Ese proyecto ya tiene un presupuesto vinculado o pendiente de aprobación.");

    return {
      parent_project_id: null,
      existing_project_id: project.id,
      client_id: project.client_id,
      plant_id: project.plant_id || null,
    };
  }

  return { parent_project_id: null, existing_project_id: null, client_id, plant_id: plant_id || null };
}

/**
 * Pone el Pedido de Cotización "en manos del responsable" cuando nace un presupuesto suyo.
 * - `pending`: todavía no se había empezado, arranca.
 * - `quoted`: ya se había cotizado y se está re-cotizando sobre el mismo pedido (típicamente
 *   duplicando un presupuesto rechazado y manteniendo el vínculo). Vuelve a abrirse para que
 *   reaparezca en los avisos y el estado del PC siga reflejando la realidad.
 * El resto de los estados no se tocan: `in_progress` ya está donde corresponde, y
 * `pending_review`/`cancelled` son decisiones explícitas que un alta de presupuesto no debe pisar.
 */
async function openQuoteRequestForWork(quoteRequest, transaction) {
  if (!quoteRequest) return;
  if (quoteRequest.status !== "pending" && quoteRequest.status !== "quoted") return;
  await quoteRequest.update({ status: "in_progress" }, { transaction });
}

const budgetDetailInclude = [
  { model: db.Client, as: "client", attributes: ["id", "razonSocial"] },
  { model: db.Plant, as: "plant", attributes: ["id", "name"] },
  { model: db.Project, as: "parentProject", attributes: ["id", "name", "code"] },
  { model: db.Project, as: "existingProject", attributes: ["id", "name", "code"] },
  { model: db.Project, as: "project", attributes: ["id", "name", "code"] },
  { model: db.User, as: "createdBy", attributes: ["id", "name", "lastname"] },
  { model: db.User, as: "approvedBy", attributes: ["id", "name", "lastname"] },
  { model: db.ClientSupervisor, as: "approvedBySupervisor", attributes: ["id", "name", "lastname", "email", "phone"] },
  {
    model: db.QuoteRequest, as: "quoteRequest",
    attributes: ["id", "number", "client_quote_number", "due_date", "status"],
    // Solo los ids: alcanza para resolver "¿está asignado a quien está mirando?" en withTotals.
    // El array se descarta ahí mismo — la respuesta lleva únicamente el booleano, no la lista de
    // responsables, que en el listado de Presupuestos no hace falta.
    include: [
      { model: db.User, as: "assignees", attributes: ["id"], through: { attributes: [] } },
      // Pliego adjunto del PC: el responsable que arma el presupuesto lo necesita a mano. Se
      // pela en withTotals si quien mira no tiene acceso al PC.
      { model: db.QuoteRequestFile, as: "files", attributes: ["id", "file_url", "file_name", "size_bytes"] },
    ],
  },
  { model: db.BudgetLaborLine, as: "laborLines", include: [{ model: db.BudgetItemType, as: "itemType" }] },
  {
    model: db.BudgetMaterialItem, as: "materialItems",
    include: [
      { model: db.MaterialUnit, as: "materialUnit" },
      { model: db.Material, as: "material", include: [{ model: db.MaterialUnit, as: "materialUnit" }] },
      // paranoid:false: una línea sigue mostrando el nombre aunque el proveedor se haya dado de baja.
      { model: db.Provider, as: "provider", paranoid: false, attributes: ["id", "razonSocial", "is_system"] },
    ],
  },
];

// El costo/margen es más sensible que el precio de venta — se gatea con material_costs_read,
// un permiso aparte de budgets_read (ver FLOWS.md).
async function withTotals(budgetInstance, user) {
  const data = budgetInstance.toJSON();
  data.totals_by_currency = computeTotalsByCurrency(data, data.laborLines || [], data.materialItems || []);

  // "¿Este presupuesto está asignado a mí?" — se resuelve acá, con los ids que trajo el include
  // anidado, y se devuelve como un solo booleano: el listado de Presupuestos lo usa para mostrar
  // la etiqueta, y no necesita (ni conviene que lleve) la lista de responsables (ver FLOWS.md 27f).
  if (data.quoteRequest) {
    const assigneeIds = (data.quoteRequest.assignees || []).map((a) => a.id);
    data.quoteRequest.assigned_to_me = user ? assigneeIds.includes(user.id) : false;
    delete data.quoteRequest.assignees;
    // Los archivos del PC solo los ve quien tiene acceso al PC: lo tiene asignado, o tiene el
    // permiso de lectura de Pedidos de Cotización. Un usuario con solo budgets_read no.
    if (!data.quoteRequest.assigned_to_me && !userHasPermission(user, "quote_requests_read")) {
      delete data.quoteRequest.files;
    }
  }

  // Consumo real por rubro (informativo, nunca pisa lo presupuestado) — solo si el presupuesto
  // ya generó/está vinculado a un proyecto con horas cargadas. No aplica mientras el proyecto
  // todavía no existe (ver FLOWS.md, Fase 2 lo habilita antes de tiempo para adicionales).
  if (data.project && data.project.id) {
    const consumedMap = await sumConsumedHoursByType([data.project.id]);
    const byType = consumedMap.get(data.project.id) || new Map();
    data.laborLines = (data.laborLines || []).map((line) => ({
      ...line,
      consumed_hours: byType.get(line.budget_item_type_id) || 0,
    }));
  }

  // Costo real y precios: ver helpers/budgetTotals.js#applyPriceVisibility. budget_prices_read
  // gatea solo la mano de obra (+ total general y bonificación); los precios y el margen de los
  // materiales los ve cualquiera con acceso a Presupuestos.
  applyPriceVisibility(data, user);

  return data;
}

module.exports = {
  getAll: async (req, res) => {
    try {
      const { status, client_id } = req.query;
      const where = {};
      if (status) where.status = status;
      if (client_id) where.client_id = client_id;

      const budgets = await db.Budget.findAll({
        where,
        include: budgetDetailInclude,
        order: [["created_at", "DESC"]],
      });

      return res.status(200).json({ data: await Promise.all(budgets.map((b) => withTotals(b, req.user))) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  get: async (req, res) => {
    try {
      const budget = await db.Budget.findByPk(req.params.id, { include: budgetDetailInclude });
      if (!budget) return res.status(404).json({ error: "Presupuesto no encontrado." });
      return res.status(200).json({ data: await withTotals(budget, req.user) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  create: async (req, res) => {
    const {
      title, client_id, plant_id, currency, parent_project_id, existing_project_id,
      description, notes, start_date, end_date, validity_days, work_order_number,
      laborLines, materialItems, quote_request_id,
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: "El título es obligatorio." });
    }

    const transaction = await db.sequelize.transaction();
    try {
      let quoteRequest = null;
      if (quote_request_id) {
        quoteRequest = await db.QuoteRequest.findByPk(quote_request_id, { transaction });
        if (!quoteRequest) {
          await transaction.rollback();
          return res.status(400).json({ error: "El Pedido de Cotización indicado no existe." });
        }
      }

      let linkage;
      try {
        linkage = await resolveProjectLinkage({
          parent_project_id, existing_project_id,
          // Cliente/planta de un presupuesto nacido de un PC vienen siempre del PC, nunca de lo
          // que mande el body — mismo resguardo server-side que ya usa resolveProjectLinkage
          // para parent_project_id/existing_project_id (ver FLOWS.md).
          client_id: quoteRequest ? quoteRequest.client_id : client_id,
          plant_id: quoteRequest ? quoteRequest.plant_id : plant_id,
        }, transaction);
      } catch (linkageError) {
        await transaction.rollback();
        return res.status(400).json({ error: linkageError.message });
      }

      if (!linkage.client_id) {
        await transaction.rollback();
        return res.status(400).json({ error: "Cliente es obligatorio." });
      }

      const number = await generateBudgetNumber();

      const budget = await db.Budget.create({
        number,
        title,
        client_id: linkage.client_id,
        plant_id: linkage.plant_id,
        currency: currency || "ARS",
        parent_project_id: linkage.parent_project_id,
        // A diferencia de un adicional o un proyecto nuevo (que recién obtienen su project_id al
        // generarlo), vincular a un proyecto ya existente no tiene nada que "generar" — el
        // proyecto ya existe desde antes, así que el vínculo es real desde la creación del
        // presupuesto. Esto además hace que nunca aparezca el botón "Generar Proyecto" para este
        // caso (ver generateProject, que rechaza budgets con project_id ya seteado).
        project_id: linkage.existing_project_id || null,
        existing_project_id: linkage.existing_project_id,
        description: description || null,
        start_date: start_date || null,
        end_date: end_date || null,
        validity_days: validity_days !== undefined && validity_days !== null ? validity_days : 15,
        notes: notes || null,
        work_order_number: work_order_number || null,
        created_by: req.user.id,
        quote_request_id: quote_request_id || null,
      }, { transaction });

      await openQuoteRequestForWork(quoteRequest, transaction);

      const canSeePrices = userHasPermission(req.user, "budget_prices_read");

      // Mano de obra: solo la toca quien tiene budget_prices_read. Sin el permiso las líneas
      // existentes se conservan TAL CUAL (rubro, horas y valores) y lo que mande el cliente se
      // ignora — antes se recreaban con unit_price 0 y se perdían los valores cargados por
      // quien sí tiene el permiso. La UI las muestra en solo lectura (ver FLOWS.md flujo 25).
      if (canSeePrices && Array.isArray(laborLines)) {
        for (const line of laborLines) {
          const quantity = parseFloat(line.quantity || 0);
          const unitPrice = parseFloat(line.unit_price || 0);
          const lineCurrency = line.currency || null;
          await db.BudgetLaborLine.create({
            budget_id: budget.id,
            budget_item_type_id: line.budget_item_type_id,
            quantity,
            unit_price: unitPrice,
            currency: lineCurrency,
            estimated_total: quantity * unitPrice,
            notes: line.notes || null,
          }, { transaction });

          await syncClientItemRate(linkage.client_id, line.budget_item_type_id, unitPrice, lineCurrency || budget.currency, req.user.id, transaction);
        }

        // Vinculado a un proyecto ya existente desde la creación (ver project_id arriba): sus
        // bolsas de horas por rubro quedan en sync con este presupuesto de una, sin esperar a
        // que se apruebe (mismo mecanismo que ya usa update para adicionales ya generados).
        if (budget.project_id) {
          const rubroBreakdown = await buildRubroHoursBreakdown(budget.id, transaction);
          await replaceProjectHourBudgets(budget.project_id, rubroBreakdown, transaction);
        }
      }

      if (Array.isArray(materialItems)) {
        const canEditCost = userHasPermission(req.user, "material_costs_read");
        for (const item of materialItems) {
          const quantity = parseFloat(item.quantity || 0);
          const editedCost = canEditCost && item.material_cost_snapshot !== undefined && item.material_cost_snapshot !== null
            ? parseFloat(item.material_cost_snapshot)
            : null;
          const costSnapshot = await resolveMaterialCostSnapshot(
            item.material_id,
            item.provider_id,
            transaction,
            editedCost !== null && !isNaN(editedCost) ? { cost: editedCost, currency: item.material_cost_currency, userId: req.user.id } : null
          );

          // El precio al cliente se calcula como margen % sobre el costo real — un material
          // sin vincular al catálogo, o sin costo cargado ahí, no se puede presupuestar
          // (decisión de esta mejora, ver FLOWS.md).
          if (costSnapshot.material_cost_snapshot === null || costSnapshot.material_cost_snapshot === undefined) {
            await transaction.rollback();
            return res.status(400).json({ error: `El material "${item.description || "sin descripción"}" no tiene costo cargado en el catálogo. Cárguelo antes de presupuestarlo.` });
          }

          const cost = parseFloat(costSnapshot.material_cost_snapshot);
          // El margen de materiales no depende de budget_prices_read (solo la mano de obra).
          const marginPercent = parseFloat(item.margin_percent || 0);
          const unitPrice = Math.round(cost * (1 + marginPercent / 100) * 100) / 100;

          await db.BudgetMaterialItem.create({
            budget_id: budget.id,
            material_id: item.material_id,
            description: item.description,
            quantity,
            material_unit_id: item.material_unit_id,
            unit_price: unitPrice,
            currency: costSnapshot.material_cost_currency,
            margin_percent: marginPercent,
            total_price: quantity * unitPrice,
            notes: item.notes || null,
            ...costSnapshot,
          }, { transaction });
        }
      }

      await transaction.commit();

      const fullBudget = await db.Budget.findByPk(budget.id, { include: budgetDetailInclude });
      return res.status(201).json({ data: await withTotals(fullBudget, req.user) });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  update: async (req, res) => {
    const { id } = req.params;
    const {
      title, client_id, plant_id, currency, parent_project_id, existing_project_id,
      description, notes, start_date, end_date, validity_days, work_order_number,
      laborLines, materialItems,
    } = req.body;

    const transaction = await db.sequelize.transaction();
    try {
      const budget = await db.Budget.findByPk(id, { transaction });
      if (!budget) {
        await transaction.rollback();
        return res.status(404).json({ error: "Presupuesto no encontrado." });
      }
      if (budget.status !== "draft") {
        await transaction.rollback();
        return res.status(400).json({ error: "Solo se pueden editar presupuestos en estado borrador." });
      }

      // Un presupuesto nacido de un Pedido de Cotización hereda cliente/planta del PC y no se
      // pueden cambiar — más allá de que el frontend ya deshabilita esos campos, este es el
      // resguardo server-side (mismo criterio que el guard de parent/existing_project_id de
      // abajo, ver FLOWS.md).
      if (budget.quote_request_id) {
        const clientChanged = client_id !== undefined && Number(client_id) !== budget.client_id;
        const plantChanged = plant_id !== undefined && (plant_id || null) !== budget.plant_id;
        if (clientChanged || plantChanged) {
          await transaction.rollback();
          return res.status(400).json({ error: "Este presupuesto nació de un Pedido de Cotización — no se puede cambiar el cliente ni la planta." });
        }
      }

      // Un adicional puede generar su proyecto estando en borrador (ver generateProject) — a
      // partir de ahí no se puede cambiar a qué proyecto está ligado el presupuesto, dejaría al
      // proyecto ya generado (con horas/materiales reales) huérfano de su origen. Esto NO aplica
      // a "vincular a un proyecto existente" (existing_project_id): ahí project_id refleja el
      // mismo vínculo desde la creación (ver create), nunca un proyecto generado — se puede
      // seguir cambiando/quitando el vínculo libremente mientras siga en borrador, como antes.
      if (budget.project_id && !budget.existing_project_id && (
        (parent_project_id !== undefined && parent_project_id !== budget.parent_project_id) ||
        (existing_project_id !== undefined && existing_project_id !== budget.existing_project_id)
      )) {
        await transaction.rollback();
        return res.status(400).json({ error: "Este presupuesto ya generó un proyecto — no se puede cambiar a qué proyecto está vinculado." });
      }

      const previousLaborLines = await db.BudgetLaborLine.findAll({ where: { budget_id: budget.id }, transaction });
      const previousMaterialItems = await db.BudgetMaterialItem.findAll({ where: { budget_id: budget.id }, transaction });
      const previousTotals = computeTotalsByCurrency(budget, previousLaborLines, previousMaterialItems);

      const linkageChanged = parent_project_id !== undefined || existing_project_id !== undefined;
      let linkage = {
        parent_project_id: budget.parent_project_id,
        existing_project_id: budget.existing_project_id,
        client_id: client_id !== undefined ? client_id : budget.client_id,
        plant_id: plant_id !== undefined ? (plant_id || null) : budget.plant_id,
      };
      if (linkageChanged) {
        try {
          linkage = await resolveProjectLinkage({
            parent_project_id: parent_project_id !== undefined ? parent_project_id : budget.parent_project_id,
            existing_project_id: existing_project_id !== undefined ? existing_project_id : budget.existing_project_id,
            client_id: client_id !== undefined ? client_id : budget.client_id,
            plant_id: plant_id !== undefined ? plant_id : budget.plant_id,
            excludeBudgetId: budget.id,
          }, transaction);
        } catch (linkageError) {
          await transaction.rollback();
          return res.status(400).json({ error: linkageError.message });
        }
      }

      // project_id sigue el mismo criterio que en create: si queda vinculado a un proyecto
      // existente, project_id lo refleja siempre; si se desvincula, vuelve a null. Si no es un
      // "vincular a existente" (linkage.existing_project_id falsy) y antes tampoco lo era, no se
      // toca — puede ser el project_id real de un adicional/proyecto nuevo ya generado, que el
      // guard de arriba ya protegió.
      const projectIdUpdate = linkage.existing_project_id
        ? { project_id: linkage.existing_project_id }
        : (budget.existing_project_id ? { project_id: null } : {});

      await budget.update({
        title: title !== undefined ? title : budget.title,
        client_id: linkage.client_id,
        plant_id: linkage.plant_id,
        currency: currency !== undefined ? currency : budget.currency,
        parent_project_id: linkage.parent_project_id,
        existing_project_id: linkage.existing_project_id,
        ...projectIdUpdate,
        description: description !== undefined ? description : budget.description,
        start_date: start_date !== undefined ? (start_date || null) : budget.start_date,
        end_date: end_date !== undefined ? (end_date || null) : budget.end_date,
        validity_days: validity_days !== undefined ? validity_days : budget.validity_days,
        notes: notes !== undefined ? notes : budget.notes,
        work_order_number: work_order_number !== undefined ? (work_order_number || null) : budget.work_order_number,
      }, { transaction });

      const canSeePrices = userHasPermission(req.user, "budget_prices_read");

      // Mano de obra: solo la toca quien tiene budget_prices_read. Sin el permiso las líneas
      // existentes se conservan TAL CUAL (rubro, horas y valores) y lo que mande el cliente se
      // ignora — antes se recreaban con unit_price 0 y se perdían los valores cargados por
      // quien sí tiene el permiso. La UI las muestra en solo lectura (ver FLOWS.md flujo 25).
      if (canSeePrices && Array.isArray(laborLines)) {
        // force: true (hard delete) — si fuera soft-delete, la fila borrada seguiría
        // chocando con el índice único (budget_id, budget_item_type_id) al recrear la
        // misma línea, y Sequelize devuelve un UniqueConstraintError ("Validation error").
        await db.BudgetLaborLine.destroy({ where: { budget_id: budget.id }, transaction, force: true });
        for (const line of laborLines) {
          const quantity = parseFloat(line.quantity || 0);
          const unitPrice = parseFloat(line.unit_price || 0);
          const lineCurrency = line.currency || null;
          await db.BudgetLaborLine.create({
            budget_id: budget.id,
            budget_item_type_id: line.budget_item_type_id,
            quantity,
            unit_price: unitPrice,
            currency: lineCurrency,
            estimated_total: quantity * unitPrice,
            notes: line.notes || null,
          }, { transaction });

          await syncClientItemRate(linkage.client_id, line.budget_item_type_id, unitPrice, lineCurrency || budget.currency, req.user.id, transaction);
        }

        // Si este presupuesto (adicional en borrador) ya generó su proyecto, las bolsas de
        // horas por rubro se resincronizan en cada guardado — no solo la primera vez — para
        // reflejar los cambios que se sigan haciendo mientras el presupuesto se termina de
        // armar (ver generateProject).
        if (budget.project_id) {
          const rubroBreakdown = await buildRubroHoursBreakdown(budget.id, transaction);
          await replaceProjectHourBudgets(budget.project_id, rubroBreakdown, transaction);
        }
      }

      if (Array.isArray(materialItems)) {
        // Antes de destruir, guardamos cómo estaba cada línea — para poder PRESERVAR el
        // material_cost_snapshot de las que no cambiaron de material en esta edición. Sin
        // esto, destruir+recrear en cada guardado terminaba re-resolviendo el costo VIGENTE
        // de todas las líneas (incluidas las que no tocaste) cada vez que se guardaba el
        // presupuesto por cualquier motivo — bug real detectado en uso, ver FLOWS.md.
        const existingItems = await db.BudgetMaterialItem.findAll({
          where: { budget_id: budget.id },
          attributes: ["id", "material_id", "provider_id", "material_cost_snapshot", "material_cost_currency"],
          transaction,
        });
        const existingById = new Map(existingItems.map((i) => [i.id, i]));

        await db.BudgetMaterialItem.destroy({ where: { budget_id: budget.id }, transaction, force: true });
        for (const item of materialItems) {
          const quantity = parseFloat(item.quantity || 0);

          const existing = item.id ? existingById.get(item.id) : null;
          // Si el cliente no manda provider_id, la línea existente conserva el suyo.
          const requestedProviderId = item.provider_id !== undefined && item.provider_id !== null ? Number(item.provider_id) : null;
          const lineProviderId = requestedProviderId ?? (existing ? existing.provider_id : null);
          // Cambiar de proveedor cuenta como cambio de línea: re-resuelve el costo vigente de ese proveedor.
          const materialUnchanged = existing
            && (existing.material_id || null) === (item.material_id || null)
            && (existing.provider_id || null) === (lineProviderId || null);

          // Línea ya existente sin cambio de material → por defecto se preserva la foto tal
          // cual estaba (comparando contra lo que esta línea puntual tenía guardado ANTES,
          // nunca contra el costo vigente del catálogo — si comparáramos contra el vigente,
          // cualquier re-guardado terminaría "detectando" un cambio cada vez que el catálogo
          // se movió por otro lado, que es justamente el bug que esto ya blindaba, ver
          // FLOWS.md). Si el usuario tiene permiso y mandó un costo real distinto al que esta
          // línea tenía, se trata como una edición deliberada: pasa a ser el nuevo costo del
          // material (precio de ese proveedor + MaterialCostHistory, vía syncMaterialCost) —
          // línea nueva, o existente con el material recién vinculado/cambiado, se resuelve el
          // costo vigente en este momento (mismo criterio que create()).
          let costSnapshot;
          if (materialUnchanged) {
            const canEditCost = userHasPermission(req.user, "material_costs_read");
            const editedValue = canEditCost && item.material_cost_snapshot !== undefined && item.material_cost_snapshot !== null
              ? parseFloat(item.material_cost_snapshot)
              : null;
            const existingValue = existing.material_cost_snapshot !== null && existing.material_cost_snapshot !== undefined
              ? parseFloat(existing.material_cost_snapshot)
              : null;
            const genuinelyEdited = editedValue !== null && !isNaN(editedValue) && editedValue !== existingValue;

            if (genuinelyEdited) {
              const material = await db.Material.findByPk(item.material_id, { transaction });
              const providerId = await resolveProviderId(lineProviderId, transaction);
              await syncMaterialCost(material, providerId, editedValue, item.material_cost_currency || existing.material_cost_currency, req.user.id, transaction);
              costSnapshot = { material_cost_snapshot: editedValue, material_cost_currency: item.material_cost_currency || existing.material_cost_currency, provider_id: providerId };
            } else {
              costSnapshot = { material_cost_snapshot: existing.material_cost_snapshot, material_cost_currency: existing.material_cost_currency, provider_id: existing.provider_id };
            }
          } else {
            const canEditCost = userHasPermission(req.user, "material_costs_read");
            const editedCost = canEditCost && item.material_cost_snapshot !== undefined && item.material_cost_snapshot !== null
              ? parseFloat(item.material_cost_snapshot)
              : null;
            costSnapshot = await resolveMaterialCostSnapshot(
              item.material_id,
              lineProviderId,
              transaction,
              editedCost !== null && !isNaN(editedCost) ? { cost: editedCost, currency: item.material_cost_currency, userId: req.user.id } : null
            );
          }

          // El precio al cliente se calcula como margen % sobre el costo real — un material
          // sin vincular al catálogo, o sin costo cargado ahí, no se puede presupuestar
          // (decisión de esta mejora, ver FLOWS.md).
          if (costSnapshot.material_cost_snapshot === null || costSnapshot.material_cost_snapshot === undefined) {
            await transaction.rollback();
            return res.status(400).json({ error: `El material "${item.description || "sin descripción"}" no tiene costo cargado en el catálogo. Cárguelo antes de presupuestarlo.` });
          }

          const cost = parseFloat(costSnapshot.material_cost_snapshot);
          // El margen de materiales no depende de budget_prices_read (solo la mano de obra).
          const marginPercent = parseFloat(item.margin_percent || 0);
          const unitPrice = Math.round(cost * (1 + marginPercent / 100) * 100) / 100;

          await db.BudgetMaterialItem.create({
            budget_id: budget.id,
            material_id: item.material_id,
            description: item.description,
            quantity,
            material_unit_id: item.material_unit_id,
            unit_price: unitPrice,
            currency: costSnapshot.material_cost_currency,
            margin_percent: marginPercent,
            total_price: quantity * unitPrice,
            notes: item.notes || null,
            ...costSnapshot,
          }, { transaction });
        }
      }

      const newLaborLines = await db.BudgetLaborLine.findAll({ where: { budget_id: budget.id }, transaction });
      const newMaterialItems = await db.BudgetMaterialItem.findAll({ where: { budget_id: budget.id }, transaction });
      const newTotals = computeTotalsByCurrency(budget, newLaborLines, newMaterialItems);

      if (JSON.stringify(previousTotals) !== JSON.stringify(newTotals)) {
        await recordAudit({
          entityType: "Budget",
          entityId: budget.id,
          action: "update",
          fieldChanged: "totals_by_currency",
          context: { totals_before: previousTotals, totals_after: newTotals },
          userId: req.user?.id,
        }, transaction);
      }

      await transaction.commit();

      const fullBudget = await db.Budget.findByPk(budget.id, { include: budgetDetailInclude });
      return res.status(200).json({ data: await withTotals(fullBudget, req.user) });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  // Bonificación post-presentación: separada del update general a propósito, porque update
  // solo permite editar presupuestos en "draft" (líneas de arriba) y la bonificación es
  // exactamente lo contrario — el cliente la pide DESPUÉS de "Enviado". Se puede reajustar
  // mientras el presupuesto siga en "sent" o "approved" (ver FLOWS.md).
  applyDiscount: async (req, res) => {
    const { id } = req.params;
    const { labor_discount_percent, material_discount_percent } = req.body;

    // Es una acción de precio — mismo criterio que cargar unit_price/margin_percent, gatea
    // aparte de budgets_update (que ya resuelve la ruta a nivel general).
    if (!userHasPermission(req.user, "budget_prices_read")) {
      return res.status(403).json({ error: "No tiene permiso para aplicar bonificaciones." });
    }

    try {
      const budget = await db.Budget.findByPk(id);
      if (!budget) return res.status(404).json({ error: "Presupuesto no encontrado." });

      if (!["sent", "approved"].includes(budget.status)) {
        return res.status(400).json({ error: "Solo se puede aplicar una bonificación a presupuestos enviados o aprobados." });
      }

      const laborPct = parseFloat(labor_discount_percent || 0);
      const materialPct = parseFloat(material_discount_percent || 0);
      if ([laborPct, materialPct].some((pct) => isNaN(pct) || pct < 0 || pct > 100)) {
        return res.status(400).json({ error: "Los porcentajes de bonificación deben estar entre 0 y 100." });
      }

      await budget.update({
        labor_discount_percent: laborPct,
        material_discount_percent: materialPct,
      });

      const fullBudget = await db.Budget.findByPk(budget.id, { include: budgetDetailInclude });
      return res.status(200).json({ data: await withTotals(fullBudget, req.user) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  destroy: async (req, res) => {
    try {
      const budget = await db.Budget.findByPk(req.params.id);
      if (!budget) return res.status(404).json({ error: "Presupuesto no encontrado." });
      if (budget.status !== "draft") {
        return res.status(400).json({ error: "Solo se pueden eliminar presupuestos en estado borrador." });
      }

      const laborLines = await db.BudgetLaborLine.findAll({ where: { budget_id: budget.id } });
      const materialItems = await db.BudgetMaterialItem.findAll({ where: { budget_id: budget.id } });
      const totals = computeTotalsByCurrency(budget, laborLines, materialItems);

      await recordAudit({
        entityType: "Budget",
        entityId: budget.id,
        action: "delete",
        fieldChanged: "totals_by_currency",
        context: { totals_at_deletion: totals },
        userId: req.user?.id,
      });

      await budget.destroy();
      return res.status(200).json({ message: "Presupuesto eliminado." });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  changeStatus: async (req, res) => {
    const { id } = req.params;
    const { status, rejection_reason, approved_by_supervisor_id } = req.body;
    const file = req.file;

    const validTransitions = {
      draft: ["sent"],
      sent: ["approved", "rejected"],
      // "approved" -> "approved" no es una transición real: permite volver a llamar este
      // mismo endpoint solo para subir/reemplazar el documento firmado, igual que
      // ocaController.approve permite re-aprobar una OCA ya aprobada para actualizar la imagen.
      approved: ["approved"],
    };

    try {
      const budget = await db.Budget.findByPk(id);
      if (!budget) return res.status(404).json({ error: "Presupuesto no encontrado." });

      const allowed = validTransitions[budget.status] || [];
      if (!allowed.includes(status)) {
        return res.status(400).json({ error: `No se puede cambiar el estado de "${budget.status}" a "${status}".` });
      }

      // Enviar al cliente es un permiso aparte de budgets_update: quien arma el presupuesto
      // (típicamente el responsable de un Pedido de Cotización) puede editarlo todo lo que
      // necesite, pero no ponerlo en manos del cliente — se lo entrega a gerencia y gerencia
      // envía. Resguardo server-side; la UI ya oculta el botón (ver FLOWS.md flujo 27).
      if (status === "sent" && !userHasPermission(req.user, "budgets_send")) {
        return res.status(403).json({ error: "No tenés permiso para enviar presupuestos al cliente." });
      }
      // Quien no ve los valores de mano de obra (budget_prices_read) tampoco puede enviar: lo
      // que le llegaría al cliente sería un presupuesto incompleto (ver FLOWS.md flujo 25).
      if (status === "sent" && !userHasPermission(req.user, "budget_prices_read")) {
        return res.status(403).json({ error: "Para enviar un presupuesto al cliente necesitás ver los valores de mano de obra (permiso de precios)." });
      }

      if (status === "rejected" && !rejection_reason) {
        return res.status(400).json({ error: "El motivo de rechazo es obligatorio." });
      }

      const updates = { status };
      if (status === "sent") updates.sent_at = new Date();
      if (status === "rejected") {
        updates.rejected_at = new Date();
        updates.rejection_reason = rejection_reason;
      }
      if (status === "approved") {
        // Documento firmado y supervisor externo son opcionales — se puede aprobar sin
        // completarlos y volver a llamar este mismo endpoint después para agregarlos.
        updates.approved_at = budget.approved_at || new Date();
        // approved_by: quién cargó la aprobación en el sistema (usuario interno).
        updates.approved_by = budget.approved_by || req.user.id;
        // approved_by_supervisor_id: quién aprobó del lado del cliente (contacto externo,
        // distinto del usuario interno de arriba).
        if (approved_by_supervisor_id) {
          updates.approved_by_supervisor_id = approved_by_supervisor_id;
        }
        if (file) {
          updates.approved_document_url = await uploadToR2(file, `budgets/${budget.id}`);
        }
      }

      await budget.update(updates);

      // El PC se da por cumplido cuando la cotización sale al cliente, no cuando se aprueba o
      // rechaza — eso ya es un asunto entre el cliente y el presupuesto (ver FLOWS.md). Se
      // hoistea `quoteRequest` fuera del if para poder usarlo después en el push.
      let notifiedQuoteRequest = null;
      let notifiedQuoteRequestPreviousStatus = null;
      if (status === "sent" && budget.quote_request_id) {
        const quoteRequest = await db.QuoteRequest.findByPk(budget.quote_request_id);
        if (quoteRequest && quoteRequest.status !== "quoted") {
          notifiedQuoteRequestPreviousStatus = quoteRequest.status;
          await quoteRequest.update({ status: "quoted" });
          notifiedQuoteRequest = quoteRequest;

          // Línea de tiempo del PC (ver FLOWS.md flujo 27g) — sin destinatarios, nunca puede
          // romper el envío del presupuesto.
          db.QuoteRequestStatusLog.create({
            quote_request_id: quoteRequest.id,
            event: "quoted",
            from_status: notifiedQuoteRequestPreviousStatus,
            to_status: "quoted",
            changed_by: req.user.id,
          }).catch((error) => {
            console.error(`[quote-request-log] error registrando "quoted" del PC ${quoteRequest.id}:`, error.message);
          });
        }
      }

      // Push "presupuesto enviado": en este momento los asignados del PC son gerencia (quien
      // envía), así que notificar por el set de assignees no le avisaría a nadie — se notifica
      // a quien armó el presupuesto (ver FLOWS.md flujo 28).
      if (notifiedQuoteRequest && budget.created_by && budget.created_by !== req.user.id) {
        sendPushToUsers([budget.created_by], {
          title: "Presupuesto enviado",
          body: `${budget.number} se envió al cliente`,
          url: `/dashboard/budgets?view=${budget.id}`,
          tag: `budget-${budget.id}`,
          excludeUserId: req.user.id,
        });
      }

      const fullBudget = await db.Budget.findByPk(budget.id, { include: budgetDetailInclude });
      return res.status(200).json({ data: await withTotals(fullBudget, req.user) });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  generateProject: async (req, res) => {
    const { id } = req.params;
    const transaction = await db.sequelize.transaction();

    try {
      const budget = await db.Budget.findByPk(id, { transaction });
      if (!budget) {
        await transaction.rollback();
        return res.status(404).json({ error: "Presupuesto no encontrado." });
      }
      // Un adicional (parent_project_id) puede generar su proyecto aún en borrador — no se sabe
      // todavía el alcance real, se va cargando horas mientras se termina de armar el
      // presupuesto formal. Proyecto nuevo raíz o vinculación a uno existente siguen
      // requiriendo aprobación (ver FLOWS.md).
      const isDraftAdditional = budget.status === "draft" && !!budget.parent_project_id;
      if (budget.status !== "approved" && !isDraftAdditional) {
        await transaction.rollback();
        return res.status(400).json({ error: "Solo se puede generar el proyecto desde un presupuesto aprobado (o, si es un adicional, desde uno en borrador)." });
      }
      if (budget.project_id) {
        await transaction.rollback();
        return res.status(400).json({ error: "Este presupuesto ya generó un proyecto." });
      }

      const project = await createProjectFromBudget(budget, transaction);
      await budget.update({ project_id: project.id }, { transaction });

      await transaction.commit();

      const fullBudget = await db.Budget.findByPk(budget.id, { include: budgetDetailInclude });
      return res.status(200).json({ message: "Proyecto generado correctamente.", data: await withTotals(fullBudget, req.user) });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  duplicate: async (req, res) => {
    const { id } = req.params;
    // quote_request_id no se copia solo del original: queda a criterio del usuario si este
    // duplicado sigue atado al mismo Pedido de Cotización (y por lo tanto hereda su número de
    // cotización del cliente) o nace libre — no hay una regla de negocio única todavía, puede
    // ser una repregunta del mismo pedido o una PC nueva que el cliente volvió a mandar meses
    // después con otro número (ver FLOWS.md flujo 27).
    const { quote_request_id } = req.body;

    const transaction = await db.sequelize.transaction();

    try {
      const original = await db.Budget.findByPk(id, {
        include: [
          { model: db.BudgetLaborLine, as: "laborLines" },
          { model: db.BudgetMaterialItem, as: "materialItems" },
        ],
        transaction,
      });
      if (!original) {
        await transaction.rollback();
        return res.status(404).json({ error: "Presupuesto no encontrado." });
      }

      // Si se eligió mantener el vínculo con el Pedido de Cotización, cliente/planta se fuerzan
      // desde ahí — mismo resguardo server-side que en create, nunca se confía en lo que venga
      // del body para ese caso.
      let quoteRequest = null;
      if (quote_request_id) {
        quoteRequest = await db.QuoteRequest.findByPk(quote_request_id, { transaction });
        if (!quoteRequest) {
          await transaction.rollback();
          return res.status(400).json({ error: "El Pedido de Cotización indicado no existe." });
        }
      }

      const number = await generateBudgetNumber();
      const copy = await db.Budget.create({
        number,
        title: `${original.title} (copia)`,
        client_id: quoteRequest ? quoteRequest.client_id : original.client_id,
        plant_id: quoteRequest ? quoteRequest.plant_id : original.plant_id,
        currency: original.currency,
        parent_project_id: original.parent_project_id,
        // existing_project_id NO se copia a propósito: si el original quedó vinculado (o
        // pendiente de vincularse) a un proyecto existente, duplicar y dejar el mismo
        // vínculo crearía dos borradores compitiendo por el mismo proyecto.
        existing_project_id: null,
        description: original.description,
        start_date: original.start_date,
        end_date: original.end_date,
        validity_days: original.validity_days,
        notes: original.notes,
        quote_request_id: quoteRequest ? quoteRequest.id : null,
        status: "draft",
        created_by: req.user.id,
      }, { transaction });

      for (const line of original.laborLines) {
        await db.BudgetLaborLine.create({
          budget_id: copy.id,
          budget_item_type_id: line.budget_item_type_id,
          quantity: line.quantity,
          unit_price: line.unit_price,
          currency: line.currency,
          estimated_total: line.estimated_total,
          notes: line.notes,
        }, { transaction });
      }

      for (const item of original.materialItems) {
        await db.BudgetMaterialItem.create({
          budget_id: copy.id,
          material_id: item.material_id,
          provider_id: item.provider_id,
          description: item.description,
          quantity: item.quantity,
          material_unit_id: item.material_unit_id,
          unit_price: item.unit_price,
          currency: item.currency,
          margin_percent: item.margin_percent,
          total_price: item.total_price,
          material_cost_snapshot: item.material_cost_snapshot,
          material_cost_currency: item.material_cost_currency,
          notes: item.notes,
        }, { transaction });
      }

      await openQuoteRequestForWork(quoteRequest, transaction);

      await transaction.commit();

      const fullBudget = await db.Budget.findByPk(copy.id, { include: budgetDetailInclude });
      return res.status(201).json({ message: "Presupuesto duplicado como borrador.", data: await withTotals(fullBudget, req.user) });
    } catch (error) {
      await transaction.rollback();
      return res.status(500).json({ error: error.message });
    }
  },

  // Parseo "stateless" de un Excel de materiales — no persiste nada, solo devuelve
  // filas de previsualización para que el frontend las agregue al form (nuevo o existente).
  // El alta de materiales/proveedores/precios es POST /materials/import (importCommit).
  importMaterials: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Debe subir un archivo .xlsx/.xls." });
      }

      const parsed = await parseMaterialSheet(req.file.buffer);
      const rows = parsed.map((row) => ({
        description: row.description,
        quantity: row.quantity,
        unit: row.unit,
        provider: row.provider,
        cost: row.cost,
        currency: row.currency,
        kg_per_meter: row.kg_per_meter,
        total_price: row.total_price ?? 0,
      }));

      return res.status(200).json({ data: rows });
    } catch (error) {
      return res.status(error.status || 500).json({ error: error.status ? error.message : `No se pudo leer el archivo: ${error.message}` });
    }
  },
};
