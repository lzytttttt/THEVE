import { useState } from 'react';
import {
  AltitudeTape,
  BossBar,
  Button,
  CommsFeed,
  Divider,
  HazardStripe,
  HeadingTape,
  IconArrowRight,
  IconBolt,
  IconCheck,
  IconFlame,
  IconLock,
  IconMissile,
  IconPlane,
  IconRadar,
  IconScan,
  IconShield,
  IconSoundOn,
  IconTarget,
  IconWarning,
  Keycap,
  LockReticle,
  Meter,
  MissileWarning,
  Panel,
  PitchLadder,
  RadarScope,
  Readout,
  SpeedTape,
  StatusLamp,
  Tag,
  Toggle,
  WeaponRack,
  WingmanStatus,
  formatClock,
  SCORE_SECTIONS,
  SECTION_ORDER,
  AutoPilotButtonView,
  AutoPilotRailView,
  ENEMIES,
  ENEMY_ORDER,
  type AutoPilotHud,
  type BossHud,
  type CommsMessage,
  type HudTarget,
  type LockState,
  type RadarContact,
  type WarningState,
  type WingmanHud,
} from '@theve/ui';
import { Brand } from '../brand';
import type { Route } from '../App';

const PALETTE = [
  ['--tv-void', '#04070C', '座舱底 / 页面底'],
  ['--tv-deep', '#07131D', '面板底'],
  ['--tv-panel', 'rgba(8,22,32,.82)', '玻璃仪表板'],
  ['--tv-cyan', '#63F3FF', '主 HUD / 可操作'],
  ['--tv-cyan-dim', '#2C8E9E', '刻度 / 次级数据'],
  ['--tv-ice', '#E8F8FC', '主数据文字'],
  ['--tv-mute', '#86A3AE', '次级文字'],
  ['--tv-amber', '#FFB547', '锁定 / 注意'],
  ['--tv-red', '#FF4D5A', '敌机 / 告警'],
  ['--tv-green', '#74FFB0', '友军 / 僚机'],
  ['--tv-sun', '#FF7A3D', '地平线 / 落日'],
  ['--tv-line', 'rgba(99,243,255,.22)', '分隔线 / 刻度'],
];

const SECTIONS = [
  ['01', 'Foundation', '基础系统'],
  ['02', 'HUD Language', 'HUD 语言'],
  ['03', 'Components', '组件'],
  ['04', 'Flight Systems', '飞行系统'],
  ['05', 'Interaction', '交互与可访问性'],
  ['06', 'Sound & Motion', '声音与动效'],
  ['07', 'Implementation', '实现'],
];

const RADAR_CONTACTS: RadarContact[] = [
  { id: 'vesper-1', x: 0.14, y: -0.56, team: 'hostile', kind: 'fighter', selected: false },
  { id: 'vesper-2', x: 0.34, y: -0.3, team: 'hostile', kind: 'fighter', selected: true },
  { id: 'vesper-ace', x: -0.42, y: -0.16, team: 'hostile', kind: 'fighter', selected: false },
  { id: 'wingman', x: 0.2, y: 0.06, team: 'ally', kind: 'wingman', selected: false },
  { id: 'leviathan-shield', x: -0.56, y: -0.66, team: 'hostile', kind: 'weakpoint', selected: false },
];

const SAMPLE_TARGET: HudTarget = {
  id: 'vesper-2',
  callsign: 'VESPER 2',
  label: 'HOSTILE FIGHTER',
  kind: 'fighter',
  team: 'hostile',
  variant: 'standard',
  enemyId: 'interceptor',
  distance: 1240,
  hp: 100,
  maxHp: 100,
  angle: 6,
  selected: true,
  locked: true,
  lockProgress: 1,
  lockable: true,
  priority: 1,
  screen: { x: 0.64, y: 0.42, scale: 1, onScreen: true },
};

const SAMPLE_LOCK: LockState = {
  targetId: 'vesper-2',
  callsign: 'VESPER 2',
  progress: 1,
  state: 'locked',
  distance: 1240,
  inCone: true,
  steering: 0,
  elevation: 0,
  assisted: false,
  jammed: false,
};

/** v0.4: a mid-showcase snapshot for the AUTO ACE documentation card. */
const SAMPLE_AUTO: AutoPilotHud = {
  engaged: true,
  mode: 'showcase',
  code: 'SHOW',
  labelEn: 'SHOWCASE',
  labelZh: '机动展示',
  callout: '库尔比特反转',
  progress: 0.46,
  demonstrated: 6,
  total: 7,
  plays: 9,
  condition: 0.72,
  targetCallsign: 'VESPER ACE',
  retryIn: null,
  shown: ['highG', 'barrelRoll', 'splitS', 'immelmann', 'airbrake', 'cobra'],
};

