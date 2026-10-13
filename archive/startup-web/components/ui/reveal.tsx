import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Scroll-into-view entrance for below-the-fold content.
 *
 * Pure markup + CSS: a tiny inline observer (REVEAL_SCRIPT, injected in the
 * root layout) flags elements with `data-in` as they enter the viewport, and
 * globals.css animates them in. Nothing waits for React to download and
 * hydrate, so on a slow phone or connection the content shows up as soon as
 * the HTML does — previously every section stayed invisible until the whole
 * JS bundle had loaded. No permanent `will-change` either (that kept ~30 big
 * GPU layers alive per page, a real memory cost on phones).
 *
 * Without JS, with reduced motion, or without IntersectionObserver, content is
 * simply visible. NOTE: don't use this for above-the-fold heroes — use the CSS
 * `animate-rise` class there.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div
      data-reveal=""
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as React.CSSProperties) : undefined}
      className={cn(className)}
    >
      {children}
    </div>
  );
}

/**
 * Runs first thing in <body> (with the theme script): arms the hidden state
 * before any section paints. If the observer below never starts (script error,
 * blocked), the attribute is dropped after 4s so nothing can stay invisible.
 */
export const REVEAL_ARM = `try{if('IntersectionObserver' in window&&!matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.setAttribute('data-reveal-js','');setTimeout(function(){if(!window.__rv)document.documentElement.removeAttribute('data-reveal-js')},4000)}}catch(e){}`;

/**
 * Inline, dependency-free observer for [data-reveal] elements. Runs as soon as
 * it's parsed (end of <body>), watches for elements added later by client-side
 * navigation, and removes itself from the equation entirely when motion is
 * reduced or IntersectionObserver is missing (content just shows).
 */
export const REVEAL_SCRIPT = `(function(){try{var d=document.documentElement;if(!d.hasAttribute('data-reveal-js'))return;window.__rv=1;var io=new IntersectionObserver(function(es){for(var i=0;i<es.length;i++){var e=es[i];if(e.isIntersecting){e.target.setAttribute('data-in','');io.unobserve(e.target)}}},{rootMargin:'0px 0px -8% 0px',threshold:0.05});var seen=new WeakSet();function scan(){var n=document.querySelectorAll('[data-reveal]:not([data-in])');for(var i=0;i<n.length;i++){if(!seen.has(n[i])){seen.add(n[i]);io.observe(n[i])}}}scan();var q=0;new MutationObserver(function(){if(q)return;q=requestAnimationFrame(function(){q=0;scan()})}).observe(document.body,{childList:true,subtree:true});setTimeout(function(){var n=document.querySelectorAll('[data-reveal]:not([data-in])');for(var i=0;i<n.length;i++){var r=n[i].getBoundingClientRect();if(r.top<innerHeight&&r.bottom>0)n[i].setAttribute('data-in','')}},3000)}catch(_){document.documentElement.removeAttribute('data-reveal-js')}})();`;
