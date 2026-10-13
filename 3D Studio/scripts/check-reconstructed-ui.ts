import assert from 'node:assert/strict';
import fs from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { importNativeScan } from '../src/lib/native/scan-import';
import { scanFinishPresentation } from '../src/components/studio/projectUtils';
import { recordScanFinishChoices } from '../src/lib/native/scan-finishes';
import { MaterialPicker } from '../src/components/studio/MaterialPicker';
import { SlotList } from '../src/components/studio/SlotRail';
import { useProjectStore } from '../src/lib/store/project-store';
import { useScanView } from '../src/components/scene/scan-view-store';
import { getMaterial } from '../src/lib/materials/catalog';

Object.assign(globalThis, { React });
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/native-countertop-contours.sample.json', import.meta.url), 'utf8'));
const fresh = () => importNativeScan(structuredClone(fixture)).project;
const store = useProjectStore.getInitialState(), view = useScanView.getInitialState();
const previous = { project: store.project, ui: store.ui, mode: view.mode };
let passed = 0;
function check(name: string, body: () => void) { body(); console.log(`PASS ${name}`); passed++; }
try {
  check('unchosen reconstructed finishes do not expose dormant catalog names or photo claims', () => {
    const project = fresh(); store.project = project; store.ui = { ...store.ui, selectedSlot: 'island_countertop' }; view.mode = 'model';
    const before = JSON.stringify(project), currentName = getMaterial(project.selections.island_countertop)!.name;
    const html = renderToStaticMarkup(createElement(MaterialPicker));
    assert.match(html, /data-testid="material-current-finish">Estimated from scan/);
    assert.ok(!html.includes(`data-testid="material-current-finish">${currentName}`));
    assert.ok(!html.includes('aria-pressed="true"'));
    assert.ok(!html.includes('recorded appearance') && !html.includes('Detected in your photo'));
    assert.equal(JSON.stringify(project), before);
    assert.equal(scanFinishPresentation(project, 'island_countertop').kind, 'estimated');
  });
  check('an explicit material choice is identified as the current model finish', () => {
    const project = fresh(), next = { ...project.selections, island_countertop: 'ct-soapstone' };
    project.overrides = recordScanFinishChoices(project, next, ['island_countertop']); project.selections = next;
    store.project = project; view.mode = 'model';
    assert.equal(scanFinishPresentation(project, 'island_countertop').name, getMaterial('ct-soapstone')!.name);
    const html = renderToStaticMarkup(createElement(MaterialPicker));
    assert.match(html, /aria-pressed="true"/); assert.match(html, />Current</);
    assert.equal(scanFinishPresentation(project, 'cabinets_base').kind, 'estimated');
  });
  check('Source material panel is read-only and never shows choice or reset actions', () => {
    view.mode = 'source'; const before = JSON.stringify(store.project);
    const html = renderToStaticMarkup(createElement(MaterialPicker));
    assert.match(html, /Original scan is read-only/); assert.match(html, /Edit 3D model/);
    assert.ok(!html.includes('Search materials') && !html.includes('Clear choices') && !html.includes('aria-pressed='));
    assert.equal(JSON.stringify(store.project), before);
    assert.equal(scanFinishPresentation(store.project, 'island_countertop', 'source').name, 'Original scan appearance');
  });
  check('Source rail disables surface editing while preserving visible slot labels', () => {
    const html = renderToStaticMarkup(createElement(SlotList, { variant: 'cards' }));
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    assert.ok(buttons.length > 0 && buttons.every(button => button.includes('disabled=""')));
    assert.match(html, /Original scan appearance/);
  });
  check('view switching is transient and preserves all scan, selection and estimate state', () => {
    const before = JSON.stringify(store.project);
    useScanView.getState().setMode('source'); useScanView.getState().setMode('model');
    assert.equal(JSON.stringify(store.project), before);
    view.mode = 'model'; store.ui = { ...store.ui, selectedSlot: null };
    const html = renderToStaticMarkup(createElement(MaterialPicker));
    assert.match(html, /Clear choices/); assert.match(html, /Estimated from scan/);
  });
} finally { store.project = previous.project; store.ui = previous.ui; view.mode = previous.mode; }
console.log(`${passed} reconstructed Studio UI checks passed.`);
