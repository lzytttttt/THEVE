import {
  add,
  angleBetween,
  approach,
  clamp,
  damp,
  distance,
  formatClock,
  forwardFromAngles,
  headingFromYaw,
  normalize,
  RAD,
  randomRange,
  rightFromYaw,
  scale,
  sub,
  vec3,
  wrapRadians,
  yawFromHeading,
  yawPitchFromDirection,
} from './math';
import { sunsetSpearScenario } from './scenario';
import type {
  AudioTelemetry,
  BossHud,
  CockpitSnapshot,
  CommsMessage,
  CommsRole,
  ControlInput,
  HudTarget,
  LockState,
  MissionPhase,
  MissionStats,
  Projection,
  RadarContact,
  Scenario,
  SimEffect,
  SimEntity,
  SimEvent,
  SimListener,
  Vec3,
  WarningState,
  WeakpointKey,
  WeaponId,
  WingmanHud,
} from './types';

const MISSILE_MAX = 8;
const GUN_MAX = 900;
const FLARE_MAX = 6;
const LOCK_CONE_DEG = 12;
const LOCK_RANGE = 3600;
const LOCK_TIME = 0.9;
const PLAYER_MAX_HP = 100;
const RADAR_RANGE = 9000;
const BOSS_WEAKPOINT_HP: Record<WeakpointKey, number> = {
  shieldL: 120,
  shieldR: 120,
  core: 360,
};
const BOSS_WEAKPOINT_LABEL: Record<WeakpointKey, string> = {
  shieldL: 'SHIELD NODE A',
  shieldR: 'SHIELD NODE B',
  core: 'REACTOR CORE',
};

interface FlakStrike {
  at: number;
  offset: Vec3;
}

interface GunTarget {
  entity: SimEntity;
  point: Vec3;
}

function emptyStats(): MissionStats {
  return {
    kills: 0,
    shotsFired: 0,
    shotsHit: 0,
    missilesFired: 0,
    missilesHit: 0,
    damageTaken: 0,
    elapsed: 0,
    score: 0,
    rank: null,
  };
}

export class CockpitEngine {
  readonly scenario: Scenario;

  phase: MissionPhase = 'idle';
  paused = false;
  elapsed = 0;

  flight = {
    position: vec3(0, 6800, 0),
    yaw: 0,
    pitch: 0,
    roll: 0,
    speed: 255,
    throttle: 0.7,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    gLoad: 1,
    afterburner: false,
  };

  weapons = {
    selected: 'aam' as WeaponId,
    missiles: MISSILE_MAX,
    maxMissiles: MISSILE_MAX,
    gunAmmo: GUN_MAX,
    gunMax: GUN_MAX,
    flares: FLARE_MAX,
    maxFlares: FLARE_MAX,
  };

  entities: SimEntity[] = [];
  effects: SimEffect[] = [];

  private listeners = new Set<SimListener>();
  private projections = new Map<string, Projection>();

  private input: ControlInput = { pitch: 0, roll: 0, yaw: 0 };
  private inputTarget: ControlInput = { pitch: 0, roll: 0, yaw: 0 };
  private throttleAxis = 0;

  private selectedId: string | null = null;
  private lockProgress = 0;
  private lockInCone = false;
  private lockWasLocked = false;
  private lockDistance = 0;

  private gunHeld = false;
  private gunBurst = 0;
  private gunAccumulator = 0;
  private gunFiring = false;
  private fireCooldown = 0;
  private flareCooldown = 0;

  private wingmanId: string | null = null;
  private bossId: string | null = null;
  private bossDefeated = false;
  private bossIntroTimer = 0;
  private completionTimer = 0;
  private bootTimer = 0;
  private flakTimer = 0;
  private flak: FlakStrike | null = null;
  private droneTimer = 0;

  private kills = 0;
  private score = 0;
  private stats: MissionStats = emptyStats();
  private comms: CommsMessage[] = [];
  private warnings: WarningState[] = [];
  private idCounter = 0;

