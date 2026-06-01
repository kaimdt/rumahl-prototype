/* ============================================================
   Macro Tracker v2.0 - Frontend Application
   ============================================================ */

// ---- State ----
let currentDate = new Date().toISOString().split('T')[0];
let goals = { protein_g: 180, fat_g: 70, carbs_g: 250, calories: 2500, water_goal_ml: 3000 };
let foods = [];
let meals = [];
let summary = null;
let pendingFood = null;
let promptMode = 'day';
let editingMealId = null;
let editingFoodId = null;
let chartPeriod = 'week';
let chartData = [];
let searchTimeout = null;
let bodyWeights = [];

// ---- Date Navigation ----
function changeDate(delta) {
  const d = new Date(currentDate + 'T12:00:00');
  if (delta === 0) {
    currentDate = new Date().toISOString().split('T')[0];
  } else {
    d.setDate(d.getDate() + delta);
    currentDate = d.toISOString().split('T')[0];
  }
  document.getElementById('currentDate').textContent = formatDate(currentDate);
  refresh();
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  let label = d.toLocaleDateString('de-DE', opts);
  if (dateStr === today.toISOString().split('T')[0]) label = 'Heute, ' + label;
  else if (dateStr === yesterday.toISOString().split('T')[0]) label = 'Gestern, ' + label;
  else if (dateStr === tomorrow.toISOString().split('T')[0]) label = 'Morgen, ' + label;
  return label;
}

// ---- Toast ----
function showToast(msg, icon) {
  const c = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = '<span class="toast-icon">' + (icon || '&#10003;') + '</span><span>' + escHtml(msg) + '</span>';
  c.appendChild(t);
  setTimeout(() => { t.classList.add('removing'); setTimeout(() => t.remove(), 200); }, 3000);
}

// ---- API Helpers ----
async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok) {
    let msg;
    try { msg = (await res.json()).error; } catch(e) { msg = res.statusText; }
    throw new Error(msg || 'API Error');
  }
  return res.json();
}

// ---- Refresh All ----
async function refresh() {
  await Promise.all([
    loadSummary(),
    loadMeals(),
    loadFoods(),
    loadCategories(),
    loadWeekHistory(),
    loadBodyWeight()
  ]);
}

async function loadGoals() {
  try { goals = await api('/api/goals'); } catch (e) { console.error(e); }
}

async function loadSummary() {
  try {
    summary = await api('/api/summary?date=' + currentDate);
    goals = summary.goals;
    renderMacroCards();
    renderDistribution();
    renderWaterDisplay();
  } catch (e) { console.error(e); }
}

async function loadMeals() {
  try {
    meals = await api('/api/meals?date=' + currentDate);
    renderMealLog();
  } catch (e) { console.error(e); }
}

async function loadFoods() {
  try {
    const search = (document.getElementById('foodSearch')?.value || '').trim();
    const category = document.getElementById('foodCategory')?.value || 'Alle';
    let url = '/api/foods?';
    if (category !== 'Alle') url += 'category=' + encodeURIComponent(category) + '&';
    if (search) url += 'search=' + encodeURIComponent(search) + '&';
    foods = await api(url);
    renderFoodList();
  } catch (e) { console.error(e); }
}

async function loadCategories() {
  try {
    const cats = await api('/api/foods/categories');
    const sel = document.getElementById('foodCategory');
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="Alle">Alle</option>';
    cats.forEach(c => { sel.innerHTML += '<option value="' + escHtml(c) + '">' + escHtml(c) + '</option>'; });
    sel.value = currentVal;
  } catch (e) { console.error(e); }
}

async function loadWeekHistory() {
  try {
    const history = await api('/api/history');
    renderWeekOverview(history);
  } catch (e) { console.error(e); }
}

async function loadBodyWeight() {
  try {
    const weights = await api('/api/bodyweight?limit=30');
    bodyWeights = weights;
    if (weights.length > 0) {
      document.getElementById('weightDisplay').textContent = weights[0].weight_kg.toFixed(1);
    }
  } catch (e) { /* table may not exist yet */ }
}

function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(loadFoods, 250);
}

