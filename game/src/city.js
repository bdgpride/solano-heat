// city.js — builds Port Solano: a 9x9 street grid of pastel deco blocks on a
// sunset coast, with a beach and marina to the west. Everything is procedural
// (canvas textures for facades and asphalt, boxes and cylinders for geometry),
// so the game ships no image or model files. The module also owns the static
// collision boxes and the street layout data the traffic and pedestrian AI
// navigate by.

export const PITCH = 46;            // metres between road centre lines
export const ROAD_HALF = 7;         // half the width of a road
export const WALK_OFF = 10.6;       // sidewalk centre offset from a road line
export const GRID_MIN = -184, GRID_MAX = 184;   // outermost road lines
export const BEACH_X = -222;        // where the promenade meets the sand
export const WATER_X = -262;        // shoreline

const LINES = [];
for (let i = -4; i <= 4; i++) LINES.push(i * PITCH);
export const ROAD_LINES = LINES;

function facadeTexture(rng, base, litRatio) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  const cols = 6, rows = 12;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const lit = rng.next() < litRatio;
    g.fillStyle = lit ? '#ffd98c' : '#2c3542';
    g.fillRect(8 + x * 20, 10 + y * 20, 12, 13);
  }
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 246, 128, 10);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 2;
  return tex;
}

function asphaltTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#33373d'; g.fillRect(0, 0, 64, 128);
  g.fillStyle = '#f7d774';
  g.fillRect(30, 8, 4, 44); g.fillRect(30, 76, 4, 44);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makePalm(rng, h) {
  const palm = new THREE.Group();
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6b48 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, h, 5), trunkMat);
  trunk.position.y = h / 2;
  trunk.rotation.z = rng.range(-0.09, 0.09);
  palm.add(trunk);
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f8f4f, side: THREE.DoubleSide });
  const top = new THREE.Group();
  top.position.set(Math.sin(trunk.rotation.z) * -h * 0.5 + trunk.rotation.z * -h * 0.4, h, 0);
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 3.9), leafMat);
    const pivot = new THREE.Group();
    leaf.position.y = 1.35;
    leaf.rotation.x = 1.28;
    pivot.add(leaf);
    pivot.rotation.y = (i / 5) * Math.PI * 2 + rng.range(-0.25, 0.25);
    pivot.rotation.x = rng.range(-0.12, 0.12);
    top.add(pivot);
  }
  const nuts = new THREE.Mesh(new THREE.SphereGeometry(0.42, 6, 5),
    new THREE.MeshLambertMaterial({ color: 0x6e5636 }));
  top.add(nuts);
  palm.add(top);
  return palm;
}

function makeBoat(rng) {
  const boat = new THREE.Group();
  const hullColor = rng.pick([0xf2f0ea, 0x7fd1d8, 0xe8836b, 0x9fc2e8]);
  const hull = new THREE.Mesh(new THREE.BoxGeometry(7, 1.6, 2.6),
    new THREE.MeshLambertMaterial({ color: hullColor }));
  hull.position.y = 0.5;
  const bow = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 1.8),
    new THREE.MeshLambertMaterial({ color: hullColor }));
  bow.position.set(4.2, 0.5, 0); bow.rotation.y = 0.6;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.2, 1.9),
    new THREE.MeshLambertMaterial({ color: 0xffffff }));
  cabin.position.set(-0.6, 1.8, 0);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 6, 5),
    new THREE.MeshLambertMaterial({ color: 0xcccccc }));
  mast.position.set(1.4, 3.6, 0);
  boat.add(hull, bow, cabin, mast);
  return boat;
}

