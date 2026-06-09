const { Op } = require("sequelize");
const db = require("../models");

/**
 * Compliance Service
 * 
 * Centralizes the logic for evaluating whether employees meet
 * the document requirements defined for a plant.
 * 
 * Designed to be consumed by any controller (plants, projects, etc.)
 * without duplicating business logic.
 */
module.exports = {
  /**
   * Evaluate compliance for all active employees against a plant's requirements.
   * 
   * @param {number} plantId
   * @param {number[]} [employeeIds] - Optional filter. If omitted, all active employees are evaluated.
   * @returns {Promise<Array<{
   *   employee: { id, name, lastname },
   *   status: 'compliant' | 'partial' | 'non_compliant',
   *   summary: { total, met, missing, expiring },
   *   details: Array<{ requirement, status, document? }>
   * }>>}
   */
  getPlantCompliance: async (plantId, employeeIds = null) => {
    // Ensure plantId is an integer (req.params values are strings)
    plantId = parseInt(plantId);

    // 1. Get all requirements for this plant
    const requirements = await db.PlantRequirement.findAll({
      where: { plant_id: plantId },
      include: [
        { model: db.DocumentCategory, as: "documentCategory", attributes: ["id", "name", "is_plant_specific"] },
      ],
    });

    if (requirements.length === 0) {
      return { requirements: [], employees: [] };
    }

    // 2. Get employees to evaluate
    const empWhere = { status: "active" };
    if (employeeIds && employeeIds.length > 0) {
      empWhere.id = { [Op.in]: employeeIds };
    }

    const employees = await db.Employee.findAll({
      where: empWhere,
      attributes: ["id", "name", "lastname"],
      order: [["lastname", "ASC"], ["name", "ASC"]],
    });

    if (employees.length === 0) {
      return { requirements: requirements.map(r => r.toJSON()), employees: [] };
    }

    // 3. Batch-fetch all relevant documents for these employees
    //    Filter: entity_type=employee, entity_id in employeeIds,
    //    document_category_id in the required categories
    const categoryIds = requirements.map(r => r.document_category_id);
    const empIds = employees.map(e => e.id);

    const documents = await db.EntityDocument.findAll({
      where: {
        entity_type: "employee",
        entity_id: { [Op.in]: empIds },
        document_category_id: { [Op.in]: categoryIds },
        alert_status: { [Op.ne]: "resolved" }, // Only active documents (not superseded by renewal)
      },
      attributes: [
        "id", "entity_id", "document_category_id", "target_plant_id",
        "expiration_date", "notify_days_before", "alert_status", "title",
      ],
    });

    // 4. Evaluate each employee against each requirement
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const results = employees.map(emp => {
      const details = requirements.map(req => {
        const category = req.documentCategory;

        // Find matching documents for this employee + category
        let candidateDocs = documents.filter(
          d => d.entity_id === emp.id && d.document_category_id === req.document_category_id
        );

        // If category is plant-specific, filter by target_plant_id
        if (category.is_plant_specific) {
          candidateDocs = candidateDocs.filter(d => d.target_plant_id === plantId);
        }

        if (candidateDocs.length === 0) {
          return {
            requirement: {
              id: req.id,
              category_name: category.name,
              is_mandatory: req.is_mandatory,
              is_plant_specific: category.is_plant_specific,
            },
            status: "missing",
            document: null,
          };
        }

        // Pick the best document (prefer non-expired, then latest expiration)
        const evaluated = candidateDocs.map(doc => {
          const expDate = doc.expiration_date;
          let docStatus = "valid";

          if (expDate) {
            const exp = new Date(expDate + "T00:00:00");
            const notifyDays = doc.notify_days_before || 15;
            const diffMs = exp.getTime() - today.getTime();
            const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

            if (diffDays < 0) docStatus = "expired";
            else if (diffDays <= notifyDays) docStatus = "expiring_soon";
          } else {
            docStatus = "valid"; // No expiration = permanent
          }

          return { doc, docStatus };
        });

        // Sort: valid > expiring_soon > expired
        const priority = { valid: 0, expiring_soon: 1, expired: 2 };
        evaluated.sort((a, b) => priority[a.docStatus] - priority[b.docStatus]);

        const best = evaluated[0];

        return {
          requirement: {
            id: req.id,
            category_name: category.name,
            is_mandatory: req.is_mandatory,
            is_plant_specific: category.is_plant_specific,
          },
          status: best.docStatus,
          document: {
            id: best.doc.id,
            title: best.doc.title,
            expiration_date: best.doc.expiration_date,
          },
        };
      });

      // Calculate summary
      const mandatoryDetails = details.filter(d => d.requirement.is_mandatory);
      const hasMissingMandatory = mandatoryDetails.some(d => d.status === "missing");
      const hasExpiredMandatory = mandatoryDetails.some(d => d.status === "expired");
      const hasExpiringMandatory = mandatoryDetails.some(d => d.status === "expiring_soon");

      let overallStatus = "compliant";
      if (hasMissingMandatory || hasExpiredMandatory) {
        overallStatus = "non_compliant";
      } else if (hasExpiringMandatory) {
        overallStatus = "expiring";
      }

      return {
        employee: { id: emp.id, name: emp.name, lastname: emp.lastname },
        status: overallStatus,
        summary: {
          total: details.length,
          met: details.filter(d => d.status === "valid" || d.status === "expiring_soon").length,
          expiring: details.filter(d => d.status === "expiring_soon").length,
          missing: details.filter(d => d.status === "missing").length,
          expired: details.filter(d => d.status === "expired").length,
        },
        details,
      };
    });

    return {
      requirements: requirements.map(r => ({
        id: r.id,
        category_name: r.documentCategory.name,
        is_mandatory: r.is_mandatory,
        is_plant_specific: r.documentCategory.is_plant_specific,
      })),
      employees: results,
    };
  },

  /**
   * Get the team (employees who logged hours) for a project,
   * enriched with compliance status if the project has a plant.
   * 
   * @param {number} projectId
   * @returns {Promise<{ team: Array, project: Object }>}
   */
  getProjectTeam: async (projectId) => {
    const { fn, col } = require("sequelize");

    const project = await db.Project.findByPk(projectId, {
      include: [
        { model: db.Client, as: "client", attributes: ["id", "razonSocial"] },
        { model: db.Plant, as: "plant", attributes: ["id", "name"] },
      ],
    });

    if (!project) return null;

    // Get distinct employees who logged approved hours on this project
    const timeAgg = await db.TimeEntry.findAll({
      where: { project_id: projectId, status: "approved" },
      attributes: [
        "employee_id",
        [fn("SUM", col("regular_hours")), "total_regular"],
        [fn("SUM", col("overtime_50_hours")), "total_50"],
        [fn("SUM", col("overtime_100_hours")), "total_100"],
        [fn("COUNT", col("id")), "entry_count"],
        [fn("MIN", col("date")), "first_date"],
        [fn("MAX", col("date")), "last_date"],
      ],
      group: ["employee_id"],
    });

    if (timeAgg.length === 0) {
      return { project: project.toJSON(), team: [] };
    }

    const empIds = timeAgg.map(t => t.employee_id);

    // Fetch employee names
    const employees = await db.Employee.findAll({
      where: { id: { [Op.in]: empIds } },
      attributes: ["id", "name", "lastname"],
    });
    const empMap = Object.fromEntries(employees.map(e => [e.id, e]));

    // Build team data
    let team = timeAgg.map(t => {
      const reg = parseFloat(t.getDataValue("total_regular") || 0);
      const ot50 = parseFloat(t.getDataValue("total_50") || 0);
      const ot100 = parseFloat(t.getDataValue("total_100") || 0);

      return {
        employee: empMap[t.employee_id]
          ? { id: t.employee_id, name: empMap[t.employee_id].name, lastname: empMap[t.employee_id].lastname }
          : { id: t.employee_id, name: "?", lastname: "?" },
        hours: {
          regular: reg,
          overtime_50: ot50,
          overtime_100: ot100,
          weighted_total: reg + (ot50 * 0.5) + (ot100 * 1.0),
        },
        entries: parseInt(t.getDataValue("entry_count") || 0),
        first_date: t.getDataValue("first_date"),
        last_date: t.getDataValue("last_date"),
        compliance: null, // Will be enriched below if project has a plant
      };
    });

    // Sort by weighted hours descending
    team.sort((a, b) => b.hours.weighted_total - a.hours.weighted_total);

    // If the project has a plant, enrich with compliance
    if (project.plant_id) {
      const compliance = await module.exports.getPlantCompliance(project.plant_id, empIds);
      if (compliance.employees.length > 0) {
        for (const member of team) {
          const match = compliance.employees.find(e => e.employee.id === member.employee.id);
          if (match) {
            member.compliance = {
              status: match.status,
              summary: match.summary,
            };
          }
        }
      }
    }

    return { project: project.toJSON(), team };
  },
};
