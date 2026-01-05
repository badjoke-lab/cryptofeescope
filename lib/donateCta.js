(() => {
  const DONATE_URL = "https://buy.stripe.com/cNi8wI7oPcvS4x528zcIE00";
  const DONATE_LABEL = "Support this project";
  const DONATE_SUBLABEL = "Keeps data running. Thank you.";
  const CTA_CLASS = "donate-cta";

  const shouldHide = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get("hideDonate") === "1";
  };

  const buildMarkup = () => {
    const section = document.createElement("section");
    section.className = CTA_CLASS;
    section.setAttribute("aria-label", "Support CryptoFeeScope");
    section.innerHTML = `
      <div class="donate-cta-inner">
        <div class="donate-cta-text">
          <div class="donate-cta-title">${DONATE_LABEL}</div>
          <div class="donate-cta-sub">${DONATE_SUBLABEL}</div>
        </div>
        <a class="btn btn-secondary donate-cta-button" href="${DONATE_URL}" target="_blank" rel="noopener noreferrer" aria-label="${DONATE_LABEL} (opens in a new tab)">
          Donate
        </a>
      </div>
    `;
    return section;
  };

  const renderDonateCTA = () => {
    if (shouldHide()) return;
    if (document.querySelector(`.${CTA_CLASS}`)) return;
    const footer = document.querySelector("footer");
    if (!footer || !footer.parentNode) return;
    footer.parentNode.insertBefore(buildMarkup(), footer);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderDonateCTA);
  } else {
    renderDonateCTA();
  }

  window.CryptoFeeScopeDonateCTA = {
    renderDonateCTA,
    DONATE_URL,
  };
})();
