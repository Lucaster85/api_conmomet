const { Op } = require("sequelize");
const db = require("../models");

/**
 * Rounds to 2 decimal places.
 */
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * NEW ENGINE: Generate PayrollLines for an employee with EmployeeRates configured.
 * Returns { lines, gross_amount, totalRegularHours, totalOt50, totalOt100, lateCount }.
 */
async function generateFlexibleLines(emp, period, timeEntries, holidays, vacationAttendances = []) {
  const isMonthly = emp.pay_type === "monthly";
  const lines = [];

  // Load employee rates with concept info
  const empRates = await db.EmployeeRate.findAll({
    where: { employee_id: emp.id },
    include: [{ model: db.PayrollConcept, as: "concept", attributes: ["id", "name", "code", "calc_type"] }],
  });

  // Build a set of holiday dates for quick lookup
  const holidayDates = new Set(holidays.map(h => h.date));

  let totalRegularHours = 0;
  let totalOt50 = 0;
  let totalOt100 = 0;
  let lateCount = 0;

  if (isMonthly) {
    // ===== MENSUALIZADO =====
    // Find the "base" rate (concept_id = null) for salary + snr
    const baseRate = empRates.find(r => !r.concept_id);

    if (baseRate) {
      // Sueldo base: only in second_half (monthly employees get paid once a month)
      const monthlySalary = parseFloat(emp.monthly_salary || 0);
      if (period.type === "second_half" && monthlySalary > 0) {
        lines.push({
          concept_id: null,
          label: "Sueldo base",
          quantity: 1,
          rate: monthlySalary,
          subtotal: monthlySalary,
          line_type: "fixed",
        });
      }

      // SNR
      const snr = parseFloat(emp.snr_amount || 0);
      if (snr > 0) {
        lines.push({
          concept_id: null,
          label: "SNR",
          quantity: 1,
          rate: snr,
          subtotal: snr,
          line_type: "fixed",
        });
      }

      // Extras: sum all TimeEntry overtime hours × extras_rate
      const extrasRate = parseFloat(baseRate.extras_rate || 0);
      if (extrasRate > 0) {
        const totalExtrasHours = timeEntries.reduce((sum, te) => {
          return sum + parseFloat(te.overtime_50_hours || 0) + parseFloat(te.overtime_100_hours || 0);
        }, 0);

        totalOt100 = totalExtrasHours;

        if (totalExtrasHours > 0) {
          lines.push({
            concept_id: null,
            label: "Extras",
            quantity: r2(totalExtrasHours),
            rate: extrasRate,
            subtotal: r2(totalExtrasHours * extrasRate),
            line_type: "extras_100",
          });
        }
      }
    }

    lateCount = timeEntries.filter(te => te.is_late).length;

  } else {
    // ===== JORNALIZADO =====

    // Group time entries by concept_id
    const entriesByConcept = {};
    for (const te of timeEntries) {
      const cid = te.concept_id || "_default";
      if (!entriesByConcept[cid]) entriesByConcept[cid] = [];
      entriesByConcept[cid].push(te);
    }

    // Process each concept group
    for (const [conceptKey, conceptEntries] of Object.entries(entriesByConcept)) {
      const conceptId = conceptKey === "_default" ? null : parseInt(conceptKey);

      // Find the matching rate
      let rate, guildRate, conceptName;

      if (conceptId) {
        // Specific concept: find matching EmployeeRate
        const empRate = empRates.find(r => r.concept_id === conceptId);
        if (!empRate) continue;
        rate = parseFloat(empRate.rate);
        guildRate = parseFloat(empRate.guild_rate || 0);
        conceptName = empRate.concept?.name || "Hs trabajadas";
      } else {
        // No concept: use employee's base hourly_rate (particular rate)
        rate = parseFloat(emp.hourly_rate || 0);
        // If employee has a categoria, use its guild_hourly_rate for holiday/non-worked-holiday calcs
        guildRate = emp.category ? parseFloat(emp.category.guild_hourly_rate || 0) : 0;
        conceptName = "Hs Regulares";
        if (rate <= 0) continue;
      }

      // Separate entries by holiday / non-holiday
      let regularHours = 0;
      let holidayHours = 0;
      let ot50Hours = 0;
      let ot100Hours = 0;

      for (const te of conceptEntries) {
        const isHoliday = holidayDates.has(te.date);
        const regH = parseFloat(te.regular_hours || 0);
        const ot50 = parseFloat(te.overtime_50_hours || 0);
        const ot100 = parseFloat(te.overtime_100_hours || 0);

        if (isHoliday) {
          holidayHours += regH;
          // Extras on holidays still count as extras
          ot100Hours += ot50 + ot100;
        } else {
          regularHours += regH;
          ot50Hours += ot50;
          ot100Hours += ot100;
        }

        if (te.is_late) lateCount++;
      }

      totalRegularHours += regularHours + holidayHours;
      totalOt50 += ot50Hours;
      totalOt100 += ot100Hours;

      // Line: regular hours
      if (regularHours > 0) {
        lines.push({
          concept_id: conceptId,
          label: conceptName,
          quantity: r2(regularHours),
          rate: rate,
          subtotal: r2(regularHours * rate),
          line_type: "regular",
        });
      }

      // Line: extras 50%
      if (ot50Hours > 0) {
        const extrasRate50 = r2(rate * 1.5);
        lines.push({
          concept_id: conceptId,
          label: `Extras 50% ${conceptName}`,
          quantity: r2(ot50Hours),
          rate: extrasRate50,
          subtotal: r2(ot50Hours * extrasRate50),
          line_type: "extras_50",
        });
      }

      // Line: extras 100%
      if (ot100Hours > 0) {
        const extrasRate100 = r2(rate * 2.0);
        lines.push({
          concept_id: conceptId,
          label: `Extras ${conceptName}`,
          quantity: r2(ot100Hours),
          rate: extrasRate100,
          subtotal: r2(ot100Hours * extrasRate100),
          line_type: "extras_100",
        });
      }

      // Line: holiday hours
      if (holidayHours > 0) {
        const holidayRate = guildRate > 0 ? guildRate : rate;
        lines.push({
          concept_id: conceptId,
          label: "Feriado",
          quantity: r2(holidayHours),
          rate: holidayRate,
          subtotal: r2(holidayHours * holidayRate),
          line_type: "holiday",
        });
      }
    }

    // Vacation days (LCT Art. 155b): tarifa_diaria (hourly_rate × 8hs) × días corridos en el período
    if (vacationAttendances.length > 0) {
      const baseHourlyRate = parseFloat(emp.hourly_rate || 0);
      if (baseHourlyRate > 0) {
        const dailyRate = r2(baseHourlyRate * 8);
        const vacationDays = vacationAttendances.length;
        lines.push({
          concept_id: null,
          label: "Vacaciones",
          quantity: vacationDays,
          rate: dailyRate,
          subtotal: r2(vacationDays * dailyRate),
          line_type: "vacation",
        });
      }
    }

    // SNR: take from employee base config
    const snr = parseFloat(emp.snr_amount || 0);
    if (snr > 0) {
      lines.push({
        concept_id: null,
        label: "SNR",
        quantity: 1,
        rate: snr,
        subtotal: snr,
        line_type: "fixed",
      });
    }

    // Holiday hours for non-worked holidays (feriado no trabajado)
    // Check which holidays in the period were NOT worked by this employee
    const workedDates = new Set(timeEntries.map(te => te.date));
    const periodHolidays = holidays.filter(h => h.date >= period.start_date && h.date <= period.end_date);
    const nonWorkedHolidays = periodHolidays.filter(h => !workedDates.has(h.date));

    if (nonWorkedHolidays.length > 0) {
      // Use guild_hourly_rate from categoria if available; fallback to employee base hourly_rate
      const categoriaGuildRate = emp.category ? parseFloat(emp.category.guild_hourly_rate || 0) : 0;
      const baseHourlyRate = parseFloat(emp.hourly_rate || 0);
      const gRate = categoriaGuildRate > 0 ? categoriaGuildRate : baseHourlyRate;

      if (gRate > 0) {
        // Standard 8h per holiday
        const hoursPerHoliday = 8;
        const totalNonWorkedHolidayHours = nonWorkedHolidays.length * hoursPerHoliday;

        lines.push({
          concept_id: null,
          label: "Feriado",
          quantity: totalNonWorkedHolidayHours,
          rate: gRate,
          subtotal: r2(totalNonWorkedHolidayHours * gRate),
          line_type: "holiday",
        });
      }
    }
  }

  // Calculate gross
  const gross_amount = r2(lines.reduce((sum, l) => sum + l.subtotal, 0));

  return { lines, gross_amount, totalRegularHours: r2(totalRegularHours), totalOt50: r2(totalOt50), totalOt100: r2(totalOt100), lateCount };
}


