import { useEffect } from 'react';
import { Button, IconArrowRight, IconRadar, IconSoundOn, IconWarning, Keycap } from '@theve/ui';
import { Brand } from '../brand';
import { BeastSilhouette, JetSilhouette } from '../components/Silhouettes';
import type { Route } from '../App';

export interface AttractPageProps {
  onNavigate: (route: Route) => void;
}

const briefRows = [
  ['THEATER / 战区', '落日空域 · 08'],
  ['CALLSIGN / 呼号', 'LUMEN 1'],
  ['WINGMAN / 僚机', 'LUMEN 2'],
  ['THREAT / 威胁', 'LEVIATHAN-CLASS'],
  ['WEATHER / 气象', '黄昏 · 能见度 40 KM'],
];

const objectives = [
  ['01', '拦截 VESPER 编队', 'INTERCEPT'],
  ['02', '摧毁护盾节点', 'SHIELD NODES'],
  ['03', '突入巨兽核心', 'STRIKE THE CORE'],
];

export function AttractPage({ onNavigate }: AttractPageProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'Enter' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onNavigate('cockpit');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNavigate]);

  return (
    <main className="attract" id="main-content">
      <div className="attract__bg" aria-hidden="true">
        <div className="attract__sun" />
        <div className="attract__sun-flare" />
        <div className="attract__horizon" />
        <div className="attract__cloud attract__cloud--far" />
        <div className="attract__cloud attract__cloud--mid" />
        <div className="attract__cloud attract__cloud--near" />
        <BeastSilhouette className="attract__beast" />
        <div className="attract__jets">
          <span className="attract__contrail attract__contrail--a" />
          <JetSilhouette className="attract__jet attract__jet--a" />
          <span className="attract__contrail attract__contrail--b" />
          <JetSilhouette className="attract__jet attract__jet--b" />
        </div>
        <div className="attract__grid" />
        <div className="attract__haze" />
      </div>

      <div className="attract__canopy" aria-hidden="true">
        <span className="attract__strut attract__strut--left" />
        <span className="attract__strut attract__strut--right" />
        <span className="attract__arch" />
        <span className="attract__dash" />
        <span className="attract__dash-line" />
        <span className="attract__glassflare" />
      </div>
      <span className="attract__scan" aria-hidden="true" />
      <span className="tv-grain attract__grain" aria-hidden="true" />
      <span className="attract__vignette" aria-hidden="true" />

      <header className="attract__top">
        <Brand />
        <div className="attract__top-meta">
          <span className="attract__live">
            <i aria-hidden="true" />
            SYSTEM READY
          </span>
          <span className="attract__top-rule" aria-hidden="true" />
          <a className="attract__nav-link" href="#/systems">
            <span>02</span> SYSTEMS / 图鉴
          </a>
          <a className="attract__nav-link attract__nav-link--primary" href="#/cockpit">
            <span>01</span> COCKPIT
          </a>
        </div>
      </header>

      <div className="attract__content">
        <section className="attract__hero">
          <div className="attract__eyebrow">
            <span className="attract__eyebrow-index">OP. 08</span>
            <span className="attract__eyebrow-line" aria-hidden="true" />
            <span>CIRRUS TASK FORCE · SUNSET THEATER</span>
          </div>
          <h1 className="attract__title">
            <span className="attract__title-ghost" aria-hidden="true">
              SUNSET
            </span>
            <span>SUNSET</span>
            <span className="attract__title-second">
              SPEAR<span className="attract__title-dot">.</span>
            </span>
          </h1>
          <div className="attract__title-zh">
            <span>落日之矛</span>
            <i aria-hidden="true" />
            <small>WINGS OF THEVE // TACTICAL AVIONICS</small>
          </div>
          <p className="attract__lede">
            黄昏平流层，云海之上。你坐在 LUMEN 1 的座舱里，面前是最后一片自由空域，
            雷达边缘，是名为 LEVIATHAN 的战争巨兽。锁定、发射、呼吸——这是献给天空的战术界面。
          </p>
          <div className="attract__actions">
            <Button
              variant="primary"
              size="lg"
              icon={<IconArrowRight size={16} />}
              kbd="ENTER"
              onClick={() => onNavigate('cockpit')}
            >
              进入座舱 / ENGAGE
            </Button>
            <Button
              variant="ghost"
              size="lg"
              icon={<IconRadar size={16} />}
              onClick={() => onNavigate('systems')}
            >
              系统图鉴 / SYSTEMS
            </Button>
          </div>
          <div className="attract__meta">
            <span className="attract__meta-item">
              <i aria-hidden="true" /> 第一人称座舱 / THREE.JS
            </span>
            <span className="attract__meta-item">
              <IconSoundOn size={12} /> 程序化主题音效
            </span>
            <span className="attract__meta-item">REACT 19 · TYPESCRIPT · ZERO UI DEPS</span>
          </div>
        </section>

        <aside className="attract__brief" aria-label="任务简报">
          <div className="attract__brief-stamp" aria-hidden="true">
            CIRRUS
            <span>TFS-08</span>
          </div>
          <div className="attract__brief-head">
            <span>
              <i aria-hidden="true" /> MISSION BRIEF
            </span>
            <em>SECRET // 08</em>
          </div>
          <h2 className="attract__brief-title">
            SUNSET SPEAR
            <span>落日之矛</span>
          </h2>
          <p className="attract__brief-copy">
            深入 VESPER 防空识别区，击落拦截编队，并在 LEVIATHAN 完成充能前摧毁其反应堆核心。
          </p>
          <dl className="attract__brief-list">
            {briefRows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="attract__brief-objectives">
            {objectives.map(([index, zh, en]) => (
              <div key={index} className="attract__brief-objective">
                <span className="tv-mono">{index}</span>
                <strong>{zh}</strong>
                <small className="tv-mono">{en}</small>
              </div>
            ))}
          </div>
          <div className="attract__brief-threat">
            <IconWarning size={16} />
            <div>
              <strong>MASSIVE CONTACT</strong>
              <span>战争巨兽 · LEVIATHAN</span>
            </div>
            <span className="attract__brief-threat-code tv-mono">CLS-08</span>
          </div>
          <Button
            variant="primary"
            block
            icon={<IconArrowRight size={14} />}
            onClick={() => onNavigate('cockpit')}
          >
            开始任务 / LAUNCH
          </Button>
          <div className="attract__brief-foot">
            <span className="tv-mono">
              <IconSoundOn size={10} /> AUDIO · PROCEDURAL
            </span>
            <span className="tv-mono">BEST WITH HEADPHONES</span>
          </div>
          <div className="attract__brief-corners" aria-hidden="true" />
        </aside>
      </div>

      <footer className="attract__bottom">
        <div className="attract__bottom-left">
          <span className="tv-mono">THEVE // TACS-8</span>
          <span className="attract__bottom-rule" aria-hidden="true" />
          <span>AN ORIGINAL UI HOMAGE INSPIRED BY ACE COMBAT 8: WINGS OF THEVE</span>
        </div>
        <div className="attract__bottom-center tv-mono">
          <span>36° 12′ N · 142° 08′ E</span>
          <span className="attract__bottom-sep">/</span>
          <span>CRUISE 25,500 FT</span>
          <span className="attract__bottom-sep">/</span>
          <span>WIND 270/08</span>
        </div>
        <div className="attract__bottom-right">
          <span>
            <Keycap>W</Keycap>
            <Keycap>S</Keycap> 俯仰
          </span>
          <span>
            <Keycap>空格</Keycap> 发射
          </span>
          <span className="attract__bottom-version">V0.4.0</span>
        </div>
      </footer>
    </main>
  );
}
