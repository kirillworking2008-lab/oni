import { BLOCK_CATEGORIES, BLOCK_DEF_MAP, formatBlockHeaderLabel, ONI_BLOCK_LIBRARY } from '../catalog/blocks';
import { ONI_CONTROLLERS, ONI_EXPANSIONS } from '../catalog/controllers';
import { KIP_FIELD_GUIDES } from '../catalog/reference';
import { KIP_PRACTICE_TASKS, KipPracticeTask } from '../catalog/tasks';
import { runTaskVerification } from '../engine/taskGrader';
import { AnalogSignalStandard, BlockInstance, CanvasNote, OniProject } from '../types';

const SOLVED_TASKS_STORAGE_KEY = 'oni_plr_solved_tasks_v1';

export function getSolvedTaskIds(): Set<string> {
  try {
    const raw = localStorage.getItem(SOLVED_TASKS_STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function markTaskSolved(taskId: string) {
  const s = getSolvedTaskIds();
  s.add(taskId);
  try {
    localStorage.setItem(SOLVED_TASKS_STORAGE_KEY, JSON.stringify([...s]));
  } catch {
    // ignore storage quota errors
  }
}

export function openBlockPropertiesModal(
  block: BlockInstance,
  _project: OniProject,
  onSaved: () => void,
  onOpenBlockHelp: (blockType: string) => void
) {
  const def = BLOCK_DEF_MAP[block.type];
  if (!def) return;

  const title = `${formatBlockHeaderLabel(def, block.channelIndex, block.customName)} [${def.nameRu}]`;
  const overlay = document.createElement('div');
  overlay.className = 'oni-modal-backdrop';

  overlay.innerHTML = `
    <div class="oni-win-dialog" style="width:480px;max-width:95vw">
      <div class="oni-win-dialog-title">
        <span>${esc(title)}</span>
        <button class="oni-dlg-close" title="Закрыть">✕</button>
      </div>
      <div class="oni-win-dialog-tabs">
        <button class="oni-dtab active" data-dtab="params">Параметры</button>
        <button class="oni-dtab" data-dtab="comments">Комментарии и входы</button>
      </div>
      <div class="oni-win-dialog-body">
        <div data-dpane="params">
          <div class="oni-prop-toprow">
            <label>
              <span>Канал (${def.prefix}):</span>
              <input type="number" id="bp-channel" min="1" max="1024" value="${block.channelIndex}" style="width:70px" />
            </label>
            <label style="flex:1">
              <span>Имя блока (метка):</span>
              <input type="text" id="bp-name" maxlength="20" value="${esc(block.customName)}" placeholder="напр. SB1 Пуск / KM1" />
            </label>
            <label class="oni-chk-inline">
              <input type="checkbox" id="bp-show-params" ${block.showParams ? 'checked' : ''} />
              <span>Показывать параметры</span>
            </label>
          </div>

          <fieldset class="oni-win-fieldset">
            <legend>${esc(def.nameRu)}</legend>
            ${
              def.params.length === 0
                ? `<div style="font-size:12px;color:#444;padding:4px 0">${esc(def.shortDesc)}</div>`
                : def.params
                    .map((p) => {
                      const val = block.params[p.key] ?? p.defaultValue;
                      if (p.type === 'select') {
                        return `
                          <label class="oni-form-row">
                            <span>${esc(p.label)}:</span>
                            <select data-param-key="${p.key}">
                              ${(p.options || [])
                                .map(
                                  (o) => `<option value="${esc(o.value)}" ${String(val) === o.value ? 'selected' : ''}>${esc(o.label)}</option>`
                                )
                                .join('')}
                            </select>
                            ${p.help ? `<small class="oni-field-help">${esc(p.help)}</small>` : ''}
                          </label>
                        `;
                      }
                      if (p.type === 'boolean') {
                        return `
                          <label class="oni-chk-inline" style="margin:6px 0">
                            <input type="checkbox" data-param-key="${p.key}" ${val ? 'checked' : ''} />
                            <span>${esc(p.label)}</span>
                          </label>
                        `;
                      }
                      if (p.type === 'text') {
                        return `
                          <label class="oni-form-row">
                            <span>${esc(p.label)}:</span>
                            <input type="text" data-param-key="${p.key}" value="${esc(String(val))}" />
                          </label>
                        `;
                      }
                      return `
                        <label class="oni-form-row">
                          <span>${esc(p.label)}${p.unit ? ` (${p.unit})` : ''}:</span>
                          <input type="number" data-param-key="${p.key}" value="${val}"
                            ${p.min !== undefined ? `min="${p.min}"` : ''}
                            ${p.max !== undefined ? `max="${p.max}"` : ''}
                            ${p.step !== undefined ? `step="${p.step}"` : ''} />
                          ${p.help ? `<small class="oni-field-help">${esc(p.help)}</small>` : ''}
                        </label>
                      `;
                    })
                    .join('')
            }
          </fieldset>

          <div class="oni-prop-flags">
            <label class="oni-chk-inline">
              <input type="checkbox" id="bp-retentive" ${block.retentive ? 'checked' : ''} />
              <span>Сохранять (энергонезависимая память Retentive)</span>
            </label>
            <label class="oni-chk-inline">
              <input type="checkbox" id="bp-protect" ${block.protectedBlock ? 'checked' : ''} />
              <span>Защитить</span>
            </label>
          </div>
        </div>

        <div data-dpane="comments" style="display:none">
          <label class="oni-form-row">
            <span>Технический комментарий блока (для документации КИПиА):</span>
            <textarea id="bp-comment" rows="3">${esc(block.comment)}</textarea>
          </label>
          ${
            def.inputs.some((i) => i.invertible)
              ? `
            <fieldset class="oni-win-fieldset" style="margin-top:8px">
              <legend>Инверсия входов (аналог двойного клика по ножке входа)</legend>
              ${def.inputs
                .filter((i) => i.invertible)
                .map(
                  (pin) => `
                  <label class="oni-chk-inline" style="margin:4px 10px 4px 0">
                    <input type="checkbox" data-inv-pin="${pin.id}" ${block.invertedInputs?.[pin.id] ? 'checked' : ''} />
                    <span>Инвертировать вход <b>${pin.label}</b> (${esc(pin.nameRu)}) — кружок НЕ ○</span>
                  </label>
                `
                )
                .join('')}
            </fieldset>
          `
              : ''
          }
        </div>
      </div>

      <div class="oni-win-dialog-footer">
        <button class="oni-win-btn primary" id="bp-ok">ОК</button>
        <button class="oni-win-btn" id="bp-cancel">Отмена</button>
        <button class="oni-win-btn" id="bp-help">Справка</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  const close = () => overlay.remove();

  overlay.querySelectorAll<HTMLButtonElement>('[data-dtab]').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      const target = tabBtn.dataset.dtab!;
      overlay.querySelectorAll('[data-dtab]').forEach((b) => b.classList.toggle('active', b === tabBtn));
      overlay.querySelectorAll<HTMLElement>('[data-dpane]').forEach((pane) => {
        pane.style.display = pane.dataset.dpane === target ? 'block' : 'none';
      });
    });
  });

  overlay.querySelector('.oni-dlg-close')?.addEventListener('click', close);
  overlay.querySelector('#bp-cancel')?.addEventListener('click', close);
  overlay.querySelector('#bp-help')?.addEventListener('click', () => {
    close();
    onOpenBlockHelp(block.type);
  });

  overlay.querySelector('#bp-ok')?.addEventListener('click', () => {
    const newCh = Math.max(1, Math.min(1024, Number((overlay.querySelector('#bp-channel') as HTMLInputElement).value || 1)));
    block.channelIndex = newCh;
    block.customName = (overlay.querySelector('#bp-name') as HTMLInputElement).value.trim();
    block.showParams = (overlay.querySelector('#bp-show-params') as HTMLInputElement).checked;
    block.retentive = (overlay.querySelector('#bp-retentive') as HTMLInputElement).checked;
    block.protectedBlock = (overlay.querySelector('#bp-protect') as HTMLInputElement).checked;
    block.comment = (overlay.querySelector('#bp-comment') as HTMLTextAreaElement).value.trim();

    def.params.forEach((p) => {
      const el = overlay.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-param-key="${p.key}"]`);
      if (!el) return;
      if (p.type === 'boolean') block.params[p.key] = (el as HTMLInputElement).checked;
      else if (p.type === 'number') block.params[p.key] = Number(el.value);
      else block.params[p.key] = el.value;
    });

    block.invertedInputs = block.invertedInputs || {};
    overlay.querySelectorAll<HTMLInputElement>('[data-inv-pin]').forEach((chk) => {
      const pid = chk.dataset.invPin!;
      if (chk.checked) block.invertedInputs[pid] = true;
      else delete block.invertedInputs[pid];
    });

    close();
    onSaved();
  });
}

