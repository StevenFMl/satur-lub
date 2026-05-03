# SaturnLub · Heavy-Duty OS

Plataforma operativa multi-tenant para **lubricentros, talleres mecánicos y ferreterías automotrices**. Permite a un dueño operar su negocio (órdenes, vehículos, inventario, caja, facturación) desde un único panel y dar acceso a su equipo (mecánicos, cobradores, administradores) con roles diferenciados.

> Este README es la fuente de verdad de la arquitectura del proyecto, las reglas de negocio del flujo de autenticación y las migraciones SQL requeridas en Supabase.

---

## 1. Stack técnico

| Capa            | Tecnología                                        |
| --------------- | ------------------------------------------------- |
| Framework       | **Next.js 15** (App Router, RSC, Server Actions)  |
| Lenguaje        | **TypeScript** estricto                           |
| Estilos         | **Tailwind CSS 3** + identidad industrial propia  |
| Tipografía      | Inter (sans) · Bebas Neue (display) · JetBrains Mono (HUD) |
| Validación      | **Zod 4** (cliente y servidor, mismos schemas)    |
| Auth + DB       | **Supabase** (`@supabase/ssr` para SSR seguro)    |
| Aislamiento     | **RLS** por `tenant_id` + `tenant_memberships`    |

Variables de entorno requeridas (`.env.local`):

```env
NEXT_PUBLIC_SUPABASE_URL=https://<proyecto>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key>
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>   # SOLO server-side, nunca expuesta al cliente
```

> ⚠️ `SUPABASE_SERVICE_ROLE_KEY` solo se importa desde `src/lib/supabase/admin.ts`. Cualquier archivo que la consuma debe ser `"use server"` o vivir bajo `src/actions` / `src/lib/supabase`.

---

## 2. Arquitectura de carpetas

Separación estricta por **route groups** de Next.js — cada grupo tiene su propio layout, sus propias guards y su propio paleta de páginas.

```
src/
├─ app/
│  ├─ (public)/                     ← Landing, pricing, marketing
│  │  ├─ layout.tsx                 ← Header público + footer marketing
│  │  └─ page.tsx                   ← Landing
│  │
│  ├─ (auth)/                       ← Login / Register / Forgot
│  │  ├─ layout.tsx                 ← Split visual + formulario
│  │  ├─ login/page.tsx             ← Acepta cédula O correo
│  │  ├─ register/page.tsx          ← Solo dueños/fundadores
│  │  └─ forgot-password/page.tsx   ← Reset por correo
│  │
│  ├─ (dashboard)/                  ← App protegida (requiere sesión + tenant)
│  │  ├─ layout.tsx                 ← Auth guard + role guard + redirect
│  │  ├─ onboarding/page.tsx        ← Setup inicial del tenant (solo owner)
│  │  └─ dashboard/                 ← Operación diaria
│  │     ├─ layout.tsx              ← Sidebar + header
│  │     └─ page.tsx                ← Centro operativo
│  │
│  ├─ auth/callback/route.ts        ← OAuth / magic-link callback
│  ├─ globals.css                   ← Tokens industriales + utilities
│  └─ layout.tsx                    ← <html><body>, fonts globales
│
├─ actions/                         ← Server Actions puras (no UI)
│  ├─ auth.ts                       ← login, register, logout, forgotPassword
│  └─ onboarding.ts                 ← createTenant
│
├─ components/
│  ├─ brand/logo.tsx                ← Marca SaturnLub (Saturno + gota)
│  ├─ ui/                           ← Button, Input, Label, Select, Alert, Card, FieldError, PasswordInput
│  └─ dashboard/                    ← Sidebar, Header (operación)
│
├─ lib/
│  ├─ supabase/
│  │  ├─ client.ts                  ← createBrowserClient (Client Components)
│  │  ├─ server.ts                  ← createServerClient (RSC, Server Actions)
│  │  ├─ middleware.ts              ← Refresh de tokens + route guards
│  │  ├─ admin.ts                   ← Cliente con service_role (server-only)
│  │  └─ types.ts                   ← Database types (Phase 1)
│  │
│  ├─ validations/
│  │  ├─ auth.ts                    ← loginSchema, registerSchema, forgotPasswordSchema
│  │  └─ onboarding.ts              ← onboardingSchema
│  │
│  └─ utils.ts                      ← cn, slugify, formatDate, daysBetween
│
├─ middleware.ts                    ← Edge middleware → updateSession()
└─ types/                           ← (futuro: tipos compartidos)
```

