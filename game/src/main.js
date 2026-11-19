// main.js — Solano Heat's bootstrap and game loop. It builds the world, owns
// the player (on foot and behind the wheel), resolves combat and collisions
// between every moving thing, drives the camera, and wires the mission,
// police, traffic and pedestrian systems together. It also stages the four
// deterministic screenshot scenes (?shot=1..4) the entry is judged by.

import { RNG } from './rng.js';
import { AudioEngine } from './audio.js';
import { buildCity, resolveCollisions } from './city.js';
import { Car, TrafficCar, CAR_COLORS } from './vehicles.js';
import { makePersonMesh, animateWalk, Pedestrian, GangMember } from './people.js';
import { PoliceSystem } from './police.js';
import { MissionSystem } from './missions.js';
import { HUD } from './hud.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') ? Number(params.get('shot')) : 0;
const SEED = Number(params.get('seed') || 7);
const rng = new RNG(SEED);

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 3000);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const world = buildCity(scene, rng);
const hud = new HUD();
const audio = new AudioEngine();
const police = new PoliceSystem(scene, world, rng);

// ---------------------------------------------------------------- entities
const cars = [];        // every Car in the world
const traffic = [];     // TrafficCar controllers
const peds = [];
const gangs = [];
const pickups = [];

for (const spot of world.parkedSpots) {
  if (!rng.chance(0.4)) continue;
  const car = new Car(scene, rng.pick(['sedan', 'coupe', 'pickup', 'van']), rng.pick(CAR_COLORS), spot.x, spot.z, spot.heading);
  car.driver = 'parked';
  cars.push(car);
}
for (let i = 0; i < 12; i++) traffic.push(new TrafficCar(scene, rng, world, cars));
for (let i = 0; i < 22; i++) peds.push(new Pedestrian(scene, rng, world));
// A few Cordero lookouts loiter near the stash house even between missions.
for (let i = 0; i < 4; i++) {
  gangs.push(new GangMember(scene, 161 + rng.range(-16, 16), -99 + rng.range(-14, 14), rng));
}

function addPickup(kind, x, z) {
  const colors = { health: 0xe84f3d, armour: 0x3fa7d6, ammo: 0xf2a541 };
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshLambertMaterial({ color: colors[kind], emissive: colors[kind], emissiveIntensity: 0.45 }));
  mesh.position.set(x, 1, z);
  scene.add(mesh);
  pickups.push({ kind, mesh, x, z, timer: 0 });
}
addPickup('health', 115, 40);
addPickup('health', 161, -92);
addPickup('armour', -69, 86);
addPickup('armour', -228, 100);
addPickup('ammo', 168, -106);
addPickup('ammo', -228, 90);

// ---------------------------------------------------------------- player
const player = {
  mesh: makePersonMesh({ skin: 0xc68863, shirt: 0x14635d, pants: 0x2e3a46, hair: 0x191410 }),
  heading: Math.PI, phase: 0,
  health: 100, armour: 0, cash: 250,
  ammo: 12, reserve: 60, reloading: 0, fireTimer: 0,
  inCar: null, speedNow: 0, dead: false,
};
player.mesh.position.set(world.locations.spawn.x, 0, world.locations.spawn.z);
scene.add(player.mesh);
const playerPos = () => player.inCar ? player.inCar.pos : player.mesh.position;
const playerVel = () => player.inCar
  ? { x: Math.cos(player.inCar.heading) * player.inCar.speed, z: -Math.sin(player.inCar.heading) * player.inCar.speed }
  : { x: 0, z: 0 };

