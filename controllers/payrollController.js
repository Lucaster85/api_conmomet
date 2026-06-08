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

    const ot50Hours = timeEntries.reduce((sum, te) => sum + parseFloat(te.overtime_50_hours || 0), 0);
    const ot100Hours = timeEntries.reduce((sum, te) => sum + parseFloat(te.overtime_100_hours || 0), 0);

    if (ot50Hours > 0 || ot100Hours > 0) {
      let extrasRate100 = baseRate ? parseFloat(baseRate.extras_rate || 0) : 0;

      // Calculate dynamically using monthly salary and OVERTIME_DIVISOR if no manual rate is set
      if (extrasRate100 <= 0 && monthlySalary > 0) {
        const divisor = parseFloat(process.env.OVERTIME_DIVISOR || 200);
        extrasRate100 = r2((monthlySalary / divisor) * 2.0);
      }

      if (extrasRate100 > 0) {
        const extrasRate50 = r2(extrasRate100 * 0.75);

        if (ot50Hours > 0) {
          totalOt50 = ot50Hours;
          lines.push({
            concept_id: null,
            label: "Extras 50%",
            quantity: r2(ot50Hours),
            rate: extrasRate50,
            subtotal: r2(ot50Hours * extrasRate50),
            line_type: "extras_50",
          });
        }

        if (ot100Hours > 0) {
          totalOt100 = ot100Hours;
          lines.push({
            concept_id: null,
            label: "Extras 100%",
            quantity: r2(ot100Hours),
            rate: extrasRate100,
            subtotal: r2(ot100Hours * extrasRate100),
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

        // Siempre sumamos las horas regulares trabajadas
        regularHours += regH;

        if (isHoliday) {
          // Además, las horas trabajadas en feriado se pagan como "Feriado" (suele ser al 100%)
          holidayHours += regH;
          // Las extras en feriado van al 100%
          ot100Hours += ot50 + ot100;
        } else {
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
          label: `Extras 100% ${conceptName}`,
          quantity: r2(ot100Hours),
          rate: extrasRate100,
          subtotal: r2(ot100Hours * extrasRate100),
          line_type: "extras_100",
        });
      }

      // Line: holiday hours (worked)
      if (holidayHours > 0) {
        const holidayRate = rate;  // Feriado trabajado → tarifa general (no CCT)
        const holidayLabel = conceptId ? `Feriado T ${conceptName}` : "Feriado T";
        lines.push({
          concept_id: conceptId,
          label: holidayLabel,
          quantity: r2(holidayHours),
          rate: holidayRate,
          subtotal: r2(holidayHours * holidayRate),
          line_type: "holiday",
        });
      }
    }

    // Vacation days (LCT Art. 155b): tarifa_diaria (hourly × 8hs) × días corridos en el período
    // Priority: category guild_hourly_rate > employee hourly_rate (arreglo particular)
    if (vacationAttendances.length > 0) {
      const categoriaRate = emp.category ? parseFloat(emp.category.guild_hourly_rate || 0) : 0;
      const particularRate = parseFloat(emp.hourly_rate || 0);
      const vacationHourlyRate = categoriaRate > 0 ? categoriaRate : particularRate;

      if (vacationHourlyRate > 0) {
        const dailyRate = r2(vacationHourlyRate * 8);
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
          label: "Feriado NT",
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
          { model: db.PayrollAdjustment, as: "adjustments", order: [["id", "ASC"]] },
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

      // Fetch active loans for all employees in this payroll
      const activeLoans = await db.Loan.findAll({
        where: {
          employee_id: { [Op.in]: employeeIds },
          status: "active",
        },
        attributes: ["id", "employee_id", "remaining_balance", "currency"],
      });

      // Group loans by employee
      const loansByEmployee = {};
      for (const loan of activeLoans) {
        if (!loansByEmployee[loan.employee_id]) {
          loansByEmployee[loan.employee_id] = [];
        }
        loansByEmployee[loan.employee_id].push(loan);
      }

      // Attach attendance and active loan info to each entry
      const enrichedEntries = entries.map(entry => {
        const plain = entry.toJSON();
        const empAttendance = attendanceByEmployee[entry.employee_id] || [];
        plain.attendance = empAttendance;
        plain.absent_unjustified = empAttendance.filter(a => a.status === "absent").length;
        plain.absent_justified = empAttendance.filter(a => a.status === "justified").length;
        plain.medical_leave_count = empAttendance.filter(a => a.status === "medical_leave").length;
        plain.vacation_count = empAttendance.filter(a => a.status === "vacation").length;
        plain.perfect_attendance = empAttendance.length === 0;

        // Active loan indicator
        const empLoans = loansByEmployee[entry.employee_id] || [];
        plain.has_active_loan = empLoans.length > 0;
        plain.active_loans_count = empLoans.length;
        plain.total_remaining_usd = empLoans
          .filter(l => l.currency === 'USD')
          .reduce((sum, l) => sum + parseFloat(l.remaining_balance), 0);
        plain.total_remaining_ars = empLoans
          .filter(l => l.currency === 'ARS')
          .reduce((sum, l) => sum + parseFloat(l.remaining_balance), 0);

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
        include: [{ model: db.Category, as: "category", attributes: ["id", "name", "guild_hourly_rate", "guild_id"] }],
      });
      const generated = [];

      // Fetch rate changes for this period (pending = new, applied = already calculated but period still open)
      // Both should be included so re-generating the payroll recalculates retroactives correctly.
      const pendingRateChanges = await db.RateChange.findAll({
        where: { applied_in_period: period.id, status: { [Op.in]: ["pending", "applied"] } },
        include: [{ model: db.PayPeriod, as: "appliesFromPeriod" }]
      });

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

        // Check if employee has EmployeeRates or at least base salary configured
        const hasBaseSalary = parseFloat(emp.hourly_rate || 0) > 0 || parseFloat(emp.monthly_salary || 0) > 0;
        const rateCount = await db.EmployeeRate.count({ where: { employee_id: emp.id } });
        
        if (!hasBaseSalary && rateCount === 0) {
          return res.status(400).json({ error: `El empleado ${emp.name} ${emp.lastname} no tiene tarifas configuradas. Debe configurarle al menos el Sueldo Base o Tarifa por Hora en su perfil para poder liquidar.` });
        }
        const useFlexible = true;

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

        // Calculate Retroactives if employee has a guild
        let retroactiveLines = [];
        if (emp.category && emp.category.guild_id) {
          const empRateChanges = pendingRateChanges.filter(rc => rc.guild_id === emp.category.guild_id);
          for (const rc of empRateChanges) {
            const affectedPeriods = await db.PayPeriod.findAll({
              where: {
                start_date: { [Op.gte]: rc.appliesFromPeriod.start_date },
                end_date: { [Op.lt]: period.start_date }
              }
            });
            const periodIds = affectedPeriods.map(p => p.id);

            const prevEntries = await db.PayrollEntry.findAll({
              where: { employee_id: emp.id, pay_period_id: { [Op.in]: periodIds } },
              include: [{
                model: db.PayrollLine, as: "lines",
                where: rc.concept_id ? { concept_id: rc.concept_id } : undefined,
                required: false
              }]
            });

            for (const pEntry of prevEntries) {
              const srcPeriod = affectedPeriods.find(p => p.id === pEntry.pay_period_id);
              const pName = srcPeriod ? `${srcPeriod.type === 'first_half' ? '1Q' : '2Q'} ${srcPeriod.month}/${srcPeriod.year}` : '';

              if (pEntry.lines && pEntry.lines.length > 0) {
                for (const line of pEntry.lines) {
                  // Only exclude previous retroactives from being compounded
                  if (line.line_type === "retroactive") continue;

                  const diff = r2(parseFloat(line.subtotal) * (parseFloat(rc.percentage) / 100));
                  if (diff > 0) {
                    retroactiveLines.push({
                      concept_id: rc.concept_id,
                      label: `Retroactivo ${rc.percentage}% - ${pName} (${line.label})`,
                      quantity: line.quantity,
                      rate: r2(parseFloat(line.rate) * (parseFloat(rc.percentage) / 100)),
                      subtotal: diff,
                      line_type: "retroactive",
                      source_period_id: pEntry.pay_period_id
                    });
                  }
                }
              } else if (!rc.concept_id) {
                // Legacy Fallback Engine: No lines generated for regular haberes
                const baseAmount = parseFloat(pEntry.regular_amount || 0) + parseFloat(pEntry.overtime_50_amount || 0) + parseFloat(pEntry.overtime_100_amount || 0);
                if (baseAmount > 0) {
                  const diff = r2(baseAmount * (parseFloat(rc.percentage) / 100));
                  if (diff > 0) {
                    retroactiveLines.push({
                      concept_id: null,
                      label: `Retroactivo ${rc.percentage}% - ${pName} (Haberes)`,
                      quantity: 1,
                      rate: diff,
                      subtotal: diff,
                      line_type: "retroactive",
                      source_period_id: pEntry.pay_period_id
                    });
                  }
                }
              }
            }
          }
        }

        if (useFlexible) {
          // ===== NEW FLEXIBLE ENGINE =====
          const result = await generateFlexibleLines(emp, period, timeEntries, holidays, vacationAttendances);
          
          // Append retroactives
          result.lines = [...result.lines, ...retroactiveLines];
          const retro_amount = r2(retroactiveLines.reduce((s, l) => s + l.subtotal, 0));
          result.gross_amount = r2(result.gross_amount + retro_amount);

          // Get existing adjustments if entry exists
          let extras = 0;
          let deds = 0;
          if (existing) {
            const adjustments = await db.PayrollAdjustment.findAll({ where: { payroll_entry_id: existing.id } });
            extras = adjustments.filter(a => a.type === "bonus").reduce((s, a) => s + parseFloat(a.amount), 0);
            deds = adjustments.filter(a => a.type === "deduction").reduce((s, a) => s + parseFloat(a.amount), 0);
          }

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
          return res.status(400).json({ error: `El empleado ${emp.name} ${emp.lastname} no tiene tarifas configuradas. Debe configurarle al menos el Sueldo Base o Tarifa por Hora en su perfil para poder liquidar.` });
        }
      }

      // Mark rate changes as applied
      for (const rc of pendingRateChanges) {
         await rc.update({ status: 'applied' });
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

      const { notes } = req.body;

      // When editing notes, we don't recalculate everything unless needed, but let's recalculate gross and net just in case
      // from the existing adjustments, lines and advances
      
      const adjustments = await db.PayrollAdjustment.findAll({ where: { payroll_entry_id: entry.id } });
      const extras = adjustments.filter(a => a.type === "bonus").reduce((s, a) => s + parseFloat(a.amount), 0);
      const deds = adjustments.filter(a => a.type === "deduction").reduce((s, a) => s + parseFloat(a.amount), 0);

      const lines = await db.PayrollLine.findAll({ where: { payroll_entry_id: entry.id } });
      let linesGross = 0;
      if (lines.length > 0) {
        linesGross = lines.reduce((s, l) => s + parseFloat(l.subtotal), 0);
      } else {
        linesGross = parseFloat(entry.regular_amount) + parseFloat(entry.overtime_50_amount) + parseFloat(entry.overtime_100_amount);
      }

      const gross_amount = r2(linesGross + extras);
      const net_amount = r2(gross_amount - deds - parseFloat(entry.advances_deducted));

      await entry.update({
        gross_amount,
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
