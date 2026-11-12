import { BLOCK_DEF_MAP, formatBlockAddress, formatBlockHeaderLabel } from '../catalog/blocks';
import { getEffectiveIoLimits } from '../catalog/controllers';
import {
  AnalogChannelConfig,
  BlockInstance,
  BlockRuntimeState,
  ErcMessage,
  LcdDisplayState,
  OniProject,
} from '../types';

export interface ModbusRow {
  address: string;
  regType: 'Coil (0x)' | 'Discrete Input (1x)' | 'Input Reg (3x)' | 'Holding Reg (4x)';
  tag: string;
  description: string;
  valueText: string;
}

export function engToAdc(valEng: number, cfg: AnalogChannelConfig): number {
  const span = cfg.maxEng - cfg.minEng || 1;
  const norm = (valEng - cfg.minEng) / span; // 0..1
  if (cfg.standard === '4-20mA') {
    // 0..20 mA maps to 0..1000 counts -> 4 mA = 200, 20 mA = 1000
    const ma = 4 + norm * 16;
    return Math.round(Math.max(0, Math.min(1100, (ma / 20) * 1000)));
  }
  // 0-10V, 0-20mA, Pt100 -> 0..1000 across configured range
  return Math.round(Math.max(-200, Math.min(1100, norm * 1000)));
}

export function adcToEng(adc: number, cfg: AnalogChannelConfig): { eng: number; elecText: string; fault: string | null } {
  const span = cfg.maxEng - cfg.minEng || 1;
  if (cfg.standard === '4-20mA') {
    const ma = (adc / 1000) * 20;
    const norm = (ma - 4) / 16;
    const eng = cfg.minEng + norm * span;
    let fault: string | null = null;
    if (ma < 3.6) fault = 'ОБРЫВ ЛИНИИ (<3.6 мА)';
    else if (ma > 20.8) fault = 'ПЕРЕГРУЗКА (>20.8 мА)';
    return { eng: Number(eng.toFixed(2)), elecText: `${ma.toFixed(2)} мА`, fault };
  }
  if (cfg.standard === '0-20mA') {
    const ma = (adc / 1000) * 20;
    const eng = cfg.minEng + (adc / 1000) * span;
    return { eng: Number(eng.toFixed(2)), elecText: `${ma.toFixed(2)} мА`, fault: null };
  }
  if (cfg.standard === 'Pt100') {
    const eng = cfg.minEng + (adc / 1000) * span;
    const ohms = 100 + eng * 0.385;
    return { eng: Number(eng.toFixed(1)), elecText: `${ohms.toFixed(1)} Ом`, fault: adc < -50 || adc > 1050 ? 'ОБРЫВ RTD' : null };
  }
  // 0-10V
  const volts = (adc / 1000) * 10;
  const eng = cfg.minEng + (adc / 1000) * span;
  return { eng: Number(eng.toFixed(2)), elecText: `${volts.toFixed(2)} В`, fault: null };
}

function createInitialBlockState(block: BlockInstance): BlockRuntimeState {
  const startCnt = Number(block.params.startValue ?? 0);
  return {
    digitalOutputs: { Q: false },
    analogOutputs: { AQ: 0, CV: startCnt, OT: 0, FA: 0, Diff: 0 },
    internalTimerSec: 0,
    targetTimerSec: 0,
    counterValue: startCnt,
    integralAccum: 0,
    prevTrigger: false,
    prevCnt: false,
    prevInputs: {},
    pulseIndex: 0,
    pulsePhaseHigh: false,
    latchState: false,
    motorHoursSec: 0,
    freqPulseTimestamps: [],
    measuredFreqHz: 0,
    rampCurrent: 0,
  };
}

function timeParamToSec(val: number, unit: string | undefined): number {
  if (unit === 'm') return val * 60;
  if (unit === 'h') return val * 3600;
  return val;
}

export class OniPlcSimulator {
  public running = false;
  public paused = false;
  public scanCount = 0;
  public simTimeSec = 0;
  public lastScanDurationMs = 0.4;

  // Physical I/O tables (1-indexed: 1..32)
  public diState: Record<number, boolean> = {};
  public doState: Record<number, boolean> = {};
  public mState: Record<number, boolean> = {};
  public cKeyState: Record<number, boolean> = {}; // 1..6 front panel keys
  public aiRaw: Record<number, number> = {}; // 0..1000
  public aoRaw: Record<number, number> = {}; // 0..1000
  public amRaw: Record<number, number> = {};

  // Per-block runtime states keyed by block.id
  public blockStates: Record<string, BlockRuntimeState> = {};

  // Ladder diagram timer/counter internal states
  public ldStates: Record<string, { timer: number; count: number; prevIn: boolean; q: boolean }> = {};

  public lcdState: LcdDisplayState = {
    active: false,
    lines: ['ONI PLR-S ГОТОВ', 'Нажмите F3 Симул', 'Цикл: СТОП      ', '                '],
    backlight: 'green',
    sourceBlockLabel: 'СИСТЕМА',
  };

  // Oscilloscope ring buffer (up to 240 points)
  public traceHistory: {
    t: number;
    i1: number;
    i2: number;
    q1: number;
    q2: number;
    ai1: number;
    aq1: number;
  }[] = [];
  private lastTraceSampleTime = -1;

  constructor() {
    this.resetHardwareIo();
  }

  public resetHardwareIo() {
    for (let i = 1; i <= 24; i++) {
      this.diState[i] = false;
      this.doState[i] = false;
    }
    for (let i = 1; i <= 32; i++) this.mState[i] = false;
    for (let i = 1; i <= 6; i++) this.cKeyState[i] = false;
    for (let i = 1; i <= 8; i++) this.aiRaw[i] = 200; // default 4 mA = 0% on 4-20mA
    for (let i = 1; i <= 8; i++) this.aoRaw[i] = 0;
    for (let i = 1; i <= 16; i++) this.amRaw[i] = 0;
  }

