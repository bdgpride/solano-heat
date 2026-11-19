// people.js — the low-poly citizens of Port Solano, built from boxes with
// swinging limbs. Pedestrians stroll the sidewalk grid and run from danger;
// Cordero crew members are the same figure with a gun, a temper and health.
// The player's own figure is built here too — his controller lives in main.js.

import { ROAD_LINES, WALK_OFF, resolveCollisions } from './city.js';

const SKINS = [0xf2c09a, 0xc68863, 0x8a5a3b, 0x6e4530, 0xffdbb4];
const SHIRTS = [0xe84f3d, 0x3fa7d6, 0xf2a541, 0x9fd356, 0xe883b0, 0xf7e3b0, 0x5b5ea6, 0x2ec4b6, 0xffffff, 0x37474f];
const PANTS = [0x2e3a46, 0x5a4632, 0x746a58, 0x243447, 0x8a8f96, 0x4a6741];

export function makePersonMesh({ skin, shirt, pants, hair = 0x2b2118, cap = null }) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const legGeo = new THREE.BoxGeometry(0.21, 0.92, 0.24);
  const armGeo = new THREE.BoxGeometry(0.16, 0.78, 0.18);
  function limb(geo, color, x, y, z) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const m = new THREE.Mesh(geo, mat(color));
    m.position.y = -geo.parameters.height / 2 + 0.04;
    pivot.add(m);
    g.add(pivot);
    return pivot;
  }
  const legL = limb(legGeo, pants, 0, 0.94, 0.13);
  const legR = limb(legGeo, pants, 0, 0.94, -0.13);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.56), mat(shirt));
  torso.position.y = 1.26;
  g.add(torso);
  const armL = limb(armGeo, shirt, 0, 1.52, 0.37);
  const armR = limb(armGeo, shirt, 0, 1.52, -0.37);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.34), mat(skin));
  head.position.y = 1.78;
  g.add(head);
  const hairM = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.12, 0.37), mat(cap ?? hair));
  hairM.position.y = 1.97;
  g.add(hairM);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 10),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.04;
  g.add(shadow);
  g.userData.parts = { legL, legR, armL, armR, torso, head };
  g.userData.mats = { torso: torso.material, head: head.material };
  return g;
}

export function animateWalk(mesh, phase, amount) {
  const p = mesh.userData.parts;
  const s = Math.sin(phase) * 0.55 * amount;
  p.legL.rotation.z = s;
  p.legR.rotation.z = -s;
  p.armL.rotation.z = -s * 0.8;
  p.armR.rotation.z = s * 0.8;
}

// Person forward is local +X; limb swing rotates around Z to match.
export class Pedestrian {
  constructor(scene, rng, world) {
    this.rng = rng;
    this.mesh = makePersonMesh({
      skin: rng.pick(SKINS), shirt: rng.pick(SHIRTS), pants: rng.pick(PANTS),
      cap: rng.chance(0.25) ? rng.pick(SHIRTS) : null,
    });
    this.axis = rng.chance(0.5) ? 'x' : 'z';
    this.line = rng.pick(ROAD_LINES);
    this.side = rng.sign();
    this.dir = rng.sign();
    const along = rng.range(-200, 200);
    this.mesh.position.set(
      this.axis === 'x' ? along : this.line + this.side * WALK_OFF,
      0,
      this.axis === 'x' ? this.line + this.side * WALK_OFF : along);
    this.heading = 0;
    this.speed = rng.range(1.2, 1.9);
    this.phase = rng.range(0, 6);
    this.state = 'walk';       // walk | flee | down | fare | gone
    this.stateTimer = 0;
    this.threat = null;
    this.target = this.nextTarget();
    scene.add(this.mesh);
  }

  get pos() { return this.mesh.position; }

  nextTarget() {
    const p = this.pos;
    const ahead = this.axis === 'x' ? p.x : p.z;
    const lines = ROAD_LINES.filter((l) => (l - ahead) * this.dir > 6);
    const cross = lines.length
      ? (this.dir > 0 ? lines[0] : lines[lines.length - 1])
      : ahead + this.dir * 30;
    return this.axis === 'x'
      ? { x: cross, z: this.line + this.side * WALK_OFF }
      : { x: this.line + this.side * WALK_OFF, z: cross };
  }

  chooseTurn() {
    if (this.rng.chance(0.5)) { this.target = this.nextTarget(); return; }
    const crossLine = this.axis === 'x' ? this.target.x : this.target.z;
    this.axis = this.axis === 'x' ? 'z' : 'x';
    this.line = crossLine;
    this.dir = this.rng.sign();
    this.side = this.rng.sign();
    this.target = this.nextTarget();
  }

  startle(fromPos) {
    if (this.state === 'down' || this.state === 'gone' || this.state === 'fare') return;
    this.state = 'flee';
    this.stateTimer = this.rng.range(2.5, 4.5);
    this.threat = { x: fromPos.x, z: fromPos.z };
  }

  knockDown() {
    if (this.state === 'gone') return;
    this.state = 'down';
    this.stateTimer = 4;
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.y = 0.25;
  }

