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
page.on("requestfailed", req => failures.push("request failed: "+req.url()+" — "+(req.failure()?.errorText||"unknown")));

try {
  await page.goto("http://127.0.0.1:4173/", {waitUntil:"domcontentloaded",timeout:30000});
  await page.locator("#heroName").waitFor({state:"visible",timeout:15000});
  await page.locator("#heroName").fill("Prova Browser Velmora");
  await page.getByRole("button",{name:/INIZIA IL VIAGGIO/i}).click();
  await page.locator("#game").waitFor({state:"visible",timeout:10000});

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

  // Verify the real canvas finisher can be skipped and always restores the battle art.
  await page.evaluate(() => {
    window.__velmoraFinisherTest = playFinisher(G.hero, battle.units[0]);
  });
  await page.locator(".finisherOverlay").waitFor({state:"visible",timeout:10000});
  await page.locator(".finisherOverlay").click({position:{x:12,y:12}});
  await page.waitForFunction(() => !document.querySelector(".finisherOverlay"), {timeout:10000});
  const finisherRestored = await page.evaluate(() => ({
    hero:document.querySelector("#partyList .unitArt")?.style.visibility || "",
    enemy:document.querySelector("#enemyList .unitArt")?.style.visibility || ""
  }));
  if (finisherRestored.hero==="hidden" || finisherRestored.enemy==="hidden") {
    throw new Error("il salto del colpo di grazia non ha ripristinato i personaggi");
  }
  await page.evaluate(() => window.__velmoraFinisherTest);
  console.log("PASS: colpo di grazia saltato e personaggi ripristinati");

  await page.evaluate(() => { window.alert=()=>{}; window.saveGame(); });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("velmoraDemoSave")||"null"));
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
  console.log("PASS: ricaricamento partita mantiene combattimento e sfondo selezionato");

  if (failures.length) throw new Error(failures.join("\n"));
  console.log("Smoke test browser Velmora completato senza errori.");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