  public start(project: OniProject) {
    this.running = true;
    this.paused = false;
    this.scanCount = 0;
    this.simTimeSec = 0;
    this.lastTraceSampleTime = -1;
    this.traceHistory = [];
    this.blockStates = {};
    this.ldStates = {};

    for (let i = 1; i <= 24; i++) this.doState[i] = false;
    for (let i = 1; i <= 32; i++) this.mState[i] = false;
    for (let i = 1; i <= 8; i++) this.aoRaw[i] = 0;
    for (let i = 1; i <= 16; i++) this.amRaw[i] = 0;

    // Initialize DI defaults: NC buttons start at 1 (closed contact in normal state!)
    for (const blk of project.blocks) {
      this.blockStates[blk.id] = createInitialBlockState(blk);
      if (blk.type === 'DI') {
        const mode = (blk.params.simSwitchMode as string) || blk.simMode || 'toggle';
        if (mode === 'momentary_nc') {
          this.diState[blk.channelIndex] = true;
        }
      }
    }

    // Run initial scan immediately so outputs settle at t=0
    this.step(project, 0);
  }

  public stop() {
    this.running = false;
    this.paused = false;
    this.lcdState = {
      active: false,
      lines: ['ONI PLR-S РЕДАКТ', 'Симулятор ОСТАН.', 'Нажмите F3 Пуск ', '                '],
      backlight: 'green',
      sourceBlockLabel: 'СИСТЕМА',
    };
  }

  public step(project: OniProject, dtSec: number) {
    const t0 = performance.now();
    this.simTimeSec += dtSec;
    this.scanCount += 1;

    if (project.activeLanguage === 'LD' && project.ldRungs.length > 0) {
      this.evaluateLadder(project, dtSec);
    } else {
      this.evaluateFbd(project, dtSec);
    }

    if (this.simTimeSec - this.lastTraceSampleTime >= 0.1 || this.traceHistory.length === 0) {
      this.lastTraceSampleTime = this.simTimeSec;
      this.traceHistory.push({
        t: Number(this.simTimeSec.toFixed(1)),
        i1: this.diState[1] ? 1 : 0,
        i2: this.diState[2] ? 1 : 0,
        q1: this.doState[1] ? 1 : 0,
        q2: this.doState[2] ? 1 : 0,
        ai1: this.aiRaw[1] ?? 0,
        aq1: this.aoRaw[1] ?? 0,
      });
      if (this.traceHistory.length > 200) {
        this.traceHistory.shift();
      }
    }

    this.lastScanDurationMs = Math.max(0.15, Number((performance.now() - t0).toFixed(2)));
  }

