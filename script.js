import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createNoise2D } from 'simplex-noise';
import { joinRoom } from 'trystero';

// --- Global Variables ---
let scene, camera, renderer, controls;
let clock = new THREE.Clock();
let zombieMixer;
let zombieGroup;
let currentCharacterName = 'gura'; // Default
let myUsername = "Visitante";
let loadingManager; // Global Loading Manager controls the Screen
let backgroundManager; // For lazy loading NPCs/Avatar

// NPC Globals
let chilcanito = {
    mesh: null,
    mixer: null,
    action: null,
    targetPos: null,
    waitTimer: 0,
    state: 'idle', // idle, walk
    dialogDiv: null,
    dialogTimer: 0,
    dialogs: ["¿Amada dónde estás?", "Tu nombre era Ha...", "Te extraño tanto...", "El cementerio es frío..."]
};

let nekosan = {
    mesh: null,
    mixer: null,
    actions: {},
    currentAction: null,
    targetPos: null,
    waitTimer: 0,
    state: 'idle',
    dialogDiv: null,
    dialogTimer: 0,
    chatTextDiv: null,
    dialogs: [
        "Seré tu novia si me pagas 💖",
        "¿Tienes dinero? 💸",
        "El amor cuesta caro...",
        "Busco un patrocinador...",
        "¿Me invitas algo?"
    ]
};

// Multiplayer Globals
let room, sendUpdate, getUpdate;
const peers = {}; // { peerId: { mesh, mixer, targetPos, targetRot, action, nameTag } }
const UPDATE_RATE = 100; // ms
let lastUpdate = 0;

// Game State
let isTourActive = false;
let isGuiding = false;
let hasArrived = false;
let currentDeceasedInfo = null;
let targetPosition = null;

// Physics / Animation State
let velocity = new THREE.Vector3(0, 0, 0);
let verticalVelocity = 0;
const GRAVITY = -20.0;
const JUMP_FORCE = 8.0;
let isJumping = false;
const MOVEMENT_SPEED = 6.0;
const SPRINT_SPEED = 10.0;

let currentAction = null;
let idleActionTimer = 0;
const IDLE_SWITCH_TIME = 8.0;
let IDLE_ANIMATION_NAMES = [];
let RUN_ANIMATION_NAME = '';
let BASE_IDLE_NAME = 'idle';

// Procedural Terrain Globals
const noise2D = createNoise2D();
const chunks = new Map();
const CHUNK_SIZE = 100;
const DRAW_DISTANCE = 2;
const stonesPerChunk = 15;
let grassTexture, dirtTexture, pavementTexture, stoneTexture;
let lastChunkX = null, lastChunkZ = null;

// Movement Keys
const keys = {
    ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false,
    KeyW: false, KeyA: false, KeyS: false, KeyD: false, KeyF: false,
    ShiftLeft: false, ShiftRight: false, Space: false
};
let joystickVector = { x: 0, y: 0 }; // Global Joystick

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Style injection for Chat UI has been removed to switch to an external widget.

    initThreeJS();
    setupUI();
    setupControls();
    resetKeys();
    animate();

    // Hide mobile controls initially to prevent overlap with login
    const mc = document.getElementById('mobile-controls');
    if (mc) mc.style.display = 'none';
});

function initThreeJS() {
    const container = document.getElementById('scene-container');

    // Loading Manager Setup (Critical Path - now empty for instant load)
    loadingManager = new THREE.LoadingManager();
    // ... (Keep existing progress logic)

    // Background Manager (Actual Assets)
    backgroundManager = new THREE.LoadingManager();
    // Optional: Add small HUD progress for background
    backgroundManager.onProgress = (url, loaded, total) => {
        console.log(`Background Load: ${Math.round(loaded / total * 100)}%`);
    };
    loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
        const progress = (itemsLoaded / itemsTotal) * 100;
        const e = document.getElementById('loading-bar');
        if (e) e.style.width = `${progress}%`;
        const t = document.getElementById('loading-text');
        if (t) t.innerText = `Cargando: ${url.split('/').pop()}`;
    };

    // Failsafe: Show Entry Button if stuck
    setTimeout(() => {
        const s = document.getElementById('loading-screen');
        if (s && document.body.contains(s)) {
            const btn = document.createElement('div');
            btn.innerText = "Saltar Carga (Problemas detectados)";
            btn.style.marginTop = '20px';
            btn.style.padding = '10px 20px';
            btn.style.background = '#ff3333';
            btn.style.color = 'white';
            btn.style.cursor = 'pointer';
            btn.style.borderRadius = '5px';
            btn.style.fontWeight = 'bold';
            btn.addEventListener('click', () => { s.style.opacity = '0'; setTimeout(() => s.remove(), 500); });

            // Append to loading container if possible, else body
            // Loading screen structure? Usually has a container.
            // Let's just append to s (the loading screen overlay).
            s.style.display = 'flex'; s.style.flexDirection = 'column'; s.style.alignItems = 'center'; s.style.justifyContent = 'center';
            s.appendChild(btn);
        }
    }, 8000); // 8 Seconds Timeout



    loadingManager.onLoad = () => {
        const s = document.getElementById('loading-screen');
        if (s) {
            s.style.opacity = '0';
            setTimeout(() => s.remove(), 500);
        }
        console.log("All Assets Loaded");
    };

    // 1. Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xaaccff);
    scene.fog = new THREE.Fog(0xaaccff, 20, 150);

    // 2. Camera
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 10);

    // 3. Renderer
    renderer = new THREE.WebGLRenderer({
        antialias: window.devicePixelRatio < 2, // Only AA if low DPI
        alpha: false,
        powerPreference: 'high-performance'
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // Cap resolution for mobile
    renderer.shadowMap.enabled = true; // Keep shadows but maybe lower res?
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // 4. Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffaa, 1.2);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5; // Tweak for shadows
    dirLight.shadow.camera.far = 500;
    dirLight.shadow.camera.left = -100;
    dirLight.shadow.camera.right = 100;
    dirLight.shadow.camera.top = 100;
    dirLight.shadow.camera.bottom = -100;
    scene.add(dirLight);

    // 5. Textures
    createProceduralTextures();

    // 6. Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 2;
    controls.maxDistance = 40;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;

    // 7. Initial Generation
    updateChunks(0, 0);

    // Placeholder Character (Emergency Fallback)
    // Used if assets fail to load or user skips loading.
    const phGeo = new THREE.CapsuleGeometry(0.5, 1.5, 4, 8);
    const phMat = new THREE.MeshStandardMaterial({ color: 0x0088cc, roughness: 0.5 });
    zombieGroup = new THREE.Mesh(phGeo, phMat);
    zombieGroup.position.set(0, 0, 0);
    zombieGroup.castShadow = true;
    zombieGroup.userData.isPlaceholder = true;
    zombieGroup.visible = false; // Hidden until intro
    scene.add(zombieGroup);

    // 8. Load Character (Background - Use Placeholder first)
    loadCharacterModel('gura', false);

    // 9. Load NPCs (Lazy / Background)
    loadNPC(backgroundManager);
    loadNekosan(backgroundManager);
    loadRenzoNPC(backgroundManager);
    loadHonda(backgroundManager);

    // Force Load Screen Exit fast for weak hosting
    setTimeout(() => {
        const s = document.getElementById('loading-screen');
        if (s) {
            s.style.opacity = '0';
            setTimeout(() => s.remove(), 500);
        }
        // Force Placeholder Visible if Gura hasn't arrived
        if (zombieGroup && !currentCharacterName.includes('gura')) {
            zombieGroup.visible = true;
        }
    }, 2000);

    // Resize Handle
    window.addEventListener('resize', onWindowResize, false);

    // Fix Sticky Keys on Blur
    window.addEventListener('blur', resetKeys);
}

// Global to store Gura's height
let REFERENCE_HEIGHT = null;

// --- Character Loading System ---
function loadCharacterModel(charName, isCritical = false) {
    console.log(`Loading character: ${charName} (Critical: ${isCritical})`);

    const loader = new GLTFLoader(isCritical ? loadingManager : (backgroundManager || loadingManager));
    const path = `${charName}/scene.gltf`;

    loader.load(path, (gltf) => {
        // SUCCESS: Swap Models
        const newModel = gltf.scene;

        // Capture old state
        let oldPos = new THREE.Vector3(0, 0, 0);
        let oldRot = new THREE.Euler();
        let wasVisible = false;

        if (zombieGroup) {
            oldPos.copy(zombieGroup.position);
            oldRot.copy(zombieGroup.rotation);
            wasVisible = zombieGroup.visible;
            scene.remove(zombieGroup);

            // Clean up mixer if switching
            if (zombieMixer) {
                zombieMixer.stopAllAction();
                zombieMixer = null;
            }
        }

        zombieGroup = newModel;
        zombieGroup.position.copy(oldPos);
        zombieGroup.rotation.copy(oldRot);

        // Restore Visibility State
        // If we were visible, stay visible.
        // If tour is active, ensure visible.
        if (isTourActive) {
            zombieGroup.visible = true;
        } else {
            zombieGroup.visible = wasVisible; // Likely false if in login
        }

        // Shadows
        zombieGroup.traverse(n => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; } });

        // --- Auto-Scale Relative to Gura ---
        newModel.scale.set(1, 1, 1);
        newModel.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(newModel);
        const size = new THREE.Vector3();
        box.getSize(size);
        const nativeHeight = size.y;

        if (nativeHeight > 0) {
            if (charName === 'gura') {
                REFERENCE_HEIGHT = nativeHeight;
                newModel.scale.set(1, 1, 1);
                console.log(`Reference Height set to Gura: ${nativeHeight.toFixed(3)}`);
            } else {
                const target = REFERENCE_HEIGHT || 1.3;
                const scaleFactor = target / nativeHeight;
                newModel.scale.set(scaleFactor, scaleFactor, scaleFactor);
                console.log(`Scaled ${charName} to match Gura.`);
            }
        }

        // Animation Setup
        if (gltf.animations.length) {
            zombieMixer = new THREE.AnimationMixer(zombieGroup);
            zombieGroup.userData.allClips = gltf.animations;

            const runClip = gltf.animations.find(a => /run|walk/i.test(a.name));
            RUN_ANIMATION_NAME = runClip ? runClip.name : gltf.animations[0].name;

            IDLE_ANIMATION_NAMES = [];
            gltf.animations.forEach(c => {
                const n = c.name.toLowerCase();
                if (!n.includes(RUN_ANIMATION_NAME.toLowerCase()) && !n.includes("resource") && !n.includes("tpos")) {
                    IDLE_ANIMATION_NAMES.push(c.name);
                }
            });

            const idleRef = IDLE_ANIMATION_NAMES.find(n => /idle/i.test(n)) || IDLE_ANIMATION_NAMES[0];
            BASE_IDLE_NAME = idleRef || RUN_ANIMATION_NAME;

            playAnimation(BASE_IDLE_NAME);
        }

        scene.add(zombieGroup);
        currentCharacterName = charName;

        // Update Grid UI Active State
        document.querySelectorAll('.char-slot').forEach(slot => {
            slot.classList.toggle('active', slot.dataset.char === charName);
        });

        // Feedback
        if (typeof addChatMessage === 'function') addChatMessage('Sistema', `Modelo ${charName} cargado.`, false);

    }, undefined, (err) => {
        console.error(`Failed to load ${charName}`, err);
        // Error Feedback
        if (typeof addChatMessage === 'function') addChatMessage('Sistema', `⚠️ Error cargando ${charName}. Usando respaldo.`, false);

        // We do NOT remove the existing zombieGroup, so player is not invisible.
        // If placeholder was there, it stays.
    });
}

