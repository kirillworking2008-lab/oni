import { BLOCK_CATEGORIES, BLOCK_DEF_MAP, formatBlockHeaderLabel, ONI_BLOCK_LIBRARY } from '../catalog/blocks';
import { ONI_EXAMPLE_PROJECTS } from '../catalog/examples';
import { KipPlantSimulator } from '../engine/plantSimulator';
import { checkProjectErc, OniPlcSimulator } from '../engine/simulator';
import { defaultAnalogConfigs, exportProjectToSvg, importXlgBinaryOrJson, parseProjectJson, serializeProjectJson } from '../engine/xlgCodec';
import { BlockInstance, OniProject } from '../types';
import { BottomSimulatorDock } from './bottomDock';
import { ContextMenuRequest, FbdSchematicCanvas } from './fbdCanvas';
import { HmiAndPlantWorkbench } from './hmiPanel';
import { LadderDiagramView } from './ldEditor';
import {
  openAnalogSensorsAndCalcModal,
  openBlockPropertiesModal,
  openHardwareConfigModal,
  openNoteEditorModal,
  openPracticeTasksModal,
  openReferenceModal,
} from './modals';

declare global {
  interface Window {
    OniAndroid?: {
      saveFile: (filename: string, mimeType: string, content: string, isBase64: boolean) => void;
      toggleFullscreen: () => void;
      showToast: (msg: string) => void;
      isNativeAndroid: () => boolean;
    };
    __oniHandleBackKey?: () => boolean;
  }
}

const AUTOSAVE_KEY = 'oni_plr_studio_autosave_v1';

export class OniStudioAppShell {
  private host: HTMLElement;
  private project: OniProject;
  private sim = new OniPlcSimulator();
  private plant = new KipPlantSimulator();

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private clipboardBlocks: BlockInstance[] = [];

  private activeWorkspaceTab: 'fbd' | 'ld' | 'hmi' = 'fbd';
  private showLeftLibrary = true;
  private libraryFilter = '';
  private collapsedCategories = new Set<string>();

  private fbdCanvas!: FbdSchematicCanvas;
  private ldView!: LadderDiagramView;
  private hmiView!: HmiAndPlantWorkbench;
  private bottomDock!: BottomSimulatorDock;

  private simTimerId: number | null = null;
  private lastTickMs = 0;

