const { Op } = require("sequelize");
const db = require("../models");

const expenseSummaryController = {
  // GET /api/expense-summary/monthly?year=2026&month=5
  monthly: async (req, res) => {
    try {
      const year = parseInt(req.query.year);
      const month = parseInt(req.query.month);

      if (!year || !month) {
        return res.status(400).json({ message: "Year and month are required" });
      }

      // 1. Sueldos Brutos (PayrollEntry)
      const payrollEntries = await db.PayrollEntry.findAll({
        where: {
          status: { [Op.in]: ["confirmed", "paid"] },
        },
        include: [
          {
            model: db.PayPeriod,
            as: "payPeriod",
            where: { year, month },
            attributes: ["type"],
          },
        ],
        attributes: ["gross_amount"],
      });

      let payrollGrossTotal = 0;
      let firstHalfTotal = 0;
      let secondHalfTotal = 0;

      payrollEntries.forEach((entry) => {
        const amount = parseFloat(entry.gross_amount || 0);
        payrollGrossTotal += amount;
        
        if (entry.payPeriod.type === "first_half") {
          firstHalfTotal += amount;
        } else if (entry.payPeriod.type === "second_half") {
          secondHalfTotal += amount;
        }
      });

      // 2. Cargas Patronales (EmployerCost)
      const employerCosts = await db.EmployerCost.findAll({
        where: { year, month },
        include: [
          {
            model: db.EmployerCostCategory,
            as: "category",
            attributes: ["name"],
          },
        ],
        attributes: ["amount"],
      });

      let employerCostsTotal = 0;
      const employerCostsBreakdown = [];

      // Agrupar por nombre de categoría
      const costsByCategory = {};
      employerCosts.forEach((cost) => {
        const amount = parseFloat(cost.amount || 0);
        employerCostsTotal += amount;
        
        const catName = cost.category?.name || "Sin Categoría";
        if (!costsByCategory[catName]) {
          costsByCategory[catName] = 0;
        }
        costsByCategory[catName] += amount;
      });

      for (const [category, amount] of Object.entries(costsByCategory)) {
        employerCostsBreakdown.push({ category, amount });
      }

      // 3. (Informativo) Adelantos (SalaryAdvance)
      const salaryAdvances = await db.SalaryAdvance.findAll({
        include: [
          {
            model: db.PayPeriod,
            as: "payPeriod",
            where: { year, month },
            attributes: [],
          },
        ],
        attributes: ["amount"],
      });

      let advancesTotal = 0;
      salaryAdvances.forEach((advance) => {
        advancesTotal += parseFloat(advance.amount || 0);
      });

      // Construir respuesta
      const grandTotal = payrollGrossTotal + employerCostsTotal;

      const response = {
        year,
        month,
        expenses: {
          payroll_gross: {
            label: "Sueldos Brutos",
            total: payrollGrossTotal,
            detail: {
              first_half: firstHalfTotal,
              second_half: secondHalfTotal,
              entry_count: payrollEntries.length,
            },
          },
          employer_costs: {
            label: "Cargas Patronales",
            total: employerCostsTotal,
            breakdown: employerCostsBreakdown,
          },
        },
        grand_total: grandTotal,
        info: {
          advances: {
            label: "Adelantos (no suma al total)",
            total: advancesTotal,
            count: salaryAdvances.length,
            note: "Flujo de caja anticipado, ya incluido en el bruto",
          },
        },
      };

      return res.status(200).json(response);
    } catch (error) {
      console.error("Error in expenseSummaryController.monthly:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  },

  // GET /api/expense-summary/annual?year=2026
  annual: async (req, res) => {
    try {
      const year = parseInt(req.query.year);

      if (!year) {
        return res.status(400).json({ message: "Year is required" });
      }

      // Inicializar estructura de meses
      const monthsData = {};
      for (let i = 1; i <= 12; i++) {
        monthsData[i] = {
          month: i,
          payroll_gross: 0,
          employer_costs: 0,
          total: 0,
        };
      }

      // 1. Sueldos Brutos Anuales
      const payrollEntries = await db.PayrollEntry.findAll({
        where: {
          status: { [Op.in]: ["confirmed", "paid"] },
        },
        include: [
          {
            model: db.PayPeriod,
            as: "payPeriod",
            where: { year },
            attributes: ["month"],
          },
        ],
        attributes: ["gross_amount"],
      });

      payrollEntries.forEach((entry) => {
        const month = entry.payPeriod.month;
        const amount = parseFloat(entry.gross_amount || 0);
        if (monthsData[month]) {
          monthsData[month].payroll_gross += amount;
          monthsData[month].total += amount;
        }
      });

      // 2. Cargas Patronales Anuales
      const employerCosts = await db.EmployerCost.findAll({
        where: { year },
        attributes: ["month", "amount"],
      });

      employerCosts.forEach((cost) => {
        const month = cost.month;
        const amount = parseFloat(cost.amount || 0);
        if (monthsData[month]) {
          monthsData[month].employer_costs += amount;
          monthsData[month].total += amount;
        }
      });

      // Preparar totales anuales
      let annualPayrollGross = 0;
      let annualEmployerCosts = 0;
      let annualTotal = 0;

      const monthsArray = [];
      for (let i = 1; i <= 12; i++) {
        monthsArray.push(monthsData[i]);
        annualPayrollGross += monthsData[i].payroll_gross;
        annualEmployerCosts += monthsData[i].employer_costs;
        annualTotal += monthsData[i].total;
      }

      const response = {
        year,
        months: monthsArray,
        annual_totals: {
          payroll_gross: annualPayrollGross,
          employer_costs: annualEmployerCosts,
          total: annualTotal,
        },
      };

      return res.status(200).json(response);
    } catch (error) {
      console.error("Error in expenseSummaryController.annual:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  },
};

module.exports = expenseSummaryController;
