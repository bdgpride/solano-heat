// missions.js — the story of Solano Heat as data plus a small state machine.
// Five missions for fixer Marisol Kane: a timed delivery, a car theft, a
// stash-house shootout, a boulevard checkpoint race, and a betrayal that ends
// in a four-star escape to the beach safehouse. Between story beats, taxi
// fares give free roam a way to earn. This module never touches the DOM or
// three.js — main.js feeds it the player's state and acts on its requests
// (spawn a wave, add heat, pay out) through callbacks.

export const STORY = [
  {
    id: 'first-run', title: 'First Run', pay: 800,
    giver: 'garage',
    intro: [
      ['Marisol Kane', 'You must be Nico. I fix problems in Port Solano — and right now my problem is a package that needs to be across town.'],
      ['Marisol Kane', 'Take it to the Coral Bar, east side. The clock is already running, wheelman.'],
    ],
    steps: [
      { type: 'goto', at: 'barDoor', r: 7, time: 240, label: 'Deliver the package to the Coral Bar' },
    ],
    outro: [
      ['Marisol Kane', 'On time and in one piece. The Solano crews could use a driver like you.'],
    ],
  },
  {
    id: 'borrowed-wheels', title: 'Borrowed Wheels', pay: 1200,
    giver: 'garage',
    intro: [
      ['Marisol Kane', 'A collector owes me money. His gold coupe is parked on the boulevard like he owns the sun.'],
      ['Marisol Kane', 'Liberate it. Bring it to my garage by the marina — and if the SPPD notice, lose them first.'],
    ],
    steps: [
      { type: 'steal', label: 'Steal the gold coupe on the boulevard' },
      { type: 'goto', at: 'garage', r: 9, label: 'Deliver the coupe to Marisol’s garage' },
    ],
    outro: [
      ['Marisol Kane', 'Beautiful. He can buy it back from me at twice the price.'],
    ],
  },
  {
    id: 'stash-house', title: 'Stash House', pay: 2000,
    giver: 'stash',
    intro: [
      ['Marisol Kane', 'The Cordero crew is hitting my stash house on the east side tonight. I need it held.'],
      ['Nico Vega', 'You need a driver, you said. Now I’m a wall?'],
      ['Marisol Kane', 'Tonight you’re a wall that shoots back. Hold the yard, Nico.'],
    ],
    steps: [
      { type: 'goto', at: 'stash', r: 11, label: 'Get to the stash house yard' },
      { type: 'shootout', waves: [3, 4, 5], label: 'Hold the stash house' },
    ],
    outro: [
      ['Marisol Kane', 'The Corderos will think twice now. So will everyone else.'],
    ],
  },
  {
    id: 'boulevard-run', title: 'Boulevard Run', pay: 1500,
    giver: 'garage',
    intro: [
      ['Marisol Kane', 'Every Friday the boulevard crews run the loop for pink slips and pride. Six gates, one clock.'],
      ['Marisol Kane', 'Win it in anything with wheels. Make them remember the new driver.'],
    ],
    steps: [
      {
        type: 'race', time: 175, label: 'Run the boulevard loop',
        points: [[92, 0], [138, 92], [46, 138], [-46, 92], [-92, 0], [-46, -46]],
      },
    ],
    outro: [
      ['Marisol Kane', 'Six gates, no excuses. The boulevard is talking about you.'],
    ],
  },
  {
    id: 'solano-heat', title: 'Solano Heat', pay: 4000,
    giver: 'marina',
    intro: [
      ['Marisol Kane', 'Meet me at the marina, Nico. One last job — then we’re both out of this life.'],
      ['Nico Vega', 'Why does “one last job” always sound like a funeral?'],
    ],
    steps: [
      { type: 'goto', at: 'marina', r: 9, label: 'Meet Marisol at the marina' },
      { type: 'shootout', waves: [4], label: 'Survive the ambush' },
      { type: 'escape', at: 'safehouse', r: 9, label: 'Lose the SPPD — reach the beach safehouse' },
    ],
    outro: [
      ['Nico Vega', 'Marisol sold me to the Corderos for a clean exit of her own. The safehouse, the sunset, and the whole city know my name now.'],
      ['Nico Vega', 'Port Solano is mine to roam. Fares, races, trouble — whatever I want. THE END'],
    ],
  },
];

const SPOTS = {
  garage: { x: -216, z: 96 },
  barDoor: { x: 69, z: -52 },
  stash: { x: 161, z: -99 },
  marina: { x: -238, z: 150 },
  safehouse: { x: -214, z: -196 },
};

export class MissionSystem {
  constructor(cb) {
    this.cb = cb;               // {pay, toast, crime, lockWanted, queueDialogue, success, fail}
    this.storyIndex = 0;
    this.active = null;         // {def, stepIndex, step, timer, wave, raceIndex}
    this.marker = null;         // {x, z} gold objective marker, or null
    this.objectiveText = '';
    this.pendingSpawns = [];    // {x, z, count} waves main.js should create
    this.fare = null;           // {phase, ped, dest, dist}
    this.targetCar = null;      // the gold coupe, while mission 2 is live
  }

  get storyDone() { return this.storyIndex >= STORY.length; }

  giverPos() {
    if (this.storyDone || this.active) return null;
    return SPOTS[STORY[this.storyIndex].giver];
  }

  tryStart() {
    if (this.active || this.storyDone) return false;
    const def = STORY[this.storyIndex];
    this.active = { def, stepIndex: -1, timer: 0, wave: 0, raceIndex: 0 };
    this.cb.queueDialogue(def.intro);
    this.advance();
    return true;
  }

