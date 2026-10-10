"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { Trend as TrendType } from "./Trend";

const Trend = dynamic(() => import("./Trend").then((m) => m.Trend), {
  ssr: false,
  loading: () => <div className="w-full rounded-xl bg-paper animate-pulse" style={{ height: 220 }} />,
});

/** Same props as Trend; the ~100KB chart library downloads after the page is interactive. */
export function TrendLazy(props: ComponentProps<typeof TrendType>) {
  return <Trend {...props} />;
}
