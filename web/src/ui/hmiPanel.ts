import { KipPlantSimulator } from '../engine/plantSimulator';
import { adcToEng, OniPlcSimulator } from '../engine/simulator';
import { HmiWidget, OniProject, PlantPresetId } from '../types';

export interface HmiPanelCallbacks {
  onMutate: (reason: string) => void;
  onSimInputChanged: () => void;
}

export class HmiAndPlantWorkbench {
  private root: HTMLElement;
  private project: OniProject;
  private sim: OniPlcSimulator;
  private plant: KipPlantSimulator;
  private cb: HmiPanelCallbacks;
  private subTab: 'plant' | 'hmi_builder' | 'din_wiring' = 'plant';

  constructor(
    container: HTMLElement,
    project: OniProject,
    sim: OniPlcSimulator,
    plant: KipPlantSimulator,
    cb: HmiPanelCallbacks
  ) {
    this.root = document.createElement('div');
    this.root.className = 'oni-hmi-workbench';
    container.appendChild(this.root);
    this.project = project;
    this.sim = sim;
    this.plant = plant;
    this.cb = cb;
    this.render();
  }

  public setProject(project: OniProject) {
    this.project = project;
    if (this.project.activePlant !== 'none') {
      this.plant.linkedToPlc = true;
    }
    this.render();
  }

