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
for (const entry of Object.values(manifest)) {
  if (entry && entry.file) referenced.add(entry.file);
  for (const list of Object.values(entry?.parts || {})) for (const part of (list || [])) if (part && part.file) referenced.add(part.file);
}
const modularPartCount = Object.values(manifest).flatMap(entry => Object.values(entry?.parts || {}).flat()).length;
if (modularPartCount !== 36) fail("Attese 36 parti PNG modulari, trovate " + modularPartCount);
else pass("Parti armatura modulari nel manifest: " + modularPartCount);

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
    !html.includes("armorPartPolygons") || !html.includes("data-armor-part=") ||
    !html.includes("data-equipment-slot=") ||
    !html.includes('equipmentLayerMarkup(u,"armor"') ||
    !html.includes('equipmentLayerMarkup(u,"head"')) {
  fail("Render dei livelli di armatura e copricapo non collegato ai modelli.");
} else pass("Layer di armatura e copricapo presenti nel renderer dei personaggi");

if (!html.includes("armorParts") || !html.includes("headData") ||
    !html.includes("for(const part of (v.armorParts||[]))") ||
    !html.includes("if(v.head&&v.headData)")) {
  fail("Il colpo di grazia non riproduce tutti i livelli equipaggiati.");
} else pass("Colpo di grazia: armatura e copricapo inclusi nella composizione 2D");

