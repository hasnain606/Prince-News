require("dotenv").config();

const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error("Set SESSION_SECRET to a random secret of at least 32 characters in production.");
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");
const db = new Database(path.join(DATA_DIR, "prince-news.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'World',
  language TEXT NOT NULL DEFAULT 'en',
  image_url TEXT NOT NULL DEFAULT '',
  source_name TEXT NOT NULL DEFAULT 'Prince News',
  source_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),
  is_imported INTEGER NOT NULL DEFAULT 0,
  external_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_articles_status_date ON articles(status, published_at DESC);
`);

const username = (process.env.ADMIN_USERNAME || "admin").trim();
const password = process.env.ADMIN_PASSWORD || "";
if (!db.prepare("SELECT id FROM users WHERE username = ?").get(username)) {
  if (password.length < 12) {
    console.warn("ADMIN_PASSWORD is not set or is too short. Admin account was NOT created. Set a password of 12+ characters and restart.");
  } else {
    const hash = bcrypt.hashSync(password, 12);
    db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run(username, hash);
    console.log(`Created initial admin account for username "${username}".`);
  }
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.NODE_ENV === "production" ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "https:", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null
    }
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.db", dir: DATA_DIR }),
  name: "prince.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));
app.use(express.static(path.join(ROOT, "public")));
app.use("/uploads", express.static(UPLOAD_DIR, { fallthrough: false, maxAge: "1d" }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many login attempts. Try again in 15 minutes." } });
const uploadLimitMB = Math.max(1, Math.min(10, Number(process.env.MAX_UPLOAD_MB || 5)));
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: uploadLimitMB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPG, PNG, WEBP or GIF images are allowed."), ok);
  }
});

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: "Please log in as an admin." });
  next();
}
function cleanText(value, max = 10000) {
  return String(value ?? "").trim().slice(0, max);
}
function validHttpUrl(value) {
  if (!value) return true;
  // Permit only app-local upload paths or absolute HTTP(S) URLs.
  if (value.startsWith("/uploads/") && !value.includes("..")) return true;
  try { const u = new URL(value); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
}
function publicArticle(row) {
  if (!row) return row;
  return { ...row, is_imported: Boolean(row.is_imported) };
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "Prince News" }));
app.get("/api/session", (req, res) => res.json({ authenticated: Boolean(req.session.userId), username: req.session.username || null }));

app.post("/api/admin/login", loginLimiter, (req, res, next) => {
  const user = cleanText(req.body.username, 100);
  const pass = String(req.body.password || "");
  const record = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(user);
  if (!record || !bcrypt.compareSync(pass, record.password_hash)) return res.status(401).json({ error: "Incorrect username or password." });
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.userId = record.id;
    req.session.username = record.username;
    req.session.save(saveErr => saveErr ? next(saveErr) : res.json({ ok: true, username: record.username }));
  });
});
app.post("/api/admin/logout", requireAdmin, (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("prince.sid", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    res.json({ ok: true });
  });
});

app.get("/api/articles", (req, res) => {
  const category = cleanText(req.query.category, 40);
  const search = cleanText(req.query.q, 120);
  const lang = cleanText(req.query.lang, 10);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));
  const conditions = ["status = 'published'"];
  const args = [];
  if (category && category !== "All") { conditions.push("category = ?"); args.push(category); }
  if (lang) { conditions.push("language = ?"); args.push(lang); }
  if (search) {
    conditions.push("(title LIKE ? OR summary LIKE ? OR body LIKE ?)");
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  args.push(limit);
  const rows = db.prepare(`SELECT id,title,summary,body,category,language,image_url,source_name,source_url,is_imported,created_at,published_at FROM articles WHERE ${conditions.join(" AND ")} ORDER BY COALESCE(published_at, created_at) DESC LIMIT ?`).all(...args);
  res.json(rows.map(publicArticle));
});

app.get("/api/admin/articles", requireAdmin, (_req, res) => {
  const rows = db.prepare("SELECT * FROM articles ORDER BY created_at DESC LIMIT 300").all();
  res.json(rows.map(publicArticle));
});

app.post("/api/admin/upload", requireAdmin, (req, res, next) => {
  upload.single("image")(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed." });
    if (!req.file) return res.status(400).json({ error: "Choose an image first." });
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

app.post("/api/admin/articles", requireAdmin, (req, res) => {
  const title = cleanText(req.body.title, 240);
  const summary = cleanText(req.body.summary, 1200);
  const body = cleanText(req.body.body, 30000);
  const category = cleanText(req.body.category, 40) || "World";
  const language = cleanText(req.body.language, 12) || "en";
  const image_url = cleanText(req.body.image_url, 1000);
  const source_name = cleanText(req.body.source_name, 160) || "Prince News";
  const source_url = cleanText(req.body.source_url, 1000);
  const status = req.body.status === "published" ? "published" : "draft";
  if (!title) return res.status(400).json({ error: "Headline is required." });
  if (!validHttpUrl(image_url) || !validHttpUrl(source_url)) return res.status(400).json({ error: "Image and source links must use http or https." });
  const now = new Date().toISOString();
  const result = db.prepare(`INSERT INTO articles (title,summary,body,category,language,image_url,source_name,source_url,status,published_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(title, summary, body, category, language, image_url, source_name, source_url, status, status === "published" ? now : null);
  res.status(201).json({ ok: true, id: result.lastInsertRowid });
});