// ---------------------------------------------------------------- missions
let dialogueQueue = [];
const missions = new MissionSystem({
  pay(amount, reason) {
    player.cash += amount;
    hud.toast(reason.toUpperCase() + ' COMPLETE', '+$' + amount);
    saveGame();
  },
  toast(t, s) { hud.toast(t, s); },
  crime(points) { police.addHeat(points); },
  lockWanted(n) { police.lockedStars = n; },
  clearWanted() { police.heat = 0; },
  queueDialogue(lines) { dialogueQueue.push(...lines); },
  success() { audio.success(); },
  fail() { audio.fail(); },
  cashSound() { audio.cash(); },
  wantTargetCar() {
    if (missions.targetCar) return;
    const car = new Car(scene, 'coupe', 0xd4af37, 58, 55.2, -Math.PI / 2);
    car.driver = 'parked';
    car.isTarget = true;
    cars.push(car);
    missions.targetCar = car;
  },
});

// Gold objective beacon + a teal one for taxi fares.
function makeBeacon(color) {
  const geo = new THREE.CylinderGeometry(1.7, 1.7, 34, 12, 1, true);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 17;
  const grp = new THREE.Group();
  grp.add(m);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.9, 2.5, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  grp.add(ring);
  grp.visible = false;
  scene.add(grp);
  return grp;
}
const beacon = makeBeacon(0xffd23f);
const fareBeacon = makeBeacon(0x2ec4b6);

// ---------------------------------------------------------------- save
const SAVE_KEY = 'solano-heat-save-v1';
function saveGame() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ storyIndex: missions.storyIndex, cash: player.cash })); } catch { /* private mode */ }
}
function loadGame() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s) { missions.storyIndex = Math.min(5, s.storyIndex | 0); player.cash = s.cash | 0; return true; }
  } catch { /* no save */ }
  return false;
}
const hasSave = loadGame();

// ---------------------------------------------------------------- input
const keys = new Set();
let mouseDown = false;
let camYaw = Math.PI, camPitch = 0.32;
let state = SHOT ? 'playing' : 'menu';   // menu | playing | paused
let started = false;
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  audio.unlock();
  if (e.code === 'KeyM') { audio.setMuted(!audio.muted); hud.toast(audio.muted ? 'SOUND OFF' : 'SOUND ON'); }
  if (e.code === 'KeyP' && state === 'playing') pauseGame();
  else if (e.code === 'KeyP' && state === 'paused') resumeGame();
  if (e.code === 'KeyE' && state === 'playing') interact();
  if (e.code === 'KeyR' && state === 'playing' && !player.inCar) startReload();
});
addEventListener('keyup', (e) => keys.delete(e.code));
canvas.addEventListener('mousedown', () => { mouseDown = true; audio.unlock(); });
addEventListener('mouseup', () => { mouseDown = false; });
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && state === 'playing' && !SHOT && started) pauseGame();
});
canvas.addEventListener('click', () => {
  if (state === 'playing' && !SHOT) canvas.requestPointerLock();
});
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || state !== 'playing') return;
  camYaw -= e.movementX * 0.0026;
  camPitch = Math.max(-0.05, Math.min(1.0, camPitch + e.movementY * 0.0022));
});

function startGame(fresh) {
  if (fresh) { missions.storyIndex = 0; player.cash = 250; saveGame(); }
  started = true;
  state = 'playing';
  document.getElementById('startScreen').style.display = 'none';
  hud.show();
  missions.refreshObjective();
  if (missions.storyIndex === 0 && !missions.active) {
    dialogueQueue.push(
      ['Nico Vega', 'Port Solano. New city, new sun, same old debts.'],
      ['Nico Vega', 'Marisol Kane runs the marina garage. She’s the gold marker on my map — time to earn.']);
  }
}
function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused';
  document.getElementById('pauseScreen').style.display = 'flex';
  if (document.exitPointerLock) document.exitPointerLock();
}
function resumeGame() {
  state = 'playing';
  document.getElementById('pauseScreen').style.display = 'none';
}
document.getElementById('btnNew').addEventListener('click', () => { audio.unlock(); startGame(true); });
document.getElementById('btnContinue').addEventListener('click', () => { audio.unlock(); startGame(false); });
document.getElementById('btnResume').addEventListener('click', resumeGame);
if (!hasSave) document.getElementById('btnContinue').style.display = 'none';

