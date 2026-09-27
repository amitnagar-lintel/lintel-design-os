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

interface Tracked {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly group: THREE.Group;
  meshes: readonly { readonly mesh: THREE.Mesh; readonly lineageId: string }[];
}

export function Viewport3D({ model, selectedId, onSelect }: { readonly model: ModelPreview | null; readonly selectedId: string | null; readonly onSelect: (lineageId: string) => void }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<Tracked | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

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
      if (target !== undefined) onSelectRef.current(target.lineageId);
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
    const meshes: { mesh: THREE.Mesh; lineageId: string }[] = [];
    for (const o of model?.objects ?? []) {
      const selected = o.lineageId === selectedId;
      for (const c of o.components) {
        const geometry = new THREE.BoxGeometry(Math.max(1, c.box.size.x), Math.max(1, c.box.size.y), Math.max(1, c.box.size.z));
        const isBack = c.componentType === "BACK";
        const color = selected ? SELECTED_COLOR : c.componentType === "SHUTTER" ? SHUTTER_COLOR : isBack ? BACK_COLOR : CARCASS_COLOR;
        const material = new THREE.MeshStandardMaterial({ color, transparent: isBack, opacity: isBack ? 0.35 : 1 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(c.box.min.x + c.box.size.x / 2, c.box.min.y + c.box.size.y / 2, c.box.min.z + c.box.size.z / 2);
        state.group.add(mesh);
        meshes.push({ mesh, lineageId: o.lineageId });
      }
    }
    state.meshes = meshes;
  }, [model, selectedId]);

  return <div ref={mountRef} className="viewport3d" role="img" aria-label="3D view of the design" />;
}