  constructor(scenario: Scenario = sunsetSpearScenario) {
    this.scenario = scenario;
    this.reset();
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  reset(): void {
    this.phase = 'idle';
    this.paused = false;
    this.elapsed = 0;
    this.flight = {
      position: vec3(0, this.scenario.start.altitude, 0),
      yaw: yawFromHeading(this.scenario.start.heading),
      pitch: 0,
      roll: 0,
      speed: this.scenario.start.speed,
      throttle: 0.7,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      gLoad: 1,
      afterburner: false,
    };
    this.weapons = {
      selected: 'aam',
      missiles: MISSILE_MAX,
      maxMissiles: MISSILE_MAX,
      gunAmmo: GUN_MAX,
      gunMax: GUN_MAX,
      flares: FLARE_MAX,
      maxFlares: FLARE_MAX,
    };
    this.input = { pitch: 0, roll: 0, yaw: 0 };
    this.inputTarget = { pitch: 0, roll: 0, yaw: 0 };
    this.throttleAxis = 0;
    this.entities = [];
    this.effects = [];
    this.projections.clear();
    this.selectedId = null;
    this.lockProgress = 0;
    this.lockInCone = false;
    this.lockWasLocked = false;
    this.lockDistance = 0;
    this.gunHeld = false;
    this.gunBurst = 0;
    this.gunAccumulator = 0;
    this.gunFiring = false;
    this.fireCooldown = 0;
    this.flareCooldown = 0;
    this.wingmanId = null;
    this.bossId = null;
    this.bossDefeated = false;
    this.bossIntroTimer = 0;
    this.completionTimer = 0;
    this.bootTimer = 0;
    this.flakTimer = 0;
    this.flak = null;
    this.droneTimer = 0;
    this.kills = 0;
    this.score = 0;
    this.stats = emptyStats();
    this.comms = [];
    this.warnings = [];
    this.idCounter = 0;
  }

  launch(): void {
    this.reset();
    this.phase = 'boot';
    this.bootTimer = 2.8;
    this.say(this.scenario.awacsCallsign, 'awacs', 'LUMEN 1，数据链同步完成。空域已清空，随时可以出发。');
    this.say(this.scenario.wingmanCallsign, 'wingman', 'LUMEN 2 编队就位。队长，落日空域的风很干净。');
    this.emit({ type: 'boot' });
  }

  skipBoot(): void {
    if (this.phase === 'boot') this.beginCombat();
  }

  restart(): void {
    this.launch();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  on(listener: SimListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: SimEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /* ------------------------------------------------------------------ */
  /* public actions                                                      */
  /* ------------------------------------------------------------------ */

  setInput(partial: Partial<ControlInput>): void {
    this.inputTarget = {
      pitch: clamp(partial.pitch ?? this.inputTarget.pitch, -1, 1),
      roll: clamp(partial.roll ?? this.inputTarget.roll, -1, 1),
      yaw: clamp(partial.yaw ?? this.inputTarget.yaw, -1, 1),
    };
  }

  setThrottle(value: number): void {
    this.flight.throttle = clamp(value, 0, 1);
    this.throttleAxis = 0;
  }

  adjustThrottle(delta: number): void {
    this.flight.throttle = clamp(this.flight.throttle + delta, 0, 1);
    this.throttleAxis = 0;
  }

  setThrottleAxis(axis: number): void {
    this.throttleAxis = clamp(axis, -1, 1);
  }

  cycleTarget(): void {
    const candidates = this.getCandidates();
    if (candidates.length === 0) {
      this.selectedId = null;
      this.warn('system', 'caution', 'NO CONTACT', '雷达范围内没有可锁定目标', 1.8);
      return;
    }
    const index = candidates.findIndex((candidate) => candidate.id === this.selectedId);
    const next = candidates[(index + 1) % candidates.length];
    this.selectTarget(next.id);
  }

  selectTarget(id: string | null): void {
    if (id === this.selectedId) return;
    this.selectedId = id;
    this.lockProgress = 0;
    this.lockWasLocked = false;
    this.lockInCone = false;
    this.lockDistance = 0;
  }

  cycleWeapon(): void {
    this.weapons.selected = this.weapons.selected === 'aam' ? 'gun' : 'aam';
  }

  selectWeapon(weapon: WeaponId): void {
    this.weapons.selected = weapon;
  }

  fire(): void {
    if (!this.canUseWeapons()) return;
    if (this.weapons.selected === 'gun') {
      this.gunBurst = Math.max(this.gunBurst, 0.32);
    } else {
      this.fireMissile();
    }
  }

  startGun(): void {
    if (!this.canUseWeapons()) return;
    this.weapons.selected = 'gun';
    this.gunHeld = true;
  }

  stopGun(): void {
    this.gunHeld = false;
  }

  fireMissile(): void {
    if (!this.canUseWeapons()) return;
    const target = this.getEntity(this.selectedId);
    if (!target || !this.isLockable(target)) {
      this.warn('system', 'caution', 'NO LOCK', '未选择有效目标 — 按 TAB 切换', 1.6);
      return;
    }
    if (this.weapons.missiles <= 0) {
      this.warn('system', 'warning', 'AAM EMPTY', '导弹挂架已空', 1.8);
      return;
    }
    if (this.fireCooldown > 0) return;
    if (this.lockProgress < 0.999) {
      this.warn('system', 'caution', 'LOCK IN PROGRESS', '保持目标在锁定锥内', 1.2);
      return;
    }
    const origin = add(
      add(this.flight.position, scale(forwardFromAngles(this.flight.yaw, this.flight.pitch), 14)),
      { x: 0, y: -4, z: 0 },
    );
    const direction = normalize(sub(target.position, origin));
    const angles = yawPitchFromDirection(direction);
    const missile = this.makeEntity({
      kind: 'missile',
      team: 'player',
      callsign: 'AAM',
      position: origin,
      yaw: angles.yaw,
      pitch: angles.pitch,
      speed: 920,
      hp: 1,
      maxHp: 1,
      radius: 3,
      label: target.callsign,
    });
    missile.missile = {
      targetId: target.id,
      speed: 920,
      life: 8,
      maxLife: 8,
      owner: 'player',
    };
    missile.maxLife = 8;
    missile.life = 8;
    this.entities.push(missile);
    this.weapons.missiles -= 1;
    this.stats.missilesFired += 1;
    this.fireCooldown = 0.45;
    this.spawnEffect('muzzle', origin, { scale: 8, color: 'cyan', life: 0.14 });
    this.emit({ type: 'missile-fire', team: 'player', id: missile.id });
  }

  flare(): void {
    if (!this.canUseWeapons() || this.flareCooldown > 0) return;
    if (this.weapons.flares <= 0) {
      this.warn('system', 'warning', 'FLARE EMPTY', '热焰弹耗尽', 1.6);
      return;
    }
    this.weapons.flares -= 1;
    this.flareCooldown = 2.6;
    const base = add(
      add(this.flight.position, scale(forwardFromAngles(this.flight.yaw, this.flight.pitch), -18)),
      { x: 0, y: -14, z: 0 },
    );
    const flares: SimEntity[] = [];
    for (let index = 0; index < 3; index += 1) {
      const offset = {
        x: randomRange(-14, 14),
        y: randomRange(-10, 4),
        z: randomRange(-14, 14),
      };
      const flare = this.makeEntity({
        kind: 'flare',
        team: 'player',
        callsign: 'FLARE',
        position: add(base, offset),
        speed: 0,
        hp: 1,
        maxHp: 1,
        radius: 2,
        label: 'FLARE',
      });
      flare.life = 2.6;
      flare.maxLife = 2.6;
      flares.push(flare);
      this.entities.push(flare);
    }
    for (const entity of this.entities) {
      if (entity.kind !== 'missile' || !entity.alive || entity.team !== 'hostile') continue;
      if (entity.missile?.targetId !== 'player') continue;
      if (Math.random() < 0.62) {
        entity.missile.targetId = flares[Math.floor(Math.random() * flares.length)]?.id ?? 'player';
      }
    }
    this.emit({ type: 'flare' });
  }

  warpToBoss(): void {
    if (this.phase === 'idle') this.launch();
    this.phase = 'boss';
    this.bootTimer = 0;
    this.bossIntroTimer = 0;
    this.bossDefeated = false;
    this.completionTimer = 0;
    this.elapsed = Math.max(this.elapsed, 62);
    this.kills = Math.max(this.kills, this.scenario.requiredKills);
    this.score = Math.max(this.score, 420);
    this.flight.hp = this.flight.maxHp;
    this.weapons.missiles = this.weapons.maxMissiles;
    this.weapons.flares = this.weapons.maxFlares;
    this.weapons.gunAmmo = this.weapons.gunMax;
    if (!this.getEntity(this.wingmanId)) this.spawnWingman();
    this.spawnBoss();
    const boss = this.getEntity(this.bossId);
    const firstShield = this.entities.find(
      (entity) => entity.kind === 'weakpoint' && entity.alive && entity.weakpoint?.key === 'shieldL',
    );
    if (firstShield) this.selectTarget(firstShield.id);
    if (boss) {
      this.say(
        this.scenario.awacsCallsign,
        'awacs',
        'LEVIATHAN 进入射程。护盾节点是突破口，LUMEN 1，看你的了。',
      );
    }
  }

  setProjection(id: string, projection: Projection): void {
    this.projections.set(id, projection);
  }

  clearProjections(): void {
    this.projections.clear();
  }

  /* ------------------------------------------------------------------ */
  /* simulation                                                          */
  /* ------------------------------------------------------------------ */

  update(dt: number): void {
    if (this.paused || this.phase === 'idle') return;
    const step = clamp(dt, 0, 0.05);
    if (step <= 0) return;

    this.elapsed += step;
    this.updateEffectsLifetime(step);
    this.flareCooldown = Math.max(0, this.flareCooldown - step);
    this.fireCooldown = Math.max(0, this.fireCooldown - step);

    if (this.phase === 'boot') {
      this.updateFlight(step);
      this.bootTimer -= step;
      if (this.bootTimer <= 0) this.beginCombat();
      return;
    }

    if (this.phase === 'complete' || this.phase === 'failed') return;

    this.updateFlight(step);
    this.updateThrottle(step);
    this.updateGun(step);
    this.updateLock(step);
    this.updateAI(step);
    this.updateWingman(step);
    this.updateMissiles(step);
    this.updateBoss(step);
    this.updateMissileWarning();
    this.updateMissionState(step);

    if (this.phase === 'boss-intro') {
      this.bossIntroTimer -= step;
      if (this.bossIntroTimer <= 0) {
        this.phase = 'boss';
        this.flakTimer = 3.5;
        this.droneTimer = 12;
      }
    }
  }

  private beginCombat(): void {
    this.phase = 'dogfight';
    this.bootTimer = 0;
    this.warnings = [];
    this.spawnWingman();
    this.spawnInitialEnemies();
    this.say(this.scenario.awacsCallsign, 'awacs', 'LUMEN 1，VESPER 编队出现在十二点方向。交战规则：自由开火。');
    this.say(this.scenario.wingmanCallsign, 'wingman', '两架主力，一架王牌。队长，别让王牌咬住你。');
    this.emit({ type: 'launch' });
    this.autoSelect();
  }

  private updateFlight(dt: number): void {
    const smoothing = 1 - Math.exp(-5.5 * dt);
    for (const axis of ['pitch', 'roll', 'yaw'] as const) {
      this.input[axis] += (this.inputTarget[axis] - this.input[axis]) * smoothing;
    }

    const speed = this.flight.speed;
    this.flight.roll = wrapRadians(this.flight.roll + this.input.roll * 1.95 * dt);
    this.flight.pitch = clamp(
      this.flight.pitch + this.input.pitch * 0.98 * dt,
      -1.35,
      1.35,
    );

    const bankTurn =
      Math.tan(clamp(this.flight.roll, -1.28, 1.28)) * (9.81 / Math.max(speed, 140)) * 2.35;
    this.flight.yaw = wrapRadians(
      this.flight.yaw + (this.input.yaw * 0.55 + bankTurn) * dt,
    );

    const targetSpeed = 128 + this.flight.throttle * 166 + (this.flight.throttle > 0.9 ? 34 : 0);
    this.flight.speed = approach(this.flight.speed, targetSpeed, 62 * dt);
    const afterburner = this.flight.throttle > 0.88;
    if (afterburner !== this.flight.afterburner) {
      this.flight.afterburner = afterburner;
      if (afterburner) this.emit({ type: 'afterburner' });
    }

    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    this.flight.position = add(this.flight.position, scale(forward, this.flight.speed * dt));

    const targetG =
      1 +
      Math.abs(this.input.pitch) * (this.flight.speed / 200) * 3.4 +
      Math.abs(this.input.roll) * 1.1;
    this.flight.gLoad = damp(this.flight.gLoad, clamp(targetG, 1, 9.2), 4, dt);
  }

  private updateThrottle(dt: number): void {
    if (this.throttleAxis === 0) return;
    this.flight.throttle = clamp(this.flight.throttle + this.throttleAxis * 0.42 * dt, 0, 1);
  }

  private updateLock(dt: number): void {
    const target = this.getEntity(this.selectedId);
    if (!target || !target.alive || !this.isLockable(target)) {
      if (this.selectedId !== null && this.phase !== 'boss-intro') {
        this.selectedId = null;
        this.lockProgress = 0;
        this.lockWasLocked = false;
        if (this.phase === 'dogfight' || this.phase === 'boss') this.autoSelect();
      }
      return;
    }

    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const toTarget = sub(target.position, this.flight.position);
    const dist = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2);
    const angle = angleBetween(forward, normalize(toTarget)) * RAD;
    this.lockDistance = dist;
    this.lockInCone = angle <= LOCK_CONE_DEG && dist <= LOCK_RANGE;
    if (this.lockProgress < 1) {
      const rate = this.lockInCone ? dt / LOCK_TIME : -(dt / LOCK_TIME) * 2.4;
      this.lockProgress = clamp(this.lockProgress + rate, 0, 1);
    } else if (angle <= 38 && dist <= 4800) {
      // Once acquired, keep the lock while the target stays roughly in front.
      this.lockProgress = 1;
    } else {
      this.lockProgress = 0;
    }

    const locked = this.lockProgress >= 0.999;
    if (locked && !this.lockWasLocked) {
      this.emit({ type: 'lock-acquired', targetId: target.id });
      this.addComms(
        this.scenario.wingmanCallsign,
        'wingman',
        target.kind === 'weakpoint'
          ? '护盾节点的锁定信号很稳定，打它！'
          : '咬住了！队长，Fox Two！',
      );
    }
    if (!locked && this.lockWasLocked) this.emit({ type: 'lock-lost' });
    this.lockWasLocked = locked;
  }

  private updateGun(dt: number): void {
    const active = this.phase === 'dogfight' || this.phase === 'boss';
    this.gunBurst = Math.max(0, this.gunBurst - dt);
    if (!active || this.weapons.gunAmmo <= 0 || (!this.gunHeld && this.gunBurst <= 0)) {
      this.gunFiring = false;
      return;
    }
    this.gunFiring = true;
    this.gunAccumulator += dt;
    const interval = 0.085;
    let fired = 0;
    while (this.gunAccumulator >= interval && fired < 4 && this.weapons.gunAmmo > 0) {
      this.gunAccumulator -= interval;
      this.weapons.gunAmmo -= 1;
      fired += 1;
      this.fireGunRound();
    }
    if (fired > 0) this.emit({ type: 'gun-fire', team: 'player' });
    if (this.weapons.gunAmmo <= 0) {
      this.gunFiring = false;
      this.warn('system', 'caution', 'GUN DRY', '机炮弹药耗尽', 1.4);
    }
  }

  private fireGunRound(): void {
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const origin = add(
      add(this.flight.position, scale(forward, 22)),
      { x: 0, y: -3, z: 0 },
    );
    const target = this.findGunTarget();
    const end = target
      ? target.point
      : add(origin, scale(forward, 1600));
    this.spawnEffect('tracer', origin, { to: end, scale: 1, color: 'amber', life: 0.12 });
    if (target) {
      this.applyDamage(target.entity, 5 + Math.random() * 3, 'player');
      this.spawnEffect('explosion', target.point, { scale: 2.4, color: 'amber', life: 0.18 });
    }
  }

  private findGunTarget(): GunTarget | null {
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    let best: GunTarget | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const entity of this.entities) {
      if (!entity.alive || !this.isLockable(entity)) continue;
      const toTarget = sub(entity.position, this.flight.position);
      const range = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2);
      if (range > 1750) continue;
      const angle = angleBetween(forward, normalize(toTarget)) * RAD;
      if (angle > 5.5) continue;
      const score = angle * 10 + range / 250;
      if (score < bestScore) {
        bestScore = score;
        best = { entity, point: entity.position };
      }
    }
    return best;
  }

