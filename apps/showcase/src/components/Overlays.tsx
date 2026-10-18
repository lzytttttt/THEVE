import { useEffect, useRef } from 'react';
import type { CockpitAudio, CockpitQuality, CockpitSnapshot } from '@theve/ui';
import {
  Button,
  IconArrowRight,
  IconCheck,
  IconClose,
  IconFlame,
  IconMissile,
  IconRadar,
  IconScan,
  IconWarning,
  Keycap,
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
  ['SPACE', '发射', 'FIRE'],
  ['J', '机炮', 'GUN'],
  ['TAB', '切换目标', 'TARGET'],
  ['F', '热焰弹', 'FLARE'],
  ['P / ESC', '暂停', 'PAUSE'],
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
      {CONTROLS.slice(0, dense ? 6 : 9).map(([keys, zh, en]) => (
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

/* ------------------------------------------------------------------ */
/* Briefing                                                            */
/* ------------------------------------------------------------------ */
export interface BriefingOverlayProps {
  onLaunch: () => void;
  onExit: () => void;
  muted: boolean;
}

export function BriefingOverlay({ onLaunch, onExit, muted }: BriefingOverlayProps) {
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
              LUMEN 1，VESPER 编队已经越过落日空域的中线。你的任务是撕开他们的护航，
              在 LEVIATHAN 完成核心充能之前，把两枚护盾节点从它的脊背上摘下来。
              云海之上没有第二道防线。
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
                    <strong>拦截 VESPER 编队</strong>
                    <small className="tv-mono">INTERCEPT THE VESPER FLIGHT</small>
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
                  LEVIATHAN-CLASS AERIAL DREADNOUGHT · 注意弹幕预警，热焰弹可以救你一命。
                </span>
              </div>
            </div>
            <div className="brief-panel__controls">
              <span className="brief-panel__controls-title tv-mono">QUICK CONTROLS</span>
              <ControlRecap dense />
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
            <div className="brief-panel__hint tv-mono">
              <Keycap>ENTER</Keycap> 开始任务
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
  onResume,
  onRestart,
  onExit,
}: PauseOverlayProps) {
  const ref = useModalFocus(onResume);
  return (
    <div className="game-overlay game-overlay--dialog" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <div className="dialog-panel" ref={ref}>
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
        <div className="dialog-panel__grid">
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
            <h3 className="tv-mono">FLIGHT CONTROLS / 操作</h3>
            <ControlRecap />
            <div className="dialog-panel__tip">
              <IconScan size={14} />
              <span>按住空格连续发射导弹？不，先锁定，再呼吸。热焰弹对来袭导弹有效。</span>
            </div>
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
          <span>THEVE // TACS-8 · SIMULATION CORE</span>
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
        <div className="dialog-panel__grid">
          <section className="dialog-panel__section">
            <h3 className="tv-mono">CONTROLS / 操作</h3>
            <ControlRecap />
          </section>
          <section className="dialog-panel__section">
            <h3 className="tv-mono">TACTICS / 战术提示</h3>
            <ol className="help-tips">
              <li>
                <strong>先锁定，后发射。</strong>
                保持目标在准星内约 1 秒；一旦锁定，只要目标还在前方就不会丢失。
              </li>
              <li>
                <strong>热焰弹是保命键。</strong>
                RWR 告警后按 F，60% 概率诱骗来袭导弹。
              </li>
              <li>
                <strong>护盾节点只吃导弹。</strong>
                机炮可以补刀，但优先把 AAM 留给巨兽的弱点。
              </li>
              <li>
                <strong>注意弹幕预警。</strong>
                FLAK BURST 出现后立刻滚转脱离，不要直线飞行。
              </li>
            </ol>
          </section>
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