  private evaluateFbd(project: OniProject, dtSec: number) {
    const blocks = project.blocks;
    const wires = project.wires;

    // Ensure every block has state
    for (const b of blocks) {
      if (!this.blockStates[b.id]) {
        this.blockStates[b.id] = createInitialBlockState(b);
      }
    }

    // Build incoming wire lookup: `${toBlockId}:${toPinId}` -> WireConnection
    const incomingMap = new Map<string, (typeof wires)[number]>();
    for (const w of wires) {
      incomingMap.set(`${w.toBlockId}:${w.toPinId}`, w);
    }

    // Topological ordering (Kahn's algorithm with graceful cycle fallback)
    const blockById = new Map(blocks.map((b) => [b.id, b]));
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const b of blocks) {
      inDegree.set(b.id, 0);
      adj.set(b.id, []);
    }
    for (const w of wires) {
      if (blockById.has(w.fromBlockId) && blockById.has(w.toBlockId) && w.fromBlockId !== w.toBlockId) {
        adj.get(w.fromBlockId)!.push(w.toBlockId);
        inDegree.set(w.toBlockId, (inDegree.get(w.toBlockId) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) queue.push(id);
    }
    const orderedIds: string[] = [];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      orderedIds.push(curr);
      for (const nxt of adj.get(curr) ?? []) {
        const nd = (inDegree.get(nxt) ?? 1) - 1;
        inDegree.set(nxt, nd);
        if (nd <= 0 && !visited.has(nxt)) {
          queue.push(nxt);
        }
      }
    }
    // Append any blocks involved in feedback loops in left-to-right canvas order
    const remaining = blocks
      .filter((b) => !visited.has(b.id))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    for (const r of remaining) orderedIds.push(r.id);

    // Clear DO / AO accumulator maps so multiple or zero drivers behave predictably
    const nextDo: Record<number, boolean> = {};
    const nextAo: Record<number, number> = {};

    const readDigitalPin = (blk: BlockInstance, pinId: string, defaultWhenUnwired = false): { val: boolean; wired: boolean } => {
      const wire = incomingMap.get(`${blk.id}:${pinId}`);
      const inv = Boolean(blk.invertedInputs?.[pinId]);
      if (!wire) {
        const raw = defaultWhenUnwired;
        return { val: inv ? !raw : raw, wired: false };
      }
      const srcState = this.blockStates[wire.fromBlockId];
      const raw = Boolean(srcState?.digitalOutputs?.[wire.fromPinId] ?? srcState?.digitalOutputs?.Q ?? false);
      return { val: inv ? !raw : raw, wired: true };
    };

    const readAnalogPin = (blk: BlockInstance, pinId: string, fallback = 0): { val: number; wired: boolean } => {
      const wire = incomingMap.get(`${blk.id}:${pinId}`);
      if (!wire) return { val: fallback, wired: false };
      const srcState = this.blockStates[wire.fromBlockId];
      if (!srcState) return { val: fallback, wired: true };
      const val =
        srcState.analogOutputs?.[wire.fromPinId] ??
        srcState.analogOutputs?.AQ ??
        srcState.analogOutputs?.CV ??
        (srcState.digitalOutputs?.[wire.fromPinId] ? 1 : 0);
      return { val: Number.isFinite(val) ? val : fallback, wired: true };
    };

    const activeMsgs: { priority: number; lines: [string, string, string, string]; backlight: LcdDisplayState['backlight']; label: string }[] = [];

    for (const id of orderedIds) {
      const blk = blockById.get(id);
      if (!blk) continue;
      const st = this.blockStates[blk.id];
      const def = BLOCK_DEF_MAP[blk.type];
      if (!def) continue;

      switch (blk.type) {
        case 'DI': {
          const v = Boolean(this.diState[blk.channelIndex]);
          st.digitalOutputs.Q = v;
          break;
        }
        case 'DO': {
          const { val } = readDigitalPin(blk, 'In', false);
          st.digitalOutputs.Q = val;
          nextDo[blk.channelIndex] = Boolean(nextDo[blk.channelIndex] || val);
          break;
        }
        case 'M': {
          const { val, wired } = readDigitalPin(blk, 'In', false);
          if (wired) {
            this.mState[blk.channelIndex] = val;
          }
          st.digitalOutputs.Q = Boolean(this.mState[blk.channelIndex]);
          break;
        }
        case 'C': {
          st.digitalOutputs.Q = Boolean(this.cKeyState[blk.channelIndex]);
          break;
        }
        case 'HI': {
          st.digitalOutputs.Q = true;
          break;
        }
        case 'LO': {
          st.digitalOutputs.Q = false;
          break;
        }
        case 'AI': {
          const raw = Number(this.aiRaw[blk.channelIndex] ?? 0);
          st.analogOutputs.AQ = raw;
          break;
        }
        case 'AO': {
          const { val } = readAnalogPin(blk, 'In', 0);
          const clamped = Math.max(0, Math.min(1000, Math.round(val)));
          st.analogOutputs.AQ = clamped;
          nextAo[blk.channelIndex] = clamped;
          break;
        }
        case 'AM': {
          const { val, wired } = readAnalogPin(blk, 'In', 0);
          if (wired) {
            this.amRaw[blk.channelIndex] = Math.round(val);
          }
          st.analogOutputs.AQ = Number(this.amRaw[blk.channelIndex] ?? 0);
          break;
        }

        // ---- LOGIC GATES ----
        case 'AND':
        case 'NAND':
        case 'AND_EDGE':
        case 'NAND_EDGE': {
          let anyWiredOrInverted = false;
          let acc = true;
          for (const pin of def.inputs) {
            const wire = incomingMap.get(`${blk.id}:${pin.id}`);
            const inv = Boolean(blk.invertedInputs?.[pin.id]);
            if (wire) {
              anyWiredOrInverted = true;
              const raw = Boolean(this.blockStates[wire.fromBlockId]?.digitalOutputs?.[wire.fromPinId] ?? false);
              const v = inv ? !raw : raw;
              acc = acc && v;
            } else if (inv) {
              // Unwired pin explicitly inverted (0 inverted -> 1)
              anyWiredOrInverted = true;
              acc = acc && true;
            }
          }
          const andResult = anyWiredOrInverted ? acc : false;
          if (blk.type === 'AND') {
            st.digitalOutputs.Q = andResult;
          } else if (blk.type === 'NAND') {
            st.digitalOutputs.Q = anyWiredOrInverted ? !andResult : true;
          } else if (blk.type === 'AND_EDGE') {
            st.digitalOutputs.Q = andResult && !st.prevTrigger;
            st.prevTrigger = andResult;
          } else {
            // NAND_EDGE (falling edge of AND)
            st.digitalOutputs.Q = !andResult && st.prevTrigger;
            st.prevTrigger = andResult;
          }
          break;
        }

        case 'OR':
        case 'NOR': {
          let acc = false;
          for (const pin of def.inputs) {
            const { val, wired } = readDigitalPin(blk, pin.id, false);
            if (wired || blk.invertedInputs?.[pin.id]) {
              acc = acc || val;
            }
          }
          st.digitalOutputs.Q = blk.type === 'OR' ? acc : !acc;
          break;
        }

        case 'XOR': {
          const a = readDigitalPin(blk, 'I1', false).val;
          const b = readDigitalPin(blk, 'I2', false).val;
          st.digitalOutputs.Q = a !== b;
          break;
        }

        case 'NOT': {
          const a = readDigitalPin(blk, 'I1', false).val;
          st.digitalOutputs.Q = !a;
          break;
        }

        case 'BOOL': {
          const a = readDigitalPin(blk, 'I1', false).val ? 1 : 0;
          const b = readDigitalPin(blk, 'I2', false).val ? 2 : 0;
          const c = readDigitalPin(blk, 'I3', false).val ? 4 : 0;
          const idx = a + b + c;
          const mask = Math.max(0, Math.min(255, Number(blk.params.mask ?? 232)));
          st.digitalOutputs.Q = ((mask >> idx) & 1) === 1;
          break;
        }

        // ---- TIMERS ----
        case 'TON': {
          const trg = readDigitalPin(blk, 'Trg', false).val;
          const delaySec = timeParamToSec(Number(blk.params.delay ?? 5), String(blk.params.unit ?? 's'));
          st.targetTimerSec = delaySec;
          if (trg) {
            st.internalTimerSec = Math.min(delaySec, st.internalTimerSec + dtSec);
            st.digitalOutputs.Q = st.internalTimerSec >= delaySec - 1e-6;
          } else {
            st.internalTimerSec = 0;
            st.digitalOutputs.Q = false;
          }
          break;
        }

        case 'TOF': {
          const trg = readDigitalPin(blk, 'Trg', false).val;
          const rst = readDigitalPin(blk, 'R', false).val;
          const delaySec = timeParamToSec(Number(blk.params.delay ?? 5), String(blk.params.unit ?? 's'));
          st.targetTimerSec = delaySec;
          if (rst) {
            st.internalTimerSec = 0;
            st.latchState = false;
            st.digitalOutputs.Q = false;
          } else if (trg) {
            st.latchState = true;
            st.internalTimerSec = 0;
            st.digitalOutputs.Q = true;
          } else if (st.latchState) {
            st.internalTimerSec += dtSec;
            if (st.internalTimerSec >= delaySec - 1e-6) {
              st.internalTimerSec = delaySec;
              st.latchState = false;
              st.digitalOutputs.Q = false;
            } else {
              st.digitalOutputs.Q = true;
            }
          } else {
            st.digitalOutputs.Q = false;
          }
          break;
        }

        case 'TONOF': {
          const trg = readDigitalPin(blk, 'Trg', false).val;
          const th = Number(blk.params.th ?? 2);
          const tl = Number(blk.params.tl ?? 3);
          if (!st.digitalOutputs.Q) {
            st.targetTimerSec = th;
            if (trg) {
              st.internalTimerSec += dtSec;
              if (st.internalTimerSec >= th - 1e-6) {
                st.digitalOutputs.Q = true;
                st.internalTimerSec = 0;
              }
            } else {
              st.internalTimerSec = 0;
            }
          } else {
            st.targetTimerSec = tl;
            if (!trg) {
              st.internalTimerSec += dtSec;
              if (st.internalTimerSec >= tl - 1e-6) {
                st.digitalOutputs.Q = false;
                st.internalTimerSec = 0;
              }
            } else {
              st.internalTimerSec = 0;
            }
          }
          break;
        }

        case 'TONR': {
          const trg = readDigitalPin(blk, 'Trg', false).val;
          const rst = readDigitalPin(blk, 'R', false).val;
          const delaySec = Number(blk.params.delay ?? 4);
          st.targetTimerSec = delaySec;
          if (rst) {
            st.latchState = false;
            st.internalTimerSec = 0;
            st.digitalOutputs.Q = false;
          } else {
            if (trg && !st.prevTrigger) {
              st.latchState = true;
            }
            if (st.latchState && !st.digitalOutputs.Q) {
              st.internalTimerSec += dtSec;
              if (st.internalTimerSec >= delaySec - 1e-6) {
                st.internalTimerSec = delaySec;
                st.digitalOutputs.Q = true;
              }
            }
          }
          st.prevTrigger = trg;
          break;
        }

        case 'TP': {
          const trg = readDigitalPin(blk, 'Trg', false).val;
          const rst = readDigitalPin(blk, 'R', false).val;
          const width = Number(blk.params.pulseWidth ?? 3);
          st.targetTimerSec = width;
          if (rst) {
            st.latchState = false;
            st.internalTimerSec = 0;
            st.digitalOutputs.Q = false;
          } else {
            if (trg && !st.prevTrigger && !st.latchState) {
              st.latchState = true;
              st.internalTimerSec = 0;
              st.digitalOutputs.Q = true;
            } else if (st.latchState) {
              st.internalTimerSec += dtSec;
              if (st.internalTimerSec >= width - 1e-6) {
                st.latchState = false;
                st.internalTimerSec = 0;
                st.digitalOutputs.Q = false;
              } else {
                st.digitalOutputs.Q = true;
              }
            }
          }
          st.prevTrigger = trg;
          break;
        }

        case 'BLINK': {
          const en = readDigitalPin(blk, 'En', false).val;
          const inv = readDigitalPin(blk, 'Inv', false).val;
          const th = Math.max(0.05, Number(blk.params.th ?? 0.5));
          const tl = Math.max(0.05, Number(blk.params.tl ?? 0.5));
          const period = th + tl;
          st.targetTimerSec = period;
          if (!en) {
            st.internalTimerSec = 0;
            st.digitalOutputs.Q = false;
          } else {
            st.internalTimerSec = (st.internalTimerSec + dtSec) % period;
            const rawHigh = st.internalTimerSec < th;
            st.digitalOutputs.Q = inv ? !rawHigh : rawHigh;
          }
          break;
        }

        case 'MPG': {
          const en = readDigitalPin(blk, 'En', false).val;
          const rst = readDigitalPin(blk, 'R', false).val;
          const th = Math.max(0.05, Number(blk.params.th ?? 1));
          const tl = Math.max(0.05, Number(blk.params.tl ?? 1));
          const count = Math.max(1, Number(blk.params.count ?? 3));
          if (rst || !en) {
            st.pulseIndex = 0;
            st.internalTimerSec = 0;
            st.digitalOutputs.Q = false;
          } else if (st.pulseIndex < count) {
            const period = th + tl;
            st.internalTimerSec += dtSec;
            if (st.internalTimerSec >= period) {
              st.internalTimerSec -= period;
              st.pulseIndex += 1;
            }
            st.digitalOutputs.Q = st.pulseIndex < count && st.internalTimerSec < th;
          } else {
            st.digitalOutputs.Q = false;
          }
          break;
        }

        case 'STAIR': {
          const trg = readDigitalPin(blk, 'Trg', false).val;
          const hold = Math.max(1, Number(blk.params.holdSec ?? 10));
          st.targetTimerSec = hold;
          if (trg && !st.prevTrigger) {
            st.latchState = true;
            st.internalTimerSec = 0;
          }
          if (st.latchState) {
            st.internalTimerSec += dtSec;
            if (st.internalTimerSec >= hold) {
              st.latchState = false;
              st.internalTimerSec = 0;
              st.digitalOutputs.Q = false;
            } else {
              st.digitalOutputs.Q = true;
            }
          } else {
            st.digitalOutputs.Q = false;
          }
          st.prevTrigger = trg;
          break;
        }

        case 'WKT': {
          st.digitalOutputs.Q = Boolean(blk.params.forceActiveSim ?? true);
          break;
        }

        // ---- TRIGGERS & COUNTERS ----
        case 'RS': {
          const s = readDigitalPin(blk, 'S', false).val;
          const r = readDigitalPin(blk, 'R', false).val;
          if (r) st.latchState = false;
          else if (s) st.latchState = true;
          st.digitalOutputs.Q = st.latchState;
          break;
        }

        case 'SR': {
          const s = readDigitalPin(blk, 'S', false).val;
          const r = readDigitalPin(blk, 'R', false).val;
          if (s) st.latchState = true;
          else if (r) st.latchState = false;
          st.digitalOutputs.Q = st.latchState;
          break;
        }

        case 'TL': {
          const trg = readDigitalPin(blk, 'Trg', false).val;
          const s = readDigitalPin(blk, 'S', false).val;
          const r = readDigitalPin(blk, 'R', false).val;
          if (r) st.latchState = false;
          else if (s) st.latchState = true;
          else if (trg && !st.prevTrigger) st.latchState = !st.latchState;
          st.prevTrigger = trg;
          st.digitalOutputs.Q = st.latchState;
          break;
        }

        case 'CTUD': {
          const rst = readDigitalPin(blk, 'R', false).val;
          const cnt = readDigitalPin(blk, 'Cnt', false).val;
          const dir = readDigitalPin(blk, 'Dir', false).val;
          const onTh = Number(blk.params.onThreshold ?? 5);
          const offTh = Number(blk.params.offThreshold ?? 5);
          const startVal = Number(blk.params.startValue ?? 0);

          if (rst) {
            st.counterValue = startVal;
          } else if (cnt && !st.prevCnt) {
            if (!dir) st.counterValue = Math.min(999999, st.counterValue + 1);
            else st.counterValue = Math.max(0, st.counterValue - 1);
          }
          st.prevCnt = cnt;

          if (st.counterValue >= onTh) st.latchState = true;
          if (st.counterValue < offTh) st.latchState = false;
          st.digitalOutputs.Q = st.latchState;
          st.analogOutputs.CV = st.counterValue;
          st.analogOutputs.AQ = st.counterValue;
          break;
        }

        case 'OTM': {
          const en = readDigitalPin(blk, 'En', false).val;
          const rst = readDigitalPin(blk, 'R', false).val;
          const limit = Number(blk.params.serviceLimitSec ?? 30);
          if (rst) st.motorHoursSec = 0;
          else if (en) st.motorHoursSec += dtSec;
          st.digitalOutputs.Q = st.motorHoursSec >= limit;
          st.analogOutputs.OT = Math.round(st.motorHoursSec);
          st.analogOutputs.AQ = Math.round(st.motorHoursSec);
          break;
        }

        case 'FRE': {
          const inp = readDigitalPin(blk, 'In', false).val;
          const win = Math.max(0.5, Number(blk.params.windowSec ?? 2.0));
          const onHz = Number(blk.params.onHz ?? 5);
          const offHz = Number(blk.params.offHz ?? 3);
          if (inp && !st.prevTrigger) {
            st.freqPulseTimestamps.push(this.simTimeSec);
          }
          st.prevTrigger = inp;
          const cutoff = this.simTimeSec - win;
          st.freqPulseTimestamps = st.freqPulseTimestamps.filter((t) => t >= cutoff);
          const hz = Number((st.freqPulseTimestamps.length / win).toFixed(1));
          st.measuredFreqHz = hz;
          if (hz >= onHz) st.latchState = true;
          else if (hz <= offHz) st.latchState = false;
          st.digitalOutputs.Q = st.latchState;
          st.analogOutputs.FA = hz;
          st.analogOutputs.AQ = hz;
          break;
        }

        // ---- ANALOG КИПиА BLOCKS ----
        case 'ATRG': {
          const ax = readAnalogPin(blk, 'Ax', 0).val;
          const gain = Number(blk.params.gain ?? 1.0);
          const offset = Number(blk.params.offset ?? 0);
          const scaled = Math.round(ax * gain + offset);
          const onTh = Number(blk.params.onThreshold ?? 600);
          const offTh = Number(blk.params.offThreshold ?? 400);
          const mode = String(blk.params.mode ?? 'cool_or_alarm_high');

          if (mode === 'heat_or_fill' || onTh < offTh) {
            // Turn ON when <= onTh, turn OFF when >= offTh (pump fill / heater thermostat!)
            if (scaled <= onTh) st.latchState = true;
            else if (scaled >= offTh) st.latchState = false;
          } else {
            // Turn ON when >= onTh, turn OFF when <= offTh (cooling / high-level alarm!)
            if (scaled >= onTh) st.latchState = true;
            else if (scaled <= offTh) st.latchState = false;
          }
          st.digitalOutputs.Q = st.latchState;
          st.analogOutputs.AQ = scaled;
          break;
        }

        case 'CMP': {
          const ax = readAnalogPin(blk, 'Ax', 0).val;
          const ay = readAnalogPin(blk, 'Ay', 0).val;
          const gain = Number(blk.params.gain ?? 1.0);
          const offset = Number(blk.params.offset ?? 0);
          const diff = Math.round((ax - ay) * gain + offset);
          const onTh = Number(blk.params.onThreshold ?? 30);
          const offTh = Number(blk.params.offThreshold ?? -30);
          if (diff >= onTh) st.latchState = true;
          else if (diff <= offTh) st.latchState = false;
          st.digitalOutputs.Q = st.latchState;
          st.analogOutputs.Diff = diff;
          st.analogOutputs.AQ = diff;
          break;
        }

        case 'AMP': {
          const ax = readAnalogPin(blk, 'Ax', 0).val;
          const gain = Number(blk.params.gain ?? 0.125);
          const offset = Number(blk.params.offset ?? -25);
          st.analogOutputs.AQ = Number((ax * gain + offset).toFixed(1));
          break;
        }

        case 'AWD': {
          const enPin = readDigitalPin(blk, 'En', true);
          const en = enPin.wired ? enPin.val : true;
          const ax = readAnalogPin(blk, 'Ax', 0).val;
          const minVal = Number(blk.params.minVal ?? 185);
          const maxVal = Number(blk.params.maxVal ?? 1020);
          st.digitalOutputs.Q = en ? ax < minVal || ax > maxVal : false;
          break;
        }

        case 'PI': {
          const amPin = readDigitalPin(blk, 'AM', true);
          const autoMode = amPin.wired ? amPin.val : true;
          const rst = readDigitalPin(blk, 'R', false).val;
          const pv = readAnalogPin(blk, 'PV', 0).val;
          const spPin = readAnalogPin(blk, 'SP', Number(blk.params.spDefault ?? 500));
          const sp = spPin.val;
          const kc = Math.max(0.01, Number(blk.params.kc ?? 2.0));
          const ti = Math.max(0.2, Number(blk.params.ti ?? 5.0));
          const dir = String(blk.params.dir ?? 'direct_heat');
          const mq = Number(blk.params.mq ?? 0);

          if (rst) {
            st.integralAccum = 0;
            st.analogOutputs.AQ = 0;
          } else if (!autoMode) {
            st.integralAccum = mq;
            st.analogOutputs.AQ = Math.max(0, Math.min(1000, Math.round(mq)));
          } else {
            const err = dir === 'reverse_cool' ? pv - sp : sp - pv;
            const pTerm = kc * err;
            if (dtSec > 0) {
              st.integralAccum += (kc / ti) * err * dtSec;
              st.integralAccum = Math.max(-200, Math.min(1000, st.integralAccum));
            }
            const out = Math.max(0, Math.min(1000, Math.round(pTerm + st.integralAccum)));
            st.analogOutputs.AQ = out;
          }
          break;
        }

        case 'MUX': {
          const enPin = readDigitalPin(blk, 'En', true);
          const en = enPin.wired ? enPin.val : true;
          const s1 = readDigitalPin(blk, 'S1', false).val ? 1 : 0;
          const s2 = readDigitalPin(blk, 'S2', false).val ? 2 : 0;
          if (!en) {
            st.analogOutputs.AQ = 0;
          } else {
            const sel = s1 + s2;
            const vals = [
              Number(blk.params.v1 ?? 300),
              Number(blk.params.v2 ?? 500),
              Number(blk.params.v3 ?? 750),
              Number(blk.params.v4 ?? 900),
            ];
            st.analogOutputs.AQ = vals[sel] ?? 0;
          }
          break;
        }

        case 'MATH': {
          const enPin = readDigitalPin(blk, 'En', true);
          const en = enPin.wired ? enPin.val : true;
          const v1 = readAnalogPin(blk, 'Ax', 0).val;
          const v2Pin = readAnalogPin(blk, 'Ay', Number(blk.params.constV2 ?? 0));
          const v2 = v2Pin.val;
          const op = String(blk.params.op ?? 'add');
          if (!en) {
            st.analogOutputs.AQ = 0;
          } else {
            let res = 0;
            if (op === 'add') res = v1 + v2;
            else if (op === 'sub') res = v1 - v2;
            else if (op === 'mul') res = v1 * v2;
            else if (op === 'div') res = Math.abs(v2) < 1e-6 ? 0 : v1 / v2;
            else if (op === 'avg') res = (v1 + v2) / 2;
            else if (op === 'min') res = Math.min(v1, v2);
            else if (op === 'max') res = Math.max(v1, v2);
            st.analogOutputs.AQ = Number(res.toFixed(1));
          }
          break;
        }

        case 'RAMP': {
          const enPin = readDigitalPin(blk, 'En', true);
          const en = enPin.wired ? enPin.val : true;
          const tgt = en ? readAnalogPin(blk, 'Target', Number(blk.params.defaultTarget ?? 1000)).val : 0;
          const rate = Math.max(1, Number(blk.params.ratePerSec ?? 200));
          const maxStep = rate * dtSec;
          const delta = tgt - st.rampCurrent;
          if (Math.abs(delta) <= maxStep) st.rampCurrent = tgt;
          else st.rampCurrent += Math.sign(delta) * maxStep;
          st.analogOutputs.AQ = Math.round(st.rampCurrent);
          break;
        }

        case 'MSG': {
          const en = readDigitalPin(blk, 'En', false).val;
          st.digitalOutputs.Q = en;
          if (en) {
            const prio = Number(blk.params.priority ?? 10);
            const bl = (blk.params.backlight as LcdDisplayState['backlight']) || 'green';
            const interp = (rawLine: string) => this.interpolateLcdLine(rawLine, project);
            activeMsgs.push({
              priority: prio,
              lines: [
                interp(String(blk.params.line1 ?? '')),
                interp(String(blk.params.line2 ?? '')),
                interp(String(blk.params.line3 ?? '')),
                interp(String(blk.params.line4 ?? '')),
              ],
              backlight: bl,
              label: formatBlockHeaderLabel(def, blk.channelIndex, blk.customName),
            });
          }
          break;
        }
      }
    }

    // Commit physical outputs
    for (let i = 1; i <= 24; i++) {
      this.doState[i] = Boolean(nextDo[i]);
    }
    for (let i = 1; i <= 8; i++) {
      if (nextAo[i] !== undefined) this.aoRaw[i] = nextAo[i];
      else this.aoRaw[i] = 0;
    }

    // Update LCD display
    if (activeMsgs.length > 0) {
      activeMsgs.sort((a, b) => b.priority - a.priority);
      const winner = activeMsgs[0];
      this.lcdState = {
        active: true,
        lines: winner.lines,
        backlight: winner.backlight,
        sourceBlockLabel: `${winner.label} (Приор. ${winner.priority})`,
      };
    } else {
      const iBits = [1, 2, 3, 4, 5, 6].map((k) => (this.diState[k] ? k : '·')).join('');
      const qBits = [1, 2, 3, 4, 5, 6].map((k) => (this.doState[k] ? k : '·')).join('');
      this.lcdState = {
        active: false,
        lines: [
          `${project.controllerId.slice(0, 16)}`,
          `IN : [${iBits}]`,
          `OUT: [${qBits}]`,
          `AI1:${String(this.aiRaw[1] ?? 0).padStart(4, ' ')} T:${this.simTimeSec.toFixed(0)}c`,
        ],
        backlight: 'green',
        sourceBlockLabel: 'ШТАТНЫЙ ЭКРАН ЦПУ',
      };
    }
  }

