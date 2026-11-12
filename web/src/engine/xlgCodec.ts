import { BLOCK_DEF_MAP, formatBlockHeaderLabel } from '../catalog/blocks';
import { BlockInstance, CanvasNote, OniProject, WireConnection } from '../types';

export function serializeProjectJson(project: OniProject): string {
  const payload: OniProject = {
    ...project,
    updatedAt: new Date().toISOString(),
  };
  return JSON.stringify(payload, null, 2);
}

export function parseProjectJson(text: string): OniProject {
  const obj = JSON.parse(text) as Partial<OniProject>;
  if (!obj || !Array.isArray(obj.blocks) || !Array.isArray(obj.wires)) {
    throw new Error('Некорректный формат файла проекта ONI.');
  }
  return {
    version: obj.version || '1.0.0',
    name: obj.name || 'Импортированный проект',
    author: obj.author || 'КИПиА',
    createdAt: obj.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    controllerId: obj.controllerId || 'PLR-S-CPU-1206',
    expansionIds: obj.expansionIds || [],
    activeLanguage: obj.activeLanguage || 'FBD',
    blocks: obj.blocks,
    wires: obj.wires,
    notes: obj.notes || [],
    analogConfigs: obj.analogConfigs || defaultAnalogConfigs(),
    ldRungs: obj.ldRungs || [],
    hmiWidgets: obj.hmiWidgets || [],
    activePlant: obj.activePlant || 'none',
  };
}

export function defaultAnalogConfigs() {
  return [
    { channel: 1, tag: 'PT101 / LT101 Основной датчик', standard: '4-20mA' as const, minEng: 0, maxEng: 100, unit: '%' },
    { channel: 2, tag: 'PT102 Давление / Уставка', standard: '4-20mA' as const, minEng: 0, maxEng: 10, unit: 'бар' },
    { channel: 3, tag: 'TT101 Температура канала', standard: 'Pt100' as const, minEng: -50, maxEng: 150, unit: '°C' },
    { channel: 4, tag: 'AI4 Универсальный 0..10В', standard: '0-10V' as const, minEng: 0, maxEng: 100, unit: '%' },
  ];
}

// Импорт бинарных файлов .xlg из настольной Windows-среды ONI PLR Studio (MFC CArchive)
// а также поддержка нашего гибридного контейнера .xlg (JSON-проект + совместимый штамп)
export function importXlgBinaryOrJson(buffer: ArrayBuffer, filename: string): OniProject {
  const bytes = new Uint8Array(buffer);
  const utf8Sample = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 256)).trim();
  if (utf8Sample.startsWith('{')) {
    const fullText = new TextDecoder('utf-8').decode(bytes);
    return parseProjectJson(fullText);
  }

  // Check if our embedded JSON trailer is present inside .xlg
  const latin = new TextDecoder('latin1').decode(bytes);
  const markerIdx = latin.indexOf('__ONI_STUDIO_JSON__:');
  if (markerIdx >= 0) {
    const jsonBytes = bytes.slice(markerIdx + '__ONI_STUDIO_JSON__:'.length);
    const jsonText = new TextDecoder('utf-8').decode(jsonBytes);
    return parseProjectJson(jsonText);
  }

  // Genuine desktop ONI PLR Studio MFC binary (.xlg): extract controller model, entities, coordinates & notes!
  const entityMap: Record<string, string> = {
    CInputEntity: 'DI',
    COutputEntity: 'DO',
    CFlagEntity: 'M',
    CAIEntity: 'AI',
    CAOEntity: 'AO',
    CAndEntity: 'AND',
    CNandEntity: 'NAND',
    COrEntity: 'OR',
    CNorEntity: 'NOR',
    CXorEntity: 'XOR',
    CNotEntity: 'NOT',
    CRSEntity: 'RS',
    CSREntity: 'SR',
    CTonEntity: 'TON',
    CTofEntity: 'TOF',
    CBlinkEntity: 'BLINK',
    CCounterEntity: 'CTUD',
    CCompEntity: 'CMP',
    CAmpEntity: 'AMP',
    CPIEntity: 'PI',
    CMsgEntity: 'MSG',
  };

  let controllerId = 'PLR-S-CPU-1410';
  const cpuMatch = latin.match(/PLR-S-CPU-\d{4}/);
  if (cpuMatch) controllerId = cpuMatch[0];

  const blocks: BlockInstance[] = [];
  const notes: CanvasNote[] = [];
  const countersByPrefix: Record<string, number> = { I: 0, Q: 0, M: 0, AI: 0, AQ: 0, B: 0 };

  const view = new DataView(buffer);
  const entityRegex = /C[A-Z][A-Za-z0-9]+Entity/g;
  let match: RegExpExecArray | null;
  while ((match = entityRegex.exec(latin)) !== null) {
    const className = match[0];
    const afterName = match.index + className.length;
    // Read bounding-box IEEE-754 doubles (left, right, top, bottom) right after entity class name
    let x = 120 + blocks.length * 90;
    let y = 120 + (blocks.length % 4) * 90;
    if (afterName + 32 <= buffer.byteLength) {
      const x1 = view.getFloat64(afterName, true);
      const y1 = view.getFloat64(afterName + 16, true);
      if (Number.isFinite(x1) && Number.isFinite(y1) && x1 >= 0 && x1 < 4000 && y1 >= 0 && y1 < 4000) {
        x = Math.round(x1 / 10) * 10;
        y = Math.round(y1 / 10) * 10;
      }
    }

    if (className === 'CNoteEntity') {
      notes.push({
        id: `note_${notes.length + 1}`,
        x,
        y,
        text: `Импортировано из ${filename}`,
      });
      continue;
    }

    const mappedType = entityMap[className];
    if (!mappedType) continue;
    const def = BLOCK_DEF_MAP[mappedType];
    if (!def) continue;

    const pKey = def.prefix === 'B' ? 'B' : def.prefix;
    countersByPrefix[pKey] = (countersByPrefix[pKey] ?? 0) + 1;
    const ch = countersByPrefix[pKey];

    const defaultParams: Record<string, number | string | boolean> = {};
    for (const p of def.params) defaultParams[p.key] = p.defaultValue;

    blocks.push({
      id: `xlg_blk_${blocks.length + 1}`,
      type: mappedType,
      channelIndex: ch,
      x,
      y,
      customName: '',
      comment: `Из файла ${filename}`,
      showParams: Boolean(def.showParamsOnCanvas),
      retentive: false,
      protectedBlock: false,
      invertedInputs: {},
      params: defaultParams,
    });
  }

  // Heuristic wire reconstruction if classic DI + logic/RS + DO topology
  const wires: WireConnection[] = [];
  const dis = blocks.filter((b) => b.type === 'DI').sort((a, b) => a.y - b.y);
  const mid = blocks.filter((b) => BLOCK_DEF_MAP[b.type]?.prefix === 'B');
  const dos = blocks.filter((b) => b.type === 'DO');
  if (dis.length >= 1 && mid.length === 1 && dos.length === 1) {
    const mDef = BLOCK_DEF_MAP[mid[0].type];
    dis.forEach((d, i) => {
      const targetPin = mDef.inputs[i];
      if (targetPin) {
        wires.push({
          id: `xlg_w_${wires.length + 1}`,
          fromBlockId: d.id,
          fromPinId: 'Q',
          toBlockId: mid[0].id,
          toPinId: targetPin.id,
        });
      }
    });
    wires.push({
      id: `xlg_w_${wires.length + 1}`,
      fromBlockId: mid[0].id,
      fromPinId: mDef.outputs[0]?.id || 'Q',
      toBlockId: dos[0].id,
      toPinId: 'In',
    });
  }

  return {
    version: '1.0.0',
    name: filename.replace(/\.xlg$/i, ''),
    author: 'Импорт ONI PLR Studio (.xlg)',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    controllerId,
    expansionIds: [],
    activeLanguage: 'FBD',
    blocks,
    wires,
    notes,
    analogConfigs: defaultAnalogConfigs(),
    ldRungs: [],
    hmiWidgets: [],
    activePlant: 'none',
  };
}