### Reglas estrictas de import

- Componentes de `(auth)` y `(dashboard)` **importan Server Actions desde `@/actions/...`**, nunca de archivos coubicados.
- `src/lib/supabase/admin.ts` **solo se importa desde `src/actions/*` y `src/lib/supabase/*`**. Cualquier import desde un Client Component debe fallar la review.
- Cada Server Action valida su input con un schema de `src/lib/validations/*` antes de tocar Supabase.

---

## 3. Resumen de la base de datos (multi-tenant + RLS)

> El esquema completo vive en migraciones de Supabase. Aquí solo el modelo de dominio relevante para auth.

### Tablas principales

| Tabla                  | Propósito                                                              | Aislamiento                       |
| ---------------------- | ---------------------------------------------------------------------- | --------------------------------- |
| `auth.users`           | Tabla nativa de Supabase Auth (email, password hash, metadata)         | Nativo Supabase                   |
| `public.users`         | Mirror del perfil (`full_name`, `avatar_url`, **`cedula`**)            | RLS: `auth.uid() = id`            |
| `public.tenants`       | Negocios (lubricentro, taller, ferretería)                             | RLS: solo miembros activos        |
| `public.tenant_memberships` | Membresías `(tenant_id, user_id, role, status)`                   | RLS: solo el propio user_id       |
| `public.subscription_plans` | Catálogo de planes                                                | Lectura pública                   |

### Roles soportados (`tenant_memberships.role`)

- **`owner`** · Dueño/fundador. Único capaz de crear el tenant. Acceso total.
- **`admin`** · Administrador delegado. Puede gestionar usuarios y operación.
- **`staff`** · Personal operativo (mecánicos, cobradores, vendedores). Acceso restringido a su flujo.

> El "cobrador" es un `staff` cuya UI principal es la pantalla de cobranza/caja. La diferenciación fina (cobrador vs mecánico) se hará luego con un sub-rol o con permisos finos.

### Aislamiento

- Todas las tablas operativas (`orders`, `vehicles`, `inventory_items`, `cash_sessions`, etc.) llevan `tenant_id` y tienen RLS:
  ```sql
  USING (tenant_id IN (
    SELECT tenant_id FROM public.tenant_memberships
    WHERE user_id = auth.uid() AND status = 'active'
  ))
  ```
- Las RPCs del dominio se ejecutan como `SECURITY INVOKER` salvo casos puntuales de bypass controlado (ver `find_email_by_cedula`).

### Migraciones requeridas para este flujo

Ejecuta estos cambios en Supabase **antes de probar el login con cédula**:

```sql
-- 1) Agregar columna cedula a public.users (única, opcional)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS cedula text;

CREATE UNIQUE INDEX IF NOT EXISTS users_cedula_unique_idx
  ON public.users (cedula)
  WHERE cedula IS NOT NULL;

-- 2) RPC para resolver email a partir de cédula durante el login.
--    SECURITY DEFINER hace que la RPC bypassée RLS de forma acotada:
--    solo puede leer el email asociado a una cédula y nada más.
CREATE OR REPLACE FUNCTION public.find_email_by_cedula(p_cedula text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.email
  FROM public.users u
  WHERE u.cedula = trim(p_cedula)
  LIMIT 1;
$$;

-- 3) Permitir ejecutar la RPC sin estar autenticado (es la primera llamada del login).
GRANT EXECUTE ON FUNCTION public.find_email_by_cedula(text) TO anon, authenticated;

-- 4) Asegúrate de que public.users.cedula NO esté expuesta por RLS general.
--    El único acceso debe ser vía esta RPC o por el propio dueño del registro.
```

