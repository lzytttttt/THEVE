# THEVE // TACS-8

> 座舱航电设计系统 × 可玩空战 Showcase  
> An original cockpit avionics UI kit and playable air-combat showcase inspired by
> **ACE COMBAT 8: WINGS OF THEVE**.

![THEVE attract screen](docs/screenshots/00-attract-1920.png)

THEVE // TACS-8 把电影化空战的第一人称座舱拆解成一套 React + TypeScript 组件库：
近黑金属、切角与磷光刻度构成的 HUD，three.js 绘制的黄昏平流层与战争巨兽，
以及全部由 WebAudio 实时合成的配乐、音效与打击反馈。Showcase 里你可以真正坐进 LUMEN 1 的座舱，
锁定 VESPER 编队，穿过弹幕，把 LEVIATHAN 的护盾节点逐个摘下来。

所有美术、机体、巨兽、文案与声音都是原创 / 程序化生成；本项目不使用任何官方素材。

---

## 快速开始

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5173
```

生产构建与预览：

```bash
pnpm build        # 先构建 @theve/ui，再构建 @theve/showcase
pnpm preview      # http://127.0.0.1:4173
```

校验与测试：

```bash
pnpm typecheck
pnpm test
pnpm verify:ui    # Playwright 冒烟 + docs/screenshots；需先运行 dev 或 preview
# 针对 preview 验证：PREVIEW_URL=http://127.0.0.1:4173/ pnpm verify:ui
```

环境：Node 22+、pnpm 11+、Chrome / Edge（WebGL2 + WebAudio）。首次构建需要联网安装依赖；
运行时不请求远程字体、图片或音频。

---

## 体验流程

1. **ATTRACT / 开场** — 落日云海、巨兽剪影、任务简报卡与电影化标题。
2. **BRIEFING / 任务简报** — 目标、载具、威胁档案与操作速查。
3. **BOOT / 航电自检** — 2.8 秒冷启动序列，可跳过。
4. **FIRST FLIGHT CHECK / 简要操作说明** — 进入任务后左下角出现的 7 项检查单，会随着你真的做出动作逐条打勾并自动收起。
5. **DOGFIGHT / 制空** — 迎击 VESPER 编队；锁定、发射、热焰弹规避，用七种战斗机机动抢位。
6. **LEVIATHAN / 战争巨兽** — 击落 2 架敌机后触发；摧毁两具护盾节点，再攻击暴露的反应堆核心。
7. **DEBRIEF / 结算** — 评分 S / A / B / C、命中率、战损、任务时间与最佳评级（localStorage）。

任务失败后可直接重试；暂停菜单提供画质、反转俯仰、辅助驾驶逐项开关、音量与静音设置。

---

## 操作

| 输入 | 动作 |
| --- | --- |
| `W` / `S` | 俯仰（默认 S 拉杆抬头，可在暂停菜单反转） |
| `A` / `D` | 滚转 |
| `Q` / `E` | 偏航 |
| `Shift` / `Ctrl` | 加 / 减油门；滚轮也可调整 |
| `Space` | 发射当前武器（AAM 需锁定） |
| `J` | 机炮（按住连射） |
| `Tab` / `T` | 切换目标 |
| `F` | 热焰弹 |
| `1` / `2` | 选择 AAM / GUN |
| `Y` | 辅助驾驶总开关 |
| `M` | 静音 |
| `P` / `Esc` | 暂停 |
| `H` | 飞行手册 |
| 鼠标拖拽 | 虚拟驾驶杆 |
| 屏幕控制台 | 完整触屏可玩：油门、武器、机动、辅助、FIRE、FLARE、TARGET |

### 战斗机机动（v0.2）

| 输入 | 机动 | 说明 |
| --- | --- | --- |
| `C`（按住） | 高G转弯 HIGH-G TURN | 操纵面权限 ×1.55，转弯更紧，掉速与过载都更高（上限 9.8G） |
| `X`（按住） | 减速板 AIRBRAKE | 约 130 m/s² 的额外阻力，用于逼敌机冲前或收半径 |
| `Z` | 眼镜蛇机动 PUGACHEV COBRA | 1.7 秒内上仰到 ~112°；速度矢量几乎不变，咬尾者会直接冲前 |
| `V` | 桶滚 BARREL ROLL | 完整 360° 螺旋滚转，航向基本不变，55% 概率甩掉来袭导弹 |
| `B` | 破S机动 SPLIT-S | 半滚倒转后下扣半筋斗：掉头 180° 并把高度换成速度 |
| `N` | 殷麦曼翻转 IMMELMANN | 半筋斗上升后半滚改平：掉头 180° 同时抢回高度 |
| `K` | 库尔比特 KULBIT | 2.6 秒内以极小半径完成 360° 筋斗，代价是几乎全部动能 |

按住类机动跟随操纵杆即时生效；一次性机动由飞控按预设剖面接管姿态，动作结束的瞬间把操纵权交回，并自动把姿态归一化回正常包线（俯仰 ±77°）。

### 辅助驾驶（v0.2，默认开启）

| 代号 | 名称 | 行为 |
| --- | --- | --- |
| `ATT` | 姿态辅助 | 松杆时消除滚转漂移；接近平飞时把机翼摆正。压着坡度时不会跟你抢杆 |
| `STG` | 目标引导 | 目标在机头前方 ±74° 内时轻微带杆（偏航 ≤0.34、俯仰 ≤0.26），把敌机送进 12° 锁定锥 |
| `THR` | 自动油门 | 松手 1.6 秒后自动补油门保持交战速度；**只会加不会减**，绝不违背你的油门指令 |
| `ALT` | 低空保护 | 1300 m 提醒、820 m 告警、520 m 以下柔和拉起 |

设计约束：辅助只在你**没有操作的那根轴**上出力（自由度按输入幅度线性衰减），任何直接输入都会瞬间夺回控制权；按 `Y` 可以整组开关，暂停菜单可以逐项开关，设置持久化到 localStorage。

竖屏手机显示横屏提示；横屏手机使用精简 HUD 与控制台。全屏按钮位于右上角。

---

## 视觉与声音

**关键词：** 黄昏平流层 / 近黑金属 / 磷光青 / 琥珀锁定 / 红色告警 / 战术文档。

| Token | 值 | 用途 |
| --- | --- | --- |
| `--tv-void` | `#04070C` | 座舱底 |
| `--tv-deep` | `#07131D` | 面板底 |
| `--tv-cyan` | `#63F3FF` | 主 HUD / 可操作 |
| `--tv-ice` | `#E8F8FC` | 主数据 |
| `--tv-amber` | `#FFB547` | 锁定 / 照射 / 注意 |
| `--tv-red` | `#FF4D5A` | 敌机 / 告警 |
| `--tv-green` | `#74FFB0` | 僚机 / 友军 |
| `--tv-sun` | `#FF7A3D` | 落日 / 地平线 |

