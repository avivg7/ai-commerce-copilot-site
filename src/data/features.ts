export type FeatureIcon =
  | "sparkles"
  | "link"
  | "lightbulb"
  | "pie-chart"
  | "activity"
  | "trending-up"
  | "refresh-cw"
  | "heart-pulse"
  | "languages"
  | "shopping-cart"
  | "eye"
  | "layout-dashboard";

export interface Feature {
  icon: FeatureIcon;
  title: string;
  description: string;
  /** Larger bento tile when true */
  featured?: boolean;
}

export const features: Feature[] = [
  {
    icon: "sparkles",
    title: "AI Recommendations",
    description:
      "Personalized product suggestions generated from real shopper behavior, not static rules.",
    featured: true,
  },
  {
    icon: "link",
    title: "Frequently Bought Together",
    description: "Surface high-converting product pairs directly on the product page.",
  },
  {
    icon: "lightbulb",
    title: "Merchant Insights",
    description:
      "AI-written explanations of why products perform well and what to do next.",
    featured: true,
  },
  {
    icon: "pie-chart",
    title: "Revenue Attribution",
    description: "See exactly how much revenue your recommendations are driving.",
  },
  {
    icon: "activity",
    title: "Customer Behavior Analytics",
    description: "Understand browsing, search, and purchase patterns across your store.",
  },
  {
    icon: "trending-up",
    title: "Recommendation Performance",
    description: "Track click-through and conversion rate for every recommendation slot.",
  },
  {
    icon: "refresh-cw",
    title: "Automatic Product Sync",
    description: "Your catalog stays in sync automatically — zero manual maintenance.",
  },
  {
    icon: "heart-pulse",
    title: "Store Health",
    description: "A single score that flags catalog, tracking, and performance issues early.",
  },
  {
    icon: "languages",
    title: "Multi-language Widget",
    description: "Fully localized recommendation widgets, including native RTL support.",
  },
  {
    icon: "shopping-cart",
    title: "Cart Recommendations",
    description: "Smart upsells and cross-sells surfaced right where checkout happens.",
  },
  {
    icon: "eye",
    title: "Recommendation Preview",
    description: "Preview exactly how every widget will look before it goes live.",
  },
  {
    icon: "layout-dashboard",
    title: "Premium Dashboard",
    description: "One clean, modern dashboard for revenue, insights, and store health.",
  },
];