function playAnimation(name, fadeDuration = 0.3) {
    if (!zombieMixer || !zombieGroup.userData.allClips) return;
    const clip = zombieGroup.userData.allClips.find(c => c.name === name);

    if (clip) {
        if (currentAction && currentAction.getClip().name === clip.name) return;
        const newAction = zombieMixer.clipAction(clip);
        if (currentAction) currentAction.fadeOut(fadeDuration);
        newAction.reset().fadeIn(fadeDuration).play();
        currentAction = newAction;
    }
}

// --- Physics & Terrain ---

function getTerrainHeight(x, z) {
    const dist = Math.sqrt(x * x + z * z);

    // Plaza Flatness
    let baseHeight = 0;
    const base = noise2D(x * 0.01, z * 0.01) * 4;
    const detail = noise2D(x * 0.05, z * 0.05) * 1;
    let h = base + detail;

    if (isLocationPath(x, z)) h -= 0.2;

    if (dist < 40) {
        return 0; // Flat
    } else if (dist < 60) {
        // Blend
        const t = (dist - 40) / 20.0;
        return h * t;
    }
    return h;
}

function isLocationPath(x, z) {
    if (Math.abs(x) < 55 && Math.abs(z) < 55) return false;
    const n = noise2D(x * 0.008, z * 0.008);
    return Math.abs(n) < 0.15;
}

function respawnPlayer() {
    if (!zombieGroup) return;

    // Spawn in random annulus (Donut) to avoid fountain
    // Radius 10 to 35
    const r = 10 + Math.random() * 25;
    const theta = Math.random() * Math.PI * 2;
    const x = r * Math.cos(theta);
    const z = r * Math.sin(theta);

    zombieGroup.position.set(x, 0, z);
    verticalVelocity = 0;
    isGuiding = false;
    targetPosition = null;

    // Camera reset
    camera.position.set(x, 5, z + 8);
    controls.target.copy(zombieGroup.position);
    controls.update();
}

function updateChunks(playerX, playerZ) {
    const currentChunkX = Math.floor(playerX / CHUNK_SIZE);
    const currentChunkZ = Math.floor(playerZ / CHUNK_SIZE);

    if (currentChunkX === lastChunkX && currentChunkZ === lastChunkZ) return;

    lastChunkX = currentChunkX;
    lastChunkZ = currentChunkZ;

    const neededKeys = new Set();
    for (let x = -DRAW_DISTANCE; x <= DRAW_DISTANCE; x++) {
        for (let z = -DRAW_DISTANCE; z <= DRAW_DISTANCE; z++) {
            const cx = currentChunkX + x;
            const cz = currentChunkZ + z;
            neededKeys.add(`${cx},${cz}`);
            if (!chunks.has(`${cx},${cz}`)) {
                chunks.set(`${cx},${cz}`, generateChunk(cx, cz));
            }
        }
    }

    chunks.forEach((chunk, key) => {
        if (!neededKeys.has(key)) {
            scene.remove(chunk);
            chunks.delete(key);
        }
    });
}

function generateChunk(cx, cz) {
    const offsetX = cx * CHUNK_SIZE;
    const offsetZ = cz * CHUNK_SIZE;
    const chunkGroup = new THREE.Group();
    chunkGroup.position.set(offsetX, 0, offsetZ);

    const resolution = 64;
    const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, resolution, resolution);
    geometry.rotateX(-Math.PI / 2);

    const posAttr = geometry.attributes.position;
    const colors = [];

    for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i) + offsetX;
        const z = posAttr.getZ(i) + offsetZ;
        const y = getTerrainHeight(x, z);
        posAttr.setY(i, y);

        const dist = Math.sqrt(x * x + z * z);
        if (dist < 40) {
            colors.push(0.5, 0.5, 0.5); // Grey Plaza
        } else if (isLocationPath(x, z)) {
            colors.push(0.6, 0.5, 0.3); // Path
        } else {
            colors.push(0.2, 0.5, 0.2); // Grass
        }
    }

    geometry.computeVertexNormals();
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 1, map: grassTexture
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true; mesh.castShadow = true;
    chunkGroup.add(mesh);

    if (cx === 0 && cz === 0) populateSpawnProps(chunkGroup);
    else createChunkTombstones(chunkGroup, offsetX, offsetZ);

    scene.add(chunkGroup);
    return chunkGroup;
}

// Reuse prop generation logic (simplified)
// --- Plaza Decorations ---

function populateSpawnProps(group) {
    const diskGeo = new THREE.CircleGeometry(40, 64);
    diskGeo.rotateX(-Math.PI / 2); diskGeo.translate(0, 0.05, 0);
    const disk = new THREE.Mesh(diskGeo, new THREE.MeshStandardMaterial({ map: pavementTexture, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1 }));
    disk.receiveShadow = true; group.add(disk);

    // Fountain
    const fBase = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 0.5, 32), new THREE.MeshStandardMaterial({ color: 0x888888 }));
    fBase.position.y = 0.25; fBase.receiveShadow = true; fBase.castShadow = true; group.add(fBase);

    const fWater = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.1, 32), new THREE.MeshStandardMaterial({ color: 0x44aaff, roughness: 0.1 }));
    fWater.position.y = 0.5; group.add(fWater);

    // Lamps
    for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const lx = Math.cos(ang) * 35; const lz = Math.sin(ang) * 35;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4), new THREE.MeshStandardMaterial({ color: 0x222 }));
        pole.position.set(lx, 2, lz); pole.castShadow = true; group.add(pole);
        const pl = new THREE.PointLight(0xffaa00, 1, 15); pl.position.set(lx, 4, lz); group.add(pl);

        // Add benches between lamps
        const bang = ang + (Math.PI / 8);
        const bx = Math.cos(bang) * 32; const bz = Math.sin(bang) * 32;
        const bench = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 1), new THREE.MeshStandardMaterial({ color: 0x5d4037 }));
        bench.position.set(bx, 0.25, bz);
        bench.lookAt(0, 0.25, 0);
        bench.castShadow = true; group.add(bench);
    }

    // Decorations
    createFountainParticles(group);
    createFireflies(group);
    createBushes(group);
}

