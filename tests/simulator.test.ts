import * as fs from 'node:fs';
import { ONI_EXAMPLE_PROJECTS } from '../web/src/catalog/examples';
import { KIP_PRACTICE_TASKS } from '../web/src/catalog/tasks';
import { OniPlcSimulator, checkProjectErc, buildModbusTable } from '../web/src/engine/simulator';
import { runTaskVerification } from '../web/src/engine/taskGrader';
import { importXlgBinaryOrJson, serializeProjectJson, exportProjectToSvg } from '../web/src/engine/xlgCodec';
import { KipPlantSimulator } from '../web/src/engine/plantSimulator';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

console.log('1. Проверка всех встроенных промышленных примеров ONI PLR Studio...');
for (const ex of ONI_EXAMPLE_PROJECTS) {
  const proj = ex.build();
  const erc = checkProjectErc(proj);
  const errors = erc.filter((m) => m.severity === 'error');
  assert(errors.length === 0, `Пример "${ex.title}" содержит ошибки ERC: ${errors.map((e) => e.text).join(', ')}`);
  const sim = new OniPlcSimulator();
  sim.start(proj);
  for (let i = 0; i < 20; i++) sim.step(proj, 0.1);
  console.log(`  [OK] ${ex.title} (${proj.blocks.length} блоков, ${proj.wires.length} связей)`);
}

console.log('2. Проверка эталонного прохождения Практикума №1 (Пуск-Стоп) на примере №1...');
const ex1 = ONI_EXAMPLE_PROJECTS[0].build();
const task1 = KIP_PRACTICE_TASKS[0];
const grade1 = runTaskVerification(ex1, task1);
assert(
  grade1.passedAll,
  `Эталон Пуск-Стоп не прошёл задачу №1: ${grade1.steps.map((s) => `${s.stepIndex}:${s.details}`).join(' | ')}`
);
console.log(`  [OK] Задача №1 пройдена (${grade1.passedCount}/${grade1.totalCount})`);

console.log('3. Проверка эталонного прохождения Практикума №6 (Сигнализация с квитированием) на примере №5...');
const ex5 = ONI_EXAMPLE_PROJECTS[4].build();
const task6 = KIP_PRACTICE_TASKS[5];
const grade6 = runTaskVerification(ex5, task6);
assert(
  grade6.passedAll,
  `Эталон сигнализации не прошёл задачу №6: ${grade6.steps.map((s) => `${s.stepIndex}:${s.details}`).join(' | ')}`
);
console.log(`  [OK] Задача №6 пройдена (${grade6.passedCount}/${grade6.totalCount})`);

console.log('4. Проверка ПИ-регулятора (пример №4)...');
const ex4 = ONI_EXAMPLE_PROJECTS[3].build();
const simPi = new OniPlcSimulator();
simPi.start(ex4);
simPi.diState[1] = true; // Auto mode
simPi.diState[3] = true; // Overtemp thermostat OK (NC=1)
simPi.aiRaw[1] = 300;    // PV=300 < SP=600 -> output must rise
for (let i = 0; i < 30; i++) simPi.step(ex4, 0.1);
assert(simPi.aoRaw[1] > 400, `ПИ-регулятор должен выдавать нагрев >400, выдал ${simPi.aoRaw[1]}`);
simPi.diState[3] = false; // Overtemp thermostat tripped (NC=0 -> R=1) -> must drop output to 0!
simPi.step(ex4, 0.1);
assert(simPi.aoRaw[1] === 0, `При размыкании термостата перегрева выход ПИ должен сброситься в 0, выдал ${simPi.aoRaw[1]}`);
console.log('  [OK] ПИ-регулятор и блокировка перегрева работают точно.');

console.log('5. Проверка кодека проектов (.oni.json / бинарный .xlg / .svg) и Modbus RTU...');
const serialized = serializeProjectJson(ex1);
const reimported = importXlgBinaryOrJson(new TextEncoder().encode(serialized).buffer, 'pusk_stop.oni.json');
assert(reimported.blocks.length === ex1.blocks.length, 'Несовпадение блоков после round-trip сериализации');
const svg = exportProjectToSvg(ex1);
assert(svg.includes('<svg') && svg.includes('ONI PLR Studio'), 'Экспорт SVG должен содержать чертёж со штампом');
const modbusRows = buildModbusTable(ex1, simPi);
assert(modbusRows.length >= 4, 'Таблица Modbus RTU должна генерировать регистры входов/выходов');

if (fs.existsSync('/tmp/oni_ref/pusk_stop.xlg')) {
  const rawBuf = fs.readFileSync('/tmp/oni_ref/pusk_stop.xlg');
  const ab = rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength);
  const importedXlg = importXlgBinaryOrJson(ab, 'pusk_stop.xlg');
  assert(importedXlg.blocks.length >= 3, `Бинарный файл pusk_stop.xlg должен содержать блоки (найдено ${importedXlg.blocks.length})`);
  assert(
    importedXlg.blocks.some((b) => b.type === 'DI') &&
      importedXlg.blocks.some((b) => b.type === 'DO') &&
      importedXlg.blocks.some((b) => b.type === 'RS'),
    'Бинарный pusk_stop.xlg должен декодировать DI, DO и RS-триггер'
  );
  console.log(`  [OK] Оригинальный бинарный pusk_stop.xlg (ONI PLR Studio 3.5.6.1) успешно прочитан (${importedXlg.blocks.length} блоков)`);
}

console.log('6. Проверка виртуального объекта КИПиА (Насосная станция 4–20 мА + обрыв петли)...');
const plant = new KipPlantSimulator();
plant.linkedToPlc = true;
const simTank = new OniPlcSimulator();
const ex3 = ONI_EXAMPLE_PROJECTS[2].build();
ex3.activePlant = 'pump_station';
simTank.start(ex3);
plant.step(ex3, simTank, 0.2);
assert(simTank.aiRaw[1] >= 200, `Нормальный сигнал 4–20 мА должен давать код АЦП >= 200, получено ${simTank.aiRaw[1]}`);
plant.state.sensorWireBreak = true;
plant.step(ex3, simTank, 0.2);
assert(simTank.aiRaw[1] < 180, `При обрыве токовой петли 4–20 мА код АЦП должен упасть ниже порога обрыва (<180), получено ${simTank.aiRaw[1]}`);
console.log('  [OK] Физический объект КИПиА и имитация обрыва 4–20 мА работают корректно.');

console.log('ВСЕ ТЕСТЫ ЯДРА ONI PLR STUDIO УСПЕШНО ПРОЙДЕНЫ!');