export function buildCity(scene, rng) {
  const world = {
    colliders: [],        // {minX, maxX, minZ, maxZ}
    parkedSpots: [],      // {x, z, heading}
    palmPositions: [],
    ocean: null,
    sunSprite: null,
    locations: {},
    update(dt, t) {
      if (this.ocean) {
        this.ocean.position.y = 0.25 + Math.sin(t * 0.5) * 0.12;
        this.ocean.position.x = WATER_X - 348 + Math.sin(t * 0.21) * 2.5;
      }
    },
  };

  // --- sky, light, fog -----------------------------------------------------
  const skyC = document.createElement('canvas');
  skyC.width = 4; skyC.height = 256;
  const sg = skyC.getContext('2d');
  const grad = sg.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#274069'); grad.addColorStop(0.45, '#7a5a8c');
  grad.addColorStop(0.72, '#e2703a'); grad.addColorStop(0.92, '#ffb36b');
  grad.addColorStop(1, '#ffd9a0');
  sg.fillStyle = grad; sg.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyC);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 16, 12),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
  scene.add(sky);
  scene.fog = new THREE.Fog(0xe88a54, 150, 1150);
  const sun = new THREE.Mesh(new THREE.CircleGeometry(60, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe9b0, fog: false }));
  sun.position.set(-1250, 190, -350); sun.lookAt(0, 40, 0);
  scene.add(sun);
  world.sunSprite = sun;
  const dir = new THREE.DirectionalLight(0xffb36b, 1.15);
  dir.position.set(-300, 180, -120);
  scene.add(dir);
  scene.add(new THREE.HemisphereLight(0x93b4e8, 0xffd9a8, 0.55));
  scene.add(new THREE.AmbientLight(0x604a3a, 0.5));

  // --- ground, roads, sidewalks -------------------------------------------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1500, 1500),
    new THREE.MeshLambertMaterial({ color: 0x8d8271 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
  scene.add(ground);

  const walkMat = new THREE.MeshLambertMaterial({ color: 0xb3a78d });
  const asphalt = asphaltTexture();
  const roadMat = new THREE.MeshLambertMaterial({ map: asphalt });
  const span = GRID_MAX - GRID_MIN + PITCH * 2; // roads run a bit past the grid
  for (const v of LINES) {
    for (const horizontal of [false, true]) {
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(span, WALK_OFF * 2 + 1.5), walkMat);
      walk.rotation.x = -Math.PI / 2;
      walk.rotation.z = horizontal ? 0 : Math.PI / 2;
      walk.position.set(horizontal ? 0 : v, 0.01, horizontal ? v : 0);
      scene.add(walk);
      const tex = asphalt.clone();
      tex.needsUpdate = true;
      tex.repeat.set(1, span / 24);
      const mat = new THREE.MeshLambertMaterial({ map: tex });
      const road = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, span), mat);
      road.rotation.x = -Math.PI / 2;
      road.rotation.z = horizontal ? Math.PI / 2 : 0;
      road.position.set(horizontal ? 0 : v, 0.03, horizontal ? v : 0);
      scene.add(road);
    }
  }
  void roadMat;

  // Promenade + beach + ocean.
  const prom = new THREE.Mesh(new THREE.PlaneGeometry(14, 760),
    new THREE.MeshLambertMaterial({ color: 0xcdbb96 }));
  prom.rotation.x = -Math.PI / 2;
  prom.position.set(BEACH_X + 4, 0.02, 0);
  scene.add(prom);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(WATER_X - BEACH_X + 60, 900),
    new THREE.MeshLambertMaterial({ color: 0xe8d09c }));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set((BEACH_X + WATER_X) / 2 - 8, 0.005, 0);
  scene.add(sand);
  const ocean = new THREE.Mesh(new THREE.PlaneGeometry(700, 1600),
    new THREE.MeshLambertMaterial({ color: 0x1b6d8f, transparent: true, opacity: 0.92 }));
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(WATER_X - 348, 0.25, 0);
  scene.add(ocean);
  world.ocean = ocean;

  // --- buildings ------------------------------------------------------------
  const pastels = ['#f2c4b3', '#e8b4b8', '#f7e3b0', '#bfe3dd', '#c9d6f2', '#f2d5e8', '#e6e0c8', '#ffd9a8'];
  const facades = pastels.map((p) => facadeTexture(rng, p, 0.4));
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x6b5a4a });
  const addCollider = (cx, cz, w, d) => world.colliders.push({
    minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2,
  });

  function building(cx, cz, w, d, h, tex) {
    const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffbe78, emissiveMap: tex, emissiveIntensity: 0.5 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    b.position.set(cx, h / 2, cz);
    scene.add(b);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, 0.7, d + 0.7), roofMat);
    roof.position.set(cx, h + 0.35, cz);
    scene.add(roof);
    if (rng.chance(0.4)) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.6, 7), roofMat);
      tank.position.set(cx + rng.range(-w / 4, w / 4), h + 1.9, cz + rng.range(-d / 4, d / 4));
      scene.add(tank);
    }
    addCollider(cx, cz, w, d);
    return b;
  }

  // Landmark blocks are claimed first so the random fill skips them.
  const claimed = new Set();
  const key = (bx, bz) => bx + ',' + bz;
  function landmark(bx, bz, w, d, h, color, signColor, locName) {
    claimed.add(key(bx, bz));
    const cx = bx * PITCH + PITCH / 2, cz = bz * PITCH + PITCH / 2;
    const tex = facadeTexture(rng, color, 0.55);
    building(cx, cz, w, d, h, tex);
    if (signColor) {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, 2.2, 0.4),
        new THREE.MeshLambertMaterial({ color: signColor, emissive: signColor, emissiveIntensity: 0.7 }));
      sign.position.set(cx, h - 2, cz - d / 2 - 0.3);
      scene.add(sign);
    }
    world.locations[locName] = { x: cx, z: cz + d / 2 + 6 };
    return { cx, cz };
  }
  landmark(2, 0, 26, 18, 16, '#f4f6f8', 0xe33f3f, 'hospital');       // Solano General
  landmark(-2, 1, 24, 16, 13, '#b9c6d8', 0x2b4d9b, 'police');       // SPPD station
  landmark(3, -3, 24, 20, 8, '#cbb59a', 0x8a5a2b, 'stash');          // Cordero stash house
  landmark(1, -2, 22, 16, 20, '#f7e3b0', 0xd8542e, 'bar');           // the Coral Bar (M1 drop)
  world.locations.hospitalRespawn = { x: 115, z: 38 };
  world.locations.policeRespawn = { x: -69, z: 83 };

  for (let bx = -4; bx < 4; bx++) for (let bz = -4; bz < 4; bz++) {
    if (claimed.has(key(bx, bz))) continue;
    const cx = bx * PITCH + PITCH / 2, cz = bz * PITCH + PITCH / 2;
    const roll = rng.next();
    if (roll < 0.13) {
      // Parking lot: flat slab plus marked spots the game fills with cars.
      const lot = new THREE.Mesh(new THREE.PlaneGeometry(30, 30),
        new THREE.MeshLambertMaterial({ color: 0x4a4d52 }));
      lot.rotation.x = -Math.PI / 2; lot.position.set(cx, 0.04, cz);
      scene.add(lot);
      for (let i = 0; i < 5; i++) {
        world.parkedSpots.push({ x: cx - 12 + i * 6, z: cz - 8, heading: 0 });
        world.parkedSpots.push({ x: cx - 12 + i * 6, z: cz + 8, heading: Math.PI });
      }
    } else if (roll < 0.22) {
      // Palm plaza.
      const plaza = new THREE.Mesh(new THREE.PlaneGeometry(32, 32),
        new THREE.MeshLambertMaterial({ color: 0xd8c9a3 }));
      plaza.rotation.x = -Math.PI / 2; plaza.position.set(cx, 0.04, cz);
      scene.add(plaza);
      for (let i = 0; i < 5; i++) {
        const px = cx + rng.range(-12, 12), pz = cz + rng.range(-12, 12);
        const palm = makePalm(rng, rng.range(5.5, 8));
        palm.position.set(px, 0, pz);
        scene.add(palm);
      }
    } else {
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) {
        const w = rng.range(10, 17), d = rng.range(10, 17);
        // Keep every facade at least ~11 m from the road lines, so curb
        // parking and sidewalks never end up inside a building.
        const lim = Math.max(0, 11.5 - Math.max(w, d) / 2);
        const ox = n === 1 ? 0 : rng.range(-lim, lim);
        const oz = n === 1 ? 0 : rng.range(-lim, lim);
        const centreBoost = 1 - Math.min(1, Math.hypot(cx, cz) / 320);
        const h = rng.range(9, 20) + centreBoost * rng.range(4, 26);
        building(cx + ox, cz + oz, w, d, h, rng.pick(facades));
      }
    }
  }

  // Curb parking along two boulevards.
  for (const lineZ of [-46, 46]) for (let x = -170; x <= 170; x += 17) {
    if (rng.chance(0.75)) world.parkedSpots.push({ x: x + rng.range(-2, 2), z: lineZ - ROAD_HALF - 2.2, heading: Math.PI / 2 });
    if (rng.chance(0.75)) world.parkedSpots.push({ x: x + rng.range(-2, 2), z: lineZ + ROAD_HALF + 2.2, heading: -Math.PI / 2 });
  }

  // --- promenade palms + streetlights --------------------------------------
  for (let z = -330; z <= 330; z += 37) {
    const palm = makePalm(rng, rng.range(6, 9));
    palm.position.set(BEACH_X + 2, 0, z + rng.range(-3, 3));
    scene.add(palm);
  }
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xffd9a0, emissive: 0xffc978, emissiveIntensity: 1.4 });
  for (const lx of [-92, 0, 92]) for (let z = -200; z <= 200; z += 40) {
    for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 6.4, 5), poleMat);
      pole.position.set(lx + s * (ROAD_HALF + 1.2), 3.2, z);
      scene.add(pole);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), lampMat);
      lamp.position.set(lx + s * (ROAD_HALF + 1.2), 6.5, z);
      scene.add(lamp);
    }
  }

  // --- marina ----------------------------------------------------------------
  const dockMat = new THREE.MeshLambertMaterial({ color: 0x8a6b48 });
  for (let i = 0; i < 3; i++) {
    const dz = 128 + i * 30;
    const dock = new THREE.Mesh(new THREE.BoxGeometry(46, 1, 5), dockMat);
    dock.position.set(WATER_X - 18, 0.8, dz);
    scene.add(dock);
    for (let b = 0; b < 3; b++) {
      const boat = makeBoat(rng);
      boat.position.set(WATER_X - 8 - b * 13, 0.4, dz + (b % 2 ? 5.5 : -5.5));
      boat.rotation.y = rng.range(-0.15, 0.15);
      scene.add(boat);
    }
  }
  // Marisol's garage: a wide, low workshop facing the promenade.
  const garageTex = facadeTexture(rng, '#e8836b', 0.5);
  building(BEACH_X - 6, 96, 20, 16, 7, garageTex);
  world.locations.garage = { x: BEACH_X + 6, z: 96 };
  // Beach safehouse at the south end of the sand.
  const safeTex = facadeTexture(rng, '#bfe3dd', 0.5);
  building(BEACH_X - 4, -196, 12, 10, 6, safeTex);
  world.locations.safehouse = { x: BEACH_X + 8, z: -196 };
  world.locations.spawn = { x: BEACH_X + 6, z: 128 };
  world.locations.barDoor = { x: 69, z: -52 };

  return world;
}

// Push a circle (x, z, radius r) out of every building box; returns the
// corrected position via the passed object. Used by the player, pedestrians
// and cars alike.
export function resolveCollisions(pos, r, world) {
  for (const c of world.colliders) {
    const nx = Math.max(c.minX, Math.min(c.maxX, pos.x));
    const nz = Math.max(c.minZ, Math.min(c.maxZ, pos.z));
    let dx = pos.x - nx, dz = pos.z - nz;
    let d2 = dx * dx + dz * dz;
    if (d2 > r * r) continue;
    if (d2 < 1e-6) {
      // Centre inside the box: push out along the smallest penetration.
      const left = pos.x - c.minX, right = c.maxX - pos.x;
      const top = pos.z - c.minZ, bottom = c.maxZ - pos.z;
      const m = Math.min(left, right, top, bottom);
      if (m === left) pos.x = c.minX - r;
      else if (m === right) pos.x = c.maxX + r;
      else if (m === top) pos.z = c.minZ - r;
      else pos.z = c.maxZ + r;
      continue;
    }
    const d = Math.sqrt(d2);
    pos.x = nx + (dx / d) * r;
    pos.z = nz + (dz / d) * r;
  }
  return pos;
}
