require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const cors = require('cors');

const indexRouter = require('./routes/index');
const db = require('./models');
const { runSeed } = require('./helpers/seed');

const app = express();

app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = (process.env.CORS_ORIGIN || 'https://conmomet-app-production.up.railway.app').split(',');
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);

// Seed initial data once DB is ready
db.sequelize.authenticate()
  .then(() => runSeed(db))
  .catch(err => console.error('[app] Error al conectar DB:', err.message));

module.exports = app;
