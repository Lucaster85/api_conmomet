const { EmployerCost, EmployerCostCategory, User } = require('../models');

const employerCostController = {
  // GET /api/employer-costs
  getAll: async (req, res) => {
    try {
      const { year, month } = req.query;
      const whereClause = {};
      
      if (year) whereClause.year = year;
      if (month) whereClause.month = month;

      const costs = await EmployerCost.findAll({
        where: whereClause,
        include: [
          {
            model: EmployerCostCategory,
            as: 'category',
            attributes: ['id', 'name', 'code', 'sort_order']
          },
          {
            model: User,
            as: 'createdBy',
            attributes: ['id', 'name', 'lastname']
          }
        ],
        order: [
          ['year', 'DESC'],
          ['month', 'DESC'],
          [{ model: EmployerCostCategory, as: 'category' }, 'sort_order', 'ASC']
        ]
      });
      res.status(200).json(costs);
    } catch (error) {
      console.error('Error fetching employer costs:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // GET /api/employer-costs/:id
  getById: async (req, res) => {
    try {
      const { id } = req.params;
      const cost = await EmployerCost.findByPk(id, {
        include: [
          { model: EmployerCostCategory, as: 'category' }
        ]
      });

      if (!cost) {
        return res.status(404).json({ message: 'Employer cost not found' });
      }

      res.status(200).json(cost);
    } catch (error) {
      console.error('Error fetching employer cost:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // POST /api/employer-costs
  create: async (req, res) => {
    try {
      const { category_id, month, year, amount, notes, file_url } = req.body;

      if (!category_id || !month || !year || amount === undefined) {
        return res.status(400).json({ message: 'Category, month, year, and amount are required' });
      }

      const cost = await EmployerCost.create({
        category_id,
        month,
        year,
        amount,
        notes,
        file_url,
        created_by: req.user?.id,
        updated_by: req.user?.id
      });

      const costWithCategory = await EmployerCost.findByPk(cost.id, {
        include: [{ model: EmployerCostCategory, as: 'category' }]
      });

      res.status(201).json(costWithCategory);
    } catch (error) {
      console.error('Error creating employer cost:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // PUT /api/employer-costs/:id
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { category_id, month, year, amount, notes, file_url } = req.body;

      const cost = await EmployerCost.findByPk(id);

      if (!cost) {
        return res.status(404).json({ message: 'Employer cost not found' });
      }

      await cost.update({
        category_id: category_id || cost.category_id,
        month: month || cost.month,
        year: year || cost.year,
        amount: amount !== undefined ? amount : cost.amount,
        notes: notes !== undefined ? notes : cost.notes,
        file_url: file_url !== undefined ? file_url : cost.file_url,
        updated_by: req.user?.id
      });

      const updatedCost = await EmployerCost.findByPk(id, {
        include: [{ model: EmployerCostCategory, as: 'category' }]
      });

      res.status(200).json(updatedCost);
    } catch (error) {
      console.error('Error updating employer cost:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // DELETE /api/employer-costs/:id
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      const cost = await EmployerCost.findByPk(id);

      if (!cost) {
        return res.status(404).json({ message: 'Employer cost not found' });
      }

      await cost.destroy();
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting employer cost:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};

module.exports = employerCostController;