  private updateAI(dt: number): void {
    const player = this.flight.position;
    for (const entity of this.entities) {
      if (!entity.alive || entity.kind !== 'fighter' || !entity.ai) continue;
      const ai = entity.ai;
      ai.cooldown -= dt;
      ai.evadeTimer = Math.max(0, ai.evadeTimer - dt);

      const toPlayer = sub(player, entity.position);
      const dist = Math.sqrt(toPlayer.x ** 2 + toPlayer.y ** 2 + toPlayer.z ** 2);
      const forward = forwardFromAngles(entity.yaw, entity.pitch);
      const angle = angleBetween(forward, normalize(toPlayer)) * RAD;

      if (dist < 900) {
        ai.mode = 'evade';
        ai.evadeTimer = Math.max(ai.evadeTimer, 1.7);
      }
      if (this.selectedId === entity.id && ai.evadeTimer <= 0 && Math.random() < 0.006) {
        ai.mode = 'evade';
        ai.evadeTimer = randomRange(0.9, 1.7);
      }
      if (ai.mode === 'evade' && ai.evadeTimer <= 0) ai.mode = 'engage';

      if (ai.mode === 'engage') {
        const desired = yawPitchFromDirection(toPlayer);
        const yawDelta = wrapRadians(desired.yaw - entity.yaw);
        const maxYaw = (entity.variant === 'ace' ? 1.15 : 0.82) * dt;
        entity.yaw = wrapRadians(entity.yaw + clamp(yawDelta, -maxYaw, maxYaw));
        entity.pitch = clamp(
          entity.pitch + clamp(desired.pitch - entity.pitch, -0.5 * dt, 0.5 * dt),
          -1.1,
          1.1,
        );
        entity.roll = damp(
          entity.roll,
          clamp(-yawDelta * 2.2, -1.05, 1.05),
          3.2,
          dt,
        );
        if (
          ai.cooldown <= 0 &&
          dist < 2900 &&
          dist > 650 &&
          angle < 24 &&
          (this.phase === 'dogfight' || this.phase === 'boss')
        ) {
          this.fireEnemyMissile(entity);
          ai.cooldown = entity.variant === 'ace' ? randomRange(4.2, 6.4) : randomRange(6, 9);
        }
      } else {
        entity.roll = damp(entity.roll, Math.sin(this.elapsed * 3 + ai.seed) * 0.7, 2.5, dt);
        entity.pitch = clamp(entity.pitch + Math.sin(this.elapsed + ai.seed) * 0.14 * dt, -0.9, 0.9);
      }

      const heading = forwardFromAngles(entity.yaw, entity.pitch);
      entity.position = add(entity.position, scale(heading, entity.speed * dt));
      entity.position.y = clamp(entity.position.y, 1800, 11800);
      if (dist > 5200) {
        entity.ai.mode = 'engage';
      }
    }
  }

