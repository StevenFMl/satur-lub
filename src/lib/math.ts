/**
 * Motor matemático financiero seguro (SaturnLub).
 *
 * Regla dura: NINGÚN operador +, -, *, / nativo de JS puede usarse para
 * dinero, cantidades monetarias o tasas impositivas en la aplicación.
 * Todo cálculo financiero pasa por estas funciones basadas en big.js
 * (precisión decimal exacta, sin errores de punto flotante IEEE-754).
 *
 * Convenciones:
 * - Dinero (subtotal, IVA, total factura): 2 decimales (centavos).
 * - Precios unitarios / costos unitarios: 4 decimales.
 * - Redondeo estándar contable: HALF_UP (bancario conservador hacia arriba
 *   en .5 para favorecer registro fiel de impuestos en Ecuador).
 */

import Big from "big.js";

// Config global: redondeo por defecto = ROUND_HALF_UP (1)
Big.RM = Big.roundHalfUp;
// Margen de precisión interno amplio para evitar pérdidas en cadenas largas.
Big.DP = 20;

export type Numeric = Big | number | string;

const toBig = (v: Numeric): Big => {
  if (v instanceof Big) return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return new Big(0);
    return new Big(v);
  }
  const t = (v ?? "").toString().trim().replace(",", ".");
  if (t === "" || Number.isNaN(Number(t))) return new Big(0);
  return new Big(t);
};

/** Suma segura. */
export const add = (a: Numeric, b: Numeric): Big => toBig(a).plus(toBig(b));
/** Resta segura. */
export const sub = (a: Numeric, b: Numeric): Big => toBig(a).minus(toBig(b));
/** Multiplicación segura. */
export const mul = (a: Numeric, b: Numeric): Big => toBig(a).times(toBig(b));
/** División segura (devuelve 0 si divisor = 0). */
export const div = (a: Numeric, b: Numeric): Big => {
  const denom = toBig(b);
  if (denom.eq(0)) return new Big(0);
  return toBig(a).div(denom);
};

/**
 * Redondea un valor a 2 decimales (centavos) con HALF_UP.
 * Uso: subtotales, impuestos, totales de factura.
 */
export const toMoney = (val: Numeric): Big =>
  toBig(val).round(2, Big.roundHalfUp);

/**
 * Redondea un valor a 4 decimales con HALF_UP.
 * Uso: precios unitarios, costos unitarios (tolera fracciones de centavo).
 */
export const toUnitPrice = (val: Numeric): Big =>
  toBig(val).round(4, Big.roundHalfUp);

/** Serializa un Big como string con N decimales fijos (para DB / JSON). */
export const toFixedStr = (val: Numeric, dp = 2): string =>
  toBig(val).toFixed(dp);

/** Convierte a número JS (solo para UI / Intl). NO usar en cálculos. */
export const toNum = (val: Numeric): number => Number(toBig(val).toString());

/**
 * Suma una colección de valores de forma segura.
 */
export const sumAll = (values: Numeric[]): Big =>
  values.reduce<Big>((acc, v) => acc.plus(toBig(v)), new Big(0));

/**
 * Calcula el monto de IVA dado un subtotal y una tasa porcentual.
 * @param subtotal base imponible
 * @param ratePct  tasa como porcentaje (ej. 15 = 15%)
 * @returns monto IVA redondeado a 2 decimales
 */
export const taxAmount = (subtotal: Numeric, ratePct: Numeric): Big =>
  toMoney(div(mul(subtotal, ratePct), 100));

/**
 * Calcula el total de factura (subtotal + IVA) redondeado a 2 decimales.
 */
export const grandTotal = (subtotal: Numeric, tax: Numeric): Big =>
  toMoney(add(subtotal, tax));

/**
 * Calcula el costo total de una línea: quantity × unit_cost, a 2 decimales.
 */
export const lineTotal = (qty: Numeric, unitCost: Numeric): Big =>
  toMoney(mul(qty, unitCost));

/**
 * Calcula el costo unitario a partir de un costo total y cantidad, 4 decimales.
 */
export const unitCostFromTotal = (total: Numeric, qty: Numeric): Big =>
  toUnitPrice(div(total, qty));
