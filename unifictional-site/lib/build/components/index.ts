// Registry of every renderable component. Add a file, import it here.
import type { Component } from "./_types";
import menu8 from "./menu-8";
import scroll41 from "./scroll-41";
import heroType from "./hero-type";
import scroll61 from "./scroll-61";
import scroll47 from "./scroll-47";
import scroll19 from "./scroll-19";
import scroll15 from "./scroll-15";
import { generic } from "./generic";
import { ported } from "./_ported";
import { studio } from "./studio";

export const COMPONENTS: Component[] = [
  menu8, scroll41, heroType, scroll61, scroll47, scroll19, scroll15, ...generic, ...studio, ...ported,
];

export const byType: Record<string, Component> = Object.fromEntries(COMPONENTS.map((c) => [c.type, c]));
export const byId: Record<string, Component> = Object.fromEntries(COMPONENTS.map((c) => [c.id, c]));
export const HEROES = COMPONENTS.filter((c) => c.kind === "hero");
export const MENUS = COMPONENTS.filter((c) => c.kind === "menu");
export const SECTIONS = COMPONENTS.filter((c) => c.kind === "section");
export type { Component, Ctx } from "./_types";