  private fireEnemyMissile(enemy: SimEntity): void {
    const direction = normalize(sub(this.flight.position, enemy.position));
    const angles = yawPitchFromDirection(direction);
    const missile = this.makeEntity({
      kind: 'missile',
      team: 'hostile',
      callsign: 'VESPER AAM',
      position: add(enemy.position, scale(direction, 16)),
      yaw: angles.yaw,
      pitch: angles.pitch,
      speed: 660,
      hp: 1,
      maxHp: 1,
      radius: 3,
      label: enemy.callsign,
    });
    missile.missile = {
      targetId: 'player',
      speed: 660,
      life: 9,
      maxLife: 9,
      owner: 'hostile',
    };
    missile.life = 9;
    missile.maxLife = 9;
    this.entities.push(missile);
    this.emit({ type: 'missile-fire', team: 'hostile', id: missile.id });
  }

  private updateWingman(dt: number): void {
    const wingman = this.getEntity(this.wingmanId);
    if (!wingman || !wingman.alive) return;
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const right = rightFromYaw(this.flight.yaw);
    const slot = add(
      add(this.flight.position, scale(forward, 300)),
      add(scale(right, 190), { x: 0, y: 30, z: 0 }),
    );
    const lerpFactor = 1 - Math.exp(-1.8 * dt);
    wingman.position.x += (slot.x - wingman.position.x) * lerpFactor;
    wingman.position.y += (slot.y - wingman.position.y) * lerpFactor;
    wingman.position.z += (slot.z - wingman.position.z) * lerpFactor;
    wingman.yaw = this.flight.yaw + Math.sin(this.elapsed * 0.7) * 0.015;
    wingman.pitch = this.flight.pitch;
    wingman.roll = this.flight.roll - 0.06;
    wingman.speed = this.flight.speed;
    wingman.hp = wingman.maxHp;

    wingman.ai = wingman.ai ?? {
      mode: 'formation',
      cooldown: 4,
      evadeTimer: 0,
      seed: 1,
    };
    wingman.ai.cooldown -= dt;
    if (
      wingman.ai.cooldown <= 0 &&
      (this.phase === 'dogfight' || this.phase === 'boss')
    ) {
      const target = this.entities.find(
        (entity) =>
          entity.alive &&
          entity.team === 'hostile' &&
          entity.kind === 'fighter' &&
          distance(entity.position, this.flight.position) < 2800,
      );
      if (target) {
        this.spawnEffect('tracer', wingman.position, {
          to: target.position,
          scale: 1,
          color: 'green',
          life: 0.14,
        });
        this.applyDamage(target, 6, 'wingman', true);
        wingman.ai.cooldown = randomRange(5.5, 8);
      } else {
        wingman.ai.cooldown = 2.5;
      }
    }
  }

  private updateMissiles(dt: number): void {
    for (const entity of this.entities) {
      if (entity.kind !== 'missile' || !entity.alive || !entity.missile) continue;
      entity.missile.life -= dt;
      entity.life = entity.missile.life;
      if (entity.missile.life <= 0) {
        entity.alive = false;
        this.spawnEffect('explosion', entity.position, { scale: 10, color: 'white', life: 0.5 });
        continue;
      }
      const target = this.resolveMissileTarget(entity.missile.targetId);
      if (!target) {
        entity.alive = false;
        this.spawnEffect('explosion', entity.position, { scale: 8, color: 'white', life: 0.4 });
        continue;
      }
      const targetPoint = target === 'player' ? this.flight.position : target.position;
      const desired = yawPitchFromDirection(sub(targetPoint, entity.position));
      const turn = 2.1 * dt;
      entity.yaw = wrapRadians(
        entity.yaw + clamp(wrapRadians(desired.yaw - entity.yaw), -turn, turn),
      );
      entity.pitch = clamp(
        entity.pitch + clamp(desired.pitch - entity.pitch, -turn, turn),
        -1.3,
        1.3,
      );
      const forward = forwardFromAngles(entity.yaw, entity.pitch);
      entity.position = add(entity.position, scale(forward, entity.missile.speed * dt));
      entity.roll = Math.sin(this.elapsed * 9) * 0.3;

      if (distance(entity.position, targetPoint) < 62) {
        entity.alive = false;
        this.detonateMissile(entity, target);
      }
    }
    this.entities = this.entities.filter(
      (entity) =>
        entity.alive ||
        entity.kind === 'fighter' ||
        entity.kind === 'weakpoint' ||
        entity.kind === 'dreadnought',
    );
  }

  private detonateMissile(missile: SimEntity, target: SimEntity | null | 'player'): void {
    const impact = missile.position;
    this.spawnEffect('explosion', impact, {
      scale: missile.team === 'player' ? 18 : 16,
      color: 'amber',
      life: 0.9,
    });
    this.emit({ type: 'explosion', position: impact, scale: 16 });
    if (missile.team === 'hostile') {
      if (missile.missile?.targetId === 'player') {
        this.damagePlayer(12);
      }
      return;
    }
    this.stats.missilesHit += 1;
    if (target && target !== 'player') {
      this.applyDamage(target, target.kind === 'weakpoint' ? 120 : 200, 'player');
    }
  }

  private resolveMissileTarget(id: string): SimEntity | 'player' | null {
    if (id === 'player') return 'player';
    const entity = this.getEntity(id);
    if (!entity || !entity.alive) return null;
    return entity;
  }

  private updateBoss(dt: number): void {
    const boss = this.getEntity(this.bossId);
    if (!boss || !boss.alive) return;
    const player = this.flight.position;

    const toPlayer = sub(player, boss.position);
    const desired = yawPitchFromDirection(toPlayer);
    boss.yaw = wrapRadians(
      boss.yaw + clamp(wrapRadians(desired.yaw - boss.yaw), -0.06 * dt, 0.06 * dt),
    );
    boss.roll = Math.sin(this.elapsed * 0.31) * 0.02;
    const forward = forwardFromAngles(boss.yaw, 0);
    boss.position = add(boss.position, scale(forward, 4 * dt));

    const right = rightFromYaw(boss.yaw);
    for (const entity of this.entities) {
      if (entity.kind !== 'weakpoint' || !entity.alive || !entity.weakpoint) continue;
      if (entity.weakpoint.parentId !== boss.id) continue;
      const lateral = entity.weakpoint.key === 'shieldL' ? -520 : entity.weakpoint.key === 'shieldR' ? 520 : 0;
      const depth = entity.weakpoint.key === 'core' ? 300 : 130;
      const height = entity.weakpoint.key === 'core' ? -10 : 60;
      entity.position = add(
        add(boss.position, scale(right, lateral)),
        add(scale(forward, depth), { x: 0, y: height, z: 0 }),
      );
      entity.yaw = boss.yaw;
      entity.roll = boss.roll;
    }

    if (this.phase !== 'boss' || this.bossDefeated) return;

    this.flakTimer -= dt;
    if (this.flakTimer <= 0) {
      this.flakTimer = randomRange(4.6, 6.8);
      this.flak = {
        at: this.elapsed + 2,
        offset: {
          x: randomRange(-160, 160),
          y: randomRange(-40, 90),
          z: randomRange(-160, 160),
        },
      };
      this.warn('boss', 'warning', 'FLAK BURST', '弹幕锁定 — 立即机动', 2.1);
    }
    if (this.flak && this.elapsed >= this.flak.at) {
      const impact = add(this.flight.position, this.flak.offset);
      this.flak = null;
      this.spawnEffect('explosion', impact, { scale: 28, color: 'amber', life: 1 });
      this.emit({ type: 'explosion', position: impact, scale: 20 });
      if (Math.random() < 0.28) this.damagePlayer(8);
    }

    this.droneTimer -= dt;
    if (this.droneTimer <= 0) {
      this.droneTimer = randomRange(14, 18);
      const droneCount = this.entities.filter(
        (entity) => entity.alive && entity.kind === 'fighter' && entity.team === 'hostile',
      ).length;
      if (droneCount < 4) this.spawnDrone(boss);
    }
  }