  public refreshLiveValues() {
    // Lightweight DOM update during 20Hz simulation loop without destroying sliders/buttons!
    const liveEls = this.root.querySelectorAll<HTMLElement>('[data-live]');
    liveEls.forEach((el) => {
      const key = el.dataset.live;
      const st = this.plant.state;
      if (key === 'tank-fill') {
        el.style.height = `${st.levelPct.toFixed(1)}%`;
      } else if (key === 'tank-pct') {
        el.textContent = `${st.levelPct.toFixed(1)} % (${this.sim.aiRaw[1] ?? 200} ед. / ${(((this.sim.aiRaw[1] ?? 200) / 1000) * 20).toFixed(1)} мА)`;
      } else if (key === 'press-bar') {
        el.textContent = `${st.pressureBar.toFixed(2)} бар`;
      } else if (key === 'pump1-badge') {
        const on = Boolean(this.sim.doState[1]);
        el.className = `kip-unit-badge ${on ? (st.pump1Fault ? 'fault' : 'on') : 'off'}`;
        el.textContent = on ? (st.pump1Fault ? 'НАСОС №1: СРЫВ ПОДАЧИ!' : 'НАСОС №1 (Q1): В РАБОТЕ') : 'НАСОС №1 (Q1): СТОП';
      } else if (key === 'pump2-badge') {
        const on = Boolean(this.sim.doState[2]);
        el.className = `kip-unit-badge ${on ? 'on' : 'off'}`;
        el.textContent = on ? 'НАСОС №2 РЕЗЕРВ (Q2): В РАБОТЕ' : 'НАСОС №2 РЕЗЕРВ (Q2): ОЖИДАНИЕ';
      } else if (key === 'alm-badge') {
        const on = Boolean(this.sim.doState[3] || this.sim.doState[2] && st.sensorWireBreak);
        el.className = `kip-unit-badge ${this.sim.doState[3] ? 'fault' : 'off'}`;
        el.textContent = this.sim.doState[3] ? 'Q3 СИГНАЛ АВАРИИ: АКТИВЕН!' : 'Q3 АВАРИЯ: НЕТ';
      } else if (key === 'oven-temp') {
        el.textContent = `${st.ovenTempC.toFixed(1)} °C`;
      } else if (key === 'oven-glow') {
        const alpha = Math.min(0.85, Math.max(0.05, (st.ovenTempC - 20) / 160));
        el.style.background = `rgba(255, 82, 20, ${alpha.toFixed(2)})`;
      } else if (key === 'oven-power') {
        const pwr = this.sim.doState[1] ? 100 : Math.round(((this.sim.aoRaw[1] ?? 0) / 1000) * 100);
        el.textContent = `Мощность ТЭНов: ${pwr}% (AQ1=${this.sim.aoRaw[1] ?? 0}, Q1=${this.sim.doState[1] ? 'ON' : 'OFF'})`;
      } else if (key === 'ahu-status') {
        el.textContent = `Заслонка: ${st.damperPosPct.toFixed(0)}% (I3=${this.sim.diState[3] ? 1 : 0}) | Проток воздуха PDS I4=${
          this.sim.diState[4] ? 1 : 0
        } | Т ядра ТЭНа: ${st.heaterCoreTempC.toFixed(1)}°C | Канал: ${st.supplyAirTempC.toFixed(1)}°C`;
      } else if (key === 'conv-box') {
        el.style.left = `${Math.min(88, (st.beltPosMm / 1000) * 88).toFixed(1)}%`;
      } else if (key === 'conv-status') {
        el.textContent = `Позиция тары: ${st.beltPosMm.toFixed(0)} мм | Фотодатчик I3=${
          this.sim.diState[3] ? 'СРАБОТАЛ (1)' : '0'
        } | Вес налива AI1: ${st.boxFillGrams.toFixed(0)} г | Упаковано коробок: ${st.boxesPacked}`;
      }
    });

    // Refresh custom HMI widgets
    const widgetCards = this.root.querySelectorAll<HTMLElement>('[data-hmi-id]');
    widgetCards.forEach((card) => {
      const wid = card.dataset.hmiId!;
      const w = this.project.hmiWidgets.find((x) => x.id === wid);
      if (!w) return;
      const valEl = card.querySelector<HTMLElement>('.hmi-live-val');
      const m = w.binding.toUpperCase().match(/^([A-Z]+)(\d+)$/);
      if (!m) return;
      const [, p, nStr] = m;
      const idx = parseInt(nStr, 10);
      if (w.type === 'lamp' || w.type === 'pushbutton' || w.type === 'selector') {
        const bit = p === 'I' ? this.sim.diState[idx] : p === 'M' ? this.sim.mState[idx] : this.sim.doState[idx];
        card.classList.toggle('active', Boolean(bit));
        if (valEl) valEl.textContent = bit ? 'ВКЛ (1)' : 'ОТКЛ (0)';
      } else {
        const raw = p === 'AI' ? this.sim.aiRaw[idx] ?? 0 : p === 'AM' ? this.sim.amRaw[idx] ?? 0 : this.sim.aoRaw[idx] ?? 0;
        if (valEl) valEl.textContent = `${raw} ${w.unit || ''}`;
        const barFill = card.querySelector<HTMLElement>('.hmi-bar-fill');
        if (barFill) {
          const pct = Math.max(0, Math.min(100, (raw / (w.max || 1000)) * 100));
          barFill.style.width = `${pct}%`;
        }
      }
    });

    // Refresh DIN terminal LEDs
    for (let i = 1; i <= 12; i++) {
      const diLed = this.root.querySelector<HTMLElement>(`[data-din-di="${i}"]`);
      if (diLed) diLed.classList.toggle('lit', Boolean(this.sim.diState[i]));
    }
    for (let i = 1; i <= 6; i++) {
      const doLed = this.root.querySelector<HTMLElement>(`[data-din-do="${i}"]`);
      if (doLed) doLed.classList.toggle('lit', Boolean(this.sim.doState[i]));
    }
  }

