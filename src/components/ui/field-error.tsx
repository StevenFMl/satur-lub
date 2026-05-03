import * as React from "react";
import { cn } from "@/lib/utils";

export interface FieldErrorProps extends React.HTMLAttributes<HTMLDivElement> {
  message?: string | null;
  fieldId?: string;
}

export function FieldError({
  message,
  fieldId,
  className,
  ...props
}: FieldErrorProps) {
  if (!message) return null;
  return (
    <div
      id={fieldId ? `${fieldId}-error` : undefined}
      role="alert"
      aria-live="assertive"
      className={cn("field-error", className)}
      {...props}
    >
      <span>{message}</span>
    </div>
  );
}