  private interpolateLcdLine(tpl: string, project: OniProject): string {
    const out = tpl.replace(/\{([A-Za-z]+)(\d+)\}/g, (_m, prefRaw: string, numStr: string) => {
      const pref = prefRaw.toUpperCase();
      const idx = parseInt(numStr, 10);
      if (pref === 'I' || pref === 'DI') return this.diState[idx] ? 'ВКЛ' : 'ВЫКЛ';
      if (pref === 'Q' || pref === 'DO') return this.doState[idx] ? 'ВКЛ' : 'ВЫКЛ';
      if (pref === 'M') return this.mState[idx] ? '1' : '0';
      if (pref === 'AI') {
        const cfg = project.analogConfigs.find((c) => c.channel === idx);
        if (cfg) {
          const { eng } = adcToEng(this.aiRaw[idx] ?? 0, cfg);
          return `${eng}${cfg.unit}`;
        }
        return String(this.aiRaw[idx] ?? 0);
      }
      if (pref === 'AQ' || pref === 'AO') return String(this.aoRaw[idx] ?? 0);
      if (pref === 'B') {
        const blk = project.blocks.find((b) => b.channelIndex === idx && BLOCK_DEF_MAP[b.type]?.prefix === 'B');
        if (blk) {
          const st = this.blockStates[blk.id];
          if (!st) return '0';
          if (blk.type === 'CTUD') return String(st.counterValue);
          if (blk.type === 'TON' || blk.type === 'TOF' || blk.type === 'TP') return `${st.internalTimerSec.toFixed(1)}c`;
          return String(st.analogOutputs.AQ ?? (st.digitalOutputs.Q ? 'ON' : 'OFF'));
        }
      }
      return '0';
    });
    return out.slice(0, 20);
  }