function createFountainParticles(group) {
    const count = 200;
    const geom = new THREE.BufferGeometry();
    const pos = [];
    const vels = [];
    for (let i = 0; i < count; i++) {
        pos.push(0, 0.5, 0);
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.5 + Math.random();
        vels.push({
            x: Math.cos(angle) * speed * 0.5,
            y: 2 + Math.random() * 2,
            z: Math.sin(angle) * speed * 0.5
        });
    }
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xaaccff, size: 0.2, transparent: true, opacity: 0.6 });
    const points = new THREE.Points(geom, mat);
    points.userData = { vels: vels };

    // Update Animation Hook
    points.onBeforeRender = () => {
        const positions = points.geometry.attributes.position.array;
        for (let i = 0; i < count; i++) {
            const idx = i * 3;
            positions[idx] += vels[i].x * 0.05;
            positions[idx + 1] += vels[i].y * 0.05;
            positions[idx + 2] += vels[i].z * 0.05;
            vels[i].y -= 0.1; // gravity
            if (positions[idx + 1] < 0.5) {
                positions[idx] = 0; positions[idx + 1] = 0.5; positions[idx + 2] = 0;
                const angle = Math.random() * Math.PI * 2;
                const speed = 0.5 + Math.random();
                vels[i].x = Math.cos(angle) * speed * 0.5;
                vels[i].y = 2 + Math.random() * 2;
                vels[i].z = Math.sin(angle) * speed * 0.5;
            }
        }
        points.geometry.attributes.position.needsUpdate = true;
    };
    group.add(points);
}

function createFireflies(group) {
    const count = 50;
    const geom = new THREE.BufferGeometry();
    const pos = [];
    for (let i = 0; i < count; i++) {
        const r = Math.random() * 40;
        const t = Math.random() * Math.PI * 2;
        pos.push(Math.cos(t) * r, 1 + Math.random() * 3, Math.sin(t) * r);
    }
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffaa, size: 0.15, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending });
    const points = new THREE.Points(geom, mat);

    points.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
        const time = Date.now() * 0.001;
        const positions = geometry.attributes.position.array;
        for (let i = 0; i < count; i++) {
            const idx = i * 3;
            positions[idx + 1] += Math.sin(time + positions[idx]) * 0.02;
        }
        geometry.attributes.position.needsUpdate = true;
    };
    group.add(points);
}

function createBushes(group) {
    const bushGeo = new THREE.IcosahedronGeometry(1, 0);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x2d5a27 });
    for (let i = 0; i < 20; i++) {
        const t = Math.random() * Math.PI * 2;
        const r = 38 + Math.random() * 4; // Edge of plaza
        const bush = new THREE.Mesh(bushGeo, bushMat);
        bush.position.set(Math.cos(t) * r, 0.5, Math.sin(t) * r);
        const s = 1 + Math.random();
        bush.scale.set(s, s, s);
        bush.castShadow = true;
        group.add(bush);
    }
}

function createChunkTombstones(group, offsetX, offsetZ) {
    const positions = [];
    const distToCenter = Math.sqrt(offsetX * offsetX + offsetZ * offsetZ);
    if (distToCenter < 60) return;

    for (let i = 0; i < stonesPerChunk; i++) {
        const lx = Math.random() * CHUNK_SIZE;
        const lz = Math.random() * CHUNK_SIZE;
        const wx = offsetX + lx;
        const wz = offsetZ + lz;
        if (Math.sqrt(wx * wx + wz * wz) < 50) continue;

        if (!isLocationPath(wx, wz)) {
            positions.push({ x: lx, y: getTerrainHeight(wx, wz), z: lz });
        }
    }
    if (!positions.length) return;

    // Detailed Arched Tombstone Shape
    const shape = new THREE.Shape();
    shape.moveTo(-0.25, 0);
    shape.lineTo(0.25, 0);
    shape.lineTo(0.25, 0.6);
    shape.absarc(0, 0.6, 0.25, 0, Math.PI, false);
    shape.lineTo(-0.25, 0);

    const geom = new THREE.ExtrudeGeometry(shape, {
        depth: 0.1, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.02, bevelThickness: 0.02
    });
    geom.translate(0, 0, -0.05); // Center thickness

    const mat = new THREE.MeshStandardMaterial({
        map: stoneTexture, color: 0xbbbbbb, roughness: 0.9
    });

    const mesh = new THREE.InstancedMesh(geom, mat, positions.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const dummy = new THREE.Object3D();
    positions.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        // Random Y Rotation (Facing)
        dummy.rotation.set(0, (Math.random() - 0.5) * Math.PI, 0);
        // Slight tilt for realism
        dummy.rotation.z = (Math.random() - 0.5) * 0.1;
        dummy.rotation.x = (Math.random() - 0.5) * 0.1;

        const s = 1 + Math.random() * 0.3; dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
    });

    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
}


// --- Main Animation Loop ---

// --- Main Animation Loop ---

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (zombieMixer) zombieMixer.update(delta);

    // Multiplayer Updates
    updatePeers(delta);

    // NPC Update
    updateNPC(delta);
    updateNekosan(delta);
    updateRenzo(delta);
    updateHonda(delta);

    // Send My Update
    if (zombieGroup && sendUpdate && isTourActive) {
        const now = Date.now();
        if (now - lastUpdate > UPDATE_RATE) {
            lastUpdate = now;

            // Determine active anim name safely
            let animName = 'idle';
            if (currentAction && currentAction.isRunning()) {
                animName = currentAction.getClip().name;
            }

            // Send
            sendUpdate({
                x: zombieGroup.position.x,
                y: zombieGroup.position.y,
                z: zombieGroup.position.z,
                ry: zombieGroup.rotation.y,
                char: currentCharacterName,
                anim: animName,
                name: myUsername
            });
            lastUpdate = now;
        }
    }

    // Name Tag Local
    if (myNameTag && zombieGroup) {
        updateNameTagPos(myNameTag, zombieGroup.position);
    }

    if (zombieGroup && zombieGroup.visible) {
        handleMovement(delta);
        updateChunks(zombieGroup.position.x, zombieGroup.position.z);

        // Light tracking
        const dl = scene.children.find(c => c.isDirectionalLight);
        if (dl) {
            dl.position.set(zombieGroup.position.x + 50, 100, zombieGroup.position.z + 50);
            dl.target.position.copy(zombieGroup.position);
            dl.target.updateMatrixWorld();
        }
    }
    if (renderer && scene && camera) renderer.render(scene, camera);
}

function handleMovement(delta) {
    if (!zombieGroup) return;

    let moveDir = new THREE.Vector3(0, 0, 0);
    const terrainHeight = getTerrainHeight(zombieGroup.position.x, zombieGroup.position.z);
    let onGround = zombieGroup.position.y <= terrainHeight + 0.1;

    // 1. Process Input
    if (isGuiding && targetPosition) {
        if (zombieGroup.position.distanceTo(targetPosition) < 1.0) {
            isGuiding = false; hasArrived = true;
            document.getElementById('deceased-info-card').classList.remove('hidden');
        } else {
            moveDir.subVectors(targetPosition, zombieGroup.position).normalize();
        }
    } else {
        // Manual
        if (keys.KeyW || keys.ArrowUp) moveDir.z -= 1;
        if (keys.KeyS || keys.ArrowDown) moveDir.z += 1;
        if (keys.KeyA || keys.ArrowLeft) moveDir.x -= 1;
        if (keys.KeyD || keys.ArrowRight) moveDir.x += 1;

        // Add joystick input (with Deadzone)
        if (Math.abs(joystickVector.y) > 0.1) moveDir.z += joystickVector.y;
        if (Math.abs(joystickVector.x) > 0.1) moveDir.x += joystickVector.x;

        // Auto-Sprint on Joystick Max
        if (Math.sqrt(joystickVector.x ** 2 + joystickVector.y ** 2) > 0.9) keys.ShiftLeft = true;

        if ((keys.Space) && onGround && !isJumping) {
            verticalVelocity = JUMP_FORCE;
            isJumping = true;
            onGround = false;
        }
    }

    // Anti-Stick Safety: If no movement input, clear Shift
    // This prevents "stuck run" if Shift keyup was missed
    if (moveDir.lengthSq() === 0) {
        keys.ShiftLeft = false;
        keys.ShiftRight = false;
    }

    // 2. Camera Relative Movement
    if (moveDir.lengthSq() > 0 && !isGuiding) {
        moveDir.normalize();
        const cf = new THREE.Vector3(); camera.getWorldDirection(cf); cf.y = 0; cf.normalize();
        const cr = new THREE.Vector3().crossVectors(cf, new THREE.Vector3(0, 1, 0));
        moveDir = new THREE.Vector3().addScaledVector(cf, -moveDir.z).addScaledVector(cr, moveDir.x).normalize();
    }

    // 3. Physics & Velocity
    verticalVelocity += GRAVITY * delta;

    const speed = (keys.ShiftLeft || keys.ShiftRight) ? SPRINT_SPEED : MOVEMENT_SPEED;
    const horizontalMove = moveDir.clone().multiplyScalar(speed * delta);

    zombieGroup.position.add(horizontalMove);
    zombieGroup.position.y += verticalVelocity * delta;

    // 4. Ground Collision
    const currentGroundH = getTerrainHeight(zombieGroup.position.x, zombieGroup.position.z);
    if (zombieGroup.position.y < currentGroundH) {
        zombieGroup.position.y = currentGroundH;
        verticalVelocity = 0;
        isJumping = false;
    }

    // 5. Rotation & Animation & Stickiness Fix
    if (moveDir.lengthSq() > 0.01) {
        const angle = Math.atan2(moveDir.x, moveDir.z);
        let rotDiff = angle - zombieGroup.rotation.y;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
        zombieGroup.rotation.y += rotDiff * 10 * delta;

        playAnimation(RUN_ANIMATION_NAME, 0.2);
        idleActionTimer = 0;
    } else {
        // Not Waiting! Strict Idle if not jumping
        if (!isJumping) {
            // Force idle if current is run
            if (currentAction && currentAction.getClip().name === RUN_ANIMATION_NAME) {
                playAnimation(BASE_IDLE_NAME, 0.2);
            }

            idleActionTimer += delta;
            // Random Idles
            if (idleActionTimer > IDLE_SWITCH_TIME) {
                if (IDLE_ANIMATION_NAMES.length > 0) {
                    const rnd = IDLE_ANIMATION_NAMES[Math.floor(Math.random() * IDLE_ANIMATION_NAMES.length)];
                    if (!currentAction || rnd !== currentAction.getClip().name)
                        playAnimation(rnd, 0.5);
                }
                idleActionTimer = 0;
            }
        }
    }

    // 6. Camera Follow
    controls.target.copy(zombieGroup.position);
    controls.update();
    camera.position.add(horizontalMove);
}