// ---------------------------------------------------------------- interaction
function nearestCar(maxD) {
  let best = null, bd = maxD;
  for (const c of cars) {
    const d = Math.hypot(c.pos.x - player.mesh.position.x, c.pos.z - player.mesh.position.z);
    if (d < bd) { bd = d; best = c; }
  }
  for (const u of police.units) {
    const d = Math.hypot(u.pos.x - player.mesh.position.x, u.pos.z - player.mesh.position.z);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

function witnessed(range) {
  const p = playerPos();
  for (const ped of peds) {
    if (ped.state !== 'gone' && Math.hypot(ped.pos.x - p.x, ped.pos.z - p.z) < range) return true;
  }
  return police.units.length > 0 && police.nearestDist(p) < range + 18;
}

function interact() {
  if (player.inCar) { exitCar(); return; }
  const giver = missions.giverPos();
  if (giver && Math.hypot(giver.x - player.mesh.position.x, giver.z - player.mesh.position.z) < 4.5) {
    if (missions.tryStart()) { audio.pickup(); return; }
  }
  const car = nearestCar(3.6);
  if (car) enterCar(car);
}

function enterCar(car) {
  const wasTraffic = car.driver === 'traffic';
  if (car.driver === 'police') { hud.toast('LOCKED', 'SPPD cruisers don’t take passengers'); return; }
  if (car.health <= 0) { hud.toast('WRECKED', 'This one isn’t going anywhere'); return; }
  player.inCar = car;
  car.driver = 'player';
  car.occupied = true;
  player.mesh.visible = false;
  audio.door();
  audio.setEngineActive(true);
  if (wasTraffic || car.isTarget) {
    if (witnessed(26)) { police.addHeat(car.isTarget ? 6 : 34); startleAround(car.pos, 16); }
    else if (car.isTarget) police.addHeat(6);
  }
  if (wasTraffic) for (const t of traffic) if (t.car === car) t.hijacked = true;
}

function exitCar() {
  const car = player.inCar;
  if (!car) return;
  if (Math.abs(car.speed) > 3) return;   // not while rolling
  car.driver = 'parked';
  car.occupied = false;
  player.inCar = null;
  const side = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
  player.mesh.position.set(car.pos.x + side.x * 2.4, 0, car.pos.z + side.z * 2.4);
  resolveCollisions(player.mesh.position, 0.45, world);
  player.mesh.visible = true;
  player.heading = car.heading;
  audio.door();
  audio.setEngineActive(false);
}

function startleAround(pos, r) {
  for (const ped of peds) {
    if (Math.hypot(ped.pos.x - pos.x, ped.pos.z - pos.z) < r) ped.startle(pos);
  }
}

// ---------------------------------------------------------------- combat
const tracers = [];
function addTracer(a, b, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  scene.add(line);
  tracers.push({ line, life: 0.06 });
}

function startReload() {
  if (player.reloading > 0 || player.ammo >= 12 || player.reserve <= 0) return;
  player.reloading = 1.1;
  audio.reload();
}

function playerShoot(dt) {
  player.fireTimer -= dt;
  if (player.reloading > 0) {
    player.reloading -= dt;
    if (player.reloading <= 0) {
      const take = Math.min(12 - player.ammo, player.reserve);
      player.ammo += take; player.reserve -= take;
    }
    return;
  }
  if (!mouseDown || player.fireTimer > 0) return;
  if (player.ammo <= 0) { audio.dryFire(); player.fireTimer = 0.3; startReload(); return; }
  player.fireTimer = 0.15;
  player.ammo--;
  audio.shot();
  // Aim: from the camera, through the crosshair.
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.position.clone();
  const gunPos = { x: player.mesh.position.x, y: 1.45, z: player.mesh.position.z };
  let bestT = 90, bestHit = null, bestKind = null;
  const testSphere = (pos, y, r, kind, ref) => {
    const c = new THREE.Vector3(pos.x, y, pos.z);
    const t = c.clone().sub(origin).dot(dir);
    if (t < 0 || t > bestT) return;
    const closest = origin.clone().add(dir.clone().multiplyScalar(t));
    if (closest.distanceTo(c) < r) { bestT = t; bestHit = closest; bestKind = { kind, ref }; }
  };
  for (const g of gangs) if (g.alive) testSphere(g.pos, 1.15, 0.62, 'gang', g);
  for (const ped of peds) if (ped.state !== 'gone' && ped.state !== 'down') testSphere(ped.pos, 1.15, 0.55, 'ped', ped);
  for (const c of cars) testSphere(c.pos, 0.85, 2.3, 'car', c);
  for (const u of police.units) testSphere(u.pos, 0.85, 2.3, 'policecar', u);
  const end = bestHit || origin.clone().add(dir.clone().multiplyScalar(90));
  addTracer(gunPos, end, 0xffe9a0);
  player.heading = camYaw + Math.PI;
  startleAround(player.mesh.position, 20);
  if (witnessed(34)) police.addHeat(7);
  if (!bestKind) return;
  if (bestKind.kind === 'gang') {
    const died = bestKind.ref.hit(34);
    audio.thud();
    if (died) { player.cash += 15; hud.toast('CREW DOWN', '+$15 scavenged'); }
  } else if (bestKind.kind === 'ped') {
    bestKind.ref.knockDown();
    police.addHeat(45);
    audio.thud();
  } else {
    bestKind.ref.damage(6);
    if (bestKind.kind === 'policecar') police.addHeat(16);
  }
}

function gangShoot(gang) {
  const p = playerPos();
  const from = { x: gang.pos.x, y: 1.45, z: gang.pos.z };
  const to = { x: p.x, y: player.inCar ? 0.9 : 1.2, z: p.z };
  addTracer(from, to, 0xff7a5c);
  audio.shot();
  const dist = Math.hypot(p.x - gang.pos.x, p.z - gang.pos.z);
  const chance = 0.52 - dist * 0.009 - (player.inCar ? 0.14 : 0) - (player.speedNow > 5 ? 0.12 : 0);
  if (Math.random() < Math.max(0.05, chance)) {
    damagePlayer(5 + Math.random() * 6);
  }
}

function damagePlayer(amount) {
  if (player.dead || SHOT) return;
  if (player.armour > 0) {
    const absorbed = Math.min(player.armour, amount * 0.7);
    player.armour -= absorbed;
    amount -= absorbed;
  }
  player.health -= amount;
  hud.damageFlash();
  audio.thud();
  if (player.health <= 0) wasted();
}

function fineAndRespawn(at, kind) {
  const fineAmt = Math.min(player.cash, 150 + police.stars * 60);
  player.cash -= fineAmt;
  player.health = 100;
  if (player.inCar) { player.inCar.driver = 'parked'; player.inCar.occupied = false; player.inCar = null; }
  player.mesh.visible = true;
  player.mesh.position.set(at.x, 0, at.z);
  police.clear();
  missions.abort();
  hud.toast(kind, fineAmt > 0 ? '-$' + fineAmt + ' in fines and fees' : 'You walk away broke');
  audio.fail();
  saveGame();
}
function wasted() { player.dead = true; setTimeout(() => { player.dead = false; fineAndRespawn(world.locations.hospitalRespawn, 'WASTED'); }, 900); }
function busted() { if (!player.dead) { player.dead = true; setTimeout(() => { player.dead = false; fineAndRespawn(world.locations.policeRespawn, 'BUSTED'); }, 900); } }

// ---------------------------------------------------------------- collisions between movers
function carCarCollisions() {
  const all = [...cars, ...police.units];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 20.3 || d2 < 0.0001) continue;
    const d = Math.sqrt(d2);
    const push = (4.5 - d) / 2;
    const nx = dx / d, nz = dz / d;
    a.pos.x -= nx * push; a.pos.z -= nz * push;
    b.pos.x += nx * push; b.pos.z += nz * push;
    const rel = Math.abs(a.speed - b.speed);
    if (rel > 3) {
      a.damage(rel * 0.7); b.damage(rel * 0.7);
      const playerInvolved = player.inCar === a || player.inCar === b;
      if (playerInvolved) {
        audio.crash(Math.min(1, rel / 18));
        if (b.driver === 'police' || a.driver === 'police') police.addHeat(4);
        else if (witnessed(24)) police.addHeat(10);
      }
      const avg = (a.speed + b.speed) / 2;
      a.speed = avg + (a.speed - avg) * 0.3;
      b.speed = avg + (b.speed - avg) * 0.3;
    }
  }
}

