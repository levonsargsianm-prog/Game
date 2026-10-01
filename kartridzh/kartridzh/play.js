(async function () {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const fresh = params.get("fresh") === "1";
  const rec = id ? await KDB.getRom(id) : null;
  if (!rec) {
    location.replace("./");
    return;
  }
  document.title = rec.title;

  const standalone = matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches;
  let started = false;
  let leaving = false;

  // ---------- Автосохранение: состояние игры кладём в IndexedDB ----------

  function captureState() {
    const em = window.EJS_emulator;
    if (!started || !em || em.failedToStart || !em.gameManager) return null;
    try { em.gameManager.saveSaveFiles(); } catch (e) {}
    try { return em.gameManager.getState(); } catch (e) { console.warn("state", e); return null; }
  }

  async function autosave() {
    const state = captureState();
    if (state) {
      try { await KDB.putState(id, state); } catch (e) { console.warn("autosave", e); }
    }
  }

  // Регистрируем раньше EmulatorJS, чтобы успеть снять состояние до его обработчика выхода.
  window.addEventListener("beforeunload", () => { if (!leaving) autosave(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") autosave();
    else if (started) keepAwake();
  });

  // ---------- Выход на полку: кнопка ✕ и системный жест «назад» ----------

  const shelfPath = new URL("./", location.href).pathname;
  let cameFromShelf = false;
  try {
    cameFromShelf = !!document.referrer &&
      new URL(document.referrer).pathname.replace(/index\.html$/, "") === shelfPath;
  } catch (e) {}

  let pushed = true;
  history.pushState({ kartridzhGame: 1 }, "");
  window.addEventListener("popstate", () => { pushed = false; leave(); });
  document.getElementById("back").addEventListener("click", leave);

  async function leave() {
    if (leaving) return;
    leaving = true;
    await autosave();
    if (cameFromShelf) history.go(pushed ? -2 : -1);
    else location.replace("./");
  }

  // ---------- Экран не гаснет во время игры ----------

  async function keepAwake() {
    try { if (navigator.wakeLock) await navigator.wakeLock.request("screen"); } catch (e) {}
  }

  // ---------- Настройка EmulatorJS ----------

  window.EJS_player = "#game";
  window.EJS_core = "segaMD";
  window.EJS_pathtodata = "emulatorjs/data/";
  window.EJS_gameUrl = new File([rec.blob], rec.file);
  window.EJS_gameName = rec.id;
  window.EJS_language = (navigator.language || "").toLowerCase().startsWith("ru") ? "ru-RU" : "en-US";
  window.EJS_startButtonName = "▶ Играть";
  window.EJS_color = "#ff4b3e";
  window.EJS_backgroundColor = "#000000";
  window.EJS_threads = false;
  window.EJS_fullscreenOnLoaded = !standalone;
  window.EJS_defaultOptions = {
    "save-state-location": "browser",
    "save-save-interval": "30",
  };
  window.EJS_Buttons = {
    netplay: false,
    cheat: false,
    screenRecord: false,
    screenshot: false,
    cacheManager: false,
    saveSavFiles: false,
    loadSavFiles: false,
    exitEmulation: false,
  };
  // Классическая раскладка на три кнопки: крестовина слева, A B C справа, Start над ними (не закрывает картинку).
  window.EJS_VirtualGamepadSettings = [
    { type: "button", text: "A", id: "a", location: "right", right: 145, top: 70, bold: true, input_value: 1 },
    { type: "button", text: "B", id: "b", location: "right", right: 75, top: 70, bold: true, input_value: 0 },
    { type: "button", text: "C", id: "c", location: "right", right: 5, top: 70, bold: true, input_value: 8 },
    { type: "dpad", id: "dpad", location: "left", left: "50%", right: "50%", joystickInput: false, inputValues: [4, 5, 6, 7] },
    { type: "button", text: "Start", id: "start", location: "right", right: 75, top: 0, fontSize: 15, block: true, input_value: 3 },
  ];

  if (!fresh) {
    const state = await KDB.getState(id);
    if (state) window.EJS_loadStateURL = state;
  }

  window.EJS_onGameStart = () => {
    started = true;
    // EmulatorJS разворачивает на весь экран свой контейнер — переносим кнопку ✕ внутрь него.
    const parent = window.EJS_emulator && window.EJS_emulator.elements && window.EJS_emulator.elements.parent;
    if (parent) parent.appendChild(document.getElementById("back"));
    KDB.touchRom(id);
    keepAwake();
    try { screen.orientation.lock("landscape").catch(() => {}); } catch (e) {}
    setInterval(autosave, 30000);
  };

  const loader = document.createElement("script");
  loader.src = "emulatorjs/data/loader.js";
  document.body.appendChild(loader);
})();
