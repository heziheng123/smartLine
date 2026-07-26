window.setTimeout(() => {
  const screen = document.querySelector('#root .boot-screen');
  const status = document.querySelector('#root .boot-status');
  if (!screen || !status) return;
  screen.setAttribute('data-delayed', 'true');
  status.textContent = '加载时间较长，请检查网络后重试。';
}, 15_000);

document.querySelector('#boot-retry')?.addEventListener('click', () => window.location.reload());
