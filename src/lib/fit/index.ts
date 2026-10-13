/**
 * Photo fitter — public surface.
 *
 *   fitToPhoto(spec)      adjust camera + spec until the twin lands on the photo's boxes
 *   fromEstimate / toRig  the analyzer's camera words ↔ an exact SolvedCamera ↔ a studio CameraRig
 *   kitchenElementBoxes / bathroomElementBoxes   the twin's elements as world boxes
 *   healContract          fill the per-element contract fields an older spec lacks
 */
export { fitToPhoto, measureAt, cleanElements, hintPenalty, DEFAULT_EVALUATIONS, SCALE_KINDS, SCALE_TOL, type FitOptions, type FitResult, type FitMatch, type FitEnd, type UnmatchedReason, type FitUnmatched } from './fit';
export { makeCamera, fromEstimate, toRig, toEstimate, verticalFov, horizontalFov, lookAngles, cameraBasis, roomSize, DEFAULT_ASPECT, STANDPOINT, AIM, type Pinhole, type AABB, type Box4, type Vec3, type CameraEstimate } from './camera';
export { kitchenElementBoxes, bathroomElementBoxes, tileTopOn, pendantPositions, pendantDrop, stoolPositions, projectElement, projectElementRaw, checkBoxes, type TwinElement } from './boxes';
export { healContract, legacyEndSeats, drawnEndSeats } from './contract';
export { readFrame, turnLabels, labelHypotheses, facingTurn, facingWallsSeen, wallFromFacing, saidWall, type FrameHints, type LabelHypothesis } from './frame';
export { drawnFacts, honesty, jointParams, integerScan, kitchenParams, bathroomParams, restoreFitted, tidy, CABINET_MIN_IN, FILLER_MIN_IN, type DrawnFacts, type SpecParam } from './params';
export { residual, proportionError, repairOpen, hintFor, type Residual } from './report';
