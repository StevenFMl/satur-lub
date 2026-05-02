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

export const loginSchema = z.object({
  email: emailSchema,
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

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;

export type LoginFieldErrors = Partial<Record<keyof LoginInput, string>>;
export type RegisterFieldErrors = Partial<Record<keyof RegisterInput, string>>;
