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
    await page.getByRole("link", { name: /Download Now/i }).first().click();
    await page.waitForURL(/\/purchase(?:\?|$)/, { timeout: 45000 });
    const freeOption = page.getByText("No thanks, just take me to the downloads", { exact: true });
    await freeOption.waitFor({ state: "visible", timeout: 30000 });
    await freeOption.click();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
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
