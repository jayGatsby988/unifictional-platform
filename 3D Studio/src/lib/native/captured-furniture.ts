/** Display-only evidence channel. This is deliberately absent from material
 * catalogs, selectable finish slots and construction takeoffs: RoomPlan's
 * furniture category does not establish wood, upholstery or stone. */
export const CAPTURED_FURNITURE_SLOT = '__captured_furniture__';

export function isCapturedFurnitureRole(role: string): boolean {
  return ['table', 'chair', 'sofa', 'bed', 'other'].includes(role);
}
