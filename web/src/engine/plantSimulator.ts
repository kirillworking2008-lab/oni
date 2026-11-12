import { OniProject } from '../types';
import { OniPlcSimulator } from './simulator';

export interface PlantTelemetry {
  levelPct: number;        // 0..100 %
  pressureBar: number;     // 0..10 bar
  outflowDemand: number;   // 0..100 %
  pump1Fault: boolean;
  sensorWireBreak: boolean;

  ovenTempC: number;       // 0..200 °C
  ambientTempC: number;    // 20 °C

  damperPosPct: number;    // 0..100 %
  supplyAirTempC: number;  // -20..+90 °C
  heaterCoreTempC: number; // 20..150 °C

  beltPosMm: number;       // 0..1000 mm
  boxFillGrams: number;    // 0..1000 g
  boxesPacked: number;
}

export class KipPlantSimulator {
  public linkedToPlc = false;
  public state: PlantTelemetry = {
    levelPct: 32,
    pressureBar: 1.2,
    outflowDemand: 35,
    pump1Fault: false,
    sensorWireBreak: false,

    ovenTempC: 22,
    ambientTempC: 20,

    damperPosPct: 0,
    supplyAirTempC: 18,
    heaterCoreTempC: 22,

    beltPosMm: 100,
    boxFillGrams: 0,
    boxesPacked: 0,
  };

  public reset() {
    this.state = {
      levelPct: 32,
      pressureBar: 1.2,
      outflowDemand: 35,
      pump1Fault: false,
      sensorWireBreak: false,
      ovenTempC: 22,
      ambientTempC: 20,
      damperPosPct: 0,
      supplyAirTempC: 18,
      heaterCoreTempC: 22,
      beltPosMm: 100,
      boxFillGrams: 0,
      boxesPacked: 0,
    };
  }

  public step(project: OniProject, sim: OniPlcSimulator, dtSec: number) {
    if (!this.linkedToPlc || !sim.running || sim.paused || project.activePlant === 'none') return;

    const s = this.state;
    if (project.activePlant === 'pump_station') {
      const p1Cmd = Boolean(sim.doState[1]);
      const p2Cmd = Boolean(sim.doState[2]);
      const p1Flow = p1Cmd && !s.pump1Fault ? 28 : 0;
      const p2Flow = p2Cmd ? 28 : 0;
      const totalInflow = p1Flow + p2Flow; // % per 10s
      const outflow = s.outflowDemand * 0.35;

      s.levelPct = Math.max(0, Math.min(100, s.levelPct + ((totalInflow - outflow) * dtSec) / 4));
      const targetPress = totalInflow > 0 ? 3.8 + (totalInflow / 56) * 3.2 - s.outflowDemand * 0.015 : Math.max(0.4, s.levelPct * 0.03);
      s.pressureBar += (targetPress - s.pressureBar) * Math.min(1, dtSec * 2.5);

      // Write back to PLC inputs:
      // AI1 = 4..20mA tank level (200..1000), or 20 if sensor wire break!
      sim.aiRaw[1] = s.sensorWireBreak ? 20 : Math.round(200 + (s.levelPct / 100) * 800);
      // AI2 = 4..20mA manifold pressure 0..10 bar
      sim.aiRaw[2] = Math.round(200 + (Math.max(0, Math.min(10, s.pressureBar)) / 10) * 800);
      // I2 = flow switch PDS (1 when actual flow > 5)
      sim.diState[2] = totalInflow > 5;
      // I4 = dry-run protection float (1 = water OK)
      sim.diState[4] = s.levelPct > 5;
      // I5 = high-high overflow probe
      sim.diState[5] = s.levelPct >= 92;
    } else if (project.activePlant === 'thermal_oven') {
      const discreteHeater = sim.doState[1] ? 1.0 : 0.0;
      const analogPower = (sim.aoRaw[1] ?? 0) / 1000;
      const totalPower = Math.min(1.2, discreteHeater * 0.85 + analogPower * 1.0);
      const fanCool = sim.doState[2] ? 0.35 : 0.08;

      // dT/dt thermal balance (0..200°C)
      const heatRate = totalPower * 22; // °C/sec max heating
      const coolRate = (s.ovenTempC - s.ambientTempC) * fanCool;
      s.ovenTempC = Math.max(-10, Math.min(220, s.ovenTempC + (heatRate - coolRate) * dtSec));

      // AI1: 4..20mA = 0..200°C -> 200..1000 counts (or 0..1000 = 0..200°C)
      sim.aiRaw[1] = s.sensorWireBreak ? 15 : Math.round(200 + (Math.max(0, Math.min(200, s.ovenTempC)) / 200) * 800);
      // I3: NC overtemp safety thermostat (1 below 165°C, 0 above 165°C)
      sim.diState[3] = s.ovenTempC < 165;
    } else if (project.activePlant === 'hvac_ahu') {
      const damperCmd = Boolean(sim.doState[1]);
      const fanCmd = Boolean(sim.doState[2]);
      const heaterStage = Boolean(sim.doState[3]);
      const heaterMod = (sim.aoRaw[1] ?? 0) / 1000;

      // Damper actuator takes ~2.5s to open/close
      s.damperPosPct = Math.max(0, Math.min(100, s.damperPosPct + (damperCmd ? 45 : -45) * dtSec));
      const airflow = fanCmd && s.damperPosPct > 60 ? 1.0 : 0.0;

      const heatInput = (heaterStage ? 0.7 : 0) + heaterMod * 0.8;
      // Without airflow, heater core overheats rapidly!
      const coreLoss = airflow > 0.5 ? (s.heaterCoreTempC - 24) * 0.9 : (s.heaterCoreTempC - 20) * 0.06;
      s.heaterCoreTempC = Math.max(15, Math.min(160, s.heaterCoreTempC + (heatInput * 32 - coreLoss) * dtSec));

      const targetAir = airflow > 0.5 ? 10 + (s.heaterCoreTempC - 15) * 0.45 : 14;
      s.supplyAirTempC += (targetAir - s.supplyAirTempC) * Math.min(1, dtSec * 1.8);

      sim.diState[3] = s.damperPosPct >= 95; // концевик заслонки
      sim.diState[4] = airflow > 0.5;        // реле перепада давления вентилятора PDS
      sim.diState[5] = s.heaterCoreTempC < 95; // НЗ термостат перегрева ТЭНов!
      sim.aiRaw[1] = Math.round(200 + ((s.supplyAirTempC + 20) / 100) * 800);
    } else if (project.activePlant === 'conveyor_line') {
      const beltRun = Boolean(sim.doState[1]);
      const valveOpen = Boolean(sim.doState[2]);

      if (beltRun) {
        s.beltPosMm += 240 * dtSec;
        if (s.beltPosMm >= 1000) {
          s.beltPosMm -= 1000;
          if (s.boxFillGrams > 100) s.boxesPacked += 1;
          s.boxFillGrams = 0;
        }
      }
      if (valveOpen) {
        s.boxFillGrams = Math.min(1000, s.boxFillGrams + 280 * dtSec);
      }

      // Photo sensor I3 triggers when box passes 420..540 mm window
      sim.diState[3] = s.beltPosMm >= 420 && s.beltPosMm <= 540;
      sim.aiRaw[1] = Math.round(s.boxFillGrams);
    }
  }
}