try {
  const femaleStart = html.indexOf("function supportsHumanoidHairAndHeadgear(p){");
  const femaleEnd = html.indexOf("\nfunction equipmentRules", femaleStart);
  const layerStart = html.indexOf("function equipmentRaceId(u){");
  const layerEnd = html.indexOf("\nfunction unitHTML", layerStart);
  if (femaleStart < 0 || femaleEnd < 0 || layerStart < 0 || layerEnd < 0) throw new Error("renderer equipment o helper sesso non individuati");
  const helperCode = html.slice(femaleStart, femaleEnd);
  const layerCode = html.slice(layerStart, layerEnd);
  const weaponStart=html.indexOf("function weaponNameFor(u){");
  const weaponEnd=html.indexOf("\nconst finisherImageCache",weaponStart);
  if(weaponStart<0||weaponEnd<0)throw new Error("helper ancoraggio armi non individuati");
  const weaponCode=html.slice(weaponStart,weaponEnd);
  const makeRenderer = new Function("asset", "equipmentManifest", helperCode + ";" + layerCode + ";" + weaponCode + "; return {equipmentLayers,equipmentLayerData,equipmentHairData,weaponAnchorFor,weaponSvgFor};");
  const sample = {};
  for (const key of ["Armatura_arciere.JPG", "Armatura_druido.JPG", "Armatura_guerriero.JPG", "Armatura_mago.JPG", "Cappello_mago.JPG", "Cappello_punk.JPG", "Elmo_drago.JPG", "Capelli_mossi.jpg"]) {
    if(!manifest[key])throw new Error("voce manifest non trovata per "+key);
    sample[key] = manifest[key];
  }
  const renderer = makeRenderer(name => name, sample);
  const render = renderer.equipmentLayers;
  const equipped = render({portrait:"hero.png",name:"Prova",race:"Umano",gender:"M",equipment:{armor:"Armatura_guerriero",shouldersStyle:"Armatura_guerriero",armsStyle:"Armatura_guerriero",legsStyle:"Armatura_guerriero",bootsStyle:"Armatura_guerriero",head:"Elmo_drago",hair:"Capelli mossi",weapon:"Spada"}});
  for(const slot of ["armor","shoulders","arms","legs","boots"])if(!equipped.includes('data-equipment-slot="'+slot+'"'))throw new Error("parte modulare non renderizzata: "+slot);
  if (!equipped.includes('data-equipment-slot="head"') || equipped.includes('data-equipment-slot="hair"')) throw new Error("elmo non nasconde i capelli");
  const torsoOnly=render({portrait:"hero.png",name:"Prova",race:"Umano",gender:"M",equipment:{armor:"Armatura_guerriero",head:"",hair:"",weapon:"Spada"}});
  for(const slot of ["shoulders","arms","legs","boots"])if(torsoOnly.includes('data-equipment-slot="'+slot+'"'))throw new Error("il torso equipaggia automaticamente "+slot);
  const bareHead = render({portrait:"hero.png",name:"Prova",race:"Umano",gender:"M",equipment:{armor:"Armatura_guerriero",head:"",hair:"Capelli mossi",weapon:"Spada"}});
  if (!bareHead.includes('data-equipment-slot="hair"')) throw new Error("capelli non ripristinati rimuovendo l'elmo");
  const noArms=render({portrait:"hero.png",name:"Prova",race:"Umano",gender:"M",equipment:{armor:"Armatura_guerriero",shouldersStyle:"Armatura_guerriero",arms:false,legsStyle:"Armatura_guerriero",bootsStyle:"Armatura_guerriero",head:"",hair:"",weapon:"Spada"}});
  if(noArms.includes('data-equipment-slot="arms"'))throw new Error("braccia non rimovibili separatamente");
  if (!(equipped.indexOf('data-equipment-slot="legs"') < equipped.indexOf('data-equipment-slot="head"'))) throw new Error("ordine dei layer modulari non valido");
  const beast = render({portrait:"wolf.png",name:"Lupo",race:"Popolo Lupo",gender:"M",equipment:{armor:"Armatura_guerriero",head:"Elmo_drago",hair:"Capelli mossi",weapon:"Ascia"}});
  if (beast.includes('data-equipment-slot="head"') || beast.includes('data-equipment-slot="hair"')) throw new Error("overlay umano applicato a un modello bestiale");
  const models=[
    ["human","Umano"],["elf","Elfo"],["orc","Orco"],["lion","Leonide"],["wolf","Lupo"],["rabbit","Coniglio"]
  ];
  for(const [id,name] of models){
    for(const gender of ["M","F"]){
      const person={raceId:id,race:name,gender,equipment:{armor:"Armatura_guerriero",shouldersStyle:"Armatura_guerriero",armsStyle:"Armatura_guerriero",legsStyle:"Armatura_guerriero",bootsStyle:"Armatura_guerriero",head:["human","elf","orc"].includes(id)?"Elmo_drago":"",hair:"Capelli mossi",weapon:"Spada"}};
      for(const weaponName of ["Spada","Arco","Bastone","Lancia","Ascia","Martello","Pugnale","Scudo"]){
        const armed={...person,equipment:{...person.equipment,weapon:weaponName}};
        const weaponAnchor=renderer.weaponAnchorFor(armed),weaponSvg=renderer.weaponSvgFor(armed);
        if(!weaponAnchor||weaponAnchor.x<0||weaponAnchor.y<0||weaponAnchor.w<=0||weaponAnchor.h<=0||weaponAnchor.x+weaponAnchor.w>1||weaponAnchor.y+weaponAnchor.h>1||!weaponSvg.includes('style="left:'))throw new Error("ancoraggio "+weaponName+" fuori modello per "+name+" "+gender+": "+JSON.stringify(weaponAnchor));
      }
      for(const partSlot of ["armor","shoulders","arms","legs","boots"]){
        const raw=renderer.equipmentLayerData(person,partSlot),parts=Array.isArray(raw)?raw:raw?[raw]:[];
        if(!parts.length)throw new Error("parte armatura assente per "+name+" "+gender+" "+partSlot);
        for(const armor of parts){
          if(armor.modular?(!String(armor.src||"").includes("assets/equip/modular/")||armor.w<=0||armor.h<=0||armor.x<0||armor.y<0||armor.x+armor.w>1||armor.y+armor.h>1):(armor.w<.40||armor.w>.52||armor.h<.68||armor.h>.82||armor.x<0||armor.y<.14||armor.y>.30||armor.x+armor.w>1||armor.y+armor.h>1||!armor.clip||!Array.isArray(armor.points)||armor.points.length<4)){
            throw new Error("fit parte armatura fuori area per "+name+" "+gender+" "+partSlot+": "+JSON.stringify(armor));
          }
        }
      }
      if(["human","elf","orc"].includes(id)){
        const head=renderer.equipmentLayerData(person,"head"),hair=renderer.equipmentHairData({...person,equipment:{...person.equipment,head:""}});
        if(!head||head.w<.14||head.w>.28||!hair||hair.x<0||hair.y<0||hair.x+hair.w>1||hair.y+hair.h>1){
          throw new Error("fit capelli/copricapo non valido per "+name+" "+gender);
        }
      }else if(renderer.equipmentLayerData(person,"head")||renderer.equipmentHairData(person)){
        throw new Error("overlay testa umano applicato a "+name);
      }
    }
  }
  const lootArmorMap=[["Armatura di Scaglie","assets/equip/modular/Armatura_guerriero_armor_01.png"],["Corazza del Viandante","assets/equip/modular/Armatura_arciere_armor_01.png"],["Veste Lunare","assets/equip/modular/Armatura_mago_armor_01.png"],["Mantello del Bosco","assets/equip/modular/Armatura_druido_armor_01.png"]];
  for(const [name,src] of lootArmorMap){
    const layers=renderer.equipmentLayerData({race:"Umano",gender:"M",equipment:{armor:name}},"armor");
    if(!Array.isArray(layers)||!layers.length||layers[0].src!==src)throw new Error("armatura loot senza grafica: "+name);
  }
  const lootHeadMap=[["Cappuccio dell'Oracolo","assets/equip/Cappello_mago.png"],["Elmo del Drago Antico","assets/equip/Elmo_drago.png"],["Maschera del Predatore","assets/equip/Cappello_punk.png"]];
  for(const [name,src] of lootHeadMap){
    const head=renderer.equipmentLayerData({race:"Umano",gender:"M",equipment:{head:name}},"head");
    if(!head||head.src!==src)throw new Error("copricapo loot senza grafica: "+name);
  }
  pass("Oggetti loot: quattro armature e tre copricapi collegati alla grafica");
  const humanM=renderer.equipmentLayerData({race:"Umano",gender:"M",equipment:{armor:"Armatura_guerriero"}},"armor")[0];
  const humanF=renderer.equipmentLayerData({race:"Umano",gender:"F",equipment:{armor:"Armatura_guerriero"}},"armor")[0];
  if(humanM.y===humanF.y||humanM.h===humanF.h)throw new Error("fit maschile e femminile non differenziato");
  pass("Fit geometrico armature per 12 modelli; hair/headgear e impugnatura armi distinti per razza e sesso");
} catch (error) {
  fail("Test renderer equipaggiamento: " + error.message);
}

