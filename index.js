// ІМПОРТИ ЗАЛЕЖНОСТЕЙ
import express from "express";
import http from "http";
import fs from "fs";
import path from "path";
import multer from "multer";
import swaggerUi from "swagger-ui-express";
import { fileURLToPath } from "url";
import { program } from "commander";

// Потрібно для коректних шляхів з ES модулями
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ====== COMMANDER — параметри командного рядка ======
program
  .requiredOption("-h, --host <host>", "Host of server")
  .requiredOption("-p, --port <port>", "Port of server")
  .requiredOption("-c, --cache <path>", "Cache directory");
program.parse(process.argv);

const options = program.opts();
const HOST = options.host;
const PORT = parseInt(options.port);
const CACHE_DIR = path.resolve(options.cache);

// ====== EXPRESS — створення сервера ======
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));



// Створення директорії кешу, якщо її немає
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// JSON-файл, де буде зберігатись інвентар
const DATA_FILE = path.join(CACHE_DIR, "inventory.json");
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
}

// MULTER — збереження фото
const upload = multer({ dest: CACHE_DIR });

// ====== Swagger ======
let swaggerDoc = {};
try {
  swaggerDoc = JSON.parse(fs.readFileSync(path.join(__dirname, "swagger.json")));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDoc));
} catch {
  console.log("⚠️ swagger.json не знайдено — /docs не працюватиме");
}

// ====== Допоміжні функції ======
function loadDB() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}
function saveDB(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ====== РОУТИ ======

/**
 * GET /RegisterForm.html
 * Віддає HTML форму для реєстрації пристрою.
 */
app.get("/RegisterForm.html", (req, res) => {
  res.sendFile(path.join(__dirname, "RegisterForm.html"));
});

/**
 * GET /SearchForm.html
 * Віддає HTML форму для пошуку пристрою в інвентарі.
 */
app.get("/SearchForm.html", (req, res) => {
  res.sendFile(path.join(__dirname, "SearchForm.html"));
});

/**
 * POST /register
 * Створення нового предмета в інвентарі.
 * Тіло: multipart/form-data (inventory_name, description?, photo?)
 * Відповідь: JSON створеного об’єкта.
 */
app.post("/register", upload.single("photo"), (req, res) => {
  const name = req.body.inventory_name;
  const description = req.body.description || "";

  if (!name) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).send("inventory_name is required");
  }

  const db = loadDB();
  const newItem = {
    id: Date.now().toString(),
    name,
    description,
    photo: req.file ? req.file.filename : null,
  };

  db.push(newItem);
  saveDB(db);

  res.status(201).json(newItem);
});

/**
 * GET /inventory
 * Отримати список усіх предметів у інвентарі.
 * Відповідь: масив JSON з photoUrl.
 */
app.get("/inventory", (req, res) => {
  const db = loadDB();
  const items = db.map((item) => ({
    ...item,
    photoUrl: item.photo
      ? `http://${HOST}:${PORT}/inventory/${item.id}/photo`
      : null,
  }));
  res.json(items);
});

/**
 * GET /inventory/:id
 * Отримати предмет за ID.
 * :id — обовʼязковий параметр шляху.
 */
app.get("/inventory/:id", (req, res) => {
  const db = loadDB();
  const item = db.find((x) => x.id === req.params.id);
  if (!item) return res.status(404).send("Not Found");

  res.json({
    ...item,
    photoUrl: item.photo
      ? `http://${HOST}:${PORT}/inventory/${item.id}/photo`
      : null,
  });
});

/**
 * PUT /inventory/:id
 * Оновити назву або опис предмета.
 * JSON body: { name?, description? }
 */
app.put("/inventory/:id", (req, res) => {
  const db = loadDB();
  const item = db.find((x) => x.id === req.params.id);
  if (!item) return res.status(404).send("Not Found");

  item.name = req.body.name ?? item.name;
  item.description = req.body.description ?? item.description;

  saveDB(db);
  res.json(item);
});

/**
 * GET /inventory/:id/photo
 * Отримати фото предмета.
 * Повертається файл зображення.
 */
app.get("/inventory/:id/photo", (req, res) => {
  const db = loadDB();
  const item = db.find((x) => x.id === req.params.id);
  if (!item || !item.photo) return res.status(404).send("Photo not found");

  const img = path.join(CACHE_DIR, item.photo);
  if (!fs.existsSync(img)) return res.status(404).send("File missing");

  res.set("Content-Type", "image/jpeg");
  res.sendFile(img);
});

/**
 * PUT /inventory/:id/photo
 * Оновити фото предмета.
 * Тіло: multipart/form-data з полем photo
 */
app.put("/inventory/:id/photo", upload.single("photo"), (req, res) => {
  const db = loadDB();
  const item = db.find((x) => x.id === req.params.id);
  if (!item) return res.status(404).send("Not Found");

  if (item.photo && fs.existsSync(path.join(CACHE_DIR, item.photo))) {
    fs.unlinkSync(path.join(CACHE_DIR, item.photo));
  }

  item.photo = req.file.filename;
  saveDB(db);

  res.send("Photo updated");
});

/**
 * DELETE /inventory/:id
 * Видалити предмет з інвентаря.
 * Якщо є фото — видаляється також файл.
 */
app.delete("/inventory/:id", (req, res) => {
  const db = loadDB();
  const idx = db.findIndex((x) => x.id === req.params.id);
  if (idx === -1) return res.status(404).send("Not Found");

  const removed = db[idx];

  try {
    if (removed.photo) {
      const imgPath = path.join(CACHE_DIR, removed.photo);
      if (fs.existsSync(imgPath)) {
        fs.unlinkSync(imgPath);
      }
    }
  } catch (err) {
    console.warn("⚠️ Failed to delete photo:", err.message);
  }

  db.splice(idx, 1);
  saveDB(db);

  res.status(200).send("Deleted");
});

/**
 * POST /search
 * Пошук предмета за ID через HTML форму (urlencoded)
 * Поля: id (обовʼязкове), has_photo (on — додати url фото)
 */
app.post("/search", (req, res) => {
  console.log("SEARCH BODY:", req.body);

  const db = loadDB();
  const item = db.find((x) => x.id === req.body.id);
  if (!item) return res.status(404).send("Not Found");

  const includePhoto = req.body.has_photo === "on";
  res.json({
    ...item,
    photoUrl:
      includePhoto && item.photo
        ? `http://${HOST}:${PORT}/inventory/${item.id}/photo`
        : undefined,
  });
});

// Невідомі методи → 405
app.use((req, res) => {
  res.status(405).send("Method Not Allowed");
});

// ====== HTTP SERVER ======
const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  console.log(`🚀 Server running: http://${HOST}:${PORT}`);
  console.log("📄 Register form: /RegisterForm.html");
  console.log("🔍 Search form: /SearchForm.html");
  console.log("📘 Swagger docs: /docs");
});
