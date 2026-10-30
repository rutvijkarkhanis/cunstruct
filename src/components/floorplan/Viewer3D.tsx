// 3D view: one extruded box per wall that has a height, on a ground grid.
// Orbit with the mouse; click a wall to select it.
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { WallBox } from "@/lib/floorplan/mesh";

interface Props {
  boxes: WallBox[];
  bounds: { min: [number, number]; max: [number, number] } | null;
  selectedId: string | null;
  onSelectWall: (id: string | null) => void;
}

const COLORS = { confirmed: 0xd6d3cd, candidate: 0xf2b45a, selected: 0x3b82f6 };

export function Viewer3D({ boxes, bounds, selectedId, onSelectWall }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    group: THREE.Group; grid: THREE.GridHelper | null; framed: string;
  } | null>(null);
  const selectRef = useRef(onSelectWall);
  selectRef.current = onSelectWall;

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f5f7);
    const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.05, 2000);
    camera.position.set(12, 12, 12);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb0b4bb, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(20, 30, 10);
    scene.add(sun);
    const group = new THREE.Group();
    scene.add(group);
    stateRef.current = { renderer, scene, camera, controls, group, grid: null, framed: "" };

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    loop();
    const ro = new ResizeObserver(() => {
      renderer.setSize(host.clientWidth, host.clientHeight);
      camera.aspect = host.clientWidth / Math.max(1, host.clientHeight);
      camera.updateProjectionMatrix();
    });
    ro.observe(host);

    const ray = new THREE.Raycaster();
    let down: [number, number] | null = null;
    const onDown = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return; // a drag orbits, a click selects
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = ray.intersectObjects(group.children, false)[0];
      selectRef.current(hit ? (hit.object.userData.id as string) : null);
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, []);

  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;
    for (const c of [...st.group.children]) {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      st.group.remove(m);
    }
    for (const b of boxes) {
      const color = b.id === selectedId ? COLORS.selected : COLORS[b.status];
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...b.size),
        new THREE.MeshStandardMaterial({ color, roughness: 0.85, transparent: b.status === "candidate", opacity: b.status === "candidate" ? 0.75 : 1 }),
      );
      mesh.position.set(...b.center);
      mesh.rotation.y = b.rotationY;
      mesh.userData.id = b.id;
      st.group.add(mesh);
    }
    // ground grid and camera framing follow the plan extent
    const key = bounds ? bounds.min.concat(bounds.max).map((v) => v.toFixed(1)).join(",") : "";
    if (bounds && key !== st.framed) {
      st.framed = key;
      if (st.grid) { st.scene.remove(st.grid); st.grid.geometry.dispose(); }
      const cx = (bounds.min[0] + bounds.max[0]) / 2, cz = (bounds.min[1] + bounds.max[1]) / 2;
      const span = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], 1);
      const size = Math.ceil(span * 1.4);
      st.grid = new THREE.GridHelper(size, size, 0x9aa0a8, 0xd5d8dc);
      st.grid.position.set(cx, 0, cz);
      st.scene.add(st.grid);
      st.controls.target.set(cx, 0, cz);
      st.camera.position.set(cx + span * 0.9, span * 0.9, cz + span * 1.1);
      st.controls.update();
    }
  }, [boxes, bounds, selectedId]);

  return <div ref={hostRef} className="h-full w-full min-h-[360px]" aria-label="3D view of the walls" />;
}
