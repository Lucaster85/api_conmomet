const { Sequelize } = require('sequelize');
const process = require('process');
const env = process.env.NODE_ENV || 'development';
const config = require('./config.js')[env];

const sequelize = new Sequelize(config.database, config.username, config.password, config);

module.exports = sequelize;