// ---- Render Macro Cards ----
function renderMacroCards() {
  const g = goals;
  const s = summary;
  if (!s) return;

  const items = [
    { id: 'protein', label: 'Protein', unit: 'g', color: 'protein', current: s.consumed.protein_g, goal: g.protein_g, remaining: s.remaining.protein_g, pct: s.progress.protein_pct },
    { id: 'fat', label: 'Fett', unit: 'g', color: 'fat', current: s.consumed.fat_g, goal: g.fat_g, remaining: s.remaining.fat_g, pct: s.progress.fat_pct },
    { id: 'carbs', label: 'Carbs', unit: 'g', color: 'carbs', current: s.consumed.carbs_g, goal: g.carbs_g, remaining: s.remaining.carbs_g, pct: s.progress.carbs_pct },
    { id: 'kcal', label: 'Kalorien', unit: 'kcal', color: 'kcal', current: s.consumed.calories, goal: g.calories, remaining: s.remaining.calories, pct: s.progress.calories_pct },
    { id: 'water', label: 'Wasser', unit: 'ml', color: 'water', current: s.consumed.water_ml || 0, goal: g.water_goal_ml || 3000, remaining: s.remaining.water_ml || 0, pct: s.progress.water_pct || 0 }
  ];

  document.getElementById('macroGrid').innerHTML = items.map(c => {
    const absRemaining = Math.abs(c.remaining);
    const pct100 = c.pct >= 100;
    const remainingLabel = pct100
      ? '<span class="text-danger">+' + absRemaining + ' ' + c.unit + '</span>'
      : '<span class="text-success">Noch ' + absRemaining + ' ' + c.unit + '</span>';

    const overClass = c.remaining < 0 ? 'over' : 'under';
    const goalLabel = c.id === 'kcal' ? c.goal : c.goal + '<span class="macro-unit">' + c.unit + '</span>';

    return '<div class="macro-card card-' + c.color + '">' +
      '<div class="macro-header">' +
        '<div class="macro-label">' + c.label + '</div>' +
        '<div class="macro-badge" style="background:' + getColorBg(c.color) + ';color:' + getColor(c.color) + ';">' + pct100 + '%</div>' +
      '</div>' +
      '<div class="macro-values">' +
        '<span class="macro-current ' + c.color + '">' + c.current + '</span>' +
        '<span class="macro-divider">/</span>' +
        '<span class="macro-goal">' + goalLabel + '</span>' +
      '</div>' +
      '<div class="macro-remaining ' + overClass + '">' + remainingLabel + '</div>' +
      '<div class="progress-bar">' +
        '<div class="progress-fill" style="width:' + Math.min(100, c.pct) + '%"></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function getColor(c) {
  return { protein:'var(--protein)', fat:'var(--fat)', carbs:'var(--carbs)', kcal:'var(--kcal)', water:'var(--water)' }[c] || '#fff';
}
function getColorBg(c) {
  return { protein:'var(--protein-bg)', fat:'var(--fat-bg)', carbs:'var(--carbs-bg)', kcal:'var(--kcal-bg)', water:'var(--water-bg)' }[c] || 'transparent';
}

// ---- Render Distribution ----
function renderDistribution() {
  const s = summary;
  if (!s || !s.by_meal_type || s.by_meal_type.length === 0) {
    document.getElementById('distributionSection').innerHTML = '';
    return;
  }
  const totalKcal = s.consumed.calories || 1;
  const proteinKcal = s.consumed.protein_g * 4;
  const fatKcal = s.consumed.fat_g * 9;
  const carbsKcal = s.consumed.carbs_g * 4;
  const pP = Math.round((proteinKcal / totalKcal) * 100);
  const pF = Math.round((fatKcal / totalKcal) * 100);
  const pC = Math.round((carbsKcal / totalKcal) * 100);

  document.getElementById('distributionSection').innerHTML =
    '<div class="dist-section">' +
      '<div class="dist-title">Makro-Verteilung</div>' +
      '<div class="dist-chart">' +
        '<div class="dist-protein" style="width:' + pP + '%"></div>' +
        '<div class="dist-fat" style="width:' + pF + '%"></div>' +
        '<div class="dist-carbs" style="width:' + pC + '%"></div>' +
      '</div>' +
      '<div class="dist-legend">' +
        '<span><span class="dot dot-protein"></span> Protein ' + Math.round(s.consumed.protein_g) + 'g (' + proteinKcal + ' kcal, ' + pP + '%)</span>' +
        '<span><span class="dot dot-fat"></span> Fett ' + Math.round(s.consumed.fat_g) + 'g (' + fatKcal + ' kcal, ' + pF + '%)</span>' +
        '<span><span class="dot dot-carbs"></span> Carbs ' + Math.round(s.consumed.carbs_g) + 'g (' + carbsKcal + ' kcal, ' + pC + '%)</span>' +
      '</div>' +
    '</div>';
}

function renderWaterDisplay() {
  const s = summary;
  if (!s) return;
  const g = goals;
  const water = s.consumed.water_ml || 0;
  const goal = g.water_goal_ml || 3000;
  const pct = goal > 0 ? Math.round((water / goal) * 100) : 0;
  document.getElementById('waterTotalDisplay').textContent = water + 'ml / ' + goal + 'ml (' + pct + '%)';
}

// ---- Render Meal Log ----
function renderMealLog() {
  const mealTypes = ['Frühstück', 'Mittagessen', 'Abendessen', 'Snack', 'Pre-Workout', 'Post-Workout'];
  const byType = {};
  mealTypes.forEach(t => { byType[t] = []; });
  meals.forEach(m => {
    if (!byType[m.meal_type]) byType[m.meal_type] = [];
    byType[m.meal_type].push(m);
  });

  document.getElementById('mealCount').textContent = meals.length > 0 ? meals.length + ' Eintr' + (meals.length === 1 ? 'ag' : '&auml;ge') : '';

  let html = '';
  let hasMeals = false;

  mealTypes.forEach(type => {
    const items = byType[type];
    if (items.length === 0) return;
    hasMeals = true;

    const sum = items.reduce((a, m) => ({
      p: a.p + (m.protein_g || 0), f: a.f + (m.fat_g || 0), c: a.c + (m.carbs_g || 0), k: a.k + (m.calories || 0)
    }), { p: 0, f: 0, c: 0, k: 0 });

    html += '<div class="meal-type-group">' +
      '<div class="meal-type-header">' +
        '<span>' + type + '</span>' +
        '<span class="type-sum">P:' + Math.round(sum.p) + ' F:' + Math.round(sum.f) + ' C:' + Math.round(sum.c) + ' | ' + Math.round(sum.k) + ' kcal</span>' +
      '</div>' +
      items.map(m =>
        '<div class="meal-item">' +
          '<span class="meal-name">' + escHtml(m.food_name) + ' <span class="amount">' + m.amount_g + 'g</span></span>' +
          '<span class="meal-macros">' +
            '<span>P:' + Math.round(m.protein_g) + '</span>' +
            '<span>F:' + Math.round(m.fat_g) + '</span>' +
            '<span>C:' + Math.round(m.carbs_g) + '</span>' +
            '<span>' + Math.round(m.calories) + '</span>' +
          '</span>' +
          '<span class="meal-actions">' +
            '<button class="meal-action-btn dup" onclick="duplicateMeal(' + m.id + ')" title="Duplizieren">&#x2396;</button>' +
            '<button class="meal-action-btn" onclick="openEditMealModal(' + m.id + ')" title="Bearbeiten">&#9998;</button>' +
            '<button class="meal-action-btn danger" onclick="deleteMeal(' + m.id + ')" title="L&ouml;schen">&times;</button>' +
          '</span>' +
        '</div>'
      ).join('') +
    '</div>';
  });

  if (!hasMeals) {
    html = '<div class="meal-empty"><div style="font-size:1.5rem;margin-bottom:8px;color:var(--text-dim);">&#9742;</div>Noch keine Mahlzeiten eingetragen.<br>W&auml;hle ein Lebensmittel aus der Datenbank oder nutze den Schnell-Eintrag unten.</div>';
  }

  document.getElementById('mealLog').innerHTML = html;
  document.getElementById('mealEmpty').style.display = hasMeals ? 'none' : '';
}

// ---- Render Food List ----
function renderFoodList() {
  const el = document.getElementById('foodList');
  if (foods.length === 0) {
    el.innerHTML = '<div class="meal-empty">Keine Lebensmittel gefunden.<br>F&uuml;ge neue &uuml;ber den &quot;+ Neu&quot; Button hinzu.</div>';
    return;
  }
  el.innerHTML = foods.map(f =>
    '<div class="food-item" onclick="openAddMealModal(' + f.id + ')">' +
      '<div class="food-info">' +
        '<div class="food-name">' +
          escHtml(f.name) +
          (f.brand ? ' <span class="brand">(' + escHtml(f.brand) + ')</span>' : '') +
          ' <span class="category-tag">' + escHtml(f.category) + '</span>' +
        '</div>' +
        '<div class="food-macros">' +
          '<span>P:' + f.protein_g + 'g</span>' +
          '<span>F:' + f.fat_g + 'g</span>' +
          '<span>C:' + f.carbs_g + 'g</span>' +
          '<span>' + f.calories + ' kcal</span>' +
          '<span style="color:var(--text-dim);">/ ' + f.serving_size_g + 'g</span>' +
        '</div>' +
      '</div>' +
      '<div class="food-actions" onclick="event.stopPropagation()">' +
        '<button class="btn-icon fav' + (f.is_favorite ? ' active' : '') + '" onclick="toggleFavorite(' + f.id + ')" title="Favorit">' + (f.is_favorite ? '&#9733;' : '&#9734;') + '</button>' +
        '<button class="btn-icon" onclick="openEditFoodModal(' + f.id + ')" title="Bearbeiten">&#9998;</button>' +
        '<button class="btn-icon danger" onclick="deleteFood(' + f.id + ')" title="L&ouml;schen">&times;</button>' +
      '</div>' +
    '</div>'
  ).join('');
}

// ---- Meal CRUD ----
function openAddMealModal(foodId) {
  const food = foods.find(f => f.id === foodId);
  if (!food) return;
  editingMealId = null;
  pendingFood = food;

  document.getElementById('addMealModalTitle').textContent = 'Mahlzeit hinzuf&uuml;gen';
  document.getElementById('confirmMealBtn').textContent = 'Hinzuf&uuml;gen';
  document.getElementById('editMealId').value = '';
  document.getElementById('addMealFoodName').textContent = food.name + (food.brand ? ' (' + food.brand + ')' : '');
  document.getElementById('addMealFoodInfo').textContent = 'Pro ' + food.serving_size_g + 'g: P:' + food.protein_g + 'g F:' + food.fat_g + 'g C:' + food.carbs_g + 'g ' + food.calories + ' kcal';
  document.getElementById('addMealAmount').value = food.serving_size_g;
  document.getElementById('addMealType').value = 'Frühstück';
  updateMealPreview();
  document.getElementById('addMealModal').classList.add('active');
  document.getElementById('addMealAmount').oninput = updateMealPreview;
}

function openEditMealModal(mealId) {
  const meal = meals.find(m => m.id === mealId);
  if (!meal) return;
  editingMealId = mealId;
  pendingFood = { id: meal.food_item_id, name: meal.food_name.split(' (')[0], brand: '', serving_size_g: 100, protein_g: meal.protein_g, fat_g: meal.fat_g, carbs_g: meal.carbs_g, calories: meal.calories };

  document.getElementById('addMealModalTitle').textContent = 'Mahlzeit bearbeiten';
  document.getElementById('confirmMealBtn').textContent = 'Speichern';
  document.getElementById('editMealId').value = mealId;
  document.getElementById('addMealFoodName').textContent = meal.food_name;
  document.getElementById('addMealFoodInfo').textContent = 'Aktuell: ' + meal.amount_g + 'g';
  document.getElementById('addMealAmount').value = meal.amount_g;
  document.getElementById('addMealType').value = meal.meal_type;
  updateEditMealPreview(mealId);
  document.getElementById('addMealModal').classList.add('active');
  document.getElementById('addMealAmount').oninput = function() { updateEditMealPreview(mealId); };
}

function updateMealPreview() {
  if (!pendingFood) return;
  const amount = parseFloat(document.getElementById('addMealAmount').value) || 0;
  const factor = amount / (pendingFood.serving_size_g || 100);
  document.getElementById('addMealPreview').innerHTML =
    '<strong>Berechnet:</strong> P:' + round1(pendingFood.protein_g * factor) + 'g F:' + round1(pendingFood.fat_g * factor) + 'g C:' + round1(pendingFood.carbs_g * factor) + 'g ' + Math.round(pendingFood.calories * factor) + ' kcal';
}

function updateEditMealPreview(mealId) {
  const meal = meals.find(m => m.id === mealId);
  if (!meal) return;
  const amount = parseFloat(document.getElementById('addMealAmount').value) || 0;
  const factor = amount / (meal.amount_g || 100);
  document.getElementById('addMealPreview').innerHTML =
    '<strong>Berechnet (neu):</strong> P:' + round1(meal.protein_g * factor) + 'g F:' + round1(meal.fat_g * factor) + 'g C:' + round1(meal.carbs_g * factor) + 'g ' + Math.round(meal.calories * factor) + ' kcal';
}

function closeAddMealModal() {
  document.getElementById('addMealModal').classList.remove('active');
  editingMealId = null;
}

async function confirmAddMeal() {
  const amount = parseFloat(document.getElementById('addMealAmount').value) || 0;
  const mealType = document.getElementById('addMealType').value;
  if (amount <= 0) { showToast('Bitte eine g&uuml;ltige Menge eingeben', '&#9888;'); return; }

  const editId = document.getElementById('editMealId').value;

  if (editId) {
    // Edit mode
    const meal = meals.find(m => m.id === parseInt(editId));
    if (!meal) return;
    const factor = amount / (meal.amount_g || 100);
    try {
      await api('/api/meals/' + editId, {
        method: 'PUT',
        body: JSON.stringify({
          food_name: meal.food_name,
          protein_g: round1(meal.protein_g * factor),
          fat_g: round1(meal.fat_g * factor),
          carbs_g: round1(meal.carbs_g * factor),
          calories: Math.round(meal.calories * factor),
          amount_g: amount,
          meal_type: mealType
        })
      });
      closeAddMealModal();
      showToast('Mahlzeit aktualisiert');
      await refresh();
    } catch (e) { showToast('Fehler: ' + e.message, '&#9888;'); }
  } else {
    // Add mode
    if (!pendingFood) return;
    const factor = amount / (pendingFood.serving_size_g || 100);
    try {
      await api('/api/meals', {
        method: 'POST',
        body: JSON.stringify({
          food_item_id: pendingFood.id,
          food_name: pendingFood.name + (pendingFood.brand ? ' (' + pendingFood.brand + ')' : ''),
          protein_g: round1(pendingFood.protein_g * factor),
          fat_g: round1(pendingFood.fat_g * factor),
          carbs_g: round1(pendingFood.carbs_g * factor),
          calories: Math.round(pendingFood.calories * factor),
          amount_g: amount,
          meal_type: mealType,
          log_date: currentDate
        })
      });
      closeAddMealModal();
      showToast(pendingFood.name + ' hinzugef&uuml;gt');
      await refresh();
    } catch (e) { showToast('Fehler: ' + e.message, '&#9888;'); }
  }
}

async function duplicateMeal(id) {
  try {
    await api('/api/meals/' + id + '/duplicate', { method: 'POST' });
    showToast('Mahlzeit dupliziert');
    await refresh();
  } catch (e) { showToast('Fehler: ' + e.message, '&#9888;'); }
}

async function addQuickMeal() {
  const name = document.getElementById('quickName').value.trim();
  if (!name) { showToast('Bitte einen Namen eingeben', '&#9888;'); return; }

  const amount = parseFloat(document.getElementById('quickAmount').value) || 100;
  const protein = parseFloat(document.getElementById('quickProtein').value) || 0;
  const fat = parseFloat(document.getElementById('quickFat').value) || 0;
  const carbs = parseFloat(document.getElementById('quickCarbs').value) || 0;
  const kcal = parseFloat(document.getElementById('quickKcal').value) || 0;
  const mealType = document.getElementById('quickMealType').value;

  try {
    await api('/api/meals', {
      method: 'POST',
      body: JSON.stringify({
        food_name: name, protein_g: protein, fat_g: fat, carbs_g: carbs,
        calories: kcal, amount_g: amount, meal_type: mealType, log_date: currentDate
      })
    });
    document.getElementById('quickName').value = '';
    document.getElementById('quickProtein').value = '0';
    document.getElementById('quickFat').value = '0';
    document.getElementById('quickCarbs').value = '0';
    document.getElementById('quickKcal').value = '0';
    document.getElementById('quickAmount').value = '100';
    document.getElementById('quickCalcHint').textContent = '';
    showToast(name + ' hinzugef&uuml;gt');
    await refresh();
  } catch (e) { showToast('Fehler: ' + e.message, '&#9888;'); }
}

async function deleteMeal(id) {
  try {
    await api('/api/meals/' + id, { method: 'DELETE' });
    showToast('Mahlzeit gel&ouml;scht');
    await refresh();
  } catch (e) { showToast('Fehler: ' + e.message, '&#9888;'); }
}

// ---- Auto-Calc Quick Add ----
function autoCalcQuick() {
  const p = parseFloat(document.getElementById('quickProtein').value) || 0;
  const f = parseFloat(document.getElementById('quickFat').value) || 0;
  const c = parseFloat(document.getElementById('quickCarbs').value) || 0;
  const kcal = Math.round(p * 4 + f * 9 + c * 4);
  document.getElementById('quickKcal').value = kcal;
  if (p > 0 || f > 0 || c > 0) {
    document.getElementById('quickCalcHint').textContent = 'Auto-berechnet: ' + kcal + ' kcal (4-9-4 Regel)';
  } else {
    document.getElementById('quickCalcHint').textContent = '';
  }
}

function onQuickKcalManual() {
  document.getElementById('quickCalcHint').textContent = 'Manuell eingegeben';
}

// ---- Food CRUD ----
function openAddFoodModal() {
  editingFoodId = null;
  document.getElementById('addFoodModalTitle').textContent = 'Neues Lebensmittel';
  document.getElementById('addFoodBtn').textContent = 'Hinzuf&uuml;gen';
  ['newFoodName','newFoodBrand','newFoodProtein','newFoodFat','newFoodCarbs','newFoodKcal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = id.includes('Name') || id.includes('Brand') ? '' : '0';
  });
  document.getElementById('newFoodServing').value = '100';
  document.getElementById('addFoodModal').classList.add('active');
}

function openEditFoodModal(foodId) {
  const food = foods.find(f => f.id === foodId);
  if (!food) return;
  editingFoodId = foodId;
  document.getElementById('addFoodModalTitle').textContent = 'Lebensmittel bearbeiten: ' + food.name;
  document.getElementById('addFoodBtn').textContent = 'Speichern';
  document.getElementById('newFoodName').value = food.name;
  document.getElementById('newFoodBrand').value = food.brand || '';
  document.getElementById('newFoodCategory').value = food.category || 'Sonstiges';
  document.getElementById('newFoodServing').value = food.serving_size_g || 100;
  document.getElementById('newFoodProtein').value = food.protein_g || 0;
  document.getElementById('newFoodFat').value = food.fat_g || 0;
  document.getElementById('newFoodCarbs').value = food.carbs_g || 0;
  document.getElementById('newFoodKcal').value = food.calories || 0;
  document.getElementById('servingLabel').textContent = (food.serving_size_g || 100) + 'g';
  document.getElementById('addFoodModal').classList.add('active');
}

function closeAddFoodModal() { document.getElementById('addFoodModal').classList.remove('active'); editingFoodId = null; }

async function addFood() {
  const name = document.getElementById('newFoodName').value.trim();
  if (!name) { showToast('Bitte einen Namen eingeben', '&#9888;'); return; }

  const data = {
    name,
    brand: document.getElementById('newFoodBrand').value.trim(),
    category: document.getElementById('newFoodCategory').value,
    serving_size_g: parseFloat(document.getElementById('newFoodServing').value) || 100,
    protein_g: parseFloat(document.getElementById('newFoodProtein').value) || 0,
    fat_g: parseFloat(document.getElementById('newFoodFat').value) || 0,
    carbs_g: parseFloat(document.getElementById('newFoodCarbs').value) || 0,
    calories: parseFloat(document.getElementById('newFoodKcal').value) || 0
  };

  try {
    if (editingFoodId) {
      await api('/api/foods/' + editingFoodId, { method: 'PUT', body: JSON.stringify(data) });
      closeAddFoodModal();
      showToast(name + ' aktualisiert');
    } else {
      await api('/api/foods', { method: 'POST', body: JSON.stringify(data) });
      closeAddFoodModal();
      ['newFoodName','newFoodBrand','newFoodProtein','newFoodFat','newFoodCarbs','newFoodKcal'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = id.includes('Name') || id.includes('Brand') ? '' : '0';
      });
      document.getElementById('newFoodServing').value = '100';
      showToast(name + ' zur Datenbank hinzugef&uuml;gt');
    }
    await loadFoods();
    await loadCategories();
  } catch (e) { showToast('Fehler: ' + e.message, '&#9888;'); }
}