export function openNoteEditorModal(note: CanvasNote, onSaved: () => void) {
  const overlay = document.createElement('div');
  overlay.className = 'oni-modal-backdrop';
  overlay.innerHTML = `
    <div class="oni-win-dialog" style="width:420px;max-width:95vw">
      <div class="oni-win-dialog-title">
        <span>Текстовая надпись на схеме</span>
        <button class="oni-dlg-close">✕</button>
      </div>
      <div class="oni-win-dialog-body">
        <label class="oni-form-row">
          <span>Текст пояснения (многострочный):</span>
          <textarea id="note-txt-area" rows="5">${esc(note.text)}</textarea>
        </label>
      </div>
      <div class="oni-win-dialog-footer">
        <button class="oni-win-btn primary" id="note-ok">ОК</button>
        <button class="oni-win-btn" id="note-cancel">Отмена</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.oni-dlg-close')?.addEventListener('click', close);
  overlay.querySelector('#note-cancel')?.addEventListener('click', close);
  overlay.querySelector('#note-ok')?.addEventListener('click', () => {
    note.text = (overlay.querySelector('#note-txt-area') as HTMLTextAreaElement).value;
    close();
    onSaved();
  });
}

export function openHardwareConfigModal(project: OniProject, onSaved: () => void) {
  const overlay = document.createElement('div');
  overlay.className = 'oni-modal-backdrop';
  overlay.innerHTML = `
    <div class="oni-win-dialog" style="width:580px;max-width:96vw">
      <div class="oni-win-dialog-title">
        <span>Инструменты → Выбор оборудования ONI PLR-S / PLR-M</span>
        <button class="oni-dlg-close">✕</button>
      </div>
      <div class="oni-win-dialog-body">
        <fieldset class="oni-win-fieldset">
          <legend>Базовый модуль ЦПУ</legend>
          ${ONI_CONTROLLERS.map(
            (c) => `
            <label class="oni-cpu-radio-card ${project.controllerId === c.id ? 'selected' : ''}">
              <input type="radio" name="cpu_model" value="${c.id}" ${project.controllerId === c.id ? 'checked' : ''} />
              <div>
                <div><b>${c.model}</b> — ${c.powerSupply} | DI: ${c.diCount}, DO: ${c.doCount} (${c.outputType})</div>
                <div style="font-size:11px;color:#444">${c.description}</div>
              </div>
            </label>
          `
          ).join('')}
        </fieldset>

        <fieldset class="oni-win-fieldset" style="margin-top:8px">
          <legend>Модули расширения на правой шине (КИПиА 4–20 мА / Pt100 / DI-DO)</legend>
          ${ONI_EXPANSIONS.map(
            (ex) => `
            <label class="oni-chk-inline" style="display:flex;margin:5px 0">
              <input type="checkbox" data-exp-id="${ex.id}" ${project.expansionIds.includes(ex.id) ? 'checked' : ''} />
              <span><b>${ex.model}:</b> ${ex.nameRu} — <i>${ex.signalNote}</i></span>
            </label>
          `
          ).join('')}
        </fieldset>
      </div>
      <div class="oni-win-dialog-footer">
        <button class="oni-win-btn primary" id="hw-ok">Применить конфигурацию</button>
        <button class="oni-win-btn" id="hw-cancel">Отмена</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.oni-dlg-close')?.addEventListener('click', close);
  overlay.querySelector('#hw-cancel')?.addEventListener('click', close);
  overlay.querySelector('#hw-ok')?.addEventListener('click', () => {
    const selRadio = overlay.querySelector<HTMLInputElement>('input[name="cpu_model"]:checked');
    if (selRadio) project.controllerId = selRadio.value;
    const exps: string[] = [];
    overlay.querySelectorAll<HTMLInputElement>('[data-exp-id]').forEach((chk) => {
      if (chk.checked && chk.dataset.expId) exps.push(chk.dataset.expId);
    });
    project.expansionIds = exps;
    close();
    onSaved();
  });
}

