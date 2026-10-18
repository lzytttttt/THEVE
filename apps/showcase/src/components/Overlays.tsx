import { useEffect, useRef } from 'react';
import type {
  AssistId,
  AssistSettings,
  CockpitAudio,
  CockpitQuality,
  CockpitSnapshot,
  ViewMode,
} from '@theve/ui';
import {
  AutoPilotButton,
  Button,
  IconArrowRight,
  IconCheck,
  IconClose,
  IconFlame,
  IconMissile,
  IconRadar,
  IconScan,
  IconView,
  IconWarning,
  Keycap,
  VIEW_LABEL,
  VIEW_ORDER,
  Toggle,
  cx,
  formatClock,
} from '@theve/ui';
import { BeastSilhouette } from './Silhouettes';

const CONTROLS: Array<[string, string, string]> = [
  ['W / S', '俯仰', 'PITCH'],
  ['A / D', '滚转', 'ROLL'],
  ['Q / E', '偏航', 'YAW'],
  ['SHIFT / CTRL', '油门', 'THROTTLE'],
  ['C', '高G转弯（按住）', 'HIGH-G'],
  ['X', '减速板（按住）', 'AIRBRAKE'],
  ['Z / V', '眼镜蛇 / 桶滚', 'COBRA / BARREL'],
  ['B / N / K', '破S / 殷麦曼 / 库尔比特', 'SPLIT-S / IMMEL / KULBIT'],
  ['SPACE', '发射', 'FIRE'],
  ['J', '机炮', 'GUN'],
  ['TAB', '切换目标', 'TARGET'],
  ['F', '热焰弹', 'FLARE'],
  ['Y', '辅助驾驶开关', 'FLIGHT AIDS'],
  ['O', '切换座舱 / 第三人称视角', 'VIEW'],
  ['G', '全自动皇牌模式（一键通关）', 'AUTO ACE'],
  ['P / ESC', '暂停', 'PAUSE'],
];

/** v0.4 threat database, mirrored from the engine's roster table. */
const ENEMY_ROSTER: Array<[string, string, string, string]> = [
  ['SCT', '维斯珀 侦察机', '轻装高速、无导弹：逼你跟着它掉能量', 'VESPER SCOUT'],
  ['INT', '维斯珀 截击机', '编队主力，中距 AAM 加机炮点射', 'VESPER INTERCEPTOR'],
  ['HVY', '维斯珀 重装攻击机', '装甲厚、转向差，机炮压制最痛', 'VESPER HEAVY'],
  ['JAM', '维斯珀 电子战机', '活着就一直压制火控：锁定速度减半', 'VESPER JAMMER'],
  ['ACE', '维斯珀 王牌', '出手早、冷却短，别让它咬住你', 'VESPER ACE'],
  ['CMD', '维斯珀 指挥机', '编队长机：击落它等于拆掉整队的大脑', 'VESPER COMMANDER'],
  ['DRN', '利维坦 无人机', '巨兽放出的消耗品，个体弱但数量多', 'LEVIATHAN DRONE'],
];

/**
 * v0.5 LEVIATHAN attack book, mirrored from `sim/boss.ts`. The briefing prints
 * the counter next to every attack, because "the boss is hard" is only fair if
 * the player is told which stick input answers it.
 */
const BOSS_ATTACKS: Array<[string, string, string, string]> = [
  ['CIWS', '近防炮拦截', '不要正对舰体直线进入 — 做侧向掠袭', 'CLOSE-IN GUNS'],
  ['VLS', '垂直发射齐射', 'F 释放热焰弹，或 V 做桶滚把导弹甩掉', 'MISSILE SALVO'],
  ['PULSE', '护盾冲击脉冲', '不要在一千米内盘旋 — 脱离或加速穿出', 'SHIELD DISCHARGE'],
  ['LANCE', '主炮照射', '炮口亮起就横向脱离炮轴 — 桶滚 / 高G急转', 'SPINAL LANCE'],
];


