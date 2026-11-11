import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const packs = [
  { id: "forest", page: "https://doomguizz.itch.io/enchanted-forest-rpg-backgrounds", filename: "Enchanted_Forest_RPG_Backgrounds.zip" },
  { id: "dungeon", page: "https://doomguizz.itch.io/dark-dungeon-rpg-backgrounds", filename: "Dark_Dungeon_RPG_Backgrounds.zip" }
];
const out = "/tmp/velmora-duskforge";
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const pack of packs) {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    console.log("Apro la pagina ufficiale:", pack.page);
    await page.goto(pack.page, { waitUntil: "domcontentloaded", timeout: 90000 });
    const downloadNow = page.getByRole("link", { name: /Download Now/i }).first();
    const purchaseHref = await downloadNow.getAttribute("href");
    console.log("Link ufficiale Download Now:", purchaseHref);
    if (purchaseHref) await page.goto(new URL(purchaseHref, page.url()).href, { waitUntil: "domcontentloaded", timeout: 90000 });
    else { await downloadNow.click(); await page.waitForLoadState("domcontentloaded").catch(() => {}); }

    const freeOption = page.getByText("No thanks, just take me to the downloads", { exact: false }).first();
    await freeOption.waitFor({ state: "visible", timeout: 30000 });
    console.log("Pagina pay-what-you-want:", page.url());

    const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
    await freeOption.click();
    let download = await downloadPromise;
    const target = path.join(out, pack.id + ".zip");

    if (!download) {
      await page.waitForURL(/\/download\//, { timeout: 45000 }).catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(500);
      console.log("Pagina restituita da itch.io:", page.url());
      const links = await page.locator("a").evaluateAll(as => as.map(a => ({ text:(a.innerText||a.textContent||"").trim(), href:a.getAttribute("href") || "", absolute:a.href })).filter(a => a.href));
      const bodyText = await page.locator("body").innerText().catch(() => "");
      console.log("Testo pagina download:", bodyText.slice(0,2600).replace(/\s+/g," "));
      console.log("Collegamenti pagina download:", JSON.stringify(links.slice(0,30)));

      // itch.io's official download landing page exposes a JavaScript Download
      // control inside #game_download_<upload-id>, rather than a direct ZIP URL.
      const jump = links.find(a => /#game_download_\d+/.test(a.href));
      const sectionId = jump && jump.href.split("#").pop();
      const section = sectionId ? page.locator("#" + sectionId) : page.locator("body");
      const sectionHtml = await section.evaluate(el => el.outerHTML.slice(0,7000)).catch(() => "");
      console.log("Sezione file ufficiale:", sectionHtml.slice(0,5000));
      const downloadControl = section.getByRole("link", { name: /^Download$/i }).first();
      if (await downloadControl.count()) {
        const actualDownload = page.waitForEvent("download", { timeout: 180000 });
        await downloadControl.click();
        download = await actualDownload;
        await download.saveAs(target);
      } else {
        const candidate = links.find(a => a.text.includes(pack.filename) || /\.zip(?:[?#]|$)/i.test(a.absolute));
        if (candidate) {
          console.log("Seguo il collegamento al file mostrato dalla pagina ufficiale:", candidate.absolute);
          const response = await context.request.get(candidate.absolute, { timeout: 180000 });
          if (!response.ok()) throw new Error("Download file ufficiale HTTP " + response.status());
          await fs.writeFile(target, await response.body());
        } else {
          throw new Error("La pagina ufficiale non espone il pulsante Download del file. Sezione: " + sectionHtml.slice(0,1200).replace(/\s+/g," "));
        }
      }
    } else {
      await download.saveAs(target);
    }

    const bytes = await fs.readFile(target);
    if (bytes.length < 100000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error("Archivio ZIP non valido o incompleto per " + pack.filename + " (" + bytes.length + " byte)");
    }
    console.log("Scaricato tramite il flusso ufficiale:", pack.filename, bytes.length, "byte");
    await context.close();
  }
} finally {
  await browser.close();
}