  private evaluateLadder(project: OniProject, dtSec: number) {
    const readBit = (operand: string): boolean => {
      const m = operand.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
      if (!m) return false;
      const [, p, nStr] = m;
      const idx = parseInt(nStr, 10);
      if (p === 'I') return Boolean(this.diState[idx]);
      if (p === 'Q') return Boolean(this.doState[idx]);
      if (p === 'M') return Boolean(this.mState[idx]);
      if (p === 'T' || p === 'C') return Boolean(this.ldStates[operand.toUpperCase()]?.q);
      return false;
    };

    const writeBit = (operand: string, val: boolean) => {
      const m = operand.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
      if (!m) return;
      const [, p, nStr] = m;
      const idx = parseInt(nStr, 10);
      if (p === 'Q') this.doState[idx] = val;
      else if (p === 'M') this.mState[idx] = val;
    };

    const evalContact = (c: OniProject['ldRungs'][number]['mainSeries'][number]): boolean => {
      const key = `edge_${c.id}`;
      if (!this.ldStates[key]) this.ldStates[key] = { timer: 0, count: 0, prevIn: false, q: false };
      if (c.kind === 'NO') return readBit(c.operand);
      if (c.kind === 'NC') return !readBit(c.operand);
      if (c.kind === 'P_EDGE') {
        const cur = readBit(c.operand);
        const pulse = cur && !this.ldStates[key].prevIn;
        this.ldStates[key].prevIn = cur;
        return pulse;
      }
      if (c.kind === 'CMP_GE') {
        const idx = parseInt(c.operand.replace(/\D/g, ''), 10) || 1;
        return (this.aiRaw[idx] ?? 0) >= (c.preset ?? 500);
      }
      if (c.kind === 'CMP_LE') {
        const idx = parseInt(c.operand.replace(/\D/g, ''), 10) || 1;
        return (this.aiRaw[idx] ?? 0) <= (c.preset ?? 500);
      }
      return false;
    };

    for (const rung of project.ldRungs) {
      let rungPower = true;
      if (rung.mainSeries.length > 0) {
        const first = evalContact(rung.mainSeries[0]);
        let branchOr = first;
        if (rung.parallelBranch && rung.parallelBranch.length > 0) {
          const parVal = rung.parallelBranch.every((pc) => evalContact(pc));
          branchOr = first || parVal;
        }
        rungPower = branchOr && rung.mainSeries.slice(1).every((c) => evalContact(c));
      }

      const out = rung.outputElement;
      const opKey = out.operand.trim().toUpperCase();
      if (!this.ldStates[opKey]) {
        this.ldStates[opKey] = { timer: 0, count: 0, prevIn: false, q: false };
      }
      const st = this.ldStates[opKey];

      if (out.kind === 'COIL') {
        writeBit(opKey, rungPower);
        st.q = rungPower;
      } else if (out.kind === 'SET') {
        if (rungPower) {
          writeBit(opKey, true);
          st.q = true;
        }
      } else if (out.kind === 'RESET') {
        if (rungPower) {
          writeBit(opKey, false);
          st.q = false;
          st.count = 0;
          st.timer = 0;
        }
      } else if (out.kind === 'TON_LD') {
        const target = (out.preset ?? 30) / 10; // preset in 0.1s or sec
        if (rungPower) {
          st.timer = Math.min(target, st.timer + dtSec);
          st.q = st.timer >= target - 1e-6;
        } else {
          st.timer = 0;
          st.q = false;
        }
      } else if (out.kind === 'TOF_LD') {
        const target = (out.preset ?? 30) / 10;
        if (rungPower) {
          st.timer = 0;
          st.q = true;
        } else if (st.q) {
          st.timer += dtSec;
          if (st.timer >= target - 1e-6) {
            st.q = false;
            st.timer = 0;
          }
        }
      } else if (out.kind === 'CTU_LD') {
        const limit = out.preset ?? 5;
        if (rungPower && !st.prevIn) {
          st.count += 1;
        }
        st.prevIn = rungPower;
        st.q = st.count >= limit;
      }
    }
  }
}