const MANEUVERS: Array<[string, string, string]> = [
  ['C', '高G转弯', 'HIGH-G TURN'],
  ['X', '减速板', 'AIRBRAKE'],
  ['Z', '眼镜蛇机动', 'PUGACHEV COBRA'],
  ['V', '桶滚', 'BARREL ROLL'],
  ['B', '破S机动', 'SPLIT-S'],
  ['N', '殷麦曼翻转', 'IMMELMANN'],
  ['K', '库尔比特', 'KULBIT'],
];

const FLIGHT_AIDS: Array<[AssistId, string, string]> = [
  ['attitude', '姿态辅助', '松杆自动消除滚转漂移，接近平飞时摆正机翼'],
  ['steering', '目标引导', '目标在机头前方时轻微带杆，把敌机送进锁定锥'],
  ['throttle', '自动油门', '松手后自动补油门保持交战速度，绝不违背你的油门指令'],
  ['terrain', '低空保护', '低空提醒并在触地前柔和拉起'],
];

const noop = () => undefined;

function useModalFocus(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    const focusable = node?.querySelector<HTMLElement>(
      '[data-autofocus], button:not([disabled]), input, [href], [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = Array.from(
        node.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((item) => item.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return ref;
}

function ControlRecap({ dense = false }: { dense?: boolean }) {
  return (
    <dl className={cx('overlay-controls', dense && 'overlay-controls--dense')}>
      {CONTROLS.slice(0, dense ? 8 : CONTROLS.length).map(([keys, zh, en]) => (
        <div key={keys}>
          <dt>
            {keys.split(' / ').map((key) => (
              <Keycap key={key}>{key}</Keycap>
            ))}
          </dt>
          <dd>
            {zh}
            <span className="tv-mono">{en}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ManeuverRecap() {
  return (
    <dl className="overlay-controls overlay-controls--dense overlay-controls--maneuvers">
      {MANEUVERS.map(([key, zh, en]) => (
        <div key={key}>
          <dt>
            <Keycap>{key}</Keycap>
          </dt>
          <dd>
            {zh}
            <span className="tv-mono">{en}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface FlightAidSettingsProps {
  assists: AssistSettings;
  master: boolean;
  onSetAssist: (id: AssistId, enabled: boolean) => void;
  onSetAll: (enabled: boolean) => void;
}

function FlightAidSettings({
  assists,
  master,
  onSetAssist,
  onSetAll,
}: FlightAidSettingsProps) {
  const allOn = FLIGHT_AIDS.every(([id]) => assists[id]);
  return (
    <div className="aid-settings">
      <div className="aid-settings__head">
        <span className="tv-mono">
          {master ? 'ASSIST BUS ONLINE' : 'ASSIST BUS CUT'}
        </span>
        <Toggle
          checked={allOn}
          onCheckedChange={(checked) => onSetAll(checked)}
          label={allOn ? '全开' : '自定义'}
        />
      </div>
      <ul className="aid-settings__list">
        {FLIGHT_AIDS.map(([id, zh, hint]) => (
          <li key={id}>
            <div className="aid-settings__text">
              <strong>{zh}</strong>
              <small>{hint}</small>
            </div>
            <Toggle
              checked={assists[id]}
              onCheckedChange={(checked) => onSetAssist(id, checked)}
              label={assists[id] ? 'ON' : 'OFF'}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Briefing                                                            */
/* ------------------------------------------------------------------ */
export interface BriefingOverlayProps {
  onLaunch: () => void;
  onExit: () => void;
  muted: boolean;
  /** v0.4: hand the whole sortie to AUTO ACE from the briefing card. */
  onAutoAce: () => void;
}

export function BriefingOverlay({ onLaunch, onExit, muted, onAutoAce }: BriefingOverlayProps) {
  return (
    <div
      className="game-overlay game-overlay--briefing"
      role="dialog"
      aria-modal="true"
      aria-labelledby="briefing-title"
      data-tv-ui="true"
    >
      <div className="brief-panel tv-cut">
        <div className="brief-panel__topline">
          <span className="tv-mono">CIRRUS TASK FORCE · SORTIE 08</span>
          <span className="brief-panel__secret tv-mono">
            <i aria-hidden="true" /> SECRET // 绝密
          </span>
        </div>
        <div className="brief-panel__grid">
          <div className="brief-panel__main">
            <span className="tv-eyebrow">MISSION BRIEF / 任务简报</span>
            <h1 id="briefing-title" className="brief-panel__title">
              SUNSET SPEAR
              <span>落日之矛</span>
            </h1>
            <p className="brief-panel__copy">
              LUMEN 1，VESPER 编队已经越过落日空域的中线，而且是分三波进来的：
              先锋、主队、最后是带着电子战机与重装机的指挥编队。
              把八架全部清掉，LEVIATHAN 才会露头——然后在你把两枚护盾节点
              从它脊背上摘下来之前，云海之上没有第二道防线。
            </p>
            <div className="brief-panel__objectives">
              <div className="brief-panel__objectives-head">
                <span className="tv-mono">PRIMARY OBJECTIVES</span>
                <span className="tv-mono">03 ITEMS</span>
              </div>
              <ol>
                <li>
                  <span className="tv-mono">01</span>
                  <div>
                    <strong>逐波拦截 VESPER 编队</strong>
                    <small className="tv-mono">CLEAR THREE WAVES · 8 BANDITS</small>
                  </div>
                  <em className="tv-mono">DOGFIGHT</em>
                </li>
                <li>
                  <span className="tv-mono">02</span>
                  <div>
                    <strong>摧毁 LEVIATHAN 护盾节点</strong>
                    <small className="tv-mono">DESTROY SHIELD NODES</small>
                  </div>
                  <em className="tv-mono">BOSS</em>
                </li>
                <li>
                  <span className="tv-mono">03</span>
                  <div>
                    <strong>突入反应堆核心</strong>
                    <small className="tv-mono">STRIKE THE CORE</small>
                  </div>
                  <em className="tv-mono">FINAL</em>
                </li>
              </ol>
            </div>
            <div className="brief-panel__warning">
              <IconWarning size={18} />
              <div>
                <strong className="tv-mono">MASSIVE CONTACT / 战争巨兽</strong>
                <span>
                  LEVIATHAN-CLASS AERIAL DREADNOUGHT — 它有实体碰撞体积，别撞上去；
                  护盾节点挂在两侧舷外挂架上，反应堆藏在舰艏的装甲口里。
                </span>
              </div>
            </div>
            {/* v0.5: the boss is a puzzle, so the briefing prints the answer key.
                Every attack and the stick input that beats it. */}
            <div className="brief-panel__threat-db">
              <div className="brief-panel__threat-db-head">
                <span className="tv-mono">LEVIATHAN ATTACK BOOK</span>
                <span className="tv-mono">4 ATTACKS</span>
              </div>
              <ul>
                {BOSS_ATTACKS.map(([code, zh, counter, en]) => (
                  <li key={code}>
                    <span className="tv-mono brief-panel__threat-code">{code}</span>
                    <div>
                      <strong>{zh}</strong>
                      <small className="tv-mono">{en}</small>
                    </div>
                    <em>应对：{counter}</em>
                  </li>
                ))}
              </ul>
            </div>
            <div className="brief-panel__camera">
              <IconView size={16} />
              <div>
                <strong className="tv-mono">CAMERA / 视角</strong>
                <span>
                  按 <Keycap>O</Keycap> 在座舱与第三人称跟随视角之间切换；
                  外部视角可以看清本机姿态、机动动作与翼尖水汽。
                </span>
              </div>
            </div>
            <div className="brief-panel__controls">
              <span className="brief-panel__controls-title tv-mono">QUICK CONTROLS</span>
              <ControlRecap dense />
              <span className="brief-panel__controls-title tv-mono">
                MANOEUVRE / 机动 (C X Z V B N K)
              </span>
              <ManeuverRecap />
            </div>
          </div>

          <aside className="brief-panel__side">
            <div className="brief-panel__stamp" aria-hidden="true">
              <span>CIRRUS</span>
              <strong>TFS</strong>
              <em>08</em>
            </div>
            <div className="brief-panel__data">
              <div>
                <span className="tv-mono">CALLSIGN</span>
                <strong>LUMEN 1</strong>
              </div>
              <div>
                <span className="tv-mono">AIRFRAME</span>
                <strong>F-08 / THEVE</strong>
              </div>
              <div>
                <span className="tv-mono">WINGMAN</span>
                <strong>LUMEN 2</strong>
              </div>
              <div>
                <span className="tv-mono">THREAT</span>
                <strong className="is-alert">LEVIATHAN</strong>
              </div>
            </div>
            <div className="brief-panel__loadout">
              <div className="brief-panel__loadout-head tv-mono">
                <span>LOADOUT</span>
                <span>FULL</span>
              </div>
              <div>
                <IconMissile size={15} />
                <span>AAM × 8</span>
                <small className="tv-mono">AIM-118</small>
              </div>
              <div>
                <IconScan size={15} />
                <span>GUN × 900</span>
                <small className="tv-mono">20 MM</small>
              </div>
              <div>
                <IconFlame size={15} />
                <span>FLARE × 6</span>
                <small className="tv-mono">COUNTER</small>
              </div>
            </div>
            <div className="brief-panel__threat-visual" aria-hidden="true">
              <div className="brief-panel__threat-head tv-mono">
                <span>THREAT DOSSIER</span>
                <span>CLS-08</span>
              </div>
              <BeastSilhouette className="brief-panel__threat-svg" />
              <div className="brief-panel__threat-tags tv-mono">
                <span><i /> SHIELD A</span>
                <span><i /> SHIELD B</span>
                <span><i /> CORE</span>
              </div>
            </div>
            <div className="brief-panel__audio tv-mono">
              <span>
                <i className={cx('brief-panel__audio-dot', !muted && 'is-on')} />
                {muted ? 'AUDIO MUTED' : 'AUDIO ARMED'}
              </span>
              <span>PROCEDURAL SCORE</span>
            </div>
            <Button
              variant="primary"
              size="lg"
              block
              icon={<IconArrowRight size={16} />}
              onClick={onLaunch}
              data-autofocus
            >
              升空 / LAUNCH
            </Button>
            <AutoPilotButton variant="solo" onClick={onAutoAce} />
            <div className="brief-panel__hint tv-mono">
              <Keycap>ENTER</Keycap> 开始任务
              <span>·</span>
              <Keycap>G</Keycap> 全自动通关
              <span>·</span>
              <button type="button" className="brief-panel__back" onClick={onExit}>
                返回开场
              </button>
            </div>
          </aside>
        </div>
        <div className="brief-panel__hazard" aria-hidden="true" />
        <div className="brief-panel__corners" aria-hidden="true" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
const BOOT_CHECKS = [
  ['FLIGHT CONTROL BUS', '飞控总线', 'OK'],
  ['WEAPON HARD POINTS', '武器挂架', 'ARMED'],
  ['IFF DATALINK', '敌我识别', 'SYNC'],
  ['OPTRONIC SUITE', '光电观瞄', 'ONLINE'],
  ['AUDIO CORE', '主题音效', 'LIVE'],
  ['CANOPY SEAL', '座舱密封', 'LOCKED'],
];

export function BootOverlay({ onSkip }: { onSkip: () => void }) {
  return (
    <div className="game-overlay game-overlay--boot">
      <div className="boot-console" data-tv-ui="true">
        <div className="boot-console__head">
          <span className="tv-mono">TACS-8 / COLD START</span>
          <span className="tv-mono boot-console__spin">BOOT SEQUENCE</span>
        </div>
        <div className="boot-console__title">
          <h2>SYSTEMS ONLINE</h2>
          <span>航电系统接通 · 请保持过载准备</span>
        </div>
        <ul className="boot-console__list">
          {BOOT_CHECKS.map(([label, zh, status], index) => (
            <li key={label} style={{ animationDelay: `${index * 240 + 80}ms` }}>
              <IconCheck size={12} />
              <span className="boot-console__label tv-mono">{label}</span>
              <span className="boot-console__zh">{zh}</span>
              <em className="tv-mono">{status}</em>
            </li>
          ))}
        </ul>
        <div className="boot-console__progress" aria-hidden="true">
          <i />
        </div>
        <div className="boot-console__foot">
          <span className="tv-mono">SPOOLING · 2.8 SEC</span>
          <button type="button" className="boot-console__skip tv-mono" onClick={onSkip}>
            跳过 / SKIP <IconClose size={10} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Boss intro                                                          */
/* ------------------------------------------------------------------ */
export function BossIntroOverlay() {
  return (
    <div className="boss-intro" aria-live="assertive">
      <span className="boss-intro__bar boss-intro__bar--top" aria-hidden="true" />
      <span className="boss-intro__bar boss-intro__bar--bottom" aria-hidden="true" />
      <div className="boss-intro__content">
        <span className="boss-intro__warning tv-mono">
          <i />
          WARNING // MASSIVE UNKNOWN CONTACT
        </span>
        <h2 className="boss-intro__name">LEVIATHAN</h2>
        <p className="boss-intro__zh">空中无畏舰 · 利维坦</p>
        <div className="boss-intro__rule" aria-hidden="true">
          <span />
          <i>CLS-08</i>
          <span />
        </div>
        <span className="boss-intro__order tv-mono">
          摧毁护盾节点 / STRIKE THE SHIELD NODES
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pause                                                               */
/* ------------------------------------------------------------------ */
export interface PauseOverlayProps {
  audio: CockpitAudio;
  quality: CockpitQuality;
  setQuality: (quality: CockpitQuality) => void;
  invertPitch: boolean;
  setInvertPitch: (invert: boolean) => void;
  /** v0.5: the camera the player is riding in. */
  view: ViewMode;
  setView: (mode: ViewMode) => void;
  assists: AssistSettings;
  assistMaster: boolean;
  setAssist: (id: AssistId, enabled: boolean) => void;
  setAllAssists: (enabled: boolean) => void;
  onResume: () => void;
  onRestart: () => void;
  onExit: () => void;
}

const QUALITIES: Array<{ value: CockpitQuality; label: string }> = [
  { value: 'auto', label: 'AUTO' },
  { value: 'high', label: 'HIGH' },
  { value: 'low', label: 'LOW' },
];

export function PauseOverlay({
  audio,
  quality,
  setQuality,
  invertPitch,
  setInvertPitch,
  view,
  setView,
  assists,
  assistMaster,
  setAssist,
  setAllAssists,
  onResume,
  onRestart,
  onExit,
}: PauseOverlayProps) {
  const ref = useModalFocus(onResume);
  return (
    <div className="game-overlay game-overlay--dialog" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <div className="dialog-panel dialog-panel--wide" ref={ref}>
        <div className="dialog-panel__head">
          <span className="tv-eyebrow">SIMULATION FROZEN</span>
          <span className="tv-mono dialog-panel__code">TACS-8 / PAUSE</span>
        </div>
        <h2 id="pause-title" className="dialog-panel__title">
          座舱冻结
          <span>PAUSED</span>
        </h2>
        <p className="dialog-panel__copy">
          空域时间已停止。所有武器保险已合上，雷达进入待机扫描。
        </p>
        <div className="dialog-panel__grid dialog-panel__grid--three">
          <section className="dialog-panel__section">
            <h3 className="tv-mono">SETTINGS / 设置</h3>
            <div className="settings-row">
              <span>渲染质量</span>
              <div className="segmented">
                {QUALITIES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className={cx('segmented__item', quality === item.value && 'is-active')}
                    onClick={() => setQuality(item.value)}
                    aria-pressed={quality === item.value}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="settings-row">
              <span>反转俯仰</span>
              <Toggle checked={invertPitch} onCheckedChange={setInvertPitch} label={invertPitch ? 'INVERTED' : 'STANDARD'} />
            </div>
            <div className="settings-row settings-row--view">
              <span>视角</span>
              <div className="segmented">
                {VIEW_ORDER.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={cx('segmented__item', view === mode && 'is-active')}
                    onClick={() => setView(mode)}
                    aria-pressed={view === mode}
                    title={`${VIEW_LABEL[mode].zh} / ${VIEW_LABEL[mode].en}`}
                  >
                    {VIEW_LABEL[mode].code}
                  </button>
                ))}
              </div>
            </div>
            <p className="dialog-panel__note tv-mono">
              {view === 'chase'
                ? 'CHASE CAM · 自机模型与机动动效可见（O 键切换）'
                : 'COCKPIT CAM · 座舱框与全息 HUD（O 键切换）'}
            </p>
            <div className="settings-row">
              <span>音效 / 主题音乐</span>
              <Toggle
                checked={!audio.muted}
                onCheckedChange={(checked) => {
                  if (checked === audio.muted) audio.toggleMute();
                }}
                label={audio.muted ? 'MUTED' : 'ON'}
              />
            </div>
            <label className="settings-row settings-row--volume">
              <span>主音量</span>
              <span className="settings-volume">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(audio.volume * 100)}
                  onChange={(event) => audio.setVolume(Number(event.currentTarget.value) / 100)}
                  aria-label="主音量"
                />
                <em className="tv-mono">{Math.round(audio.volume * 100)}</em>
              </span>
            </label>
            <p className="dialog-panel__note tv-mono">
              {audio.started ? 'AUDIO CORE ONLINE' : 'AUDIO STARTS ON LAUNCH'} · WEBGL {quality.toUpperCase()}
            </p>
          </section>
          <section className="dialog-panel__section">
            <h3 className="tv-mono">FLIGHT AIDS / 辅助驾驶</h3>
            <FlightAidSettings
              assists={assists}
              master={assistMaster}
              onSetAssist={setAssist}
              onSetAll={setAllAssists}
            />
            <div className="dialog-panel__tip">
              <IconScan size={14} />
              <span>
                辅助只在你松杆的轴上出力，任何直接输入都会立刻夺回控制权；按 Y 可以随时整组开关。
              </span>
            </div>
          </section>
          <section className="dialog-panel__section">
            <h3 className="tv-mono">CONTROLS / 操作</h3>
            <ControlRecap />
          </section>
        </div>
        <div className="dialog-panel__actions">
          <Button variant="primary" size="lg" onClick={onResume} data-autofocus>
            继续飞行 / RESUME
          </Button>
          <Button variant="ghost" onClick={onRestart}>
            重新出击
          </Button>
          <Button variant="ghost" onClick={onExit}>
            返回开场
          </Button>
        </div>
        <div className="dialog-panel__foot tv-mono">
          <span>
            <Keycap>ESC</Keycap> 恢复
          </span>
          <span>THEVE // TACS-8 · SIMULATION CORE v0.5</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Help                                                                */
/* ------------------------------------------------------------------ */
export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const ref = useModalFocus(onClose);
  return (
    <div className="game-overlay game-overlay--dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <div className="dialog-panel dialog-panel--wide" ref={ref}>
        <div className="dialog-panel__head">
          <span className="tv-eyebrow">PILOT REFERENCE</span>
          <span className="tv-mono dialog-panel__code">QUICK CARD / 08</span>
        </div>
        <h2 id="help-title" className="dialog-panel__title">
          飞行手册
          <span>COCKPIT MANUAL</span>
        </h2>
        <div className="dialog-panel__grid dialog-panel__grid--three">
          <section className="dialog-panel__section">
            <h3 className="tv-mono">CONTROLS / 操作</h3>
            <ControlRecap />
          </section>
          <section className="dialog-panel__section">
            <h3 className="tv-mono">MANOEUVRES / 机动</h3>
            <ManeuverRecap />
            <div className="dialog-panel__tip">
              <IconScan size={14} />
              <span>
                C / X 按住持续生效；Z V B N K 为一次性动作，动作期间由飞控接管，结束后立刻交还操纵。
              </span>
            </div>
          </section>
          <section className="dialog-panel__section">
            <h3 className="tv-mono">TACTICS / 战术提示</h3>
            <ol className="help-tips">
              <li>
                <strong>先打干扰机，再打别人。</strong>
                VESPER 电子战机只要活着，锁定速度就只有一半。看到紫色涂装优先处理。
              </li>
              <li>
                <strong>把机炮留给护航，把导弹留给巨兽。</strong>
                八架敌机分三波进来，每波抵达时都会补给弹药；护盾节点很吃导弹，但机炮也能磨。
              </li>
              <li>
                <strong>热焰弹是保命键，但要看时机。</strong>
                RWR 告警后按 F：四发弹体带惯性抛出，任何从 130 m 内掠过的导弹都会被引开——
                早一秒放也有用，晚一秒放才有用。
              </li>
              <li>
                <strong>高G转弯换角度，减速板换位置。</strong>
                咬不住时按住 C 收紧盘旋，被咬住时按 X 让他冲前。
              </li>
              <li>
                <strong>别把机头停在重装机的炮口前。</strong>
                它的转向很差，但 13 dps 的机炮会在你停留的两秒里把机体打穿。
              </li>
              <li>
                <strong>LEVIATHAN 是一道问答题，不是血条。</strong>
                近防炮要侧向掠袭、齐射要放热焰弹、脉冲要脱离千米、主炮要横向脱离炮轴；
                舰体是实心的，撞上去掉 45% 结构。
              </li>
            </ol>
          </section>
          <section className="dialog-panel__section">
            <h3 className="tv-mono">THREAT DB / 敌机识别</h3>
            <ul className="help-roster">
              {ENEMY_ROSTER.map(([code, zh, role, en]) => (
                <li key={code}>
                  <b className="tv-mono">{code}</b>
                  <div>
                    <strong>{zh}</strong>
                    <small>{role}</small>
                  </div>
                  <em className="tv-mono">{en}</em>
                </li>
              ))}
            </ul>
            <div className="dialog-panel__tip">
              <IconWarning size={14} />
              <span>
                <strong className="tv-mono">LEVIATHAN ATTACK BOOK</strong>
                {BOSS_ATTACKS.map(([code, zh, counter]) => (
                  <em key={code} className="help-attack">
                    <b className="tv-mono">{code}</b>
                    {zh} — {counter}
                  </em>
                ))}
              </span>
            </div>
          </section>
        </div>
        <div className="dialog-panel__tip dialog-panel__tip--auto">
          <IconScan size={14} />
          <span>
            <strong className="tv-mono">AUTO ACE / 全自动皇牌模式</strong>
            按 G 把杆交给飞控：它会自己升空、自己选目标、自己在正确的时机做眼镜蛇、
            库尔比特与殷麦曼，把整场任务打完；被击落会在几秒后重新升空。
            它用的每一项操作都与你手动时完全相同——同样的飞行模型、同样的弹药、同样的评分，
            LEVIATHAN 的四种攻击它也靠同样的机动躲。
          </span>
        </div>
        <div className="dialog-panel__tip dialog-panel__tip--auto">
          <IconView size={14} />
          <span>
            <strong className="tv-mono">VIEW / 视角</strong>
            按 O（或屏幕控制台的 VIEW 模块）在座舱视角与第三人称跟随视角之间切换。
            外部视角会渲染 LUMEN 1 本机、可动的操纵面、加力尾焰与高G时的翼尖水汽，
            做眼镜蛇、库尔比特或桶滚时镜头会拉开并滞后一拍，机动动作因此在画面里读得出来。
          </span>
        </div>
        <div className="dialog-panel__actions">
          <Button variant="primary" onClick={onClose} data-autofocus>
            返回座舱 / RESUME
          </Button>
        </div>
        <div className="dialog-panel__foot tv-mono">
          <span>
            <Keycap>H</Keycap> 随时呼出
          </span>
          <span>减少动态效果请遵循系统设置</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Debrief                                                             */
/* ------------------------------------------------------------------ */
export interface DebriefOverlayProps {
  snapshot: CockpitSnapshot;
  best: 'S' | 'A' | 'B' | 'C' | null;
  onRetry: () => void;
  onExit: () => void;
}

export function DebriefOverlay({ snapshot, best, onRetry, onExit }: DebriefOverlayProps) {
  const success = snapshot.phase === 'complete';
  const stats = snapshot.mission.stats;
  const accuracy =
    stats.missilesFired > 0 ? Math.round((stats.missilesHit / stats.missilesFired) * 100) : 0;
  const ref = useModalFocus(noop);
  const statRows: Array<[string, string, string]> = [
    ['SCORE', stats.score.toLocaleString('en-US'), '总分'],
    ['KILLS', String(stats.kills), '击落'],
    ['ACCURACY', `${accuracy}%`, '命中率'],
    ['DAMAGE', String(stats.damageTaken), '战损'],
    ['MISSILES', `${stats.missilesHit}/${stats.missilesFired}`, '导弹命中'],
    ['TIME', formatClock(stats.elapsed), '任务时间'],
  ];
  return (
    <div
      className={cx('game-overlay', 'game-overlay--debrief', success ? 'is-success' : 'is-failed')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="debrief-title"
    >
      <div className="debrief-panel" ref={ref}>
        <span className="debrief-panel__watermark" aria-hidden="true">SUNSET SPEAR</span>
        <div className="debrief-panel__head">
          <span className="tv-mono">SORTIE RECORD / 08</span>
          <span className="tv-mono">{success ? 'RTB · CIRRUS TFS' : 'SIGNAL LOST'}</span>
        </div>
        <div className="debrief-panel__hero">
          <div className="debrief-panel__result">
            <span className="tv-eyebrow">{success ? 'MISSION COMPLETE' : 'MISSION FAILED'}</span>
            <h2 id="debrief-title" className="debrief-panel__title">
              {success ? '巨兽沉没' : '机体失控'}
              <span>{success ? 'LEVIATHAN DOWN' : 'AIRFRAME LOST'}</span>
            </h2>
            <p className="debrief-panel__copy">
              {success
                ? 'LEVIATHAN 的反应堆已经熄灭。落日空域重新回到 CIRRUS 手中。SENTINEL 正在引导你返航。'
                : 'LUMEN 1 信号消失在云海下方。僚机仍在呼叫，但战争不会等人。'}
            </p>
            <div className="debrief-panel__actions">
              <Button variant="primary" size="lg" onClick={onRetry} data-autofocus>
                {success ? '再次出击 / REPLAY' : '重新出击 / RETRY'}
              </Button>
              <Button variant="ghost" onClick={onExit}>
                返回开场
              </Button>
            </div>
          </div>
          <div className="debrief-panel__rank">
            <span className="tv-mono">COMBAT RATING</span>
            <div className="debrief-panel__rank-letter">{success ? stats.rank ?? 'C' : 'X'}</div>
            <div className="debrief-panel__rank-foot tv-mono">
              <span>BEST {best ?? '—'}</span>
              <span>{success ? 'RESOLVED' : 'UNRESOLVED'}</span>
            </div>
            <div className="debrief-panel__stamp" aria-hidden="true">
              {success ? 'SUNSET SPEAR' : 'SIGNAL LOST'}
            </div>
          </div>
        </div>
        <dl className="debrief-panel__stats">
          {statRows.map(([label, value, zh]) => (
            <div key={label}>
              <dt className="tv-mono">{label}</dt>
              <dd className="tv-mono">{value}</dd>
              <span>{zh}</span>
            </div>
          ))}
        </dl>
        <div className="debrief-panel__foot">
          <span className="tv-mono">OP.08 / SUNSET SPEAR</span>
          <span className="tv-mono">
            {success ? '护盾节点已摧毁 · 核心贯穿' : '飞行记录已封存'}
          </span>
          <span className="tv-mono">
            <IconRadar size={11} /> SENTINEL LINK CLOSED
          </span>
        </div>
      </div>
    </div>
  );
}
