import { OniPlcSimulator } from '../engine/simulator';
import { LdContactOrBox, LdElementType, LdRung, OniProject } from '../types';

export interface LdEditorCallbacks {
  onMutate: (reason: string) => void;
  onSimToggleInput: (ch: number) => void;
}

const CONTACT_LABELS: Record<LdElementType, string> = {
  NO: '─┤ ├─ НО контакт',
  NC: '─┤/├─ НЗ контакт',
  P_EDGE: '─┤P├─ Фронт ↑',
  CMP_GE: '[AI ≥ K] Сравн. ≥',
  CMP_LE: '[AI ≤ K] Сравн. ≤',
  COIL: '─( )─ Катушка',
  SET: '─(S)─ Установка S',
  RESET: '─(R)─ Сброс R',
  TON_LD: '[TON] Задержка вкл.',
  TOF_LD: '[TOF] Задержка выкл.',
  CTU_LD: '[CTU] Счётчик имп.',
};

export class LadderDiagramView {
  private root: HTMLElement;
  private project: OniProject;
  private sim: OniPlcSimulator;
  private cb: LdEditorCallbacks;

  constructor(container: HTMLElement, project: OniProject, sim: OniPlcSimulator, cb: LdEditorCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'oni-ld-container';
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

  private evalOperandEnergized(el: LdContactOrBox): boolean {
    if (!this.sim.running) return false;
    const m = el.operand.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!m) return false;
    const [, p, nStr] = m;
    const idx = parseInt(nStr, 10);
    let bit = false;
    if (p === 'I') bit = Boolean(this.sim.diState[idx]);
    else if (p === 'Q') bit = Boolean(this.sim.doState[idx]);
    else if (p === 'M') bit = Boolean(this.sim.mState[idx]);
    else if (p === 'T' || p === 'C') bit = Boolean(this.sim.ldStates[el.operand.toUpperCase()]?.q);

    if (el.kind === 'NO' || el.kind === 'COIL' || el.kind === 'SET') return bit;
    if (el.kind === 'NC') return !bit;
    if (el.kind === 'CMP_GE') return (this.sim.aiRaw[idx] ?? 0) >= (el.preset ?? 500);
    if (el.kind === 'CMP_LE') return (this.sim.aiRaw[idx] ?? 0) <= (el.preset ?? 500);
    if (el.kind === 'TON_LD' || el.kind === 'TOF_LD' || el.kind === 'CTU_LD') {
      return Boolean(this.sim.ldStates[el.operand.toUpperCase()]?.q);
    }
    return bit;
  }