  private updateMissionState(dt: number): void {
    if (this.flight.hp <= 0 && this.phase !== 'complete' && this.phase !== 'failed') {
      this.failMission();
      return;
    }
    if (this.phase === 'dogfight') {
      if (this.kills >= this.scenario.requiredKills || this.elapsed >= this.scenario.bossTriggerAt) {
        this.beginBossIntro();
      }
      return;
    }
    if (this.phase === 'boss' && this.bossDefeated) {
      this.completionTimer -= dt;
      if (this.completionTimer <= 0) this.completeMission();
    }
  }

  private beginBossIntro(): void {
    if (this.phase !== 'dogfight') return;
    this.phase = 'boss-intro';
    this.bossIntroTimer = 3.1;
    this.weapons.missiles = this.weapons.maxMissiles;
    this.weapons.flares = this.weapons.maxFlares;
    this.weapons.gunAmmo = this.weapons.gunMax;
    this.emit({ type: 'resupply' });
    this.spawnBoss();
    this.say(
      this.scenario.awacsCallsign,
      'awacs',
      '警告！巨型空中目标进入战区 — 识别为 LEVIATHAN。全员规避其弹幕。',
    );
    this.say(this.scenario.wingmanCallsign, 'wingman', '那东西比整座城市还大……队长，我跟着你。');
    this.warn('boss', 'critical', 'MASSIVE CONTACT', '战争巨兽出现 — 摧毁护盾节点', 4.5);
    this.emit({ type: 'boss-intro' });
    const shield = this.entities.find(
      (entity) => entity.kind === 'weakpoint' && entity.weakpoint?.key === 'shieldL',
    );
    if (shield) this.selectTarget(shield.id);
  }

  private completeMission(): void {
    if (this.phase === 'complete') return;
    const accuracy = this.stats.missilesFired > 0 ? this.stats.missilesHit / this.stats.missilesFired : 0;
    const timeBonus = Math.max(0, Math.round(1200 - this.elapsed * 5.5));
    this.score += 2000 + Math.round(accuracy * 800) + timeBonus;
    this.stats.score = this.score;
    this.stats.elapsed = Math.floor(this.elapsed);
    this.stats.rank =
      this.score >= 5200 ? 'S' : this.score >= 4100 ? 'A' : this.score >= 2900 ? 'B' : 'C';
    this.phase = 'complete';
    this.gunHeld = false;
    this.gunFiring = false;
    this.addComms(this.scenario.awacsCallsign, 'awacs', 'LEVIATHAN 已沉没。全体返航，这是属于 CIRRUS 的黄昏。');
    this.say(this.scenario.wingmanCallsign, 'wingman', '干得漂亮，队长。今晚的酒我请。');
    this.emit({ type: 'mission-complete' });
  }

  private failMission(): void {
    if (this.phase === 'failed' || this.phase === 'complete') return;
    this.phase = 'failed';
    this.flight.hp = 0;
    this.gunHeld = false;
    this.gunFiring = false;
    this.stats.elapsed = Math.floor(this.elapsed);
    this.stats.rank = 'C';
    this.stats.score = this.score;
    this.spawnEffect('explosion', this.flight.position, { scale: 40, color: 'red', life: 1.4 });
    this.emit({ type: 'explosion', position: this.flight.position, scale: 40 });
    this.say(this.scenario.wingmanCallsign, 'wingman', 'LUMEN 1！跳伞！重复，跳伞！');
    this.emit({ type: 'mission-failed' });
  }

  /* ------------------------------------------------------------------ */
  /* spawning & damage                                                   */
  /* ------------------------------------------------------------------ */

  private makeEntity(options: {
    kind: SimEntity['kind'];
    team: SimEntity['team'];
    callsign: string;
    position: Vec3;
    speed: number;
    hp: number;
    maxHp: number;
    radius: number;
    yaw?: number;
    pitch?: number;
    roll?: number;
    label?: string;
    variant?: SimEntity['variant'];
  }): SimEntity {
    this.idCounter += 1;
    return {
      id: `${options.kind}-${this.idCounter}`,
      kind: options.kind,
      team: options.team,
      callsign: options.callsign,
      label: options.label ?? options.callsign,
      position: options.position,
      yaw: options.yaw ?? 0,
      pitch: options.pitch ?? 0,
      roll: options.roll ?? 0,
      speed: options.speed,
      hp: options.hp,
      maxHp: options.maxHp,
      radius: options.radius,
      alive: true,
      variant: options.variant ?? 'standard',
      ai: null,
      missile: null,
      weakpoint: null,
      life: 0,
      maxLife: 0,
    };
  }

  private spawnWingman(): void {
    if (this.getEntity(this.wingmanId)) return;
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const right = rightFromYaw(this.flight.yaw);
    const position = add(
      add(this.flight.position, scale(forward, 300)),
      add(scale(right, 190), { x: 0, y: 30, z: 0 }),
    );
    const wingman = this.makeEntity({
      kind: 'wingman',
      team: 'ally',
      callsign: this.scenario.wingmanCallsign,
      label: 'WINGMAN',
      position,
      yaw: this.flight.yaw,
      pitch: this.flight.pitch,
      roll: this.flight.roll,
      speed: this.flight.speed,
      hp: 100,
      maxHp: 100,
      radius: 8,
    });
    wingman.ai = { mode: 'formation', cooldown: 4.5, evadeTimer: 0, seed: 2 };
    this.entities.push(wingman);
    this.wingmanId = wingman.id;
  }

  private spawnInitialEnemies(): void {
    const forward = forwardFromAngles(this.flight.yaw, 0);
    const right = rightFromYaw(this.flight.yaw);
    for (const enemy of this.scenario.enemies) {
      const position = add(
        add(this.flight.position, scale(forward, enemy.distance)),
        add(scale(right, enemy.side), { x: 0, y: enemy.vertical, z: 0 }),
      );
      const direction = sub(this.flight.position, position);
      const angles = yawPitchFromDirection(direction);
      const entity = this.makeEntity({
        kind: 'fighter',
        team: 'hostile',
        callsign: enemy.callsign,
        position,
        yaw: angles.yaw,
        pitch: angles.pitch,
        speed: enemy.variant === 'ace' ? 218 : 194,
        hp: enemy.variant === 'ace' ? 150 : 100,
        maxHp: enemy.variant === 'ace' ? 150 : 100,
        radius: 9,
        variant: enemy.variant ?? 'standard',
      });
      entity.ai = {
        mode: 'engage',
        cooldown: randomRange(4.5, 8),
        evadeTimer: 0,
        seed: randomRange(0, 10),
      };
      this.entities.push(entity);
    }
  }

  private spawnDrone(boss: SimEntity): void {
    const offset = {
      x: randomRange(-180, 180),
      y: randomRange(-40, 50),
      z: randomRange(-120, 120),
    };
    const position = add(boss.position, offset);
    const direction = sub(this.flight.position, position);
    const angles = yawPitchFromDirection(direction);
    const drone = this.makeEntity({
      kind: 'fighter',
      team: 'hostile',
      callsign: 'VESPER DRONE',
      position,
      yaw: angles.yaw,
      pitch: angles.pitch,
      speed: 205,
      hp: 70,
      maxHp: 70,
      radius: 8,
      variant: 'standard',
    });
    drone.ai = {
      mode: 'engage',
      cooldown: randomRange(1, 2.5),
      evadeTimer: 0,
      seed: randomRange(0, 10),
    };
    this.entities.push(drone);
    this.say(this.scenario.awacsCallsign, 'awacs', 'LEVIATHAN 放出无人机群，注意近距离缠斗。');
  }

