(function () {
  'use strict';

  const D = window.ListasData;
  if (!D) return;

  const app = document.getElementById('app');
  const overlayRoot = document.getElementById('overlayRoot');
  const toastRoot = document.getElementById('toastRoot');

  let data = null;
  let settings = D.normalizeSettings(null);
  let route = { name: 'home', key: 'home' };
  let bootNotice = '';
  let saveTimer = null;
  let saveState = 'saved';
  let sheetCounter = 0;
  let deferredInstallPrompt = null;
  let swRegistration = null;
  let updateToastShown = false;
  let reloading = false;

  const ui = {
    search: { home: '', folder: '', list: '' },
    filter: 'all',
    editRows: false,
    scroll: Object.create(null)
  };

  function esc(value) {
    return D.escapeHtml(value);
  }

  function escAttr(value) {
    return D.escapeHtml(value);
  }

  function icon(name, className) {
    return '<svg class="icon' + (className ? ' ' + className : '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function plural(count, singular, pluralWord) {
    return count + ' ' + (count === 1 ? singular : pluralWord);
  }

  function currentList() {
    return route.name === 'list' ? findList(route.id) : null;
  }

  function currentFolder() {
    return route.name === 'folder' ? findFolder(route.id) : null;
  }

  function findFolder(id) {
    for (let i = 0; i < data.folders.length; i += 1) {
      if (data.folders[i].id === id) return data.folders[i];
    }
    return null;
  }

  function findList(id) {
    for (let i = 0; i < data.folders.length; i += 1) {
      const folder = data.folders[i];
      for (let j = 0; j < folder.lists.length; j += 1) {
        if (folder.lists[j].id === id) return { folder: folder, list: folder.lists[j] };
      }
    }
    return null;
  }

  function safeGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function safeGetJSON(key) {
    const raw = safeGet(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function load() {
    const currentRaw = safeGet(D.KEYS.data);
    let hadError = false;

    if (currentRaw) {
      try {
        data = D.normalizeData(JSON.parse(currentRaw));
      } catch (error) {
        hadError = true;
        safeSet(D.KEYS.corrupt + '.' + Date.now(), currentRaw);
      }
    }

    if (!data) {
      const legacyRaw = safeGet(D.KEYS.legacy);
      if (legacyRaw) {
        try {
          const legacy = JSON.parse(legacyRaw);
          if (!safeGet(D.KEYS.legacyBackup)) safeSet(D.KEYS.legacyBackup, legacyRaw);
          data = D.normalizeData(legacy);
          bootNotice = 'Datos actualizados a la nueva versión. Guardamos una copia de la versión anterior.';
          saveDataNow(true);
        } catch (error) {
          hadError = true;
        }
      }
    }

    if (!data) {
      data = D.emptyData();
      if (hadError) bootNotice = 'No se pudieron leer los datos guardados. Guardamos una copia y empezamos de nuevo.';
    }

    settings = D.normalizeSettings(safeGetJSON(D.KEYS.settings));
    if (!safeGet(D.KEYS.data)) saveDataNow(true);
  }

  function saveDataNow(silent) {
    const saved = safeSet(D.KEYS.data, JSON.stringify(data));
    if (!saved) {
      setSaveState('error');
      if (!silent) showToast('No se pudieron guardar los cambios. Revisa el espacio del navegador.', { tone: 'error' });
      return false;
    }
    if (!silent) setSaveState('saved');
    return true;
  }

  function scheduleSave() {
    setSaveState('saving');
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(function () {
      saveTimer = null;
      if (saveDataNow(true)) setSaveState('saved');
    }, 320);
  }

  function flushSave() {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
      if (saveDataNow(true)) setSaveState('saved');
    }
  }

  function saveSettings() {
    safeSet(D.KEYS.settings, JSON.stringify(settings));
  }

  function setSaveState(state) {
    saveState = state;
    updateSaveBadge();
  }

  function saveStatusHTML() {
    const labels = { saving: 'Guardando…', saved: 'Guardado', error: 'Sin guardar' };
    return '<span class="save-status is-' + saveState + '" data-bind="save-status" aria-live="polite"><span class="save-dot"></span>' + labels[saveState] + '</span>';
  }

  function updateSaveBadge() {
    const element = document.querySelector('[data-bind="save-status"]');
    if (!element) return;
    const labels = { saving: 'Guardando…', saved: 'Guardado', error: 'Sin guardar' };
    element.className = 'save-status is-' + saveState;
    element.innerHTML = '<span class="save-dot"></span>' + labels[saveState];
  }

  function parseRoute() {
    const raw = (location.hash || '').replace(/^#\/?/, '');
    const parts = raw.split('/').filter(Boolean).map(function (part) {
      try {
        return decodeURIComponent(part);
      } catch (error) {
        return part;
      }
    });
    if (parts[0] === 'carpeta' && parts[1]) return { name: 'folder', id: parts[1], key: 'folder:' + parts[1] };
    if (parts[0] === 'lista' && parts[1]) return { name: 'list', id: parts[1], key: 'list:' + parts[1] };
    return { name: 'home', key: 'home' };
  }

  function navigate(path, replace) {
    const hash = '#' + (path.charAt(0) === '/' ? path : '/' + path);
    if (replace) {
      history.replaceState(null, '', location.pathname + location.search + hash);
      handleRoute();
      return;
    }
    if (location.hash === hash) {
      handleRoute();
      return;
    }
    location.hash = hash;
  }

  function goHome() {
    navigate('/');
  }

  function goFolder(id) {
    navigate('/carpeta/' + encodeURIComponent(id));
  }

  function goList(id) {
    navigate('/lista/' + encodeURIComponent(id));
  }

  function resetSearchAndFilter() {
    ui.search.home = '';
    ui.search.folder = '';
    ui.search.list = '';
    ui.filter = 'all';
    ui.editRows = false;
  }

  function handleRoute(initial) {
    if (!initial) ui.scroll[route.key] = window.scrollY;

    let next = parseRoute();

    if (next.name === 'folder' && !findFolder(next.id)) {
      showToast('Esa carpeta ya no existe.', { tone: 'error' });
      history.replaceState(null, '', location.pathname + location.search + '#/');
      next = { name: 'home', key: 'home' };
    }

    if (next.name === 'list' && !findList(next.id)) {
      showToast('Esa lista ya no existe.', { tone: 'error' });
      history.replaceState(null, '', location.pathname + location.search + '#/');
      next = { name: 'home', key: 'home' };
    }

    const changed = next.key !== route.key;
    route = next;
    if (changed) resetSearchAndFilter();
    render();

    window.requestAnimationFrame(function () {
      window.scrollTo(0, ui.scroll[route.key] || 0);
    });
  }

  function render() {
    if (route.name === 'folder') renderFolder();
    else if (route.name === 'list') renderList();
    else renderHome();
  }

  function brandTopbar(addAction, addLabel) {
    return '<header class="topbar">' +
      '<div class="topbar-left"><span class="brand-mark">' + icon('list') + '</span><span class="brand">Mis listas</span></div>' +
      '<div class="topbar-actions">' + saveStatusHTML() +
      (addAction ? headerAddHTML(addAction, addLabel) : '') +
      '<button type="button" class="icon-btn" data-action="open-settings" aria-label="Ajustes y copias de seguridad">' + icon('settings') + '</button>' +
      '</div></header>';
  }

  function pageTopbar(backAction, backLabel, menuAction, menuLabel, addAction, addLabel, addId) {
    return '<header class="topbar">' +
      '<div class="topbar-left"><button type="button" class="back-btn" data-action="' + backAction + '" aria-label="Volver a ' + escAttr(backLabel) + '">' + icon('chevron-left') + '<span>' + esc(backLabel) + '</span></button></div>' +
      '<div class="topbar-actions">' + saveStatusHTML() +
      (addAction ? headerAddHTML(addAction, addLabel, addId) : '') +
      '<button type="button" class="icon-btn" data-action="' + menuAction + '" aria-label="' + escAttr(menuLabel || 'Más opciones') + '">' + icon('more') + '</button>' +
      '</div></header>';
  }

  function searchHTML(scope, placeholder) {
    const value = ui.search[scope] || '';
    return '<div class="search' + (value ? ' has-value' : '') + '">' +
      icon('search') +
      '<input type="text" value="' + escAttr(value) + '" placeholder="' + escAttr(placeholder) + '" data-search="' + scope + '" enterkeyhint="search" autocomplete="off" spellcheck="false" aria-label="' + escAttr(placeholder) + '">' +
      '<button type="button" class="search-clear" data-action="clear-search" data-scope="' + scope + '" aria-label="Borrar búsqueda">' + icon('x') + '</button>' +
      '</div>';
  }

  function headerAddHTML(action, label, id) {
    return '<button type="button" class="btn primary header-add" data-action="' + action + '"' + (id ? ' data-id="' + escAttr(id) + '"' : '') + '>' + icon('plus') + '<span>' + esc(label) + '</span></button>';
  }

  function emptyStateHTML(options) {
    return '<div class="empty-state">' +
      '<span class="empty-icon">' + icon(options.iconName || 'list') + '</span>' +
      '<h2>' + esc(options.title) + '</h2>' +
      '<p>' + esc(options.text) + '</p>' +
      (options.action ? '<button type="button" class="btn primary" data-action="' + options.action + '">' + icon('plus') + esc(options.actionLabel || 'Crear') + '</button>' : '') +
      '</div>';
  }

  function summaryText(counts) {
    if (!counts.folders) return 'Crea tu primera carpeta para empezar.';
    return plural(counts.folders, 'carpeta', 'carpetas') + ' · ' + plural(counts.lists, 'lista', 'listas') + ' · ' + plural(counts.pending, 'pendiente', 'pendientes');
  }

  function renderHome() {
    const counts = D.countData(data);
    const sortMode = settings.folderSort || 'manual';
    app.innerHTML = brandTopbar('new-folder', 'Nueva carpeta') +
      '<main class="page home-page">' +
      '<section class="hero">' +
      '<div class="eyebrow">Tu espacio personal</div>' +
      '<h1>Mis carpetas</h1>' +
      '<p class="lede">' + esc(summaryText(counts)) + '</p>' +
      '</section>' +
      '<div class="toolbar">' +
      searchHTML('home', 'Buscar carpetas…') +
      '<button type="button" class="select-btn" data-action="sort-folders">' + icon('sort') + '<span>Ordenar:</span><strong data-sort-label>' + esc(D.sortLabel(sortMode)) + '</strong></button>' +
      '</div>' +
      '<div id="homeFolders" class="folder-grid"></div>' +
      '</main>';
    updateHomeFolders();
    updateSaveBadge();
    document.title = 'Mis listas';
  }

  function updateHomeFolders() {
    if (route.name !== 'home') return;
    const container = document.getElementById('homeFolders');
    if (!container) return;
    const query = D.normalizeForSearch(ui.search.home);
    let folders = data.folders.filter(function (folder) {
      return !query || D.normalizeForSearch(folder.name).indexOf(query) !== -1;
    });
    folders = D.sortItems(folders, settings.folderSort || 'manual', function (folder) { return folder.name; }, function (folder) { return folder.createdAt; }, function (folder) { return folder.updatedAt; });

    if (!data.folders.length) {
      container.innerHTML = emptyStateHTML({
        iconName: 'folder',
        title: 'Tu primera carpeta',
        text: 'Crea una carpeta para agrupar tus listas.',
        action: 'new-folder',
        actionLabel: 'Crear carpeta'
      });
      return;
    }

    if (!folders.length) {
      container.innerHTML = emptyStateHTML({
        iconName: 'search',
        title: 'Sin resultados',
        text: 'No hay carpetas que coincidan con tu búsqueda.'
      });
      return;
    }

    container.innerHTML = folders.map(folderCardHTML).join('');
  }

  function folderCardHTML(folder) {
    const counts = D.countData({ folders: [folder] });
    const meta = folder.lists.length ? plural(folder.lists.length, 'lista', 'listas') + ' · ' + plural(counts.pending, 'pendiente', 'pendientes') : 'Sin listas todavía';
    return '<article class="folder-card">' +
      '<button type="button" class="card-main" data-action="open-folder" data-id="' + escAttr(folder.id) + '">' +
      '<span class="folder-icon">' + icon('folder') + '</span>' +
      '<span class="folder-name">' + esc(folder.name) + '</span>' +
      '<span class="folder-meta">' + esc(meta) + '</span>' +
      '<span class="folder-dates" title="' + escAttr('Creada ' + D.exactDate(folder.createdAt)) + '">Creada ' + esc(D.dateLabel(folder.createdAt)) + ' · Editada ' + esc(D.timeAgo(folder.updatedAt)) + '</span>' +
      '</button>' +
      '<button type="button" class="card-menu" data-action="folder-menu" data-id="' + escAttr(folder.id) + '" aria-label="Opciones de ' + escAttr(folder.name) + '">' + icon('more') + '</button>' +
      '</article>';
  }

  function renderFolder() {
    const folder = findFolder(route.id);
    if (!folder) {
      goHome();
      return;
    }
    const counts = D.countData({ folders: [folder] });
    const sortMode = settings.listSort[folder.id] || 'manual';
    app.innerHTML = pageTopbar('go-home', 'Carpetas', 'folder-menu', 'Opciones de la carpeta', 'new-list', 'Nueva lista', folder.id) +
      '<main class="page">' +
      '<section class="hero">' +
      '<div class="eyebrow">Carpeta</div>' +
      '<h1>' + esc(folder.name) + '</h1>' +
      '<p class="lede">' + esc(plural(folder.lists.length, 'lista', 'listas')) + ' · ' + esc(plural(counts.pending, 'pendiente', 'pendientes')) + ' · Editada ' + esc(D.timeAgo(folder.updatedAt)) + '</p>' +
      '</section>' +
      '<div class="toolbar">' +
      searchHTML('folder', 'Buscar listas…') +
      '<button type="button" class="select-btn" data-action="sort-lists" data-id="' + escAttr(folder.id) + '">' + icon('sort') + '<span>Ordenar:</span><strong data-sort-label>' + esc(D.sortLabel(sortMode)) + '</strong></button>' +
      '</div>' +
      '<div id="folderLists" class="list-grid"></div>' +
      '</main>';
    updateFolderLists(folder);
    updateSaveBadge();
    document.title = folder.name + ' · Mis listas';
  }

  function updateFolderLists(folder) {
    if (route.name !== 'folder' || route.id !== folder.id) return;
    const container = document.getElementById('folderLists');
    if (!container) return;
    const query = D.normalizeForSearch(ui.search.folder);
    let lists = folder.lists.filter(function (list) {
      return !query || D.normalizeForSearch(list.name).indexOf(query) !== -1;
    });
    lists = D.sortItems(lists, settings.listSort[folder.id] || 'manual', function (list) { return list.name; }, function (list) { return list.createdAt; }, function (list) { return list.updatedAt; });

    if (!folder.lists.length) {
      container.innerHTML = emptyStateHTML({
        iconName: 'list',
        title: 'Esta carpeta está vacía',
        text: 'Crea una lista para empezar a organizar.',
        action: 'new-list',
        actionLabel: 'Crear lista'
      });
      return;
    }

    if (!lists.length) {
      container.innerHTML = emptyStateHTML({
        iconName: 'search',
        title: 'Sin resultados',
        text: 'No hay listas que coincidan con tu búsqueda.'
      });
      return;
    }

    container.innerHTML = lists.map(function (list) { return listCardHTML(folder, list); }).join('');
  }

  function listCardHTML(folder, list) {
    const stats = D.countList(list);
    const percent = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
    const isComplete = stats.total > 0 && stats.done === stats.total;
    const badgeText = stats.total ? (stats.done + '/' + stats.total + (isComplete ? ' completada' : ' (' + percent + '%)')) : '0 registros';
    return '<article class="list-card">' +
      '<button type="button" class="card-main" data-action="open-list" data-id="' + escAttr(list.id) + '">' +
      '<div class="list-card-top">' +
      '<span class="list-icon">' + icon('list') + '</span>' +
      '<div class="list-info">' +
      '<span class="list-name">' + esc(list.name) + '</span>' +
      '<div class="list-meta">' +
      '<span class="list-badge' + (isComplete ? ' is-complete' : '') + '">' + esc(badgeText) + '</span>' +
      '<span class="list-dot">·</span>' +
      '<span class="list-date" title="' + escAttr('Creada ' + D.exactDate(list.createdAt)) + '">Editada ' + esc(D.timeAgo(list.updatedAt)) + '</span>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '<div class="list-card-progress">' +
      '<span class="progress-track"><span class="progress-fill" style="width:' + percent + '%"></span></span>' +
      '</div>' +
      '</button>' +
      '<button type="button" class="card-menu" data-action="list-menu" data-id="' + escAttr(list.id) + '" aria-label="Opciones de ' + escAttr(list.name) + '">' + icon('more') + '</button>' +
      '</article>';
  }

  function listLede(list) {
    const stats = D.countList(list);
    if (!stats.total) return 'Sin registros · Creada ' + D.dateLabel(list.createdAt);
    return stats.done + ' de ' + stats.total + ' completadas · Creada ' + D.dateLabel(list.createdAt);
  }

  function renderList() {
    const ctx = findList(route.id);
    if (!ctx) {
      goHome();
      return;
    }
    const folder = ctx.folder;
    const list = ctx.list;
    const stats = D.countList(list);
    const percent = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
    const sortMode = settings.rowSort[list.id] || 'manual';
    if (!stats.total) ui.editRows = false;

    app.innerHTML = pageTopbar('go-folder', folder.name, 'list-menu', 'Opciones de la lista', 'add-row', 'Añadir fila') +
      '<main class="page">' +
      '<section class="hero list-hero">' +
      '<div class="hero-copy"><div class="eyebrow">Lista</div><h1>' + esc(list.name) + '</h1><p class="lede" data-bind="list-lede">' + esc(listLede(list)) + '</p></div>' +
      '<div class="hero-progress"><strong data-bind="list-percent">' + percent + '%</strong><span>completado</span></div>' +
      '</section>' +
      '<div class="progress-line"><span data-bind="progress-fill" style="width:' + percent + '%"></span></div>' +
      '<div class="toolbar">' +
      searchHTML('list', 'Buscar en la lista…') +
      '<button type="button" class="select-btn" data-action="sort-rows" data-id="' + escAttr(list.id) + '">' + icon('sort') + '<span>Ordenar:</span><strong data-sort-label>' + esc(D.sortLabel(sortMode)) + '</strong></button>' +
      '<button type="button" class="select-btn edit-toggle" data-action="toggle-row-edit" aria-pressed="' + (ui.editRows ? 'true' : 'false') + '"' + (stats.total ? '' : ' disabled') + '>' + icon(ui.editRows ? 'check' : 'pencil') + '<span>' + (ui.editRows ? 'Listo' : 'Editar') + '</span></button>' +
      '</div>' +
      '<p class="edit-hint" data-bind="edit-hint"' + (ui.editRows ? '' : ' hidden') + '>' + icon('pencil') + ' Toca una fila para ver sus acciones.</p>' +
      '<div class="chips" role="group" aria-label="Filtrar filas">' +
      filterChip('all', 'Todas', stats.total) +
      filterChip('pending', 'Pendientes', stats.pending) +
      filterChip('done', 'Hechas', stats.done) +
      '</div>' +
      '<div id="listBody" class="list-body"></div>' +
      '</main>';

    renderListBody(list);
    updateListStats(list);
    updateSaveBadge();
    document.title = list.name + ' · Mis listas';
  }

  function filterChip(filter, label, count) {
    return '<button type="button" class="chip" data-action="filter" data-filter="' + filter + '" aria-pressed="' + (ui.filter === filter) + '">' +
      '<span>' + esc(label) + '</span><b data-filter-count="' + filter + '">' + count + '</b>' +
      '</button>';
  }

  function adjustNameField(field) {
    if (!field || !field.classList || !field.classList.contains('row-name')) return;
    const len = (field.value || '').length;
    const fontSize = len <= 16 ? 12.5 : (len <= 26 ? 11 : 9.5);
    field.style.fontSize = fontSize + 'px';
    field.style.height = 'auto';
    const scrollH = field.scrollHeight;
    field.style.height = Math.max(40, scrollH) + 'px';
  }

  function renderListBody(list) {
    const body = document.getElementById('listBody');
    if (!body) return;

    let rowTemplate;
    if (!list.columns.length) {
      rowTemplate = '1fr';
    } else {
      const colsDef = list.columns.map(function (col) {
        return col.type === 'number' ? 'minmax(40px, 0.7fr)' : 'minmax(50px, 1fr)';
      });
      const nameFr = list.columns.length === 1 ? '4fr' : (list.columns.length === 2 ? '3.6fr' : '2.8fr');
      rowTemplate = 'minmax(0, ' + nameFr + ') ' + colsDef.join(' ');
    }
    body.style.setProperty('--row-cols', rowTemplate);
    body.classList.toggle('is-edit-mode', ui.editRows);

    const visible = visibleRows(list);
    const hasRows = list.rows.length > 0;
    const emptyFiltered = hasRows && visible.length === 0;

    body.innerHTML =
      '<div class="table-shell" role="table" aria-label="Filas de la lista">' +
        gridHeadHTML(list) +
        '<div id="rowsContainer" class="rows-container" role="rowgroup">' +
          visible.map(function (row) { return rowHTML(row, list); }).join('') +
        '</div>' +
      '</div>' +
      (hasRows ? '<div class="empty-state filter-empty" id="filterEmpty" hidden></div>' : '') +
      '<button type="button" class="add-row-inline" data-action="add-row">' + icon('plus') + 'Añadir fila</button>';

    body.querySelectorAll('.row-name').forEach(adjustNameField);

    if (emptyFiltered) updateFilterEmpty(list);
    updateEditModeUI();
  }

  function gridHeadHTML(list) {
    const columns = list.columns.map(function (column) {
      return '<button type="button" class="col-head' + (column.type === 'number' ? ' is-number' : '') + '" data-action="open-columns" title="Editar columnas" role="columnheader">' + esc(column.name) + '</button>';
    }).join('');
    return '<div class="grid-head" role="row">' +
      '<button type="button" class="col-head col-head-name" data-action="open-columns" title="Editar columnas" role="columnheader">Nombre</button>' +
      columns +
      '</div>';
  }

  function rowHTML(row, list) {
    const editAttrs = ui.editRows ? ' readonly tabindex="-1"' : '';
    const values = list.columns.map(function (column) {
      const value = row.values[column.id] || '';
      const numberClass = column.type === 'number' ? ' is-number' : '';
      return '<div class="cell value-field' + numberClass + '" role="cell">' +
        '<span class="value-display' + numberClass + '" data-value-display="' + escAttr(column.id) + '" aria-hidden="true">' + esc(value) + '</span>' +
        '<input class="value-input' + numberClass + '" type="text" value="' + escAttr(value) + '" placeholder="" data-field="value" data-col-id="' + escAttr(column.id) + '"' + (column.type === 'number' ? ' inputmode="decimal"' : '') + editAttrs + ' enterkeyhint="next" autocomplete="off" spellcheck="false" aria-label="' + escAttr(column.name) + '">' +
        '</div>';
    }).join('');
    const rowLabel = row.name ? 'Abrir acciones de ' + row.name : 'Abrir acciones de la fila sin nombre';

    return '<div class="row-card' + (row.done ? ' is-done' : '') + '" data-row-id="' + escAttr(row.id) + '" role="row"' + (ui.editRows ? ' tabindex="0" aria-label="' + escAttr(rowLabel) + '"' : '') + '>' +
      '<div class="cell cell-name" role="cell">' +
      '<input class="row-check" type="checkbox"' + (row.done ? ' checked' : '') + ' data-check-row="' + escAttr(row.id) + '" aria-label="' + (row.done ? 'Marcar como pendiente' : 'Marcar como completada') + '">' +
      '<div class="name-wrap"><textarea class="row-name" rows="1" placeholder="Sin nombre" data-field="name"' + editAttrs + ' enterkeyhint="next" autocomplete="off" spellcheck="false" aria-label="Nombre de la fila">' + esc(row.name) + '</textarea></div>' +
      '</div>' +
      values +
      '</div>';
  }

  function visibleRows(list) {
    const query = D.normalizeForSearch(ui.search.list);
    const filtered = list.rows.filter(function (row) {
      if (ui.filter === 'pending' && row.done) return false;
      if (ui.filter === 'done' && !row.done) return false;
      if (query) {
        let haystack = row.name || '';
        list.columns.forEach(function (column) { haystack += ' ' + (row.values[column.id] || ''); });
        if (D.normalizeForSearch(haystack).indexOf(query) === -1) return false;
      }
      return true;
    });
    return D.sortItems(filtered, settings.rowSort[list.id] || 'manual', function (row) { return row.name; }, function (row) { return row.createdAt; }, function (row) { return row.updatedAt; });
  }

  function filteredEmptyContent() {
    const query = ui.search.list.trim();
    if (query) {
      return '<span class="empty-icon">' + icon('search') + '</span><h2>Sin resultados</h2><p>No encontramos filas para «' + esc(query) + '».</p>';
    }
    if (ui.filter === 'pending') {
      return '<span class="empty-icon">' + icon('check') + '</span><h2>Nada pendiente</h2><p>Todo lo de esta lista está completado.</p>';
    }
    if (ui.filter === 'done') {
      return '<span class="empty-icon">' + icon('check-circle') + '</span><h2>Todavía no hay hechas</h2><p>Marca una fila como completada para verla aquí.</p>';
    }
    return '<span class="empty-icon">' + icon('list') + '</span><h2>Sin filas visibles</h2><p>Cambia el filtro para ver más.</p>';
  }

  function updateFilterEmpty(list) {
    const filterEmpty = document.getElementById('filterEmpty');
    if (!filterEmpty) return;
    const visible = document.querySelectorAll('#rowsContainer .row-card:not(.is-filtered-out)').length;
    filterEmpty.innerHTML = filteredEmptyContent();
    filterEmpty.hidden = visible > 0 || list.rows.length === 0;
  }

  function updateListStats(list) {
    if (route.name !== 'list' || route.id !== list.id) return;
    const stats = D.countList(list);
    const percent = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

    const lede = document.querySelector('[data-bind="list-lede"]');
    if (lede) lede.textContent = listLede(list);
    const percentElement = document.querySelector('[data-bind="list-percent"]');
    if (percentElement) percentElement.textContent = percent + '%';
    const fill = document.querySelector('[data-bind="progress-fill"]');
    if (fill) fill.style.width = percent + '%';

    document.querySelectorAll('[data-filter-count]').forEach(function (element) {
      const key = element.getAttribute('data-filter-count');
      element.textContent = key === 'pending' ? stats.pending : key === 'done' ? stats.done : stats.total;
    });

    document.querySelectorAll('[data-action="filter"]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-filter') === ui.filter));
    });

    updateEditModeUI();
    updateFilterEmpty(list);
  }

  function updateEditModeUI() {
    const ctx = currentList();
    const hasRows = !!(ctx && ctx.list.rows.length);
    const button = document.querySelector('[data-action="toggle-row-edit"]');
    if (button) {
      button.disabled = !hasRows;
      button.setAttribute('aria-pressed', String(ui.editRows));
      button.innerHTML = icon(ui.editRows ? 'check' : 'pencil') + '<span>' + (ui.editRows ? 'Listo' : 'Editar') + '</span>';
    }
    const hint = document.querySelector('[data-bind="edit-hint"]');
    if (hint) hint.hidden = !ui.editRows;
  }

  function setRowEditMode(active, options) {
    if (ui.editRows === active) return;
    ui.editRows = active;
    updateEditModeUI();
    if (options && options.render === false) return;
    const ctx = currentList();
    if (ctx) renderListBody(ctx.list);
  }

  function touchRow(folder, list, row) {
    const timestamp = D.nowIso();
    row.updatedAt = timestamp;
    list.updatedAt = timestamp;
    folder.updatedAt = timestamp;
    scheduleSave();
  }

  function syncValueDisplay(field) {
    if (!field || field.getAttribute('data-field') !== 'value') return;
    const rowElement = field.closest('.row-card');
    if (!rowElement) return;
    const display = rowElement.querySelector('[data-value-display="' + field.getAttribute('data-col-id') + '"]');
    if (display) display.textContent = field.value;
  }

  function commitField(field, trim) {
    if (!field || !field.closest('.row-card')) return;
    const ctx = currentList();
    if (!ctx) return;
    const rowElement = field.closest('.row-card');
    const row = ctx.list.rows.find(function (item) { return item.id === rowElement.getAttribute('data-row-id'); });
    if (!row) return;

    let value = field.value;
    if (trim) {
      value = value.trim();
      if (value !== field.value) field.value = value;
    }

    if (field.getAttribute('data-field') === 'name') row.name = value;
    else {
      row.values[field.getAttribute('data-col-id')] = value;
      syncValueDisplay(field);
    }

    touchRow(ctx.folder, ctx.list, row);
    updateListStats(ctx.list);
  }

  function updateFieldFromInput(field) {
    const ctx = currentList();
    if (!ctx) return;
    const rowElement = field.closest('.row-card');
    if (!rowElement) return;
    const row = ctx.list.rows.find(function (item) { return item.id === rowElement.getAttribute('data-row-id'); });
    if (!row) return;

    if (field.getAttribute('data-field') === 'name') row.name = field.value;
    else {
      row.values[field.getAttribute('data-col-id')] = field.value;
      syncValueDisplay(field);
    }

    touchRow(ctx.folder, ctx.list, row);
    updateListStats(ctx.list);
  }

  function toggleSearchClear(input) {
    const wrapper = input.closest('.search');
    if (!wrapper) return;
    wrapper.classList.toggle('has-value', input.value.length > 0);
  }

  function resetListFiltersForAdd() {
    ui.filter = 'all';
    if (ui.search.list) {
      ui.search.list = '';
      const input = document.querySelector('[data-search="list"]');
      if (input) {
        input.value = '';
        toggleSearchClear(input);
      }
    }
    document.querySelectorAll('[data-action="filter"]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-filter') === 'all'));
    });
  }

  function addRow(options) {
    const ctx = currentList();
    if (!ctx) return;
    const wasEditing = ui.editRows;
    if (wasEditing) {
      ui.editRows = false;
      updateEditModeUI();
    }
    const hadActiveFilter = ui.filter !== 'all' || !!ui.search.list;
    resetListFiltersForAdd();

    const row = D.newRow(ctx.list.columns);
    const timestamp = D.nowIso();
    row.createdAt = timestamp;
    row.updatedAt = timestamp;
    ctx.list.rows.push(row);
    ctx.list.updatedAt = timestamp;
    ctx.folder.updatedAt = timestamp;
    saveDataNow();

    if (wasEditing || hadActiveFilter || (settings.rowSort[ctx.list.id] || 'manual') !== 'manual') {
      renderListBody(ctx.list);
      updateListStats(ctx.list);
      focusRow(row.id, options && options.focusField ? options.focusField : 'name');
      return;
    }

    const rowsContainer = document.getElementById('rowsContainer');
    if (!rowsContainer) {
      renderListBody(ctx.list);
      updateListStats(ctx.list);
      focusRow(row.id, 'name');
      return;
    }

    rowsContainer.insertAdjacentHTML('beforeend', rowHTML(row, ctx.list));
    const newRowEl = rowsContainer.lastElementChild;
    if (newRowEl) {
      const nameField = newRowEl.querySelector('.row-name');
      if (nameField) adjustNameField(nameField);
    }
    updateListStats(ctx.list);
    focusRow(row.id, options && options.focusField ? options.focusField : 'name');
  }

  function focusRow(rowId, field) {
    window.requestAnimationFrame(function () {
      const body = document.getElementById('listBody');
      if (!body) return;
      const rowElement = body.querySelector('.row-card[data-row-id="' + rowId + '"]');
      if (!rowElement) return;
      rowElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const selector = field === 'name' ? '.row-name' : '[data-field="value"][data-col-id="' + field + '"]';
      const input = rowElement.querySelector(selector);
      if (input) {
        window.setTimeout(function () {
          input.focus({ preventScroll: true });
          if (input.select) input.select();
        }, 80);
      }
    });
  }

  function insertRow(anchorId, below) {
    const ctx = currentList();
    if (!ctx) return;
    if (ui.editRows) {
      ui.editRows = false;
      updateEditModeUI();
    }
    resetListFiltersForAdd();
    const index = ctx.list.rows.findIndex(function (row) { return row.id === anchorId; });
    const insertAt = index === -1 ? ctx.list.rows.length : index + (below ? 1 : 0);
    const row = D.newRow(ctx.list.columns);
    const timestamp = D.nowIso();
    row.createdAt = timestamp;
    row.updatedAt = timestamp;
    ctx.list.rows.splice(insertAt, 0, row);
    ctx.list.updatedAt = timestamp;
    ctx.folder.updatedAt = timestamp;
    saveDataNow();
    renderListBody(ctx.list);
    updateListStats(ctx.list);
    focusRow(row.id, 'name');
  }

  function duplicateRow(rowId) {
    const ctx = currentList();
    if (!ctx) return;
    if (ui.editRows) {
      ui.editRows = false;
      updateEditModeUI();
    }
    const index = ctx.list.rows.findIndex(function (row) { return row.id === rowId; });
    if (index === -1) return;
    const original = ctx.list.rows[index];
    const timestamp = D.nowIso();
    const copy = D.clone(original);
    copy.id = D.uid('row');
    copy.name = original.name ? original.name + ' (copia)' : 'Copia';
    copy.createdAt = timestamp;
    copy.updatedAt = timestamp;
    ctx.list.rows.splice(index + 1, 0, copy);
    ctx.list.updatedAt = timestamp;
    ctx.folder.updatedAt = timestamp;
    saveDataNow();
    renderListBody(ctx.list);
    updateListStats(ctx.list);
    focusRow(copy.id, 'name');
    showToast('Fila duplicada.');
  }

  function moveRow(rowId, direction) {
    const ctx = currentList();
    if (!ctx) return;
    if ((settings.rowSort[ctx.list.id] || 'manual') !== 'manual') {
      showToast('Cambia a orden manual para mover filas.');
      return;
    }
    const index = ctx.list.rows.findIndex(function (row) { return row.id === rowId; });
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ctx.list.rows.length) return;
    const row = ctx.list.rows.splice(index, 1)[0];
    ctx.list.rows.splice(target, 0, row);
    const timestamp = D.nowIso();
    ctx.list.updatedAt = timestamp;
    ctx.folder.updatedAt = timestamp;
    saveDataNow();
    const scroll = window.scrollY;
    renderListBody(ctx.list);
    updateListStats(ctx.list);
    window.requestAnimationFrame(function () { window.scrollTo(0, scroll); });
  }

  function deleteRow(rowId) {
    const ctx = currentList();
    if (!ctx) return;
    const index = ctx.list.rows.findIndex(function (row) { return row.id === rowId; });
    if (index === -1) return;
    const removed = ctx.list.rows.splice(index, 1)[0];
    const timestamp = D.nowIso();
    ctx.list.updatedAt = timestamp;
    ctx.folder.updatedAt = timestamp;
    saveDataNow();

    const rowElement = document.querySelector('.row-card[data-row-id="' + rowId + '"]');
    if (rowElement) rowElement.remove();
    if (!ctx.list.rows.length) {
      ui.editRows = false;
      updateEditModeUI();
      renderListBody(ctx.list);
    }
    updateListStats(ctx.list);

    showToast('Fila eliminada.', {
      actionLabel: 'Deshacer',
      duration: 6500,
      onAction: function () {
        ctx.list.rows.splice(index, 0, removed);
        const restoreTime = D.nowIso();
        ctx.list.updatedAt = restoreTime;
        ctx.folder.updatedAt = restoreTime;
        saveDataNow();
        if (route.name === 'list' && route.id === ctx.list.id) {
          renderListBody(ctx.list);
          updateListStats(ctx.list);
        }
        showToast('Fila restaurada.');
      }
    });
  }

  function toggleDone(rowId, done) {
    const ctx = currentList();
    if (!ctx) return;
    const row = ctx.list.rows.find(function (item) { return item.id === rowId; });
    if (!row) return;
    row.done = done;
    touchRow(ctx.folder, ctx.list, row);
    flushSave();

    const rowElement = document.querySelector('.row-card[data-row-id="' + rowId + '"]');
    if (rowElement) {
      rowElement.classList.toggle('is-done', done);
      const checkbox = rowElement.querySelector('[data-check-row]');
      if (checkbox) checkbox.setAttribute('aria-label', done ? 'Marcar como pendiente' : 'Marcar como completada');
      const matches = ui.filter === 'all' || (ui.filter === 'done' ? done : !done);
      rowElement.classList.toggle('is-filtered-out', !matches);
    }
    updateListStats(ctx.list);
  }

  function openTextPrompt(options) {
    const formId = 'form_' + D.uid();
    const sheet = openSheet({
      variant: 'dialog',
      title: options.title,
      subtitle: options.subtitle || '',
      body: '<form id="' + formId + '" novalidate>' +
        '<label class="field"><span>' + esc(options.label || 'Nombre') + '</span>' +
        '<input class="input" name="value" type="text" value="' + escAttr(options.value || '') + '" placeholder="' + escAttr(options.placeholder || '') + '" autocomplete="off" enterkeyhint="done" maxlength="150"></label>' +
        '<p class="form-error" data-error hidden></p></form>',
      actions: '<button type="button" class="btn ghost" data-cancel>Cancelar</button>' +
        '<button type="submit" class="btn primary" form="' + formId + '">' + esc(options.submitLabel || 'Guardar') + '</button>'
    });
    const form = sheet.body.querySelector('form');
    const input = form.querySelector('input');
    const error = form.querySelector('[data-error]');
    sheet.actionsEl.querySelector('[data-cancel]').addEventListener('click', sheet.close);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) {
        error.hidden = false;
        error.textContent = 'Escribe un nombre.';
        input.focus();
        return;
      }
      sheet.close();
      options.onSubmit(value);
    });
    window.requestAnimationFrame(function () {
      input.focus();
      input.select();
    });
  }

  function openConfirm(options) {
    const sheet = openSheet({
      title: options.title,
      subtitle: options.subtitle || '',
      body: '<p class="sheet-text">' + options.message + '</p>',
      actions: '<button type="button" class="btn ghost" data-cancel>' + esc(options.cancelLabel || 'Cancelar') + '</button>' +
        '<button type="button" class="btn ' + (options.danger === false ? 'primary' : 'danger') + '" data-confirm>' + esc(options.confirmLabel || 'Eliminar') + '</button>'
    });
    sheet.actionsEl.querySelector('[data-cancel]').addEventListener('click', sheet.close);
    sheet.actionsEl.querySelector('[data-confirm]').addEventListener('click', function () {
      sheet.close();
      window.setTimeout(options.onConfirm, 170);
    });
  }

  function openActionSheet(options) {
    const body = '<div class="menu-list">' + options.items.map(function (item, index) {
      return '<button type="button" class="menu-item' + (item.danger ? ' danger' : '') + '" data-menu-index="' + index + '"' + (item.disabled ? ' disabled' : '') + '>' +
        '<span class="menu-icon">' + icon(item.icon || 'circle') + '</span>' +
        '<span class="menu-copy"><span>' + esc(item.label) + '</span>' + (item.hint ? '<small>' + esc(item.hint) + '</small>' : '') + '</span>' +
        '</button>';
    }).join('') + '</div>' + (options.footerHTML || '');
    const sheet = openSheet({
      title: options.title,
      subtitle: options.subtitle || '',
      body: body
    });
    sheet.body.querySelectorAll('[data-menu-index]').forEach(function (button) {
      button.addEventListener('click', function () {
        const item = options.items[Number(button.getAttribute('data-menu-index'))];
        if (!item || item.disabled) return;
        sheet.close();
        window.setTimeout(function () { if (item.onSelect) item.onSelect(); }, 170);
      });
    });
    return sheet;
  }

  function openSheet(options) {
    const opts = Object.assign({
      title: '',
      subtitle: '',
      body: '',
      actions: '',
      dismissible: true,
      onMount: null,
      className: '',
      variant: 'sheet'
    }, options || {});
    const titleId = 'sheet-title-' + (++sheetCounter);
    const overlay = document.createElement('div');
    overlay.className = 'overlay' + (opts.variant === 'dialog' ? ' is-dialog' : '');
    overlay.innerHTML = '<div class="sheet ' + opts.className + (opts.variant === 'dialog' ? ' is-dialog' : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '" tabindex="-1">' +
      '<div class="sheet-grabber" aria-hidden="true"></div>' +
      '<div class="sheet-head"><div><h2 class="sheet-title" id="' + titleId + '">' + esc(opts.title) + '</h2>' +
      (opts.subtitle ? '<p class="sheet-sub">' + esc(opts.subtitle) + '</p>' : '') + '</div>' +
      (opts.dismissible ? '<button type="button" class="icon-btn sheet-close" aria-label="Cerrar">' + icon('x') + '</button>' : '') +
      '</div>' +
      '<div class="sheet-body">' + opts.body + '</div>' +
      (opts.actions ? '<div class="sheet-actions">' + opts.actions + '</div>' : '') +
      '</div>';
    overlayRoot.appendChild(overlay);
    document.body.classList.add('no-scroll');

    const sheet = overlay.querySelector('.sheet');
    const previouslyFocused = document.activeElement;
    let closed = false;

    function onKeydown(event) {
      if (event.key === 'Escape' && opts.dismissible) {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(sheet.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter(function (element) {
        return element.offsetParent !== null;
      });
      if (!focusable.length) {
        event.preventDefault();
        sheet.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function close() {
      if (closed) return;
      closed = true;
      overlay.classList.add('is-closing');
      document.removeEventListener('keydown', onKeydown, true);
      window.setTimeout(function () {
        overlay.remove();
        if (!overlayRoot.querySelector('.overlay')) document.body.classList.remove('no-scroll');
        if (previouslyFocused && previouslyFocused.isConnected && typeof previouslyFocused.focus === 'function') {
          previouslyFocused.focus({ preventScroll: true });
        }
      }, 180);
    }

    document.addEventListener('keydown', onKeydown, true);
    overlay.addEventListener('click', function (event) {
      if (event.target === overlay && opts.dismissible) close();
    });
    const closeButton = overlay.querySelector('.sheet-close');
    if (closeButton) closeButton.addEventListener('click', close);

    const api = {
      overlay: overlay,
      sheet: sheet,
      body: overlay.querySelector('.sheet-body'),
      actionsEl: overlay.querySelector('.sheet-actions'),
      close: close
    };
    if (opts.onMount) opts.onMount(api);

    window.requestAnimationFrame(function () {
      const auto = sheet.querySelector('[autofocus]');
      if (auto) {
        auto.focus();
        if (auto.select) auto.select();
        return;
      }
      const input = sheet.querySelector('.sheet-body input, .sheet-body select, .sheet-body textarea');
      if (input) {
        input.focus();
        if (input.select) input.select();
        return;
      }
      const firstButton = sheet.querySelector('.sheet-body button, .sheet-actions button');
      if (firstButton) firstButton.focus();
      else sheet.focus();
    });

    return api;
  }

  function openSortSheet(kind, id) {
    const current = kind === 'folders' ? settings.folderSort : kind === 'lists' ? (settings.listSort[id] || 'manual') : (settings.rowSort[id] || 'manual');
    const sheet = openSheet({
      title: 'Ordenar',
      subtitle: 'Elige cómo quieres ver esta vista.',
      body: '<div class="option-list">' + D.SORT_OPTIONS.map(function (option) {
        return '<button type="button" class="option" data-sort-value="' + option.value + '" aria-checked="' + (option.value === current) + '">' +
          '<span><strong>' + esc(option.label) + '</strong><small>' + esc(option.hint) + '</small></span>' +
          icon('check', 'option-check') +
          '</button>';
      }).join('') + '</div>'
    });
    sheet.body.querySelectorAll('[data-sort-value]').forEach(function (button) {
      button.addEventListener('click', function () {
        applySort(kind, id, button.getAttribute('data-sort-value'));
        sheet.close();
      });
    });
  }

  function applySort(kind, id, value) {
    if (kind === 'folders') {
      settings.folderSort = value;
      saveSettings();
      updateSortLabel(value);
      updateHomeFolders();
      return;
    }
    if (kind === 'lists') {
      settings.listSort[id] = value;
      saveSettings();
      updateSortLabel(value);
      const folder = findFolder(id);
      if (folder) updateFolderLists(folder);
      return;
    }
    settings.rowSort[id] = value;
    saveSettings();
    updateSortLabel(value);
    const ctx = findList(id);
    if (ctx) {
      renderListBody(ctx.list);
      updateListStats(ctx.list);
    }
  }

  function updateSortLabel(value) {
    const label = document.querySelector('[data-sort-label]');
    if (label) label.textContent = D.sortLabel(value);
  }

  function openNewFolder() {
    openTextPrompt({
      title: 'Nueva carpeta',
      subtitle: 'Agrupa tus listas por tema.',
      label: 'Nombre de la carpeta',
      placeholder: 'Ej. Casa, Trabajo, Viajes',
      submitLabel: 'Crear carpeta',
      onSubmit: function (name) {
        const timestamp = D.nowIso();
        const folder = { id: D.uid('folder'), name: name, createdAt: timestamp, updatedAt: timestamp, lists: [] };
        data.folders.push(folder);
        saveDataNow();
        goFolder(folder.id);
        showToast('Carpeta creada.');
      }
    });
  }

  function openRenameFolder(folder) {
    openTextPrompt({
      title: 'Renombrar carpeta',
      label: 'Nombre de la carpeta',
      value: folder.name,
      submitLabel: 'Guardar',
      onSubmit: function (name) {
        folder.name = name;
        folder.updatedAt = D.nowIso();
        saveDataNow();
        if (route.name === 'folder' && route.id === folder.id) renderFolder();
        else if (route.name === 'home') renderHome();
        showToast('Carpeta renombrada.');
      }
    });
  }

  function openNewList(folder) {
    const formId = 'newlist_' + D.uid();
    const draft = [D.newColumn('Columna 1', 'number'), D.newColumn('Columna 2', 'number')];
    const sheet = openSheet({
      variant: 'dialog',
      title: 'Nueva lista',
      subtitle: 'Ponle un nombre y define sus columnas.',
      body: '<form id="' + formId + '" novalidate>' +
        '<label class="field"><span>Nombre de la lista</span><input class="input" name="listName" type="text" placeholder="Ej. Compras del mes" autocomplete="off" maxlength="150" autofocus></label>' +
        '<div class="field"><span>Columnas</span><div id="newColumnsEditor" class="columns-editor"></div>' +
        '<button type="button" class="btn ghost small add-column-btn" data-add-column>' + icon('plus') + 'Añadir columna</button>' +
        '<p class="hint">Puedes dejarla sin columnas si solo quieres una checklist.</p></div>' +
        '<p class="form-error" data-error hidden></p></form>',
      actions: '<button type="button" class="btn ghost" data-cancel>Cancelar</button>' +
        '<button type="submit" class="btn primary" form="' + formId + '">Crear lista</button>'
    });
    const form = sheet.body.querySelector('form');
    const nameInput = form.querySelector('input[name="listName"]');
    const error = form.querySelector('[data-error]');
    const editor = form.querySelector('#newColumnsEditor');

    function renderEditor() {
      editor.innerHTML = draft.length ? draft.map(function (column, index) {
        return '<div class="column-editor" data-col-index="' + index + '">' +
          '<div class="column-editor-main">' +
          '<input class="input col-name" type="text" value="' + escAttr(column.name) + '" aria-label="Nombre de la columna ' + (index + 1) + '" maxlength="120">' +
          '<select class="input col-type" aria-label="Tipo de la columna ' + (index + 1) + '">' +
          '<option value="text"' + (column.type === 'text' ? ' selected' : '') + '>Texto</option>' +
          '<option value="number"' + (column.type === 'number' ? ' selected' : '') + '>Número</option>' +
          '</select></div>' +
          '<div class="column-tools">' +
          '<button type="button" class="mini-btn" data-move="-1"' + (index === 0 ? ' disabled' : '') + ' aria-label="Mover arriba">' + icon('arrow-up') + '</button>' +
          '<button type="button" class="mini-btn" data-move="1"' + (index === draft.length - 1 ? ' disabled' : '') + ' aria-label="Mover abajo">' + icon('arrow-down') + '</button>' +
          '<button type="button" class="mini-btn danger" data-remove aria-label="Eliminar columna">' + icon('trash') + '</button>' +
          '</div></div>';
      }).join('') : '<p class="hint">Sin columnas. La lista funcionará como una checklist.</p>';
    }

    editor.addEventListener('input', function (event) {
      const input = event.target.closest('.col-name');
      if (!input) return;
      const index = Number(input.closest('.column-editor').getAttribute('data-col-index'));
      draft[index].name = input.value;
    });
    editor.addEventListener('change', function (event) {
      const select = event.target.closest('.col-type');
      if (!select) return;
      const index = Number(select.closest('.column-editor').getAttribute('data-col-index'));
      draft[index].type = select.value;
    });
    editor.addEventListener('click', function (event) {
      const row = event.target.closest('.column-editor');
      if (!row) return;
      const index = Number(row.getAttribute('data-col-index'));
      const move = event.target.closest('[data-move]');
      if (move) {
        const direction = Number(move.getAttribute('data-move'));
        const target = index + direction;
        if (target < 0 || target >= draft.length) return;
        const item = draft.splice(index, 1)[0];
        draft.splice(target, 0, item);
        renderEditor();
        return;
      }
      if (event.target.closest('[data-remove]')) {
        draft.splice(index, 1);
        renderEditor();
      }
    });
    form.querySelector('[data-add-column]').addEventListener('click', function () {
      draft.push(D.newColumn('Columna ' + (draft.length + 1), 'number'));
      renderEditor();
      const inputs = editor.querySelectorAll('.col-name');
      const last = inputs[inputs.length - 1];
      if (last) {
        last.focus();
        last.select();
      }
    });
    form.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && event.target.classList.contains('col-name')) event.preventDefault();
    });
    sheet.actionsEl.querySelector('[data-cancel]').addEventListener('click', sheet.close);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        error.hidden = false;
        error.textContent = 'Ponle un nombre a la lista.';
        nameInput.focus();
        return;
      }
      const timestamp = D.nowIso();
      const columns = draft.map(function (column, index) {
        return {
          id: column.id,
          name: (column.name || '').trim() || 'Columna ' + (index + 1),
          type: column.type === 'number' ? 'number' : 'text'
        };
      });
      const firstRow = D.newRow(columns);
      const list = { id: D.uid('list'), name: name, createdAt: timestamp, updatedAt: timestamp, columns: columns, rows: [firstRow] };
      folder.lists.push(list);
      folder.updatedAt = timestamp;
      saveDataNow();
      sheet.close();
      goList(list.id);
      window.setTimeout(function () { focusRow(firstRow.id, 'name'); }, 120);
      showToast('Lista creada.');
    });
    renderEditor();
    window.requestAnimationFrame(function () {
      nameInput.focus();
      nameInput.select();
    });
  }

  function openRenameList(list) {
    openTextPrompt({
      title: 'Renombrar lista',
      label: 'Nombre de la lista',
      value: list.name,
      submitLabel: 'Guardar',
      onSubmit: function (name) {
        list.name = name;
        list.updatedAt = D.nowIso();
        const ctx = findList(list.id);
        if (ctx) ctx.folder.updatedAt = list.updatedAt;
        saveDataNow();
        if (route.name === 'list' && route.id === list.id) renderList();
        else if (route.name === 'folder') renderFolder();
        showToast('Lista renombrada.');
      }
    });
  }

  function duplicateList(folder, list) {
    const index = folder.lists.indexOf(list);
    const timestamp = D.nowIso();
    const columns = list.columns.map(function (column) {
      return { id: D.uid('col'), name: column.name, type: column.type };
    });
    const rows = list.rows.map(function (row) {
      const values = {};
      list.columns.forEach(function (column, columnIndex) { values[columns[columnIndex].id] = row.values[column.id] || ''; });
      return {
        id: D.uid('row'),
        name: row.name,
        done: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        values: values
      };
    });
    const copy = {
      id: D.uid('list'),
      name: 'Copia de ' + list.name,
      createdAt: timestamp,
      updatedAt: timestamp,
      columns: columns,
      rows: rows
    };
    folder.lists.splice(index + 1, 0, copy);
    folder.updatedAt = timestamp;
    saveDataNow();
    goList(copy.id);
    showToast('Lista duplicada.');
  }

  function confirmDeleteFolder(folder) {
    const counts = D.countData({ folders: [folder] });
    const index = data.folders.indexOf(folder);
    const isCurrent = (route.name === 'folder' && route.id === folder.id) ||
      (route.name === 'list' && findList(route.id) && findList(route.id).folder.id === folder.id);
    openConfirm({
      title: 'Eliminar carpeta',
      message: 'Se eliminará <strong>' + esc(folder.name) + '</strong> con ' + plural(counts.lists, 'lista', 'listas') + ' y ' + plural(counts.rows, 'registro', 'registros') + '.',
      confirmLabel: 'Eliminar carpeta',
      onConfirm: function () {
        data.folders.splice(index, 1);
        saveDataNow();
        if (isCurrent) goHome();
        else render();
        showToast('Carpeta eliminada.', {
          actionLabel: 'Deshacer',
          duration: 6500,
          onAction: function () {
            data.folders.splice(index, 0, folder);
            saveDataNow();
            render();
            showToast('Carpeta restaurada.');
          }
        });
      }
    });
  }

  function duplicateFolder(folder) {
    const index = data.folders.indexOf(folder);
    const timestamp = D.nowIso();
    const copy = {
      id: D.uid('folder'),
      name: 'Copia de ' + folder.name,
      createdAt: timestamp,
      updatedAt: timestamp,
      lists: folder.lists.map(function (list) {
        const columns = list.columns.map(function (column) {
          return { id: D.uid('col'), name: column.name, type: column.type };
        });
        return {
          id: D.uid('list'),
          name: list.name,
          createdAt: timestamp,
          updatedAt: timestamp,
          columns: columns,
          rows: list.rows.map(function (row) {
            const values = {};
            list.columns.forEach(function (column, columnIndex) { values[columns[columnIndex].id] = row.values[column.id] || ''; });
            return {
              id: D.uid('row'),
              name: row.name,
              done: false,
              createdAt: timestamp,
              updatedAt: timestamp,
              values: values
            };
          })
        };
      })
    };
    data.folders.splice(index + 1, 0, copy);
    saveDataNow();
    goFolder(copy.id);
    showToast('Carpeta duplicada.');
  }

  function openFolderMenu(folder) {
    openActionSheet({
      title: folder.name,
      subtitle: plural(folder.lists.length, 'lista', 'listas'),
      items: [
        { icon: 'pencil', label: 'Renombrar carpeta', onSelect: function () { openRenameFolder(folder); } },
        { icon: 'copy', label: 'Duplicar carpeta', onSelect: function () { duplicateFolder(folder); } },
        { icon: 'settings', label: 'Ajustes y copias', hint: 'Importar, exportar o instalar', onSelect: openSettings },
        { icon: 'trash', label: 'Eliminar carpeta', danger: true, onSelect: function () { confirmDeleteFolder(folder); } }
      ]
    });
  }

  function openListMenu(ctx) {
    const list = ctx.list;
    openActionSheet({
      title: list.name,
      subtitle: plural(list.rows.length, 'registro', 'registros') + ' · ' + plural(list.columns.length, 'columna', 'columnas'),
      items: [
        { icon: 'columns', label: 'Editar columnas', hint: 'Añadir, renombrar o eliminar', onSelect: function () { openColumnsSheet(list); } },
        { icon: 'pencil', label: 'Renombrar lista', onSelect: function () { openRenameList(list); } },
        { icon: 'copy', label: 'Duplicar lista', onSelect: function () { duplicateList(ctx.folder, list); } },
        { icon: 'download', label: 'Exportar a CSV', hint: 'Para abrir en una hoja de cálculo', onSelect: function () { exportCSV(list); } },
        { icon: 'settings', label: 'Ajustes y copias', hint: 'Importar, exportar o instalar', onSelect: openSettings },
        { icon: 'trash', label: 'Eliminar lista', danger: true, onSelect: function () { confirmDeleteList(ctx.folder, list); } }
      ]
    });
  }

  function confirmDeleteList(folder, list) {
    const stats = D.countList(list);
    const index = folder.lists.indexOf(list);
    openConfirm({
      title: 'Eliminar lista',
      message: 'Se eliminará <strong>' + esc(list.name) + '</strong> con ' + plural(stats.total, 'registro', 'registros') + '.',
      confirmLabel: 'Eliminar lista',
      onConfirm: function () {
        folder.lists.splice(index, 1);
        folder.updatedAt = D.nowIso();
        saveDataNow();
        goFolder(folder.id);
        showToast('Lista eliminada.', {
          actionLabel: 'Deshacer',
          duration: 6500,
          onAction: function () {
            folder.lists.splice(index, 0, list);
            saveDataNow();
            goList(list.id);
            showToast('Lista restaurada.');
          }
        });
      }
    });
  }

  function openRowMenu(ctx, row) {
    const list = ctx.list;
    const index = list.rows.indexOf(row);
    const manual = (settings.rowSort[list.id] || 'manual') === 'manual';
    const boundaryHint = manual ? '' : 'Cambia a orden manual';
    openActionSheet({
      title: row.name || 'Fila sin nombre',
      subtitle: 'Creada ' + D.exactDate(row.createdAt) + ' · Editada ' + D.exactDate(row.updatedAt),
      items: [
        { icon: 'plus', label: 'Insertar fila arriba', onSelect: function () { insertRow(row.id, false); } },
        { icon: 'plus', label: 'Insertar fila abajo', onSelect: function () { insertRow(row.id, true); } },
        { icon: 'copy', label: 'Duplicar fila', onSelect: function () { duplicateRow(row.id); } },
        { icon: 'arrow-up', label: 'Mover arriba', disabled: !manual || index === 0, hint: boundaryHint, onSelect: function () { moveRow(row.id, -1); } },
        { icon: 'arrow-down', label: 'Mover abajo', disabled: !manual || index === list.rows.length - 1, hint: boundaryHint, onSelect: function () { moveRow(row.id, 1); } },
        { icon: 'trash', label: 'Eliminar fila', danger: true, onSelect: function () { deleteRow(row.id); } }
      ]
    });
  }

  function openColumnsSheet(list) {
    const draft = list.columns.map(function (column) { return { id: column.id, name: column.name, type: column.type }; });
    let confirmDelete = false;
    const sheet = openSheet({
      title: 'Columnas',
      subtitle: 'Añade, renombra, ordena o elimina columnas.',
      body: '<div id="columnsEditor" class="columns-editor"></div>' +
        '<button type="button" class="btn ghost small add-column-btn" data-add-column>' + icon('plus') + 'Añadir columna</button>' +
        '<div id="deleteWarning" class="warning-box" hidden></div>',
      actions: '<button type="button" class="btn ghost" data-cancel>Cancelar</button>' +
        '<button type="button" class="btn primary" data-save>Guardar cambios</button>'
    });
    const editor = sheet.body.querySelector('#columnsEditor');
    const warning = sheet.body.querySelector('#deleteWarning');
    const saveButton = sheet.actionsEl.querySelector('[data-save]');

    function deletedColumns() {
      return list.columns.filter(function (column) {
        return !draft.some(function (item) { return item.id === column.id; });
      });
    }

    function deletedValueCount() {
      return deletedColumns().reduce(function (total, column) {
        return total + list.rows.filter(function (row) { return String(row.values[column.id] || '').trim() !== ''; }).length;
      }, 0);
    }

    function updateWarning() {
      const deleted = deletedColumns();
      const count = deletedValueCount();
      if (!deleted.length || !count) {
        warning.hidden = true;
        warning.innerHTML = '';
        saveButton.disabled = false;
        return;
      }
      warning.hidden = false;
      warning.innerHTML = '<strong>Se eliminarán ' + count + ' valores</strong>' +
        '<p>' + deleted.map(function (column) { return esc(column.name); }).join(', ') + (deleted.length === 1 ? ' tiene' : ' tienen') + ' datos guardados.</p>' +
        '<label class="check-line"><input type="checkbox" data-confirm-delete' + (confirmDelete ? ' checked' : '') + '> Entiendo que se perderán esos valores</label>';
      const check = warning.querySelector('[data-confirm-delete]');
      check.addEventListener('change', function () {
        confirmDelete = check.checked;
        saveButton.disabled = !confirmDelete;
      });
      saveButton.disabled = !confirmDelete;
    }

    function renderEditor() {
      editor.innerHTML = draft.length ? draft.map(function (column, index) {
        return '<div class="column-editor" data-col-index="' + index + '">' +
          '<div class="column-editor-main">' +
          '<input class="input col-name" type="text" value="' + escAttr(column.name) + '" aria-label="Nombre de la columna ' + (index + 1) + '" maxlength="120">' +
          '<select class="input col-type" aria-label="Tipo de la columna ' + (index + 1) + '">' +
          '<option value="text"' + (column.type === 'text' ? ' selected' : '') + '>Texto</option>' +
          '<option value="number"' + (column.type === 'number' ? ' selected' : '') + '>Número</option>' +
          '</select></div>' +
          '<div class="column-tools">' +
          '<button type="button" class="mini-btn" data-move="-1"' + (index === 0 ? ' disabled' : '') + ' aria-label="Mover arriba">' + icon('arrow-up') + '</button>' +
          '<button type="button" class="mini-btn" data-move="1"' + (index === draft.length - 1 ? ' disabled' : '') + ' aria-label="Mover abajo">' + icon('arrow-down') + '</button>' +
          '<button type="button" class="mini-btn danger" data-remove aria-label="Eliminar columna">' + icon('trash') + '</button>' +
          '</div></div>';
      }).join('') : '<p class="hint">Esta lista no tiene columnas. Puedes añadir una o dejarla como checklist.</p>';
      updateWarning();
    }

    editor.addEventListener('input', function (event) {
      const input = event.target.closest('.col-name');
      if (!input) return;
      const index = Number(input.closest('.column-editor').getAttribute('data-col-index'));
      draft[index].name = input.value;
    });
    editor.addEventListener('change', function (event) {
      const select = event.target.closest('.col-type');
      if (!select) return;
      const index = Number(select.closest('.column-editor').getAttribute('data-col-index'));
      draft[index].type = select.value;
    });
    editor.addEventListener('click', function (event) {
      const row = event.target.closest('.column-editor');
      if (!row) return;
      const index = Number(row.getAttribute('data-col-index'));
      const move = event.target.closest('[data-move]');
      if (move) {
        const direction = Number(move.getAttribute('data-move'));
        const target = index + direction;
        if (target < 0 || target >= draft.length) return;
        const item = draft.splice(index, 1)[0];
        draft.splice(target, 0, item);
        renderEditor();
        return;
      }
      if (event.target.closest('[data-remove]')) {
        draft.splice(index, 1);
        renderEditor();
      }
    });
    sheet.body.querySelector('[data-add-column]').addEventListener('click', function () {
      draft.push(D.newColumn('Columna ' + (draft.length + 1), 'number'));
      renderEditor();
      const inputs = editor.querySelectorAll('.col-name');
      const last = inputs[inputs.length - 1];
      if (last) {
        last.focus();
        last.select();
      }
    });
    sheet.actionsEl.querySelector('[data-cancel]').addEventListener('click', sheet.close);
    saveButton.addEventListener('click', function () {
      const deleted = deletedColumns();
      const count = deletedValueCount();
      if (deleted.length && count && !confirmDelete) {
        updateWarning();
        return;
      }
      list.columns = draft.map(function (column, index) {
        return {
          id: column.id,
          name: (column.name || '').trim() || 'Columna ' + (index + 1),
          type: column.type === 'number' ? 'number' : 'text'
        };
      });
      list.rows.forEach(function (row) {
        const values = {};
        list.columns.forEach(function (column) { values[column.id] = row.values[column.id] || ''; });
        row.values = values;
      });
      const timestamp = D.nowIso();
      list.updatedAt = timestamp;
      const ctx = findList(list.id);
      if (ctx) ctx.folder.updatedAt = timestamp;
      saveDataNow();
      sheet.close();
      renderList();
      showToast('Columnas actualizadas.');
    });
    renderEditor();
  }

  function openSettings() {
    const legacyBackup = safeGet(D.KEYS.legacyBackup);
    const importBackup = safeGet(D.KEYS.importBackup);
    const standalone = isStandalone();
    const bytes = new Blob([JSON.stringify(data)]).size;
    const installLabel = standalone ? 'App instalada' : 'Instalar en el dispositivo';
    const installHint = standalone ? 'Ya estás usando la versión instalada' : (isIOS() ? 'Añadir a pantalla de inicio' : 'Acceso directo y uso sin conexión');

    const sheet = openSheet({
      title: 'Ajustes',
      subtitle: 'Copias, instalación y almacenamiento.',
      body: '<div class="settings-group"><h3 class="settings-title">Copia de seguridad</h3>' +
        '<button type="button" class="menu-item" data-setting="export">' + icon('download') + '<span class="menu-copy"><span>Exportar copia</span><small>Descarga un archivo JSON con todo</small></span></button>' +
        '<button type="button" class="menu-item" data-setting="import">' + icon('upload') + '<span class="menu-copy"><span>Importar copia</span><small>Restaura desde un archivo JSON</small></span></button>' +
        (legacyBackup ? '<button type="button" class="menu-item" data-setting="restore-legacy">' + icon('restore') + '<span class="menu-copy"><span>Restaurar datos anteriores</span><small>Copia creada al actualizar la app</small></span></button>' : '') +
        (importBackup ? '<button type="button" class="menu-item" data-setting="restore-import">' + icon('restore') + '<span class="menu-copy"><span>Restaurar última importación</span><small>Vuelve a los datos previos a importar</small></span></button>' : '') +
        '</div>' +
        '<div class="settings-group"><h3 class="settings-title">Aplicación</h3>' +
        '<button type="button" class="menu-item" data-setting="install"' + (standalone ? ' disabled' : '') + '>' + icon('install') + '<span class="menu-copy"><span>' + esc(installLabel) + '</span><small>' + esc(installHint) + '</small></span></button>' +
        '<div class="storage-info"><span>Datos guardados: ' + esc(formatBytes(bytes)) + '</span><span>Versión ' + esc(D.APP_VERSION) + '</span></div>' +
        '</div>',
      actions: '<button type="button" class="btn ghost" data-close>Cerrar</button>'
    });
    sheet.actionsEl.querySelector('[data-close]').addEventListener('click', sheet.close);
    sheet.body.querySelector('[data-setting="export"]').addEventListener('click', function () { exportJSON(); });
    sheet.body.querySelector('[data-setting="import"]').addEventListener('click', function () { sheet.close(); window.setTimeout(importJSON, 180); });
    sheet.body.querySelector('[data-setting="install"]').addEventListener('click', function () { if (!standalone) { sheet.close(); window.setTimeout(installApp, 180); } });
    const legacyButton = sheet.body.querySelector('[data-setting="restore-legacy"]');
    if (legacyButton) legacyButton.addEventListener('click', function () { sheet.close(); window.setTimeout(function () { restoreBackup(D.KEYS.legacyBackup, 'datos anteriores'); }, 180); });
    const importButton = sheet.body.querySelector('[data-setting="restore-import"]');
    if (importButton) importButton.addEventListener('click', function () { sheet.close(); window.setTimeout(function () { restoreBackup(D.KEYS.importBackup, 'última importación'); }, 180); });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1).replace('.', ',') + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
  }

  function exportJSON() {
    const payload = D.exportPayload(data);
    downloadFile(JSON.stringify(payload, null, 2), 'mis-listas-' + dateStamp() + '.json', 'application/json');
    showToast('Copia de seguridad descargada.');
  }

  function exportCSV(list) {
    const headers = ['Nombre'].concat(list.columns.map(function (column) { return column.name; }), ['Completada']);
    const rows = list.rows.map(function (row) {
      return [row.name].concat(list.columns.map(function (column) { return row.values[column.id] || ''; }), [row.done ? 'Sí' : 'No']);
    });
    const csv = '\ufeff' + [headers].concat(rows).map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n');
    downloadFile(csv, safeFilename(list.name) + '.csv', 'text/csv;charset=utf-8');
    showToast('CSV descargado.');
  }

  function csvCell(value) {
    const text = String(value === null || value === undefined ? '' : value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function safeFilename(value) {
    return String(value || 'lista').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'lista';
  }

  function dateStamp() {
    const date = new Date();
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
  }

  function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type: type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  function importJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      file.text().then(function (text) {
        let raw;
        try {
          raw = JSON.parse(String(text).replace(/^\uFEFF/, ''));
        } catch (error) {
          throw new Error('invalid');
        }
        const source = raw && raw.data && Array.isArray(raw.data.folders) ? raw.data : raw;
        if (!source || !Array.isArray(source.folders)) throw new Error('invalid');
        const imported = D.normalizeData(source);
        showImportPreview(imported, raw && raw.exportedAt);
      }).catch(function () {
        showToast('El archivo no es una copia válida de Mis listas.', { tone: 'error', duration: 5000 });
      });
    });
    input.click();
  }

  function showImportPreview(imported, exportedAt) {
    const counts = D.countData(imported);
    const sheet = openSheet({
      title: 'Importar copia',
      subtitle: exportedAt ? 'Creada el ' + D.exactDate(exportedAt) : 'Copia de seguridad de Mis listas',
      body: '<p class="sheet-text">Se reemplazarán tus datos actuales. Antes de importar guardaremos una copia de lo que tienes ahora.</p>' +
        '<div class="summary-grid">' +
        '<div><strong>' + counts.folders + '</strong><span>Carpetas</span></div>' +
        '<div><strong>' + counts.lists + '</strong><span>Listas</span></div>' +
        '<div><strong>' + counts.rows + '</strong><span>Registros</span></div>' +
        '</div>',
      actions: '<button type="button" class="btn ghost" data-cancel>Cancelar</button>' +
        '<button type="button" class="btn primary" data-import>Importar</button>'
    });
    sheet.actionsEl.querySelector('[data-cancel]').addEventListener('click', sheet.close);
    sheet.actionsEl.querySelector('[data-import]').addEventListener('click', function () {
      const current = safeGet(D.KEYS.data) || JSON.stringify(data);
      safeSet(D.KEYS.importBackup, current);
      data = imported;
      saveDataNow();
      sheet.close();
      history.replaceState(null, '', location.pathname + location.search + '#/');
      route = { name: 'home', key: 'home' };
      resetSearchAndFilter();
      render();
      showToast('Copia importada.');
    });
  }

  function restoreBackup(key, label) {
    const raw = safeGet(key);
    if (!raw) {
      showToast('No hay una copia disponible.', { tone: 'error' });
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      showToast('La copia no se puede leer.', { tone: 'error' });
      return;
    }
    const restored = D.normalizeData(parsed);
    const counts = D.countData(restored);
    openConfirm({
      title: 'Restaurar ' + label,
      message: 'Se reemplazarán tus datos actuales por ' + plural(counts.folders, 'carpeta', 'carpetas') + ' y ' + plural(counts.rows, 'registro', 'registros') + '.',
      confirmLabel: 'Restaurar',
      danger: false,
      onConfirm: function () {
        if (key !== D.KEYS.importBackup) {
          safeSet(D.KEYS.importBackup, safeGet(D.KEYS.data) || JSON.stringify(data));
        }
        data = restored;
        saveDataNow();
        history.replaceState(null, '', location.pathname + location.search + '#/');
        route = { name: 'home', key: 'home' };
        resetSearchAndFilter();
        render();
        showToast('Copia restaurada.');
      }
    });
  }

  function setupPWA() {
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      deferredInstallPrompt = event;
    });
    window.addEventListener('appinstalled', function () {
      deferredInstallPrompt = null;
      showToast('App instalada.');
    });
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isIOS() {
    const userAgent = window.navigator.userAgent || '';
    return /iphone|ipad|ipod/i.test(userAgent) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  }

  function installApp() {
    if (isStandalone()) {
      showToast('Ya estás usando la app instalada.');
      return;
    }
    if (deferredInstallPrompt) {
      const prompt = deferredInstallPrompt;
      deferredInstallPrompt = null;
      prompt.prompt();
      return;
    }
    if (isIOS()) {
      const sheet = openSheet({
        title: 'Instalar en iPhone o iPad',
        subtitle: 'Añádela a tu pantalla de inicio.',
        body: '<ol class="steps"><li>Abre esta página en <strong>Safari</strong>.</li><li>Toca el botón <strong>Compartir</strong>.</li><li>Elige <strong>Añadir a pantalla de inicio</strong>.</li></ol>',
        actions: '<button type="button" class="btn primary" data-close>Entendido</button>'
      });
      sheet.actionsEl.querySelector('[data-close]').addEventListener('click', sheet.close);
      return;
    }
    showToast('Abre el menú del navegador y elige «Instalar aplicación» o «Añadir a pantalla de inicio».', { duration: 7000 });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('./sw.js').then(function (registration) {
      swRegistration = registration;
      if (registration.waiting && navigator.serviceWorker.controller) showUpdateToast(registration.waiting);
      registration.addEventListener('updatefound', function () {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', function () {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateToast(worker);
        });
      });
    }).catch(function () {});
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });
    window.setInterval(function () {
      if (swRegistration) swRegistration.update().catch(function () {});
    }, 60 * 60 * 1000);
  }

  function showUpdateToast(worker) {
    if (updateToastShown) return;
    updateToastShown = true;
    showToast('Hay una versión nueva disponible.', {
      actionLabel: 'Actualizar',
      duration: 12000,
      onAction: function () { worker.postMessage({ type: 'SKIP_WAITING' }); }
    });
  }

  function showToast(message, options) {
    const opts = Object.assign({ duration: 3800, actionLabel: '', onAction: null, tone: '' }, options || {});
    const element = document.createElement('div');
    element.className = 'toast' + (opts.tone ? ' toast-' + opts.tone : '');
    element.setAttribute('role', 'status');
    element.innerHTML = '<span class="toast-text">' + esc(message) + '</span>' +
      (opts.actionLabel ? '<button type="button" class="toast-action">' + esc(opts.actionLabel) + '</button>' : '');
    toastRoot.appendChild(element);
    while (toastRoot.children.length > 3) toastRoot.firstElementChild.remove();
    const timer = window.setTimeout(remove, opts.duration);
    function remove() {
      window.clearTimeout(timer);
      element.classList.add('is-leaving');
      window.setTimeout(function () { element.remove(); }, 180);
    }
    if (opts.actionLabel) {
      element.querySelector('.toast-action').addEventListener('click', function () {
        remove();
        if (opts.onAction) opts.onAction();
      });
    }
    return remove;
  }

  function handleAppClick(event) {
    if (ui.editRows) {
      const rowElement = event.target.closest('.row-card');
      if (rowElement && !event.target.closest('[data-check-row]')) {
        const ctx = currentList();
        if (ctx) {
          const row = ctx.list.rows.find(function (item) { return item.id === rowElement.getAttribute('data-row-id'); });
          if (row) {
            openRowMenu(ctx, row);
            return;
          }
        }
      }
    }

    const target = event.target.closest('[data-action]');
    if (!target || target.disabled) return;
    const action = target.getAttribute('data-action');
    const id = target.getAttribute('data-id');

    if (action === 'open-folder') {
      if (id) goFolder(id);
      return;
    }
    if (action === 'open-list') {
      if (id) goList(id);
      return;
    }
    if (action === 'go-home') {
      goHome();
      return;
    }
    if (action === 'go-folder') {
      const ctx = currentList();
      if (ctx) goFolder(ctx.folder.id);
      else goHome();
      return;
    }
    if (action === 'new-folder') {
      openNewFolder();
      return;
    }
    if (action === 'new-list') {
      const folder = currentFolder() || (id ? findFolder(id) : null);
      if (folder) openNewList(folder);
      return;
    }
    if (action === 'toggle-row-edit') {
      const ctx = currentList();
      if (!ctx || !ctx.list.rows.length) return;
      setRowEditMode(!ui.editRows);
      return;
    }
    if (action === 'add-row') {
      addRow();
      return;
    }
    if (action === 'folder-menu') {
      const folder = (id ? findFolder(id) : null) || currentFolder();
      if (folder) openFolderMenu(folder);
      return;
    }
    if (action === 'list-menu') {
      const ctx = (id ? findList(id) : null) || currentList();
      if (ctx) openListMenu(ctx);
      return;
    }
    if (action === 'open-settings') {
      openSettings();
      return;
    }
    if (action === 'sort-folders') {
      openSortSheet('folders');
      return;
    }
    if (action === 'sort-lists') {
      openSortSheet('lists', id || (currentFolder() && currentFolder().id));
      return;
    }
    if (action === 'sort-rows') {
      openSortSheet('rows', id || (currentList() && currentList().list.id));
      return;
    }
    if (action === 'filter') {
      ui.filter = target.getAttribute('data-filter') || 'all';
      const ctx = currentList();
      if (ctx) {
        renderListBody(ctx.list);
        updateListStats(ctx.list);
      }
      return;
    }
    if (action === 'clear-search') {
      const scope = target.getAttribute('data-scope');
      if (!scope) return;
      ui.search[scope] = '';
      const input = document.querySelector('[data-search="' + scope + '"]');
      if (input) {
        input.value = '';
        toggleSearchClear(input);
      }
      if (scope === 'home') updateHomeFolders();
      else if (scope === 'folder' && currentFolder()) updateFolderLists(currentFolder());
      else if (scope === 'list' && currentList()) {
        renderListBody(currentList().list);
        updateListStats(currentList().list);
      }
      return;
    }
    if (action === 'open-columns') {
      const ctx = currentList();
      if (ctx) openColumnsSheet(ctx.list);
    }
  }

  function handleAppInput(event) {
    const search = event.target.closest('[data-search]');
    if (search) {
      const scope = search.getAttribute('data-search');
      ui.search[scope] = search.value;
      toggleSearchClear(search);
      if (scope === 'home') updateHomeFolders();
      else if (scope === 'folder' && currentFolder()) updateFolderLists(currentFolder());
      else if (scope === 'list') {
        const ctx = currentList();
        if (ctx) {
          renderListBody(ctx.list);
          updateListStats(ctx.list);
        }
      }
      return;
    }
    const field = event.target.closest('[data-field]');
    if (field) {
      if (field.classList.contains('row-name')) adjustNameField(field);
      syncValueDisplay(field);
      updateFieldFromInput(field);
    }
  }

  function handleAppChange(event) {
    const checkbox = event.target.closest('[data-check-row]');
    if (checkbox) {
      toggleDone(checkbox.getAttribute('data-check-row'), checkbox.checked);
    }
  }

  function handleAppFocusIn(event) {
    const field = event.target.closest('[data-field]');
    if (!field) return;
    field.dataset.original = field.value;
    field.closest('.value-field') && field.closest('.value-field').classList.add('is-focused');
    if (field.select) field.select();
  }

  function handleAppKeydown(event) {
    const search = event.target.closest('[data-search]');
    if (search) {
      if (event.key === 'Enter') {
        event.preventDefault();
        search.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        search.value = '';
        ui.search[search.getAttribute('data-search')] = '';
        toggleSearchClear(search);
        search.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }

    if (ui.editRows) {
      const rowElement = event.target.closest('.row-card');
      if (rowElement && event.target === rowElement && (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar')) {
        event.preventDefault();
        const ctx = currentList();
        if (ctx) {
          const row = ctx.list.rows.find(function (item) { return item.id === rowElement.getAttribute('data-row-id'); });
          if (row) openRowMenu(ctx, row);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setRowEditMode(false);
        return;
      }
    }

    const field = event.target.closest('[data-field]');
    if (!field) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      commitField(field, true);
      moveFocusFromField(field, 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      field.value = field.dataset.original || '';
      const ctx = currentList();
      if (ctx) {
        const rowElement = field.closest('.row-card');
        const row = ctx.list.rows.find(function (item) { return item.id === rowElement.getAttribute('data-row-id'); });
        if (row) {
          if (field.getAttribute('data-field') === 'name') row.name = field.value;
          else {
            row.values[field.getAttribute('data-col-id')] = field.value;
            syncValueDisplay(field);
          }
          touchRow(ctx.folder, ctx.list, row);
          updateListStats(ctx.list);
        }
      }
      field.blur();
    }
  }

  function moveFocusFromField(field, direction) {
    const rowElement = field.closest('.row-card');
    const body = document.getElementById('listBody');
    if (!rowElement || !body) return;
    const rows = Array.from(body.querySelectorAll('.row-card:not(.is-filtered-out)'));
    const index = rows.indexOf(rowElement);
    const target = rows[index + direction];
    const isName = field.getAttribute('data-field') === 'name';
    const columnId = field.getAttribute('data-col-id');

    if (target) {
      const next = isName ? target.querySelector('.row-name') : target.querySelector('[data-field="value"][data-col-id="' + columnId + '"]');
      if (next) {
        next.focus();
        if (next.select) next.select();
      }
      return;
    }

    if (direction > 0) addRow({ focusField: isName ? 'name' : columnId });
  }

  function handleFieldBlur(event) {
    const field = event.target.closest('[data-field]');
    if (!field) return;
    const valueField = field.closest('.value-field');
    if (valueField) valueField.classList.remove('is-focused');
    commitField(field, true);
  }

  function bindEvents() {
    window.addEventListener('hashchange', function () { handleRoute(); });
    app.addEventListener('click', handleAppClick);
    app.addEventListener('input', handleAppInput);
    app.addEventListener('change', handleAppChange);
    app.addEventListener('focusin', handleAppFocusIn);
    app.addEventListener('keydown', handleAppKeydown);
    app.addEventListener('focusout', handleFieldBlur);
    window.addEventListener('pagehide', flushSave);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flushSave();
    });
    window.addEventListener('online', function () { showToast('Conexión restablecida.'); });
    window.addEventListener('offline', function () { showToast('Sin conexión. Tus datos siguen guardados en este dispositivo.', { duration: 5000 }); });
  }

  function init() {
    load();
    bindEvents();
    setupPWA();
    if (!location.hash) history.replaceState(null, '', location.pathname + location.search + '#/');
    handleRoute(true);
    if (bootNotice) window.setTimeout(function () { showToast(bootNotice, { duration: 7000 }); }, 420);
    registerServiceWorker();
  }

  init();
})();
