'use client';
/**
 * Reads /api/health to learn which render / scan providers are configured.
 *
 * Expected response (parsed defensively — several shapes are accepted):
 *   { ok: true, providers: { render: ['openai','google'], scan: ['meshy'] } }
 */
import { useEffect, useState } from 'react';
import type { RenderJob, ScanJob } from '@/lib/spec/types';

export type RenderProvider = RenderJob['provider'];
export type ScanProvider = ScanJob['provider'];

export interface Health {
  loading: boolean;
  ok: boolean;
  error: string | null;
  renderProviders: RenderProvider[];
  scanProviders: ScanProvider[];
  /** raw payload for debugging */
  raw: unknown;
}

const RENDER_PROVIDERS: RenderProvider[] = ['openai', 'google', 'higgsfield'];
const SCAN_PROVIDERS: ScanProvider[] = ['higgsfield', 'meshy'];

function pickList<T extends string>(candidates: unknown[], allowed: T[]): T[] {
  for (const c of candidates) {
    if (Array.isArray(c)) {
      const list = c.filter((x): x is T => typeof x === 'string' && (allowed as string[]).includes(x));
      if (list.length) return list;
    } else if (c && typeof c === 'object') {
      const obj = c as Record<string, unknown>;
      const list = allowed.filter((k) => {
        const v = obj[k];
        if (typeof v === 'boolean') return v;
        if (v && typeof v === 'object') {
          const o = v as Record<string, unknown>;
          return o.configured === true || o.enabled === true || o.ok === true || o.available === true;
        }
        return false;
      });
      if (list.length) return list;
    }
  }
  return [];
}

export function parseHealth(raw: unknown): { ok: boolean; renderProviders: RenderProvider[]; scanProviders: ScanProvider[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const providers = (r.providers && typeof r.providers === 'object' ? r.providers : {}) as Record<string, unknown>;
  const renderProviders = pickList<RenderProvider>(
    [providers.render, providers.renders, providers.image, r.render, r.renders, r.renderProviders, r.imageProviders, providers],
    RENDER_PROVIDERS,
  );
  const scanProviders = pickList<ScanProvider>(
    [providers.scan, providers.scans, providers.scan3d, r.scan, r.scans, r.scanProviders, providers],
    SCAN_PROVIDERS,
  );
  const ok = typeof r.ok === 'boolean' ? r.ok : true;
  return { ok, renderProviders, scanProviders };
}

let cached: Promise<unknown> | null = null;

export function useHealth(): Health {
  const [state, setState] = useState<Health>({ loading: true, ok: true, error: null, renderProviders: [], scanProviders: [], raw: null });
  useEffect(() => {
    let alive = true;
    if (!cached) {
      cached = fetch('/api/health', { cache: 'no-store' })
        .then(async (res) => {
          if (!res.ok) throw new Error(`Health check failed (${res.status})`);
          return res.json();
        })
        .catch((err) => { cached = null; throw err; });
    }
    cached.then((raw) => {
      if (!alive) return;
      const parsed = parseHealth(raw);
      setState({ loading: false, error: null, raw, ...parsed });
    }).catch((err: unknown) => {
      if (!alive) return;
      // Assume the default provider is present so the UI stays usable when /api/health is missing.
      setState({ loading: false, ok: true, error: err instanceof Error ? err.message : 'Health check unavailable', renderProviders: ['openai'], scanProviders: [], raw: null });
    });
    return () => { alive = false; };
  }, []);
  return state;
}

export const PROVIDER_LABEL: Record<RenderProvider | ScanProvider, string> = {
  openai: 'OpenAI gpt-image',
  google: 'Google Nano Banana Pro',
  higgsfield: 'Higgsfield',
  meshy: 'Meshy',
};
