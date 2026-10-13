import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultKitchen } from '../src/lib/spec/defaults';
import type { RenderJob } from '../src/lib/spec/types';
import { DEFAULT_ESTIMATE_SETTINGS } from '../src/lib/store/project-store';
import { calculateEstimate } from '../src/lib/estimate/estimator';
import { designFingerprint, type DesignOption } from '../src/lib/jarvis/types';
import { assertSnapshotFresh } from '../src/lib/jarvis/project';
import { JarvisOptionCard, jarvisOptionBlocked, jarvisArtifactUrl, jarvisGeometrySummary } from '../src/components/studio/JarvisOptionCard';
import { JarvisMessageText, jarvisMarkdownUrl } from '../src/components/studio/JarvisMessageText';

// Render the production option card. Costs come from the real estimator, and
// a thumbnail is eligible only if it belongs to this exact saved design.
const spec = defaultKitchen(), selections = { ...spec.materials };
const snapshot = { spec, selections, estimateSettings: DEFAULT_ESTIMATE_SETTINGS, baseline: null };
const estimate = calculateEstimate(spec, selections, DEFAULT_ESTIMATE_SETTINGS, null);
const option: DesignOption = {
  id: 'option-real', name: 'Test design', description: 'Observed material choice', createdAt: '2026-09-10T00:00:00Z',
  snapshot, estimate, validation: { valid: true, issues: [] }, budget: { max: estimate.totalHigh, status: 'within', headroom: 0 },
};
let count = 0;
const check = (condition: unknown, message: string) => { count++; assert.ok(condition, message); };
check(!jarvisOptionBlocked(option), 'a valid option at the high budget boundary remains applicable');
check(jarvisOptionBlocked({ ...option, budget: { ...option.budget, max: estimate.mid } }), 'midpoint affordability cannot pass a hard budget');
check(jarvisOptionBlocked({ ...option, validation: { valid: false, issues: [] } }), 'invalid geometry blocks Apply');
check(jarvisOptionBlocked({ ...option, validation: { valid: true, issues: [{ severity: 'error', code: 'collision', message: 'Fixture collision' }] } }), 'a concrete validation error blocks even a stale valid flag');
check(jarvisOptionBlocked({ ...option, estimate: { ...estimate, totalHigh: NaN } }), 'nonfinite estimate cannot be applied');
check(jarvisOptionBlocked({ ...option, budget: { ...option.budget, status: 'over' } }), 'server over-budget status remains binding');
for (const url of ['javascript:alert(1)', 'data:text/html,test', '//evil.invalid', 'file:///etc/passwd']) check(jarvisArtifactUrl(url) === null, `unsafe artifact link excluded: ${url}`);
check(jarvisArtifactUrl('/proposal/real') === '/proposal/real', 'local proposal links work');
check(jarvisArtifactUrl('https://example.com/render.png') === 'https://example.com/render.png', 'real HTTPS artifact links work');
check(jarvisGeometrySummary(spec, structuredClone(spec)).length === 0, 'unchanged geometry has no invented changes');
const changed = structuredClone(spec); changed.island.lengthFt = 8;
check(jarvisGeometrySummary(spec, changed).some((s) => s.includes('Island: 8')), 'geometry summary reports the actual 8 ft option');
const old: RenderJob = {
  id: 'old', provider: 'openai', optionId: option.id, designFingerprint: 'stale', status: 'completed',
  resultUrl: 'https://example.com/stale.png', createdAt: option.createdAt, selections,
  sourceUrl: 'https://example.com/capture.png', sourceKind: 'viewport', prompt: 'Saved design render',
};
const latest: RenderJob = { ...old, id: 'new', designFingerprint: designFingerprint(snapshot), resultUrl: 'https://example.com/current.png' };
const props = { option, index: 0, active: false, compared: true, busy: false, currentSpec: spec, currentSelections: selections, renders: [latest, old], onCompare() {}, onApply() {}, onRender() {}, onRemove() {} };
const html = renderToStaticMarkup(createElement(JarvisOptionCard, props));
check(html.includes('https://example.com/current.png') && !html.includes('https://example.com/stale.png'), 'thumbnail shows only the exact actual option render');
check(html.includes('Apply to 3D') && html.includes('Render again'), 'real apply/render action controls are present');
check(html.includes('Compare') && html.includes('Estimated full remodel'), 'comparison and estimate mode are identified');
const blocked = renderToStaticMarkup(createElement(JarvisOptionCard, { ...props, option: { ...option, budget: { ...option.budget, max: 1 } }, renders: [] }));
check(/disabled=""[^>]*>Apply to 3D/.test(blocked), 'actual Apply button disables an over-budget design');
check(blocked.includes('validation or budget issues'), 'blocked action has an explanation');
check(html.includes('aria-label="Remove saved option Test design"'), 'saved option removal has an explicit accessible name');
const busy = renderToStaticMarkup(createElement(JarvisOptionCard, { ...props, busy: true }));
check(/disabled=""[^>]*aria-label="Remove saved option Test design"/.test(busy), 'option removal is disabled during in-flight work');
const measured = structuredClone(snapshot); measured.spec.detected.measurements = { widthFt: 16, depthFt: 14, ceilingFt: 9, confirmedAt: '2026-09-10T12:00:00Z' };
let staleReason = '';
try { assertSnapshotFresh(measured, option.snapshot); } catch (cause) { staleReason = cause instanceof Error ? cause.message : ''; }
check(staleReason.includes('confirmed measurements'), 'freshness policy explains the actual measurement change');
const stale = renderToStaticMarkup(createElement(JarvisOptionCard, { ...props, staleReason }));
check(stale.includes(staleReason), 'outdated option shows the specific policy explanation');
check(/disabled=""[^>]*>Apply to 3D/.test(stale), 'outdated option cannot replace current geometry');
check(/disabled=""[^>]*><svg[^]*?Render again/.test(stale), 'outdated option cannot start a new render');
check(/type="checkbox"[^>]*disabled=""[^>]*aria-label="Compare Test design"/.test(stale), 'outdated option cannot be selected for a proposal');
check(!/disabled=""[^>]*aria-label="Remove saved option Test design"/.test(stale), 'outdated option can still be retired');
const markdown = [
  '**Design comparison**', '', '| Option | Low | High |', '| --- | ---: | ---: |',
  `| White oak | ${estimate.totalLow} | ${estimate.totalHigh} |`, '', '- Retain appliances', '- Verify dimensions',
].join('\n');
const formatted = renderToStaticMarkup(createElement(JarvisMessageText, { role: 'assistant', text: markdown }));
check(/<strong[^>]*>Design comparison<\/strong>/.test(formatted), 'assistant bold is semantic formatting rather than literal asterisks');
check(formatted.includes('<table') && formatted.includes('<thead') && formatted.includes('<td'), 'GFM comparison tables render semantic cells and headers');
check(formatted.includes(String(estimate.totalHigh)) && formatted.includes('text-align:right'), 'tables preserve exact estimate values and numeric alignment');
check(formatted.includes('overflow-x-auto') && formatted.includes('tabindex="0"') && formatted.includes('aria-label="Jarvis comparison table"'), 'wide tables have a named keyboard-accessible horizontal scroll container');
check(formatted.includes('<ul') && formatted.includes('<li'), 'assistant lists remain structured and readable');
const plain = renderToStaticMarkup(createElement(JarvisMessageText, { role: 'user', text: markdown }));
check(plain.includes('**Design comparison**') && !plain.includes('<strong') && !plain.includes('<table'), 'user messages remain plain text even when they contain Markdown');
for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,test', 'file:///etc/passwd', '//evil.invalid', '/\\evil.invalid', 'java\nscript:alert(1)']) check(jarvisMarkdownUrl(url) === '', `Markdown rejects unsafe URL: ${JSON.stringify(url)}`);
const links = renderToStaticMarkup(createElement(JarvisMessageText, { role: 'assistant', text: '[Proposal](/proposal/real) [Source](https://example.com/design) [unsafe](javascript:alert(1)) [encoded](javascript&#x3a;alert(1))' }));
check(links.includes('href="/proposal/real"') && links.includes('href="https://example.com/design"'), 'valid artifact and source links are navigable');
check(links.includes('target="_blank" rel="noopener noreferrer"'), 'external links open with opener protection');
check(!links.includes('href="javascript:') && !links.includes('href=""') && links.includes('unsafe') && links.includes('encoded'), 'unsafe Markdown links become readable text without executable or empty links');
const injection = renderToStaticMarkup(createElement(JarvisMessageText, { role: 'assistant', text: '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n<iframe src="https://evil.invalid"></iframe>\n\n![Unverified picture](https://evil.invalid/pixel.png)' }));
check(!/<(?:script|img|iframe)\b/i.test(injection) && !injection.includes('onerror='), 'raw HTML cannot inject executable elements or event handlers');
check(injection.includes('Unverified picture') && !injection.includes('pixel.png'), 'Markdown images remain descriptive text without loading unverified resources');
console.log(`PASS ${count} Jarvis UI budget, validation, artifact, summary and rendered-control checks`);
