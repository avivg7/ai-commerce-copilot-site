export interface Metric {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

export const metrics: Metric[] = [
  { label: "Average Order Value", value: 27, suffix: "%", prefix: "+" },
  { label: "Revenue Growth", value: 34, suffix: "%", prefix: "+" },
  { label: "AI-Assisted Revenue", value: 41, suffix: "%" },
  { label: "Widget CTR", value: 18.6, suffix: "%", decimals: 1 },
  { label: "Bundle Adds", value: 12400, suffix: "+" },
  { label: "Customer Insights Generated", value: 3200, suffix: "+" },
];