  // UI refs
  private titleProjSpan!: HTMLElement;
  private statusLeftSpan!: HTMLElement;
  private statusRightSpan!: HTMLElement;
  private simToolbarBtn!: HTMLButtonElement;
  private fileInput!: HTMLInputElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.project = this.loadInitialProject();
    this.pushUndoSnapshot();
    this.buildDom();
    this.bindGlobalShortcuts();
    this.startSimulationLoop();
  }

  private loadInitialProject(): OniProject {
    try {
      const saved = localStorage.getItem(AUTOSAVE_KEY);
      if (saved) {
        return parseProjectJson(saved);
      }
    } catch {
      // fallback to default example
    }
    return ONI_EXAMPLE_PROJECTS[0].build();
  }

  private autosaveProject() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeProjectJson(this.project));
    } catch {
      // ignore
    }
  }

  private pushUndoSnapshot() {
    const snap = serializeProjectJson(this.project);
    if (this.undoStack.length === 0 || this.undoStack[this.undoStack.length - 1] !== snap) {
      this.undoStack.push(snap);
      if (this.undoStack.length > 40) this.undoStack.shift();
    }
  }

  public undo() {
    if (this.sim.running || this.undoStack.length <= 1) return;
    const curr = this.undoStack.pop()!;
    this.redoStack.push(curr);
    const prev = this.undoStack[this.undoStack.length - 1];
    this.project = parseProjectJson(prev);
    this.syncAllViews('Отмена действия');
  }

  public redo() {
    if (this.sim.running || this.redoStack.length === 0) return;
    const next = this.redoStack.pop()!;
    this.undoStack.push(next);
    this.project = parseProjectJson(next);
    this.syncAllViews('Повтор действия');
  }

  private onProjectMutated(reason: string) {
    this.pushUndoSnapshot();
    this.redoStack = [];
    this.autosaveProject();
    this.updateHeaderAndStatus(reason);
    this.bottomDock?.render();
  }

  private syncAllViews(statusMsg?: string) {
    this.autosaveProject();
    this.fbdCanvas.setProject(this.project);
    this.ldView.setProject(this.project);
    this.hmiView.setProject(this.project);
    this.bottomDock.setProject(this.project);
    this.updateHeaderAndStatus(statusMsg || 'Готово');
  }

  private buildDom() {
    this.host.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'oni-app-window';

    // Hidden file input for Open (.oni.json / .xlg)
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,.xlg,.oni';
    this.fileInput.style.display = 'none';
    this.fileInput.addEventListener('change', () => this.handleFileImport());
    shell.appendChild(this.fileInput);

    // 1. Classic Windows Titlebar
    const isNativeApk = Boolean((window as unknown as { OniAndroid?: { isNativeAndroid?: () => boolean } }).OniAndroid);
    const apkDownloadBtnHtml = isNativeApk
      ? ''
      : `<a class="oni-title-btn" href="https://github.com/kirillworking2008-lab/oni/raw/arena/7e7fc498-oni/ONI-PLR-Studio-Android.apk" target="_blank" rel="noopener noreferrer" style="text-decoration:none;background:#008a32;color:#fff;border-color:#005a20;font-weight:bold;" title="Скачать установочный файл Android APK">📥 Скачать APK</a>`;
    const titleBar = document.createElement('div');
    titleBar.className = 'oni-titlebar';
    titleBar.innerHTML = `
      <div class="oni-title-left">
        <span class="oni-logo-diamond">ONI</span>
        <span class="oni-title-text" id="oni-win-title">ONI PLR Studio — ${esc(this.project.name)} [${this.project.controllerId}]</span>
      </div>
      <div class="oni-title-right">
        ${apkDownloadBtnHtml}
        <button class="oni-title-btn" id="btn-kip-tasks-quick" title="Открыть практикум с автопроверкой">🎓 Практикум КИПиА</button>
        <button class="oni-title-btn" id="btn-kip-ref-quick" title="Справочник блоков и датчиков 4–20 мА">📖 Справочник</button>
        <button class="oni-title-btn" id="btn-fullscreen-win" title="Полноэкранный режим планшета (F11)">⛶ Полный экран</button>
      </div>
    `;
    shell.appendChild(titleBar);
    this.titleProjSpan = titleBar.querySelector('#oni-win-title')!;
    titleBar.querySelector('#btn-kip-tasks-quick')?.addEventListener('click', () => this.showPracticeModal());
    titleBar.querySelector('#btn-kip-ref-quick')?.addEventListener('click', () => openReferenceModal());
    titleBar.querySelector('#btn-fullscreen-win')?.addEventListener('click', () => this.toggleFullscreen());

    // 2. Classic Windows Menu Bar (Файл | Изменить | Инструменты | Вид | Обучение КИПиА | Справка)
    shell.appendChild(this.buildMenuBar());

    // 3. Classic Icon Toolbar
    shell.appendChild(this.buildTopToolbar());

    // 4. Main Middle Area (Far-Left Tool Strip + Left Block Library + Center Tabbed Workspace)
    const middleRow = document.createElement('div');
    middleRow.className = 'oni-middle-row';

    middleRow.appendChild(this.buildLeftQuickToolStrip());

    const libraryContainer = document.createElement('div');
    libraryContainer.className = 'oni-library-dock';
    libraryContainer.id = 'oni-library-dock';
    this.populateLibraryTree(libraryContainer);
    middleRow.appendChild(libraryContainer);

    const workspaceCol = document.createElement('div');
    workspaceCol.className = 'oni-workspace-col';

    // Document tabs above canvas (like [ONI PLR 1] [подготовка] in Slide 1!)
    const docTabs = document.createElement('div');
    docTabs.className = 'oni-doc-tabs';
    docTabs.id = 'oni-doc-tabs';
    docTabs.innerHTML = `
      <button class="oni-doc-tab active" data-wtab="fbd">▦ ${esc(this.project.name)} (FBD)</button>
      <button class="oni-doc-tab" data-wtab="ld">╟─╢ Релейно-контактная схема (LD)</button>
      <button class="oni-doc-tab" data-wtab="hmi">🏭 Стенд КИПиА / Панель HMI / Клеммы</button>
    `;
    workspaceCol.appendChild(docTabs);

    const panesWrap = document.createElement('div');
    panesWrap.className = 'oni-panes-wrap';

    const fbdPane = document.createElement('div');
    fbdPane.className = 'oni-pane active';
    fbdPane.dataset.wpane = 'fbd';

    const ldPane = document.createElement('div');
    ldPane.className = 'oni-pane';
    ldPane.dataset.wpane = 'ld';

    const hmiPane = document.createElement('div');
    hmiPane.className = 'oni-pane';
    hmiPane.dataset.wpane = 'hmi';

    panesWrap.appendChild(fbdPane);
    panesWrap.appendChild(ldPane);
    panesWrap.appendChild(hmiPane);
    workspaceCol.appendChild(panesWrap);
    middleRow.appendChild(workspaceCol);
    shell.appendChild(middleRow);

    docTabs.querySelectorAll<HTMLButtonElement>('[data-wtab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.switchWorkspaceTab(btn.dataset.wtab as 'fbd' | 'ld' | 'hmi');
      });
    });

    // 5. Bottom Docked Simulator / Digital IO / Analog IO / LCD / Oscilloscope
    const bottomWrap = document.createElement('div');
    bottomWrap.className = 'oni-bottom-wrap';
    shell.appendChild(bottomWrap);

    // 6. Classic Windows Status Bar at very bottom
    const statusBar = document.createElement('div');
    statusBar.className = 'oni-statusbar';
    statusBar.innerHTML = `
      <span id="oni-status-left">Готово. Правая кнопка мыши (ПКМ) — контекстное меню, двойной клик по блоку — свойства, F3 — Симулятор.</span>
      <span id="oni-status-right">ЦПУ: ${this.project.controllerId} | Масштаб: 115%</span>
    `;
    shell.appendChild(statusBar);
    this.statusLeftSpan = statusBar.querySelector('#oni-status-left')!;
    this.statusRightSpan = statusBar.querySelector('#oni-status-right')!;

    this.host.appendChild(shell);

    // Instantiate sub-views
    this.fbdCanvas = new FbdSchematicCanvas(fbdPane, this.project, this.sim, {
      onProjectMutated: (reason) => this.onProjectMutated(reason),
      onSelectionChanged: (ids) => {
        if (ids.length === 1) {
          const blk = this.project.blocks.find((b) => b.id === ids[0]);
          const def = blk ? BLOCK_DEF_MAP[blk.type] : undefined;
          if (blk && def) {
            this.statusLeftSpan.textContent = `Выбран ${formatBlockHeaderLabel(def, blk.channelIndex, blk.customName)}: ${def.nameRu} — Двойной клик для настройки параметров`;
          }
        }
      },
      onOpenBlockProperties: (blk) => this.editBlockProperties(blk),
      onOpenNoteEditor: (note) => openNoteEditorModal(note, () => {
        this.onProjectMutated('Изменена надпись');
        this.fbdCanvas.render();
      }),
      onContextMenu: (req) => this.showContextMenu(req),
      onQuickAnalogAdjust: (blk, cx, cy) => this.showQuickAnalogPopup(blk, cx, cy),
      onSimInputChanged: () => {
        if (this.sim.running) this.sim.step(this.project, 0);
        this.fbdCanvas.render();
        this.ldView.render();
        this.hmiView.refreshLiveValues();
        this.bottomDock.refreshLive();
      },
      onToolResetToSelect: () => this.highlightActiveToolButton('select'),
    });

    this.ldView = new LadderDiagramView(ldPane, this.project, this.sim, {
      onMutate: (reason) => this.onProjectMutated(reason),
      onSimToggleInput: (ch) => {
        this.sim.diState[ch] = !this.sim.diState[ch];
        this.sim.step(this.project, 0);
        this.ldView.render();
        this.bottomDock.refreshLive();
      },
    });

    this.hmiView = new HmiAndPlantWorkbench(hmiPane, this.project, this.sim, this.plant, {
      onMutate: (reason) => this.onProjectMutated(reason),
      onSimInputChanged: () => {
        if (this.sim.running) this.sim.step(this.project, 0);
        this.fbdCanvas.render();
        this.bottomDock.refreshLive();
      },
    });

    this.bottomDock = new BottomSimulatorDock(bottomWrap, this.project, this.sim, {
      onSimInputChanged: () => {
        if (this.sim.running) this.sim.step(this.project, 0);
        this.fbdCanvas.render();
        this.ldView.render();
        this.hmiView.refreshLiveValues();
      },
      onToggleSimulator: () => this.toggleSimulator(),
      onStepSingleScan: () => {
        if (!this.sim.running) this.sim.start(this.project);
        this.sim.paused = true;
        this.sim.step(this.project, 0.1);
        this.fbdCanvas.render();
        this.ldView.render();
        this.hmiView.refreshLiveValues();
        this.bottomDock.refreshLive();
      },
      onOpenAnalogSetup: () =>
        openAnalogSensorsAndCalcModal(this.project, () => {
          this.onProjectMutated('Обновлены шкалы датчиков');
          this.fbdCanvas.render();
          this.bottomDock.render();
        }),
    });

    requestAnimationFrame(() => {
      this.fbdCanvas.resize();
      this.updateHeaderAndStatus('Среда ONI PLR Studio готова к работе');
    });

    // Android hardware back key hook so pressing Back closes modals/menus instead of killing unsaved work!
    window.__oniHandleBackKey = () => {
      const openModal = document.querySelector('.oni-modal-backdrop');
      if (openModal) {
        openModal.remove();
        return true;
      }
      const openCtx = document.querySelector('.oni-context-menu');
      if (openCtx) {
        openCtx.remove();
        return true;
      }
      if (this.sim.running) {
        this.toggleSimulator();
        return true;
      }
      return false;
    };
  }

  private switchWorkspaceTab(tab: 'fbd' | 'ld' | 'hmi') {
    this.activeWorkspaceTab = tab;
    this.host.querySelectorAll<HTMLElement>('[data-wtab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.wtab === tab);
    });
    this.host.querySelectorAll<HTMLElement>('[data-wpane]').forEach((p) => {
      p.classList.toggle('active', p.dataset.wpane === tab);
    });
    if (tab === 'fbd') {
      requestAnimationFrame(() => this.fbdCanvas.resize());
    } else if (tab === 'ld') {
      this.ldView.render();
    } else {
      this.hmiView.render();
    }
  }

  private buildMenuBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'oni-menubar';

    const menus: { label: string; items: { text: string; shortcut?: string; sep?: boolean; action?: () => void }[] }[] = [
      {
        label: 'Файл',
        items: [
          { text: 'Новый проект FBD', shortcut: 'Ctrl+N', action: () => this.createNewBlankProject() },
          { text: 'Открыть файл (.oni.json / .xlg)...', shortcut: 'Ctrl+O', action: () => this.fileInput.click() },
          { text: 'Сохранить проект (.oni.json)', shortcut: 'Ctrl+S', action: () => this.exportProjectFile('json') },
          { text: 'Экспорт совместимого проекта (.xlg)', action: () => this.exportProjectFile('xlg') },
          { text: 'Экспорт чертежа схемы в SVG (ГОСТ рамка)', action: () => this.exportProjectFile('svg') },
          { text: '', sep: true },
          ...ONI_EXAMPLE_PROJECTS.map((ex) => ({
            text: `Пример: ${ex.title}`,
            action: () => this.loadExampleProject(ex.id),
          })),
        ],
      },
      {
        label: 'Изменить',
        items: [
          { text: 'Отменить', shortcut: 'Ctrl+Z', action: () => this.undo() },
          { text: 'Повторить', shortcut: 'Ctrl+Y', action: () => this.redo() },
          { text: '', sep: true },
          { text: 'Копировать выбранные блоки', shortcut: 'Ctrl+C', action: () => this.copySelection() },
          { text: 'Вставить блоки', shortcut: 'Ctrl+V', action: () => this.pasteSelection() },
          { text: 'Дублировать', shortcut: 'Ctrl+D', action: () => { this.copySelection(); this.pasteSelection(); } },
          { text: 'Выделить все блоки', shortcut: 'Ctrl+A', action: () => this.selectAllBlocks() },
          { text: 'Удалить выбранное', shortcut: 'Del', action: () => this.fbdCanvas.deleteSelection() },
        ],
      },
      {
        label: 'Инструменты',
        items: [
          { text: 'Запустить / Остановить симулятор', shortcut: 'F3', action: () => this.toggleSimulator() },
          { text: 'Проверка схемы и компиляция (ERC)', shortcut: 'F7', action: () => this.runErcCheckToast() },
          { text: '', sep: true },
          { text: 'Выбор оборудования (Модель ЦПУ ONI PLR-S)...', action: () => this.openHwModal() },
          { text: 'Настройка датчиков 4–20 мА / Pt100 и Калькулятор...', action: () => this.openAnalogModal() },
          { text: 'Переименовать проект...', action: () => this.renameProjectPrompt() },
        ],
      },
      {
        label: 'Вид',
        items: [
          { text: 'Показать / скрыть «Библиотека блоков»', action: () => this.toggleLeftLibrary() },
          { text: 'Показать / скрыть сетку редактора', action: () => { this.fbdCanvas.showGrid = !this.fbdCanvas.showGrid; this.fbdCanvas.render(); } },
          { text: 'Показать / скрыть адреса Modbus под блоками', action: () => { this.fbdCanvas.showModbusAddresses = !this.fbdCanvas.showModbusAddresses; this.fbdCanvas.render(); } },
          { text: '', sep: true },
          { text: 'Увеличить масштаб (+)', shortcut: 'Ctrl++', action: () => this.fbdCanvas.setZoom(this.fbdCanvas.zoom * 1.15) },
          { text: 'Уменьшить масштаб (−)', shortcut: 'Ctrl+-', action: () => this.fbdCanvas.setZoom(this.fbdCanvas.zoom / 1.15) },
          { text: 'Масштаб 100%', shortcut: 'Ctrl+0', action: () => this.fbdCanvas.setZoom(1.0) },
          { text: 'Вписать всю схему в экран', action: () => this.fbdCanvas.fitToContent() },
          { text: 'Полноэкранный режим планшета', shortcut: 'F11', action: () => this.toggleFullscreen() },
        ],
      },
      {
        label: 'Обучение КИПиА',
        items: [
          { text: '🎓 Практикум КИПовца (10 задач с автопроверкой)', action: () => this.showPracticeModal() },
          { text: '📖 Справочник всех функциональных блоков ONI', shortcut: 'F1', action: () => openReferenceModal() },
          { text: '🧮 Калькулятор токовой петли 4–20 мА и AMP', action: () => this.openAnalogModal() },
          { text: '🏭 Открыть виртуальный стенд объектов КИПиА', action: () => this.switchWorkspaceTab('hmi') },
          { text: '╟─╢ Открыть тренажёр релейно-контактных схем (LD)', action: () => this.switchWorkspaceTab('ld') },
        ],
      },
      {
        label: 'Справка',
        items: [
          { text: 'Управление мышью, клавиатурой и тачем на планшете', action: () => this.showShortcutsHelpModal() },
          { text: 'О программе ONI PLR Studio Android', action: () => this.showAboutModal() },
        ],
      },
    ];

    let openDropdown: HTMLElement | null = null;
    const closeAllMenus = () => {
      bar.querySelectorAll('.oni-menu-dropdown').forEach((d) => d.remove());
      bar.querySelectorAll('.oni-menu-root-btn').forEach((b) => b.classList.remove('open'));
      openDropdown = null;
    };
    window.addEventListener('pointerdown', (e) => {
      if (openDropdown && !bar.contains(e.target as Node)) closeAllMenus();
    });

    menus.forEach((m) => {
      const wrap = document.createElement('div');
      wrap.className = 'oni-menu-item-wrap';
      const btn = document.createElement('button');
      btn.className = 'oni-menu-root-btn';
      btn.textContent = m.label;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const alreadyOpen = btn.classList.contains('open');
        closeAllMenus();
        if (alreadyOpen) return;

        btn.classList.add('open');
        const dd = document.createElement('div');
        dd.className = 'oni-menu-dropdown';
        m.items.forEach((item) => {
          if (item.sep) {
            const hr = document.createElement('div');
            hr.className = 'oni-menu-sep';
            dd.appendChild(hr);
            return;
          }
          const row = document.createElement('button');
          row.className = 'oni-menu-dd-row';
          row.innerHTML = `<span>${esc(item.text)}</span>${item.shortcut ? `<kbd>${item.shortcut}</kbd>` : ''}`;
          row.addEventListener('click', () => {
            closeAllMenus();
            item.action?.();
          });
          dd.appendChild(row);
        });
        wrap.appendChild(dd);
        openDropdown = dd;
      });
      wrap.appendChild(btn);
      bar.appendChild(wrap);
    });

    return bar;
  }

  private buildTopToolbar(): HTMLElement {
    const tb = document.createElement('div');
    tb.className = 'oni-top-toolbar';
    tb.innerHTML = `
      <button class="oni-tb-btn" data-act="new" title="Новый проект (Ctrl+N)">📄 Новый</button>
      <button class="oni-tb-btn" data-act="open" title="Открыть .oni.json / .xlg (Ctrl+O)">📂 Открыть</button>
      <button class="oni-tb-btn" data-act="save" title="Сохранить проект на планшет (Ctrl+S)">💾 Сохранить</button>
      <div class="oni-tb-sep"></div>
      <button class="oni-tb-btn" data-act="undo" title="Отменить (Ctrl+Z)">↩</button>
      <button class="oni-tb-btn" data-act="redo" title="Повторить (Ctrl+Y)">↪</button>
      <button class="oni-tb-btn" data-act="copy" title="Копировать (Ctrl+C)">📋</button>
      <button class="oni-tb-btn" data-act="paste" title="Вставить (Ctrl+V)">📥</button>
      <button class="oni-tb-btn" data-act="del" title="Удалить выбранное (Delete)">🗑</button>
      <div class="oni-tb-sep"></div>
      <button class="oni-tb-btn" data-act="zin" title="Приблизить">🔍+</button>
      <button class="oni-tb-btn" data-act="zout" title="Отдалить">🔍−</button>
      <button class="oni-tb-btn" data-act="zfit" title="Вписать схему">⊞ Вписать</button>
      <div class="oni-tb-sep"></div>
      <button class="oni-tb-btn" data-act="hw" title="Выбор модели реле ONI PLR-S и модулей КИПиА">🎛 ЦПУ</button>
      <button class="oni-tb-btn" data-act="ai_calc" title="Шкалы 4–20 мА и инженерный калькулятор">📐 4–20 мА</button>
      <button class="oni-tb-btn" data-act="erc" title="Проверить схему на ошибки (F7)">✔ Проверка</button>
      <button class="oni-tb-btn sim-main-btn" id="tb-sim-btn" title="Офлайн-симулятор ONI PLR Studio (F3)">▶ Симулятор (F3)</button>
      <div class="oni-tb-sep"></div>
      <select id="tb-examples-select" class="oni-tb-select" title="Быстрая загрузка готового примера КИПиА">
        <option value="">⚡ Готовые схемы КИПиА...</option>
        ${ONI_EXAMPLE_PROJECTS.map((ex) => `<option value="${ex.id}">${esc(ex.title)}</option>`).join('')}
      </select>
    `;

    this.simToolbarBtn = tb.querySelector('#tb-sim-btn')!;
    this.simToolbarBtn.addEventListener('click', () => this.toggleSimulator());

    tb.querySelector('[data-act="new"]')?.addEventListener('click', () => this.createNewBlankProject());
    tb.querySelector('[data-act="open"]')?.addEventListener('click', () => this.fileInput.click());
    tb.querySelector('[data-act="save"]')?.addEventListener('click', () => this.exportProjectFile('json'));
    tb.querySelector('[data-act="undo"]')?.addEventListener('click', () => this.undo());
    tb.querySelector('[data-act="redo"]')?.addEventListener('click', () => this.redo());
    tb.querySelector('[data-act="copy"]')?.addEventListener('click', () => this.copySelection());
    tb.querySelector('[data-act="paste"]')?.addEventListener('click', () => this.pasteSelection());
    tb.querySelector('[data-act="del"]')?.addEventListener('click', () => this.fbdCanvas.deleteSelection());
    tb.querySelector('[data-act="zin"]')?.addEventListener('click', () => this.fbdCanvas.setZoom(this.fbdCanvas.zoom * 1.15));
    tb.querySelector('[data-act="zout"]')?.addEventListener('click', () => this.fbdCanvas.setZoom(this.fbdCanvas.zoom / 1.15));
    tb.querySelector('[data-act="zfit"]')?.addEventListener('click', () => this.fbdCanvas.fitToContent());
    tb.querySelector('[data-act="hw"]')?.addEventListener('click', () => this.openHwModal());
    tb.querySelector('[data-act="ai_calc"]')?.addEventListener('click', () => this.openAnalogModal());
    tb.querySelector('[data-act="erc"]')?.addEventListener('click', () => this.runErcCheckToast());

    const exSel = tb.querySelector<HTMLSelectElement>('#tb-examples-select')!;
    exSel.addEventListener('change', () => {
      if (exSel.value) {
        this.loadExampleProject(exSel.value);
        exSel.value = '';
      }
    });

    return tb;
  }

  private buildLeftQuickToolStrip(): HTMLElement {
    // Authentic vertical editor strip from ONI PLR Studio (Slide 1 bottom-right!)
    const strip = document.createElement('div');
    strip.className = 'oni-left-strip';
    strip.innerHTML = `
      <button class="oni-strip-btn" data-strip="lib" title="Показать/скрыть дерево «Библиотека блоков»">☰</button>
      <button class="oni-strip-btn active" data-tool="select" title="Курсор: выделение и перемещение (Esc)">↖</button>
      <button class="oni-strip-btn" data-tool="wire" title="Соединение: связь выходов со входами">┼</button>
      <button class="oni-strip-btn badge-co" data-quick="Co" title="Входы / Выходы / Флаги (Co)">Co</button>
      <button class="oni-strip-btn badge-gf" data-quick="GF" title="Логические функции (GF)">GF</button>
      <button class="oni-strip-btn badge-sf" data-quick="SF" title="Специальные функции: таймеры, счётчики, триггеры (SF)">SF</button>
      <button class="oni-strip-btn badge-af" data-quick="AF" title="Аналоговые функции КИПиА: компаратор, ПИД, масштаб (AF)">AF</button>
      <button class="oni-strip-btn" data-tool="note" title="Текстовая надпись на схеме (A)" style="font-family:Georgia,serif;font-weight:bold">A</button>
      <button class="oni-strip-btn" data-tool="scissors" title="Разрыв / адресная ссылка на длинном проводе (✂)">✂</button>
      <button class="oni-strip-btn sim-bug" data-strip="sim" title="Запустить / остановить симулятор (F3)">🐞</button>
    `;

    strip.querySelector('[data-strip="lib"]')?.addEventListener('click', () => this.toggleLeftLibrary());
    strip.querySelector('[data-strip="sim"]')?.addEventListener('click', () => this.toggleSimulator());

    strip.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const t = btn.dataset.tool as 'select' | 'wire' | 'note' | 'scissors';
        this.fbdCanvas.toolMode = t;
        this.fbdCanvas.pendingBlockType = null;
        this.highlightActiveToolButton(t);
        this.switchWorkspaceTab('fbd');
      });
    });

    strip.querySelectorAll<HTMLButtonElement>('[data-quick]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const grp = btn.dataset.quick as 'Co' | 'GF' | 'SF' | 'AF';
        this.openQuickGroupPalette(grp, e.clientX + 16, e.clientY);
      });
    });

    return strip;
  }

  private highlightActiveToolButton(tool: string) {
    this.host.querySelectorAll<HTMLElement>('.oni-strip-btn[data-tool]').forEach((b) => {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    this.host.querySelectorAll<HTMLElement>('.oni-lib-item').forEach((item) => {
      item.classList.toggle('armed', item.dataset.btype === this.fbdCanvas?.pendingBlockType);
    });
  }

  private openQuickGroupPalette(group: 'Co' | 'GF' | 'SF' | 'AF', clientX: number, clientY: number) {
    document.querySelectorAll('.oni-context-menu').forEach((m) => m.remove());
    const menu = document.createElement('div');
    menu.className = 'oni-context-menu';
    menu.style.left = `${Math.min(window.innerWidth - 250, clientX)}px`;
    menu.style.top = `${Math.min(window.innerHeight - 340, clientY)}px`;

    const blocks = ONI_BLOCK_LIBRARY.filter((b) => b.toolbarGroup === group);
    menu.innerHTML = `<div class="ctx-hdr">Быстрый выбор (${group}):</div>`;
    blocks.forEach((b) => {
      const row = document.createElement('button');
      row.className = 'ctx-item';
      row.innerHTML = `<span class="mini-blk-badge ${b.colorKind}">${b.codeLabel}</span> <span>${esc(b.nameRu)}</span>`;
      row.addEventListener('click', () => {
        menu.remove();
        this.armBlockPlacement(b.type);
      });
      menu.appendChild(row);
    });
    document.body.appendChild(menu);
    const dismiss = (ev: PointerEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        window.removeEventListener('pointerdown', dismiss);
      }
    };
    setTimeout(() => window.addEventListener('pointerdown', dismiss), 10);
  }

  private populateLibraryTree(container: HTMLElement) {
    container.innerHTML = `
      <div class="oni-lib-header">
        <span>Библиотека блоков</span>
        <button class="oni-lib-close" title="Скрыть панель">✕</button>
      </div>
      <div class="oni-lib-search-wrap">
        <input type="text" id="oni-lib-search" placeholder="Поиск блока (RS, TON, PI, AI...)" value="${esc(this.libraryFilter)}" />
      </div>
      <div class="oni-lib-tree" id="oni-lib-tree"></div>
    `;

    container.querySelector('.oni-lib-close')?.addEventListener('click', () => this.toggleLeftLibrary());
    const searchInput = container.querySelector<HTMLInputElement>('#oni-lib-search')!;
    searchInput.addEventListener('input', () => {
      this.libraryFilter = searchInput.value.trim().toLowerCase();
      this.renderLibraryTreeItems(container.querySelector('#oni-lib-tree')!);
    });

    this.renderLibraryTreeItems(container.querySelector('#oni-lib-tree')!);
  }

  private renderLibraryTreeItems(treeEl: HTMLElement) {
    treeEl.innerHTML = '';
    const q = this.libraryFilter;

    BLOCK_CATEGORIES.forEach((cat) => {
      const items = ONI_BLOCK_LIBRARY.filter(
        (b) =>
          b.category === cat.id &&
          (!q ||
            b.nameRu.toLowerCase().includes(q) ||
            b.type.toLowerCase().includes(q) ||
            b.codeLabel.toLowerCase().includes(q) ||
            b.shortDesc.toLowerCase().includes(q))
      );
      if (items.length === 0) return;

      const isCollapsed = !q && this.collapsedCategories.has(cat.id);
      const folderHdr = document.createElement('button');
      folderHdr.className = 'oni-lib-folder';
      folderHdr.innerHTML = `<span>${isCollapsed ? '▸' : '▾'} 📁 ${esc(cat.nameRu)}</span>`;
      folderHdr.addEventListener('click', () => {
        if (this.collapsedCategories.has(cat.id)) this.collapsedCategories.delete(cat.id);
        else this.collapsedCategories.add(cat.id);
        this.renderLibraryTreeItems(treeEl);
      });
      treeEl.appendChild(folderHdr);

      if (isCollapsed) return;

      const listWrap = document.createElement('div');
      listWrap.className = 'oni-lib-folder-items';
      items.forEach((b) => {
        const btn = document.createElement('div');
        btn.className = `oni-lib-item ${this.fbdCanvas?.pendingBlockType === b.type ? 'armed' : ''}`;
        btn.dataset.btype = b.type;
        btn.draggable = true;
        btn.title = `${b.nameRu}: ${b.shortDesc}\nКликните и щёлкните на поле схемы (или перетащите мышью)!`;
        btn.innerHTML = `
          <span class="mini-blk-badge ${b.colorKind}">${b.codeLabel}</span>
          <span class="lib-item-label">${esc(b.nameRu)}</span>
        `;
        btn.addEventListener('click', () => this.armBlockPlacement(b.type));
        btn.addEventListener('dragstart', (ev) => {
          ev.dataTransfer?.setData('application/x-oni-block', b.type);
        });
        listWrap.appendChild(btn);
      });
      treeEl.appendChild(listWrap);
    });
  }

  private armBlockPlacement(blockType: string) {
    if (this.sim.running) {
      this.toast('Остановите симулятор (F3), чтобы добавлять блоки в схему.');
      return;
    }
    this.switchWorkspaceTab('fbd');
    this.fbdCanvas.toolMode = 'place_block';
    this.fbdCanvas.pendingBlockType = blockType;
    this.highlightActiveToolButton('place_block');
    const def = BLOCK_DEF_MAP[blockType];
    this.statusLeftSpan.textContent = `Режим установки «${def?.nameRu || blockType}»: щёлкните левой кнопкой мыши на рабочем поле (ПКМ или Esc — отмена).`;
  }

  private toggleLeftLibrary() {
    this.showLeftLibrary = !this.showLeftLibrary;
    const dock = this.host.querySelector<HTMLElement>('#oni-library-dock');
    if (dock) dock.style.display = this.showLeftLibrary ? 'flex' : 'none';
    this.fbdCanvas.resize();
  }

  public toggleSimulator() {
    if (this.sim.running) {
      this.sim.stop();
      this.statusLeftSpan.textContent = 'Симулятор остановлен. Режим редактирования схемы.';
    } else {
      this.fbdCanvas.toolMode = 'select';
      this.fbdCanvas.pendingBlockType = null;
      this.highlightActiveToolButton('select');
      if (this.project.activePlant !== 'none') {
        this.plant.linkedToPlc = true;
      }
      this.sim.start(this.project);
      this.statusLeftSpan.textContent =
        'Симулятор ЗАПУЩЕН (F3): щёлкайте по входам I001.. на схеме или внизу! Красный = ON (1), Синий = OFF (0).';
    }
    this.simToolbarBtn.classList.toggle('active-sim', this.sim.running);
    this.simToolbarBtn.textContent = this.sim.running ? '■ Стоп симулятора (F3)' : '▶ Симулятор (F3)';
    this.fbdCanvas.render();
    this.ldView.render();
    this.hmiView.render();
    this.bottomDock.render();
  }

  private startSimulationLoop() {
    this.lastTickMs = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, Math.max(0.01, (now - this.lastTickMs) / 1000));
      this.lastTickMs = now;
      if (this.sim.running && !this.sim.paused) {
        this.plant.step(this.project, this.sim, dt);
        this.sim.step(this.project, dt);
        if (this.activeWorkspaceTab === 'fbd') this.fbdCanvas.render();
        else if (this.activeWorkspaceTab === 'ld') this.ldView.render();
        else if (this.activeWorkspaceTab === 'hmi') this.hmiView.refreshLiveValues();
        this.bottomDock.refreshLive();
      }
      this.simTimerId = window.requestAnimationFrame(tick);
    };
    this.simTimerId = window.requestAnimationFrame(tick);
  }

  private showContextMenu(req: ContextMenuRequest) {
    document.querySelectorAll('.oni-context-menu').forEach((m) => m.remove());
    const menu = document.createElement('div');
    menu.className = 'oni-context-menu';
    menu.style.left = `${Math.min(window.innerWidth - 260, req.clientX)}px`;
    menu.style.top = `${Math.min(window.innerHeight - 280, req.clientY)}px`;

    const addItem = (label: string, fn: () => void, danger = false) => {
      const b = document.createElement('button');
      b.className = `ctx-item ${danger ? 'danger' : ''}`;
      b.textContent = label;
      b.addEventListener('click', () => {
        menu.remove();
        fn();
      });
      menu.appendChild(b);
    };

    if (req.targetPin && req.targetPin.side === 'in' && !this.sim.running) {
      const p = req.targetPin;
      if (p.pin.invertible) {
        addItem(`○ Инвертировать вход ${p.pin.label} (НЕ)`, () => {
          p.block.invertedInputs[p.pin.id] = !p.block.invertedInputs[p.pin.id];
          this.onProjectMutated('Инверсия входа');
          this.fbdCanvas.render();
        });
      }
      addItem('✂ Отсоединить провод от этого входа', () => {
        this.project.wires = this.project.wires.filter(
          (w) => !(w.toBlockId === p.block.id && w.toPinId === p.pin.id)
        );
        this.onProjectMutated('Удалено соединение входа');
        this.fbdCanvas.render();
      }, true);
    } else if (req.targetBlock) {
      const blk = req.targetBlock;
      const def = BLOCK_DEF_MAP[blk.type];
      addItem(`⚙ Свойства блока ${def ? formatBlockHeaderLabel(def, blk.channelIndex, blk.customName) : ''}...`, () =>
        this.editBlockProperties(blk)
      );
      addItem('📖 Справка по этому блоку (F1)', () => openReferenceModal(blk.type));
      if (!this.sim.running) {
        addItem('📋 Дублировать блок (Ctrl+D)', () => {
          this.copySelection();
          this.pasteSelection();
        });
        addItem('✂ Отсоединить все связи блока', () => {
          this.project.wires = this.project.wires.filter(
            (w) => w.fromBlockId !== blk.id && w.toBlockId !== blk.id
          );
          this.onProjectMutated('Отсоединены связи блока');
          this.fbdCanvas.render();
        });
        addItem('🗑 Удалить блок (Del)', () => this.fbdCanvas.deleteSelection(), true);
      }
    } else if (req.targetWire && !this.sim.running) {
      const w = req.targetWire;
      addItem(w.splitMode ? '🔗 Сшить разрыв обратно в провод' : '✂ Разрезать провод в адресную ссылку', () => {
        w.splitMode = !w.splitMode;
        this.onProjectMutated('Изменён вид линии связи');
        this.fbdCanvas.render();
      });
      addItem('🗑 Удалить соединение', () => {
        this.project.wires = this.project.wires.filter((item) => item.id !== w.id);
        this.onProjectMutated('Удалено соединение');
        this.fbdCanvas.render();
      }, true);
    } else if (req.targetNote && !this.sim.running) {
      const n = req.targetNote;
      addItem('✎ Изменить текст надписи...', () =>
        openNoteEditorModal(n, () => {
          this.onProjectMutated('Изменена надпись');
          this.fbdCanvas.render();
        })
      );
      addItem('🗑 Удалить надпись', () => {
        this.project.notes = this.project.notes.filter((x) => x.id !== n.id);
        this.onProjectMutated('Удалена надпись');
        this.fbdCanvas.render();
      }, true);
    } else {
      if (!this.sim.running) {
        addItem('+ Цифровой вход (DI)', () => this.fbdCanvas.placeNewBlockAt('DI', req.worldX, req.worldY));
        addItem('+ Цифровой выход (DO)', () => this.fbdCanvas.placeNewBlockAt('DO', req.worldX, req.worldY));
        addItem('+ RS-триггер (память Пуск/Стоп)', () => this.fbdCanvas.placeNewBlockAt('RS', req.worldX, req.worldY));
        addItem('+ Таймер задержки вкл. (TON)', () => this.fbdCanvas.placeNewBlockAt('TON', req.worldX, req.worldY));
        addItem('+ Логика И (AND)', () => this.fbdCanvas.placeNewBlockAt('AND', req.worldX, req.worldY));
        addItem('+ Логика ИЛИ (OR)', () => this.fbdCanvas.placeNewBlockAt('OR', req.worldX, req.worldY));
        addItem('+ Текстовая надпись на схеме', () => {
          this.project.notes.push({ id: `n_${Date.now()}`, x: Math.round(req.worldX), y: Math.round(req.worldY), text: 'Комментарий' });
          this.onProjectMutated('Добавлена надпись');
          this.fbdCanvas.render();
        });
        if (this.clipboardBlocks.length > 0) {
          addItem('📥 Вставить скопированное (Ctrl+V)', () => this.pasteSelection());
        }
      }
      addItem('⊞ Центрировать и вписать схему', () => this.fbdCanvas.fitToContent());
      addItem(this.sim.running ? '■ Остановить симулятор (F3)' : '▶ Запустить симулятор (F3)', () => this.toggleSimulator());
    }

    document.body.appendChild(menu);
    const dismiss = (ev: PointerEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        window.removeEventListener('pointerdown', dismiss);
      }
    };
    setTimeout(() => window.addEventListener('pointerdown', dismiss), 10);
  }

  private showQuickAnalogPopup(blk: BlockInstance, clientX: number, clientY: number) {
    document.querySelectorAll('.oni-context-menu').forEach((m) => m.remove());
    const ch = blk.channelIndex;
    const cfg = this.project.analogConfigs.find((c) => c.channel === ch) || defaultAnalogConfigs()[0];

    const pop = document.createElement('div');
    pop.className = 'oni-context-menu';
    pop.style.left = `${Math.min(window.innerWidth - 280, clientX + 10)}px`;
    pop.style.top = `${Math.min(window.innerHeight - 150, clientY + 10)}px`;
    pop.style.padding = '8px 10px';
    pop.style.width = '260px';

    pop.innerHTML = `
      <div style="font-weight:bold;font-size:12px;margin-bottom:6px">Сигнал AI${ch} (${esc(cfg.tag)})</div>
      <input type="range" min="0" max="1050" step="5" value="${this.sim.aiRaw[ch] ?? 200}" id="qa-rng" style="width:100%" />
      <div id="qa-lbl" style="font-size:11px;margin:4px 0">Код: ${this.sim.aiRaw[ch] ?? 200}</div>
      <div style="display:flex;gap:4px;margin-top:4px">
        <button class="oni-win-btn-sm" id="qa-brk">Обрыв (0 мА)</button>
        <button class="oni-win-btn-sm" id="qa-4ma">4 мА (0%)</button>
        <button class="oni-win-btn-sm" id="qa-20ma">20 мА (100%)</button>
      </div>
    `;
    document.body.appendChild(pop);

    const rng = pop.querySelector<HTMLInputElement>('#qa-rng')!;
    const lbl = pop.querySelector<HTMLElement>('#qa-lbl')!;
    const syncVal = (v: number) => {
      this.sim.aiRaw[ch] = v;
      rng.value = String(v);
      const ma = ((v / 1000) * 20).toFixed(2);
      lbl.textContent = `Код АЦП: ${v} (${ma} мА)`;
      this.sim.step(this.project, 0);
      this.fbdCanvas.render();
      this.bottomDock.refreshLive();
    };
    rng.addEventListener('input', () => syncVal(Number(rng.value)));
    pop.querySelector('#qa-brk')?.addEventListener('click', () => syncVal(15));
    pop.querySelector('#qa-4ma')?.addEventListener('click', () => syncVal(200));
    pop.querySelector('#qa-20ma')?.addEventListener('click', () => syncVal(1000));

    const dismiss = (ev: PointerEvent) => {
      if (!pop.contains(ev.target as Node)) {
        pop.remove();
        window.removeEventListener('pointerdown', dismiss);
      }
    };
    setTimeout(() => window.addEventListener('pointerdown', dismiss), 10);
  }

  private editBlockProperties(blk: BlockInstance) {
    openBlockPropertiesModal(
      blk,
      this.project,
      () => {
        this.onProjectMutated('Обновлены параметры блока');
        this.fbdCanvas.render();
      },
      (bType) => openReferenceModal(bType)
    );
  }

  private copySelection() {
    this.clipboardBlocks = this.project.blocks
      .filter((b) => this.fbdCanvas.selectedBlockIds.has(b.id))
      .map((b) => JSON.parse(JSON.stringify(b)) as BlockInstance);
    if (this.clipboardBlocks.length > 0) {
      this.toast(`Скопировано блоков: ${this.clipboardBlocks.length}`);
    }
  }

  private pasteSelection() {
    if (this.sim.running || this.clipboardBlocks.length === 0) return;
    this.fbdCanvas.selectedBlockIds.clear();
    for (const orig of this.clipboardBlocks) {
      const created = this.fbdCanvas.placeNewBlockAt(orig.type, orig.x + 40, orig.y + 40);
      if (created) {
        created.params = JSON.parse(JSON.stringify(orig.params));
        created.invertedInputs = JSON.parse(JSON.stringify(orig.invertedInputs || {}));
        created.customName = orig.customName;
        this.fbdCanvas.selectedBlockIds.add(created.id);
      }
    }
    this.fbdCanvas.render();
  }

  private selectAllBlocks() {
    this.fbdCanvas.selectedBlockIds.clear();
    for (const b of this.project.blocks) this.fbdCanvas.selectedBlockIds.add(b.id);
    this.fbdCanvas.render();
  }

  private createNewBlankProject() {
    if (this.sim.running) this.sim.stop();
    this.project = {
      version: '1.0.0',
      name: 'Новый проект КИПиА',
      author: 'Инженер КИПиА',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      controllerId: 'PLR-S-CPU-1206',
      expansionIds: [],
      activeLanguage: 'FBD',
      blocks: [],
      wires: [],
      notes: [],
      analogConfigs: defaultAnalogConfigs(),
      ldRungs: [],
      hmiWidgets: [],
      activePlant: 'none',
    };
    this.pushUndoSnapshot();
    this.syncAllViews('Создан чистый проект FBD');
  }

  private loadExampleProject(exampleId: string) {
    const ex = ONI_EXAMPLE_PROJECTS.find((e) => e.id === exampleId);
    if (!ex) return;
    if (this.sim.running) this.sim.stop();
    this.simToolbarBtn.classList.remove('active-sim');
    this.simToolbarBtn.textContent = '▶ Симулятор (F3)';
    this.project = ex.build();
    this.plant.reset();
    this.plant.linkedToPlc = this.project.activePlant !== 'none';
    this.pushUndoSnapshot();
    this.syncAllViews(`Загружен пример: ${ex.title}`);
    this.switchWorkspaceTab('fbd');
    this.fbdCanvas.fitToContent();
  }

  private handleFileImport() {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (this.sim.running) this.sim.stop();
        const buf = reader.result as ArrayBuffer;
        this.project = importXlgBinaryOrJson(buf, file.name);
        this.pushUndoSnapshot();
        this.syncAllViews(`Открыт файл: ${file.name}`);
        this.fbdCanvas.fitToContent();
        this.toast(`Проект «${this.project.name}» успешно открыт!`);
      } catch (err) {
        this.toast(`Ошибка чтения файла: ${(err as Error).message}`);
      }
    };
    reader.readAsArrayBuffer(file);
    this.fileInput.value = '';
  }

  private exportProjectFile(kind: 'json' | 'xlg' | 'svg') {
    const safeName = this.project.name.replace(/[^\wа-яА-ЯёЁ0-9_-]+/g, '_') || 'oni_project';
    let filename = `${safeName}.oni.json`;
    let mime = 'application/json';
    let content = '';

    if (kind === 'json') {
      content = serializeProjectJson(this.project);
    } else if (kind === 'xlg') {
      filename = `${safeName}.xlg`;
      mime = 'application/octet-stream';
      content = `ONI_PLR_STUDIO_3.5.6.1\n${this.project.controllerId}\n__ONI_STUDIO_JSON__:${serializeProjectJson(this.project)}`;
    } else {
      filename = `${safeName}.svg`;
      mime = 'image/svg+xml';
      content = exportProjectToSvg(this.project);
    }

    // Use native Android Storage Access Framework if running inside our Android APK!
    if (window.OniAndroid && typeof window.OniAndroid.saveFile === 'function') {
      window.OniAndroid.saveFile(filename, mime, content, false);
      return;
    }

    // Browser download fallback
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    this.toast(`Файл ${filename} сохранён.`);
  }

  private openHwModal() {
    openHardwareConfigModal(this.project, () => {
      this.onProjectMutated(`Выбрано оборудование ${this.project.controllerId}`);
      this.syncAllViews();
    });
  }

  private openAnalogModal() {
    openAnalogSensorsAndCalcModal(this.project, () => {
      this.onProjectMutated('Обновлены настройки датчиков КИПиА');
      this.fbdCanvas.render();
      this.bottomDock.render();
    });
  }

  private showPracticeModal() {
    openPracticeTasksModal(
      () => this.project,
      (starter, task) => {
        if (this.sim.running) this.sim.stop();
        this.project = starter;
        this.pushUndoSnapshot();
        this.syncAllViews(`Загружены клеммы для задачи №${task.number}: ${task.title}`);
        this.switchWorkspaceTab('fbd');
        this.fbdCanvas.fitToContent();
      }
    );
  }

  private renameProjectPrompt() {
    const n = prompt('Введите название проекта КИПиА:', this.project.name);
    if (n && n.trim()) {
      this.project.name = n.trim();
      this.onProjectMutated('Переименован проект');
      this.syncAllViews();
    }
  }

  private runErcCheckToast() {
    const msgs = checkProjectErc(this.project);
    this.bottomDock.activeTab = 'erc_modbus';
    this.bottomDock.collapsed = false;
    this.bottomDock.render();
    const errs = msgs.filter((m) => m.severity === 'error');
    this.toast(errs.length === 0 ? `✔ Ошибок не обнаружено (${this.project.blocks.length} блоков)` : `⛔ Найдено ошибок: ${errs.length}`);
  }

  private toggleFullscreen() {
    if (window.OniAndroid && typeof window.OniAndroid.toggleFullscreen === 'function') {
      window.OniAndroid.toggleFullscreen();
      return;
    }
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  private showShortcutsHelpModal() {
    const overlay = document.createElement('div');
    overlay.className = 'oni-modal-backdrop';
    overlay.innerHTML = `
      <div class="oni-win-dialog" style="width:560px;max-width:95vw">
        <div class="oni-win-dialog-title">
          <span>Управление на планшете с клавиатурой, мышью и сенсорным экраном</span>
          <button class="oni-dlg-close">✕</button>
        </div>
        <div class="oni-win-dialog-body" style="font-size:12.5px;line-height:1.55">
          <ul style="margin:0;padding-left:18px">
            <li><b>Добавление блока:</b> выберите блок слева в «Библиотеке блоков» и щёлкните ЛКМ на схеме (либо перетащите блок мышью).</li>
            <li><b>Прокладка провода:</b> потяните мышью (или кликните по очереди) от выходной ножки справа к входной ножке слева.</li>
            <li><b>Инверсия входа (кружок НЕ ○):</b> двойной клик ЛКМ прямо по входной ножке блока (или через ПКМ → Инвертировать вход).</li>
            <li><b>Настройка таймеров / порогов / имён:</b> двойной клик по корпусу блока (или ПКМ → Свойства блока).</li>
            <li><b>Контекстное меню (как на Windows):</b> правая кнопка мыши (ПКМ) или долгое нажатие пальцем.</li>
            <li><b>Масштаб и панорамирование:</b> колесо мыши — зум; зажатый <code>Пробел + ЛКМ</code>, средняя кнопка мыши или два пальца — перемещение листа.</li>
            <li><b>Горячие клавиши:</b> <code>F3</code> Симулятор, <code>F1</code> Справочник, <code>Ctrl+Z / Ctrl+Y</code> Отмена/Повтор, <code>Ctrl+C / Ctrl+V / Ctrl+D</code> Копирование, <code>Delete</code> Удаление, <code>Ctrl+S</code> Сохранить, <code>Esc</code> Сброс инструмента.</li>
          </ul>
        </div>
        <div class="oni-win-dialog-footer">
          <button class="oni-win-btn primary" id="sh-ok">Понятно</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.oni-dlg-close')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#sh-ok')?.addEventListener('click', () => overlay.remove());
  }

  private showAboutModal() {
    const overlay = document.createElement('div');
    overlay.className = 'oni-modal-backdrop';
    overlay.innerHTML = `
      <div class="oni-win-dialog" style="width:480px;max-width:95vw">
        <div class="oni-win-dialog-title">
          <span>О программе ONI PLR Studio Android</span>
          <button class="oni-dlg-close">✕</button>
        </div>
        <div class="oni-win-dialog-body" style="font-size:12.5px;line-height:1.5">
          <p><b>ONI PLR Studio (Android КИПиА Edition) v1.0</b></p>
          <p>Автономная среда разработки, отладки и инженерного практикума по программируемым логическим реле <b>ONI PLR-S / PLR-M</b> и ПЛК <b>ONI</b> для планшетов и смартфонов Android (без эмуляторов Windows и без требования интернета).</p>
          <ul>
            <li>Полная библиотека 34 функциональных блоков FBD + офлайн-симулятор (F3)</li>
            <li>Релейно-контактные схемы LD (МЭК 61131-3) и панель HMI</li>
            <li>4 физических стенда объектов КИПиА (4–20 мА, Pt100, ПИД, АВР)</li>
            <li>10 практических задач КИПовца с автоматической проверкой</li>
          </ul>
        </div>
        <div class="oni-win-dialog-footer">
          <button class="oni-win-btn primary" id="ab-ok">ОК</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.oni-dlg-close')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#ab-ok')?.addEventListener('click', () => overlay.remove());
  }

  private bindGlobalShortcuts() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'F3') {
        e.preventDefault();
        this.toggleSimulator();
        return;
      }
      if (e.key === 'F1') {
        e.preventDefault();
        openReferenceModal();
        return;
      }
      if (e.key === 'F7') {
        e.preventDefault();
        this.runErcCheckToast();
        return;
      }
      if (inInput) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        this.redo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.exportProjectFile('json');
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        this.fileInput.click();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this.createNewBlankProject();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        this.copySelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        this.pasteSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        this.copySelection();
        this.pasteSelection();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        this.selectAllBlocks();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.fbdCanvas.deleteSelection();
      } else if (e.key === 'Enter' && this.fbdCanvas.selectedBlockIds.size === 1) {
        const id = [...this.fbdCanvas.selectedBlockIds][0];
        const blk = this.project.blocks.find((b) => b.id === id);
        if (blk) this.editBlockProperties(blk);
      }
    });
  }

  private updateHeaderAndStatus(msg?: string) {
    this.titleProjSpan.textContent = `ONI PLR Studio — ${this.project.name} [${this.project.controllerId}]`;
    const fbdTab = this.host.querySelector<HTMLElement>('[data-wtab="fbd"]');
    if (fbdTab) fbdTab.textContent = `▦ ${this.project.name} (FBD)`;
    if (msg) this.statusLeftSpan.textContent = msg;
    this.statusRightSpan.textContent = `ЦПУ: ${this.project.controllerId} | Блоков: ${this.project.blocks.length} | Масштаб: ${Math.round(
      this.fbdCanvas.zoom * 100
    )}%`;
  }

  private toast(msg: string) {
    this.statusLeftSpan.textContent = msg;
    if (window.OniAndroid && typeof window.OniAndroid.showToast === 'function') {
      window.OniAndroid.showToast(msg);
      return;
    }
    const t = document.createElement('div');
    t.className = 'oni-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
