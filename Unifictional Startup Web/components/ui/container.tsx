import * as React from "react";
import { cn } from "@/lib/utils";

/** Editorial page gutter. Wide, generous margins. */
export function Container({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[1400px] px-6 sm:px-8 lg:px-12", className)}>
      {children}
    </div>
  );
}
