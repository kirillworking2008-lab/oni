export interface ControllerSpec {
  id: string;
  model: string;
  series: 'ONI PLR-S' | 'ONI PLR-M' | 'ONI PLC-S';
  powerSupply: string;
  diCount: number;
  universalAiCount: number; // 0..10V shared or dedicated
  dedicatedMaCount: number; // 4..20mA
  doCount: number;
  aoCount: number;
  outputType: string;
  maxBlocks: number;
  hasScreen: boolean;
  hasRs485: boolean;
  expandable: boolean;
  description: string;
}

export interface ExpansionModuleSpec {
  id: string;
  model: string;
  nameRu: string;
  addDi: number;
  addDo: number;
  addAi: number;
  addAo: number;
  signalNote: string;
}

export const ONI_CONTROLLERS: ControllerSpec[] = [
  {
    id: 'PLR-S-CPU-1206',
    model: 'PLR-S-CPU-1206',
    series: 'ONI PLR-S',
    powerSupply: '12..24 В DC',
    diCount: 12,
    universalAiCount: 6,
    dedicatedMaCount: 0,
    doCount: 6,
    aoCount: 0,
    outputType: 'Релейные 10А (НО)',
    maxBlocks: 1024,
    hasScreen: true,
    hasRs485: true,
    expandable: true,
    description:
      'Базовый промышленный модуль ЦПУ ONI: 12 дискретных входов (I1–I6 универсальные 0..10 В), 6 релейных выходов 10А, ЖК-экран 4×16, часы RTC, расширение до 16 модулей.',
  },
  {
    id: 'PLR-S-CPU-1410',
    model: 'PLR-S-CPU-1410',
    series: 'ONI PLR-S',
    powerSupply: '12..24 В DC / 220 В AC',
    diCount: 14,
    universalAiCount: 6,
    dedicatedMaCount: 0,
    doCount: 10,
    aoCount: 0,
    outputType: 'Релейные 10А (НО)',
    maxBlocks: 1024,
    hasScreen: true,
    hasRs485: true,
    expandable: true,
    description:
      'Расширенный модуль ЦПУ (стандарт официальных примеров ONI PLR Studio): 14 входов, 10 релейных выходов, ЖК-экран, порт Modbus RTU RS-485.',
  },
  {
    id: 'PLR-S-CPU-0804',
    model: 'PLR-S-CPU-0804',
    series: 'ONI PLR-S',
    powerSupply: '12..24 В DC',
    diCount: 8,
    universalAiCount: 4,
    dedicatedMaCount: 0,
    doCount: 4,
    aoCount: 0,
    outputType: 'Релейные 10А / Транзисторные PNP',
    maxBlocks: 64,
    hasScreen: true,
    hasRs485: false,
    expandable: false,
    description:
      'Компактное логическое реле для локальных щитов автоматики (освещение, АВР, небольшие насосы): 8 входов (4×0..10 В), 4 выхода, до 64 блоков.',
  },
  {
    id: 'PLR-M-CPU-2006-KIP',
    model: 'PLR-M-CPU-2006 (КИПиА)',
    series: 'ONI PLR-M',
    powerSupply: '24 В DC',
    diCount: 16,
    universalAiCount: 4,
    dedicatedMaCount: 4,
    doCount: 8,
    aoCount: 2,
    outputType: 'Релейные 8А + 2×ЦАП 4..20 мА / 0..10 В',
    maxBlocks: 1024,
    hasScreen: true,
    hasRs485: true,
    expandable: true,
    description:
      'Микро-ПЛК ONI для задач КИПиА (котельные, ИТП, КНС, ПВУ): 16 DI (4×HSC 60 кГц), 4 токовых входа 4..20 мА, 4 входа 0..10 В, 8 DO и 2 аналоговых выхода 4..20 мА.',
  },
];

export const ONI_EXPANSIONS: ExpansionModuleSpec[] = [
  {
    id: 'PLR-S-EMA-0400',
    model: 'PLR-S-EMA-0400 (4AI)',
    nameRu: 'Модуль 4×AI токовой петли (0/4..20 мА)',
    addDi: 0,
    addDo: 0,
    addAi: 4,
    addAo: 0,
    signalNote: 'Датчики давления ПД100, уровня, расхода 4..20 мА',
  },
  {
    id: 'PLR-S-EMA-PT100',
    model: 'PLR-S-EMA-PT100 (3×RTD)',
    nameRu: 'Модуль 3×Pt100 термосопротивлений (-50..+200°C)',
    addDi: 0,
    addDo: 0,
    addAi: 3,
    addAo: 0,
    signalNote: 'Термопреобразователи сопротивления Pt100 3-проводные',
  },
  {
    id: 'PLR-S-EMA-0002',
    model: 'PLR-S-EMA-0002 (2AO)',
    nameRu: 'Модуль 2×AO аналогового вывода (0..10 В / 4..20 мА)',
    addDi: 0,
    addDo: 0,
    addAi: 0,
    addAo: 2,
    signalNote: 'Управление приводами КЗР и частотниками ПЧ 4..20 мА',
  },
  {
    id: 'PLR-S-EMD-0808',
    model: 'PLR-S-EMD-0808R',
    nameRu: 'Модуль расширения 8×DI + 8×DO (Реле 10А)',
    addDi: 8,
    addDo: 8,
    addAi: 0,
    addAo: 0,
    signalNote: 'Дополнительные дискретные входы и релейные выходы',
  },
];

export function getEffectiveIoLimits(controllerId: string, expansionIds: string[]) {
  const cpu = ONI_CONTROLLERS.find((c) => c.id === controllerId) ?? ONI_CONTROLLERS[0];
  let maxDi = cpu.diCount;
  let maxDo = cpu.doCount;
  let maxAi = Math.max(cpu.universalAiCount + cpu.dedicatedMaCount, 4);
  let maxAo = Math.max(cpu.aoCount, 2);
  for (const expId of expansionIds) {
    const exp = ONI_EXPANSIONS.find((e) => e.id === expId);
    if (exp) {
      maxDi += exp.addDi;
      maxDo += exp.addDo;
      maxAi += exp.addAi;
      maxAo += exp.addAo;
    }
  }
  return { cpu, maxDi, maxDo, maxAi: Math.min(maxAi, 8), maxAo: Math.min(maxAo, 4) };
}
