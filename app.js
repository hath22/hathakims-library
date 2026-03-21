// ── OMDB API ──────────────────────────────────────────────────────────────
const OMDB_KEY = '643be800';

async function fetchOMDB(title, type) {
  const t = type === 'tv' ? 'series' : type === 'arwen' ? '' : 'movie';
  const typeParam = t ? `&type=${t}` : '';
  const url = `https://www.omdbapi.com/?apikey=${OMDB_KEY}&t=${encodeURIComponent(title)}${typeParam}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.Response === 'True' ? data : null;
  } catch { return null; }
}

async function fetchOMDBSearch(title, type) {
  const t = type === 'tv' ? 'series' : type === 'arwen' ? '' : 'movie';
  const typeParam = t ? `&type=${t}` : '';
  const url = `https://www.omdbapi.com/?apikey=${OMDB_KEY}&s=${encodeURIComponent(title)}${typeParam}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.Response === 'True' ? data.Search : null;
  } catch { return null; }
}

async function fetchOMDBById(imdbId) {
  const url = `https://www.omdbapi.com/?apikey=${OMDB_KEY}&i=${imdbId}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data.Response === 'True' ? data : null;
  } catch { return null; }
}

function omdbToFields(data) {
  const n = v => v && v !== 'N/A' ? v : null;
  // OMDB year can be "2008–2013" for series — take first 4 digits
  const year = n(data.Year) ? parseInt(data.Year.slice(0, 4)) : null;
  // For series, Director is often N/A; Writer often holds the creator
  const creator = n(data.Director) || n(data.Writer) || null;
  // Runtime: "142 min" → 142
  const runtimeStr = n(data.Runtime);
  const runtime = runtimeStr ? parseInt(runtimeStr) || null : null;
  // Language: primary (first listed). Null if English.
  const langStr = n(data.Language);
  const primaryLang = langStr ? langStr.split(',')[0].trim() : null;
  const language = (primaryLang && primaryLang.toLowerCase() !== 'english') ? primaryLang : null;
  return {
    title:    n(data.Title),
    year,
    genre:    n(data.Genre),
    rating:   n(data.imdbRating) ? parseFloat(data.imdbRating) : null,
    creator,
    poster:   n(data.Poster),
    type:     data.Type === 'series' ? 'tv' : 'movie',
    runtime,
    language,
  };
}

const LANG_FLAGS = {
  'french':'🇫🇷','spanish':'🇪🇸','german':'🇩🇪','italian':'🇮🇹',
  'japanese':'🇯🇵','korean':'🇰🇷','mandarin':'🇨🇳','cantonese':'🇨🇳','chinese':'🇨🇳',
  'portuguese':'🇵🇹','russian':'🇷🇺','arabic':'🇸🇦','hindi':'🇮🇳',
  'swedish':'🇸🇪','danish':'🇩🇰','norwegian':'🇳🇴','finnish':'🇫🇮','dutch':'🇳🇱',
  'polish':'🇵🇱','turkish':'🇹🇷','hebrew':'🇮🇱','thai':'🇹🇭','vietnamese':'🇻🇳',
  'romanian':'🇷🇴','czech':'🇨🇿','greek':'🇬🇷','hungarian':'🇭🇺','ukrainian':'🇺🇦',
  'farsi':'🇮🇷','persian':'🇮🇷','tagalog':'🇵🇭','indonesian':'🇮🇩','malay':'🇲🇾',
};
function langFlag(lang) {
  if (!lang) return '';
  const flag = LANG_FLAGS[lang.toLowerCase()];
  return flag ? `<span class="lang-flag" title="${escHtml(lang)}">${flag}</span>` : '';
}

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' toast-error' : '');
  t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 3500);
}

// ── Supabase ──────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://cldzxfmofsijgqcjuzkq.supabase.co';
const SUPABASE_KEY = 'sb_publishable_S6S9cVdFrDF63THKNhd5ng_ZNTa6xde';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── State ─────────────────────────────────────────────────────────────────
let library = [];
let nextId  = 1;

// ── Lists state ───────────────────────────────────────────────────────────
let lists         = [];
let listsNextId   = 1;
let currentListId = null;

let activeType   = 'all';
let searchQuery  = '';
let filterGenre  = '';
let filterRating = '';
let sortBy       = 'dateAdded';

// ── Persist ───────────────────────────────────────────────────────────────
async function save() {
  localStorage.setItem('mediaLibrary', JSON.stringify(library));
  if (library.length > 0) {
    const { error } = await db.from('library').upsert(library);
    if (error) console.warn('Supabase save error:', error);
  }
}

async function saveLists() {
  localStorage.setItem('mediaLists', JSON.stringify(lists));
  const rows = lists.map(l => ({ id: l.id, name: l.name, item_ids: l.itemIds || [], created_at: l.createdAt || null }));
  if (rows.length > 0) {
    const { error } = await db.from('lists').upsert(rows);
    if (error) console.warn('Supabase saveLists error:', error);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────
async function initApp() {
  // Show a subtle loading state
  document.getElementById('grid').innerHTML = '<p style="color:var(--muted);padding:40px;grid-column:1/-1;text-align:center">Loading library…</p>';

  // Load library
  const { data: libData, error: libErr } = await db.from('library').select('*');
  if (libErr) console.warn('Supabase load error:', libErr);

  if (libData && libData.length > 0) {
    library = libData;
  } else {
    // First run — seed from data.js
    library = [...LIBRARY_DATA];
    await db.from('library').upsert(library);
  }
  nextId = Math.max(...library.map(i => i.id), 0) + 1;

  // Load lists
  const { data: listsData } = await db.from('lists').select('*');
  lists = (listsData || []).map(l => ({ id: l.id, name: l.name, itemIds: l.item_ids || [], createdAt: l.created_at }));
  listsNextId = Math.max(...lists.map(l => l.id), 0) + 1;

  render();
}

initApp();

// ── Genre list ────────────────────────────────────────────────────────────
function buildGenreFilter() {
  const genres = new Set();
  library.forEach(item => {
    (item.genre || '').split(',').map(g => g.trim()).filter(Boolean).forEach(g => genres.add(g));
  });
  const sel = document.getElementById('filterGenre');
  const current = sel.value;
  sel.innerHTML = '<option value="">All Genres</option>' +
    [...genres].sort().map(g => `<option value="${g}"${g === current ? ' selected' : ''}>${g}</option>`).join('');
}

// ── Poster gradient ───────────────────────────────────────────────────────
const GRADIENTS = [
  'linear-gradient(135deg,#1e3a5f,#0f1e3a)',
  'linear-gradient(135deg,#3a1f5f,#1e0f3a)',
  'linear-gradient(135deg,#1f3a2a,#0f1e15)',
  'linear-gradient(135deg,#3a2a1f,#1e150f)',
  'linear-gradient(135deg,#1f2a3a,#0f1520)',
  'linear-gradient(135deg,#3a1f2a,#1e0f15)',
  'linear-gradient(135deg,#2a3a1f,#151e0f)',
  'linear-gradient(135deg,#3a3a1f,#1e1e0f)',
];
function getGradient(id) { return GRADIENTS[id % GRADIENTS.length]; }

const TYPE_ICON = { movie: '🎬', tv: '📺', arwen: '⭐' };

// ── Render helpers ────────────────────────────────────────────────────────
function ratingColor(r) {
  if (r >= 7.5) return '#22c55e'; // green
  if (r >= 6.0) return '#f59e0b'; // yellow
  return '#e2e8f0';               // white/light
}

function renderStars(rating) {
  if (!rating) return '';
  const full  = Math.round(rating / 2);
  const empty = 5 - full;
  return `<span class="stars">${'<span class="star filled">★</span>'.repeat(full)}${'<span class="star">★</span>'.repeat(empty)}</span>`;
}

function statusLabel(s) {
  return { watched: 'Watched', watching: 'Watching', want: 'Want to Watch' }[s] || s;
}

function cardHTML(item) {
  const poster = item.poster
    ? `<img src="${escHtml(item.poster)}" alt="${escHtml(item.title)}" loading="lazy" onerror="this.parentNode.innerHTML='<div class=card-poster-placeholder style=background:${getGradient(item.id)}><span class=poster-icon>${TYPE_ICON[item.type]||'🎬'}</span><span>${escHtml(item.title)}</span></div>'">`
    : `<div class="card-poster-placeholder" style="background:${getGradient(item.id)}"><span class="poster-icon">${TYPE_ICON[item.type] || '🎬'}</span><span>${escHtml(item.title)}</span></div>`;

  return `
  <div class="card${item.status === 'watched' ? ' card--watched' : ''}${item.hearted ? ' card--hearted' : ''}" data-id="${item.id}" onclick="openDetail(${item.id})">
    <div class="card-poster">
      ${poster}
      ${activeType === 'movie' || activeType === 'tv' || activeType === 'arwen' ? '' : `<span class="type-badge">${item.type === 'tv' ? 'TV' : item.type === 'arwen' ? 'Arwen' : 'Movie'}</span>`}
      ${langFlag(item.language)}
      <button class="heart-btn${item.hearted ? ' hearted' : ''}" onclick="event.stopPropagation(); toggleHeart(${item.id})" title="${item.hearted ? 'Remove from favourites' : 'Add to favourites'}">
        <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 21C12 21 3 14 3 8.5A5 5 0 0 1 12 6a5 5 0 0 1 9 2.5C21 14 12 21 12 21z" stroke="currentColor" stroke-width="2" stroke-linejoin="round" ${item.hearted ? 'fill="currentColor"' : 'fill="none"'}/></svg>
      </button>
    </div>
    <div class="card-body">
      <div class="card-title">${escHtml(item.title)}</div>
      <div class="card-meta">
        ${item.year ? `<span>${item.year}</span>` : ''}
        ${item.runtime ? `<span class="dot">·</span><span>${item.runtime}m</span>` : ''}
        ${item.creator ? `<span class="dot">·</span><span>${escHtml(item.creator.split(',')[0].trim())}</span>` : ''}
      </div>
      ${item.genre ? `<div class="card-genre">${escHtml(item.genre)}</div>` : ''}
      ${item.rating ? `<div class="card-rating" style="color:${ratingColor(item.rating)}"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1l1.4 2.8L11 4.3l-2.5 2.4.6 3.4L6 8.5l-3.1 1.6.6-3.4L1 4.3l3.6-.5z" fill="${ratingColor(item.rating)}"/></svg>${item.rating.toFixed(1)}</div>` : ''}
    </div>
    <div class="card-watched" onclick="event.stopPropagation()">
      <label class="watched-label">
        <input type="checkbox" class="watched-check" ${item.status === 'watched' ? 'checked' : ''} onchange="toggleWatched(${item.id}, this.checked)">
        <span>Watched</span>
      </label>
    </div>
    <div class="card-actions" onclick="event.stopPropagation()">
      <button class="card-btn" onclick="openEdit(${item.id})" title="Edit">✏ Edit</button>
      <button class="card-btn list-add-btn${lists.some(l => l.itemIds.includes(item.id)) ? ' in-list' : ''}" onclick="toggleListPopover(event,${item.id})" title="Add to list">☰</button>
    </div>
  </div>`;
}

// ── Page title ────────────────────────────────────────────────────────────
function updatePageTitle() {
  const el = document.getElementById('libraryPageTitle');
  if (!el) return;
  const titles = { all: 'My Library', movie: 'Movies', tv: 'TV Shows', arwen: 'Arwen' };
  el.textContent = titles[activeType] || 'My Library';
}

// ── Stats bar ─────────────────────────────────────────────────────────────
function updateStats() {
  const bar = document.getElementById('statsBar');
  if (!bar) return;
  const s = (val, lbl) => `<div class="stat"><span>${val}</span><label>${lbl}</label></div>`;
  const count = f => library.filter(f).length;

  let html;
  if (activeType === 'movie') {
    html = s(count(i => i.type === 'movie'), 'Movies')
         + s(count(i => i.type === 'movie' && i.status === 'watched'), 'Watched');
  } else if (activeType === 'tv') {
    html = s(count(i => i.type === 'tv'), 'TV Shows')
         + s(count(i => i.type === 'tv' && i.status === 'watched'), 'Watched');
  } else if (activeType === 'arwen') {
    html = s(count(i => i.type === 'arwen' && i.subtype !== 'tv'), 'Movies')
         + s(count(i => i.type === 'arwen' && i.subtype === 'tv'), 'TV Shows');
  } else {
    html = s(count(() => true), 'Total')
         + s(count(i => i.type === 'movie'), 'Movies')
         + s(count(i => i.type === 'tv'), 'TV Shows')
         + s(count(i => i.type === 'arwen'), 'Arwen')
         + s(count(i => i.status === 'watched'), 'Watched');
  }
  bar.innerHTML = html;
}

// ── Main render ───────────────────────────────────────────────────────────
function render(animateCards = false) {
  updatePageTitle();
  buildGenreFilter();

  let items = [...library];

  // Type filter (nav)
  if (activeType !== 'all') items = items.filter(i => i.type === activeType);

  // Search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    items = items.filter(i =>
      i.title.toLowerCase().includes(q) ||
      (i.genre  || '').toLowerCase().includes(q) ||
      (i.creator || '').toLowerCase().includes(q) ||
      (i.notes   || '').toLowerCase().includes(q)
    );
  }

  // Filters
  if (filterGenre)  items = items.filter(i => (i.genre || '').split(',').map(g => g.trim()).includes(filterGenre));
  if (filterRating) items = items.filter(i => i.rating >= +filterRating);

  // Sort
  items.sort((a, b) => {
    if (sortBy === 'title')     return a.title.localeCompare(b.title);
    if (sortBy === 'year')      return (b.year || 0) - (a.year || 0);
    if (sortBy === 'rating')    return (b.rating || 0) - (a.rating || 0);
    return b.id - a.id; // dateAdded (higher id = more recent)
  });

  const grid  = document.getElementById('grid');
  const empty = document.getElementById('empty');

  if (items.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
  } else {
    empty.style.display = 'none';
    const unwatched = items.filter(i => i.status !== 'watched');
    const watched   = items.filter(i => i.status === 'watched');

    let html = unwatched.map(cardHTML).join('');

    if (watched.length > 0) {
      if (unwatched.length > 0) {
        html += `<div class="watched-divider"><span>Watched</span></div>`;
      }
      html += watched.map(cardHTML).join('');
    }

    grid.innerHTML = html;

    if (animateCards) {
      grid.querySelectorAll('.card').forEach((card, i) => {
        card.style.animationDelay = `${i * 30}ms`;
        card.classList.add('card--entering');
      });
    }
  }

  updateStats();

  // Result count (hidden)
  const rc = document.getElementById('resultCount');
  rc.textContent = '';

  // Active filter tags
  renderFilterTags();
}

function renderFilterTags() {
  const c = document.getElementById('activeFilters');
  const tags = [];
  if (filterGenre)  tags.push({ label: filterGenre,               key: 'genre'  });
  if (filterRating) tags.push({ label: `${filterRating}+ rating`, key: 'rating' });
  if (searchQuery)  tags.push({ label: `"${searchQuery}"`,         key: 'search' });

  c.innerHTML = tags.map(t =>
    `<span class="filter-tag">${escHtml(t.label)} <button onclick="clearTag('${t.key}')">✕</button></span>`
  ).join('');
}

function clearTag(key) {
  if (key === 'genre')  { filterGenre  = ''; document.getElementById('filterGenre').value  = ''; }
  if (key === 'rating') { filterRating = ''; document.getElementById('filterRating').value = ''; }
  if (key === 'search') { searchQuery  = ''; document.getElementById('searchInput').value  = ''; document.getElementById('clearSearch').style.display = 'none'; }
  render();
}

function resetFilters() {
  searchQuery = filterGenre = filterRating = '';
  activeType = 'all';
  document.getElementById('searchInput').value  = '';
  document.getElementById('filterGenre').value  = '';
  document.getElementById('filterRating').value = '';
  document.getElementById('clearSearch').style.display = 'none';
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.filterType === 'all'));
  render();
}

// ── Detail modal ──────────────────────────────────────────────────────────
function openDetail(id) {
  const item = library.find(i => i.id === id);
  if (!item) return;

  const poster = item.poster
    ? `<img src="${escHtml(item.poster)}" alt="${escHtml(item.title)}" style="width:100%;height:100%;object-fit:cover">`
    : `<div class="detail-poster-placeholder" style="background:${getGradient(item.id)};width:100%;height:100%">${TYPE_ICON[item.type] || '🎬'}</div>`;

  const statusClass = { watched: 'badge-watched', watching: 'badge-watching', want: 'badge-want' }[item.status] || '';

  document.getElementById('detailContent').innerHTML = `
    <div class="detail-layout">
      <div class="detail-poster">${poster}</div>
      <div class="detail-info">
        <h2 class="detail-title">${escHtml(item.title)}</h2>
        <div class="detail-badges">
          <span class="badge ${item.type === 'arwen' ? 'badge-arwen' : 'badge-type'}">${item.type === 'tv' ? 'TV Show' : item.type === 'arwen' ? 'Arwen' : 'Movie'}</span>
        </div>
        <div class="detail-meta">
          ${item.year     ? `<div class="detail-meta-item"><label>Year</label><span>${item.year}</span></div>` : ''}
          ${item.rating   ? `<div class="detail-meta-item"><label>Rating</label><span>${renderStars(item.rating)} ${item.rating.toFixed(1)}</span></div>` : ''}
          ${item.creator  ? `<div class="detail-meta-item"><label>${item.type === 'tv' || item.type === 'arwen' ? 'Creator' : 'Director'}</label><span>${escHtml(item.creator)}</span></div>` : ''}
          ${item.genre    ? `<div class="detail-meta-item"><label>Genre</label><span>${escHtml(item.genre)}</span></div>` : ''}
        </div>
        ${item.notes ? `<div class="detail-notes">"${escHtml(item.notes)}"</div>` : ''}
        <div class="detail-actions">
          <button class="btn-primary" onclick="closeDetail();openEdit(${item.id})">✏ Edit</button>
          <button class="btn-secondary" onclick="closeDetail();deleteItem(${item.id})">Delete</button>
        </div>
      </div>
    </div>`;

  document.getElementById('detailModal').style.display = 'flex';
}

function closeDetail() {
  document.getElementById('detailModal').style.display = 'none';
}

// ── Add / Edit modal ──────────────────────────────────────────────────────
function openModal(item = null) {
  const form = document.getElementById('addForm');
  form.reset();
  const status = document.getElementById('imdbStatus');
  if (status) { status.textContent = ''; status.className = 'imdb-status'; }
  closeIMDBPicker();
  const fetchBtn = document.getElementById('fetchIMDB');
  if (fetchBtn) fetchBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M7 4v3.5l2 1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg> Fetch from IMDB`;
  document.getElementById('editId').value    = item ? item.id : '';
  document.getElementById('modalTitle').textContent = item ? 'Edit Title' : 'Add Title';
  document.getElementById('f-title').value   = item?.title   || '';
  document.getElementById('f-type').value    = item?.type    || 'movie';
  document.getElementById('f-year').value    = item?.year    || '';
  document.getElementById('f-genre').value   = item?.genre   || '';
  document.getElementById('f-rating').value  = item?.rating  || '';
  document.getElementById('f-creator').value = item?.creator || '';
  document.getElementById('f-notes').value   = item?.notes   || '';
  document.getElementById('f-poster').value  = item?.poster  || '';
  document.getElementById('modalSyncIMDB').style.display = item ? '' : 'none';
  document.getElementById('modal').style.display = 'flex';
  document.getElementById('f-title').focus();
}

