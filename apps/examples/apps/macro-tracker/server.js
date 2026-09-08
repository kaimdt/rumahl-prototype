/* ============================================================
   Macro Tracker - Protein, Kalorien & Fett Rechner
   Für Kraftsportler zum Tracken und Planen von Mahlzeiten
   ============================================================ */
const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const app = express();
const PORT = process.env.PORT || 3000;

// ---- Middleware ----
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));

// ---- rumahl Database Integration ----
const RUMAHL_HOME = process.env.RUMAHL_HOME_URL || 'http://rumahl-home:3001';
const APP_ID = 'macro-tracker';
let db = null;

function getHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (process.env.RUMAHL_API_KEY) h['Authorization'] = 'Bearer ' + process.env.RUMAHL_API_KEY;
  return h;
}

// Use rumahl-provided SQLite if running in rumahl, otherwise use local file
async function initDatabase() {
  try {
    // Try rumahl database first
    const statusRes = await fetch(`${RUMAHL_HOME}/api/apps/${APP_ID}/database/status`, {
      headers: getHeaders()
    });
    if (statusRes.ok) {
      const status = await statusRes.json();
      if (status.provisioned) {
        console.log('[MacroTracker] Using rumahl-managed SQLite database');

        // Execute init SQL directly against rumahl API
        const initSQL = [
          `CREATE TABLE IF NOT EXISTS goals (id INTEGER PRIMARY KEY AUTOINCREMENT, protein_g REAL NOT NULL DEFAULT 180, fat_g REAL NOT NULL DEFAULT 70, carbs_g REAL NOT NULL DEFAULT 250, calories REAL NOT NULL DEFAULT 2500, water_goal_ml REAL NOT NULL DEFAULT 3000, updated_at TEXT DEFAULT (datetime('now')))`,
          `CREATE TABLE IF NOT EXISTS water_log (id INTEGER PRIMARY KEY AUTOINCREMENT, amount_ml REAL NOT NULL DEFAULT 250, log_date TEXT NOT NULL DEFAULT (date('now')), logged_at TEXT DEFAULT (datetime('now')))`,
          `CREATE INDEX IF NOT EXISTS idx_water_date ON water_log(log_date)`,
          `CREATE TABLE IF NOT EXISTS food_items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, brand TEXT DEFAULT '', protein_g REAL NOT NULL DEFAULT 0, fat_g REAL NOT NULL DEFAULT 0, carbs_g REAL NOT NULL DEFAULT 0, calories REAL NOT NULL DEFAULT 0, serving_size_g REAL NOT NULL DEFAULT 100, category TEXT DEFAULT 'Sonstiges', is_favorite INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
          `CREATE TABLE IF NOT EXISTS meals (id INTEGER PRIMARY KEY AUTOINCREMENT, food_item_id INTEGER, food_name TEXT NOT NULL, protein_g REAL NOT NULL DEFAULT 0, fat_g REAL NOT NULL DEFAULT 0, carbs_g REAL NOT NULL DEFAULT 0, calories REAL NOT NULL DEFAULT 0, amount_g REAL NOT NULL DEFAULT 100, meal_type TEXT NOT NULL DEFAULT 'snack', log_date TEXT NOT NULL DEFAULT (date('now')), logged_at TEXT DEFAULT (datetime('now')))`,
          `CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(log_date)`,
          `CREATE INDEX IF NOT EXISTS idx_food_category ON food_items(category)`,
          `INSERT OR IGNORE INTO goals (id, protein_g, fat_g, carbs_g, calories, water_goal_ml) VALUES (1, 180, 70, 250, 2500, 3000)`,
        ];

        for (const sql of initSQL) {
          await fetch(`${RUMAHL_HOME}/api/apps/${APP_ID}/database/execute`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ sql, params: [] })
          });
        }

        // Insert default foods
        const defaultFoods = [
          ['Hähnchenbrust', '', 31, 3.6, 0, 165, 100, 'Fleisch & Fisch'],
          ['Lachs', '', 20, 13, 0, 208, 100, 'Fleisch & Fisch'],
          ['Rinderhack (mager)', '', 21, 10, 0, 176, 100, 'Fleisch & Fisch'],
          ['Thunfisch (Dose, Wasser)', '', 26, 1, 0, 116, 100, 'Fleisch & Fisch'],
          ['Eier (ganz)', '', 13, 11, 1.1, 155, 100, 'Eier & Milch'],
          ['Magerquark', '', 12, 0.3, 4.2, 68, 100, 'Eier & Milch'],
          ['Skyr', '', 11, 0.2, 4, 64, 100, 'Eier & Milch'],
          ['Reis (gekocht)', '', 2.7, 0.3, 28, 130, 100, 'Beilagen'],
          ['Haferflocken', '', 13, 7, 59, 370, 100, 'Frühstück'],
          ['Vollkornbrot', '', 8, 1.5, 43, 220, 100, 'Frühstück'],
          ['Süßkartoffel', '', 1.6, 0.1, 20, 86, 100, 'Beilagen'],
          ['Nudeln (gekocht)', '', 5, 1, 31, 160, 100, 'Beilagen'],
          ['Brokkoli', '', 2.8, 0.4, 7, 34, 100, 'Gemüse'],
          ['Whey Protein', '', 80, 5, 5, 390, 30, 'Supplements'],
          ['Erdnussbutter', '', 25, 50, 20, 620, 100, 'Fette & Nüsse'],
          ['Mandeln', '', 21, 50, 22, 610, 100, 'Fette & Nüsse'],
          ['Olivenöl', '', 0, 100, 0, 884, 100, 'Fette & Nüsse'],
          ['Banane', '', 1.1, 0.3, 23, 96, 100, 'Obst'],
          ['Apfel', '', 0.3, 0.2, 14, 52, 100, 'Obst'],
          ['Quinoa (gekocht)', '', 4.4, 1.9, 21, 120, 100, 'Beilagen'],
        ];

        for (const food of defaultFoods) {
          await fetch(`${RUMAHL_HOME}/api/apps/${APP_ID}/database/execute`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
              sql: `INSERT OR IGNORE INTO food_items (name, brand, protein_g, fat_g, carbs_g, calories, serving_size_g, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              params: food
            })
          });
        }

        console.log('[MacroTracker] rumahl database initialized with default foods');
        return true;
      }
    }
  } catch (e) {
    console.log('[MacroTracker] rumahl database not available, using local SQLite:', e.message);
  }

  // Fallback: local SQLite file
  db = new Database(path.join(__dirname, 'macro-tracker.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      protein_g REAL NOT NULL DEFAULT 180,
      fat_g REAL NOT NULL DEFAULT 70,
      carbs_g REAL NOT NULL DEFAULT 250,
      calories REAL NOT NULL DEFAULT 2500,
      water_goal_ml REAL NOT NULL DEFAULT 3000,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS water_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount_ml REAL NOT NULL DEFAULT 250,
      log_date TEXT NOT NULL DEFAULT (date('now')),
      logged_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_water_date ON water_log(log_date);

    CREATE TABLE IF NOT EXISTS food_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT DEFAULT '',
      protein_g REAL NOT NULL DEFAULT 0,
      fat_g REAL NOT NULL DEFAULT 0,
      carbs_g REAL NOT NULL DEFAULT 0,
      calories REAL NOT NULL DEFAULT 0,
      serving_size_g REAL NOT NULL DEFAULT 100,
      category TEXT DEFAULT 'Sonstiges',
      is_favorite INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      food_item_id INTEGER,
      food_name TEXT NOT NULL,
      protein_g REAL NOT NULL DEFAULT 0,
      fat_g REAL NOT NULL DEFAULT 0,
      carbs_g REAL NOT NULL DEFAULT 0,
      calories REAL NOT NULL DEFAULT 0,
      amount_g REAL NOT NULL DEFAULT 100,
      meal_type TEXT NOT NULL DEFAULT 'snack',
      log_date TEXT NOT NULL DEFAULT (date('now')),
      logged_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (food_item_id) REFERENCES food_items(id)
    );

    CREATE INDEX IF NOT EXISTS idx_meals_date ON meals(log_date);
    CREATE INDEX IF NOT EXISTS idx_food_category ON food_items(category);
  `);

  // Insert default goals if empty
  const goalCount = db.prepare('SELECT COUNT(*) as c FROM goals').get();
  if (goalCount.c === 0) {
    db.prepare('INSERT INTO goals (protein_g, fat_g, carbs_g, calories, water_goal_ml) VALUES (180, 70, 250, 2500, 3000)').run();
  }
  // Migration: add water_goal_ml to existing goals
  try { db.prepare('ALTER TABLE goals ADD COLUMN water_goal_ml REAL NOT NULL DEFAULT 3000').run(); } catch(e) {}

  // Insert default foods if empty
  const foodCount = db.prepare('SELECT COUNT(*) as c FROM food_items').get();
  if (foodCount.c === 0) {
    const insertFood = db.prepare('INSERT INTO food_items (name, brand, protein_g, fat_g, carbs_g, calories, serving_size_g, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const defaultFoods = [
      ['Hähnchenbrust', '', 31, 3.6, 0, 165, 100, 'Fleisch & Fisch'],
      ['Lachs', '', 20, 13, 0, 208, 100, 'Fleisch & Fisch'],
      ['Rinderhack (mager)', '', 21, 10, 0, 176, 100, 'Fleisch & Fisch'],
      ['Thunfisch (Dose, Wasser)', '', 26, 1, 0, 116, 100, 'Fleisch & Fisch'],
      ['Eier (ganz)', '', 13, 11, 1.1, 155, 100, 'Eier & Milch'],
      ['Magerquark', '', 12, 0.3, 4.2, 68, 100, 'Eier & Milch'],
      ['Skyr', '', 11, 0.2, 4, 64, 100, 'Eier & Milch'],
      ['Reis (gekocht)', '', 2.7, 0.3, 28, 130, 100, 'Beilagen'],
      ['Haferflocken', '', 13, 7, 59, 370, 100, 'Frühstück'],
      ['Vollkornbrot', '', 8, 1.5, 43, 220, 100, 'Frühstück'],
      ['Süßkartoffel', '', 1.6, 0.1, 20, 86, 100, 'Beilagen'],
      ['Nudeln (gekocht)', '', 5, 1, 31, 160, 100, 'Beilagen'],
      ['Brokkoli', '', 2.8, 0.4, 7, 34, 100, 'Gemüse'],
      ['Whey Protein', '', 80, 5, 5, 390, 30, 'Supplements'],
      ['Erdnussbutter', '', 25, 50, 20, 620, 100, 'Fette & Nüsse'],
      ['Mandeln', '', 21, 50, 22, 610, 100, 'Fette & Nüsse'],
      ['Olivenöl', '', 0, 100, 0, 884, 100, 'Fette & Nüsse'],
      ['Banane', '', 1.1, 0.3, 23, 96, 100, 'Obst'],
      ['Apfel', '', 0.3, 0.2, 14, 52, 100, 'Obst'],
      ['Quinoa (gekocht)', '', 4.4, 1.9, 21, 120, 100, 'Beilagen'],
    ];

    const insertAll = db.transaction(() => {
      for (const food of defaultFoods) {
        insertFood.run(...food);
      }
    });
    insertAll();
  }

  console.log('[MacroTracker] Local SQLite database initialized');
  return false;
}

// ---- DB Query Helper (works with both rumahl and local SQLite) ----
async function dbAll(sql, params = []) {
  if (db) {
    // Local SQLite
    const stmt = db.prepare(sql);
    return stmt.all(...params);
  } else {
    // rumahl API
    const res = await fetch(`${RUMAHL_HOME}/api/apps/${APP_ID}/database/execute`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ sql, params })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Database query failed');
    if (!data.rows || data.rows.length === 0) return [];

    // Convert array-based rows to objects
    return data.rows.map(row => {
      const obj = {};
      data.columns.forEach((col, i) => { obj[col] = row[i]; });
      return obj;
    });
  }
}

async function dbRun(sql, params = []) {
  if (db) {
    const stmt = db.prepare(sql);
    return stmt.run(...params);
  } else {
    const res = await fetch(`${RUMAHL_HOME}/api/apps/${APP_ID}/database/execute`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ sql, params })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Database query failed');
    return data;
  }
}

async function dbGet(sql, params = []) {
  const rows = await dbAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// ---- Health Check ----
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'macro-tracker',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ---- API: Goals ----
app.get('/api/goals', async (req, res) => {
  try {
    const goal = await dbGet('SELECT * FROM goals ORDER BY id DESC LIMIT 1');
    res.json(goal || { protein_g: 180, fat_g: 70, carbs_g: 250, calories: 2500 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/goals', async (req, res) => {
  try {
    const { protein_g, fat_g, carbs_g, calories, water_goal_ml } = req.body;
    await dbRun(
      'INSERT INTO goals (protein_g, fat_g, carbs_g, calories, water_goal_ml) VALUES (?, ?, ?, ?, ?)',
      [protein_g, fat_g, carbs_g, calories, water_goal_ml || 3000]
    );
    const goal = await dbGet('SELECT * FROM goals ORDER BY id DESC LIMIT 1');
    res.json(goal);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: Water Tracking ----
app.get('/api/water', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const total = await dbGet(
      'SELECT COALESCE(SUM(amount_ml), 0) as total_ml, COUNT(*) as entries FROM water_log WHERE log_date = ?',
      [date]
    );
    const entries = await dbAll(
      'SELECT * FROM water_log WHERE log_date = ? ORDER BY logged_at DESC',
      [date]
    );
    res.json({ date, total_ml: total.total_ml, entries, entry_count: total.entries });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/water', async (req, res) => {
  try {
    const { amount_ml, log_date } = req.body;
    const date = log_date || new Date().toISOString().split('T')[0];
    const result = await dbRun(
      'INSERT INTO water_log (amount_ml, log_date) VALUES (?, ?)',
      [amount_ml || 250, date]
    );
    let id;
    if (db) id = result.lastInsertRowid;
    else id = result.last_insert_id || result.lastInsertRowid;
    const entry = await dbGet('SELECT * FROM water_log WHERE id = ?', [id]);
    res.status(201).json(entry);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/water/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM water_log WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: Food Items ----
app.get('/api/foods', async (req, res) => {
  try {
    const { category, search } = req.query;
    let sql = 'SELECT * FROM food_items WHERE 1=1';
    const params = [];

    if (category && category !== 'Alle') {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (search) {
      sql += ' AND name LIKE ?';
      params.push(`%${search}%`);
    }

    sql += ' ORDER BY is_favorite DESC, category, name';
    const foods = await dbAll(sql, params);
    res.json(foods);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/foods/categories', async (req, res) => {
  try {
    const categories = await dbAll('SELECT DISTINCT category FROM food_items ORDER BY category');
    res.json(categories.map(c => c.category));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/foods', async (req, res) => {
  try {
    const { name, brand, protein_g, fat_g, carbs_g, calories, serving_size_g, category } = req.body;
    const result = await dbRun(
      'INSERT INTO food_items (name, brand, protein_g, fat_g, carbs_g, calories, serving_size_g, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, brand || '', protein_g || 0, fat_g || 0, carbs_g || 0, calories || 0, serving_size_g || 100, category || 'Sonstiges']
    );

    let id;
    if (db) {
      id = result.lastInsertRowid;
    } else {
      id = result.last_insert_id || result.lastInsertRowid;
    }

    const food = await dbGet('SELECT * FROM food_items WHERE id = ?', [id]);
    res.status(201).json(food);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/foods/:id', async (req, res) => {
  try {
    const { name, brand, protein_g, fat_g, carbs_g, calories, serving_size_g, category } = req.body;
    await dbRun(
      'UPDATE food_items SET name=?, brand=?, protein_g=?, fat_g=?, carbs_g=?, calories=?, serving_size_g=?, category=? WHERE id=?',
      [name, brand || '', protein_g, fat_g, carbs_g, calories, serving_size_g || 100, category, req.params.id]
    );
    const food = await dbGet('SELECT * FROM food_items WHERE id = ?', [req.params.id]);
    res.json(food);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/foods/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM food_items WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/foods/:id/toggle-favorite', async (req, res) => {
  try {
    const food = await dbGet('SELECT * FROM food_items WHERE id = ?', [req.params.id]);
    if (!food) return res.status(404).json({ error: 'Not found' });
    const newFav = food.is_favorite ? 0 : 1;
    await dbRun('UPDATE food_items SET is_favorite = ? WHERE id = ?', [newFav, req.params.id]);
    res.json({ id: parseInt(req.params.id), is_favorite: newFav });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: Meals ----
app.get('/api/meals', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const meals = await dbAll(
      'SELECT * FROM meals WHERE log_date = ? ORDER BY logged_at DESC',
      [date]
    );
    res.json(meals);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/meals', async (req, res) => {
  try {
    const { food_item_id, food_name, protein_g, fat_g, carbs_g, calories, amount_g, meal_type, log_date } = req.body;
    const date = log_date || new Date().toISOString().split('T')[0];

    const result = await dbRun(
      'INSERT INTO meals (food_item_id, food_name, protein_g, fat_g, carbs_g, calories, amount_g, meal_type, log_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [food_item_id || null, food_name, protein_g || 0, fat_g || 0, carbs_g || 0, calories || 0, amount_g || 100, meal_type || 'snack', date]
    );

    let id;
    if (db) {
      id = result.lastInsertRowid;
    } else {
      id = result.last_insert_id || result.lastInsertRowid;
    }

    const meal = await dbGet('SELECT * FROM meals WHERE id = ?', [id]);
    res.status(201).json(meal);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/meals/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM meals WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: Bulk Import (from AI prompt output) ----
app.post('/api/meals/import', async (req, res) => {
  try {
    const { date, meals: mealsData } = req.body;
    if (!mealsData || !Array.isArray(mealsData) || mealsData.length === 0) {
      return res.status(400).json({ error: 'Keine Mahlzeiten zum Importieren' });
    }

    const importDate = date || new Date().toISOString().split('T')[0];
    const imported = [];

    for (const m of mealsData) {
      if (!m.food_name) continue;
      const result = await dbRun(
        'INSERT INTO meals (food_item_id, food_name, protein_g, fat_g, carbs_g, calories, amount_g, meal_type, log_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          m.food_item_id || null,
          m.food_name,
          m.protein_g || 0,
          m.fat_g || 0,
          m.carbs_g || 0,
          m.calories || 0,
          m.amount_g || 100,
          m.meal_type || 'snack',
          importDate
        ]
      );

      let id;
      if (db) {
        id = result.lastInsertRowid;
      } else {
        id = result.last_insert_id || result.lastInsertRowid;
      }
      const meal = await dbGet('SELECT * FROM meals WHERE id = ?', [id]);
      imported.push(meal);
    }

    // Return updated summary
    const goal = await dbGet('SELECT * FROM goals ORDER BY id DESC LIMIT 1');
    const totals = await dbGet(
      `SELECT COALESCE(SUM(protein_g),0) as tp, COALESCE(SUM(fat_g),0) as tf,
        COALESCE(SUM(carbs_g),0) as tc, COALESCE(SUM(calories),0) as tcal
      FROM meals WHERE log_date = ?`,
      [importDate]
    );
    const g = goal || { protein_g: 180, fat_g: 70, carbs_g: 250, calories: 2500 };

    res.json({
      success: true,
      imported_count: imported.length,
      summary: {
        consumed: { protein_g: Math.round(totals.tp*10)/10, fat_g: Math.round(totals.tf*10)/10, carbs_g: Math.round(totals.tc*10)/10, calories: Math.round(totals.tcal) },
        remaining: { protein_g: Math.round((g.protein_g-totals.tp)*10)/10, fat_g: Math.round((g.fat_g-totals.tf)*10)/10, carbs_g: Math.round((g.carbs_g-totals.tc)*10)/10, calories: Math.round(g.calories-totals.tcal) }
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: Daily Summary ----
app.get('/api/summary', async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().split('T')[0];
    const goal = await dbGet('SELECT * FROM goals ORDER BY id DESC LIMIT 1');
    const totals = await dbGet(
      `SELECT
        COALESCE(SUM(protein_g), 0) as total_protein,
        COALESCE(SUM(fat_g), 0) as total_fat,
        COALESCE(SUM(carbs_g), 0) as total_carbs,
        COALESCE(SUM(calories), 0) as total_calories,
        COUNT(*) as meal_count
      FROM meals WHERE log_date = ?`,
      [date]
    );

    // Group by meal type
    const byMealType = await dbAll(
      `SELECT meal_type,
        COALESCE(SUM(protein_g), 0) as protein,
        COALESCE(SUM(fat_g), 0) as fat,
        COALESCE(SUM(carbs_g), 0) as carbs,
        COALESCE(SUM(calories), 0) as calories
      FROM meals WHERE log_date = ?
      GROUP BY meal_type`,
      [date]
    );

    const g = goal || { protein_g: 180, fat_g: 70, carbs_g: 250, calories: 2500, water_goal_ml: 3000 };

    // Water
    const waterTotal = await dbGet('SELECT COALESCE(SUM(amount_ml),0) as total_ml FROM water_log WHERE log_date = ?', [date]);

    res.json({
      date,
      goals: {
        protein_g: g.protein_g,
        fat_g: g.fat_g,
        carbs_g: g.carbs_g,
        calories: g.calories,
        water_goal_ml: g.water_goal_ml || 3000
      },
      consumed: {
        protein_g: Math.round(totals.total_protein * 10) / 10,
        fat_g: Math.round(totals.total_fat * 10) / 10,
        carbs_g: Math.round(totals.total_carbs * 10) / 10,
        calories: Math.round(totals.total_calories),
        water_ml: Math.round(waterTotal.total_ml)
      },
      remaining: {
        protein_g: Math.round((g.protein_g - totals.total_protein) * 10) / 10,
        fat_g: Math.round((g.fat_g - totals.total_fat) * 10) / 10,
        carbs_g: Math.round((g.carbs_g - totals.total_carbs) * 10) / 10,
        calories: Math.round(g.calories - totals.total_calories),
        water_ml: Math.round((g.water_goal_ml || 3000) - waterTotal.total_ml)
      },
      progress: {
        protein_pct: g.protein_g > 0 ? Math.min(100, Math.round((totals.total_protein / g.protein_g) * 100)) : 0,
        fat_pct: g.fat_g > 0 ? Math.min(100, Math.round((totals.total_fat / g.fat_g) * 100)) : 0,
        carbs_pct: g.carbs_g > 0 ? Math.min(100, Math.round((totals.total_carbs / g.carbs_g) * 100)) : 0,
        calories_pct: g.calories > 0 ? Math.min(100, Math.round((totals.total_calories / g.calories) * 100)) : 0,
        water_pct: (g.water_goal_ml || 3000) > 0 ? Math.min(100, Math.round((waterTotal.total_ml / (g.water_goal_ml || 3000)) * 100)) : 0
      },
      by_meal_type: byMealType,
      meal_count: totals.meal_count
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: Week History ----
app.get('/api/history', async (req, res) => {
  try {
    const days = await dbAll(
      `SELECT log_date,
        COALESCE(SUM(protein_g), 0) as protein,
        COALESCE(SUM(fat_g), 0) as fat,
        COALESCE(SUM(carbs_g), 0) as carbs,
        COALESCE(SUM(calories), 0) as calories
      FROM meals
      WHERE log_date >= date('now', '-6 days')
      GROUP BY log_date
      ORDER BY log_date DESC`
    );
    res.json(days);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: History (month) ----
app.get('/api/history/month', async (req, res) => {
  try {
    const yearMonth = req.query.month || new Date().toISOString().slice(0, 7);
    const days = await dbAll(
      `SELECT log_date,
        COALESCE(SUM(protein_g), 0) as protein,
        COALESCE(SUM(fat_g), 0) as fat,
        COALESCE(SUM(carbs_g), 0) as carbs,
        COALESCE(SUM(calories), 0) as calories
      FROM meals
      WHERE log_date LIKE ?
      GROUP BY log_date
      ORDER BY log_date ASC`,
      [yearMonth + '%']
    );
    res.json(days);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: Edit Meal ----
app.put('/api/meals/:id', async (req, res) => {
  try {
    const { food_name, protein_g, fat_g, carbs_g, calories, amount_g, meal_type } = req.body;
    await dbRun(
      'UPDATE meals SET food_name=?, protein_g=?, fat_g=?, carbs_g=?, calories=?, amount_g=?, meal_type=? WHERE id=?',
      [food_name, protein_g||0, fat_g||0, carbs_g||0, calories||0, amount_g||100, meal_type||'snack', req.params.id]
    );
    const meal = await dbGet('SELECT * FROM meals WHERE id = ?', [req.params.id]);
    res.json(meal);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: Duplicate Meal ----
app.post('/api/meals/:id/duplicate', async (req, res) => {
  try {
    const original = await dbGet('SELECT * FROM meals WHERE id = ?', [req.params.id]);
    if (!original) return res.status(404).json({ error: 'Meal not found' });
    const result = await dbRun(
      'INSERT INTO meals (food_item_id, food_name, protein_g, fat_g, carbs_g, calories, amount_g, meal_type, log_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [original.food_item_id, original.food_name, original.protein_g, original.fat_g, original.carbs_g, original.calories, original.amount_g, original.meal_type, original.log_date]
    );
    let id;
    if (db) id = result.lastInsertRowid;
    else id = result.last_insert_id || result.lastInsertRowid;
    const meal = await dbGet('SELECT * FROM meals WHERE id = ?', [id]);
    res.status(201).json(meal);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: Copy Meals (one day to another) ----
app.post('/api/meals/copy', async (req, res) => {
  try {
    const { from_date, to_date } = req.body;
    if (!from_date || !to_date) {
      return res.status(400).json({ error: 'from_date and to_date required' });
    }
    const sourceMeals = await dbAll('SELECT * FROM meals WHERE log_date = ?', [from_date]);
    if (sourceMeals.length === 0) {
      return res.status(404).json({ error: 'Keine Mahlzeiten am Quell-Datum gefunden' });
    }
    const copied = [];
    for (const m of sourceMeals) {
      const result = await dbRun(
        'INSERT INTO meals (food_item_id, food_name, protein_g, fat_g, carbs_g, calories, amount_g, meal_type, log_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [m.food_item_id, m.food_name, m.protein_g, m.fat_g, m.carbs_g, m.calories, m.amount_g, m.meal_type, to_date]
      );
      let id;
      if (db) id = result.lastInsertRowid;
      else id = result.last_insert_id || result.lastInsertRowid;
      const meal = await dbGet('SELECT * FROM meals WHERE id = ?', [id]);
      copied.push(meal);
    }
    res.status(201).json({ success: true, copied_count: copied.length, meals: copied });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: Export ----
app.get('/api/export', async (req, res) => {
  try {
    const format = req.query.format || 'json';
    const dateFrom = req.query.from || '2024-01-01';
    const dateTo = req.query.to || new Date().toISOString().split('T')[0];

    const rows = await dbAll(
      `SELECT m.log_date, m.meal_type, m.food_name, m.amount_g,
              m.protein_g, m.fat_g, m.carbs_g, m.calories,
              COALESCE(g.protein_g, 180) as goal_protein,
              COALESCE(g.fat_g, 70) as goal_fat,
              COALESCE(g.carbs_g, 250) as goal_carbs,
              COALESCE(g.calories, 2500) as goal_calories
       FROM meals m
       CROSS JOIN (SELECT protein_g, fat_g, carbs_g, calories FROM goals ORDER BY id DESC LIMIT 1) g
       WHERE m.log_date >= ? AND m.log_date <= ?
       ORDER BY m.log_date ASC, m.logged_at ASC`,
      [dateFrom, dateTo]
    );

    if (format === 'csv') {
      const header = 'Datum;Mahlzeit;Lebensmittel;Menge_g;Protein_g;Fett_g;Carbs_g;Kalorien;Ziel_Protein;Ziel_Fett;Ziel_Carbs;Ziel_Kalorien\n';
      const csv = header + rows.map(r =>
        `${r.log_date};${r.meal_type};${r.food_name};${r.amount_g};${r.protein_g};${r.fat_g};${r.carbs_g};${r.calories};${r.goal_protein};${r.goal_fat};${r.goal_carbs};${r.goal_calories}`
      ).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=macro-tracker-' + dateFrom + '-' + dateTo + '.csv');
      res.send('\uFEFF' + csv);
    } else {
      res.json({ from: dateFrom, to: dateTo, entries: rows, count: rows.length });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: Body Weight ----
app.get('/api/bodyweight', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const rows = await dbAll(
      'SELECT * FROM bodyweight_log ORDER BY log_date DESC LIMIT ?',
      [limit]
    );
    res.json(rows);
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/bodyweight', async (req, res) => {
  try {
    await dbRun(
      'CREATE TABLE IF NOT EXISTS bodyweight_log (id INTEGER PRIMARY KEY AUTOINCREMENT, weight_kg REAL NOT NULL, log_date TEXT NOT NULL DEFAULT (date(\'now\')), logged_at TEXT DEFAULT (datetime(\'now\')))'
    );
    await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_bodyweight_date ON bodyweight_log(log_date)');
    const existing = await dbGet('SELECT id FROM bodyweight_log WHERE log_date = ?', [req.body.log_date || new Date().toISOString().split('T')[0]]);
    let result;
    if (existing) {
      await dbRun('UPDATE bodyweight_log SET weight_kg = ? WHERE id = ?', [req.body.weight_kg, existing.id]);
      result = await dbGet('SELECT * FROM bodyweight_log WHERE id = ?', [existing.id]);
    } else {
      result = await dbRun(
        'INSERT INTO bodyweight_log (weight_kg, log_date) VALUES (?, ?)',
        [req.body.weight_kg, req.body.log_date || new Date().toISOString().split('T')[0]]
      );
      let id;
      if (db) id = result.lastInsertRowid;
      else id = result.last_insert_id || result.lastInsertRowid;
      result = await dbGet('SELECT * FROM bodyweight_log WHERE id = ?', [id]);
    }
    res.status(201).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/bodyweight/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM bodyweight_log WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: Import ----
app.post('/api/import', async (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Ung\u00fcltiges JSON-Objekt' });
    }

    const result = { imported: {} };

    // ---- Import Foods ----
    if (data.foods && Array.isArray(data.foods) && data.foods.length > 0) {
      let count = 0;
      for (const f of data.foods) {
        if (!f.name) continue;
        const existing = await dbGet('SELECT id FROM food_items WHERE name = ? AND brand = ?', [f.name, f.brand || '']);
        if (existing) {
          await dbRun(
            'UPDATE food_items SET protein_g=?, fat_g=?, carbs_g=?, calories=?, serving_size_g=?, category=? WHERE id=?',
            [f.protein_g||0, f.fat_g||0, f.carbs_g||0, f.calories||0, f.serving_size_g||100, f.category||'Sonstiges', existing.id]
          );
        } else {
          await dbRun(
            'INSERT INTO food_items (name, brand, protein_g, fat_g, carbs_g, calories, serving_size_g, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [f.name, f.brand||'', f.protein_g||0, f.fat_g||0, f.carbs_g||0, f.calories||0, f.serving_size_g||100, f.category||'Sonstiges']
          );
        }
        count++;
      }
      result.imported.foods = count;
    }

    // ---- Import Goals ----
    if (data.goals && typeof data.goals === 'object') {
      const g = data.goals;
      await dbRun(
        'INSERT INTO goals (protein_g, fat_g, carbs_g, calories, water_goal_ml) VALUES (?, ?, ?, ?, ?)',
        [g.protein_g||180, g.fat_g||70, g.carbs_g||250, g.calories||2500, g.water_goal_ml||3000]
      );
      result.imported.goals = true;
    }

    // ---- Import Bodyweight ----
    if (data.bodyweight && Array.isArray(data.bodyweight)) {
      await dbRun(
        'CREATE TABLE IF NOT EXISTS bodyweight_log (id INTEGER PRIMARY KEY AUTOINCREMENT, weight_kg REAL NOT NULL, log_date TEXT NOT NULL DEFAULT (date(\'now\')), logged_at TEXT DEFAULT (datetime(\'now\')))'
      );
      await dbRun('CREATE UNIQUE INDEX IF NOT EXISTS idx_bodyweight_date ON bodyweight_log(log_date)');

      let count = 0;
      for (const w of data.bodyweight) {
        if (!w.weight_kg || !w.log_date) continue;
        const existing = await dbGet('SELECT id FROM bodyweight_log WHERE log_date = ?', [w.log_date]);
        if (existing) {
          await dbRun('UPDATE bodyweight_log SET weight_kg=? WHERE id=?', [w.weight_kg, existing.id]);
        } else {
          await dbRun('INSERT INTO bodyweight_log (weight_kg, log_date) VALUES (?, ?)', [w.weight_kg, w.log_date]);
        }
        count++;
      }
      result.imported.bodyweight = count;
    }

    // ---- Import Meals ----
    // Accept either "meals" array or "entries" array (export format) or flat array
    let mealsData = null;
    if (data.meals && Array.isArray(data.meals) && data.meals.length > 0) {
      mealsData = data.meals;
    } else if (data.entries && Array.isArray(data.entries) && data.entries.length > 0) {
      mealsData = data.entries;
    }

    if (mealsData) {
      let count = 0;
      for (const m of mealsData) {
        if (!m.food_name) continue;
        const date = m.log_date || data.date || new Date().toISOString().split('T')[0];
        await dbRun(
          'INSERT INTO meals (food_item_id, food_name, protein_g, fat_g, carbs_g, calories, amount_g, meal_type, log_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [m.food_item_id || null, m.food_name, m.protein_g||0, m.fat_g||0, m.carbs_g||0, m.calories||0, m.amount_g||100, m.meal_type||'snack', date]
        );
        count++;
      }
      result.imported.meals = count;
    }

    // ---- Build summary response ----
    const totalImported = Object.values(result.imported).reduce((a, b) => a + (typeof b === 'number' ? b : (b ? 1 : 0)), 0);
    result.success = true;
    result.total_count = totalImported;
    result.message = totalImported > 0
      ? Object.entries(result.imported).filter(([_,v]) => v && v !== 0).map(([k,v]) => `${typeof v === 'number' ? v : '1'} ${k}`).join(', ') + ' importiert'
      : 'Keine Daten zum Importieren gefunden';

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Catch-all for frontend SPA
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---- Startup ----
async function start() {
  const usingrumahl = await initDatabase();
  console.log(`[MacroTracker] Running on port ${PORT}, rumahl mode: ${usingrumahl}`);
}

const server = app.listen(PORT, () => {
  console.log(`[MacroTracker] Server started on port ${PORT}`);
  start();
});

process.on('SIGTERM', () => {
  console.log('[MacroTracker] Shutting down...');
  if (db) db.close();
  server.close(() => process.exit(0));
});
