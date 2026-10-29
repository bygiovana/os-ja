// Service worker do OS Já: guarda a "casca" do app para abrir rápido no celular.
// Os dados (API) vêm sempre do servidor — nada de OS é guardado offline.
const VERSAO = "osja-v1";
const CASCA = [
  "/",
  "/estilo.css",
  "/app.js",
  "/vendor/qrcode.js",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icones/icone-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ordens/")) return; // sempre rede

  // rede primeiro (pega atualizações), cache como reserva quando a rede falhar
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) {
          const copia = r.clone();
          caches.open(VERSAO).then((c) => c.put(e.request, copia));
        }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("/"))),
  );
});