  public render() {
    const isLdActive = this.project.activeLanguage === 'LD';
    this.root.innerHTML = '';

    const bar = document.createElement('div');
    bar.className = 'oni-ld-toolbar';
    bar.innerHTML = `
      <div class="oni-ld-toolbar-left">
        <span class="oni-badge-title">Редактор РКС / LD (МЭК 61131-3 — ONI CICON / Builder)</span>
        <label class="oni-ld-mode-switch">
          <input type="checkbox" id="ld-exec-toggle" ${isLdActive ? 'checked' : ''} />
          <span>Исполнять в симуляторе именно LD-схему (вместо FBD)</span>
        </label>
      </div>
      <div class="oni-ld-toolbar-actions">
        <button class="oni-win-btn" id="ld-add-rung-btn">+ Добавить цепь (Rung)</button>
        <button class="oni-win-btn" id="ld-preset-seal-btn">+ Шаблон «Пуск-Стоп с шунтом»</button>
        <button class="oni-win-btn" id="ld-sync-from-fbd-btn" title="Построить учебные цепи LD по входам/выходам проекта">Автопостроение из FBD</button>
      </div>
    `;
    this.root.appendChild(bar);

    bar.querySelector('#ld-exec-toggle')?.addEventListener('change', (ev) => {
      const checked = (ev.target as HTMLInputElement).checked;
      this.project.activeLanguage = checked ? 'LD' : 'FBD';
      this.cb.onMutate('Переключение языка исполнения ПЛК');
      this.render();
    });

    bar.querySelector('#ld-add-rung-btn')?.addEventListener('click', () => {
      if (this.sim.running) return;
      const n = this.project.ldRungs.length + 1;
      this.project.ldRungs.push({
        id: `rung_${Date.now()}`,
        title: `Цепь ${n}: Новая ступень логики`,
        mainSeries: [{ id: `c_${Date.now()}`, kind: 'NO', operand: 'I1', comment: 'Вход' }],
        outputElement: { id: `o_${Date.now()}`, kind: 'COIL', operand: `Q${Math.min(n, 6)}`, comment: 'Выход' },
      });
      this.cb.onMutate('Добавлена ступень LD');
      this.render();
    });

    bar.querySelector('#ld-preset-seal-btn')?.addEventListener('click', () => {
      if (this.sim.running) return;
      this.project.ldRungs.push({
        id: `rung_${Date.now()}`,
        title: 'Цепь самоподхвата магнитного пускателя KM1 (классика КИПиА)',
        mainSeries: [
          { id: `c1_${Date.now()}`, kind: 'NO', operand: 'I1', comment: 'SB1 Пуск' },
          { id: `c2_${Date.now()}`, kind: 'NC', operand: 'I2', comment: 'SB2 Стоп' },
          { id: `c3_${Date.now()}`, kind: 'NC', operand: 'I3', comment: 'KK1 Тепл.реле' },
        ],
        parallelBranch: [{ id: `p1_${Date.now()}`, kind: 'NO', operand: 'Q1', comment: 'Шунт KM1' }],
        outputElement: { id: `o1_${Date.now()}`, kind: 'COIL', operand: 'Q1', comment: 'KM1 Двигатель' },
      });
      this.project.activeLanguage = 'LD';
      this.cb.onMutate('Добавлен шаблон самоподхвата LD');
      this.render();
    });

    bar.querySelector('#ld-sync-from-fbd-btn')?.addEventListener('click', () => {
      if (this.sim.running) return;
      this.generateFromFbd();
      this.project.activeLanguage = 'LD';
      this.cb.onMutate('Сгенерирована релейно-контактная схема LD');
      this.render();
    });

    const sheet = document.createElement('div');
    sheet.className = 'oni-ld-sheet';

    if (this.project.ldRungs.length === 0) {
      sheet.innerHTML = `
        <div class="oni-ld-empty">
          <p><b>В этом проекте пока нет цепей релейно-контактной логики (LD / LAD).</b></p>
          <p>Для КИПовца важно уметь читать и функциональные блок-схемы (FBD — ONI PLR Studio), и релейно-контактные лестничные диаграммы (LD — ПЛК ONI CICON и принципиальные электрические схемы Э3).</p>
          <p>Нажмите <b>«+ Шаблон Пуск-Стоп с шунтом»</b> или <b>«Автопостроение из FBD»</b> выше!</p>
        </div>
      `;
      this.root.appendChild(sheet);
      return;
    }

    this.project.ldRungs.forEach((rung, rIdx) => {
      const rungCard = document.createElement('div');
      rungCard.className = 'oni-ld-rung';

      const header = document.createElement('div');
      header.className = 'oni-ld-rung-hdr';
      header.innerHTML = `
        <span><b>Сеть #${rIdx + 1}:</b> ${escapeHtml(rung.title)}</span>
        <div class="oni-ld-rung-btns">
          ${
            !this.sim.running
              ? `
            <button class="oni-win-btn-sm" data-act="add-contact">+ Контакт</button>
            <button class="oni-win-btn-sm" data-act="toggle-shunt">${rung.parallelBranch?.length ? 'Убрать шунт ИЛИ' : '+ Шунт самоподхвата'}</button>
            <button class="oni-win-btn-sm" data-act="del-rung">✕ Удалить цепь</button>
          `
              : ''
          }
        </div>
      `;
      rungCard.appendChild(header);

      header.querySelector('[data-act="add-contact"]')?.addEventListener('click', () => {
        rung.mainSeries.push({ id: `c_${Date.now()}`, kind: 'NO', operand: 'I1', comment: '' });
        this.cb.onMutate('Добавлен контакт в LD');
        this.render();
      });
      header.querySelector('[data-act="toggle-shunt"]')?.addEventListener('click', () => {
        if (rung.parallelBranch && rung.parallelBranch.length > 0) {
          rung.parallelBranch = undefined;
        } else {
          rung.parallelBranch = [{ id: `p_${Date.now()}`, kind: 'NO', operand: rung.outputElement.operand || 'Q1', comment: 'Самоподхват' }];
        }
        this.cb.onMutate('Изменён параллельный шунт LD');
        this.render();
      });
      header.querySelector('[data-act="del-rung"]')?.addEventListener('click', () => {
        this.project.ldRungs.splice(rIdx, 1);
        this.cb.onMutate('Удалена ступень LD');
        this.render();
      });

      // Visual power rail + contacts + coil
      const railRow = document.createElement('div');
      railRow.className = 'oni-ld-rail-row';

      const leftRail = document.createElement('div');
      leftRail.className = 'oni-ld-power-rail left';
      leftRail.title = 'Шина питания +24V (L+)';
      railRow.appendChild(leftRail);

      const middleTrack = document.createElement('div');
      middleTrack.className = 'oni-ld-track';

      const seriesRow = document.createElement('div');
      seriesRow.className = 'oni-ld-series-row';
      rung.mainSeries.forEach((contact, cIdx) => {
        seriesRow.appendChild(this.renderContactCell(contact, () => {
          if (rung.mainSeries.length > 1) {
            rung.mainSeries.splice(cIdx, 1);
            this.cb.onMutate('Удалён контакт LD');
            this.render();
          }
        }));
      });
      middleTrack.appendChild(seriesRow);

      if (rung.parallelBranch && rung.parallelBranch.length > 0) {
        const shuntRow = document.createElement('div');
        shuntRow.className = 'oni-ld-shunt-row';
        rung.parallelBranch.forEach((pContact) => {
          shuntRow.appendChild(this.renderContactCell(pContact));
        });
        middleTrack.appendChild(shuntRow);
      }

      railRow.appendChild(middleTrack);

      const coilWrap = document.createElement('div');
      coilWrap.className = 'oni-ld-coil-wrap';
      coilWrap.appendChild(this.renderCoilCell(rung.outputElement));
      railRow.appendChild(coilWrap);

      const rightRail = document.createElement('div');
      rightRail.className = 'oni-ld-power-rail right';
      rightRail.title = 'Шина 0V (M)';
      railRow.appendChild(rightRail);

      rungCard.appendChild(railRow);
      sheet.appendChild(rungCard);
    });

    this.root.appendChild(sheet);
  }

