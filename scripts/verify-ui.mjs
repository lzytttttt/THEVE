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

  await page.goto(`${target}#/systems`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.systems');
  await page.waitForTimeout(900);
  await shot('08-systems-1920', { fullPage: true });

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

  console.log(JSON.stringify({ consoleErrors, pageErrors, muteBefore, muteAfter }, null, 2));
  if (consoleErrors.length || pageErrors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
