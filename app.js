const BASE_URL = 'https://appaficion' + 'feg' + 'aba.gesdeportiva.es';
const COOKIE_DAYS = 365;
const PAGE_SIZE = 50;
const INITIAL_MATCH_SEARCH_PAGE_CAP = 512;
const MAX_MATCH_SEARCH_PAGE_CAP = 8192;
const STORAGE_PREFIX = 'baloncesto_galego';

const searchConfig = {
  player: { label: 'Xogadores', action: 'buscarJugador', keys: ['jugadores'], extra: { nombre: '' }, listOnOpen: false },
  team: { label: 'Equipos', action: 'buscarEquipo', keys: ['equipos'] },
  club: { label: 'Clubs', action: 'buscarClub', keys: ['clubes'] },
  category: { label: 'Categorías', action: 'buscarCategoria', keys: ['categorias'] },
  match: { label: 'Partidos', action: 'buscarPartido', keys: ['partidos'] },
};

const state = {
  view: 'home',
  auth: readAuth(),
  detailCache: new Map(),
  searchCache: new Map(),
  currentDetailItem: null,
  currentDetailData: null,
  currentQuery: '',
  currentSkip: 0,
  routeIndex: 0,
};

const els = {
  content: document.getElementById('content'),
  identityBtn: document.getElementById('identityBtn'),
  identityDialog: document.getElementById('identityDialog'),
  uidInput: document.getElementById('uidInput'),
  registerBtn: document.getElementById('registerBtn'),
  clearBtn: document.getElementById('clearBtn'),
  identityStatus: document.getElementById('identityStatus'),
  deviceIdView: document.getElementById('deviceIdView'),
  keyView: document.getElementById('keyView'),
  tabs: [...document.querySelectorAll('.tab')],
};

function setCookie(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${COOKIE_DAYS * 86400}; path=/; SameSite=Lax`;
}

function getCookie(name) {
  const row = document.cookie.split('; ').find((entry) => entry.startsWith(`${name}=`));
  return row ? decodeURIComponent(row.slice(name.length + 1)) : '';
}

function deleteCookie(name) {
  document.cookie = `${name}=; max-age=0; path=/; SameSite=Lax`;
}

function makeUid() {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `webapp-${random}`;
}

function readAuth() {
  return {
    uid: getCookie(`${STORAGE_PREFIX}_uid`) || makeUid(),
    id_dispositivo: getCookie(`${STORAGE_PREFIX}_id_dispositivo`),
    key: getCookie(`${STORAGE_PREFIX}_key`),
    ruta: getCookie(`${STORAGE_PREFIX}_ruta`) || `${BASE_URL}/`,
  };
}

function saveAuth(auth) {
  setCookie(`${STORAGE_PREFIX}_uid`, auth.uid || makeUid());
  setCookie(`${STORAGE_PREFIX}_id_dispositivo`, auth.id_dispositivo || '');
  setCookie(`${STORAGE_PREFIX}_key`, auth.key || '');
  setCookie(`${STORAGE_PREFIX}_ruta`, auth.ruta || `${BASE_URL}/`);
  state.auth = readAuth();
  renderIdentity();
}

function applyAuthResponse(data, fallback = {}) {
  if (!data || typeof data !== 'object') return;
  const next = { ...state.auth, ...fallback };
  if (data.id_dispositivo) next.id_dispositivo = data.id_dispositivo;
  if (data.key) next.key = data.key;
  if (data.ruta) next.ruta = data.ruta;
  saveAuth(next);
}

async function post(path, params, includeAuth = true) {
  const body = new URLSearchParams();
  const merged = { ...params };
  if (includeAuth) {
    merged.id_dispositivo = state.auth.id_dispositivo;
    merged.key = state.auth.key;
  }
  Object.entries(merged).forEach(([key, value]) => {
    if (value !== undefined && value !== null) body.append(key, value);
  });
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = JSON.parse(await res.text());
  applyAuthResponse(data);
  return data;
}

async function registerDevice() {
  const uid = els.uidInput.value.trim() || state.auth.uid || makeUid();
  const data = await post('/dispositivo.ashx', {
    accion: 'registrar',
    uid,
    plataforma: 'android',
    tipo_dispositivo: 'android',
    version: '5.0.34',
  }, false);
  applyAuthResponse(data, { uid });
  return data;
}

async function ensureAuth() {
  if (state.auth.id_dispositivo && state.auth.key) return;
  await registerDevice();
}

function renderIdentity() {
  els.uidInput.value = state.auth.uid;
  const ready = Boolean(state.auth.id_dispositivo && state.auth.key);
  els.identityStatus.textContent = ready ? 'Rexistrado' : 'Sen rexistrar';
  els.identityStatus.style.color = ready ? 'var(--ok)' : 'var(--danger)';
  els.deviceIdView.textContent = state.auth.id_dispositivo || '-';
  els.keyView.textContent = state.auth.key || '-';
}

function clearAuth() {
  [`${STORAGE_PREFIX}_uid`, `${STORAGE_PREFIX}_id_dispositivo`, `${STORAGE_PREFIX}_key`, `${STORAGE_PREFIX}_ruta`].forEach(deleteCookie);
  [`${STORAGE_PREFIX}_favorite_players`, `${STORAGE_PREFIX}_favorite_teams`, `${STORAGE_PREFIX}_favorite_matches`].forEach((key) => localStorage.removeItem(key));
  state.auth = readAuth();
  state.detailCache.clear();
  state.searchCache.clear();
  renderIdentity();
  renderMessage('Identidade e cache local borradas. A app volverá rexistrarse cando sexa necesario.');
}

function setView(view, options = {}) {
  const query = options.query ?? '';
  const skip = cleanSkip(options.skip);
  state.view = view;
  state.currentDetailItem = null;
  state.currentDetailData = null;
  state.currentQuery = query;
  state.currentSkip = skip;
  setActiveTab(view);
  if (!options.fromRoute) writeRoute({ view, query, skip });
  if (view === 'home') loadHome().catch(showError);
  if (searchConfig[view]) loadBrowsePage(view, { query, skip }).catch(showError);
}

function setActiveTab(view, detailType) {
  const activeView = view === 'detail' ? detailType : view;
  els.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.view === activeView));
}

function readRoute() {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const type = params.get('type');
  const id = params.get('id');
  if ((view === 'detail' || (type && id)) && searchConfig[type] && id) {
    return {
      view: 'detail',
      type,
      id,
      local: params.get('local') || '',
      visitor: params.get('visitor') || '',
      date: params.get('date') || '',
      time: params.get('time') || '',
      status: params.get('status') || '',
      localScore: params.get('localScore') || '',
      visitorScore: params.get('visitorScore') || '',
      court: params.get('court') || '',
      competition: params.get('competition') || '',
      category: params.get('category') || '',
      name: params.get('name') || '',
      delegation: params.get('delegation') || '',
      phaseId: params.get('phaseId') || '',
      phaseName: params.get('phaseName') || '',
      groupId: params.get('groupId') || '',
      groupName: params.get('groupName') || '',
      roundId: params.get('roundId') || '',
      roundName: params.get('roundName') || '',
      phaseType: params.get('phaseType') || '',
    };
  }
  if (searchConfig[view]) {
    return {
      view,
      query: params.get('q') || '',
      skip: cleanSkip(params.get('skip')),
    };
  }
  return { view: 'home' };
}

function writeRoute(route, replace = false) {
  const index = replace ? state.routeIndex : state.routeIndex + 1;
  const url = routeUrl(route);
  const historyState = { app: 'baloncesto-galego', route, index };
  if (replace) window.history.replaceState(historyState, '', url);
  else window.history.pushState(historyState, '', url);
  state.routeIndex = index;
}

function routeUrl(route) {
  const url = new URL(window.location.href);
  url.search = '';
  if (route.view === 'detail') {
    url.searchParams.set('view', 'detail');
    url.searchParams.set('type', route.type);
    url.searchParams.set('id', route.id);
    ['local', 'visitor', 'date', 'time', 'status', 'localScore', 'visitorScore', 'court', 'competition', 'category', 'name', 'delegation', 'phaseId', 'phaseName', 'groupId', 'groupName', 'roundId', 'roundName', 'phaseType'].forEach((key) => {
      if (route[key]) url.searchParams.set(key, route[key]);
    });
    return url;
  }
  if (route.view && route.view !== 'home') {
    url.searchParams.set('view', route.view);
    if (route.query) url.searchParams.set('q', route.query);
    if (cleanSkip(route.skip) > 0) url.searchParams.set('skip', String(cleanSkip(route.skip)));
  }
  return url;
}

function applyRoute(route) {
  if (route.view === 'detail') {
    openDetail(routeItem(route), false).catch(showError);
    return;
  }
  setView(route.view, {
    query: route.query || '',
    skip: cleanSkip(route.skip),
    fromRoute: true,
  });
}

function routeItem(type, id) {
  if (typeof type === 'object') {
    const route = type;
    if (route.type === 'match') {
      return {
        type: 'match',
        IdPartido: route.id,
        NombreEquipoLocal: route.local,
        NombreEquipoVisitante: route.visitor,
        Fecha: route.date,
        Hora: route.time,
        Estado: route.status,
        CampoJuego: route.court,
        Competicion: route.competition,
        Categoria: route.category,
        Resultados: {
          ResultadoLocal: route.localScore,
          ResultadoVisitante: route.visitorScore,
        },
      };
    }
    if (route.type === 'category') {
      return {
        type: 'category',
        Id: route.id,
        NombreCategoria: route.name || route.category,
        NombreCompeticion: route.competition,
        NombreDelegacion: route.delegation,
        selectedPhaseId: route.phaseId,
        selectedPhaseName: route.phaseName,
        selectedGroupId: route.groupId,
        selectedGroupName: route.groupName,
        selectedRoundId: route.roundId,
        selectedRoundName: route.roundName,
        selectedPhaseType: route.phaseType,
      };
    }
    return routeItem(route.type, route.id);
  }
  if (type === 'match') return { type, IdPartido: id };
  return { type, Id: id };
}

function cleanSkip(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed / PAGE_SIZE) * PAGE_SIZE;
}

function renderMessage(message) {
  els.content.innerHTML = `<div class="message">${escapeHtml(message)}</div>`;
}

function showError(error) {
  renderMessage(error.message || String(error));
}

async function loadHome() {
  renderMessage('Cargando inicio...');
  await ensureAuth();
  const [players, teams, matches] = await Promise.all([
    getFavoritePlayers(),
    getFavoriteTeams(),
    getUpcomingMatches(30),
  ]);
  els.content.innerHTML = `
    ${renderPanel('Os meus xogadores', players.slice(0, 6), 'Aínda non hai xogadores gardados.')}
    ${renderPanel('Os meus equipos', teams.slice(0, 6), 'Aínda non hai equipos gardados.')}
    ${renderPanel('Próximos partidos', matches.slice(0, 8), 'Non se atoparon próximos partidos.')}
  `;
  attachCardHandlers();
}

async function loadBrowsePage(type, options = {}) {
  const config = searchConfig[type];
  const query = options.query ?? '';
  const skip = cleanSkip(options.skip);
  state.currentQuery = query;
  state.currentSkip = skip;
  renderBrowsePage(type, query);
  await ensureAuth();
  if (config.listOnOpen === false) {
    if (!query) {
      updateSearchResults([], 'Introduce un nome para buscar xogadores.', config.label, { type, query, skip });
      return;
    }
  }
  await runSearch(type, query, skip, query ? 'Resultados da busca' : config.label);
}

function renderBrowsePage(type, query = '') {
  const config = searchConfig[type];
  els.content.dataset.entityType = type;
  els.content.innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <h2>${escapeHtml(config.label)}</h2>
        <span class="muted">${escapeHtml(labelFor(type))}</span>
      </div>
      <div class="searchbar">
        <input id="searchInput" value="${escapeHtml(query)}" placeholder="Buscar ${config.label.toLowerCase()}">
        <button id="searchBtn" type="button">Buscar</button>
      </div>
    </section>
    <section class="panel" id="searchResults">
      <div class="panel-header">
        <h2>${escapeHtml(config.label)}</h2>
        <span class="muted">0 rexistros</span>
      </div>
      <div class="message">Cargando ${escapeHtml(config.label.toLowerCase())}...</div>
    </section>
  `;
  attachSearchHandlers();
}

