export interface Insight {
  tag: string;
  title: string;
  detail: string;
  metric: string;
}

export const insights: Insight[] = [
  {
    tag: "Top Performer",
    title: "Top Performing Product",
    detail:
      "\"Wireless Charging Stand\" drives 3.2x more AI-assisted revenue than any other SKU this month.",
    metric: "+312% AI revenue",
  },
  {
    tag: "Opportunity",
    title: "High Interest, Low Conversion",
    detail:
      "\"Ceramic Pour-Over Kit\" gets strong traffic but converts 40% below your store average — try bundling it.",
    metric: "40% below avg.",
  },
  {
    tag: "Bundle",
    title: "Bundle Opportunity Detected",
    detail:
      "Customers who buy \"Trail Running Shoes\" add \"Compression Socks\" 61% of the time. Bundle them.",
    metric: "61% co-purchase rate",
  },
  {
    tag: "Performance",
    title: "Recommendation Performance",
    detail:
      "Your \"Frequently Bought Together\" widget is outperforming cart recommendations by 2.1x this week.",
    metric: "2.1x higher CTR",
  },
];
