import { html } from 'lit';

export function renderUrlChips(component) {
  const hasDetected = component.detectedUrls?.length > 0;
  const hasFetched = Object.keys(component.fetchedUrls || {}).length > 0;
  const hasFetching = Object.keys(component.fetchingUrls || {}).length > 0;
  
  if (!hasDetected && !hasFetched && !hasFetching) {
    return '';
  }

  return html`
    <div class="url-chips-area">
      ${hasFetched ? html`
        <div class="url-chips-row fetched">
          ${Object.values(component.fetchedUrls).map(result => {
            const isIncluded = !component.excludedUrls?.has(result.url);
            const statusClass = result.error ? 'error' : (isIncluded ? 'success' : 'excluded');
            return html`
              <div class="url-chip fetched ${statusClass}" 
                   title=${result.error ? result.error : (result.summary || result.readme || 'No summary available')}>
                ${!result.error ? html`
                  <input 
                    type="checkbox" 
                    class="url-chip-checkbox"
                    .checked=${isIncluded}
                    @change=${() => component.toggleUrlIncluded(result.url)}
                    title="${isIncluded ? 'Click to exclude from context' : 'Click to include in context'}"
                  />
                ` : html`
                  <span class="url-chip-icon">❌</span>
                `}
                <span class="url-chip-label" 
                      @click=${() => component.viewUrlContent(result)}
                      style="cursor: pointer;">
                  ${result.title || component.getUrlDisplayName({ url: result.url })}
                </span>
                <button class="url-chip-remove" @click=${() => component.removeFetchedUrl(result.url)} title="Remove">×</button>
              </div>
            `;
          })}
        </div>
      ` : ''}
      ${hasDetected || hasFetching ? html`
        <div class="url-chips-row detected">
          ${(component.detectedUrls || []).map(urlInfo => html`
            <div class="url-chip detected">
              <span class="url-chip-type">${component.getUrlTypeLabel(urlInfo.type)}</span>
              <span class="url-chip-label" title=${urlInfo.url}>
                ${component.getUrlDisplayName(urlInfo)}
              </span>
              ${component.fetchingUrls?.[urlInfo.url] 
                ? html`<span class="url-chip-loading">⏳</span>`
                : html`
                    <button class="url-chip-fetch" @click=${() => component.fetchUrl(urlInfo)} title="Fetch content">
                      📥
                    </button>
                    <button class="url-chip-dismiss" @click=${() => component.dismissUrl(urlInfo.url)} title="Dismiss">×</button>
                  `
              }
            </div>
          `)}
          ${Object.entries(component.fetchingUrls || {}).filter(([url]) => 
            !(component.detectedUrls || []).some(u => u.url === url)
          ).map(([url]) => html`
            <div class="url-chip fetching">
              <span class="url-chip-loading">⏳</span>
              <span class="url-chip-label">Fetching...</span>
            </div>
          `)}
        </div>
      ` : ''}
    </div>
  `;
}
