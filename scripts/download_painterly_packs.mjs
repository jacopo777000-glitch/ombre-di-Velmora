import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const packs = [
  {
    id: "kalponic",
    page: "https://kalponic-studio.itch.io/painterly-battle-backgrounds",
    filename: "Free Battle Backgrounds.zip",
    minimumBytes: 1000000
  },
  {
    id: "gegx",
    page: "https://gegx.itch.io/painterly-backgrounds-free",
    filename: "painterly-backgrounds-free-assets.zip",
    minimumBytes: 1000000
  }
];
const out = "/tmp/velmora-painterly";
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
    await downloadNow.waitFor({ state: "visible", timeout: 45000 });
    const downloadHref = await downloadNow.getAttribute("href");
    if (downloadHref) {
      await page.goto(new URL(downloadHref, page.url()).href, { waitUntil: "domcontentloaded", timeout: 90000 });
    } else {
      await downloadNow.click();
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    }

    const freeOption = page.getByText("No thanks, just take me to the downloads", { exact: false }).first();
    await freeOption.waitFor({ state: "visible", timeout: 45000 });
    console.log("Pagina ufficiale di download:", page.url());
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
    await freeOption.click();
    let download = await downloadPromise;
    const target = path.join(out, pack.id + ".zip");

    if (!download) {
      await page.waitForURL(/\/download\//, { timeout: 60000 }).catch(() => {});
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      const links = await page.locator("a").evaluateAll(as => as.map(a => ({
        text: (a.innerText || a.textContent || "").trim(),
        href: a.getAttribute("href") || "",
        absolute: a.href
      })).filter(a => a.href));
      const jump = links.find(a => /#game_download_\d+/.test(a.href));
      const sectionId = jump && jump.href.split("#").pop();
      const section = sectionId ? page.locator("#" + sectionId) : page.locator("body");
      const downloadControl = section.getByRole("link", { name: /^Download$/i }).first();
      if (await downloadControl.count()) {
        const actualDownload = page.waitForEvent("download", { timeout: 180000 });
        await downloadControl.click();
        download = await actualDownload;
        await download.saveAs(target);
      } else {
        const candidate = links.find(a => a.text.includes(pack.filename) || /\.zip(?:[?#]|$)/i.test(a.absolute));
        if (!candidate) throw new Error("La pagina ufficiale non espone il file " + pack.filename);
        const response = await context.request.get(candidate.absolute, { timeout: 180000 });
        if (!response.ok()) throw new Error("Download ufficiale HTTP " + response.status());
        await fs.writeFile(target, await response.body());
      }
    } else {
      await download.saveAs(target);
    }

    const bytes = await fs.readFile(target);
    if (bytes.length < pack.minimumBytes || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      throw new Error("Archivio ZIP non valido o incompleto: " + pack.filename + " (" + bytes.length + " byte)");
    }
    console.log("Scaricato dalla pagina ufficiale:", pack.filename, bytes.length, "byte");
    await context.close();
  }
} finally {
  await browser.close();
}