async function deleteFood(id) {
  if (!confirm('Lebensmittel wirklich l&ouml;schen?')) return;
  try {
    await api('/api/foods/' + id, { method: 'DELETE' });
    showToast('Lebensmittel gel&ouml;scht');
    await loadFoods();
    await loadCategories();
  } catch (e) { showToast('Fehler: ' + e.message, '&#9888;'); }
}

async function toggleFavorite(id) {
  try {
    const result = await api('/api/foods/' + id + '/toggle-favorite', { method: 'POST' });
    const food = foods.find(f => f.id === id);
    if (food) food.is_favorite = result.is_favorite;
    renderFoodList();
  } catch (e) { showToast('Fehler: ' + e.message, '&#9888;'); }
}

// ---- Goals Modal ----
function openGoalsModal() {
  document.getElementById('goalProtein').value = goals.protein_g;
  document.getElementById('goalFat').value = goals.fat_g;
  document.getElementById('goalCarbs').value = goals.carbs_g;
  document.getElementById('goalKcal').value = goals.calories;
  document.getElementById('goalWater').value = goals.water_goal_ml || 3000;
  document.getElementById('goalsModal').classList.add('active');
}
function closeGoalsModal() { document.getElementById('goalsModal').classList.remove('active'); }

async function saveGoals() {
  const protein = parseFloat(document.getElementById('goalProtein').value);
  const fat = parseFloat(document.getElementById('goalFat').value);
  const carbs = parseFloat(document.getElementById('goalCarbs').value);
  const kcal = parseFloat(document.getElementById('goalKcal').value);
  const water = parseFloat(document.getElementById('goalWater').value) || 3000;
  try {
    await api('/api/goals', {
      method: 'PUT',
      body: JSON.stringify({ protein_g: protein, fat_g: fat, carbs_g: carbs, calories: kcal, water_goal_ml: water })
    });
    closeGoalsModal();
    showToast('Ziele gespeichert');
    await refresh();
  } catch (e) { showToast('Fehler: ' + e.message, '&#9888;'); }
}

