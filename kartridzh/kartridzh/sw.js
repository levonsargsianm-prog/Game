// Офлайн-кэш: всё приложение и ядро эмулятора скачиваются один раз при установке.
const VERSION = "kartridzh-v2";

const PRECACHE = [
  "./",
  "index.html",
  "play.html",
  "app.css",
  "db.js",
  "shelf.js",
  "play.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "emulatorjs/data/loader.js",
  "emulatorjs/data/emulator.min.js",
  "emulatorjs/data/emulator.min.css",
  "emulatorjs/data/version.json",
  "emulatorjs/data/localization/ru-RU.json",
  "emulatorjs/data/localization/en-US.json",
  "emulatorjs/data/cores/reports/genesis_plus_gx.json",
  "emulatorjs/data/cores/genesis_plus_gx-legacy-wasm.data",
  "emulatorjs/data/cores/genesis_plus_gx-wasm.data",
  "emulatorjs/data/compression/extract7z.js",
  "emulatorjs/data/compression/extractzip.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // внешние запросы не трогаем

  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (e) {
        if (req.mode === "navigate") {
          const shelf = await cache.match("index.html");
          if (shelf) return shelf;
        }
        return Response.error();
      }
    })
  );
});
