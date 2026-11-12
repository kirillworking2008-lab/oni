import { KipPracticeTask } from '../catalog/tasks';
import { OniProject } from '../types';
import { OniPlcSimulator } from './simulator';

export interface StepCheckResult {
  stepIndex: number;
  description: string;
  passed: boolean;
  details: string;
}

export interface TaskGradeReport {
  taskId: string;
  passedAll: boolean;
  passedCount: number;
  totalCount: number;
  steps: StepCheckResult[];
}

export function runTaskVerification(project: OniProject, task: KipPracticeTask): TaskGradeReport {
  const sim = new OniPlcSimulator();
  sim.resetHardwareIo();
  sim.start(project);

  const stepResults: StepCheckResult[] = [];

  task.steps.forEach((step, idx) => {
    if (step.setDi) {
      for (const [k, v] of Object.entries(step.setDi)) {
        sim.diState[Number(k)] = v;
      }
    }
    if (step.setAi) {
      for (const [k, v] of Object.entries(step.setAi)) {
        sim.aiRaw[Number(k)] = v;
      }
    }

    // Step through simulated time in crisp 50ms PLC scans
    const dt = 0.05;
    const nScans = Math.max(2, Math.round(step.advanceSec / dt));
    for (let s = 0; s < nScans; s++) {
      sim.step(project, dt);
    }

    const mismatches: string[] = [];
    if (step.expectDo) {
      for (const [qStr, expected] of Object.entries(step.expectDo)) {
        const qCh = Number(qStr);
        const actual = Boolean(sim.doState[qCh]);
        if (actual !== expected) {
          mismatches.push(`Q${qCh}: ожидалось ${expected ? 'ON (1)' : 'OFF (0)'}, получено ${actual ? 'ON (1)' : 'OFF (0)'}`);
        }
      }
    }
    if (step.expectAoRange) {
      const actualAo = sim.aoRaw[step.expectAoRange.channel] ?? 0;
      if (actualAo < step.expectAoRange.min || actualAo > step.expectAoRange.max) {
        mismatches.push(
          `AQ${step.expectAoRange.channel}: ожидалось ${step.expectAoRange.min}..${step.expectAoRange.max}, получено ${actualAo}`
        );
      }
    }

    stepResults.push({
      stepIndex: idx + 1,
      description: step.description,
      passed: mismatches.length === 0,
      details: mismatches.length === 0 ? 'Выполнено верно' : mismatches.join('; '),
    });
  });

  const passedCount = stepResults.filter((r) => r.passed).length;
  return {
    taskId: task.id,
    passedAll: passedCount === stepResults.length,
    passedCount,
    totalCount: stepResults.length,
    steps: stepResults,
  };
}
