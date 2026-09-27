import { Inject, Injectable } from "@nestjs/common";
import type { ValidationMessage } from "@lintel/types";
import type { RequestScope } from "../../common/auth/context.js";
import { UnitOfWork } from "../../common/db/unit-of-work.js";
import { API_CONFIG, ENGINE_MANIFEST } from "../../common/tokens.js";
import type { ApiConfig } from "../../config.js";
import type { EngineManifest } from "../../infrastructure/engines/engine-manifest.js";
import { engineProvenance } from "../../infrastructure/engines/engine-manifest.js";
import { engineeringModel, resolveEngineeringModel } from "../outputs/engines/validation.js";
import { readEngineeringInputs } from "../outputs/output-context.js";
import type { ModelMessage, ModelObject, ModelPreviewResponse } from "./model-preview.schemas.js";

function message(m: ValidationMessage): ModelMessage {
  return { code: m.code, severity: m.severity, message: m.message, lineageId: m.sourceObjectId ?? null, componentId: m.componentId ?? null, ruleId: m.ruleId ?? null, path: m.path ?? null };
}

/**
 * The resolved-model preview (M6 G3). It reads the exact stored inputs of ONE design version with the same reader as
 * output generation (readEngineeringInputs: the version's exact pins, never "latest") and resolves them with the same
 * validation-engine entry (engineeringModel + resolveEngineeringModel) that BOM, BOQ and drawings are generated from.
 * The API only projects the engine's result; it computes no geometry or rule of its own, and persists nothing.
 */
@Injectable()
export class ModelPreviewService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(ENGINE_MANIFEST) private readonly manifest: EngineManifest,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  preview(scope: RequestScope, versionId: string): Promise<ModelPreviewResponse> {
    return this.uow.run(scope, { readOnly: true, isolation: "REPEATABLE READ" }, async (tx) => {
      const { v, inputHash, pins, rows } = await readEngineeringInputs(tx, versionId);
      const resolved = resolveEngineeringModel(engineeringModel(rows));
      const engine = engineProvenance(this.manifest, "validation", this.config.buildRevision);
      // The engine identifies objects by lineage id (designObjectFromRow); rows are this version's objects.
      const byLineage = new Map(rows.objects.map((o) => [o.lineage_id, o]));
      const placements = new Map(resolved.placements.map((p) => [p.objectId, p]));
      const messages = resolved.validation.messages.map(message);

      const objects: ModelObject[] = resolved.cabinets.map((c) => {
        const row = byLineage.get(c.object.objectId);
        if (row === undefined) throw new Error(`resolved object ${c.object.objectId} is not an input of this version`);
        const p = placements.get(c.object.objectId);
        const boxes = new Map((p?.components ?? []).map((x) => [x.componentId, x.box]));
        return {
          objectId: row.id, lineageId: row.lineage_id, objectCode: c.object.objectCode, objectType: c.object.objectType,
          productCode: row.product_code, productVersionId: row.product_version_id,
          parameters: { ...c.parameters.values }, parameterSources: { ...c.parameters.provenance },
          dimensions: { ...c.object.dimensions },
          transform: { x: c.object.transform.x, y: c.object.transform.y, z: c.object.transform.z, rotationY: c.object.transform.rotationY },
          placement: p === undefined ? null : { wallId: p.wallId, rotationY: p.rotationY, envelope: p.envelope, alongWall: { ...p.alongWall }, distanceToWall: p.distanceToWall },
          components: c.components.flatMap((k) => {
            const box = boxes.get(k.componentId);
            return box === undefined ? [] : [{
              componentId: k.componentId, componentType: k.componentType, dimensions: { ...k.dimensions }, box,
              materialId: k.materialId, finishId: k.finishId, finishedFaces: k.finishedFaces, grainDirection: k.grainDirection,
            }];
          }),
          cutouts: c.cutouts.map((cut) => ({
            cutoutId: cut.cutoutId, target: cut.target, shape: cut.shape, widthMm: cut.widthMm, depthMm: cut.depthMm,
            position: { ...cut.position }, cornerRadiusMm: cut.cornerRadiusMm,
            clearance: cut.clearance.map((cr) => ({ ...cr })),
            sourceApplianceId: cut.sourceApplianceId, edgeTreatment: cut.edgeTreatment === null ? null : { ...cut.edgeTreatment },
          })),
          validation: { counts: { ...c.validation.counts }, canApprove: c.validation.canApprove },
          messages: messages.filter((m) => m.lineageId === c.object.objectId),
        };
      });

      return {
        designVersion: { id: v.id, designId: v.entity_id, projectId: v.project_id, versionNumber: v.version_number, status: v.status, inputHash, inputRevision: v.input_revision, contentHash: v.content_hash },
        pins: { ...pins },
        dataClassification: resolved.trace.dataClassification,
        testFixtureSources: [...resolved.trace.testFixtureSources],
        engine: { name: "validation", version: engine.version, fingerprint: engine.fingerprint, build: engine.build },
        modelFingerprint: resolved.roomFingerprint,
        room: { ...resolved.room, walls: resolved.room.walls.map((w) => ({ wallId: w.wallId, start: { ...w.start }, end: { ...w.end }, length: w.length, height: w.height, thickness: w.thickness })) },
        objects,
        runs: resolved.runs.map((r) => ({ runId: r.runId, wallId: r.wallId, lineageIds: [...r.objectIds], start: r.start, end: r.end, length: r.length })),
        relationships: resolved.relationships.map((r) => ({ relationshipId: r.relationshipId, type: r.type, source: r.source, lineageIds: [...r.objectIds], wallIds: [...r.wallIds], gap: r.gap, touching: r.touching, overrideIds: [...r.overrideIds] })),
        validation: { counts: { ...resolved.validation.counts }, canApprove: resolved.validation.canApprove, messages },
      };
    });
  }
}
