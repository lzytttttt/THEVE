import * as THREE from 'three';
import type { CockpitEngine } from '../sim/engine';
import type { CockpitQuality } from '../sim/CockpitProvider';
import { enemyProfile } from '../sim/enemies';
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
const MATTE_EFFECTS = new Set(['smoke', 'flak']);

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
    // the light count never changes — adding or removing a light would force
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

    const euler = new THREE.Euler(
      flight.pitch + shakeX + this.impulse.x * jolt,
      flight.yaw + shakeY + this.impulse.y * jolt,
      flight.roll + shakeZ + this.impulse.z * jolt,
      'YXZ',
    );
    this.camera.quaternion.setFromEuler(euler);
    this.camera.position.set(flight.position.x, flight.position.y, flight.position.z);
    this.camera.updateMatrixWorld();
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
   * Wounded aircraft bleed smoke. The sim never emits these — they are a pure
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
    this.camera.fov = width / height < 1.1 ? 78 : 70;
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
    context.fillText('S/N 08-1130 · CIRRUS TFS', 300, 56);
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
    context.fillText('FCS · IFF · LINK 08', 26, 86);
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

  private createDreadnought(): THREE.Group {
    const group = new THREE.Group();
    const hullMaterial = new THREE.MeshStandardMaterial({
      color: 0x3b4d58,
      metalness: 0.62,
      roughness: 0.44,
      emissive: 0x162730,
      emissiveIntensity: 1.1,
    });
    const darkMaterial = new THREE.MeshStandardMaterial({
      color: 0x1f2b34,
      metalness: 0.5,
      roughness: 0.6,
      emissive: 0x0a1319,
      emissiveIntensity: 0.65,
    });
    const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xffb547 });
    const redMaterial = new THREE.MeshBasicMaterial({ color: 0xff4d5a });
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xa9ced6,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
    });

    const hull = new THREE.Mesh(new THREE.BoxGeometry(430, 46, 210), hullMaterial);
    group.add(hull);
    const hullEdges = new THREE.LineSegments(new THREE.EdgesGeometry(hull.geometry, 22), edgeMaterial);
    hull.add(hullEdges);
    const lowerHull = new THREE.Mesh(new THREE.BoxGeometry(320, 32, 150), darkMaterial);
    lowerHull.position.y = -34;
    group.add(lowerHull);
    const lowerEdges = new THREE.LineSegments(new THREE.EdgesGeometry(lowerHull.geometry, 22), edgeMaterial);
    lowerHull.add(lowerEdges);
    const prow = new THREE.Mesh(new THREE.ConeGeometry(64, 190, 4), hullMaterial);
    prow.rotation.x = -Math.PI / 2;
    prow.rotation.z = Math.PI / 4;
    prow.position.set(0, 0, -195);
    prow.scale.x = 1.9;
    group.add(prow);
    const prowLight = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xff8a4d,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.5,
      }),
    );
    prowLight.position.set(0, -4, -280);
    prowLight.scale.set(120, 80, 1);
    group.add(prowLight);

    const spine = new THREE.Mesh(new THREE.BoxGeometry(150, 68, 270), hullMaterial);
    spine.position.set(0, 30, 30);
    group.add(spine);
    const spineEdges = new THREE.LineSegments(new THREE.EdgesGeometry(spine.geometry, 22), edgeMaterial);
    spine.add(spineEdges);

    const forwardTower = new THREE.Mesh(new THREE.BoxGeometry(70, 58, 90), hullMaterial);
    forwardTower.position.set(0, 52, -82);
    group.add(forwardTower);
    const forwardTowerEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(forwardTower.geometry, 22),
      edgeMaterial,
    );
    forwardTower.add(forwardTowerEdges);
    const forwardWindows = new THREE.Mesh(new THREE.BoxGeometry(52, 3, 2), windowMaterial);
    forwardWindows.position.set(0, 58, -128);
    group.add(forwardWindows);
    for (const side of [-1, 1]) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(10, 26, 10), darkMaterial);
      pylon.position.set(side * 45, 90, -82);
      group.add(pylon);
    }

    const hangarGlow = new THREE.Mesh(
      new THREE.BoxGeometry(180, 4, 120),
      new THREE.MeshBasicMaterial({
        color: 0xff9b55,
        transparent: true,
        opacity: 0.58,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    hangarGlow.position.set(0, -46, -25);
    group.add(hangarGlow);

    for (const side of [-1, 1]) {
      const leadingLight = new THREE.Mesh(
        new THREE.BoxGeometry(320, 2.4, 7),
        new THREE.MeshBasicMaterial({
          color: 0xffb26a,
          transparent: true,
          opacity: 0.82,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      leadingLight.position.set(side * 190, -7, -60);
      group.add(leadingLight);
      const undersideStrip = new THREE.Mesh(
        new THREE.BoxGeometry(280, 1.8, 3),
        new THREE.MeshBasicMaterial({
          color: 0x63f3ff,
          transparent: true,
          opacity: 0.52,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      undersideStrip.position.set(side * 270, -18, -100);
      group.add(undersideStrip);
      const wingtipFin = new THREE.Mesh(new THREE.BoxGeometry(12, 56, 140), hullMaterial);
      wingtipFin.position.set(side * 350, 28, 55);
      group.add(wingtipFin);
      const finEdges = new THREE.LineSegments(
        new THREE.EdgesGeometry(wingtipFin.geometry, 22),
        edgeMaterial,
      );
      wingtipFin.add(finEdges);
      for (let index = 0; index < 12; index += 1) {
        const light = new THREE.Mesh(new THREE.BoxGeometry(5, 1.8, 1.8), windowMaterial);
        light.position.set(side * (60 + index * 24), -10, -56);
        group.add(light);
      }
    }

    for (const x of [-300, -170, 170, 300]) {
      const turret = new THREE.Mesh(new THREE.BoxGeometry(34, 20, 34), darkMaterial);
      turret.position.set(x, -44, -55);
      group.add(turret);
      const turretLight = new THREE.Mesh(new THREE.SphereGeometry(2.4, 6, 6), redMaterial);
      turretLight.position.set(x, -56, -55);
      group.add(turretLight);
    }

    const coreLight = new THREE.PointLight(0xffa66a, 2.4, 1800, 2);
    coreLight.position.set(0, 80, -300);
    group.add(coreLight);

    const topMast = new THREE.Mesh(new THREE.BoxGeometry(8, 90, 8), darkMaterial);
    topMast.position.set(0, 135, 30);
    group.add(topMast);
    const mastBeacon = new THREE.Mesh(new THREE.SphereGeometry(6, 8, 8), redMaterial);
    mastBeacon.position.set(0, 182, 30);
    group.add(mastBeacon);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(760, 9, 96), hullMaterial);
    wing.position.set(0, -3, 30);
    group.add(wing);
    const wingEdges = new THREE.LineSegments(new THREE.EdgesGeometry(wing.geometry, 22), edgeMaterial);
    wing.add(wingEdges);
    for (const side of [-1, 1]) {
      const pod = new THREE.Mesh(new THREE.BoxGeometry(58, 30, 170), darkMaterial);
      pod.position.set(side * 260, -14, 15);
      group.add(pod);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(62, 54, 90), hullMaterial);
      tower.position.set(side * 112, 48, 22);
      group.add(tower);
      const towerEdges = new THREE.LineSegments(new THREE.EdgesGeometry(tower.geometry, 22), edgeMaterial);
      tower.add(towerEdges);
      const mast = new THREE.Mesh(new THREE.BoxGeometry(2, 70, 2), darkMaterial);
      mast.position.set(side * 112, 105, 22);
      group.add(mast);
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(5.5, 8, 8), redMaterial);
      beacon.position.set(side * 148, 80, 10);
      group.add(beacon);
      const wingBeacon = new THREE.Mesh(new THREE.SphereGeometry(4, 6, 6), redMaterial);
      wingBeacon.position.set(side * 360, 0, 30);
      group.add(wingBeacon);
      for (let index = 0; index < 7; index += 1) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(18, 2.2, 1.4), windowMaterial);
        window.position.set(side * (40 + index * 34), 5, side > 0 ? 106 : -106);
        group.add(window);
      }
    }

    const undersideGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: this.glowTexture,
        color: 0xff9a5e,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.35,
      }),
    );
    undersideGlow.position.set(0, -46, 20);
    undersideGlow.scale.set(620, 220, 1);
    undersideGlow.material.opacity = 0.48;
    group.add(undersideGlow);

    const bridge = new THREE.Mesh(new THREE.BoxGeometry(88, 32, 60), hullMaterial);
    bridge.position.set(0, 62, 25);
    group.add(bridge);
    const bridgeEdges = new THREE.LineSegments(new THREE.EdgesGeometry(bridge.geometry, 22), edgeMaterial);
    bridge.add(bridgeEdges);
    const bridgeWindows = new THREE.Mesh(new THREE.BoxGeometry(66, 4, 2), windowMaterial);
    bridgeWindows.position.set(0, 66, -6);
    group.add(bridgeWindows);

    const radar = new THREE.Group();
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(26, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({
        color: 0x1d2c36,
        metalness: 0.6,
        roughness: 0.4,
        side: THREE.DoubleSide,
      }),
    );
    dish.rotation.x = Math.PI / 2;
    radar.add(dish);
    radar.position.set(0, 88, 30);
    group.add(radar);
    group.userData.radar = radar;

    const glowMaterial = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0x63f3ff,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 0.6,
    });
    for (const x of [-140, -45, 45, 140]) {
      const glow = new THREE.Sprite(glowMaterial);
      glow.position.set(x, -8, 130);
      glow.scale.set(34, 34, 1);
      group.add(glow);
    }

    group.scale.setScalar(2);
    return group;
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

  private createFlare(): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.SpriteMaterial({
      map: this.glowTexture,
      color: 0xffc06a,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      opacity: 1,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(55, 55, 1);
    group.add(sprite);
    group.userData.flare = material;
    return group;
  }

  private updateEntityMesh(group: THREE.Group, entity: SimEntity, delta: number): void {
    group.position.set(entity.position.x, entity.position.y, entity.position.z);
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
      const radar = group.userData.radar as THREE.Group | undefined;
      if (radar) radar.rotation.y += delta * 0.22;
      group.position.y += Math.sin(time * 0.4) * 0.6;
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
      const material = group.userData.flare as THREE.SpriteMaterial | undefined;
      if (material) material.opacity = Math.max(0, entity.life / Math.max(0.001, entity.maxLife));
      group.scale.setScalar(0.6 + Math.random() * 0.5);
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
      color: matte ? (effect.kind === 'flak' ? 0x3c3c42 : 0x2a2a2e) : color,
      blending: matte ? THREE.NormalBlending : THREE.AdditiveBlending,
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
    if (object instanceof THREE.Mesh) {
      // Shield ripple: a thin ring that races outward and dies fast.
      const material = object.material as THREE.MeshBasicMaterial;
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
