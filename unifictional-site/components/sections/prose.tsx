import * as React from "react";

import type { GuideBlock } from "@/lib/guides";

/**
 * Renders a guide's structured blocks as editorial long-form copy.
 *
 * Headings carry generated ids so the table of contents can link to them and
 * so AI assistants and search engines get stable anchor targets for passage
 * ranking. Measure is capped for readability; tables are allowed to break out
 * of it and scroll horizontally on small screens.
 */

export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function Prose({ blocks }: { blocks: GuideBlock[] }) {
  return (
    <div className="space-y-6">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "h2":
            return (
              <h2
                key={i}
                id={slugifyHeading(block.text)}
                className="scroll-mt-28 pt-8 font-display text-3xl font-medium leading-tight text-ink sm:text-4xl"
              >
                {block.text}
              </h2>
            );

          case "h3":
            return (
              <h3
                key={i}
                id={slugifyHeading(block.text)}
                className="scroll-mt-28 pt-4 font-display text-xl font-medium leading-snug text-ink sm:text-2xl"
              >
                {block.text}
              </h3>
            );

          case "p":
            return (
              <p key={i} className="max-w-[68ch] text-lg leading-relaxed text-ink-soft">
                {block.text}
              </p>
            );

          case "ul":
            return (
              <ul key={i} className="max-w-[68ch] space-y-3 border-t border-line pt-5">
                {block.items.map((item) => (
                  <li key={item} className="flex items-start gap-4">
                    <span
                      aria-hidden
                      className="mt-[0.7rem] h-1.5 w-1.5 shrink-0 rounded-full bg-terracotta"
                    />
                    <span className="text-base leading-relaxed text-ink-soft">{item}</span>
                  </li>
                ))}
              </ul>
            );

          case "ol":
            return (
              <ol key={i} className="max-w-[68ch] border-t border-line">
                {block.items.map((item, n) => (
                  <li key={item} className="flex items-start gap-5 border-b border-line py-4">
                    <span className="mt-1 font-mono text-xs text-terracotta">
                      {String(n + 1).padStart(2, "0")}
                    </span>
                    <span className="text-base leading-relaxed text-ink-soft">{item}</span>
                  </li>
                ))}
              </ol>
            );

          case "table":
            return (
              <React.Fragment key={i}>
                {/* Phones: one card per row. A 4-column table in a 342px
                    column either clips its last column or needs a sideways
                    scroll nobody discovers. (display:none hides this from
                    screen readers at sm+, and the table from them below.) */}
                <div className="border-t border-line sm:hidden">
                  {block.rows.map((row, r) => (
                    <div key={r} className="border-b border-line py-5">
                      <p className="font-display text-lg font-medium leading-snug text-ink">
                        {row[0]}
                      </p>
                      <dl className="mt-3 space-y-3">
                        {row.slice(1).map((cell, c) => (
                          <div key={c}>
                            <dt className="font-mono text-[11px] uppercase leading-4 tracking-label text-ink-muted">
                              {block.head[c + 1]}
                            </dt>
                            <dd className="mt-1 text-base leading-relaxed text-ink-soft">{cell}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-y border-line">
                      {block.head.map((h) => (
                        <th
                          key={h}
                          scope="col"
                          className="py-3 pr-6 font-mono text-[11px] uppercase tracking-label text-ink-muted"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className="border-b border-line align-top">
                        {row.map((cell, c) => (
                          <td
                            key={c}
                            className={
                              c === 0
                                ? "py-4 pr-6 font-medium leading-relaxed text-ink"
                                : "py-4 pr-6 leading-relaxed text-ink-soft"
                            }
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </React.Fragment>
            );

          case "callout":
            return (
              <aside
                key={i}
                className="max-w-[68ch] border-l-2 border-terracotta bg-sand/50 px-6 py-5"
              >
                <p className="font-mono text-[11px] uppercase tracking-label text-terracotta">
                  {block.title}
                </p>
                <p className="mt-3 text-base leading-relaxed text-ink-soft">{block.text}</p>
              </aside>
            );
        }
      })}
    </div>
  );
}
