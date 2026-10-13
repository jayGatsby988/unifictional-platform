/**
 * Provider registry + routing order. RENDER_PROVIDER (env) or a per-request
 * override picks the primary; every other configured provider is a fallback.
 */
import { isBlobConfigured } from '@/lib/storage/blob';
import { googleRenderProvider, isGoogleConfigured } from './google';
import { higgsfieldRenderProvider, higgsfieldScanProvider, isHiggsfieldConfigured } from './higgsfield';
import { isMeshyConfigured, meshyScanProvider } from './meshy';
import { isOpenAIConfigured, openaiImageModel, openaiRenderProvider, openaiVisionModel } from './openai';
import type { RenderProvider, RenderProviderId, ScanProvider, ScanProviderId } from './types';

export * from './types';
export { openaiClient, openaiVisionModel, openaiImageModel } from './openai';

export const RENDER_PROVIDERS: Record<RenderProviderId, RenderProvider> = {
  openai: openaiRenderProvider,
  google: googleRenderProvider,
  higgsfield: higgsfieldRenderProvider,
};

export const SCAN_PROVIDERS: Record<ScanProviderId, ScanProvider> = {
  meshy: meshyScanProvider,
  higgsfield: higgsfieldScanProvider,
};

export const RENDER_PROVIDER_IDS: RenderProviderId[] = ['openai', 'google', 'higgsfield'];
export const SCAN_PROVIDER_IDS: ScanProviderId[] = ['meshy', 'higgsfield'];

export function isRenderProviderId(v: unknown): v is RenderProviderId {
  return typeof v === 'string' && (RENDER_PROVIDER_IDS as string[]).includes(v);
}
export function isScanProviderId(v: unknown): v is ScanProviderId {
  return typeof v === 'string' && (SCAN_PROVIDER_IDS as string[]).includes(v);
}

export function defaultRenderProviderId(): RenderProviderId {
  const env = process.env.RENDER_PROVIDER;
  return isRenderProviderId(env) ? env : 'openai';
}

/** Configured render providers, primary first. */
export function renderProviderOrder(preferred?: RenderProviderId): RenderProvider[] {
  const primary = preferred ?? defaultRenderProviderId();
  const fallbackOrder: RenderProviderId[] = ['openai', 'google', 'higgsfield'];
  const ids = [primary, ...fallbackOrder.filter((id) => id !== primary)];
  return ids.map((id) => RENDER_PROVIDERS[id]).filter((p) => p.isConfigured());
}

/** Configured scan providers, primary first (meshy default, higgsfield if configured). */
export function scanProviderOrder(preferred?: ScanProviderId): ScanProvider[] {
  const env = process.env.SCAN_PROVIDER;
  const primary = preferred ?? (isScanProviderId(env) ? env : 'meshy');
  const ids: ScanProviderId[] = [primary, ...SCAN_PROVIDER_IDS.filter((id) => id !== primary)];
  return ids.map((id) => SCAN_PROVIDERS[id]).filter((p) => p.isConfigured());
}

export interface ProviderHealth {
  openai: boolean;
  google: boolean;
  higgsfield: boolean;
  meshy: boolean;
  blob: boolean;
}

/** Booleans only — never expose key material. */
export function providerHealth(): ProviderHealth {
  return {
    openai: isOpenAIConfigured(),
    google: isGoogleConfigured(),
    higgsfield: isHiggsfieldConfigured(),
    meshy: isMeshyConfigured(),
    blob: isBlobConfigured(),
  };
}

export function modelInfo() {
  return {
    visionModel: openaiVisionModel(),
    imageModel: openaiImageModel(),
    renderProvider: defaultRenderProviderId(),
  };
}