export function checkProjectErc(project: OniProject): ErcMessage[] {
  const msgs: ErcMessage[] = [];
  const limits = getEffectiveIoLimits(project.controllerId, project.expansionIds);

  if (project.blocks.length === 0) {
    msgs.push({ severity: 'warning', text: 'Схема пуста — добавьте блоки из панели «Библиотека блоков» слева.' });
    return msgs;
  }

  if (project.blocks.length > limits.cpu.maxBlocks) {
    msgs.push({
      severity: 'error',
      text: `Превышен лимит блоков модели ${limits.cpu.model}: ${project.blocks.length} > ${limits.cpu.maxBlocks}.`,
    });
  }

  const incomingByBlock = new Map<string, number>();
  const outgoingByBlock = new Map<string, number>();
  for (const w of project.wires) {
    incomingByBlock.set(w.toBlockId, (incomingByBlock.get(w.toBlockId) ?? 0) + 1);
    outgoingByBlock.set(w.fromBlockId, (outgoingByBlock.get(w.fromBlockId) ?? 0) + 1);
  }

  const seenDo = new Set<number>();
  for (const b of project.blocks) {
    const def = BLOCK_DEF_MAP[b.type];
    if (!def) continue;
    const label = formatBlockHeaderLabel(def, b.channelIndex, b.customName);

    if (b.type === 'DI' && b.channelIndex > limits.maxDi) {
      msgs.push({
        severity: 'error',
        blockId: b.id,
        text: `Недопустимая конфигурация [${label}]: у ${limits.cpu.model} доступно максимум I1..I${limits.maxDi}.`,
      });
    }
    if (b.type === 'DO') {
      if (b.channelIndex > limits.maxDo) {
        msgs.push({
          severity: 'error',
          blockId: b.id,
          text: `Недопустимая конфигурация [${label}]: у ${limits.cpu.model} доступно максимум Q1..Q${limits.maxDo}.`,
        });
      }
      if (seenDo.has(b.channelIndex)) {
        msgs.push({
          severity: 'warning',
          blockId: b.id,
          text: `Дублирование катушки выхода Q${String(b.channelIndex).padStart(3, '0')} — в ПЛК и реле рекомендуется управлять одним выходом через блок ИЛИ (OR)!`,
        });
      }
      seenDo.add(b.channelIndex);
    }

    if (def.inputs.length > 0 && (incomingByBlock.get(b.id) ?? 0) === 0 && Object.keys(b.invertedInputs ?? {}).length === 0) {
      msgs.push({
        severity: 'warning',
        blockId: b.id,
        text: `Блок ${label} (${def.nameRu}) не имеет ни одного входного соединения.`,
      });
    }
    if (b.type !== 'DO' && b.type !== 'AO' && b.type !== 'M' && b.type !== 'AM' && b.type !== 'MSG') {
      if ((outgoingByBlock.get(b.id) ?? 0) === 0) {
        msgs.push({
          severity: 'info',
          blockId: b.id,
          text: `Выход блока ${label} никуда не подключён.`,
        });
      }
    }
  }

  if (msgs.filter((m) => m.severity === 'error').length === 0) {
    msgs.unshift({
      severity: 'info',
      text: `Компиляция успешна: ${project.blocks.length} блоков, ${project.wires.length} связей. Ошибок аппаратной конфигурации (${limits.cpu.model}) нет.`,
    });
  }
  return msgs;
}

