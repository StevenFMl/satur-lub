"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Alert } from "@/components/ui/alert";
import { slugify } from "@/lib/utils";
import { createTenantAction, type OnboardingState } from "./actions";

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState<OnboardingState, FormData>(
    createTenantAction,
    null
  );

  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (!slugTouched) setSlug(slugify(businessName));
  }, [businessName, slugTouched]);

  const fieldErrors = state?.fieldErrors;

  return (
    <form action={formAction} className="space-y-8" noValidate>
      <Section
        title="Información del negocio"
        description="Cómo identificaremos tu espacio en SaturnLub."
      >
        <div className="space-y-1.5">
          <Label htmlFor="business_name">Nombre del negocio</Label>
          <Input
            id="business_name"
            name="business_name"
            required
            placeholder="Lubricentro La Esquina"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            invalid={Boolean(fieldErrors?.business_name)}
            autoFocus
          />
          {fieldErrors?.business_name ? (
            <p className="text-[12px] text-destructive">
              {fieldErrors.business_name}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="slug">Identificador</Label>
          <div
            className={
              "flex items-stretch overflow-hidden rounded-md border bg-card transition-colors " +
              (fieldErrors?.slug
                ? "border-destructive/50"
                : "border-input focus-within:border-foreground/40 focus-within:ring-2 focus-within:ring-foreground/10")
            }
          >
            <span className="grid place-items-center border-r border-border bg-muted/60 px-3 text-[12px] text-muted-foreground">
              saturnlub.app/
            </span>
            <input
              id="slug"
              name="slug"
              required
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugTouched(true);
              }}
              placeholder="lubricentro-la-esquina"
              className="h-10 min-w-0 flex-1 bg-transparent px-3 text-[14px] text-foreground placeholder:text-muted-foreground/80 focus:outline-none"
            />
          </div>
          <p className="text-[12px] text-muted-foreground">
            Solo minúsculas, números y guiones (3 a 60 caracteres). Será único
            en SaturnLub.
          </p>
          {fieldErrors?.slug ? (
            <p className="text-[12px] text-destructive">{fieldErrors.slug}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="business_type">Tipo de negocio</Label>
          <Select
            id="business_type"
            name="business_type"
            defaultValue="lubricentro"
            required
          >
            <option value="lubricentro">Lubricentro</option>
            <option value="taller">Taller mecánico</option>
            <option value="autoservicio">Autoservicio</option>
            <option value="otro">Otro</option>
          </Select>
          {fieldErrors?.business_type ? (
            <p className="text-[12px] text-destructive">
              {fieldErrors.business_type}
            </p>
          ) : null}
        </div>
      </Section>

      <Divider />

      <Section
        title="Datos fiscales"
        description="Opcionales por ahora. Los puedes completar más tarde para emitir comprobantes."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="legal_name">
              Razón social{" "}
              <span className="font-normal text-muted-foreground">
                (opcional)
              </span>
            </Label>
            <Input
              id="legal_name"
              name="legal_name"
              placeholder="Lubricentro La Esquina S.A.C."
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ruc">
              RUC{" "}
              <span className="font-normal text-muted-foreground">
                (opcional)
              </span>
            </Label>
            <Input
              id="ruc"
              name="ruc"
              inputMode="numeric"
              pattern="[0-9]{8,11}"
              placeholder="20123456789"
            />
          </div>
        </div>
      </Section>

      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}

      <div className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
        <p className="text-[12px] text-muted-foreground sm:mr-auto">
          Tu negocio inicia con un periodo de prueba.
        </p>
        <Button type="submit" size="lg" loading={pending} className="sm:min-w-[200px]">
          {pending ? "Creando negocio" : "Crear negocio y continuar"}
        </Button>
      </div>
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
    <section className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="text-[13px] leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Divider() {
  return <div className="h-px w-full bg-border" />;
}
