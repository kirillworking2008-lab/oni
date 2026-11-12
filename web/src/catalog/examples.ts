import { defaultAnalogConfigs } from '../engine/xlgCodec';
import { OniProject } from '../types';

export interface ExampleProjectEntry {
  id: string;
  title: string;
  subtitle: string;
  kipDomain: string;
  build: () => OniProject;
}

export const ONI_EXAMPLE_PROJECTS: ExampleProjectEntry[] = [
  {
    id: 'ex_pusk_stop',
    title: '01. Пуск-Стоп с самоподхватом (RS-триггер)',
    subtitle: 'Классическая базовая схема ONI PLR Studio: I1 Пуск → S, I2 Стоп → R, выход Q1 с приоритетом СТОП',
    kipDomain: 'Электропривод / База',
    build: () => ({
      version: '1.0.0',
      name: 'ONI PLR 1 — Пуск-Стоп',
      author: 'ONI PLR Studio',
      createdAt: '2026-11-11T08:00:00Z',
      updatedAt: '2026-11-11T08:00:00Z',
      controllerId: 'PLR-S-CPU-1206',
      expansionIds: [],
      activeLanguage: 'FBD',
      activePlant: 'none',
      analogConfigs: defaultAnalogConfigs(),
      blocks: [
        {
          id: 'b_i1',
          type: 'DI',
          channelIndex: 1,
          x: 130,
          y: 90,
          customName: 'SB1 Пуск',
          comment: 'Кнопка ПУСК (НО)',
          showParams: false,
          retentive: false,
          protectedBlock: false,
          invertedInputs: {},
          params: { simSwitchMode: 'toggle' },
        },
        {
          id: 'b_i2',
          type: 'DI',
          channelIndex: 2,
          x: 130,
          y: 230,
          customName: 'SB2 Стоп',
          comment: 'Кнопка СТОП',
          showParams: false,
          retentive: false,
          protectedBlock: false,
          invertedInputs: {},
          params: { simSwitchMode: 'toggle' },
        },
        {
          id: 'b_rs1',
          type: 'RS',
          channelIndex: 1,
          x: 420,
          y: 160,
          customName: 'M1',
          comment: 'RS-триггер памяти пуска (приоритет сброса R)',
          showParams: true,
          retentive: false,
          protectedBlock: false,
          invertedInputs: {},
          params: {},
        },
        {
          id: 'b_q1',
          type: 'DO',
          channelIndex: 1,
          x: 690,
          y: 160,
          customName: 'KM1 Двигатель',
          comment: 'Контактор электродвигателя',
          showParams: false,
          retentive: false,
          protectedBlock: false,
          invertedInputs: {},
          params: {},
        },
      ],
      wires: [
        { id: 'w1', fromBlockId: 'b_i1', fromPinId: 'Q', toBlockId: 'b_rs1', toPinId: 'S' },
        { id: 'w2', fromBlockId: 'b_i2', fromPinId: 'Q', toBlockId: 'b_rs1', toPinId: 'R' },
        { id: 'w3', fromBlockId: 'b_rs1', fromPinId: 'Q', toBlockId: 'b_q1', toPinId: 'In' },
      ],
      notes: [
        {
          id: 'n1',
          x: 70,
          y: 340,
          text: 'Пуск-Стоп с самоподхватом (ONI PLR Studio)\nI1 — кнопка ПУСК (подаёт сигнал на S)\nI2 — кнопка СТОП (сброс R с приоритетом)\nQ1 — контактор нагрузки KM1\nНажмите F3 (Симулятор) и щёлкайте по I001 / I002!',
        },
      ],
      ldRungs: [
        {
          id: 'r1',
          title: 'Ступень 1: Цепь пуска и самоподхвата контактора KM1 (Q1)',
          mainSeries: [
            { id: 'c1', kind: 'NO', operand: 'I1', comment: 'SB1 Пуск' },
            { id: 'c2', kind: 'NC', operand: 'I2', comment: 'SB2 Стоп' },
          ],
          parallelBranch: [{ id: 'p1', kind: 'NO', operand: 'Q1', comment: 'Блок-контакт KM1' }],
          outputElement: { id: 'o1', kind: 'COIL', operand: 'Q1', comment: 'Катушка KM1' },
        },
      ],
      hmiWidgets: [
        { id: 'h1', type: 'pushbutton', label: 'ПУСК (I1)', binding: 'I1', x: 30, y: 30, width: 130, height: 54, color: 'green', momentary: true },
        { id: 'h2', type: 'pushbutton', label: 'СТОП (I2)', binding: 'I2', x: 180, y: 30, width: 130, height: 54, color: 'red', momentary: true },
        { id: 'h3', type: 'lamp', label: 'РАБОТА KM1 (Q1)', binding: 'Q1', x: 340, y: 30, width: 150, height: 54, color: 'green' },
      ],
    }),
  },

  {
    id: 'ex_avr_pumps',
    title: '02. АВР двух насосов с контролем протока и сухого хода',
    subtitle: 'Основной насос Q1 → контроль реле протока PDS (I2) за 3 с → автопереход на Резервный насос Q2 + Авария Q3',
    kipDomain: 'КНС / ВНС / Водоснабжение',
    build: () => ({
      version: '1.0.0',
      name: 'АВР Насосной Станции',
      author: 'Инженер КИПиА',
      createdAt: '2026-11-11T08:00:00Z',
      updatedAt: '2026-11-11T08:00:00Z',
      controllerId: 'PLR-S-CPU-1206',
      expansionIds: ['PLR-S-EMA-0400'],
      activeLanguage: 'FBD',
      activePlant: 'pump_station',
      analogConfigs: [
        { channel: 1, tag: 'LT101 Уровень резервуара', standard: '4-20mA', minEng: 0, maxEng: 100, unit: '%' },
        { channel: 2, tag: 'PT102 Давление коллектора', standard: '4-20mA', minEng: 0, maxEng: 10, unit: 'бар' },
        { channel: 3, tag: 'TT101 Температура', standard: 'Pt100', minEng: -50, maxEng: 150, unit: '°C' },
        { channel: 4, tag: 'AI4 Резерв', standard: '0-10V', minEng: 0, maxEng: 100, unit: '%' },
      ],
      blocks: [
        {
          id: 'i1', type: 'DI', channelIndex: 1, x: 80, y: 60, customName: 'SA1 Работа АВТО',
          comment: 'Ключ разрешения работы станции', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: { simSwitchMode: 'toggle' },
        },
        {
          id: 'i2', type: 'DI', channelIndex: 2, x: 80, y: 150, customName: 'PDS Реле протока',
          comment: '1 = есть перепад давления на насосе', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: { simSwitchMode: 'toggle' },
        },
        {
          id: 'i3', type: 'DI', channelIndex: 3, x: 80, y: 240, customName: 'SB Сброс аварии',
          comment: 'Кнопка сброса аварии Насоса 1', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: { simSwitchMode: 'momentary_no' },
        },
        {
          id: 'i4', type: 'DI', channelIndex: 4, x: 80, y: 330, customName: 'LS Сухой ход (1=Норма)',
          comment: 'Датчик наличия воды во всасывающем коллекторе', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: { simSwitchMode: 'momentary_nc' },
        },
        {
          id: 'b1_run_ok', type: 'AND', channelIndex: 1, x: 270, y: 80, customName: 'Разреш',
          comment: 'Работа разрешена И есть вода (нет сухого хода)', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'b2_p1_cmd', type: 'AND', channelIndex: 2, x: 430, y: 70, customName: 'ПускН1',
          comment: 'Команда Насоса 1 при отсутствии аварии Н1', showParams: false, retentive: false, protectedBlock: false, invertedInputs: { I2: true }, params: {},
        },
        {
          id: 'b3_no_flow', type: 'AND', channelIndex: 3, x: 430, y: 180, customName: 'НетПрот',
          comment: 'Насос 1 включён, но реле протока I2 = 0', showParams: false, retentive: false, protectedBlock: false, invertedInputs: { I2: true }, params: {},
        },
        {
          id: 'b4_ton_avr', type: 'TON', channelIndex: 4, x: 580, y: 180, customName: 'Т_АВР',
          comment: 'Выдержка 3 с на разгон насоса и набор давления', showParams: true, retentive: false, protectedBlock: false, invertedInputs: {}, params: { delay: 3.0, unit: 's' },
        },
        {
          id: 'b5_rs_flt1', type: 'RS', channelIndex: 5, x: 740, y: 200, customName: 'АварН1',
          comment: 'Защёлка аварии Насоса 1 (сброс по I3)', showParams: false, retentive: true, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'b6_p2_cmd', type: 'AND', channelIndex: 6, x: 890, y: 130, customName: 'ПускН2',
          comment: 'Ввод резервного Насоса 2 при аварии Н1', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'q1', type: 'DO', channelIndex: 1, x: 1050, y: 60, customName: 'KM1 Насос №1',
          comment: 'Основной насос', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'q2', type: 'DO', channelIndex: 2, x: 1050, y: 140, customName: 'KM2 Насос №2',
          comment: 'Резервный насос АВР', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'q3', type: 'DO', channelIndex: 3, x: 1050, y: 230, customName: 'HL Авария Н1',
          comment: 'Лампа аварии Насоса №1', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'b7_msg', type: 'MSG', channelIndex: 7, x: 890, y: 310, customName: 'Экран',
          comment: 'Индикация на дисплее реле PLR-S', showParams: true, retentive: false, protectedBlock: false, invertedInputs: {},
          params: {
            priority: 20,
            backlight: 'amber',
            line1: 'АВР АКТИВЕН! Н2',
            line2: 'Уровень: {AI1}',
            line3: 'Давлен.: {AI2}',
            line4: 'Н1=АВАР  Н2={Q2}',
          },
        },
      ],
      wires: [
        { id: 'w1', fromBlockId: 'i1', fromPinId: 'Q', toBlockId: 'b1_run_ok', toPinId: 'I1' },
        { id: 'w2', fromBlockId: 'i4', fromPinId: 'Q', toBlockId: 'b1_run_ok', toPinId: 'I2' },
        { id: 'w3', fromBlockId: 'b1_run_ok', fromPinId: 'Q', toBlockId: 'b2_p1_cmd', toPinId: 'I1' },
        { id: 'w4', fromBlockId: 'b5_rs_flt1', fromPinId: 'Q', toBlockId: 'b2_p1_cmd', toPinId: 'I2' },
        { id: 'w5', fromBlockId: 'b2_p1_cmd', fromPinId: 'Q', toBlockId: 'q1', toPinId: 'In' },
        { id: 'w6', fromBlockId: 'b2_p1_cmd', fromPinId: 'Q', toBlockId: 'b3_no_flow', toPinId: 'I1' },
        { id: 'w7', fromBlockId: 'i2', fromPinId: 'Q', toBlockId: 'b3_no_flow', toPinId: 'I2' },
        { id: 'w8', fromBlockId: 'b3_no_flow', fromPinId: 'Q', toBlockId: 'b4_ton_avr', toPinId: 'Trg' },
        { id: 'w9', fromBlockId: 'b4_ton_avr', fromPinId: 'Q', toBlockId: 'b5_rs_flt1', toPinId: 'S' },
        { id: 'w10', fromBlockId: 'i3', fromPinId: 'Q', toBlockId: 'b5_rs_flt1', toPinId: 'R' },
        { id: 'w11', fromBlockId: 'b1_run_ok', fromPinId: 'Q', toBlockId: 'b6_p2_cmd', toPinId: 'I1' },
        { id: 'w12', fromBlockId: 'b5_rs_flt1', fromPinId: 'Q', toBlockId: 'b6_p2_cmd', toPinId: 'I2' },
        { id: 'w13', fromBlockId: 'b6_p2_cmd', fromPinId: 'Q', toBlockId: 'q2', toPinId: 'In' },
        { id: 'w14', fromBlockId: 'b5_rs_flt1', fromPinId: 'Q', toBlockId: 'q3', toPinId: 'In' },
        { id: 'w15', fromBlockId: 'b5_rs_flt1', fromPinId: 'Q', toBlockId: 'b7_msg', toPinId: 'En' },
      ],
      notes: [
        {
          id: 'n1',
          x: 70,
          y: 415,
          text: 'АВР насосов КИПиА: Включите I001 (SA1 Работа). Если за 3 с реле протока I002 (PDS) не замкнулось,\nНасос №1 (Q001) выводится в аварию (Q003) и автоматически запускается резервный Насос №2 (Q002).\nПерейдите на вкладку «Стенд КИПиА», чтобы проверить работу на живой модели насосной станции!',
        },
      ],
      ldRungs: [],
      hmiWidgets: [
        { id: 'h1', type: 'selector', label: 'РЕЖИМ РАБОТА (I1)', binding: 'I1', x: 25, y: 25, width: 150, height: 54, color: 'green' },
        { id: 'h2', type: 'pushbutton', label: 'СБРОС АВАРИИ (I3)', binding: 'I3', x: 190, y: 25, width: 150, height: 54, color: 'amber', momentary: true },
        { id: 'h3', type: 'lamp', label: 'НАСОС №1 (Q1)', binding: 'Q1', x: 360, y: 25, width: 135, height: 54, color: 'green' },
        { id: 'h4', type: 'lamp', label: 'НАСОС №2 РЕЗ (Q2)', binding: 'Q2', x: 510, y: 25, width: 150, height: 54, color: 'blue' },
        { id: 'h5', type: 'lamp', label: 'АВАРИЯ Н1 (Q3)', binding: 'Q3', x: 675, y: 25, width: 140, height: 54, color: 'red' },
      ],
    }),
  },

  {
    id: 'ex_level_4_20ma',
    title: '03. Подкачка резервуара по датчику 4–20 мА + Контроль обрыва линии',
    subtitle: 'Масштабирование 4–20 мА (0..100%), гистерезис насоса (Вкл ≤ 25%, Выкл ≥ 80%) и блокировка при обрыве < 3.7 мА',
    kipDomain: 'Уровнеметрия 4–20 мА',
    build: () => ({
      version: '1.0.0',
      name: 'Регулятор уровня 4-20мА',
      author: 'Инженер КИПиА',
      createdAt: '2026-11-11T08:00:00Z',
      updatedAt: '2026-11-11T08:00:00Z',
      controllerId: 'PLR-S-CPU-1206',
      expansionIds: ['PLR-S-EMA-0400'],
      activeLanguage: 'FBD',
      activePlant: 'pump_station',
      analogConfigs: defaultAnalogConfigs(),
      blocks: [
        {
          id: 'i1', type: 'DI', channelIndex: 1, x: 90, y: 60, customName: 'SA1 Автомат',
          comment: 'Разрешение автоматической подкачки', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: { simSwitchMode: 'toggle' },
        },
        {
          id: 'ai1', type: 'AI', channelIndex: 1, x: 90, y: 175, customName: 'LT101 4-20мА',
          comment: 'Гидростатический датчик уровня 4..20 мА (200..1000 ед.)', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'amp1', type: 'AMP', channelIndex: 1, x: 280, y: 140, customName: 'Шкала%',
          comment: 'Пересчёт 200..1000 (4..20мА) в 0..100%', showParams: true, retentive: false, protectedBlock: false, invertedInputs: {},
          params: { gain: 0.125, offset: -25, unitLabel: '%' },
        },
        {
          id: 'awd1', type: 'AWD', channelIndex: 2, x: 280, y: 265, customName: 'Обрыв4-20',
          comment: 'Сторож токовой петли: авария при коде < 185 (< 3.7 мА)', showParams: true, retentive: false, protectedBlock: false, invertedInputs: {},
          params: { minVal: 185, maxVal: 1030 },
        },
        {
          id: 'atrg1', type: 'ATRG', channelIndex: 3, x: 480, y: 140, customName: 'Гистерезис',
          comment: 'Включить насос при ≤ 25%, отключить при ≥ 80%', showParams: true, retentive: false, protectedBlock: false, invertedInputs: {},
          params: { gain: 1, offset: 0, mode: 'heat_or_fill', onThreshold: 25, offThreshold: 80 },
        },
        {
          id: 'and1', type: 'AND', channelIndex: 4, x: 690, y: 110, customName: 'РазрешПуск',
          comment: 'Режим Авто И Требуется подкачка И Датчик исправен', showParams: false, retentive: false, protectedBlock: false, invertedInputs: { I3: true }, params: {},
        },
        {
          id: 'q1', type: 'DO', channelIndex: 1, x: 890, y: 110, customName: 'KM1 Насос',
          comment: 'Насос заполнения бака', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'q2', type: 'DO', channelIndex: 2, x: 890, y: 265, customName: 'HL Обрыв AI1',
          comment: 'Авария обрыва линии датчика 4–20 мА', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
      ],
      wires: [
        { id: 'w1', fromBlockId: 'ai1', fromPinId: 'AQ', toBlockId: 'amp1', toPinId: 'Ax' },
        { id: 'w2', fromBlockId: 'ai1', fromPinId: 'AQ', toBlockId: 'awd1', toPinId: 'Ax' },
        { id: 'w3', fromBlockId: 'amp1', fromPinId: 'AQ', toBlockId: 'atrg1', toPinId: 'Ax' },
        { id: 'w4', fromBlockId: 'i1', fromPinId: 'Q', toBlockId: 'and1', toPinId: 'I1' },
        { id: 'w5', fromBlockId: 'atrg1', fromPinId: 'Q', toBlockId: 'and1', toPinId: 'I2' },
        { id: 'w6', fromBlockId: 'awd1', fromPinId: 'Q', toBlockId: 'and1', toPinId: 'I3' },
        { id: 'w7', fromBlockId: 'and1', fromPinId: 'Q', toBlockId: 'q1', toPinId: 'In' },
        { id: 'w8', fromBlockId: 'awd1', fromPinId: 'Q', toBlockId: 'q2', toPinId: 'In' },
      ],
      notes: [
        {
          id: 'n1',
          x: 80,
          y: 375,
          text: 'Золотое правило КИПовца: при обрыве токовой петли 4–20 мА ток падает в 0 мА (код АЦП = 0),\nчто без блока AWD система приняла бы за «пустой бак 0%» и затопила цех! Здесь AWD мгновенно блокирует насос.',
        },
      ],
      ldRungs: [],
      hmiWidgets: [],
    }),
  },

  {
    id: 'ex_pid_oven',
    title: '04. ПИ-регулятор температуры печи (Pt100 → ТРМ 4–20 мА)',
    subtitle: 'Плавное поддержание температуры термокамеры с защитным термостатом перегрева и выводом на ЖК-экран',
    kipDomain: 'Терморегулирование / ПИД',
    build: () => ({
      version: '1.0.0',
      name: 'ПИ-регулятор термокамеры',
      author: 'Инженер КИПиА',
      createdAt: '2026-11-11T08:00:00Z',
      updatedAt: '2026-11-11T08:00:00Z',
      controllerId: 'PLR-M-CPU-2006-KIP',
      expansionIds: ['PLR-S-EMA-PT100'],
      activeLanguage: 'FBD',
      activePlant: 'thermal_oven',
      analogConfigs: [
        { channel: 1, tag: 'TT101 Температура печи', standard: '4-20mA', minEng: 0, maxEng: 200, unit: '°C' },
        { channel: 2, tag: 'SP Задатчик температуры', standard: '0-10V', minEng: 0, maxEng: 200, unit: '°C' },
        { channel: 3, tag: 'AI3 Резерв', standard: '0-10V', minEng: 0, maxEng: 100, unit: '%' },
        { channel: 4, tag: 'AI4 Резерв', standard: '0-10V', minEng: 0, maxEng: 100, unit: '%' },
      ],
      blocks: [
        {
          id: 'i1', type: 'DI', channelIndex: 1, x: 90, y: 70, customName: 'SA1 Авто ПИ',
          comment: '1 = Автомат ПИ, 0 = Ручной режим', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: { simSwitchMode: 'toggle' },
        },
        {
          id: 'i3', type: 'DI', channelIndex: 3, x: 90, y: 165, customName: 'TSH Перегрев НЗ',
          comment: 'Аварийный термостат (1 = норма, 0 = перегрев > 165°C)', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: { simSwitchMode: 'momentary_nc' },
        },
        {
          id: 'ai1', type: 'AI', channelIndex: 1, x: 90, y: 265, customName: 'TT101 Печь',
          comment: 'Датчик температуры в печи', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'not1', type: 'NOT', channelIndex: 1, x: 280, y: 165, customName: 'АварТС',
          comment: 'Срабатывание защиты перегрева', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'pi1', type: 'PI', channelIndex: 2, x: 470, y: 170, customName: 'ПИ_Печь',
          comment: 'ПИ-регулятор мощности ТЭНов (уставка 600 = 100°C)', showParams: true, retentive: false, protectedBlock: false, invertedInputs: {},
          params: { spDefault: 600, kc: 2.4, ti: 6.0, dir: 'direct_heat', mq: 0 },
        },
        {
          id: 'ao1', type: 'AO', channelIndex: 1, x: 740, y: 170, customName: 'AQ1 ТРМ 4-20мА',
          comment: 'Сигнал 4..20 мА на тиристорный регулятор ТЭНов', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'msg1', type: 'MSG', channelIndex: 3, x: 740, y: 280, customName: 'Дисплей',
          comment: 'Экран оператора печи', showParams: true, retentive: false, protectedBlock: false, invertedInputs: {},
          params: {
            priority: 15,
            backlight: 'white',
            line1: 'ТЕРМОКАМЕРА ПИД',
            line2: 'Тек Т: {AI1}',
            line3: 'Мощн.: {AQ1}/1000',
            line4: 'Авто:  {I1}',
          },
        },
      ],
      wires: [
        { id: 'w1', fromBlockId: 'i1', fromPinId: 'Q', toBlockId: 'pi1', toPinId: 'AM' },
        { id: 'w2', fromBlockId: 'i3', fromPinId: 'Q', toBlockId: 'not1', toPinId: 'I1' },
        { id: 'w3', fromBlockId: 'not1', fromPinId: 'Q', toBlockId: 'pi1', toPinId: 'R' },
        { id: 'w4', fromBlockId: 'ai1', fromPinId: 'AQ', toBlockId: 'pi1', toPinId: 'PV' },
        { id: 'w5', fromBlockId: 'pi1', fromPinId: 'AQ', toBlockId: 'ao1', toPinId: 'In' },
        { id: 'w6', fromBlockId: 'i1', fromPinId: 'Q', toBlockId: 'msg1', toPinId: 'En' },
      ],
      notes: [
        {
          id: 'n1',
          x: 80,
          y: 380,
          text: 'Откройте нижнюю вкладку «Осциллограф КИПиА» и верхнюю вкладку «Стенд КИПиА (Термокамера)»,\nвключите I001 (Авто) и наблюдайте плавный выход температуры на уставку без автоколебаний!',
        },
      ],
      ldRungs: [],
      hmiWidgets: [],
    }),
  },

  {
    id: 'ex_alarm_ack',
    title: '05. Светозвуковая аварийная сигнализация с квитированием',
    subtitle: 'Классика щита КИПиА: при аварии лампа Q1 мигает и звучит сирена Q2; кнопка «Съём звука» I2 гасит сирену и переводит лампу на ровный свет',
    kipDomain: 'Щиты сигнализации КИПиА',
    build: () => ({
      version: '1.0.0',
      name: 'Щит аварийной сигнализации',
      author: 'Инженер КИПиА',
      createdAt: '2026-11-11T08:00:00Z',
      updatedAt: '2026-11-11T08:00:00Z',
      controllerId: 'PLR-S-CPU-0804',
      expansionIds: [],
      activeLanguage: 'FBD',
      activePlant: 'none',
      analogConfigs: defaultAnalogConfigs(),
      blocks: [
        {
          id: 'i1', type: 'DI', channelIndex: 1, x: 90, y: 90, customName: 'Датчик Аварии',
          comment: 'Аварийный контакт процесса (1 = Авария)', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: { simSwitchMode: 'toggle' },
        },
        {
          id: 'i2', type: 'DI', channelIndex: 2, x: 90, y: 230, customName: 'SB Квитирование',
          comment: 'Кнопка «Сброс звука / Квитирование»', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: { simSwitchMode: 'momentary_no' },
        },
        {
          id: 'not_alm', type: 'NOT', channelIndex: 1, x: 250, y: 270, customName: 'СбросКвит',
          comment: 'Автосброс квитирования при уходе аварии', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'rs_ack', type: 'RS', channelIndex: 2, x: 400, y: 220, customName: 'Квитиров',
          comment: 'Память подтверждения аварии оператором', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'blink1', type: 'BLINK', channelIndex: 3, x: 400, y: 70, customName: 'Мигание',
          comment: 'Генератор 0.5с / 0.5с для неквитированной аварии', showParams: true, retentive: false, protectedBlock: false, invertedInputs: {}, params: { th: 0.5, tl: 0.5 },
        },
        {
          id: 'and_steady', type: 'AND', channelIndex: 4, x: 580, y: 150, customName: 'РовнСвет',
          comment: 'Авария есть И квитирована → ровный свет', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'or_lamp', type: 'OR', channelIndex: 5, x: 740, y: 90, customName: 'ЛампаИЛИ',
          comment: 'Мигание ИЛИ ровное свечение', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'and_horn', type: 'AND', channelIndex: 6, x: 580, y: 260, customName: 'ЗвукРазр',
          comment: 'Авария есть И ещё НЕ квитирована → Сирена!', showParams: false, retentive: false, protectedBlock: false, invertedInputs: { I2: true }, params: {},
        },
        {
          id: 'q1', type: 'DO', channelIndex: 1, x: 910, y: 90, customName: 'HL1 Авария',
          comment: 'Аварийная лампа на двери шкафа', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
        {
          id: 'q2', type: 'DO', channelIndex: 2, x: 910, y: 260, customName: 'HA1 Сирена',
          comment: 'Звуковой оповещатель (ревун)', showParams: false, retentive: false, protectedBlock: false, invertedInputs: {}, params: {},
        },
      ],
      wires: [
        { id: 'w1', fromBlockId: 'i1', fromPinId: 'Q', toBlockId: 'blink1', toPinId: 'En' },
        { id: 'w2', fromBlockId: 'i1', fromPinId: 'Q', toBlockId: 'not_alm', toPinId: 'I1' },
        { id: 'w3', fromBlockId: 'i2', fromPinId: 'Q', toBlockId: 'rs_ack', toPinId: 'S' },
        { id: 'w4', fromBlockId: 'not_alm', fromPinId: 'Q', toBlockId: 'rs_ack', toPinId: 'R' },
        { id: 'w5', fromBlockId: 'i1', fromPinId: 'Q', toBlockId: 'and_steady', toPinId: 'I1' },
        { id: 'w6', fromBlockId: 'rs_ack', fromPinId: 'Q', toBlockId: 'and_steady', toPinId: 'I2' },
        { id: 'w7', fromBlockId: 'blink1', fromPinId: 'Q', toBlockId: 'or_lamp', toPinId: 'I1' },
        { id: 'w8', fromBlockId: 'and_steady', fromPinId: 'Q', toBlockId: 'or_lamp', toPinId: 'I2' },
        { id: 'w9', fromBlockId: 'or_lamp', fromPinId: 'Q', toBlockId: 'q1', toPinId: 'In' },
        { id: 'w10', fromBlockId: 'i1', fromPinId: 'Q', toBlockId: 'and_horn', toPinId: 'I1' },
        { id: 'w11', fromBlockId: 'rs_ack', fromPinId: 'Q', toBlockId: 'and_horn', toPinId: 'I2' },
        { id: 'w12', fromBlockId: 'and_horn', fromPinId: 'Q', toBlockId: 'q2', toPinId: 'In' },
      ],
      notes: [
        {
          id: 'n1',
          x: 80,
          y: 365,
          text: 'Ячейка сигнализации КИПиА: подайте I001=ON (мигает Q001 и гудит сирена Q002),\nнажмите I002 Квитирование — сирена замолкает, а лампа Q001 горит ровно до устранения аварии.',
        },
      ],
      ldRungs: [],
      hmiWidgets: [],
    }),
  },
];
