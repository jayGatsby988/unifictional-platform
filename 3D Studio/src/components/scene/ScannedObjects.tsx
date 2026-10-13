"use client";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { InstancedSurface } from "./Surface";
import type { InstanceTransform } from "./detail";
import { scannedObjectParts, scannedSinkCutouts } from "./scanned-object-parts";
import type { ScannedObjectPresentation } from "./scanned-object-layout";
import { useProjectStore } from "@/lib/store/project-store";
import type { ScannedRoomGeometry } from "@/lib/spec/types";
import { scannedObjectFeatures } from "./scanned-object-features";
import { deriveScannedIslandShell } from "./scanned-island-shell";
import { useNativeMesh } from "@/lib/native/mesh-store";
import { applyWorldUVs } from "./geometry";
import { useScanView } from "./scan-view-store";
import type { AppearancePlane } from "./ReconstructedAppearance";
import { ScanObjectDesign } from './ScanObjectDesign';
import { CAPTURED_FURNITURE_SLOT } from '@/lib/native/captured-furniture';

const BATHROOM_SLOTS: Record<string, string> = {
  cabinets_base: "vanity_cabinet",
  cabinets_upper: "vanity_cabinet",
  cabinets_tall: "vanity_cabinet",
  island_cabinets: "vanity_cabinet",
  countertop: "vanity_top",
  island_countertop: "vanity_top",
  faucet: "fixtures",
};

