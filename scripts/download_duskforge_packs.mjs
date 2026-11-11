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

    const downloadPromise = page.waitForEvent("download", { timeout: 90000 }).catch(() => null);
    await freeOption.click();
    let download = await downloadPromise;
    const target = path.join(out, pack.id + ".zip");

    if (!download) {
      await page.waitForURL(/\/download\//, { timeout: 45000 }).catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      await page.waitForTimeout(500);
      console.log("Pagina restituita da itch.io:", page.url());
      const links = await page.locator("a").evaluateAll(as => as.map(a => ({ text:(a.innerText||a.textContent||"").trim(), href:a.href })).filter(a => a.href));
      const bodyText = await page.locator("body").innerText().catch(() => "");
      console.log("Testo pagina download:", bodyText.slice(0,1800).replace(/\s+/g," "));
      console.log("Collegamenti pagina download:", JSON.stringify(links.slice(0,25)));

      const candidate = links.find(a => a.text.includes(pack.filename) || /\.zip(?:[?#]|$)/i.test(a.href));
      if (candidate) {
        console.log("Seguo il collegamento al file mostrato dalla pagina ufficiale:", candidate.href);
        const response = await context.request.get(candidate.href, { timeout: 180000 });
        if (!response.ok()) throw new Error("Download file ufficiale HTTP " + response.status());
        await fs.writeFile(target, await response.body());
      } else {
        const currentUrl = page.url();
        if (!/\/download\//.test(currentUrl)) throw new Error("itch.io non ha esposto né un evento download né un collegamento al file ZIP.");
        const response = await context.request.get(currentUrl, { timeout: 180000 });
        const bytes = await response.body();
        const type = response.headers()["content-type"] || "";
        console.log("Risposta endpoint download:", response.status(), type, response.headers()["content-disposition"] || "", "byte:", bytes.length);
        if (!response.ok() || !type.toLowerCase().includes("zip")) {
          throw new Error("Endpoint ufficiale ha restituito una pagina non-zip (" + type + "). Testo: " + bytes.toString("utf8").slice(0,900).replace(/\s+/g," "));
        }
        await fs.writeFile(target, bytes);
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