module.exports = {
  /**
   * Get all payroll entries for a pay period.
   */
  getByPeriod: async (req, res) => {
    try {
      const period = await db.PayPeriod.findByPk(req.params.payPeriodId);
      if (!period) return res.status(404).json({ error: "Quincena no encontrada." });

      const entries = await db.PayrollEntry.findAll({
        where: { pay_period_id: period.id },
        include: [
          { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname", "dni", "hourly_rate", "pay_type", "monthly_salary", "position"] },
          { model: db.PayrollLine, as: "lines", order: [["id", "ASC"]] },
        ],
        order: [["employee_id", "ASC"]],
      });

      // Fetch attendance records for all employees in this period
      const employeeIds = entries.map(e => e.employee_id);
      const attendanceRecords = await db.Attendance.findAll({
        where: {
          employee_id: { [Op.in]: employeeIds },
          date: { [Op.between]: [period.start_date, period.end_date] },
        },
        order: [["date", "ASC"]],
      });

      // Group attendance by employee
      const attendanceByEmployee = {};
      for (const record of attendanceRecords) {
        if (!attendanceByEmployee[record.employee_id]) {
          attendanceByEmployee[record.employee_id] = [];
        }
        attendanceByEmployee[record.employee_id].push(record);
      }

      // Attach attendance to each entry
      const enrichedEntries = entries.map(entry => {
        const plain = entry.toJSON();
        const empAttendance = attendanceByEmployee[entry.employee_id] || [];
        plain.attendance = empAttendance;
        plain.absent_unjustified = empAttendance.filter(a => a.status === "absent").length;
        plain.absent_justified = empAttendance.filter(a => a.status === "justified").length;
        plain.medical_leave_count = empAttendance.filter(a => a.status === "medical_leave").length;
        plain.vacation_count = empAttendance.filter(a => a.status === "vacation").length;
        plain.perfect_attendance = empAttendance.length === 0;
        return plain;
      });

      return res.status(200).json({ count: enrichedEntries.length, data: enrichedEntries, period });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * Get PayrollLines for a specific PayrollEntry.
   */
  getLines: async (req, res) => {
    try {
      const entry = await db.PayrollEntry.findByPk(req.params.id, {
        include: [
          { model: db.Employee, as: "employee", attributes: ["id", "name", "lastname", "dni", "pay_type"] },
        ],
      });
      if (!entry) return res.status(404).json({ error: "Liquidación no encontrada." });

      const lines = await db.PayrollLine.findAll({
        where: { payroll_entry_id: entry.id },
        include: [{ model: db.PayrollConcept, as: "concept", attributes: ["id", "name", "code"] }],
        order: [["id", "ASC"]],
      });

      return res.status(200).json({ data: lines, entry });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * Generate payroll entries for all active employees in a pay period.
   * Uses new flexible engine if employee has EmployeeRates, fallback otherwise.
   */
  generate: async (req, res) => {
    try {
      const period = await db.PayPeriod.findByPk(req.params.payPeriodId);
      if (!period) return res.status(404).json({ error: "Quincena no encontrada." });
      if (period.status !== "open") return res.status(400).json({ error: "Solo se puede generar liquidación para quincenas abiertas." });

      // Load holidays for the period
      const holidays = await db.Holiday.findAll({
        where: { date: { [Op.between]: [period.start_date, period.end_date] } },
      });

      const whereClause = { status: "active" };
      if (period.type === "first_half") {
        whereClause.pay_type = "hourly";
      }
      const employees = await db.Employee.findAll({
        where: whereClause,
        include: [{ model: db.Category, as: "category", attributes: ["id", "name", "guild_hourly_rate"] }],
      });
      const generated = [];

      for (const emp of employees) {
        // Check if already generated
        const existing = await db.PayrollEntry.findOne({
          where: { pay_period_id: period.id, employee_id: emp.id },
        });
        
        // Skip if already confirmed or paid
        if (existing && existing.status !== "draft") continue;

        const isMonthly = emp.pay_type === "monthly";
        
        let timeEntryDateRange;
        if (isMonthly && period.type === "second_half") {
          const monthStart = `${period.year}-${String(period.month).padStart(2, '0')}-01`;
          timeEntryDateRange = [monthStart, period.end_date];
        } else {
          timeEntryDateRange = [period.start_date, period.end_date];
        }

        // Sum approved time entries for this period
        const timeEntries = await db.TimeEntry.findAll({
          where: {
            employee_id: emp.id,
            date: { [Op.between]: timeEntryDateRange },
            status: "approved",
          },
        });

        // Query vacation attendance records for jornalizados (LCT Art. 155b)
        let vacationAttendances = [];
        if (!isMonthly) {
          vacationAttendances = await db.Attendance.findAll({
            where: {
              employee_id: emp.id,
              date: { [Op.between]: [period.start_date, period.end_date] },
              status: "vacation",
            },
          });
        }

        // Check if employee has EmployeeRates configured
        const rateCount = await db.EmployeeRate.count({ where: { employee_id: emp.id } });
        const useFlexible = rateCount > 0;

        // Count absences (shared by both engines)
        const absences = await db.Attendance.count({
          where: {
            employee_id: emp.id,
            date: { [Op.between]: [period.start_date, period.end_date] },
            status: "absent",
          },
        });

        // Sum advances for this period (shared by both engines)
        const advances = await db.SalaryAdvance.findAll({
          where: {
            employee_id: emp.id,
            [Op.or]: [
              { pay_period_id: period.id },
              { pay_period_id: null, date: { [Op.between]: timeEntryDateRange } },
            ],
          },
        });
        const advances_deducted = advances.reduce((sum, a) => sum + parseFloat(a.amount), 0);

        // Link unassigned advances to this period
        const unassignedIds = advances.filter(a => !a.pay_period_id).map(a => a.id);
        if (unassignedIds.length > 0) {
          await db.SalaryAdvance.update(
            { pay_period_id: period.id },
            { where: { id: unassignedIds } }
          );
        }

        let payrollData;

        if (useFlexible) {
          // ===== NEW FLEXIBLE ENGINE =====
          const result = await generateFlexibleLines(emp, period, timeEntries, holidays, vacationAttendances);

          // Preserve manual extra_payments and deductions from existing entry
          const extras = existing ? parseFloat(existing.extra_payments || 0) : 0;
          const deds = existing ? parseFloat(existing.deductions || 0) : 0;

          const gross_amount = r2(result.gross_amount + extras);
          const net_amount = r2(gross_amount - advances_deducted - deds);

          payrollData = {
            total_regular_hours: result.totalRegularHours,
            total_overtime_50_hours: result.totalOt50,
            total_overtime_100_hours: result.totalOt100,
            regular_amount: r2(result.lines.filter(l => l.line_type === "regular" || l.line_type === "fixed").reduce((s, l) => s + l.subtotal, 0)),
            overtime_50_amount: r2(result.lines.filter(l => l.line_type === "extras_50").reduce((s, l) => s + l.subtotal, 0)),
            overtime_100_amount: r2(result.lines.filter(l => l.line_type === "extras_100").reduce((s, l) => s + l.subtotal, 0)),
            gross_amount,
            advances_deducted,
            net_amount,
            late_count: result.lateCount,
            absent_count: absences,
          };

          // Save/update entry first to get the id
          let entryId;
          if (existing) {
            await existing.update(payrollData);
            entryId = existing.id;
          } else {
            const newEntry = await db.PayrollEntry.create({
              pay_period_id: period.id,
              employee_id: emp.id,
              ...payrollData,
            });
            entryId = newEntry.id;
          }

          // Delete old lines and create new ones
          await db.PayrollLine.destroy({ where: { payroll_entry_id: entryId } });
          for (const line of result.lines) {
            await db.PayrollLine.create({
              payroll_entry_id: entryId,
              ...line,
            });
          }

          const savedEntry = await db.PayrollEntry.findByPk(entryId);
          generated.push(savedEntry);

        } else {
          // ===== LEGACY FALLBACK ENGINE =====
          const total_regular_hours = timeEntries.reduce((sum, te) => sum + parseFloat(te.regular_hours || 0), 0);
          const total_overtime_50_hours = timeEntries.reduce((sum, te) => sum + parseFloat(te.overtime_50_hours || 0), 0);
          const total_overtime_100_hours = timeEntries.reduce((sum, te) => sum + parseFloat(te.overtime_100_hours || 0), 0);
          const late_count = timeEntries.filter(te => te.is_late).length;

          const hourly_rate = parseFloat(emp.hourly_rate);
          const monthlySalary = parseFloat(emp.monthly_salary || 0);
          const OVERTIME_DIVISOR = parseInt(process.env.OVERTIME_DIVISOR || "200");
          const overtimeRate = isMonthly ? (monthlySalary / OVERTIME_DIVISOR) : hourly_rate;

          let regular_amount;
          if (isMonthly) {
            regular_amount = period.type === "second_half" ? monthlySalary : 0;
          } else {
            regular_amount = r2(total_regular_hours * hourly_rate);
          }

          const overtime_50_amount = r2(total_overtime_50_hours * overtimeRate * 1.5);
          const overtime_100_amount = r2(total_overtime_100_hours * overtimeRate * 2.0);

          const extras = existing ? parseFloat(existing.extra_payments || 0) : 0;
          const deds = existing ? parseFloat(existing.deductions || 0) : 0;

          const gross_amount = regular_amount + overtime_50_amount + overtime_100_amount + extras;
          const net_amount = r2(gross_amount - advances_deducted - deds);

          payrollData = {
            total_regular_hours: r2(total_regular_hours),
            total_overtime_50_hours: r2(total_overtime_50_hours),
            total_overtime_100_hours: r2(total_overtime_100_hours),
            regular_amount,
            overtime_50_amount,
            overtime_100_amount,
            gross_amount,
            advances_deducted,
            net_amount,
            late_count,
            absent_count: absences,
          };

          if (existing) {
            await existing.update(payrollData);
            generated.push(existing);
          } else {
            const entry = await db.PayrollEntry.create({
              pay_period_id: period.id,
              employee_id: emp.id,
              ...payrollData
            });
            generated.push(entry);
          }
        }
      }

      return res.status(201).json({ count: generated.length, data: generated });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  /**
   * Update a payroll entry manually (extra payments, deductions, notes).
   */
  update: async (req, res) => {
    try {
      const entry = await db.PayrollEntry.findByPk(req.params.id);
      if (!entry) return res.status(404).json({ error: "Liquidación no encontrada." });
      if (entry.status === "paid") return res.status(400).json({ error: "No se puede editar una liquidación ya pagada." });

      const { extra_payments, extra_payments_notes, deductions, deductions_notes, notes } = req.body;

      const extras = extra_payments !== undefined ? parseFloat(extra_payments) : parseFloat(entry.extra_payments);
      const deds = deductions !== undefined ? parseFloat(deductions) : parseFloat(entry.deductions);

      const gross_amount = parseFloat(entry.regular_amount) + parseFloat(entry.overtime_50_amount) + parseFloat(entry.overtime_100_amount) + extras;
      const net_amount = r2(gross_amount - deds - parseFloat(entry.advances_deducted));

      await entry.update({
        extra_payments: extras,
        extra_payments_notes: extra_payments_notes !== undefined ? extra_payments_notes : entry.extra_payments_notes,
        deductions: deds,
        deductions_notes: deductions_notes !== undefined ? deductions_notes : entry.deductions_notes,
        gross_amount: r2(gross_amount),
        net_amount,
        notes: notes !== undefined ? notes : entry.notes,
      });

      return res.status(200).json({ data: entry });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  confirm: async (req, res) => {
    try {
      const entry = await db.PayrollEntry.findByPk(req.params.id);
      if (!entry) return res.status(404).json({ error: "Liquidación no encontrada." });
      if (entry.status !== "draft") return res.status(400).json({ error: "Solo se pueden confirmar liquidaciones en borrador." });

      await entry.update({ status: "confirmed" });
      return res.status(200).json({ data: entry });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },

  pay: async (req, res) => {
    try {
      const entry = await db.PayrollEntry.findByPk(req.params.id);
      if (!entry) return res.status(404).json({ error: "Liquidación no encontrada." });
      if (entry.status !== "confirmed") return res.status(400).json({ error: "La liquidación debe estar confirmada para poder pagarse." });

      await entry.update({ status: "paid", paid_at: new Date() });
      return res.status(200).json({ data: entry });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  },
};