if (styles.some(css => css.includes("\\n.unitArt"))) {
  fail("CSS contiene un newline letterale escapato prima del selettore unitArt.");
} else pass("Selettore unitArt senza newline escapati anomali");

for (const questId of ['id:"prezzo_nomi"', 'id:"pozzo_vuoto"']) {
  if (!html.includes(questId)) fail("Missione secondaria mancante: " + questId);
}
for (const action of ['action==="deliver"', 'action==="burn"', 'action==="seal"', 'action==="collect"']) {
  if (!html.includes(action)) fail("Diramazione missione mancante: " + action);
}
if (html.includes('id:"prezzo_nomi"') && html.includes('id:"pozzo_vuoto"')) {
  pass("Due nuove missioni secondarie ramificate presenti");
}

if (!html.includes('"Lancia"') || !html.includes('name.includes("lancia")') ||
    !html.includes('name:"Lancia del Guardiano"')) {
  fail("Supporto della lancia incompleto tra generazione, grafica e bottino.");
} else pass("Lancia disponibile per classi compatibili, resa SVG e bottino");
if (failures === 0) pass("Punti di aggancio salvataggio, equipaggiamento, colpi di grazia e generazione presenti");

try {
  const compatStart = html.indexOf("function supportsHumanoidHairAndHeadgear(p){");
  const compatEnd = html.indexOf("\nfunction renderCharacterScreen", compatStart);
  if (compatStart < 0 || compatEnd < 0) throw new Error("helper di compatibilità razza non individuati");
  const compatCode = html.slice(compatStart, compatEnd);
  const compat = new Function("G", compatCode + ";return {supportsHumanoidHairAndHeadgear,isFemaleCharacter,equipmentRules};")({equipmentBag:[]});
  for (const race of ["Umano","Elfo","Orco"]) {
    if (!compat.supportsHumanoidHairAndHeadgear({race})) throw new Error(race + " deve supportare capelli e copricapi");
  }
  for (const race of ["Popolo Leone","Popolo Lupo","Popolo Coniglio"]) {
    if (compat.supportsHumanoidHairAndHeadgear({race})) throw new Error(race + " non deve ricevere overlay umani");
    if (compat.equipmentRules({race,class:"Guerriero"}).heads.length) throw new Error(race + " ha ricevuto un copricapo non compatibile");
  }
  if (!compat.isFemaleCharacter({gender:"female"}) || !compat.isFemaleCharacter({gender:"F"}) || compat.isFemaleCharacter({gender:"male"})) {
    throw new Error("riconoscimento sesso femminile non coerente tra eroe e personaggi procedurali");
  }
  pass("Compatibilità razza: capelli/copricapi limitati ai modelli adatti; sesso femminile riconosciuto");
} catch (error) {
  fail("Test compatibilità razza/equipaggiamento: " + error.message);
}