function attachSearchHandlers() {
  const input = document.getElementById('searchInput');
  const button = document.getElementById('searchBtn');
  if (!input || !button) return;
  button.addEventListener('click', () => {
    const type = els.content.dataset.entityType;
    setView(type, { query: input.value.trim(), skip: 0 });
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') setView(els.content.dataset.entityType, { query: input.value.trim(), skip: 0 });
  });
}

async function runSearch(type, query, skip, title) {
  const config = searchConfig[type];
  if (!config) return;
  if (!query && config.listOnOpen === false) {
    updateSearchResults([], 'Introduce un nome para buscar xogadores.', config.label, { type, query, skip });
    return;
  }
  await ensureAuth();
  updateSearchResults([], type === 'match' ? 'Buscando os partidos máis recentes...' : 'Buscando...', title, { type, query, skip });
  const result = type === 'match'
    ? await loadSortedMatchSearch(config, query, skip)
    : await loadSearchPage(type, config, query, skip);
  updateSearchResults(result.items, `Non se atoparon ${config.label.toLowerCase()}.`, title, {
    type,
    query,
    skip,
    hasNext: result.hasNext,
  });
}

async function loadSearchPage(type, config, query, skip) {
  const response = await post('/v2/busqueda.ashx', {
    accion: config.action,
    ...config.extra,
    texto: query,
    skip: String(skip),
  });
  const items = sortedBrowseItems(normalize(firstArray(response, config.keys), type), type);
  return { items, hasNext: items.length >= PAGE_SIZE };
}

async function loadSortedMatchSearch(config, query, skip) {
  const cacheKey = `match:${query}`;
  if (!state.searchCache.has(cacheKey)) {
    state.searchCache.set(cacheKey, { pages: new Map(), lastPageIndex: null });
  }
  const cache = state.searchCache.get(cacheKey);
  const lastPageIndex = await resolveLastMatchPageIndex(cache, config, query);
  const start = cleanSkip(skip);
  const needed = start + PAGE_SIZE;
  const matches = [];
  for (let page = lastPageIndex; page >= 0 && matches.length < needed; page -= 1) {
    matches.push(...await loadMatchSearchPage(cache, config, query, page));
  }
  const allItems = sortRecordsMostRecent(mergeById([], matches));
  const lastPageItems = await loadMatchSearchPage(cache, config, query, lastPageIndex);
  const totalKnown = Math.max(0, lastPageIndex) * PAGE_SIZE + lastPageItems.length;
  return {
    items: allItems.slice(start, start + PAGE_SIZE),
    hasNext: start + PAGE_SIZE < totalKnown,
  };
}

async function resolveLastMatchPageIndex(cache, config, query) {
  if (cache.lastPageIndex !== null) return cache.lastPageIndex;
  const firstPage = await loadMatchSearchPage(cache, config, query, 0);
  if (firstPage.length < PAGE_SIZE) {
    cache.lastPageIndex = firstPage.length ? 0 : -1;
    return cache.lastPageIndex;
  }

  let low = 0;
  let high = INITIAL_MATCH_SEARCH_PAGE_CAP - 1;
  while (high < MAX_MATCH_SEARCH_PAGE_CAP) {
    const highPageItems = await loadMatchSearchPage(cache, config, query, high);
    if (highPageItems.length < PAGE_SIZE) break;
    low = high;
    high = Math.min(high * 2, MAX_MATCH_SEARCH_PAGE_CAP - 1);
    if (high === low) {
      cache.lastPageIndex = high;
      return cache.lastPageIndex;
    }
  }

  let firstNonFull = high;
  let left = low + 1;
  let right = high;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const pageItems = await loadMatchSearchPage(cache, config, query, mid);
    if (pageItems.length < PAGE_SIZE) {
      firstNonFull = mid;
      right = mid - 1;
    } else {
      left = mid + 1;
    }
  }
  const lastPageItems = await loadMatchSearchPage(cache, config, query, firstNonFull);
  cache.lastPageIndex = lastPageItems.length ? firstNonFull : firstNonFull - 1;
  return cache.lastPageIndex;
}

async function loadMatchSearchPage(cache, config, query, page) {
  if (page < 0) return [];
  if (cache.pages.has(page)) return cache.pages.get(page);
  const response = await post('/v2/busqueda.ashx', {
    accion: config.action,
    ...config.extra,
    texto: query,
    skip: String(page * PAGE_SIZE),
  });
  const items = normalize(firstArray(response, config.keys), 'match');
  cache.pages.set(page, items);
  return items;
}

function showSearchError(error) {
  updateSearchResults([], error.message || String(error), 'Resultados da busca', {
    type: state.view,
    query: state.currentQuery,
    skip: state.currentSkip,
  });
}

function updateSearchResults(items, emptyText, title = 'Resultados da busca', pagination = null) {
  const panel = document.getElementById('searchResults');
  if (!panel) return;
  panel.innerHTML = `
    <div class="panel-header">
      <h2>${escapeHtml(title)}</h2>
      <span class="muted">${items.length} ${items.length === 1 ? 'rexistro' : 'rexistros'}</span>
    </div>
    ${items.length ? renderGrid(items) : `<div class="message">${escapeHtml(emptyText)}</div>`}
    ${renderPagination(items, pagination)}
  `;
  attachCardHandlers();
  attachPaginationHandlers();
}

function renderPagination(items, pagination) {
  if (!pagination) return '';
  const skip = cleanSkip(pagination.skip);
  const hasPrevious = skip > 0;
  const hasNext = Boolean(pagination.hasNext);
  if (!hasPrevious && !hasNext) return '';
  const range = items.length ? `Mostrando ${skip + 1}-${skip + items.length}` : 'Sen rexistros nesta páxina';
  return `
    <div class="pager">
      <button class="secondary" type="button" data-page-skip="${Math.max(0, skip - PAGE_SIZE)}"${hasPrevious ? '' : ' disabled'}>Anterior</button>
      <span class="pager-info">${range}</span>
      <button class="secondary" type="button" data-page-skip="${skip + PAGE_SIZE}"${hasNext ? '' : ' disabled'}>Seguinte</button>
    </div>
  `;
}

function attachPaginationHandlers() {
  els.content.querySelectorAll('[data-page-skip]').forEach((button) => {
    button.addEventListener('click', () => {
      setView(state.view, {
        query: state.currentQuery,
        skip: cleanSkip(button.dataset.pageSkip),
      });
    });
  });
}

async function getFavoritePlayers() {
  const response = await post('/v2/misjugadores.ashx', { accion: 'listado' });
  return mergeById(normalize(firstArray(response, ['misjugadores', 'jugadores']), 'player'), readLocalFavorites('player'));
}

async function getFavoriteTeams() {
  const response = await post('/v2/misequipos.ashx', { accion: 'listado' });
  return mergeById(normalize(firstArray(response, ['misequipos', 'equipos']), 'team'), readLocalFavorites('team'));
}

async function getFavoriteMatches() {
  const response = await post('/v2/mispartidos.ashx', { accion: 'listado' });
  return sortRecordsMostRecent(mergeById(normalize(firstArray(response, ['mispartidos', 'partidos']), 'match'), readLocalFavorites('match')));
}

async function getUpcomingMatches(days) {
  const response = await post('/v2/mispartidos.ashx', { accion: 'listadoProximos', dias: String(days) });
  return sortRecordsMostRecent(normalize(firstArray(response, ['mispartidos', 'proximosPartidos', 'partidos']), 'match'));
}