/** Shared parts are instanced across the room, including door frames and pulls. */
export function ScannedObjects({
  objects,
  geometry,
  roomType,
  clean = false,
}: {
  clean?: boolean;
  objects: ScannedObjectPresentation[];
  geometry: ScannedRoomGeometry;
  roomType: "kitchen" | "bathroom";
}) {
  const projectId = useProjectStore((s) => s.project.id);
  const designSpec = useProjectStore(s => s.ui.jarvisPreview?.snapshot.spec ?? s.project.spec);
  const observedMesh = useNativeMesh((s) =>
    s.projectId === projectId ? s.mesh : null,
  );
  const requestedSolids = useProjectStore(
    (s) => s.project.overrides.scanSolidPreview === true,
  );
  const simplifiedSolids = clean || requestedSolids;
  const islandStyle = useProjectStore((s) =>
    s.project.overrides.scanIslandStyle === "raised-bar"
      ? "raised-bar"
      : "standard",
  );
  const sinkUnderWindow = useProjectStore(
    (s) => s.project.overrides.scanSinkUnderWindow === true,
  );
  const microwaveOverRange = useProjectStore(
    (s) => s.project.overrides.scanMicrowaveOverRange === true,
  );
  const features = useMemo(
    () =>
      scannedObjectFeatures(
        objects,
        geometry,
        clean ? {} : { sinkUnderWindow, microwaveOverRange },
      ),
    [objects, geometry, clean, sinkUnderWindow, microwaveOverRange],
  );
  const batches = useMemo(() => {
    type Part = ReturnType<typeof scannedObjectParts>[number] & {
      appearancePlane?: AppearancePlane;
    };
    const groups = new Map<
      string,
      { part: Part; appearanceId: string; transforms: InstanceTransform[] }
    >();
    const cutouts = simplifiedSolids
      ? scannedSinkCutouts(features.objects)
      : new Map();
    const p = new THREE.Vector3(),
      q = new THREE.Quaternion(),
      s = new THREE.Vector3(),
      e = new THREE.Euler();
    const local = new THREE.Matrix4();
    for (const object of features.objects) {
      const frame = new THREE.Matrix4().fromArray(object.transform);
      const shell =
        clean &&
        roomType === "kitchen" &&
        observedMesh &&
        object.role === "island"
          ? deriveScannedIslandShell(
              observedMesh,
              object,
              features.objects,
              geometry.surfaces.filter((surface) => surface.kind === "floor"),
            )
          : null;
      const parts: Part[] = shell
        ? shell.panels.map((panel) => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute(
              "position",
              new THREE.BufferAttribute(panel.positions, 3),
            );
            geometry.computeVertexNormals();
            applyWorldUVs(geometry);
            geometry.userData = {
              disposableScanGeometry: true,
              supportedIslandShell: true,
              inferredFillArea: panel.inferredFillArea,
              observedArea: panel.observedArea,
              maximumPlaneFitMeters: shell.maximumPlaneFitMeters,
              inferredWorkingCap: shell.inferredWorkingCap === true,
              partialRaisedCountertop: shell.inferredWorkingCap === true && shell.panels.some(p => p.kind === "countertop" && p.origin[1] > Math.min(...shell.panels.filter(p => p.kind === "countertop").map(p => p.origin[1])) + 0.08),
            };
            return {
              geometry,
              slot: panel.slot,
              name: panel.id,
              inference: "supported-mesh-shell",
              appearancePlane: {
                objectId: object.id,
                slot: panel.slot,
                origin: panel.origin,
                u: panel.unitU,
                v: panel.unitV,
                spanMeters: [panel.widthMeters, panel.heightMeters],
                maxPlaneDistance: 0.025,
                sourceTriangleIndices: panel.sourceTriangleIndices,
              },
            };
          })
        : scannedObjectParts(object, {
            simplifiedSolids,
            roomType,
            detectedSinkCutouts: cutouts.get(object.id),
            islandStyle: clean ? undefined : islandStyle,
            sinkInsert: features.sinkObjectId === object.id,
            sinkCenterX: features.sinkCenterX ?? undefined,
            ...(features.microwave?.objectId === object.id
              ? { microwaveInsert: features.microwave }
              : {}),
          });
      for (const sourcePart of parts) {
        const part =
          roomType === "bathroom"
            ? {
                ...sourcePart,
                slot: BATHROOM_SLOTS[sourcePart.slot] ?? sourcePart.slot,
              }
            : sourcePart;
        const key = `${object.id}/${part.geometry.uuid}/${part.slot}/${part.util ?? ""}`;
        let batch = groups.get(key);
        if (!batch) {
          batch = { part, appearanceId: object.id, transforms: [] };
          groups.set(key, batch);
        }
        p.fromArray(part.position ?? [0, 0, 0]);
        e.set(...(part.rotation ?? [0, 0, 0]));
        q.setFromEuler(e);
        local
          .compose(p, q, s.set(1, 1, 1))
          .premultiply(frame)
          .decompose(p, q, s);
        e.setFromQuaternion(q);
        batch.transforms.push({
          position: p.toArray(),
          rotation: [e.x, e.y, e.z],
          scale: s.toArray(),
        });
      }
    }
    return [...groups.entries()];
  }, [
    features,
    islandStyle,
    roomType,
    simplifiedSolids,
    clean,
    observedMesh,
    geometry.surfaces,
  ]);
  useEffect(
    () => () => {
      const geometries = new Set(
        batches
          .map(([, batch]) => batch.part.geometry)
          .filter(
            (geometry) =>
              geometry.userData.measuredCountertop ||
              geometry.userData.disposableScanGeometry,
          ),
      );
      geometries.forEach((geometry) => geometry.dispose());
    },
    [batches],
  );
  useEffect(() => {
    const partial = batches.some(([, batch]) => batch.part.geometry.userData.partialRaisedCountertop);
    useScanView.setState({ partialRaisedCountertopProjectId: partial ? projectId : null });
    return () => {
      if (useScanView.getState().partialRaisedCountertopProjectId === projectId) useScanView.setState({ partialRaisedCountertopProjectId: null });
    };
  }, [batches, projectId]);
  const byObject = useMemo(() => {
    const groups = new Map<string, typeof batches>();
    for (const entry of batches) { const id = entry[1].appearanceId; const group = groups.get(id) ?? []; group.push(entry); groups.set(id, group); }
    return [...groups];
  }, [batches]);
  return (
    <group
      name="reconstructed-scan-fixtures"
      userData={{
        representation: "inferred-from-captured-bounds",
        inferences: [
          ...new Set(
            batches.map(([, batch]) => batch.part.inference).filter(Boolean),
          ),
        ],
      }}
    >
      {byObject.map(([objectId, entries]) => <ScanObjectDesign key={objectId} objectId={objectId} spec={clean && designSpec && (designSpec.roomType === 'kitchen' || designSpec.roomType === 'bathroom') ? designSpec : null}>
      {entries.map(([key, { part, transforms, appearanceId }]) => (
        <InstancedSurface
          key={key}
          name={`scan-model-${part.name}`}
          slot={part.slot}
          appearanceId={appearanceId}
          appearancePlane={part.appearancePlane}
          util={part.util}
          inert={!!part.util || part.slot === CAPTURED_FURNITURE_SLOT}
          geometry={part.geometry}
          transforms={transforms}
        />
      ))}</ScanObjectDesign>)}
    </group>
  );
}
