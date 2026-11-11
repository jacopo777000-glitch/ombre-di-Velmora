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
      await page.waitForTimeout(1500);
    }

    const freeOption = page.getByText("No thanks, just take me to the downloads", { exact: false }).first();
    await freeOption.waitFor({ state: "visible", timeout: 30000 });
    console.log("Pagina pay-what-you-want:", page.url());

    // itch.io may deliver the ZIP immediately after this button, without
    // showing a separate file-list page. Listen before clicking so the
    // attachment response cannot be missed.
    const downloadPromise = page.waitForEvent("download", { timeout: 90000 }).catch(() => null);
    await freeOption.click();
    let download = await downloadPromise;

    const target = path.join(out, pack.id + ".zip");
    if (download) {
      await download.saveAs(target);
    } else {
      // Some itch.io layouts navigate directly to a signed /download/<token>
      // endpoint instead of raising Playwright's download event. Re-request
      // only that URL produced by the official page, preserving the official
      // download flow and its short-lived token.
      await page.waitForTimeout(1200);
      const currentUrl = page.url();
      console.log("Dopo la scelta gratuita:", currentUrl);
      if (/\.itch\.io\/[^/]+\/download\//i.test(currentUrl)) {
        const response = await context.request.get(currentUrl, { timeout: 180000 });
        if (!response.ok()) throw new Error("Download ufficiale non riuscito: HTTP " + response.status());
        const bytes = await response.body();
        await fs.writeFile(target, bytes);
        console.log("Risposta del download diretto:", response.headers()["content-type"], response.headers()["content-disposition"] || "");
      } else {
        const fileLink = page.locator("a").filter({ hasText: pack.filename }).first();
        await fileLink.waitFor({ state: "visible", timeout: 30000 });
        const [fallbackDownload] = await Promise.all([
          page.waitForEvent("download", { timeout: 180000 }),
          fileLink.click()
        ]);
        await fallbackDownload.saveAs(target);
      }
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
