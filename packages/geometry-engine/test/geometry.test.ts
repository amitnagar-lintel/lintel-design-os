import { describe, expect, it } from "vitest";
import type { Transform } from "@lintel/types";
import { edgeLength, edgeSidesForPlane, envelope, grainLiesInFace, overlapVolume, panelBox, toWorld, worldCorners, isSupportedTransform } from "../src/index.js";

const identity: Transform = { x: 0, y: 0, z: 0, rotationX: 0, rotationY: 0, rotationZ: 0 };

describe("panelBox", () => {
  it("maps face dimensions to cabinet axes by plane", () => {
    const side = panelBox("YZ", { width: 560, height: 720, thickness: 18 }, { x: 0, y: 0, z: 0 });
    expect(side.size).toEqual({ x: 18, y: 720, z: 560 });
    const bottom = panelBox("XZ", { width: 564, height: 560, thickness: 18 }, { x: 18, y: 0, z: 0 });
    expect(bottom.size).toEqual({ x: 564, y: 18, z: 560 });
    const back = panelBox("XY", { width: 564, height: 702, thickness: 6 }, { x: 18, y: 18, z: 10 });
    expect(back.size).toEqual({ x: 564, y: 702, z: 6 });
  });
});

describe("edges", () => {
  it("names the four edges of each plane", () => {
    expect(edgeSidesForPlane("YZ")).toEqual(["TOP", "BOTTOM", "FRONT", "BACK"]);
    expect(edgeSidesForPlane("XZ")).toEqual(["FRONT", "BACK", "LEFT", "RIGHT"]);
    expect(edgeSidesForPlane("XY")).toEqual(["TOP", "BOTTOM", "LEFT", "RIGHT"]);
  });
  it("computes edge lengths and rejects sides absent from the plane", () => {
    const face = { width: 560, height: 720 };
    expect(edgeLength("YZ", "FRONT", face)).toBe(720);
    expect(edgeLength("YZ", "TOP", face)).toBe(560);
    expect(edgeLength("YZ", "LEFT", face)).toBeNull();
  });
});

describe("grain", () => {
  it("accepts grain only in the panel face", () => {
    expect(grainLiesInFace("YZ", "HEIGHT")).toBe(true);
    expect(grainLiesInFace("YZ", "WIDTH")).toBe(false);
    expect(grainLiesInFace("XZ", "DEPTH")).toBe(true);
    expect(grainLiesInFace("XY", "NONE")).toBe(true);
  });
});

describe("envelope / overlap", () => {
  it("bounds boxes", () => {
    const a = panelBox("YZ", { width: 560, height: 720, thickness: 18 }, { x: 0, y: 0, z: 0 });
    const b = panelBox("XY", { width: 600, height: 700, thickness: 18 }, { x: 0, y: 10, z: 560 });
    expect(envelope([a, b])).toEqual({ min: { x: 0, y: 0, z: 0 }, size: { x: 600, y: 720, z: 578 } });
    expect(envelope([])).toBeNull();
  });
  it("reports overlap volume, zero when touching", () => {
    const a = { min: { x: 0, y: 0, z: 0 }, size: { x: 10, y: 10, z: 10 } };
    expect(overlapVolume(a, { min: { x: 10, y: 0, z: 0 }, size: { x: 5, y: 5, z: 5 } })).toBe(0);
    expect(overlapVolume(a, { min: { x: 8, y: 8, z: 8 }, size: { x: 5, y: 5, z: 5 } })).toBe(8);
  });
});

describe("world transform", () => {
  it("translates with identity rotation", () => {
    expect(toWorld({ x: 1, y: 2, z: 3 }, { ...identity, x: 1200 })).toEqual({ x: 1201, y: 2, z: 3 });
  });
  it("rotates about Y by 90° deterministically", () => {
    expect(toWorld({ x: 600, y: 0, z: 0 }, { ...identity, rotationY: 90 })).toEqual({ x: 0, y: 0, z: -600 });
    expect(toWorld({ x: 0, y: 0, z: 560 }, { ...identity, rotationY: 90 })).toEqual({ x: 560, y: 0, z: 0 });
  });
  it("returns 8 corners", () => {
    expect(worldCorners({ min: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } }, identity)).toHaveLength(8);
  });
  it("supports only rotation about Y", () => {
    expect(isSupportedTransform(identity)).toBe(true);
    expect(isSupportedTransform({ ...identity, rotationX: 5 })).toBe(false);
  });
});
