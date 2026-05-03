import type { Metadata } from "next";
import { HeroSection } from "@/components/public/hero";
import { StatsStrip } from "@/components/public/stats-strip";
import { ServicesOverlapSection } from "@/components/public/services-overlap";
import { WorkflowSection } from "@/components/public/workflow";
import { PricingSection } from "@/components/public/pricing";
import { CtaBanner } from "@/components/public/cta-banner";

export const metadata: Metadata = {
  title: "SaturnLub · Gestión total para tu taller",
  description:
    "Software para lubricadoras, talleres mecánicos y ferreterías automotrices en Ecuador. Órdenes de trabajo, facturación electrónica SRI, control de inventario y caja, todo en un solo panel.",
};

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <StatsStrip />
      <ServicesOverlapSection />
      <WorkflowSection />
      <PricingSection />
      <CtaBanner />
    </>
  );
}
