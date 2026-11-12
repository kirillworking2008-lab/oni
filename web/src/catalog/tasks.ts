import { defaultAnalogConfigs } from '../engine/xlgCodec';
import { OniProject } from '../types';

export interface TaskTestStep {
  description: string;
  setDi?: Record<number, boolean>;
  setAi?: Record<number, number>;
  advanceSec: number; // simulated seconds to advance in 0.05s increments
  expectDo?: Record<number, boolean>;
  expectAoRange?: { channel: number; min: number; max: number };
}

export interface KipPracticeTask {
  id: string;
  number: number;
  level: 'Базовый' | 'Средний' | 'Продвинутый КИПиА';
  title: string;
  plantContext: string;
  objective: string;
  ioTable: { pin: string; role: string }[];
  hint: string;
  steps: TaskTestStep[];
  createStarter: () => OniProject;
}

function makeBlankTaskStarter(
  title: string,
  diList: { ch: number; name: string; nc?: boolean }[],
  aiList: { ch: number; name: string }[],
  doList: { ch: number; name: string }[]
): OniProject {
  const blocks: OniProject['blocks'] = [];
  diList.forEach((d, idx) => {
    blocks.push({
      id: `st_di_${d.ch}`,
      type: 'DI',
      channelIndex: d.ch,
      x: 90,
      y: 70 + idx * 85,
      customName: d.name,
      comment: '',
      showParams: false,
      retentive: false,
      protectedBlock: false,
      invertedInputs: {},
      params: { simSwitchMode: d.nc ? 'momentary_nc' : 'toggle' },
    });
  });
  aiList.forEach((a, idx) => {
    blocks.push({
      id: `st_ai_${a.ch}`,
      type: 'AI',
      channelIndex: a.ch,
      x: 90,
      y: 70 + (diList.length + idx) * 85,
      customName: a.name,
      comment: '',
      showParams: false,
      retentive: false,
      protectedBlock: false,
      invertedInputs: {},
      params: {},
    });
  });
  doList.forEach((q, idx) => {
    blocks.push({
      id: `st_do_${q.ch}`,
      type: 'DO',
      channelIndex: q.ch,
      x: 820,
      y: 90 + idx * 95,
      customName: q.name,
      comment: '',
      showParams: false,
      retentive: false,
      protectedBlock: false,
      invertedInputs: {},
      params: {},
    });
  });

  return {
    version: '1.0.0',
    name: `Задача: ${title}`,
    author: 'Практикум КИПовца',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    controllerId: 'PLR-S-CPU-1206',
    expansionIds: ['PLR-S-EMA-0400'],
    activeLanguage: 'FBD',
    activePlant: 'none',
    analogConfigs: defaultAnalogConfigs(),
    blocks,
    wires: [],
    notes: [
      {
        id: 'st_note',
        x: 90,
        y: 430,
        text: `Задание: ${title}\nСоедините входы и выходы функциональными блоками из библиотеки слева,\nзатем нажмите «Проверить решение» в окне Практикума.`,
      },
    ],
    ldRungs: [],
    hmiWidgets: [],
  };
}