export function buildModbusTable(project: OniProject, sim: OniPlcSimulator): ModbusRow[] {
  const rows: ModbusRow[] = [];
  const sorted = [...project.blocks].sort((a, b) => a.type.localeCompare(b.type) || a.channelIndex - b.channelIndex);
  for (const b of sorted) {
    const def = BLOCK_DEF_MAP[b.type];
    if (!def) continue;
    const addrTag = formatBlockAddress(def.prefix, b.channelIndex);
    const st = sim.blockStates[b.id];
    if (b.type === 'DI') {
      rows.push({
        address: String(100000 + (b.channelIndex - 1)).padStart(6, '0'),
        regType: 'Discrete Input (1x)',
        tag: addrTag,
        description: b.customName || 'Цифровой вход',
        valueText: sim.diState[b.channelIndex] ? '1 (ON)' : '0 (OFF)',
      });
    } else if (b.type === 'DO') {
      rows.push({
        address: String(b.channelIndex - 1).padStart(6, '0'),
        regType: 'Coil (0x)',
        tag: addrTag,
        description: b.customName || 'Цифровой выход',
        valueText: sim.doState[b.channelIndex] ? '1 (ON)' : '0 (OFF)',
      });
    } else if (b.type === 'M') {
      rows.push({
        address: String(3000 + (b.channelIndex - 1)).padStart(6, '0'),
        regType: 'Coil (0x)',
        tag: addrTag,
        description: b.customName || 'Меркер памяти',
        valueText: sim.mState[b.channelIndex] ? '1 (ON)' : '0 (OFF)',
      });
    } else if (b.type === 'AI') {
      const cfg = project.analogConfigs.find((c) => c.channel === b.channelIndex);
      const raw = sim.aiRaw[b.channelIndex] ?? 0;
      const extra = cfg ? ` (${adcToEng(raw, cfg).eng} ${cfg.unit})` : '';
      rows.push({
        address: String(300000 + (b.channelIndex - 1)).padStart(6, '0'),
        regType: 'Input Reg (3x)',
        tag: addrTag,
        description: b.customName || cfg?.tag || 'Аналоговый вход',
        valueText: `${raw}${extra}`,
      });
    } else if (b.type === 'AO') {
      rows.push({
        address: String(400000 + (b.channelIndex - 1)).padStart(6, '0'),
        regType: 'Holding Reg (4x)',
        tag: addrTag,
        description: b.customName || 'Аналоговый выход ЦАП',
        valueText: String(sim.aoRaw[b.channelIndex] ?? 0),
      });
    } else if (def.modbusBase !== undefined) {
      const reg = def.modbusBase + b.channelIndex * 2;
      let valStr = st?.digitalOutputs?.Q ? 'ON' : 'OFF';
      if (b.type === 'TON' || b.type === 'TOF' || b.type === 'BLINK') {
        valStr = `${(st?.internalTimerSec ?? 0).toFixed(2)} с / уст. ${b.params.delay ?? b.params.th ?? 0} с`;
      } else if (b.type === 'CTUD') {
        valStr = `Счёт = ${st?.counterValue ?? 0} (порог ${b.params.onThreshold ?? 5})`;
      } else if (b.type === 'PI') {
        valStr = `AQ = ${st?.analogOutputs?.AQ ?? 0} (SP=${b.params.spDefault ?? 500})`;
      }
      rows.push({
        address: String(reg),
        regType: 'Holding Reg (4x)',
        tag: formatBlockHeaderLabel(def, b.channelIndex, b.customName),
        description: def.nameRu,
        valueText: valStr,
      });
    }
  }
  return rows;
}
