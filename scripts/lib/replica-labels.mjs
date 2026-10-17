// Real plugin-admin labels that the site's UI replicas (dashboard preview, rules demo, merchant view, Ask Reco panel) and the prose around them show in ENGLISH
// on every translated page, because the AICC admin itself is English (and Hebrew) only: a merchant must find exactly these words in their WordPress admin.
// Source: the plugin's own strings (class-aicc-settings.php, class-aicc-reco.php). The translation checkers treat them like brand names (never "untranslated English").
export const REPLICA_LABELS = [
  "Recommendation Views", "Recommendation Clicks", "Recommendation Click Rate", "Bundle Add-To-Carts", "Associated Orders", "Associated Revenue",
  "Merchant Insights", "Recommendation Preview", "Top Performing Product", "Strong Bundle Opportunity", "High Interest, Low Conversion", "Recommendation Winner", "Top Recommendation", "Hot Product",
  "Share of store purchases", "Times bought together", "Add-to-cart count", "Recommendation clicks", "Bought together {n} times", "Bought together", "Last 30 days",
  "Go to Order History", "Order History", "Import order history", "Add Override", "Not now",
  "Pin", "Prefer", "Deprioritize", "Exclude",
].sort((a, b) => b.length - a.length);
