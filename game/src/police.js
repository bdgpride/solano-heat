// police.js — the wanted system and the SPPD pursuit. Crimes add heat; heat
// makes stars; stars decide how many patrol cars hunt you. A unit that can
// see you keeps your heat pinned — break line of sight long enough and the
// heat bleeds away. On foot, a unit that corners you runs the bust clock.

import { Car } from './vehicles.js';
import { ROAD_LINES } from './city.js';

const STAR_POINTS = 30;   // heat points per star

export function segmentBlocked(a, b, world) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.floor(dist / 6));
  for (let i = 1; i < steps; i++) {
    const x = a.x + dx * (i / steps), z = a.z + dz * (i / steps);
    for (const c of world.colliders) {
      if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) return true;
    }
  }
  return false;
}

export class PoliceSystem {
  constructor(scene, world, rng) {
    this.scene = scene;
    this.world = world;
    this.rng = rng;
    this.heat = 0;
    this.units = [];        // Car instances, driver 'police'
    this.unseenTimer = 0;
    this.bustTimer = 0;
    this.lockedStars = 0;   // mission 5 pins the wanted level
    this.spawnTimer = 0;
  }

  get stars() {
    const s = this.heat <= 0 ? 0 : Math.min(5, Math.ceil(this.heat / STAR_POINTS));
    return Math.max(s, this.lockedStars);
  }

  addHeat(points) {
    this.heat = Math.min(STAR_POINTS * 5 + 10, this.heat + points);
    this.unseenTimer = 0;
  }

  clear() {
    this.heat = 0;
    this.lockedStars = 0;
    this.bustTimer = 0;
  }

  nearestDist(from) {
    let best = Infinity;
    for (const u of this.units) best = Math.min(best, Math.hypot(u.pos.x - from.x, u.pos.z - from.z));
    return best;
  }

  anySees(playerPos) {
    for (const u of this.units) {
      const d = Math.hypot(u.pos.x - playerPos.x, u.pos.z - playerPos.z);
      if (d < 62 && !segmentBlocked(u.pos, playerPos, this.world)) return true;
    }
    return false;
  }

  spawnUnit(playerPos) {
    // Pick a road intersection 70–115 m away, then set the car on its lane.
    for (let tries = 0; tries < 12; tries++) {
      const lx = this.rng.pick(ROAD_LINES), lz = this.rng.pick(ROAD_LINES);
      const d = Math.hypot(lx - playerPos.x, lz - playerPos.z);
      if (d < 70 || d > 115) continue;
      const heading = this.rng.pick([0, Math.PI, Math.PI / 2, -Math.PI / 2]);
      const car = new Car(this.scene, 'police', 0x23262b, lx + 3.4, 0, heading);
      car.group.position.z = lz + 3.4;
      car.driver = 'police';
      car.stuckTimer = 0;
      car.reverseTimer = 0;
      this.units.push(car);
      return car;
    }
    return null;
  }

  removeUnit(car) {
    this.scene.remove(car.group);
    for (const s of car.smokes) this.scene.remove(s.sprite);
    this.units.splice(this.units.indexOf(car), 1);
  }

  // ctx: {playerPos, playerVel, playerInCar, playerSpeed, onBust, allCars}
  update(dt, ctx) {
    const stars = this.stars;
    const seen = stars > 0 && this.anySees(ctx.playerPos);
    if (seen) this.unseenTimer = 0; else this.unseenTimer += dt;
    if (this.unseenTimer > 5 && this.lockedStars === 0) {
      this.heat = Math.max(0, this.heat - dt * 3.4);
    }
    if (this.lockedStars > 0) this.heat = Math.max(this.heat, this.lockedStars * STAR_POINTS);

    // Fleet size follows the stars.
    this.spawnTimer -= dt;
    const wanted = stars === 0 ? 0 : Math.min(5, stars + (stars >= 3 ? 1 : 0));
    if (this.units.length < wanted && this.spawnTimer <= 0) {
      this.spawnUnit(ctx.playerPos);
      this.spawnTimer = 1.6;
    }
    for (let i = this.units.length - 1; i >= 0; i--) {
      const u = this.units[i];
      const d = Math.hypot(u.pos.x - ctx.playerPos.x, u.pos.z - ctx.playerPos.z);
      if ((stars === 0 && d > 40) || d > 190) this.removeUnit(u);
    }

    // Pursuit driving.
    let busting = false;
    for (const u of this.units) {
      const lead = {
        x: ctx.playerPos.x + (ctx.playerVel?.x || 0) * 0.45,
        z: ctx.playerPos.z + (ctx.playerVel?.z || 0) * 0.45,
      };
      const dx = lead.x - u.pos.x, dz = lead.z - u.pos.z;
      const dist = Math.hypot(dx, dz);
      const want = Math.atan2(-dz, dx);
      let dh = want - u.heading;
      while (dh > Math.PI) dh -= Math.PI * 2;
      while (dh < -Math.PI) dh += Math.PI * 2;
      let throttle = Math.abs(dh) > 1.25 ? 0.25 : 1;
      let steer = Math.max(-1, Math.min(1, dh * 1.9));
      // Cornered on foot: pull up alongside and run the bust clock instead.
      if (!ctx.playerInCar && dist < 7.5) {
        throttle = dist < 4.5 ? -0.2 : 0.12;
        if (ctx.playerSpeed < 2.2 && dist < 8.5) busting = true;
      }
      // Stuck detection: full throttle but no movement means reverse out.
      if (u.reverseTimer > 0) {
        u.reverseTimer -= dt;
        throttle = -1; steer = -steer;
      } else if (Math.abs(u.speed) < 0.6 && throttle > 0.5) {
        u.stuckTimer += dt;
        if (u.stuckTimer > 1.4) { u.reverseTimer = 0.8; u.stuckTimer = 0; }
      } else u.stuckTimer = 0;
      u.drive(dt, { throttle, steer, handbrake: false }, this.world);
      if (u.hitImpulse > 6) u.damage(u.hitImpulse * 0.7);
      if (u.health <= 0) { u.speed = 0; }  // wrecked units stop hunting
    }
    for (let i = this.units.length - 1; i >= 0; i--) {
      if (this.units[i].health <= 0) this.removeUnit(this.units[i]);
    }

    if (busting) {
      this.bustTimer += dt;
      if (this.bustTimer > 2.2) { this.bustTimer = 0; ctx.onBust(); }
    } else this.bustTimer = Math.max(0, this.bustTimer - dt * 2);
  }
}