  update(dt, world) {
    if (this.state === 'gone') return;
    this.stateTimer -= dt;
    if (this.state === 'down') {
      if (this.stateTimer <= 0) {
        this.mesh.rotation.x = 0;
        this.mesh.position.y = 0;
        this.state = 'flee';
        this.stateTimer = 3;
        this.threat = { x: this.pos.x + 10, z: this.pos.z };
        this.target = this.nextTarget();
      }
      return;
    }
    let speed = this.speed;
    let tx, tz;
    if (this.state === 'flee' && this.threat) {
      const dx = this.pos.x - this.threat.x, dz = this.pos.z - this.threat.z;
      const d = Math.hypot(dx, dz) || 1;
      tx = this.pos.x + (dx / d) * 18;
      tz = this.pos.z + (dz / d) * 18;
      speed = 6.2;
      if (this.stateTimer <= 0) { this.state = 'walk'; this.target = this.nextTarget(); }
    } else if (this.state === 'fare') {
      animateWalk(this.mesh, 0, 0);
      return; // standing at the curb, thumb out
    } else {
      const dx = this.target.x - this.pos.x, dz = this.target.z - this.pos.z;
      if (Math.hypot(dx, dz) < 2.5) this.chooseTurn();
      tx = this.target.x; tz = this.target.z;
    }
    const want = Math.atan2(-(tz - this.pos.z), tx - this.pos.x);
    let dh = want - this.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    this.heading += Math.max(-2.6 * dt, Math.min(2.6 * dt, dh));
    this.pos.x += Math.cos(this.heading) * speed * dt;
    this.pos.z += -Math.sin(this.heading) * speed * dt;
    resolveCollisions(this.pos, 0.42, world);
    this.pos.x = Math.max(-252, Math.min(228, this.pos.x));
    this.pos.z = Math.max(-228, Math.min(228, this.pos.z));
    this.mesh.position.y = 0;
    this.mesh.rotation.y = this.heading;
    this.phase += dt * speed * 3.4;
    animateWalk(this.mesh, this.phase, this.state === 'flee' ? 1.25 : 0.8);
  }
}

export class GangMember {
  constructor(scene, x, z, rng) {
    this.mesh = makePersonMesh({
      skin: rng.pick(SKINS), shirt: 0x722f37, pants: 0x243447, cap: 0x1c1e24,
    });
    this.mesh.position.set(x, 0, z);
    this.heading = rng.range(0, Math.PI * 2);
    this.health = 100;
    this.state = 'idle';       // idle | engage | down
    this.phase = rng.range(0, 6);
    this.shootTimer = rng.range(0.8, 1.8);
    this.strafeDir = rng.sign();
    this.strafeTimer = rng.range(1, 2.5);
    this.flash = 0;
    scene.add(this.mesh);
  }

  get pos() { return this.mesh.position; }
  get alive() { return this.state !== 'down'; }

  hit(dmg) {
    if (!this.alive) return false;
    this.health -= dmg;
    this.flash = 1;
    if (this.state === 'idle') this.state = 'engage';
    if (this.health <= 0) {
      this.state = 'down';
      this.mesh.rotation.x = -Math.PI / 2;
      this.mesh.position.y = 0.25;
      return true; // died
    }
    return false;
  }

  // ctx: {playerPos, onShoot(gang)} — main.js resolves the shot.
  update(dt, world, ctx) {
    if (!this.alive) return;
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 5);
      this.mesh.userData.mats.torso.emissive = new THREE.Color(0xff2222);
      this.mesh.userData.mats.torso.emissiveIntensity = this.flash * 0.8;
    }
    const p = this.pos;
    const dx = ctx.playerPos.x - p.x, dz = ctx.playerPos.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (this.state === 'idle') {
      if (dist < 46) this.state = 'engage';
      else { this.mesh.rotation.y = this.heading; return; }
    }
    const want = Math.atan2(-dz, dx);
    this.heading = want;
    this.mesh.rotation.y = this.heading;
    let mx = 0, mz = 0;
    if (dist > 19) { mx = Math.cos(this.heading); mz = -Math.sin(this.heading); }
    else if (dist < 9) { mx = -Math.cos(this.heading); mz = Math.sin(this.heading); }
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) { this.strafeDir *= -1; this.strafeTimer = 1 + Math.random() * 1.6; }
    const sx = Math.cos(this.heading + Math.PI / 2) * this.strafeDir;
    const sz = -Math.sin(this.heading + Math.PI / 2) * this.strafeDir;
    const spd = 3.1;
    p.x += (mx + sx * 0.6) * spd * dt;
    p.z += (mz + sz * 0.6) * spd * dt;
    resolveCollisions(p, 0.42, world);
    this.phase += dt * 9;
    animateWalk(this.mesh, this.phase, 0.7);
    this.shootTimer -= dt;
    if (this.shootTimer <= 0 && dist < 42) {
      this.shootTimer = 1.05 + Math.random() * 0.9;
      ctx.onShoot(this);
    }
  }
}
