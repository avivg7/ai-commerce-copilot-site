/**
 * English source dictionary. The shape of this object is the contract for he.ts, es.ts and ru.ts
 * (they are typed `Dictionary`, so a missing key is a compile error; `npm run i18n:check` adds value checks).
 *
 * Mini-markup inside strings:
 *   **bold**                 -> <strong>
 *   [label](route:pricing)   -> internal, locale-aware link (route ids from src/lib/routes.ts)
 *   [label](https://...)     -> external link
 *   {priceSolo}              -> values from plans.ts / owner config (see src/lib/rich.tsx for the full list)
 *   {companyDetails} {supportEmail} {governingLaw} {paymentProcessor} {hostingRegion}   ({legalName} and {address} feed {companyDetails})
 *                            -> owner-supplied values; until set they render ONE plain muted line (pending.line / pending.detail)
 * Terminology follows content-source.md section 8 (Control Plane repo, docs/unified-experience/).
 * Never translate: AICC, Reco, WooCommerce, WordPress, Solo, Studio, Agency, prices.
 */
export const en = {
  meta: {
    siteName: "AI Commerce Copilot",
    ogImageAlt: "AICC: Frequently Bought Together, learned from your own store's orders. With Reco, the AICC guide.",
    pages: {
      home: {
        title: "AICC: Frequently Bought Together, learned from your own orders",
        description:
          "AICC adds a Frequently Bought Together widget to your WooCommerce product and cart pages, learned from your store's own orders. Plans from {priceSolo} a year.",
      },
      product: {
        title: "How AICC works for WooCommerce stores",
        description:
          "What shoppers see, what you control, how AICC decides what to recommend, what data it uses, and what it does not do yet.",
      },
      pricing: {
        title: "Pricing: Solo, Studio and Agency plans",
        description:
          "Solo {priceSolo}, Studio {priceStudio} and Agency {priceAgency} per year. Same features on every plan; only the number of stores differs. Manual renewal and a 14-day money-back guarantee.",
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
        title: "Questions we get, honestly answered",
        description:
          "All 40 questions about what AICC does, plans and stores, renewal, refunds, data and what happens when access pauses.",
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
    },
    getStarted: "Get started",
    seeHow: "See how it works",
    seePricing: "See pricing",
    seeAllQuestions: "See all 40 questions",
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
      tagline: "A Frequently Bought Together widget for WooCommerce, learned from your own orders.",
      productHeading: "AICC",
      trustHeading: "Trust and legal",
      languageHeading: "Language",
      copyright: "© {year} {name}",
      note: "AICC is a WooCommerce plugin. WooCommerce and WordPress are trademarks of their respective owners.",
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
      recommended: "Recommended for 2 to 3 stores",
      sameFeatures: "Every feature, on every plan",
      countHelper: "Count the stores you want to connect: 1 is Solo, 2 to 3 is Studio, 4 to 10 is Agency.",
      term: "365 days from purchase",
      renewal: "Manual renewal: nothing is charged automatically",
      guarantee: "14-day money-back guarantee on your first purchase",
      usd: "All prices are in US dollars (USD).",
    },
    toc: "On this page",
    lastReviewed: "Last reviewed",
    draftUpdated: "Draft last updated",
    version: "Status",
    versionDraft: "Draft",
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
    modal: {
      title: "Product demo",
      close: "Close",
      placeholder: "The product demo video will appear here.",
      placeholderBadge: "placeholder",
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
  demo: {
    label: "Illustrative demo: not store data",
    heading: "Try the widget",
    groupLabel: "Products in this bundle",
    intro:
      "Tick the products and watch the bundle total change. The products, prices and link strengths below are invented, so no store data or results are shown here.",
    nudge: "Start with \"Without AICC\", then switch to \"With AICC\".",
    summary: "Selected: {count}. Bundle total: {total}.",
    dashboard: {
      heading: "What you would see in your AICC dashboard (illustration)",
      explain: "Strong link means the two products were in the same orders most often. This is sample data, not a result.",
    },
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
      legend: "What the shopper sees",
      without: "Without AICC",
      with: "With AICC",
      captionWithout: "Reco: same category, not from orders.",
      captionWith: "Reco: bought together most often.",
      withoutCaption:
        "WooCommerce's own related products come from the same category or tags. They are not based on what shoppers buy together.",
      withCaption: "AICC lists the products that appear in the same orders as the product being viewed.",
    },
    products: {
      kit: "Pour-over coffee set",
      filters: "Paper filters, 100 pack",
      grinder: "Hand grinder",
      kettle: "Gooseneck kettle",
      mug: "Ceramic mug",
      towel: "Linen tea towel",
      scale: "Travel mug",
    },
    anchorTag: "Viewing this product",
    strength: {
      label: "Link to the product being viewed",
      strong: "Strong link",
      medium: "Medium link",
      light: "Light link",
      none: "Same category only",
    },
    why: {
      heading: "Why these",
      none: "Tick a product to see why AICC pairs it with the pour-over set.",
      filters:
        "In this sample store's orders, paper filters appear with the pour-over set more than anything else. They are used up with every brew, so shoppers come back for them.",
      grinder:
        "A hand grinder is a medium link here: shoppers setting up a pour-over routine often add one, but not every time.",
      kettle:
        "A kettle is a light link. It shows up in some orders with the pour-over set, so AICC lists it after the stronger partners.",
      without:
        "Without AICC, these are just products from the same category. Nothing about them comes from what your shoppers buy together.",
    },
    reco: {
      intro: "Reco: tick a product and I'll tell you how strongly it is tied to the pour-over set.",
      strong: "Reco: paper filters are used up with every brew, so they come first.",
      medium: "Reco: a grinder is a medium link. Plenty of orders include both, but not most.",
      light: "Reco: a kettle is a light link. AICC would list it after stronger partners.",
      without: "Reco: these come from the category, not from orders.",
    },
    keyboardHint: "Use Tab and Space to tick products. Arrow keys move between them.",
    sample: "Sample",
  },

  home: {
    hero: {
      eyebrow: "Frequently Bought Together for WooCommerce",
      titleLead: "Show shoppers what your own customers",
      titleAccent: "buy together.",
      lead:
        "AICC adds a Frequently Bought Together widget to your WooCommerce product and cart pages. It learns from your store's own orders, so what shoppers see comes from your catalog and your customers, not from a generic list. Where a product has little history, AICC fills the gaps from the same category and your newest products, and says so.",
      facts: {
        price: "Plans from {priceSolo} a year",
        guarantee: "14-day money-back guarantee on your first purchase",
        noCharge: "Nothing is ever charged automatically",
      },
      cardLabel: "Illustrative widget",
      cardTitle: "Frequently Bought Together",
    },
    demo: {
      title: "Frequently-bought-together, actually learned.",
      lead: "Most \"related products\" are the same category with a different label. AICC looks at what customers put in the same order, then fills any gaps in a way it tells you about.",
    },
    how: {
      title: "How it works",
      lead: "Three steps. You do the first one; AICC does the rest in the background.",
      steps: {
        connect: {
          title: "Connect",
          body: "Sign in to your AICC account and connect the store from its own AICC screen in WordPress. Normally there is no licence key to paste, and no code to write.",
        },
        learn: {
          title: "Learn",
          body: "AICC prepares your store in the background: it syncs your catalog, imports up to the last 24 months of past orders and checks that the widget is ready. This starts when you open the AICC dashboard in WordPress or when WordPress's scheduled tasks run, so we don't promise a number of minutes.",
        },
        recommend: {
          title: "Recommend",
          body: "On product and cart pages the widget shows what your customers bought together. New orders keep teaching AICC, and your own rules adjust the result.",
        },
      },
    },
    control: {
      title: "You decide, and WooCommerce keeps working.",
      lead: "AICC is a WooCommerce plugin. It doesn't replace WooCommerce: your products, cart, checkout and orders stay where they are.",
      items: {
        rules: {
          title: "Rules you control",
          body: "Pin a product, prefer it, deprioritise it or exclude it. Rules apply after the algorithm and exclude always wins. Products that are out of stock or deleted stay out whatever the rule says.",
        },
        dashboard: {
          title: "A dashboard that stays honest",
          body: "Readiness, widget views and clicks, and the orders associated with the widget. Plain-English observations from your own data appear once you have at least 10 purchases in the period shown.",
        },
        checkout: {
          title: "Not on your checkout path",
          body: "Checkout doesn't wait for AICC: AICC makes no network call to its servers while a customer checks out. Order details are queued and sent in the background.",
        },
        failSoft: {
          title: "If AICC is unavailable",
          body: "The widget hides itself and WooCommerce's own related products and cross-sells come back. Built to fail soft and tested, but not a guarantee against every host failure.",
        },
        dormant: {
          title: "If your plan isn't active",
          body: "Nothing of AICC appears on your storefront: no widget, no script and no new cookies. Cookies already in browsers stay there, and nothing reads them.",
        },
        remove: {
          title: "Light touch on WooCommerce",
          body: "AICC doesn't edit WooCommerce's products, prices or templates. It adds a few private fields to orders (visitor and session IDs, only with cookie consent) and by default hides WooCommerce's related-products block while its widget shows. Deactivate it and the native recommendations return.",
        },
      },
      caveat: "We tested with Storefront and a block theme and can't promise every theme or host.",
      history: "Your history can be kept when access pauses.",
    },
    reco: {
      title: "Meet Reco, the guide inside AICC.",
      lead: "Reco shows up where it helps: explaining how recommendations work, answering questions in your admin, and keeping you company while your store is prepared.",
      points: {
        one: "Ask Reco answers in English and Hebrew.",
        two: "Works from your own dashboard data. It is not a general chatbot.",
        three: "Gives information and links. It never changes your settings.",
        four: "Merchant-only: shoppers never see it.",
      },
    },
    pricing: {
      title: "Simple yearly plans.",
      lead: "Prices are per plan, per year, in US dollars. Every plan has every feature; only the number of stores differs. Renewal is manual and nothing is charged automatically.",
      link: "Compare plans and read the details",
    },
    questions: {
      title: "Questions we get, honestly answered.",
      lead: "A short selection. The full list has all 40.",
    },
    final: {
      title: "Ready when your store is.",
      body: "Create your account, choose a plan and connect your first store. The 14-day money-back guarantee covers your initial purchase.",
    },
  },

  product: {
    hero: {
      title: "How AICC works, in more detail.",
      lead: "What shoppers see, what you control, how a recommendation is decided and where the limits are. Written for a store owner, not an engineer.",
    },
    toc: {
      shopper: "What shoppers see",
      merchant: "What you see and control",
      decide: "How a recommendation is decided",
      data: "What data AICC uses",
      measure: "Measuring the widget",
      import: "Importing your history",
      multi: "More than one store",
      safe: "When something goes wrong",
      returning: "Coming back later",
      languages: "Languages",
      notYet: "What AICC doesn't do yet",
    },
    shopper: {
      title: "What shoppers see",
      p1: "A Frequently Bought Together widget on your product pages and on the cart page. On a product page, the product being viewed starts ticked and shoppers can tick the others and add the bundle to the cart in one step. On the cart page, the first item in the cart is the starting point and products already in the cart are left out.",
      p2: "The widget adapts to the width of the space it sits in, on phones as well as desktop. It follows your theme's direction, so right-to-left stores render right-to-left.",
      p3: "It appears on product pages and the cart page only. There is no home page, category or checkout widget.",
    },
    merchant: {
      title: "What you see and control",
      p1: "In your WordPress admin there is a dashboard with technical readiness, widget views, clicks and bundle adds, and the orders and revenue associated with the widget. Insights are plain-English, rule-based observations from your own data (top products, strong bundles, high-interest low-purchase products, widget performance), shown once there are at least 10 purchases in the period shown. They are deterministic. They are not written by an AI.",
      p2: "You can pin, prefer, deprioritise or exclude a product, for one pair or everywhere. Rules apply after the algorithm; exclude always wins; out-of-stock and deleted products stay out whatever the rule.",
      p3: "Ask Reco answers common questions about setup, performance and next steps from your dashboard data. It works for merchants in the admin, can't change settings, and is not shown to shoppers.",
    },
    decide: {
      title: "How a recommendation is decided",
      lead: "In this order, with your rules applied last:",
      steps: {
        learned: {
          title: "Learned from your orders",
          body: "AICC looks at your completed and processing orders. When customers buy product A, which other products are in the same order? Those counts, highest first, are the recommendations. It is plain counting on AICC's backend: no generative AI, no per-shopper profile.",
        },
        category: {
          title: "Same category",
          body: "If a product has too little purchase history to fill the widget, the remaining spots are filled with other products from the same category.",
        },
        newest: {
          title: "Newest in stock",
          body: "If there are still spots left, AICC adds your newest in-stock products.",
        },
        rules: {
          title: "Your rules",
          body: "Pin, prefer, deprioritise and exclude are applied last. Out-of-stock and deleted products are filtered out.",
        },
      },
      honest:
        "One thing to know: today the widget heading is the same for all of these. So a product with little history can show same-category or newest products under \"Frequently Bought Together\". We tell you this rather than imply every item is a proven co-purchase.",
    },
    data: {
      title: "What data AICC uses",
      p1: "Your catalog (names, prices, categories, images, stock status) and order facts (products and product names, quantities, totals, currency, billing country, visitor and session IDs where they exist, and a pseudonymous hashed email identifier). It never receives the raw email, name, phone or address, or any payment details. With cookie consent for statistics it also receives shopping activity, as described on the [data and trust page](route:data-and-trust).",
      p2: "Each store's data is kept separate from every other store's. The data and trust page lists what is sent and what is not.",
    },
    measure: {
      title: "Measuring the widget",
      p1: "The dashboard shows widget impressions, clicks and bundle adds, plus orders and revenue associated with the widget. An order is counted only when a shopper added a bundle from the widget and bought one of those products within 24 hours. The full order total is counted.",
      p2: "That is association, not causation: it does not say the widget caused the sale. It needs your store's cookie consent to allow statistics, through a consent plugin compatible with the WP Consent API. With none installed there are no cookies, and no orders can be associated with the widget. Order facts themselves are still sent to AICC, because they are how recommendations are learned.",
    },
    import: {
      title: "Importing your history",
      p1: "After you connect, AICC imports up to the last 24 months of your past orders in the background, so recommendations can learn from day one. Past orders are imported as orders. They are never shown as recommendation history, and no impressions, clicks or attributed revenue are created for a time when AICC wasn't connected.",
      p2: "It is not instant: it starts when you open the AICC dashboard in WordPress or when WordPress's scheduled tasks run, and the timing depends on your store's size. You can cancel an import from the AICC dashboard; a cancelled import is started again when a returning store is caught up. The widget doesn't need the import to appear; without it AICC starts from category and newest-product fallbacks and learns from new orders.",
    },
    multi: {
      title: "More than one store",
      p1: "Solo connects 1 store, Studio up to 3, Agency up to 10. Staging and production are separate stores, and so are www and non-www or http and https spellings of the same address. Disconnecting a store frees its slot immediately.",
      p2: "See [pricing](route:pricing) for how slots work, and for what happens if you need a larger plan.",
    },
    safe: {
      title: "When something goes wrong",
      p1: "Checkout doesn't wait for AICC: AICC makes no network call to its servers while a customer checks out. Order details are queued and sent in the background. If AICC or its backend is slow or unavailable, the widget hides and WooCommerce's own related products and cross-sells return. This is built to fail soft and tested; it is not a guarantee against every possible host failure, such as a server running out of memory.",
      p2: "On an unusual theme where AICC can't find a safe place for the widget, it hides rather than guess. A developer can help in that case. AICC doesn't edit WooCommerce's products, prices or templates; deactivate it and the native recommendations return.",
    },
    returning: {
      title: "Coming back later",
      p1: "Renew the same plan and your stores return without reconnecting. If a plan was refunded, buy a new plan and connect the same store: AICC can recognise it if the store still has its AICC connection, and your history may be available again, because operational data may be kept for up to 12 months. Today nothing is deleted automatically, so data may be kept longer until it is deleted on request. A reinstall that lost the connection starts as a new store. A refunded plan is never revived.",
    },
    languages: {
      title: "Languages",
      p1: "This website and your account area: English, Hebrew (right-to-left), Spanish and Russian. The AICC admin in WordPress: English and Hebrew. The storefront widget: English and Hebrew in full, plus the core labels (heading, buttons, messages) in Spanish, Russian, French, German and Arabic.",
    },
    notYet: {
      title: "What AICC doesn't do yet",
      items: {
        a: "Personalised recommendations for each shopper. Recommendations are based on the product, not the person.",
        b: "Upselling. AICC recommends products bought together; it doesn't suggest pricier alternatives.",
        c: "A widget on the home page, category pages or checkout.",
        d: "A shopper-facing assistant. Ask Reco is for merchants only.",
        e: "A different widget heading for same-category and newest-product fallbacks.",
        f: "A setting to turn off the automatic import before it starts.",
      },
      outro: "We'd rather list these than let you find out later.",
    },
    demoHeading: "See it working",
  },

  pricing: {
    hero: {
      title: "Three plans. One difference.",
      lead: "Every plan has every feature. The only difference is how many stores you can connect.",
    },
    plans: {
      solo: { name: "Solo", fit: "One store." },
      studio: { name: "Studio", fit: "A shop plus staging, or a few client stores." },
      agency: { name: "Agency", fit: "A portfolio of client stores." },
    },
    included: {
      title: "What every plan includes",
      items: {
        a: "The Frequently Bought Together widget on product and cart pages",
        b: "Dashboard, rule-based insights and the CSV export of product performance",
        c: "Pin, prefer, deprioritise and exclude rules",
        d: "Ask Reco in your WordPress admin",
        e: "Import of up to 24 months of past orders",
        f: "English, Hebrew, Spanish and Russian website and account area",
      },
    },
    slots: {
      title: "How store slots work",
      p1: "Each plan has a number of store slots: 1, 3 or 10. Connecting a store uses a slot; disconnecting it frees the slot at once.",
      p2: "Staging and production count as separate stores. So do the www and bare-domain spellings of an address, and http and https.",
      p3: "To move your plan from one store to another: disconnect the old store, connect the new one. There is no transfer allowance and no extra fee.",
      p4: "If all slots are used, disconnect a store you no longer need or buy a larger plan. There is no in-place upgrade: a larger plan is a separate purchase with its own 365-day term and store slots, and it does not credit or replace your current plan.",
    },
    which: {
      title: "Which plan?",
      lead: "Count the stores you want to connect.",
      items: {
        solo: "1 store",
        studio: "2 to 3 stores",
        agency: "4 to 10 stores",
      },
      outro: "Features are identical, so you are only choosing capacity. More than 10 stores? Contact support; no larger plan exists yet. Support address: {supportEmail}",
    },
    finder: {
      label: "How many stores will you connect?",
      hint: "Enter a whole number from 1 to 10.",
      error: "Enter a whole number from 1 to 10.",
      resultSolo: "Solo covers 1 store.",
      resultStudio: "Studio covers up to 3 stores.",
      resultAgency: "Agency covers up to 10 stores.",
      empty: "Your suggestion appears here.",
      suggestion: "Suggested plan",
    },
    terms: {
      title: "Term, renewal and refunds",
      items: {
        term: "A plan lasts 365 days from purchase.",
        renewal: "Renewal is manual. You buy it from Plans & Stores in your account, and it adds 365 days to the later of today and your current end date, so renewing early keeps your unused time.",
        billing: "There is no recurring billing, and no authorisation to charge you again is stored. Nothing is ever charged automatically.",
        guarantee: "A 14-day money-back guarantee covers your initial purchase. The 14 days start when payment is received and the plan is issued. It doesn't automatically cover later renewals. The refund policy lists the exceptions (abuse, duplicate purchases, chargebacks, payment-processor and tax limits).",
        account: "You need an AICC account to buy. Normally there is no licence key to paste: you connect each store from its own AICC screen.",
      },
      policy: "Read the refund policy",
    },
    refunds: {
      p1: "After a full refund the plan is revoked and AICC stops on your stores. WooCommerce is unaffected.",
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
  },



  questionsPage: {
    hero: {
      title: "Questions we get, honestly answered.",
      lead: "All 40, grouped by topic. If something isn't here, ask support. Support address: {supportEmail}",
    },
    topics: {
      basics: "What AICC does",
      plans: "Plans and stores",
      billing: "Renewal and billing",
      refunds: "Refunds",
      pause: "When access pauses, and coming back",
      data: "Data and privacy",
      reliability: "Reliability and safety",
      languages: "Languages, mobile and compatibility",
    },
  },

  faq: {
    items: {
      q01: {
        q: "What exactly does AICC do?",
        a: "It adds a Frequently Bought Together recommendation widget to your product and cart pages, learned from your own store's orders, and gives you a dashboard, rule-based insights, product controls and an assistant (Ask Reco) in your WordPress admin. It does not replace WooCommerce.",
      },
      q02: {
        q: "How does AICC decide what to recommend?",
        a: "It looks at the orders in your store and counts which products are bought together. Where a product has little history, it fills the remaining spots with products from the same category, then your newest in-stock products. Your own rules (pin, prefer, deprioritise, exclude) are applied afterwards. There is no generative AI in this decision.",
      },
      q03: {
        q: "Does AICC replace WooCommerce?",
        a: "No. It is a WooCommerce plugin. Your products, cart, checkout and orders stay in WooCommerce.",
      },
      q04: {
        q: "What happens if AICC is unavailable?",
        a: "The widget hides itself and WooCommerce's own related products return. Your store keeps selling.",
      },
      q05: {
        q: "Will my checkout ever depend on AICC?",
        a: "No. Checkout doesn't wait for AICC: AICC makes no network call to its servers while a customer checks out. Order details are queued and sent in the background. Built to fail soft and tested; not a guarantee against every host failure.",
      },
      q06: {
        q: "Do I need a developer?",
        a: "No code and no setup wizard. AICC places the widget at standard WooCommerce locations. If it can't find a safe place on an unusual theme, it hides rather than guess; a developer can help in that case.",
      },
      q07: {
        q: "How long does setup take?",
        a: "You connect the store, and AICC prepares it in the background: catalog, past orders and a readiness check. This starts when you open the AICC dashboard in WordPress or when WordPress's scheduled tasks run, and how long it takes depends on the size of your catalog, so we don't promise a number.",
      },
      q08: {
        q: "Do I need to paste a licence key?",
        a: "Normally no. You sign in to your AICC account and connect each store from its own AICC screen.",
      },
      q09: {
        q: "What's the difference between Solo, Studio and Agency?",
        a: "Only how many stores you can connect: 1, 3 or 10. Everything else is identical.",
      },
      q10: {
        q: "Do the plans have different features?",
        a: "No. Every plan has every feature.",
      },
      q11: {
        q: "How do I connect a second or third store?",
        a: "Open AICC in the other store's WordPress admin, sign in to the same AICC account and choose the plan. It uses a free slot on your plan.",
      },
      q12: {
        q: "What happens when all my store slots are used?",
        a: "You can disconnect a store you no longer need, or buy a larger plan. A larger plan is a separate purchase with its own 365-day term and store slots; it does not credit or replace your current plan. Plans & Stores shows what's available.",
      },
      q13: {
        q: "Can I disconnect one store and connect another?",
        a: "Yes. Disconnecting frees the slot immediately.",
      },
      q14: {
        q: "Can I reconnect a store later?",
        a: "Yes, as long as your plan is active and has a free slot. You don't buy again and you don't need a key.",
      },
      q15: {
        q: "What happens to the disconnected store?",
        a: "AICC stops there: no widget on the storefront and no store data sent (a technical registration check still runs). WooCommerce works as normal. The store's AICC history may be kept for up to 12 months, but today nothing is deleted automatically, so data may be kept longer until it is deleted on request. Reconnecting can pick up where it left off.",
      },
      q16: {
        q: "What happens to the recommendation widget when my plan isn't active?",
        a: "AICC shows no widget, loads no script and sets no new cookies on the storefront, and WooCommerce's native recommendations show instead. Cookies already in browsers stay there, and nothing reads them.",
      },
      q17: {
        q: "What happens if my licence expires?",
        a: "After 365 days the plan ends. AICC stops on your stores until you renew; WooCommerce is unaffected.",
      },
      q18: {
        q: "Is renewal automatic?",
        a: "No. You renew by hand when you choose to.",
      },
      q19: {
        q: "Will you charge me automatically?",
        a: "No. There is no recurring billing and no stored payment authorisation.",
      },
      q20: {
        q: "How do I renew?",
        a: "From Plans & Stores in your account. Renewing early keeps your unused time.",
      },
      q21: {
        q: "What happens to my data if my plan expires?",
        a: "Operational data may be kept for up to 12 months after access ends, but today nothing is deleted automatically, so data may be kept longer until it is deleted on request. Account and purchase records follow separate rules.",
      },
      q22: {
        q: "What happens if I come back later?",
        a: "Renew the same plan and your stores return without reconnecting. If your plan was refunded, buy a new plan and connect the same store: AICC can recognise it if the store still has its AICC connection, and your history may be available again. A reinstall that lost the connection starts as a new store. A refunded plan is never revived.",
      },
      q23: {
        q: "Is my previous store history retained?",
        a: "Possibly. Operational data may be kept for up to 12 months after access ends, but today nothing is deleted automatically, so data may be kept longer until it is deleted on request.",
      },
      q24: {
        q: "What happens to products and orders created while AICC was inactive?",
        a: "When you return, AICC brings its copy of your catalog up to date (including products you deleted) and imports the orders from the gap through the same history import used at first connection.",
      },
      q25: {
        q: "Do you fabricate recommendation history for the inactive period?",
        a: "Never. Past orders are imported as orders. No impressions, clicks or attributed revenue are created for a time when AICC wasn't running.",
      },
      q26: {
        q: "What is the 14-day refund policy?",
        a: "A 14-day money-back guarantee on the initial purchase of a plan. The full [refund policy](route:refund-policy) lists the exceptions (abuse, duplicate purchases, chargebacks, payment-processor and tax limits). A refund goes to the original payment method where the processor allows it.",
      },
      q27: {
        q: "When do the 14 days start?",
        a: "When payment is received and your plan is issued.",
      },
      q28: {
        q: "Does the 14-day guarantee apply to renewals?",
        a: "The guarantee covers the initial purchase. Later manual renewals aren't automatically covered.",
      },
      q29: {
        q: "What happens after a full refund?",
        a: "The plan is revoked and AICC stops on your stores. Your WooCommerce store is unaffected.",
      },
      q30: {
        q: "Does a refund affect my WooCommerce store?",
        a: "No. Products, orders, customers and checkout remain as they were.",
      },
      q31: {
        q: "Is the historical-order import required?",
        a: "It starts automatically after connecting, because it's how recommendations learn from day one, and covers up to the last 24 months. It isn't required for the widget to appear; without it AICC begins with category and newest-product fallbacks and learns from new orders.",
      },
      q32: {
        q: "Can I choose not to import historical orders?",
        a: "You can cancel an import from the AICC dashboard; a cancelled import is started again when a returning store is caught up. There is no setting to turn the automatic import off before it starts.",
      },
      q33: {
        q: "What shopper and store data does AICC process?",
        a: "Your catalog (names, prices, categories, images, stock status) and order facts (products and product names, quantities, totals, currency, billing country, visitor and session IDs where they exist, and a pseudonymous hashed email identifier; never the raw email, name, phone or address, and never payment details). If your store's cookie consent grants statistics through a WP Consent API-compatible consent plugin, AICC also receives shopping activity (product, category and search-page views including the words typed into on-site search, add-to-cart actions, the start of checkout, widget impressions, clicks and bundle adds, the WordPress user ID of signed-in shoppers, a coarse device and browser type and the referring page address) and sets two first-party cookies: a visitor ID (1 year) and a session ID (30 minutes). With no such consent plugin there are no cookies and no visitor tracking. Order facts are sent either way.",
      },
      q34: {
        q: "Is data shared between my different stores?",
        a: "No. Each store's data is kept separate.",
      },
      q35: {
        q: "Can one store see another store's data?",
        a: "No. Everything AICC stores is scoped to the one store it belongs to.",
      },
      q36: {
        q: "How can I request deletion or export of my data?",
        a: "Contact support from your account email. Support address: {supportEmail} We handle these requests by hand: deletion removes events, impressions, clicks and conversions and anonymises orders; the store record, configuration, catalog-derived data and licence and audit records follow their own retention, and WooCommerce may require some records to be kept. Exports are prepared manually, and we tell you if a record must be kept.",
      },
      q37: {
        q: "Which languages are supported?",
        a: "This website and the account area: English, Hebrew, Spanish and Russian. The AICC admin in WordPress: English and Hebrew. The storefront widget: English and Hebrew in full, plus core labels in Spanish, Russian, French, German and Arabic.",
      },
      q38: {
        q: "Does AICC work on mobile?",
        a: "The widget adapts to the width of the space it sits in, on phones as well as desktop. This website and your account area are designed for phones first.",
      },
      q39: {
        q: "What happens if I change my theme?",
        a: "AICC finds its place using standard WooCommerce hooks, not theme edits, so it usually keeps working after a theme change. On a theme it can't safely place in, it hides instead of guessing. We tested with Storefront and a block theme, and can't promise every theme.",
      },
      q40: {
        q: "Can I remove AICC without harming WooCommerce?",
        a: "Yes. AICC doesn't edit WooCommerce's products, prices or templates. It adds a few private fields to orders (visitor and session IDs, only with cookie consent) and by default hides WooCommerce's related-products block while its widget shows. Disconnect the store in Plans & Stores first to free its slot, then deactivate AICC and the native recommendations return.",
      },
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
            "Catalog: product names, prices, categories, images and stock status.",
            "Orders: the products (including product names) and quantities, totals, currency, the billing country, visitor and session IDs where they exist and, for signed-in shoppers, the WooCommerce customer ID.",
            "A pseudonymous (hashed) email identifier, made on your store from your store ID and the shopper's email. AICC never receives the raw email, name, phone number or address.",
            "Never payment details of any kind.",
          ],
          c: "Past orders from up to the last 24 months are imported when you connect, as orders only. Order facts are sent whether or not a shopper consented to statistics, because they are how recommendations are learned.",
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
          a: "Operational data (catalog-derived state, imported order history, configuration, your rules and recommendation learning) may be kept for up to 12 months after AICC access ends, so a returning merchant can continue instead of starting over. Today nothing is deleted automatically, so data may be kept longer until it is deleted on request.",
          b: "Account, purchase, licence, refund and audit records follow separate retention, for accounting, legal and security reasons. They are not part of the 12-month figure.",
          c: "If you come back, AICC can recognise your store if it still has its AICC connection, and your history may be available again. A reinstall that lost the connection starts as a new store.",
        },
        requests: {
          h: "Deletion and export requests",
          a: "Contact support from your account email to ask for deletion or export of your data. These requests are handled by hand: there is no self-service button. Deletion removes events, impressions, clicks and conversions and anonymises orders. The store record, configuration, catalog-derived data and licence and audit records follow their own retention, and WooCommerce may require some records to be kept. Exports are prepared manually. We tell you which records are kept. Support address: {supportEmail}",
        },
        security: {
          h: "Security",
          a: "Connections between your store, AICC and the account site use HTTPS. Licence keys and store credentials are stored hashed. No security measure is perfect, and we don't promise AICC is invulnerable.",
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
          a: "AICC is a WooCommerce plugin with a hosted service. It adds a Frequently Bought Together widget learned from your store's orders, a dashboard, rule-based insights, merchant controls and Ask Reco.",
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
          c: "Every plan has every feature. Staging and production count as separate stores. You can disconnect a store to free its slot and connect another. A larger plan is a separate purchase with its own 365-day term and store slots; it does not credit or replace your current plan.",
        },
        fees: {
          h: "Fees and renewal",
          a: "Prices are in US dollars, per plan, per year. Payments are processed by a third-party payment processor. Payment processor: {paymentProcessor}",
          b: "Renewal is manual. Nothing is charged automatically, and no authorisation to charge you again is stored. A renewal you buy adds 365 days to the later of today and your current end date.",
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
          a: "AICC is built to fail soft, so that WooCommerce keeps working if AICC or its backend is slow or unavailable. We don't promise the service will always be available or free of errors.",
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
          a: "AICC is provided as is, to the extent the law allows. Limits on our liability are being finalised with legal review.",
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
        how: {
          h: "How to ask",
          a: "Email support from your account email within the 14 days and name the order. Support address: {supportEmail}",
          b: "We handle refund requests personally and usually reply within one business day; that is an expectation, not a guarantee. An approved refund goes to the original payment method where the payment processor allows it.",
        },
        exceptions: {
          h: "Exceptions",
          a: [
            "Abuse: repeated purchase-and-refund cycles that look aimed at free use.",
            "Duplicate purchases: a purchase made twice by mistake can be refunded on request.",
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
          a: "Operational data may be kept for up to 12 months, but today nothing is deleted automatically, so data may be kept longer until it is deleted on request; see the [privacy policy](route:privacy). Account and purchase records follow their own retention.",
        },
        nothingElse: {
          h: "Nothing else to cancel",
          a: "There is no recurring billing, so there is nothing further to cancel after a refund.",
        },
        rights: {
          h: "Your rights",
          a: "Nothing in this policy limits rights you have under the law where you live. Payment processor: {paymentProcessor}",
        },
      },
    },

    dataTrust: {
      title: "Data and trust",
      intro: "A plain-language summary. The [privacy policy](route:privacy) is the full text.",
      s: {
        reads: {
          h: "What AICC reads from your store",
          a: "When you connect a store, AICC receives what it needs to learn which products are bought together:",
          b: [
            "Catalog: names, prices, categories, images and stock status.",
            "Orders: products and product names, quantities, totals, currency, billing country, visitor and session IDs where they exist, and a pseudonymous (hashed) email identifier.",
            "Past orders from up to the last 24 months, imported as orders.",
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
          a: "Operational data (catalog-derived state, imported order history, your rules and what AICC learned) may be kept for up to 12 months after access ends, but today nothing is deleted automatically, so data may be kept longer until it is deleted on request.",
          b: "Account, purchase, licence, refund and audit records follow separate retention.",
          c: "When you return, AICC brings its copy of your catalog up to date and imports the orders from the gap. It never invents recommendation history for the time it wasn't running.",
        },
        requests: {
          h: "Ask us to delete or export",
          a: "Email support from your account email. These requests are handled by hand. Deletion removes events, impressions, clicks and conversions and anonymises orders; the store record, configuration, catalog-derived data and licence and audit records follow their own retention, and WooCommerce may require some records to be kept. Exports are prepared manually. Support address: {supportEmail}",
        },
        pending: {
          h: "What we haven't finalised",
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
            "Text and interface colours checked against WCAG contrast ratios by a script. Buttons and controls are at least 44 pixels high, and links inside text at least 24 pixels.",
            "Reduced motion honoured from your system setting and from our own control, including smooth scrolling.",
            "Right-to-left layout for Hebrew, built with logical properties, with mixed-direction text such as prices and brand names kept in order.",
            "No audio, no autoplaying video and no third-party accessibility overlay. Your accessibility settings are stored only in your browser.",
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
          a: "This statement was last reviewed on {date}, after automated checks on every page in all four languages at phone and desktop widths, and automated keyboard tests of the main controls.",
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