function renderPanel(title, items, emptyText) {
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>${escapeHtml(title)}</h2>
        <span class="muted">${items.length} ${items.length === 1 ? 'rexistro' : 'rexistros'}</span>
      </div>
      ${items.length ? renderGrid(items) : `<div class="message">${escapeHtml(emptyText)}</div>`}
    </section>
  `;
}

function renderGrid(items) {
  return `<div class="grid">${items.map(renderCard).join('')}</div>`;
}

function renderCard(item) {
  const key = registerRenderedItem(item);
  return `
    <button type="button" class="card" data-item-key="${key}">
      <span class="badge">${escapeHtml(labelFor(item.type))}</span>
      <h3>${escapeHtml(titleFor(item))}</h3>
      <p>${escapeHtml(summaryFor(item))}</p>
    </button>
  `;
}

const renderedItems = new Map();
let renderedCounter = 0;

function registerRenderedItem(item) {
  const key = `item-${renderedCounter++}`;
  renderedItems.set(key, item);
  return key;
}

function attachCardHandlers(root = document) {
  root.querySelectorAll('[data-item-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = renderedItems.get(button.dataset.itemKey);
      if (item) openDetail(item, true).catch(showError);
    });
  });
}

async function openDetail(item, pushStack) {
  if (pushStack) writeRoute(detailRouteForItem(item));
  state.view = 'detail';
  setActiveTab('detail', item.type);
  renderMessage('Cargando detalle...');
  await ensureAuth();
  const detail = await loadDetail(item);
  renderDetail(item, detail);
}

function detailRouteForItem(item) {
  const route = { view: 'detail', type: item.type, id: getId(item) };
  if (item.type === 'category') {
    return {
      ...route,
      name: item.NombreCategoria || item.Categoria || '',
      competition: item.NombreCompeticion || item.Competicion || '',
      delegation: item.NombreDelegacion || item.Delegacion || '',
      phaseId: item.selectedPhaseId || '',
      phaseName: item.selectedPhaseName || '',
      groupId: item.selectedGroupId || '',
      groupName: item.selectedGroupName || '',
      roundId: item.selectedRoundId || '',
      roundName: item.selectedRoundName || '',
      phaseType: item.selectedPhaseType || '',
    };
  }
  if (item.type !== 'match') return route;
  return {
    ...route,
    local: item.NombreEquipoLocal || item.EquipoLocal || item.local || '',
    visitor: item.NombreEquipoVisitante || item.EquipoVisitante || item.visitante || '',
    date: item.Fecha || item.FechaPartido || item.fechaPartido || '',
    time: item.Hora || '',
    status: item.Estado || '',
    localScore: item.Resultados?.ResultadoLocal || item.ResultadoLocal || '',
    visitorScore: item.Resultados?.ResultadoVisitante || item.ResultadoVisitante || '',
    court: item.CampoJuego || '',
    competition: item.Competicion || '',
    category: item.Categoria || item.NombreCategoria || '',
  };
}

function goBack() {
  if (state.routeIndex > 0) {
    window.history.back();
    return;
  }
  setView(state.currentDetailItem?.type || 'home');
}

async function loadDetail(item) {
  const cacheKey = detailCacheKey(item);
  if (state.detailCache.has(cacheKey)) return state.detailCache.get(cacheKey);
  let detail = {};
  if (item.type === 'player') detail = await loadPlayerDetail(item);
  if (item.type === 'team') detail = await loadTeamDetail(item);
  if (item.type === 'club') detail = await loadClubDetail(item);
  if (item.type === 'category') detail = await loadCategoryDetail(item);
  if (item.type === 'match') detail = await loadMatchDetail(item);
  state.detailCache.set(cacheKey, detail);
  return detail;
}

function detailCacheKey(item) {
  if (item.type === 'category') {
    return [
      item.type,
      getId(item),
      item.selectedPhaseId || '',
      item.selectedGroupId || '',
      item.selectedRoundId || '',
    ].join(':');
  }
  return `${item.type}:${getId(item)}`;
}

async function loadPlayerDetail(item) {
  const detail = await post('/v2/jugador.ashx', { accion: 'detalleJugador', id_jugador: getId(item) });
  const team = detail.equipo;
  const idEquipo = team?.Id || item.IdEquipo;
  const idComponenteClub = detail.idComponenteClub || item.IdComponenteClub;
  const idTemporada = detail.idTemporadaActual || item.IdTemporada;
  const stats = idEquipo && idComponenteClub && idTemporada
    ? await post('/v2/jugador.ashx', { accion: 'datosGlobalesJugadorEquipo', id_jugador: getId(item), id_equipo: idEquipo, id_componente_club: idComponenteClub, id_temporada: idTemporada }).catch(() => null)
    : null;
  const matches = idEquipo && idComponenteClub && idTemporada
    ? await post('/v2/jugador.ashx', { accion: 'datosMediasJugadorPartidos', id_jugador: getId(item), id_equipo: idEquipo, id_componente_club: idComponenteClub, id_temporada: idTemporada }).catch(() => null)
    : null;
  return { ...detail, stats, matches };
}

async function loadTeamDetail(item) {
  const detail = await post('/v2/equipo.ashx', { accion: 'detalleEquipo', id_equipo: getId(item) });
  const roster = await post('/v2/equipo.ashx', { accion: 'jugadores', id_equipo: getId(item) }).catch(() => null);
  return { ...detail, roster };
}

async function loadClubDetail(item) {
  const id = getId(item);
  const teams = await post('/v2/club.ashx', { accion: 'equipos', id_club: id }).catch(() => null);
  const matches = await post('/v2/club.ashx', { accion: 'partidosClub', id_club: id, dias: '30' }).catch(() => null);
  return { club: item, teams, matches };
}

async function loadCategoryDetail(item) {
  const id = getId(item);
  const detail = await post('/v2/categoria.ashx', { accion: 'detalleCategoria', id_categoria_competicion: id }).catch(() => null);
  const phases = await post('/v2/categoria.ashx', { accion: 'fasesGrupos', id_categoria_competicion: id }).catch(() => null);
  const context = categoryContext(phases, item);
  const params = categoryParams(id, context);
  let standings = null;
  let teams = null;
  let teamStats = null;
  let playerStats = null;
  let bestPlayers = null;
  let rounds = null;
  let schedule = null;
  if (context.hasGroupSelection && context.group) {
    [standings, teams, teamStats, playerStats, bestPlayers, rounds] = await Promise.all([
      post('/v2/categoria.ashx', { accion: 'clasificacion', ...params }).catch(() => null),
      post('/v2/categoria.ashx', { accion: 'equipos', ...params }).catch(() => null),
      post('/v2/categoria.ashx', { accion: 'estadisticaEquipo', ...params }).catch(() => null),
      post('/v2/categoria.ashx', { accion: 'estadisticaJugadores', ...params }).catch(() => null),
      post('/v2/categoria.ashx', { accion: 'mejoresJugadores', ...params }).catch(() => null),
      post('/v2/categoria.ashx', { accion: 'Jornadas', ...params }).catch(() => null),
    ]);
    schedule = await loadCategoryRoundSchedules(params, rounds, context);
  }
  return { category: item, detail, phases, context, standings, teams, teamStats, playerStats, bestPlayers, rounds, schedule };
}

async function loadCategoryRoundSchedules(params, roundsResponse, context) {
  const namedRounds = contextRounds(context);
  const jornadaRows = firstArray(roundsResponse || {}, ['ListaJornadas', 'jornadas']);
  const rounds = mergeRoundMetadata(jornadaRows, namedRounds);
  const defaultJornada = firstRoundJornadaValue(jornadaRows) || params.jornada;
  const canUseBaseRoundFallback = uniqueRoundIds(namedRounds).length <= 1;
  const groupResponsePromise = loadGroupScheduleResponses(params);
  if (!rounds.length) return groupResponsePromise;
  const sortedRounds = sortRecordsMostRecent(rounds);
  const groupResponse = await groupResponsePromise;
  const groupMatches = firstArray(groupResponse || {}, ['partidos']);
  const groupJornadaBuckets = matchBucketsByJornada(groupMatches);
  const roundSchedules = await Promise.all(sortedRounds.map(async (round, index) => {
    const key = roundKey(round) || String(index + 1);
    const roundRondaId = categoryRondaId(round);
    const response = await post('/v2/categoria.ashx', {
      accion: 'horariosJornadas',
      ...params,
      id_ronda: roundRondaId || (canUseBaseRoundFallback ? params.id_ronda : ''),
      jornada: categoryJornadaValue(round) || defaultJornada,
    }).catch((error) => ({ error: error.message }));
    const responseMatches = firstArray(response || {}, ['partidos']);
    const matches = matchesForRound(responseMatches, round, { fallbackWhenUnmarked: false });
    const responseDateMatches = matchesForRoundDate(responseMatches, round);
    const groupDateMatches = matchesForRoundDate(groupMatches, round);
    let displayRound = round;
    let acceptedMatches = [];
    if (matches.length) acceptedMatches = matches;
    else if (responseDateMatches.length) acceptedMatches = responseDateMatches;
    else if (groupDateMatches.length) acceptedMatches = groupDateMatches;
    else if (groupJornadaBuckets.length === sortedRounds.length) {
      acceptedMatches = groupJornadaBuckets[index][1];
      displayRound = roundDateKey(round) ? round : { ...round, FechaJornada: groupJornadaBuckets[index][0] };
    } else if (roundEndpointReturnedSubset(responseMatches, groupMatches)) {
      acceptedMatches = responseMatches;
    }
    return {
      key,
      round: displayRound,
      response,
      matches: acceptedMatches,
    };
  }));
  const scheduledMatches = roundSchedules.flatMap((entry) => entry.matches);
  return {
    groupResponse,
    roundSchedules,
    partidos: groupMatches.length ? groupMatches : scheduledMatches,
  };
}

async function loadGroupScheduleResponses(params) {
  const requests = [
    post('/v2/categoria.ashx', {
      accion: 'horariosJornadas',
      ...params,
      id_ronda: '',
      jornada: '0',
    }).catch(() => null),
  ];
  if (params.id_ronda) {
    requests.push(post('/v2/categoria.ashx', {
      accion: 'horariosJornadas',
      ...params,
      jornada: '0',
    }).catch(() => null));
  }
  const responses = await Promise.all(requests);
  return combineScheduleResponses(responses);
}

function combineScheduleResponses(responses) {
  const usable = responses.filter(Boolean);
  if (!usable.length) return null;
  const partidos = uniqueMatches(usable.flatMap((response) => firstArray(response || {}, ['partidos'])));
  const successful = usable.find((response) => response.resultado === 'correcto') || usable[0];
  return { ...successful, partidos };
}

function uniqueMatches(matches) {
  const seen = new Set();
  return matches.filter((match, index) => {
    const key = matchStableId(match) || JSON.stringify(match) || String(index);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function contextRounds(context) {
  const rounds = [
    ...firstArray(context?.phase || {}, ['Rondas', 'rondas']),
    ...firstArray(context?.group || {}, ['Rondas', 'rondas']),
  ];
  const seen = new Set();
  return rounds.filter((round, index) => {
    const key = categoryRoundId(round) || normalizeText(roundDisplayName(round)) || String(index);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueRoundIds(rounds) {
  return [...new Set(rounds.map(categoryRondaId).filter(Boolean).map(String))];
}

function firstRoundJornadaValue(rounds) {
  for (const round of rounds) {
    const value = categoryJornadaValue(round);
    if (value) return value;
  }
  return '';
}

function mergeRoundMetadata(rounds, namedRounds) {
  if (!rounds.length) return namedRounds;
  if (!namedRounds.length) return rounds;
  if (rounds.every((round) => !categoryRoundId(round) && !roundDisplayName(round))) return namedRounds;
  return rounds.map((round, index) => {
    const id = categoryRoundId(round);
    const byId = id ? namedRounds.find((candidate) => categoryRoundId(candidate) === id) : null;
    const byIndex = namedRounds.length === rounds.length ? namedRounds[index] : null;
    const named = byId || byIndex;
    if (!named) return round;
    return {
      ...named,
      ...round,
      NombreRonda: round.NombreRonda || round.nombreRonda || round.Nombre || named.NombreRonda || named.nombreRonda || named.Nombre,
      nombreRonda: round.nombreRonda || round.NombreRonda || named.nombreRonda || named.NombreRonda,
      Nombre: round.Nombre || round.NombreRonda || round.nombreRonda || named.Nombre || named.NombreRonda || named.nombreRonda,
    };
  });
}

function categoryContext(phases, selection = {}) {
  const phaseList = firstArray(phases || {}, ['listaFasesGrupo', 'fasesGrupos', 'fases']);
  const selectedPhaseId = selection.selectedPhaseId;
  const selectedGroupId = selection.selectedGroupId;
  const selectedRoundId = selection.selectedRoundId;
  const hasPhaseSelection = Boolean(selectedPhaseId || selection.selectedPhaseName);
  const hasGroupSelection = Boolean(selectedGroupId || selection.selectedGroupName);
  const hasRoundSelection = Boolean(selectedRoundId || selection.selectedRoundName);
  const hasSelection = hasPhaseSelection || hasGroupSelection || hasRoundSelection;
  const fallbackPhase = selectedPhaseId || selection.selectedPhaseName
    ? { IdFase: selectedPhaseId, NombreFase: selection.selectedPhaseName, TipoFase: selection.selectedPhaseType, Grupos: [], Rondas: [] }
    : null;
  const fallbackGroup = selectedGroupId || selection.selectedGroupName
    ? { IdGrupo: selectedGroupId, NombreGrupo: selection.selectedGroupName }
    : null;
  const fallbackRound = selectedRoundId || selection.selectedRoundName
    ? { IdRonda: selectedRoundId, NombreRonda: selection.selectedRoundName }
    : null;
  if (fallbackPhase && fallbackGroup) fallbackPhase.Grupos = [fallbackGroup];
  if (fallbackPhase && fallbackRound) fallbackPhase.Rondas = [fallbackRound];
  const availablePhases = phaseList.length ? phaseList : (fallbackPhase ? [fallbackPhase] : []);
  const phase = availablePhases.find((row) => categoryPhaseId(row) === selectedPhaseId)
    || availablePhases.find((row) => firstArray(row, ['Grupos', 'grupos']).some((group) => categoryGroupId(group) === selectedGroupId))
    || (hasSelection ? null : availablePhases[0])
    || null;
  const phaseGroups = firstArray(phase || {}, ['Grupos', 'grupos']);
  const allGroups = availablePhases.flatMap((row) => firstArray(row, ['Grupos', 'grupos']));
  const group = hasGroupSelection
    ? phaseGroups.find((row) => categoryGroupId(row) === selectedGroupId)
      || allGroups.find((row) => categoryGroupId(row) === selectedGroupId)
      || fallbackGroup
      || null
    : null;
  const phaseRounds = firstArray(phase || {}, ['Rondas', 'rondas']);
  const groupRounds = firstArray(group || {}, ['Rondas', 'rondas']);
  const round = [...phaseRounds, ...groupRounds].find((row) => categoryRoundId(row) === selectedRoundId)
    || phaseRounds[0]
    || groupRounds[0]
    || null;
  return { phase, group, round, phases: availablePhases, hasSelection, hasPhaseSelection, hasGroupSelection, hasRoundSelection };
}

function categoryPhaseId(phase) {
  return phase?.IdFase || phase?.idFase || phase?.id_fase || phase?.Id || '';
}

function categoryGroupId(group) {
  return group?.IdGrupo || group?.idGrupo || group?.id_grupo || group?.Id || '';
}

function categoryRoundId(round) {
  return categoryRondaId(round) || round?.Id || '';
}

function categoryRondaId(round) {
  return round?.IdRonda || round?.idRonda || round?.id_ronda || '';
}

function categoryJornadaId(round) {
  return round?.IdJornada || round?.idJornada || round?.id_jornada || '';
}

function categoryJornadaValue(round) {
  return firstMeaningfulValue(
    round?.NumeroJornada,
    round?.numeroJornada,
    round?.NumJornada,
    round?.numJornada,
    round?.Jornada,
    round?.jornada,
    round?.Numero,
    round?.numero
  );
}

function categoryParams(id, context) {
  return {
    id_categoria_competicion: id,
    id_fase: categoryPhaseId(context.phase),
    id_grupo: categoryGroupId(context.group),
    id_ronda: categoryRondaId(context.round),
    jornada: '0',
    tipo_fase: context.phase?.TipoFase || context.phase?.tipo_fase || '',
    ventana: '0',
    fecha_inicial: '',
    fecha_final: '',
  };
}

async function loadMatchDetail(item) {
  const id = getId(item);
  const [live, stats, best, videos, comparison, shotMap] = await Promise.all([
    post('/v2/envivo/partido.ashx', { id_partido: id }).catch(() => null),
    post('/v2/envivo/estadisticas.ashx', { id_partido: id }).catch(() => null),
    post('/v2/envivo/mejores-jugadores.ashx', { id_partido: id }).catch(() => null),
    post('/v2/envivo/videos.ashx', { id_partido: id }).catch(() => null),
    post('/v2/envivo/comparativa.ashx', { id_partido: id }).catch(() => null),
    post('/v2/envivo/mapa-de-tiro.ashx', { id_partido: id }).catch(() => null),
  ]);
  return { match: item, live, stats, best, videos, comparison, shotMap };
}

function renderDetail(item, detail) {
  const displayItem = detailDisplayItem(item, detail);
  state.currentDetailItem = displayItem;
  state.currentDetailData = detail;
  const favoriteCapable = ['player', 'team', 'match'].includes(displayItem.type);
  const favorite = favoriteCapable && isFavorite(displayItem);
  const detailLabel = detailLabelFor(displayItem, detail);
  els.content.innerHTML = `
    <article class="detail">
      <section class="panel detail-hero">
        <div class="detail-top">
          <button type="button" class="back-btn" id="backBtn">Volver</button>
          <div class="detail-actions">
            ${favoriteCapable ? `<button id="saveBtn" type="button">${favorite ? 'Gardado' : 'Gardar'}</button><button id="removeBtn" type="button" class="secondary">Retirar</button>` : ''}
          </div>
        </div>
        <div class="detail-title">
          <span class="badge">${escapeHtml(detailLabel)}</span>
          <h2>${escapeHtml(titleFor(displayItem))}</h2>
          <p class="muted">${escapeHtml(summaryFor(displayItem))}</p>
        </div>
        ${renderFacts(primaryFacts(displayItem))}
      </section>
      <div class="sections">
        ${renderRelated(displayItem, detail)}
        ${renderSectionsFor(displayItem, detail)}
      </div>
    </article>
  `;
  document.getElementById('backBtn').addEventListener('click', goBack);
  if (favoriteCapable) {
    document.getElementById('saveBtn').addEventListener('click', () => saveFavorite(displayItem).then(() => renderDetail(displayItem, detail)).catch(showError));
    document.getElementById('removeBtn').addEventListener('click', () => removeFavorite(displayItem).then(() => renderDetail(displayItem, detail)).catch(showError));
  }
  attachRelatedHandlers();
}

function detailDisplayItem(item, detail) {
  const source = item.type === 'category'
    ? detail?.detail?.categoria || detail?.category
    : detail?.jugador || detail?.equipo || detail?.club || detail?.category || detail?.match || detail?.partido;
  const displayItem = source ? { ...item, ...source, type: item.type } : item;
  if (item.type !== 'category') return displayItem;
  const context = detail?.context || {};
  const groupName = context.group?.NombreGrupo || context.group?.Nombre || item.selectedGroupName;
  const phaseName = context.phase?.NombreFase || context.phase?.Nombre || item.selectedPhaseName;
  const roundName = roundDisplayName(context.round) || item.selectedRoundName;
  if (context.hasRoundSelection && roundName) return { ...displayItem, Nombre: roundName };
  if (context.hasGroupSelection && groupName) return { ...displayItem, Nombre: groupName };
  if (context.hasPhaseSelection && phaseName) return { ...displayItem, Nombre: phaseName };
  return displayItem;
}

function detailLabelFor(item, detail) {
  if (item.type === 'category') {
    if (detail?.context?.hasRoundSelection) return 'Rolda';
    if (detail?.context?.hasGroupSelection) return 'Grupo';
    if (detail?.context?.hasPhaseSelection) return 'Fase';
  }
  return labelFor(item.type);
}

function attachPageHandlers() {
  attachSearchHandlers();
  attachCardHandlers();
  attachPaginationHandlers();
}

function renderSectionsFor(item, detail) {
  if (item.type === 'player') return renderPlayerSections(detail);
  if (item.type === 'team') return renderTeamSections(detail);
  if (item.type === 'club') return renderClubSections(detail);
  if (item.type === 'category') return renderCategorySections(detail);
  if (item.type === 'match') return renderMatchSections(detail);
  return '';
}

function renderRelated(item, detail) {
  const source = detail?.jugador || detail?.equipo || item;
  const rows = [];
  if (item.type === 'player' && detail?.equipo) rows.push(teamItem(detail.equipo));
  if (source?.IdClub && item.type !== 'club') rows.push({ type: 'club', Id: source.IdClub, NombreClub: source.Club || source.NombreClub || 'Club' });
  const categoryId = source?.IdCategoriaCompeticion || source?.IdCompeticionCategoria;
  if (categoryId && item.type !== 'category') {
    rows.push({ type: 'category', Id: categoryId, NombreCategoria: source.Categoria || source.NombreCategoria || 'Categoría', NombreCompeticion: source.Competicion || source.NombreCompeticion });
  }
  return rows.length ? renderRowSection('Relacionado', mergeById([], rows), titleFor, (row) => row) : '';
}

function renderPlayerSections(detail) {
  return [
    detail?.equipo ? renderRowSection('Equipo actual', [detail.equipo], (row) => row.Nombre || row.NombreEquipo || 'Equipo', teamItem) : '',
    renderRowSection('Historico de equipos', firstArray(detail, ['equiposJugador']), (row) => row.NombreEquipo || row.Nombre || 'Equipo', teamItem),
    renderObjectSection('Estatísticas', detail?.stats),
    renderRowSection('Partidos', sortRecordsMostRecent(firstArray(detail?.matches || {}, ['listaDatosPartido', 'datosPartidos', 'partidos'])), (row) => summaryFor({ ...row, type: 'match' }), matchItem),
  ].join('');
}

function renderTeamSections(detail) {
  return [
    renderRowSection('Cadro de xogadores', firstArray(detail?.roster || {}, ['jugadores', 'jugadoresEquipo', 'misjugadores']), (row) => row.Nombre || row.Jugador || titleFor({ ...row, type: 'player' }), playerItem),
    renderRowSection('Xornadas', firstArray(detail || {}, ['jornadas']), (row) => row.Nombre || row.Jornada || displayDate(row.fechaJornada, false) || JSON.stringify(row).slice(0, 90)),
  ].join('');
}

function renderClubSections(detail) {
  return [
    renderRowSection('Equipos', firstArray(detail?.teams || {}, ['equipos']), (row) => row.Nombre || titleFor({ ...row, type: 'team' }), teamItem),
    renderRowSection('Partidos', sortRecordsMostRecent(firstArray(detail?.matches || {}, ['partidos'])), (row) => summaryFor({ ...row, type: 'match' }), matchItem),
  ].join('');
}

function renderCategorySections(detail) {
  if (detail?.context?.hasRoundSelection) return renderCategoryRoundScreen(detail);
  if (detail?.context?.hasGroupSelection) return renderCategoryGroupScreen(detail);
  if (detail?.context?.hasPhaseSelection) return renderCategoryPhaseScreen(detail);
  return renderCategoryPhases(detail);
}

function renderCategoryPhases(detail) {
  const phases = sortRecordsMostRecent(detail?.context?.phases || firstArray(detail?.phases || {}, ['listaFasesGrupo', 'fasesGrupos', 'fases']));
  if (!phases.length) return renderKeyValueSection('Fases e grupos', [['Fases', 'Non se atoparon fases.']]);
  const activePhaseId = categoryPhaseId(detail?.context?.phase);
  const activeGroupId = categoryGroupId(detail?.context?.group);
  const base = categoryBaseItem(detail);
  return `
    <section class="section phase-section">
      <h3>Fases e grupos</h3>
      <div class="phase-list">
        ${phases.map((phase) => {
          const groups = firstArray(phase, ['Grupos', 'grupos']);
          const phaseSelected = categoryPhaseId(phase) === activePhaseId;
          return `
            <div class="phase-block">
              <div class="phase-title">
                ${renderCategoryPhaseLink(base, phase, phaseSelected && !activeGroupId)}
                <span>${escapeHtml(phase.TipoFase || '')}</span>
              </div>
              <div class="chip-row">
                ${groups.length
                  ? groups.map((group) => renderCategoryContextChip(base, phase, group, null, categoryGroupId(group) === activeGroupId && phaseSelected)).join('')
                  : renderCategoryContextChip(base, phase, null, null, phaseSelected)}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderCategoryPhaseLink(base, phase, active) {
  const item = categoryContextItem(base, phase, null, null);
  const key = registerRenderedItem(item);
  const label = phase.NombreFase || phase.Nombre || 'Fase';
  return `<button type="button" class="phase-link${active ? ' active' : ''}" data-related-key="${key}">${escapeHtml(label)}</button>`;
}

function renderCategoryContextChip(base, phase, group, round, active) {
  const item = categoryContextItem(base, phase, group, round);
  const key = registerRenderedItem(item);
  const label = roundDisplayName(round) || group?.NombreGrupo || group?.Nombre || phase?.NombreFase || phase?.Nombre || 'Abrir';
  return `<button type="button" class="context-chip${active ? ' active' : ''}" data-related-key="${key}">${escapeHtml(label)}</button>`;
}

function categoryBaseItem(detail) {
  const category = detail?.detail?.categoria || detail?.category || {};
  const original = detail?.category || {};
  return {
    ...category,
    type: 'category',
    Id: category.Id || getId(category) || getId(original),
    NombreCategoria: category.NombreCategoria || original.NombreCategoria,
    NombreCompeticion: category.NombreCompeticion || original.NombreCompeticion,
    NombreDelegacion: category.NombreDelegacion || original.NombreDelegacion,
  };
}

function categoryContextItem(base, phase, group, round) {
  return {
    ...base,
    selectedPhaseId: categoryPhaseId(phase),
    selectedPhaseName: phase?.NombreFase || phase?.Nombre || '',
    selectedPhaseType: phase?.TipoFase || phase?.tipo_fase || '',
    selectedGroupId: categoryGroupId(group),
    selectedGroupName: group?.NombreGrupo || group?.Nombre || '',
    selectedRoundId: categoryRoundId(round),
    selectedRoundName: roundDisplayName(round) || '',
  };
}

function renderCategoryPhaseScreen(detail) {
  if (!detail?.context?.hasPhaseSelection || detail?.context?.hasGroupSelection || !detail?.context?.phase) return '';
  const phase = detail.context.phase;
  const groups = firstArray(phase, ['Grupos', 'grupos']);
  const base = categoryBaseItem(detail);
  return `
    <section class="section phase-detail-section">
      <h3>${escapeHtml(phase.NombreFase || phase.Nombre || 'Fase')}</h3>
      <div class="group-shell">
        ${renderKeyValueBlock('Fase', [
          ['Fase', phase.NombreFase || phase.Nombre],
          ['Tipo', phase.TipoFase],
          ['Grupos', groups.length],
        ])}
        <div class="group-card wide">
          <h4>Grupos</h4>
          <div class="chip-row">
            ${groups.length
              ? groups.map((group) => renderCategoryContextChip(base, phase, group, null, false)).join('')
              : '<span class="muted">Non se atoparon grupos.</span>'}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderCategoryGroupScreen(detail) {
  if (!detail?.context?.hasGroupSelection) return '';
  const groupName = detail.context.group?.NombreGrupo || detail.context.group?.Nombre || detail.context.phase?.NombreFase || 'Grupo seleccionado';
  const phaseName = detail.context.phase?.NombreFase || detail.context.phase?.Nombre;
  const showRanking = !isPlayoffPhase(detail.context.phase);
  return `
    <section class="section group-section">
      <h3>${escapeHtml(groupName)}</h3>
      <div class="group-shell">
        ${renderCategoryGroupContextBlock(detail, phaseName, groupName)}
        ${renderGroupTeams(detail)}
        ${showRanking ? renderGroupRanking(detail) : ''}
        ${renderGroupRounds(detail)}
        ${renderGroupTeamLeaders(detail)}
        ${renderGroupPlayerLeaders(detail)}
      </div>
    </section>
  `;
}

function renderCategoryRoundScreen(detail) {
  if (!detail?.context?.hasRoundSelection) return '';
  const round = detail.context.round || {};
  const roundName = roundDisplayName(round) || detail.category?.selectedRoundName || 'Rolda seleccionada';
  const matches = selectedRoundMatches(detail);
  return `
    <section class="section group-section">
      <h3>${escapeHtml(roundName)}</h3>
      <div class="group-shell">
        ${renderCategoryRoundContextBlock(detail, roundName)}
        <div class="group-card wide">
          <h4>Partidos</h4>
          ${matches.length
            ? renderRoundMatchTable(matches)
            : '<div class="rows compact"><div class="row"><strong>Partidos</strong>: Non se atoparon partidos nesta rolda.</div></div>'}
        </div>
      </div>
    </section>
  `;
}

function renderCategoryRoundContextBlock(detail, roundName) {
  const base = categoryBaseItem(detail);
  const phaseItem = detail.context.phase ? categoryContextItem(base, detail.context.phase, null, null) : null;
  const groupItem = detail.context.group ? categoryContextItem(base, detail.context.phase, detail.context.group, null) : null;
  const phaseName = detail.context.phase?.NombreFase || detail.context.phase?.Nombre;
  const groupName = detail.context.group?.NombreGrupo || detail.context.group?.Nombre;
  return `
    <div class="group-card">
      <h4>Rolda</h4>
      <div class="rows compact">
        ${renderPlainValueRow('Rolda', roundName)}
        ${phaseItem && categoryPhaseId(detail.context.phase)
          ? renderInlineRelatedRow('Fase', phaseName, phaseItem)
          : renderPlainValueRow('Fase', phaseName)}
        ${groupItem && categoryGroupId(detail.context.group)
          ? renderInlineRelatedRow('Grupo', groupName, groupItem)
          : renderPlainValueRow('Grupo', groupName)}
      </div>
    </div>
  `;
}

function renderCategoryGroupContextBlock(detail, phaseName, groupName) {
  const base = categoryBaseItem(detail);
  const phaseItem = detail.context.phase ? categoryContextItem(base, detail.context.phase, null, null) : null;
  const phaseRow = phaseItem && categoryPhaseId(detail.context.phase)
    ? renderInlineRelatedRow('Fase', phaseName, phaseItem)
    : renderPlainValueRow('Fase', phaseName);
  const showRankingType = !isPlayoffPhase(detail.context.phase);
  return `
    <div class="group-card">
      <h4>Grupo</h4>
      <div class="rows compact">
        ${phaseRow}
        ${renderPlainValueRow('Grupo', groupName)}
        ${showRankingType ? renderPlainValueRow('Clasificación', detail.context.group?.NombreTipoClasificacion) : ''}
      </div>
    </div>
  `;
}

function isPlayoffPhase(phase) {
  return normalizeText(phase?.TipoFase || phase?.tipo_fase || phase?.tipoFase) === 'playoff';
}

function selectedRoundMatches(detail) {
  const selected = detail?.context?.round || {};
  const selectedId = categoryRondaId(selected);
  const selectedName = normalizeText(roundDisplayName(selected) || detail?.category?.selectedRoundName);
  const selectedKey = roundKey(selected);
  const canMatchByKey = !roundDisplayName(selected) && !roundDateKey(selected);
  const roundSchedules = Array.isArray(detail?.schedule?.roundSchedules) ? detail.schedule.roundSchedules : [];
  const exactEntry = roundSchedules.find((entry) => {
    const entryRound = entry.round || {};
    return (selectedId && categoryRondaId(entryRound) === selectedId)
      || (canMatchByKey && selectedKey && roundKey(entryRound) === selectedKey)
      || (selectedName && normalizeText(roundDisplayName(entryRound) || roundLabel(entryRound, 0)) === selectedName);
  });
  if (exactEntry?.matches?.length) return exactEntry.matches;
  const groupMatches = firstArray(detail?.schedule?.groupResponse || {}, ['partidos']);
  const groupFiltered = matchesForRound(groupMatches, selected, { fallbackWhenUnmarked: false });
  if (groupFiltered.length) return groupFiltered;
  const matches = firstArray(detail?.schedule || {}, ['partidos']);
  if (!matches.length) return [];
  const filtered = matchesForRound(matches, selected, { fallbackWhenUnmarked: false });
  if (filtered.length) return filtered;
  return exactEntry?.matches || [];
}

function renderGroupRanking(detail) {
  const rows = firstArray(detail?.standings || {}, ['clasificacion']);
  if (!rows.length) return renderGroupEmpty('Clasificación', detail?.standings?.error || 'Non se atopou clasificación.');
  return renderMiniTable('Clasificación', ['#', 'Equipo', 'G', 'P', 'Pts'], rows, (row) => [
    row.Posicion,
    row.NombreEquipo,
    row.PartidosGanados,
    row.PartidosPerdidos,
    row.Puntos,
  ], (row) => teamItem({ ...row, Id: row.IdEquipo, Nombre: row.NombreEquipo }));
}

function renderGroupTeams(detail) {
  const teams = firstArray(detail?.teams || {}, ['equipos']);
  if (!teams.length) return renderGroupEmpty('Equipos', detail?.teams?.error || 'Non se atoparon equipos.');
  return renderGroupRows('Equipos', teams, (row) => [
    row.Nombre,
    row.Club,
    row.PartidosJugados ? `${row.PartidosJugados} partidos` : '',
  ].filter(Boolean).join(' · '), teamItem);
}

function renderGroupRounds(detail) {
  const rounds = sortRecordsMostRecent(firstArray(detail?.rounds || {}, ['ListaJornadas', 'jornadas']));
  const matches = firstArray(detail?.schedule || {}, ['partidos']);
  const roundSchedules = Array.isArray(detail?.schedule?.roundSchedules)
    ? sortRecordsMostRecent(detail.schedule.roundSchedules).sort((left, right) => recordTimestamp(right.round) - recordTimestamp(left.round))
    : [];
  if (roundSchedules.length) {
    const uniqueRoundSchedules = suppressRepeatedRoundMatchSets(roundSchedules);
    const matchedEntries = uniqueRoundSchedules.filter((entry) => entry.matches?.length);
    const unmatchedRounds = uniqueRoundSchedules.length - matchedEntries.length;
    const groupMatches = firstArray(detail?.schedule?.groupResponse || detail?.schedule || {}, ['partidos']);
    const unassignedMatches = unmatchedRounds ? excludeAssignedMatches(groupMatches, matchedEntries.flatMap((entry) => entry.matches)) : [];
    return `
      <div class="group-card wide">
        <h4>Roldas</h4>
        <div class="round-list">
          ${uniqueRoundSchedules.map((entry, index) => renderGroupRoundCard(
            entry.round,
            null,
            index,
            entry.matches,
            entry.response?.error || 'A API non identifica que partidos pertencen a esta rolda.'
          )).join('')}
        </div>
        ${unmatchedRounds && unassignedMatches.length ? `
          <div class="round-fallback">
            <h4>Partidos sen rolda identificada</h4>
            ${renderRoundMatchTable(unassignedMatches)}
          </div>
        ` : ''}
      </div>
    `;
  }
  if (!rounds.length && !matches.length) return renderGroupEmpty('Roldas', detail?.rounds?.error || detail?.schedule?.error || 'Non se atoparon roldas.');
  const matchGroups = groupMatchesByRound(matches);
  const virtualRounds = rounds.length ? rounds : Array.from(matchGroups.keys()).map((key) => ({ NumeroJornada: key }));
  return `
    <div class="group-card wide">
      <h4>Roldas</h4>
      <div class="round-list">
        ${virtualRounds.map((round, index) => renderGroupRoundCard(round, matchGroups, index)).join('')}
      </div>
    </div>
  `;
}

function renderGroupRoundCard(round, matchGroups, index, explicitMatches = null, error = '') {
  const key = roundKey(round) || String(index + 1);
  const matches = explicitMatches || matchGroups?.get(key) || [];
  const dateLabel = displayDate(round.FechaJornada || round.fechaJornada || round.Fecha, false) || matchDateRangeLabel(matches);
  return `
    <div class="round-card">
      <div class="round-heading">
        <strong>${escapeHtml(roundLabel(round, index))}</strong>
        <span>${escapeHtml(dateLabel)}</span>
      </div>
      ${matches.length
        ? renderRoundMatchTable(matches)
        : `<div class="rows compact"><div class="row"><strong>Partidos</strong>: ${escapeHtml(error || 'Non se atoparon partidos nesta rolda.')}</div></div>`}
    </div>
  `;
}

function renderRoundMatchTable(matches) {
  const sortedMatches = sortRecordsMostRecent(matches);
  return `
    <div class="round-match-table">
      <div class="round-match-row round-match-head">
        <span>Data</span>
        <span>Local</span>
        <span>Visitante</span>
        <span>Resultado</span>
        <span>Partido</span>
      </div>
      ${sortedMatches.map(renderRoundMatchRow).join('')}
    </div>
  `;
}

function renderRoundMatchRow(match) {
  const item = matchItem(match);
  const key = item ? registerRenderedItem(item) : '';
  const teams = matchTeamsObject(match, null);
  const scores = matchScoreObject(match, null);
  return `
    <div class="round-match-row">
      <span>${escapeHtml(matchDateLabel(match))}</span>
      <span>${renderMatchTeamLink(match, 'local', teams.local || 'Local')}</span>
      <span>${renderMatchTeamLink(match, 'visitor', teams.visitor || 'Visitante')}</span>
      <span>${escapeHtml(matchResultLabel(match, scores))}</span>
      <span>
        ${key
          ? `<button type="button" class="inline-link inline-value-link" data-related-key="${key}">Abrir</button>`
          : '<span class="muted">-</span>'}
      </span>
    </div>
  `;
}

function renderMatchTeamLink(match, side, fallback) {
  const item = teamItemFromMatch(match, side);
  if (!item) return escapeHtml(fallback);
  const key = registerRenderedItem(item);
  return `<button type="button" class="inline-link inline-value-link" data-related-key="${key}">${escapeHtml(titleFor(item) || fallback)}</button>`;
}

function matchDateLabel(match) {
  const date = displayDate(match.Fecha || match.FechaPartido || match.fechaPartido || match.FechaHora || match.fechaHora || match.FechaHoraUTC || match.fechaHoraUTC || match.fecha || match.fecha_hora, false);
  const time = match.Hora || match.hora || match.HoraPartido || match.horaPartido || match.horaDia || '';
  return [date, time].filter(Boolean).join(' ');
}

function matchResultLabel(match, scores) {
  if (hasMeaningfulValue(scores.local) && hasMeaningfulValue(scores.visitor) && scores.local !== '-' && scores.visitor !== '-') {
    return `${scores.local} - ${scores.visitor}`;
  }
  return match.Estado || match.estado || match.EstadoPartido || match.estadoPartido || '-';
}

function groupMatchesByRound(matches) {
  return matches.reduce((groups, match) => {
    const key = roundKey(match) || '0';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(match);
    return groups;
  }, new Map());
}

function roundKey(row) {
  return String(
    categoryJornadaValue(row)
    || categoryJornadaId(row)
    || categoryRondaId(row)
    || ''
  ).trim();
}

function roundLabel(round, index) {
  const name = roundDisplayName(round) || round.NombreJornada || round.nombreJornada || round.Jornada || round.jornada || categoryJornadaValue(round);
  return name ? `Rolda ${name}` : `Rolda ${index + 1}`;
}

function roundDisplayName(round) {
  return round?.NombreRonda || round?.nombreRonda || round?.Nombre || round?.nombre;
}

function normalizeText(value) {
  return String(value || '').trim().toLocaleLowerCase('gl-ES');
}

function matchesForRound(matches, round, options = {}) {
  if (!matches?.length || !round) return [];
  const fallbackWhenUnmarked = options.fallbackWhenUnmarked !== false;
  const selectedId = categoryRondaId(round);
  const selectedKey = roundKey(round);
  const selectedName = normalizeText(round.NombreRonda || round.nombreRonda || round.Nombre || round.nombre || round.NombreJornada || round.nombreJornada || round.Jornada || round.jornada);
  const selectedDate = dateKey(round);
  const canMatchByKey = !roundDisplayName(round) && !roundDateKey(round);
  const filtered = matches.filter((match) => (
    (selectedId && matchRoundIds(match).includes(selectedId))
    || (canMatchByKey && selectedKey && roundKey(match) === selectedKey)
    || (selectedName && normalizeText(match.NombreRonda || match.nombreRonda || match.NombreJornada || match.nombreJornada || match.Jornada || match.jornada || match.Ronda || match.ronda) === selectedName)
    || (selectedDate && dateKey(match) === selectedDate)
  ));
  if (filtered.length) return filtered;
  return fallbackWhenUnmarked && !matches.some(matchHasRoundMarker) ? matches : [];
}

function matchesForRoundDate(matches, round) {
  const selectedDate = roundDateKey(round);
  if (!matches?.length || !selectedDate) return [];
  return matches.filter((match) => matchDateKey(match) === selectedDate);
}

function matchBucketsByJornada(matches) {
  const buckets = new Map();
  for (const match of matches || []) {
    const key = dateKey(match);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(match);
  }
  return [...buckets.entries()].sort((left, right) => parseDisplayDate(left[0]) - parseDisplayDate(right[0]));
}

function dateKey(row) {
  const value = firstMeaningfulValue(
    row?.FechaJornada,
    row?.fechaJornada,
    row?.FechaHoraUTC,
    row?.fechaHoraUTC,
    row?.Fecha,
    row?.FechaPartido,
    row?.fechaPartido,
    row?.FechaHora,
    row?.fechaHora,
    row?.fecha,
    row?.fecha_hora
  );
  return value ? displayDate(value, false) : '';
}

function roundDateKey(round) {
  const value = firstMeaningfulValue(
    round?.FechaJornada,
    round?.fechaJornada,
    round?.Fecha,
    round?.fecha
  );
  return value ? displayDate(value, false) : '';
}

function matchDateKey(match) {
  const value = firstMeaningfulValue(
    match?.Fecha,
    match?.FechaPartido,
    match?.fechaPartido,
    match?.FechaHora,
    match?.fechaHora,
    match?.FechaHoraUTC,
    match?.fechaHoraUTC,
    match?.fecha,
    match?.fecha_hora
  );
  return value ? displayDate(value, false) : '';
}

function matchDateRangeLabel(matches) {
  const dates = [...new Set((matches || []).map(matchDateKey).filter(Boolean))].sort((left, right) => parseDisplayDate(left) - parseDisplayDate(right));
  if (!dates.length) return '';
  return dates.length === 1 ? dates[0] : `${dates[0]}-${dates[dates.length - 1]}`;
}

function parseDisplayDate(value) {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return 0;
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])).getTime();
}

function roundEndpointReturnedSubset(responseMatches, groupMatches) {
  if (!responseMatches.length || !groupMatches.length) return false;
  if (responseMatches.length >= groupMatches.length) return !sameMatchSet(responseMatches, groupMatches);
  return true;
}

function suppressRepeatedRoundMatchSets(roundSchedules) {
  const counts = roundSchedules.reduce((map, entry) => {
    const signature = matchSetSignature(entry.matches || []);
    if (signature) map.set(signature, (map.get(signature) || 0) + 1);
    return map;
  }, new Map());
  return roundSchedules.map((entry) => {
    const signature = matchSetSignature(entry.matches || []);
    return signature && counts.get(signature) > 1 ? { ...entry, matches: [] } : entry;
  });
}

function matchSetSignature(matches) {
  if (!matches.length) return '';
  const ids = matches.map(matchStableId).filter(Boolean).sort();
  if (ids.length === matches.length) return `ids:${ids.join('|')}`;
  return `json:${JSON.stringify(matches)}`;
}

function sameMatchSet(left, right) {
  const leftIds = left.map(matchStableId).filter(Boolean).sort();
  const rightIds = right.map(matchStableId).filter(Boolean).sort();
  if (leftIds.length && rightIds.length) return leftIds.join('|') === rightIds.join('|');
  return left.length === right.length && JSON.stringify(left) === JSON.stringify(right);
}

function matchStableId(match) {
  return String(match?.Id || match?.IdPartido || match?.idPartido || match?.IdCalendario || match?.idCalendario || '').trim();
}

function excludeAssignedMatches(allMatches, assignedMatches) {
  if (!allMatches.length || !assignedMatches.length) return allMatches;
  const assignedIds = new Set(assignedMatches.map(matchStableId).filter(Boolean));
  if (!assignedIds.size) return allMatches;
  return allMatches.filter((match) => !assignedIds.has(matchStableId(match)));
}

function matchRoundIds(match) {
  return [
    match.IdRonda,
    match.idRonda,
    match.id_ronda,
    match.IdJornada,
    match.idJornada,
    match.id_jornada,
  ].filter(hasMeaningfulValue).map(String);
}

function matchHasRoundMarker(match) {
  return Boolean(
    roundKey(match)
    || matchRoundIds(match).length
    || match.NombreRonda
    || match.nombreRonda
    || match.NombreJornada
    || match.nombreJornada
    || match.Ronda
    || match.ronda
  );
}

function renderGroupTeamLeaders(detail) {
  const stats = detail?.teamStats || {};
  const groups = [
    ['Puntos', 'EquiposPuntos'],
    ['Valoración', 'EquiposValoracion'],
    ['Rebotes', 'EquiposRebotes'],
    ['Asistencias', 'EquiposAsistencia'],
    ['Recuperacións', 'EquiposRecuperaciones'],
    ['Tapones', 'EquiposTapones'],
  ].map(([label, key]) => [label, firstArray(stats, [key])]).filter(([, rows]) => rows.length);
  if (!groups.length) return renderGroupEmpty('Líderes por equipo', stats.error || 'Non se atoparon estatísticas de equipos.');
  return renderGroupLeaders('Líderes por equipo', groups, teamStatLabel, (row) => teamItem({ Id: row.EquipoId, Nombre: row.Equipo, Club: row.Club }));
}

function renderGroupPlayerLeaders(detail) {
  const stats = detail?.playerStats || detail?.bestPlayers || {};
  const groups = [
    ['Estatísticas de xogadores', 'DatosTupla'],
    ['Estatísticas de tiro', 'DatosTripla'],
  ].map(([label, key]) => [label, firstArray(stats, [key])]).filter(([, rows]) => rows.length);
  if (!groups.length) return renderGroupEmpty('Líderes por xogador', stats.error || detail?.bestPlayers?.error || 'Non se atoparon estatísticas de xogadores.');
  return renderGroupLeaders('Líderes por xogador', groups, playerStatLabel, playerItemFromStat);
}

function renderMatchSections(detail) {
  const match = detailDisplayItem(detail?.match || { type: 'match' }, detail);
  const liveMatch = firstObject(detail?.live, ['partido']);
  const stats = firstObject(detail?.stats, ['estadisticas']);
  const best = firstObject(detail?.best, ['mejoresjugadores']);
  const comparison = firstObject(detail?.comparison, ['comparativa']);
  const shotMap = firstObject(detail?.shotMap, ['mapadetiro']);
  return [
    renderMatchScoreboard(match, liveMatch),
    renderMatchInfoSection(match, detail),
    renderPeriodsSection(match, liveMatch),
    renderTeamStatsSection(stats, shotMap),
    renderBestPlayersSection(best),
    renderLiveEventsSection(detail?.live),
    renderVideoSection(detail?.videos),
    renderComparisonSection(comparison),
    renderShotMapSection(shotMap),
  ].join('');
}

function renderMatchScoreboard(match, liveMatch) {
  const teams = matchTeamsObject(match, liveMatch);
  const scores = matchScoreObject(match, liveMatch);
  return `
    <section class="section match-summary">
      <h3>Marcador</h3>
      <div class="scoreboard">
        <div class="team-score">
          <span>${renderMatchTeamLink(match, 'local', teams.local || 'Local')}</span>
          <strong>${escapeHtml(scores.local)}</strong>
        </div>
        <div class="score-status">
          <span>${escapeHtml(match.Estado || liveMatch?.estado_partido || 'Estado descoñecido')}</span>
          <small>${escapeHtml([displayDate(match.Fecha, false), match.Hora].filter(Boolean).join(' ') || '-')}</small>
        </div>
        <div class="team-score away">
          <span>${renderMatchTeamLink(match, 'visitor', teams.visitor || 'Visitante')}</span>
          <strong>${escapeHtml(scores.visitor)}</strong>
        </div>
      </div>
    </section>
  `;
}

function renderMatchInfoSection(match, detail) {
  const liveMatch = firstObject(detail?.live, ['partido']);
  const rows = [
    ['Competición', match.Competicion || detail?.stats?.estadisticas?.Competicion],
    ['Categoría', match.Categoria || detail?.stats?.estadisticas?.Categoria],
    ['Delegación', match.Delegacion || detail?.stats?.estadisticas?.Delegacion],
    ['Rolda', match.NumeroJornada || displayDate(match.FechaJornada, false)],
    ['Pavillón', match.CampoJuego],
    ['Enderezo', match.DireccionCampo],
    ['Club local', match.NombreClubLocal],
    ['Club visitante', match.NombreClubVisitante],
    ['Tipo de acta', match.TipoActa || liveMatch?.tipo_acta],
    ['OTT', match.OTT || match.UrlOTT || match.Video],
    ['Última actualización', readableDate(liveMatch?.fechaultimaactualizacion)],
  ].filter(([, value]) => hasMeaningfulValue(value));
  return renderKeyValueSection('Información do partido', rows);
}

function renderPeriodsSection(match, liveMatch) {
  const periods = firstArray(match.Resultados || {}, ['ResultadosPeriodo'])
    .concat(firstArray(liveMatch || {}, ['periodos']));
  if (!periods.length) return renderKeyValueSection('Períodos', [['Períodos', 'Non se atopou detalle por períodos.']]);
  return `
    <section class="section">
      <h3>Períodos</h3>
      <div class="stat-table">
        <div class="stat-row stat-head"><span>Período</span><span>Local</span><span>Visitante</span></div>
        ${periods.map((period, index) => `
          <div class="stat-row">
            <span>${escapeHtml(period.periodo || period.numero_periodo || period.NumeroPeriodo || index + 1)}</span>
            <span>${escapeHtml(period.local || period.tanteo_periodo_local || period.ResultadoLocal || period.puntosLocal || '-')}</span>
            <span>${escapeHtml(period.visitante || period.tanteo_periodo_visitante || period.ResultadoVisitante || period.puntosVisitante || '-')}</span>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderTeamStatsSection(stats, shotMap) {
  const localStats = stats?.estadisticasequipolocal || shotMap?.estadiscasequipolocal;
  const visitorStats = stats?.estadisticasequipovisitante || shotMap?.estadiscasequipovisitante;
  const keys = ['puntos', 'rebotes', 'asistencias', 'recuperaciones', 'perdidas', 'faltascometidas', 'tapones', 'taponescometidos', 'canasta1p', 'tiro1p', 'porcentaje1p', 'canasta2p', 'tiro2p', 'porcentaje2p', 'canasta3p', 'tiro3p', 'porcentaje3p', 'canastatirodecampo', 'tirosdecampo', 'porcentajetirosdecampo'];
  const rows = keys
    .filter((key) => hasMeaningfulValue(localStats?.[key]) || hasMeaningfulValue(visitorStats?.[key]))
    .map((key) => [humanizeKey(key), localStats?.[key], visitorStats?.[key]]);
  if (!rows.length) return renderKeyValueSection('Estatísticas de equipo', [['Estatísticas', 'Non se atoparon estatísticas de equipos.']]);
  return `
    <section class="section">
      <h3>Estatísticas de equipo</h3>
      <div class="stat-table">
        <div class="stat-row stat-head"><span>Dato</span><span>Local</span><span>Visitante</span></div>
        ${rows.map(([label, local, visitor]) => `
          <div class="stat-row">
            <span>${escapeHtml(label)}</span>
            <span>${escapeHtml(local ?? '-')}</span>
            <span>${escapeHtml(visitor ?? '-')}</span>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderBestPlayersSection(best) {
  if (!best) return renderKeyValueSection('Mellores xogadores', [['Mellores xogadores', 'Non se atoparon datos de mellores xogadores.']]);
  const groups = [
    ['Máis valorados', 'jugadores_mas_valorados'],
    ['Anotadores', 'jugadores_mas_anotadores'],
    ['Rebotes', 'jugadores_mas_reboteadores'],
    ['Asistencias', 'jugadores_mas_asisten'],
    ['Recuperacións', 'jugadores_mas_recuperan'],
    ['Tapones', 'jugadores_mas_taponan'],
  ].map(([label, key]) => [label, firstArray(best, [key])]).filter(([, rows]) => rows.length);
  if (!groups.length) return renderKeyValueSection('Mellores xogadores', [['Mellores xogadores', 'Non se atoparon datos de mellores xogadores.']]);
  return `
    <section class="section">
      <h3>Mellores xogadores</h3>
      <div class="rows">
        ${groups.map(([label, rows]) => `
          <div class="row">
            <strong>${escapeHtml(label)}</strong>
            ${rows.slice(0, 5).map((row) => `<span class="inline-stat">${escapeHtml(playerLabel(row))}</span>`).join('')}
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderLiveEventsSection(live) {
  const events = firstArray(live?.envivo || {}, ['historialacciones']);
  if (!events.length) return renderKeyValueSection('Directo', [['Accions', live?.error || 'Non se atopou historial de accions.']]);
  return renderRowSection('Directo', events.slice(-30).reverse(), (row) => [
    row.tiempo_partido || row.tiempo || row.minuto,
    row.accion_tipo || row.accion || row.descripcion,
    row.jugador || row.NombreJugador,
    row.puntos ? `${row.puntos} pts` : '',
  ].filter(Boolean).join(' · '));
}

function renderVideoSection(videosResponse) {
  const videos = firstArray(videosResponse || {}, ['videos']);
  if (!videos.length) return renderKeyValueSection('Videos', [['Videos', videosResponse?.error || 'Non se atoparon videos.']]);
  return renderRowSection('Videos', videos, (row) => row.Titulo || row.titulo || row.urlVideoPartido || row.Url || row.url || 'Video');
}

function renderComparisonSection(comparison) {
  const local = comparison?.EstadisticasEquipoLocal;
  const visitor = comparison?.EstadisticasEquipoVisitante;
  if (!local && !visitor) return '';
  const keys = uniqueKeys(local, visitor).filter((key) => !ignoredObjectKey(key)).slice(0, 18);
  if (!keys.length) return '';
  return `
    <section class="section">
      <h3>Comparativa</h3>
      <div class="stat-table">
        <div class="stat-row stat-head"><span>Métrica</span><span>Local</span><span>Visitante</span></div>
        ${keys.map((key) => `
          <div class="stat-row">
            <span>${escapeHtml(humanizeKey(key))}</span>
            <span>${escapeHtml(shortValue(local?.[key]))}</span>
            <span>${escapeHtml(shortValue(visitor?.[key]))}</span>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderShotMapSection(shotMap) {
  if (!shotMap) return '';
  const rows = [
    ['Xogadores locais', firstArray(shotMap, ['jugadoreslocales']).length],
    ['Xogadores visitantes', firstArray(shotMap, ['jugadoresvisitantes']).length],
    ['Tiros', firstArray(shotMap, ['tiros']).length],
    ['Zonas de tiro locais', firstArray(shotMap, ['tiroszonalocal']).length],
    ['Zonas de tiro visitantes', firstArray(shotMap, ['tiroszonavisitante']).length],
  ].filter(([, value]) => Number(value) > 0);
  return rows.length ? renderKeyValueSection('Mapa de tiro', rows) : '';
}

function renderRowSection(title, rows, getLabel, getLinkedItem) {
  if (!rows?.length) return `<section class="section"><h3>${escapeHtml(title)}</h3><div class="rows"><p class="muted">Non se atoparon datos.</p></div></section>`;
  return `
    <section class="section">
      <h3>${escapeHtml(title)}</h3>
      <div class="rows">
        ${rows.slice(0, 20).map((row) => renderRow(row, getLabel, getLinkedItem)).join('')}
      </div>
    </section>
  `;
}

function renderRow(row, getLabel, getLinkedItem) {
  const label = escapeHtml(getLabel(row) || 'Sen nome');
  const item = getLinkedItem?.(row);
  if (!item || !getId(item)) return `<div class="row">${label}</div>`;
  const key = registerRenderedItem(item);
  return `<button type="button" class="link-row" data-related-key="${key}">${label}</button>`;
}

function renderKeyValueBlock(title, rows) {
  const visibleRows = rows.filter(([, value]) => hasMeaningfulValue(value));
  if (!visibleRows.length) return '';
  return `
    <div class="group-card">
      <h4>${escapeHtml(title)}</h4>
      <div class="rows compact">
        ${visibleRows.map(([label, value]) => `<div class="row"><strong>${escapeHtml(label)}</strong>: ${escapeHtml(shortValue(value))}</div>`).join('')}
      </div>
    </div>
  `;
}

function renderGroupEmpty(title, message) {
  return `
    <div class="group-card">
      <h4>${escapeHtml(title)}</h4>
      <div class="rows compact"><div class="row"><strong>${escapeHtml(title)}</strong>: ${escapeHtml(message)}</div></div>
    </div>
  `;
}

function renderGroupRows(title, rows, getLabel, getLinkedItem) {
  return `
    <div class="group-card">
      <h4>${escapeHtml(title)}</h4>
      <div class="rows compact">
        ${rows.slice(0, 16).map((row) => renderRow(row, getLabel, getLinkedItem)).join('')}
      </div>
    </div>
  `;
}

function renderMiniTable(title, columns, rows, getCells, getLinkedItem) {
  return `
    <div class="group-card wide">
      <h4>${escapeHtml(title)}</h4>
      <div class="mini-table">
        <div class="mini-row mini-head" style="grid-template-columns: ${columns.map(() => 'minmax(0, 1fr)').join(' ')}">
          ${columns.map((column) => `<span>${escapeHtml(column)}</span>`).join('')}
        </div>
        ${rows.slice(0, 20).map((row) => renderMiniRow(row, getCells, getLinkedItem, columns.length)).join('')}
      </div>
    </div>
  `;
}

function renderMiniRow(row, getCells, getLinkedItem, columnCount) {
  const style = `grid-template-columns: ${Array.from({ length: columnCount }, () => 'minmax(0, 1fr)').join(' ')}`;
  const cells = getCells(row).map((value) => `<span>${escapeHtml(value ?? '-')}</span>`).join('');
  const item = getLinkedItem?.(row);
  if (!item || !getId(item)) return `<div class="mini-row" style="${style}">${cells}</div>`;
  const key = registerRenderedItem(item);
  return `<button type="button" class="mini-row mini-link" style="${style}" data-related-key="${key}">${cells}</button>`;
}

function renderGroupLeaders(title, groups, getLabel, getLinkedItem) {
  return `
    <div class="group-card">
      <h4>${escapeHtml(title)}</h4>
      <div class="rows compact">
        ${groups.map(([label, rows]) => `
          <div class="row leader-group">
            <strong>${escapeHtml(label)}</strong>
            ${rows.slice(0, 5).map((row) => renderGroupLeader(row, getLabel, getLinkedItem)).join('')}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderGroupLeader(row, getLabel, getLinkedItem) {
  const label = escapeHtml(getLabel(row));
  const item = getLinkedItem?.(row);
  if (!item || !getId(item)) return `<span class="inline-stat">${label}</span>`;
  const key = registerRenderedItem(item);
  return `<button type="button" class="inline-link" data-related-key="${key}">${label}</button>`;
}

function renderInlineRelatedRow(label, text, item) {
  const key = registerRenderedItem(item);
  return `<div class="row"><strong>${escapeHtml(label)}</strong>: <button type="button" class="inline-link inline-value-link" data-related-key="${key}">${escapeHtml(text || '-')}</button></div>`;
}

function renderPlainValueRow(label, value) {
  if (!hasMeaningfulValue(value)) return '';
  return `<div class="row"><strong>${escapeHtml(label)}</strong>: ${escapeHtml(shortValue(value))}</div>`;
}

function renderObjectSection(title, object) {
  if (!object) return `<section class="section"><h3>${escapeHtml(title)}</h3><div class="rows"><p class="muted">Non se atoparon datos.</p></div></section>`;
  const keys = Object.keys(object).filter((key) => !['id_dispositivo', 'key', 'ruta'].includes(key));
  if (!keys.length) return `<section class="section"><h3>${escapeHtml(title)}</h3><div class="rows"><p class="muted">Non se atoparon campos.</p></div></section>`;
  return `
    <section class="section">
      <h3>${escapeHtml(title)}</h3>
      <div class="rows">
        ${keys.slice(0, 14).map((key) => `<div class="row"><strong>${escapeHtml(key)}</strong>: ${escapeHtml(shortValue(object[key]))}</div>`).join('')}
      </div>
    </section>
  `;
}

function attachRelatedHandlers() {
  els.content.querySelectorAll('[data-related-key]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = renderedItems.get(button.dataset.relatedKey);
      if (item) openDetail(item, true).catch(showError);
    });
  });
}

function renderFacts(facts) {
  return `<div class="facts">${facts.map(([label, value]) => `<div class="fact"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? '-')}</strong></div>`).join('')}</div>`;
}

function primaryFacts(item) {
  if (item.type === 'match') {
    return [
      ['Equipos', matchTeams(item)],
      ['Data', displayDate(item.Fecha || item.FechaPartido || item.fechaPartido, false)],
      ['Categoría', item.Categoria || item.NombreCategoria],
      ['Pavillón', item.CampoJuego || item.campoJuego],
    ];
  }
  return [
    ['Club', item.Club || item.NombreClub],
    ['Categoría', item.Categoria || item.NombreCategoria],
    ['Competición', item.Competicion || item.NombreCompeticion],
    ['Tempada', item.Temporada],
    ['Partidos', item.PartidosJugados],
    [item.type === 'player' ? 'Puntos/partido' : 'Vitorias', item.type === 'player' ? item.PuntosPorPartido : item.PartidosGanados],
  ];
}

async function saveFavorite(item) {
  await ensureAuth();
  if (item.type === 'player') await post('/v2/misjugadores.ashx', { accion: 'insertar', id_jugador: getId(item) });
  if (item.type === 'team') await post('/v2/misequipos.ashx', { accion: 'insertar', id_equipo: getId(item) });
  if (item.type === 'match') await post('/v2/mispartidos.ashx', { accion: 'insertar', id_calendario: getId(item) });
  cacheFavorite(item);
}

async function removeFavorite(item) {
  await ensureAuth();
  if (item.type === 'player') await post('/v2/misjugadores.ashx', { accion: 'eliminar', id_jugador: getId(item) });
  if (item.type === 'team') await post('/v2/misequipos.ashx', { accion: 'eliminar', id_equipo: getId(item) });
  if (item.type === 'match') await post('/v2/mispartidos.ashx', { accion: 'eliminar', id_calendario: getId(item) });
  uncacheFavorite(item);
}

function cacheFavorite(item) {
  const key = localFavoriteKey(item.type);
  const list = JSON.parse(localStorage.getItem(key) || '[]');
  if (!list.some((row) => getId(row) === getId(item))) {
    list.unshift(item);
    localStorage.setItem(key, JSON.stringify(list));
  }
}

function uncacheFavorite(item) {
  const key = localFavoriteKey(item.type);
  const list = JSON.parse(localStorage.getItem(key) || '[]').filter((row) => getId(row) !== getId(item));
  localStorage.setItem(key, JSON.stringify(list));
}

function isFavorite(item) {
  return readLocalFavorites(item.type).some((row) => getId(row) === getId(item));
}

function readLocalFavorites(type) {
  return JSON.parse(localStorage.getItem(localFavoriteKey(type)) || '[]').map((item) => ({ ...item, type }));
}

function localFavoriteKey(type) {
  if (type === 'player') return `${STORAGE_PREFIX}_favorite_players`;
  if (type === 'team') return `${STORAGE_PREFIX}_favorite_teams`;
  return `${STORAGE_PREFIX}_favorite_matches`;
}

function firstArray(object, keys) {
  for (const key of keys) {
    if (Array.isArray(object?.[key])) return object[key];
  }
  return [];
}

function firstObject(object, keys) {
  for (const key of keys) {
    if (object?.[key] && typeof object[key] === 'object' && !Array.isArray(object[key])) return object[key];
  }
  return null;
}

function normalize(items = [], type) {
  return items.map((item) => ({ ...item, type }));
}

function mergeById(primary, secondary) {
  const merged = [...primary];
  secondary.forEach((item) => {
    if (!merged.some((row) => getId(row) === getId(item))) merged.push(item);
  });
  return merged;
}

function sortedBrowseItems(items, type) {
  return ['category', 'match'].includes(type) ? sortRecordsMostRecent(items) : items;
}

function sortRecordsMostRecent(rows = []) {
  return rows
    .map((row, index) => ({ row, index, stamp: recordTimestamp(row) }))
    .sort((left, right) => {
      if (left.stamp !== right.stamp) return right.stamp - left.stamp;
      return left.index - right.index;
    })
    .map(({ row }) => row);
}

function recordTimestamp(row) {
  const values = [
    row?.FechaHora,
    row?.fechaHora,
    row?.FechaHoraUTC,
    row?.fechaHoraUTC,
    row?.FechaPartido,
    row?.fechaPartido,
    row?.Fecha,
    row?.fecha,
    row?.fecha_hora,
    row?.FechaJornada,
    row?.fechaJornada,
    row?.FechaInicio,
    row?.FechaFin,
    row?.Temporada,
  ];
  for (const value of values) {
    const stamp = parseTimestamp(value);
    if (stamp) return stamp;
  }
  return 0;
}

function parseTimestamp(value) {
  if (!value) return 0;
  const raw = String(value).trim();
  const apiDate = parseApiDateTimestamp(raw);
  if (apiDate !== null) return apiDate;
  const europeanDate = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (europeanDate) {
    const [, day, month, year] = europeanDate;
    return new Date(Number(year), Number(month) - 1, Number(day)).getTime();
  }
  const seasonYears = raw.match(/\b(20\d{2})(?:\D+(20\d{2}))?\b/);
  if (seasonYears) return new Date(Number(seasonYears[2] || seasonYears[1]), 6, 1).getTime();
  const parsed = new Date(raw).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getId(item) {
  return item?.Id || item?.id || item?.IdEquipo || item?.idEquipo || item?.IdJugador || item?.idJugador || item?.IdPartido || item?.idPartido || item?.IdCalendario || item?.idCalendario || item?.IdCategoriaCompeticion || item?.IdCompeticionCategoria || '';
}

function teamItem(row) {
  const id = row.Id || row.IdEquipo || row.idEquipo;
  return id ? { ...row, type: 'team', Id: id, Nombre: row.Nombre || row.NombreEquipo || row.Equipo || 'Equipo' } : null;
}

function teamItemFromMatch(match, side) {
  const local = side === 'local';
  const id = local
    ? firstMeaningfulValue(match.IdEquipoLocal, match.idEquipoLocal, match.EquipoLocalId, match.equipoLocalId, match.IdLocal, match.idLocal)
    : firstMeaningfulValue(match.IdEquipoVisitante, match.idEquipoVisitante, match.EquipoVisitanteId, match.equipoVisitanteId, match.IdVisitante, match.idVisitante);
  const name = local
    ? firstMeaningfulValue(match.NombreEquipoLocal, match.EquipoLocal, match.equipoLocal, match.local)
    : firstMeaningfulValue(match.NombreEquipoVisitante, match.EquipoVisitante, match.equipoVisitante, match.visitante);
  return id ? { type: 'team', Id: id, Nombre: name || 'Equipo' } : null;
}

function playerItem(row) {
  const id = row.Id || row.IdJugador || row.idJugador;
  return id ? { ...row, type: 'player', Id: id, Nombre: row.Nombre || row.Jugador || 'Xogador' } : null;
}

function matchItem(row) {
  const id = row.Id || row.IdPartido || row.idPartido || row.IdCalendario || row.idCalendario;
  return id ? { ...row, type: 'match', IdPartido: id } : null;
}

function titleFor(item) {
  if (item?.type === 'match') return matchTeams(item) || item.Partido || item.partido || 'Partido';
  return item?.Nombre || item?.nombre || item?.Equipo || item?.equipo || item?.Club || item?.NombreClub || item?.Categoria || item?.NombreCategoria || item?.NombreCompeticion || 'Sen nome';
}

function summaryFor(item) {
  if (item.type === 'match') {
    const result = matchResultLabel(item, matchScoreObject(item, null));
    return [matchDateLabel(item), item.Categoria || item.NombreCategoria, result !== '-' ? result : ''].filter(Boolean).join(' · ') || 'Partido';
  }
  return [item.Club || item.NombreClub, item.Categoria || item.NombreCategoria, item.Competicion || item.NombreCompeticion, item.Temporada].filter(Boolean).join(' · ') || 'Sen resumo dispoñible';
}

function matchTeams(item) {
  const local = item.EquipoLocal || item.NombreEquipoLocal || item.NombreClubLocal || item.equipoLocal || item.local;
  const visitor = item.EquipoVisitante || item.NombreEquipoVisitante || item.NombreClubVisitante || item.equipoVisitante || item.visitante;
  return [local, visitor].filter(Boolean).join(' contra ');
}

function matchTeamsObject(match, liveMatch) {
  return {
    local: match.NombreEquipoLocal || match.EquipoLocal || match.equipoLocal || liveMatch?.local || match.local,
    visitor: match.NombreEquipoVisitante || match.EquipoVisitante || match.equipoVisitante || liveMatch?.visitante || match.visitante,
  };
}

function matchScoreObject(match, liveMatch) {
  return {
    local: firstMeaningfulValue(match.Resultados?.ResultadoLocal, match.ResultadoLocal, match.resultadoLocal, match.PuntosLocal, match.puntosLocal, liveMatch?.tanteo_local, '-'),
    visitor: firstMeaningfulValue(match.Resultados?.ResultadoVisitante, match.ResultadoVisitante, match.resultadoVisitante, match.PuntosVisitante, match.puntosVisitante, liveMatch?.tanteo_visitante, '-'),
  };
}

function firstMeaningfulValue(...values) {
  return values.find(hasMeaningfulValue);
}

function labelFor(type) {
  return { player: 'Xogador', team: 'Equipo', club: 'Club', category: 'Categoría', match: 'Partido' }[type] || 'Elemento';
}

function shortValue(value) {
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'elemento' : 'elementos'}`;
  if (value && typeof value === 'object') return Object.keys(value).join(', ');
  return value ?? '-';
}

function renderKeyValueSection(title, rows) {
  const visibleRows = rows.filter(([, value]) => hasMeaningfulValue(value));
  if (!visibleRows.length) return '';
  return `
    <section class="section">
      <h3>${escapeHtml(title)}</h3>
      <div class="rows">
        ${visibleRows.map(([label, value]) => `<div class="row"><strong>${escapeHtml(label)}</strong>: ${escapeHtml(shortValue(value))}</div>`).join('')}
      </div>
    </section>
  `;
}

function hasMeaningfulValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function readableDate(value) {
  return displayDate(value, true);
}

function displayDate(value, includeTime = true) {
  if (!value) return '';
  const raw = String(value);
  const apiDate = parseApiDateTimestamp(raw);
  if (apiDate === null && /\d{1,2}\/\d{1,2}\/\d{4}/.test(raw)) return raw;
  const date = apiDate !== null ? new Date(apiDate) : new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  const datePart = new Intl.DateTimeFormat('gl-ES', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  if (!includeTime) return datePart;
  const timePart = new Intl.DateTimeFormat('gl-ES', { hour: '2-digit', minute: '2-digit' }).format(date);
  return `${datePart} ${timePart}`;
}

function parseApiDateTimestamp(value) {
  const match = String(value || '').trim().match(/^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/);
  if (!match) return null;
  const timestamp = Number(match[1]);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function humanizeKey(key) {
  return String(key)
    .replaceAll('_', ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\\b\\w/g, (letter) => letter.toUpperCase());
}

function playerLabel(row) {
  return [
    row.Nombre || row.Jugador || row.nombre || row.jugador || 'Xogador',
    row.valoracion ?? row.puntos ?? row.rebotes ?? row.asistencias ?? row.recuperaciones ?? row.tapones ?? row.masMenos,
  ].filter(hasMeaningfulValue).join(' · ');
}

function teamStatLabel(row) {
  return [
    row.Equipo || row.NombreEquipo || 'Equipo',
    row.Total !== undefined ? `total ${row.Total}` : '',
    row.Media !== undefined ? `media ${row.Media}` : '',
    row.Porcentaje !== undefined ? `${row.Anotados || 0}/${row.Intentos || 0} (${row.Porcentaje}%)` : '',
  ].filter(hasMeaningfulValue).join(' · ');
}

function playerStatLabel(row) {
  return [
    row.Jugador || row.NombreJugador || row.Nombre || 'Xogador',
    row.Equipo,
    row.Total !== undefined ? `total ${row.Total}` : '',
    row.Media !== undefined ? `media ${row.Media}` : '',
    row.Porcentaje !== undefined ? `${row.Anotados || 0}/${row.Intentos || 0} (${row.Porcentaje}%)` : '',
  ].filter(hasMeaningfulValue).join(' · ');
}

function playerItemFromStat(row) {
  const id = row.JugadorId || row.IdJugador || row.Id;
  return id ? { ...row, type: 'player', Id: id, Nombre: row.Jugador || row.NombreJugador || row.Nombre || 'Xogador' } : null;
}

function uniqueKeys(...objects) {
  return [...new Set(objects.flatMap((object) => object && typeof object === 'object' ? Object.keys(object) : []))];
}

function ignoredObjectKey(key) {
  return ['id_dispositivo', 'key', 'ruta', 'configuracion', 'LOGO_GESDEPORTIVA'].includes(key) || /logo|imagen|img/i.test(key);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

els.identityBtn.addEventListener('click', () => {
  renderIdentity();
  els.identityDialog.showModal();
});
els.registerBtn.addEventListener('click', () => registerDevice().catch((error) => {
  els.identityStatus.textContent = error.message;
  els.identityStatus.style.color = 'var(--danger)';
}));
els.clearBtn.addEventListener('click', clearAuth);
els.tabs.forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)));
window.addEventListener('popstate', (event) => {
  state.routeIndex = event.state?.index ?? 0;
  applyRoute(event.state?.route || readRoute());
});

renderIdentity();
const initialRoute = readRoute();
writeRoute(initialRoute, true);
applyRoute(initialRoute);