// ---- Copy Day ----
function openCopyDayModal() {
  document.getElementById('copyFromDate').value = currentDate;
  document.getElementById('copyToDate').value = currentDate;
  document.getElementById('copyResult').innerHTML = '';
  document.getElementById('copyDayModal').classList.add('active');
}
function closeCopyDayModal() { document.getElementById('copyDayModal').classList.remove('active'); }

async function executeCopyDay() {
  const from = document.getElementById('copyFromDate').value;
  const to = document.getElementById('copyToDate').value;
  if (!from || !to) { showToast('Bitte beide Daten ausw&auml;hlen', '&#9888;'); return; }
  try {
    const result = await api('/api/meals/copy', {
      method: 'POST',
      body: JSON.stringify({ from_date: from, to_date: to })
    });
    document.getElementById('copyResult').innerHTML = '<div style="color:var(--success);">' + result.copied_count + ' Mahlzeiten kopiert von ' + from + ' nach ' + to + '!</div>';
    closeCopyDayModal();
    if (to === currentDate) await refresh();
    showToast(result.copied_count + ' Mahlzeiten kopiert');
  } catch (e) { showToast('Fehler: ' + e.message, '&#9888;'); }
}

// ---- Export ----
function exportData() {
  const today = new Date().toISOString().split('T')[0];
  const format = confirm('JSON (OK) oder CSV (Abbrechen)?') ? 'json' : 'csv';
  window.open('/api/export?from=2024-01-01&to=' + today + '&format=' + format, '_blank');
  showToast('Export wird heruntergeladen');
}

// ---- Import ----
let importFileData = null;

