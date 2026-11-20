// Error de la integración con ARCA. `code` permite al controller elegir el status HTTP sin parsear el mensaje, y
// `message` es siempre apto para mostrar en pantalla: nunca lleva token, sign, claves ni el sobre SOAP (S2).
class ArcaError extends Error {
  /**
   * @param {string} code - config | disabled | network | wsaa_already_authenticated | wsaa | afip
   * @param {string} message - texto legible para el usuario
   * @param {object} [extra] - detalle seguro (códigos de error de ARCA, etc.)
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "ArcaError";
    this.code = code;
    this.details = extra.details || null;
  }
}

module.exports = { ArcaError };
