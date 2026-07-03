export interface ComparisonRow {
  typical: string;
  copilot: string;
}

export const comparisonRows: ComparisonRow[] = [
  { typical: "Recommendations only", copilot: "Recommendations + Intelligence" },
  { typical: "Analytics only", copilot: "Actionable AI Insights" },
  { typical: "Static, rule-based logic", copilot: "Explains WHY products perform well" },
  { typical: "Generic dashboards", copilot: "Revenue attributed to every recommendation" },
];