// --- Inputs & UI ---


function resetKeys() {
    Object.keys(keys).forEach(k => keys[k] = false);
    joystickVector = { x: 0, y: 0 };
}

function setupControls() {
    window.addEventListener('keydown', (e) => {
        // Use e.code (Physical Key) to avoid Case/Shift modification
        if (keys.hasOwnProperty(e.code)) keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
        if (keys.hasOwnProperty(e.code)) keys[e.code] = false;
    });
    // Extra safety for window focus loss
    window.addEventListener('blur', resetKeys);
    window.addEventListener('focus', resetKeys);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) resetKeys();
    });

    // Joystick Init
    if (typeof nipplejs !== 'undefined') {
        const zone = document.getElementById('joystick-zone');
        if (zone) {
            const manager = nipplejs.create({
                zone: zone,
                mode: 'static',
                position: { left: '50%', top: '50%' },
                color: 'white',
                size: 100
            });
            manager.on('move', (evt, data) => {
                const fwd = data.vector.y;
                const turn = data.vector.x;
                // Mapping: Up(y>0) -> z-1, Down(y<0) -> z+1
                joystickVector.y = -fwd;
                joystickVector.x = turn;
            });
            manager.on('end', () => {
                joystickVector.x = 0; joystickVector.y = 0;
            });
        }
    }

    // Mobile Jump
    const jumpBtn = document.getElementById('mobile-jump-btn');
    if (jumpBtn) {
        jumpBtn.addEventListener('touchstart', (e) => { e.preventDefault(); keys.Space = true; });
        jumpBtn.addEventListener('touchend', (e) => { e.preventDefault(); keys.Space = false; });
        // Mouse fallback for testing
        jumpBtn.addEventListener('mousedown', () => keys.Space = true);
        jumpBtn.addEventListener('mouseup', () => keys.Space = false);
    }

    // Mobile Run Button (Inject if not exists)
    // Strict Mobile Check: Must support touch points
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    if (isTouch && typeof nipplejs !== 'undefined' && !document.getElementById('mobile-run-btn')) {
        const runBtn = document.createElement('div');
        runBtn.id = 'mobile-run-btn';
        runBtn.style.position = 'absolute';
        runBtn.style.bottom = '160px'; // Above jump
        runBtn.style.right = '40px';
        runBtn.style.width = '60px';
        runBtn.style.height = '60px';
        runBtn.style.background = 'rgba(255, 165, 0, 0.5)';
        runBtn.style.borderRadius = '50%';
        runBtn.style.border = '2px solid white';
        runBtn.style.zIndex = '1000';
        runBtn.style.display = 'flex';
        runBtn.style.justifyContent = 'center';
        runBtn.style.alignItems = 'center';

        const icon = document.createElement('div');
        icon.innerText = 'Run';
        icon.style.color = 'white';
        icon.style.fontWeight = 'bold';
        icon.style.fontSize = '12px';
        icon.style.pointerEvents = 'none';
        runBtn.appendChild(icon);

        const container = document.getElementById('mobile-controls');
        if (container) container.appendChild(runBtn);
        else document.body.appendChild(runBtn);

        runBtn.addEventListener('touchstart', (e) => { e.preventDefault(); keys.ShiftLeft = true; runBtn.style.background = 'rgba(255, 165, 0, 0.8)'; });
        runBtn.addEventListener('touchend', (e) => { e.preventDefault(); keys.ShiftLeft = false; runBtn.style.background = 'rgba(255, 165, 0, 0.5)'; });
    }
}

function setupUI() {
    // Login
    document.getElementById('loginForm')?.addEventListener('submit', (e) => {
        e.preventDefault();

        // Capture Username
        const input = document.getElementById('username');
        if (input && input.value.trim() !== "") {
            myUsername = input.value.trim();
        }

        // Init local name tag
        if (!myNameTag) myNameTag = createNameTag(myUsername);

        const c = document.getElementById('loginContainer');
        c.style.opacity = '0';
        setTimeout(() => { c.style.display = 'none'; startIntro(); }, 1000);
    });

    // Respawn
    document.getElementById('btn-respawn')?.addEventListener('click', respawnPlayer);

    // Character Selector
    const modal = document.getElementById('character-modal');
    document.getElementById('btn-char-select')?.addEventListener('click', () => modal.classList.remove('hidden'));
    document.querySelector('.close-modal')?.addEventListener('click', () => modal.classList.add('hidden'));

    // Character Slots click
    document.querySelectorAll('.char-slot').forEach(slot => {
        slot.addEventListener('click', () => {
            const charName = slot.dataset.char;
            if (!charName) return;

            // Feedback
            if (typeof addChatMessage === 'function') {
                addChatMessage('Sistema', `Solicitando cambio a ${charName}...`, false);
            }
            console.log("Switching to", charName);

            loadCharacterModel(charName, false); // Background load
            modal.classList.add('hidden');
        });
    });

    // Intro Button
    document.getElementById('start-tour-btn')?.addEventListener('click', () => {
        document.getElementById('welcome-message').classList.add('hidden');
        // SKIP SEARCH FOR NOW
        // document.getElementById('deceased-form-container').classList.remove('hidden');
    });

    // Deceased Form
    document.getElementById('deceasedForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        document.getElementById('deceased-form-container').classList.add('hidden');
        isGuiding = true; hasArrived = false;
        // Random faraway target
        const r = 50 + Math.random() * 50; const t = Math.random() * 6.28;
        targetPosition = new THREE.Vector3(r * Math.cos(t), 0, r * Math.sin(t));
        targetPosition.y = getTerrainHeight(targetPosition.x, targetPosition.z);
    });

    document.getElementById('close-info-btn')?.addEventListener('click', () => {
        document.getElementById('deceased-info-card').classList.add('hidden');
        document.getElementById('deceased-form-container').classList.remove('hidden');
        isGuiding = false;
    });

    document.querySelector('.toggle-password')?.addEventListener('click', () => {
        const i = document.getElementById('password'); i.type = i.type === 'password' ? 'text' : 'password';
    });
}

function startIntro() {
    isTourActive = true;
    if (zombieGroup) {
        zombieGroup.visible = true;
        // Ensure character is spawned within plaza if hidden before
        if (zombieGroup.position.length() < 1) respawnPlayer();
    }
    document.getElementById('welcome-message').classList.remove('hidden');

    // Show Mobile Controls if Touch
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouch) {
        const mc = document.getElementById('mobile-controls');
        if (mc) mc.style.display = 'block';
    }

    // Start Multiplayer
    initMultiplayer();

    // External Widget is now handled in HTML directly.
}

// --- Textures Utils ---
function createProceduralTextures() {
    function createTexture(colorBase, colorVar, scale = 5000, w = 512, h = 512) {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d'); ctx.fillStyle = colorBase; ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < scale; i++) {
            ctx.fillStyle = Math.random() > 0.5 ? colorVar : colorBase;
            ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
        }
        const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
    }
    grassTexture = createTexture('#2d5a27', '#3e7a36'); grassTexture.repeat.set(10, 10);
    dirtTexture = createTexture('#5d4037', '#6d4c41'); dirtTexture.repeat.set(5, 5);

    const cp = document.createElement('canvas'); cp.width = 512; cp.height = 512;
    const ctxp = cp.getContext('2d'); ctxp.fillStyle = '#666'; ctxp.fillRect(0, 0, 512, 512);
    ctxp.strokeStyle = '#555'; ctxp.lineWidth = 4;
    for (let x = 0; x <= 512; x += 64) { ctxp.beginPath(); ctxp.moveTo(x, 0); ctxp.lineTo(x, 512); ctxp.stroke(); }
    for (let y = 0; y <= 512; y += 64) { ctxp.beginPath(); ctxp.moveTo(0, y); ctxp.lineTo(512, y); ctxp.stroke(); }
    pavementTexture = new THREE.CanvasTexture(cp); pavementTexture.wrapS = pavementTexture.wrapT = THREE.RepeatWrapping; pavementTexture.repeat.set(6, 6);

    // Stone Texture for Tombstones
    stoneTexture = createTexture('#777777', '#888888');
    stoneTexture.repeat.set(1, 1);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Multiplayer Logic ---

