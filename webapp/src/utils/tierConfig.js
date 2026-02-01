/**
 * Shared configuration for cache tier display.
 * Used by CacheViewer, ContextViewer, and PromptView HUD.
 */

export const TIER_COLORS = {
  'L0': '#4ade80',  // Green - most stable
  'L1': '#2dd4bf',  // Teal
  'L2': '#60a5fa',  // Blue
  'L3': '#fbbf24',  // Yellow
  'active': '#fb923c' // Orange - least stable
};

export const TIER_THRESHOLDS = {
  'L0': 12,
  'L1': 9,
  'L2': 6,
  'L3': 3
};

export const TIER_NAMES = {
  'L0': 'Stable (12+)',
  'L1': 'Semi-stable (9+)',
  'L2': 'Warming (6+)',
  'L3': 'New (3+)',
  'active': 'Active'
};

/**
 * Get the color for a tier.
 * @param {string} tier - Tier name (L0, L1, L2, L3, active)
 * @returns {string} CSS color value
 */
export function getTierColor(tier) {
  return TIER_COLORS[tier] || '#888';
}

/**
 * Get the display name for a tier.
 * @param {string} tier - Tier name
 * @returns {string} Human-readable tier name
 */
export function getTierName(tier) {
  return TIER_NAMES[tier] || tier;
}
