// hud.js — everything drawn over the 3D view: health and armour bars, cash,
// wanted stars, the objective banner, dialogue box, interaction prompts,
// toasts, and the minimap. The minimap is a plain 2D canvas painted each
// frame from the same world data the game simulates, so it never lies.

import { ROAD_LINES, BEACH_X, WATER_X } from './city.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = $('hud');
    this.healthBar = $('healthBar');
    this.armourBar = $('armourBar');
    this.cashEl = $('cash');
    this.starsEl = $('stars');
    this.objectiveEl = $('objective');
    this.dialogueEl = $('dialogue');
    this.dlgName = $('dlgName');
    this.dlgText = $('dlgText');
    this.promptEl = $('prompt');
    this.weaponEl = $('weapon');
    this.speedEl = $('speedo');
    this.toastEl = $('toast');
    this.crosshair = $('crosshair');
    this.vignette = $('vignette');
    this.minimap = $('minimap').getContext('2d');
    this.toastTimer = 0;
    this.lastStars = -1;
  }

  show() { this.root.style.display = 'block'; }
  hide() { this.root.style.display = 'none'; }

  setHealth(h, armour) {
    this.healthBar.style.width = Math.max(0, h) + '%';
    this.healthBar.style.background = h > 30 ? '#7ed957' : '#e84f3d';
    this.armourBar.style.width = Math.max(0, armour) + '%';
  }

  setCash(n) { this.cashEl.textContent = '$' + Math.floor(n).toLocaleString('en-US'); }

  setStars(n) {
    if (n === this.lastStars) return;
    this.lastStars = n;
    this.starsEl.textContent = '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
    this.starsEl.style.color = n > 0 ? '#ffd23f' : 'rgba(255,255,255,0.25)';
  }

  setWeapon(text) { this.weaponEl.textContent = text; }
  setSpeed(kmh) { this.speedEl.textContent = kmh == null ? '' : Math.round(kmh) + ' km/h'; }
  setObjective(text) {
    this.objectiveEl.textContent = text || '';
    this.objectiveEl.style.display = text ? 'block' : 'none';
  }
  showDialogue(name, text) {
    this.dlgName.textContent = name;
    this.dlgText.textContent = text;
    this.dialogueEl.style.display = 'block';
  }
  hideDialogue() { this.dialogueEl.style.display = 'none'; }
  prompt(text) {
    this.promptEl.textContent = text || '';
    this.promptEl.style.display = text ? 'block' : 'none';
  }
  toast(title, sub = '') {
    this.toastEl.innerHTML = '';
    const t = document.createElement('div');
    t.className = 'toastTitle'; t.textContent = title;
    const s = document.createElement('div');
    s.className = 'toastSub'; s.textContent = sub;
    this.toastEl.append(t, s);
    this.toastEl.style.display = 'block';
    this.toastTimer = 3.2;
  }
  damageFlash() {
    this.vignette.style.opacity = '0.55';
    setTimeout(() => { this.vignette.style.opacity = '0'; }, 90);
  }
  setCrosshair(on) { this.crosshair.style.display = on ? 'block' : 'none'; }

  update(dt) {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.style.display = 'none';
    }
  }

  // view: {playerPos, playerHeading, cars[], police[], gangs[], marker, fare}
  drawMinimap(view) {
    const g = this.minimap;
    const S = 190, RANGE = 260;
    const px = (x) => (x + RANGE) * (S / (RANGE * 2));
    const pz = (z) => (z + RANGE) * (S / (RANGE * 2));
    g.fillStyle = '#131e2a';
    g.fillRect(0, 0, S, S);
    // Ocean and beach down the west edge.
    g.fillStyle = '#1b6d8f';
    g.fillRect(0, 0, px(WATER_X), S);
    g.fillStyle = '#e8d09c';
    g.fillRect(px(WATER_X), 0, px(BEACH_X) - px(WATER_X), S);
    // Roads.
    g.strokeStyle = 'rgba(220,225,235,0.4)';
    g.lineWidth = 2;
    for (const l of ROAD_LINES) {
      g.beginPath(); g.moveTo(px(l), 0); g.lineTo(px(l), S); g.stroke();
      g.beginPath(); g.moveTo(0, pz(l)); g.lineTo(S, pz(l)); g.stroke();
    }
    const dot = (x, z, color, r) => {
      g.fillStyle = color;
      g.beginPath(); g.arc(px(x), pz(z), r, 0, Math.PI * 2); g.fill();
    };
    for (const c of view.cars) dot(c.pos.x, c.pos.z, 'rgba(216,221,227,0.75)', 1.6);
    const flash = Math.floor(performance.now() / 300) % 2 === 0;
    for (const u of view.police) dot(u.pos.x, u.pos.z, flash ? '#ff4040' : '#4d7cff', 2.6);
    for (const m of view.gangs) if (m.alive) dot(m.pos.x, m.pos.z, '#ff5a3c', 2.2);
    if (view.fare) dot(view.fare.x, view.fare.z, '#ffd23f', 3);
    if (view.marker) {
      const pulse = 3.4 + Math.sin(performance.now() / 220) * 1.1;
      dot(view.marker.x, view.marker.z, '#ffd23f', pulse);
      g.strokeStyle = '#ffd23f';
      g.beginPath(); g.arc(px(view.marker.x), pz(view.marker.z), pulse + 3.5, 0, Math.PI * 2); g.stroke();
    }
    // Player arrow: the canvas angle of the facing (cos h, -sin h) is -h.
    const x = px(view.playerPos.x), y = pz(view.playerPos.z);
    g.save();
    g.translate(x, y);
    g.rotate(-view.playerHeading);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(6, 0); g.lineTo(-4.5, -4); g.lineTo(-4.5, 4);
    g.closePath(); g.fill();
    g.restore();
  }
}