  private renderContactCell(el: LdContactOrBox, onRemove?: () => void): HTMLElement {
    const active = this.evalOperandEnergized(el);
    const cell = document.createElement('div');
    cell.className = `oni-ld-cell ${active ? 'energized' : ''}`;

    let sym = '─┤ ├─';
    if (el.kind === 'NC') sym = '─┤/├─';
    else if (el.kind === 'P_EDGE') sym = '─┤P├─';
    else if (el.kind === 'CMP_GE') sym = `[≥${el.preset ?? 500}]`;
    else if (el.kind === 'CMP_LE') sym = `[≤${el.preset ?? 500}]`;

    cell.innerHTML = `
      <div class="oni-ld-operand">${escapeHtml(el.operand)}</div>
      <div class="oni-ld-symbol">${sym}</div>
      <div class="oni-ld-comment">${escapeHtml(el.comment || '')}</div>
    `;

    cell.addEventListener('click', () => {
      if (this.sim.running) {
        const m = el.operand.toUpperCase().match(/^I(\d+)$/);
        if (m) this.cb.onSimToggleInput(parseInt(m[1], 10));
        return;
      }
      this.openQuickElementPopup(el, false, onRemove);
    });
    return cell;
  }

  private renderCoilCell(el: LdContactOrBox): HTMLElement {
    const active = this.evalOperandEnergized(el);
    const cell = document.createElement('div');
    cell.className = `oni-ld-cell coil ${active ? 'energized' : ''}`;

    const ldSt = this.sim.ldStates[el.operand.toUpperCase()];
    let sym = '─( )─';
    if (el.kind === 'SET') sym = '─(S)─';
    else if (el.kind === 'RESET') sym = '─(R)─';
    else if (el.kind === 'TON_LD') sym = `[TON ${((el.preset ?? 30) / 10).toFixed(1)}c]`;
    else if (el.kind === 'TOF_LD') sym = `[TOF ${((el.preset ?? 30) / 10).toFixed(1)}c]`;
    else if (el.kind === 'CTU_LD') sym = `[CTU N=${el.preset ?? 5}]`;

    const extraRuntime =
      this.sim.running && ldSt && (el.kind === 'TON_LD' || el.kind === 'TOF_LD')
        ? ` (${ldSt.timer.toFixed(1)}с)`
        : this.sim.running && ldSt && el.kind === 'CTU_LD'
        ? ` (Счёт:${ldSt.count})`
        : '';

    cell.innerHTML = `
      <div class="oni-ld-operand">${escapeHtml(el.operand)}${extraRuntime}</div>
      <div class="oni-ld-symbol">${sym}</div>
      <div class="oni-ld-comment">${escapeHtml(el.comment || '')}</div>
    `;
    cell.addEventListener('click', () => {
      if (!this.sim.running) this.openQuickElementPopup(el, true);
    });
    return cell;
  }