  private spawnBoss(): void {
    if (this.getEntity(this.bossId)) return;
    const config = this.scenario.boss;
    const forward = forwardFromAngles(this.flight.yaw, 0);
    const right = rightFromYaw(this.flight.yaw);
    const position: Vec3 = {
      x: this.flight.position.x + forward.x * config.spawnDistance + right.x * config.spawnSide,
      y: config.spawnAlt,
      z: this.flight.position.z + forward.z * config.spawnDistance + right.z * config.spawnSide,
    };
    const boss = this.makeEntity({
      kind: 'dreadnought',
      team: 'hostile',
      callsign: config.callsign,
      label: config.nameEn,
      position,
      yaw: yawPitchFromDirection(sub(this.flight.position, position)).yaw,
      pitch: 0,
      speed: 5,
      hp: 600,
      maxHp: 600,
      radius: 260,
      variant: 'dreadnought',
    });
    boss.ai = { mode: 'drift', cooldown: 0, evadeTimer: 0, seed: 7 };
    this.entities.push(boss);
    this.bossId = boss.id;

    for (const key of ['shieldL', 'shieldR', 'core'] as WeakpointKey[]) {
      const weakpoint = this.makeEntity({
        kind: 'weakpoint',
        team: 'hostile',
        callsign: config.callsign,
        label: BOSS_WEAKPOINT_LABEL[key],
        position: boss.position,
        yaw: boss.yaw,
        speed: 0,
        hp: BOSS_WEAKPOINT_HP[key],
        maxHp: BOSS_WEAKPOINT_HP[key],
        radius: key === 'core' ? 38 : 26,
        variant: 'dreadnought',
      });
      weakpoint.weakpoint = {
        key,
        parentId: boss.id,
        label: BOSS_WEAKPOINT_LABEL[key],
        targetable: key !== 'core',
      };
      this.entities.push(weakpoint);
    }
  }

  private applyDamage(
    target: SimEntity,
    damage: number,
    source: 'player' | 'wingman',
    assist = false,
  ): void {
    if (!target.alive) return;
    target.hp = Math.max(0, target.hp - damage);
    const mine = source === 'player';
    this.emit({ type: 'hit', targetId: target.id, damage, mine });
    this.spawnEffect('explosion', target.position, {
      scale: target.kind === 'fighter' ? 5 : 8,
      color: 'amber',
      life: 0.35,
    });
    if (target.kind === 'fighter') {
      if (target.hp <= 0) {
        if (assist) {
          target.hp = 1;
          return;
        }
        this.destroyFighter(target, mine);
      }
      return;
    }
    if (target.kind === 'weakpoint' && target.weakpoint) {
      if (assist) {
        target.hp = Math.max(1, target.hp);
        return;
      }
      if (target.hp <= 0) this.destroyWeakpoint(target);
    }
  }

  private destroyFighter(target: SimEntity, minedByPlayer: boolean): void {
    if (!target.alive) return;
    target.alive = false;
    target.hp = 0;
    this.spawnEffect('explosion', target.position, { scale: 28, color: 'red', life: 1.2 });
    this.spawnEffect('shockwave', target.position, { scale: 40, color: 'amber', life: 0.8 });
    this.emit({ type: 'explosion', position: target.position, scale: 24 });
    if (minedByPlayer) {
      this.kills += 1;
      this.stats.kills += 1;
      this.score += target.variant === 'ace' ? 180 : 100;
      const lines =
        target.variant === 'ace'
          ? ['王牌掉了！这就是 CIRRUS 的答案。', 'VESPER ACE 被击落，敌编队正在崩溃。']
          : ['VESPER 被击落，干得漂亮。', '确认击落，雷达上少了一个光点。'];
      this.say(this.scenario.wingmanCallsign, 'wingman', lines[Math.floor(Math.random() * lines.length)] ?? lines[0]);
    }
    if (this.selectedId === target.id) {
      this.selectedId = null;
      this.lockProgress = 0;
      this.lockWasLocked = false;
      this.autoSelect();
    }
  }

  private destroyWeakpoint(target: SimEntity): void {
    if (!target.alive || !target.weakpoint) return;
    target.alive = false;
    target.weakpoint.targetable = false;
    target.hp = 0;
    this.spawnEffect('explosion', target.position, { scale: 60, color: 'amber', life: 1.5 });
    this.spawnEffect('shockwave', target.position, { scale: 120, color: 'amber', life: 1.2 });
    this.emit({ type: 'explosion', position: target.position, scale: 55 });
    this.score += 500;

    const boss = this.getEntity(this.bossId);
    const weakpoints = this.getWeakpoints();
    if (target.weakpoint.key === 'core') {
      if (boss) {
        boss.alive = false;
        boss.hp = 0;
      }
      this.bossDefeated = true;
      this.completionTimer = 3.4;
      this.score += 2000;
      this.weapons.missiles = this.weapons.maxMissiles;
      this.spawnEffect('shockwave', target.position, { scale: 300, color: 'white', life: 2 });
      this.emit({ type: 'boss-destroyed' });
      this.say(this.scenario.awacsCallsign, 'awacs', '反应堆核心贯穿！LEVIATHAN 正在解体 — 全员脱离。');
      this.say(this.scenario.wingmanCallsign, 'wingman', '天哪……它真的沉了。队长，我们回家。');
      this.selectedId = null;
      this.lockProgress = 0;
      return;
    }

    this.emit({ type: 'boss-shield-down', key: target.weakpoint.key });
    const aliveShields = weakpoints.filter(
      (weakpoint) => weakpoint.weakpoint?.key !== 'core' && weakpoint.alive,
    ).length;
    const core = weakpoints.find((weakpoint) => weakpoint.weakpoint?.key === 'core');
    if (aliveShields === 0 && core && core.weakpoint) {
      core.weakpoint.targetable = true;
      this.say(this.scenario.awacsCallsign, 'awacs', '两具护盾节点失效，核心暴露！集中火力攻击反应堆。');
      this.selectTarget(core.id);
    } else {
      this.say(this.scenario.wingmanCallsign, 'wingman', '护盾节点失效一个，还有一具！');
      const next = weakpoints.find(
        (weakpoint) =>
          weakpoint.alive &&
          weakpoint.weakpoint?.key !== 'core' &&
          weakpoint.weakpoint?.targetable,
      );
      if (next) this.selectTarget(next.id);
    }
  }

  private damagePlayer(amount: number): void {
    if (this.phase === 'complete' || this.phase === 'failed') return;
    this.flight.hp = Math.max(0, this.flight.hp - amount);
    this.stats.damageTaken += amount;
    this.warn('damage', 'warning', 'HULL DAMAGE', `结构损伤 -${amount}%`, 1.7);
    this.emit({ type: 'damage', amount });
    if (this.flight.hp <= 0) this.failMission();
  }

  /* ------------------------------------------------------------------ */
  /* effects, warnings, comms                                            */
  /* ------------------------------------------------------------------ */

  private spawnEffect(
    kind: SimEffect['kind'],
    position: Vec3,
    options: {
      scale?: number;
      color?: SimEffect['color'];
      life?: number;
      to?: Vec3;
    } = {},
  ): void {
    this.idCounter += 1;
    this.effects.push({
      id: `fx-${this.idCounter}`,
      kind,
      position,
      to: options.to ?? null,
      scale: options.scale ?? 1,
      color: options.color ?? 'amber',
      life: options.life ?? 0.6,
      maxLife: options.life ?? 0.6,
    });
    if (this.effects.length > 110) this.effects.splice(0, this.effects.length - 110);
  }