function carPeopleCollisions() {
  const all = [...cars, ...police.units];
  for (const car of all) {
    if (Math.abs(car.speed) < 2.5) continue;
    const runners = [...peds, ...gangs];
    for (const person of runners) {
      if (person.state === 'gone' || person.state === 'down') continue;
      const d = Math.hypot(person.pos.x - car.pos.x, person.pos.z - car.pos.z);
      if (d > 2.6) continue;
      if (person instanceof GangMember) person.hit(Math.abs(car.speed) * 7);
      else person.knockDown();
      if (car === player.inCar) {
        police.addHeat(42);
        audio.thud();
        hud.damageFlash();
      } else if (car.driver === 'traffic') {
        startleAround(car.pos, 14);
      }
    }
    // Police ramming the player on foot hurts.
    if (!player.inCar && car.driver === 'police' && Math.abs(car.speed) > 4) {
      const d = Math.hypot(player.mesh.position.x - car.pos.x, player.mesh.position.z - car.pos.z);
      if (d < 2.6) {
        damagePlayer(12);
        player.mesh.position.x += (player.mesh.position.x - car.pos.x) * 0.4;
        player.mesh.position.z += (player.mesh.position.z - car.pos.z) * 0.4;
      }
    }
  }
}

// ---------------------------------------------------------------- per-frame updates
let dialogueTimer = 0;
function updateDialogue(dt) {
  dialogueTimer -= dt;
  if (dialogueTimer > 0) return;
  if (dialogueQueue.length) {
    const [name, text] = dialogueQueue.shift();
    hud.showDialogue(name, text);
    dialogueTimer = 3.8;
  } else hud.hideDialogue();
}

