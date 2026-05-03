import { z } from "zod";

const asString = (v: unknown) => (typeof v === "string" ? v : "");

const emailSchema = z.preprocess(
  asString,
  z
    .string()
    .trim()
    .min(1, "Ingresa tu correo electrónico.")
    .email("El correo no tiene un formato válido.")
    .max(254, "El correo es demasiado largo.")
);

const passwordLoginSchema = z.preprocess(
  asString,
  z.string().min(1, "Ingresa tu contraseña.")
);

const passwordRegisterSchema = z.preprocess(
  asString,
  z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres.")
    .max(72, "La contraseña no puede superar los 72 caracteres.")
    .regex(/[A-Za-z]/, "Incluye al menos una letra.")
    .regex(/[0-9]/, "Incluye al menos un número.")
);

/**
 * Identificador del login: acepta correo o cédula.
 * - Cédula ecuatoriana = 10 dígitos exactos.
 * - Correo = formato email estándar.
 *
 * El servidor decide cuál es cuál mirando si contiene `@`. La validación aquí
 * solo asegura que el campo no esté vacío y tenga formato razonable.
 */
const cedulaRegex = /^[0-9]{10}$/;
const looksLikeEmail = (v: string) => v.includes("@");

const identifierSchema = z.preprocess(
  asString,
  z
    .string()
    .trim()
    .min(1, "Ingresa tu cédula o correo.")
    .max(254, "Identificador demasiado largo.")
    .refine(
      (v) => looksLikeEmail(v) || cedulaRegex.test(v),
      "Ingresa una cédula válida (10 dígitos) o un correo."
    )
    .refine(
      (v) => !looksLikeEmail(v) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      "El correo no tiene un formato válido."
    )
);

export const loginSchema = z.object({
  identifier: identifierSchema,
  password: passwordLoginSchema,
  redirectTo: z.preprocess(asString, z.string()).optional(),
});

export const registerSchema = z.object({
  full_name: z.preprocess(
    asString,
    z
      .string()
      .trim()
      .min(2, "El nombre debe tener al menos 2 caracteres.")
      .max(80, "El nombre es demasiado largo.")
  ),
  email: emailSchema,
  password: passwordRegisterSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export type LoginFieldErrors = Partial<Record<keyof LoginInput, string>>;
export type RegisterFieldErrors = Partial<Record<keyof RegisterInput, string>>;
export type ForgotPasswordFieldErrors = Partial<
  Record<keyof ForgotPasswordInput, string>
>;

/**
 * Helper para que el cliente y el servidor decidan cómo procesar un identifier.
 * Se exporta porque el `loginAction` lo usa para llamar a la RPC sólo si es cédula.
 */
export function classifyIdentifier(
  identifier: string
): { kind: "email"; value: string } | { kind: "cedula"; value: string } {
  const trimmed = identifier.trim();
  if (looksLikeEmail(trimmed)) return { kind: "email", value: trimmed };
  return { kind: "cedula", value: trimmed };
}
