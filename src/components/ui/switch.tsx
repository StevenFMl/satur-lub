"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  /** Si se especifica, renderiza un input hidden con `value` "true" / "false". */
  name?: string;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  name,
  id,
  disabled,
  ...rest
}: SwitchProps) {
  return (
    <>
      {name ? (
        <input
          type="hidden"
          name={name}
          value={checked ? "true" : "false"}
        />
      ) : null}
      <button
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-sm border-2 transition-colors duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-safety-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked
            ? "border-safety-600 bg-safety-500"
            : "border-steel-700 bg-steel-800 hover:border-steel-500"
        )}
        {...rest}
      >
        <span
          aria-hidden
          className={cn(
            "inline-block h-4 w-4 transform rounded-sm bg-steel-950 shadow-bevel-sm transition-transform duration-150",
            checked ? "translate-x-[22px]" : "translate-x-1"
          )}
        />
      </button>
    </>
  );
}
