import { html } from 'lit';
import { formatTokens } from '../utils/formatters.js';

export function renderHistoryBar(component) {
  const historyTokens = component._hudData?.history_tokens || 0;
  const historyThreshold = component._hudData?.history_threshold || 9000;
  
  if (historyThreshold <= 0) return '';
  
  const percent = Math.min(100, (historyTokens / historyThreshold) * 100);
  const statusClass = percent > 95 ? 'critical' : percent > 80 ? 'warning' : '';
  
  return html`
    <div class="history-bar ${statusClass}" title="History: ${formatTokens(historyTokens)} / ${formatTokens(historyThreshold)} (${Math.round(percent)}%)">
      <div class="history-bar-fill" style="width: ${percent}%"></div>
    </div>
  `;
}