function openEdit(id) {
  const item = library.find(i => i.id === id);
  if (item) openModal(item);
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
}

document.getElementById('addForm').addEventListener('submit', e => {
  e.preventDefault();
  const editId = document.getElementById('editId').value;
  const data = {
    title:   document.getElementById('f-title').value.trim(),
    type:    document.getElementById('f-type').value,
    year:    parseInt(document.getElementById('f-year').value) || null,
    genre:   document.getElementById('f-genre').value.trim(),
    rating:  parseFloat(document.getElementById('f-rating').value) || null,
    creator: document.getElementById('f-creator').value.trim(),
    notes:   document.getElementById('f-notes').value.trim(),
    poster:  document.getElementById('f-poster').value.trim(),
  };

  if (editId) {
    const idx = library.findIndex(i => i.id === +editId);
    if (idx !== -1) library[idx] = { ...library[idx], ...data };
  } else {
    library.unshift({ id: nextId++, ...data });
  }

  save();
  closeModal();
  render();
});

// ── Toggle watched ────────────────────────────────────────────────────────
function toggleWatched(id, checked) {
  const idx = library.findIndex(i => i.id === id);
  if (idx === -1) return;

  const card = document.querySelector(`.card[data-id="${id}"]`);
  const doUpdate = () => {
    library[idx].status = checked ? 'watched' : 'want';
    save();
    render(true); // true = animate cards in
  };

  if (card) {
    card.classList.add('card--exiting');
    setTimeout(doUpdate, 320);
  } else {
    doUpdate();
  }
}

