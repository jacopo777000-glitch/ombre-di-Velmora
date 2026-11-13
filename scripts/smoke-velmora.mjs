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
  if (!(req.resourceType()==="media" && error==="net::ERR_ABORTED")) {
    failures.push("request failed: "+req.url()+" — "+error);
  }
 });

try {
  await page.goto("http://127.0.0.1:4173/", {waitUntil:"domcontentloaded",timeout:30000});
  await page.locator("#heroName").waitFor({state:"visible",timeout:15000});
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

  async function checkBattle(n, expected) {
    await page.evaluate(value => window.startBattle(value), n);
    await page.waitForFunction((needle) => {
      const field=document.querySelector("#combat .battlefield");
      return field && field.style.backgroundImage.includes(needle);
    }, expected, {timeout:20000});
    const result=await page.locator("#combat .battlefield").evaluate(el=>({
      image:el.style.backgroundImage,
      source:el.dataset.backgroundSource,
      width:el.getBoundingClientRect().width
    }));
    if (!result.image.includes(expected) || result.source!=="Duskforge") {
      throw new Error("Sfondo non applicato per battaglia "+n+": "+JSON.stringify(result));
    }
    console.log("PASS: battaglia "+n+" usa "+result.image);
  }

  await checkBattle(1,"duskforge_forest_");
  await checkBattle(2,"duskforge_dungeon_");
  await checkBattle(3,"boss_room");

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
      hero.equipment={hair:"Capelli mossi",armor:"Armatura_guerriero",head:"Elmo_drago",weapon:"Spada"};
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
    const oldArmor=G.hero.equipment?.armor,oldArms=G.hero.equipment?.arms,oldClass=G.hero.class;
    if(!G.hero.equipment)G.hero.equipment={};
    G.hero.class="Guerriero";G.hero.equipment.armor="Armatura_guerriero";G.hero.equipment.arms=true;
    selectedEquipmentMember="hero";openCharacterScreen();
    const names=[...document.querySelectorAll("[data-armor-part]")].map(x=>x.dataset.armorPart).sort();
    if(names.join(",")!=="arms,boots,legs,shoulders")throw new Error("controlli modulari non presenti: "+names.join(","));
    document.querySelector('[data-armor-part="arms"]').click();
    const hidden=!document.querySelector('#partyList [data-unit-id="hero"] .unitArt [data-equipment-slot="arms"]');
    document.querySelector('[data-armor-part="arms"]').click();
    const restored=!!document.querySelector('#partyList [data-unit-id="hero"] .unitArt [data-equipment-slot="arms"]');
    closeCharacterScreen();
    G.hero.equipment.armor=oldArmor||"";G.hero.class=oldClass;
    if(oldArms===undefined)delete G.hero.equipment.arms;else G.hero.equipment.arms=oldArms;
    renderBattle();
    if(!hidden||!restored)throw new Error("toggle braccia non ha aggiornato la scena");
    return {parts:names,hidden,restored};
  });
  console.log("PASS: schermata equipaggiamento espone quattro controlli modulari",modularUi);

  // Capture a high-resolution visual diagnostic of the current armor fit on the two original human models.
  await page.evaluate(async () => {
    const hero=G.hero;
    const backup={race:hero.race,gender:hero.gender,portrait:hero.portrait,equipment:JSON.parse(JSON.stringify(hero.equipment||{}))};
    const samples=[
      {gender:"M",portrait:"modello_umano_maschile.png.JPG.JPG",label:"UOMO"},
      {gender:"F",portrait:"modello_umano_femminile.png.JPG.JPG",label:"DONNA"}
    ];
    const panel=document.createElement("div");
    panel.id="__velmoraArmorPreview";
    panel.style.cssText="position:fixed;z-index:999999;left:12px;top:12px;display:flex;gap:18px;padding:18px;background:#100e0c;border:2px solid #d6b16c;border-radius:12px;box-shadow:0 0 30px #000;color:#f0d49b;font:14px Georgia,serif";
    for(const sample of samples){
      hero.race="Umano";hero.raceId="human";hero.gender=sample.gender;hero.portrait=sample.portrait;
      hero.equipment={hair:"Capelli mossi",armor:"Armatura_guerriero",head:"Elmo_drago",weapon:"Spada"};
      renderBattle();
      const source=document.querySelector('#partyList [data-unit-id="hero"] .unitArt');
      const clone=source.cloneNode(true);
      clone.style.cssText="width:320px;height:410px;aspect-ratio:912/1168;flex:none;background:#17120d;border:1px solid #96713b";
      const card=document.createElement("div");
      card.style.cssText="display:flex;flex-direction:column;gap:8px;align-items:center";
      const label=document.createElement("strong");label.textContent=sample.label;card.append(label,clone);panel.append(card);
    }
    document.body.append(panel);
    await Promise.all([...panel.querySelectorAll("img")].map(img=>img.decode().catch(()=>null)));
    window.__velmoraArmorPreviewBackup=backup;
  });
  const armorPreview=await page.locator("#__velmoraArmorPreview").screenshot({type:"jpeg",quality:78});
  console.log("VELMORA_ARMOR_PREVIEW_BASE64="+armorPreview.toString("base64"));
  await page.evaluate(() => {
    document.querySelector("#__velmoraArmorPreview")?.remove();
    const b=window.__velmoraArmorPreviewBackup;
    if(b){Object.assign(G.hero,b);delete window.__velmoraArmorPreviewBackup;renderBattle();}
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
        hero.equipment={hair:"Capelli mossi",armor:"Armatura_guerriero",head:humanoid?"Elmo_drago":"",weapon:"Spada"};
        renderBattle();
        const art=document.querySelector('#partyList [data-unit-id="hero"] .unitArt');
        const loaded=await settle(art);
        const armor=art.querySelector('[data-equipment-slot="armor"]');
        const head=art.querySelector('[data-equipment-slot="head"]');
        const hair=art.querySelector('[data-equipment-slot="hair"]');
        const artRect=art.getBoundingClientRect(),armorRect=armor?.getBoundingClientRect();
        const geometry=armorRect?{
          x:(armorRect.left-artRect.left)/artRect.width,
          y:(armorRect.top-artRect.top)/artRect.height,
          w:armorRect.width/artRect.width,
          h:armorRect.height/artRect.height
        }:null;
        if(!loaded||!geometry||geometry.w<.40||geometry.w>.52||geometry.h<.68||geometry.h>.82||geometry.x<0||geometry.y<.14||geometry.y>.25||geometry.x+geometry.w>1||geometry.y+geometry.h>1){
          throw new Error("armatura fuori geometria o asset non caricato su "+race+" "+gender+": "+JSON.stringify({loaded,geometry}));
        }
        for(const armorName of armorOptions){
          hero.equipment.armor=armorName;
          for(const partSlot of ["armor","shoulders","arms","legs","boots"]){
            const raw=equipmentLayerData(hero,partSlot),parts=Array.isArray(raw)?raw:raw?[raw]:[];
            if(!parts.length)throw new Error("profilo armatura assente: "+race+" "+gender+" "+armorName+" "+partSlot);
            for(const d of parts){
              if(d.w<.40||d.w>.52||d.h<.68||d.h>.82||d.x<0||d.y<.14||d.y>.30||d.x+d.w>1||d.y+d.h>1||!d.clip||!d.points?.length){
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
        results.push({race,gender,geometry,head:!!head,hair:!!hair});
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
    return {models:results,transparentOverlays:transparencyChecks};
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

  const rosterSnapshot = await page.evaluate(() => {
    ensureProceduralRoster();
    const snapshot=G.proceduralRoster.map(p=>({
      id:p.id,seed:p.seed,name:p.name,race:p.race,raceId:p.raceId,
      gender:p.gender,class:p.class,equipment:p.equipment
    }));
    if(snapshot.length!==6) throw new Error("attesi sei avventurieri persistenti nella Gilda");
    const a=generateProceduralEnemies(2,7788),b=generateProceduralEnemies(2,7788);
    const key=items=>items.map(p=>({id:p.id,seed:p.seed,race:p.race,class:p.class,equipment:p.equipment}));
    if(JSON.stringify(key(a))!==JSON.stringify(key(b))) throw new Error("gli avversari con lo stesso seed non sono riproducibili");
    window.__velmoraRosterSnapshot=snapshot;
    return snapshot;
  });
  await page.evaluate(() => { window.alert=()=>{}; window.saveGame(); });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("velmoraDemoSave")||"null"));
  if (JSON.stringify(saved?.G?.proceduralRoster?.map(p=>({
    id:p.id,seed:p.seed,name:p.name,race:p.race,raceId:p.raceId,
    gender:p.gender,class:p.class,equipment:p.equipment
  }))) !== JSON.stringify(rosterSnapshot)) {
    throw new Error("il salvataggio non conserva l'identità dei compagni generati");
  }
  if (!saved?.battle?.backgroundSeed) throw new Error("backgroundSeed non presente nel salvataggio");
  const seed = saved.battle.backgroundSeed;

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
  await page.waitForFunction(() => {
    const field=document.querySelector("#combat .battlefield");
    return field && !document.querySelector("#combat").classList.contains("hidden") &&
      field.style.backgroundImage.includes("duskforge_dungeon_");
  }, {timeout:20000});
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("velmoraDemoSave")||"null"));
  if (restored?.battle?.backgroundSeed !== seed) throw new Error("backgroundSeed cambiato dopo reload/loadGame");
  const restoredRoster=await page.evaluate(()=>G.proceduralRoster.map(p=>({id:p.id,seed:p.seed,name:p.name,race:p.race,raceId:p.raceId,gender:p.gender,class:p.class,equipment:p.equipment})));
  if (JSON.stringify(restoredRoster)!==JSON.stringify(rosterSnapshot)) throw new Error("identità/equipaggiamento dei compagni generati non ripristinati");
  console.log("PASS: ricaricamento partita mantiene combattimento, sfondo e roster procedurale");

  if (failures.length) throw new Error(failures.join("\n"));
  console.log("Smoke test browser Velmora completato senza errori.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
