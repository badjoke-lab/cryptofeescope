(function createCryptoFeeScopePageState(){
  function normalizeError(err, response) {
    if (err && typeof err === 'object' && err.name === 'AbortError') {
      return {
        title: 'Request aborted',
        message: 'Request was cancelled.',
        details: err.stack || '',
      };
    }

    if (response && typeof response.status === 'number') {
      return {
        title: 'Request failed',
        message: `API returned ${response.status}`,
        details: response.statusText || '',
      };
    }

    if (err instanceof Error) {
      return {
        title: 'Request failed',
        message: err.message || 'Unexpected error',
        details: err.stack || '',
      };
    }

    return {
      title: 'Request failed',
      message: 'Unexpected error',
      details: '',
    };
  }

  async function safeFetchJson(url, options, validate) {
    let response = null;
    try {
      response = await fetch(url, options);
    } catch (err) {
      throw err;
    }

    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();

    if (!response.ok) {
      const err = new Error(`API returned ${response.status}`);
      err.status = response.status;
      err.responseText = text;
      throw err;
    }

    if (text.trim().startsWith('<') && !contentType.includes('application/json')) {
      throw new Error('Invalid JSON (HTML response)');
    }

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (err) {
      const parseErr = new Error('Invalid JSON');
      parseErr.cause = err;
      throw parseErr;
    }

    if (typeof validate === 'function') {
      const validationError = validate(data);
      if (validationError) {
        throw new Error(validationError);
      }
    }

    return data;
  }

  function createStateContent(mode, { title, message, details, onRetry }) {
    const panel = document.createElement('div');
    panel.className = `state-panel state-${mode}`;

    const titleEl = document.createElement('div');
    titleEl.className = 'state-title';
    titleEl.textContent = title || (mode === 'loading' ? 'Loading...' : 'Status');

    const messageEl = document.createElement('div');
    messageEl.className = 'state-message';
    if (message) messageEl.textContent = message;

    panel.append(titleEl);
    if (message) panel.append(messageEl);

    if (details) {
      const detailsEl = document.createElement('details');
      detailsEl.className = 'state-details';
      const summary = document.createElement('summary');
      summary.textContent = 'Details';
      const pre = document.createElement('pre');
      pre.textContent = details;
      detailsEl.append(summary, pre);
      panel.append(detailsEl);
    }

    if (typeof onRetry === 'function') {
      const actions = document.createElement('div');
      actions.className = 'state-actions';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn small btn-primary';
      button.textContent = 'Retry';
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true;
        try {
          await onRetry();
        } finally {
          button.disabled = false;
        }
      });
      actions.appendChild(button);
      panel.append(actions);
    }

    return panel;
  }

  function createPageState(containerId) {
    const container = document.getElementById(containerId);
    let currentMode = 'loading';

    function setState(mode, options = {}) {
      if (!container) return;
      currentMode = mode;

      if (mode === 'ok') {
        container.textContent = '';
        container.classList.add('hidden');
        container.setAttribute('aria-live', 'polite');
        container.dataset.state = mode;
        return;
      }

      container.textContent = '';
      container.classList.remove('hidden');
      container.dataset.state = mode;

      const content = createStateContent(mode, options);
      container.appendChild(content);
    }

    function getMode() {
      return currentMode;
    }

    return { setState, getMode };
  }

  window.CryptoFeeScopePageState = {
    createPageState,
    normalizeError,
    safeFetchJson,
  };
})();