function initMultiplayer() {
    // UI for Connection Status
    let statusDiv = document.getElementById('connection-status');
    if (!statusDiv) {
        statusDiv = document.createElement('div');
        statusDiv.id = 'connection-status';
        statusDiv.style.position = 'absolute';
        statusDiv.style.top = '90px';
        statusDiv.style.right = '20px';
        statusDiv.style.background = 'rgba(0,0,0,0.6)';
        statusDiv.style.color = '#00ff00';
        statusDiv.style.padding = '8px 15px';
        statusDiv.style.borderRadius = '20px';
        statusDiv.style.fontWeight = 'bold';
        statusDiv.style.fontSize = '14px';
        statusDiv.style.zIndex = '2000';
        statusDiv.innerText = '● En línea: 1';
        document.body.appendChild(statusDiv);
    }

    // Robust MQTT Configuration with Fallback Brokers
    // We rotate brokers if possible, or just pick a very stable one.
    // 'wss://broker.emqx.io:8084/mqtt' and 'wss://broker.hivemq.com:8000/mqtt' are good choices.
    const config = {
        appId: 'cementerio-virtual-v4-stable',
        brokerUrls: [
            'wss://broker.emqx.io:8084/mqtt',
            'wss://broker.hivemq.com:8000/mqtt'
        ]
    };

    // Feedback
    // Feedback
    console.log("Sistema: Conectando al servidor...");


    try {
        room = joinRoom(config, 'lobby');
        // Success Feedback
        setTimeout(() => {
            console.log("Sistema: ¡Conexión establecida!");
        }, 1000);
    } catch (e) {
        console.error("Multiplayer Error", e);
        console.error("Multiplayer Error", e);

    }

    // Action: update -> sends { x, y, z, ry, char, anim, name }
    const [sendPos, getPos] = room.makeAction('pos');
    sendUpdate = sendPos;
    getUpdate = getPos;

    // Log connection
    room.onPeerJoin(peerId => {
        console.log(`Peer joined: ${peerId}`);
        console.log(`Peer joined: ${peerId}`);


        // Update Count
        const count = Object.keys(peers).length + 2; // +1 new peer, +1 self
        if (statusDiv) statusDiv.innerText = `● En línea: ${count}`;

        // Force immediate update send to new peer
        if (zombieGroup) {
            sendUpdate({
                x: zombieGroup.position.x,
                y: zombieGroup.position.y,
                z: zombieGroup.position.z,
                ry: zombieGroup.rotation.y,
                char: currentCharacterName,
                anim: currentAction ? currentAction.getClip().name : 'idle',
                name: myUsername
            });
        }
    });

    room.onPeerLeave(peerId => {
        if (peers[peerId]) {
            scene.remove(peers[peerId].mesh);
            if (peers[peerId].nameTag) peers[peerId].nameTag.remove();
            delete peers[peerId];

            // Update Count
            const count = Object.keys(peers).length + 1; // +1 self
            if (statusDiv) statusDiv.innerText = `● En línea: ${count}`;
        }
    });

    // Listen
    getUpdate((data, peerId) => {
        if (!peers[peerId]) {
            createPeer(peerId, data);
        }
        updatePeer(peerId, data);
    });

    // Chat system has been removed in favor of external widget.


}

function createPeer(id, data) {
    console.log("New peer:", id, data.name);

    peers[id] = {
        mesh: new THREE.Group(),
        targetPos: new THREE.Vector3(data.x, data.y, data.z),
        targetRot: data.ry,
        char: data.char,
        mixer: null,
        nameTag: createNameTag(data.name || "Visitante")
    };
    scene.add(peers[id].mesh);

    // Placeholder for Peer
    const phGeo = new THREE.CapsuleGeometry(0.5, 1.5, 4, 8);
    const phMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 });
    const placeholder = new THREE.Mesh(phGeo, phMat);
    placeholder.userData.isPlaceholder = true;
    placeholder.castShadow = true;
    peers[id].mesh.add(placeholder);

    // Load actual GLTF
    const loader = new GLTFLoader();
    loader.load(`${data.char}/scene.gltf`, (gltf) => {
        if (!peers[id]) return;

        // Remove Placeholder
        const ph = peers[id].mesh.children.find(c => c.userData.isPlaceholder);
        if (ph) peers[id].mesh.remove(ph);

        const model = gltf.scene;

        // --- Peer Size Normalization (Robust) ---
        model.scale.set(1, 1, 1);
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3(); box.getSize(size);
        const nativeHeight = size.y;

        if (nativeHeight > 0) {
            let target = 1.3;
            if (typeof REFERENCE_HEIGHT !== 'undefined' && REFERENCE_HEIGHT !== null) {
                target = REFERENCE_HEIGHT;
            }
            const s = target / nativeHeight;
            model.scale.set(s, s, s);
        }

        model.traverse(n => { if (n.isMesh) { n.castShadow = true; } });
        peers[id].mesh.add(model);

        if (gltf.animations.length) {
            peers[id].mixer = new THREE.AnimationMixer(model);
            peers[id].clips = gltf.animations;

            // Start Animation immediately to avoid T-Pose
            const animToPlay = data.anim || 'idle';
            // Find clip
            let clip = gltf.animations.find(c => c.name === animToPlay);
            if (!clip && gltf.animations.length > 0) {
                // Fallback heuristic if name mismatch (e.g. peer uses different locale logic or just initial state)
                clip = gltf.animations.find(a => /idle/i.test(a.name)) || gltf.animations[0];
            }
            if (clip) {
                const action = peers[id].mixer.clipAction(clip);
                action.play();
                peers[id].currentAction = action;
            }
        }
    }, undefined, (err) => {
        console.error(`Error loading peer ${data.char}:`, err);
        // Leave placeholder (optional: change color)
        if (peers[id]) {
            const ph = peers[id].mesh.children.find(c => c.userData.isPlaceholder);
            if (ph) ph.material.color.setHex(0xff0000); // Red error
        }
    });
}

function updatePeer(id, data) {
    const p = peers[id];
    if (!p) return;

    p.targetPos.set(data.x, data.y, data.z);
    p.targetRot = data.ry;

    // Check for Character Swap
    if (p.char !== data.char) {
        console.log(`Peer ${id} swapped to ${data.char}`);
        p.char = data.char;

        // Remove old model
        while (p.mesh.children.length > 0) {
            p.mesh.remove(p.mesh.children[0]);
        }

        // Reload new model
        // Show Placeholder while switching
        const phGeo = new THREE.CapsuleGeometry(0.5, 1.5, 4, 8);
        const phMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5 });
        const placeholder = new THREE.Mesh(phGeo, phMat);
        placeholder.userData.isPlaceholder = true;
        p.mesh.add(placeholder);

        const loader = new GLTFLoader();
        loader.load(`${data.char}/scene.gltf`, (gltf) => {
            if (!peers[id]) return; // Peer might have left

            // Remove Placeholder
            const ph = p.mesh.children.find(c => c.userData.isPlaceholder);
            if (ph) p.mesh.remove(ph);

            const model = gltf.scene;

            // Normalize Size Logic (Robust)
            model.scale.set(1, 1, 1);
            model.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(model);
            const size = new THREE.Vector3(); box.getSize(size);

            if (size.y > 0) {
                // Determine target height. 
                // If we know Gura's height locally, use it. Otherwise guess 1.3
                // Ideally, we want EVERYONE to be 1.3m if Gura is absent.
                // But if Gura is present, use REFERENCE_HEIGHT.
                // NOTE: If REFERENCE_HEIGHT is null (Gura not loaded yet locally), 
                // we might drift. But Gura loads on init.
                let target = 1.3;
                if (typeof REFERENCE_HEIGHT !== 'undefined' && REFERENCE_HEIGHT !== null) {
                    target = REFERENCE_HEIGHT;
                }
                const s = target / size.y;
                model.scale.set(s, s, s);
            }

            model.traverse(n => { if (n.isMesh) { n.castShadow = true; } });
            p.mesh.add(model);

            if (gltf.animations.length) {
                p.mixer = new THREE.AnimationMixer(model);
                p.clips = gltf.animations;

                // Resume previous action if possible or default to idle
                const animToPlay = data.anim || 'idle';
                let clip = gltf.animations.find(c => c.name === animToPlay);
                if (!clip) clip = gltf.animations.find(a => /idle/i.test(a.name));

                if (clip) {
                    const action = p.mixer.clipAction(clip);
                    action.play();
                    p.currentAction = action;
                }
            }
        }, undefined, (err) => {
            console.error(`Error swapping to ${data.char}:`, err);
            // Keep placeholder, maybe red?
            const ph = p.mesh.children.find(c => c.userData.isPlaceholder);
            if (ph) ph.material.color.setHex(0xff0000);
        });
    }

    // Animation Sync (only if mixer exists)
    if (p.mixer && p.clips && data.anim) {
        let clip = p.clips.find(c => c.name === data.anim);
        if (!clip) clip = p.clips.find(c => c.name.toLowerCase().includes(data.anim.toLowerCase()));

        if (clip) {
            // Only switch if different
            if (!p.currentAction || p.currentAction.getClip().name !== clip.name) {
                const action = p.mixer.clipAction(clip);
                if (p.currentAction) p.currentAction.fadeOut(0.3);
                action.reset().fadeIn(0.3).play();
                p.currentAction = action;
            }
        }
    }
}