> **Auto-confirm de email** debe estar activado en Supabase Dashboard → Authentication → Providers → Email → "Confirm email" desactivado. Sin esto, el registro no abre sesión inmediata y la UX se rompe.

---

## 4. Flujo del Cobrador (detallado)

Este es el flujo crítico que justifica la mecánica "cédula o correo". Se documenta paso a paso para que cualquier ingeniero pueda implementar features encima sin romperlo.

### Actores

- **Admin/Owner**: dueño o administrador del taller. Tiene acceso al panel de gestión de usuarios.
- **Cobrador**: empleado que opera la caja. **No tiene correo profesional**. Suele recordar mejor su cédula que un email.

### 4.1 · Alta del cobrador (hecha por el admin)

1. El admin entra a `/dashboard/team` (UI futura) y elige **"Agregar miembro"**.
2. Llena el formulario:
   - Nombre completo
   - **Cédula** (8–11 dígitos, único en `public.users`)
   - **Correo** (puede ser uno real, uno corporativo `cobranza@taller.com`, o un alias generado)
   - **Contraseña inicial** (generada o establecida)
   - **Rol**: `staff` (con sub-categoría "cobrador" si la modelamos luego)
3. Server Action `createTeamMember`:
   - Valida con Zod.
   - Llama a `supabase.auth.admin.createUser({ email, password, email_confirm: true })` usando el **service-role client** (`@/lib/supabase/admin.ts`).
   - Inserta en `public.users` con `id` = el `user.id` recién creado, `email`, `full_name`, **`cedula`**.
   - Inserta en `public.tenant_memberships` con `tenant_id` del admin, `user_id`, `role: 'staff'`, `status: 'active'`.
4. El admin recibe en pantalla las credenciales (cédula + contraseña) para entregarlas físicamente al cobrador (impresas, SMS interno, papel firmado).

### 4.2 · El cobrador inicia sesión

El cobrador llega al frente de caja, abre `/login` y ve **un solo input** llamado **"Cédula o correo"**. Escribe su cédula y su contraseña.

### 4.3 · Qué hace el servidor (paso a paso)

1. El form de cliente valida con `loginSchema` (Zod): `identifier` no vacío, `password` no vacío.
2. Submit dispara la Server Action `loginAction(formData)` en `src/actions/auth.ts`.
3. El action vuelve a parsear con Zod (defensa server-side).
4. `loginAction` detecta si `identifier` es **email** o **cédula**:
   - Si contiene `@` → trata como email directo.
   - Si es solo dígitos (8–11) → llama a la RPC:
     ```ts
     const { data: email } = await supabase.rpc("find_email_by_cedula", {
       p_cedula: identifier,
     });
     ```
   - La RPC corre con `SECURITY DEFINER`, así bypassea RLS y devuelve el email asociado (o `null`).
5. Si no hay email resuelto → retorna error genérico `"Credenciales inválidas."` (no decimos "esa cédula no existe" — evita enumeration attacks).
6. Con el email resuelto, llama a:
   ```ts
   await supabase.auth.signInWithPassword({ email, password });
   ```
7. Si las credenciales son válidas, Supabase setea las cookies de sesión vía `@supabase/ssr`.
8. `loginAction` consulta `tenant_memberships` para resolver:
   - Si **no hay membership activa** → redirige a `/onboarding` (caso owner recién registrado, no aplica al cobrador).
   - Si hay membership con rol `owner` o `admin` → `/dashboard`.
   - Si hay membership con rol `staff` → `/dashboard` (la UI interna se diferencia por rol).

### 4.4 · Refresh seguro de tokens

`src/middleware.ts` ejecuta `updateSession()` en cada request. Esto:

- Lee las cookies de sesión.
- Si el access token venció, llama a Supabase y obtiene un nuevo par access/refresh.
- Sobrescribe las cookies en la response **antes** de que cualquier RSC las lea.
- Sin este middleware, los Server Components ven sesiones expiradas y redirigen al login innecesariamente.