export function openAnalogSensorsAndCalcModal(project: OniProject, onSaved: () => void) {
  const overlay = document.createElement('div');
  overlay.className = 'oni-modal-backdrop';
  overlay.innerHTML = `
    <div class="oni-win-dialog" style="width:660px;max-width:96vw">
      <div class="oni-win-dialog-title">
        <span>Настройка аналоговых датчиков КИПиА и Калькулятор токовой петли 4–20 мА</span>
        <button class="oni-dlg-close">✕</button>
      </div>
      <div class="oni-win-dialog-body" style="max-height:74vh;overflow-y:auto">
        <fieldset class="oni-win-fieldset">
          <legend>Шкалы датчиков проекта (AI1..AI4)</legend>
          <table class="oni-modbus-tbl">
            <thead>
              <tr><th>Вход</th><th>Позиция / Наименование</th><th>Сигнал</th><th>Низ шкалы</th><th>Верх шкалы</th><th>Ед.изм.</th></tr>
            </thead>
            <tbody>
              ${project.analogConfigs
                .map(
                  (c, idx) => `
                <tr>
                  <td><b>AI${c.channel}</b></td>
                  <td><input type="text" data-ac-tag="${idx}" value="${esc(c.tag)}" style="width:165px" /></td>
                  <td>
                    <select data-ac-std="${idx}">
                      ${(['4-20mA', '0-10V', '0-20mA', 'Pt100'] as AnalogSignalStandard[])
                        .map((s) => `<option value="${s}" ${c.standard === s ? 'selected' : ''}>${s}</option>`)
                        .join('')}
                    </select>
                  </td>
                  <td><input type="number" data-ac-min="${idx}" value="${c.minEng}" style="width:68px" /></td>
                  <td><input type="number" data-ac-max="${idx}" value="${c.maxEng}" style="width:68px" /></td>
                  <td><input type="text" data-ac-unit="${idx}" value="${esc(c.unit)}" style="width:52px" /></td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </fieldset>

        <fieldset class="oni-win-fieldset" style="margin-top:10px">
          <legend>Инженерный калькулятор КИПовца: Токовая петля 4–20 мА ↔ Физическая величина ↔ Коэффициенты AMP</legend>
          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px">
            <label class="oni-form-row">
              <span>Низ шкалы датчика (при 4 мА):</span>
              <input type="number" id="calc-xmin" value="0" step="0.1" />
            </label>
            <label class="oni-form-row">
              <span>Верх шкалы датчика (при 20 мА):</span>
              <input type="number" id="calc-xmax" value="10" step="0.1" />
            </label>
            <label class="oni-form-row">
              <span>Измеренный мультиметром ток (мА):</span>
              <input type="number" id="calc-ma" value="12.0" min="0" max="24" step="0.1" />
            </label>
          </div>
          <div id="calc-result-box" class="kip-calc-result"></div>
        </fieldset>
      </div>
      <div class="oni-win-dialog-footer">
        <button class="oni-win-btn primary" id="ac-save">Сохранить шкалы</button>
        <button class="oni-win-btn" id="ac-close">Закрыть</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const updateCalc = () => {
    const xmin = Number((overlay.querySelector('#calc-xmin') as HTMLInputElement).value || 0);
    const xmax = Number((overlay.querySelector('#calc-xmax') as HTMLInputElement).value || 10);
    const ma = Number((overlay.querySelector('#calc-ma') as HTMLInputElement).value || 12);
    const pct = ((ma - 4) / 16) * 100;
    const eng = xmin + ((ma - 4) / 16) * (xmax - xmin);
    const adc = Math.round((ma / 20) * 1000);
    const gain = (xmax - xmin) / 800;
    const offset = xmin - 200 * gain;
    const box = overlay.querySelector('#calc-result-box')!;
    box.innerHTML = `
      <div><b>Процент шкалы:</b> ${pct.toFixed(1)}% &nbsp;|&nbsp; <b>Физическое значение:</b> <span style="color:#0055aa;font-size:14px"><b>${eng.toFixed(
      2
    )}</b></span> &nbsp;|&nbsp; <b>Код АЦП ONI (0..1000):</b> <code>${adc}</code></div>
      <div style="margin-top:4px"><b>Готовые настройки для блока «AMP (Усилитель)»:</b> <code>Gain = ${gain.toFixed(
        4
      )}</code>, <code>Offset = ${offset.toFixed(2)}</code> ${
      ma < 3.8 ? '<span style="color:#c92a2a;font-weight:bold"> ⚠ ТОК НИЖЕ 3.8 мА — ОБРЫВ ЦЕПИ!</span>' : ''
    }</div>
    `;
  };
  ['#calc-xmin', '#calc-xmax', '#calc-ma'].forEach((sel) => {
    overlay.querySelector(sel)?.addEventListener('input', updateCalc);
  });
  updateCalc();

  const close = () => overlay.remove();
  overlay.querySelector('.oni-dlg-close')?.addEventListener('click', close);
  overlay.querySelector('#ac-close')?.addEventListener('click', close);
  overlay.querySelector('#ac-save')?.addEventListener('click', () => {
    project.analogConfigs.forEach((cfg, idx) => {
      cfg.tag = (overlay.querySelector(`[data-ac-tag="${idx}"]`) as HTMLInputElement).value.trim() || `AI${cfg.channel}`;
      cfg.standard = (overlay.querySelector(`[data-ac-std="${idx}"]`) as HTMLSelectElement).value as AnalogSignalStandard;
      cfg.minEng = Number((overlay.querySelector(`[data-ac-min="${idx}"]`) as HTMLInputElement).value || 0);
      cfg.maxEng = Number((overlay.querySelector(`[data-ac-max="${idx}"]`) as HTMLInputElement).value || 100);
      cfg.unit = (overlay.querySelector(`[data-ac-unit="${idx}"]`) as HTMLInputElement).value.trim() || '%';
    });
    close();
    onSaved();
  });
}

