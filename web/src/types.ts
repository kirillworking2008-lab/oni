// Типы данных среды разработки ONI PLR Studio Android (КИПиА Edition)

export type BlockCategory =
  | 'digital_io'
  | 'analog_io'
  | 'logic'
  | 'timers'
  | 'triggers_counters'
  | 'analog_kip'
  | 'display';

export type PinSignalType = 'digital' | 'analog';

export interface PinDefinition {
  id: string;
  label: string;
  nameRu: string;
  type: PinSignalType;
  invertible?: boolean;
  edgeMarker?: boolean;
  resetPriorityMarker?: boolean;
}

export interface ParamFieldDefinition {
  key: string;
  label: string;
  type: 'number' | 'select' | 'boolean' | 'text' | 'weekdays';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  defaultValue: number | string | boolean;
  help?: string;
}

export interface BlockTypeDefinition {
  type: string;
  codeLabel: string; // e.g. 'DI', 'DO', 'AND', 'RS', 'TON', 'PI'
  subSymbol?: string; // e.g. contact, gate, clock, pulse
  nameRu: string;
  shortDesc: string;
  category: BlockCategory;
  toolbarGroup: 'Co' | 'GF' | 'SF' | 'AF';
  colorKind: 'io_green' | 'logic_blue' | 'sf_blue';
  prefix: 'I' | 'Q' | 'M' | 'C' | 'AI' | 'AQ' | 'AM' | 'Hi' | 'Lo' | 'B';
  inputs: PinDefinition[];
  outputs: PinDefinition[];
  params: ParamFieldDefinition[];
  modbusBase?: number;
  showParamsOnCanvas?: boolean;
}

export type SimSwitchMode = 'toggle' | 'momentary_no' | 'momentary_nc';

export interface BlockInstance {
  id: string; // internal unique id
  type: string; // references BlockTypeDefinition.type
  channelIndex: number; // e.g. 1 -> I001 / Q001 / B001
  x: number;
  y: number;
  customName: string; // e.g. 'SB1 Пуск', 'KM1 Насос 1'
  comment: string;
  showParams: boolean;
  retentive: boolean;
  protectedBlock: boolean;
  invertedInputs: Record<string, boolean | undefined>; // pinId -> true if inverted (NOT bubble on input)
  params: Record<string, number | string | boolean | undefined>;
  simMode?: SimSwitchMode; // for DI blocks
}

export interface WireConnection {
  id: string;
  fromBlockId: string;
  fromPinId: string;
  toBlockId: string;
  toPinId: string;
  splitMode?: boolean; // cut/page-reference style like ONI PLR Studio scissors tool
  waypoints?: { x: number; y: number }[];
}

export interface CanvasNote {
  id: string;
  x: number;
  y: number;
  text: string;
  fontSize?: number;
}

export type AnalogSignalStandard = '0-10V' | '4-20mA' | '0-20mA' | 'Pt100';

export interface AnalogChannelConfig {
  channel: number; // 1..8
  tag: string; // e.g. 'PT101 Давление коллектора'
  standard: AnalogSignalStandard;
  minEng: number;
  maxEng: number;
  unit: string; // 'бар', '°C', '%', 'м³/ч'
}

// Ladder Diagram (LD / LAD) types for ONI PLC / CICON training
export type LdElementType =
  | 'NO'       // --| |-- Нормально открытый контакт
  | 'NC'       // --|/|-- Нормально закрытый контакт
  | 'P_EDGE'   // --|P|-- Передний фронт
  | 'COIL'     // --( )-- Обычная катушка
  | 'SET'      // --(S)-- Установка триггера
  | 'RESET'    // --(R)-- Сброс триггера
  | 'TON_LD'   // Таймер задержки включения
  | 'TOF_LD'   // Таймер задержки выключения
  | 'CTU_LD'   // Счётчик импульсов
  | 'CMP_GE'   // Сравнение >= (аналог)
  | 'CMP_LE';  // Сравнение <= (аналог)

export interface LdContactOrBox {
  id: string;
  kind: LdElementType;
  operand: string; // e.g. 'I1', 'I2', 'Q1', 'M1', 'T1', 'C1', 'AI1'
  comment?: string;
  preset?: number; // timer sec*100 or counter limit or analog threshold
}

export interface LdRung {
  id: string;
  title: string;
  mainSeries: LdContactOrBox[]; // contacts in main branch
  parallelBranch?: LdContactOrBox[]; // optional OR shunt branch across first contact(s) (самоподхват!)
  outputElement: LdContactOrBox; // right-side coil/function
}

// HMI Panel Elements (ONI Visual Studio style)
export type HmiWidgetType =
  | 'pushbutton'
  | 'selector'
  | 'lamp'
  | 'numeric_display'
  | 'slider_setpoint'
  | 'bar_gauge';

export interface HmiWidget {
  id: string;
  type: HmiWidgetType;
  label: string;
  binding: string; // e.g. 'I1', 'Q1', 'M1', 'AI1', 'AQ1', 'AM1', 'B1'
  x: number;
  y: number;
  width: number;
  height: number;
  color?: 'green' | 'red' | 'amber' | 'blue';
  momentary?: boolean;
  min?: number;
  max?: number;
  unit?: string;
}

export type PlantPresetId = 'none' | 'pump_station' | 'thermal_oven' | 'hvac_ahu' | 'conveyor_line';

export interface OniProject {
  version: string;
  name: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  controllerId: string;
  expansionIds: string[];
  activeLanguage: 'FBD' | 'LD';
  blocks: BlockInstance[];
  wires: WireConnection[];
  notes: CanvasNote[];
  analogConfigs: AnalogChannelConfig[];
  ldRungs: LdRung[];
  hmiWidgets: HmiWidget[];
  activePlant: PlantPresetId;
}

export interface BlockRuntimeState {
  digitalOutputs: Record<string, boolean>;
  analogOutputs: Record<string, number>;
  internalTimerSec: number;
  targetTimerSec: number;
  counterValue: number;
  integralAccum: number;
  prevTrigger: boolean;
  prevCnt: boolean;
  prevInputs: Record<string, boolean>;
  pulseIndex: number;
  pulsePhaseHigh: boolean;
  latchState: boolean;
  motorHoursSec: number;
  freqPulseTimestamps: number[];
  measuredFreqHz: number;
  rampCurrent: number;
}

export interface LcdDisplayState {
  active: boolean;
  lines: [string, string, string, string];
  backlight: 'green' | 'white' | 'amber' | 'red';
  sourceBlockLabel: string;
}

export interface ErcMessage {
  severity: 'info' | 'warning' | 'error';
  blockId?: string;
  text: string;
}