  advance() {
    const a = this.active;
    a.stepIndex++;
    if (a.stepIndex >= a.def.steps.length) { this.complete(); return; }
    a.step = a.def.steps[a.stepIndex];
    a.timer = a.step.time || 0;
    a.wave = 0;
    a.raceIndex = 0;
    if (a.step.type === 'steal') this.cb.wantTargetCar();
    if (a.step.type === 'escape') this.cb.lockWanted(4);
    this.refreshObjective();
  }

  refreshObjective() {
    const a = this.active;
    if (!a) {
      this.objectiveText = this.storyDone
        ? 'Free roam — Port Solano is yours. Grab taxi fares to earn.'
        : 'Meet your contact at the gold marker';
      const g = this.giverPos();
      this.marker = g ? { x: g.x, z: g.z } : null;
      return;
    }
    const s = a.step;
    this.objectiveText = a.def.title + ' — ' + s.label;
    if (a.timer > 0) this.objectiveText += ' · ' + Math.ceil(a.timer) + 's';
    if (s.type === 'goto' || s.type === 'escape') this.marker = { ...SPOTS[s.at] };
    else if (s.type === 'steal') this.marker = this.targetCar
      ? { x: this.targetCar.pos.x, z: this.targetCar.pos.z } : null;
    else if (s.type === 'race') {
      const p = s.points[a.raceIndex];
      this.marker = { x: p[0], z: p[1] };
      this.objectiveText += ' · gate ' + (a.raceIndex + 1) + '/' + s.points.length;
    } else if (s.type === 'shootout') this.marker = a.def.id === 'stash-house' ? { ...SPOTS.stash } : { ...SPOTS.marina };
  }

  complete() {
    const def = this.active.def;
    this.active = null;
    this.storyIndex++;
    this.cb.pay(def.pay, def.title);
    this.cb.queueDialogue(def.outro);
    this.cb.success();
    if (this.storyDone) this.cb.toast('STORY COMPLETE', 'Solano Heat — thanks for playing');
    this.refreshObjective();
  }

  fail(reason) {
    if (!this.active) return;
    this.cb.toast('MISSION FAILED', reason);
    this.cb.fail();
    this.cb.lockWanted(0);
    this.active = null;
    this.refreshObjective();
  }

  abort() { // player wasted/busted mid-mission
    if (this.active) { this.active = null; this.cb.lockWanted(0); }
    this.fare = null;
    this.refreshObjective();
  }

  // ctx: {playerPos, playerInCar, playerCar, gangAlive}
  update(dt, ctx) {
    // --- taxi fares ---------------------------------------------------------
    if (this.fare) {
      const f = this.fare;
      if (f.phase === 'pickup') {
        if (ctx.playerInCar && ctx.playerSpeed < 1.5 &&
            Math.hypot(ctx.playerPos.x - f.ped.pos.x, ctx.playerPos.z - f.ped.pos.z) < 5) {
          f.phase = 'dropoff';
          f.ped.state = 'gone';
          f.ped.mesh.visible = false;
          const dests = [[120, 120], [-120, -80], [60, -140], [-60, 160], [170, 40], [-170, -150], [0, 0]];
          const d = dests[Math.floor(Math.random() * dests.length)];
          f.dest = { x: d[0], z: d[1] };
          f.dist = Math.hypot(ctx.playerPos.x - d[0], ctx.playerPos.z - d[1]);
          this.cb.toast('FARE PICKED UP', 'Take them to the gold drop-off');
          this.cb.cashSound();
        }
      } else if (f.phase === 'dropoff') {
        if (!ctx.playerInCar) { this.fare = null; this.cb.toast('FARE LOST', 'You left them stranded'); }
        else if (Math.hypot(ctx.playerPos.x - f.dest.x, ctx.playerPos.z - f.dest.z) < 7 && ctx.playerSpeed < 2) {
          const payAmt = Math.round(45 + f.dist / 5);
          this.cb.pay(payAmt, 'Taxi fare');
          this.cb.cashSound();
          this.fare = null;
        }
      }
    }

    if (!this.active) { this.refreshObjective(); return; }
    const a = this.active;
    const s = a.step;
    if (a.timer > 0) {
      a.timer -= dt;
      if (a.timer <= 0) { this.fail('Out of time'); return; }
    }
    const p = ctx.playerPos;
    const at = (spot, r) => Math.hypot(p.x - spot.x, p.z - spot.z) < r;
    switch (s.type) {
      case 'goto':
        if (at(SPOTS[s.at], s.r)) this.advance();
        break;
      case 'escape':
        if (at(SPOTS[s.at], s.r)) { this.cb.lockWanted(0); this.cb.clearWanted(); this.advance(); }
        break;
      case 'steal':
        if (this.targetCar && ctx.playerCar === this.targetCar) {
          this.cb.crime(34);
          this.advance();
        }
        break;
      case 'race': {
        const pt = s.points[a.raceIndex];
        if (Math.hypot(p.x - pt[0], p.z - pt[1]) < 10) {
          a.raceIndex++;
          this.cb.cashSound();
          if (a.raceIndex >= s.points.length) this.advance();
        }
        break;
      }
      case 'shootout': {
        if (ctx.gangAlive === 0) {
          if (a.wave < s.waves.length) {
            const base = a.def.id === 'stash-house' ? SPOTS.stash : SPOTS.marina;
            this.pendingSpawns.push({ x: base.x, z: base.z, count: s.waves[a.wave] });
            a.wave++;
          } else this.advance();
        }
        break;
      }
    }
    this.refreshObjective();
  }
}