function openImportModal() {
  importFileData = null;
  document.getElementById('importPreviewContainer').innerHTML = '';
  document.getElementById('importResultContainer').innerHTML = '';
  document.getElementById('importActions').style.display = 'none';
  document.getElementById('importEmptyActions').style.display = 'block';
  document.getElementById('importDropzone').style.display = 'block';
  document.getElementById('importFileInput').value = '';
  document.getElementById('importModal').classList.add('active');
}

function closeImportModal() {
  document.getElementById('importModal').classList.remove('active');
  importFileData = null;
}

function handleImportFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      importFileData = data;
      showImportPreview(data);
    } catch (err) {
      importFileData = null;
      document.getElementById('importPreviewContainer').innerHTML = '<div class="import-result error">Ung\u00fcltige JSON-Datei: ' + escHtml(err.message) + '</div>';
      document.getElementById('importActions').style.display = 'none';
      document.getElementById('importEmptyActions').style.display = 'block';
    }
  };
  reader.readAsText(file);
}

function showImportPreview(data) {
  const preview = document.getElementById('importPreviewContainer');
  const actions = document.getElementById('importActions');
  const emptyActions = document.getElementById('importEmptyActions');
  const dropzone = document.getElementById('importDropzone');

  let html = '<div class="import-preview">';
  let totalItems = 0;

  // Count all data
  const mealCount = (data.meals || data.entries || []).length;
  const foodCount = (data.foods || []).length;
  const weightCount = (data.bodyweight || []).length;
  const hasGoals = data.goals && typeof data.goals === 'object';

  if (mealCount > 0) {
    html += '<div class="preview-section">Mahlzeiten (' + mealCount + ')</div>';
    const meals = (data.meals || data.entries || []).slice(0, 5);
    meals.forEach(m => {
      html += '<div class="preview-item"><span>' + escHtml(m.food_name || 'Unbekannt') + '</span><span>' + (m.amount_g || '') + 'g &middot; ' + (m.calories || 0) + ' kcal</span></div>';
    });
    if (mealCount > 5) html += '<div class="preview-item" style="color:var(--text-muted);font-style:italic;">... +' + (mealCount - 5) + ' weitere</div>';
    totalItems += mealCount;
  }

  if (foodCount > 0) {
    html += '<div class="preview-section">Lebensmittel (' + foodCount + ')</div>';
    const foods = data.foods.slice(0, 4);
    foods.forEach(f => {
      html += '<div class="preview-item"><span>' + escHtml(f.name) + '</span><span>P:' + (f.protein_g||0) + ' F:' + (f.fat_g||0) + ' C:' + (f.carbs_g||0) + '</span></div>';
    });
    if (foodCount > 4) html += '<div class="preview-item" style="color:var(--text-muted);font-style:italic;">... +' + (foodCount - 4) + ' weitere</div>';
    totalItems += foodCount;
  }

  if (weightCount > 0) {
    html += '<div class="preview-section">K\u00f6rpergewicht (' + weightCount + ' Eintr\u00e4ge)</div>';
    const weights = data.bodyweight.slice(0, 3);
    weights.forEach(w => {
      html += '<div class="preview-item"><span>' + w.log_date + '</span><span>' + w.weight_kg + ' kg</span></div>';
    });
    if (weightCount > 3) html += '<div class="preview-item" style="color:var(--text-muted);font-style:italic;">... +' + (weightCount - 3) + ' weitere</div>';
    totalItems += weightCount;
  }

  if (hasGoals) {
    html += '<div class="preview-section">Ziele</div>';
    const g = data.goals;
    html += '<div class="preview-item"><span>Protein: ' + (g.protein_g||'---') + 'g | Fett: ' + (g.fat_g||'---') + 'g | Carbs: ' + (g.carbs_g||'---') + 'g | Kalorien: ' + (g.calories||'---') + ' kcal</span></div>';
    totalItems++;
  }

  if (totalItems === 0 && !hasGoals) {
    html += '<div style="color:var(--text-dim);text-align:center;padding:10px;">Keine importierbaren Daten gefunden.<br>Erwartet werden Arrays: <strong>meals</strong>, <strong>foods</strong>, <strong>bodyweight</strong> und/oder ein <strong>goals</strong>-Objekt.</div>';
  }

  html += '</div>';
  preview.innerHTML = html;

  if (totalItems > 0 || hasGoals) {
    actions.style.display = 'flex';
    emptyActions.style.display = 'none';
    dropzone.style.display = 'none';
  }
}

async function executeImport() {
  if (!importFileData) return;
  const btn = document.getElementById('importConfirmBtn');
  btn.disabled = true;
  btn.textContent = 'Importiere...';

  try {
    const result = await api('/api/import', {
      method: 'POST',
      body: JSON.stringify(importFileData)
    });

    const container = document.getElementById('importResultContainer');
    if (result.success) {
      container.innerHTML = '<div class="import-result success">' + escHtml(result.message) + '</div>';
      showToast(result.message);
      await refresh();
    } else {
      container.innerHTML = '<div class="import-result error">Fehler beim Import: ' + escHtml(result.message) + '</div>';
    }

    document.getElementById('importActions').style.display = 'none';
    document.getElementById('importEmptyActions').style.display = 'block';
  } catch (e) {
    document.getElementById('importResultContainer').innerHTML = '<div class="import-result error">Fehler: ' + escHtml(e.message) + '</div>';
    document.getElementById('importActions').style.display = 'none';
    document.getElementById('importEmptyActions').style.display = 'block';
  }

  btn.disabled = false;
  btn.textContent = 'Importieren';
}

// ---- Body Weight ----
function openWeightModal() {
  document.getElementById('weightInput').value = bodyWeights.length > 0 ? bodyWeights[0].weight_kg : 80;
  document.getElementById('weightDate').value = currentDate;
  renderWeightHistory();
  document.getElementById('weightModal').classList.add('active');
}
function closeWeightModal() { document.getElementById('weightModal').classList.remove('active'); }

async function saveWeight() {
  const weight = parseFloat(document.getElementById('weightInput').value);
  const date = document.getElementById('weightDate').value;
  if (!weight || weight < 20) { showToast('Bitte ein g&uuml;ltiges Gewicht eingeben', '&#9888;'); return; }
  try {
    await api('/api/bodyweight', {
      method: 'POST',
      body: JSON.stringify({ weight_kg: weight, log_date: date })
    });
    showToast('Gewicht gespeichert: ' + weight + ' kg');
    await loadBodyWeight();
    renderWeightHistory();
  } catch (e) { showToast('Fehler: ' + e.message, '&#9888;'); }
}

async function deleteWeight(id) {
  try {
    await api('/api/bodyweight/' + id, { method: 'DELETE' });
    await loadBodyWeight();
    renderWeightHistory();
  } catch (e) { showToast('Fehler: ' + e.message, '&#9888;'); }
}

function renderWeightHistory() {
  const el = document.getElementById('weightHistory');
  if (!el) return;
  if (bodyWeights.length === 0) {
    el.innerHTML = '<div style="color:var(--text-dim);font-size:0.82rem;text-align:center;padding:10px;">Noch keine Gewichtsdaten</div>';
    return;
  }
  el.innerHTML = bodyWeights.slice(0, 10).map(w =>
    '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);font-size:0.82rem;">' +
      '<span>' + w.log_date + '</span>' +
      '<span><strong>' + w.weight_kg.toFixed(1) + '</strong> kg' +
      ' <button class="btn-icon" onclick="deleteWeight(' + w.id + ')" style="color:var(--danger);font-size:0.7rem;">&times;</button></span>' +
    '</div>'
  ).join('');
}