app.put("/api/admin/articles/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const old = db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
  if (!old) return res.status(404).json({ error: "Article not found." });
  const title = cleanText(req.body.title, 240);
  if (!title) return res.status(400).json({ error: "Headline is required." });
  const status = req.body.status === "published" ? "published" : "draft";
  const values = {
    title, summary: cleanText(req.body.summary, 1200), body: cleanText(req.body.body, 30000),
    category: cleanText(req.body.category, 40) || "World", language: cleanText(req.body.language, 12) || "en",
    image_url: cleanText(req.body.image_url, 1000), source_name: cleanText(req.body.source_name, 160) || "Prince News",
    source_url: cleanText(req.body.source_url, 1000), status,
    published_at: status === "published" ? (old.published_at || new Date().toISOString()) : null
  };
  if (!validHttpUrl(values.image_url) || !validHttpUrl(values.source_url)) return res.status(400).json({ error: "Image and source links must use http or https." });
  db.prepare(`UPDATE articles SET title=@title,summary=@summary,body=@body,category=@category,language=@language,image_url=@image_url,source_name=@source_name,source_url=@source_url,status=@status,published_at=@published_at WHERE id=@id`).run({ ...values, id });
  res.json({ ok: true });
});

app.delete("/api/admin/articles/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare("DELETE FROM articles WHERE id = ?").run(id);
  if (!result.changes) return res.status(404).json({ error: "Article not found." });
  res.json({ ok: true });
});

const gnewsLangs = new Set(["ar","bn","de","el","en","es","fr","he","hi","id","it","ja","ko","ml","mr","nl","no","pa","pt","ro","ru","sv","ta","te","th","tr","uk","ur","vi","zh"]);
const countryCodes = new Set(["au","bd","br","ca","cn","eg","fr","de","gr","hk","in","ie","il","it","jp","nl","no","pk","pe","ph","pl","pt","ro","ru","sg","za","kr","se","ch","tw","tr","ua","gb","us"]);

async function translateText(text, targetLang) {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!key || !text || targetLang === "en") return text;
  const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: text, target: targetLang, format: "text" })
  });
  if (!response.ok) throw new Error(`Translation service returned ${response.status}`);
  const data = await response.json();
  return data?.data?.translations?.[0]?.translatedText || text;
}

