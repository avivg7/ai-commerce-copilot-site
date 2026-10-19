/**
 * English source dictionary. The shape of this object is the contract for he.ts, es.ts and ru.ts. Those are PARTIAL dictionaries:
 * a unit they do not translate falls back to this English text (shown lang="en" dir="ltr"), see src/i18n/merge.ts.
 * FAQ text is NOT here: it lives in the shared content pack brand/content/faq.<locale>.json (see src/data/faq.ts).
 *
 * Mini-markup inside strings:
 *   **bold**                 -> <strong>
 *   [label](route:pricing)   -> internal, locale-aware link (route ids from src/lib/routes.ts)
 *   [label](https://...)     -> external link
 *   {priceSolo}              -> values from plans.ts / owner config (see src/lib/rich.tsx for the full list)
 *   {companyDetails} {supportEmail} {governingLaw} {paymentProcessor} {hostingRegion}   ({legalName} and {address} feed {companyDetails})
 *                            -> owner-supplied values; until set they render ONE plain muted line (pending.line / pending.detail)
 * Terminology follows content-source.md section 8 (Control Plane repo, docs/unified-experience/). US English.
 * Never translate: AICC, Reco, WooCommerce, WordPress, Solo, Studio, Agency, prices.
 * Every claim here is listed in docs/claims-inventory-content-pass.md with its evidence.
 */