字体使用系统栈：Bahnschrift / DIN 类窄体用于标题，Cascadia Mono / JetBrains Mono 类等宽用于数据，
中文使用 Noto Sans / 微软雅黑回退。没有字体下载，没有 CDN 依赖。

**three.js 座舱：** 固定在相机上的座舱框与切角玻璃、程序化天空 shader、FBM 云海、
近场云团、低多边形敌机 / 僚机、可旋转雷达的空中无畏舰、对象池化爆炸与曳光弹。
v0.3 起战场本身也在演戏：远景弹幕与曳光弹持续扫过地平线，受创机拖着烟迹，
爆炸会用一盏池化点光源真的照亮云层。3D 在独立 rAF 中运行，不经过 React；
模拟以 60Hz 推进，只以 30Hz 向 React 发布快照。

**飞行模型（v0.2 手感重做）：** 操纵面权限随动压（速度）缩放，滚转用角加速度 + 阻尼产生机翼惯量，
俯仰走一阶滞后指令，转弯由坡度升力自动协调并叠加滚转协调舵；爬升掉速、俯冲增速，
拉杆与滚转产生诱导阻力，过载由俯仰角速度与速度实时积分。失速地板 150 m/s，
高速上限 330 m/s（加力 0.88 油门以上）。

**打击感（v0.3）：** 命中会有四道冰白刻线在准星上炸开并附上伤害数字，击坠时整圈点亮；
机炮每发都有炮口闪光与金属火花，护盾节点会把炮弹弹开成冷色涟漪；
挨打时 HUD 外圈出现指向来袭方向的扇区，镜头按方位被顶一下。
所有反馈都是 `age` 的纯函数——暂停时它们就停在原地，掉帧也不会和那一枪错位。

**WebAudio：** 全部程序化，没有音频文件。v0.3 把配乐换成一台真正的编曲机：
D 小调、六个段落（翱翔 / 制空 / 强攻 / 巨兽 / 凯旋 / 挽歌）、十条写好的旋律、
太鼓与弦乐固定音型、程序化生成的厅堂混响，只在小节线上换段。
音效层同样重做：机炮分瞬态 / 音体 / 机械三层，命中是金属短鸣，
爆炸按距离延迟并按真实声速衰减高频，导弹掠过时播放多普勒呼啸。
首次 `LAUNCH` 用户手势才创建 AudioContext；静音、画质与俯仰设置会持久化。

