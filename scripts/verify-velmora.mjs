import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
let failures = 0;
const fail = (message) => { console.error("FAIL:", message); failures++; };
const pass = (message) => console.log("PASS:", message);

const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((match) => match[1])
  .filter((code) => code.trim());

if (!scripts.length) fail("index.html non contiene script inline da verificare.");
for (let i = 0; i < scripts.length; i++) {
  try {
    new Function(scripts[i]);
    pass("Sintassi JavaScript dello script inline " + (i + 1));
  } catch (error) {
    fail("Sintassi JavaScript: " + error.message);
  }
}

const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
  .map((match) => match[1]);
if (!styles.length) fail("index.html non contiene un blocco style.");
for (let i = 0; i < styles.length; i++) {
  const css = styles[i];
  const opens = (css.match(/{/g) || []).length;
  const closes = (css.match(/}/g) || []).length;
  if (opens !== closes) fail("CSS blocco " + (i + 1) + ": parentesi graffe non bilanciate (" + opens + "/" + closes + ").");
  else pass("Parentesi CSS bilanciate nel blocco " + (i + 1));
}

let manifest = {};
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, "assets/equip/manifest.json"), "utf8"));
  pass("Manifest equipaggiamento JSON valido (" + Object.keys(manifest).length + " voci)");
} catch (error) {
  fail("Manifest JSON non valido: " + error.message);
}

const referenced = new Set();
const addPath = (value) => {
  if (!value || /^(?:https?:|data:|blob:|javascript:|#)/i.test(value)) return;
  let candidate = value.trim().replace(/^\.\//, "").split(/[?#]/)[0];
  if (candidate.startsWith("/")) candidate = candidate.slice(1);
  if (!candidate || candidate.includes("$" + "{")) return;
  if (!/\.(?:png|jpe?g|webp|gif|svg|mp3|json|ogg|wav)(?:\.JPG){0,2}$/i.test(candidate)) return;
  referenced.add(candidate);
};

for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) addPath(match[1]);
for (const css of styles) for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/gi)) addPath(match[1]);
for (const code of scripts) {
  for (const match of code.matchAll(/["']([^"']+?\.(?:png|jpe?g|webp|gif|svg|mp3|json|ogg|wav)(?:\.JPG){0,2})["']/gi)) addPath(match[1]);
}
for (const entry of Object.values(manifest)) if (entry && entry.file) referenced.add(entry.file);

for (const file of [...referenced].sort()) {
  const full = path.resolve(root, file);
  if (!full.startsWith(root + path.sep) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    fail("Asset locale assente o path con maiuscole/minuscole errate: " + file);
  }
}
if (referenced.size) pass("Riferimenti locali verificati (" + referenced.size + " percorsi)");

for (const [key, entry] of Object.entries(manifest)) {
  if (!entry || !entry.file || !Number.isFinite(entry.width) || !Number.isFinite(entry.height)) {
    fail("Voce manifest incompleta: " + key);
  }
}

for (const name of ["modello_umano_maschile.png.JPG.JPG", "modello_umano_femminile.png.JPG.JPG", "dado_d20_velmora.PNG"]) {
  if (!fs.existsSync(path.join(root, name))) fail("Asset base obbligatorio assente: " + name);
}

for (const fn of ["function saveGame", "function loadGame", "function equipmentLayers", "function playFinisher", "function generateProceduralRoster"]) {
  if (!html.includes(fn)) fail("Funzione fondamentale non trovata: " + fn);
}

if (!html.includes("function equipmentLayerData") ||
    !html.includes('data-equipment-slot="armor"') ||
    !html.includes('data-equipment-slot="head"')) {
  fail("Render dei livelli di armatura e copricapo non collegato ai modelli.");
} else pass("Layer di armatura e copricapo presenti nel renderer dei personaggi");

if (!html.includes("armorData") || !html.includes("headData") ||
    !html.includes("if(v.armor&&v.armorData)") ||
    !html.includes("if(v.head&&v.headData)")) {
  fail("Il colpo di grazia non riproduce tutti i livelli equipaggiati.");
} else pass("Colpo di grazia: armatura e copricapo inclusi nella composizione 2D");

if (styles.some(css => css.includes("\\n.unitArt"))) {
  fail("CSS contiene un newline letterale escapato prima del selettore unitArt.");
} else pass("Selettore unitArt senza newline escapati anomali");
if (failures === 0) pass("Punti di aggancio salvataggio, equipaggiamento, colpi di grazia e generazione presenti");

if (failures) {
  console.error("\nVerifica terminata con " + failures + " errore/i.");
  process.exit(1);
}
console.log("\nVerifica Velmora completata senza errori.");
