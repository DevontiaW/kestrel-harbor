// Copy buttons for the "Build it yourself with AI" prompts. Works offline; falls back to selecting the text.
document.querySelectorAll('button.copy[data-copy]').forEach(button => {
  button.addEventListener('click', async () => {
    const pre = document.getElementById(button.dataset.copy), label = button.textContent;
    try { await navigator.clipboard.writeText(pre.textContent); button.textContent = 'Copied'; }
    catch { const range = document.createRange(); range.selectNodeContents(pre); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); button.textContent = 'Selected: copy it'; }
    setTimeout(() => { button.textContent = label; }, 2000);
  });
});