更多设计决策与迭代记录见 [`docs/DESIGN.md`](docs/DESIGN.md)。

---

## 轻量组件库

`@theve/ui` 的运行时 peer 依赖只有 React / ReactDOM / three；没有状态库、动画库或图标库。

| 入口 | 内容 | 是否依赖 three |
| --- | --- | --- |
| `@theve/ui` | tokens、primitives、HUD、飞行模拟、音频、Provider/hooks | 否 |
| `@theve/ui/three` | `CockpitViewport`、`CockpitScene`、目标投影 | 是 |
| `@theve/ui/styles.css` | 全部设计令牌与组件样式 | — |

### 最小用法

```tsx
import {
  CockpitProvider,
  CockpitHud,
  CockpitControls,
  useCockpitControls,
} from '@theve/ui';
import { CockpitViewport } from '@theve/ui/three';
import '@theve/ui/styles.css';

function CockpitExperience() {
  useCockpitControls({ onPause: () => {}, onHelp: () => {} });
  return (
    <CockpitProvider audio>
      <CockpitViewport />
      <CockpitHud />
      <CockpitControls />
    </CockpitProvider>
  );
}
```

`CockpitProvider` 可传入自定义 `scenario`（`sunsetSpearScenario` / `createDemoScenario`）。
HUD 组件均可单独复用；组合版 `CockpitHud` 只是本项目 Showcase 的默认布局。

### 组件概览（36+）

- **基础**：`TheveRoot` `Panel` `Button` `IconButton` `Tag` `Readout` `Meter` `Keycap` `Toggle` `StatusLamp` `Divider` `HazardStripe`
- **HUD**：`CockpitHud` `HeadingTape` `PitchLadder` `FlightPathMarker` `SpeedTape` `AltitudeTape` `TargetMarker` `LockReticle` `MissileWarning` `RadarScope` `WeaponRack` `CommsFeed` `WingmanStatus` `BossBar` `ObjectiveTracker` `ScoreTicker` `DamageOverlay`
- **操纵与辅助（v0.2）**：`ManeuverRail` `ManeuverBanner` `AssistRail` `FlightAidStrip` `LockSteeringCue` `StartupChecklist` `GLoadMeter`
- **打击反馈（v0.3）**：`HitConfirm` `DamageDirection` `KillTicker` `CombatFeedbackLayer`
- **操作**：`CockpitControls`，内部组合油门、武器、机动、辅助、FIRE、热焰弹与目标切换
- **模拟**：`CockpitEngine`、`MANEUVERS`、`ASSISTS`、`TUTORIAL_STEPS`、`useCockpit`、`useCockpitActions`、`useCockpitEngine`、`useCockpitSettings`、`useAudio`、`useCockpitControls`
- **配乐（v0.3）**：`SCORE_SECTIONS` `SECTION_ORDER` `PHRASES` `selectSection` `phraseForBar` `chordForBar` `degreeToMidi` `midiToFreq`
- **3D**：`CockpitViewport`、`CockpitScene`（`getDebugInfo()` 供自动化测试）
- **音频**：`AudioEngine`（可在 Provider 外独立使用）

### 构建产物（以当前 lockfile 为准）

| 产物 | raw | gzip |
| --- | --- | --- |
| 核心入口 `dist/index.js` | 63.7 KB | 14.6 KB |
| three 入口 `dist/three.js` | 45.1 KB | 12.3 KB |
| 模拟/音频共享块 | 129.3 KB | 35.4 KB |
| 样式 `dist/theve.css` | 74.5 KB | 15.0 KB |

Showcase 首屏在构建时做了路由级 code split；cockpit 路由的 three 包单独加载，
配乐数据表单独成块（`score-*.js`），不进首屏。

---

## 可访问性

- 所有控制按钮可键盘到达，2px 青色 focus ring；暂停 / 帮助 / 结算对话框带焦点陷阱。
- 仪表使用 `role="meter"` 与 `aria-valuetext`；告警使用限流的 `role="alert"`；通讯使用 `aria-live="polite"`。
- 敌我、锁定与告警不只依赖颜色：同时使用形状、图标、文字与方向箭头。
- 七种机动、四项辅助与检查单均为真实 `<button>`，带中文 `aria-label` 与键盘 `aria-pressed` 状态。
- 打击反馈同样不只靠颜色：受击扇区带箭头、命中刻线带伤害数字、击坠记录带文字标签。
  机炮一秒能命中十几次，所以命中标记**不**朗读，只有击坠用 `role="log"` 播报。
