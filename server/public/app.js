document.addEventListener('DOMContentLoaded', () => {
  const snippets = {
    curl: 'curl -fsSL https://tunnel.corelabs.network/install.sh | bash',
    powershell: 'iwr -useb https://tunnel.corelabs.network/install.ps1 | iex',
    npm: 'npx -y @corelabs/tunnel-cli',
    bun: 'bunx @corelabs/tunnel-cli',
    brew: 'brew install corelabs-tunnel'
  };

  const codeElem = document.getElementById('command-code');
  const tabBtns = document.querySelectorAll('.tab-btn');
  const copyBtn = document.getElementById('copy-btn');

  let currentTab = 'curl';

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.dataset.tab;

      if (snippets[currentTab]) {
        codeElem.textContent = snippets[currentTab];
      }
    });
  });

  copyBtn.addEventListener('click', async () => {
    const textToCopy = snippets[currentTab] || codeElem.textContent;
    try {
      await navigator.clipboard.writeText(textToCopy);
      
      const originalSvg = copyBtn.innerHTML;
      copyBtn.innerHTML = `<span style="font-family: var(--font-mono); font-size: 0.8rem; color: #22c55e; font-weight: bold;">✔ Copié!</span>`;
      
      setTimeout(() => {
        copyBtn.innerHTML = originalSvg;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy', err);
    }
  });
});

function scrollToInstall() {
  const elem = document.getElementById('installer');
  if (elem) {
    elem.scrollIntoView({ behavior: 'smooth' });
  }
}