export function openPracticeTasksModal(
  getCurrentProject: () => OniProject,
  onLoadStarter: (starter: OniProject, task: KipPracticeTask) => void
) {
  let selectedTaskId = KIP_PRACTICE_TASKS[0].id;
  const overlay = document.createElement('div');
  overlay.className = 'oni-modal-backdrop';

  const renderModalContent = () => {
    const solved = getSolvedTaskIds();
    const task = KIP_PRACTICE_TASKS.find((t) => t.id === selectedTaskId) || KIP_PRACTICE_TASKS[0];

    overlay.innerHTML = `
      <div class="oni-win-dialog" style="width:860px;max-width:97vw">
        <div class="oni-win-dialog-title">
          <span>🎓 Практикум инженера КИПиА — Задачи с автоматической проверкой схемы (${solved.size}/${KIP_PRACTICE_TASKS.length} решено)</span>
          <button class="oni-dlg-close">✕</button>
        </div>
        <div class="oni-win-dialog-body oni-split-modal">
          <div class="oni-split-list">
            ${KIP_PRACTICE_TASKS.map(
              (t) => `
              <button class="oni-task-item ${t.id === task.id ? 'active' : ''}" data-tid="${t.id}">
                <span class="task-status">${solved.has(t.id) ? '✅' : '⬜'}</span>
                <div>
                  <div class="task-item-title">${t.number}. ${esc(t.title)}</div>
                  <div class="task-item-lvl">${t.level}</div>
                </div>
              </button>
            `
            ).join('')}
          </div>

          <div class="oni-split-detail">
            <div class="task-badge-row">
              <span class="task-lvl-pill">${task.level}</span>
              <span class="task-ctx">Объект: <b>${esc(task.plantContext)}</b></span>
            </div>
            <h3 style="margin:6px 0">${task.number}. ${esc(task.title)}</h3>
            <p style="font-size:12.5px;line-height:1.45;margin:6px 0">${esc(task.objective)}</p>

            <table class="oni-modbus-tbl" style="margin:8px 0">
              <thead><tr><th>Клемма реле ONI</th><th>Назначение сигнала в задаче</th></tr></thead>
              <tbody>
                ${task.ioTable.map((r) => `<tr><td><b><code>${r.pin}</code></b></td><td>${esc(r.role)}</td></tr>`).join('')}
              </tbody>
            </table>

            <details class="oni-hint-box">
              <summary>💡 Показать подсказку КИПовца по сборке схемы</summary>
              <p>${esc(task.hint)}</p>
            </details>

            <div class="task-action-bar">
              <button class="oni-win-btn" id="btn-load-starter">📋 Разместить клеммы задачи на чистом листе</button>
              <button class="oni-win-btn primary" id="btn-run-autograde">▶ Проверить мою текущую схему автоматически</button>
            </div>

            <div id="autograde-output"></div>
          </div>
        </div>
        <div class="oni-win-dialog-footer">
          <button class="oni-win-btn" id="task-close-btn">Закрыть окно практикума</button>
        </div>
      </div>
    `;

    overlay.querySelector('.oni-dlg-close')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#task-close-btn')?.addEventListener('click', () => overlay.remove());

    overlay.querySelectorAll<HTMLButtonElement>('[data-tid]').forEach((b) => {
      b.addEventListener('click', () => {
        selectedTaskId = b.dataset.tid!;
        renderModalContent();
      });
    });

    overlay.querySelector('#btn-load-starter')?.addEventListener('click', () => {
      const starter = task.createStarter();
      onLoadStarter(starter, task);
      overlay.remove();
    });

    overlay.querySelector('#btn-run-autograde')?.addEventListener('click', () => {
      const proj = getCurrentProject();
      const report = runTaskVerification(proj, task);
      if (report.passedAll) {
        markTaskSolved(task.id);
      }
      const out = overlay.querySelector('#autograde-output')!;
      out.innerHTML = `
        <div class="grade-banner ${report.passedAll ? 'pass' : 'fail'}">
          ${
            report.passedAll
              ? `🎉 ОТЛИЧНО! Задача №${task.number} полностью решена (${report.passedCount}/${report.totalCount} проверок)!`
              : `⚠ Схема требует доработки: пройдено ${report.passedCount} из ${report.totalCount} шагов стенда.`
          }
        </div>
        <div class="grade-steps-list">
          ${report.steps
            .map(
              (s) => `
            <div class="grade-step ${s.passed ? 'ok' : 'err'}">
              <span>${s.passed ? '✔' : '✖'} <b>Шаг ${s.stepIndex}:</b> ${esc(s.description)}</span>
              ${!s.passed ? `<div class="grade-err-detail">↳ ${esc(s.details)}</div>` : ''}
            </div>
          `
            )
            .join('')}
        </div>
      `;
    });
  };

  document.body.appendChild(overlay);
  renderModalContent();
}