  private updateEffectsLifetime(dt: number): void {
    for (const effect of this.effects) effect.life -= dt;
    this.effects = this.effects.filter((effect) => effect.life > 0);
    for (const entity of this.entities) {
      if (entity.kind === 'flare') {
        entity.life -= dt;
        if (entity.life <= 0) entity.alive = false;
      }
    }
  }

  private warn(
    kind: WarningState['kind'],
    severity: WarningState['severity'],
    message: string,
    detail: string,
    duration: number,
    direction = 0,
  ): void {
    const existing = this.warnings.find(
      (warning) => warning.kind === kind && warning.message === message,
    );
    if (existing) {
      existing.expiresAt = this.elapsed + duration;
      existing.detail = detail;
      existing.direction = direction;
      return;
    }
    const warning: WarningState = {
      id: `warn-${kind}-${this.idCounter++}`,
      kind,
      severity,
      message,
      detail,
      direction,
      expiresAt: this.elapsed + duration,
    };
    this.warnings.push(warning);
    if (this.warnings.length > 6) this.warnings.shift();
    this.emit({ type: 'warning', warning });
  }

  private updateMissileWarning(): void {
    const missile = this.entities.find(
      (entity) =>
        entity.alive &&
        entity.kind === 'missile' &&
        entity.team === 'hostile' &&
        entity.missile?.targetId === 'player',
    );
    if (!missile) return;
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const right = rightFromYaw(this.flight.yaw);
    const toMissile = normalize(sub(missile.position, this.flight.position));
    const direction =
      Math.atan2(
        toMissile.x * right.x + toMissile.y * right.y + toMissile.z * right.z,
        toMissile.x * forward.x + toMissile.y * forward.y + toMissile.z * forward.z,
      ) * RAD;
    this.warn('missile', 'critical', 'MISSILE ALERT', '导弹来袭 — F 释放热焰弹', 0.5, direction);
  }

  private addComms(from: string, role: CommsRole, text: string): void {
    const message: CommsMessage = {
      id: `comms-${this.idCounter++}`,
      at: this.elapsed,
      from,
      role,
      text,
    };
    this.comms.push(message);
    if (this.comms.length > 8) this.comms.shift();
    this.emit({ type: 'radio', message });
  }

  private say(from: string, role: CommsRole, text: string): void {
    this.addComms(from, role, text);
  }

  /* ------------------------------------------------------------------ */
  /* queries & snapshot                                                  */
  /* ------------------------------------------------------------------ */

  private canUseWeapons(): boolean {
    return (
      !this.paused &&
      (this.phase === 'dogfight' || this.phase === 'boss-intro' || this.phase === 'boss')
    );
  }

  private getEntity(id: string | null): SimEntity | undefined {
    if (!id) return undefined;
    return this.entities.find((entity) => entity.id === id);
  }

  private getWeakpoints(): SimEntity[] {
    return this.entities.filter((entity) => entity.kind === 'weakpoint');
  }

  private isLockable(entity: SimEntity): boolean {
    if (!entity.alive || entity.team !== 'hostile') return false;
    if (entity.kind === 'fighter') return true;
    if (entity.kind === 'weakpoint') return entity.weakpoint?.targetable === true;
    return false;
  }

  private getCandidates(): SimEntity[] {
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    return this.entities
      .filter((entity) => this.isLockable(entity))
      .map((entity) => {
        const toTarget = normalize(sub(entity.position, this.flight.position));
        return {
          entity,
          score:
            angleBetween(forward, toTarget) * RAD +
            distance(entity.position, this.flight.position) / 1400,
        };
      })
      .sort((a, b) => a.score - b.score)
      .map((entry) => entry.entity);
  }

  private autoSelect(): void {
    if (this.phase !== 'dogfight' && this.phase !== 'boss' && this.phase !== 'boss-intro') return;
    const current = this.getEntity(this.selectedId);
    if (current && this.isLockable(current)) return;
    const candidates = this.getCandidates();
    const bossActive = Boolean(this.bossId) && !this.bossDefeated;
    const weakpoint = bossActive ? candidates.find((candidate) => candidate.kind === 'weakpoint') : undefined;
    this.selectTarget((weakpoint ?? candidates[0])?.id ?? null);
  }

  private getLockState(): LockState {
    const target = this.getEntity(this.selectedId);
    const targetable = target && this.isLockable(target);
    const locked = targetable && this.lockProgress >= 0.999;
    return {
      targetId: targetable ? this.selectedId : null,
      callsign: targetable ? target.label || target.callsign : null,
      progress: targetable ? this.lockProgress : 0,
      state: locked ? 'locked' : targetable && this.lockProgress > 0.02 ? 'searching' : 'none',
      distance: this.lockDistance,
      inCone: this.lockInCone,
    };
  }

  private buildBossHud(): BossHud | null {
    const boss = this.getEntity(this.bossId);
    if (!boss) return null;
    const weakpoints = this.getWeakpoints().filter(
      (entity) => entity.weakpoint?.parentId === boss.id,
    );
    if (weakpoints.length === 0) return null;
    const hp = weakpoints.reduce((total, entity) => total + Math.max(0, entity.hp), 0);
    const maxHp = weakpoints.reduce((total, entity) => total + entity.maxHp, 0);
    const shieldsAlive = weakpoints.filter(
      (entity) => entity.weakpoint?.key !== 'core' && entity.alive,
    ).length;
    const coreExposed = weakpoints.some(
      (entity) => entity.weakpoint?.key === 'core' && entity.weakpoint.targetable,
    );
    const stage: 1 | 2 | 3 = coreExposed ? 3 : shieldsAlive === 2 ? 1 : 2;
    return {
      id: boss.id,
      callsign: this.scenario.boss.callsign,
      nameEn: this.scenario.boss.nameEn,
      nameZh: this.scenario.boss.nameZh,
      hp,
      maxHp,
      stage,
      weakpoints: weakpoints
        .map((entity) => ({
          key: entity.weakpoint?.key ?? 'core',
          label: entity.weakpoint?.label ?? BOSS_WEAKPOINT_LABEL.core,
          hp: Math.max(0, entity.hp),
          maxHp: entity.maxHp,
          destroyed: !entity.alive,
          targetable: entity.weakpoint?.targetable ?? false,
        }))
        .sort((a, b) => (a.key === 'core' ? 1 : b.key === 'core' ? -1 : a.key.localeCompare(b.key))),
    };
  }

  private buildWingmanHud(): WingmanHud | null {
    const wingman = this.getEntity(this.wingmanId);
    if (!wingman) return null;
    return {
      id: wingman.id,
      callsign: wingman.callsign,
      state:
        this.phase === 'complete'
          ? '返航 / RTB'
          : this.phase === 'failed'
            ? '紧急脱离'
            : this.bossId
              ? '交战 / ENGAGED'
              : '护航 / ON STATION',
      hp: wingman.hp,
      maxHp: wingman.maxHp,
      kills: 0,
      distance: distance(wingman.position, this.flight.position),
    };
  }

