"use strict";

/**
 * Clave de comparación de un teléfono, para detectar al mismo postulante cargado dos veces (ver
 * FLOWS.md §59). NO es un formato de guardado: el teléfono se guarda como lo escribió la persona.
 *
 * Los argentinos escriben el mismo número de muchas formas (con o sin 0, con o sin 15, con +54 9 o
 * sin nada), así que se compara por los últimos 10 dígitos —código de área + número—. Si hay menos
 * de 10 pero al menos 8 (un número sin característica) se compara completo. Menos de 8 dígitos no
 * alcanza para identificar a nadie: devuelve null y el teléfono no se usa para detectar duplicados.
 *
 * Limitación conocida: un número local sin característica puede coincidir con el final de otro con
 * característica distinta. Como solo alimenta un AVISO ("posible duplicado"), no una fusión
 * automática, se acepta.
 */
function phoneKey(value) {
  if (value === undefined || value === null) return null;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 8) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

module.exports = { phoneKey };