const SAMPLE_BOSS: BossHud = {
  id: 'leviathan',
  callsign: 'LEVIATHAN',
  nameEn: 'AERIAL DREADNOUGHT LEVIATHAN',
  nameZh: '空中无畏舰 · 利维坦',
  hp: 340,
  maxHp: 600,
  stage: 2,
  stageLabel: '护盾破损',
  stageCode: 'BREACHED',
  distance: 1840,
  tooClose: false,
  nextIn: null,
  attack: {
    id: 'lance',
    code: 'LANCE',
    labelEn: 'SPINAL LANCE',
    labelZh: '主炮照射',
    counterEn: 'Leave the gun axis — barrel roll or high-G turn',
    counterZh: '横向脱离炮轴 — 桶滚或高G急转',
    counterCode: 'BAR',
    phase: 'telegraph',
    progress: 0.62,
    remaining: 1.1,
    severity: 'critical',
    uses: 2,
  },
  weakpoints: [
    { key: 'shieldL', label: 'SHIELD NODE A', hp: 0, maxHp: 120, destroyed: true, targetable: false },
    { key: 'shieldR', label: 'SHIELD NODE B', hp: 120, maxHp: 120, destroyed: false, targetable: true },
    { key: 'core', label: 'REACTOR CORE', hp: 220, maxHp: 360, destroyed: false, targetable: false },
  ],
};

const SAMPLE_COMMS: CommsMessage[] = [
  {
    id: 'c1',
    at: 12,
    from: 'SENTINEL',
    role: 'awacs',
    text: 'LUMEN 1，VESPER 编队出现在十二点方向。交战规则：自由开火。',
  },
  {
    id: 'c2',
    at: 21,
    from: 'LUMEN 2',
    role: 'wingman',
    text: '咬住了！队长，Fox Two！',
  },
  {
    id: 'c3',
    at: 34,
    from: 'SENTINEL',
    role: 'awacs',
    text: '警告！巨型空中目标进入战区 — 识别为 LEVIATHAN。',
  },
];

const SAMPLE_WINGMAN: WingmanHud = {
  id: 'wingman-1',
  callsign: 'LUMEN 2',
  state: '交战 / ENGAGED',
  hp: 100,
  maxHp: 100,
  kills: 0,
  distance: 380,
};

const SAMPLE_WARNING: WarningState = {
  id: 'warn-1',
  kind: 'missile',
  severity: 'critical',
  message: 'MISSILE ALERT',
  detail: '导弹来袭 — F 释放热焰弹',
  direction: 38,
  expiresAt: 99,
};

const CODE = `import { CockpitProvider, CockpitHud, CockpitControls } from '@theve/ui';
import { CockpitViewport } from '@theve/ui/three';
import '@theve/ui/styles.css';

export function Sortie() {
  return (
    <CockpitProvider audio>
      <CockpitViewport />
      <CockpitHud />
      <CockpitControls />
    </CockpitProvider>
  );
}`;

export interface SystemsPageProps {
  onNavigate: (route: Route) => void;
}

