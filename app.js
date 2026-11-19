require('dotenv').config();
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const cors = require('cors');
const helmet = require('helmet');

const multer = require('multer');
const { sendServerError } = require('./helpers/httpErrors');

const indexRouter = require('./routes/index');

const app = express();

// Railway está detrás de un proxy: sin esto `req.ip` es siempre la IP del proxy, y el rate limit
// de los formularios públicos (middlewares/publicForm.js) contaría a todos los visitantes como
// uno solo. El `1` confía únicamente en el primer salto.
app.set('trust proxy', 1);

// Cabeceras de seguridad (FLOWS.md §75.4): X-Content-Type-Options, X-Frame-Options, HSTS, Referrer-Policy,
// sin X-Powered-By. La API solo sirve JSON y archivos: no necesita CSP propia (la del front la pone su
// middleware) y CORP en cross-origin para no romper nada servido desde public/ al front en otro dominio.
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false,
}));

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

// Handler final de errores (FLOWS.md §75.3). Antes, un JSON mal formado, el error de CORS o un
// archivo de más devolvían HTML de express con el stack en desarrollo.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'El archivo supera los 25 MB.', code: 'file_too_large' });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: 'Se enviaron más archivos de los permitidos.', code: 'too_many_files' });
    }
    return res.status(400).json({ error: 'No se pudo procesar el archivo enviado.', code: 'upload_error' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la solicitud no es un JSON válido.', code: 'invalid_json' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'La solicitud es demasiado grande.', code: 'payload_too_large' });
  }
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origen no permitido.', code: 'cors_not_allowed' });
  }
  return sendServerError(res, err);
});

module.exports = app;