// ── Heart ─────────────────────────────────────────────────────────────────
function toggleHeart(id) {
  const idx = library.findIndex(i => i.id === id);
  if (idx === -1) return;
  library[idx].hearted = !library[idx].hearted;
  save();
  // Update card in place — no full re-render needed
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (card) {
    const hearted = library[idx].hearted;
    card.classList.toggle('card--hearted', hearted);
    const btn = card.querySelector('.heart-btn');
    if (btn) {
      btn.classList.toggle('hearted', hearted);
      btn.title = hearted ? 'Remove from favourites' : 'Add to favourites';
      btn.querySelector('path').setAttribute('fill', hearted ? 'currentColor' : 'none');
    }
  }
}

// ── Delete ────────────────────────────────────────────────────────────────
async function deleteItem(id) {
  const item = library.find(i => i.id === id);
  if (!item) return;
  if (!confirm(`Remove "${item.title}" from your library?`)) return;
  library = library.filter(i => i.id !== id);
  localStorage.setItem('mediaLibrary', JSON.stringify(library));
  await db.from('library').delete().eq('id', id);
  render();
}

// ── Escape HTML ───────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Page switching ────────────────────────────────────────────────────────
function switchPage(page, listId = null) {
  currentListId = listId;
  document.body.dataset.page = page;
  document.getElementById('libraryPage').style.display    = page === 'library'     ? '' : 'none';
  document.getElementById('listsPage').style.display      = page === 'lists'       ? '' : 'none';
  document.getElementById('listDetailPage').style.display = page === 'list-detail' ? '' : 'none';
  // Mark Lists nav button active when on lists pages, deactivate type filter buttons
  const onLists = page === 'lists' || page === 'list-detail';
  document.getElementById('listsPageBtn').classList.toggle('active', onLists);
  if (onLists) {
    document.querySelectorAll('.nav-btn[data-filter-type]').forEach(b => b.classList.remove('active'));
  } else {
    document.querySelectorAll('.nav-btn[data-filter-type]').forEach(b =>
      b.classList.toggle('active', b.dataset.filterType === activeType));
  }
  closeAllPopovers();
  if (page === 'lists')       renderListsPage();
  if (page === 'list-detail') renderListDetail(listId);
}