export function SystemsPage({ onNavigate }: SystemsPageProps) {
  const [toggleA, setToggleA] = useState(true);
  const [toggleB, setToggleB] = useState(false);
  const [weapon, setWeapon] = useState<'aam' | 'gun'>('aam');
  const [volume, setVolume] = useState(64);

  return (
    <div className="systems" id="main-content">
      <header className="systems-head">
        <Brand />
        <nav className="systems-head__nav" aria-label="主导航">
          <a href="#/">
            <span>00</span> ATTRACT
          </a>
          <a href="#/cockpit">
            <span>01</span> COCKPIT
          </a>
          <a href="#/systems" className="is-active" aria-current="page">
            <span>02</span> SYSTEMS
          </a>
        </nav>
        <div className="systems-head__meta">
          <span className="systems-head__build tv-mono">V0.5.0 / TACS-8</span>
          <Button variant="primary" kbd="↗" onClick={() => onNavigate('cockpit')}>
            进入座舱
          </Button>
        </div>
      </header>

      <main className="systems-main">
        <section className="systems-hero" aria-labelledby="systems-title">
          <div className="systems-hero__copy">
            <span className="tv-eyebrow">LIVING DESIGN SYSTEM / TACTICAL AVIONICS</span>
            <h1 id="systems-title" className="systems-hero__title">
              SYSTEMS<span>/</span>
            </h1>
            <h2 className="systems-hero__subtitle">座舱航电系统图鉴</h2>
            <p className="systems-hero__lede">
              TACS-8 把电影化空战的第一人称座舱拆解成可组合的 React 组件：
              一边是近黑金属、切角与磷光刻度，一边是 three.js 的天空、云海与目标投影。
              所有数据共用同一套令牌，所有声音由 WebAudio 实时合成。
            </p>
            <div className="systems-hero__actions">
              <Button variant="primary" size="lg" icon={<IconArrowRight size={15} />} onClick={() => onNavigate('cockpit')}>
                启动任务 / LAUNCH
              </Button>
              <Button variant="ghost" size="lg" icon={<IconRadar size={15} />} onClick={() => onNavigate('attract')}>
                返回开场
              </Button>
            </div>
            <div className="systems-hero__meta tv-mono">
              <span>30+ COMPONENTS</span>
              <span>3 ENTRY POINTS</span>
              <span>0 RUNTIME DEPS</span>
              <span>WEBGL + WEBAUDIO</span>
            </div>
          </div>

          <div className="systems-specimen" aria-hidden="true">
            <div className="systems-specimen__top">
              <span className="tv-mono">SPECIMEN 08</span>
              <span className="tv-mono systems-specimen__live">
                <i /> LIVE
              </span>
            </div>
            <div className="systems-orbit">
              <span className="systems-orbit__ring systems-orbit__ring--a" />
              <span className="systems-orbit__ring systems-orbit__ring--b" />
              <span className="systems-orbit__ring systems-orbit__ring--c" />
              <span className="systems-orbit__cross systems-orbit__cross--x" />
              <span className="systems-orbit__cross systems-orbit__cross--y" />
              <span className="systems-orbit__core">
                <IconLock size={22} />
                <b>08</b>
              </span>
              <span className="systems-orbit__tag systems-orbit__tag--a tv-mono">IFF / LINK</span>
              <span className="systems-orbit__tag systems-orbit__tag--b tv-mono">FCS / NOMINAL</span>
              <span className="systems-orbit__tag systems-orbit__tag--c tv-mono">WPN / ARMED</span>
            </div>
            <div className="systems-specimen__readouts">
              <div>
                <span className="tv-mono">DISPLAY</span>
                <strong>HUD / 30 HZ</strong>
              </div>
              <div>
                <span className="tv-mono">SCENE</span>
                <strong>THREE / R186</strong>
              </div>
              <div>
                <span className="tv-mono">AUDIO</span>
                <strong>PROCEDURAL</strong>
              </div>
            </div>
          </div>
        </section>

        <div className="systems-layout">
          <aside className="systems-index" aria-label="章节目录">
            <span className="systems-index__label tv-mono">INDEX / 索引</span>
            <nav>
              {SECTIONS.map(([number, en, zh]) => (
                <a key={number} href={`#systems-${number}`}>
                  <span className="tv-mono">{number}</span>
                  <strong>{zh}</strong>
                  <em className="tv-mono">{en}</em>
                </a>
              ))}
            </nav>
            <div className="systems-index__foot tv-mono">
              <span>REACT 19 · TS 5.9</span>
              <span>VITE 8 · THREE R186</span>
            </div>
          </aside>

          <div className="systems-content">
            <section className="systems-section" id="systems-01">
              <SectionHead number="01" en="Foundation" zh="基础系统" desc="色板、字体、间距与几何。所有组件只消费令牌。" />
              <div className="systems-grid systems-grid--foundation">
                <Panel tone="glass" label="CHROMA / 色板" className="sys-card sys-card--wide" brackets>
                  <div className="swatch-grid">
                    {PALETTE.map(([token, value, use]) => (
                      <div className="swatch" key={token}>
                        <span className="swatch__chip" style={{ background: `var(${token})` }} />
                        <div>
                          <strong className="tv-mono">{value}</strong>
                          <span className="tv-mono">{token}</span>
                          <em>{use}</em>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>

                <Panel tone="glass" label="TYPOGRAPHY / 字体" className="sys-card sys-card--type">
                  <div className="type-specimen">
                    <span className="type-specimen__display">SUNSET SPEAR</span>
                    <span className="type-specimen__display-zh">落日之矛 / 战术航电</span>
                    <code className="type-specimen__mono">LOCK 08 · 452 KT · 21,400 M · G 6.4</code>
                    <p className="type-specimen__body">
                      中文叙事 + 英文航电标签。Display 使用系统窄体字，数据一律等宽表格数字，
                      不做远程字体请求。
                    </p>
                    <div className="type-specimen__stack tv-mono">
                      <span>DISPLAY — 600 / 0.02em</span>
                      <span>MONO — 500 / TABULAR</span>
                      <span>TEXT — 400 / 1.7 LH</span>
                    </div>
                  </div>
                </Panel>

                <Panel tone="glass" label="SPACE & GEOMETRY / 间距" className="sys-card">
                  <div className="space-scale">
                    {[4, 8, 12, 16, 24, 32, 48, 64, 96].map((size) => (
                      <div key={size}>
                        <span className="tv-mono">{size}</span>
                        <i style={{ width: `${Math.min(size, 96) * 1.5}px` }} />
                      </div>
                    ))}
                  </div>
                  <Divider label="切角 / CHAMFER" />
                  <div className="geometry-samples">
                    <span className="geometry-samples__cut">CHAMFER 10</span>
                    <span className="geometry-samples__bracket">BRACKET</span>
                    <HazardStripe className="geometry-samples__hazard" />
                  </div>
                </Panel>

                <Panel
                  tone="warning"
                  label="SURFACES / 表面"
                  className="sys-card"
                  actions={<Tag tone="warning">CAUTION</Tag>}
                >
                  <div className="surface-demo">
                    <div>
                      <StatusLamp label="GLASS PANEL" tone="nominal" />
                      <p>深色玻璃 + 1px 内描边；压在亮天空上仍可读。</p>
                    </div>
                    <div>
                      <StatusLamp label="WARNING SURFACE" tone="warning" pulse />
                      <p>红黑渐变用于巨兽、导弹与机体损伤，不承担普通信息。</p>
                    </div>
                  </div>
                </Panel>
              </div>
            </section>

            <section className="systems-section" id="systems-02">
              <SectionHead number="02" en="HUD Language" zh="HUD 语言" desc="瞄准、锁定、姿态与告警共享同一套刻度和括号。" />
              <div className="hud-specimen">
                <div className="hud-specimen__sky" aria-hidden="true" />
                <div className="hud-specimen__scan" aria-hidden="true" />
                <span className="hud-specimen__corner hud-specimen__corner--tl" aria-hidden="true" />
                <span className="hud-specimen__corner hud-specimen__corner--br" aria-hidden="true" />
                <div className="hud-specimen__heading">
                  <HeadingTape heading={352} />
                </div>
                <div className="hud-specimen__tape hud-specimen__tape--left">
                  <SpeedTape knots={472} mach={0.86} afterburner />
                </div>
                <div className="hud-specimen__tape hud-specimen__tape--right">
                  <AltitudeTape altitude={6800} verticalSpeed={12} />
                </div>
                <div className="hud-specimen__ladder">
                  <PitchLadder pitch={4} roll={-12} />
                </div>
                <div className="hud-specimen__target">
                  <span className="tv-target tv-target--hostile is-selected is-locked">
                    <span className="tv-target__corner tv-target__corner--tl" />
                    <span className="tv-target__corner tv-target__corner--tr" />
                    <span className="tv-target__corner tv-target__corner--bl" />
                    <span className="tv-target__corner tv-target__corner--br" />
                    <span className="tv-target__core" />
                    <span className="tv-target__label">
                      <span className="tv-target__name">VESPER 2</span>
                      <span className="tv-target__meta tv-mono">
                        HOSTILE <em>1.2 KM</em>
                      </span>
                    </span>
                  </span>
                  <LockReticle target={SAMPLE_TARGET} />
                </div>
                <div className="hud-specimen__caption tv-mono">
                  <span>SUNSET THEATER / HUD COMPOSITION</span>
                  <span>30 HZ SNAPSHOT · DOM OVERLAY</span>
                </div>
              </div>
              <div className="systems-grid systems-grid--three">
                <Panel tone="glass" label="TARGET LANGUAGE" className="sys-card">
                  <Tag tone="hostile">VESPER 2</Tag>
                  <h3>锁定锥 / LOCK CONE</h3>
                  <p>12° 锥角、3.6 km 射程、约 0.9s 保持。锁定后菱形变为琥珀色并连续闪烁，目标仍在视野前方时不会丢失锁定。</p>
                  <div className="mini-targets">
                    <span className="mini-target">IDLE</span>
                    <span className="mini-target is-seek">SEEK</span>
                    <span className="mini-target is-lock">LOCK</span>
                  </div>
                </Panel>
                <Panel tone="glass" label="ALERT LANGUAGE" className="sys-card">
                  <Tag tone="warning">MISSILE</Tag>
                  <h3>只给需要行动的信息</h3>
                  <p>告警层级：CAUTION → WARNING → CRITICAL。方向箭头、双音节警报与文字同时出现。</p>
                  <div className="alert-swatches">
                    <span>CAUTION</span>
                    <span>WARNING</span>
                    <span>CRITICAL</span>
                  </div>
                </Panel>
                <Panel tone="glass" label="RADAR" className="sys-card">
                  <Tag tone="cyan">LINK 08</Tag>
                  <h3>北向锁定 + 敌方菱形</h3>
                  <p>六边形语言退让给功能：圆圈代表友军，三角代表敌机，菱形代表巨兽弱点。</p>
                  <IconRadar size={28} />
                </Panel>
              </div>
            </section>

            <section className="systems-section" id="systems-03">
              <SectionHead number="03" en="Components" zh="组件" desc="从按钮到面板，所有状态都能在暗色座舱中共存。" />
              <div className="systems-grid systems-grid--components">
                <Panel tone="glass" label="BUTTONS / 按钮" className="sys-card sys-card--wide">
                  <div className="component-row">
                    <Button variant="primary" icon={<IconArrowRight size={14} />} kbd="ENTER">
                      LAUNCH
                    </Button>
                    <Button>STEER</Button>
                    <Button variant="ghost">CANCEL</Button>
                    <Button variant="danger" icon={<IconWarning size={13} />}>
                      ABORT
                    </Button>
                    <Button disabled>NO LINK</Button>
                  </div>
                  <div className="component-row">
                    <Button size="lg" variant="primary">
                      大号主操作
                    </Button>
                    <Button size="sm" variant="quiet">
                      SMALL / QUIET
                    </Button>
                    <span className="component-note tv-mono">切角 8px · 内描边 · focus ring 2px</span>
                  </div>
                </Panel>
                <Panel tone="glass" label="TAGS & STATUS / 状态" className="sys-card">
                  <div className="tag-cloud">
                    <Tag tone="nominal">LINK OK</Tag>
                    <Tag tone="caution">SEEK</Tag>
                    <Tag tone="hostile">VESPER</Tag>
                    <Tag tone="ally">LUMEN 2</Tag>
                    <Tag tone="warning">CRITICAL</Tag>
                    <Tag tone="offline">NO SIGNAL</Tag>
                    <Tag tone="plain">STANDBY</Tag>
                  </div>
                  <div className="status-grid">
                    <StatusLamp label="FCS NOMINAL" tone="nominal" />
                    <StatusLamp label="MISSILE ALERT" tone="warning" pulse />
                    <StatusLamp label="LOW FUEL" tone="caution" />
                    <StatusLamp label="OFFLINE" tone="offline" />
                  </div>
                  <div className="component-row">
                    <Keycap>W</Keycap>
                    <Keycap>A</Keycap>
                    <Keycap>S</Keycap>
                    <Keycap>D</Keycap>
                    <Keycap>SPACE</Keycap>
                    <Keycap>F</Keycap>
                  </div>
                </Panel>
                <Panel tone="glass" label="READOUTS / 读数" className="sys-card">
                  <div className="readout-grid">
                    <Readout label="IAS / 空速" value="472" unit="KT" />
                    <Readout label="ALT / 高度" value="6,800" unit="M" tone="ice" />
                    <Readout label="MACH" value="0.86" tone="amber" />
                    <Readout label="SCORE" value="004200" tone="green" />
                  </div>
                  <Divider />
                  <div className="meter-stack">
                    <Meter label="HULL" value={82} tone="green" showValue valueSuffix="%" />
                    <Meter label="THROTTLE" value={64} tone="amber" showValue valueSuffix="%" />
                    <Meter label="AAM RACK" value={8} max={8} tone="cyan" segments={8} />
                  </div>
                </Panel>
                <Panel tone="glass" label="TOGGLES / 开关" className="sys-card">
                  <div className="toggle-stack">
                    <Toggle checked={toggleA} onCheckedChange={setToggleA} label="INVERT PITCH" />
                    <Toggle checked={toggleB} onCheckedChange={setToggleB} label="REDUCED EFFECTS" />
                  </div>
                  <Divider label="VOLUME" />
                  <label className="volume-demo">
                    <IconSoundOn size={15} />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={volume}
                      onChange={(event) => setVolume(Number(event.currentTarget.value))}
                      aria-label="演示音量"
                    />
                    <span className="tv-mono">{volume}</span>
                  </label>
                  <p className="component-note">
                    开关与音量分享同一条 focus ring；游戏内状态和组件库不耦合。
                  </p>
                </Panel>
                <Panel tone="glass" label="ICONS / 图标" className="sys-card">
                  <div className="icon-strip">
                    <span><IconRadar size={19} /><em className="tv-mono">RADAR</em></span>
                    <span><IconTarget size={19} /><em className="tv-mono">TARGET</em></span>
                    <span><IconMissile size={19} /><em className="tv-mono">AAM</em></span>
                    <span><IconShield size={19} /><em className="tv-mono">SHIELD</em></span>
                    <span><IconFlame size={19} /><em className="tv-mono">FLARE</em></span>
                    <span><IconPlane size={19} /><em className="tv-mono">WING</em></span>
                    <span><IconBolt size={19} /><em className="tv-mono">POWER</em></span>
                    <span><IconScan size={19} /><em className="tv-mono">SCAN</em></span>
                  </div>
                  <p className="component-note">手工 SVG，统一 24×24 网格与 currentColor。</p>
                </Panel>
              </div>
            </section>

            <section className="systems-section" id="systems-04">
              <SectionHead number="04" en="Flight Systems" zh="飞行系统" desc="战斗信息不是装饰：每个模块都消费真实的模拟快照。" />
              <div className="systems-grid systems-grid--flight">
                <Panel tone="glass" label="ARMAMENT / 武器" className="sys-card">
                  <WeaponRack
                    weapons={{
                      selected: weapon,
                      missiles: 6,
                      maxMissiles: 8,
                      gunAmmo: 642,
                      gunMax: 900,
                      flares: 4,
                      maxFlares: 6,
                      gunFiring: false,
                    }}
                    lock={SAMPLE_LOCK}
                    onSelect={setWeapon}
                  />
                </Panel>
                <Panel tone="glass" label="COMMS / 通讯" className="sys-card">
                  <CommsFeed messages={SAMPLE_COMMS} />
                </Panel>
                <Panel tone="glass" label="WINGMAN / 僚机" className="sys-card">
                  <WingmanStatus wingman={SAMPLE_WINGMAN} />
                  <p className="component-note">
                    友军永远使用绿色，并且以方形/菱形与敌机区分；颜色不是唯一信息。
                  </p>
                </Panel>
                <Panel tone="glass" label="MASSIVE CONTACT / 巨兽" className="sys-card sys-card--boss">
                  <BossBar boss={SAMPLE_BOSS} />
                </Panel>
                <Panel tone="glass" label="RADAR / 雷达" className="sys-card">
                  <RadarScope contacts={RADAR_CONTACTS} heading={352} />
                </Panel>
                <Panel tone="glass" label="WARNING / 告警" className="sys-card">
                  <div className="systems-alert-stage">
                    <MissileWarning warnings={[SAMPLE_WARNING]} />
                  </div>
                  <p className="component-note">
                    告警文本同时承担视觉与屏幕阅读器通知；声音音量独立于视觉层。
                  </p>
                </Panel>
              </div>
            </section>

            {/* v0.4 — the cast, and the one-key performer that flies against it. */}
            <section className="systems-section" id="systems-04b">
              <SectionHead
                number="04b"
                en="Stage &amp; Auto Ace"
                zh="敌机编成与全自动皇牌模式"
                desc="七个机型分三波进场；同一个飞控模型既可以交给你，也可以交给自动驾驶。"
              />
              <div className="systems-grid systems-grid--two">
                <Panel tone="glass" label="THREAT DB / 敌机识别" className="sys-card">
                  <ul className="systems-roster">
                    {ENEMY_ORDER.map((id) => {
                      const profile = ENEMIES[id];
                      return (
                        <li key={id}>
                          <span
                            className="systems-roster__tint"
                            style={{ background: `#${profile.tint.toString(16).padStart(6, '0')}` }}
                            aria-hidden="true"
                          />
                          <b className="tv-mono">{profile.code}</b>
                          <div>
                            <strong>{profile.labelZh}</strong>
                            <small>{profile.role}</small>
                          </div>
                          <em className="tv-mono">
                            {profile.hp} HP · {Math.round((profile.turnRate * 180) / Math.PI)}°/s
                            {profile.jammer ? ' · ECM' : ''}
                            {profile.gun ? ` · GUN ${profile.gun.dps}` : ''}
                          </em>
                        </li>
                      );
                    })}
                  </ul>
                  <p className="component-note">
                    每种机型的转向率都低于玩家（约 20°/s，高G转弯 28°/s），差别体现在
                    武器、装甲、站位与数量上，而不是靠无法反制的机动性。
                  </p>
                </Panel>
                <Panel tone="glass" label="AUTO ACE / 全自动皇牌模式" className="sys-card">
                  <div className="systems-auto">
                    <AutoPilotRailView auto={SAMPLE_AUTO} />
                    <div className="systems-auto__demo">
                      <AutoPilotButtonView auto={SAMPLE_AUTO} />
                    </div>
                  </div>
                  <p className="component-note">
                    按 G 一键接管。它不是外挂：每一帧它写入的都是和你按键时完全相同的
                    俯仰/滚转/偏航、油门、武器选择与扳机，走同一套飞行模型、同一份弹药、
                    同一个评分。区别只在于它知道什么时候该做库尔比特。
                  </p>
                  <ul className="systems-auto__rules">
                    <li>先清护航，再打巨兽：机炮射程内还有敌机时，护盾节点排到后面。</li>
                    <li>导弹优先用热焰弹解决，超机动留给热焰弹解决不了的那 1.5 秒。</li>
                    <li>追不上就脱离：机头偏出 58° 超过 1.8 秒就拉直重新进入攻击航线。</li>
                    <li>被击落后 3 秒重新升空，机动展示清单跨重启保留。</li>
                  </ul>
                </Panel>
              </div>
            </section>

            <section className="systems-section" id="systems-05">
              <SectionHead number="05" en="Interaction" zh="交互与可访问性" desc="从键盘到触屏，从逐帧数据到 reduced motion。" />
              <div className="systems-grid systems-grid--two">
                <Panel tone="glass" label="CONTROLS / 操作" className="sys-card">
                  <div className="control-map">
                    {[
                      ['W / S', '俯仰 / PITCH'],
                      ['A / D', '滚转 / ROLL'],
                      ['Q / E', '偏航 / YAW'],
                      ['SHIFT / CTRL', '油门 / THROTTLE'],
                      ['SPACE', '发射 / FIRE'],
                      ['TAB / T', '切换目标 / TARGET'],
                      ['F', '热焰弹 / FLARE'],
                      ['P / ESC', '暂停 / PAUSE'],
                    ].map(([keys, label]) => (
                      <div key={keys}>
                        <span>
                          {keys.split(' / ').map((key) => (
                            <Keycap key={key}>{key}</Keycap>
                          ))}
                        </span>
                        <em>{label}</em>
                      </div>
                    ))}
                  </div>
                </Panel>
                <Panel tone="glass" label="ACCESSIBILITY / 可访问性" className="sys-card">
                  <ul className="a11y-list">
                    <li><IconCheck size={13} /> 仪表使用 `role="meter"` 与 `aria-valuetext`</li>
                    <li><IconCheck size={13} /> 告警使用限流的 `role="alert"`；通讯使用 `aria-live="polite"`</li>
                    <li><IconCheck size={13} /> 焦点环 2px，可 Tab 到达所有操作按钮</li>
                    <li><IconCheck size={13} /> 敌我/锁定状态同时使用形状、图标与文字</li>
                    <li><IconCheck size={13} /> 支持 `prefers-reduced-motion`，可关闭镜头抖动</li>
                    <li><IconCheck size={13} /> 静音后所有关键声音都有字幕替代</li>
                  </ul>
                </Panel>
              </div>
            </section>

            <section className="systems-section" id="systems-06">
              <SectionHead
                number="06"
                en="Sound & Motion"
                zh="声音与动效"
                desc="v0.3 起配乐是一台真正的编曲机：六个段落、十条写好的旋律、一把太鼓。"
              />
              <div className="sound-panel">
                <div className="sound-panel__visual" aria-hidden="true">
                  <div className="sound-bars">
                    {Array.from({ length: 36 }, (_, index) => (
                      <i key={index} style={{ animationDelay: `${(index % 12) * 0.09}s`, height: `${18 + ((index * 13) % 62)}%` }} />
                    ))}
                  </div>
                  <span className="sound-panel__scan" />
                  <span className="sound-panel__label tv-mono">AUDIO CORE / D MINOR / 62–108 BPM</span>
                </div>
                <div className="sound-panel__copy">
                  <Tag tone="cyan">WEBAUDIO</Tag>
                  <h3>原创程序化主题</h3>
                  <p>
                    双锯齿引擎随油门变调，风噪随速度增强；锁定单音随锁定进度爬升，
                    导弹掠过时按真实声速延迟播放多普勒呼啸。爆炸按距离衰减高频并延迟到达，
                    远处弹幕因此听起来真的远。
                  </p>
                  <div className="sound-panel__grid tv-mono">
                    <span>ENGINE / SAW + NOISE</span>
                    <span>LOCK / 620 → 1240 HZ</span>
                    <span>HIT / METALLIC PING</span>
                    <span>SCORE / 6 CUES · 10 PHRASES</span>
                  </div>
                  <span className="component-note">首次 LAUNCH 手势才创建 AudioContext；没有版权音频。</span>
                </div>
              </div>

              <div className="score-table" role="table" aria-label="v0.3 配乐段落">
                <div className="score-table__head tv-mono" role="row">
                  <span role="columnheader">CUE</span>
                  <span role="columnheader">BPM</span>
                  <span role="columnheader">PROGRESSION</span>
                  <span role="columnheader">ARRANGEMENT</span>
                </div>
                {SECTION_ORDER.map((id) => {
                  const section = SCORE_SECTIONS[id];
                  return (
                    <div className="score-table__row" role="row" key={id}>
                      <span className="score-table__name" role="cell">
                        <strong>{section.labelZh}</strong>
                        <em className="tv-mono">{id.toUpperCase()}</em>
                      </span>
                      <span className="tv-mono" role="cell">
                        {section.bpm}
                      </span>
                      <span className="tv-mono score-table__chords" role="cell">
                        {section.progression.join(' · ')}
                      </span>
                      <span className="score-table__mix" role="cell">
                        <i style={{ width: `${Math.round(section.energy * 100)}%` }} />
                        <em className="tv-mono">
                          {section.ostinato === 'none' ? 'PAD + LEAD' : `OSTINATO ×${section.ostinato === 'sixteenth' ? 16 : 8}`}
                        </em>
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="component-note">
                段落只在小节线上切换，且至少停留两小节；章节曲线（翱翔 → 制空 → 强攻 → 巨兽）由模拟的
                <span className="tv-mono"> intensity </span>
                单一数值驱动，画面调色与配器读的是同一个数。
              </p>
            </section>

            <section className="systems-section" id="systems-07">
              <SectionHead number="07" en="Implementation" zh="实现" desc="两个入口，一份样式，three 只在需要时加载。" />
              <div className="systems-grid systems-grid--two">
                <Panel tone="glass" label="USAGE / 使用" className="sys-card">
                  <pre className="code-block"><code>{CODE}</code></pre>
                  <div className="code-meta tv-mono">
                    <span>@theve/ui</span>
                    <span>@theve/ui/three</span>
                    <span>@theve/ui/styles.css</span>
                  </div>
                </Panel>
                <Panel tone="glass" label="DESIGN NOTES / 设计注记" className="sys-card">
                  <div className="notes-list">
                    <div>
                      <strong>01 / 原创致敬</strong>
                      <p>
                        这是一个受《皇牌空战8：希孚之翼》电影化空战气质启发的原创 UI 设计实验，
                        不使用任何官方 Logo、美术、音乐或真实机体模型。
                      </p>
                    </div>
                    <div>
                      <strong>02 / 轻量</strong>
                      <p>核心入口不依赖 three；three 只在 `@theve/ui/three` 中进入。运行时除 React/three 无第三方依赖。</p>
                    </div>
                    <div>
                      <strong>03 / 数据驱动</strong>
                      <p>模拟以 60 Hz 推进，只以 30 Hz 发布快照给 React；three 在独立 rAF 中渲染，不触发组件重渲染。</p>
                    </div>
                    <div>
                      <strong>04 / 可移除</strong>
                      <p>HUD 组件也可脱离模拟单独使用，战机和巨兽只是场景适配层，不影响令牌与基础组件。</p>
                    </div>
                  </div>
                </Panel>
              </div>
              <Divider label="END OF DOCUMENT" />
              <div className="systems-end">
                <div>
                  <span className="tv-mono">NEXT SORTIE</span>
                  <h3>去云海之上验证它。</h3>
                </div>
                <Button variant="primary" size="lg" icon={<IconArrowRight size={15} />} onClick={() => onNavigate('cockpit')}>
                  进入座舱 / ENGAGE
                </Button>
              </div>
            </section>
          </div>
        </div>
      </main>

      <footer className="systems-foot">
        <Brand compact />
        <p>
          An original UI homage inspired by <em>ACE COMBAT 8: WINGS OF THEVE</em>. All visuals,
          aircraft, superweapons and audio are procedural and original.
        </p>
        <div className="systems-foot__meta tv-mono">
          <span>THEVE // TACS-8</span>
          <span>{formatClock(0)} / 00:00</span>
          <span>BUILT FOR THE DUSK</span>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({
  number,
  en,
  zh,
  desc,
}: {
  number: string;
  en: string;
  zh: string;
  desc: string;
}) {
  return (
    <header className="systems-section__head">
      <span className="systems-section__number tv-mono">{number}</span>
      <div>
        <span className="tv-mono systems-section__en">{en}</span>
        <h2>{zh}</h2>
        <p>{desc}</p>
      </div>
    </header>
  );
}
