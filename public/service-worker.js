self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  return self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  // 空监听器，只为了骗过 Chrome 的 PWA 安装检测，不拦截任何请求
});