try {
  const procStart = html.indexOf("const proceduralPortraits={");
  const procEnd = html.indexOf("\nfunction generateProceduralRoster", procStart);
  if (procStart < 0 || procEnd < 0) throw new Error("motore procedurale non individuato");
  const procCode = "function seededRandom(seed){let state=(Number(seed)>>>0)||1;return function(){state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296}}function proceduralPick(list,rng){return list[Math.floor(rng()*list.length)]}" + html.slice(procStart, procEnd);
  const proc = new Function(procCode + ";return {seededRandom,makeProceduralPerson};")();
  let generated = 0;
  for (let seed = 1; seed <= 120; seed++) {
    const person = proc.makeProceduralPerson(proc.seededRandom(seed), 0, "ally", 1, seed);
    const beastfolk = ["lion","wolf","rabbit"].includes(person.raceId);
    if (beastfolk && (person.equipment.hair || person.equipment.head)) {
      throw new Error("personaggio " + seed + " (" + person.raceId + ") ha ricevuto capelli/copricapo umano");
    }
    if (!beastfolk && (!person.equipment.hair || !person.equipment.head)) {
      throw new Error("personaggio " + seed + " (" + person.raceId + ") non ha ricevuto una combinazione estetica umanoide");
    }
    if (!person.portrait || !person.equipment.weapon || !person.equipment.armor) {
      throw new Error("personaggio " + seed + " privo di ritratto/arma/armatura");
    }
    generated++;
  }
  pass("Test generazione procedurale: " + generated + " seed, equipaggiamento coerente con la razza");
} catch (error) {
  fail("Test generazione procedurale: " + error.message);
}

try {
  const saveStart = html.indexOf("function saveGame(){");
  const loadStart = html.indexOf("function loadGame(){", saveStart);
  const loadEnd = html.indexOf("\nfunction ", loadStart + 20);
  if (saveStart < 0 || loadStart < 0 || loadEnd < 0) throw new Error("funzioni save/load non individuate");
  const saveCode = html.slice(saveStart, loadStart);
  const loadCode = html.slice(loadStart, loadEnd);
  const hero = {id:"hero",name:"Prova"};
  const companion = {id:"ally-1",name:"Compagna"};
  const foe = {id:"foe-1",name:"Predone",alive:true,hp:10};
  const originalG = {hero,party:[companion],inventory:{Pozione:2},proceduralSeed:1234,proceduralRoster:[{id:"wanderer-1"}],activeGuildMission:{id:"test",step:4,seed:77}};
  const originalBattle = {n:1,backgroundSeed:98765,round:3,units:[foe],order:[hero,companion,foe],idx:1,log:["Prova"],ended:false};
  const store = {};
  const alerts = [];
  const elements = new Map();
  const fakeElement = () => ({classList:{add(){},remove(){}},innerHTML:"",textContent:""});
  const deps = {
    G:originalG,battle:originalBattle,localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=v},
    alert:m=>alerts.push(m),$:id=>{if(!elements.has(id))elements.set(id,fakeElement());return elements.get(id)},
    document:{body:{classList:{add(){},remove(){}}}},
    ensureSideQuestState(){},ensureProceduralRoster(){},renderBattle(){},advanceToPlayer(){},
    showScene(){},guildRouteEvent(){},updateHUD(){},openTab(){}
  };
  const factory = new Function("deps", `let G=deps.G,battle=deps.battle,busy=true;
    const localStorage=deps.localStorage,alert=deps.alert,$=deps.$,document=deps.document;
    const ensureSideQuestState=deps.ensureSideQuestState,ensureProceduralRoster=deps.ensureProceduralRoster;
    const renderBattle=deps.renderBattle,advanceToPlayer=deps.advanceToPlayer,showScene=deps.showScene;
    const guildRouteEvent=deps.guildRouteEvent,updateHUD=deps.updateHUD,openTab=deps.openTab;
    ${saveCode}
    ${loadCode}
    return {saveGame,loadGame,getState:()=>({G,battle,busy})};`);
  const writer=factory(deps);
  writer.saveGame();
  const saved=JSON.parse(store.velmoraDemoSave);
  if (saved.battle.order.join(",") !== "hero,ally-1,foe-1") throw new Error("ordine dei turni non serializzato come ID");
  const reader=factory({...deps,G:null,battle:null});
  reader.loadGame();
  const restored=reader.getState();
  if (restored.G.proceduralSeed !== 1234 || restored.G.activeGuildMission.step !== 4 ||
      restored.battle.order[0] !== restored.G.hero ||
      restored.battle.order[1] !== restored.G.party[0] ||
      restored.battle.order[2] !== restored.battle.units[0] || restored.battle.backgroundSeed !== 98765 ||
      restored.busy !== false) {
    throw new Error("salvataggio partita/missione/ordine turni non ripristinato correttamente");
  }
  pass("Test save/load: party, seed, missione attiva e ordine turni ripristinati");
} catch (error) {
  fail("Test persistenza save/load: " + error.message);
}