// Экспорт схемы в чистый векторный SVG (для печати / документации КИПиА)
export function exportProjectToSvg(project: OniProject): string {
  const width = 1280;
  const height = 800;
  const lines: string[] = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="background:#B5B5B5;font-family:Consolas,monospace;">`
  );
  // Title block GOST / КИПиА stamp at bottom right
  lines.push(
    `<rect x="10" y="10" width="${width - 20}" height="${height - 20}" fill="none" stroke="#333" stroke-width="1.5"/>`
  );
  lines.push(
    `<rect x="${width - 390}" y="${height - 75}" width="380" height="65" fill="#EAEAEA" stroke="#333" stroke-width="1.2"/>`
  );
  lines.push(
    `<text x="${width - 380}" y="${height - 52}" font-size="13" font-weight="bold" fill="#111">${escapeXml(
      project.name
    )}</text>`
  );
  lines.push(
    `<text x="${width - 380}" y="${height - 34}" font-size="11" fill="#333">Контроллер: ${escapeXml(
      project.controllerId
    )} | Блоков: ${project.blocks.length}</text>`
  );
  lines.push(
    `<text x="${width - 380}" y="${height - 18}" font-size="10" fill="#555">ONI PLR Studio Android (КИПиА) — ${new Date().toLocaleDateString(
      'ru-RU'
    )}</text>`
  );

  const blockMap = new Map(project.blocks.map((b) => [b.id, b]));
  for (const w of project.wires) {
    const fb = blockMap.get(w.fromBlockId);
    const tb = blockMap.get(w.toBlockId);
    if (!fb || !tb) continue;
    const x1 = fb.x + 36;
    const y1 = fb.y + 24;
    const x2 = tb.x;
    const y2 = tb.y + 20;
    const mx = Math.round((x1 + x2) / 2);
    lines.push(
      `<polyline points="${x1},${y1} ${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="#000" stroke-width="1.6"/>`
    );
  }

  for (const b of project.blocks) {
    const def = BLOCK_DEF_MAP[b.type];
    if (!def) continue;
    const fill =
      def.colorKind === 'io_green' ? '#00A83E' : def.colorKind === 'logic_blue' ? '#5D96D8' : '#0068B7';
    const hdr = formatBlockHeaderLabel(def, b.channelIndex, b.customName);
    lines.push(`<text x="${b.x}" y="${b.y - 5}" font-size="11" fill="#000">${escapeXml(hdr)}</text>`);
    lines.push(
      `<rect x="${b.x}" y="${b.y}" width="36" height="48" fill="${fill}" stroke="#003366" stroke-width="1.2"/>`
    );
    lines.push(
      `<text x="${b.x + 18}" y="${b.y + 26}" font-size="13" font-weight="bold" text-anchor="middle" fill="#FFF">${escapeXml(
        def.codeLabel
      )}</text>`
    );
  }

  for (const n of project.notes) {
    const rowLines = n.text.split('\n');
    rowLines.forEach((rl, idx) => {
      lines.push(
        `<text x="${n.x}" y="${n.y + idx * 16}" font-size="12" fill="#000">${escapeXml(rl)}</text>`
      );
    });
  }

  lines.push('</svg>');
  return lines.join('\n');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