  private buildTargets(): HudTarget[] {
    const forward = forwardFromAngles(this.flight.yaw, this.flight.pitch);
    const lock = this.getLockState();
    const targets: HudTarget[] = [];
    for (const entity of this.entities) {
      const isAircraft = entity.kind === 'fighter' || entity.kind === 'wingman';
      const isWeakpoint = entity.kind === 'weakpoint';
      if (!entity.alive) continue;
      if (!isAircraft && !isWeakpoint) continue;
      if (isWeakpoint && !entity.weakpoint) continue;
      const toTarget = sub(entity.position, this.flight.position);
      const dist = Math.sqrt(toTarget.x ** 2 + toTarget.y ** 2 + toTarget.z ** 2);
      const angle = angleBetween(forward, normalize(toTarget)) * RAD;
      const projection: Projection = this.projections.get(entity.id) ?? {
        x: 0.5,
        y: 0.5,
        scale: 1,
        onScreen: false,
      };
      const selected = this.selectedId === entity.id;
      targets.push({
        id: entity.id,
        callsign: entity.callsign,
        label: entity.label || entity.callsign,
        kind: entity.kind === 'weakpoint' ? 'weakpoint' : entity.kind === 'wingman' ? 'wingman' : 'fighter',
        team: entity.team,
        variant: entity.variant,
        distance: dist,
        hp: entity.hp,
        maxHp: entity.maxHp,
        angle,
        selected,
        locked: selected && lock.state === 'locked',
        lockProgress: selected ? lock.progress : 0,
        lockable: this.isLockable(entity),
        screen: projection,
      });
    }
    return targets.sort((a, b) => {
      if (a.selected !== b.selected) return a.selected ? -1 : 1;
      if (a.team !== b.team) return a.team === 'hostile' ? -1 : 1;
      return a.distance - b.distance;
    });
  }

  private buildRadar(): RadarContact[] {
    const contacts: RadarContact[] = [];
    for (const entity of this.entities) {
      if (!entity.alive) continue;
      if (!['fighter', 'wingman', 'weakpoint', 'dreadnought'].includes(entity.kind)) continue;
      if (entity.kind === 'dreadnought') continue;
      const dx = entity.position.x - this.flight.position.x;
      const dz = entity.position.z - this.flight.position.z;
      contacts.push({
        id: entity.id,
        x: clamp(dx / RADAR_RANGE, -1, 1),
        y: clamp(dz / RADAR_RANGE, -1, 1),
        team: entity.team,
        kind:
          entity.kind === 'weakpoint'
            ? 'weakpoint'
            : entity.kind === 'wingman'
              ? 'wingman'
              : 'fighter',
        selected: this.selectedId === entity.id,
      });
    }
    return contacts;
  }

  private buildObjective(): { objective: string; objectiveZh: string; hint: string } {
    const lock = this.getLockState();
    const missileWarning = this.warnings.some((warning) => warning.kind === 'missile');
    if (this.phase === 'boot') {
      return { objective: 'SYSTEM BOOT', objectiveZh: '航电自检', hint: '座舱加压中……' };
    }
    if (this.phase === 'complete') {
      return { objective: 'MISSION COMPLETE', objectiveZh: '任务完成', hint: 'LEVIATHAN 已沉没' };
    }
    if (this.phase === 'failed') {
      return { objective: 'MISSION FAILED', objectiveZh: '任务失败', hint: '机体失控 — 按 R 重新出击' };
    }
    if (this.phase === 'boss-intro') {
      return {
        objective: 'MASSIVE CONTACT',
        objectiveZh: '战争巨兽接近',
        hint: 'LEVIATHAN — 摧毁护盾节点',
      };
    }
    const boss = this.buildBossHud();
    if (boss) {
      const core = boss.weakpoints.find((weakpoint) => weakpoint.key === 'core');
      if (this.bossDefeated) {
        return {
          objective: 'LEVIATHAN DOWN',
          objectiveZh: '巨兽解体',
          hint: '离开爆心，返航',
        };
      }
      if (core?.targetable) {
        return {
          objective: 'STRIKE THE CORE',
          objectiveZh: '攻击反应堆核心',
          hint: missileWarning ? '导弹来袭 — F 释放热焰弹' : '核心暴露 — 锁定并发射',
        };
      }
      return {
        objective: 'DESTROY SHIELD NODES',
        objectiveZh: '摧毁护盾节点',
        hint: missileWarning ? '导弹来袭 — F 释放热焰弹' : '护盾节点是唯一弱点',
      };
    }
    if (missileWarning) {
      return {
        objective: 'EVADE',
        objectiveZh: '规避导弹',
        hint: '导弹来袭 — F 释放热焰弹并机动',
      };
    }
    if (lock.state === 'locked') {
      return {
        objective: 'WEAPONS FREE',
        objectiveZh: '锁定完成',
        hint: '按 SPACE 发射导弹',
      };
    }
    return {
      objective: 'INTERCEPT',
      objectiveZh: `击落敌机 ${Math.min(this.kills, this.scenario.requiredKills)}/${this.scenario.requiredKills}`,
      hint: 'TAB 切换目标 — 保持目标在锁定锥内',
    };
  }

  getSnapshot(): CockpitSnapshot {
    const lock = this.getLockState();
    const boss = this.buildBossHud();
    const objective = this.buildObjective();
    const activeWarnings = this.warnings
      .filter((warning) => warning.expiresAt > this.elapsed)
      .sort((a, b) => {
        const order = { critical: 0, warning: 1, caution: 2 };
        return order[a.severity] - order[b.severity];
      });
    return {
      phase: this.phase,
      paused: this.paused,
      elapsed: this.elapsed,
      operation: this.scenario.operation,
      titleEn: this.scenario.titleEn,
      titleZh: this.scenario.titleZh,
      flight: {
        speed: this.flight.speed,
        knots: this.flight.speed * 1.94384,
        mach: this.flight.speed / 340,
        altitude: this.flight.position.y,
        verticalSpeed: Math.sin(this.flight.pitch) * this.flight.speed,
        heading: headingFromYaw(this.flight.yaw),
        pitch: this.flight.pitch * RAD,
        roll: this.flight.roll * RAD,
        gLoad: this.flight.gLoad,
        throttle: this.flight.throttle,
        hp: this.flight.hp,
        maxHp: this.flight.maxHp,
        afterburner: this.flight.afterburner,
      },
      weapons: {
        selected: this.weapons.selected,
        missiles: this.weapons.missiles,
        maxMissiles: this.weapons.maxMissiles,
        gunAmmo: this.weapons.gunAmmo,
        gunMax: this.weapons.gunMax,
        flares: this.weapons.flares,
        maxFlares: this.weapons.maxFlares,
        gunFiring: this.gunFiring,
      },
      lock,
      targets: this.buildTargets(),
      radar: this.buildRadar(),
      warnings: activeWarnings,
      comms: this.comms.slice(-6),
      wingman: this.buildWingmanHud(),
      boss,
      mission: {
        kills: this.kills,
        requiredKills: this.scenario.requiredKills,
        objective: objective.objective,
        objectiveZh: objective.objectiveZh,
        hint: objective.hint,
        score: this.score,
        stats: {
          ...this.stats,
          elapsed: this.stats.elapsed || Math.floor(this.elapsed),
          score: this.stats.score || this.score,
        },
      },
    };
  }

  getAudioTelemetry(): AudioTelemetry {
    const missileWarning = this.entities.some(
      (entity) =>
        entity.alive &&
        entity.kind === 'missile' &&
        entity.team === 'hostile' &&
        entity.missile?.targetId === 'player',
    );
    return {
      phase: this.phase,
      paused: this.paused,
      throttle: this.flight.throttle,
      speed: this.flight.speed,
      altitude: this.flight.position.y,
      gLoad: this.flight.gLoad,
      hpRatio: this.flight.hp / this.flight.maxHp,
      lockState: this.getLockState().state,
      missileWarning,
      bossActive: Boolean(this.bossId) && !this.bossDefeated,
      elapsed: this.elapsed,
    };
  }

  getEntities(): readonly SimEntity[] {
    return this.entities;
  }

  getEffects(): readonly SimEffect[] {
    return this.effects;
  }

  getFlight(): Readonly<typeof this.flight> {
    return this.flight;
  }

  getBossEntity(): SimEntity | undefined {
    return this.getEntity(this.bossId);
  }

  getTargetLabel(id: string | null): string | null {
    return this.getEntity(id)?.label ?? null;
  }

  getClockLabel(): string {
    return formatClock(this.elapsed);
  }

  /** Test/debug helper: force a boss encounter without replaying the full sortie. */
  debugTriggerBoss(): void {
    this.warpToBoss();
  }
}
