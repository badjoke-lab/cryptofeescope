(function initShareUrlCopy() {
  const button = document.getElementById("share-button");
  if (!button) return;

  const feedback = document.getElementById("share-feedback");
  const label = button.querySelector(".label");
  const defaultLabel = label ? label.textContent : button.textContent;
  let resetTimer = 0;

  function setFeedback(message, status) {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.classList.remove("success", "error", "hidden");
    if (status) feedback.classList.add(status);
  }

  function resetFeedback() {
    if (feedback) {
      feedback.textContent = "";
      feedback.classList.add("hidden");
      feedback.classList.remove("success", "error");
    }
    if (label) {
      label.textContent = defaultLabel;
    } else if (defaultLabel) {
      button.textContent = defaultLabel;
    }
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const succeeded = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!succeeded) {
      throw new Error("Copy command failed");
    }
  }

  async function handleCopy() {
    const url = window.location.href;
    if (label) {
      label.textContent = "Copying…";
    }

    try {
      await copyText(url);
      setFeedback("URL copied", "success");
      if (label) label.textContent = "Copied!";
    } catch (error) {
      setFeedback("Copy failed", "error");
      if (label) label.textContent = "Copy failed";
    }

    if (resetTimer) window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(resetFeedback, 2200);
  }

  button.addEventListener("click", handleCopy);
})();
