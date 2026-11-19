// vehicles.js — low-poly cars built from boxes, an arcade driving model, and
// the traffic AI that cruises the street grid. Traffic cars follow the road
// lines from city.js, keep to a lane, pick a new direction at intersections
// and brake for whatever is in front of them. Police and the player drive the
// same Car with different controllers.

import { ROAD_LINES, GRID_MIN, GRID_MAX, resolveCollisions } from './city.js';

export const CAR_COLORS = [0xe84f3d, 0xf2a541, 0x3fa7d6, 0xf7e3b0, 0x9fd356, 0xe883b0, 0xd8dde3, 0x5b5ea6, 0x2ec4b6, 0xff7f51];
export const CAR_TYPES = ['sedan', 'coupe', 'pickup', 'van', 'sedan', 'coupe'];
const LANE = 3.4;

let smokeTexture = null;
function getSmokeTexture() {
  if (smokeTexture) return smokeTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(60,60,60,0.55)');
  grad.addColorStop(1, 'rgba(60,60,60,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  smokeTexture = new THREE.CanvasTexture(c);
  return smokeTexture;
}

const glassMat = new THREE.MeshLambertMaterial({ color: 0x1d2733 });
const tyreMat = new THREE.MeshLambertMaterial({ color: 0x17181c });
const chromeMat = new THREE.MeshLambertMaterial({ color: 0xb9c0c7 });

function wheel(r) {
  const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.26, 10), tyreMat);
  w.rotation.x = Math.PI / 2;
  const pivot = new THREE.Group();
  pivot.add(w);
  pivot.userData.spin = w;
  return pivot;
}

export function makeCarMesh(type, colorHex) {
  const car = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: colorHex });
  const dims = { length: 4.4, width: 1.9 };
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    car.add(m); return m;
  };
  if (type === 'van') {
    dims.length = 4.8;
    add(new THREE.BoxGeometry(4.8, 1.7, 1.95), paint, 0, 1.25, 0);
    add(new THREE.BoxGeometry(1.1, 0.62, 1.85), glassMat, 1.95, 1.62, 0);
    add(new THREE.BoxGeometry(4.9, 0.35, 2.0), paint, 0, 0.32, 0);
  } else if (type === 'pickup') {
    dims.length = 4.9;
    add(new THREE.BoxGeometry(4.9, 0.5, 1.95), paint, 0, 0.62, 0);
    add(new THREE.BoxGeometry(1.7, 0.85, 1.85), paint, 1.15, 1.28, 0);
    add(new THREE.BoxGeometry(1.55, 0.5, 1.7), glassMat, 1.2, 1.32, 0);
    add(new THREE.BoxGeometry(2.2, 0.28, 1.8), chromeMat, -1.25, 0.95, 0);
  } else if (type === 'coupe') {
    dims.length = 4.3;
    add(new THREE.BoxGeometry(4.3, 0.48, 1.85), paint, 0, 0.55, 0);
    const cabin = add(new THREE.BoxGeometry(2.0, 0.5, 1.65), glassMat, -0.25, 1.0, 0);
    cabin.rotation.z = -0.06;
    add(new THREE.BoxGeometry(0.9, 0.09, 1.7), paint, -2.0, 1.02, 0); // spoiler
    add(new THREE.BoxGeometry(0.12, 0.3, 0.12), paint, -2.25, 0.85, 0.6);
    add(new THREE.BoxGeometry(0.12, 0.3, 0.12), paint, -2.25, 0.85, -0.6);
  } else { // sedan / taxi base
    add(new THREE.BoxGeometry(4.4, 0.55, 1.9), paint, 0, 0.58, 0);
    add(new THREE.BoxGeometry(2.3, 0.55, 1.7), glassMat, -0.2, 1.1, 0);
    add(new THREE.BoxGeometry(2.5, 0.1, 1.8), paint, -0.2, 1.4, 0);
  }
  // Lights: warm headlights, red tails.
  const headMat = new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xffdf80, emissiveIntensity: 0.9 });
  const tailMat = new THREE.MeshLambertMaterial({ color: 0xd42a2a, emissive: 0xa01212, emissiveIntensity: 0.8 });
  add(new THREE.BoxGeometry(0.1, 0.16, 1.5), headMat, dims.length / 2 + 0.02, 0.62, 0);
  add(new THREE.BoxGeometry(0.1, 0.14, 1.5), tailMat, -dims.length / 2 - 0.02, 0.66, 0);
  if (type === 'taxi') {
    const sign = add(new THREE.BoxGeometry(0.7, 0.28, 0.4),
      new THREE.MeshLambertMaterial({ color: 0xffd23f, emissive: 0xcc9a00, emissiveIntensity: 0.6 }), -0.2, 1.62, 0);
    car.userData.taxiSign = sign;
  }
  if (type === 'police') {
    add(new THREE.BoxGeometry(2.5, 0.1, 1.8), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }), -0.2, 1.4, 0);
    const barR = add(new THREE.BoxGeometry(0.5, 0.16, 0.5),
      new THREE.MeshLambertMaterial({ color: 0xff2a2a, emissive: 0xff0000, emissiveIntensity: 2 }), -0.2, 1.55, 0.3);
    const barB = add(new THREE.BoxGeometry(0.5, 0.16, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x2a5cff, emissive: 0x0033ff, emissiveIntensity: 0.2 }), -0.2, 1.55, -0.3);
    car.userData.lightbar = [barR, barB];
  }
  // Wheels.
  const r = type === 'van' || type === 'pickup' ? 0.4 : 0.35;
  const wx = dims.length / 2 - 0.85, wz = dims.width / 2 - 0.05;
  car.userData.wheels = [];
  for (const [x, z, front] of [[wx, wz, 1], [wx, -wz, 1], [-wx, wz, 0], [-wx, -wz, 0]]) {
    const pivot = wheel(r);
    pivot.position.set(x, r, z);
    pivot.userData.front = !!front;
    car.add(pivot);
    car.userData.wheels.push(pivot);
  }
  // Soft blob shadow.
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(2.6, 14),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.05;
  shadow.scale.set(1, 0.75, 1);
  car.add(shadow);
  car.userData.dims = dims;
  return car;
}

