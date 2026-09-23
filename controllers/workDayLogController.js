"use strict";

const { Op, fn, col } = require("sequelize");
const db = require("../models");

const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function getMonday(dateString) {
  const d = new Date(dateString + "T00:00:00");
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return monday.toISOString().split("T")[0];
}

function getWeekDays(mondayString) {
  const days = [];
  const m = new Date(mondayString + "T00:00:00");
  for (let i = 0; i < 7; i++) {
    const d = new Date(m);
    d.setDate(m.getDate() + i);
    days.push(d.toISOString().split("T")[0]);
  }
  return days;
}

function formatTime(timeStr) {
  if (!timeStr) return null;
  return String(timeStr).slice(0, 5);
}

async function getProjectWithSubprojects(projectId) {
  const project = await db.Project.findByPk(projectId, {
    include: [{ model: db.Project, as: "subprojects", attributes: ["id"] }],
  });
  if (!project) return null;

  const projectIds = [project.id];
  if (project.subprojects && project.subprojects.length > 0) {
    project.subprojects.forEach((sp) => projectIds.push(sp.id));
  }
  return { project, projectIds };
}

/**
 * Normaliza una tarea para comparar si es "la misma" que otra a pesar de diferencias menores de
 * tipeo (mayúsculas/minúsculas, espacios, punto final) — ej. "Pintura de silos verticales" y
 * "Pintura de silos verticales." no deben quedar como dos tareas distintas en la sugerencia.
 */
function normalizeTaskForDedup(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/, "")
    .trim();
}

/**
 * A partir de las TimeEntries aprobadas de un rango de fechas, arma por día: el horario sugerido
 * (mínimo check_in / máximo check_out, igual que antes) y el detalle de tareas sugerido (las
 * TimeEntry.notes de ese día, unificando las que son la misma tarea aunque estén tipeadas
 * distinto — ver normalizeTaskForDedup — sin indicar empleado) — este último se usa como
 * sugerencia para el campo "observations" cuando el día todavía no tiene un valor guardado,
 * mismo criterio que start_time/end_time. No es una columna propia.
 */
function computeDayAggregates(rawEntries) {
  const byDate = new Map();
  rawEntries.forEach((entry) => {
    const existing = byDate.get(entry.date) || { checkIns: [], checkOuts: [], tasks: new Map() };
    if (entry.check_in) existing.checkIns.push(entry.check_in);
    if (entry.check_out) existing.checkOuts.push(entry.check_out);
    const task = (entry.notes || "").trim();
    if (task) {
      const key = normalizeTaskForDedup(task);
      if (key && !existing.tasks.has(key)) existing.tasks.set(key, task);
    }
    byDate.set(entry.date, existing);
  });

  const result = new Map();
  byDate.forEach((value, date) => {
    result.set(date, {
      start_time: value.checkIns.length ? formatTime(value.checkIns.sort()[0]) : null,
      end_time: value.checkOuts.length ? formatTime(value.checkOuts.sort()[value.checkOuts.length - 1]) : null,
      tasks_detail: value.tasks.size ? Array.from(value.tasks.values()).join("; ") : null,
    });
  });
  return result;
}

