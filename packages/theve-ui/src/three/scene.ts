import * as THREE from 'three';
import type { CockpitEngine } from '../sim/engine';
import type { CockpitQuality } from '../sim/CockpitProvider';
import { enemyProfile } from '../sim/enemies';
import { BOSS_ANCHOR, BOSS_TURRETS, BOSS_VLS } from '../sim/boss';
import { clamp, forwardFromAngles } from '../sim/math';
import type { EffectColor, SimEffect, SimEntity } from '../sim/types';

interface SceneOptions {
  quality: CockpitQuality;
}

type ResolvedQuality = 'high' | 'low';

const SUN_DIRECTION = new THREE.Vector3(0.28, 0.045, -0.96).normalize();
const CLOUD_ALTITUDE = 4300;
const TEAM_COLORS = {
  player: 0x63f3ff,
  ally: 0x74ffb0,
  hostile: 0xff4d5a,
} as const;

/* --- v0.5 chase camera ---------------------------------------------- */
/** How much of the airframe's roll the outside camera carries. */
const CHASE_ROLL_FOLLOW = 0.78;
/** Boom length behind the aircraft at the slow and fast ends of the envelope. */
const CHASE_BACK = 44;
const CHASE_BACK_SPEED = 18;
/** How far the boom stretches while a scripted manoeuvre owns the airframe. */
const CHASE_MANEUVER_PULL = 20;
/**
 * The boom only tilts this far with the nose. Above it the camera holds its
 * attitude and *watches* the aircraft rear up — which is the difference between
 * a cobra you can see and a frame full of fuselage underside.
 */
const CHASE_BOOM_PITCH = 0.5;
/** Camera attitude lag, per second. Lower is looser and more cinematic. */
const CHASE_YAW_LAG = 8.5;
const CHASE_PITCH_LAG = 9.5;
const CHASE_ROLL_LAG = 6.4;
/** How far ahead of the aircraft the boom aims, in metres. */
const CHASE_LOOK_AHEAD = 70;
/** Base field of view by view mode; widened further with speed. */
const FOV_COCKPIT = 70;
const FOV_CHASE = 74;
/** Wingtip vapour: the g threshold and how fast it fades. */
const VAPOUR_G = 4.6;
const VAPOUR_FADE = 2.6;

const EFFECT_COLORS: Record<EffectColor, number> = {
  cyan: 0x63f3ff,
  amber: 0xffb547,
  red: 0xff4d5a,
  white: 0xfff3d6,
  green: 0x74ffb0,
};

/* --- v0.3 impact & atmosphere --------------------------------------- */
/** Explosions past this range are decoration, not events. */
const FLASH_POOL = 3;
/** Camera impulse spring: stiffness and damping of the jolt. */
const IMPULSE_STIFFNESS = 52;
const IMPULSE_DAMPING = 10.5;
/** A hull below this fraction of health starts trailing smoke. */
const SMOKE_HULL = 0.55;
const SMOKE_INTERVAL = 0.075;
/** Effect kinds drawn with normal blending instead of additive glow. */
const MATTE_EFFECTS = new Set(['smoke', 'flak', 'vapour']);

/** Base world size multiplier per effect kind. */
const EFFECT_SCALE: Record<SimEffect['kind'], number> = {
  explosion: 2.4,
  shockwave: 4.2,
  tracer: 1,
  muzzle: 1.8,
  spark: 1.5,
  debris: 1.2,
  smoke: 3.4,
  shield: 0.5,
  flak: 5.6,
  flash: 6.5,
  beam: 1,
  pulse: 1.6,
  vapour: 2.6,
};

/** How much each kind grows over its lifetime. Sparks shrink, smoke billows. */
const EFFECT_EXPANSION: Record<SimEffect['kind'], number> = {
  explosion: 0.75,
  shockwave: 2.4,
  tracer: 0,
  muzzle: 0.6,
  spark: -0.35,
  debris: 0.1,
  smoke: 2.2,
  shield: 2.6,
  flak: 3.2,
  flash: 1.1,
  beam: 0.02,
  pulse: 1.9,
  vapour: 2.4,
};

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    // three.js gives every Sprite the same module-level plane geometry, so
    // disposing it here would make the renderer re-upload it for all sprites in
    // the scene. Only materials are ours to release.
    if (!(object instanceof THREE.Sprite)) {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    }
    const material = (object as THREE.Mesh).material;
    if (Array.isArray(material)) {
      for (const item of material) item.dispose();
    } else if (material) {
      material.dispose();
    }
  });
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Shortest-path angular damping, so a heading wrap does not spin the camera. */
function dampAngle(current: number, target: number, lambda: number, delta: number): number {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * (1 - Math.exp(-lambda * delta));
}

/** The animated parts of the player's airframe, hung off `group.userData`. */
interface PlayerSurfaces {
  aileronL: THREE.Mesh;
  aileronR: THREE.Mesh;
  flapL: THREE.Mesh;
  flapR: THREE.Mesh;
  elevator: THREE.Mesh;
  burnerMaterials: THREE.SpriteMaterial[];
  flames: THREE.Mesh[];
  vapour: THREE.Sprite[];
  navRed: THREE.Mesh;
  navGreen: THREE.Mesh;
}

/** The animated parts of the dreadnought, hung off `group.userData`. */
interface FlareParts {
  bloom: THREE.SpriteMaterial;
  core: THREE.SpriteMaterial;
  smoke: THREE.SpriteMaterial;
  bloomSprite: THREE.Sprite;
  coreSprite: THREE.Sprite;
  smokeSprite: THREE.Sprite;
  star: THREE.Mesh;
  seed: number;
}

/** The animated parts of the dreadnought, hung off `group.userData`. */
interface DreadnoughtParts {
  radar: THREE.Group;
  /** Turret yokes that track the player. */
  turrets: THREE.Group[];
  /** Twin barrels per turret, flashed while the close-in guns are live. */
  barrels: THREE.Mesh[][];
  /** Vertical launch hatches, lit while a salvo is being released. */
  vls: THREE.Mesh[];
  /** The two armoured shutters over the reactor maw. */
  shutters: THREE.Mesh[];
  /** Containment rings around the reactor. */
  rings: THREE.Mesh[];
  /** The reactor itself. */
  core: THREE.Mesh;
  coreGlow: THREE.SpriteMaterial;
  /** Spinal lance emitter at the muzzle. */
  lance: THREE.Sprite;
  lanceMaterial: THREE.SpriteMaterial;
  lanceBarrel: THREE.Mesh;
  /** Whole-ship shield bubble; fades out once the array is down. */
  dome: THREE.Mesh;
  domeMaterial: THREE.MeshBasicMaterial;
  /** Outrigger emitter heads over the shield nodes. */
  emitterMaterials: THREE.SpriteMaterial[];
}

/**
 * The three.js visual layer for the cockpit: a fixed canopy, a warm dusk sky,
 * a procedural cloud sea, target projection and non-React simulation entities.
 */
export class CockpitScene {
  private readonly host: HTMLElement;
  private readonly engine: CockpitEngine;
  private readonly resolvedQuality: ResolvedQuality;
  private readonly reducedMotion: boolean;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private lastTime = 0;
  private readonly resizeObserver: ResizeObserver;

  private readonly canopyGroup = new THREE.Group();
  private readonly entityMeshes = new Map<string, THREE.Group>();
  private readonly effectObjects = new Map<string, THREE.Object3D>();
  private readonly puffs: THREE.Sprite[] = [];
  private readonly disposables: Array<{ dispose: () => void }> = [];

  private sky: THREE.Mesh;
  private skyUniforms: { uSunDir: { value: THREE.Vector3 } };
  private cloudDeck: THREE.Mesh;
  private cloudUniforms: {
    uTime: { value: number };
    uTravel: { value: THREE.Vector2 };
  };
  private sunLight: THREE.DirectionalLight;
  private glowTexture: THREE.Texture;
  private cloudTexture: THREE.Texture;
  private smokeTexture: THREE.Texture;

  /* --- v0.3 impact & atmosphere -------------------------------------- */
  private readonly flashLights: THREE.PointLight[] = [];
  private readonly flashTimers: number[] = [];
  private flashCursor = 0;
  private readonly smokeTrails: THREE.Sprite[] = [];
  private smokeCursor = 0;
  private smokeClock = 0;
  /** Rotational jolt: x = pitch, y = yaw, z = roll, in radians. */
  private readonly impulse = new THREE.Vector3();
  private readonly impulseVelocity = new THREE.Vector3();
  private hemisphere: THREE.HemisphereLight | null = null;
  private fogBase = 0x35404e;
  private exposure = 1.08;

  private frame = 0;
  private disposed = false;
  private shake = 0;
  private elapsed = 0;
  private unsubscribe: (() => void) | null = null;
  private contextLostHandler: ((event: Event) => void) | null = null;
  private autoQualityChecked = false;
  private frameSamples: number[] = [];

  private readonly cameraForward = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();
  private readonly tempVector = new THREE.Vector3();

  /* --- v0.5 third-person camera & player airframe --------------------- */
  /** The player's own aircraft, only drawn from the outside view. */
  private readonly playerGroup = new THREE.Group();
  private playerBuilt = false;
  /** Boom position and damped attitude of the chase camera. */
  private readonly chasePosition = new THREE.Vector3();
  private chaseYaw = 0;
  private chasePitch = 0;
  private chaseRoll = 0;
  private chaseReady = false;
  private chaseFloorReady = false;
  /** Wingtip vapour intensity, 0..1, smoothed. */
  private vapour = 0;
  /** Field of view from the last resize, before the view-mode multiplier. */
  private baseFov = FOV_COCKPIT;

  constructor(host: HTMLElement, engine: CockpitEngine, options: SceneOptions) {
    this.host = host;
    this.engine = engine;
    this.resolvedQuality = options.quality === 'low' ? 'low' : 'high';
    this.reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.resolvedQuality === 'high',
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.resolvedQuality === 'high' ? 1.7 : 1),
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.domElement.className = 'tv-cockpit__canvas';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color('#0a1420');
    this.scene.fog = new THREE.FogExp2(0x35404e, 0.000075);
    this.camera = new THREE.PerspectiveCamera(
      70,
      Math.max(1, host.clientWidth) / Math.max(1, host.clientHeight),
      0.03,
      60000,
    );
    this.scene.add(this.camera);

    this.glowTexture = this.createGlowTexture();
    this.cloudTexture = this.createCloudTexture();
    this.smokeTexture = this.createSmokeTexture();
    this.disposables.push(this.glowTexture, this.cloudTexture, this.smokeTexture);

    this.skyUniforms = { uSunDir: { value: SUN_DIRECTION.clone() } };
    this.sky = this.createSky();
    this.scene.add(this.sky);

    this.cloudUniforms = {
      uTime: { value: 0 },
      uTravel: { value: new THREE.Vector2() },
    };
    this.cloudDeck = this.createCloudDeck();
    this.scene.add(this.cloudDeck);

    this.sunLight = new THREE.DirectionalLight(0xffc49a, 2.6);
    this.sunLight.target = new THREE.Object3D();
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.hemisphere = new THREE.HemisphereLight(0x8ebbe0, 0x3c2c26, 0.82);
    this.scene.add(this.hemisphere);
    this.scene.add(new THREE.AmbientLight(0x182a35, 1.15));
    const frontFill = new THREE.DirectionalLight(0x7fa6b4, 0.65);
    frontFill.position.set(0, 3000, 5000);
    this.scene.add(frontFill);
    const underFill = new THREE.DirectionalLight(0xffa66a, 1.15);
    underFill.position.set(0, -5000, -6500);
    this.scene.add(underFill);

    // A fixed pool of impact lights. They stay in the graph with intensity 0 so
    // the light count never changes 鈥?adding or removing a light would force
    // three.js to recompile every material mid-dogfight.
    if (this.resolvedQuality === 'high') {
      for (let index = 0; index < FLASH_POOL; index += 1) {
        const light = new THREE.PointLight(0xffb266, 0, 3000, 2);
        light.position.set(0, -100000, 0);
        this.scene.add(light);
        this.flashLights.push(light);
        this.flashTimers.push(0);
      }
    }

    this.buildCanopy();
    this.buildCloudPuffs();
    this.buildSmokeTrails();
    this.buildPlayerFighter();
    this.resize();

    this.unsubscribe = engine.on((event) => {
      if (event.type === 'explosion') {
        this.shake = Math.min(1.2, this.shake + event.scale / 420);
        this.flashAt(event.position, Math.min(1, event.scale / 60));
        this.kickFromPoint(event.position, Math.min(1, event.scale / 60) * 0.9);
      } else if (event.type === 'damage') {
        this.shake = Math.min(1.2, this.shake + 0.28);
        this.kickFromBearing(event.bearing, 0.24 + event.amount * 0.012);
      } else if (event.type === 'gun-fire') {
        this.shake = Math.min(0.6, this.shake + 0.015);
        this.kick(0.05, randomBetween(-0.03, 0.03));
      } else if (event.type === 'hit') {
        if (event.mine) this.kick(event.kill ? 0.34 : 0.11, randomBetween(-0.05, 0.05));
      } else if (event.type === 'kill') {
        this.shake = Math.min(1.4, this.shake + 0.45);
      }
    });