// ---- Week Overview ----
function renderWeekOverview(history) {
  if (!history || history.length === 0) {
    document.getElementById('weekOverview').innerHTML = '<div class="meal-empty">Noch keine Daten f&uuml;r die letzten 7 Tage.</div>';
    return;
  }

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const existing = history.find(h => h.log_date === dateStr);
    days.push(existing || { log_date: dateStr, protein: 0, fat: 0, carbs: 0, calories: 0 });
  }

  const goalKcal = goals.calories;
  document.getElementById('weekOverview').innerHTML =
    '<div style="overflow-x:auto;">' +
    '<table class="week-table">' +
      '<thead><tr>' +
        '<th>Tag</th><th>Protein</th><th>Fett</th><th>Carbs</th><th>Kalorien</th><th>Fortschritt</th>' +
      '</tr></thead><tbody>' +
      days.map(d => {
        const pct = goalKcal > 0 ? Math.min(100, Math.round((d.calories / goalKcal) * 100)) : 0;
        const isToday = d.log_date === currentDate;
        return '<tr class="' + (isToday ? 'today' : '') + '">' +
          '<td style="font-weight:' + (isToday ? '700' : '400') + ';">' + formatDate(d.log_date).split(',')[0] + (isToday ? ' &larr;' : '') + '</td>' +
          '<td>' + Math.round(d.protein) + 'g</td>' +
          '<td>' + Math.round(d.fat) + 'g</td>' +
          '<td>' + Math.round(d.carbs) + 'g</td>' +
          '<td>' + Math.round(d.calories) + ' / ' + goalKcal + '</td>' +
          '<td class="bar-cell"><div class="bar-track">' +
            '<div class="bar-fill' + (pct >= 100 ? ' over' : '') + '" style="width:' + pct + '%;min-width:3px;"></div>' +
            '<span style="font-size:0.72rem;color:var(--text-muted);white-space:nowrap;">' + pct + '%</span>' +
          '</div></td>' +
        '</tr>';
      }).join('') +
      '</tbody></table></div>';
}

// ---- Tab Switching ----
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const idx = ['foods', 'calculator', 'charts', 'ai-import'].indexOf(tabName);
  const tabs = document.querySelectorAll('.tab');
  if (tabs[idx]) tabs[idx].classList.add('active');

  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const content = document.getElementById('tab-' + tabName);
  if (content) content.classList.add('active');

  if (tabName === 'calculator') calculateMacros();
  if (tabName === 'charts') renderCharts();
}

// ---- Macro Calculator (Mifflin-St Jeor) ----
let lastCalcResult = null;

function calculateMacros() {
  const gender = document.getElementById('calcGender').value;
  const age = parseInt(document.getElementById('calcAge').value) || 30;
  const height = parseInt(document.getElementById('calcHeight').value) || 180;
  const weight = parseFloat(document.getElementById('calcWeight').value) || 80;
  const activity = parseFloat(document.getElementById('calcActivity').value);
  const goal = document.getElementById('calcGoal').value;

  let bmr;
  if (gender === 'male') {
    bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  }

  const tdee = Math.round(bmr * activity);
  const adjustments = { muscle: 300, moderate_gain: 150, maintenance: 0, fat_loss: -400, aggressive_cut: -700 };
  const targetKcal = tdee + (adjustments[goal] || 0);

  let proteinPerKg, fatPct;
  switch (goal) {
    case 'muscle': case 'moderate_gain': proteinPerKg = 2.0; fatPct = 0.25; break;
    case 'maintenance': proteinPerKg = 1.6; fatPct = 0.25; break;
    case 'fat_loss': proteinPerKg = 2.2; fatPct = 0.22; break;
    case 'aggressive_cut': proteinPerKg = 2.4; fatPct = 0.20; break;
    default: proteinPerKg = 1.8; fatPct = 0.25;
  }

  const proteinG = Math.round(weight * proteinPerKg);
  const fatG = Math.round((targetKcal * fatPct) / 9);
  const proteinKcal = proteinG * 4;
  const fatKcal = fatG * 9;
  const carbsKcal = targetKcal - proteinKcal - fatKcal;
  const carbsG = Math.round(Math.max(0, carbsKcal / 4));
  const waterMl = Math.round(weight * 35);

  lastCalcResult = { bmr, tdee, targetKcal, proteinG, fatG, carbsG, waterMl, proteinKcal, fatKcal, carbsKcal, weight, age, height, gender, activity, goal };

  const goalLabels = { muscle: 'Muskelaufbau', moderate_gain: 'Leichter Aufbau', maintenance: 'Gewicht halten', fat_loss: 'Fettabbau', aggressive_cut: 'Starker Fettabbau' };

  document.getElementById('calcResultBox').style.display = 'block';
  document.getElementById('calcResultBox').innerHTML =
    '<h4>Ergebnis f&uuml;r ' + weight + 'kg, ' + age + ' Jahre (' + goalLabels[goal] + ')</h4>' +
    '<div class="calc-macros" style="margin-bottom:8px;">' +
      '<div class="calc-macro-item"><span>Grundumsatz (BMR)</span><span class="val">' + Math.round(bmr) + ' kcal</span></div>' +
      '<div class="calc-macro-item"><span>Gesamtumsatz (TDEE)</span><span class="val">' + tdee + ' kcal</span></div>' +
    '</div>' +
    '<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;">' +
      'Ziel: <strong style="color:var(--kcal);">' + targetKcal + ' kcal</strong> (' + Math.round((targetKcal / tdee) * 100) + '% TDEE' + (targetKcal > tdee ? ', +' : ', ') + (targetKcal - tdee) + ' kcal)</div>' +
    '<div class="calc-macros">' +
      '<div class="calc-macro-item"><span><span class="tag tag-protein">Protein</span> ' + proteinG + 'g</span><span class="val macro-protein">' + proteinKcal + ' kcal</span></div>' +
      '<div class="calc-macro-item"><span><span class="tag tag-fat">Fett</span> ' + fatG + 'g</span><span class="val macro-fat">' + fatKcal + ' kcal</span></div>' +
      '<div class="calc-macro-item"><span><span class="tag tag-carbs">Carbs</span> ' + carbsG + 'g</span><span class="val macro-carbs">' + carbsKcal + ' kcal</span></div>' +
      '<div class="calc-macro-item"><span><span class="tag tag-kcal">Gesamt</span></span><span class="val macro-kcal">' + targetKcal + ' kcal</span></div>' +
    '</div>' +
    '<div style="margin-top:8px;font-size:0.76rem;color:var(--text-muted);">' +
      'Protein: <strong>' + (proteinG / weight).toFixed(1) + 'g/kg</strong> | Wasser: <strong style="color:var(--water);">' + waterMl + 'ml</strong></div>' +
    '<button class="btn btn-sm" onclick="applyCalcGoals()" style="margin-top:10px;width:100%;">Als Tagesziel &uuml;bernehmen</button>';
}