function updatePeers(delta) {
    Object.values(peers).forEach(p => {
        // Interpolate Position
        if (p.mesh.position.distanceTo(p.targetPos) > 10.0) {
            p.mesh.position.copy(p.targetPos);
        } else {
            p.mesh.position.lerp(p.targetPos, 10 * delta);
        }

        // Interpolate Rotation (Y)
        let rotDiff = p.targetRot - p.mesh.rotation.y;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
        p.mesh.rotation.y += rotDiff * 10 * delta;

        if (p.mixer) p.mixer.update(delta);

        // Update NameTag
        updateNameTagPos(p.nameTag, p.mesh.position);
    });
}

// --- Name Tags ---

function createNameTag(text) {
    const div = document.createElement('div');
    div.className = 'name-tag';
    div.innerText = text;
    document.body.appendChild(div);
    return div;
}

function updateNameTagPos(div, pos3d, heightOffset = 1.8) {
    if (!div) return;

    const v = pos3d.clone();
    v.y += heightOffset;
    v.project(camera);

    const x = (v.x * .5 + .5) * window.innerWidth;
    const y = (-(v.y * .5) + .5) * window.innerHeight;

    if (v.z < 1 && x > 0 && x < window.innerWidth && y > 0 && y < window.innerHeight) {
        div.style.display = 'block';
        div.style.left = `${x}px`;
        div.style.top = `${y}px`;
    } else {
        div.style.display = 'none';
    }
}

// Main Player Name Tag
let myNameTag = null;

// --- NPC System ---


function loadNPC(customMgr) {
    const mgr = customMgr || loadingManager;
    const loader = new GLTFLoader(mgr);
    loader.load('chilcanito/scene.gltf', (gltf) => {
        const model = gltf.scene;
        chilcanito.mesh = model;
        chilcanito.actions = {}; // Store actions

        // Scale
        model.scale.set(1, 1, 1);
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3(); box.getSize(size);
        const nativeHeight = size.y;

        if (nativeHeight > 0) {
            let target = 1.3;
            if (typeof REFERENCE_HEIGHT !== 'undefined' && REFERENCE_HEIGHT !== null) {
                target = REFERENCE_HEIGHT;
            }
            const s = target / nativeHeight;
            model.scale.set(s, s, s);
        }

        // Manual Texture Load (Force Fix)
        const texLoader = new THREE.TextureLoader(mgr);
        const manualTexture = texLoader.load('chilcanito/textures/defaultMat_diffuse.png');
        manualTexture.flipY = false;
        manualTexture.colorSpace = THREE.SRGBColorSpace;

        model.traverse(n => {
            if (n.isMesh) {
                n.castShadow = true;
                n.receiveShadow = true;

                if (n.material) {
                    // Force Manual Texture
                    n.material.map = manualTexture;
                    n.material.side = THREE.DoubleSide;

                    if (n.material.color) n.material.color.setHex(0xffffff);
                    n.material.roughness = 0.8;
                    n.material.metalness = 0.0;
                    n.material.needsUpdate = true;
                }
            }
        });

        // Initial Pos
        model.position.set(5, 0, 5);
        scene.add(model);

        // Animations Setup
        if (gltf.animations.length) {
            chilcanito.mixer = new THREE.AnimationMixer(model);

            // Find Clips
            const idleClip = gltf.animations.find(c => /idle/i.test(c.name)) || gltf.animations[0];
            const walkClip = gltf.animations.find(c => /walk/i.test(c.name));
            const runClip = gltf.animations.find(c => /run/i.test(c.name));

            // Create Actions
            chilcanito.actions.idle = chilcanito.mixer.clipAction(idleClip);
            if (walkClip) chilcanito.actions.walk = chilcanito.mixer.clipAction(walkClip);
            if (runClip) chilcanito.actions.run = chilcanito.mixer.clipAction(runClip);

            // Start Idle
            chilcanito.actions.idle.play();
            chilcanito.currentAction = chilcanito.actions.idle;
        }

        // Combo Tag (Name + Dialog)
        const container = document.createElement('div');
        container.className = 'name-tag npc-tag-container';
        container.style.display = 'none'; // Hidden until updated
        container.style.flexDirection = 'column';
        container.style.alignItems = 'center';
        container.style.pointerEvents = 'none';

        const nameDiv = document.createElement('div');
        nameDiv.innerText = "Chilcanito";
        nameDiv.style.fontWeight = 'bold';
        nameDiv.style.color = '#ffaa00';
        nameDiv.style.textShadow = '0 2px 0 #000';
        nameDiv.style.marginBottom = '2px';
        nameDiv.style.fontSize = '14px';

        const chatDiv = document.createElement('div');
        chatDiv.className = 'npc-chat-bubble';
        chatDiv.innerText = chilcanito.dialogs[0];
        chatDiv.style.background = 'white';
        chatDiv.style.color = 'black';
        chatDiv.style.padding = '5px 8px';
        chatDiv.style.borderRadius = '8px';
        chatDiv.style.fontSize = '12px';
        chatDiv.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
        chatDiv.style.maxWidth = '140px';
        chatDiv.style.textAlign = 'center';
        chatDiv.style.marginTop = '2px';

        // Little arrow for bubble
        const arrow = document.createElement('div');
        arrow.style.width = '0'; arrow.style.height = '0';
        arrow.style.borderLeft = '6px solid transparent';
        arrow.style.borderRight = '6px solid transparent';
        arrow.style.borderTop = '6px solid white';
        arrow.style.marginTop = '-1px';

        container.appendChild(nameDiv);
        container.appendChild(chatDiv);
        container.appendChild(arrow);

        document.body.appendChild(container);
        chilcanito.dialogDiv = container; // We store container here
        chilcanito.chatTextDiv = chatDiv; // Ref to text part

        // Set first target
        pickNPCTarget();

    }, undefined, (err) => console.error("Error loading NPC", err));
}

function pickNPCTarget() {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 30;
    chilcanito.targetPos = new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    chilcanito.waitTimer = 2 + Math.random() * 3;
}

function updateNPC(delta) {
    if (!chilcanito.mesh) return;

    if (chilcanito.mixer) chilcanito.mixer.update(delta);

    // Dialog Cycle
    chilcanito.dialogTimer += delta;
    if (chilcanito.dialogTimer > 5.0) {
        chilcanito.dialogTimer = 0;
        const txt = chilcanito.dialogs[Math.floor(Math.random() * chilcanito.dialogs.length)];
        if (chilcanito.chatTextDiv) {
            chilcanito.chatTextDiv.innerText = txt;
            // Pop effect
            chilcanito.chatTextDiv.style.transform = 'scale(1.1)';
            setTimeout(() => chilcanito.chatTextDiv.style.transform = 'scale(1)', 200);
        }
    }

    // Position Tag (Higher offset for stacked UI)
    if (chilcanito.dialogDiv) updateNameTagPos(chilcanito.dialogDiv, chilcanito.mesh.position, 2.2);

    // AI Movement
    if (!chilcanito.targetPos) {
        pickNPCTarget();
        return;
    }

    const dist = chilcanito.mesh.position.distanceTo(chilcanito.targetPos);
    let desiredAnim = 'idle';

    if (dist < 0.5) {
        // Arrived / Idle
        chilcanito.waitTimer -= delta;
        desiredAnim = 'idle';

        if (chilcanito.waitTimer <= 0) {
            pickNPCTarget();
        }
    } else {
        // Moving
        desiredAnim = 'walk';
        const dir = new THREE.Vector3().subVectors(chilcanito.targetPos, chilcanito.mesh.position).normalize();

        // Speed
        const speed = 2.0;
        chilcanito.mesh.position.add(dir.multiplyScalar(speed * delta));

        // Face Target
        const angle = Math.atan2(dir.x, dir.z);
        let rotDiff = angle - chilcanito.mesh.rotation.y;
        while (rotDiff > Math.PI) rotDiff -= Math.PI * 2;
        while (rotDiff < -Math.PI) rotDiff += Math.PI * 2;
        chilcanito.mesh.rotation.y += rotDiff * 5 * delta;
        // Ground
        chilcanito.mesh.position.y = getTerrainHeight(chilcanito.mesh.position.x, chilcanito.mesh.position.z);
    }

    // Animation Switch Logic
    if (chilcanito.actions && chilcanito.actions[desiredAnim]) {
        const newAction = chilcanito.actions[desiredAnim];
        if (chilcanito.currentAction !== newAction) { // Only switch if different
            if (chilcanito.currentAction) chilcanito.currentAction.fadeOut(0.2);
            newAction.reset().fadeIn(0.2).play();
            chilcanito.currentAction = newAction;
        }
    }
}