export const en = {
  meta: {
    siteName: "AI Commerce Copilot",
    ogImageAlt: "AICC: product recommendations, merchant insight and merchandising control for WooCommerce. A simple sketch of a product page with a recommended bundle.",
    pages: {
      home: {
        title: "AICC: product recommendations and merchandising copilot",
        description:
          "AICC turns your store data into better product recommendations, useful merchant insight and practical merchandising control. Available for WooCommerce.",
      },
      product: {
        title: "How AICC works: recommendations you can explain and control",
        description:
          "See what shoppers see, how AICC decides what to recommend, what you can measure and control, and how it stays out of your checkout's way.",
      },
      pricing: {
        title: "Pricing: Solo, Studio and Agency plans for AICC",
        description:
          "Every plan has the full AICC product. Solo {priceSolo}, Studio {priceStudio}, Agency {priceAgency} per year, priced by store count. Manual renewal, 14-day money-back guarantee.",
      },
      dataTrust: {
        title: "Data and trust: what AICC reads and what it does not",
        description:
          "The store and order data AICC uses, the cookies it can set, how stores are kept apart, and how long data may be kept.",
      },
      privacy: {
        title: "Privacy policy (draft)",
        description: "How AICC handles website, account and connected-store information. Draft pending legal review.",
      },
      terms: {
        title: "Terms of service (draft)",
        description: "The terms for using AICC plans and connecting stores. Draft pending legal review.",
      },
      refund: {
        title: "Refund policy: 14-day money-back guarantee",
        description:
          "A 14-day money-back guarantee on your initial purchase of a plan, when it starts, and what happens after a refund.",
      },
      accessibility: {
        title: "Accessibility statement",
        description:
          "How we aim for WCAG 2.2 level AA on this website, what we have done, known limitations and how to report a barrier.",
      },
      questions: {
        title: "Questions about AICC, answered plainly",
        description:
          "Straight answers about what AICC does, how recommendations work, plans and stores, renewal and refunds, data and what happens when access pauses.",
      },
      notFound: {
        title: "Page not found",
        description: "This page does not exist.",
      },
    },
  },

  // Shown (one muted plain line, no pills) in place of owner values that are not supplied yet.
  pending: {
    line: "Support details will be published before launch.",
    detail: "This detail will be published before launch.",
  },

  common: {
    skip: "Skip to main content",
    nav: {
      label: "Main",
      product: "Product",
      pricing: "Pricing",
      dataTrust: "Data and trust",
      questions: "Questions",
      menu: "Menu",
      account: "Account",
    },
    pageNames: {
      product: "Product",
      pricing: "Pricing",
      dataTrust: "Data and trust",
      privacy: "Privacy policy",
      terms: "Terms of service",
      refund: "Refund policy",
      accessibility: "Accessibility",
      questions: "Questions",
      dpa: "Data Processing Addendum",
    },
    getStarted: "Get started",
    seeHow: "See how it works",
    seePricing: "See pricing",
    seeAllQuestions: "Browse all questions",
    readHistory: "Read how your history can be kept",
    learnMoreProduct: "How AICC works",
    home: "AICC home",
    language: {
      label: "Language",
      choose: "Choose language",
      current: "current",
    },
    langSuggest: {
      label: "Language suggestion",
      text: "This page is also available in English.",
      accept: "Switch to English",
      dismiss: "Not now",
    },
    a11y: {
      button: "Accessibility",
      title: "Accessibility settings",
      intro: "These settings are saved in this browser only. They adjust this website; they do not change anything else.",
      motion: "Reduce motion",
      motionHelp: "Stops animations and transitions.",
      contrast: "Higher contrast",
      contrastHelp: "Darker text and stronger borders.",
      text: "Larger text",
      textHelp: "Makes all text about 19% bigger.",
      reset: "Reset all",
      close: "Close",
      statement: "Read the accessibility statement",
      disclaimer: "These controls are a convenience. They do not make this website conformant on their own.",
      storage: "Settings are stored in this browser (local storage).",
    },
    footer: {
      tagline: "Product recommendations, merchant insight and merchandising control for WooCommerce, learned from your own orders.",
      productHeading: "AICC",
      trustHeading: "Trust and legal",
      languageHeading: "Language",
      copyright: "© {year} {name}",
      note: "AICC is built for WooCommerce and is not affiliated with or endorsed by WooCommerce or WordPress. WooCommerce and WordPress are trademarks of their respective owners.",
    },
    breadcrumbs: { label: "Breadcrumb" },
    draft: {
      badge: "Draft: pending legal review",
      text: "This wording is a draft. It has not been reviewed by a lawyer or by a person with legal authority, and it may change before it is final.",
      translation:
        "Hebrew, Spanish and Russian texts have not yet been reviewed by native speakers. This translation is a draft and also needs a native-speaking legal reviewer. If it differs from the English text, the English text prevails.",
    },
    plan: {
      perYear: "per year",
      oneStore: "1 store",
      upToStores: "Up to {n} stores",
      choose: "Choose {plan}",
      recommended: "Built for multiple stores",
      sameFeatures: "Every feature, on every plan",
      countHelper: "Count the stores you want to connect. Solo covers 1, Studio up to 3, Agency up to 10.",
      term: "Fixed 365-day plan. Renewal is manual.",
      renewal: "You stay in control: AICC never renews your plan automatically.",
      guarantee: "14-day money-back guarantee on your first purchase",
      usd: "All prices are in US dollars (USD).",
    },
    toc: "On this page",
    lastReviewed: "Last reviewed",
    draftUpdated: "Draft last updated",
    version: "Status",
    versionDraft: "Draft",
    fallbackTag: "EN",
  },

  // Brand kit strings (also exported to brand/i18n/strings.json by `npm run brand:strings`).
  brand: {
    watchDemo: "Watch demo",
    signIn: "Sign in",
    chips: {
      orders: "Order history",
      clicks: "Click rate",
      recs: "Recommendations",
      insights: "Insights",
      bundles: "Bundles",
    },
    motion: { pause: "Pause animation", play: "Play animation" },
    modal: {
      title: "Product demo",
      close: "Close",
      placeholder: "A short product video is coming. Meanwhile, try the interactive demo.",
      tryDemo: "Try the interactive demo",
      captionsLabel: "Captions",
    },
  },

  notFound: {
    heading: "We can't find that page.",
    body: "The link may be old or mistyped. Your store was not affected.",
    home: "Go to the home page",
    questions: "Read the questions",
  },

  // Strings mirror the real storefront widget (get_widget_strings() in the ai-commerce-copilot plugin repo) where one exists.
  // Kit module: brand/js/fbt-demo.js. Everything here is SAMPLE content: invented products and counts.
  demo: {
    label: "Sample data: not from a real store",
    heading: "Try the widget",
    groupLabel: "Products in this bundle",
    intro:
      "Tick the products and watch the bundle total change. The products, prices and counts are invented sample data.",
    nudge: "Compare the two, then see it from your side.",
    result: {
      without: "WooCommerce related products pick from the same category: {names}. Nothing about them comes from what shoppers buy together.",
      withTwo: "Same product. With AICC the partners are {a} and {b}, bought together {na} and {nb} times.",
      withOne: "Same product. With AICC the first partner is {a}, bought together {na} times; your rules shape the rest.",
      withNone: "Same product. Your rules have removed the partners AICC learned from your orders, so the list is filled in from your catalog.",
      merchant: "The same bundle from your side: how each product was ranked, and the rules that shape the list.",
    },
    plain: {
      title: "Related products",
      note: "WooCommerce's own related products: the same category or tags, with no bundle and no total.",
    },
    summary: "Selected: {count}. Bundle total: {total}.",
    widget: {
      title: "Frequently Bought Together",
      subtitle: "Customers often purchase these products together.",
      bundleTotal: "Bundle total",
      addOne: "Add 1 product to cart",
      addMany: "Add {count} products to cart",
      added: "Added to cart",
      selectAtLeastOne: "Select at least one product",
      noteAdd: "Nothing is added anywhere: this is an illustration.",
      addFew: "Add {count} products to cart",
    },
    mode: {
      legend: "Compare",
      without: "WooCommerce related products",
      with: "With AICC",
      captionWithout: "WooCommerce related products: same category, not from orders.",
      captionWith: "With AICC: products bought together come first.",
      withoutCaption:
        "WooCommerce's own related products come from the same category or tags. They are not based on what shoppers buy together.",
      withCaption: "AICC lists the products that appear in the same orders as the product being viewed first, then fills the remaining spots from your catalog.",
    },
    view: {
      legend: "View",
      shopper: "What shoppers see",
      merchant: "What you see",
      cue: "Switch to “What you see” for the same bundle from your side.",
    },
    products: {
      kit: "Pour-over coffee set",
      filters: "Paper filters, 100 pack",
      grinder: "Hand grinder",
      mug: "Ceramic mug",
      towel: "Linen tea towel",
      scale: "Travel mug",
    },
    anchorTag: "Viewing this product",
    merchant: {
      heading: "How each product was ranked",
      intro: "A sample styled after the AICC dashboard; rules are set in the Merchant Controls form. The products and counts are invented.",
      sameBundle: "Same bundle as in the shopper view",
      forProduct: "Recommendations for",
      insightHeading: "An observation about this bundle",
      insightTitle: "Strong Bundle Opportunity",
      insightBody: "Pour-over coffee set and {product} are often bought together.",
      insightNone: "No strong bundle is left in the current list.",
      insightMetric: "Times bought together",
      askHeading: "Ask Reco",
      askLabel: "Sample answer",
      askQuestion: "What is my biggest opportunity?",
      askAnswer: "{product} is your strongest bundle with the pour-over set in this sample: bought together {n} times. Open Recommendation Preview to see the partners and counts for any product.",
      askNone: "No bought-together partner is left in this sample list. Open Recommendation Preview to see the partners for any product.",
      colProduct: "Product",
      colWhy: "Basis (illustration)",
      colRule: "Your rule",
      position: "Place {n}",
      boughtTogether: "Bought together {n} times",
      fallback: "No count: filled in from your catalog",
      fallbackNewest: "No count: one of your newest in-stock products",
      byRule: { pin: "Pinned by you", prefer: "Preferred by you", deprioritize: "Deprioritized by you", exclude: "Excluded by you" },
      inBundle: "Ticked in the shopper view",
      evidenceHeading: "How the list is built (illustration).",
      evidenceOrder: "AICC fills the list in this order: products bought together first, then the same category, then your newest in-stock products. Your rules apply last. In your dashboard, a learned partner (bought together in your orders) shows a count; a fallback (filled in from your catalog) or a pinned product shows only a price.",
      previewNote: "In your AICC dashboard, Recommendation Preview lets you pick any product and see its own list.",
      shopperNow: "The shopper sees now:",
      ruleLabel: "Rule for {product}",
      rules: { none: "No rule", pin: "Pin", prefer: "Prefer", deprioritize: "Deprioritize", exclude: "Exclude" },
      excluded: "Excluded: never shown to shoppers.",
      ruleNote: "Rules are applied after the ranking. Exclude wins over every other rule; prefer and deprioritize nudge one place.",
      tilesHeading: "What your dashboard records",
      tiles: { views: "Recommendation Views", clicks: "Recommendation Clicks", adds: "Bundle Add-To-Carts" },
      tileNote: "Sample numbers. Add the bundle to the cart in the shopper view and Bundle Add-To-Carts goes up by one.",
      tileAdded: "+1 from the add-to-cart you just made",
      announceRule: "{product}: {rule}. The shopper list is now: {list}.",
      announceNone: "{product}: no rule. The shopper list is now: {list}.",
      listEmpty: "nothing",
    },
    why: {
      heading: "Why this product (illustration)",
      recoIntro: "Reco is your guide inside AICC.",
      none: "Tick a product to see what this sample bases its place on.",
      filters: "Paper filters: bought together with the pour-over set more often than any other product in this sample.",
      grinder: "Hand grinder: bought together with the pour-over set less often than the filters, so it is listed next.",
      mug: "Ceramic mug: no purchase history for this pair in the sample, so this spot is filled in from the same category.",
      towel: "Linen tea towel: filled in from your newest in-stock products, after the bought-together partners and the same-category products.",
      without:
        "WooCommerce related products come from the same category, which is how they work by default. Nothing about them comes from what your shoppers buy together.",
      merchant:
        "A sample of how the list is built: how many times each product was bought together with the pour-over set, and which spots are filled in from your catalog.",
    },
    reco: {
      preview: "Reco: for the real partners and counts of any product, open Recommendation Preview in your dashboard.",
    },
    keyboardHint: "Use Tab and Space to tick products. Arrow keys move between them.",
    plainHint: "This is the WooCommerce related-products block: nothing to tick, no bundle total.",
    sample: "Sample",
  },

  // Kit module: brand/js/rules-demo.js ("Control, not a black box").
  rules: {
    label: "Sample data: not from a real store",
    heading: "What the widget would show",
    productLabel: "Product to apply a rule to",
    actionLabel: "Rule",
    actions: { pin: "Pin", prefer: "Prefer", deprioritize: "Deprioritize", exclude: "Exclude" },
    help: {
      none: "Choose a product and a rule. Choosing the same rule again removes it.",
      pin: "Keep this product near the top.",
      exclude: "Never show this product.",
      prefer: "Give this product a little extra priority.",
      deprioritize: "Lower this product's priority without removing it outright.",
    },
    effect: {
      none: "No rule on this product.",
      pin: "Pinned: it moves to the first place.",
      exclude: "Excluded: it is removed from the list. Exclude always wins.",
      prefer: "Preferred: it moves up one place.",
      deprioritize: "Deprioritized: it moves down one place.",
      stays: "No move this time: prefer and deprioritize nudge one place, never across groups, and not past a product with the same kind of rule.",
      outOfStock: "Out-of-stock products stay out, even when pinned.",
    },
    products: {
      filters: "Paper filters, 100 pack",
      grinder: "Hand grinder",
      kettle: "Gooseneck kettle",
      mug: "Ceramic mug",
      towel: "Linen tea towel",
      travel: "Travel mug",
    },
    evidence: { learned: "Bought together {n} times", fallback: "From the same category", outOfStock: "Out of stock" },
    tags: { pin: "Pinned", prefer: "Preferred", deprioritize: "Deprioritized", exclude: "Excluded" },
    place: "Place {n}",
    hiddenHeading: "Not shown to shoppers",
    hiddenNone: "Nothing is hidden.",
    reset: "Reset",
    activeHeading: "Rules in place",
    activeNone: "No rules yet.",
    announceList: "Widget list: {list}.",
    announceHidden: "Not shown: {list}.",
    announceReset: "All rules removed. The list is back to AICC's own order.",
    smallprint: "Illustration with sample products.",
  },

  // Kit module: brand/js/dash-preview.js. A styled replica of the real dashboard blocks, with the real labels.
  dash: {
    label: "Sample data: not from a real store",
    shopperTitle: "Shopper sees",
    youTitle: "You see",
    widgetTitle: "Frequently Bought Together",
    widgetSubtitle: "Customers often purchase these products together.",
    widgetAdd: "Add 3 products to cart",
    widgetTotal: "Bundle total",
    products: { kit: "Pour-over coffee set", filters: "Paper filters, 100 pack", grinder: "Hand grinder", mug: "Ceramic mug" },
    page: "AI Commerce Copilot",
    period: "Last 30 days",
    tiles: {
      views: "Recommendation Views",
      clicks: "Recommendation Clicks",
      rate: "Recommendation Click Rate",
      adds: "Bundle Add-To-Carts",
      orders: "Associated Orders",
      revenue: "Associated Revenue",
    },
    associationNote: "Orders and revenue are associated with the widget, not proof it caused them.",
    insightsHeading: "Merchant Insights",
    insightTitle: "Strong Bundle Opportunity",
    insightBody: "Pour-over coffee set and Paper filters, 100 pack are often bought together.",
    insightMetric: "Times bought together",
    insightGate: "Observations appear once you have at least 10 orders in the period; each kind also needs enough data of its own.",
    insightsLead: "Plain-English observations from fixed rules, not written by an AI. These four are the kinds AICC can show.",
    insightsBanner: "Top Recommendation",
    insightKinds: {
      hot: { title: "Top Performing Product", body: "Paper filters, 100 pack is one of your top sellers this period.", metric: "Share of store purchases", value: "24%" },
      bundle: { title: "Strong Bundle Opportunity", body: "Pour-over coffee set and Paper filters, 100 pack are often bought together.", metric: "Times bought together", value: "9" },
      interest: { title: "High Interest, Low Conversion", body: "Gooseneck kettle is added to carts often but bought less.", metric: "Add-to-cart count", value: "22" },
      winner: { title: "Recommendation Winner", body: "Hand grinder is getting a high share of the clicks on recommended products.", metric: "Recommendation clicks", value: "41" },
    },
    previewHeading: "Recommendation Preview",
    previewFor: "Recommendations for",
    previewLearned: "Bought together {n} times",
    callouts: {
      a: "Recommendation activity for the last 30 days.",
      b: "Orders and revenue associated with the widget within 24 hours of a bundle add.",
      c: "Plain-English observations from fixed rules, not an AI.",
      d: "Preview what AICC recommends for any product.",
    },
  },

  // Kit module: brand/js/reco-ask.js. A mockup of the Ask Reco panel in the WordPress admin, with sample questions.
  ask: {
    label: "Sample conversation",
    title: "Ask Reco",
    suggestionsLabel: "Choose a question for Reco",
    answerLabel: "Sample answer",
    footnote: "Answers come from your own dashboard data. Reco gives information and links; it never changes your settings. In your admin you can also type a short question, and Reco matches it to the topics it knows.",
    qa: {
      focus: {
        q: "What should I focus on today?",
        a: "Optional next step: import up to 24 months of your WooCommerce order history so AICC can learn which products your customers already buy together. Past orders are never imported unless you choose to; without it, AICC starts with catalog fallbacks and learns from new orders.",
        link: "Go to Order History",
      },
      opportunity: {
        q: "What is my biggest opportunity?",
        a: "Pour-over coffee set and Paper filters, 100 pack are bought together 9 times, your strongest bundle in this sample. Open Merchant Insights to see the other observations.",
        link: "Open Merchant Insights",
      },
      win: {
        q: "Give me one quick win.",
        a: "Pick one of your best sellers in Recommendation Preview and check that its partners look right. Pin a product to keep it near the top, or exclude one you don't want shown.",
        link: "Open Recommendation Preview",
      },
      help: {
        q: "What can you help me with?",
        a: "I can check your setup and data, help you read your dashboard numbers, point out bundle opportunities and catalog health, and link you to the right screen. I don't change settings or answer open-ended questions.",
        link: "",
      },
    },
  },

  // Kit markup: .aicc-loop. The merchandising loop as one strip; the same words go to brand/i18n/strings.json for the Control Plane.
  loop: {
    label: "How AICC works, step by step",
    title: "How it works, step by step",
    steps: ["Your orders", "Pairs found", "Shown to shoppers", "Clicks and carts counted", "Insights", "Your rules", "Learns from new orders"],
  },

  // Kit module: brand/js/faq-search.js (client-side filter for the Questions page; nothing is sent or stored).
  faqSearch: {
    label: "Search the questions",
    placeholder: "Try “refund”, “checkout” or “stores”",
    hint: "Searches the questions and answers on this page. Your search stays in your browser.",
    clear: "Clear",
    results: { one: "1 question matches “{q}”.", other: "{n} questions match “{q}”." },
    empty: "No question matches “{q}”. Try fewer words, or browse by topic.",
  },

  // Kit markup: .aicc-flow (brand/aicc-brand.css). The same words are exported to brand/i18n/strings.json for the Control Plane.
  flows: {
    order: {
      title: "When an order is placed",
      steps: ["Order placed", "Details queued in your store", "Sent to AICC in the background"],
      note: "Placing an order never waits on AICC.",
    },
    down: {
      title: "If AICC or its servers are slow or down",
      steps: ["AICC unavailable", "The widget hides", "WooCommerce's related products return"],
      note: "With the default setting, when the page's JavaScript runs.",
    },
    inactive: {
      title: "If your plan isn't active",
      steps: ["Plan not active", "No widget, no script, no new cookies", "WooCommerce works as usual"],
      note: "Nothing of AICC appears on your storefront.",
    },
  },

  home: {
    hero: {
      eyebrow: "Available for WooCommerce",
      category: "Commerce recommendation and merchandising copilot",
      titleLead: "Make every product page",
      titleAccent: "a smarter selling opportunity.",
      lead: "AICC turns your store data into better product recommendations on your product and cart pages, with the merchant insight and practical control to steer them.",
      confidence: {
        price: "Plans from {priceSolo} a year",
        guarantee: "14-day money-back guarantee on your first purchase",
        renewal: "No automatic renewal",
      },
    },
    pillars: {
      label: "What AICC gives you",
      a: { title: "Better recommendations", body: "Suggestions drawn from your own store data: what customers buy together, your catalog and your stock.", link: "See an example" },
      b: { title: "Less manual merchandising", body: "AICC finds the pairs in your orders. You keep the last word with a few rules, instead of curating every product.", link: "See the controls" },
      c: { title: "Visibility and control", body: "A dashboard, plain-English insights and a guide show what is recommended and how often it is bought together.", link: "See the workspace" },
    },
    demo: {
      title: "See what each recommendation is based on.",
      lead:
        "A shopper sees a short, relevant bundle. Switch to your side to see what is recommended and how often it is bought together, what you can change and what your dashboard records.",
    },
    why: {
      title: "Related products match by category. AICC starts from the basket.",
      lead:
        "WooCommerce's related products are a sensible default: they match products by category and tags. They can't tell you what people actually buy together.",
      points: {
        intent: {
          title: "Same category isn't the same intent.",
          body: "A grinder and a bag of coffee beans can sit in different categories and still go into the same basket. Category matching can't see that. Your orders can.",
        },
        evidence: {
          title: "Your orders are the evidence.",
          body: "AICC counts which products appear together in your completed and processing orders, and lists the most frequent partners first.",
        },
        fallback: {
          title: "Thin history gets a safe fallback.",
          body: "When a product has few co-purchases, the remaining spots are filled with fallbacks: in-stock products from the same category, then your newest in-stock products. Nothing is invented. Learned partners (products your orders show were bought together) and fallbacks share the widget heading today; your dashboard preview shows which is which.",
        },
      },
      link: "See how a recommendation is decided",
    },
    // A one-key unit on purpose: it can be retranslated without touching the workspace tabs.
    connectorNote: "A sample dashboard styled after the AICC admin",
    // One premium workspace replaces the standalone dashboard, Control and Meet Reco sections of the first deck (owner addendum F).
    workspace: {
      title: "More than a widget. A\u00a0merchandising workspace.",
      lead: "The storefront bundle is what shoppers see. Around it, AICC gives you a place in your WordPress admin to understand what is happening, steer it and decide what to do next.",
      connectorLink: "Back to the demo",
      tabsLabel: "What the AICC workspace gives you",
      understand: {
        tab: "Understand",
        title: "See what your recommendations are doing.",
        lead: "See what shoppers do with your recommendations: views, clicks and bundle add-to-carts from the last 30 days, and the orders and revenue associated with the widget. Preview what AICC recommends for any product, with how many times each partner was bought together.",
        note: "Orders and revenue are shown as association, not proof of cause. An associated order counts at its full order total.",
      },
      control: {
        tab: "Control",
        title: "Keep the final say.",
        lead: "Pin, prefer, deprioritize or exclude any product and watch the list respond. Exclude always wins.",
        note: "Rules can target one product pair or a product everywhere, and can expire. Out-of-stock and deleted products stay out even when pinned.",
        link: "How rules work in detail",
      },
      insights: {
        tab: "Find opportunities",
        title: "Spot what is worth acting on.",
        lead: "Plain-English observations from your own data: top sellers, strong bundles, products added to cart often but bought less, and which recommended products get the clicks.",
        note: "They come from fixed rules, not from a generative model.",
      },
      ask: {
        tab: "Ask Reco",
        title: "Ask Reco, your guide inside AICC.",
        lead: "Reco lives in your WordPress admin and answers common questions about your setup, performance and next steps from your own dashboard data, with links to the right screen.",
        note: "Reco follows fixed rules rather than generative AI, so it won't improvise. It answers in English and Hebrew, gives information and links, never changes your settings, and shoppers never see it.",
        link: "What Ask Reco can and can't do",
      },
    },
    how: {
      title: "Connect, learn, recommend.",
      lead: "You do the first step. AICC does the rest in the background.",
      steps: {
        connect: {
          title: "Connect",
          body: "Create your AICC account and choose a plan, install and activate the AICC plugin on your WooCommerce site, then connect your store from the AICC screen. Normally there is no license key to paste and no code to write.",
        },
        learn: {
          title: "Learn",
          body: "AICC prepares your catalog in the background. Once your store is ready, recommendations start with same-category and newest products, then move to real bought-together pairs as orders are counted. Import your past orders (optional) to start with pairs already learned.",
        },
        recommend: {
          title: "Recommend",
          body: "On product and cart pages, the Frequently Bought Together widget shows what your customers bought together. New orders keep teaching AICC, and your rules adjust the result.",
        },
      },
    },
    safety: {
      title: "A recommendation tool should never become a checkout dependency.",
      lead: "AICC is built so that if anything goes wrong, WooCommerce keeps selling.",
      points: {
        a: "Placing an order never waits on AICC. Order details are queued and sent in the background.",
        b: "If AICC or its servers are slow or down, the widget hides after a short wait.",
        c: "WooCommerce's own related products and cross-sells come back.",
        d: "If your plan isn't active, nothing of AICC appears on your storefront: no widget, no script, no new cookies.",
      },
      supporting:
        "AICC doesn't edit your products, prices or templates. Deactivate it and the native recommendations return. Tested with Storefront and a block theme.",
      link: "How your data is handled",
      more: "What happens if AICC is unavailable",
    },
    pricing: {
      title: "One full product. Priced by how many stores.",
      lead:
        "Every plan includes the storefront recommendations, the dashboard and insights, your rules, Ask Reco and an optional import of past orders. You only choose how many stores to connect. You stay in control: AICC never renews your plan automatically.",
      link: "See what every plan includes",
    },
    questions: {
      title: "Questions merchants ask before they buy.",
      lead: "Short answers first. The full list covers plans, data and what happens when you come back.",
    },
    final: {
      title: "Start on your own store.",
      body: "Create your account, choose a plan and connect your first store.",
      guarantee: "Your initial plan purchase includes a 14-day money-back guarantee. The 14 days start when payment is received and your plan is issued. See the [Refund Policy](route:refund-policy) for full terms.",
    },
  },

  product: {
    hero: {
      title: "Recommendations your store can explain.",
      lead:
        "AICC turns your store data into the recommendations shoppers see, plus the dashboard, insight and rules you use to understand and steer every one. Pin, exclude or nudge any product from WordPress.",
    },
    toc: {
      shopper: "Shopper experience",
      learn: "How it learns",
      sparse: "Thin history",
      dash: "Your dashboard",
      control: "Your controls",
      ask: "Ask Reco",
      measure: "Measurement",
      safety: "If AICC is down",
      history: "Past orders",
      stores: "Stores",
      compare: "Versus related products",
      limits: "Current scope",
    },
    shopper: {
      title: "What shoppers see",
      lead: "Today, AICC's recommendations reach shoppers as a Frequently Bought Together bundle on your product pages and on the cart page.",
      page: {
        title: "On a product page",
        body: "The product being viewed starts ticked. Shoppers tick the others and add the bundle to the cart in one step.",
      },
      cart: {
        title: "On the cart page",
        body: "The first item in the cart is the starting point. Shoppers add the bundle the same way.",
      },
      fit: {
        title: "On any screen",
        body: "The widget adapts to the width of the space it sits in, from phone to desktop, and follows your theme's direction, so right-to-left stores render right-to-left. It shows up to five rows: on a product page the viewed product plus up to four recommendations, on the cart page up to five, leaving out products already in the cart.",
      },
      only: "It appears on product pages and the cart page only. There is no home page, category or checkout widget. On an unusual theme where AICC can't find a safe place, it hides rather than guess.",
    },
    learn: {
      title: "How AICC decides what to recommend.",
      lead: "A short, fixed list, worked through in this order, with your rules applied last.",
      steps: {
        learned: {
          title: "Learned from your orders",
          body: "AICC looks at your completed and processing orders. When customers buy product A, which other products are in the same order? Those counts, highest first, are the recommendations.",
        },
        category: {
          title: "Same category",
          body: "If a product has too little purchase history to fill the widget, the remaining spots are filled with in-stock products from the same category.",
        },
        newest: {
          title: "Newest in stock",
          body: "If there are still spots left, AICC adds your newest in-stock products.",
        },
        rules: {
          title: "Your rules",
          body: "Pin, exclude, prefer and deprioritize are applied afterwards. Out-of-stock and deleted products stay out.",
        },
      },
    },
    // A one-key unit on purpose (product.learn keeps its translations): retranslate it alone.
    learnPlain:
      "Every recommendation can be explained: it comes from counting your own orders, from your catalog (same category, newest products) or from a rule you set, not from a generative model or a profile of the shopper. The same data gives the same result.",
    sparse: {
      title: "What happens when there isn't much history.",
      lead: "AICC fills the spots that purchase history can't.",
      p1: "The spots that purchase history can't fill are filled with in-stock products from the same category, then your newest in-stock products. As orders come in, real co-purchases take over from the fallbacks.",
      p2: "You can import up to 24 months of past orders (optional), so AICC can start from your history instead of from zero.",
      limitTitle: "In the widget",
      limit:
        "The widget heading is the same for every item. In the Recommendation Preview in your dashboard, learned partners show how many times they were bought together and fallback products show only a price, so you can always tell them apart.",
      slots: {
        caption: "Illustration with sample numbers: the four recommendations next to the viewed product on a product page, with two learned partners.",
        learned: "Bought together {n} times",
        category: "Same category",
        newest: "Newest in stock",
        slot: "Spot {n}",
      },
    },
    dash: {
      title: "See what the widget did.",
      lead: "A sample styled after the AICC dashboard in your WordPress admin. The numbers are invented.",
      readiness: "Readiness is setup readiness: connection, tracking, products and widget. It is not a sales measure.",
      items: {
        a: { title: "Recommendation activity", body: "Recommendation views, clicks and click rate, and bundle add-to-carts, for the last 30 days." },
        b: { title: "Associated orders and revenue", body: "Orders where a shopper added a bundle from the widget and bought one of those products within 24 hours. Association, not proof of cause." },
        c: { title: "Merchant Insights", body: "Plain-English observations from fixed rules, not written by an AI: top sellers, strong bundles, products added to cart often but bought less, and which recommended products get the clicks." },
        d: { title: "Recommendation Preview", body: "Pick any product and see what AICC recommends for it. Learned partners show how many times they were bought together; fallback products show only a price." },
      },
      gate: "Observations appear once you have at least 10 orders in the period; each kind also needs enough data of its own.",
      export: "You can export product performance as a CSV for 7, 30 or 90 days. Everything comes from your store's data; AICC doesn't project results.",
    },
    control: {
      title: "You keep the final say.",
      lead: "Add a rule for a product and watch the list respond. AICC does the heavy lifting; you decide where it should not.",
      tableCaption: "What each rule does",
      colRule: "Rule",
      colDoes: "What it does",
      rows: {
        pin: "Keeps the product near the top. If you pin several, the one set most recently comes first.",
        exclude: "Never shown. Always wins over every other rule.",
        prefer: "Nudges the product up one place.",
        deprioritize: "Nudges the product down one place, without removing it outright.",
      },
      scopeTitle: "Where a rule applies",
      scope:
        "A rule can target one product pair (when shoppers view product A, product B gets the action) or one product everywhere (it gets the action on every product's list). Rules can have an optional expiry date and an internal note. There are no rules by category.",
      guardTitle: "What a rule can't override",
      guard:
        "Out-of-stock and deleted products stay out, even when pinned. Prefer and deprioritize never move a product past one from another group (learned partners, same-category products, newest products). Only pin forces a position. The widget shows only a few products, so a deprioritized product at the last visible spot can slip out of view.",
    },
    ask: {
      title: "What Ask Reco adds.",
      lead: "Reco lives in your WordPress admin and helps you make sense of your store's data. Ask it a common question and it answers from your own dashboard data, with links to the right screens.",
      canTitle: "What it can do",
      can: {
        a: "Tell you whether your store is ready, and what to fix first.",
        b: "Explain why recommendations aren't showing.",
        c: "Help you read views, clicks, bundle add-to-carts and associated orders.",
        d: "Point out bundle opportunities and catalog health.",
        e: "Suggest a next step and link you to the right screen.",
      },
      cannotTitle: "What it can't do",
      cannot: {
        a: "Answer open-ended questions or write copy: it is built from fixed rules, not a generative model.",
        b: "Change your settings. It only gives information and links.",
        c: "Appear to shoppers. It is for merchants in the admin.",
        d: "Work in other languages yet: it answers in English and Hebrew.",
      },
      note: "Your questions are answered in your WordPress admin and are not sent to AICC.",
    },
    measure: {
      title: "How performance is measured.",
      lead: "See what happens after shoppers meet the widget: views, clicks, bundle add-to-carts and the orders that follow.",
      flow: {
        title: "When an order counts as associated",
        steps: ["Shopper adds a bundle from the widget", "Buys one of those products within 24 hours", "Order shown as associated, at its full order total"],
      },
      association:
        "AICC reports the orders and revenue associated with the widget and leaves the conclusion to you. Association shows where to look; it is not proof that the widget caused the sale, and AICC doesn't run a control group. An associated order counts at its full order total.",
      consent:
        "It also needs your store's cookie consent tool to allow statistics, through a consent plugin compatible with the WP Consent API. With none installed there are no cookies and no orders can be associated, though order facts are still sent because they are how recommendations are learned.",
      notTitle: "Not measured",
      not: {
        a: "Uplift compared with a control group.",
        b: "View-through, or clicks that never became a bundle add-to-cart.",
        c: "Orders from visitors who haven't consented to statistics.",
        d: "Orders from before you connected.",
        e: "Journeys that continue on another device.",
      },
    },
    safety: {
      title: "If AICC is ever unavailable, your store keeps selling.",
      lead: "Placing an order never waits on AICC, and the widget steps aside if AICC can't be reached.",
      conditions:
        "This applies with the default setting, where AICC's widget replaces WooCommerce's related products, and when the page's JavaScript runs.",
      limit:
        "Failures that stop PHP itself, such as a server running out of memory, are outside what any plugin can intercept. Tested with Storefront, a block theme and common plugins.",
      requirements:
        "Declared minimums: WordPress 6.0, WooCommerce 7.0 and PHP 7.4. Compatible with WooCommerce's high-performance order storage (HPOS).",
      light:
        "AICC doesn't edit your products, prices or templates. Deactivate it and the native recommendations return. Disconnect the store first to free its slot.",
      link: "What data is sent, and what is not",
    },
    history: {
      title: "Your past orders can give AICC a head start.",
      lead: "After your store is connected, AICC offers to import up to 24 months of your past orders, so recommendations can learn from your existing history. It is optional: you choose.",
      p1: "Skip it and AICC starts with same-category and newest-product recommendations, and learns from new orders. AICC doesn't import your past orders until you choose. Orders placed before you connected are not sent unless you import them; orders placed after connecting are sent as they are created or updated.",
      p2: "You can start the import later from the dashboard. It reads your orders and sends order facts to AICC without changing them in WooCommerce, orders already imported aren't duplicated, and you can cancel an import from the dashboard. Timing varies with catalog size and your site's scheduled tasks.",
      p3: "Coming back after a pause? AICC can preserve your store history when access pauses, so returning merchants can continue instead of starting from zero. If you imported your history, AICC catches up from your real WooCommerce history; a store that chose Not now is never imported without asking. It never invents impressions, clicks or revenue for the time it wasn't running.",
      link: "Exact retention, today and as our target",
      flowTitle: "If you choose to import",
      flow: ["Past orders from the last 24 months, if you choose", "Imported in the background", "Learned relationships"],
    },
    stores: {
      title: "More than one store.",
      lead: "Every plan has every feature. The only difference is how many stores you connect: 1, up to 3 or up to 10.",
      solo: "Solo",
      studio: "Studio",
      agency: "Agency",
      slots: "{n} store slots",
      slotsOne: "1 store slot",
      p1: "Each website address you connect uses one slot, and staging and production count as separate stores. Disconnecting a store frees its slot immediately.",
      link: "See Solo, Studio and Agency plans",
    },
    compare: {
      title: "Why AICC and not another related-products plugin?",
      lead: "Related products are a good default and they are always there. AICC adds what they don't try to do.",
      caption: "WooCommerce related products compared with AICC",
      colTopic: "What is compared",
      colWoo: "WooCommerce related products",
      colAicc: "AICC",
      rows: {
        chosen: { topic: "How products are chosen", woo: "Shared category and tags (plus hand-picked Upsells and Cross-sells)", aicc: "What customers in your store bought together; category and newest as fallbacks" },
        see: { topic: "What you can see", woo: "The block itself", aicc: "A dashboard: views, clicks, bundle add-to-carts, associated orders, observations" },
        control: { topic: "Control", woo: "Hand-picked Upsells and Cross-sells; related products themselves are automatic", aicc: "Rules: pin, exclude, prefer, deprioritize, pair-specific or everywhere" },
        explain: { topic: "Explainability", woo: "Simple: shared category or tag", aicc: "Counting you can inspect in the Recommendation Preview" },
        guide: { topic: "Guidance", woo: "None", aicc: "Ask Reco in your admin" },
        history: { topic: "History", woo: "Not used", aicc: "Optional import of up to 24 months of past orders" },
        fail: { topic: "If something fails", woo: "Native block", aicc: "Widget hides after a short wait; the native block returns" },
      },
    },
    limits: {
      title: "What AICC focuses on today.",
      lead: "Clear boundaries, so you know what to expect.",
      items: {
        a: "Recommendations follow the product, not the shopper: there is no per-shopper personalization.",
        b: "AICC recommends complementary products from your own orders and catalog. It isn't an upsell engine.",
        c: "The widget appears on product pages and the cart page, not on the home page, category pages or checkout.",
        d: "Ask Reco is for merchants and is built from fixed rules. It answers in English and Hebrew.",
        e: "The widget heading is the same for fallback products as for learned ones.",
        f: "Products that need an option choice, such as size or color, show a Choose options link instead of being added to the bundle, so a bundle never claims more than the cart contains.",
        g: "The plugin admin is in English and Hebrew.",
      },
    },
    languages: {
      title: "Languages.",
      lead: "What is available in which language.",
      caption: "Languages by part of AICC",
      colPart: "Part of AICC",
      colLangs: "Languages",
      rows: {
        site: { part: "This website and your account area", langs: "English, Hebrew (right-to-left), Spanish and Russian" },
        admin: { part: "The AICC admin in WordPress", langs: "English and Hebrew" },
        reco: { part: "Ask Reco", langs: "English and Hebrew" },
        widget: { part: "The storefront widget", langs: "English and Hebrew in full, plus core labels in Spanish, Russian, French, German and Arabic; one language per store, chosen in the plugin settings" },
      },
    },
    questions: { title: "Common questions about how it works." },
    safetyCta: { title: "See it on your own store.", body: "Create your account, choose a plan and connect your first store." },
    cta: { title: "Ready to see it on your store?", body: "Create your account, choose a plan and connect your first store." },
  },

  pricing: {
    hero: {
      title: "One full product. Pick how many stores.",
      lead: "Solo {priceSolo}, Studio {priceStudio} or Agency {priceAgency} a year. Every plan includes everything AICC does; the only difference is how many stores you can connect.",
    },
    plans: {
      solo: { name: "Solo", fit: "One live store. A staging site counts as a second store." },
      studio: { name: "Studio", fit: "A shop plus staging, or a few client stores." },
      agency: { name: "Agency", fit: "A portfolio of client stores." },
    },
    included: {
      title: "Every plan includes the full AICC product.",
      lead: "Before you look at prices, this is what you are buying.",
      items: {
        a: "Recommendations learned from your own orders",
        b: "Storefront recommendations on product and cart pages (the Frequently Bought Together bundle)",
        c: "A dashboard for views, clicks, bundle add-to-carts and associated orders",
        d: "Rules to pin, exclude, prefer or deprioritize products",
        e: "Plain-English observations from your store's data",
        f: "Ask Reco, your guide in WordPress",
        g: "Optional import of up to 24 months of past orders, so AICC can start from pairs already learned",
        h: "Website and account area in English, Hebrew, Spanish and Russian",
        i: "Your store keeps working if AICC doesn't",
      },
      outro: "Plans differ only by store capacity.",
    },
    plansSection: {
      title: "Three plans, priced by store capacity.",
      note: "All prices are in US dollars (USD). You confirm your plan in your AICC account.",
    },
    slots: {
      title: "How store slots work",
      p1: "Each plan has a number of store slots: 1, 3 or 10. Connecting a store uses a slot; disconnecting it frees the slot at once.",
      p2: "Staging and production count as separate stores. So do the www and bare-domain spellings of an address, and http and https.",
      p3: "To move your plan from one store to another: disconnect the old store, connect the new one. There is no transfer fee.",
      p4: "If all slots are used, disconnect a store you no longer need or buy a larger plan. There is no in-place upgrade: a larger plan is a separate purchase with its own 365-day term and store slots, and it does not credit or replace your current plan.",
    },
    which: {
      title: "Which plan?",
      lead: "Count the stores you want to connect.",
      items: {
        solo: "1 store",
        studio: "Up to 3 stores",
        agency: "Up to 10 stores",
      },
      outro: "Features are identical, so you are only choosing capacity. More than 10 stores? Contact support; no larger plan exists yet. Support address: {supportEmail}",
    },
    finder: {
      label: "How many stores will you connect?",
      hint: "How many websites will AICC run on? Staging counts as one.",
      error: "Enter a whole number from 1 to 10.",
      many: "More than 10 stores? Contact support; no larger plan exists yet.",
      resultSolo: "Solo covers 1 store in one plan.",
      resultStudio: "Studio covers up to 3 stores in one plan.",
      resultAgency: "Agency covers up to 10 stores in one plan.",
      empty: "Your suggestion appears here.",
      suggestion: "Smallest plan that fits",
    },
    terms: {
      title: "Term, renewal and refunds",
      try: {
        title: "Try it",
        body: "Your initial plan purchase includes a 14-day money-back guarantee. The 14 days start when payment is received and your plan is issued. Import your past orders (optional) on day one to see learned partners sooner. See the [Refund Policy](route:refund-policy) for full terms.",
      },
      renewal: {
        title: "Renewal",
        body: "You stay in control: AICC never renews your plan automatically. A plan is a fixed 365 days from purchase. To renew, you buy it from Plans & Stores in your account, and it adds 365 days to the later of today and your current end date, so renewing early keeps your unused time. AICC keeps no payment authorization for future charges.",
      },
      back: {
        title: "Coming back",
        body: "AICC can preserve your store history when access pauses, so returning merchants can continue instead of starting from zero. If your plan expired, renew the same plan and your stores return without reconnecting. If it was refunded, the old plan stays revoked: buy a new plan and connect the same store. AICC can recognize it if the store kept its connection.",
        link: "Exact retention, today and as our target",
      },
      account: "You need an AICC account to buy. Normally there is no license key to paste: you connect each store from its own AICC screen.",
    },
    questions: {
      title: "Questions about plans and refunds",
    },
    cta: {
      title: "Choose your plan",
      body: "You'll confirm your plan in your AICC account.",
    },
    teaser: {
      text: "Curious how the widget decides? Try it with sample products.",
      link: "Open the interactive demo",
    },
    final: {
      title: "Start with one store.",
      body: "Create your account, choose a plan and connect your first store.",
    },
  },

  questionsPage: {
    hero: {
      title: "Questions, answered plainly.",
      lead: "Straight answers, grouped by what you are trying to decide. If something isn't here, ask support. Support address: {supportEmail}",
    },
    top: {
      title: "Most asked before buying",
      lead: "The questions merchants read first. Short answers, with a link to the detail.",
    },
    search: {
      title: "Find an answer",
    },
    browse: {
      title: "Browse questions by topic",
    },
    nav: {
      label: "Jump to a topic",
      backToTop: "Back to the topics",
    },
  },

  // Legal and trust documents. Structure and review flags live in src/data/legal.ts.
  legal: {
    privacy: {
      title: "Privacy policy",
      intro: "How AICC handles information about visitors to this website, about the people who buy and manage plans, and about the stores they connect.",
      s: {
        who: {
          h: "Who this policy covers",
          a: "This policy covers three things: this website, your AICC account and purchases, and the data from stores you connect. Company details: {companyDetails}",
          b: "AICC is meant for businesses. When a merchant connects a store, information about that store's shoppers passes through AICC as described below.",
        },
        website: {
          h: "This website",
          a: "This website doesn't use analytics, advertising or tracking scripts, and it doesn't call third-party services when you visit. It stores your choices in your own browser: your language (a cookie called aicc_lang, kept for 1 year, and a matching local storage entry), a local storage entry called aicc_lang_dismissed that remembers you closed a language suggestion, and your accessibility settings (local storage). They stay on your device and are used only to show the site the way you chose.",
          b: "The language cookie is sent to the website host with page requests, like any cookie. Our hosting provider may keep ordinary server logs, such as the page requested and the IP address.",
        },
        account: {
          h: "Your account and purchases",
          a: "When you buy or manage a plan we process the details needed for that: your name, billing details, email address and the order history for your plans. We use them to sell and administer plans, to connect your stores and to give support.",
          b: "Payments are handled by a third-party payment processor, and AICC does not receive your shoppers' payment details. Payment processor: {paymentProcessor}",
        },
        storeData: {
          h: "Data from stores you connect",
          a: "Once a store is connected, AICC receives the following to produce recommendations, measure the widget and show your dashboard:",
          b: [
            "Catalog: product names, prices, SKUs, categories, stock status, a link to each product page and a link to each product image (not the image file itself). Catalog data contains no customer or order information.",
            "Orders: the products (including product names) and quantities, totals, currency, the billing country, visitor and session IDs where they exist and, for signed-in shoppers, the WooCommerce customer ID.",
            "A pseudonymous (hashed) email identifier, made on your store from your store ID and the shopper's email. AICC never receives the raw email, name, phone number or address.",
            "Never payment details of any kind.",
          ],
          c: "Order facts are sent from your store in the background as orders are created or changed. They are sent whether or not a shopper consented to statistics, because they are how recommendations are learned. Importing past orders is optional and starts only when you choose it. If you choose to import, orders from up to the last 24 months are sent as order facts only. Orders placed before you connected are not sent unless you choose to import them; orders placed after connecting are sent as they are created or updated.",
          d: [
            "With consent for statistics, AICC also receives: product, category and search-page views, including the words typed into on-site search; add-to-cart actions; the start of checkout; widget impressions, clicks and bundle adds.",
            "With that consent it also receives visitor and session IDs, the WordPress user ID of signed-in shoppers, a coarse device and browser type and the referring page address.",
          ],
          e: "Shopper IP addresses are processed on your site and are not sent to AICC. Hashes used for rate limiting or identifiers are pseudonymous, not irreversible.",
        },
        cookies: {
          h: "Cookies on your store",
          a: "AICC can set two first-party cookies on your storefront to measure the widget.",
          b: [
            "A visitor ID, kept for 1 year.",
            "A session ID, kept for 30 minutes.",
            "Both need an active plan, your store's tracking setting on, and a consent plugin compatible with the WP Consent API that grants statistics. With none installed AICC treats consent as not given: no cookies, no visitor tracking, and no orders can be associated with the widget.",
          ],
          c: "These identifiers are pseudonymous, not anonymous. They don't contain a shopper's name or contact details, but they can be linked across visits and may count as personal data where you live.",
        },
        use: {
          h: "What we use it for",
          a: [
            "Producing recommendations from your store's orders.",
            "Showing your dashboard, insights and Ask Reco answers.",
            "Measuring the widget: impressions, clicks, bundle adds and associated orders.",
            "Running, securing and supporting the service.",
          ],
        },
        separate: {
          h: "Stores are kept apart",
          a: "Everything AICC stores is scoped to the one store it belongs to. No store can see another store's data, and data is not shared between your stores.",
        },
        retention: {
          h: "How long data may be kept",
          a: "Operational data (catalog-derived state, imported order history, configuration, your rules and recommendation learning) is covered by two statements. **Our retention target (up to 12 months).** It may be kept for up to 12 months after AICC access ends, so a returning merchant can continue instead of starting from zero.",
          b: "**What happens today (nothing is deleted automatically).** No automatic deletion exists yet, so operational data may be kept longer than 12 months until it is deleted on request.",
          c: "Account, purchase, license, refund and audit records follow separate retention, for accounting, legal and security reasons. They are not part of the 12-month figure.",
          d: "If you come back, AICC can recognize your store if it still has its AICC connection; a reinstall that lost the connection starts as a new store. When a returning store is recognized, its history is available again and AICC brings its copy of the catalog up to date. If you chose to import your order history, it also catches up on the orders from the gap; if you did not, it imports nothing without asking.",
        },
        requests: {
          h: "Deletion and export requests",
          a: "Contact support from your account email to ask for deletion or export of your data. These requests are handled by hand: there is no self-service button. Deletion removes events, impressions, clicks and conversions and anonymizes orders. The store record, configuration, catalog-derived data and license and audit records follow their own retention, and WooCommerce may require some records to be kept. Exports are prepared manually. We tell you which records are kept. Support address: {supportEmail}",
        },
        security: {
          h: "Security",
          a: "Connections between your store, AICC and the account site use HTTPS. License keys and store credentials are stored hashed. No security measure is perfect, and we don't promise AICC is invulnerable.",
        },
        transfers: {
          h: "Where data is processed",
          a: "We don't yet state a hosting region or a transfer mechanism, and we don't claim a selectable data location. Hosting region: {hostingRegion}",
        },
        rights: {
          h: "Your rights",
          a: "Depending on where you live you may have rights over your information, such as access, correction, deletion and export. Ask support. Nothing here limits rights you have under the law where you live. Support address: {supportEmail}",
        },
        changes: {
          h: "Changes and contact",
          a: "When this policy changes we will update it and the date at the top of the page.",
          b: "Questions? Support address: {supportEmail}",
        },
      },
    },

    terms: {
      title: "Terms of service",
      intro: "The terms for using AICC plans and connecting stores. These are written in plain language from how AICC actually works.",
      s: {
        agreement: {
          h: "Who these terms are between",
          a: "These terms are between you and the company that operates AICC. By buying a plan or connecting a store you agree to them. Company details: {companyDetails}",
          b: "AICC is for business use. If you use it for a company or client, you confirm you can accept these terms for them.",
        },
        service: {
          h: "What AICC is",
          a: "AICC is a commerce recommendation and merchandising copilot, available for WooCommerce as a plugin with a hosted service. It adds product recommendations learned from your store's orders (shown to shoppers as a Frequently Bought Together bundle), a dashboard, rule-based insights, merchant controls and Ask Reco.",
          b: "AICC does not replace WooCommerce. Your products, cart, checkout and orders stay in WooCommerce.",
        },
        account: {
          h: "Your account",
          a: "You need an AICC account to buy a plan. Keep your sign-in details safe; you are responsible for what happens under your account.",
        },
        plans: {
          h: "Plans, stores and term",
          a: "A plan lasts 365 days from purchase. Each plan lets you connect a number of stores:",
          b: [
            "Solo: 1 store, {priceSolo} per year.",
            "Studio: up to 3 stores, {priceStudio} per year.",
            "Agency: up to 10 stores, {priceAgency} per year.",
          ],
          c: "Every plan has every feature. Staging and production count as separate stores. You can disconnect a store to free its slot and connect another. There is no in-place upgrade: a larger plan is a separate purchase with its own 365-day term and store slots; it does not credit or replace your current plan.",
        },
        fees: {
          h: "Fees and renewal",
          a: "Prices are in US dollars, per plan, per year. Payments are processed by a third-party payment processor. Payment processor: {paymentProcessor}",
          b: "Renewal is manual. Nothing is charged automatically, and no authorization to charge you again is stored. A renewal you buy adds 365 days to the later of today and your current end date.",
        },
        refunds: {
          h: "Refunds",
          a: "The 14-day money-back guarantee on an initial purchase is described in the [refund policy](route:refund-policy), together with its exceptions.",
        },
        yourStore: {
          h: "Your store and your shoppers",
          a: "You are responsible for having the right to connect your store, and for telling your shoppers about the data your store collects, including any cookie notice and consent setup your law requires.",
          b: "Order and catalog data you send is used to run AICC for you, as described in the [privacy policy](route:privacy).",
        },
        outcomes: {
          h: "No guaranteed results",
          a: "Recommendations are an aid. We don't promise any sales, revenue or conversion outcome. The dashboard shows orders associated with the widget; that is association, not proof that the widget caused them.",
        },
        availability: {
          h: "Availability",
          a: "Placing an order never waits on AICC: order details are queued and sent to AICC in the background. AICC is built to fail soft: if AICC or its backend is slow or unavailable, the recommendation widgets simply hide and WooCommerce keeps working. We don't promise the service will always be available or free of errors.",
          b: "AICC may be unavailable for maintenance or for reasons outside our control.",
        },
        inactive: {
          h: "When a plan isn't active",
          a: "When a plan expires, is revoked or suspended, or a store is disconnected, AICC stops on the affected storefront and the store stops sending business data. WooCommerce keeps working as before.",
          b: "After a full refund the plan is revoked permanently and is not revived; you can buy a new plan.",
        },
        changes: {
          h: "Changes",
          a: "We may change AICC or these terms. We will update the date on this page. If you disagree with a change you can stop using AICC.",
        },
        liability: {
          h: "Warranties and liability",
          a: "AICC is provided as is, to the extent the law allows. Limits on our liability are being finalized with legal review.",
          b: "Nothing here limits rights you have under the law where you live that cannot be limited.",
        },
        law: {
          h: "Governing law",
          a: "Governing law and courts: {governingLaw}",
        },
        contact: {
          h: "Contact",
          a: "Questions about these terms? Support address: {supportEmail}",
        },
      },
    },

    refund: {
      title: "Refund policy",
      intro: "A 14-day money-back guarantee on the initial purchase of a plan. Here is exactly how it works.",
      s: {
        guarantee: {
          h: "The guarantee",
          a: "If AICC isn't right for you, you can ask for your money back within 14 days of the initial purchase of a plan.",
          b: "The guarantee is a promise from us. It does not replace any right you have by law.",
        },
        start: {
          h: "When the 14 days start",
          a: "The 14 days start when payment is received and your plan is issued, not when the order was first created.",
        },
        renewals: {
          h: "Renewals",
          a: "The guarantee covers the initial purchase. Later manual renewals aren't automatically covered.",
        },
        duplicate: {
          h: "A purchase made twice by mistake",
          a: "A purchase made twice by mistake can be refunded on request. For example, two plans bought for the same store in the same transaction window: once the duplicate is identified, it is eligible for a refund even after the 14 days. This is separate from the 14-day guarantee, and it is not an exception to it.",
        },
        how: {
          h: "How to ask",
          a: "Email support from your account email within the 14 days and name the order. Support address: {supportEmail}",
          b: "We aim to reply within one business day and to resolve straightforward requests promptly after that. This is a service target, not a contractual deadline. An approved refund goes to the original payment method where the payment processor allows it.",
        },
        exceptions: {
          h: "Exceptions",
          a: [
            "Abuse: repeated purchase-and-refund cycles that look aimed at free use.",
            "Chargebacks: starting a card chargeback instead of asking us can suspend the plan while it is resolved.",
            "Payment-processor and tax limits on the amount or method of a refund.",
          ],
        },
        after: {
          h: "After a full refund",
          a: "The plan is revoked and AICC stops working on your connected stores. Your WooCommerce store keeps selling: products, orders, customers and checkout are unaffected.",
          b: "A revoked plan is never revived. If you come back, you buy a new plan.",
        },
        data: {
          h: "Your data after a refund",
          a: "Data AICC holds about your stores follows the retention described in the [privacy policy](route:privacy).",
          b: "**Our retention target (up to 12 months).** Operational data may be kept for up to 12 months after access ends.",
          c: "**What happens today (nothing is deleted automatically).** No automatic deletion exists yet, so data may be kept longer than 12 months until it is deleted on request.",
          d: "Account and purchase records follow their own retention.",
        },
        nothingElse: {
          h: "Plans and renewal",
          a: "There is no in-place upgrade: a larger plan is a separate purchase with its own 365-day term and store slots; it does not credit or replace your current plan.",
          b: "AICC never renews a plan automatically and keeps no authorization to charge you again, so there is nothing to cancel.",
        },
        rights: {
          h: "Your rights",
          a: "Nothing in this policy limits rights you have under the law where you live. Payment processor: {paymentProcessor}",
        },
      },
    },

    dataTrust: {
      title: "Data and trust",
      intro: "AICC never receives your shoppers' names, raw email addresses, phone numbers, street addresses or payment details. Here is exactly what it does read, and what it never does. The [privacy policy](route:privacy) is the full text.",
      short: {
        h: "The short version",
        needsTitle: "AICC needs",
        needs: [
          "Your product catalog",
          "Order relationships: which products were in which orders, with totals, currency, billing country, the customer ID for signed-in customers and a hashed email identifier",
          "Optional shopper activity, only if your cookie consent tool allows statistics",
        ],
        neverTitle: "AICC does not receive",
        never: [
          "Raw email addresses",
          "Names",
          "Phone numbers",
          "Street addresses",
          "Payment details",
          "Shopper IP addresses (processed on your site, not sent)",
        ],
        receives: "It does receive pseudonymous identifiers (a hashed email, customer and visitor IDs), billing country and order contents.",
        note: "We call these identifiers pseudonymous, not anonymous. The sections below say exactly what is sent, which cookies can be set and how long data may be kept.",
      },
      s: {
        reads: {
          h: "What AICC reads from your store",
          a: "When you connect a store, AICC receives what it needs to learn which products are bought together:",
          b: [
            "Catalog: names, prices, categories, images, SKUs, product links and stock status.",
            "Orders: products and product names, quantities, totals, currency, billing country, visitor and session IDs where they exist, the WooCommerce customer ID for signed-in customers, and a pseudonymous (hashed) email identifier. Orders of every status are sent; only completed and processing orders are counted for recommendations.",
            "Past orders from up to the last 24 months, only if you choose to import them. AICC doesn't import your past orders until you choose: orders placed before you connected are not sent unless you import them, and orders placed after connecting are sent as they are created or updated.",
          ],
        },
        never: {
          h: "What AICC never receives",
          a: [
            "The raw email address, name, phone number or street address of a shopper.",
            "Payment details of any kind.",
            "Shopper IP addresses: they are processed on your site and not sent to AICC. Hashes are pseudonymous, not irreversible.",
            "We don't call this data anonymous. Pseudonymous identifiers can still count as personal data, so we say what is sent.",
          ],
        },
        cookies: {
          h: "Cookies and consent",
          a: "Cookies and visitor-level events need an active plan, tracking turned on in your store, and a consent plugin compatible with the WP Consent API that grants statistics. Then AICC sets two first-party cookies on your storefront to measure the widget.",
          b: [
            "A visitor ID, kept for 1 year.",
            "A session ID, kept for 30 minutes.",
          ],
          c: "With no such consent plugin there are no cookies and no visitor tracking, and no orders can be associated with the widget. Order facts are still sent, because they are how recommendations are learned.",
          d: [
            "With consent for statistics AICC also receives: product, category and search-page views, including the words typed into on-site search; add-to-cart actions; the start of checkout; widget impressions, clicks and bundle adds.",
            "With that consent it also receives visitor and session IDs, the WordPress user ID of signed-in shoppers, a coarse device and browser type and the referring page address.",
          ],
        },
        apart: {
          h: "Stores are kept apart",
          a: "Each store's data is kept separate. One store can't see another store's data, and data is not shared between your stores.",
        },
        woo: {
          h: "What AICC changes in WooCommerce",
          a: "AICC doesn't edit WooCommerce's products, prices or templates. It adds a few private fields to orders (visitor and session IDs, only with cookie consent) and by default hides WooCommerce's related-products block while its widget shows. Deactivate it and the native recommendations return.",
        },
        outage: {
          h: "If AICC or your plan is unavailable",
          a: "AICC may fail; WooCommerce must keep working.",
          b: [
            "If AICC is slow or unavailable the widget hides and WooCommerce's own related products return.",
            "If your plan isn't active, nothing of AICC appears on your storefront: no widget, no script and no new cookies. Cookies already in browsers stay there, and nothing reads them.",
            "If a store is disconnected, no store data is sent. A technical registration check still runs.",
          ],
        },
        retention: {
          h: "Your history can be kept when access pauses",
          a: "**Our retention target:** operational data (catalog-derived state, imported order history, your rules and what AICC learned) may be kept for up to 12 months after access ends, so a returning merchant can continue instead of starting from zero.",
          b: "**What happens today:** nothing is deleted automatically, so data may be kept longer until it is deleted on request. Account, purchase, license, refund and audit records follow separate retention.",
          c: "When you return, AICC brings its copy of your catalog up to date. If you chose to import your order history, it also catches up on the orders from the gap; if you didn't, it imports nothing without asking. It never invents recommendation history for the time it wasn't running.",
        },
        requests: {
          h: "Ask us to delete or export",
          a: "Email support from your account email. These requests are handled by hand. Deletion removes events, impressions, clicks and conversions and anonymizes orders; the store record, configuration, catalog-derived data and license and audit records follow their own retention, and WooCommerce may require some records to be kept. Exports are prepared manually. Support address: {supportEmail}",
        },
        pending: {
          h: "What we haven't finalized",
          a: "Some details are not yet published: the company details, support address, governing law, payment processor and hosting region. They will be published before launch.",
        },
      },
    },

    accessibility: {
      title: "Accessibility statement",
      intro: "We want this website to be usable by everyone who visits it, including people who use a keyboard, a screen reader, zoom, or high contrast.",
      s: {
        commitment: {
          h: "Our commitment",
          a: "We want everyone to be able to use this website. We work on accessibility as part of how the site is built, not as an add-on.",
        },
        target: {
          h: "What we aim for",
          a: "We aim for WCAG 2.2 level AA. We do not claim full compliance or certification: we test, fix what we find, and tell you what we know is still wrong.",
        },
        done: {
          h: "What we have done",
          a: [
            "Semantic landmarks, one main heading per page and a sequential heading order.",
            "A skip link. The main journeys can be used with a keyboard: automated tests cover the header, the menus, the accessibility dialog, the language switcher, the questions and the interactive demo, and hand testing of the full journeys continues.",
            "A visible focus ring on every control, with enough contrast on light and dark backgrounds.",
            "Text and interface colors checked against WCAG contrast ratios by a script. Our targets are at least 44 pixels for buttons and controls and at least 24 pixels for links inside text.",
            "Reduced motion honored from your system setting and from our own control, including smooth scrolling.",
            "Right-to-left layout for Hebrew, built with logical properties, with mixed-direction text such as prices and brand names kept in order.",
            "No audio and no third-party accessibility overlay. The one looping video at the top of the home page is muted, plays only while it is on screen, can be paused and does not play when you reduce motion. The accessibility settings (reduce motion, higher contrast, larger text) are stored only in your browser.",
          ],
        },
        limits: {
          h: "Known limitations",
          a: [
            "The sign-in, account and checkout pages live on a separate site, and payments are handled by a third-party payment processor. We can't promise those pages meet the same standard.",
            "Hebrew, Spanish and Russian texts have not yet been reviewed by native speakers, including for accessibility.",
            "Automated and manual checks cannot confirm everything, such as whether alternative text is the best description or whether the reading order feels natural with every screen reader. We have not tested with a screen reader or with every combination of browser and assistive technology.",
            "The Reco illustrations contain short words inside the pictures. They are decorative and the same information is in the page text.",
          ],
        },
        report: {
          h: "Report a barrier",
          a: "If something on this website is hard to use, write to support. Tell us the page, what you tried and the assistive technology you use if you're comfortable sharing it. We aim to reply promptly and to fix real barriers. Support address: {supportEmail}",
        },
        review: {
          h: "Last review",
          a: "This statement was last reviewed on {date}, after automated accessibility checks on every page in all four languages at a phone and a desktop width, on the five main pages at five widths, and with higher contrast and reduced motion switched on, plus automated keyboard tests of the main controls.",
        },
        jurisdiction: {
          h: "Legal frameworks",
          a: "Accessibility law differs by country. We have not made any statement of conformance under a specific national law, and this section needs legal review before we do.",
        },
      },
    },
  },
};

export type Dictionary = typeof en;