- 支持 `prefers-reduced-motion`：关闭镜头抖动、镜头冲击、扫描线、机动横幅与检查单的切入动画，
  命中标记也退化为不缩放的静态刻线。
- 静音后，导弹告警、通讯与任务结果都有视觉替代。
- 竖屏提示可继续进入精简模式；横屏手机有专门的短屏 HUD 布局。

---

## 版本

| 版本 | 主题 | 内容 |
| --- | --- | --- |
| 0.1 | 座舱与世界观 | 设计令牌、HUD 组件、three.js 座舱、程序化音频、SUNSET SPEAR 任务 |
| 0.2 | 战机操作 | 七种战斗机机动、四项辅助驾驶、进入任务后的简要操作说明、飞行手感重做 |
| **0.3** | **音效与打击感** | **编曲式生成配乐（六段落 / 十条旋律）、战斗音效分层重做、命中与受击反馈、战场氛围层** |

---

## 目录

```
├─ apps/showcase/          # Vite + React Showcase（开场 / 座舱 / 图鉴）
├─ packages/theve-ui/      # 组件库、模拟、three 层、音频
├─ docs/
│  ├─ DESIGN.md            # 设计说明 / 令牌 / 场景与声音
│  └─ screenshots/         # Playwright 输出的验收截图
├─ scripts/verify-ui.mjs   # 冒烟测试 + 截图
└─ pnpm-workspace.yaml
```

**技术栈：** React 19.3 · TypeScript 5.9 · Vite 8.3 · three r186 · Vitest 5 · Playwright (system Chrome)。

---

## 验收截图

| | |
| --- | --- |
| ![Dogfight](docs/screenshots/03-dogfight-1920.png) | ![Hit confirm](docs/screenshots/14-hit-confirm-1920.png) |
| 制空：锁定 VESPER，检查单与辅助状态条 | v0.3 命中确认：准星上的刻线、伤害数字与连击计数 |
| ![Splash](docs/screenshots/15-splash-1920.png) | ![Damage bearing](docs/screenshots/16-damage-bearing-1920.png) |
| v0.3 击坠：爆炸、碎片与 SPLASH 记录 | v0.3 受击方位：指向来袭方向的扇区与告警 |
| ![Boss](docs/screenshots/04-boss-1920.png) | ![Debrief](docs/screenshots/07-debrief-1920.png) |
| 战争巨兽 LEVIATHAN 与护盾节点 | 任务结算 / S 评级 |

完整截图集（开场、启动、制空、命中确认、击坠、受击方位、高G转弯、眼镜蛇、巨兽、暂停、手册、Boss 登场、任务失败、系统图鉴、1366 / 390 / 横屏）在
[`docs/screenshots/`](docs/screenshots/)。

---

## 边界与非目标

- 这是设计实验与可玩 Showcase，不是《皇牌空战》的复刻；没有官方机体、Logo、音乐或美术。
- 飞行模型是街机化手感，不是真实气动；没有地形碰撞、多人联机或完整战役。
- 机动的姿态剖面是手工调参的脚本，不是真实飞控律；眼镜蛇 / 库尔比特只保留「姿态先动、速度矢量后动」这一条关键特征。
- 辅助驾驶不会在你正在操作的轴上出力，因此不会替你完成机动，也不会自动开火。
- 桌面 Chromium 为主要目标；Safari / Firefox 尽力兼容。WebGL 不可用时会退化为 CSS 黄昏 + 2D HUD。
- 音频必须在用户手势后启动；自动化无手势环境可能保持静默，但界面仍可用。
- 没有手柄支持；触屏与键鼠已覆盖全部核心操作。
- `window.__THEVE__` 是 Showcase 的调试桥（截图与冒烟测试使用），不是面向生产应用的接口。

## 原创说明

本项目以《皇牌空战8：希孚之翼》（ACE COMBAT 8: WINGS OF THEVE）的电影化空战气质为灵感，
世界观、呼号、机体、巨兽与全部视觉/声音资产均为原创。参考其公开的巨兽兵器、连锁破坏、
第一人称座舱方向：

- [ACE COMBAT 8: WINGS OF THEVE – Game Overview](https://www.bandainamcoent.com/news/ace-combat-8-wings-of-theve-game-overview)
- [PlayStation Blog – Annihilation Battle mode / story trailer](https://blog.playstation.com/2026/09/14/ace-combat-8-wings-of-theve-annihilation-battle-mode-confirmed-story-trailer-revealed/)
- [GameSpark – 巨大兵器与连锁破坏](https://www.gamespark.jp/article/2026/06/04/167407.html)

Licensed under the MIT License. See [`LICENSE`](LICENSE).
