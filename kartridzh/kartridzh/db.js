// Хранилище: ROM-файлы и автосейвы живут в IndexedDB этого браузера.
(function () {
  const DB_NAME = "kartridzh";
  const DB_VER = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("roms")) db.createObjectStore("roms", { keyPath: "id" });
        if (!db.objectStoreNames.contains("states")) db.createObjectStore("states");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      let result;
      const req = fn(os);
      if (req) req.onsuccess = () => { result = req.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function listRoms() {
    const roms = (await run("roms", "readonly", (os) => os.getAll())) || [];
    const stateKeys = new Set((await run("states", "readonly", (os) => os.getAllKeys())) || []);
    for (const r of roms) r.hasState = stateKeys.has(r.id);
    roms.sort((a, b) => (b.lastPlayed || b.added) - (a.lastPlayed || a.added));
    return roms;
  }

  const getRom = (id) => run("roms", "readonly", (os) => os.get(id));
  const putRom = (rec) => run("roms", "readwrite", (os) => os.put(rec));
  const getState = (id) => run("states", "readonly", (os) => os.get(id));
  const putState = (id, data) => run("states", "readwrite", (os) => os.put(data, id));
  const deleteState = (id) => run("states", "readwrite", (os) => os.delete(id));

  async function deleteRom(id) {
    await run("roms", "readwrite", (os) => os.delete(id));
    await deleteState(id);
  }

  async function touchRom(id) {
    const rec = await getRom(id);
    if (!rec) return;
    rec.lastPlayed = Date.now();
    await putRom(rec);
  }

  window.KDB = { listRoms, getRom, putRom, deleteRom, touchRom, getState, putState, deleteState };
})();