// ── Lists page ────────────────────────────────────────────────────────────
function renderListsPage() {
  const grid  = document.getElementById('listsGrid');
  const empty = document.getElementById('listsEmpty');
  if (lists.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  grid.innerHTML = lists.map(list => {
    const items = list.itemIds.map(id => library.find(i => i.id === id)).filter(Boolean);
    const posters = items.slice(0, 4).map(item =>
      item.poster
        ? `<img src="${escHtml(item.poster)}" alt="">`
        : `<div class="lc-ph" style="background:${getGradient(item.id)}">${TYPE_ICON[item.type] || '🎬'}</div>`
    ).join('');
    const count = items.length;
    return `
    <div class="list-card" onclick="switchPage('list-detail', ${list.id})">
      <div class="list-card-posters lc-count-${Math.min(count, 4)}">${posters || '<div class="lc-ph lc-empty">☰</div>'}</div>
      <div class="list-card-info">
        <div class="list-card-name">${escHtml(list.name)}</div>
        <div class="list-card-count">${count} title${count !== 1 ? 's' : ''}</div>
      </div>
    </div>`;
  }).join('');
}

function promptNewList() {
  const name = prompt('List name:');
  if (!name || !name.trim()) return;
  lists.unshift({ id: listsNextId++, name: name.trim(), itemIds: [], createdAt: Date.now() });
  saveLists();
  renderListsPage();
}

// ── List detail page ──────────────────────────────────────────────────────
function renderListDetail(listId) {
  const list = lists.find(l => l.id === listId);
  if (!list) { switchPage('lists'); return; }

  document.getElementById('listDetailName').textContent = list.name;

  const items  = list.itemIds.map(id => library.find(i => i.id === id)).filter(Boolean);
  const grid   = document.getElementById('listDetailGrid');
  const empty  = document.getElementById('listDetailEmpty');

  document.getElementById('renameListBtn').onclick  = () => renameList(listId);
  document.getElementById('deleteListBtn').onclick  = () => deleteList(listId);

  if (items.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  // Render cards with a "Remove from list" button instead of the list-add button
  grid.innerHTML = items.map((item, idx) => listCardHTML(item, listId, idx + 1)).join('');
  initListDrag(listId);
}

function listCardHTML(item, listId, rank) {
  const poster = item.poster
    ? `<img src="${escHtml(item.poster)}" alt="${escHtml(item.title)}" loading="lazy" onerror="this.parentNode.innerHTML='<div class=card-poster-placeholder style=background:${getGradient(item.id)}><span class=poster-icon>${TYPE_ICON[item.type]||'🎬'}</span><span>${escHtml(item.title)}</span></div>'">`
    : `<div class="card-poster-placeholder" style="background:${getGradient(item.id)}"><span class="poster-icon">${TYPE_ICON[item.type] || '🎬'}</span><span>${escHtml(item.title)}</span></div>`;

  return `
  <div class="card list-card${item.status === 'watched' ? ' card--watched' : ''}" data-id="${item.id}" draggable="true" onclick="openDetail(${item.id})">
    <div class="card-poster">
      ${poster}
      <span class="type-badge">${item.type === 'tv' ? 'TV' : item.type === 'arwen' ? 'Arwen' : 'Movie'}</span>
      <div class="list-card-rank">${rank}</div>
      <div class="drag-handle" onclick="event.stopPropagation()" title="Drag to reorder">⠿</div>
    </div>
    <div class="card-body">
      <div class="card-title">${escHtml(item.title)}</div>
      <div class="card-meta">
        ${item.year ? `<span>${item.year}</span>` : ''}
        ${item.creator ? `<span class="dot">·</span><span>${escHtml(item.creator.split(',')[0].trim())}</span>` : ''}
      </div>
      ${item.genre ? `<div class="card-genre">${escHtml(item.genre)}</div>` : ''}
      ${item.rating ? `<div class="card-rating" style="color:${ratingColor(item.rating)}"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1l1.4 2.8L11 4.3l-2.5 2.4.6 3.4L6 8.5l-3.1 1.6.6-3.4L1 4.3l3.6-.5z" fill="${ratingColor(item.rating)}"/></svg>${item.rating.toFixed(1)}</div>` : ''}
    </div>
    <div class="card-actions" onclick="event.stopPropagation()">
      <button class="card-btn delete" onclick="removeFromList(${listId}, ${item.id})">✕ Remove</button>
    </div>
  </div>`;
}

function removeFromList(listId, itemId) {
  const list = lists.find(l => l.id === listId);
  if (!list) return;
  list.itemIds = list.itemIds.filter(id => id !== itemId);
  saveLists();
  renderListDetail(listId);
}

function initListDrag(listId) {
  const grid = document.getElementById('listDetailGrid');
  let dragId = null;

  grid.querySelectorAll('.list-card').forEach(card => {
    card.addEventListener('dragstart', e => {
      dragId = parseInt(card.dataset.id);
      card.classList.add('drag-source');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('drag-source');
      grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      grid.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      if (parseInt(card.dataset.id) !== dragId) card.classList.add('drag-over');
    });
    card.addEventListener('drop', e => {
      e.preventDefault();
      const targetId = parseInt(card.dataset.id);
      if (dragId === null || dragId === targetId) return;
      const list = lists.find(l => l.id === listId);
      if (!list) return;
      const fromIdx = list.itemIds.indexOf(dragId);
      const toIdx   = list.itemIds.indexOf(targetId);
      if (fromIdx === -1 || toIdx === -1) return;
      list.itemIds.splice(fromIdx, 1);
      list.itemIds.splice(toIdx, 0, dragId);
      saveLists();
      renderListDetail(listId);
    });
  });
}

function renameList(listId) {
  const list = lists.find(l => l.id === listId);
  if (!list) return;
  const name = prompt('Rename list:', list.name);
  if (!name || !name.trim()) return;
  list.name = name.trim();
  saveLists();
  document.getElementById('listDetailName').textContent = list.name;
}

async function deleteList(listId) {
  const list = lists.find(l => l.id === listId);
  if (!list || !confirm(`Delete "${list.name}"?`)) return;
  lists = lists.filter(l => l.id !== listId);
  localStorage.setItem('mediaLists', JSON.stringify(lists));
  await db.from('lists').delete().eq('id', listId);
  switchPage('lists');
}

// ── Add-to-list popover ───────────────────────────────────────────────────
function closeAllPopovers() {
  document.querySelectorAll('.list-popover').forEach(p => p.remove());
}

function toggleListPopover(event, itemId) {
  event.stopPropagation();
  const existing = event.currentTarget.querySelector('.list-popover') ||
                   event.currentTarget.parentNode.querySelector('.list-popover');

  closeAllPopovers();
  if (existing) return; // was open — toggle closed

  if (lists.length === 0) {
    showToast('Create a list first — click ☰ Lists in the header', true);
    return;
  }

  const popover = document.createElement('div');
  popover.className = 'list-popover';
  popover.innerHTML = `<div class="list-popover-title">Add to list</div>` +
    lists.map(list => {
      const isIn = list.itemIds.includes(itemId);
      return `<label class="list-popover-item">
        <input type="checkbox" ${isIn ? 'checked' : ''} onchange="toggleItemInList(${list.id},${itemId},this.checked)">
        <span>${escHtml(list.name)}</span>
        ${isIn ? '<span class="lp-check">✓</span>' : ''}
      </label>`;
    }).join('');

  const wrap = event.currentTarget.parentNode;
  wrap.style.position = 'relative';
  wrap.appendChild(popover);

  setTimeout(() => {
    document.addEventListener('click', function closePopover(e) {
      if (!popover.contains(e.target)) {
        popover.remove();
        document.removeEventListener('click', closePopover);
      }
    });
  }, 0);
}

function toggleItemInList(listId, itemId, checked) {
  const list = lists.find(l => l.id === listId);
  if (!list) return;
  if (checked && !list.itemIds.includes(itemId)) {
    list.itemIds.push(itemId);
    showToast(`Added to "${list.name}"`);
  } else if (!checked) {
    list.itemIds = list.itemIds.filter(id => id !== itemId);
    showToast(`Removed from "${list.name}"`);
  }
  saveLists();
}

// ── Event wiring ──────────────────────────────────────────────────────────
document.getElementById('listsPageBtn').addEventListener('click', () => switchPage('lists'));
document.getElementById('newListBtn').addEventListener('click', promptNewList);
document.getElementById('openModal').addEventListener('click',   () => openModal());
document.getElementById('closeModal').addEventListener('click',  closeModal);
document.getElementById('cancelModal').addEventListener('click', closeModal);
document.getElementById('modalSyncIMDB').addEventListener('click', async function() {
  const editId = +document.getElementById('editId').value;
  if (!editId) return;
  this.textContent = '…';
  this.disabled = true;
  await refreshCardIMDB(editId);
  this.textContent = '↻ Sync IMDB';
  this.disabled = false;
  // Refresh form fields with updated data
  const item = library.find(i => i.id === editId);
  if (item) {
    document.getElementById('f-year').value    = item.year    || '';
    document.getElementById('f-genre').value   = item.genre   || '';
    document.getElementById('f-rating').value  = item.rating  || '';
    document.getElementById('f-creator').value = item.creator || '';
    document.getElementById('f-poster').value  = item.poster  || '';
  }
});
document.getElementById('closeDetail').addEventListener('click', closeDetail);

// Close modals on overlay click
document.getElementById('modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
document.getElementById('detailModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeDetail(); });

// Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeDetail(); }
});

// Search
const searchInput = document.getElementById('searchInput');
const clearSearch = document.getElementById('clearSearch');
searchInput.addEventListener('input', e => {
  searchQuery = e.target.value.trim();
  clearSearch.style.display = searchQuery ? 'block' : 'none';
  render();
});
clearSearch.addEventListener('click', () => {
  searchQuery = '';
  searchInput.value = '';
  clearSearch.style.display = 'none';
  render();
});

// Filters
document.getElementById('filterGenre').addEventListener('change',  e => { filterGenre  = e.target.value; render(); });
document.getElementById('filterRating').addEventListener('change', e => { filterRating = e.target.value; render(); });
document.getElementById('sortBy').addEventListener('change',       e => { sortBy       = e.target.value; render(); });

// Nav type buttons
document.querySelectorAll('.nav-btn[data-filter-type]').forEach(btn => {
  btn.addEventListener('click', () => {
    activeType = btn.dataset.filterType;
    document.querySelectorAll('.nav-btn[data-filter-type]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('listsPageBtn').classList.remove('active');
    if (document.body.dataset.page !== 'library') switchPage('library');
    else render();
  });
});

// ── OMDB: Fetch into modal form ───────────────────────────────────────────
document.getElementById('fetchIMDB').addEventListener('click', async () => {
  const title = document.getElementById('f-title').value.trim();
  if (!title) { showToast('Enter a title first', true); return; }

  const btn    = document.getElementById('fetchIMDB');
  const status = document.getElementById('imdbStatus');
  btn.disabled = true;
  btn.textContent = 'Fetching…';
  status.textContent = '';

  const FETCH_BTN_HTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M7 4v3.5l2 1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg> Fetch from IMDB`;
  const type = document.getElementById('f-type').value;
  closeIMDBPicker();

  const results = await fetchOMDBSearch(title, type);

  btn.disabled = false;
  btn.innerHTML = FETCH_BTN_HTML;

  if (!results || results.length === 0) {
    status.textContent = '✕ Not found';
    status.className = 'imdb-status error';
    return;
  }

  if (results.length === 1) {
    await fillFromIMDBId(results[0].imdbID, status);
    return;
  }

  // Multiple matches — show picker
  status.textContent = `${results.length} matches found — pick one below`;
  status.className = 'imdb-status';
  showIMDBPicker(results, async imdbId => {
    btn.disabled = true;
    status.textContent = 'Loading…';
    await fillFromIMDBId(imdbId, status);
    btn.disabled = false;
  });
});

async function fillFromIMDBId(imdbId, statusEl) {
  const data = await fetchOMDBById(imdbId);
  if (!data) {
    statusEl.textContent = '✕ Could not load details';
    statusEl.className = 'imdb-status error';
    return;
  }
  const fields = omdbToFields(data);
  if (fields.title)   document.getElementById('f-title').value   = fields.title;
  if (fields.year)    document.getElementById('f-year').value    = fields.year;
  if (fields.genre)   document.getElementById('f-genre').value   = fields.genre;
  if (fields.rating)  document.getElementById('f-rating').value  = fields.rating;
  if (fields.creator) document.getElementById('f-creator').value = fields.creator;
  if (fields.poster)  document.getElementById('f-poster').value  = fields.poster;
  if (fields.type)    document.getElementById('f-type').value    = fields.type;
  statusEl.textContent = '✓ Filled from IMDB';
  statusEl.className = 'imdb-status success';
}

function showIMDBPicker(results, onSelect) {
  closeIMDBPicker();
  const picker = document.createElement('div');
  picker.id = 'imdbPicker';
  picker.className = 'imdb-picker';
  picker.innerHTML = results.slice(0, 8).map(r => `
    <button type="button" class="imdb-picker-item" data-id="${escHtml(r.imdbID)}">
      <img class="imdb-picker-poster" src="${r.Poster !== 'N/A' ? escHtml(r.Poster) : ''}" onerror="this.src=''" alt="">
      <div class="imdb-picker-info">
        <span class="imdb-picker-title">${escHtml(r.Title)}</span>
        <span class="imdb-picker-meta">${r.Year} · ${r.Type === 'series' ? 'TV' : 'Movie'}</span>
      </div>
    </button>`).join('');
  picker.querySelectorAll('.imdb-picker-item').forEach(btn => {
    btn.addEventListener('click', () => { closeIMDBPicker(); onSelect(btn.dataset.id); });
  });
  document.querySelector('.imdb-fetch-row').insertAdjacentElement('afterend', picker);
}

function closeIMDBPicker() {
  document.getElementById('imdbPicker')?.remove();
}

// ── OMDB: Refresh a single card ───────────────────────────────────────────
async function refreshCardIMDB(id) {
  const item = library.find(i => i.id === id);
  if (!item) return;

  const btn = document.getElementById(`imdb-btn-${id}`);
  if (btn) { btn.textContent = '…'; btn.disabled = true; }

  const data = await fetchOMDB(item.title, item.type);

  if (btn) { btn.textContent = '↻'; btn.disabled = false; }

  if (!data) { showToast(`IMDB: "${item.title}" not found`, true); return; }

  const fields = omdbToFields(data);
  const idx = library.findIndex(i => i.id === id);
  // Custom data always wins — IMDB only fills blank fields.
  // Poster is the exception: always refresh since CDN URLs can expire.
  library[idx] = {
    ...library[idx],
    year:     library[idx].year     || fields.year,
    genre:    library[idx].genre    || fields.genre,
    rating:   library[idx].rating   || fields.rating,
    creator:  library[idx].creator  || fields.creator,
    runtime:  library[idx].runtime  || fields.runtime,
    language: library[idx].language || fields.language,
    subtype:  library[idx].type === 'arwen' ? (library[idx].subtype || fields.type) : null,
    poster:   fields.poster         || library[idx].poster,
  };
  save();
  render();
  showToast(`Updated "${item.title}" from IMDB`);
}

// ── OMDB: Sync all library items ──────────────────────────────────────────
document.getElementById('syncAll').addEventListener('click', async () => {
  const btn = document.getElementById('syncAll');
  btn.disabled = true;
  btn.textContent = 'Syncing…';

  let updated = 0, failed = 0;
  for (let i = 0; i < library.length; i++) {
    const item = library[i];
    const data = await fetchOMDB(item.title, item.type);
    if (data) {
      const fields = omdbToFields(data);
      library[i] = {
        ...library[i],
        year:     library[i].year     || fields.year,
        genre:    library[i].genre    || fields.genre,
        rating:   library[i].rating   || fields.rating,
        creator:  library[i].creator  || fields.creator,
        runtime:  library[i].runtime  || fields.runtime,
        language: library[i].language || fields.language,
        subtype:  library[i].type === 'arwen' ? (library[i].subtype || fields.type) : null,
        poster:   fields.poster       || library[i].poster,
      };
      updated++;
    } else {
      failed++;
    }
    // Small delay to avoid hammering the API
    await new Promise(r => setTimeout(r, 200));
  }

  save();
  render();
  btn.disabled = false;
  btn.textContent = '↻ Sync IMDB';
  showToast(`Synced ${updated} titles${failed ? ` · ${failed} not found` : ''}`);
});

// ── Init ──────────────────────────────────────────────────────────────────
render();