module.exports = {
  getWeek: async (req, res) => {
    try {
      const projectId = req.params.id;
      const projectData = await getProjectWithSubprojects(projectId);
      if (!projectData) {
        return res.status(404).json({ error: "Proyecto no encontrado." });
      }

      const todayStr = new Date().toISOString().split("T")[0];
      const weekStart = getMonday(req.query.week_start || todayStr);
      const weekDays = getWeekDays(weekStart);

      // 1. Existing WorkDayLogs
      const savedLogs = await db.WorkDayLog.findAll({
        where: {
          project_id: projectId,
          date: { [Op.in]: weekDays },
        },
      });
      const savedMap = new Map();
      savedLogs.forEach((log) => savedMap.set(log.date, log));

      // 2. Computed times + tasks from approved TimeEntries (including subprojects)
      const rawEntries = await db.TimeEntry.findAll({
        where: {
          project_id: { [Op.in]: projectData.projectIds },
          date: { [Op.in]: weekDays },
          status: "approved",
        },
        attributes: ["date", "check_in", "check_out", "notes"],
        raw: true,
      });
      const computedMap = computeDayAggregates(rawEntries);

      // 3. Holidays
      const holidays = await db.Holiday.findAll({
        where: { date: { [Op.in]: weekDays } },
        raw: true,
      });
      const holidayMap = new Map();
      holidays.forEach((h) => holidayMap.set(h.date, h.name));

      // Assemble 7 days
      const days = weekDays.map((dateStr, index) => {
        const saved = savedMap.get(dateStr);
        const computed = computedMap.get(dateStr);
        const holidayName = holidayMap.get(dateStr);

        const isSaved = !!saved;
        const computedStart = computed?.start_time || null;
        const computedEnd = computed?.end_time || null;

        let startTime = isSaved ? formatTime(saved.start_time) : computedStart;
        let endTime = isSaved ? formatTime(saved.end_time) : computedEnd;
        let suspensionReason = saved?.suspension_reason || null;
        let suspendedBy = saved?.suspended_by || null;
        let observations = saved?.observations || null;

        // Sin valor guardado, se sugiere el detalle de tareas del día
        if (!isSaved && !observations) {
          observations = computed?.tasks_detail || null;
        }

        // Default suspension text if holiday and not saved
        if (holidayName && !isSaved && !suspensionReason) {
          suspensionReason = "Feriado";
          if (!observations) observations = `Feriado: ${holidayName}`;
        }

        return {
          id: saved?.id || undefined,
          project_id: Number(projectId),
          date: dateStr,
          day_name: DAY_NAMES[index],
          start_time: startTime,
          end_time: endTime,
          computed_start_time: computedStart,
          computed_end_time: computedEnd,
          suspension_reason: suspensionReason,
          suspended_by: suspendedBy,
          observations: observations,
          is_saved: isSaved,
          is_holiday: !!holidayName,
          holiday_name: holidayName || null,
        };
      });

      return res.status(200).json({
        data: {
          week_start: weekDays[0],
          week_end: weekDays[6],
          days,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  getAll: async (req, res) => {
    try {
      const projectId = req.params.id;
      const projectData = await getProjectWithSubprojects(projectId);
      if (!projectData) {
        return res.status(404).json({ error: "Proyecto no encontrado." });
      }

      const { project, projectIds } = projectData;

      // Determine date range
      const todayStr = new Date().toISOString().split("T")[0];
      let fromStr = req.query.from;
      let toStr = req.query.to;

      if (!fromStr) {
        const minTimeEntry = await db.TimeEntry.findOne({
          where: { project_id: { [Op.in]: projectIds }, status: "approved" },
          attributes: [[fn("MIN", col("date")), "min_date"]],
          raw: true,
        });
        const minWorkDayLog = await db.WorkDayLog.findOne({
          where: { project_id: projectId },
          attributes: [[fn("MIN", col("date")), "min_date"]],
          raw: true,
        });

        const dates = [];
        if (project.start_date) dates.push(project.start_date);
        if (minTimeEntry && minTimeEntry.min_date) dates.push(minTimeEntry.min_date);
        if (minWorkDayLog && minWorkDayLog.min_date) dates.push(minWorkDayLog.min_date);

        if (dates.length > 0) {
          dates.sort();
          fromStr = getMonday(dates[0]);
        } else {
          fromStr = getMonday(todayStr);
        }
      } else {
        fromStr = getMonday(fromStr);
      }

      if (!toStr) {
        const maxTimeEntry = await db.TimeEntry.findOne({
          where: { project_id: { [Op.in]: projectIds }, status: "approved" },
          attributes: [[fn("MAX", col("date")), "max_date"]],
          raw: true,
        });
        const maxWorkDayLog = await db.WorkDayLog.findOne({
          where: { project_id: projectId },
          attributes: [[fn("MAX", col("date")), "max_date"]],
          raw: true,
        });

        const dates = [todayStr];
        if (project.end_date) dates.push(project.end_date);
        if (maxTimeEntry && maxTimeEntry.max_date) dates.push(maxTimeEntry.max_date);
        if (maxWorkDayLog && maxWorkDayLog.max_date) dates.push(maxWorkDayLog.max_date);

        dates.sort().reverse();
        const mondayEnd = getMonday(dates[0]);
        const sundayEnd = new Date(mondayEnd + "T00:00:00");
        sundayEnd.setDate(sundayEnd.getDate() + 6);
        toStr = sundayEnd.toISOString().split("T")[0];
      }

      // Generate all weeks between fromStr and toStr
      const weeks = [];
      let currentMonday = new Date(fromStr + "T00:00:00");
      const endDateLimit = new Date(toStr + "T00:00:00");

      while (currentMonday <= endDateLimit) {
        const mondayIso = currentMonday.toISOString().split("T")[0];
        const weekDays = getWeekDays(mondayIso);
        weeks.push({ week_start: weekDays[0], week_end: weekDays[6], weekDays });
        currentMonday.setDate(currentMonday.getDate() + 7);
      }

      const allDates = weeks.flatMap((w) => w.weekDays);

      // 1. Fetch saved WorkDayLogs
      const savedLogs = await db.WorkDayLog.findAll({
        where: {
          project_id: projectId,
          date: { [Op.in]: allDates },
        },
      });
      const savedMap = new Map();
      savedLogs.forEach((log) => savedMap.set(log.date, log));

      // 2. Fetch computed TimeEntries (horario + tareas sugeridas)
      const rawEntries = await db.TimeEntry.findAll({
        where: {
          project_id: { [Op.in]: projectIds },
          date: { [Op.in]: allDates },
          status: "approved",
        },
        attributes: ["date", "check_in", "check_out", "notes"],
        raw: true,
      });
      const computedMap = computeDayAggregates(rawEntries);

      // 3. Fetch Holidays
      const holidays = await db.Holiday.findAll({
        where: { date: { [Op.in]: allDates } },
        raw: true,
      });
      const holidayMap = new Map();
      holidays.forEach((h) => holidayMap.set(h.date, h.name));

      // Assemble weeks response
      const resultWeeks = weeks.map((w) => {
        const days = w.weekDays.map((dateStr, index) => {
          const saved = savedMap.get(dateStr);
          const computed = computedMap.get(dateStr);
          const holidayName = holidayMap.get(dateStr);

          const isSaved = !!saved;
          const computedStart = computed?.start_time || null;
          const computedEnd = computed?.end_time || null;

          let startTime = isSaved ? formatTime(saved.start_time) : computedStart;
          let endTime = isSaved ? formatTime(saved.end_time) : computedEnd;
          let suspensionReason = saved?.suspension_reason || null;
          let suspendedBy = saved?.suspended_by || null;
          let observations = saved?.observations || null;

          // Sin valor guardado, se sugiere el detalle de tareas del día
          if (!isSaved && !observations) {
            observations = computed?.tasks_detail || null;
          }

          if (holidayName && !isSaved && !suspensionReason) {
            suspensionReason = "Feriado";
            if (!observations) observations = `Feriado: ${holidayName}`;
          }

          return {
            id: saved?.id || undefined,
            project_id: Number(projectId),
            date: dateStr,
            day_name: DAY_NAMES[index],
            start_time: startTime,
            end_time: endTime,
            computed_start_time: computedStart,
            computed_end_time: computedEnd,
            suspension_reason: suspensionReason,
            suspended_by: suspendedBy,
            observations: observations,
            is_saved: isSaved,
            is_holiday: !!holidayName,
            holiday_name: holidayName || null,
          };
        });

        return {
          week_start: w.week_start,
          week_end: w.week_end,
          days,
        };
      });

      return res.status(200).json({ data: resultWeeks });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  upsertWeek: async (req, res) => {
    try {
      const projectId = req.params.id;
      const project = await db.Project.findByPk(projectId);
      if (!project) {
        return res.status(404).json({ error: "Proyecto no encontrado." });
      }

      const { entries } = req.body;
      if (!Array.isArray(entries)) {
        return res.status(400).json({ error: "entries debe ser un array." });
      }

      const recordsToUpsert = entries.map((entry) => ({
        project_id: Number(projectId),
        date: entry.date,
        start_time: entry.start_time || null,
        end_time: entry.end_time || null,
        suspension_reason: entry.suspension_reason || null,
        suspended_by: entry.suspended_by || null,
        observations: entry.observations || null,
      }));

      await db.WorkDayLog.bulkCreate(recordsToUpsert, {
        updateOnDuplicate: [
          "start_time",
          "end_time",
          "suspension_reason",
          "suspended_by",
          "observations",
          "updated_at",
        ],
      });

      const updatedDates = recordsToUpsert.map((r) => r.date);
      const updatedLogs = await db.WorkDayLog.findAll({
        where: {
          project_id: projectId,
          date: { [Op.in]: updatedDates },
        },
      });

      return res.status(200).json({
        message: "Planilla diaria guardada correctamente.",
        data: updatedLogs,
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