export function openReferenceModal(initialBlockType?: string) {
  let mode: 'blocks' | 'kip_guides' = 'blocks';
  let selectedBlock = initialBlockType || 'RS';
  let selectedGuide = KIP_FIELD_GUIDES[0].id;

  const overlay = document.createElement('div');
  overlay.className = 'oni-modal-backdrop';

  const renderRef = () => {
    const blkDef = BLOCK_DEF_MAP[selectedBlock] || ONI_BLOCK_LIBRARY[0];
    const guide = KIP_FIELD_GUIDES.find((g) => g.id === selectedGuide) || KIP_FIELD_GUIDES[0];

    overlay.innerHTML = `
      <div class="oni-win-dialog" style="width:860px;max-width:97vw">
        <div class="oni-win-dialog-title">
          <span>📖 Справочник ONI PLR Studio и Полевая шпаргалка КИПовца</span>
          <button class="oni-dlg-close">✕</button>
        </div>
        <div class="oni-win-dialog-tabs">
          <button class="oni-dtab ${mode === 'blocks' ? 'active' : ''}" data-rmode="blocks">Все функциональные блоки ONI (${ONI_BLOCK_LIBRARY.length})</button>
          <button class="oni-dtab ${mode === 'kip_guides' ? 'active' : ''}" data-rmode="kip_guides">Полевая шпаргалка КИПовца (4–20 мА, Pt100, PNP, ПИД, RS-485)</button>
        </div>
        <div class="oni-win-dialog-body oni-split-modal">
          ${
            mode === 'blocks'
              ? `
            <div class="oni-split-list">
              ${BLOCK_CATEGORIES.map(
                (cat) => `
                <div class="ref-cat-hdr">${cat.nameRu}</div>
                ${ONI_BLOCK_LIBRARY.filter((b) => b.category === cat.id)
                  .map(
                    (b) => `
                  <button class="oni-task-item ${b.type === blkDef.type ? 'active' : ''}" data-btype="${b.type}">
                    <span class="mini-blk-badge ${b.colorKind}">${b.codeLabel}</span>
                    <span>${esc(b.nameRu)}</span>
                  </button>
                `
                  )
                  .join('')}
              `
              ).join('')}
            </div>
            <div class="oni-split-detail">
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
                <div class="ref-big-icon ${blkDef.colorKind}">${blkDef.codeLabel}</div>
                <div>
                  <h3 style="margin:0">${esc(blkDef.nameRu)} (группа ${blkDef.toolbarGroup})</h3>
                  <div style="font-size:12px;color:#444">Обозначение на схеме: <code>${blkDef.prefix}001</code></div>
                </div>
              </div>
              <p style="font-size:13px;line-height:1.5">${esc(blkDef.shortDesc)}</p>

              <h4>Входы блока:</h4>
              ${
                blkDef.inputs.length === 0
                  ? `<p style="font-size:12px;color:#555">Внешних программных входов нет (сигнал поступает с физической клеммы или часов ЦПУ).</p>`
                  : `<ul style="font-size:12.5px">
                    ${blkDef.inputs
                      .map(
                        (i) =>
                          `<li><b><code>${i.label}</code></b> (${i.type === 'analog' ? 'аналоговый 0..1000' : 'дискретный 0/1'}) — ${esc(
                            i.nameRu
                          )}${i.invertible ? ' <i>[двойной клик по входу ставит инверсию НЕ ○]</i>' : ''}</li>`
                      )
                      .join('')}
                  </ul>`
              }

              <h4>Выходы блока:</h4>
              <ul style="font-size:12.5px">
                ${blkDef.outputs
                  .map(
                    (o) =>
                      `<li><b><code>${o.label}</code></b> (${o.type === 'analog' ? 'аналоговое число' : 'дискретный бит 0/1'}) — ${esc(
                        o.nameRu
                      )}</li>`
                  )
                  .join('')}
              </ul>

              ${
                blkDef.params.length > 0
                  ? `<h4>Настраиваемые параметры:</h4>
                  <ul style="font-size:12.5px">
                    ${blkDef.params.map((p) => `<li><b>${esc(p.label)}</b> (по умолч.: <code>${p.defaultValue}</code>) ${p.help ? `— ${esc(p.help)}` : ''}</li>`).join('')}
                  </ul>`
                  : ''
              }
            </div>
          `
              : `
            <div class="oni-split-list">
              ${KIP_FIELD_GUIDES.map(
                (g) => `
                <button class="oni-task-item ${g.id === guide.id ? 'active' : ''}" data-gid="${g.id}">
                  <div>
                    <div class="task-item-title">${esc(g.title)}</div>
                    <div class="task-item-lvl">${g.category}</div>
                  </div>
                </button>
              `
              ).join('')}
            </div>
            <div class="oni-split-detail kip-guide-article">
              <span class="task-lvl-pill">${guide.category}</span>
              <h3 style="margin:6px 0">${esc(guide.title)}</h3>
              ${guide.bodyHtml}
            </div>
          `
          }
        </div>
        <div class="oni-win-dialog-footer">
          <button class="oni-win-btn" id="ref-close-btn">Закрыть справочник</button>
        </div>
      </div>
    `;

    overlay.querySelector('.oni-dlg-close')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#ref-close-btn')?.addEventListener('click', () => overlay.remove());

    overlay.querySelectorAll<HTMLButtonElement>('[data-rmode]').forEach((b) => {
      b.addEventListener('click', () => {
        mode = b.dataset.rmode as typeof mode;
        renderRef();
      });
    });
    overlay.querySelectorAll<HTMLButtonElement>('[data-btype]').forEach((b) => {
      b.addEventListener('click', () => {
        selectedBlock = b.dataset.btype!;
        renderRef();
      });
    });
    overlay.querySelectorAll<HTMLButtonElement>('[data-gid]').forEach((b) => {
      b.addEventListener('click', () => {
        selectedGuide = b.dataset.gid!;
        renderRef();
      });
    });
  };

  document.body.appendChild(overlay);
  renderRef();
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