// --- Nekosan NPC ---
function loadNekosan(customMgr) {
    const mgr = customMgr || loadingManager;
    const loader = new GLTFLoader(mgr);
    loader.load('nekosan/scene.gltf', (gltf) => {
        const model = gltf.scene;
        nekosan.mesh = model;
        nekosan.actions = {};

        // Scale
        model.scale.set(1, 1, 1);
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3(); box.getSize(size);
        const nativeHeight = size.y;

        if (nativeHeight > 0) {
            let target = 1.4;
            if (typeof REFERENCE_HEIGHT !== 'undefined' && REFERENCE_HEIGHT !== null) {
                target = REFERENCE_HEIGHT;
            }
            const s = target / nativeHeight;
            model.scale.set(s, s, s);
        }

        model.traverse(n => {
            if (n.isMesh) {
                n.castShadow = true;
                n.receiveShadow = true;
                // Material Fixes
                if (n.material) {
                    n.material.side = THREE.DoubleSide;
                    if (n.material.map) n.material.map.colorSpace = THREE.SRGBColorSpace;
                    if (n.material.color) n.material.color.setHex(0xffffff);
                    n.material.roughness = 0.7;
                    n.material.metalness = 0.0;
                }
            }
        });

        // Initial Pos (Standing by a bench, facing fountain)
        // Bench at Rad 32, Angle PI/8. placing slightly offset.
        model.position.set(28, 0, 10);
        model.lookAt(0, 0, 0); // Face the central fountain
        scene.add(model);

        // Animations
        if (gltf.animations.length) {
            nekosan.mixer = new THREE.AnimationMixer(model);

            const idle = gltf.animations.find(c => /idle/i.test(c.name)) || gltf.animations[0];
            const walk = gltf.animations.find(c => /walk/i.test(c.name));

            nekosan.actions.idle = nekosan.mixer.clipAction(idle);
            if (walk) nekosan.actions.walk = nekosan.mixer.clipAction(walk);

            nekosan.actions.idle.play();
            nekosan.currentAction = nekosan.actions.idle;
        }

        // Tag
        const container = document.createElement('div');
        container.className = 'name-tag npc-tag-container';
        container.style.display = 'none';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'center';
        container.style.pointerEvents = 'none';

        const nameDiv = document.createElement('div');
        nameDiv.innerText = "Neko-san";
        nameDiv.style.fontWeight = 'bold';
        nameDiv.style.color = '#ff69b4';
        nameDiv.style.textShadow = '0 2px 0 #000';
        nameDiv.style.marginBottom = '2px';
        nameDiv.style.fontSize = '14px';

        const chatDiv = document.createElement('div');
        chatDiv.className = 'npc-chat-bubble';
        chatDiv.innerText = nekosan.dialogs[0];
        chatDiv.style.background = 'white';
        chatDiv.style.color = '#d10069';
        chatDiv.style.padding = '5px 8px';
        chatDiv.style.borderRadius = '8px';
        chatDiv.style.fontSize = '12px';
        chatDiv.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
        chatDiv.style.maxWidth = '160px';
        chatDiv.style.textAlign = 'center';
        chatDiv.style.marginTop = '2px';
        chatDiv.style.border = '1px solid #ff69b4';

        const arrow = document.createElement('div');
        arrow.style.width = '0'; arrow.style.height = '0';
        arrow.style.borderLeft = '6px solid transparent';
        arrow.style.borderRight = '6px solid transparent';
        arrow.style.borderTop = '6px solid white';
        arrow.style.marginTop = '-1px';

        container.appendChild(nameDiv);
        container.appendChild(chatDiv);
        container.appendChild(arrow);
        document.body.appendChild(container);
        nekosan.dialogDiv = container;
        nekosan.chatTextDiv = chatDiv;

        // pickNekosanTarget(); // DISABLED for Static Pose

    }, undefined, (err) => console.error("Error loading Nekosan", err));
}

function pickNekosanTarget() {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * 25;
    nekosan.targetPos = new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r);
    nekosan.waitTimer = 3 + Math.random() * 4;
}

function updateNekosan(delta) {
    if (!nekosan.mesh) return;
    if (nekosan.mixer) nekosan.mixer.update(delta);

    // Dialog
    nekosan.dialogTimer += delta;
    if (nekosan.dialogTimer > 6.0) {
        nekosan.dialogTimer = 0;
        const txt = nekosan.dialogs[Math.floor(Math.random() * nekosan.dialogs.length)];
        if (nekosan.chatTextDiv) {
            nekosan.chatTextDiv.innerText = txt;
            nekosan.chatTextDiv.style.transform = 'scale(1.1) rotate(2deg)';
            setTimeout(() => nekosan.chatTextDiv.style.transform = 'scale(1) rotate(0deg)', 200);
        }
    }
    if (nekosan.dialogDiv) updateNameTagPos(nekosan.dialogDiv, nekosan.mesh.position, 2.3);

    // STATIC - No Movement
    // Just facing slightly towards center naturally from initial rotation?
    // We can force a rotation if needed.
    // nekosan.mesh.lookAt(0, 0, 0); // Optional: Face center
}

// --- Renzo NPC (The 2D Sprite) ---
let renzoValues = {
    sprite: null,
    dialogDiv: null,
    floatTime: 0
};

function loadRenzoNPC(customMgr) {
    // 1. Load Texture
    const loader = new THREE.TextureLoader(customMgr || loadingManager);
    loader.load('Renzo.png', (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;

        // 2. Create Material
        const mat = new THREE.SpriteMaterial({ map: tex, color: 0xffffff });

        // 3. Create Sprite
        const sprite = new THREE.Sprite(mat);

        // 4. Scale & Position
        sprite.scale.set(2.5, 3.5, 1); // Taller (3.5) to fix aspect ratio
        sprite.position.set(-8, 1, 0);
        sprite.position.y = 1.75 + getTerrainHeight(-8, 0); // Correct center height

        // Fake Shadow
        const shadowGeo = new THREE.CircleGeometry(0.5, 32);
        shadowGeo.rotateX(-Math.PI / 2);
        const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3 });
        const shadow = new THREE.Mesh(shadowGeo, shadowMat);
        shadow.position.y = -0.7; // Relative to sprite center
        sprite.add(shadow);

        scene.add(sprite);
        renzoValues.sprite = sprite;

        // 5. UI Tag
        const container = document.createElement('div');
        container.className = 'name-tag npc-tag-container';
        container.style.display = 'none';
        container.style.flexDirection = 'column';
        container.style.alignItems = 'center';
        container.style.pointerEvents = 'none';

        const nameDiv = document.createElement('div');
        nameDiv.innerText = "Renzo";
        nameDiv.style.fontWeight = 'bold';
        nameDiv.style.color = '#ff3333';
        nameDiv.style.textShadow = '0 2px 0 #000';
        nameDiv.style.marginBottom = '2px';
        nameDiv.style.fontSize = '14px';

        const chatDiv = document.createElement('div');
        chatDiv.className = 'npc-chat-bubble';
        chatDiv.innerText = "¿Quieres revivir a un muerto?";
        chatDiv.style.background = 'white';
        chatDiv.style.color = 'black';
        chatDiv.style.padding = '8px 12px';
        chatDiv.style.borderRadius = '8px';
        chatDiv.style.fontSize = '14px';
        chatDiv.style.marginTop = '0px';
        chatDiv.style.width = 'max-content';
        chatDiv.style.maxWidth = '250px';
        chatDiv.style.textAlign = 'center';
        chatDiv.style.fontWeight = '600';

        // Little arrow
        const arrow = document.createElement('div');
        arrow.style.width = '0'; arrow.style.height = '0';
        arrow.style.borderLeft = '6px solid transparent';
        arrow.style.borderRight = '6px solid transparent';
        arrow.style.borderTop = '6px solid white';
        arrow.style.marginTop = '-1px';

        container.appendChild(nameDiv);
        container.appendChild(chatDiv);
        container.appendChild(arrow);

        document.body.appendChild(container);
        renzoValues.dialogDiv = container;

    });
}

function updateRenzo(delta) {
    if (!renzoValues.sprite) return;

    // Floating effect
    renzoValues.floatTime += delta;
    const baseH = getTerrainHeight(renzoValues.sprite.position.x, renzoValues.sprite.position.z) + 1.75;
    renzoValues.sprite.position.y = baseH + Math.sin(renzoValues.floatTime * 2) * 0.05;

    // Update Tag
    if (renzoValues.dialogDiv) updateNameTagPos(renzoValues.dialogDiv, renzoValues.sprite.position, 2.4);
}

