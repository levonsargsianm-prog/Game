(function () {
  const ROM_EXT = ["md", "bin", "gen", "smd", "zip", "7z", "68k", "sgd"];
  const MAX_SIZE = 32 * 1024 * 1024;

  const $list = document.getElementById("list");
  const $empty = document.getElementById("empty");
  const $picker = document.getElementById("picker");
  const $sheet = document.getElementById("sheet");
  const $toast = document.getElementById("toast");
  let current = null;

  // ---------- Service worker и установка ----------

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("SW:", e));
  }

  let installEvent = null;
  const $install = document.getElementById("install");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e;
    $install.hidden = false;
  });
  $install.addEventListener("click", async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    $install.hidden = true;
  });

  // ---------- Помощники ----------

  function toast(msg) {
    $toast.textContent = msg;
    $toast.classList.add("show");
    clearTimeout(toast.t);
    toast.t = setTimeout(() => $toast.classList.remove("show"), 2600);
  }

  const SMALL = new Set(["the", "of", "and", "in", "a", "to", "vs"]);
  function titleCase(s) {
    return s
      .toLowerCase()
      .split(" ")
      .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
  }

  function nameFromFile(fileName) {
    return fileName
      .replace(/\.[^.]+$/, "")
      .replace(/[_]+/g, " ")
      .replace(/\s*[\(\[].*?[\)\]]/g, "")
      .replace(/\s+/g, " ")
      .trim() || fileName;
  }

  // Заголовок картриджа Mega Drive: "SEGA" по адресу 0x100, название на 0x150 (или 0x120).
  async function titleFromHeader(file) {
    const buf = new Uint8Array(await file.slice(0, 0x200).arrayBuffer());
    if (buf.length < 0x180) return null;
    const read = (a, b) =>
      String.fromCharCode(...buf.slice(a, b)).replace(/[^\x20-\x7e]/g, " ").replace(/\s+/g, " ").trim();
    if (!read(0x100, 0x110).includes("SEGA")) return null;
    const t = read(0x150, 0x180) || read(0x120, 0x150);
    return t ? titleCase(t) : null;
  }

  async function hashFile(file) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest).slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function hue(str) {
    let h = 0;
    for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % 360;
  }

  function initials(title) {
    const words = title.replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
    const sig = words.filter((w) => !SMALL.has(w.toLowerCase()));
    const src = sig.length ? sig : words;
    return (src.slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();
  }

  function play(id, fresh) {
    location.href = "play.html?id=" + encodeURIComponent(id) + (fresh ? "&fresh=1" : "");
  }

  // ---------- Полка ----------

  async function render() {
    const roms = await KDB.listRoms();
    $list.innerHTML = "";
    $empty.hidden = roms.length > 0;

    for (const r of roms) {
      const h = hue(r.id);
      const card = document.createElement("div");
      card.className = "cart";
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      card.style.setProperty(
        "--label-bg",
        `linear-gradient(135deg, hsl(${h} 75% 52%), hsl(${(h + 40) % 360} 70% 32%))`
      );
      card.innerHTML = `
        <div class="label"><span class="initials"></span></div>
        <div class="title"></div>
        <div class="meta"></div>
        <button class="more" aria-label="Меню">⋯</button>`;
      card.querySelector(".initials").textContent = initials(r.title);
      card.querySelector(".title").textContent = r.title;
      const meta = card.querySelector(".meta");
      if (r.hasState) {
        meta.textContent = "● Продолжить с места";
        meta.classList.add("saved");
      } else {
        meta.textContent = r.lastPlayed ? "Играли недавно" : "Новая";
      }

      card.addEventListener("click", (e) => {
        if (e.target.closest(".more")) return;
        play(r.id, false);
      });
      card.querySelector(".more").addEventListener("click", () => openSheet(r));
      $list.appendChild(card);
    }
  }

  function openSheet(rec) {
    current = rec;
    document.getElementById("sheet-title").textContent = rec.title;
    document.getElementById("act-fresh").hidden = !rec.hasState;
    $sheet.showModal();
  }

  $sheet.addEventListener("click", async (e) => {
    if (e.target === $sheet) return $sheet.close();
    const act = e.target.closest("button")?.dataset.act;
    if (!act || !current) return;
    $sheet.close();
    const rec = current;

    if (act === "play") play(rec.id, false);
    if (act === "fresh") play(rec.id, true);
    if (act === "rename") {
      const name = prompt("Название игры", rec.title);
      if (name && name.trim()) {
        const full = await KDB.getRom(rec.id);
        full.title = name.trim();
        await KDB.putRom(full);
        render();
      }
    }
    if (act === "delete") {
      if (confirm(`Удалить «${rec.title}» вместе с автосохранением?`)) {
        await KDB.deleteRom(rec.id);
        toast("Удалено");
        render();
      }
    }
  });

  // ---------- Добавление ROM ----------

  $picker.addEventListener("change", async () => {
    const files = Array.from($picker.files || []);
    $picker.value = "";
    if (!files.length) return;

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    let added = 0;
    for (const file of files) {
      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (!ROM_EXT.includes(ext)) {
        toast(`Не похоже на ROM Mega Drive: ${file.name}`);
        continue;
      }
      if (file.size > MAX_SIZE) {
        toast(`Слишком большой файл: ${file.name}`);
        continue;
      }
      try {
        const id = await hashFile(file);
        if (await KDB.getRom(id)) {
          toast("Эта игра уже на полке");
          continue;
        }
        const title = (await titleFromHeader(file)) || nameFromFile(file.name);
        await KDB.putRom({
          id,
          title,
          file: file.name,
          size: file.size,
          added: Date.now(),
          lastPlayed: 0,
          blob: new Blob([await file.arrayBuffer()], { type: "application/octet-stream" }),
        });
        added++;
      } catch (e) {
        console.error(e);
        toast(`Не получилось добавить ${file.name}`);
      }
    }
    if (added) toast(added === 1 ? "Игра добавлена" : `Добавлено игр: ${added}`);
    await render();
  });

  // При возврате из игры жестом «назад» страница может подняться из кэша — обновляем полку.
  window.addEventListener("pageshow", (e) => { if (e.persisted) render(); });

  render();
})();