export const KIP_PRACTICE_TASKS: KipPracticeTask[] = [
  {
    id: 'task_01_pusk_stop',
    number: 1,
    level: 'Базовый',
    title: 'Пуск–Стоп электродвигателя с самоподхватом (приоритет СТОП)',
    plantContext: 'Щит управления вентилятором вытяжки ЩУВ-1',
    objective:
      'Кратковременное нажатие кнопки ПУСК (I1=1 → 0) должно включать контактор двигателя Q1 и удерживать его включённым. Нажатие кнопки СТОП (I2=1) должно отключать Q1. При одновременном нажатии ПУСК и СТОП двигатель обязан быть выключен.',
    ioTable: [
      { pin: 'I1', role: 'Кнопка ПУСК (1 = нажата)' },
      { pin: 'I2', role: 'Кнопка СТОП (1 = нажата)' },
      { pin: 'Q1', role: 'Контактор двигателя KM1' },
    ],
    hint: 'Используйте блок «RS-триггер» (приоритет сброса R): подключите I1 на вход S, I2 на вход R, а выход триггера на Q1. Либо соберите классический самоподхват на блоках ИЛИ + И с инверсией входа от I2.',
    steps: [
      { description: 'Исходное состояние (I1=0, I2=0) → Q1 выключен', setDi: { 1: false, 2: false }, advanceSec: 0.2, expectDo: { 1: false } },
      { description: 'Нажатие ПУСК (I1=1, I2=0) → Q1 включается', setDi: { 1: true, 2: false }, advanceSec: 0.2, expectDo: { 1: true } },
      { description: 'Отпускание ПУСК (I1=0, I2=0) → самоподхват удерживает Q1=ON', setDi: { 1: false, 2: false }, advanceSec: 0.3, expectDo: { 1: true } },
      { description: 'Нажатие СТОП (I1=0, I2=1) → Q1 выключается', setDi: { 1: false, 2: true }, advanceSec: 0.2, expectDo: { 1: false } },
      { description: 'Одновременно ПУСК=1 и СТОП=1 → приоритет СТОП (Q1=OFF)', setDi: { 1: true, 2: true }, advanceSec: 0.2, expectDo: { 1: false } },
    ],
    createStarter: () =>
      makeBlankTaskStarter('01. Пуск-Стоп с самоподхватом', [{ ch: 1, name: 'SB1 Пуск' }, { ch: 2, name: 'SB2 Стоп' }], [], [{ ch: 1, name: 'KM1 Двигатель' }]),
  },

  {
    id: 'task_02_nc_thermal',
    number: 2,
    level: 'Базовый',
    title: 'Реальная цепь КИПиА: НЗ кнопка СТОП и тепловое реле КК1',
    plantContext: 'Насос подачи теплоносителя с защитой от перегрузки',
    objective:
      'В реальном шкафу кнопка СТОП (I2) и контакт теплового реле КК1 (I3) — нормально закрытые (в норме на входе «1», при нажатии Стоп или обрыве провода — «0»!). Реализуйте пуск насоса Q1 по кнопке I1, останов при размыкании I2=0 или срабатывании КК1 (I3=0), и включение аварийной лампы Q2 при перегрузке (I3=0).',
    ioTable: [
      { pin: 'I1', role: 'Кнопка ПУСК НО (1 = нажата)' },
      { pin: 'I2', role: 'Кнопка СТОП НЗ (1 = норма, 0 = нажата/обрыв)' },
      { pin: 'I3', role: 'Тепловое реле КК1 НЗ (1 = норма, 0 = перегрузка!)' },
      { pin: 'Q1', role: 'Контактор насоса KM1' },
      { pin: 'Q2', role: 'Лампа «Авария теплового реле» HL_Авар' },
    ],
    hint: 'Чтобы подать сброс R на RS-триггер при пропадании I2 или I3, объедините I2 и I3 через «И-НЕ (NAND)» (выход NAND станет 1, как только хотя бы один из НЗ-контактов разомкнётся в 0!). А на лампу Q2 подайте I3 через блок «НЕ (NOT)».',
    steps: [
      { description: 'Норма на старте (I1=0, I2=1, I3=1) → Q1=0, Q2=0', setDi: { 1: false, 2: true, 3: true }, advanceSec: 0.2, expectDo: { 1: false, 2: false } },
      { description: 'Импульс ПУСК (I1=1 → 0 при I2=1, I3=1) → Насос Q1 работает', setDi: { 1: true, 2: true, 3: true }, advanceSec: 0.2, expectDo: { 1: true, 2: false } },
      { description: 'ПУСК отпущена (I1=0, I2=1, I3=1) → Насос Q1 продолжает работу', setDi: { 1: false, 2: true, 3: true }, advanceSec: 0.2, expectDo: { 1: true, 2: false } },
      { description: 'Размыкание кнопки СТОП НЗ (I2=0) → Насос Q1 отключён, аварии нет (Q2=0)', setDi: { 1: false, 2: false, 3: true }, advanceSec: 0.2, expectDo: { 1: false, 2: false } },
      { description: 'Повторный ПУСК (I1=1, I2=1, I3=1) → Насос Q1 снова в работе', setDi: { 1: true, 2: true, 3: true }, advanceSec: 0.2, expectDo: { 1: true, 2: false } },
      { description: 'Сработало тепловое реле КК1 (I3=0) → Насос Q1 выключен, горит Авария Q2=1', setDi: { 1: false, 2: true, 3: false }, advanceSec: 0.2, expectDo: { 1: false, 2: true } },
    ],
    createStarter: () =>
      makeBlankTaskStarter(
        '02. НЗ Стоп + Тепловое реле КК1',
        [{ ch: 1, name: 'SB1 Пуск НО' }, { ch: 2, name: 'SB2 Стоп НЗ', nc: true }, { ch: 3, name: 'KK1 Тепл.реле НЗ', nc: true }],
        [],
        [{ ch: 1, name: 'KM1 Насос' }, { ch: 2, name: 'HL Авария КК1' }]
      ),
  },

  {
    id: 'task_03_valve_interlock',
    number: 3,
    level: 'Базовый',
    title: 'Реверсивная электрозадвижка с взаимной блокировкой и концевиками',
    plantContext: 'Задвижка подачи сетевой воды с электроприводом МЭО / AUMA',
    objective:
      'По кнопке «Открыть» (I1) включается пускатель открытия Q1 до срабатывания концевика КВО (I4=1) или кнопки «Стоп» (I3=1). По кнопке «Закрыть» (I2) включается Q2 до концевика КВЗ (I5=1) или Стоп (I3=1). Включение «Закрыть» во время открытия запрещено без предварительного Стоп (взаимная электрическая блокировка пускателей Q1 и Q2 от межфазного КЗ!).',
    ioTable: [
      { pin: 'I1', role: 'Кнопка «Открыть» (1 = нажата)' },
      { pin: 'I2', role: 'Кнопка «Закрыть» (1 = нажата)' },
      { pin: 'I3', role: 'Кнопка «Стоп» (1 = нажата)' },
      { pin: 'I4', role: 'Концевой выключатель КВО «Открыто» (1 = дошла)' },
      { pin: 'I5', role: 'Концевой выключатель КВЗ «Закрыто» (1 = дошла)' },
      { pin: 'Q1', role: 'Пускатель КМ_Открыть' },
      { pin: 'Q2', role: 'Пускатель КМ_Закрыть' },
    ],
    hint: 'Поставьте два RS-триггера (Открытие и Закрытие). На вход S первого подавайте I1 ЧЕРЕЗ блок «И» с инверсией от выхода второго триггера (блокировка!). На вход R первого подавайте ИЛИ(I3 Стоп, I4 КВО). Аналогично для второго канала.',
    steps: [
      { description: 'Старт: всё выключено', setDi: { 1: false, 2: false, 3: false, 4: false, 5: false }, advanceSec: 0.2, expectDo: { 1: false, 2: false } },
      { description: 'Нажали Открыть (I1=1 → 0) → идёт открытие Q1=1, Q2=0', setDi: { 1: true }, advanceSec: 0.2, expectDo: { 1: true, 2: false } },
      { description: 'Отпустили I1, попытка нажать Закрыть (I2=1) на ходу → взаимная блокировка не даёт включить Q2!', setDi: { 1: false, 2: true }, advanceSec: 0.2, expectDo: { 1: true, 2: false } },
      { description: 'Задвижка дошла до концевика КВО (I4=1) → Q1 автоматически отключается', setDi: { 2: false, 4: true }, advanceSec: 0.2, expectDo: { 1: false, 2: false } },
      { description: 'Нажали Закрыть (I2=1, КВО разомкнулся I4=0) → идёт закрытие Q2=1', setDi: { 2: true, 4: false }, advanceSec: 0.2, expectDo: { 1: false, 2: true } },
      { description: 'Дошла до концевика КВЗ (I5=1) → Q2 отключается', setDi: { 2: false, 5: true }, advanceSec: 0.2, expectDo: { 1: false, 2: false } },
    ],
    createStarter: () =>
      makeBlankTaskStarter(
        '03. Реверс задвижки с концевиками',
        [
          { ch: 1, name: 'SB1 Открыть' },
          { ch: 2, name: 'SB2 Закрыть' },
          { ch: 3, name: 'SB3 Стоп' },
          { ch: 4, name: 'SQ1 КВО Откр' },
          { ch: 5, name: 'SQ2 КВЗ Закр' },
        ],
        [],
        [{ ch: 1, name: 'KM1 Открыть' }, { ch: 2, name: 'KM2 Закрыть' }]
      ),
  },

  {
    id: 'task_04_prestart_horn',
    number: 4,
    level: 'Средний',
    title: 'Предпусковая предупредительная сирена конвейера (3 секунды)',
    plantContext: 'Ленточный конвейер подачи сырья (требование ПБ)',
    objective:
      'По нажатию кнопки ПУСК (I1=1 → 0) сначала на 3 секунды должна включиться предупредительная сирена Q2 (двигатель Q1 ещё стоит!). Спустя 3 секунды сирена Q2 выключается и запускается двигатель ленты Q1. Кнопка СТОП (I2=1) в любой момент мгновенно останавливает и сирену, и конвейер.',
    ioTable: [
      { pin: 'I1', role: 'Кнопка ПУСК (импульс)' },
      { pin: 'I2', role: 'Кнопка СТОП (1 = стоп)' },
      { pin: 'Q1', role: 'Привод конвейера KM1' },
      { pin: 'Q2', role: 'Предпусковая сирена HA1 (3 с)' },
    ],
    hint: 'Защёлкните режим «Пуск активен» на RS-триггере (S=I1, R=I2). Выход RS подайте на таймер задержки включения TON (T = 3.0 с). Выход TON включает привод Q1. А сирена Q2 работает, когда RS=1 И TON=0 (блок И с инверсией второго входа)!',
    steps: [
      { description: 'Исходное состояние → Q1=0, Q2=0', setDi: { 1: false, 2: false }, advanceSec: 0.2, expectDo: { 1: false, 2: false } },
      { description: 'Нажали и отпустили ПУСК: идёт 1-я секунда → звучит сирена Q2=1, лента Q1=0', setDi: { 1: true, 2: false }, advanceSec: 0.2, expectDo: { 1: false, 2: true } },
      { description: 'Через 1.5 с после отпускания I1 → сирена Q2 всё ещё звучит, Q1=0', setDi: { 1: false, 2: false }, advanceSec: 1.5, expectDo: { 1: false, 2: true } },
      { description: 'Прошло > 3.2 с → сирена Q2 погасла, конвейер Q1 запущен!', advanceSec: 2.0, expectDo: { 1: true, 2: false } },
      { description: 'Нажатие СТОП (I2=1) → конвейер Q1 остановлен', setDi: { 2: true }, advanceSec: 0.2, expectDo: { 1: false, 2: false } },
    ],
    createStarter: () =>
      makeBlankTaskStarter(
        '04. Предпусковая сирена 3 с',
        [{ ch: 1, name: 'SB1 Пуск' }, { ch: 2, name: 'SB2 Стоп' }],
        [],
        [{ ch: 1, name: 'KM1 Конвейер' }, { ch: 2, name: 'HA1 Сирена 3с' }]
      ),
  },

  {
    id: 'task_05_heater_purge',
    number: 5,
    level: 'Средний',
    title: 'Приточная установка: продувка электрокалорифера после СТОП (TOF 4 с)',
    plantContext: 'Приточная вентиляция ПВУ с электрическим ТЭНовым нагревателем',
    objective:
      'При включённом тумблере «Работа» (I1=1) работают приточный вентилятор Q1 и контактор ТЭНов Q2. Как только тумблер переводят в «Стоп» (I1=0), ТЭНы Q2 обязаны отключиться мгновенно, а вентилятор Q1 должен вращаться ещё 4 секунды (продувка для снятия тепла с раскалённых ТЭНов) и затем отключиться!',
    ioTable: [
      { pin: 'I1', role: 'Тумблер «Работа ПВУ» (1 = Вкл, 0 = Стоп)' },
      { pin: 'Q1', role: 'Вентилятор приточный (+4 с выбег продувки)' },
      { pin: 'Q2', role: 'Контактор ТЭНов калорифера' },
    ],
    hint: 'Подайте сигнал I1 напрямую на катушку ТЭНов Q2, а на вентилятор Q1 подайте сигнал через блок «Задержка выключения (TOF)» с параметром T = 4.0 с!',
    steps: [
      { description: 'ПВУ выключена (I1=0) → Q1=0, Q2=0', setDi: { 1: false }, advanceSec: 0.2, expectDo: { 1: false, 2: false } },
      { description: 'Включили работу (I1=1) → работают и вентилятор Q1=1, и ТЭНы Q2=1', setDi: { 1: true }, advanceSec: 0.5, expectDo: { 1: true, 2: true } },
      { description: 'Выключили ПВУ (I1=0), прошло 1.5 с → ТЭНы Q2=0 отключены, вентилятор Q1=1 продувает!', setDi: { 1: false }, advanceSec: 1.5, expectDo: { 1: true, 2: false } },
      { description: 'Прошло ещё 3.0 с (всего 4.5 с продувки) → вентилятор Q1 остановился', advanceSec: 3.0, expectDo: { 1: false, 2: false } },
    ],
    createStarter: () =>
      makeBlankTaskStarter('05. Продувка калорифера TOF 4с', [{ ch: 1, name: 'SA1 Работа ПВУ' }], [], [{ ch: 1, name: 'KM1 Вентилятор' }, { ch: 2, name: 'KM2 ТЭНы' }]),
  },

  {
    id: 'task_06_alarm_ack',
    number: 6,
    level: 'Средний',
    title: 'Аварийная ячейка КИПиА с квитированием звука',
    plantContext: 'Щит сигнализации котельной',
    objective:
      'При появлении сигнала аварии (I1=1) должна включиться сирена Q2 и сигнальная лампа Q1 (мигающая или включённая). После нажатия кнопки «Квитирование» (I2=1 → 0) сирена Q2 обязана отключиться, а лампа Q1 — гореть ровно (постоянно Q1=1) до тех пор, пока авария I1 не исчезнет (I1=0). При исчезновении аварии всё гаснет и готово к новому циклу.',
    ioTable: [
      { pin: 'I1', role: 'Контакт датчика аварии (1 = Авария)' },
      { pin: 'I2', role: 'Кнопка «Квитирование / Съём звука»' },
      { pin: 'Q1', role: 'Лампа «Авария» HL1' },
      { pin: 'Q2', role: 'Звуковая сирена HA1' },
    ],
    hint: 'Запоминайте квитирование в RS-триггере (S = I2, R = НЕ(I1)). Пока I1=1 и RS=0 — работает сирена Q2 и генератор BLINK на Q1. Когда I1=1 и RS=1 — сирена Q2 гаснет, а Q1 запитывается постоянной единицей через ИЛИ!',
    steps: [
      { description: 'Норма (I1=0, I2=0) → тишина, лампа погашена', setDi: { 1: false, 2: false }, advanceSec: 0.2, expectDo: { 1: false, 2: false } },
      { description: 'Пришла авария (I1=1) → ревёт сирена Q2=1', setDi: { 1: true, 2: false }, advanceSec: 0.2, expectDo: { 2: true } },
      { description: 'Оператор нажал Квитирование (I2=1 → 0) → сирена Q2=0 погасла, лампа Q1=1 горит ровно', setDi: { 1: true, 2: true }, advanceSec: 0.2, expectDo: { 1: true, 2: false } },
      { description: 'Отпустили кнопку I2=0 (авария ещё висит) → Q1=1 продолжает гореть ровно, Q2=0 молчит', setDi: { 1: true, 2: false }, advanceSec: 0.7, expectDo: { 1: true, 2: false } },
      { description: 'Авария устранена (I1=0) → лампа Q1 гаснет, схема сбрасывается', setDi: { 1: false, 2: false }, advanceSec: 0.3, expectDo: { 1: false, 2: false } },
    ],
    createStarter: () =>
      makeBlankTaskStarter(
        '06. Ячейка сигнализации с квитированием',
        [{ ch: 1, name: 'Датчик аварии' }, { ch: 2, name: 'SB Квитирование' }],
        [],
        [{ ch: 1, name: 'HL1 Лампа аварии' }, { ch: 2, name: 'HA1 Сирена' }]
      ),
  },

  {
    id: 'task_07_batch_counter',
    number: 7,
    level: 'Средний',
    title: 'Счётчик фасовки партии из 5 изделий с блокировкой подачи',
    plantContext: 'Упаковочный конвейер цеха розлива',
    objective:
      'При включённом разрешении линии (I3=1) работает лента подачи Q1, пока в коробке меньше 5 бутылок. Каждый импульс оптического датчика I1 увеличивает счёт на 1. При достижении 5 шт. конвейер Q1 останавливается и включается толкатель упаковки Q2=1. Кнопка «Сброс партии» (I2=1 → 0) обнуляет счётчик для следующей коробки.',
    ioTable: [
      { pin: 'I1', role: 'Фотодатчик прохода изделия (импульсы 0→1)' },
      { pin: 'I2', role: 'Кнопка «Сброс партии»' },
      { pin: 'I3', role: 'Тумблер «Линия ВКЛ» (1 = работа)' },
      { pin: 'Q1', role: 'Привод конвейера подачи' },
      { pin: 'Q2', role: 'Сигнал «Партия 5 шт. набрана / Упаковка»' },
    ],
    hint: 'Поставьте «Реверсивный счётчик (CTUD)» с порогом ON = 5, OFF = 5: вход Cnt ← I1, вход R ← I2. Выход счётчика подайте на Q2, а на конвейер Q1 подайте И(I3, НЕ(выход счётчика)).',
    steps: [
      { description: 'Линия включена (I3=1), счёт = 0 → конвейер Q1=1 едет, Q2=0', setDi: { 1: false, 2: false, 3: true }, advanceSec: 0.2, expectDo: { 1: true, 2: false } },
      { description: '1-й импульс датчика', setDi: { 1: true }, advanceSec: 0.1, expectDo: { 1: true, 2: false } },
      { description: 'Спад 1-го импульса', setDi: { 1: false }, advanceSec: 0.1 },
      { description: '2-й импульс', setDi: { 1: true }, advanceSec: 0.1 },
      { description: 'Спад 2-го', setDi: { 1: false }, advanceSec: 0.1 },
      { description: '3-й импульс', setDi: { 1: true }, advanceSec: 0.1 },
      { description: 'Спад 3-го', setDi: { 1: false }, advanceSec: 0.1 },
      { description: '4-й импульс → пока 4 шт., Q1=1, Q2=0', setDi: { 1: true }, advanceSec: 0.1, expectDo: { 1: true, 2: false } },
      { description: 'Спад 4-го', setDi: { 1: false }, advanceSec: 0.1 },
      { description: '5-й импульс → партия набрана! Q1=0 стоп, Q2=1 упаковка', setDi: { 1: true }, advanceSec: 0.1, expectDo: { 1: false, 2: true } },
      { description: 'Сброс партии (I2=1) → счёт 0, конвейер Q1 снова запущен!', setDi: { 1: false, 2: true }, advanceSec: 0.2, expectDo: { 1: true, 2: false } },
    ],
    createStarter: () =>
      makeBlankTaskStarter(
        '07. Счётчик партии 5 шт.',
        [{ ch: 1, name: 'SQ Фотодатчик' }, { ch: 2, name: 'SB Сброс счёта' }, { ch: 3, name: 'SA Линия ВКЛ' }],
        [],
        [{ ch: 1, name: 'KM1 Подача' }, { ch: 2, name: 'YV1 Упаковка' }]
      ),
  },

  {
    id: 'task_08_tank_hysteresis',
    number: 8,
    level: 'Продвинутый КИПиА',
    title: 'Двухпозиционное регулирование уровня в баке (гистерезис 250..800)',
    plantContext: 'Накопительная ёмкость деаэрированной воды',
    objective:
      'На вход AI1 поступает сигнал уровнемера (код 0..1000). Чтобы насос подкачки Q1 не дёргался от волн на поверхности, реализуйте гистерезис: насос Q1 должен включаться при падении кода AI1 ≤ 250 и оставаться включённым до заполнения бака AI1 ≥ 800, после чего отключаться до следующего падения ≤ 250.',
    ioTable: [
      { pin: 'AI1', role: 'Датчик уровня бака (код 0..1000)' },
      { pin: 'Q1', role: 'Насос подкачки KM1' },
    ],
    hint: 'Используйте блок «Аналоговый пороговый выключатель (ATRG)» в режиме «Обратный (Вкл ≤ ON, Выкл ≥ OFF — подкачка)» с порогами ON = 250, OFF = 800!',
    steps: [
      { description: 'Уровень средний (AI1 = 500) при старте → насос Q1=0 выключен', setAi: { 1: 500 }, advanceSec: 0.2, expectDo: { 1: false } },
      { description: 'Уровень упал до 220 (≤ 250) → насос Q1=1 включился на закачку', setAi: { 1: 220 }, advanceSec: 0.2, expectDo: { 1: true } },
      { description: 'Бак наполняется: уровень 600 → насос Q1=1 продолжает качать (гистерезис!)', setAi: { 1: 600 }, advanceSec: 0.2, expectDo: { 1: true } },
      { description: 'Бак полон: уровень достиг 830 (≥ 800) → насос Q1=0 отключился', setAi: { 1: 830 }, advanceSec: 0.2, expectDo: { 1: false } },
      { description: 'Воду разбирают: уровень снизился до 450 → насос Q1=0 ещё ждёт нижнего порога', setAi: { 1: 450 }, advanceSec: 0.2, expectDo: { 1: false } },
    ],
    createStarter: () =>
      makeBlankTaskStarter('08. Уровень с гистерезисом 250..800', [], [{ ch: 1, name: 'LT101 Уровень' }], [{ ch: 1, name: 'KM1 Насос' }]),
  },

  {
    id: 'task_09_loop_break_4_20',
    number: 9,
    level: 'Продвинутый КИПиА',
    title: 'Терморегулятор + Защита от обрыва токовой петли 4–20 мА',
    plantContext: 'Обогрев технологического трубопровода с датчиком 4–20 мА',
    objective:
      'Датчик температуры подключён по токовой петле 4–20 мА (4 мА = код 200, 20 мА = код 1000). Нагреватель Q1 должен включаться при коде ≤ 450 и выключаться при ≥ 650. НО если произошёл обрыв линии датчика (код AI1 упал ниже 180, т.е. ток < 3.6 мА!), нагреватель Q1 обязан МГНОВЕННО заблокироваться (Q1=0) и должна зажечься лампа «Обрыв датчика» Q2=1!',
    ioTable: [
      { pin: 'AI1', role: 'Токовый вход 0..20 мА (норма 200..1000, обрыв < 180)' },
      { pin: 'Q1', role: 'Контактор обогрева' },
      { pin: 'Q2', role: 'Авария «Обрыв цепи датчика 4–20 мА»' },
    ],
    hint: 'Сочетайте блок ATRG (режим нагрева ON=450, OFF=650) и блок AWD «Аналоговый сторож» (Min=180, Max=1020). Выход AWD подайте на лампу Q2 и через инверсию на блок И перед катушкой нагревателя Q1!',
    steps: [
      { description: 'Холодная труба в норме (AI1 = 350 ед. = 7 мА) → Обогрев Q1=1 включён, обрыва нет Q2=0', setAi: { 1: 350 }, advanceSec: 0.2, expectDo: { 1: true, 2: false } },
      { description: 'Нагрелась до 700 ед. (14 мА) → Обогрев Q1=0 штатно выключился, Q2=0', setAi: { 1: 700 }, advanceSec: 0.2, expectDo: { 1: false, 2: false } },
      { description: 'Остыла до 400 ед. → Обогрев Q1=1 снова включился', setAi: { 1: 400 }, advanceSec: 0.2, expectDo: { 1: true, 2: false } },
      { description: 'ОБРЫВ ПРОВОДА ДАТЧИКА (AI1 = 20 ед. ≈ 0.4 мА)! → Q1=0 заблокирован, Q2=1 АВАРИЯ ОБРЫВА!', setAi: { 1: 20 }, advanceSec: 0.2, expectDo: { 1: false, 2: true } },
    ],
    createStarter: () =>
      makeBlankTaskStarter(
        '09. Контроль обрыва 4-20 мА',
        [],
        [{ ch: 1, name: 'TT101 4-20мА' }],
        [{ ch: 1, name: 'KM1 Обогрев' }, { ch: 2, name: 'HL Обрыв AI1' }]
      ),
  },

  {
    id: 'task_10_pump_avr',
    number: 10,
    level: 'Продвинутый КИПиА',
    title: 'АВР двух насосов по невыходу на режим (реле протока PDS за 3 с)',
    plantContext: 'Циркуляционный узел котельной (Основной + Резервный насос)',
    objective:
      'При подаче сигнала «Работа станции» (I1=1) запускается Основной насос Q1. Если в течение 3 секунд датчик протока PDS (I2) не выдал сигнал «1» (I2=0), насос Q1 признаётся аварийным (отключается Q1=0, зажигается лампа аварии Q3=1) и автоматически запускается Резервный насос Q2=1! Кнопка «Сброс аварии» (I3=1) снимает аварию.',
    ioTable: [
      { pin: 'I1', role: 'Ключ «Работа станции» (1 = Вкл)' },
      { pin: 'I2', role: 'Реле перепада давления / протока PDS (1 = проток есть)' },
      { pin: 'I3', role: 'Кнопка «Сброс аварии Н1»' },
      { pin: 'Q1', role: 'Основной насос №1' },
      { pin: 'Q2', role: 'Резервный насос №2' },
      { pin: 'Q3', role: 'Лампа «Авария насоса №1»' },
    ],
    hint: 'Контролируйте условие И(Q1_команда, НЕ(I2)) таймером TON на 3.0 с. Выход TON взводит RS-триггер «Авария Н1» (сброс от I3). Когда RS=0 и I1=1 — работает Q1; когда RS=1 и I1=1 — работает Q2 и горит Q3!',
    steps: [
      { description: 'Станция выключена (I1=0) → все выходы 0', setDi: { 1: false, 2: false, 3: false }, advanceSec: 0.2, expectDo: { 1: false, 2: false, 3: false } },
      { description: 'Пуск станции (I1=1), первые 1.5 с разгона без протока (I2=0) → качает Q1=1, АВР ещё ждёт', setDi: { 1: true, 2: false, 3: false }, advanceSec: 1.5, expectDo: { 1: true, 2: false, 3: false } },
      { description: 'Прошло 3.3 с без протока (I2=0) → сработал АВР! Q1=0 откл., Q2=1 резерв в работе, Q3=1 авария!', advanceSec: 2.0, expectDo: { 1: false, 2: true, 3: true } },
      { description: 'Появился проток от резервного насоса (I2=1) → резервный Q2=1 стабильно держит подачу!', setDi: { 2: true }, advanceSec: 1.0, expectDo: { 1: false, 2: true, 3: true } },
      { description: 'Сброс аварии оператором (I3=1) при наличии протока → возврат на основной насос Q1=1, Q3=0', setDi: { 3: true }, advanceSec: 0.3, expectDo: { 1: true, 2: false, 3: false } },
    ],
    createStarter: () =>
      makeBlankTaskStarter(
        '10. АВР двух насосов по реле протока',
        [{ ch: 1, name: 'SA1 Работа' }, { ch: 2, name: 'PDS Проток' }, { ch: 3, name: 'SB Сброс АВР' }],
        [],
        [{ ch: 1, name: 'KM1 Насос 1' }, { ch: 2, name: 'KM2 Насос 2' }, { ch: 3, name: 'HL Авария Н1' }]
      ),
  },
];