// --- Vehicle System (Car) ---
let honda = {
    mesh: null,
    active: false,
    speed: 0,
    steering: 0,
    velocity: new THREE.Vector3(),
    maxSpeed: 30.0,
    acceleration: 15.0,
    friction: 2.0,
    turnSpeed: 3.5,
    seats: { driver: null },
    returnTimer: 0
};

function loadHonda(customMgr) {
    const loader = new GLTFLoader(customMgr || loadingManager);
    loader.load('car/scene.gltf', (gltf) => {
        const model = gltf.scene;

        // --- Physics Wrapper ---
        // Create a parent group to handle physics (Z-forward)
        // while the child model handles visual rotation.
        const wrapper = new THREE.Group();
        wrapper.add(model);
        honda.mesh = wrapper;

        // Visual Correction: Rotate inner model 90 degrees (Flip 180 from previous)
        model.rotation.y = Math.PI / 2;

        // Scale Logic (Apply to inner model)
        model.scale.set(1, 1, 1);
        model.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3(); box.getSize(size);

        const maxDim = Math.max(size.x, size.y, size.z);
        if (maxDim > 0) {
            const desiredSize = 6.5;
            const scale = desiredSize / maxDim;
            model.scale.set(scale, scale, scale);
        }

        // Pos (Apply to Wrapper)
        wrapper.position.set(0, 0, 15);
        wrapper.position.y = getTerrainHeight(0, 15);

        // Shadow Fixes
        model.traverse(n => {
            if (n.isMesh) {
                // Fix Square Shadow: Check for transparent/invisible helper meshes
                if (n.material && (n.material.transparent || n.material.opacity < 1.0)) {
                    n.castShadow = false;
                } else if (n.name.toLowerCase().includes('shadow') || n.name.toLowerCase().includes('bound')) {
                    n.castShadow = false;
                } else {
                    n.castShadow = true;
                    n.receiveShadow = true;
                }
            }
        });

        scene.add(wrapper);

        // Hint UI (Interactive for Mobile)
        const hintDiv = document.createElement('div');
        hintDiv.className = 'interaction-hint';
        hintDiv.innerText = "Presiona F o Toca para Conducir";
        hintDiv.style.position = 'absolute';
        hintDiv.style.background = 'rgba(0,0,0,0.85)';
        hintDiv.style.color = '#4caf50';
        hintDiv.style.border = '2px solid #4caf50';
        hintDiv.style.padding = '12px 24px';
        hintDiv.style.borderRadius = '30px';
        hintDiv.style.top = '80%';
        hintDiv.style.left = '50%';
        hintDiv.style.transform = 'translate(-50%, -50%)';
        hintDiv.style.display = 'none';
        hintDiv.style.pointerEvents = 'auto'; // Allow clicking
        hintDiv.style.cursor = 'pointer';
        hintDiv.style.fontWeight = 'bold';
        hintDiv.style.fontSize = '18px';
        hintDiv.style.zIndex = '2000';
        hintDiv.style.boxShadow = '0 0 15px #4caf50';
        document.body.appendChild(hintDiv);
        honda.hintDiv = hintDiv;

        // Interaction Handler (Click/Touch)
        const interactHandler = (e) => {
            if (e.type === 'touchstart') e.preventDefault();
            if (honda.mesh && zombieGroup) {
                const dist = honda.mesh.position.distanceTo(zombieGroup.position);
                if ((!honda.active && dist < 5.0) || honda.active) {
                    toggleHonda();
                }
            }
        };
        hintDiv.addEventListener('click', interactHandler);
        hintDiv.addEventListener('touchstart', interactHandler);

        // F Key Listener
        document.addEventListener('keydown', (e) => {
            if (e.key.toLowerCase() === 'f') {
                if (honda.mesh && zombieGroup) {
                    const dist = honda.mesh.position.distanceTo(zombieGroup.position);
                    if ((!honda.active && dist < 5.0) || honda.active) {
                        toggleHonda();
                    }
                }
            }
        });

    }, undefined, err => console.error("Error loading Car", err));
}

function updateHonda(delta) {
    if (!honda.mesh) return;

    // Proximity Update for UI Hint & Auto-Return
    if (!honda.active && zombieGroup) {
        const dist = honda.mesh.position.distanceTo(zombieGroup.position);

        // UI Hint
        if (dist < 5.0) {
            if (honda.hintDiv) honda.hintDiv.style.display = 'block';
        } else {
            if (honda.hintDiv) honda.hintDiv.style.display = 'none';
        }

        // Auto-Return Logic
        const distFromSpawn = honda.mesh.position.distanceTo(new THREE.Vector3(0, 0, 15));
        if (distFromSpawn > 40.0 && dist > 20.0) { // If far from spawn AND far from player
            honda.returnTimer += delta;
            if (honda.returnTimer > 5.0) {
                // Return to Plaza
                honda.mesh.position.set(0, 0, 15);
                honda.mesh.rotation.set(0, 0, 0);
                honda.speed = 0;
                honda.returnTimer = 0;
                honda.mesh.position.y = getTerrainHeight(0, 15);
            }
        } else {
            honda.returnTimer = 0;
        }

    } else if (honda.active) {
        if (honda.hintDiv) honda.hintDiv.innerText = "Presiona F o Toca para Salir";
    }

    if (honda.active) {
        // DRIVING PHYSICS

        // Accel
        // Fix: Use joystickVector instead of joystickMove which was undefined
        // Fix: Use joystickVector from global scope
        const moveForward = (keys.KeyW || keys.ArrowUp || joystickVector.y < -0.2); // Joystick Y is -1 when forward
        const moveBackward = (keys.KeyS || keys.ArrowDown || joystickVector.y > 0.2);
        const turnLeft = (keys.KeyA || keys.ArrowLeft || joystickVector.x < -0.2);
        const turnRight = (keys.KeyD || keys.ArrowRight || joystickVector.x > 0.2);

        if (moveForward) {
            honda.speed += honda.acceleration * delta;
        } else if (moveBackward) {
            honda.speed -= honda.acceleration * delta;
        } else {
            // Decel
            if (honda.speed > 0) honda.speed = Math.max(0, honda.speed - honda.friction * delta);
            else if (honda.speed < 0) honda.speed = Math.min(0, honda.speed + honda.friction * delta);
        }

        // Cap speed
        honda.speed = Math.min(Math.max(honda.speed, -honda.maxSpeed / 2), honda.maxSpeed);

        // Turn
        if (Math.abs(honda.speed) > 0.1) {
            const dir = honda.speed > 0 ? 1 : -1;
            if (turnLeft) honda.mesh.rotation.y += honda.turnSpeed * delta * dir;
            if (turnRight) honda.mesh.rotation.y -= honda.turnSpeed * delta * dir;
        }

        // Apply Velocity
        const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), honda.mesh.rotation.y);
        honda.mesh.position.add(forward.multiplyScalar(honda.speed * delta));

        // Terrain Follow
        honda.mesh.position.y = getTerrainHeight(honda.mesh.position.x, honda.mesh.position.z);

        // Snap Character to Car
        if (zombieGroup) {
            zombieGroup.position.copy(honda.mesh.position);
            zombieGroup.rotation.y = honda.mesh.rotation.y;
            zombieGroup.visible = false;
        }

        // Camera Follow - Loose Chase Cam
        // Disable OrbitControls auto-update? Or just override
        const offset = new THREE.Vector3(0, 3.5, -9).applyAxisAngle(new THREE.Vector3(0, 1, 0), honda.mesh.rotation.y);
        const targetCamPos = honda.mesh.position.clone().add(offset);

        // Smooth Lerp
        camera.position.lerp(targetCamPos, 4.0 * delta);
        camera.lookAt(honda.mesh.position.clone().add(new THREE.Vector3(0, 1, 0)));

        // Update controls target so if we exit, controls are nearby
        controls.target.copy(honda.mesh.position);
    }
}

function toggleHonda() {
    honda.active = !honda.active;
    if (honda.active) {
        // Enter
        if (zombieGroup) zombieGroup.visible = false;
        // Disable OrbitControls to prevent fighting
        controls.enabled = false;
    } else {
        // Exit
        if (zombieGroup) {
            zombieGroup.visible = true;
            zombieGroup.position.copy(honda.mesh.position);
            const sideOffset = new THREE.Vector3(3, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), honda.mesh.rotation.y);
            zombieGroup.position.add(sideOffset);

            // Adjust to terrain
            zombieGroup.position.y = getTerrainHeight(zombieGroup.position.x, zombieGroup.position.z);
        }
        // Re-enable controls
        controls.enabled = true;
        // Reset camera offset slightly so it doesn't snap weirdly
        controls.target.copy(zombieGroup.position);
    }
}


// --- Chat Utils ---
// Chat functions removed.
