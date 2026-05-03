import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Si true, agrega 4 tornillos decorativos en las esquinas. */
  bolts?: boolean;
}

export function Card({ className, bolts, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "panel rounded-sm",
        bolts && "panel-bolts",
        className
      )}
      {...props}
    >
      {bolts ? (
        <>
          <span aria-hidden className="bolt-bl" />
          <span aria-hidden className="bolt-br" />
        </>
      ) : null}
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b border-steel-700 bg-steel-900/60 px-5 py-4",
        "top-highlight",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "font-display text-[18px] tracking-[0.04em] leading-none text-foreground",
        className
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn("industrial-label !text-[10px]", className)}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-5", className)} {...props} />;
}

export function CardFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center border-t border-steel-700 bg-steel-900/40 px-5 py-3",
        className
      )}
      {...props}
    />
  );
}