try {
  const hairStart = html.indexOf("function equipmentRaceId(u){");
  const hairHelpersEnd = html.indexOf("\nfunction equipmentLayerData", hairStart);
  const finisherStart = html.indexOf("function finisherHairSource(u){");
  const hairEnd = html.indexOf("\nasync function finisherVisual", finisherStart);
  if (hairStart < 0 || hairHelpersEnd < 0 || finisherStart < 0 || hairEnd < 0) throw new Error("helper capelli/colpo di grazia non individuati");
  const hairCode = html.slice(hairStart, hairHelpersEnd) + ";" + html.slice(finisherStart, hairEnd);
  const manifest = {
    "Capelli_mossi.jpg": {file:"assets/equip/Capelli_mossi.png",x:100,y:20,width:120,height:140,sourceWidth:912,sourceHeight:1000}
  };
  const makeHair = new Function("equipmentManifest","isFemaleCharacter",hairCode+";return finisherHairSource;");
  const isFemale = p => ["f","female"].includes(String(p.gender||"").toLowerCase());
  const hair = makeHair(manifest,isFemale);
  const female = hair({race:"Umano",gender:"female",equipment:{hair:"Capelli mossi",head:""}});
  const expectedY = 24/1000, expectedHeight = (140*1.08)/1000;
  if (!female || Math.abs(female.y-expectedY)>1e-9 || Math.abs(female.h-expectedHeight)>1e-9) {
    throw new Error("coordinate capelli femminili non usano sourceHeight o scala sesso corretti");
  }
  if (hair({race:"Umano",gender:"F",equipment:{hair:"Capelli mossi",head:"Elmo_drago"}})!==null) {
    throw new Error("i capelli non vengono esclusi quando è equipaggiato un copricapo");
  }
  if (hair({race:"Popolo Lupo",gender:"female",equipment:{hair:"Capelli mossi",head:""}})!==null) {
    throw new Error("overlay capelli umano applicato a una razza bestiale");
  }
  pass("Colpo di grazia: coordinate capelli coerenti con altezza sorgente, sesso, elmo e razza");
} catch (error) {
  fail("Test allineamento capelli nel colpo di grazia: " + error.message);
}

try {
  const battleManifestPath = path.join(root, "assets/battle/duskforge/manifest.json");
  const battleManifest = JSON.parse(fs.readFileSync(battleManifestPath, "utf8"));
  const usable = (battleManifest.sources || []).flatMap(source => source.images || [])
    .filter(item => item && item.file && !/preview_sheet/i.test(String(item.sourceFile || item.file)));
  if (usable.length !== 20) throw new Error("attesi 20 sfondi effettivi, trovati " + usable.length);
  for (const item of usable) {
    const full = path.resolve(root, item.file);
    if (!full.startsWith(root + path.sep) || !fs.existsSync(full)) throw new Error("sfondo mancante: " + item.file);
  }
  if (!html.includes("function applyDuskforgeBattleBackground") ||
      !html.includes("backgroundSeed:") ||
      !html.includes("fetch('./assets/battle/duskforge/manifest.json')")) {
    throw new Error("selezione e caricamento sfondi non collegati alle battaglie");
  }
  const credits=fs.readFileSync(path.join(root,"assets/battle/CREDITS.md"),"utf8");
  for(const term of ["Duskforge Studio","free for commercial use","no attribution required","raw files","doomguizz.itch.io/enchanted-forest-rpg-backgrounds","doomguizz.itch.io/dark-dungeon-rpg-backgrounds"]){
    if(!credits.toLowerCase().includes(term.toLowerCase()))throw new Error("credito/licenza ufficiale mancante: "+term);
  }
  pass("Sfondi Duskforge: 20 WebP ottimizzati, manifest, collegamento alle battaglie e licenza documentata");
} catch (error) {
  fail("Test sfondi Duskforge: " + error.message);
}

if (failures) {
  console.error("\nVerifica terminata con " + failures + " errore/i.");
  process.exit(1);
}
console.log("\nVerifica Velmora completata senza errori.");