async function applyCalcGoals() {
  if (!lastCalcResult) return;
  try {
    await api('/api/goals', {
      method: 'PUT',
      body: JSON.stringify({
        protein_g: lastCalcResult.proteinG, fat_g: lastCalcResult.fatG,
        carbs_g: lastCalcResult.carbsG, calories: lastCalcResult.targetKcal,
        water_goal_ml: lastCalcResult.waterMl
      })
    });
    showToast('Makro-Ziele &uuml;bernommen!');
    goals = { protein_g: lastCalcResult.proteinG, fat_g: lastCalcResult.fatG, carbs_g: lastCalcResult.carbsG, calories: lastCalcResult.targetKcal, water_goal_ml: lastCalcResult.waterMl };
    if (summary) {
      summary.goals = goals;
      summary.remaining = {
        protein_g: lastCalcResult.proteinG - summary.consumed.protein_g,
        fat_g: lastCalcResult.fatG - summary.consumed.fat_g,
        carbs_g: lastCalcResult.carbsG - summary.consumed.carbs_g,
        calories: lastCalcResult.targetKcal - summary.consumed.calories
      };
      renderMacroCards();
    }
    await refresh();
    ['goalProtein','goalFat','goalCarbs','goalKcal','goalWater'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = goals[id.replace('goal','').toLowerCase() + (id==='goalKcal'?'_g':'_g')] || goals[id.replace('goal','').toLowerCase()];
    });
    document.getElementById('goalWater').value = lastCalcResult.waterMl;
  } catch (e) { showToast('Fehler: ' + e.message, '&#9888;'); }
}

// ---- Water Tracking ----
async function addWater(ml) {
  try {
    await api('/api/water', { method: 'POST', body: JSON.stringify({ amount_ml: ml, log_date: currentDate }) });
    showToast('+' + ml + 'ml Wasser ');
    await loadSummary();
  } catch (e) { showToast('Fehler: ' + e.message, '&#9888;'); }
}

// ============================================================
// CHARTS (Canvas-based)
// ============================================================

function setChartPeriod(period) {
  chartPeriod = period;
  document.getElementById('chartWeekBtn').className = period === 'week' ? 'btn btn-sm' : 'btn btn-sm btn-secondary';
  document.getElementById('chartMonthBtn').className = period === 'month' ? 'btn btn-sm' : 'btn btn-sm btn-secondary';
  renderCharts();
}

async function renderCharts() {
  const canvas = document.getElementById('chartCanvas');
  if (!canvas) return;

  try {
    let data;
    if (chartPeriod === 'week') {
      data = await api('/api/history');
      // Fill empty days
      const filled = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toISOString().split('T')[0];
        const e = data.find(x => x.log_date === ds);
        filled.push(e || { log_date: ds, protein: 0, fat: 0, carbs: 0, calories: 0 });
      }
      data = filled;
    } else {
      const month = currentDate.slice(0, 7);
      data = await api('/api/history/month?month=' + month);
    }
    chartData = data;
    drawChart(canvas, data, chartPeriod);
  } catch (e) {
    console.error(e);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#45495a';
      ctx.font = '14px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Keine Daten verf&uuml;gbar', canvas.width / 2, canvas.height / 2);
    }
  }
}

function drawChart(canvas, data, period) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = rect.width || 600;
  const h = 260;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, w, h);

  if (!data || data.length === 0) {
    ctx.fillStyle = '#45495a';
    ctx.font = '14px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Keine Daten', w / 2, h / 2);
    return;
  }

  const pad = { top: 30, bottom: 30, left: 55, right: 20 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const barCount = data.length;
  const barGap = cw / barCount;
  const barW = Math.min(barGap * 0.6, 30);
  const barOffset = (barGap - barW) / 2;

  const goalKcal = goals.calories || 2500;
  const maxVal = Math.max(...data.map(d => d.calories), goalKcal * 1.2);

  // Grid lines
  ctx.strokeStyle = '#252b3d';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (ch / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(w - pad.right, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#686c7e';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), pad.left - 8, y + 4);
    ctx.setLineDash([4, 4]);
  }
  ctx.setLineDash([]);

  // Goal line
  const goalY = pad.top + ch - (goalKcal / maxVal) * ch;
  ctx.strokeStyle = 'rgba(124,92,252,0.5)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(pad.left, goalY); ctx.lineTo(w - pad.right, goalY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = 'rgba(124,92,252,0.7)';
  ctx.font = '10px -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('Ziel: ' + goalKcal + ' kcal', pad.left + 4, goalY - 4);

  // Bars
  data.forEach((d, i) => {
    const x = pad.left + i * barGap + barOffset;
    const barH = (d.calories / maxVal) * ch;
    const y = pad.top + ch - barH;

    const overGoal = d.calories > goalKcal;
    const gradient = ctx.createLinearGradient(x, y, x, pad.top + ch);
    if (overGoal) {
      gradient.addColorStop(0, '#ef5350');
      gradient.addColorStop(1, '#c62828');
    } else {
      gradient.addColorStop(0, '#7c5cfc');
      gradient.addColorStop(1, '#5b3ce0');
    }

    ctx.fillStyle = gradient;
    ctx.beginPath();
    const r = 3;
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + barW - r, y);
    ctx.quadraticCurveTo(x + barW, y, x + barW, y + r);
    ctx.lineTo(x + barW, pad.top + ch);
    ctx.lineTo(x, pad.top + ch);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.fill();

    // Value on top
    ctx.fillStyle = '#e8eaef';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(d.calories), x + barW / 2, y - 6);

    // Date label
    ctx.fillStyle = '#686c7e';
    ctx.font = '10px -apple-system, sans-serif';
    const dateLabel = d.log_date ? d.log_date.slice(5) : '';
    ctx.fillText(dateLabel, x + barW / 2, pad.top + ch + 16);
  });

  // Stats
  const total = data.reduce((a, d) => a + d.calories, 0);
  const avg = total / data.length;
  const max = Math.max(...data.map(d => d.calories));
  const min = Math.min(...data.map(d => d.calories));
  document.getElementById('chartStats').innerHTML =
    '<span>Durchschnitt: <strong>' + Math.round(avg) + '</strong> kcal</span>' +
    '<span>Max: <strong>' + Math.round(max) + '</strong> kcal</span>' +
    '<span>Min: <strong>' + Math.round(min) + '</strong> kcal</span>' +
    '<span>Tage: <strong>' + data.filter(d => d.calories > 0).length + '/' + data.length + '</strong></span>';

  document.getElementById('chartLegend').innerHTML =
    '<span><span class="clr" style="background:var(--accent);"></span> Kalorien (Balken)</span>' +
    '<span><span class="clr" style="background:var(--protein);"></span> Ziel-Linie</span>' +
    '<span style="color:var(--text-dim);">| ' + (period === 'week' ? 'Letzte 7 Tage' : 'Monat ' + currentDate.slice(0, 7)) + '</span>';
}

// ============================================================
// KI Prompt & Import
// ============================================================

function setPromptMode(mode) {
  promptMode = mode;
  document.getElementById('btnPromptDay').className = mode === 'day' ? 'btn btn-sm' : 'btn btn-sm btn-secondary';
  document.getElementById('btnPromptMeal').className = mode === 'meal' ? 'btn btn-sm' : 'btn btn-sm btn-secondary';
  document.getElementById('promptDaySection').style.display = mode === 'day' ? 'block' : 'none';
  document.getElementById('promptMealSection').style.display = mode === 'meal' ? 'block' : 'none';
}