function updatePlayerOnFoot(dt) {
  const p = player.mesh.position;
  let ix = 0, iz = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) iz += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) iz -= 1;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1;
  if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1;
  const moving = ix !== 0 || iz !== 0;
  const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = sprint ? 8.6 : 5.2;
  player.speedNow = moving ? speed : 0;
  if (moving && !SHOT) {
    const sin = Math.sin(camYaw), cos = Math.cos(camYaw);
    const mx = ix * cos - iz * sin;
    const mz = iz * cos + ix * sin;
    const want = Math.atan2(-mz, mx);
    let dh = want - player.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    player.heading += dh * Math.min(1, dt * 12);
    p.x += Math.cos(player.heading) * speed * dt;
    p.z += -Math.sin(player.heading) * speed * dt;
    player.phase += dt * speed * 1.9;
    if (Math.random() < dt * (sprint ? 3.4 : 2.2)) audio.step();
  }
  resolveCollisions(p, 0.45, world);
  p.x = Math.max(-256, Math.min(232, p.x));
  p.z = Math.max(-232, Math.min(232, p.z));
  player.mesh.position.y = 0;
  player.mesh.rotation.y = player.heading;
  animateWalk(player.mesh, player.phase, moving ? 1 : 0);
  playerShoot(dt);
}