async function importGNews({ query = "world", country = process.env.NEWS_COUNTRY || "pk", language = process.env.NEWS_LANGUAGE || "en" } = {}) {
  const key = process.env.GNEWS_API_KEY;
  if (!key) throw new Error("Automatic news import is not configured. Add GNEWS_API_KEY to .env.");
  const safeCountry = countryCodes.has(country) ? country : "pk";
  const safeLanguage = gnewsLangs.has(language) ? language : "en";
  const url = new URL("https://gnews.io/api/v4/top-headlines");
  url.searchParams.set("token", key);
  url.searchParams.set("country", safeCountry);
  url.searchParams.set("lang", safeLanguage);
  url.searchParams.set("max", "10");
  if (query && query !== "top") url.searchParams.set("q", query.slice(0, 80));
  const response = await fetch(url, { headers: { "User-Agent": "PrinceNews/1.0" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.errors?.join(", ") || `GNews returned ${response.status}`);
  const articles = Array.isArray(data.articles) ? data.articles : [];
  const insert = db.prepare(`INSERT OR IGNORE INTO articles
    (title,summary,body,category,language,image_url,source_name,source_url,status,is_imported,external_id,published_at)
    VALUES (@title,@summary,@body,@category,@language,@image_url,@source_name,@source_url,'published',1,@external_id,@published_at)`);
  let added = 0;
  for (const item of articles) {
    const sourceUrl = item.url || "";
    if (!item.title || !sourceUrl || !validHttpUrl(sourceUrl)) continue;
    const external_id = crypto.createHash("sha256").update(sourceUrl).digest("hex");
    const result = insert.run({
      title: cleanText(item.title, 240),
      summary: cleanText(item.description || "", 1200),
      body: cleanText(item.content || item.description || "", 30000),
      category: query && query !== "top" ? "World" : "World",
      language: safeLanguage,
      image_url: validHttpUrl(item.image || "") ? (item.image || "") : "",
      source_name: cleanText(item.source?.name || "External source", 160),
      source_url: sourceUrl,
      external_id,
      published_at: item.publishedAt || new Date().toISOString()
    });
    added += result.changes;
  }
  return { fetched: articles.length, added };
}

app.post("/api/admin/import", requireAdmin, async (req, res) => {
  try {
    const query = cleanText(req.body.query || "top", 80);
    const country = cleanText(req.body.country || process.env.NEWS_COUNTRY || "pk", 2).toLowerCase();
    const language = cleanText(req.body.language || process.env.NEWS_LANGUAGE || "en", 2).toLowerCase();
    const result = await importGNews({ query, country, language });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message || "News import failed." });
  }
});

app.post("/api/admin/translate", requireAdmin, async (req, res) => {
  const target = cleanText(req.body.target, 10).toLowerCase();
  const text = cleanText(req.body.text, 4000);
  if (!/^[a-z-]{2,10}$/.test(target)) return res.status(400).json({ error: "Invalid target language." });
  try {
    res.json({ translated: await translateText(text, target), configured: Boolean(process.env.GOOGLE_TRANSLATE_API_KEY) });
  } catch (error) {
    res.status(502).json({ error: error.message || "Translation failed." });
  }
});

// Best-effort scheduled import. GNews free-plan quotas and deployment sleep policies may affect this.
const intervalMinutes = Math.max(15, Math.min(1440, Number(process.env.AUTO_IMPORT_MINUTES || 30)));
if (process.env.GNEWS_API_KEY) {
  setInterval(() => {
    importGNews().then(r => console.log("Scheduled GNews import:", r)).catch(e => console.error("Scheduled import:", e.message));
  }, intervalMinutes * 60 * 1000).unref();
}

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ error: process.env.NODE_ENV === "production" ? "Server error." : (err.message || "Server error.") });
});

app.listen(PORT, () => {
  console.log(`Prince News is running at ${process.env.BASE_URL || `http://localhost:${PORT}`}`);
});
