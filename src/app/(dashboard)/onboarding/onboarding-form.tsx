"use client";

import { useActionState, useEffect, useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { FieldError } from "@/components/ui/field-error";
import { slugify, cn } from "@/lib/utils";
import { createTenantAction, type OnboardingState } from "@/actions/onboarding";
import {
  onboardingSchema,
  type OnboardingFieldErrors,
} from "@/lib/validations/onboarding";
import { useScrollOnMessage } from "@/lib/hooks/use-scroll-on-error";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(
    createTenantAction,
    null
  );

  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [clientErrors, setClientErrors] = useState<OnboardingFieldErrors>({});
  const alertRef = useScrollOnMessage<HTMLDivElement>(
    !state?.fieldErrors ? state?.error : null
  );

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(businessName));
  }, [businessName, slugTouched]);

  const errors: OnboardingFieldErrors = {
    ...(state?.fieldErrors as OnboardingFieldErrors | undefined),
    ...clientErrors,
  };

  function clearError(field: keyof OnboardingFieldErrors) {
    if (clientErrors[field]) {
      setClientErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const result = onboardingSchema.safeParse({
      business_name: formData.get("business_name"),
      slug: formData.get("slug"),
      business_type: formData.get("business_type"),
      legal_name: formData.get("legal_name"),
      ruc: formData.get("ruc"),
    });

    if (!result.success) {
      event.preventDefault();
      const flat: OnboardingFieldErrors = {};
      for (const issue of result.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && !(key in flat)) {
          (flat as Record<string, string>)[key] = issue.message;
        }
      }
      setClientErrors(flat);
      return;
    }

    setClientErrors({});
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate>
      <fieldset
        disabled={pending}
        className="m-0 min-w-0 space-y-10 border-0 p-0 disabled:opacity-95"
      >
        <Section
          title="Información del negocio"
          description="Cómo identificaremos tu espacio en SaturnLub."
        >
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="business_name" required>
                Nombre del negocio
              </Label>
              <Input
                id="business_name"
                name="business_name"
                placeholder="Lubricentro La Esquina"
                value={businessName}
                onChange={(e) => {
                  setBusinessName(e.target.value);
                  clearError("business_name");
                }}
                invalid={Boolean(errors.business_name)}
                aria-describedby={
                  errors.business_name ? "business_name-error" : undefined
                }
                autoFocus
              />
              <FieldError fieldId="business_name" message={errors.business_name} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="slug" required>
                Identificador único
              </Label>
              <div
                className={cn(
                  "flex items-stretch overflow-hidden rounded-sm border-2 bg-steel-950",
                  "shadow-control-inset transition-all duration-150 ease-out",
                  "focus-within:ring-2",
                  errors.slug
                    ? "border-hazard-500/70 focus-within:border-hazard-500 focus-within:ring-hazard-500/45"
                    : "border-steel-700 hover:border-steel-500 focus-within:border-safety-500 focus-within:ring-safety-500/45"
                )}
              >
                <span className="grid place-items-center border-r-2 border-steel-700 bg-steel-800 px-3 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground sm:text-[11.5px]">
                  saturnlub.app/
                </span>
                <input
                  id="slug"
                  name="slug"
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value);
                    setSlugTouched(true);
                    clearError("slug");
                  }}
                  placeholder="la-esquina"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={Boolean(errors.slug) || undefined}
                  aria-describedby={errors.slug ? "slug-error" : "slug-hint"}
                  className="h-11 min-w-0 flex-1 bg-transparent px-3 font-mono text-[13.5px] tracking-[0.02em] tabular-nums text-foreground placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground focus:outline-none sm:h-12 sm:px-4 sm:text-[14.5px]"
                />
              </div>
              {errors.slug ? (
                <FieldError fieldId="slug" message={errors.slug} />
              ) : (
                <p id="slug-hint" className="field-hint">
                  Solo minúsculas, números y guiones
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="business_type" required>
                Tipo de negocio
              </Label>
              <Select
                id="business_type"
                name="business_type"
                defaultValue="lubricentro"
                invalid={Boolean(errors.business_type)}
                onChange={() => clearError("business_type")}
                aria-describedby={
                  errors.business_type ? "business_type-error" : undefined
                }
              >
                <option value="lubricentro">Lubricentro</option>
                <option value="taller">Taller mecánico</option>
                <option value="autoservicio">Autoservicio</option>
                <option value="otro">Otro</option>
              </Select>
              <FieldError fieldId="business_type" message={errors.business_type} />
            </div>
          </div>
        </Section>

        <Divider />

        <Section
          title="Datos fiscales"
          description="Opcionales por ahora. Los puedes completar más tarde para emitir comprobantes."
        >
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="legal_name">
                Razón social{" "}
                <span className="font-normal normal-case tracking-normal text-muted-foreground/80">
                  (opcional)
                </span>
              </Label>
              <Input
                id="legal_name"
                name="legal_name"
                placeholder="Lubricentro La Esquina S.A.C."
                invalid={Boolean(errors.legal_name)}
                onChange={() => clearError("legal_name")}
              />
              <FieldError fieldId="legal_name" message={errors.legal_name} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ruc">
                RUC{" "}
                <span className="font-normal normal-case tracking-normal text-muted-foreground/80">
                  (opcional)
                </span>
              </Label>
              <Input
                id="ruc"
                name="ruc"
                inputMode="numeric"
                pattern="[0-9]{13}"
                maxLength={13}
                mono
                placeholder="1234567890001"
                invalid={Boolean(errors.ruc)}
                aria-describedby={errors.ruc ? "ruc-error" : "ruc-hint"}
                onChange={() => clearError("ruc")}
              />
              {errors.ruc ? (
                <FieldError fieldId="ruc" message={errors.ruc} />
              ) : (
                <p id="ruc-hint" className="field-hint">
                  RUC ecuatoriano · 13 dígitos
                </p>
              )}
            </div>
          </div>
        </Section>

        {state?.error && !state.fieldErrors ? (
          <div ref={alertRef} tabIndex={-1} className="outline-none">
            <Alert tone="error">{state.error}</Alert>
          </div>
        ) : null}

        <div className="flex flex-col-reverse items-stretch gap-4 border-t border-steel-700 pt-7 sm:flex-row sm:items-center sm:justify-end">
          <p className="industrial-label sm:mr-auto">
            Tu negocio inicia con un periodo de prueba.
          </p>
          <Button
            type="submit"
            size="xl"
            loading={pending}
            className="sm:min-w-[240px]"
          >
            {pending
                ? "Creando negocio…"
                : "Crear negocio"}
          </Button>
        </div>
      </fieldset>
    </form>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-6">
      <header className="flex items-center gap-3 border-b-2 border-steel-700 pb-4">
        <span
          aria-hidden
          className="inline-block h-3 w-3 shrink-0 rounded-sm bg-safety-500 shadow-[0_0_8px_-1px_rgba(255,193,7,0.4)]"
        />
        <div className="space-y-1">
          <h2 className="text-[15px] font-extrabold uppercase tracking-[0.08em] text-foreground leading-none">
            {title}
          </h2>
          {description ? (
            <p className="text-[12.5px] leading-5 text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      </header>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

function Divider() {
  return (
    <div
      aria-hidden
      className="hazard-stripe h-1 w-full opacity-60"
    />
  );
}