function updateDriving(dt) {
  const car = player.inCar;
  const ctrl = {
    throttle: (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) + (keys.has('KeyS') || keys.has('ArrowDown') ? -1 : 0),
    steer: (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + (keys.has('KeyD') || keys.has('ArrowRight') ? -1 : 0),
    handbrake: keys.has('Space'),
  };
  if (SHOT) ctrl.throttle = 0.55;
  car.drive(dt, ctrl, world);
  player.speedNow = Math.abs(car.speed);
  if (car.hitImpulse > 5) audio.crash(Math.min(1, car.hitImpulse / 20));
  if (ctrl.handbrake && Math.abs(car.speed) > 8) audio.screech(Math.min(1, Math.abs(car.speed) / 30));
  audio.engine(Math.abs(car.speed) / 34, Math.abs(ctrl.throttle), dt);
  if (car.health <= 0 && Math.abs(car.speed) < 0.5) hud.prompt('This car is wrecked — get out (E) and find another');
}

let cameraOverride = null;
let shotFollow = null;   // {car, mode} — screenshot scenes that track a car
function updateCamera(dt) {
  if (shotFollow) {
    const car = shotFollow.car;
    const f = { x: Math.cos(car.heading), z: -Math.sin(car.heading) };
    const r = { x: -f.z, z: f.x };
    if (shotFollow.mode === 'front') {
      // Ahead and above, looking back: the pursued car head-on, pursuers
      // stacked behind it, the city as backdrop.
      camera.position.set(
        car.pos.x + f.x * 15 + r.x * 7, 6, car.pos.z + f.z * 15 + r.z * 7);
      camera.lookAt(car.pos.x - f.x * 2, 1, car.pos.z - f.z * 2);
    } else {
      camera.position.set(
        car.pos.x - f.x * 10 + r.x * 3, 3.4, car.pos.z - f.z * 10 + r.z * 3);
      camera.lookAt(car.pos.x + f.x * 8, 1.2, car.pos.z + f.z * 8);
    }
    return;
  }
  if (cameraOverride) {
    camera.position.set(...cameraOverride.pos);
    camera.lookAt(...cameraOverride.look);
    return;
  }
  if (state === 'menu') {
    const t = performance.now() / 1000;
    camera.position.set(-235 + Math.sin(t * 0.05) * 12, 26, 120 + Math.cos(t * 0.04) * 30);
    camera.lookAt(-60, 4, 40);
    return;
  }
  if (player.inCar) {
    const car = player.inCar;
    const back = { x: Math.cos(car.heading), z: -Math.sin(car.heading) };
    const target = new THREE.Vector3(
      car.pos.x - back.x * 9.5, 3.6 + Math.abs(car.speed) * 0.02, car.pos.z - back.z * 9.5);
    camera.position.lerp(target, Math.min(1, dt * 5));
    camera.lookAt(car.pos.x + back.x * 7, 1.6, car.pos.z + back.z * 7);
  } else {
    const p = player.mesh.position;
    const dist = 7.6;
    const cx = p.x - Math.cos(camYaw) * Math.cos(camPitch) * dist;
    const cz = p.z + Math.sin(camYaw) * Math.cos(camPitch) * dist;
    const cy = 1.6 + Math.sin(camPitch) * dist;
    const target = new THREE.Vector3(cx, cy, cz);
    resolveCollisions(target, 0.6, world);
    camera.position.lerp(target, Math.min(1, dt * 10));
    camera.lookAt(p.x, 1.5, p.z);
  }
}

// Taxi fare designation: every so often a nearby pedestrian hails the player.
let fareTimer = 8;
function updateFares(dt) {
  fareTimer -= dt;
  if (missions.fare || fareTimer > 0 || !player.inCar) return;
  fareTimer = 9;
  let best = null, bd = 55;
  for (const ped of peds) {
    if (ped.state !== 'walk') continue;
    const d = Math.hypot(ped.pos.x - playerPos().x, ped.pos.z - playerPos().z);
    if (d < bd) { bd = d; best = ped; }
  }
  if (best) {
    best.state = 'fare';
    missions.fare = { phase: 'pickup', ped: best, dest: null, dist: 0 };
    hud.toast('TAXI FARE', 'Stop beside the hailing passenger');
  }
}

// ---------------------------------------------------------------- shot staging
function enterCarSilent(car) {
  player.inCar = car;
  car.driver = 'player';
  car.occupied = true;
  player.mesh.visible = false;
}
function stageShot(n) {
  hud.show();
  started = true;
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('pauseScreen').style.display = 'none';
  if (n === 1) {
    // Cover: Nico and his red coupe at the east curb of the beach boulevard,
    // shot low from the road looking north-east up the street — the pastel
    // blocks fill the background, staged traffic waits up the boulevard
    // behind them, and the shoreline slides away at the frame's left edge.
    const coupe = new Car(scene, 'coupe', 0xe84f3d, -174.8, 30, Math.PI / 2);
    coupe.driver = 'parked';
    cars.push(coupe);
    const sedan = new Car(scene, 'sedan', 0x3fa7d6, -180.6, 0, Math.PI / 2);
    sedan.driver = 'parked';
    cars.push(sedan);
    const pickup = new Car(scene, 'pickup', 0xf7e3b0, -174.8, -12, Math.PI / 2);
    pickup.driver = 'parked';
    cars.push(pickup);
    player.mesh.position.set(-177.4, 0, 26.4);
    player.heading = -1.9;
    player.mesh.rotation.y = player.heading;
    cameraOverride = { pos: [-181.8, 1.4, 38.6], look: [-175.8, 1.2, 28.4] };
  } else if (n === 2) {
    missions.storyIndex = 5;
    const sedan = new Car(scene, 'sedan', 0x3fa7d6, -6, 49.4, 0);
    sedan.speed = 13;
    cars.push(sedan);
    enterCarSilent(sedan);
    shotFollow = { car: sedan, mode: 'chase' };
  } else if (n === 3) {
    missions.storyIndex = 5;
    // The chase runs up the open promenade, where nothing blocks the camera.
    const coupe = new Car(scene, 'coupe', 0xf2a541, -214, 60, Math.PI / 2);
    coupe.speed = 16;
    cars.push(coupe);
    enterCarSilent(coupe);
    police.heat = 90;
    const spots = [[-214.5, 76, Math.PI / 2], [-211, 86, Math.PI / 2], [-215, 97, Math.PI / 2]];
    for (const [x, z, h] of spots) {
      const u = new Car(scene, 'police', 0x23262b, x, z, h);
      u.driver = 'police'; u.speed = 15; u.stuckTimer = 0; u.reverseTimer = 0;
      police.units.push(u);
    }
    shotFollow = { car: coupe, mode: 'front' };
  } else if (n === 4) {
    missions.storyIndex = 4;
    player.mesh.position.set(-234, 0, 143);
    player.heading = -2.2;
    player.mesh.rotation.y = player.heading;
    missions.tryStart();
    cameraOverride = { pos: [-225.5, 2.6, 134.5], look: [-237, 1.4, 149] };
  }
}
if (SHOT) stageShot(SHOT);

// ---------------------------------------------------------------- main loop
const clock = new THREE.Clock();
let frames = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, clock.getDelta());
  const t = clock.elapsedTime;
  world.update(dt, t);

  if (state === 'playing' && !player.dead) {
    if (player.inCar) updateDriving(dt); else updatePlayerOnFoot(dt);
    for (const tc of traffic) if (!tc.hijacked) tc.update(dt, world, { entities: cars, playerOnFoot: !player.inCar, playerPos: playerPos() });
    for (const ped of peds) ped.update(dt, world);
    // Drain mission wave requests.
    while (missions.pendingSpawns.length) {
      const s = missions.pendingSpawns.shift();
      for (let i = 0; i < s.count; i++) {
        const g = new GangMember(scene, s.x + rng.range(-14, 14), s.z + rng.range(-12, 12), rng);
        g.state = 'engage';
        gangs.push(g);
      }
    }
    for (const g of gangs) g.update(dt, world, { playerPos: playerPos(), onShoot: gangShoot });
    police.update(dt, {
      playerPos: playerPos(), playerVel: playerVel(),
      playerInCar: !!player.inCar, playerSpeed: player.speedNow,
      onBust: busted, allCars: cars,
    });
    carCarCollisions();
    carPeopleCollisions();
    // A shootout only counts the crew fighting at its own location — the
    // stash-house lookouts join mission 3's fight, but a marina ambush is
    // not held up by survivors across town.
    const fightAt = missions.active && missions.active.step && missions.active.step.type === 'shootout'
      ? missions.marker : null;
    const gangAlive = fightAt
      ? gangs.filter((g) => g.alive && Math.hypot(g.pos.x - fightAt.x, g.pos.z - fightAt.z) < 55).length
      : gangs.filter((g) => g.alive).length;
    missions.update(dt, {
      playerPos: playerPos(), playerInCar: !!player.inCar,
      playerCar: player.inCar, playerSpeed: player.speedNow,
      gangAlive,
    });
    updateFares(dt);
    updateDialogue(dt);
    // Pickups.
    for (const pk of pickups) {
      pk.mesh.rotation.y += dt * 2;
      pk.mesh.position.y = 1 + Math.sin(t * 2.4 + pk.x) * 0.18;
      if (pk.timer > 0) { pk.timer -= dt; pk.mesh.visible = pk.timer <= 0; continue; }
      const d = Math.hypot(playerPos().x - pk.x, playerPos().z - pk.z);
      if (d < 2.4) {
        if (pk.kind === 'health' && player.health < 100) player.health = Math.min(100, player.health + 40);
        else if (pk.kind === 'armour' && player.armour < 100) player.armour = 100;
        else if (pk.kind === 'ammo' && player.reserve < 99) player.reserve = Math.min(99, player.reserve + 36);
        else continue;
        pk.timer = 45; pk.mesh.visible = false;
        audio.pickup();
        hud.toast(pk.kind.toUpperCase(), 'Picked up');
      }
    }
    // Interaction prompt.
    if (!player.inCar) {
      const giver = missions.giverPos();
      if (giver && Math.hypot(giver.x - player.mesh.position.x, giver.z - player.mesh.position.z) < 4.5) hud.prompt('E — Talk');
      else if (nearestCar(3.6)) hud.prompt('E — Enter car');
      else hud.prompt(null);
    } else if (Math.abs(player.inCar.speed) < 3) hud.prompt('E — Exit car');
    else hud.prompt(null);
  }

  // Tracers fade.
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    if (tracers[i].life <= 0) {
      scene.remove(tracers[i].line);
      tracers[i].line.geometry.dispose();
      tracers.splice(i, 1);
    }
  }
  // Beacons follow the current markers.
  const mk = missions.marker;
  beacon.visible = !!mk && state !== 'menu';
  if (mk) beacon.position.set(mk.x, 0, mk.z);
  const fareTarget = missions.fare
    ? (missions.fare.phase === 'pickup' ? missions.fare.ped.pos : missions.fare.dest)
    : null;
  fareBeacon.visible = !!fareTarget && state !== 'menu';
  if (fareTarget) fareBeacon.position.set(fareTarget.x, 0, fareTarget.z);

  // HUD.
  if (started) {
    hud.setHealth(player.health, player.armour);
    hud.setCash(player.cash);
    hud.setStars(police.stars);
    hud.setObjective(state === 'playing' ? missions.objectiveText : '');
    hud.setWeapon(player.inCar ? '' : (player.reloading > 0 ? 'RELOADING…' : 'PISTOL  ' + player.ammo + ' / ' + player.reserve));
    hud.setSpeed(player.inCar ? Math.abs(player.inCar.speed) * 3.6 : null);
    hud.setCrosshair(state === 'playing' && !player.inCar);
    hud.update(dt);
    hud.drawMinimap({
      playerPos: playerPos(),
      playerHeading: player.inCar ? player.inCar.heading : player.heading,
      cars, police: police.units, gangs,
      marker: mk, fare: fareTarget,
    });
  }
  audio.siren(police.stars > 0 ? police.nearestDist(playerPos()) : Infinity, dt);
  if (started && state === 'playing') audio.ambient(dt);
  if (!player.inCar) audio.setEngineActive(false);

  updateCamera(dt);
  renderer.render(scene, camera);
  frames++;
  if (SHOT && frames === 60) window.__shotReady = true;
}
loop();
