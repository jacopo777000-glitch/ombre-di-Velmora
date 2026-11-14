import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const mime = {
  ".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",
  ".json":"application/json; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",
  ".webp":"image/webp",".svg":"image/svg+xml",".mp3":"audio/mpeg",".wav":"audio/wav",".ogg":"audio/ogg"
};
const server = http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + path.sep) && file !== path.join(root,"index.html")) {
      res.writeHead(403); res.end("Forbidden"); return;
    }
    const stat = await fs.stat(file);
    if (!stat.isFile()) { res.writeHead(404); res.end("Not found"); return; }
    const bytes = await fs.readFile(file);
    res.writeHead(200, {"Content-Type":mime[path.extname(file).toLowerCase()]||"application/octet-stream","Cache-Control":"no-store"});
    res.end(bytes);
  } catch {
    res.writeHead(404); res.end("Not found");
  }
});

await new Promise(resolve => server.listen(4173, "127.0.0.1", resolve));
const browser = await chromium.launch({headless:true});
const failures = [];
const page = await browser.newPage({viewport:{width:1280,height:900}});
page.on("pageerror", error => failures.push("pageerror: "+error.message));
page.on("console", msg => { if (msg.type()==="error") failures.push("console: "+msg.text()); });
page.on("requestfailed", req => {
  const error=req.failure()?.errorText||"unknown";
  // Chromium aborts the background music request when the test reloads the page.
  const expectedBackgroundSwap=req.url().includes("/assets/battle/")&&error==="net::ERR_ABORTED";
  if (!(req.resourceType()==="media" && error==="net::ERR_ABORTED")&&!expectedBackgroundSwap) {
    failures.push("request failed: "+req.url()+" — "+error);
  }
 });

