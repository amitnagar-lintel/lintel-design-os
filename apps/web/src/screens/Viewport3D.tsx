/**
 * Design Studio — the live 3D viewport (D6): orbit / pan / zoom over the API's already-resolved model
 * (`GET .../model`, `objects[].components[]`). Three.js only places and colours the boxes the engines already
 * computed; it never calculates a position, a size or a geometry itself (PRD §31, CLAUDE.md "Do not couple
 * Three.js directly to business calculations").
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ModelPreview } from "../api/client";

const CARCASS_COLOR = 0xd8c9a3;
const BACK_COLOR = 0xc7b896;
const SHUTTER_COLOR = 0xf2efe9;
const SELECTED_COLOR = 0x3b82f6;
/** Slice 2.1: a single selected component (e.g. one drawer front) within an already-selected object. */
const SELECTED_COMPONENT_COLOR = 0xf59e0b;

/**
 * Remediation P2 (Slice 6F follow-up): a presentational colour per catalog material/finish id — the same kind of
 * componentType→colour mapping this file already did before this change (never a business calculation; see
 * CLAUDE.md "Do not couple Three.js directly to business calculations"), just keyed by the resolved component's
 * own `materialId`/`finishId` instead of only its `componentType`. An id with no entry falls back to today's
 * fixed colours, so an unmapped or future catalog value never breaks rendering. The two current defaults
 * (`BOARD_BWP_18` for carcass, `LAMINATE_WHITE` for front finish) are chosen to match the colours this viewport
 * already used before materials/finishes became editable, so an unedited cabinet looks exactly as it did.
 */
const MATERIAL_COLORS: Readonly<Record<string, number>> = {
  BOARD_BWP_18: CARCASS_COLOR,
  BOARD_HDHMR_18: 0xcbb27a,
  BOARD_BACK_6: BACK_COLOR,
};
const FINISH_COLORS: Readonly<Record<string, number>> = {
  LAMINATE_WHITE: SHUTTER_COLOR,
};
const FRONT_COMPONENT_TYPES = new Set(["SHUTTER", "DRAWER_FRONT", "FILLER", "END_PANEL"]);

interface Tracked {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly group: THREE.Group;
  meshes: readonly { readonly mesh: THREE.Mesh; readonly lineageId: string; readonly componentId: string; readonly componentType: string }[];
}

export function Viewport3D({ model, selectedId, onSelect, selectedComponentId, onSelectComponent }: {
  readonly model: ModelPreview | null;
  readonly selectedId: string | null;
  readonly onSelect: (lineageId: string) => void;
  /** Slice 2.1: which component (e.g. one drawer front) within the selected object is highlighted, if any. */
  readonly selectedComponentId?: string | null;
  /** Slice 2.1: fired (in addition to `onSelect`) when the clicked component is individually selectable — today, a DRAWER_FRONT. */
  readonly onSelectComponent?: (lineageId: string, componentId: string, componentType: string) => void;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<Tracked | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onSelectComponentRef = useRef(onSelectComponent);
  onSelectComponentRef.current = onSelectComponent;

  useEffect(() => {
    const mount = mountRef.current;
    if (mount === null) return;
    const width = Math.max(1, mount.clientWidth);
    const height = Math.max(1, mount.clientHeight);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f4f5);
    const camera = new THREE.PerspectiveCamera(45, width / height, 10, 30000);
    camera.position.set(3200, 2200, 3200);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(1000, 500, 1000);
    controls.enableDamping = true;
    controls.update();

    scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.55);
    sun.position.set(2000, 3000, 1500);
    scene.add(sun);
    scene.add(new THREE.GridHelper(8000, 40, 0xb8b8bc, 0xdcdce0));

    const group = new THREE.Group();
    scene.add(group);
    stateRef.current = { renderer, scene, camera, controls, group, meshes: [] };

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    const onResize = () => {
      const w = Math.max(1, mount.clientWidth);
      const h = Math.max(1, mount.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    const raycaster = new THREE.Raycaster();
    const onClick = (e: MouseEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const pointer = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(group.children, false)[0];
      const target = hit === undefined ? undefined : stateRef.current?.meshes.find((m) => m.mesh === hit.object);
      if (target === undefined) return;
      onSelectRef.current(target.lineageId);
      if (target.componentType === "DRAWER_FRONT") onSelectComponentRef.current?.(target.lineageId, target.componentId, target.componentType);
    };
    renderer.domElement.addEventListener("click", onClick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, []);

  useEffect(() => {
    const state = stateRef.current;
    if (state === null) return;
    for (const child of [...state.group.children]) {
      state.group.remove(child);
      if (child instanceof THREE.Mesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => { m.dispose(); });
      }
    }
    const meshes: { mesh: THREE.Mesh; lineageId: string; componentId: string; componentType: string }[] = [];
    for (const o of model?.objects ?? []) {
      const selected = o.lineageId === selectedId;
      for (const c of o.components) {
        const geometry = new THREE.BoxGeometry(Math.max(1, c.box.size.x), Math.max(1, c.box.size.y), Math.max(1, c.box.size.z));
        const isBack = c.componentType === "BACK";
        const componentSelected = selected && c.componentId === selectedComponentId;
        // Remediation P2: a front-like component (shutter/drawer front/filler/end panel) is coloured by its own
        // finish; everything else (carcass sides, back, internals) by its own material — both read straight off
        // the resolved component the engine already produced, never recomputed here.
        const baseColor = FRONT_COMPONENT_TYPES.has(c.componentType)
          ? FINISH_COLORS[c.finishId ?? ""] ?? SHUTTER_COLOR
          : MATERIAL_COLORS[c.materialId] ?? (isBack ? BACK_COLOR : CARCASS_COLOR);
        const color = componentSelected ? SELECTED_COMPONENT_COLOR : selected ? SELECTED_COLOR : baseColor;
        const material = new THREE.MeshStandardMaterial({ color, transparent: isBack, opacity: isBack ? 0.35 : 1 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(c.box.min.x + c.box.size.x / 2, c.box.min.y + c.box.size.y / 2, c.box.min.z + c.box.size.z / 2);
        state.group.add(mesh);
        meshes.push({ mesh, lineageId: o.lineageId, componentId: c.componentId, componentType: c.componentType });
      }
    }
    state.meshes = meshes;
  }, [model, selectedId, selectedComponentId]);

  return <div ref={mountRef} className="viewport3d" role="img" aria-label="3D view of the design" />;
}
