import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const packs = [
  {
    id: "forest",
    page: "https://doomguizz.itch.io/enchanted-forest-rpg-backgrounds",
    filename: "Enchanted_Forest_RPG_Backgrounds.zip"
  },
  {
    id: "dungeon",
    page: "https://doomguizz.itch.io/dark-dungeon-rpg-backgrounds",
    filename: "Dark_Dungeon_RPG_Backgrounds.zip"
  }
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
    if (purchaseHref) {
      await page.goto(new URL(purchaseHref, page.url()).href, { waitUntil: "domcontentloaded", timeout: 90000 });
    } else {
      await downloadNow.click();
      await page.waitForTimeout(2500);
    }
    console.log("Pagina pay-what-you-want:", page.url());
    const freeOption = page.getByText("No thanks, just take me to the downloads", { exact: false }).first();
    await freeOption.waitFor({ state: "visible", timeout: 30000 });
    const freeHref = await freeOption.evaluate(el => {
      let node = el;
      while (node && !["A", "BUTTON"].includes(node.tagName)) node = node.parentElement;
      return node ? node.getAttribute("href") : null;
    });
    if (freeHref) {
      await page.goto(new URL(freeHref, page.url()).href, { waitUntil: "domcontentloaded", timeout: 90000 });
    } else {
      await freeOption.click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }
    console.log("Pagina dei file:", page.url());
    const fileLink = page.locator("a").filter({ hasText: pack.filename }).first();
    await fileLink.waitFor({ state: "visible", timeout: 45000 });
    console.log("Pagina download ufficiale:", page.url());
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 180000 }),
      fileLink.click()
    ]);
    const target = path.join(out, pack.id + ".zip");
    await download.saveAs(target);
    const stat = await fs.stat(target);
    if (stat.size < 100000) throw new Error("Archivio troppo piccolo o download incompleto: " + pack.filename);
    console.log("Scaricato", pack.filename, stat.size, "byte");
    await context.close();
  }
} finally {
  await browser.close();
}
