const { EmployerCostCategory } = require('../models');

const employerCostCategoryController = {
  // GET /api/employer-cost-categories
  getAll: async (req, res) => {
    try {
      const categories = await EmployerCostCategory.findAll({
        order: [['sort_order', 'ASC'], ['name', 'ASC']]
      });
      res.status(200).json(categories);
    } catch (error) {
      console.error('Error fetching employer cost categories:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // GET /api/employer-cost-categories/:id
  getById: async (req, res) => {
    try {
      const { id } = req.params;
      const category = await EmployerCostCategory.findByPk(id);

      if (!category) {
        return res.status(404).json({ message: 'Employer cost category not found' });
      }

      res.status(200).json(category);
    } catch (error) {
      console.error('Error fetching employer cost category:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // POST /api/employer-cost-categories
  create: async (req, res) => {
    try {
      const { name, code, sort_order, is_active } = req.body;

      if (!name || !code) {
        return res.status(400).json({ message: 'Name and code are required' });
      }

      const category = await EmployerCostCategory.create({
        name,
        code,
        sort_order: sort_order || 0,
        is_active: is_active !== undefined ? is_active : true
      });

      res.status(201).json(category);
    } catch (error) {
      console.error('Error creating employer cost category:', error);
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ message: 'A category with this code already exists' });
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // PUT /api/employer-cost-categories/:id
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, sort_order, is_active } = req.body;

      const category = await EmployerCostCategory.findByPk(id);

      if (!category) {
        return res.status(404).json({ message: 'Employer cost category not found' });
      }

      await category.update({
        name: name || category.name,
        code: code || category.code,
        sort_order: sort_order !== undefined ? sort_order : category.sort_order,
        is_active: is_active !== undefined ? is_active : category.is_active
      });

      res.status(200).json(category);
    } catch (error) {
      console.error('Error updating employer cost category:', error);
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ message: 'A category with this code already exists' });
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // DELETE /api/employer-cost-categories/:id
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      const category = await EmployerCostCategory.findByPk(id);

      if (!category) {
        return res.status(404).json({ message: 'Employer cost category not found' });
      }

      await category.destroy();
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting employer cost category:', error);
      if (error.name === 'SequelizeForeignKeyConstraintError') {
        return res.status(409).json({ message: 'Cannot delete category as it is currently in use' });
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};

module.exports = employerCostCategoryController;