  public render() {
    this.root.innerHTML = '';

    const nav = document.createElement('div');
    nav.className = 'oni-hmi-subnav';
    nav.innerHTML = `
      <button class="oni-subtab-btn ${this.subTab === 'plant' ? 'active' : ''}" data-sub="plant">🏭 Виртуальный объект КИПиА (Физика процесса)</button>
      <button class="oni-subtab-btn ${this.subTab === 'hmi_builder' ? 'active' : ''}" data-sub="hmi_builder">🖥 Панель оператора HMI (ONI Visual)</button>
      <button class="oni-subtab-btn ${this.subTab === 'din_wiring' ? 'active' : ''}" data-sub="din_wiring">🔌 Клеммник реле ONI PLR-S на DIN-рейке (Монтаж проводов)</button>
    `;
    this.root.appendChild(nav);
    nav.querySelectorAll<HTMLButtonElement>('[data-sub]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.subTab = btn.dataset.sub as typeof this.subTab;
        this.render();
      });
    });

    const body = document.createElement('div');
    body.className = 'oni-hmi-body';
    this.root.appendChild(body);

    if (this.subTab === 'plant') {
      this.renderPlantSimulator(body);
    } else if (this.subTab === 'hmi_builder') {
      this.renderHmiBuilder(body);
    } else {
      this.renderDinRailWiring(body);
    }
    this.refreshLiveValues();
  }

  private renderPlantSimulator(container: HTMLElement) {
    const active = this.project.activePlant === 'none' ? 'pump_station' : this.project.activePlant;

    const topCtrl = document.createElement('div');
    topCtrl.className = 'kip-plant-header';
    topCtrl.innerHTML = `
      <div class="kip-plant-select-group">
        <label><b>Технологический стенд:</b></label>
        <select id="plant-preset-sel">
          <option value="pump_station" ${active === 'pump_station' ? 'selected' : ''}>1. Насосная станция КНС/ВНС (2 насоса + бак 4–20 мА + PDS)</option>
          <option value="thermal_oven" ${active === 'thermal_oven' ? 'selected' : ''}>2. Термокамера / Печь отжига (Pt100 + ТРМ 4–20 мА + термостат)</option>
          <option value="hvac_ahu" ${active === 'hvac_ahu' ? 'selected' : ''}>3. Приточная вентсистема ПВУ (жалюзи, вентилятор, ТЭНы)</option>
          <option value="conveyor_line" ${active === 'conveyor_line' ? 'selected' : ''}>4. Конвейер фасовки и дозирования (фотодатчик + тензодатчик)</option>
        </select>
        <label class="kip-link-chk">
          <input type="checkbox" id="plant-link-chk" ${this.plant.linkedToPlc ? 'checked' : ''} />
          <span><b>Связать датчики объекта со входами реле (живая обратная связь при F3 Симуляторе!)</b></span>
        </label>
      </div>
      <button class="oni-win-btn" id="plant-reset-btn">Сброс физики объекта</button>
    `;
    container.appendChild(topCtrl);

    topCtrl.querySelector('#plant-preset-sel')?.addEventListener('change', (ev) => {
      this.project.activePlant = (ev.target as HTMLSelectElement).value as PlantPresetId;
      this.plant.linkedToPlc = true;
      this.cb.onMutate('Выбран технологический объект КИПиА');
      this.render();
    });

    topCtrl.querySelector('#plant-link-chk')?.addEventListener('change', (ev) => {
      this.plant.linkedToPlc = (ev.target as HTMLInputElement).checked;
      if (this.plant.linkedToPlc && this.project.activePlant === 'none') {
        this.project.activePlant = 'pump_station';
      }
    });

    topCtrl.querySelector('#plant-reset-btn')?.addEventListener('click', () => {
      this.plant.reset();
      this.refreshLiveValues();
    });

    const stage = document.createElement('div');
    stage.className = 'kip-plant-stage';
    container.appendChild(stage);

    if (active === 'pump_station') {
      stage.innerHTML = `
        <div class="kip-mnemonic-grid">
          <div class="kip-tank-card">
            <div class="kip-card-title">Накопительный резервуар (Датчик LT101 → AI1 4..20 мА)</div>
            <div class="kip-tank-visual-row">
              <div class="kip-tank-vessel">
                <div class="kip-tank-water" data-live="tank-fill" style="height:${this.plant.state.levelPct}%"></div>
                <div class="kip-tank-mark high">80% ВУ</div>
                <div class="kip-tank-mark low">25% НУ</div>
              </div>
              <div class="kip-tank-readouts">
                <div><b>Уровень LT101 (AI1):</b> <span data-live="tank-pct">--</span></div>
                <div><b>Давление коллектора PT102 (AI2):</b> <span data-live="press-bar">--</span></div>
                <div data-live="pump1-badge" class="kip-unit-badge off">НАСОС №1 (Q1)</div>
                <div data-live="pump2-badge" class="kip-unit-badge off">НАСОС №2 (Q2)</div>
                <div data-live="alm-badge" class="kip-unit-badge off">АВАРИЯ (Q3)</div>
              </div>
            </div>
          </div>
          <div class="kip-fault-card">
            <div class="kip-card-title">Пульт оператора и ввод неисправностей КИПиА</div>
            <div class="kip-quick-io-btns">
              <button class="oni-win-btn primary" id="p-toggle-i1">Переключить I1 (Пуск/Авто)</button>
              <button class="oni-win-btn" id="p-pulse-i3">Импульс I3 (Сброс аварии)</button>
            </div>
            <label class="oni-form-row" style="margin-top:10px">
              <span>Разбор воды цехом (% расхода):</span>
              <input type="range" min="0" max="100" value="${this.plant.state.outflowDemand}" id="p-outflow-rng" />
            </label>
            <label class="kip-fault-chk">
              <input type="checkbox" id="p-flt-pump1" ${this.plant.state.pump1Fault ? 'checked' : ''} />
              <span>⚠️ Имитировать заклинивание / обрыв вала Насоса №1 (пропадает проток PDS на I2 → проверка АВР!)</span>
            </label>
            <label class="kip-fault-chk">
              <input type="checkbox" id="p-flt-wire" ${this.plant.state.sensorWireBreak ? 'checked' : ''} />
              <span>✂️ Имитировать обрыв линии датчика уровня 4–20 мА (падение тока AI1 в 0,4 мА!)</span>
            </label>
            <div class="kip-io-legend">
              <b>Привязка каналов стенда:</b> <code>I1</code> Пуск/Авто, <code>I2</code> Реле протока PDS, <code>I3</code> Сброс, <code>I4</code> Сухой ход (1=вода есть), <code>AI1</code> Уровень 4..20мА, <code>AI2</code> Давление 4..20мА → <code>Q1</code> Насос 1, <code>Q2</code> Насос 2, <code>Q3</code> Лампа Авария.
            </div>
          </div>
        </div>
      `;
      stage.querySelector('#p-toggle-i1')?.addEventListener('click', () => {
        this.sim.diState[1] = !this.sim.diState[1];
        this.cb.onSimInputChanged();
      });
      stage.querySelector('#p-pulse-i3')?.addEventListener('click', () => {
        this.sim.diState[3] = true;
        this.cb.onSimInputChanged();
        setTimeout(() => {
          this.sim.diState[3] = false;
          this.cb.onSimInputChanged();
        }, 350);
      });
      stage.querySelector('#p-outflow-rng')?.addEventListener('input', (ev) => {
        this.plant.state.outflowDemand = Number((ev.target as HTMLInputElement).value);
      });
      stage.querySelector('#p-flt-pump1')?.addEventListener('change', (ev) => {
        this.plant.state.pump1Fault = (ev.target as HTMLInputElement).checked;
      });
      stage.querySelector('#p-flt-wire')?.addEventListener('change', (ev) => {
        this.plant.state.sensorWireBreak = (ev.target as HTMLInputElement).checked;
      });
    } else if (active === 'thermal_oven') {
      stage.innerHTML = `
        <div class="kip-mnemonic-grid">
          <div class="kip-tank-card">
            <div class="kip-card-title">Промышленная печь отжига (Датчик ТСП Pt100 → AI1 0..200°C)</div>
            <div class="kip-oven-chamber" data-live="oven-glow">
              <div class="kip-oven-temp-big" data-live="oven-temp">${this.plant.state.ovenTempC.toFixed(1)} °C</div>
              <div data-live="oven-power">Мощность ТЭНов: 0%</div>
            </div>
          </div>
          <div class="kip-fault-card">
            <div class="kip-card-title">Управление и проверка защит печи</div>
            <button class="oni-win-btn primary" id="ov-toggle-i1">Переключить I1 (Включить Автомат / Нагрев)</button>
            <label class="kip-fault-chk" style="margin-top:12px">
              <input type="checkbox" id="ov-flt-wire" ${this.plant.state.sensorWireBreak ? 'checked' : ''} />
              <span>✂️ Имитировать обрыв термометра сопротивления / токовой петли AI1</span>
            </label>
            <div class="kip-io-legend">
              <b>Привязка каналов печи:</b> <code>AI1</code> Температура 0..200°C (4..20 мА = 200..1000 ед., т.е. 100°C = код 600), <code>I3</code> НЗ термостат перегрева (&lt;165°C = 1), <code>Q1</code> Дискретный пускатель ТЭНов, <code>AQ1</code> Плавный тиристорный регулятор ТРМ (0..1000), <code>Q2</code> Вентилятор охлаждения.
            </div>
          </div>
        </div>
      `;
      stage.querySelector('#ov-toggle-i1')?.addEventListener('click', () => {
        this.sim.diState[1] = !this.sim.diState[1];
        this.cb.onSimInputChanged();
      });
      stage.querySelector('#ov-flt-wire')?.addEventListener('change', (ev) => {
        this.plant.state.sensorWireBreak = (ev.target as HTMLInputElement).checked;
      });
    } else if (active === 'hvac_ahu') {
      stage.innerHTML = `
        <div class="kip-tank-card">
          <div class="kip-card-title">Приточная вентсистема ПВУ с электрокалорифером</div>
          <div class="kip-ahu-duct" data-live="ahu-status">Заслонка: 0% | Вентилятор: СТОП</div>
          <div class="kip-io-legend" style="margin-top:10px">
            <b>Алгоритм КИПиА ПВУ:</b> <code>Q1</code> Открыть воздушную заслонку → дождаться концевика <code>I3=1</code> → включить вентилятор <code>Q2</code> → дождаться реле перепада давления <code>I4=1</code> → разрешить нагрев ТЭНов <code>Q3</code> / <code>AQ1</code>! При останове сначала снять нагрев, продуть ТЭНы вентилятором 4–10 с, иначе сработает термостат перегрева <code>I5 (НЗ)</code>!
          </div>
        </div>
      `;
    } else {
      stage.innerHTML = `
        <div class="kip-tank-card">
          <div class="kip-card-title">Конвейерная линия фасовки и счёта продукции</div>
          <div class="kip-conveyor-track">
            <div class="kip-conveyor-sensor">Фотодатчик I3</div>
            <div class="kip-conveyor-box" data-live="conv-box">📦</div>
          </div>
          <div style="margin-top:10px;font-weight:bold" data-live="conv-status"></div>
          <div class="kip-io-legend" style="margin-top:8px">
            <b>Привязка каналов конвейера:</b> <code>Q1</code> Движение ленты конвейера, <code>Q2</code> Клапан налива дозы, <code>I3</code> Оптический датчик прохода тары (формирует импульсы счёта!), <code>AI1</code> Вес дозы на тензодатчике (0..1000 г).
          </div>
        </div>
      `;
    }
  }

  private renderHmiBuilder(container: HTMLElement) {
    const toolbar = document.createElement('div');
    toolbar.className = 'kip-plant-header';
    toolbar.innerHTML = `
      <div><b>Панель оператора ONI Visual (мнемосхема щита):</b> добавляйте кнопки, тумблеры, сигнальные лампы и индикаторы регистров</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="oni-win-btn" data-add-hmi="pushbutton">+ Кнопка</button>
        <button class="oni-win-btn" data-add-hmi="selector">+ Тумблер</button>
        <button class="oni-win-btn" data-add-hmi="lamp">+ Сигнальная лампа</button>
        <button class="oni-win-btn" data-add-hmi="numeric_display">+ Цифровой индикатор AI/AQ</button>
      </div>
    `;
    container.appendChild(toolbar);

    toolbar.querySelectorAll<HTMLButtonElement>('[data-add-hmi]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.addHmi as HmiWidget['type'];
        const idx = this.project.hmiWidgets.length + 1;
        this.project.hmiWidgets.push({
          id: `hmi_${Date.now()}`,
          type,
          label:
            type === 'lamp'
              ? `Лампа Q${Math.min(idx, 6)}`
              : type === 'numeric_display'
              ? 'Показание AI1'
              : `Кнопка I${Math.min(idx, 8)}`,
          binding: type === 'lamp' ? 'Q1' : type === 'numeric_display' ? 'AI1' : 'I1',
          x: 20,
          y: 20,
          width: 155,
          height: 64,
          color: type === 'lamp' ? 'green' : 'blue',
          momentary: type === 'pushbutton',
          max: 1000,
        });
        this.cb.onMutate('Добавлен элемент панели HMI');
        this.render();
      });
    });

    const grid = document.createElement('div');
    grid.className = 'oni-hmi-widgets-grid';
    container.appendChild(grid);

    if (this.project.hmiWidgets.length === 0) {
      grid.innerHTML = `<div class="oni-ld-empty">Нажмите кнопки выше, чтобы собрать свой пульт оператора HMI (привязка к I1..I16, M1..M16, Q1..Q12, AI1..AI8, AQ1..AQ4).</div>`;
      return;
    }

    this.project.hmiWidgets.forEach((w, wIdx) => {
      const card = document.createElement('div');
      card.className = `oni-hmi-widget-card type-${w.type} color-${w.color || 'green'}`;
      card.dataset.hmiId = w.id;
      card.innerHTML = `
        <div class="hmi-card-top">
          <span class="hmi-tag">[${w.binding}]</span>
          <button class="hmi-cfg-btn" title="Настроить привязку">⚙</button>
          <button class="hmi-del-btn" title="Удалить">✕</button>
        </div>
        <div class="hmi-label">${w.label}</div>
        <div class="hmi-live-val">--</div>
        ${w.type === 'numeric_display' ? `<div class="hmi-bar-bg"><div class="hmi-bar-fill"></div></div>` : ''}
      `;

      const m = w.binding.toUpperCase().match(/^([A-Z]+)(\d+)$/);
      if (w.type === 'pushbutton' && m) {
        const [, p, nStr] = m;
        const ch = parseInt(nStr, 10);
        const setVal = (v: boolean) => {
          if (p === 'I') this.sim.diState[ch] = v;
          else if (p === 'M') this.sim.mState[ch] = v;
          this.cb.onSimInputChanged();
          this.refreshLiveValues();
        };
        card.addEventListener('pointerdown', (e) => {
          if ((e.target as HTMLElement).tagName === 'BUTTON') return;
          setVal(true);
        });
        card.addEventListener('pointerup', () => setVal(false));
        card.addEventListener('pointerleave', () => {
          if (w.momentary) setVal(false);
        });
      } else if (w.type === 'selector' && m) {
        const [, p, nStr] = m;
        const ch = parseInt(nStr, 10);
        card.addEventListener('click', (e) => {
          if ((e.target as HTMLElement).tagName === 'BUTTON') return;
          if (p === 'I') this.sim.diState[ch] = !this.sim.diState[ch];
          else if (p === 'M') this.sim.mState[ch] = !this.sim.mState[ch];
          this.cb.onSimInputChanged();
          this.refreshLiveValues();
        });
      }

      card.querySelector('.hmi-del-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.project.hmiWidgets.splice(wIdx, 1);
        this.cb.onMutate('Удалён элемент HMI');
        this.render();
      });

      card.querySelector('.hmi-cfg-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        const newLabel = prompt('Подпись элемента на панели HMI:', w.label);
        if (newLabel === null) return;
        const newBind = prompt('Канал привязки (например I1, I2, M1, Q1, Q2, AI1, AQ1):', w.binding);
        if (newBind === null) return;
        w.label = newLabel.trim() || w.label;
        w.binding = newBind.trim().toUpperCase() || w.binding;
        this.cb.onMutate('Настроен элемент HMI');
        this.render();
      });

      grid.appendChild(card);
    });
  }

  private renderDinRailWiring(container: HTMLElement) {
    container.innerHTML = `
      <div class="din-rail-wrapper">
        <div class="din-plc-housing">
          <div class="din-terminals-row top">
            <div class="din-term pwr" title="Питание +24В DC">+24V</div>
            <div class="din-term gnd" title="Общий минус БП 0V">0V(M)</div>
            ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
              .map(
                (i) => `
              <div class="din-term di" data-click-di="${i}" title="Щёлкните для подачи +24В на клемму I${i}">
                <span class="din-screw">⊖</span>
                <span class="din-name">I${i}</span>
                <span class="din-led" data-din-di="${i}"></span>
              </div>
            `
              )
              .join('')}
          </div>

          <div class="din-plc-body-mid">
            <div class="din-brand-col">
              <div class="din-brand-logo">ONI®</div>
              <div class="din-model-name">${this.project.controllerId}</div>
              <div class="din-pwr-led">RUN / 24VDC</div>
              <div class="din-rs485-port">RS-485 (A / B) Modbus RTU</div>
            </div>
            <div class="din-lcd-bezel">
              <div class="din-lcd-lines">
                <div>${this.sim.lcdState.lines[0]}</div>
                <div>${this.sim.lcdState.lines[1]}</div>
                <div>${this.sim.lcdState.lines[2]}</div>
                <div>${this.sim.lcdState.lines[3]}</div>
              </div>
            </div>
            <div class="din-keypad">
              <span class="din-key">ESC</span>
              <span class="din-key">▲</span>
              <span class="din-key">OK</span>
              <span class="din-key">◀</span>
              <span class="din-key">▼</span>
              <span class="din-key">▶</span>
            </div>
          </div>

          <div class="din-terminals-row bottom">
            ${[1, 2, 3, 4, 5, 6]
              .map(
                (q) => `
              <div class="din-relay-pair">
                <div class="din-led out" data-din-do="${q}"></div>
                <div class="din-pair-label">Реле Q${q} (10A)</div>
                <div class="din-pair-screws"><span>1(L) ⊖</span> <span>⊖ 2(КМ${q})</span></div>
              </div>
            `
              )
              .join('')}
          </div>
        </div>

        <div class="din-wiring-notes">
          <h4>Памятка электромонтажа КИПовца (клик по винтовой клемме I1..I12 подаёт +24В!):</h4>
          <ul>
            <li><b>Верхний ряд (Входы 24В DC):</b> кнопка ПУСК (НО), кнопка СТОП (НЗ!), контакты тепловых реле и PNP-датчики подключаются между шиной <code>+24V</code> и входом <code>I1..I12</code>.</li>
            <li><b>Универсальные входы <code>I1..I6</code>:</b> могут измерять аналоговое напряжение <code>0..10 В</code> относительно клеммы <code>0V(M)</code>. Для датчиков давления/температуры <code>4..20 мА</code> справа на DIN-рейку защёлкивается модуль расширения <code>PLR-S-EMA-0400 (4AI)</code> (или шунт 500 Ом 0,1% на вход 0..10 В!).</li>
            <li><b>Нижний ряд (Выходы <code>Q1..Q6</code>):</b> изолированные «сухие» нормально разомкнутые контакты реле до 10А ~230В AC / =24В DC — разрывают фазу <code>L</code> или <code>+24V</code> на катушку пускателя <code>КМ1 (А1–А2)</code>, соленоидный клапан <code>YV</code> или сигнальную лампу <code>HL</code>.</li>
          </ul>
        </div>
      </div>
    `;

    container.querySelectorAll<HTMLElement>('[data-click-di]').forEach((el) => {
      el.addEventListener('click', () => {
        const ch = Number(el.dataset.clickDi);
        this.sim.diState[ch] = !this.sim.diState[ch];
        this.cb.onSimInputChanged();
        this.refreshLiveValues();
      });
    });
  }
}
