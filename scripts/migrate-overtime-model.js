#!/usr/bin/env node
/**
 * migrate-overtime-model.js
 * 
 * Migrates TimeEntry records from "full hour" overtime model to "surcharge" model.
 * 
 * BEFORE: check_in=08:00, check_out=17:00, regular_hours=9, overtime_50=1
 *         (extras are ADDITIONAL hours outside the range)
 * 
 * AFTER:  check_in=08:00, check_out=18:00, regular_hours=10, overtime_50=1
 *         (extras are a SUBSET of hours within the range that carry a surcharge)
 * 
 * Usage:
 *   node scripts/migrate-overtime-model.js --dry-run   # Preview changes only
 *   node scripts/migrate-overtime-model.js --apply      # Apply changes
 * 
 * Only processes:
 *   - Employees with pay_type = 'hourly' (jornalizados)
 *   - TimeEntries with overtime_50_hours > 0 OR overtime_100_hours > 0
 *   - Non-voided entries
 */

const path = require('path');

// Load environment
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { Op } = require('sequelize');
const sequelize = require('../config/sequelize');
const db = require('../models');

const DRY_RUN = process.argv.includes('--dry-run');
const APPLY = process.argv.includes('--apply');

if (!DRY_RUN && !APPLY) {
  console.log('Usage:');
  console.log('  node scripts/migrate-overtime-model.js --dry-run   # Preview changes');
  console.log('  node scripts/migrate-overtime-model.js --apply      # Apply changes');
  process.exit(1);
}

/**
 * Adds hours to a TIME string (HH:MM or HH:MM:SS)
 * Returns HH:MM format
 */
