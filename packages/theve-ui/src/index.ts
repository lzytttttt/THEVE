import './styles/index.css';

export * from './primitives';
export * from './icons';
export * from './hud';
export type * from './sim/types';
export { sunsetSpearScenario, createDemoScenario } from './sim/scenario';
export { CockpitEngine } from './sim/engine';
export {
  ASSIST_ORDER,
  ASSISTS,
  DEFAULT_ASSISTS,
  buildAssistStatus,
  normalizeAssists,
  solveAssists,
} from './sim/assists';
export {
  checkManeuverAvailability,
  buildManeuverStatus,
  isManeuverId,
  MANEUVER_ORDER,
  MANEUVERS,
} from './sim/maneuvers';
export {
  countRoster,
  createAIState,
  describeWave,
  enemyPriority,
  enemyProfile,
  ENEMIES,
  ENEMY_ORDER,
  isEnemyId,
  resolveEnemyId,
  rosterPoints,
  SHOWCASE_ORDER,
  SHOWCASE_PLAYS,
  styleRating,
  waveBriefing,
  waveReady,
} from './sim/enemies';
export type {
  EnemyGunFit,
  EnemyMissileFit,
  EnemyProfile,
  EnemySilhouette,
  ShowcasePlay,
  WaveGate,
  WaveCallout,
} from './sim/enemies';
export {
  autoPilotCondition,
  autoPilotShown,
  autoPilotStyle,
  AUTO_MODE_LABEL,
  createAutoPilotMemory,
  resetAutoPilotMemory,
  solveAutoPilot,
} from './sim/autopilot';
export type {
  AutoPilotCommand,
  AutoPilotContact,
  AutoPilotMemory,
  AutoPilotPlayEvent,
  AutoPilotThreat,
  AutoPilotWorld,
} from './sim/autopilot';
export {
  CockpitProvider,
  useCockpit,
  useCockpitSelector,
  useCockpitEngine,
  useCockpitActions,
  useCockpitSettings,
  useAudio,
} from './sim/CockpitProvider';
export type {
  CockpitActions,
  CockpitAudio,
  CockpitProviderProps,
  CockpitQuality,
  CockpitSettingsValue,
} from './sim/CockpitProvider';
export { useCockpitControls } from './sim/useCockpitControls';
export type { CockpitControlOptions } from './sim/useCockpitControls';
export { AudioEngine } from './audio/AudioEngine';
export {
  barSeconds,
  CHORD_VOICINGS,
  chordForBar,
  chordNameForBar,
  degreeToMidi,
  midiToFreq,
  PHRASES,
  phraseForBar,
  phraseNoteToMidi,
  SCORE_SECTIONS,
  SECTION_ORDER,
  selectSection,
  TONIC,
} from './audio/score';
export type { Phrase, PhraseNote, ScoreSection, SectionId } from './audio/score';