try {
  await page.goto("http://127.0.0.1:4173/", {waitUntil:"domcontentloaded",timeout:30000});
  await page.locator("#heroName").waitFor({state:"visible",timeout:15000});
  const creatorClassChecks=await page.locator("[data-class]").evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.class,name:node.textContent.trim()})));
  const requiredCreatorClasses=["warrior","mage","archer","druid","darkknight","cleric","berserker","thief","assassin","paladin"];
  for(const id of requiredCreatorClasses)if(!creatorClassChecks.some(item=>item.id===id))throw new Error("classe non presente nel creatore: "+id);
  const newClassAbilities=await page.evaluate(()=>["Cavaliere oscuro","Berserker","Assassino"].map(name=>({name,count:classAbilities({class:name}).length,starter:classAbilities({class:name}).filter(a=>a.unlockLevel===1).length})));
  if(newClassAbilities.some(item=>item.count!==4||item.starter<2))throw new Error("abilità iniziali o progressione incompleta per le nuove classi: "+JSON.stringify(newClassAbilities));
  await page.locator('[data-class="darkknight"]').click();
  await page.locator('[data-class="berserker"]').click();
  await page.locator('[data-class="assassin"]').click();
  await page.locator('[data-class="warrior"]').click();
  console.log("PASS: creatore e abilità delle dieci classi giocabili",creatorClassChecks,newClassAbilities);
  await page.locator("#heroName").fill("Prova Browser Velmora");
  await page.getByRole("button",{name:/INIZIA IL VIAGGIO/i}).click();
  await page.locator("#game").waitFor({state:"visible",timeout:10000});

  const companionQuestChecks = await page.evaluate(() => {
    const original=G,originalSave=localStorage.getItem("velmoraDemoSave"),originalRandom=Math.random,results=[];
    const cases=[
      {id:"richiamo_branco",companion:"rauk",name:"Rauk",portrait:"uomo_lupo_m_base.png.JPG",choice:"reconcile",bond:2},
      {id:"promessa_cenere",companion:"leona",name:"Leona",portrait:"uomo_leone_f_base.png.JPG",choice:"return",bond:2}
    ];
    try{
      for(const item of cases){
        G=JSON.parse(JSON.stringify(original));G.battleWon=3;G.party=[];G.companions={wolf:false,lion:false};
        ensureSideQuestState();
        const quest=sideQuestCatalog.find(q=>q.id===item.id);
        if(sideQuestUnlocked(quest))throw new Error("missione personale sbloccata senza "+item.name);
        G.party.push(makeCompanion(item.name,40,7,4,4,item.portrait));
        G.companions[item.companion==="rauk"?"wolf":"lion"]=true;
        if(!sideQuestUnlocked(quest))throw new Error("missione personale non sbloccata con "+item.name);
        sideQuestAction(item.id,"accept");
        Math.random=()=>.99;
        sideQuestAction(item.id,quest.checkAction);
        if(G.sideQuests[item.id].stage!==2||G.sideQuests[item.id].lastRoll.actor!==item.name)throw new Error("prova personale non attribuita a "+item.name);
        sideQuestAction(item.id,item.choice);
        const state=G.sideQuests[item.id],saved=JSON.parse(localStorage.getItem("velmoraDemoSave")||"null");
        if(state.status!=="completed"||G.companionBonds[item.companion]!==item.bond||saved?.G?.companionBonds?.[item.companion]!==item.bond)throw new Error("esito o legame non persistito per "+item.name);
        results.push({quest:item.id,companion:item.name,actor:state.lastRoll.actor,bond:G.companionBonds[item.companion],outcome:state.outcome});
      }
    }finally{
      Math.random=originalRandom;G=original;
      if(originalSave===null)localStorage.removeItem("velmoraDemoSave");else localStorage.setItem("velmoraDemoSave",originalSave);
    }
    return results;
  });
  console.log("PASS: due missioni personali, requisiti compagno, prove del compagno e legami persistenti",companionQuestChecks);

  const sideQuestBranchChecks=await page.evaluate(()=>{
    const original=G,originalSave=localStorage.getItem("velmoraDemoSave"),originalRandom=Math.random,results=[];
    const cases=[
      {id:"lume_bruma",choices:["seal","take"]},
      {id:"morso_ponte",choices:["spare","slay"]},
      {id:"conto_mugnaio",choices:["forgive","expose"]},
      {id:"prezzo_nomi",choices:["deliver","burn"]},
      {id:"pozzo_vuoto",choices:["seal","collect"]}
    ];
    try{
      for(const item of cases)for(const choice of item.choices){
        G=JSON.parse(JSON.stringify(original));G.sideQuests={};G.battleWon=3;G.party=[];G.gold=0;G.sideQuestReputation=0;G.equipmentBag=[];
        ensureSideQuestState();
        const quest=sideQuestCatalog.find(q=>q.id===item.id);
        if(!quest||!sideQuestUnlocked(quest))throw new Error("missione non disponibile: "+item.id);
        sideQuestAction(item.id,"accept");
        Math.random=()=>.99;
        sideQuestAction(item.id,quest.checkAction);
        const active=G.sideQuests[item.id];
        if(active.stage!==2||!active.lastRoll)throw new Error("prova non completata: "+item.id);
        sideQuestAction(item.id,choice);
        const state=G.sideQuests[item.id];
        if(state.status!=="completed"||!state.outcome||!state.history.length||G.gold<=0)throw new Error("esito/ricompensa non assegnati: "+item.id+" "+choice);
        const factionSnapshot=JSON.parse(JSON.stringify(G.factionReputation||{}));
        if(!Object.values(factionSnapshot).some(value=>Number(value)!==0))throw new Error("la scelta non modifica la reputazione di alcuna fazione: "+item.id+" "+choice);
        if(JSON.stringify(saved?.G?.factionReputation)!==JSON.stringify(factionSnapshot))throw new Error("reputazione delle fazioni non persistita: "+item.id+" "+choice);
        results.push({quest:item.id,choice,outcome:state.outcome,gold:G.gold,reputation:G.sideQuestReputation,factions:factionSnapshot});
      }
    }finally{
      Math.random=originalRandom;G=original;
      if(originalSave===null)localStorage.removeItem("velmoraDemoSave");else localStorage.setItem("velmoraDemoSave",originalSave);
    }
    return results;
  });
  if(sideQuestBranchChecks.length!==10)throw new Error("rami missione secondaria non verificati: "+JSON.stringify(sideQuestBranchChecks));
  console.log("PASS: 10 finali alternativi delle cinque missioni principali e reputazione persistente delle fazioni",sideQuestBranchChecks);
  const factionUi=await page.evaluate(()=>{
    showMenu("factions");
    return {count:document.querySelectorAll("#menuContent .factionCard").length,labels:[...document.querySelectorAll("#menuContent .factionCard strong")].map(x=>x.textContent.trim())};
  });
  if(factionUi.count!==7)throw new Error("schermata fazioni incompleta: "+JSON.stringify(factionUi));
  console.log("PASS: schermata reputazione mostra tutte le sette fazioni",factionUi);

  async function checkBattle(n, expectedScene) {
    await page.evaluate(value => window.startBattle(value), n);
    await page.waitForFunction(scene => {
      const field=document.querySelector("#combat .battlefield");
      return field && field.style.backgroundImage.includes("assets/battle/") && field.dataset.backgroundScene===scene;
    }, expectedScene, {timeout:30000});
    const result=await page.locator("#combat .battlefield").evaluate(el=>({
      image:el.style.backgroundImage,
      source:el.dataset.backgroundSource,
      scene:el.dataset.backgroundScene,
      width:el.getBoundingClientRect().width
    }));
    if (!result.image.includes("assets/battle/") || !["Duskforge","Kalponic Studio","GegX"].includes(result.source) || result.scene!==expectedScene) {
      throw new Error("Sfondo painterly non applicato per battaglia "+n+": "+JSON.stringify(result));
    }
    const assetUrl=(result.image.match(/url\(["']?(.*?)["']?\)/)||[])[1];
    const response=assetUrl?await page.evaluate(async url=>{const r=await fetch(url,{cache:"no-store"});return {ok:r.ok,status:r.status}},assetUrl):{ok:false,status:0};
    if(!response.ok)throw new Error("Asset di battaglia non raggiungibile: "+assetUrl+" HTTP "+response.status);
    console.log("PASS: battaglia "+n+" usa uno sfondo "+result.source+" per la scena "+expectedScene+": "+assetUrl);
  }

  await checkBattle(1,"forest");
  await checkBattle(2,"crypt");
  await checkBattle(3,"boss");
  const prologueBackground=await page.evaluate(()=>{
    showScene("prologue");
    const panel=$("missionPanel");
    return {source:panel.dataset.sceneBackgroundSource||"",image:panel.style.getPropertyValue("--mission-scene-image"),hasTavern:(gegxBackgroundManifest?.images||[]).some(x=>(x.scenes||[]).includes("tavern"))};
  });
  if(prologueBackground.hasTavern&&prologueBackground.source!=="GegX")throw new Error("sfondo taverna GegX non collegato al prologo: "+JSON.stringify(prologueBackground));
  console.log("PASS: scena prologo mantiene uno sfondo illustrato e usa la taverna GegX quando presente",prologueBackground);



  // Load and exercise the real equipment overlays on both original human base models.
  await page.waitForFunction(() => Object.keys(equipmentManifest||{}).length===16, {timeout:15000});
  const equipmentChecks = await page.evaluate(async () => {
    const hero=G.hero;
    const backup={race:hero.race,gender:hero.gender,portrait:hero.portrait,equipment:JSON.parse(JSON.stringify(hero.equipment||{}))};
    const results=[];
    async function settleImages(root){
      const imgs=[...root.querySelectorAll("img")];
      await Promise.all(imgs.map(img=>img.decode().catch(()=>null)));
      return imgs;
    }
    for (const sample of [
      {gender:"M",portrait:"modello_umano_maschile.png.JPG.JPG"},
      {gender:"F",portrait:"modello_umano_femminile.png.JPG.JPG"}
    ]) {
      hero.race="Umano";hero.gender=sample.gender;hero.portrait=sample.portrait;
      hero.equipment={hair:"Capelli mossi",armor:"Armatura_guerriero",shouldersStyle:"Armatura_guerriero",armsStyle:"Armatura_guerriero",legsStyle:"Armatura_guerriero",bootsStyle:"Armatura_guerriero",head:"Elmo_drago",weapon:"Spada"};
      renderBattle();
      let art=document.querySelector('#partyList [data-unit-id="hero"] .unitArt');
      let imgs=await settleImages(art);
      const covered={
        armor:!!art.querySelector('[data-equipment-slot="armor"]'),
        shoulders:!!art.querySelector('[data-equipment-slot="shoulders"]'),
        arms:!!art.querySelector('[data-equipment-slot="arms"]'),
        legs:!!art.querySelector('[data-equipment-slot="legs"]'),
        boots:!!art.querySelector('[data-equipment-slot="boots"]'),
        head:!!art.querySelector('[data-equipment-slot="head"]'),
        hair:!!art.querySelector('[data-equipment-slot="hair"]'),
        loaded:imgs.every(img=>img.complete&&img.naturalWidth>0)
      };
      if(!covered.armor||!covered.shoulders||!covered.arms||!covered.legs||!covered.boots||!covered.head||covered.hair||!covered.loaded) throw new Error("componenti armatura/elmo non caricati sul modello "+sample.gender+": "+JSON.stringify(covered));
      hero.equipment.head="";
      renderBattle();
      art=document.querySelector('#partyList [data-unit-id="hero"] .unitArt');
      imgs=await settleImages(art);
      const uncovered={
        hair:!!art.querySelector('[data-equipment-slot="hair"]'),
        loaded:imgs.every(img=>img.complete&&img.naturalWidth>0)
      };
      if(!uncovered.hair||!uncovered.loaded) throw new Error("capelli non ripristinati o immagine non caricata sul modello "+sample.gender+": "+JSON.stringify(uncovered));
      hero.equipment.arms=false;
      renderBattle();
      const withoutArms=document.querySelector('#partyList [data-unit-id="hero"] .unitArt');
      if(withoutArms.querySelector('[data-equipment-slot="arms"]'))throw new Error("braccia non rimovibili separatamente sul modello "+sample.gender);
      hero.equipment.arms=true;
      renderBattle();
      results.push({gender:sample.gender,covered,uncovered,modularArms:true});
    }
    Object.assign(hero,backup);renderBattle();
    return results;
  });
  console.log("PASS: overlay armatura/elmo e ripristino capelli su modelli maschile e femminile",equipmentChecks);
  const modularUi = await page.evaluate(() => {
    const oldEquipment=JSON.parse(JSON.stringify(G.hero.equipment||{})),oldClass=G.hero.class;
    if(!G.hero.equipment)G.hero.equipment={};
    G.hero.class="Guerriero";G.hero.equipment.armor="Armatura_guerriero";
    selectedEquipmentMember="hero";openCharacterScreen();renderCharacterScreen();renderBattle();
    const screen=document.getElementById("characterScreen"),body=document.getElementById("characterScreenBody");
    const names=[...body.querySelectorAll("[data-armor-part]")].map(x=>x.dataset.armorPart).sort();
    if(names.join(",")!=="armor,arms,boots,legs,shoulders")throw new Error("tendine modulari non presenti: "+JSON.stringify({names,screenOpen:screen?.classList.contains("open"),bodyExists:!!body,bodyHtml:body?.innerHTML?.slice(0,900),hero:!!G.hero,party:G.party?.length,selectedEquipmentMember}));
    let art=document.querySelector('#partyList [data-unit-id="hero"] .unitArt');
    const torsoOnly=!!art.querySelector('[data-equipment-slot="armor"]')&&!art.querySelector('[data-equipment-slot="shoulders"],[data-equipment-slot="arms"],[data-equipment-slot="legs"],[data-equipment-slot="boots"]');
    if(!torsoOnly)throw new Error("selezionare il torso equipaggia ancora automaticamente altri pezzi");
    let control=document.querySelector('[data-armor-part="arms"]');
    control.value="Armatura_arciere";control.dispatchEvent(new Event("change",{bubbles:true}));
    let selected=document.querySelector('#partyList [data-unit-id="hero"] .unitArt [data-equipment-slot="arms"]');
    const changed=!!selected&&selected.getAttribute("src").includes("Armatura_arciere_arms_01.png");
    control=document.querySelector('[data-armor-part="arms"]');
    control.value="";control.dispatchEvent(new Event("change",{bubbles:true}));
    const hidden=!document.querySelector('#partyList [data-unit-id="hero"] .unitArt [data-equipment-slot="arms"]');
    control=document.querySelector('[data-armor-part="arms"]');
    control.value="Armatura_guerriero";control.dispatchEvent(new Event("change",{bubbles:true}));
    const restored=!!document.querySelector('#partyList [data-unit-id="hero"] .unitArt [data-equipment-slot="arms"]');
    closeCharacterScreen();G.hero.equipment=oldEquipment;G.hero.class=oldClass;renderBattle();
    if(!changed||!hidden||!restored)throw new Error("tendina non cambia, rimuove e ripristina la parte selezionata");
    return {parts:names,torsoOnly,changed,hidden,restored};
  });
  console.log("PASS: schermata equipaggiamento espone quattro controlli modulari",modularUi);
  const lootVisualChecks = await page.evaluate(async () => {
    const hero=G.hero,backup={race:hero.race,raceId:hero.raceId,gender:hero.gender,portrait:hero.portrait,equipment:JSON.parse(JSON.stringify(hero.equipment||{})),armor:hero.armor,baseArmor:hero.baseArmor};
    hero.race="Umano";hero.raceId="human";hero.gender="M";hero.portrait="modello_umano_maschile.png.JPG.JPG";
    const armorItems=[
      ["Armatura di Scaglie","assets/equip/modular/Armatura_guerriero_armor_01.png"],
      ["Corazza del Viandante","assets/equip/modular/Armatura_arciere_armor_01.png"],
      ["Veste Lunare","assets/equip/modular/Armatura_mago_armor_01.png"],
      ["Mantello del Bosco","assets/equip/modular/Armatura_druido_armor_01.png"]
    ];
    const headItems=[
      ["Cappuccio dell'Oracolo","assets/equip/Cappello_mago.png"],
      ["Elmo del Drago Antico","assets/equip/Elmo_drago.png"],
      ["Maschera del Predatore","assets/equip/Cappello_punk.png"]
    ];
    const checked=[];
    async function settle(art){await Promise.all([...art.querySelectorAll("img")].map(img=>img.decode().catch(()=>null)))}
    for(const [name,src] of armorItems){
      hero.equipment={armor:name,shouldersStyle:"Armatura_guerriero",armsStyle:"Armatura_guerriero",legsStyle:"Armatura_guerriero",bootsStyle:"Armatura_guerriero",head:"",hair:"",weapon:"Spada"};
      renderBattle();
      const art=document.querySelector('#partyList [data-unit-id="hero"] .unitArt');
      await settle(art);
      const layer=art.querySelector('[data-equipment-slot="armor"]');
      if(!layer||layer.getAttribute("src")!==src||!layer.complete||!layer.naturalWidth)throw new Error("armatura loot non visibile: "+name);
      checked.push({name,src});
    }
    for(const [name,src] of headItems){
      hero.equipment={armor:"Armatura_guerriero",shouldersStyle:"Armatura_guerriero",armsStyle:"Armatura_guerriero",legsStyle:"Armatura_guerriero",bootsStyle:"Armatura_guerriero",head:name,hair:"Capelli mossi",weapon:"Spada"};
      renderBattle();
      const art=document.querySelector('#partyList [data-unit-id="hero"] .unitArt');
      await settle(art);
      const layer=art.querySelector('[data-equipment-slot="head"]');
      if(!layer||layer.getAttribute("src")!==src||!layer.complete||!layer.naturalWidth||art.querySelector('[data-equipment-slot="hair"]'))throw new Error("copricapo loot non visibile o non nasconde capelli: "+name);
      checked.push({name,src});
    }
    selectedEquipmentMember="hero";
    hero.equipment={armor:"Armatura_guerriero",shouldersStyle:"Armatura_guerriero",armsStyle:"Armatura_guerriero",legsStyle:"Armatura_guerriero",bootsStyle:"Armatura_guerriero",head:"",hair:"",weapon:"Spada"};
    hero.baseArmor=1;hero.armor=1;hero.equipment.armorBonus=0;
    setEquipment("arms",false);const reduced=hero.armor;
    setEquipment("arms",true);const restored=hero.armor;
    if(!(reduced<restored)||Math.abs(restored-4)>0.001)throw new Error("difesa modulare accumulata o non ricalcolata: "+JSON.stringify({reduced,restored}));
    Object.assign(hero,backup);renderBattle();
    return {items:checked,reducedDefense:reduced,restoredDefense:restored};
  });
  console.log("PASS: grafica di sette oggetti loot e difesa modulare senza accumulo",lootVisualChecks);

  // Capture a 12-model visual diagnostic to inspect race/sex fit, not just numeric bounds.
  await page.evaluate(async () => {
    const hero=G.hero;
    const backup={race:hero.race,raceId:hero.raceId,gender:hero.gender,portrait:hero.portrait,equipment:JSON.parse(JSON.stringify(hero.equipment||{}))};
    const samples=[
      {raceId:"human",race:"Umano",gender:"M",portrait:"modello_umano_maschile.png.JPG.JPG",hair:"Capelli coda ciuffi",label:"UMANO M"},
      {raceId:"human",race:"Umano",gender:"F",portrait:"modello_umano_femminile.png.JPG.JPG",hair:"Capelli lunghi",label:"UMANO F"},
      {raceId:"elf",race:"Elfo",gender:"M",portrait:"elfo_m_base.png.JPG",hair:"Capelli rasati lato",label:"ELFO M"},
      {raceId:"elf",race:"Elfo",gender:"F",portrait:"elfo_f_base.png.JPG",hair:"Capelli trecce",label:"ELFO F"},
      {raceId:"orc",race:"Orco",gender:"M",portrait:"orco_m_base.png.JPG",hair:"Capelli rasta",label:"ORCO M"},
      {raceId:"orc",race:"Orco",gender:"F",portrait:"orco_f_base.png.JPG",hair:"Capelli spettinati",label:"ORCO F"},
      {raceId:"lion",race:"Leonide",gender:"M",portrait:"uomo_leone_m_base.png.JPG",label:"LEONIDE M"},
      {raceId:"lion",race:"Leonide",gender:"F",portrait:"uomo_leone_f_base.png.JPG",label:"LEONIDE F"},
      {raceId:"wolf",race:"Lupo",gender:"M",portrait:"uomo_lupo_m_base.png.JPG",label:"LUPO M"},
      {raceId:"wolf",race:"Lupo",gender:"F",portrait:"uomo_lupo_f_base.png.JPG",label:"LUPO F"},
      {raceId:"rabbit",race:"Coniglio",gender:"M",portrait:"uomo_coniglio_m_base.png.JPG",label:"CONIGLIO M"},
      {raceId:"rabbit",race:"Coniglio",gender:"F",portrait:"uomo_coniglio_f_base.png.JPG",label:"CONIGLIO F"}
    ];
    const panel=document.createElement("div");
    panel.id="__velmoraArmorPreview";
    panel.style.cssText="position:fixed;z-index:999999;left:12px;top:12px;display:grid;grid-template-columns:repeat(6,170px);gap:12px;padding:18px;background:#100e0c;border:2px solid #d6b16c;border-radius:12px;box-shadow:0 0 30px #000;color:#f0d49b;font:12px Georgia,serif";
    for(const sample of samples){
      hero.race=sample.race;hero.raceId=sample.raceId;hero.gender=sample.gender;hero.portrait=sample.portrait;
      const humanoid=["human","elf","orc"].includes(sample.raceId);
      hero.equipment={hair:humanoid?"Capelli mossi":"",armor:"Armatura_guerriero",shouldersStyle:"Armatura_guerriero",armsStyle:"Armatura_guerriero",legsStyle:"Armatura_guerriero",bootsStyle:"Armatura_guerriero",head:humanoid?"Elmo_drago":"",weapon:"Spada"};
      renderBattle();
      const source=document.querySelector('#partyList [data-unit-id="hero"] .unitArt');
      const clone=source.cloneNode(true);
      clone.style.cssText="width:170px;height:218px;aspect-ratio:912/1168;flex:none;background:#17120d;border:1px solid #96713b";
      const card=document.createElement("div");
      card.style.cssText="display:flex;flex-direction:column;gap:5px;align-items:center";
      const label=document.createElement("strong");label.textContent=sample.label;
      card.append(label,clone);panel.append(card);
    }
    document.body.append(panel);
    await Promise.all([...panel.querySelectorAll("img")].map(img=>img.decode().catch(()=>null)));
    window.__velmoraArmorPreviewBackup=backup;
  });
  const armorPreview=await page.locator("#__velmoraArmorPreview").screenshot({type:"jpeg",quality:76});
  console.log("VELMORA_ARMOR_PREVIEW_BASE64="+armorPreview.toString("base64"));
  await page.evaluate(() => {
    document.querySelector("#__velmoraArmorPreview")?.remove();
    const b=window.__velmoraArmorPreviewBackup;
    if(b){Object.assign(G.hero,b);delete window.__velmoraArmorPreviewBackup;renderBattle();}
  });

  // Capture a separate hair-fit contact sheet for the six humanoid model variants.
  await page.evaluate(async () => {
    const hero=G.hero;
    const backup={race:hero.race,raceId:hero.raceId,gender:hero.gender,portrait:hero.portrait,equipment:JSON.parse(JSON.stringify(hero.equipment||{}))};
    const samples=[
      {raceId:"human",race:"Umano",gender:"M",portrait:"modello_umano_maschile.png.JPG.JPG",hair:"Capelli coda ciuffi",label:"UMANO M"},
      {raceId:"human",race:"Umano",gender:"F",portrait:"modello_umano_femminile.png.JPG.JPG",hair:"Capelli lunghi",label:"UMANO F"},
      {raceId:"elf",race:"Elfo",gender:"M",portrait:"elfo_m_base.png.JPG",hair:"Capelli rasati lato",label:"ELFO M"},
      {raceId:"elf",race:"Elfo",gender:"F",portrait:"elfo_f_base.png.JPG",hair:"Capelli trecce",label:"ELFO F"},
      {raceId:"orc",race:"Orco",gender:"M",portrait:"orco_m_base.png.JPG",hair:"Capelli rasta",label:"ORCO M"},
      {raceId:"orc",race:"Orco",gender:"F",portrait:"orco_f_base.png.JPG",hair:"Capelli spettinati",label:"ORCO F"}
    ];
    const panel=document.createElement("div");
    panel.id="__velmoraHairPreview";
    panel.style.cssText="position:fixed;z-index:999999;left:12px;top:12px;display:grid;grid-template-columns:repeat(3,230px);gap:12px;padding:18px;background:#100e0c;border:2px solid #d6b16c;border-radius:12px;box-shadow:0 0 30px #000;color:#f0d49b;font:13px Georgia,serif";
    for(const sample of samples){
      hero.race=sample.race;hero.raceId=sample.raceId;hero.gender=sample.gender;hero.portrait=sample.portrait;
      hero.equipment={hair:sample.hair,head:"",armor:"",weapon:""};
      renderBattle();
      const source=document.querySelector('#partyList [data-unit-id="hero"] .unitArt');
      const clone=source.cloneNode(true);
      clone.querySelector(".weaponLayer")?.remove();
      clone.style.cssText="width:230px;height:294px;aspect-ratio:912/1168;flex:none;background:#17120d;border:1px solid #96713b";
      const card=document.createElement("div");
      card.style.cssText="display:flex;flex-direction:column;gap:5px;align-items:center";
      const label=document.createElement("strong");label.textContent=sample.label;
      card.append(label,clone);panel.append(card);
    }
    document.body.append(panel);
    await Promise.all([...panel.querySelectorAll("img")].map(img=>img.decode().catch(()=>null)));
    window.__velmoraHairPreviewBackup=backup;
  });
  const hairPreview=await page.locator("#__velmoraHairPreview").screenshot({type:"jpeg",quality:78});
  console.log("VELMORA_HAIR_PREVIEW_BASE64="+hairPreview.toString("base64"));
  await page.evaluate(() => {
    document.querySelector("#__velmoraHairPreview")?.remove();
    const b=window.__velmoraHairPreviewBackup;
    if(b){Object.assign(G.hero,b);delete window.__velmoraHairPreviewBackup;renderBattle();}
  });

  const allRaceEquipment = await page.evaluate(async () => {
    const hero=G.hero;
    const backup={race:hero.race,raceId:hero.raceId,gender:hero.gender,portrait:hero.portrait,equipment:JSON.parse(JSON.stringify(hero.equipment||{}))};
    const models=[
      ["human","Umano","modello_umano_maschile.png.JPG.JPG","modello_umano_femminile.png.JPG.JPG"],
      ["elf","Elfo","elfo_m_base.png.JPG","elfo_f_base.png.JPG"],
      ["orc","Orco","orco_m_base.png.JPG","orco_f_base.png.JPG"],
      ["lion","Leonide","uomo_leone_m_base.png.JPG","uomo_leone_f_base.png.JPG"],
      ["wolf","Lupo","uomo_lupo_m_base.png.JPG","uomo_lupo_f_base.png.JPG"],
      ["rabbit","Coniglio","uomo_coniglio_m_base.png.JPG","uomo_coniglio_f_base.png.JPG"]
    ];
    const results=[];
    async function settle(root){
      const imgs=[...root.querySelectorAll("img")];
      await Promise.all(imgs.map(img=>img.decode().catch(()=>null)));
      return imgs.every(img=>img.complete&&img.naturalWidth>0);
    }
    const armorOptions=["Armatura_guerriero","Armatura_arciere","Armatura_druido","Armatura_mago"];
    const headOptions=["Cappello_mago","Cappello_punk","Elmo_drago","Elmo_leone"];
    const hairOptions=["Capelli coda ciuffi","Capelli coda lunga","Capelli lunghi","Capelli mossi","Capelli rasati lato","Capelli rasta","Capelli spettinati","Capelli trecce"];
    let armorFits=0,armorPartFits=0,headFits=0,hairFits=0;
    for(const [raceId,race,male,female] of models){
      for(const [gender,portrait] of [["M",male],["F",female]]){
        hero.raceId=raceId;hero.race=race;hero.gender=gender;hero.portrait=portrait;
        const humanoid=["human","elf","orc"].includes(raceId);
        hero.equipment={hair:"Capelli mossi",armor:"Armatura_guerriero",shouldersStyle:"Armatura_guerriero",armsStyle:"Armatura_guerriero",legsStyle:"Armatura_guerriero",bootsStyle:"Armatura_guerriero",head:humanoid?"Elmo_drago":"",weapon:"Spada"};
        renderBattle();
        const art=document.querySelector('#partyList [data-unit-id="hero"] .unitArt');
        const loaded=await settle(art);
        const head=art.querySelector('[data-equipment-slot="head"]');
        const hair=art.querySelector('[data-equipment-slot="hair"]');
        const artRect=art.getBoundingClientRect();
        const armorLayers=[...art.querySelectorAll('[data-equipment-slot="armor"],[data-equipment-slot="shoulders"],[data-equipment-slot="arms"],[data-equipment-slot="legs"],[data-equipment-slot="boots"]')];
        const rects=armorLayers.map(el=>el.getBoundingClientRect());
        const union=rects.length?{left:Math.min(...rects.map(r=>r.left)),top:Math.min(...rects.map(r=>r.top)),right:Math.max(...rects.map(r=>r.right)),bottom:Math.max(...rects.map(r=>r.bottom))}:null;
        const geometry=union?{x:(union.left-artRect.left)/artRect.width,y:(union.top-artRect.top)/artRect.height,w:(union.right-union.left)/artRect.width,h:(union.bottom-union.top)/artRect.height}:null;
        const weapon=art.querySelector(".weaponLayer"),weaponRect=weapon&&weapon.getBoundingClientRect();
        const weaponGeometry=weaponRect?{x:(weaponRect.left-artRect.left)/artRect.width,y:(weaponRect.top-artRect.top)/artRect.height,w:weaponRect.width/artRect.width,h:weaponRect.height/artRect.height}:null;
        const clippedArmor=armorLayers.every(el=>getComputedStyle(el).clipPath.includes("polygon"));
        if(!loaded||!geometry||geometry.w<.40||geometry.w>.52||geometry.h<.68||geometry.h>.82||geometry.x<0||geometry.y<.14||geometry.y>.25||geometry.x+geometry.w>1||geometry.y+geometry.h>1||!weaponGeometry||weaponGeometry.x<0||weaponGeometry.y<0||weaponGeometry.x+weaponGeometry.w>1||weaponGeometry.y+weaponGeometry.h>1||getComputedStyle(weapon).zIndex!=="7"||!clippedArmor){
          throw new Error("armatura fuori geometria o asset non caricato su "+race+" "+gender+": "+JSON.stringify({loaded,geometry,weaponGeometry,clippedArmor}));
        }
        for(const armorName of armorOptions){
          hero.equipment.armor=armorName;
          for(const partSlot of ["armor","shoulders","arms","legs","boots"]){
            const raw=equipmentLayerData(hero,partSlot),parts=Array.isArray(raw)?raw:raw?[raw]:[];
            if(!parts.length)throw new Error("profilo armatura assente: "+race+" "+gender+" "+armorName+" "+partSlot);
            for(const d of parts){
              if(!d.modular||!String(d.src||"").includes("assets/equip/modular/")||d.w<=0||d.h<=0||d.x<0||d.y<0||d.x+d.w>1||d.y+d.h>1){
                throw new Error("profilo parte armatura non valido: "+race+" "+gender+" "+armorName+" "+partSlot+" "+JSON.stringify(d));
              }
              armorPartFits++;
            }
          }
          armorFits++;
        }
        if(humanoid){
          for(const headName of headOptions){
            hero.equipment.head=headName;
            const d=equipmentLayerData(hero,"head");
            if(!d||d.w<.14||d.w>.28||d.h<.10||d.h>.25||d.x<0||d.y<0||d.x+d.w>1||d.y+d.h>1){
              throw new Error("profilo copricapo non valido: "+race+" "+gender+" "+headName+" "+JSON.stringify(d));
            }
            headFits++;
          }
          hero.equipment.head="";
          for(const hairName of hairOptions){
            hero.equipment.hair=hairName;
            const d=equipmentHairData(hero);
            if(!d||d.x<0||d.y<0||d.w<=0||d.h<=0||d.x+d.w>1||d.y+d.h>1){
              throw new Error("profilo capelli non valido: "+race+" "+gender+" "+hairName+" "+JSON.stringify(d));
            }
            hairFits++;
          }
          hero.equipment.head="Elmo_drago";hero.equipment.hair="Capelli mossi";
          renderBattle();
          const coveredArt=document.querySelector('#partyList [data-unit-id="hero"] .unitArt');
          await settle(coveredArt);
          if(!coveredArt.querySelector('[data-equipment-slot="head"]')||coveredArt.querySelector('[data-equipment-slot="hair"]')){
            throw new Error("il copricapo non nasconde i capelli su "+race+" "+gender);
          }
          hero.equipment.head="";
          renderBattle();
          const bareArt=document.querySelector('#partyList [data-unit-id="hero"] .unitArt');
          await settle(bareArt);
          if(!bareArt.querySelector('[data-equipment-slot="hair"]'))throw new Error("capelli non ripristinati su "+race+" "+gender);
        }else if(head||hair||equipmentLayerData(hero,"head")||equipmentHairData(hero)){
          throw new Error("overlay umano presente su "+race+" "+gender);
        }
        const base=art.querySelector(".unitBase");
        if(!base.naturalWidth||Math.abs(base.naturalWidth/base.naturalHeight-(912/1168))>.01)throw new Error("proporzioni modello base inattese su "+race+" "+gender+": "+base.naturalWidth+"x"+base.naturalHeight);
        results.push({race,gender,geometry,weaponGeometry,head:!!head,hair:!!hair});
      }
    }
    if(armorFits!==48||armorPartFits!==432||headFits!==24||hairFits!==48)throw new Error("conteggio fit non completo: "+JSON.stringify({armorFits,armorPartFits,headFits,hairFits}));
    const transparencyChecks=[];
    for(const [name,entry] of Object.entries(equipmentManifest)){
      if(!entry||!["armor","headgear","hair"].includes(entry.group)||!entry.file)continue;
      const source=new Image();source.src=entry.file;await source.decode();
      const c=document.createElement("canvas");c.width=48;c.height=48;
      const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(source,0,0,48,48);
      const pixels=ctx.getImageData(0,0,48,48).data;let transparent=0,visible=0;
      for(let i=3;i<pixels.length;i+=4){if(pixels[i]<16)transparent++;if(pixels[i]>240)visible++;}
      const transparency=transparent/(48*48),visibility=visible/(48*48);
      if(transparency<.05||visibility<.06)throw new Error("ritaglio non sufficientemente trasparente o visibile per "+name+": "+JSON.stringify({transparency,visibility}));
      transparencyChecks.push({name,transparency:Number(transparency.toFixed(3)),visibility:Number(visibility.toFixed(3))});
    }
    if(transparencyChecks.length!==16)throw new Error("attesi 16 overlay equipaggiamento, controllati "+transparencyChecks.length);
    Object.assign(hero,backup);renderBattle();
    const modularFiles=[...new Set(Object.values(equipmentManifest).flatMap(entry=>Object.values(entry.parts||{}).flat().map(part=>part.file)))];
    const modularTransparencyChecks=[];
    for(const file of modularFiles){const source=new Image();source.src=file;await source.decode();const c=document.createElement("canvas");c.width=32;c.height=32;const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(source,0,0,32,32);const data=ctx.getImageData(0,0,32,32).data;let transparent=0,visible=0;for(let i=3;i<data.length;i+=4){if(data[i]<16)transparent++;if(data[i]>240)visible++;}if(!transparent||!visible)throw new Error("PNG modulare senza trasparenza o pixel visibili: "+file);modularTransparencyChecks.push(file);}
    if(modularTransparencyChecks.length!==36)throw new Error("attese 36 immagini modulari, controllate "+modularTransparencyChecks.length);
    return {models:results,transparentOverlays:transparencyChecks,modularParts:modularTransparencyChecks};
  });
  console.log("PASS: 432 parti modulari armatura, copricapi e capelli su tutti i 12 modelli originali; ritaglio trasparente",allRaceEquipment);

  const finisherMotionChecks = await page.evaluate(() => {
    const cases=[
      ["Guerriero","Spada","blade"],["Guerriero","Ascia","heavy"],["Guerriero","Martello","heavy"],
      ["Guerriero","Lancia","spear"],["Guerriero","Scudo","shield"],["Arciere","Arco","ranged"],
      ["Ladro","Pugnale","quick"],["Mago","Bastone","arcane"],["Druido","Bastone","nature"],
      ["Paladino","Spada","holy"],["Chierico","Martello","holy"]
    ];
    return cases.map(([klass,weapon,expected])=>({klass,weapon,expected,actual:finisherMotionFor({class:klass,equipment:{weapon}})}));
  });
  const badFinisherMotions=finisherMotionChecks.filter(x=>x.actual!==x.expected);
  if(badFinisherMotions.length)throw new Error("mossa colpo di grazia non coerente con classe/arma: "+JSON.stringify(badFinisherMotions));
  console.log("PASS: 11 profili di colpo di grazia distinti per classe e categoria d'arma",finisherMotionChecks);

  // Verify the finisher is composed as a real in-memory WebP/PNG frame sequence, then can be skipped safely.
  await page.evaluate(() => {
    window.__velmoraFinisherFrameCount=0;
    window.__velmoraFinisherTest = playFinisher(G.hero, battle.units[0]);
  });
  await page.locator(".finisherOverlay").waitFor({state:"visible",timeout:10000});
  await page.waitForFunction(() => window.__velmoraFinisherFrameCount===16, {timeout:20000});
  const frameSequence = await page.evaluate(() => ({
    count:window.__velmoraFinisherFrameCount,
    types:window.__velmoraFinisherFrameTypes||[]
  }));
  if(frameSequence.count!==16||frameSequence.types.length!==16||frameSequence.types.some(type=>!/^image\/(?:webp|png)$/i.test(type))){
    throw new Error("sequenza frame del colpo di grazia non valida: "+JSON.stringify(frameSequence));
  }
  await page.waitForFunction(() => !document.querySelector(".finisherOverlay"), {timeout:15000});
  const finisherFullRestored = await page.evaluate(() => ({
    hero:document.querySelector("#partyList .unitArt")?.style.visibility || "",
    enemy:document.querySelector("#enemyList .unitArt")?.style.visibility || ""
  }));
  if(finisherFullRestored.hero==="hidden"||finisherFullRestored.enemy==="hidden")throw new Error("la sequenza completa non ha ripristinato i personaggi");
  console.log("PASS: colpo di grazia composto e riprodotto come sequenza di 16 immagini",frameSequence);

  await page.evaluate(() => {
    window.__velmoraFinisherFrameCount=0;
    window.__velmoraFinisherTest=playFinisher(G.hero,battle.units[0]);
  });
  await page.locator(".finisherOverlay").waitFor({state:"visible",timeout:10000});
  await page.locator(".finisherOverlay").click({position:{x:12,y:12}});
  await page.waitForFunction(() => !document.querySelector(".finisherOverlay"), {timeout:10000});
  const finisherRestored = await page.evaluate(() => ({
    hero:document.querySelector("#partyList .unitArt")?.style.visibility || "",
    enemy:document.querySelector("#enemyList .unitArt")?.style.visibility || ""
  }));
  if(finisherRestored.hero==="hidden"||finisherRestored.enemy==="hidden")throw new Error("il salto del colpo di grazia non ha ripristinato i personaggi");
  await page.evaluate(() => window.__velmoraFinisherTest);
  console.log("PASS: colpo di grazia saltato e personaggi ripristinati");

  const navigationCheck=await page.evaluate(()=>{
    if(!battle||battle.ended)throw new Error("battaglia non attiva durante il test dei menu");
    const snapshot=()=>({round:battle.round,order:battle.order.map(unit=>String(unit.id)),current:current()?.id,target:selectedTarget,units:battle.units.map(unit=>({id:String(unit.id),hp:unit.hp,alive:unit.alive}))});
    const before=snapshot();
    openTab("inventory");openTab("squad");openTab("more");
    openAbilitiesScreen();closeAbilitiesScreen();
    openCharacterScreen();closeCharacterScreen();
    openTab("mission");
    return {before,after:snapshot()};
  });
  if(JSON.stringify(navigationCheck.before)!==JSON.stringify(navigationCheck.after))throw new Error("la navigazione nei menu ha alterato lo stato del combattimento: "+JSON.stringify(navigationCheck));
  console.log("PASS: navigazione inventario/squadra/abilità/personaggio senza reset del combattimento",navigationCheck);

  const proceduralLootCheck = await page.evaluate(() => {
    const originalRandom=Math.random,originalBag=G.equipmentBag;
    G.equipmentBag=[];
    try{
      Math.random=()=>0;
      const mageDrop=rollMissionLoot(false,[{class:"Mago",rarity:"Comune"}]);
      const paladinDrop=rollMissionLoot(true,[{class:"Paladino",rarity:"Epico"}]);
      return {mageDrop,paladinDrop};
    }finally{
      Math.random=originalRandom;
      G.equipmentBag=originalBag;
    }
  });
  if(!proceduralLootCheck.mageDrop?.classes?.includes("Mago")||proceduralLootCheck.mageDrop.rarity==="Epico"||!proceduralLootCheck.paladinDrop?.classes?.includes("Paladino")||!["Raro","Epico"].includes(proceduralLootCheck.paladinDrop.rarity)){
    throw new Error("bottino non coerente con classe/rarità dei nemici generati: "+JSON.stringify(proceduralLootCheck));
  }
  console.log("PASS: bottino dei nemici filtrato per classe e rarità",proceduralLootCheck);

  const rosterSnapshot = await page.evaluate(() => {
    ensureProceduralRoster();
    const snapshot=G.proceduralRoster.map(p=>({
      id:p.id,seed:p.seed,name:p.name,race:p.race,raceId:p.raceId,
      gender:p.gender,class:p.class,equipment:p.equipment,abilities:p.equippedAbilities
    }));
    if(snapshot.length!==6) throw new Error("attesi sei avventurieri persistenti nella Gilda");
    for(const p of G.proceduralRoster){
      const unlocked=new Set(unlockedAbilities(p).map(a=>a.id));
      if(!Array.isArray(p.equippedAbilities)||p.equippedAbilities.length!==2||p.equippedAbilities.some(id=>!unlocked.has(id)))throw new Error("abilità procedurali non disponibili per "+p.name);
      if(["Chierico","Druido","Paladino"].includes(p.class)&&!p.equippedAbilities.some(id=>id.endsWith("_heal")))throw new Error("cura iniziale assente per "+p.name);
    }
    const a=generateProceduralEnemies(2,7788),b=generateProceduralEnemies(2,7788);
    const key=items=>items.map(p=>({id:p.id,seed:p.seed,race:p.race,class:p.class,equipment:p.equipment,abilities:p.equippedAbilities}));
    if(JSON.stringify(key(a))!==JSON.stringify(key(b))) throw new Error("gli avversari con lo stesso seed non sono riproducibili");
    window.__velmoraRosterSnapshot=snapshot;
    return snapshot;
  });
  await page.evaluate(() => { window.alert=()=>{}; window.saveGame(); });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("velmoraDemoSave")||"null"));
  if (JSON.stringify(saved?.G?.proceduralRoster?.map(p=>({
    id:p.id,seed:p.seed,name:p.name,race:p.race,raceId:p.raceId,
    gender:p.gender,class:p.class,equipment:p.equipment,abilities:p.equippedAbilities
  }))) !== JSON.stringify(rosterSnapshot)) {
    throw new Error("il salvataggio non conserva l'identità dei compagni generati");
  }
  if (!saved?.battle?.backgroundSeed) throw new Error("backgroundSeed non presente nel salvataggio");
  const seed = saved.battle.backgroundSeed;
  if(!saved.battle || saved.battle.ended) throw new Error("il salvataggio non contiene un combattimento attivo");
  const expectedScene = Number(saved.battle.n)===1 ? "forest" : Number(saved.battle.n)===2 ? "crypt" : "boss";
  const backgroundBeforeReload=await page.evaluate(()=>({
    image:document.querySelector("#combat .battlefield")?.style.backgroundImage||"",
    scene:document.querySelector("#combat .battlefield")?.dataset.backgroundScene||""
  }));
  if(!backgroundBeforeReload.image.includes("assets/battle/") || backgroundBeforeReload.scene!==expectedScene) {
    throw new Error("lo sfondo prima del salvataggio non corrisponde allo scontro attivo: "+JSON.stringify({expectedScene,backgroundBeforeReload,battleN:saved.battle.n}));
  }

  await page.setViewportSize({width:390,height:844});
  const mobile = await page.evaluate(() => ({
    width:window.innerWidth,
    scrollWidth:document.documentElement.scrollWidth,
    battlefieldWidth:document.querySelector("#combat .battlefield")?.getBoundingClientRect().width||0
  }));
  if (mobile.scrollWidth > mobile.width + 2) throw new Error("overflow orizzontale su iPhone: "+JSON.stringify(mobile));
  if (mobile.battlefieldWidth < 250) throw new Error("area di battaglia troppo stretta su iPhone: "+JSON.stringify(mobile));
  console.log("PASS: layout mobile 390px senza overflow",mobile);

  await page.reload({waitUntil:"domcontentloaded",timeout:30000});
  await page.locator("#heroName").waitFor({state:"visible",timeout:15000}).catch(()=>{});
  await page.evaluate(() => { window.alert=()=>{}; window.loadGame(); });
  await page.waitForFunction(scene => {
    const field=document.querySelector("#combat .battlefield");
    return field && !document.querySelector("#combat").classList.contains("hidden") &&
      field.style.backgroundImage.includes("assets/battle/") && field.dataset.backgroundScene===scene;
  }, expectedScene, {timeout:30000});
  const backgroundAfterReload=await page.evaluate(()=>({
    image:document.querySelector("#combat .battlefield")?.style.backgroundImage||"",
    scene:document.querySelector("#combat .battlefield")?.dataset.backgroundScene||""
  }));
  if(backgroundAfterReload.image!==backgroundBeforeReload.image || backgroundAfterReload.scene!==expectedScene) {
    throw new Error("lo sfondo non è stato ripristinato dallo stesso seed dopo reload: "+JSON.stringify({before:backgroundBeforeReload,after:backgroundAfterReload,seed}));
  }
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("velmoraDemoSave")||"null"));
  if (restored?.battle?.backgroundSeed !== seed) throw new Error("backgroundSeed cambiato dopo reload/loadGame");
  const restoredRoster=await page.evaluate(()=>G.proceduralRoster.map(p=>({id:p.id,seed:p.seed,name:p.name,race:p.race,raceId:p.raceId,gender:p.gender,class:p.class,equipment:p.equipment,abilities:p.equippedAbilities})));
  if (JSON.stringify(restoredRoster)!==JSON.stringify(rosterSnapshot)) throw new Error("identità/equipaggiamento dei compagni generati non ripristinati");
  console.log("PASS: ricaricamento partita mantiene combattimento, sfondo e roster procedurale");

  if (failures.length) throw new Error(failures.join("\n"));
  console.log("Smoke test browser Velmora completato senza errori.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
