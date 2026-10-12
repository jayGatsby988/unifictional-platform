'use client'

/**
 * @author: @emerald-ui (adapted for Tailwind v3)
 * @description: A 3D marquee component that rotates images in a 3D space.
 * The original ships Tailwind v4 class syntax (h-140, scale-135, transform-3d,
 * aspect-4/3); this project is on Tailwind v3, so those are written as v3
 * arbitrary values / inline transform-style here so the tilt + sizing render.
 */
import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

import { canRunLiveEmbeds } from '@/lib/perf'

function cn(...inputs: unknown[]) {
  return twMerge(clsx(inputs))
}

export interface MarqueeItem {
  /** Client name — used for meaningful alt text. */
  name?: string
  /** Live site URL — embedded as an iframe on desktop only. */
  url?: string
  /** Static screenshot — used on mobile/tablet (and as the live fallback). */
  image: string
}

/** Live tiles are off (2026-10-10): two full third-party sites in iframes
 *  inside a tilted, masked, preserve-3d layer kept Chrome's compositor so
 *  busy that hovering elsewhere on the page left white, un-painted tiles.
 *  The screenshots are the whole marquee now; `url` stays in the data for
 *  the links elsewhere. */
const LIVE_COUNT = 0
const LIVE_ROTATE_MS = 9000

interface ThreeDMarqueeProps {
  items?: MarqueeItem[]
  className?: string
}

const defaultItems: MarqueeItem[] = [
  { image: '/showcase/blue-lake-construction.webp' },
  { image: '/showcase/cascade-pool-works.webp' },
  { image: '/showcase/enf-siding.webp' },
  { image: '/showcase/go-far-construction-v2.webp' },
  { image: '/showcase/diggs-builders.webp' },
  { image: '/showcase/tremor-excavation.webp' },
]

const ThreeDMarquee = ({ items = defaultItems, className }: ThreeDMarqueeProps) => {
  // Live iframes only on capable desktops, and only once the page has fully
  // loaded and gone idle — they never compete with the page's own loading.
  const liveOk = LIVE_COUNT > 0 && canRunLiveEmbeds()

  // Only load live sites while the marquee is actually on screen…
  const rootRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), {
      rootMargin: '200px',
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // …and only LIVE_COUNT at a time, rotating so every site gets its moment
  // without ever loading 8 full third-party websites at once.
  const liveable = items.map((it, i) => (it.url ? i : -1)).filter((i) => i >= 0)
  const [liveStart, setLiveStart] = useState(0)
  useEffect(() => {
    if (!liveOk || !inView || liveable.length <= LIVE_COUNT) return
    const t = setInterval(
      () => setLiveStart((s) => (s + LIVE_COUNT) % liveable.length),
      LIVE_ROTATE_MS
    )
    return () => clearInterval(t)
  }, [liveOk, inView, liveable.length])

  const liveNow = new Set<number>()
  if (liveOk && inView) {
    for (let k = 0; k < Math.min(LIVE_COUNT, liveable.length); k++) {
      liveNow.add(liveable[(liveStart + k) % liveable.length])
    }
  }

  const chunkSize = Math.ceil(items.length / 3)
  const chunks = Array.from({ length: 3 }, (_, colIndex) => {
    const start = colIndex * chunkSize
    return items.slice(start, start + chunkSize)
  })

  return (
    <div
      ref={rootRef}
      data-paused={inView ? undefined : ''}
      className={cn(
        'mx-auto block h-[35rem] w-full overflow-hidden rounded-md [contain:paint] max-xl:h-[30rem] max-sm:h-[25rem]',
        className
      )}
      // Feather all four edges so the tilted grid dissolves into the page
      // instead of being sliced off by a hard top/right edge.
      style={{
        maskImage:
          'linear-gradient(to bottom, transparent 0, #000 14%, #000 84%, transparent 100%), linear-gradient(to right, transparent 0, #000 8%, #000 90%, transparent 100%)',
        WebkitMaskImage:
          'linear-gradient(to bottom, transparent 0, #000 14%, #000 84%, transparent 100%), linear-gradient(to right, transparent 0, #000 8%, #000 90%, transparent 100%)',
        maskComposite: 'intersect',
        WebkitMaskComposite: 'source-in',
      }}
    >
      <div className='flex size-full items-center justify-center'>
        <div className='aspect-square size-[45rem] shrink-0 scale-[1.35] max-xl:size-full max-xl:scale-110 max-sm:scale-[1.3]'>
          <div
            style={{
              transform: 'rotateX(45deg) rotateY(0deg) rotateZ(45deg)',
              transformStyle: 'preserve-3d',
            }}
            className='relative right-[-55%] top-0 grid size-full origin-top-left grid-cols-3 gap-5 max-xl:-top-[7.5rem] max-xl:right-[-45%] max-sm:top-0 max-sm:gap-2'
          >
            {chunks.map((subarray, colIndex) => (
              // Slow up/down drift per column — native CSS keyframes
              // (globals.css), paused while the marquee is off screen.
              <figure
                key={colIndex + 'marquee'}
                className='marquee-col flex flex-col items-start gap-6 max-sm:gap-3'
                style={{
                  animation: `${colIndex % 2 === 0 ? 'marquee-drift-down' : 'marquee-drift-up'} ${
                    colIndex % 2 === 0 ? 10 : 15
                  }s ease-in-out infinite alternate`,
                }}
              >
                {subarray.map((item, imageIndex) => {
                  const flatIndex = colIndex * chunkSize + imageIndex
                  const isLive = liveNow.has(flatIndex) && !!item.url
                  return (
                    <div
                      className='relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-neutral-200 shadow-[0_18px_40px_-18px_rgba(26,23,20,0.5)] ring-1 ring-black/5'
                      key={imageIndex + item.image}
                    >
                      {/* Screenshot is always the base layer — live embeds fade
                          in over it, so rotating them never flashes empty. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className='absolute inset-0 h-full w-full select-none object-cover'
                        src={item.image}
                        loading='lazy'
                        decoding='async'
                        draggable={false}
                        alt={item.name ? `${item.name} — website by Unifictional` : `Client website preview ${flatIndex + 1}`}
                      />
                      {isLive && (
                        // Live, scaled-down desktop preview of the real site (videos autoplay).
                        // pointer-events-none keeps it display-only so it never traps scroll.
                        <iframe
                          src={item.url}
                          title={item.name ? `${item.name} — live preview` : `Live website preview ${flatIndex + 1}`}
                          loading='lazy'
                          tabIndex={-1}
                          aria-hidden
                          scrolling='no'
                          allow='autoplay; fullscreen; encrypted-media'
                          onLoad={(e) => {
                            e.currentTarget.style.opacity = '1'
                          }}
                          className='pointer-events-none absolute left-0 top-0 origin-top-left opacity-0 transition-opacity duration-700'
                          style={{
                            width: '600%',
                            height: '600%',
                            transform: 'scale(0.16667)',
                            border: 0,
                          }}
                        />
                      )}
                    </div>
                  )
                })}
              </figure>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default ThreeDMarquee
