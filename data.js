(function (global) {
  'use strict';

  const SCHEMA_VERSION = 3;
  const APP_VERSION = '3.3.0';

  const KEYS = {
    data: 'misListasData',
    settings: 'misListasSettings',
    legacy: 'miGestorListasV1',
    legacyBackup: 'miGestorListasV1.backup',
    importBackup: 'misListasData.importBackup',
    corrupt: 'misListasData.corrupt'
  };

  const SORT_OPTIONS = [
    { value: 'manual', label: 'Manual', hint: 'Tu orden' },
    { value: 'name-asc', label: 'Nombre A–Z', hint: 'Alfabético' },
    { value: 'name-desc', label: 'Nombre Z–A', hint: 'Alfabético inverso' },
    { value: 'updated-desc', label: 'Editadas recientes', hint: 'Última edición primero' },
    { value: 'updated-asc', label: 'Editadas antiguas', hint: 'Última edición al final' },
    { value: 'created-desc', label: 'Creadas recientes', hint: 'Fecha de creación' },
    { value: 'created-asc', label: 'Creadas antiguas', hint: 'Fecha de creación' }
  ];

  const SORT_VALUES = new Set(SORT_OPTIONS.map(function (option) { return option.value; }));
  const COLUMN_TYPES = new Set(['text', 'number']);

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function safeString(value, fallback) {
    if (value === null || value === undefined) return fallback || '';
    let text = String(value);
    if (text.length > 5000) text = text.slice(0, 5000);
    return text;
  }

  function safeId(value, prefix, used) {
    let id = typeof value === 'string' ? value.trim() : '';
    if (!id || id.length > 120 || !/^[A-Za-z0-9_-]+$/.test(id)) id = uid(prefix);
    if (used) {
      while (used.has(id)) id = uid(prefix);
      used.add(id);
    }
    return id;
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function parseDateValue(value) {
    if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
    if (typeof value === 'number' && isFinite(value)) {
      const fromNumber = new Date(value);
      return isNaN(fromNumber.getTime()) ? null : fromNumber.toISOString();
    }
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text) return null;

    if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
      const isoTime = Date.parse(text);
      if (!isNaN(isoTime)) return new Date(isoTime).toISOString();
    }

    const match = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})(?:[ T].*)?$/);
    if (match) {
      let first = Number(match[1]);
      let second = Number(match[2]);
      let year = Number(match[3]);
      if (year < 100) year += 2000;
      let day;
      let month;
      if (first > 12) {
        day = first;
        month = second;
      } else if (second > 12) {
        day = second;
        month = first;
      } else {
        day = first;
        month = second;
      }
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const parsed = new Date(year, month - 1, day, 12, 0, 0);
        if (!isNaN(parsed.getTime())) return parsed.toISOString();
      }
    }

    const timestamp = Date.parse(text);
    if (!isNaN(timestamp)) return new Date(timestamp).toISOString();
    return null;
  }

  function normalizeIso(value, fallback) {
    return parseDateValue(value) || parseDateValue(fallback) || nowIso();
  }

  function maxIso(first, second) {
    const a = parseDateValue(first);
    const b = parseDateValue(second);
    if (!a) return b || nowIso();
    if (!b) return a;
    return Date.parse(a) >= Date.parse(b) ? a : b;
  }

  function parseNumber(value) {
    if (typeof value === 'number') return isFinite(value) ? value : null;
    if (typeof value !== 'string') return null;
    let text = value.trim().replace(/\s+/g, '').replace(/[€$£]/g, '');
    if (!text) return null;
    let negative = false;
    if (/^\(.*\)$/.test(text)) {
      negative = true;
      text = text.slice(1, -1);
    }
    text = text.replace(/[^\d.,-]/g, '');
    if (!text || text === '-' || text === '.' || text === ',') return null;

    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      if (lastComma > lastDot) {
        text = text.replace(/\./g, '').replace(/,/g, '.');
      } else {
        text = text.replace(/,/g, '');
      }
    } else if (lastComma > -1) {
      text = text.replace(/,/g, '.');
    } else if (lastDot > -1) {
      const parts = text.split('.');
      if (parts.length > 2) {
        const last = parts.pop();
        text = last.length === 3 ? parts.join('') + last : parts.join('') + '.' + last;
      } else if (parts[1] && parts[1].length === 3 && /^-?\d{1,3}$/.test(parts[0])) {
        text = parts.join('');
      }
    }

    const number = Number(text);
    if (!isFinite(number)) return null;
    return negative ? -number : number;
  }

  function formatNumber(value) {
    const number = typeof value === 'number' ? value : parseNumber(value);
    if (number === null) return '';
    return new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(number);
  }

  function dateLabel(value) {
    const parsed = parseDateValue(value);
    if (!parsed) return '—';
    const date = new Date(parsed);
    const now = new Date();
    const options = { day: 'numeric', month: 'short' };
    if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
    return new Intl.DateTimeFormat('es', options).format(date).replace('.', '');
  }

  function exactDate(value) {
    const parsed = parseDateValue(value);
    if (!parsed) return '—';
    return new Intl.DateTimeFormat('es', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(parsed));
  }

  function timeAgo(value, reference) {
    const parsed = parseDateValue(value);
    if (!parsed) return '—';
    const now = reference ? new Date(reference).getTime() : Date.now();
    const then = Date.parse(parsed);
    const diff = Math.max(0, now - then);
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (diff < 45 * 1000) return 'ahora';
    if (diff < hour) return 'hace ' + Math.max(1, Math.floor(diff / minute)) + ' min';
    if (diff < day) return 'hace ' + Math.floor(diff / hour) + ' h';
    if (diff < 7 * day) return 'hace ' + Math.floor(diff / day) + ' d';
    return dateLabel(parsed);
  }

  function normalizeForSearch(value) {
    return String(value === null || value === undefined ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function compareText(first, second) {
    return String(first || '').localeCompare(String(second || ''), 'es', {
      numeric: true,
      sensitivity: 'base'
    });
  }

  function sortItems(items, mode, getName, getCreated, getUpdated) {
    const list = items.slice();
    if (!SORT_VALUES.has(mode) || mode === 'manual') return list;

    const nameOf = function (item) { return getName ? getName(item) : item.name; };
    const createdOf = function (item) { return getCreated ? getCreated(item) : item.createdAt; };
    const updatedOf = function (item) { return getUpdated ? getUpdated(item) : item.updatedAt; };
    const timeOf = function (value) {
      const parsed = parseDateValue(value);
      return parsed ? Date.parse(parsed) : 0;
    };

    list.sort(function (a, b) {
      if (mode === 'name-asc') return compareText(nameOf(a), nameOf(b));
      if (mode === 'name-desc') return compareText(nameOf(b), nameOf(a));
      if (mode === 'created-desc' || mode === 'created-asc') {
        const difference = timeOf(createdOf(a)) - timeOf(createdOf(b));
        return (mode === 'created-asc' ? difference : -difference) || compareText(nameOf(a), nameOf(b));
      }
      const difference = timeOf(updatedOf(a)) - timeOf(updatedOf(b));
      return (mode === 'updated-asc' ? difference : -difference) || compareText(nameOf(a), nameOf(b));
    });

    return list;
  }

  function sortLabel(mode) {
    const option = SORT_OPTIONS.find(function (item) { return item.value === mode; });
    return option ? option.label : SORT_OPTIONS[0].label;
  }

  function detectColumnType(column, rawRows, index) {
    if (isObject(column) && COLUMN_TYPES.has(column.type)) return column.type;
    let found = false;
    for (let rowIndex = 0; rowIndex < rawRows.length; rowIndex += 1) {
      const row = rawRows[rowIndex];
      if (!isObject(row)) continue;
      let rawValue;
      if (Array.isArray(row.values)) rawValue = row.values[index];
      else if (isObject(row.values) && column && column.id) rawValue = row.values[column.id];
      if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') continue;
      found = true;
      if (parseNumber(rawValue) === null) return 'text';
    }
    return found ? 'number' : 'text';
  }

  function normalizeColumns(rawColumns, rawRows, listId) {
    const columns = [];
    const used = new Set();
    const rows = Array.isArray(rawRows) ? rawRows : [];
    const source = Array.isArray(rawColumns) ? rawColumns : [];

    source.forEach(function (rawColumn, index) {
      if (rawColumn === null || rawColumn === undefined) return;
      const isPlainName = typeof rawColumn === 'string' || typeof rawColumn === 'number';
      const name = isPlainName ? safeString(rawColumn, 'Columna ' + (index + 1)) : safeString(rawColumn.name, 'Columna ' + (index + 1));
      const type = detectColumnType(rawColumn, rows, index);
      columns.push({
        id: safeId(isObject(rawColumn) ? rawColumn.id : null, 'col', used),
        name: name || 'Columna ' + (index + 1),
        type: COLUMN_TYPES.has(type) ? type : 'text'
      });
    });

    return columns;
  }

  function normalizeRows(rawRows, columns, listCreatedAt) {
    const rows = [];
    const used = new Set();
    const source = Array.isArray(rawRows) ? rawRows : [];

    source.forEach(function (rawRow) {
      if (!isObject(rawRow)) return;
      const createdAt = normalizeIso(rawRow.createdAt || rawRow.created || rawRow.date || rawRow.fecha, listCreatedAt);
      const updatedAt = normalizeIso(rawRow.updatedAt, createdAt);
      const values = {};
      columns.forEach(function (column, index) {
        let value = '';
        if (Array.isArray(rawRow.values)) value = rawRow.values[index];
        else if (isObject(rawRow.values)) value = rawRow.values[column.id];
        values[column.id] = safeString(value, '');
      });
      rows.push({
        id: safeId(rawRow.id, 'row', used),
        name: safeString(rawRow.name, ''),
        done: rawRow.done === true || rawRow.done === 1 || rawRow.done === 'true',
        createdAt: createdAt,
        updatedAt: updatedAt,
        values: values
      });
    });

    return rows;
  }

  function emptyData() {
    return { version: SCHEMA_VERSION, folders: [] };
  }

  function normalizeData(raw) {
    let source = raw;
    if (isObject(raw) && isObject(raw.data) && Array.isArray(raw.data.folders)) source = raw.data;
    if (!isObject(source) || !Array.isArray(source.folders)) return emptyData();

    const folders = [];
    const usedFolderIds = new Set();
    const usedListIds = new Set();

    source.folders.forEach(function (rawFolder, folderIndex) {
      if (!isObject(rawFolder)) return;
      const folderCreatedAt = normalizeIso(rawFolder.createdAt || rawFolder.created, nowIso());
      const folder = {
        id: safeId(rawFolder.id, 'folder', usedFolderIds),
        name: safeString(rawFolder.name, 'Carpeta ' + (folderIndex + 1)) || 'Carpeta ' + (folderIndex + 1),
        createdAt: folderCreatedAt,
        updatedAt: normalizeIso(rawFolder.updatedAt, folderCreatedAt),
        lists: []
      };
      const rawLists = Array.isArray(rawFolder.lists) ? rawFolder.lists : [];

      rawLists.forEach(function (rawList, listIndex) {
        if (!isObject(rawList)) return;
        const listCreatedAt = normalizeIso(rawList.createdAt || rawList.created, folderCreatedAt);
        const columns = normalizeColumns(rawList.columns, rawList.rows, rawList.id);
        const rows = normalizeRows(rawList.rows, columns, listCreatedAt);
        const listUpdatedAt = rows.reduce(function (latest, row) {
          return maxIso(latest, row.updatedAt);
        }, normalizeIso(rawList.updatedAt, listCreatedAt));

        const list = {
          id: safeId(rawList.id, 'list', usedListIds),
          name: safeString(rawList.name, 'Lista ' + (listIndex + 1)) || 'Lista ' + (listIndex + 1),
          createdAt: listCreatedAt,
          updatedAt: listUpdatedAt,
          columns: columns,
          rows: rows
        };

        folder.lists.push(list);
        folder.updatedAt = maxIso(folder.updatedAt, listUpdatedAt);
      });

      folders.push(folder);
    });

    return { version: SCHEMA_VERSION, folders: folders };
  }

  function normalizeSettings(raw) {
    const source = isObject(raw) ? raw : {};
    const settings = {
      folderSort: SORT_VALUES.has(source.folderSort) ? source.folderSort : 'manual',
      listSort: {},
      rowSort: {}
    };
    if (isObject(source.listSort)) {
      Object.keys(source.listSort).forEach(function (key) {
        if (SORT_VALUES.has(source.listSort[key])) settings.listSort[key] = source.listSort[key];
      });
    }
    if (isObject(source.rowSort)) {
      Object.keys(source.rowSort).forEach(function (key) {
        if (SORT_VALUES.has(source.rowSort[key])) settings.rowSort[key] = source.rowSort[key];
      });
    }
    return settings;
  }

  function exportPayload(data) {
    return {
      app: 'mis-listas',
      version: SCHEMA_VERSION,
      exportedAt: nowIso(),
      data: data
    };
  }

  function countData(data) {
    const counts = { folders: 0, lists: 0, rows: 0, done: 0, pending: 0 };
    const folders = data && Array.isArray(data.folders) ? data.folders : [];
    counts.folders = folders.length;
    folders.forEach(function (folder) {
      const lists = Array.isArray(folder.lists) ? folder.lists : [];
      counts.lists += lists.length;
      lists.forEach(function (list) {
        const rows = Array.isArray(list.rows) ? list.rows : [];
        counts.rows += rows.length;
        rows.forEach(function (row) {
          if (row.done) counts.done += 1;
          else counts.pending += 1;
        });
      });
    });
    return counts;
  }

  function countList(list) {
    const rows = list && Array.isArray(list.rows) ? list.rows : [];
    const done = rows.filter(function (row) { return row.done; }).length;
    return { total: rows.length, done: done, pending: rows.length - done };
  }

  function newColumn(name, type) {
    return {
      id: uid('col'),
      name: name || 'Columna',
      type: COLUMN_TYPES.has(type) ? type : 'text'
    };
  }

  function newRow(columns) {
    const timestamp = nowIso();
    const values = {};
    (columns || []).forEach(function (column) { values[column.id] = ''; });
    return {
      id: uid('row'),
      name: '',
      done: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      values: values
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  global.ListasData = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    APP_VERSION: APP_VERSION,
    KEYS: KEYS,
    SORT_OPTIONS: SORT_OPTIONS,
    emptyData: emptyData,
    normalizeData: normalizeData,
    normalizeSettings: normalizeSettings,
    exportPayload: exportPayload,
    countData: countData,
    countList: countList,
    sortItems: sortItems,
    sortLabel: sortLabel,
    parseNumber: parseNumber,
    formatNumber: formatNumber,
    dateLabel: dateLabel,
    exactDate: exactDate,
    timeAgo: timeAgo,
    normalizeForSearch: normalizeForSearch,
    compareText: compareText,
    escapeHtml: escapeHtml,
    uid: uid,
    nowIso: nowIso,
    newColumn: newColumn,
    newRow: newRow,
    clone: clone,
    maxIso: maxIso,
    parseDateValue: parseDateValue
  };
})(typeof window !== 'undefined' ? window : globalThis);