export class Car {
  constructor(scene, type, colorHex, x, z, heading) {
    this.type = type;
    this.group = makeCarMesh(type, colorHex);
    this.group.position.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.steer = 0;
    this.health = 100;
    this.occupied = false;      // player inside
    this.driver = null;         // 'traffic' | 'police' | 'parked' | 'player'
    this.smokeTimer = 0;
    this.smokes = [];
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: getSmokeTexture(), transparent: true, opacity: 0 }));
      s.scale.set(1.4, 1.4, 1);
      s.visible = false;
      scene.add(s);
      this.smokes.push({ sprite: s, life: i / 5 });
    }
    scene.add(this.group);
    this.syncMesh();
  }

  get pos() { return this.group.position; }
  get dims() { return this.group.userData.dims; }

  forward() { return { x: Math.cos(this.heading), z: -Math.sin(this.heading) }; }

  syncMesh() {
    this.group.position.y = 0;
    this.group.rotation.y = this.heading;
    const dist = this.speed * 0.016;
    for (const w of this.group.userData.wheels) {
      w.userData.spin.rotation.y += dist / 0.35;
      if (w.userData.front) w.rotation.y = -this.steer * 0.5;
    }
    if (this.group.userData.lightbar) {
      const t = performance.now() / 280;
      const phase = Math.floor(t) % 2 === 0;
      this.group.userData.lightbar[0].material.emissiveIntensity = phase ? 2.4 : 0.15;
      this.group.userData.lightbar[1].material.emissiveIntensity = phase ? 0.15 : 2.4;
    }
  }

  // Arcade driving model. ctrl: {throttle -1..1, steer -1..1, handbrake bool}
  drive(dt, ctrl, world) {
    const topSpeed = this.type === 'coupe' ? 36 : this.type === 'van' ? 25 : 30;
    const accel = this.type === 'coupe' ? 15 : 11;
    if (ctrl.throttle > 0) this.speed += accel * ctrl.throttle * dt * (1 - Math.max(0, this.speed) / (topSpeed * 1.25));
    else if (ctrl.throttle < 0) {
      if (this.speed > 0.5) this.speed -= 26 * dt;                    // braking
      else this.speed = Math.max(-9, this.speed + 8 * ctrl.throttle * dt); // reverse
    }
    const drag = ctrl.handbrake ? 2.6 : 0.35;
    this.speed -= this.speed * drag * dt;
    if (!ctrl.throttle && Math.abs(this.speed) < 0.25) this.speed = 0;
    const steerTarget = ctrl.steer * 0.62;
    this.steer += (steerTarget - this.steer) * Math.min(1, dt * 8);
    const grip = ctrl.handbrake ? 1.5 : 1;
    if (Math.abs(this.speed) > 0.1) {
      this.heading -= this.steer * Math.min(Math.abs(this.speed), 12) * 0.115 * grip * dt * Math.sign(this.speed);
    }
    const f = this.forward();
    this.pos.x += f.x * this.speed * dt;
    this.pos.z += f.z * this.speed * dt;
    const before = { x: this.pos.x, z: this.pos.z };
    resolveCollisions(this.pos, 2.1, world);
    if (Math.hypot(this.pos.x - before.x, this.pos.z - before.z) > 0.02 && Math.abs(this.speed) > 4) {
      this.hitImpulse = Math.abs(this.speed);
      this.speed *= -0.22;
      this.damage(this.hitImpulse * 1.6);
    } else this.hitImpulse = 0;
    this.updateSmoke(dt);
    this.syncMesh();
  }

  damage(amount) {
    this.health = Math.max(0, this.health - amount);
  }

  updateSmoke(dt) {
    const smoking = this.health < 38;
    for (const s of this.smokes) {
      if (!smoking) { s.sprite.visible = false; continue; }
      s.life += dt * 0.7;
      if (s.life > 1) s.life = 0;
      const f = this.forward();
      s.sprite.visible = true;
      s.sprite.position.set(
        this.pos.x + f.x * 1.6, 1 + s.life * 2.6, this.pos.z + f.z * 1.6);
      const sc = 0.8 + s.life * 2.2;
      s.sprite.scale.set(sc, sc, 1);
      s.sprite.material.opacity = 0.5 * (1 - s.life);
    }
  }
}