function generatePrompt() {
  const date = currentDate;
  let prompt;

  if (promptMode === 'meal') {
    const desc = document.getElementById('promptMealDescription').value.trim();
    const mealType = document.getElementById('promptMealType').value;
    prompt = `Ich schicke dir Fotos von meiner Mahlzeit. Analysiere die Bilder und berechne die Makro-Nährwerte (Protein, Fett, Kohlenhydrate, Kalorien).

Zusätzliche Beschreibung: "${desc || 'Siehe Fotos'}"

Mahlzeit-Typ: ${mealType}
Datum: ${date}

Anforderungen:
- Identifiziere alle Lebensmittel auf den Fotos
- Schätze die Portionsgrößen anhand der Bilder (in Gramm)
- Berechne für jedes Lebensmittel die Makros
- Wenn unsicher bei Mengen: gib konservative Schätzungen an
- Berechne Protein, Fett, Kohlenhydrate (in Gramm) und Kalorien für die gesamte Mahlzeit
- Berücksichtige Öl, Butter, Soßen und Dressings
- Gib die Antwort AUSSCHLIESSLICH als gültiges JSON zurück (kein Markdown, kein Text davor oder danach):

{
  "date": "${date}",
  "meals": [
    {
      "food_name": "Exakter Name des Gerichts mit allen erkannten Zutaten",
      "protein_g": 30,
      "fat_g": 12,
      "carbs_g": 45,
      "calories": 420,
      "amount_g": 350,
      "meal_type": "${mealType}"
    }
  ]
}`;
  } else {
    let p, f, c, kcal;
    if (lastCalcResult) { p = lastCalcResult.proteinG; f = lastCalcResult.fatG; c = lastCalcResult.carbsG; kcal = lastCalcResult.targetKcal; }
    else { p = goals.protein_g; f = goals.fat_g; c = goals.carbs_g; kcal = goals.calories; }
    const preferences = document.getElementById('promptPreferences').value.trim();
    prompt = `Erstelle mir einen vollständigen Ernährungsplan für einen Tag (${date}) mit folgenden Makro-Zielen:
- Protein: ${p}g
- Fett: ${f}g
- Kohlenhydrate: ${c}g
- Kalorien: ${kcal} kcal

${preferences ? 'Ernährungsstil / Wünsche: ' + preferences + '\n' : ''}Anforderungen:
- Erstelle 4-6 Mahlzeiten (Frühstück, Mittagessen, Abendessen, 1-3 Snacks)
- Jede Mahlzeit soll realistische Mengen haben (in Gramm)
- Die Summe aller Mahlzeiten muss möglichst genau die Ziel-Makros treffen
- Gib die Antwort AUSSCHLIESSLICH als gültiges JSON zurück (kein Markdown, kein Text davor oder danach):

{
  "date": "${date}",
  "meals": [
    {
      "food_name": "Genauer Name des Gerichts mit Zutaten",
      "protein_g": 30,
      "fat_g": 12,
      "carbs_g": 45,
      "calories": 420,
      "amount_g": 350,
      "meal_type": "Frühstück|Mittagessen|Abendessen|Snack|Pre-Workout|Post-Workout"
    }
  ]
}`;
  }

  document.getElementById('promptBox').style.display = 'block';
  document.getElementById('promptBox').innerHTML =
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
      '<span style="font-weight:600;color:var(--text);">KI-Prompt</span>' +
      '<button class="btn btn-sm" onclick="copyPrompt()">Kopieren</button>' +
    '</div>' +
    '<div style="background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);padding:12px;max-height:200px;overflow-y:auto;font-family:\'SF Mono\',\'Fira Code\',monospace;font-size:0.76rem;color:var(--text-muted);white-space:pre-wrap;word-break:break-word;">' + escHtml(prompt) + '</div>';
}

async function copyPrompt() {
  const content = document.getElementById('promptBox').querySelector('div:last-child').textContent;
  try { await navigator.clipboard.writeText(content); showToast('Prompt kopiert!'); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = content;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Prompt kopiert!');
  }
}

async function importMeals() {
  const raw = document.getElementById('importData').value.trim();
  if (!raw) { showToast('Bitte die KI-Antwort einfugen', '&#9888;'); return; }

  let data;
  try { data = JSON.parse(raw); }
  catch (e) {
    const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) { try { data = JSON.parse(jsonMatch[1]); } catch(e2) {} }
  }
  if (!data) { showToast('Kein gultiges JSON gefunden', '&#9888;'); return; }
  if (!data.meals || !Array.isArray(data.meals) || data.meals.length === 0) {
    showToast('Das JSON muss ein "meals"-Array enthalten', '&#9888;'); return;
  }
  if (data.meals.filter(m => !m.food_name).length > 0) {
    showToast('Einige Mahlzeiten ohne "food_name"', '&#9888;'); return;
  }

  try {
    const result = await api('/api/meals/import', {
      method: 'POST',
      body: JSON.stringify({ date: data.date || currentDate, meals: data.meals })
    });

    if (data.date && data.date !== currentDate) {
      currentDate = data.date;
      document.getElementById('currentDate').textContent = formatDate(currentDate);
    }

    const s = result.summary;
    document.getElementById('importResult').innerHTML =
      '<div style="color:var(--success);font-weight:600;">' + result.imported_count + ' Mahlzeiten importiert!</div>' +
      '<div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px;">' +
        'P: ' + s.consumed.protein_g + 'g | F: ' + s.consumed.fat_g + 'g | C: ' + s.consumed.carbs_g + 'g | ' + s.consumed.calories + ' kcal' +
      '</div>';
    document.getElementById('importData').value = '';
    showToast(result.imported_count + ' Mahlzeiten importiert!');
    await refresh();
  } catch (e) {
    document.getElementById('importResult').innerHTML = '<div style="color:var(--danger);">Fehler: ' + escHtml(e.message) + '</div>';
  }
}

// ---- Utilities ----
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
    .replace(/ä/g, '&auml;').replace(/ö/g, '&ouml;').replace(/ü/g, '&uuml;')
    .replace(/Ä/g, '&Auml;').replace(/Ö/g, '&Ouml;').replace(/Ü/g, '&Uuml;')
    .replace(/ß/g, '&szlig;');
}

function round1(v) { return Math.round(v * 10) / 10; }

// ---- Keyboard Shortcuts ----
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(m => m.classList.remove('active'));
  }
  if (e.ctrlKey || e.metaKey) return;
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;
  if (e.key === 'ArrowLeft') changeDate(-1);
  if (e.key === 'ArrowRight') changeDate(1);
  if (e.key === 't' || e.key === 'T') changeDate(0);
});

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('currentDate').textContent = formatDate(currentDate);

  // Set date inputs to today
  document.getElementById('weightDate').value = currentDate;
  document.getElementById('copyFromDate').value = currentDate;
  document.getElementById('copyToDate').value = currentDate;

  await loadGoals();
  await refresh();

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('active');
    });
  });

  // Handle window resize for charts
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const chartsTab = document.getElementById('tab-charts');
      if (chartsTab && chartsTab.classList.contains('active')) renderCharts();
    }, 200);
  });

  // Import dropzone drag & drop
  const dropzone = document.getElementById('importDropzone');
  if (dropzone) {
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
    dropzone.addEventListener('dragleave', () => { dropzone.classList.remove('drag-over'); });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.json')) {
        const input = document.getElementById('importFileInput');
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        handleImportFile({ target: { files: [file] } });
      } else {
        showToast('Bitte eine .json Datei ablegen', '&#9888;');
      }
    });
  }
});