    this.contextLostHandler = (event: Event) => {
      event.preventDefault();
      this.renderer.domElement.style.display = 'none';
      if (this.host) this.host.dataset.webgl = 'lost';
    };
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLostHandler);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);

    this.loop = this.loop.bind(this);
    this.loop();
  }

  dispose(): void {
    if (this.disposed) return;    this.disposed = true;
    window.cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.unsubscribe?.();
    if (this.contextLostHandler) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLostHandler);
    }
    for (const mesh of this.entityMeshes.values()) disposeObject(mesh);
    this.entityMeshes.clear();
    for (const effect of this.effectObjects.values()) disposeObject(effect);
    this.effectObjects.clear();
    for (const puff of this.puffs) disposeObject(puff);
    this.puffs.length = 0;
    for (const sprite of this.smokeTrails) disposeObject(sprite);
    this.smokeTrails.length = 0;
    for (const light of this.flashLights) this.scene.remove(light);
    this.flashLights.length = 0;
    this.flashTimers.length = 0;
    disposeObject(this.canopyGroup);
    disposeObject(this.playerGroup);
    disposeObject(this.sky);
    disposeObject(this.cloudDeck);
    for (const disposable of this.disposables) disposable.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.engine.clearProjections();
  }

  private loop(): void {
    if (this.disposed) return;
    this.frame = window.requestAnimationFrame(this.loop);
    if (document.hidden) return;

    const delta = this.lastTime > 0 ? Math.min((performance.now() - this.lastTime) / 1000, 0.05) : 0.016;
    this.lastTime = performance.now();
    this.elapsed += delta;
    const flight = this.engine.getFlight();
    const paused = this.engine.paused;

    this.updateCamera(flight, delta, paused);
    this.updateWorld(delta, paused);
    this.syncEntities(delta);
    this.syncEffects(delta);
    this.updateSmokeTrails(delta, paused);
    this.updateFlashes(delta);
    this.updateProjections();
    this.updateAtmosphere(delta, paused);
    this.renderer.render(this.scene, this.camera);

    if (!this.autoQualityChecked && this.resolvedQuality === 'high') {
      this.frameSamples.push(delta);
      if (this.frameSamples.length > 90) {
        const average =
          this.frameSamples.reduce((sum, value) => sum + value, 0) / this.frameSamples.length;
        this.autoQualityChecked = true;
        if (average > 1 / 42) {
          this.renderer.setPixelRatio(1);
          this.resize();
        }
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* camera & world                                                      */
  /* ------------------------------------------------------------------ */

  private updateCamera(
    flight: ReturnType<CockpitEngine['getFlight']>,
    delta: number,
    paused: boolean,
  ): void {
    this.shake = Math.max(0, this.shake - delta * (paused ? 2 : 1.6));
    this.integrateImpulse(delta, paused);
    const buffetBase = this.reducedMotion ? 0 : 0.0009 + flight.gLoad * 0.00045;
    const buffet = paused ? 0 : buffetBase;
    const shake = this.reducedMotion ? 0 : this.shake * 0.018;
    const time = this.elapsed;

    const shakeX = Math.sin(time * 71) * (buffet + shake * 0.5) + Math.sin(time * 113) * shake;
    const shakeY = Math.cos(time * 59) * (buffet + shake * 0.4);
    const shakeZ = Math.sin(time * 83) * buffet * 0.7;
    const jolt = this.reducedMotion ? 0 : 1;

    /* --- v0.5: drain whatever the simulation asked the camera to do --- */
    const commanded = this.engine.drainShake();
    if (commanded > 0) this.shake = Math.min(2, this.shake + commanded);

    const telemetry = this.engine.getViewTelemetry();
    const outside = telemetry.mode === 'chase';

    this.canopyGroup.visible = !outside;
    this.playerGroup.visible = outside;
    this.updatePlayerFighter(flight, telemetry, delta, paused);

    if (!outside) {
      this.chaseReady = false;
      this.chaseFloorReady = false;
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
      const euler = new THREE.Euler(
        flight.pitch + shakeX + this.impulse.x * jolt,
        flight.yaw + shakeY + this.impulse.y * jolt,
        flight.roll + shakeZ + this.impulse.z * jolt,
        'YXZ',
      );
      this.camera.quaternion.setFromEuler(euler);
      this.camera.position.set(flight.position.x, flight.position.y, flight.position.z);
      this.camera.updateMatrixWorld();
      return;
    }

    /* --- third-person boom ------------------------------------------- */
    // The boom rides the airframe's heading and a *clamped* slice of its pitch,
    // and then aims at the aircraft. That split matters: a rigid boom that
    // followed the nose through a cobra or a kulbit puts the camera inside the
    // fuselage, while a boom that ignores attitude entirely stops feeling like
    // it is attached to anything. Attitude is damped rather than rigid too, so
    // the aircraft leads the camera for a beat in a hard manoeuvre — which is
    // where the sense of weight and speed comes from.
    const speedT = clamp01((flight.speed - 165) / 165);
    const scripted = telemetry.maneuver !== null && telemetry.maneuverProgress > 0;
    const back = CHASE_BACK + speedT * CHASE_BACK_SPEED + (scripted ? CHASE_MANEUVER_PULL : 0);
    const lift = 9.5 + speedT * 3;

    if (!this.chaseReady) {
      this.chaseYaw = flight.yaw;
      this.chasePitch = flight.pitch;
      this.chaseRoll = flight.roll * CHASE_ROLL_FOLLOW;
      this.chaseReady = true;
    } else {
      this.chaseYaw = dampAngle(this.chaseYaw, flight.yaw, CHASE_YAW_LAG, delta);
      this.chasePitch = dampAngle(this.chasePitch, flight.pitch, CHASE_PITCH_LAG, delta);
      this.chaseRoll = dampAngle(
        this.chaseRoll,
        flight.roll * CHASE_ROLL_FOLLOW,
        CHASE_ROLL_LAG,
        delta,
      );
    }

    const boomQuat = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        clamp(this.chasePitch, -CHASE_BOOM_PITCH, CHASE_BOOM_PITCH),
        this.chaseYaw,
        this.chaseRoll,
        'YXZ',
      ),
    );
    const aircraft = new THREE.Vector3(
      flight.position.x,
      flight.position.y,
      flight.position.z,
    );
    const desired = aircraft
      .clone()
      .add(new THREE.Vector3(0, lift, back).applyQuaternion(boomQuat));
    // Never let the boom drop through the hard floor.
    desired.y = Math.max(desired.y, 150);
    if (!this.chaseFloorReady) {
      this.chasePosition.copy(desired);
      this.chaseFloorReady = true;
    } else {
      // Damp the boom itself: holding station exactly would erase the sensation
      // of speed, so position lags a little more than attitude does.
      this.chasePosition.lerp(desired, 1 - Math.exp(-9.5 * delta));
    }

    // Aim at the aircraft, biased along its real nose so a manoeuvre leads the
    // frame instead of hiding inside it.
    const nose = forwardFromAngles(
      flight.yaw,
      clamp(flight.pitch, -1.15, 1.15),
    );
    const look = aircraft.clone().add(
      new THREE.Vector3(nose.x, nose.y, nose.z).multiplyScalar(CHASE_LOOK_AHEAD),
    );
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(boomQuat);
    const view = this.tempVector.copy(look).sub(this.chasePosition);
    if (view.lengthSq() < 1) view.set(0, 0, -1);
    view.normalize();
    // A look-at whose up vector is parallel to its direction is degenerate —
    // which is exactly the vertical-manoeuvre case, so fall back to level.
    if (Math.abs(up.dot(view)) > 0.985) {
      up.set(0, 1, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), this.chaseRoll * 0.4);
      if (Math.abs(up.dot(view)) > 0.985) up.set(0, 0, -1).applyQuaternion(boomQuat);
    }

    const lookMatrix = new THREE.Matrix4().lookAt(this.chasePosition, look, up);
    this.camera.quaternion.setFromRotationMatrix(lookMatrix);
    if (jolt > 0 || buffet > 0) {
      // Shake and blast jolts belong in the camera's own frame, not the world's.
      this.camera.quaternion.multiply(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            shakeX + this.impulse.x * jolt,
            shakeY + this.impulse.y * jolt,
            shakeZ + this.impulse.z * jolt,
            'YXZ',
          ),
        ),
      );
    }
    this.camera.position.copy(this.chasePosition);
    this.camera.updateMatrixWorld();

    // A wider lens outside sells the speed the boom cannot.
    const targetFov = FOV_CHASE + speedT * 9 + (flight.afterburner ? 3 : 0);
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, delta * 3.4);
    this.camera.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------------ */
  /* v0.3 impact feel                                                    */
  /* ------------------------------------------------------------------ */

  /** A decaying rotational jolt, integrated as a critically damped spring. */
  private integrateImpulse(delta: number, paused: boolean): void {
    if (paused) {
      this.impulse.set(0, 0, 0);
      this.impulseVelocity.set(0, 0, 0);
      return;
    }
    this.impulseVelocity.addScaledVector(this.impulse, -IMPULSE_STIFFNESS * delta);
    this.impulseVelocity.multiplyScalar(Math.max(0, 1 - IMPULSE_DAMPING * delta));
    this.impulse.addScaledVector(this.impulseVelocity, delta);
  }

  /** Recoil / hit punch: a short spike on pitch, with a little roll noise. */
  private kick(pitch: number, roll: number): void {
    this.impulseVelocity.x -= pitch * 9;
    this.impulseVelocity.z += roll * 9;
  }

  /** Push the nose away from a blast, scaled by how close it went off. */
  private kickFromPoint(origin: { x: number; y: number; z: number }, strength: number): void {
    const yaw = this.engine.getFlight().yaw;
    const dx = this.camera.position.x - origin.x;
    const dz = this.camera.position.z - origin.z;
    const lateral = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const ahead = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
    const span = Math.hypot(lateral, ahead) || 1;
    this.impulseVelocity.z += (lateral / span) * strength * 4.5;
    this.impulseVelocity.x -= (ahead / span) * strength * 3;
  }

  /** Damage jolt: the airframe lurches away from the side it was hit on. */
  private kickFromBearing(bearing: number, strength: number): void {
    const radians = (bearing * Math.PI) / 180;
    this.impulseVelocity.z += Math.sin(radians) * strength * 5;
    this.impulseVelocity.x -= Math.cos(radians) * strength * 2.6;
  }

  /** Light an explosion with a pooled point light so the clouds react to it. */
  private flashAt(position: { x: number; y: number; z: number }, intensity: number): void {
    if (this.flashLights.length === 0) return;
    const index = this.flashCursor % this.flashLights.length;
    this.flashCursor += 1;
    const light = this.flashLights[index];
    if (!light) return;
    light.position.set(position.x, position.y, position.z);
    light.distance = 2600 + intensity * 6000;
    light.intensity = 1200 + intensity * 6400;
    this.flashTimers[index] = 0.2 + intensity * 0.3;
  }

  private updateFlashes(delta: number): void {
    for (let index = 0; index < this.flashLights.length; index += 1) {
      const light = this.flashLights[index];
      if (!light) continue;
      const timer = this.flashTimers[index] ?? 0;
      if (timer <= 0) {
        if (light.intensity !== 0) light.intensity = 0;
        continue;
      }
      this.flashTimers[index] = timer - delta;
      light.intensity *= Math.max(0, 1 - delta * 7.5);
      if ((this.flashTimers[index] ?? 0) <= 0) light.intensity = 0;
    }
  }

  /* ------------------------------------------------------------------ */
  /* v0.3 battle atmosphere                                              */
  /* ------------------------------------------------------------------ */

  private buildSmokeTrails(): void {
    const count = this.resolvedQuality === 'high' ? 30 : 12;
    for (let index = 0; index < count; index += 1) {
      const material = new THREE.SpriteMaterial({
        map: this.smokeTexture,
        color: 0x2c2c30,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.userData.life = 0;
      sprite.userData.maxLife = 1;
      sprite.userData.baseScale = 30;
      this.smokeTrails.push(sprite);
      this.scene.add(sprite);
    }
  }

  /**
   * Wounded aircraft bleed smoke. The sim never emits these 鈥?they are a pure
   * rendering affordance, recycled from a fixed pool so a long fight cannot
   * grow the draw-call count.
   */
  private updateSmokeTrails(delta: number, paused: boolean): void {
    for (const sprite of this.smokeTrails) {
      const life = sprite.userData.life as number;
      if (life <= 0) continue;
      const maxLife = Math.max(0.001, sprite.userData.maxLife as number);
      const next = life - delta;
      sprite.userData.life = next;
      const progress = 1 - Math.max(0, next) / maxLife;
      const material = sprite.material as THREE.SpriteMaterial;
      sprite.scale.setScalar((sprite.userData.baseScale as number) * (1 + progress * 2.6));
      material.opacity = Math.max(0, 1 - progress) * 0.52;
      sprite.position.y += delta * 7;
      if (next <= 0) sprite.visible = false;
    }
    if (paused) return;

    this.smokeClock -= delta;
    if (this.smokeClock > 0) return;
    this.smokeClock = SMOKE_INTERVAL;
    for (const entity of this.engine.getEntities()) {
      if (!entity.alive) continue;
      if (entity.kind !== 'fighter' && entity.kind !== 'wingman') continue;
      const ratio = entity.hp / Math.max(1, entity.maxHp);
      if (ratio > SMOKE_HULL) continue;
      const sprite = this.smokeTrails[this.smokeCursor % this.smokeTrails.length];
      this.smokeCursor += 1;
      if (!sprite) continue;
      const severity = 1 - ratio / SMOKE_HULL;
      sprite.visible = true;
      sprite.position.set(entity.position.x, entity.position.y, entity.position.z);
      sprite.userData.maxLife = 1 + severity * 0.9;
      sprite.userData.life = sprite.userData.maxLife;
      sprite.userData.baseScale = 24 + severity * 30;
      sprite.scale.setScalar(sprite.userData.baseScale as number);
      const material = sprite.material as THREE.SpriteMaterial;
      material.opacity = 0.52;
      material.color.setHex(severity > 0.7 ? 0x141416 : 0x3a3a40);
    }
  }

  /**
   * Grade the picture with the same 0..1 intensity the score uses: calm skies
   * stay bright and warm, a heavy fight gets hazier, cooler and slightly
   * darker, so the mood tracks the music without a single extra draw call.
   */
  private updateAtmosphere(delta: number, paused: boolean): void {
    const intensity = paused ? 0.25 : this.engine.getIntensity();
    const targetExposure = 1.08 - intensity * 0.16;
    this.exposure += (targetExposure - this.exposure) * Math.min(1, delta * 1.4);
    this.renderer.toneMappingExposure = this.exposure;

    const fog = this.scene.fog as THREE.FogExp2 | null;
    if (fog) {
      const targetDensity = 0.000075 + intensity * 0.00005;
      fog.density += (targetDensity - fog.density) * Math.min(1, delta * 1.2);
      fog.color.setHex(this.fogBase).offsetHSL(0, intensity * 0.05, -intensity * 0.05);
    }
    if (this.hemisphere) {
      this.hemisphere.intensity = 0.82 + intensity * 0.2;
    }
  }

  private updateWorld(delta: number, paused: boolean): void {
    const flight = this.engine.getFlight();
    const timeScale = paused ? 0.12 : 1;
    this.sky.position.copy(this.camera.position);
    this.skyUniforms.uSunDir.value.copy(SUN_DIRECTION);

    this.cloudDeck.position.set(
      this.camera.position.x,
      CLOUD_ALTITUDE,
      this.camera.position.z,
    );
    this.cloudUniforms.uTime.value = this.elapsed * timeScale;
    this.cloudUniforms.uTravel.value.set(
      flight.position.x * 0.000055,
      flight.position.z * 0.000055,
    );

    this.sunLight.position.copy(this.camera.position).addScaledVector(SUN_DIRECTION, 9000);
    this.sunLight.target.position.copy(this.camera.position);
    this.sunLight.target.updateMatrixWorld();

    for (const puff of this.puffs) {
      const offset = puff.userData.offset as THREE.Vector3;
      offset.z += flight.speed * delta * 0.0018 * timeScale;
      if (offset.z > 12000) {
        offset.z = -26000;
        offset.x = randomBetween(-14000, 14000);
        offset.y = randomBetween(-3400, -300);
      }
      puff.position.set(
        this.camera.position.x + offset.x,
        this.camera.position.y + offset.y,
        this.camera.position.z + offset.z,
      );
    }
  }

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = width / height < 1.1 ? 78 : FOV_COCKPIT;
    this.baseFov = this.camera.fov;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
  }

  /* ------------------------------------------------------------------ */
  /* scene construction                                                  */
  /* ------------------------------------------------------------------ */

  private createSky(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(20000, 32, 20);
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uSunDir: this.skyUniforms.uSunDir,
        uZenith: { value: new THREE.Color('#071321') },
        uMid: { value: new THREE.Color('#2a3c54') },
        uHorizon: { value: new THREE.Color('#d47a51') },
        uSunColor: { value: new THREE.Color('#ffd6a0') },
        uGround: { value: new THREE.Color('#1b1b26') },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunDir;
        uniform vec3 uZenith;
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        uniform vec3 uSunColor;
        uniform vec3 uGround;
        varying vec3 vDir;
        void main() {
          vec3 dir = normalize(vDir);
          float elevation = dir.y;
          vec3 color = mix(uGround, uHorizon, smoothstep(-0.22, 0.015, elevation));
          color = mix(color, uMid, smoothstep(0.0, 0.22, elevation));
          color = mix(color, uZenith, smoothstep(0.18, 0.8, elevation));
          float sun = max(dot(dir, normalize(uSunDir)), 0.0);
          color += uSunColor * pow(sun, 1500.0) * 4.0;
          color += uSunColor * pow(sun, 22.0) * 0.22;
          color += uHorizon * exp(-abs(elevation) * 12.0) * 0.16;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
  }

  private createCloudDeck(): THREE.Mesh {
    const geometry = new THREE.PlaneGeometry(90000, 90000, 1, 1);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      uniforms: {
        uTime: this.cloudUniforms.uTime,
        uTravel: this.cloudUniforms.uTravel,
        uShadow: { value: new THREE.Color('#3a2d38') },
        uLit: { value: new THREE.Color('#eab18a') },
        uHighlight: { value: new THREE.Color('#fff0d2') },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vWorld;
        void main() {
          vUv = uv;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec2 uTravel;
        uniform vec3 uShadow;
        uniform vec3 uLit;
        uniform vec3 uHighlight;
        varying vec2 vUv;
        varying vec3 vWorld;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                     mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float value = 0.0;
          float amplitude = 0.55;
          for (int i = 0; i < 5; i++) {
            value += noise(p) * amplitude;
            p = p * 2.03 + 17.0;
            amplitude *= 0.5;
          }
          return value;
        }

        void main() {
          vec2 uv = vUv * 44.0 + uTravel + vec2(uTime * 0.0015, 0.0);
          float broad = fbm(uv);
          float detail = fbm(uv * 2.7 + 13.7);
          float clouds = broad * 0.72 + detail * 0.28;
          float cover = smoothstep(0.38, 0.74, clouds);
          float lit = fbm(uv + vec2(-0.08, -0.05));
          vec3 color = mix(uShadow, uLit, cover * 0.82 + detail * 0.2);
          color = mix(color, uHighlight, smoothstep(0.55, 0.92, lit) * 0.32);
          float distanceToCamera = distance(vWorld.xz, cameraPosition.xz);
          float fade = 1.0 - smoothstep(8000.0, 52000.0, distanceToCamera);
          float alpha = cover * fade * 0.92;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(color, alpha);
        }
      `,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.frustumCulled = false;
    return mesh;
  }

  private buildCloudPuffs(): void {
    const count = this.resolvedQuality === 'high' ? 16 : 8;
    for (let index = 0; index < count; index += 1) {
      const material = new THREE.SpriteMaterial({
        map: this.cloudTexture,
        color: new THREE.Color(index % 3 === 0 ? '#ffd6b0' : '#b9a0a4'),
        transparent: true,
        opacity: randomBetween(0.2, 0.42),
        depthWrite: false,
        fog: true,
      });
      const sprite = new THREE.Sprite(material);
      const scale = randomBetween(2200, 6500);
      sprite.scale.set(scale, scale * 0.5, 1);
      sprite.userData.offset = new THREE.Vector3(
        randomBetween(-12000, 12000),
        randomBetween(-2400, -200),
        randomBetween(-18000, -2500),
      );
      this.puffs.push(sprite);
      this.scene.add(sprite);
    }
  }

  private buildCanopy(): void {
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: 0x0a1015,
      metalness: 0.72,
      roughness: 0.38,
    });
    const innerMaterial = new THREE.MeshStandardMaterial({
      color: 0x070c10,
      metalness: 0.5,
      roughness: 0.62,
    });
    const edgeMaterial = new THREE.MeshBasicMaterial({
      color: 0x14383f,
      transparent: true,
      opacity: 0.8,
    });
    const amberEdge = new THREE.MeshBasicMaterial({
      color: 0x5a3c1a,
      transparent: true,
      opacity: 0.8,
    });

    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0x14343c,
      metalness: 0.5,
      roughness: 0.5,
      emissive: 0x0a242a,
      emissiveIntensity: 0.6,
    });

    const leftPillar = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.62, 0.06), frameMaterial);
    leftPillar.position.set(-0.625, -0.02, -0.6);
    leftPillar.rotation.z = -0.18;
    this.canopyGroup.add(leftPillar);
    const leftTrim = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.5, 0.012), trimMaterial);
    leftTrim.position.set(-0.606, -0.03, -0.596);
    leftTrim.rotation.z = -0.18;
    this.canopyGroup.add(leftTrim);

    const rightPillar = leftPillar.clone();
    rightPillar.position.x = 0.625;
    rightPillar.rotation.z = 0.18;
    this.canopyGroup.add(rightPillar);
    const rightTrim = leftTrim.clone();
    rightTrim.position.x = 0.606;
    rightTrim.rotation.z = 0.18;
    this.canopyGroup.add(rightTrim);

    const arch = new THREE.Mesh(new THREE.BoxGeometry(1.38, 0.022, 0.05), frameMaterial);
    arch.position.set(0, 0.355, -0.64);
    this.canopyGroup.add(arch);

    const archTrim = new THREE.Mesh(new THREE.BoxGeometry(1.24, 0.004, 0.01), trimMaterial);
    archTrim.position.set(0, 0.34, -0.642);
    this.canopyGroup.add(archTrim);

    const rivetGeometry = new THREE.BoxGeometry(0.006, 0.006, 0.006);
    const rivetMaterial = new THREE.MeshStandardMaterial({
      color: 0x44555c,
      metalness: 0.85,
      roughness: 0.35,
    });
    for (let index = 0; index < 11; index += 1) {
      const rivet = new THREE.Mesh(rivetGeometry, rivetMaterial);
      rivet.position.set(-0.55 + index * 0.11, 0.365, -0.64);
      this.canopyGroup.add(rivet);
    }

    const leftBrace = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.5, 0.018), innerMaterial);
    leftBrace.position.set(-0.95, 0.24, -0.76);
    leftBrace.rotation.z = 0.82;
    this.canopyGroup.add(leftBrace);
    const rightBrace = leftBrace.clone();
    rightBrace.position.x = 0.95;
    rightBrace.rotation.z = -0.82;
    this.canopyGroup.add(rightBrace);

    const dashboard = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.3, 0.56), innerMaterial);
    dashboard.position.set(0, -0.58, -0.56);
    this.canopyGroup.add(dashboard);

    const glareShield = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.05, 0.4), frameMaterial);
    glareShield.position.set(0, -0.36, -0.58);
    glareShield.rotation.x = -0.2;
    this.canopyGroup.add(glareShield);

    const glareTrim = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.004, 0.008), trimMaterial);
    glareTrim.position.set(0, -0.335, -0.64);
    glareTrim.rotation.x = -0.2;
    this.canopyGroup.add(glareTrim);

    const instrumentStrip = new THREE.Mesh(
      new THREE.BoxGeometry(1.18, 0.005, 0.012),
      trimMaterial,
    );
    instrumentStrip.position.set(0, -0.285, -0.67);
    this.canopyGroup.add(instrumentStrip);

    const consoleBox = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.24, 0.42), innerMaterial);
    consoleBox.position.set(0, -0.64, -0.38);
    this.canopyGroup.add(consoleBox);

    const leftSill = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.2, 1.05), frameMaterial);
    leftSill.position.set(-0.82, -0.3, -0.35);
    leftSill.rotation.y = 0.2;
    this.canopyGroup.add(leftSill);
    const rightSill = leftSill.clone();
    rightSill.position.x = 0.82;
    rightSill.rotation.y = -0.2;
    this.canopyGroup.add(rightSill);

    for (const side of [-1, 1]) {
      for (let index = 0; index < 3; index += 1) {
        const light = new THREE.Mesh(
          new THREE.BoxGeometry(0.018, 0.0025, 0.005),
          index === 1 ? amberEdge : edgeMaterial,
        );
        light.position.set(side * (0.44 + index * 0.075), -0.305, -0.66);
        this.canopyGroup.add(light);
      }
    }

    const label = this.createLabelPlane();
    if (label) {
      label.position.set(-0.47, -0.405, -0.67);
      label.rotation.z = 0.02;
      this.canopyGroup.add(label);
    }
    const systemPlate = this.createSystemPlate();
    if (systemPlate) {
      systemPlate.position.set(0.47, -0.405, -0.67);
      systemPlate.rotation.z = -0.02;
      this.canopyGroup.add(systemPlate);
    }

    const ventGeometry = new THREE.BoxGeometry(0.05, 0.004, 0.016);
    const ventMaterial = new THREE.MeshStandardMaterial({
      color: 0x050a0d,
      metalness: 0.4,
      roughness: 0.8,
    });
    for (let index = 0; index < 6; index += 1) {
      const vent = new THREE.Mesh(ventGeometry, ventMaterial);
      vent.position.set(-0.12 + index * 0.048, -0.33, -0.69);
      this.canopyGroup.add(vent);
    }

    const cockpitLight = new THREE.PointLight(0x4bd7ff, 0.42, 2.2, 2);
    cockpitLight.position.set(0, -0.33, -0.42);
    this.canopyGroup.add(cockpitLight);
    const amberLight = new THREE.PointLight(0xffb547, 0.34, 1.8, 2);
    amberLight.position.set(0.5, -0.4, -0.5);
    this.canopyGroup.add(amberLight);
    const leftGlow = new THREE.PointLight(0x2f8c9a, 0.22, 1.4, 2);
    leftGlow.position.set(-0.58, -0.25, -0.5);
    this.canopyGroup.add(leftGlow);
    const fillLight = new THREE.PointLight(0x9ec8d2, 0.35, 2.4, 2);
    fillLight.position.set(0.1, 0.55, 0.2);
    this.canopyGroup.add(fillLight);
    const warmFill = new THREE.PointLight(0xffa26a, 0.24, 2, 2);
    warmFill.position.set(0.55, 0.05, 0.15);
    this.canopyGroup.add(warmFill);

    this.camera.add(this.canopyGroup);
  }

  private createLabelPlane(): THREE.Mesh | null {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#060d12';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = 'rgba(99,243,255,0.35)';
    context.lineWidth = 2;
    context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
    context.fillStyle = '#63f3ff';
    context.font = '600 34px Consolas, monospace';
    context.fillText('LUMEN 1 // F-08', 28, 56);
    context.fillStyle = 'rgba(255,181,71,0.85)';
    context.font = '500 20px Consolas, monospace';
    context.fillText('TACS-8 AVIONICS', 28, 92);
    context.fillStyle = 'rgba(232,248,252,0.4)';
    context.font = '16px Consolas, monospace';
    context.fillText('S/N 08-1130 路 CIRRUS TFS', 300, 56);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(texture);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.085), material);
    mesh.rotation.x = -0.3;
    return mesh;
  }

  private createSystemPlate(): THREE.Mesh | null {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#070d12';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = 'rgba(99,243,255,0.22)';
    context.lineWidth = 2;
    context.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
    context.fillStyle = '#ffb547';
    context.font = '600 28px Consolas, monospace';
    context.fillText('MASTER CAUTION', 26, 50);
    context.fillStyle = 'rgba(99,243,255,0.72)';
    context.font = '500 19px Consolas, monospace';
    context.fillText('FCS 路 IFF 路 LINK 08', 26, 86);
    context.fillStyle = 'rgba(255,181,71,0.5)';
    context.fillRect(26, 98, 64, 4);
    context.fillRect(98, 98, 20, 4);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.disposables.push(texture);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.068), material);
    mesh.rotation.x = -0.3;
    return mesh;
  }

  /* ------------------------------------------------------------------ */
  /* v0.5 the player's own airframe                                      */
  /* ------------------------------------------------------------------ */

  /**
   * F-08 LUMEN 1. In the cockpit view the aircraft is a rumour told by the
   * canopy frame; from outside it has to hold up to being looked at from four
   * metres away while it flies a cobra, so it is modelled properly: canards,
   * canted twins, a real canopy with a helmet inside, two engine nozzles, and
   * control surfaces that are wired to the same input the flight model uses.
   */
  private buildPlayerFighter(): void {
    const group = this.playerGroup;
    const hull = new THREE.MeshStandardMaterial({
      color: 0x2c3a48,
      metalness: 0.68,
      roughness: 0.36,
      emissive: 0x0c1a22,
      emissiveIntensity: 0.9,
    });
    const panel = new THREE.MeshStandardMaterial({
      color: 0x1a2530,
      metalness: 0.55,
      roughness: 0.52,
      emissive: 0x08131a,
      emissiveIntensity: 0.6,
    });
    const trim = new THREE.MeshBasicMaterial({ color: TEAM_COLORS.player });
    const ice = new THREE.MeshBasicMaterial({ color: 0xe8f8fc });
    const amber = new THREE.MeshBasicMaterial({ color: 0xffb547 });
    const edge = new THREE.LineBasicMaterial({
      color: 0x9fe9f5,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
    });

    // Fuselage: a flattened forward section blended into a wide lifting body.
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 2.5, 9, 8), hull);
    fore.rotation.x = Math.PI / 2;
    fore.position.z = -5.2;
    fore.scale.set(1, 0.62, 1);
    group.add(fore);
    fore.add(new THREE.LineSegments(new THREE.EdgesGeometry(fore.geometry, 28), edge));

    const mid = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.9, 8.4, 8), hull);
    mid.rotation.x = Math.PI / 2;
    mid.position.z = 3.4;
    mid.scale.set(1, 0.72, 1);
    group.add(mid);

    const aft = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.3, 5.4, 8), panel);
    aft.rotation.x = Math.PI / 2;
    aft.position.z = 10.2;
    aft.scale.set(1, 0.8, 1);
    group.add(aft);

    // Nose cone and pitot.
    const nose = new THREE.Mesh(new THREE.ConeGeometry(1.5, 4.6, 8), hull);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -12;
    nose.scale.set(1, 0.72, 1);
    group.add(nose);
    const pitot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3.4, 5), ice);
    pitot.rotation.x = Math.PI / 2;
    pitot.position.z = -15.4;
    group.add(pitot);

    // Canards.
    for (const side of [-1, 1]) {
      const canard = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.22, 2.6), hull);
      canard.position.set(side * 2.9, 0.1, -6.4);
      canard.rotation.z = side * 0.06;
      canard.rotation.y = side * 0.2;
      group.add(canard);
      const canardEdge = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 0.16), trim);
      canardEdge.position.set(side * 2.9, 0.24, -7.5);
      group.add(canardEdge);
    }

    // Main wing: a broad delta with a leading-edge glow and wingtip rails.
    const wing = new THREE.Mesh(new THREE.BoxGeometry(19, 0.5, 9.4), hull);
    wing.position.set(0, -0.5, 2.2);
    group.add(wing);
    wing.add(new THREE.LineSegments(new THREE.EdgesGeometry(wing.geometry, 24), edge));
    const leadingEdge = new THREE.Mesh(new THREE.BoxGeometry(18.6, 0.16, 0.4), trim);
    leadingEdge.position.set(0, -0.22, -2.5);
    group.add(leadingEdge);

    const aileronL = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.28, 1.9), panel);
    aileronL.position.set(-6.1, -0.6, 6.2);
    group.add(aileronL);
    const aileronR = aileronL.clone();
    aileronR.position.x = 6.1;
    group.add(aileronR);

    const flapL = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.26, 1.7), panel);
    flapL.position.set(-3.2, -0.62, 6.3);
    group.add(flapL);
    const flapR = flapL.clone();
    flapR.position.x = 3.2;
    group.add(flapR);

    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 5.6), panel);
      rail.position.set(side * 9.1, 0.05, 1.6);
      group.add(rail);
      const missileBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.34, 0.34, 4.6, 6),
        new THREE.MeshStandardMaterial({
          color: 0xd8e6ea,
          metalness: 0.4,
          roughness: 0.4,
          emissive: 0x2a4a55,
          emissiveIntensity: 0.7,
        }),
      );
      missileBody.rotation.x = Math.PI / 2;
      missileBody.position.set(side * 9.1, 0.55, 0.8);
      group.add(missileBody);
      const seeker = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 6), trim);
      seeker.position.set(side * 9.1, 0.55, -1.5);
      group.add(seeker);
    }

    // Canted twin tails and the all-moving stabilators.
    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.32, 5.4, 3.6), hull);
      fin.position.set(side * 3.4, 3, 11);
      fin.rotation.z = side * 0.34;
      group.add(fin);
      const finEdge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 4.4, 0.3), trim);
      finEdge.position.set(side * 4.5, 3.2, 9.4);
      finEdge.rotation.z = side * 0.34;
      group.add(finEdge);

      const stab = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.3, 2.6), panel);
      stab.position.set(side * 3.6, -0.4, 13.6);
      group.add(stab);
    }
    const elevator = new THREE.Mesh(new THREE.BoxGeometry(13.4, 0.3, 2.2), panel);
    elevator.position.set(0, -0.45, 15.4);
    group.add(elevator);

    // Canopy and the pilot.
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(2.1, 14, 10),
      new THREE.MeshStandardMaterial({
        color: 0x1d3d4a,
        metalness: 0.5,
        roughness: 0.1,
        emissive: 0x0d3038,
        emissiveIntensity: 0.7,
        transparent: true,
        opacity: 0.86,
      }),
    );
    canopy.scale.set(1, 0.72, 2.4);
    canopy.position.set(0, 1.7, -3.4);
    group.add(canopy);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.78, 10, 8), ice);
    helmet.position.set(0, 1.5, -3.6);
    group.add(helmet);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.34, 0.2), amber);
    visor.position.set(0, 1.5, -4.3);
    group.add(visor);

    // Nav lights: red to port, green to starboard, white strobes on the fins.
    const navRed = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xff4d5a, transparent: true }),
    );
    navRed.position.set(-9.6, -0.2, -0.6);
    group.add(navRed);
    const navGreen = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0x74ffb0, transparent: true }),
    );
    navGreen.position.set(9.6, -0.2, -0.6);
    group.add(navGreen);

    // Engine nozzles and the two burner plumes.
    const burnerMaterials: THREE.SpriteMaterial[] = [];
    const flames: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const nozzle = new THREE.Mesh(
        new THREE.CylinderGeometry(1.15, 1.5, 2.2, 10, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0x14191e,
          metalness: 0.85,
          roughness: 0.35,
          side: THREE.DoubleSide,
          emissive: 0x40210c,
          emissiveIntensity: 0.9,
        }),
      );
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(side * 1.7, 0.1, 13.2);
      group.add(nozzle);

      const burner = new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xffc48a,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.9,
      });
      const glow = new THREE.Sprite(burner);
      glow.position.set(side * 1.7, 0.1, 14.6);
      glow.scale.set(5, 5, 1);
      group.add(glow);
      burnerMaterials.push(burner);

      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(1.05, 8, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x8fe6ff,
          transparent: true,
          opacity: 0.34,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      flame.rotation.x = Math.PI / 2;
      flame.position.set(side * 1.7, 0.1, 19);
      group.add(flame);
      flames.push(flame);
    }

    // Wingtip vapour, the visual signature of a hard manoeuvre from outside.
    const vapour: THREE.Sprite[] = [];
    for (const side of [-1, 1]) {
      const material = new THREE.SpriteMaterial({
        map: this.smokeTexture,
        color: 0xdff4ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.set(side * 9.4, 0.1, 0.6);
      sprite.scale.set(9, 9, 1);
      sprite.visible = false;
      group.add(sprite);
      vapour.push(sprite);
    }

    // A soft rim light so the airframe reads against the dusk even in shadow.
    // Kept deliberately weak: the sun plus ACES tone mapping already blows the
    // upper surfaces out, and a strong fill turns the aircraft into a silhouette
    // cut out of white paper.
    const fill = new THREE.PointLight(0x9edcff, 0.85, 34, 2);
    fill.position.set(0, 2.5, 8);
    group.add(fill);

    group.add(leadingEdge);
    group.userData.surfaces = {
      aileronL,
      aileronR,
      flapL,
      flapR,
      elevator,
      burnerMaterials,
      flames,
      vapour,
      navRed,
      navGreen,
    } satisfies PlayerSurfaces;
    group.visible = false;
    this.scene.add(group);
    this.playerBuilt = true;
  }

  /** Pose the player's aircraft and animate its control surfaces. */
  private updatePlayerFighter(
    flight: ReturnType<CockpitEngine['getFlight']>,
    telemetry: ReturnType<CockpitEngine['getViewTelemetry']>,
    delta: number,
    paused: boolean,
  ): void {
    if (!this.playerBuilt) return;
    const group = this.playerGroup;
    group.position.set(flight.position.x, flight.position.y, flight.position.z);
    group.rotation.set(flight.pitch, flight.yaw, flight.roll, 'YXZ');

    const data = group.userData.surfaces as PlayerSurfaces | undefined;
    if (!data) return;
    const time = this.elapsed;
    const roll = telemetry.control.roll;
    const pitch = telemetry.control.pitch;

    // Control surfaces: the same numbers the flight model is flying on, so the
    // outside view never lies about what the aircraft is doing.
    data.aileronL.rotation.x = -roll * 0.5;
    data.aileronR.rotation.x = roll * 0.5;
    data.flapL.rotation.x = telemetry.airbrake ? -0.65 : -pitch * 0.12;
    data.flapR.rotation.x = telemetry.airbrake ? -0.65 : -pitch * 0.12;
    data.elevator.rotation.x = pitch * 0.42;

    // Burner: throttle drives the plume, afterburner drives the colour.
    const throttle = flight.throttle;
    const lit = clamp01((throttle - 0.42) / 0.58);
    const flicker = 0.86 + Math.sin(time * 26) * 0.1 + Math.sin(time * 41) * 0.04;
    for (const material of data.burnerMaterials) {
      material.opacity = lit * 0.92 * flicker;
      material.color.setHex(flight.afterburner ? 0xff9a5e : 0x9fd8ff);
    }
    for (const flame of data.flames) {
      const mesh = flame.material as THREE.MeshBasicMaterial;
      mesh.opacity = lit * (flight.afterburner ? 0.5 : 0.26) * flicker;
      mesh.color.setHex(flight.afterburner ? 0xffb066 : 0x8fe6ff);
      flame.scale.set(1, 0.7 + lit * 0.9 + (flight.afterburner ? 0.7 : 0), 1);
    }

    const blink = Math.sin(time * 4.2) > 0 ? 0.95 : 0.18;
    (data.navRed.material as THREE.MeshBasicMaterial).opacity = blink;
    (data.navGreen.material as THREE.MeshBasicMaterial).opacity = blink;

    // Vapour off the wingtips: g, stall and the scripted manoeuvre profiles all
    // pull condensation out of the air, and it is the cheapest way to make a
    // cobra or a kulbit legible from behind the aircraft.
    const scripted = telemetry.maneuver !== null && telemetry.maneuverProgress > 0;
    const want = paused
      ? 0
      : clamp01((telemetry.gLoad - VAPOUR_G) / 4.4) +
        (telemetry.postStall ? 0.55 : 0) +
        (scripted ? 0.7 : 0) +
        (telemetry.highG ? 0.35 : 0);
    this.vapour += (Math.min(1.4, want) - this.vapour) * Math.min(1, delta * VAPOUR_FADE);
    const strength = clamp01(this.vapour);
    for (const sprite of data.vapour) {
      const material = sprite.material as THREE.SpriteMaterial;
      sprite.visible = strength > 0.04;
      material.opacity = strength * 0.7 * (0.8 + Math.sin(time * 18) * 0.2);
      sprite.scale.setScalar(7 + strength * 16);
    }
  }

  /* ------------------------------------------------------------------ */
  /* entity meshes                                                       */
  /* ------------------------------------------------------------------ */

  private syncEntities(delta: number): void {
    const entities = this.engine.getEntities();
    const alive = new Set<string>();
    for (const entity of entities) {
      if (!entity.alive) continue;
      if (!['fighter', 'wingman', 'dreadnought', 'weakpoint', 'missile', 'flare'].includes(entity.kind)) {
        continue;
      }
      alive.add(entity.id);
      let group = this.entityMeshes.get(entity.id);
      if (!group) {
        const created = this.createEntityMesh(entity);
        if (!created) continue;
        group = created;
        this.entityMeshes.set(entity.id, group);
        this.scene.add(group);
      }
      this.updateEntityMesh(group, entity, delta);
    }
    for (const [id, group] of this.entityMeshes) {
      if (alive.has(id)) continue;
      this.scene.remove(group);
      disposeObject(group);
      this.entityMeshes.delete(id);
      this.engine.setProjection(id, { x: 0.5, y: 0.5, scale: 1, onScreen: false });
    }
  }

  private createEntityMesh(entity: SimEntity): THREE.Group | null {
    switch (entity.kind) {
      case 'fighter':
      case 'wingman':
        return this.createFighter(entity);
      case 'dreadnought':
        return this.createDreadnought();
      case 'weakpoint':
        return this.createWeakpoint(entity);
      case 'missile':
        return this.createMissile(entity);
      case 'flare':
        return this.createFlare();
      default:
        return null;
    }
  }

  private createFighter(entity: SimEntity): THREE.Group {
    const group = new THREE.Group();
    const isAlly = entity.team === 'ally';
    /**
     * v0.4 reads the airframe class instead of a single "ace or not" flag. The
     * roster now has seven silhouettes, and the accent colour is the cheapest
     * way to tell the audience which one is shooting at them: a violet strobe
     * across the sky means the jammer, gold means the commander, and both are
     * worth breaking off for.
     */
    const profile = enemyProfile(entity.enemyId);
    const accent = isAlly
      ? TEAM_COLORS.ally
      : profile?.tint ?? (entity.variant === 'ace' ? 0xff7546 : TEAM_COLORS.hostile);
    const silhouette = profile?.silhouette ?? 'standard';
    const heavy = silhouette === 'heavy';
    const light = silhouette === 'light';
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: isAlly ? 0x2b3d37 : 0x2b333e,
      metalness: 0.62,
      roughness: 0.4,
      emissive: isAlly ? 0x0c2c20 : 0x1a0b0e,
      emissiveIntensity: 0.8,
    });
    const accentMaterial = new THREE.MeshBasicMaterial({ color: accent });
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.82,
      blending: THREE.AdditiveBlending,
    });

    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(heavy ? 0.5 : 0.42, heavy ? 3.1 : 2.6, 6),
      bodyMaterial,
    );
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = heavy ? -2.6 : -2.3;
    group.add(nose);

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(heavy ? 0.62 : light ? 0.34 : 0.44, 0.34, 4.2, 6),
      bodyMaterial,
    );
    body.rotation.x = Math.PI / 2;
    body.position.z = 0.15;
    group.add(body);
    body.add(new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry, 30), edgeMaterial));

    // Drones are a bare delta; heavies get a long span; everyone else is stock.
    const span = heavy ? 9.6 : light ? 5.4 : 7.6;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(span, 0.11, heavy ? 2.4 : 1.9), bodyMaterial);
    wing.position.set(0, -0.02, 0.5);
    group.add(wing);
    wing.add(
      new THREE.LineSegments(
        new THREE.EdgesGeometry(wing.geometry, 20),
        edgeMaterial,
      ),
    );
    const leadingEdge = new THREE.Mesh(new THREE.BoxGeometry(span - 0.2, 0.02, 0.1), accentMaterial);
    leadingEdge.position.set(0, 0.01, heavy ? -0.68 : -0.43);
    group.add(leadingEdge);
    const wingTipLeft = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 1.1), accentMaterial);
    wingTipLeft.position.set(-span / 2 + 0.4, 0.015, 0.25);
    wingTipLeft.rotation.y = 0.24;
    group.add(wingTipLeft);
    const wingTipRight = wingTipLeft.clone();
    wingTipRight.position.x = span / 2 - 0.4;
    wingTipRight.rotation.y = -0.24;
    group.add(wingTipRight);

    const stabilizer = new THREE.Mesh(
      new THREE.BoxGeometry(heavy ? 3.8 : 2.8, 0.08, 0.9),
      bodyMaterial,
    );
    stabilizer.position.set(0, 0, 2.1);
    group.add(stabilizer);
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, heavy ? 1.7 : light ? 0.8 : 1.25, 1.1),
      bodyMaterial,
    );
    fin.position.set(0, heavy ? 0.78 : 0.55, 1.85);
    fin.rotation.x = -0.18;
    group.add(fin);
    // Twin fins are the heavy airframe's read at long range.
    if (heavy) {
      const cantedLeft = fin.clone();
      cantedLeft.position.set(-1.1, 0.6, 1.9);
      cantedLeft.rotation.z = 0.34;
      group.add(cantedLeft);
      const cantedRight = fin.clone();
      cantedRight.position.set(1.1, 0.6, 1.9);
      cantedRight.rotation.z = -0.34;
      group.add(cantedRight);
    }

    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 10, 6),
      new THREE.MeshStandardMaterial({
        color: 0x1b3a44,
        metalness: 0.4,
        roughness: 0.16,
        emissive: 0x0b2f36,
        emissiveIntensity: 0.6,
      }),
    );
    canopy.scale.set(light ? 0.8 : 1, 0.55, light ? 1.5 : 1.8);
    canopy.position.set(0, 0.36, -0.7);
    group.add(canopy);

    const navLightGeometry = new THREE.SphereGeometry(0.11, 6, 6);
    const navRed = new THREE.Mesh(
      navLightGeometry,
      new THREE.MeshBasicMaterial({ color: 0xff4d5a, transparent: true }),
    );
    navRed.position.set(-span / 2 - 0.2, 0.08, 0.4);
    group.add(navRed);
    const navGreen = new THREE.Mesh(
      navLightGeometry,
      new THREE.MeshBasicMaterial({ color: 0x74ffb0, transparent: true }),
    );
    navGreen.position.set(span / 2 + 0.2, 0.08, 0.4);
    group.add(navGreen);

    const navGlowGeometry = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: isAlly ? 0x74ffb0 : accent,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.7,
    });
    const leftNavGlow = new THREE.Sprite(navGlowGeometry);
    leftNavGlow.position.set(-span / 2 - 0.1, 0.1, 0.5);
    leftNavGlow.scale.set(2.8, 2.8, 1);
    group.add(leftNavGlow);
    const rightNavGlow = new THREE.Sprite(navGlowGeometry.clone());
    rightNavGlow.material.color.setHex(0x74ffb0);
    rightNavGlow.position.set(3.9, 0.1, 0.5);
    rightNavGlow.scale.set(2.8, 2.8, 1);
    group.add(rightNavGlow);

    const trailGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-3.9, 0.08, 0.5),
      new THREE.Vector3(-3.7, 0.08, 46),
      new THREE.Vector3(3.7, 0.08, 46),
      new THREE.Vector3(3.9, 0.08, 0.5),
    ]);
    const trails = new THREE.Line(
      trailGeometry,
      new THREE.LineBasicMaterial({
        color: isAlly ? 0x74ffb0 : 0xc9e0e6,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    group.add(trails);

    const burnerMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: accent,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.95,
    });
    const burner = new THREE.Sprite(burnerMaterial);
    burner.position.set(0, 0, 2.5);
    burner.scale.set(5.5, 5.5, 1);
    group.add(burner);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.8, 10, 7, 1, true),
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    flame.rotation.x = Math.PI / 2;
    flame.position.z = 6.5;
    group.add(flame);
    group.userData.burner = burnerMaterial;
    group.userData.flame = flame;
    group.userData.navRed = navRed;
    group.userData.navGreen = navGreen;
    group.userData.isFighter = true;

    group.scale.setScalar(3.2);
    return group;
  }

  /**
   * LEVIATHAN. v0.4's dreadnought was a stack of pale boxes that read as a
   * building; v0.5 rebuilds it around the simulation's own anchors, so what the
   * player sees is exactly what the collider in `sim/boss.ts` describes: a long
   * armoured keel, a swept wing with outrigger pylons carrying the two shield
   * nodes, bow jaws with an armoured reactor maw between them, four tracking
   * close-in turrets, a vertical launch deck and the spinal lance slung under
   * the bow. Everything that can be shot is where the sim says it is, and
   * everything that can shoot back is animated.
   */
  private createDreadnought(): THREE.Group {
    const group = new THREE.Group();
    const hullMaterial = new THREE.MeshStandardMaterial({
      color: 0x394a56,
      metalness: 0.66,
      roughness: 0.42,
      emissive: 0x14242d,
      emissiveIntensity: 1.15,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x1b2630,
      metalness: 0.5,
      roughness: 0.62,
      emissive: 0x081015,
      emissiveIntensity: 0.7,
    });
    const plateMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a5c68,
      metalness: 0.72,
      roughness: 0.34,
      emissive: 0x101d24,
      emissiveIntensity: 0.9,
    });
    const amberMaterial = new THREE.MeshBasicMaterial({ color: 0xffb547 });
    const redMaterial = new THREE.MeshBasicMaterial({ color: 0xff4d5a });
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xa9ced6,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
    });

    /** Adds a box and traces its silhouette, which is what sells the scale. */
    const slab = (
      width: number,
      height: number,
      depth: number,
      x: number,
      y: number,
      z: number,
      material: THREE.Material = hullMaterial,
      outline = true,
    ): THREE.Mesh => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.position.set(x, y, z);
      group.add(mesh);
      if (outline) {
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 24), edgeMaterial));
      }
      return mesh;
    };

    /* --- keel, deck and stern ---------------------------------------- */
    slab(156, 92, 536, 0, 0, -30);
    slab(124, 84, 380, 0, 74, 30);
    slab(300, 80, 192, 0, 4, 232);

    // Deck plating and the catapult tracks running forward.
    slab(150, 6, 300, 0, 118, 30, plateMaterial, false);
    for (const side of [-1, 1]) {
      slab(12, 4, 250, side * 46, 122, 20, darkMaterial, false);
      for (let index = 0; index < 9; index += 1) {
        slab(4, 3, 16, side * 46, 125, -100 + index * 30, amberMaterial, false);
      }
    }

    // Armour ribs along the keel: pure silhouette, cheap to draw.
    for (let index = 0; index < 12; index += 1) {
      slab(170, 10, 14, 0, 40, -260 + index * 44, plateMaterial, false);
    }

    /* --- main wing and outer panels ---------------------------------- */
    slab(792, 30, 304, 0, -6, 60);
    slab(236, 18, 168, -312, -4, 128);
    slab(236, 18, 168, 312, -4, 128);
    // Swept leading edges. A plain box reads as a table; a delta reads as a
    // warship, and the silhouette is all the player gets at four kilometres.
    for (const side of [-1, 1]) {
      const sweep = new THREE.Mesh(new THREE.BoxGeometry(300, 26, 150), hullMaterial);
      sweep.position.set(side * 190, -6, -80);
      sweep.rotation.y = side * 0.42;
      group.add(sweep);
      sweep.add(new THREE.LineSegments(new THREE.EdgesGeometry(sweep.geometry, 24), edgeMaterial));

      const tip = new THREE.Mesh(
        new THREE.ConeGeometry(22, 190, 4),
        hullMaterial,
      );
      tip.rotation.z = Math.PI / 2;
      tip.rotation.y = Math.PI / 4;
      tip.position.set(side * 470, -6, 30);
      tip.scale.set(0.6, 1, 1.5);
      group.add(tip);
    }
    for (const side of [-1, 1]) {
      // Leading-edge glow, hardpoints and a wingtip beacon.
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(390, 3, 8),
        new THREE.MeshBasicMaterial({
          color: 0x63f3ff,
          transparent: true,
          opacity: 0.42,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      strip.position.set(side * 200, 9, -88);
      group.add(strip);
      for (let index = 0; index < 4; index += 1) {
        slab(26, 22, 74, side * (150 + index * 80), -26, 40, darkMaterial, false);
      }
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(7, 8, 8), redMaterial);
      beacon.position.set(side * 424, -2, 128);
      group.add(beacon);
    }

    /* --- bow jaws and the reactor maw -------------------------------- */
    for (const side of [-1, 1]) {
      slab(52, 68, 152, side * 74, 2, -318);
      // Forward sensor blister on each jaw.
      const blister = new THREE.Mesh(new THREE.SphereGeometry(20, 12, 10), plateMaterial);
      blister.position.set(side * 74, 26, -386);
      blister.scale.set(1, 0.7, 1.4);
      group.add(blister);
      const blisterLight = new THREE.Mesh(new THREE.SphereGeometry(5, 8, 8), amberMaterial);
      blisterLight.position.set(side * 74, 30, -404);
      group.add(blisterLight);
    }

    // The maw: a recessed housing, two armoured petals and the reactor inside.
    // The petals are the stage read at close range — while the shields are up
    // they meet in the middle and the reactor glows through the seam; once the
    // core is targetable they have slid clear of it.
    const mawHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(74, 84, 40, 16, 1, true),
      darkMaterial,
    );
    mawHousing.rotation.x = Math.PI / 2;
    mawHousing.position.set(BOSS_ANCHOR.core.x, BOSS_ANCHOR.core.y, BOSS_ANCHOR.core.z + 8);
    group.add(mawHousing);
    const mawRing = new THREE.Mesh(
      new THREE.TorusGeometry(80, 6, 8, 26),
      plateMaterial,
    );
    mawRing.position.set(BOSS_ANCHOR.core.x, BOSS_ANCHOR.core.y, BOSS_ANCHOR.core.z - 34);
    group.add(mawRing);

    const shutters: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const shutter = new THREE.Mesh(new THREE.BoxGeometry(74, 104, 22), plateMaterial);
      shutter.position.set(side * 37, BOSS_ANCHOR.core.y, BOSS_ANCHOR.core.z - 42);
      group.add(shutter);
      shutter.add(new THREE.LineSegments(new THREE.EdgesGeometry(shutter.geometry, 24), edgeMaterial));
      for (let index = 0; index < 4; index += 1) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(64, 6, 8), darkMaterial);
        rib.position.set(0, -36 + index * 24, -12);
        shutter.add(rib);
      }
      shutters.push(shutter);
    }

    const coreGlowMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0xff7a3d,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.8,
    });
    const coreGlow = new THREE.Sprite(coreGlowMaterial);
    coreGlow.position.set(BOSS_ANCHOR.core.x, BOSS_ANCHOR.core.y, BOSS_ANCHOR.core.z - 6);
    coreGlow.scale.set(150, 150, 1);
    group.add(coreGlow);

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(34, 2),
      new THREE.MeshBasicMaterial({ color: 0xff8a4d, wireframe: true }),
    );
    core.position.set(BOSS_ANCHOR.core.x, BOSS_ANCHOR.core.y, BOSS_ANCHOR.core.z);
    group.add(core);
    const coreInner = new THREE.Mesh(
      new THREE.SphereGeometry(20, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd9a8 }),
    );
    coreInner.position.copy(core.position);
    group.add(coreInner);

    // Containment rings: two gyroscope hoops around the reactor.
    const rings: THREE.Mesh[] = [];
    for (let index = 0; index < 2; index += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(52 + index * 12, 2.4, 6, 30),
        new THREE.MeshBasicMaterial({
          color: 0x63f3ff,
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
        }),
      );
      ring.position.copy(core.position);
      ring.rotation.x = index === 0 ? 0 : Math.PI / 2.4;
      group.add(ring);
      rings.push(ring);
    }

    // The spinal lance, slung under the bow.
    const lanceBarrel = new THREE.Mesh(
      new THREE.CylinderGeometry(17, 21, 300, 12),
      plateMaterial,
    );
    lanceBarrel.rotation.x = Math.PI / 2;
    lanceBarrel.position.set(0, -50, -220);
    group.add(lanceBarrel);
    lanceBarrel.add(
      new THREE.LineSegments(new THREE.EdgesGeometry(lanceBarrel.geometry, 30), edgeMaterial),
    );
    for (let index = 0; index < 5; index += 1) {
      const collar = new THREE.Mesh(new THREE.TorusGeometry(21, 3, 6, 16), darkMaterial);
      collar.position.set(0, -50, -110 - index * 52);
      group.add(collar);
    }
    const lanceMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0xff4d5a,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.12,
    });
    const lanceMuzzle = new THREE.Sprite(lanceMaterial);
    lanceMuzzle.position.set(0, -50, -372);
    lanceMuzzle.scale.set(120, 120, 1);
    group.add(lanceMuzzle);

    /* --- outrigger pylons and the shield emitters -------------------- */
    const emitterMaterials: THREE.SpriteMaterial[] = [];
    for (const side of [-1, 1]) {
      slab(120, 40, 52, side * 430, 40, -30, plateMaterial);
      const anchor = side < 0 ? BOSS_ANCHOR.shieldL : BOSS_ANCHOR.shieldR;
      // The arm that carries the node out past the wing tip.
      const arm = new THREE.Mesh(new THREE.BoxGeometry(180, 20, 22), darkMaterial);
      arm.position.set(side * 430, anchor.y, anchor.z);
      arm.rotation.z = side * 0.06;
      group.add(arm);

      const housing = new THREE.Mesh(
        new THREE.CylinderGeometry(30, 38, 34, 14, 1, true),
        plateMaterial,
      );
      housing.rotation.z = Math.PI / 2;
      housing.position.set(anchor.x, anchor.y, anchor.z);
      group.add(housing);
      const housingEdge = new THREE.LineSegments(
        new THREE.EdgesGeometry(housing.geometry, 26),
        edgeMaterial,
      );
      housing.add(housingEdge);

      const emitter = new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0x63f3ff,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.75,
      });
      const glow = new THREE.Sprite(emitter);
      glow.position.set(anchor.x + side * 22, anchor.y, anchor.z);
      glow.scale.set(120, 120, 1);
      group.add(glow);
      emitterMaterials.push(emitter);
    }

    // The shield itself: a squashed bubble over the whole ship. This is the
    // single clearest read in the encounter — while it is up, the hull is not
    // the answer; when it goes down, the reactor is. It is *only* drawn from
    // outside the bubble (see `updateDreadnought`): a force field you are
    // standing inside of is a wall of triangles, not a shield.
    const domeMaterial = new THREE.MeshBasicMaterial({
      color: 0x63f3ff,
      wireframe: true,
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(600, 2), domeMaterial);
    dome.scale.set(1.12, 0.46, 1.05);
    group.add(dome);

    /* --- close-in turrets ------------------------------------------- */
    const turrets: THREE.Group[] = [];
    const barrels: THREE.Mesh[][] = [];
    for (const mount of BOSS_TURRETS) {
      const mountGroup = new THREE.Group();
      mountGroup.position.set(mount.x, mount.y, mount.z);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(20, 24, 14, 10), darkMaterial);
      mountGroup.add(base);
      const yoke = new THREE.Group();
      yoke.position.y = -10;
      const head = new THREE.Mesh(new THREE.BoxGeometry(26, 20, 26), plateMaterial);
      yoke.add(head);
      const pair: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        const barrel = new THREE.Mesh(
          new THREE.CylinderGeometry(3.2, 3.2, 54, 7),
          new THREE.MeshStandardMaterial({
            color: 0x2b3742,
            metalness: 0.8,
            roughness: 0.3,
            emissive: 0x5a1b12,
            emissiveIntensity: 0.5,
          }),
        );
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(side * 7, -4, -30);
        yoke.add(barrel);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(3.6, 6, 6), redMaterial);
        tip.position.set(side * 7, -4, -56);
        yoke.add(tip);
        pair.push(barrel);
      }
      mountGroup.add(yoke);
      group.add(mountGroup);
      turrets.push(yoke);
      barrels.push(pair);
    }

    /* --- vertical launch cells --------------------------------------- */
    const vls: THREE.Mesh[] = [];
    for (const cell of BOSS_VLS) {
      const hatch = new THREE.Mesh(
        new THREE.BoxGeometry(34, 5, 34),
        new THREE.MeshBasicMaterial({
          color: 0x2a3238,
          transparent: true,
          opacity: 0.8,
        }),
      );
      hatch.position.set(cell.x, cell.y, cell.z);
      group.add(hatch);
      const frame = new THREE.Mesh(
        new THREE.TorusGeometry(24, 2.4, 6, 4),
        new THREE.MeshBasicMaterial({ color: 0x6b7a85 }),
      );
      frame.rotation.x = -Math.PI / 2;
      frame.rotation.z = Math.PI / 4;
      frame.position.set(cell.x, cell.y + 3, cell.z);
      group.add(frame);
      vls.push(hatch);
    }

    /* --- superstructure, radar, masts and running lights -------------- */
    const radar = new THREE.Group();
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(34, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0x1d2c36,
        metalness: 0.6,
        roughness: 0.4,
        side: THREE.DoubleSide,
      }),
    );
    dish.rotation.x = Math.PI / 2;
    radar.add(dish);
    const dishMast = new THREE.Mesh(new THREE.BoxGeometry(8, 40, 8), darkMaterial);
    dishMast.position.y = -24;
    radar.add(dishMast);
    radar.position.set(0, 150, 60);
    group.add(radar);

    slab(96, 40, 70, 0, 138, -60, plateMaterial);
    const bridgeWindows = new THREE.Mesh(new THREE.BoxGeometry(84, 6, 3), amberMaterial);
    bridgeWindows.position.set(0, 142, -96);
    group.add(bridgeWindows);

    for (const side of [-1, 1]) {
      const mast = new THREE.Mesh(new THREE.BoxGeometry(6, 96, 6), darkMaterial);
      mast.position.set(side * 96, 176, 40);
      group.add(mast);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(7, 8, 8), redMaterial);
      beacon.position.set(side * 96, 226, 40);
      group.add(beacon);
    }

    // Hull name plate, because capital ships have names painted on them.
    const plate = this.createHullPlate();
    if (plate) {
      plate.position.set(-296, 5, -6);
      plate.rotation.x = -Math.PI / 2;
      plate.rotation.z = Math.PI / 2;
      group.add(plate);
    }

    // Running lights down both flanks.
    for (const side of [-1, 1]) {
      for (let index = 0; index < 14; index += 1) {
        const light = new THREE.Mesh(new THREE.BoxGeometry(5, 2.4, 2.4), amberMaterial);
        light.position.set(side * 79, -34, -280 + index * 40);
        group.add(light);
      }
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(4, 3, 420),
        new THREE.MeshBasicMaterial({
          color: 0xff9b55,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      strip.position.set(side * 82, -44, -20);
      group.add(strip);
    }

    /* --- engines ------------------------------------------------------ */
    for (const side of [-1, 1]) {
      for (const row of [-1, 1]) {
        const nozzle = new THREE.Mesh(
          new THREE.CylinderGeometry(26, 34, 46, 12, 1, true),
          darkMaterial,
        );
        nozzle.rotation.x = Math.PI / 2;
        nozzle.position.set(side * 78, row * 30 + 4, 330);
        group.add(nozzle);
      }
      const plume = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowTexture,
          color: 0xffa66a,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          opacity: 0.55,
        }),
      );
      plume.position.set(side * 78, 4, 372);
      plume.scale.set(180, 180, 1);
      group.add(plume);
    }

    const coreLight = new THREE.PointLight(0xffa66a, 2.6, 2600, 2);
    coreLight.position.set(0, 40, -300);
    group.add(coreLight);

    group.userData.dreadnought = {
      radar,
      turrets,
      barrels,
      vls,
      shutters,
      rings,
      core,
      coreGlow: coreGlowMaterial,
      lance: lanceMuzzle,
      lanceMaterial,
      lanceBarrel,
      dome,
      domeMaterial,
      emitterMaterials,
    } satisfies DreadnoughtParts;
    return group;
  }

  /**
   * The hull name, painted procedurally. Every other label in the project is
   * drawn this way, and a capital ship without its name on the side is just a
   * grey shape at four hundred metres.
   */
  private createHullPlate(): THREE.Mesh | null {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.fillStyle = '#2b3a44';
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 60; index += 1) {
      context.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`;
      context.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 60, 3);
    }
    context.fillStyle = '#0d1419';
    context.font = '700 132px Bahnschrift, "DIN Condensed", Impact, sans-serif';
    context.fillText('LEVIATHAN', 32, 150);
    context.fillStyle = 'rgba(99,243,255,0.85)';
    context.font = '600 44px Consolas, monospace';
    context.fillText('CVB-01 · THEVE NAVAL COMMAND', 36, 214);
    context.fillStyle = '#ffb547';
    for (let index = 0; index < 12; index += 1) {
      context.fillRect(760 + index * 20, 168, 12, 40);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.disposables.push(texture);
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    return new THREE.Mesh(new THREE.PlaneGeometry(300, 76), material);
  }

  private createWeakpoint(entity: SimEntity): THREE.Group {
    const group = new THREE.Group();
    const isCore = entity.weakpoint?.key === 'core';
    const color = isCore ? 0xff6a3d : 0xffb547;
    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(isCore ? 20 : 13, 1),
      new THREE.MeshBasicMaterial({ color, wireframe: true }),
    );
    group.add(core);

    const inner = new THREE.Mesh(
      new THREE.SphereGeometry(isCore ? 11 : 7, 12, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
    );
    group.add(inner);

    const haloMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.62,
    });
    const halo = new THREE.Sprite(haloMaterial);
    halo.scale.set(isCore ? 116 : 78, isCore ? 116 : 78, 1);
    group.add(halo);

    if (!isCore) {
      const shield = new THREE.Mesh(
        new THREE.IcosahedronGeometry(36, 1),
        new THREE.MeshBasicMaterial({
          color: 0x63f3ff,
          wireframe: true,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
        }),
      );
      group.add(shield);
      group.userData.shield = shield;
    }

    group.userData.core = core;
    group.userData.halo = haloMaterial;
    group.userData.isWeakpoint = true;
    group.userData.isCore = isCore;
    return group;
  }

  private createMissile(entity: SimEntity): THREE.Group {
    const group = new THREE.Group();
    const color = entity.team === 'player' ? 0x63f3ff : 0xff4d5a;
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 0.9, 7, 6),
      new THREE.MeshStandardMaterial({
        color: 0x161d24,
        emissive: color,
        emissiveIntensity: 0.8,
        metalness: 0.5,
        roughness: 0.4,
      }),
    );
    body.rotation.x = Math.PI / 2;
    group.add(body);
    const glowMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
    });
    const glow = new THREE.Sprite(glowMaterial);
    glow.scale.set(26, 26, 1);
    glow.position.z = 3;
    group.add(glow);

    const history: THREE.Vector3[] = [];
    const positions = new Float32Array(8 * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const trail = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.38,
        blending: THREE.AdditiveBlending,
      }),
    );
    trail.frustumCulled = false;
    group.add(trail);
    group.userData.history = history;
    group.userData.trail = trail;
    group.userData.trailPositions = positions;
    group.userData.isMissile = true;
    return group;
  }

  /**
   * v0.5 flare. v0.4 was one amber sprite that pulsed its scale; it read as a
   * lamp rather than an ejection seat for burning magnesium. The new cartridge
   * has a white-hot core, a wide amber bloom, a tumbling spark star and its own
   * smoke, and the group is left to burn down over the entity's life.
   */
  private createFlare(): THREE.Group {
    const group = new THREE.Group();

    const bloomMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0xffa64d,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 1,
    });
    const bloom = new THREE.Sprite(bloomMaterial);
    // Sized against the airframe, not against the sky: a cartridge is a
    // metre-long object, and an 88 m bloom just fills the screen when the
    // outside camera is 40 m behind the aircraft that dropped it.
    bloom.scale.set(21, 21, 1);
    group.add(bloom);

    const coreMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0xfff6e2,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 1,
    });
    const core = new THREE.Sprite(coreMaterial);
    core.scale.set(8, 8, 1);
    group.add(core);

    // A tumbling scrap of burning composition, so the cartridge reads as an
    // object rather than a billboard.
    const star = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.1, 0),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
    );
    group.add(star);

    const smokeMaterial = new THREE.SpriteMaterial({
      map: this.smokeTexture,
      color: 0x6b6a66,
      transparent: true,
      depthWrite: false,
      opacity: 0,
      blending: THREE.NormalBlending,
    });
    const smoke = new THREE.Sprite(smokeMaterial);
    smoke.scale.set(18, 18, 1);
    group.add(smoke);

    group.userData.flare = {
      bloom: bloomMaterial,
      core: coreMaterial,
      smoke: smokeMaterial,
      bloomSprite: bloom,
      coreSprite: core,
      smokeSprite: smoke,
      star,
      seed: Math.random() * Math.PI * 2,
    } satisfies FlareParts;
    return group;
  }

  /**
   * Animate the dreadnought from the simulation's own attack state: turrets
   * track the player, the launch cells light up through a salvo, the reactor
   * shutters open when the core is exposed, and the lance emitter charges in
   * plain sight. Every animated part is a read on an attack the player has to
   * answer, which is the whole point of moving them.
   */
  private updateDreadnought(group: THREE.Group, entity: SimEntity, delta: number): void {
    const parts = group.userData.dreadnought as DreadnoughtParts | undefined;
    if (!parts) return;
    const time = this.elapsed;
    const state = this.engine.getBossVisualState();

    group.position.y += Math.sin(time * 0.4) * 0.6;
    parts.radar.rotation.y += delta * 0.22;

    // Close-in turrets: slew onto the player, then flash their muzzles while
    // the battery is actually firing.
    const player = this.engine.getFlight().position;
    for (const yoke of parts.turrets) {
      const world = new THREE.Vector3();
      yoke.parent?.getWorldPosition(world);
      const toPlayer = new THREE.Vector3(
        player.x - world.x,
        player.y - world.y,
        player.z - world.z,
      );
      if (toPlayer.lengthSq() < 1) continue;
      // Convert the bearing into the hull's own frame so the mount points the
      // right way whatever the dreadnought's heading is.
      const local = toPlayer
        .clone()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), -entity.yaw);
      const desiredYaw = Math.atan2(local.x, -local.z);
      const desiredPitch = -Math.atan2(local.y, Math.hypot(local.x, local.z));
      yoke.rotation.y +=
        ((((desiredYaw - yoke.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI)) *
        Math.min(1, delta * 2.4);
      yoke.rotation.x += (desiredPitch - yoke.rotation.x) * Math.min(1, delta * 2.4);
    }
    const heat = state.turretHeat;
    for (const pair of parts.barrels) {
      for (const barrel of pair) {
        const material = barrel.material as THREE.MeshStandardMaterial;
        material.emissiveIntensity = 0.4 + heat * (2.4 + Math.sin(time * 40) * 0.6);
        material.emissive.setHex(heat > 0.5 ? 0xff3a1e : 0x5a1b12);
      }
    }

    // Vertical launch cells: warm through the telegraph, blow open on release.
    const salvo = state.attackId === 'salvo';
    for (let index = 0; index < parts.vls.length; index += 1) {
      const hatch = parts.vls[index]!;
      const material = hatch.material as THREE.MeshBasicMaterial;
      const primed = salvo ? clamp01(state.charge * 1.4 - index * 0.08) : 0;
      material.color.setRGB(0.16 + primed * 0.84, 0.2 + primed * 0.5, 0.22 + primed * 0.3);
      material.opacity = 0.8 + primed * 0.2;
      hatch.scale.y = 1 + primed * 3.4;
    }

    // Reactor: the maw opens only when the core is actually targetable, so the
    // silhouette tells the player which weapon can hurt it.
    const open = state.coreExposed ? 1 : 0;
    for (let index = 0; index < parts.shutters.length; index += 1) {
      const shutter = parts.shutters[index]!;
      const side = index === 0 ? -1 : 1;
      const target = side * (37 + open * 78);
      shutter.position.x += (target - shutter.position.x) * Math.min(1, delta * 2.2);
      // The petals also swing back on their hinges as they clear the maw.
      shutter.rotation.y += (side * open * 0.5 - shutter.rotation.y) * Math.min(1, delta * 2.2);
    }
    const corePulse = 0.55 + Math.sin(time * 5.4) * 0.16 + (state.coreExposed ? 0.5 : 0);
    parts.coreGlow.opacity = clamp01(corePulse);
    parts.coreGlow.color.setHex(state.coreExposed ? 0xffd08a : 0xff5a2d);
    const coreMaterial = parts.core.material as THREE.MeshBasicMaterial;
    coreMaterial.color.setHex(state.coreExposed ? 0xffd08a : 0x7a3a24);
    parts.core.rotation.y += delta * (state.coreExposed ? 1.4 : 0.5);
    for (let index = 0; index < parts.rings.length; index += 1) {
      const ring = parts.rings[index]!;
      ring.rotation.z += delta * (0.5 + index * 0.35) * (state.coreExposed ? 2.2 : 1);
      ring.rotation.y += delta * 0.3;
      const material = ring.material as THREE.MeshBasicMaterial;
      material.opacity = state.coreExposed ? 0.85 : 0.3;
    }

    // The lance: dark until it charges, then a red star at the muzzle.
    const charging = state.attackId === 'lance';
    const lancePower = charging
      ? state.phase === 'telegraph'
        ? state.charge
        : state.phase === 'active'
          ? 1
          : state.charge * 0.4
      : 0;
    parts.lanceMaterial.opacity = 0.06 + lancePower * (0.9 + Math.sin(time * 46) * 0.1);
    parts.lance.scale.setScalar(90 + lancePower * 190);
    const lanceBarrelMaterial = parts.lanceBarrel.material as THREE.MeshStandardMaterial;
    lanceBarrelMaterial.emissive.setHex(lancePower > 0.4 ? 0x8c1f14 : 0x101d24);
    lanceBarrelMaterial.emissiveIntensity = 0.9 + lancePower * 2.2;

    // Shield array: one bubble over the whole ship, gone the moment the two
    // nodes are down. This is the encounter's stage read — and it fades out as
    // the camera crosses the shell, because a force field you are standing
    // inside of is a wall of triangles rather than a shield.
    const rangeToShip = this.camera.position.distanceTo(group.position);
    const outside = clamp01((rangeToShip - 900) / 700);
    const domeTarget = state.shieldsUp
      ? (0.09 + Math.sin(time * 1.6) * 0.02) * outside
      : 0;
    parts.domeMaterial.opacity += (domeTarget - parts.domeMaterial.opacity) * Math.min(1, delta * 2.2);
    parts.dome.visible = parts.domeMaterial.opacity > 0.006;
    parts.dome.rotation.y += delta * 0.04;
    const emitterPower = state.shieldsUp ? 0.85 : 0.12;
    for (const emitter of parts.emitterMaterials) {
      emitter.opacity += (emitterPower - emitter.opacity) * Math.min(1, delta * 2.4);
    }
  }

  private updateEntityMesh(group: THREE.Group, entity: SimEntity, delta: number): void {    group.position.set(entity.position.x, entity.position.y, entity.position.z);
    group.rotation.set(entity.pitch, entity.yaw, entity.roll, 'YXZ');
    const time = this.elapsed;

    if (group.userData.isFighter) {
      const burnerMaterial = group.userData.burner as THREE.SpriteMaterial | undefined;
      if (burnerMaterial) {
        burnerMaterial.opacity = 0.6 + Math.sin(time * 12 + entity.position.x) * 0.18;
      }
      const flame = group.userData.flame as THREE.Mesh | undefined;
      if (flame?.material) {
        (flame.material as THREE.MeshBasicMaterial).opacity =
          0.24 + Math.sin(time * 17 + entity.position.z) * 0.08;
      }
      const navRed = group.userData.navRed as THREE.Mesh | undefined;
      const navGreen = group.userData.navGreen as THREE.Mesh | undefined;
      const blink = Math.sin(time * 4.2) > 0 ? 0.9 : 0.2;
      if (navRed?.material) (navRed.material as THREE.MeshBasicMaterial).opacity = blink;
      if (navGreen?.material) (navGreen.material as THREE.MeshBasicMaterial).opacity = blink;
    }

    if (entity.kind === 'dreadnought') {
      this.updateDreadnought(group, entity, delta);
    }

    if (entity.kind === 'weakpoint') {
      const shield = group.userData.shield as THREE.Mesh | undefined;
      if (shield) {
        const pulse = 1 + Math.sin(time * 2.2) * 0.05;
        shield.scale.setScalar(pulse);
        shield.rotation.y += delta * 0.12;
      }
      const haloMaterial = group.userData.halo as THREE.SpriteMaterial | undefined;
      if (haloMaterial) {
        haloMaterial.opacity = entity.weakpoint?.targetable === false ? 0.22 : 0.7 + Math.sin(time * 4) * 0.15;
      }
      const core = group.userData.core as THREE.Mesh | undefined;
      if (core) core.rotation.y += delta * 0.7;
    }

    if (entity.kind === 'missile') {
      const history = group.userData.history as THREE.Vector3[];
      const trail = group.userData.trail as THREE.Line;
      const positions = group.userData.trailPositions as Float32Array;
      const point = new THREE.Vector3(entity.position.x, entity.position.y, entity.position.z);
      if (history.length === 0 || history[history.length - 1]!.distanceTo(point) > 2.5) {
        history.push(point);
        if (history.length > 8) history.shift();
      }
      for (let index = 0; index < 8; index += 1) {
        const source = history[Math.min(index, Math.max(0, history.length - 1))] ?? point;
        positions[index * 3] = source.x;
        positions[index * 3 + 1] = source.y;
        positions[index * 3 + 2] = source.z;
      }
      const attribute = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
      attribute.needsUpdate = true;
      trail.geometry.setDrawRange(0, Math.max(2, history.length));
    }

    if (entity.kind === 'flare') {
      const parts = group.userData.flare as FlareParts | undefined;
      if (!parts) return;
      const life = clamp01(entity.life / Math.max(0.001, entity.maxLife));
      // Burn-in then burn-out: full brightness for the first third, then a
      // falling ember. The bloom collapses faster than the core, which is what
      // makes it read as cooling rather than dimming.
      const burn = life > 0.66 ? 1 : life / 0.66;
      const flicker = 0.82 + Math.sin(time * 34 + parts.seed) * 0.12 + Math.random() * 0.06;
      parts.bloom.opacity = burn * flicker;
      parts.core.opacity = Math.min(1, burn * 1.25) * flicker;
      parts.bloom.color.setHSL(0.09 - (1 - burn) * 0.05, 0.95, 0.55 + burn * 0.14);
      parts.coreSprite.scale.setScalar(7 + burn * 4);
      parts.bloomSprite.scale.setScalar(18 + burn * 8);
      parts.smoke.opacity = (1 - burn) * 0.5;
      parts.smokeSprite.scale.setScalar(14 + (1 - burn) * 42);
      parts.star.rotation.x += delta * 6;
      parts.star.rotation.y += delta * 4.4;
      parts.star.scale.setScalar(0.6 + burn * 0.8);
    }
  }

  /* ------------------------------------------------------------------ */
  /* effects                                                             */
  /* ------------------------------------------------------------------ */

  private syncEffects(delta: number): void {
    const effects = this.engine.getEffects();
    const ids = new Set<string>();
    for (const effect of effects) {
      ids.add(effect.id);
      let object = this.effectObjects.get(effect.id);
      if (!object) {
        const created = this.createEffectObject(effect);
        if (!created) continue;
        object = created;
        this.effectObjects.set(effect.id, object);
        this.scene.add(object);
      }
      this.animateEffect(object, effect, delta);
    }
    for (const [id, object] of this.effectObjects) {
      if (ids.has(id)) continue;
      this.scene.remove(object);
      disposeObject(object);
      this.effectObjects.delete(id);
    }
  }

  private createEffectObject(effect: SimEffect): THREE.Object3D | null {
    const color = EFFECT_COLORS[effect.color] ?? 0xffb547;
    if (effect.kind === 'beam') {
      // The spinal lance: a real cylinder from the muzzle to wherever it was
      // aimed, with a hot inner core. It is the one effect in the game the
      // player is expected to look at and decide to leave.
      const from = new THREE.Vector3(effect.position.x, effect.position.y, effect.position.z);
      const to = new THREE.Vector3(
        effect.to?.x ?? effect.position.x,
        effect.to?.y ?? effect.position.y,
        effect.to?.z ?? effect.position.z,
      );
      const span = from.distanceTo(to);
      const group = new THREE.Group();
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(effect.scale, effect.scale * 1.5, span, 14, 1, true),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.42,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(effect.scale * 0.34, effect.scale * 0.5, span, 10, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xfff1e0,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      group.add(shell, core);
      // Orient the cylinder's +Y onto the beam direction, then sit it halfway.
      const midway = from.clone().add(to).multiplyScalar(0.5);
      group.position.copy(midway);
      group.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        to.clone().sub(from).normalize(),
      );
      group.frustumCulled = false;
      group.userData.beamShell = shell.material as THREE.MeshBasicMaterial;
      group.userData.beamCore = core.material as THREE.MeshBasicMaterial;
      return group;
    }
    if (effect.kind === 'pulse') {
      // The shield discharge: an expanding wireframe shell that races out to
      // the pulse radius and dies. Deliberately not a sprite — a shockwave has
      // to have a surface.
      const material = new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), material);
      shell.scale.setScalar(effect.scale);
      shell.frustumCulled = false;
      return shell;
    }
    if (effect.kind === 'tracer') {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(effect.position.x, effect.position.y, effect.position.z),
        new THREE.Vector3(
          effect.to?.x ?? effect.position.x,
          effect.to?.y ?? effect.position.y,
          effect.to?.z ?? effect.position.z,
        ),
      ]);
      const material = new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
      });
      const line = new THREE.Line(geometry, material);
      line.frustumCulled = false;
      return line;
    }
    if (effect.kind === 'shield') {
      // A thin billboarded ring. Geometry is per-effect so the shared pool can
      // keep disposing freely when the ripple expires.
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.74, 1, 44), material);
      ring.scale.setScalar(Math.max(2, effect.scale * 0.5));
      ring.frustumCulled = false;
      return ring;
    }
    // Smoke and flak are matter, not light: they must not be additive or they
    // read as glowing fog instead of a burning airframe and dirty shell bursts.
    const matte = MATTE_EFFECTS.has(effect.kind);
    const material = new THREE.SpriteMaterial({
      map: matte ? this.smokeTexture : this.glowTexture,
      color: matte
        ? effect.kind === 'flak'
          ? 0x3c3c42
          : effect.kind === 'vapour'
            ? 0xdff4ff
            : 0x2a2a2e
        : color,
      blending: matte && effect.kind !== 'vapour' ? THREE.NormalBlending : THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: effect.kind === 'explosion' ? 0.95 : 0.8,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.setScalar(Math.max(2, effect.scale * EFFECT_SCALE[effect.kind]));
    if (effect.kind === 'debris') {
      sprite.center.set(0.5, 0.5);
      material.rotation = effect.seed * Math.PI * 2;
    }
    return sprite;
  }

  private animateEffect(object: THREE.Object3D, effect: SimEffect, delta: number): void {
    const life = Math.max(0, effect.life);
    const progress = 1 - life / Math.max(0.001, effect.maxLife);
    object.position.set(effect.position.x, effect.position.y, effect.position.z);
    if (object.userData.beamShell) {
      // The beam keeps its own transform — it is aimed once and holds.
      const fade = Math.max(0, 1 - progress);
      const shell = object.userData.beamShell as THREE.MeshBasicMaterial;
      const core = object.userData.beamCore as THREE.MeshBasicMaterial;
      shell.opacity = fade ** 0.7 * 0.45 * (0.85 + Math.sin(this.elapsed * 52) * 0.15);
      core.opacity = fade ** 0.5 * (0.7 + Math.sin(this.elapsed * 61) * 0.3);
      return;
    }
    if (object instanceof THREE.Mesh) {
      // Shield ripple: a thin ring that races outward and dies fast.
      const material = object.material as THREE.MeshBasicMaterial;
      if (effect.kind === 'pulse') {
        object.scale.setScalar(Math.max(2, effect.scale * (0.25 + progress * 0.85)));
        material.opacity = Math.max(0, 1 - progress) ** 1.3 * 0.6;
        object.rotation.y += delta * 0.6;
        object.rotation.x += delta * 0.3;
        return;
      }
      object.scale.setScalar(Math.max(2, effect.scale * (0.5 + progress * 2.6)));
      material.opacity = Math.max(0, 1 - progress) ** 1.6 * 0.85;
      object.quaternion.copy(this.camera.quaternion);
      return;
    }
    if (object instanceof THREE.Sprite) {
      const material = object.material as THREE.SpriteMaterial;
      const base = EFFECT_SCALE[effect.kind];
      const expansion = EFFECT_EXPANSION[effect.kind];
      object.scale.setScalar(Math.max(1, effect.scale * base * (1 + progress * expansion)));
      const fade = Math.max(0, 1 - progress);
      material.opacity = effect.kind === 'spark' ? fade ** 0.7 : fade * 0.9;
      if (effect.spin !== 0) material.rotation += effect.spin * delta;
      return;
    }
    if (object instanceof THREE.Line) {
      const lineMaterial = object.material as THREE.LineBasicMaterial;
      lineMaterial.opacity = Math.max(0, 1 - progress);
    }
  }

  /* ------------------------------------------------------------------ */
  /* projection                                                          */
  /* ------------------------------------------------------------------ */

  private updateProjections(): void {
    this.camera.getWorldDirection(this.cameraForward);
    const forward = this.cameraForward;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);

    for (const entity of this.engine.getEntities()) {
      if (!entity.alive) continue;
      if (!['fighter', 'wingman', 'weakpoint'].includes(entity.kind)) continue;
      const point = this.tempVector.set(entity.position.x, entity.position.y, entity.position.z);
      const relative = point.clone().sub(this.camera.position);
      const behind = relative.dot(forward) <= 0;
      this.projected.copy(point).project(this.camera);
      let x = this.projected.x * 0.5 + 0.5;
      let y = -this.projected.y * 0.5 + 0.5;
      const onScreen = !behind && x >= 0.02 && x <= 0.98 && y >= 0.02 && y <= 0.98;
      if (!onScreen) {
        const horizontal = relative.dot(right);
        const vertical = relative.dot(up);
        const dirX = behind ? horizontal : this.projected.x;
        const dirY = behind ? vertical : -this.projected.y;
        const magnitude = Math.hypot(dirX, dirY) || 1;
        x = 0.5 + (dirX / magnitude) * 0.455;
        y = 0.5 - (dirY / magnitude) * 0.425;
      }
      const dist = relative.length();
      const scale = Math.min(2.2, Math.max(0.55, 1500 / Math.max(1, dist)));
      this.engine.setProjection(entity.id, { x, y, scale, onScreen });
    }
  }

  /* ------------------------------------------------------------------ */
  /* diagnostics                                                         */
  /* ------------------------------------------------------------------ */
  getDebugInfo(): Record<string, unknown> {
    const boss = this.engine.getBossEntity();
    const snapshot = this.engine.getSnapshot();
    const cameraDirection = this.camera.getWorldDirection(new THREE.Vector3());
    let bossAngle: number | null = null;
    if (boss) {
      const toBoss = new THREE.Vector3(
        boss.position.x - this.camera.position.x,
        boss.position.y - this.camera.position.y,
        boss.position.z - this.camera.position.z,
      ).normalize();
      bossAngle = THREE.MathUtils.radToDeg(toBoss.angleTo(cameraDirection));
    }
    return {
      phase: this.engine.phase,
      paused: this.engine.paused,
      meshes: this.entityMeshes.size,
      effects: this.effectObjects.size,
      sceneChildren: this.scene.children.length,
      bossAngle,
      entities: this.engine
        .getEntities()
        .filter((entity) => entity.alive)
        .map((entity) => ({
          id: entity.id,
          kind: entity.kind,
          mesh: this.entityMeshes.has(entity.id),
          position: [Math.round(entity.position.x), Math.round(entity.position.y), Math.round(entity.position.z)],
        })),
      targets: snapshot.targets.map((target) => ({
        callsign: target.callsign,
        screen: target.screen,
        distance: Math.round(target.distance),
      })),
      renderer: {
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        dpr: this.renderer.getPixelRatio(),
        size: this.renderer.getSize(new THREE.Vector2()).toArray(),
      },
      camera: {
        position: this.camera.position.toArray().map((value) => Math.round(value)),
        direction: cameraDirection.toArray(),
      },
    };
  }

  /* ------------------------------------------------------------------ */
  /* textures                                                            */
  /* ------------------------------------------------------------------ */

  private createGlowTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) {
      const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(255,255,255,1)');
      gradient.addColorStop(0.16, 'rgba(255,235,196,0.95)');
      gradient.addColorStop(0.4, 'rgba(255,154,84,0.45)');
      gradient.addColorStop(1, 'rgba(255,120,60,0)');
      context.fillStyle = gradient;
      context.fillRect(0, 0, 128, 128);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private createCloudTexture(): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, 256, 128);
      for (let index = 0; index < 22; index += 1) {
        const x = 30 + Math.random() * 196;
        const y = 45 + Math.random() * 42;
        const radius = 12 + Math.random() * 34;
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, 'rgba(255,236,216,0.34)');
        gradient.addColorStop(0.55, 'rgba(214,190,190,0.16)');
        gradient.addColorStop(1, 'rgba(160,140,150,0)');
        context.fillStyle = gradient;
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /**
   * Soft, slightly irregular puff used for damage smoke and flak bursts. Drawn
   * with normal blending and a light gust of noise so a trail does not read as
   * a row of identical circles.
   */
  private createSmokeTexture(): THREE.Texture {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (context) {
      context.clearRect(0, 0, size, size);
      for (let index = 0; index < 7; index += 1) {
        const x = size / 2 + randomBetween(-16, 16);
        const y = size / 2 + randomBetween(-16, 16);
        const radius = randomBetween(20, 44);
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, 'rgba(255,255,255,0.5)');
        gradient.addColorStop(0.5, 'rgba(255,255,255,0.22)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient;
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }
}
