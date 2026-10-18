import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const target = process.env.PREVIEW_URL ?? 'http://127.0.0.1:5173/';
const outDir = resolve('docs/screenshots');
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const consoleErrors = [];
const pageErrors = [];
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => pageErrors.push(String(error)));

async function shot(name, options = {}) {
  const path = resolve(outDir, `${name}.png`);
  await page.screenshot({ path, ...options });
  console.log(`saved ${name}`);
}

async function openCockpit() {
  await page.goto(`${target}#/cockpit`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__THEVE__) && Boolean(window.__THEVE_SCENE__), null, {
    timeout: 20000,
  });
  await page.waitForTimeout(700);
}

async function startMission({ skip = true } = {}) {
  await page.getByRole('button', { name: /升空/ }).click();
  await page.waitForTimeout(600);
  if (skip) {
    await page.evaluate(() => window.__THEVE__?.skipBoot());
    await page.waitForTimeout(1600);
  }
}

try {
  await page.goto(target, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await shot('00-attract-1920');

  await openCockpit();
  await shot('01-briefing-1920');
  await startMission({ skip: false });
  await shot('02-boot-1920');
  await page.evaluate(() => window.__THEVE__?.skipBoot());
  await page.waitForTimeout(1500);
  await shot('03-dogfight-1920');

  // v0.2 handling: the held manoeuvre and the first-flight checklist.
  await page.evaluate(() => {
    const engine = window.__THEVE__.engine;
    engine.setThrottle(0.95);
  });
  await page.waitForTimeout(1400);
  await page.keyboard.down('c');
  await page.keyboard.down('s');
  await page.waitForTimeout(900);
  await shot('03b-highg-turn-1920');
  await page.keyboard.up('s');
  await page.keyboard.up('c');
  await page.waitForTimeout(400);

  await page.keyboard.press('z');
  await page.waitForTimeout(700);
  await shot('03c-cobra-1920');
  await page.waitForTimeout(1600);

  await page.keyboard.press('y');
  await page.waitForTimeout(400);
  const assistOff = await page.evaluate(
    () => window.__THEVE__?.snapshot().assist.master === false,
  );
  console.log('assist master toggled off via Y:', assistOff);
  await page.keyboard.press('y');
  await page.waitForTimeout(300);

  // --- v0.3 impact: a gun run on a target pinned dead ahead ---------------
  // The marker only lives 0.42 s, so the target is held in the gun cone from a
  // rAF loop rather than hoping the AI cooperates with the screenshot timing.
  await page.evaluate(() => {
    const engine = window.__THEVE__.engine;
    const hostile = engine
      .getEntities()
      .find((entity) => entity.alive && entity.kind === 'fighter' && entity.team === 'hostile');
    if (!hostile) return;
    hostile.maxHp = 9000;
    hostile.hp = 9000;
    window.__PIN__ = { id: hostile.id, distance: 620 };
    const pin = () => {
      const state = window.__PIN__;
      const target = state
        ? window.__THEVE__?.engine.getEntities().find((entity) => entity.id === state.id)
        : null;
      const flight = window.__THEVE__?.engine.flight;
      if (state && target?.alive && flight) {
        const cosPitch = Math.cos(flight.pitch);
        const forward = {
          x: -Math.sin(flight.yaw) * cosPitch,
          y: Math.sin(flight.pitch),
          z: -Math.cos(flight.yaw) * cosPitch,
        };
        target.position = {
          x: flight.position.x + forward.x * state.distance,
          y: flight.position.y + forward.y * state.distance,
          z: flight.position.z + forward.z * state.distance,
        };
        target.yaw = flight.yaw;
        target.pitch = flight.pitch;
        target.speed = flight.speed;
      }
      requestAnimationFrame(pin);
    };
    requestAnimationFrame(pin);
  });

  await page.keyboard.down('j');
  await page.waitForTimeout(800);
  await shot('14-hit-confirm-1920');
  await page.keyboard.up('j');
  await page.waitForTimeout(120);

  // --- v0.3 impact: the killing burst and the splash ticker ---------------
  await page.evaluate(() => {
    const engine = window.__THEVE__.engine;
    const target = engine.getEntities().find((entity) => entity.id === window.__PIN__?.id);
    if (target) target.hp = 14;
  });
  await page.keyboard.down('j');
  await page.waitForTimeout(420);
  await page.keyboard.up('j');
  await page.waitForTimeout(180);
  await shot('15-splash-1920');

  // --- v0.3 impact: damage bearings ---------------------------------------
  await page.evaluate(() => {
    const engine = window.__THEVE__.engine;
    const flight = engine.flight;
    const right = { x: Math.cos(flight.yaw), y: 0, z: -Math.sin(flight.yaw) };
    engine.damagePlayer(14, {
      x: flight.position.x + right.x * 320,
      y: flight.position.y + 40,
      z: flight.position.z + right.z * 320,
    });
    engine.damagePlayer(9, {
      x: flight.position.x - right.x * 320,
      y: flight.position.y - 30,
      z: flight.position.z - right.z * 320,
    });
  });
  await page.waitForTimeout(320);
  await shot('16-damage-bearing-1920');
  await page.evaluate(() => {
    window.__PIN__ = null;
    window.__THEVE__.engine.flight.hp = 82;
  });
  await page.waitForTimeout(200);

  await page.evaluate(() => window.__THEVE__?.triggerBoss());
  await page.waitForTimeout(1400);
  await shot('04-boss-1920');

  /* ------------------------------------------------------------------ */
  /* v0.5 — the third-person camera, the boss attack telegraph, flares   */
  /* ------------------------------------------------------------------ */
  // The camera is a first-class control now, so the smoke test drives it both
  // ways and screenshots the outside view.
  await page.evaluate(() => window.__THEVE__?.view('chase'));
  await page.waitForTimeout(1200);
  const chaseView = await page.evaluate(() => window.__THEVE__?.view());
  console.log('view after toggle:', chaseView);
  await shot('23-chase-view-1920');

  // A scripted manoeuvre from outside: the boom pulls back and the wingtip
  // vapour comes out, which is the whole reason the outside camera exists.
  await page.keyboard.press('v');
  await page.waitForTimeout(760);
  await shot('24-chase-manoeuvre-1920');
  await page.waitForTimeout(2200);

  // The flare salvo, caught on the way out of the dispenser. The outside camera
  // sits dead astern, so the cloud reads as a bloom around the tail — which is
  // exactly how a countermeasure looks from the aircraft that dropped it.
  await page.evaluate(() => {
    const engine = window.__THEVE__.engine;
    engine.flight.roll = 0.6;
    engine.flight.pitch = 0.06;
  });
  await page.waitForTimeout(260);
  await page.evaluate(() => window.__THEVE__?.engine.flare());
  await page.waitForTimeout(280);
  await shot('25-flare-salvo-1920');

  // Park off the dreadnought's bow quarter: the shield dome, the closed reactor
  // maw and the two outrigger nodes are the v0.5 model read.
  await page.evaluate(() => {
    const engine = window.__THEVE__.engine;
    const boss = engine.getBossEntity();
    if (!boss) return;
    const forward = { x: -Math.sin(boss.yaw), y: 0, z: -Math.cos(boss.yaw) };
    engine.flight.position = {
      x: boss.position.x + forward.x * 1000,
      y: boss.position.y + 220,
      z: boss.position.z + forward.z * 1000,
    };
    engine.flight.yaw = boss.yaw + Math.PI;
    engine.flight.pitch = -0.14;
    engine.flight.roll = 0;
    engine.flight.speed = 180;
    engine.setThrottle(0.5);
    engine.flight.hp = 100;
  });
  await page.waitForTimeout(1100);
  await shot('26-boss-shielded-1920');

  // Force the exposed stage and wait for the spinal lance to telegraph: the
  // attack banner, the countdown and the counter hint are the fight's read.
  const lance = await page.evaluate(() => {
    const api = window.__THEVE__;
    if (!api) return null;
    const engine = api.engine;
    for (const entity of engine.getEntities()) {
      if (entity.kind === 'weakpoint' && entity.weakpoint?.key !== 'core') {
        engine.destroyWeakpoint(entity);
      }
    }
    for (let index = 0; index < 4000; index += 1) {
      const snapshot = api.step(0.05);
      engine.flight.hp = 100;
      const attack = snapshot.boss?.attack;
      if (attack?.id === 'lance' && attack.phase === 'telegraph' && attack.progress > 0.55) {
        return { code: attack.code, phase: attack.phase, counter: attack.counterZh };
      }
      if (attack?.id === 'lance' && attack.phase === 'active') {
        return { code: attack.code, phase: attack.phase, counter: attack.counterZh };
      }
    }
    return null;
  });
  // Reframe onto the dreadnought's beam so the telegraph, the charging lance and
  // the ship are all in one shot. The charge runs for three seconds, so there is
  // plenty of time left when the reposition lands.
  await page.evaluate(() => {
    const engine = window.__THEVE__.engine;
    const boss = engine.getBossEntity();
    if (!boss) return;
    const forward = { x: -Math.sin(boss.yaw), y: 0, z: -Math.cos(boss.yaw) };
    const right = { x: Math.cos(boss.yaw), y: 0, z: -Math.sin(boss.yaw) };
    engine.flight.position = {
      x: boss.position.x + forward.x * 1500 + right.x * 420,
      y: boss.position.y + 150,
      z: boss.position.z + forward.z * 1500 + right.z * 420,
    };
    engine.flight.yaw = Math.atan2(
      -(boss.position.x - engine.flight.position.x),
      -(boss.position.z - engine.flight.position.z),
    );
    engine.flight.pitch = -0.05;
    engine.flight.roll = 0;
    engine.flight.speed = 170;
    engine.setThrottle(0.45);
    engine.flight.hp = 100;
  });
  await page.waitForTimeout(180);
  await shot('27-boss-lance-1920');
  console.log('lance telegraph captured:', JSON.stringify(lance));

  await page.evaluate(() => window.__THEVE__?.view('cockpit'));
  await page.waitForTimeout(500);

  await page.getByRole('button', { name: '暂停' }).click();
  await page.waitForTimeout(450);
  await shot('05-pause-1920');
  await page.getByRole('button', { name: /继续飞行/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '操作帮助' }).click();
  await page.waitForTimeout(300);
  await shot('06-help-1920');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  const muteBefore = await page.evaluate(() => document.body.innerText.includes('MUTED'));
  await page.getByRole('button', { name: '静音' }).first().click();
  await page.waitForTimeout(400);
  const muteAfter = await page.evaluate(() => document.body.innerText.includes('MUTED'));
  console.log(`mute state ${muteBefore} -> ${muteAfter}`);
  await page.getByRole('button', { name: '取消静音' }).first().click();

  await page.evaluate(() => {
    const engine = window.__THEVE__.engine;
    engine.stats.missilesFired = 5;
    engine.stats.missilesHit = 5;
    engine.stats.kills = 2;
    engine.stats.damageTaken = 23;
    engine.flight.hp = 77;
    const weakpoints = engine.getEntities().filter((entity) => entity.kind === 'weakpoint');
    for (const weakpoint of weakpoints) engine.destroyWeakpoint(weakpoint);
  });
  await page.waitForTimeout(5500);
  console.log('debrief phase', await page.evaluate(() => window.__THEVE__?.phase()));
  await shot('07-debrief-1920');

  /* ------------------------------------------------------------------ */
  /* v0.4 — the wave stage and AUTO ACE                                  */
  /* ------------------------------------------------------------------ */
  // Reload the cockpit from scratch. The sortie above already ended, and a
  // hash-only navigation would leave the finished mission — and its debrief —
  // on screen for every v0.4 shot.
  await page.goto(target, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await openCockpit();
  await shot('17-auto-ace-briefing-1920');

  // One key. No other input from here on.
  await page.evaluate(() => window.__THEVE__?.autoAce(true));
  await page.waitForTimeout(3400);
  const engaged = await page.evaluate(() => window.__THEVE__?.snapshot().auto.engaged);
  console.log('auto ace engaged:', engaged);
  await shot('18-auto-ace-engage-1920');

  /**
   * Advance the simulation headlessly instead of waiting on rAF. It keeps the
   * screenshots deterministic and lets one run reach a wave change and a
   * showcase manoeuvre inside a few seconds of wall clock.
   */
  const waveShot = await page.evaluate(() => {
    const api = window.__THEVE__;
    if (!api) return null;
    for (let index = 0; index < 600; index += 1) {
      const snapshot = api.step(0.08);
      // Stop at the first reinforcement, not the last: the showcase search
      // below needs a live mission to find a quiet moment in.
      if (snapshot.wave.inbound && snapshot.wave.index >= 2) {
        return { code: snapshot.wave.code, hostiles: snapshot.wave.hostiles, at: snapshot.elapsed };
      }
    }
    return null;
  });
  await page.waitForTimeout(500);
  await shot('19-wave-inbound-1920');
  console.log('wave inbound captured:', JSON.stringify(waveShot));

  const showcase = await page.evaluate(() => {
    const api = window.__THEVE__;
    if (!api) return null;
    // No bail-out on `failed`: AUTO ACE relaunches itself after a shoot-down, so
    // the next attempt is another chance at a quiet moment. Only a mission
    // complete ends the search.
    for (let index = 0; index < 4000; index += 1) {
      const snapshot = api.step(0.05);
      if (
        snapshot.auto.mode === 'showcase' &&
        snapshot.auto.progress > 0.2 &&
        snapshot.auto.progress < 0.85
      ) {
        return { callout: snapshot.auto.callout, code: snapshot.auto.code, at: snapshot.elapsed };
      }
      if (snapshot.phase === 'complete') break;
    }
    return null;
  });
  await page.waitForTimeout(220);
  await shot('20-auto-ace-showcase-1920');
  console.log('showcase captured:', JSON.stringify(showcase));

  const autoReport = await page.evaluate(() => {
    const snapshot = window.__THEVE__?.snapshot();
    if (!snapshot) return null;
    return {
      phase: snapshot.phase,
      mode: snapshot.auto.mode,
      demonstrated: snapshot.auto.demonstrated,
      plays: snapshot.auto.plays,
      kills: snapshot.mission.kills,
      hostiles: snapshot.wave.hostiles,
      roster: snapshot.wave.roster.map((entry) => `${entry.code}:${entry.down}/${entry.total}`),
      score: snapshot.mission.score,
    };
  });
  console.log('auto ace progress:', JSON.stringify(autoReport));
  await shot('21-auto-ace-rail-1920');

  await page.goto(`${target}#/systems`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.systems');
  await page.waitForTimeout(900);
  await shot('08-systems-1920', { fullPage: true });

  // v0.4 codex section: the threat database and the AUTO ACE card.
  const stageSection = await page.$('#systems-04b');
  if (stageSection) {
    await stageSection.screenshot({ path: resolve(outDir, '22-systems-stage-1920.png') });
    console.log('saved 22-systems-stage-1920');
  }

  await page.setViewportSize({ width: 1366, height: 768 });
  await openCockpit();
  await startMission();
  await shot('09-dogfight-1366');

  await page.setViewportSize({ width: 390, height: 844 });
  await openCockpit();
  await shot('10-cockpit-390');

  await page.goto(target, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await shot('11-attract-390');

  await page.setViewportSize({ width: 844, height: 390 });
  await openCockpit();
  await startMission();
  await shot('12-cockpit-landscape');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${target}#/systems`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.systems');
  await page.waitForTimeout(600);
  await shot('13-systems-390');

  console.log(JSON.stringify({ consoleErrors, pageErrors, muteBefore, muteAfter, chaseView, lance }, null, 2));
  if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
