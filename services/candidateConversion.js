const { Op } = require("sequelize");
const db = require("../models");
const { writeLog } = require("../helpers/candidateData");
const { findEmployeeMatches } = require("../helpers/candidateMatching");
const { OPEN_STAGES } = require("../helpers/candidateStages");

/**
 * Conversión de un postulante en empleado (ver FLOWS.md §62). La llama `employeeController.create`
 * cuando el alta trae `candidate_id`.
 *
 * Todo ocurre en UNA transacción: el empleado, el vínculo con el candidato, la postulación que pasa a
 * `hired` y el cierre de las demás. Si algo falla (por ejemplo un DNI repetido al crear el empleado),
 * no queda un candidato "contratado" sin empleado ni un empleado sin vínculo.
 *
 * Las validaciones devuelven `{ error, status }` en vez de lanzar: son condiciones de negocio esperables,
 * no fallos. Lo que sí lanza (un unique de Employee, por ejemplo) lo traduce el catch del controller.
 */

// Etapas desde las que se puede contratar: el botón de la ficha solo aparece en estas dos.
const HIRING_STAGES = ["interview", "offer"];

async function convertCandidateToEmployee({ candidateId, employeeData, userId }) {
  const transaction = await db.sequelize.transaction();
  try {
    // FOR UPDATE: dos altas simultáneas del mismo postulante no pueden pasar las dos la validación.
    const candidate = await db.Candidate.findByPk(candidateId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!candidate) {
      await transaction.rollback();
      return { error: "Postulante no encontrado.", status: 404 };
    }
    if (candidate.employee_id) {
      await transaction.rollback();
      return { error: "Este postulante ya fue dado de alta como empleado.", status: 400 };
    }

    // Ex-empleados y empleados actuales: se miran el DNI/CUIL del postulante Y los del alta, por si se
    // corrigieron al cargar. Un ex-empleado no se convierte acá: el reingreso se trata aparte.
    const matches = await findEmployeeMatches({
      dni: candidate.dni || employeeData.dni,
      cuil: candidate.cuil || employeeData.cuil,
    });
    const submitted = await findEmployeeMatches({ dni: employeeData.dni, cuil: employeeData.cuil });
    const former = [...matches.former, ...submitted.former];
    const current = [...matches.current, ...submitted.current];
    if (former.length > 0) {
      await transaction.rollback();
      return { error: "Este DNI o CUIL pertenece a un ex-empleado. El reingreso se trata aparte: no se puede dar de alta desde Postulantes.", status: 400 };
    }
    if (current.length > 0) {
      await transaction.rollback();
      return { error: "Este DNI o CUIL ya pertenece a un empleado actual.", status: 400 };
    }

    const openApplications = await db.CandidateApplication.findAll({
      where: { candidate_id: candidate.id, stage: { [Op.in]: OPEN_STAGES } },
      order: [["id", "DESC"]],
      transaction,
    });
    const hiring = openApplications.find((a) => HIRING_STAGES.includes(a.stage));
    if (!hiring) {
      await transaction.rollback();
      return { error: "Para dar de alta a un postulante su postulación tiene que estar en entrevista o en oferta.", status: 400 };
    }

    const employee = await db.Employee.create(employeeData, { transaction });

    const now = new Date();
    await candidate.update({ employee_id: employee.id, converted_at: now, converted_by: userId }, { transaction });

    const previousStage = hiring.stage;
    await hiring.update({ stage: "hired", rejection_reason: null, rejection_notes: null }, { transaction });
    await writeLog(
      { applicationId: hiring.id, event: "converted", fromStage: previousStage, toStage: "hired", comment: `Dado de alta como empleado (${employee.name} ${employee.lastname}).`, changedBy: userId },
      transaction
    );

    // Cualquier otra postulación abierta ya no tiene sentido: la persona entró a trabajar.
    for (const other of openApplications.filter((a) => a.id !== hiring.id)) {
      const from = other.stage;
      await other.update({ stage: "withdrawn", rejection_reason: null, rejection_notes: null }, { transaction });
      await writeLog(
        { applicationId: other.id, event: "stage_changed", fromStage: from, toStage: "withdrawn", comment: "La persona fue dada de alta como empleado desde otra postulación.", changedBy: userId },
        transaction
      );
    }

    // Las entrevistas que seguían agendadas se cancelan: ya no hay nada que entrevistar.
    const applicationIds = openApplications.map((a) => a.id);
    await db.CandidateInterview.update(
      { status: "cancelled" },
      { where: { application_id: applicationIds, status: "scheduled" }, transaction }
    );

    await transaction.commit();
    return { employee };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

module.exports = { convertCandidateToEmployee, HIRING_STAGES };
