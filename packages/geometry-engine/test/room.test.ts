import { describe, expect, it } from "vitest";
import type { Box3, Transform } from "@lintel/types";
import { asQuarterTurn, BACK_WALL, containment, placeBox, planDistance, relativeToWall, roomWalls, wallFrame } from "../src/index.js";

const t = (x: number, z: number, rotationY: number): Transform => ({ x, y: 0, z, rotationX: 0, rotationY, rotationZ: 0 });
const carcass: Box3 = { min: { x: 0, y: 0, z: 0 }, size: { x: 600, y: 720, z: 560 } };

describe("quarter turns", () => {
  it("accepts only 0/90/180/270 (normalised)", () => {
    expect([0, 90, 180, 270, 360, -90, 450].map(asQuarterTurn)).toEqual([0, 90, 180, 270, 0, 270, 90]);
    expect(asQuarterTurn(45)).toBeNull();
    expect(asQuarterTurn(89.9)).toBeNull();
  });
  it("maps the back of the cabinet to a wall", () => {
    expect(BACK_WALL).toEqual({ 0: "A", 90: "D", 180: "C", 270: "B" });
  });
});

describe("placeBox (exact for quarter turns)", () => {
  it("translates at 0°", () => {
    expect(placeBox(carcass, t(1200, 0, 0))).toEqual({ min: { x: 1200, y: 0, z: 0 }, size: { x: 600, y: 720, z: 560 } });
  });
  it("rotates 90°: depth runs along +X, width runs towards −Z", () => {
    expect(placeBox(carcass, t(0, 1200, 90))).toEqual({ min: { x: 0, y: 0, z: 600 }, size: { x: 560, y: 720, z: 600 } });
  });
  it("rotates 180° and 270°", () => {
    expect(placeBox(carcass, t(4200, 3200, 180))).toEqual({ min: { x: 3600, y: 0, z: 2640 }, size: { x: 600, y: 720, z: 560 } });
    expect(placeBox(carcass, t(4200, 0, 270))).toEqual({ min: { x: 3640, y: 0, z: 0 }, size: { x: 560, y: 720, z: 600 } });
  });
});

describe("wall frames", () => {
  const L = 4200;
  const W = 3200;
  it("measure along-wall left → right from inside the room, and distance into the room", () => {
    const box = placeBox(carcass, t(1200, 0, 0));
    expect(relativeToWall(box, wallFrame("A", L, W))).toEqual({ start: 1200, end: 1800, distance: 0 });
    const onD = placeBox(carcass, t(0, 1200, 90));
    expect(relativeToWall(onD, wallFrame("D", L, W))).toEqual({ start: 2000, end: 2600, distance: 0 });
    const onC = placeBox(carcass, t(4200, 3200, 180));
    expect(relativeToWall(onC, wallFrame("C", L, W))).toEqual({ start: 0, end: 600, distance: 0 });
    const onB = placeBox(carcass, t(4200, 0, 270));
    expect(relativeToWall(onB, wallFrame("B", L, W))).toEqual({ start: 0, end: 600, distance: 0 });
  });
  it("describes the four walls", () => {
    expect(roomWalls(L, W, 3000, 150).map((w) => [w.wallId, w.length])).toEqual([
      ["A", 4200],
      ["B", 3200],
      ["C", 4200],
      ["D", 3200],
    ]);
  });
});

describe("containment and distance", () => {
  it("reports each wall, floor and ceiling violation", () => {
    expect(containment({ min: { x: -5, y: -1, z: -2 }, size: { x: 4210, y: 3002, z: 3205 } }, 4200, 3200, 3000).map((v) => [v.kind, v.wallId, v.by])).toEqual([
      ["THROUGH_WALL", "A", 2],
      ["THROUGH_WALL", "B", 5],
      ["THROUGH_WALL", "C", 3],
      ["THROUGH_WALL", "D", 5],
      ["BELOW_FLOOR", null, 1],
      ["ABOVE_CEILING", null, 1],
    ]);
    expect(containment(carcass, 4200, 3200, 3000)).toEqual([]);
  });
  it("measures plan distance (0 when touching)", () => {
    const b: Box3 = { min: { x: 600, y: 0, z: 0 }, size: { x: 10, y: 10, z: 10 } };
    expect(planDistance(carcass, b)).toBe(0);
    expect(planDistance(carcass, { ...b, min: { x: 603, y: 0, z: 564 } })).toBe(5);
  });
});