function addHoursToTime(timeStr, hoursToAdd) {
  const parts = timeStr.split(':').map(Number);
  const totalMinutes = parts[0] * 60 + parts[1] + Math.round(hoursToAdd * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Calculates hours between two TIME strings
 */
function calculateHours(checkIn, checkOut) {
  const [inH, inM] = checkIn.split(':').map(Number);
  const [outH, outM] = checkOut.split(':').map(Number);
  return Math.round(((outH * 60 + outM - inH * 60 - inM) / 60) * 100) / 100;
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  MIGRACIÓN: Modelo de Horas Extras → Modelo Recargo`);
  console.log(`  Modo: ${DRY_RUN ? '🔍 DRY RUN (solo vista previa)' : '⚡ APPLY (cambios reales)'}`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    await sequelize.authenticate();
    console.log('✅ Conexión a base de datos OK\n');

    // 1. Get all hourly employees
    const hourlyEmployees = await db.Employee.findAll({
      where: { pay_type: 'hourly' },
      attributes: ['id', 'name', 'lastname'],
    });
    const hourlyIds = hourlyEmployees.map(e => e.id);
    const empMap = Object.fromEntries(hourlyEmployees.map(e => [e.id, e]));

    console.log(`📋 Empleados jornalizados encontrados: ${hourlyIds.length}`);

    if (hourlyIds.length === 0) {
      console.log('\n✅ No hay empleados jornalizados. Nada que migrar.');
      process.exit(0);
    }

    // 2. Find all TimeEntries for hourly employees with overtime > 0
    const entries = await db.TimeEntry.findAll({
      where: {
        employee_id: { [Op.in]: hourlyIds },
        status: { [Op.ne]: 'voided' },
        [Op.or]: [
          { overtime_50_hours: { [Op.gt]: 0 } },
          { overtime_100_hours: { [Op.gt]: 0 } },
        ],
      },
      order: [['date', 'ASC'], ['employee_id', 'ASC']],
    });

    console.log(`📝 TimeEntries con extras encontradas: ${entries.length}\n`);

    if (entries.length === 0) {
      console.log('✅ No hay registros con horas extras que migrar.');
      process.exit(0);
    }

    // 3. Check for potential overlaps BEFORE applying
    // Group entries by employee_id + date to detect multi-block days
    const byEmpDate = {};
    for (const entry of entries) {
      const key = `${entry.employee_id}_${entry.date}`;
      if (!byEmpDate[key]) byEmpDate[key] = [];
      byEmpDate[key].push(entry);
    }

    // Also load OTHER entries on the same dates (without overtime) to check overlap
    const allDates = [...new Set(entries.map(e => e.date))];
    const allEntriesOnDates = await db.TimeEntry.findAll({
      where: {
        employee_id: { [Op.in]: hourlyIds },
        date: { [Op.in]: allDates },
        status: { [Op.ne]: 'voided' },
      },
      order: [['date', 'ASC'], ['check_in', 'ASC']],
    });

    const allByEmpDate = {};
    for (const entry of allEntriesOnDates) {
      const key = `${entry.employee_id}_${entry.date}`;
      if (!allByEmpDate[key]) allByEmpDate[key] = [];
      allByEmpDate[key].push(entry);
    }

    // 4. Process each entry
    const changes = [];
    const warnings = [];

    for (const entry of entries) {
      const ot50 = parseFloat(entry.overtime_50_hours || 0);
      const ot100 = parseFloat(entry.overtime_100_hours || 0);
      const totalExtras = ot50 + ot100;

      if (totalExtras <= 0) continue;

      const oldCheckOut = entry.check_out.substring(0, 5); // Normalize HH:MM
      const checkIn = entry.check_in.substring(0, 5);
      const newCheckOut = addHoursToTime(oldCheckOut, totalExtras);
      const newRegularHours = calculateHours(checkIn, newCheckOut);

      const emp = empMap[entry.employee_id];
      const empName = emp ? `${emp.lastname}, ${emp.name}` : `ID ${entry.employee_id}`;

      // Check: would the new check_out overlap with another entry on the same day?
      const key = `${entry.employee_id}_${entry.date}`;
      const dayEntries = allByEmpDate[key] || [];
      const otherEntries = dayEntries.filter(e => e.id !== entry.id);

      let hasOverlap = false;
      for (const other of otherEntries) {
        const otherIn = other.check_in.substring(0, 5);
        const otherOut = other.check_out.substring(0, 5);
        // Check if new range overlaps with other
        if (newCheckOut > otherIn && checkIn < otherOut) {
          // Only warn if the overlap is NEW (didn't exist before)
          if (!(oldCheckOut > otherIn && checkIn < otherOut)) {
            hasOverlap = true;
            warnings.push(
              `⚠️  OVERLAP: ${empName} el ${entry.date} — ` +
              `extender ${oldCheckOut}→${newCheckOut} se superpone con bloque ${otherIn}-${otherOut}`
            );
          }
        }
      }

      changes.push({
        id: entry.id,
        employee: empName,
        date: entry.date,
        check_in: checkIn,
        old_check_out: oldCheckOut,
        new_check_out: newCheckOut,
        old_regular_hours: parseFloat(entry.regular_hours),
        new_regular_hours: newRegularHours,
        ot50,
        ot100,
        has_overlap: hasOverlap,
      });
    }

    // 5. Display results
    console.log(`${'─'.repeat(60)}`);
    console.log(`  CAMBIOS A REALIZAR: ${changes.length} registros`);
    console.log(`${'─'.repeat(60)}\n`);

    for (const c of changes) {
      const overlapFlag = c.has_overlap ? ' ⚠️ OVERLAP' : '';
      console.log(
        `  [${c.date}] ${c.employee}${overlapFlag}\n` +
        `    ${c.check_in}-${c.old_check_out} (${c.old_regular_hours}h) → ` +
        `${c.check_in}-${c.new_check_out} (${c.new_regular_hours}h)` +
        `  |  Rec50: ${c.ot50}  Rec100: ${c.ot100}\n`
      );
    }

    if (warnings.length > 0) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log(`  ⚠️  ADVERTENCIAS: ${warnings.length}`);
      console.log(`${'─'.repeat(60)}\n`);
      for (const w of warnings) {
        console.log(`  ${w}`);
      }
      console.log('\n  Los registros con overlap NO se migrarán automáticamente.');
      console.log('  Deberás ajustarlos manualmente.\n');
    }

    // Summary
    const safeChanges = changes.filter(c => !c.has_overlap);
    const skipped = changes.filter(c => c.has_overlap);

    console.log(`${'─'.repeat(60)}`);
    console.log(`  RESUMEN`);
    console.log(`${'─'.repeat(60)}`);
    console.log(`  ✅ A migrar:   ${safeChanges.length} registros`);
    console.log(`  ⚠️  Con overlap: ${skipped.length} registros (se omiten)`);
    console.log(`${'─'.repeat(60)}\n`);

    // 6. Apply if not dry run
    if (APPLY) {
      if (safeChanges.length === 0) {
        console.log('❌ No hay cambios seguros para aplicar.');
        process.exit(0);
      }

      console.log('⚡ Aplicando cambios...\n');

      const t = await sequelize.transaction();
      try {
        let applied = 0;
        for (const c of safeChanges) {
          await db.TimeEntry.update(
            {
              check_out: c.new_check_out,
              regular_hours: c.new_regular_hours,
            },
            {
              where: { id: c.id },
              transaction: t,
            }
          );
          applied++;
        }

        await t.commit();
        console.log(`✅ ${applied} registros migrados exitosamente.\n`);
      } catch (err) {
        await t.rollback();
        console.error('❌ Error durante la migración. Se hizo ROLLBACK:', err.message);
        process.exit(1);
      }
    } else {
      console.log('🔍 Esto fue un DRY RUN. Para aplicar los cambios ejecutá:');
      console.log('   node scripts/migrate-overtime-model.js --apply\n');
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await sequelize.close();
  }
}

main();