  private openQuickElementPopup(el: LdContactOrBox, isOutput: boolean, onRemove?: () => void) {
    const overlay = document.createElement('div');
    overlay.className = 'oni-modal-backdrop';
    const types: LdElementType[] = isOutput
      ? ['COIL', 'SET', 'RESET', 'TON_LD', 'TOF_LD', 'CTU_LD']
      : ['NO', 'NC', 'P_EDGE', 'CMP_GE', 'CMP_LE'];

    overlay.innerHTML = `
      <div class="oni-win-dialog" style="width:380px">
        <div class="oni-win-dialog-title">
          <span>Параметры элемента схемы LD</span>
          <button class="oni-dlg-close">✕</button>
        </div>
        <div class="oni-win-dialog-body">
          <label class="oni-form-row">
            <span>Тип элемента:</span>
            <select id="ld-el-kind">
              ${types.map((t) => `<option value="${t}" ${el.kind === t ? 'selected' : ''}>${CONTACT_LABELS[t]}</option>`).join('')}
            </select>
          </label>
          <label class="oni-form-row">
            <span>Операнд (I1..I12, Q1..Q8, M1..M16, T1, C1, AI1):</span>
            <input type="text" id="ld-el-op" value="${escapeHtml(el.operand)}" />
          </label>
          <label class="oni-form-row">
            <span>Уставка (0.1с для таймеров / порог для CTU, AI):</span>
            <input type="number" id="ld-el-preset" value="${el.preset ?? 30}" />
          </label>
          <label class="oni-form-row">
            <span>Пояснение на схеме:</span>
            <input type="text" id="ld-el-comm" value="${escapeHtml(el.comment || '')}" />
          </label>
        </div>
        <div class="oni-win-dialog-footer">
          ${onRemove ? `<button class="oni-win-btn danger" id="ld-el-del">Удалить</button>` : ''}
          <button class="oni-win-btn primary" id="ld-el-save">ОК</button>
          <button class="oni-win-btn" id="ld-el-cancel">Отмена</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.oni-dlg-close')?.addEventListener('click', close);
    overlay.querySelector('#ld-el-cancel')?.addEventListener('click', close);
    overlay.querySelector('#ld-el-del')?.addEventListener('click', () => {
      onRemove?.();
      close();
    });
    overlay.querySelector('#ld-el-save')?.addEventListener('click', () => {
      el.kind = (overlay.querySelector('#ld-el-kind') as HTMLSelectElement).value as LdElementType;
      el.operand = (overlay.querySelector('#ld-el-op') as HTMLInputElement).value.trim().toUpperCase() || 'I1';
      el.preset = Number((overlay.querySelector('#ld-el-preset') as HTMLInputElement).value || 30);
      el.comment = (overlay.querySelector('#ld-el-comm') as HTMLInputElement).value.trim();
      close();
      this.cb.onMutate('Изменён элемент LD');
      this.render();
    });
  }

  private generateFromFbd() {
    const rungs: LdRung[] = [];
    const rsBlocks = this.project.blocks.filter((b) => b.type === 'RS' || b.type === 'SR');
    const doBlocks = this.project.blocks.filter((b) => b.type === 'DO');

    if (rsBlocks.length > 0 && doBlocks.length > 0) {
      rsBlocks.forEach((rs, idx) => {
        const qCh = doBlocks[idx]?.channelIndex ?? idx + 1;
        rungs.push({
          id: `gen_r_${idx}`,
          title: `Эквивалент триггера B${String(rs.channelIndex).padStart(3, '0')} → Q${qCh}`,
          mainSeries: [
            { id: `gc1_${idx}`, kind: 'NO', operand: `I${idx * 2 + 1}`, comment: 'Пуск S' },
            { id: `gc2_${idx}`, kind: 'NC', operand: `I${idx * 2 + 2}`, comment: 'Стоп R' },
          ],
          parallelBranch: [{ id: `gp1_${idx}`, kind: 'NO', operand: `Q${qCh}`, comment: 'Самоподхват' }],
          outputElement: { id: `go1_${idx}`, kind: 'COIL', operand: `Q${qCh}`, comment: doBlocks[idx]?.customName || `Выход Q${qCh}` },
        });
      });
    } else {
      doBlocks.forEach((qBlk, idx) => {
        rungs.push({
          id: `gen_q_${idx}`,
          title: `Цепь управления выходом Q${qBlk.channelIndex} (${qBlk.customName || 'Нагрузка'})`,
          mainSeries: [{ id: `gqc_${idx}`, kind: 'NO', operand: `I${idx + 1}`, comment: `Вход I${idx + 1}` }],
          outputElement: { id: `gqo_${idx}`, kind: 'COIL', operand: `Q${qBlk.channelIndex}`, comment: qBlk.customName || `Q${qBlk.channelIndex}` },
        });
      });
    }

    if (rungs.length === 0) {
      rungs.push({
        id: 'gen_default',
        title: 'Базовая цепь Пуск-Стоп',
        mainSeries: [
          { id: 'd1', kind: 'NO', operand: 'I1', comment: 'SB1 Пуск' },
          { id: 'd2', kind: 'NC', operand: 'I2', comment: 'SB2 Стоп' },
        ],
        parallelBranch: [{ id: 'dp1', kind: 'NO', operand: 'Q1', comment: 'Шунт KM1' }],
        outputElement: { id: 'do1', kind: 'COIL', operand: 'Q1', comment: 'KM1' },
      });
    }
    this.project.ldRungs = rungs;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
