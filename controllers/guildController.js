const { Guild } = require('../models');

const guildController = {
  // GET /api/guilds
  getAll: async (req, res) => {
    try {
      const guilds = await Guild.findAll({
        order: [['name', 'ASC']]
      });
      res.status(200).json(guilds);
    } catch (error) {
      console.error('Error fetching guilds:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // GET /api/guilds/:id
  getById: async (req, res) => {
    try {
      const { id } = req.params;
      const guild = await Guild.findByPk(id);

      if (!guild) {
        return res.status(404).json({ message: 'Guild not found' });
      }

      res.status(200).json(guild);
    } catch (error) {
      console.error('Error fetching guild:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // POST /api/guilds
  create: async (req, res) => {
    try {
      const { name, code, is_active } = req.body;

      if (!name || !code) {
        return res.status(400).json({ message: 'Name and code are required' });
      }

      const guild = await Guild.create({
        name,
        code,
        is_active: is_active !== undefined ? is_active : true
      });

      res.status(201).json(guild);
    } catch (error) {
      console.error('Error creating guild:', error);
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ message: 'A guild with this code already exists' });
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // PUT /api/guilds/:id
  update: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, code, is_active } = req.body;

      const guild = await Guild.findByPk(id);

      if (!guild) {
        return res.status(404).json({ message: 'Guild not found' });
      }

      await guild.update({
        name: name || guild.name,
        code: code || guild.code,
        is_active: is_active !== undefined ? is_active : guild.is_active
      });

      res.status(200).json(guild);
    } catch (error) {
      console.error('Error updating guild:', error);
      if (error.name === 'SequelizeUniqueConstraintError') {
        return res.status(409).json({ message: 'A guild with this code already exists' });
      }
      res.status(500).json({ message: 'Internal server error' });
    }
  },

  // DELETE /api/guilds/:id
  delete: async (req, res) => {
    try {
      const { id } = req.params;
      const guild = await Guild.findByPk(id);

      if (!guild) {
        return res.status(404).json({ message: 'Guild not found' });
      }

      await guild.destroy();
      res.status(204).send();
    } catch (error) {
      console.error('Error deleting guild:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};

module.exports = guildController;
