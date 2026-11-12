import { getEffectiveIoLimits } from '../catalog/controllers';
import { adcToEng, buildModbusTable, checkProjectErc, engToAdc, OniPlcSimulator } from '../engine/simulator';
import { OniProject } from '../types';

export type BottomTabId = 'digital_io' | 'analog_io' | 'lcd_screen' | 'oscilloscope' | 'erc_modbus';

export interface BottomDockCallbacks {
  onSimInputChanged: () => void;
  onToggleSimulator: () => void;
  onStepSingleScan: () => void;
  onOpenAnalogSetup: () => void;
}

export class BottomSimulatorDock {
  private root: HTMLElement;
  private project: OniProject;
  private sim: OniPlcSimulator;
  private cb: BottomDockCallbacks;

  public activeTab: BottomTabId = 'digital_io';
  public collapsed = false;
  private oscCanvas: HTMLCanvasElement | null = null;

  constructor(container: HTMLElement, project: OniProject, sim: OniPlcSimulator, cb: BottomDockCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'oni-bottom-dock';
    container.appendChild(this.root);
    this.project = project;
    this.sim = sim;
    this.cb = cb;
    this.render();
  }

  public setProject(project: OniProject) {
    this.project = project;
    this.render();
  }

  public render() {
    this.root.innerHTML = '';
    this.root.classList.toggle('collapsed', this.collapsed);

    const tabBar = document.createElement('div');
    tabBar.className = 'oni-bottom-tabbar';
    tabBar.innerHTML = `
      <div class="oni-bottom-tabs-left">
        <button class="oni-btab ${this.activeTab === 'digital_io' ? 'active' : ''}" data-tab="digital_io">Цифровые I/O</button>
        <button class="oni-btab ${this.activeTab === 'analog_io' ? 'active' : ''}" data-tab="analog_io">Аналоговые 4–20 мА / Pt100</button>
        <button class="oni-btab ${this.activeTab === 'lcd_screen' ? 'active' : ''}" data-tab="lcd_screen">Экран реле PLR-S</button>
        <button class="oni-btab ${this.activeTab === 'oscilloscope' ? 'active' : ''}" data-tab="oscilloscope">Осциллограф КИПиА</button>
        <button class="oni-btab ${this.activeTab === 'erc_modbus' ? 'active' : ''}" data-tab="erc_modbus">Проверка / Modbus</button>
      </div>
      <div class="oni-bottom-sim-controls">
        <span class="oni-sim-status-pill ${this.sim.running ? 'run' : 'stop'}" id="dock-sim-pill">
          ${this.sim.running ? (this.sim.paused ? '⏸ ПАУЗА' : '● СИМУЛЯТОР (RUN)') : '■ РЕДАКТОР'}
        </span>
        <button class="oni-win-btn-sm ${this.sim.running ? 'danger' : 'sim-go'}" id="dock-sim-toggle">
          ${this.sim.running ? 'Стоп (F3)' : '▶ Симулятор (F3)'}
        </button>
        <button class="oni-win-btn-sm" id="dock-sim-step" title="Одиночный скан ПЛК (+0.1 с)">Шаг +0.1с</button>
        <button class="oni-win-btn-sm" id="dock-collapse-btn" title="Свернуть/развернуть нижнюю панель">${this.collapsed ? '▲ Развернуть' : '▼ Свернуть'}</button>
      </div>
    `;
    this.root.appendChild(tabBar);

    tabBar.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset.tab as BottomTabId;
        this.collapsed = false;
        this.render();
      });
    });
    tabBar.querySelector('#dock-sim-toggle')?.addEventListener('click', () => this.cb.onToggleSimulator());
    tabBar.querySelector('#dock-sim-step')?.addEventListener('click', () => this.cb.onStepSingleScan());
    tabBar.querySelector('#dock-collapse-btn')?.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.render();
      window.dispatchEvent(new Event('resize'));
    });

    if (this.collapsed) return;

    const content = document.createElement('div');
    content.className = 'oni-bottom-content';
    this.root.appendChild(content);

    this.oscCanvas = null;
    if (this.activeTab === 'digital_io') {
      this.buildDigitalIoTab(content);
    } else if (this.activeTab === 'analog_io') {
      this.buildAnalogIoTab(content);
    } else if (this.activeTab === 'lcd_screen') {
      this.buildLcdScreenTab(content);
    } else if (this.activeTab === 'oscilloscope') {
      this.buildOscilloscopeTab(content);
    } else {
      this.buildErcModbusTab(content);
    }

    this.refreshLive();
  }

  private buildDigitalIoTab(container: HTMLElement) {
    const limits = getEffectiveIoLimits(this.project.controllerId, this.project.expansionIds);
    const diCount = Math.min(limits.maxDi, 14);
    const doCount = Math.min(limits.maxDo, 10);

    const wrap = document.createElement('div');
    wrap.className = 'oni-dio-grid';

    // Inputs row
    const diRow = document.createElement('div');
    diRow.className = 'oni-dio-section';
    diRow.innerHTML = `<div class="oni-dio-sec-title">Входы DI (I1..I${diCount}):</div>`;
    const diStrip = document.createElement('div');
    diStrip.className = 'oni-dio-strip';

    for (let ch = 1; ch <= diCount; ch++) {
      const blk = this.project.blocks.find((b) => b.type === 'DI' && b.channelIndex === ch);
      const mode = (blk?.params.simSwitchMode as string) || 'toggle';
      const cell = document.createElement('div');
      cell.className = 'oni-dio-cell';
      cell.innerHTML = `
        <button class="oni-io-btn di" data-di-btn="${ch}" title="${blk?.customName || `Вход I${ch}`}">
          <span class="io-led" data-di-led="${ch}"></span>
          <span class="io-name">I${ch}</span>
        </button>
        <span class="io-sub" title="${blk?.customName || ''}">${(blk?.customName || (mode === 'momentary_nc' ? 'НЗ' : mode === 'momentary_no' ? 'Кн.НО' : 'Фикс')).slice(0, 8)}</span>
      `;
      const btn = cell.querySelector<HTMLButtonElement>(`[data-di-btn="${ch}"]`)!;
      if (mode === 'momentary_no') {
        btn.addEventListener('pointerdown', () => {
          this.sim.diState[ch] = true;
          this.cb.onSimInputChanged();
          this.refreshLive();
        });
        const release = () => {
          if (this.sim.diState[ch]) {
            this.sim.diState[ch] = false;
            this.cb.onSimInputChanged();
            this.refreshLive();
          }
        };
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointerleave', release);
      } else if (mode === 'momentary_nc') {
        btn.addEventListener('pointerdown', () => {
          this.sim.diState[ch] = false;
          this.cb.onSimInputChanged();
          this.refreshLive();
        });
        const releaseNc = () => {
          if (!this.sim.diState[ch]) {
            this.sim.diState[ch] = true;
            this.cb.onSimInputChanged();
            this.refreshLive();
          }
        };
        btn.addEventListener('pointerup', releaseNc);
        btn.addEventListener('pointerleave', releaseNc);
      } else {
        btn.addEventListener('click', () => {
          this.sim.diState[ch] = !this.sim.diState[ch];
          this.cb.onSimInputChanged();
          this.refreshLive();
        });
      }
      diStrip.appendChild(cell);
    }
    diRow.appendChild(diStrip);
    wrap.appendChild(diRow);

    // Outputs row
    const doRow = document.createElement('div');
    doRow.className = 'oni-dio-section';
    doRow.innerHTML = `<div class="oni-dio-sec-title">Выходы DO (Q1..Q${doCount}):</div>`;
    const doStrip = document.createElement('div');
    doStrip.className = 'oni-dio-strip';
    for (let ch = 1; ch <= doCount; ch++) {
      const blk = this.project.blocks.find((b) => b.type === 'DO' && b.channelIndex === ch);
      const cell = document.createElement('div');
      cell.className = 'oni-dio-cell';
      cell.innerHTML = `
        <div class="oni-io-lamp" data-do-lamp="${ch}" title="${blk?.customName || `Выход Q${ch}`}">
          <span class="io-bulb"></span>
          <span class="io-name">Q${ch}</span>
        </div>
        <span class="io-sub">${(blk?.customName || 'Реле').slice(0, 8)}</span>
      `;
      doStrip.appendChild(cell);
    }
    doRow.appendChild(doStrip);
    wrap.appendChild(doRow);

    container.appendChild(wrap);
  }

  private buildAnalogIoTab(container: HTMLElement) {
    const wrap = document.createElement('div');
    wrap.className = 'oni-aio-wrap';

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;';
    topRow.innerHTML = `
      <span style="font-size:11px;color:#222"><b>Каналы датчиков КИПиА (AI1..AI4) и ЦАП (AQ1..AQ2):</b> двигайте ползунки тока/физической величины или имитируйте обрыв линии</span>
      <button class="oni-win-btn-sm" id="btn-cfg-ai">⚙ Настроить шкалы датчиков (°C, бар, 4–20 мА)</button>
    `;
    topRow.querySelector('#btn-cfg-ai')?.addEventListener('click', () => this.cb.onOpenAnalogSetup());
    wrap.appendChild(topRow);

    const grid = document.createElement('div');
    grid.className = 'oni-aio-channels';

    for (let ch = 1; ch <= 4; ch++) {
      const cfg = this.project.analogConfigs.find((c) => c.channel === ch) || {
        channel: ch,
        tag: `AI${ch}`,
        standard: '4-20mA' as const,
        minEng: 0,
        maxEng: 100,
        unit: '%',
      };
      const card = document.createElement('div');
      card.className = 'oni-aio-card';
      card.innerHTML = `
        <div class="aio-hdr">
          <b>AI${ch}</b> <span>${cfg.tag.slice(0, 22)} (${cfg.standard})</span>
        </div>
        <div class="aio-slider-row">
          <input type="range" min="0" max="1050" step="5" value="${this.sim.aiRaw[ch] ?? 200}" data-ai-slider="${ch}" />
          <button class="oni-win-btn-sm" data-ai-break="${ch}" title="Уронить сигнал в 0 мА (проверка защиты от обрыва)">Обрыв</button>
          <button class="oni-win-btn-sm" data-ai-norm="${ch}" title="Вернуть 50% шкалы (12 мА)">50%</button>
        </div>
        <div class="aio-readout" data-ai-readout="${ch}">--</div>
      `;

      const slider = card.querySelector<HTMLInputElement>(`[data-ai-slider="${ch}"]`)!;
      slider.addEventListener('input', () => {
        this.sim.aiRaw[ch] = Number(slider.value);
        this.cb.onSimInputChanged();
        this.refreshLive();
      });
      card.querySelector(`[data-ai-break="${ch}"]`)?.addEventListener('click', () => {
        this.sim.aiRaw[ch] = 15; // ~0.3 mA wire break!
        slider.value = '15';
        this.cb.onSimInputChanged();
        this.refreshLive();
      });
      card.querySelector(`[data-ai-norm="${ch}"]`)?.addEventListener('click', () => {
        const mid = engToAdc((cfg.minEng + cfg.maxEng) / 2, cfg);
        this.sim.aiRaw[ch] = mid;
        slider.value = String(mid);
        this.cb.onSimInputChanged();
        this.refreshLive();
      });
      grid.appendChild(card);
    }

    // Analog outputs AQ1, AQ2
    const aoCard = document.createElement('div');
    aoCard.className = 'oni-aio-card ao-card';
    aoCard.innerHTML = `
      <div class="aio-hdr"><b>Выходы ЦАП (AQ1 / AQ2)</b></div>
      <div class="ao-meter-row" data-ao-readout="1">AQ1: 0 (4.00 мА / 0%)</div>
      <div class="ao-bar"><div class="ao-bar-fill" data-ao-bar="1"></div></div>
      <div class="ao-meter-row" data-ao-readout="2" style="margin-top:4px">AQ2: 0 (4.00 мА / 0%)</div>
      <div class="ao-bar"><div class="ao-bar-fill" data-ao-bar="2"></div></div>
    `;
    grid.appendChild(aoCard);

    wrap.appendChild(grid);
    container.appendChild(wrap);
  }

  private buildLcdScreenTab(container: HTMLElement) {
    const wrap = document.createElement('div');
    wrap.className = 'oni-lcd-dock-wrap';
    wrap.innerHTML = `
      <div class="oni-lcd-module">
        <div class="oni-lcd-glass backlight-green" id="dock-lcd-glass">
          <div class="lcd-line" data-lcd-line="0"></div>
          <div class="lcd-line" data-lcd-line="1"></div>
          <div class="lcd-line" data-lcd-line="2"></div>
          <div class="lcd-line" data-lcd-line="3"></div>
        </div>
        <div class="oni-lcd-buttons">
          ${[
            { ch: 1, lbl: 'C1 ▲' },
            { ch: 2, lbl: 'C2 ▼' },
            { ch: 3, lbl: 'C3 ◀' },
            { ch: 4, lbl: 'C4 ▶' },
            { ch: 5, lbl: 'C5 OK' },
            { ch: 6, lbl: 'C6 ESC' },
          ]
            .map((k) => `<button class="oni-panel-key" data-ckey="${k.ch}">${k.lbl}</button>`)
            .join('')}
        </div>
      </div>
      <div class="oni-lcd-help">
        <div><b>Источник на экране:</b> <span id="dock-lcd-src">Штатный экран</span></div>
        <p style="margin:4px 0 0;font-size:11px;color:#333">
          Чтобы выводить свои аварийные сообщения, температуру и давление на дисплей реле ONI PLR-S, добавьте на схему блок <b>TXT (Текстовое сообщение)</b> из раздела «Экран реле» и используйте метки <code>{AI1}</code>, <code>{Q1}</code>, <code>{B1}</code>. Кнопки справа управляют блоками клавиш <code>C1..C6</code>!
        </p>
      </div>
    `;
    wrap.querySelectorAll<HTMLButtonElement>('[data-ckey]').forEach((btn) => {
      const ch = Number(btn.dataset.ckey);
      btn.addEventListener('pointerdown', () => {
        this.sim.cKeyState[ch] = true;
        this.cb.onSimInputChanged();
      });
      const up = () => {
        this.sim.cKeyState[ch] = false;
        this.cb.onSimInputChanged();
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointerleave', up);
    });
    container.appendChild(wrap);
  }

  private buildOscilloscopeTab(container: HTMLElement) {
    const wrap = document.createElement('div');
    wrap.className = 'oni-osc-wrap';
    wrap.innerHTML = `
      <div class="oni-osc-legend">
        <span style="color:#ff4444">■ Q1 (Выход 1)</span>
        <span style="color:#44bbff">■ I1 (Вход 1)</span>
        <span style="color:#00e676">■ AI1 (Датчик 0..1000)</span>
        <span style="color:#ffca28">■ AQ1 (ЦАП ПИД 0..1000)</span>
        <span id="osc-time-lbl" style="margin-left:auto;color:#ccc">t = 0.0 с</span>
      </div>
    `;
    const canvas = document.createElement('canvas');
    canvas.width = 860;
    canvas.height = 105;
    canvas.className = 'oni-osc-canvas';
    wrap.appendChild(canvas);
    this.oscCanvas = canvas;
    container.appendChild(wrap);
  }

  private buildErcModbusTab(container: HTMLElement) {
    const erc = checkProjectErc(this.project);
    const modbus = buildModbusTable(this.project, this.sim);

    const wrap = document.createElement('div');
    wrap.className = 'oni-erc-modbus-split';
    wrap.innerHTML = `
      <div class="oni-erc-pane">
        <div class="pane-hdr">Контроль ошибок схемы (ERC):</div>
        ${erc
          .map(
            (m) =>
              `<div class="erc-row sev-${m.severity}">${
                m.severity === 'error' ? '⛔' : m.severity === 'warning' ? '⚠️' : '✔'
              } ${m.text}</div>`
          )
          .join('')}
      </div>
      <div class="oni-modbus-pane">
        <div class="pane-hdr">Карта регистров Modbus RTU (RS-485 Slave):</div>
        <table class="oni-modbus-tbl">
          <thead><tr><th>Адрес</th><th>Тип</th><th>Блок</th><th>Значение</th></tr></thead>
          <tbody>
            ${modbus
              .map(
                (r) =>
                  `<tr><td><code>${r.address}</code></td><td>${r.regType}</td><td><b>${r.tag}</b> (${r.description})</td><td>${r.valueText}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
    container.appendChild(wrap);
  }

  public refreshLive() {
    const pill = this.root.querySelector<HTMLElement>('#dock-sim-pill');
    if (pill) {
      pill.className = `oni-sim-status-pill ${this.sim.running ? 'run' : 'stop'}`;
      pill.textContent = this.sim.running
        ? `● СИМУЛЯТОР (${this.sim.simTimeSec.toFixed(1)}с | скан #${this.sim.scanCount})`
        : '■ РЕДАКТОР';
    }
    const simBtn = this.root.querySelector<HTMLButtonElement>('#dock-sim-toggle');
    if (simBtn) {
      simBtn.textContent = this.sim.running ? '■ Стоп (F3)' : '▶ Симулятор (F3)';
      simBtn.className = `oni-win-btn-sm ${this.sim.running ? 'danger' : 'sim-go'}`;
    }

    if (this.collapsed) return;

    if (this.activeTab === 'digital_io') {
      this.root.querySelectorAll<HTMLElement>('[data-di-btn]').forEach((btn) => {
        const ch = Number(btn.dataset.diBtn);
        const on = Boolean(this.sim.diState[ch]);
        btn.classList.toggle('active', on);
      });
      this.root.querySelectorAll<HTMLElement>('[data-do-lamp]').forEach((lamp) => {
        const ch = Number(lamp.dataset.doLamp);
        const on = Boolean(this.sim.doState[ch]);
        lamp.classList.toggle('lit', on);
      });
    } else if (this.activeTab === 'analog_io') {
      for (let ch = 1; ch <= 4; ch++) {
        const rd = this.root.querySelector<HTMLElement>(`[data-ai-readout="${ch}"]`);
        const sl = this.root.querySelector<HTMLInputElement>(`[data-ai-slider="${ch}"]`);
        const raw = this.sim.aiRaw[ch] ?? 0;
        if (sl && document.activeElement !== sl) sl.value = String(raw);
        if (rd) {
          const cfg = this.project.analogConfigs.find((c) => c.channel === ch) || {
            channel: ch,
            tag: `AI${ch}`,
            standard: '4-20mA' as const,
            minEng: 0,
            maxEng: 100,
            unit: '%',
          };
          const conv = adcToEng(raw, cfg);
          rd.innerHTML = conv.fault
            ? `<span style="color:#c92a2a;font-weight:bold">⚠ ${conv.fault} (Код=${raw})</span>`
            : `Код: <b>${raw}</b> | Сигнал: <b>${conv.elecText}</b> | Физ: <b>${conv.eng} ${cfg.unit}</b>`;
        }
      }
      for (let ch = 1; ch <= 2; ch++) {
        const raw = this.sim.aoRaw[ch] ?? 0;
        const ma = 4 + (raw / 1000) * 16;
        const pct = Math.round((raw / 1000) * 100);
        const aoRd = this.root.querySelector<HTMLElement>(`[data-ao-readout="${ch}"]`);
        const aoBar = this.root.querySelector<HTMLElement>(`[data-ao-bar="${ch}"]`);
        if (aoRd) aoRd.textContent = `AQ${ch}: ${raw} (${ma.toFixed(2)} мА / ${pct}%)`;
        if (aoBar) aoBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
      }
    } else if (this.activeTab === 'lcd_screen') {
      const glass = this.root.querySelector<HTMLElement>('#dock-lcd-glass');
      if (glass) {
        glass.className = `oni-lcd-glass backlight-${this.sim.lcdState.backlight}`;
      }
      this.sim.lcdState.lines.forEach((txt, i) => {
        const l = this.root.querySelector<HTMLElement>(`[data-lcd-line="${i}"]`);
        if (l) l.textContent = txt.padEnd(16, ' ');
      });
      const src = this.root.querySelector<HTMLElement>('#dock-lcd-src');
      if (src) src.textContent = this.sim.lcdState.sourceBlockLabel;
    } else if (this.activeTab === 'oscilloscope' && this.oscCanvas) {
      this.drawOscilloscope(this.oscCanvas);
    }
  }

  private drawOscilloscope(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#101820';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#243442';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 25) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const hist = this.sim.traceHistory;
    const tLbl = this.root.querySelector<HTMLElement>('#osc-time-lbl');
    if (tLbl) tLbl.textContent = `t = ${this.sim.simTimeSec.toFixed(1)} с (${hist.length} отсчётов)`;
    if (hist.length < 2) return;

    const plotSeries = (extract: (pt: (typeof hist)[number]) => number, color: string, lineW = 1.6) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineW;
      ctx.beginPath();
      hist.forEach((pt, idx) => {
        const x = (idx / 199) * w;
        const norm = Math.max(0, Math.min(1, extract(pt)));
        const y = h - 8 - norm * (h - 16);
        if (idx === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    };

    plotSeries((p) => p.ai1 / 1000, '#00e676', 1.8);
    plotSeries((p) => p.aq1 / 1000, '#ffca28', 1.8);
    plotSeries((p) => (p.i1 ? 0.88 : 0.65), '#44bbff', 1.5);
    plotSeries((p) => (p.q1 ? 0.35 : 0.08), '#ff4444', 2.0);
  }
}