### 4.5 · Por qué esta arquitectura es segura

- **No exponemos service role al cliente**: la única forma de resolver cédula→email desde el browser es la RPC `SECURITY DEFINER`, que sólo retorna `email` (no contraseña, no hash).
- **No revelamos si una cédula existe**: cualquier fallo (cédula no registrada, password equivocado) retorna el mismo mensaje genérico al cliente.
- **Auto-confirm sin email significa que un atacante no necesita verificación**, pero nuestro registro público está limitado a **dueños creando su propio negocio**. Los empleados son creados por el admin con `email_confirm: true` server-side, nunca por sí mismos en `/register`.
- **La cédula viaja en `formData` cifrada por TLS**, igual que el password — no aparece en la URL.

---

## 5. Reglas de UI/UX

Identidad **"Industrial Heavy-Duty"**: pensada para POS de taller, operadores con guantes, pantallas táctiles en ambientes con luz cambiante.

- **Paleta**: superficies en `steel-700/800/900/950` (asfalto/carbón). Acento principal `safety-500` (amarillo CAT) para CTAs y focus rings. Acentos secundarios `rust-*` (operativo), `mechanic-*` (info), `hazard-*` (errores), `signal-*` (OK).
- **Esquinas duras**: `rounded-sm` (2 px) o cuadrado. Nunca `rounded-md`/`rounded-lg`/`rounded-full` salvo casos puntuales (indicador de status).
- **Sombras**: secas, con offset, sin blur. Tokens `shadow-bevel`, `shadow-industrial-sm`, `shadow-safety-glow`.
- **Tipografía**:
  - **Bebas Neue** (font-display) para titulares grandes y headers de panel.
  - **JetBrains Mono** (font-mono) para IDs, seriales, lecturas tipo HUD.
  - **Inter** (font-sans) para todo lo demás.
- **Inputs y botones**: alto mínimo 48 px (`h-12`/`h-14`). Pensados para guantes.
- **Errores de campo**: utility `.field-error` (barra roja + glyph + texto en mayúsculas tracked) vía componente `FieldError`. Nunca un `<p className="text-destructive text-xs">` suelto.
- **Texturas**: `.carbon-fiber`, `.tread-plate`, `.garage-backdrop`, `.brushed-steel`, `.metal-gradient`, `.hazard-stripe` están definidas en `globals.css`.

### Validación — Zod first

- Todos los formularios de `(auth)` y `onboarding` validan en cliente con Zod **antes** de disparar la Server Action.
- La misma Server Action vuelve a validar con el mismo schema (defensa en profundidad).
- Errores se mapean por campo y se muestran inline con `<FieldError />`.
- Errores globales (credenciales incorrectas, RPC caída) se muestran con `<Alert tone="error" />`.

---

## 6. Convenciones del repositorio

- **No mezclar** UI y Server Actions en el mismo archivo. UI en `app/.../page.tsx`/`*-form.tsx`, lógica en `src/actions/*.ts`.
- **No** crear validation schemas inline en componentes — todos viven en `src/lib/validations/`.
- **No** importar `@/lib/supabase/admin` desde código que pueda terminar en el cliente. Si dudas, no lo importes.
- **No** escribir mensajes "revisa tu correo para confirmar" — el flujo asume auto-confirm activo.
- **No** registrar empleados desde `/register`. Esa pantalla es **solo dueños**.

---

## 7. Scripts

```bash
npm run dev         # Next.js dev server (turbopack si el flag está activo)
npm run build       # Production build
npm run start       # Production server
npm run lint        # ESLint (next/core-web-vitals)
npm run typecheck   # tsc --noEmit
```

---

## 8. Roadmap inmediato

- [x] Auth público (registro de owner, login, forgot password)
- [x] Login con cédula o correo
- [x] Onboarding del tenant
- [ ] `/dashboard/team` — alta de cobradores/mecánicos por el admin
- [ ] Permisos finos por sub-rol dentro de `staff`
- [ ] Pantalla de caja específica para cobrador
- [ ] Soft-deletes y auditoría operativa