// --- traffic -----------------------------------------------------------------

export class TrafficCar {
  constructor(scene, rng, world, allCars) {
    const type = rng.pick(CAR_TYPES);
    const color = rng.pick(CAR_COLORS);
    // Start on a random road line, in a random lane, mid-block.
    this.axis = rng.chance(0.5) ? 'x' : 'z';
    this.line = rng.pick(ROAD_LINES);
    this.dir = rng.sign();
    const along = rng.range(GRID_MIN + 12, GRID_MAX - 12);
    const laneOff = this.laneOffset();
    const x = this.axis === 'x' ? along : this.line + laneOff;
    const z = this.axis === 'x' ? this.line + laneOff : along;
    // Forward is (cos h, -sin h), so travelling +z means heading -PI/2.
    const heading = this.axis === 'x'
      ? (this.dir > 0 ? 0 : Math.PI)
      : (this.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    this.car = new Car(scene, type, color, x, z, heading);
    this.car.driver = 'traffic';
    this.rng = rng;
    this.cruise = rng.range(9, 14);
    this.target = this.nextTarget() || { x, z };
    allCars.push(this.car);
  }

  laneOffset() {
    if (this.axis === 'x') return this.dir > 0 ? LANE : -LANE;
    return this.dir > 0 ? -LANE : LANE;
  }

  // The point one intersection ahead, in this car's lane; null at the grid edge.
  nextTarget() {
    const p = this.car.pos;
    const ahead = this.axis === 'x' ? p.x : p.z;
    const lines = ROAD_LINES.filter((l) => (l - ahead) * this.dir > 8);
    if (!lines.length) return null;
    const cross = this.dir > 0 ? lines[0] : lines[lines.length - 1];
    return this.axis === 'x'
      ? { x: cross, z: this.line + this.laneOffset() }
      : { x: this.line + this.laneOffset(), z: cross };
  }

  // Reached an intersection: go straight if the road continues, else turn
  // onto the crossing road in a random direction.
  chooseTurn() {
    if (this.rng.next() < 0.42) {
      const t = this.nextTarget();
      if (t) { this.target = t; return; }
    }
    const crossLine = this.axis === 'x' ? this.target.x : this.target.z;
    this.axis = this.axis === 'x' ? 'z' : 'x';
    this.line = crossLine;
    this.dir = this.rng.sign();
    this.target = this.nextTarget() || (this.axis === 'x'
      ? { x: this.car.pos.x + this.dir * 30, z: this.line + this.laneOffset() }
      : { x: this.line + this.laneOffset(), z: this.car.pos.z + this.dir * 30 });
  }

  update(dt, world, ctx) {
    const car = this.car;
    const p = car.pos;
    const dx = this.target.x - p.x, dz = this.target.z - p.z;
    const distT = Math.hypot(dx, dz);
    if (distT < 7) this.chooseTurn();
    const want = Math.atan2(-(this.target.z - p.z), this.target.x - p.x);
    let dh = want - car.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    const steer = Math.max(-1, Math.min(1, dh * 1.6));
    // Obstacle scan: anything slow or stopped in front slows us down.
    let throttle = 0.75;
    const f = car.forward();
    for (const other of ctx.entities) {
      if (other === car) continue;
      const ox = other.pos.x - p.x, oz = other.pos.z - p.z;
      const ahead = ox * f.x + oz * f.z;
      const side = Math.abs(ox * -f.z + oz * f.x);
      if (ahead > 0 && ahead < 11 && side < 2.2) {
        throttle = ahead < 5.5 ? -0.4 : 0.05;
        break;
      }
    }
    if (ctx.playerOnFoot) {
      const ox = ctx.playerPos.x - p.x, oz = ctx.playerPos.z - p.z;
      const ahead = ox * f.x + oz * f.z;
      const side = Math.abs(ox * -f.z + oz * f.x);
      if (ahead > 0 && ahead < 8 && side < 2) throttle = -0.5;
    }
    car.drive(dt, { throttle, steer, handbrake: false }, world);
    if (car.speed > this.cruise) car.speed = this.cruise;
  }
}
