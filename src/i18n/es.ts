import type { Dictionary } from "./en";
import type { DeepPartial } from "./merge";
import { eaEs } from "./ea/es";

/**
 * Spanish dictionary (neutral international Spanish, formal "usted"). A PARTIAL dictionary in shape (see merge.ts), but every unit of en.ts is
 * translated, so nothing falls back to English. Machine draft: texts have not yet been reviewed by native speakers (see common.draft.translation).
 * Legal text under `legal.*` is a draft translation pending native legal review. FAQ translations live in brand/content/faq.es.json.
 *
 * Conventions a native reviewer should check:
 *  - The plugin admin is English-only (and Hebrew), so labels that are REAL admin labels stay in English inside the site's UI replicas:
 *    Recommendation Views / Clicks / Click Rate, Bundle Add-To-Carts, Associated Orders / Revenue, Merchant Insights, Recommendation Preview,
 *    Strong Bundle Opportunity and the other insight titles, "Bought together {n} times", the rule names Pin / Prefer / Deprioritize / Exclude,
 *    "Go to Order History". The text around them is Spanish and carries a short Spanish gloss where it helps ("Pin (fijar)").
 *  - The storefront widget strings are the plugin's own Spanish strings (class-aicc-widget.php get_widget_strings()), verbatim.
 *  - A number keeps its unit on one line (no-break space in "30 días"). Ordinary typography only: copy:check bans the 30-day REFUND / TRIAL claim (the guarantee is 14 days), not the dashboard period "últimos 30 días".
 */
export const es: DeepPartial<Dictionary> = {
  meta: {
    siteName: "AI Commerce Copilot",
    ogImageAlt: "AICC: recomendaciones de producto, información para el comerciante y control del merchandising para WooCommerce. Un boceto sencillo de una página de producto con un paquete recomendado.",
    pages: {
      home: {
        title: "AI Commerce Copilot: recomendaciones y merchandising para WooCommerce",
        description: "AI Commerce Copilot convierte los datos de su tienda en recomendaciones relevantes en sus páginas de producto y de carrito, con la información y el control para orientarlas. Disponible para WooCommerce.",
      },
      product: {
        title: "Cómo funciona AICC: recomendaciones que puede explicar y controlar",
        description: "Vea lo que ven los compradores, cómo decide AICC qué recomendar, qué puede medir y controlar, y cómo evita interferir con su proceso de pago.",
      },
      pricing: {
        title: "Precios: planes Solo, Studio y Agency de AICC",
        description: "Todos los planes incluyen el producto AICC completo. Plan Solo {priceSolo}, Studio {priceStudio}, Agency {priceAgency} al año, según el número de tiendas. Renovación manual y garantía de devolución del dinero de 14 días.",
      },
      dataTrust: {
        title: "Datos y confianza: qué lee AICC y qué no",
        description: "Los datos de tienda y de pedidos que usa AICC, las cookies que puede establecer, cómo se mantienen separadas las tiendas y cuánto tiempo pueden conservarse los datos.",
      },
      privacy: {
        title: "Política de privacidad",
        description: "Cómo trata AICC la información del sitio web, de las cuentas y de las tiendas conectadas.",
      },
      terms: {
        title: "Términos del servicio",
        description: "Los términos para usar los planes de AICC y conectar tiendas.",
      },
      refund: {
        title: "Política de reembolso: garantía de devolución del dinero de 14 días",
        description: "Una garantía de devolución del dinero de 14 días en su compra inicial de un plan, cuándo empieza y qué ocurre después de un reembolso.",
      },
      accessibility: {
        title: "Declaración de accesibilidad",
        description: "Cómo aspiramos a cumplir el nivel AA de WCAG 2.2 en este sitio web, qué hemos hecho, las limitaciones conocidas y cómo informar de una barrera.",
      },
      questions: {
        title: "Preguntas sobre AICC, con respuestas claras",
        description: "Respuestas directas sobre qué hace AICC, cómo funcionan las recomendaciones, planes y tiendas, renovación y reembolsos, datos y qué ocurre cuando se pausa el acceso.",
      },
      notFound: {
        title: "Página no encontrada",
        description: "Esta página no existe.",
      },
    },
  },
  pending: {
    line: "Se confirmará antes de que se abran las compras.",
    detail: "Se confirmará antes de que se abran las compras.",
  },
  // Early Access campaign copy (Production 20): rendered only by an Early Access build, see src/lib/earlyAccess.ts.
  ea: eaEs,

  common: {
    skip: "Saltar al contenido principal",
    nav: {
      label: "Principal",
      product: "Producto",
      pricing: "Precios",
      dataTrust: "Datos y confianza",
      questions: "Preguntas",
      menu: "Menú",
      account: "Cuenta",
    },
    pageNames: {
      product: "Producto",
      pricing: "Precios",
      dataTrust: "Datos y confianza",
      privacy: "Política de privacidad",
      terms: "Términos del servicio",
      refund: "Política de reembolso",
      accessibility: "Accesibilidad",
      questions: "Preguntas",
      dpa: "Adenda de tratamiento de datos",
    },
    getStarted: "Empezar",
    seeHow: "Ver cómo funciona",
    seePricing: "Ver precios",
    seeAllQuestions: "Ver todas las preguntas",
    readHistory: "Lea cómo se puede conservar su historial",
    learnMoreProduct: "Cómo funciona AICC",
    home: "Inicio de AICC",
    language: {
      label: "Idioma",
      choose: "Elegir idioma",
      current: "actual",
    },
    langSuggest: {
      label: "Sugerencia de idioma",
      text: "Esta página también está disponible en español.",
      accept: "Continuar en español",
      dismiss: "Ahora no",
    },
    a11y: {
      button: "Accesibilidad",
      title: "Ajustes de accesibilidad",
      intro: "Estos ajustes se guardan solo en este navegador. Modifican este sitio web; no cambian nada más.",
      motion: "Reducir movimiento",
      motionHelp: "Detiene las animaciones y transiciones.",
      contrast: "Mayor contraste",
      contrastHelp: "Texto más oscuro y bordes más marcados.",
      text: "Texto más grande",
      textHelp: "Hace todo el texto un 19% más grande, aproximadamente.",
      reset: "Restablecer todo",
      close: "Cerrar",
      statement: "Leer la declaración de accesibilidad",
      disclaimer: "Estos controles son una comodidad. Por sí solos no hacen que este sitio web sea conforme.",
      storage: "Los ajustes se guardan en este navegador (almacenamiento local).",
    },
    footer: {
      tagline: "Recomendaciones de producto, información para el comerciante y control del merchandising para WooCommerce, a partir de sus propios pedidos.",
      productHeading: "AICC",
      trustHeading: "Confianza y legal",
      languageHeading: "Idioma",
      copyright: "© {year} {name}",
      note: "AICC está creado para WooCommerce y no está afiliado ni respaldado por WooCommerce ni por WordPress. WooCommerce y WordPress son marcas de sus respectivos propietarios.",
    },
    breadcrumbs: {
      label: "Ruta de navegación",
    },
    draft: {
      badge: "En proceso de finalización",
      text: "Esta página se está ultimando y puede cambiar antes de que se abran las compras. Los datos marcados como “se confirmarán” se añadirán entonces; ninguno se rellena con suposiciones.",
      translation: "Los textos en hebreo, español y ruso aún no han sido revisados por hablantes nativos. Esta traducción es un borrador y además necesita un revisor legal nativo. Si difiere del texto en inglés, prevalece el texto en inglés.",
    },
    // Pre-commercial truth (round 3): shown instead of any purchase CTA while NEXT_PUBLIC_AICC_COMMERCE_OPEN is not "true".
    soon: {
      label: "Las compras abrirán pronto",
      note: "Los planes y los precios son definitivos, pero las compras y las cuentas nuevas aún no están abiertas.",
      contact: "¿Preguntas mientras tanto? Escriba a {contactEmail}.",
      band: "Los planes y los precios son definitivos. Las compras y las cuentas nuevas abrirán pronto.",
      faqNote: "Los planes y los precios son definitivos, pero las compras aún no están abiertas. Las respuestas siguientes describen cómo funcionan los planes cuando se abran.",
    },
    plan: {
      perYear: "al año",
      oneStore: "1 tienda",
      upToStores: "Hasta {n} tiendas",
      choose: "Elegir {plan}",
      recommended: "Pensado para varias tiendas",
      sameFeatures: "Todas las funciones, en todos los planes",
      countHelper: "Cuente las tiendas que quiere conectar. El plan Solo cubre 1, Studio hasta 3 y Agency hasta 10.",
      term: "Plan fijo de 365 días. La renovación es manual.",
      renewal: "Usted mantiene el control: sin cobros automáticos. AICC nunca renueva su plan por su cuenta.",
      guarantee: "Garantía de devolución del dinero de 14 días en la compra inicial de su plan",
      usd: "Todos los precios están en dólares estadounidenses (USD).",
    },
    toc: "En esta página",
    lastReviewed: "Última revisión",
    draftUpdated: "Última actualización",
    version: "Estado",
    versionDraft: "En proceso de finalización",
    fallbackTag: "Inglés",
  },
  brand: {
    watchDemo: "Ver demostración",
    signIn: "Iniciar sesión",
    chips: {
      orders: "Historial de pedidos",
      clicks: "Tasa de clics",
      recs: "Recomendaciones",
      insights: "Observaciones",
      bundles: "Paquetes",
    },
    motion: { pause: "Pausar animación", play: "Reanudar animación" },
    modal: {
      title: "Demostración del producto",
      close: "Cerrar",
      placeholder: "Pronto habrá un video breve del producto. Mientras tanto, pruebe la demostración interactiva.",
      tryDemo: "Probar la demostración interactiva",
      captionsLabel: "Subtítulos",
    },
  },
  notFound: {
    heading: "No encontramos esa página.",
    body: "Puede que el enlace sea antiguo o esté mal escrito. Su tienda no se ha visto afectada.",
    home: "Ir a la página de inicio",
    questions: "Leer las preguntas",
  },

  // Kit module: fbt-demo.js. The "What shoppers see" side mirrors the plugin's own Spanish widget strings; the "What you see" side is a replica of
  // the English-only admin, so its labels (rule names, dashboard tiles, insight title and metric, Recommendation Preview) stay English.
  demo: {
    label: "Datos de ejemplo: no son de una tienda real",
    heading: "Pruebe el widget",
    groupLabel: "Productos de este paquete",
    intro: "Marque los productos y vea cómo cambia el total del paquete. Los productos, los precios y las cantidades son datos de ejemplo inventados.",
    nudge: "Compare los dos y luego véalo desde su lado.",
    result: {
      without: "Los productos relacionados de WooCommerce se eligen de la misma categoría: {names}. Nada de ello procede de lo que los compradores compran juntos.",
      withTwo: "El mismo producto. Con AICC, los acompañantes son «{a}» y «{b}», comprados juntos {na} y {nb} veces.",
      withOne: "El mismo producto. Con AICC, el primer acompañante es «{a}», comprado junto {na} veces; sus reglas dan forma al resto.",
      withNone: "El mismo producto. Sus reglas han quitado los acompañantes que AICC aprendió de sus pedidos, así que AICC completa la lista con señales de su catálogo.",
      cartWithout: "Las ventas cruzadas de WooCommerce son productos que el comerciante vincula a mano a los artículos, por ejemplo {names}. WooCommerce no las aprende de lo que los compradores compran juntos.",
      cartWithTwo: "En el carrito. AICC parte del primer artículo y deja fuera lo que ya está en el carrito: los acompañantes son «{a}» y «{b}», comprados juntos {na} y {nb} veces.",
      cartWithOne: "En el carrito. AICC parte del primer artículo y deja fuera lo que ya está en el carrito: el primer acompañante es «{a}», comprado junto {na} veces; sus reglas dan forma al resto.",
      cartWithNone: "En el carrito. Sus reglas han quitado los acompañantes que AICC aprendió de sus pedidos, así que AICC completa la lista con señales de su catálogo.",
      merchant: "El mismo paquete visto desde su lado: cómo se ordenó cada producto y las reglas que dan forma a la lista.",
    },
    plain: {
      title: "Productos relacionados",
      note: "Los productos relacionados propios de WooCommerce: la misma categoría o las mismas etiquetas, sin paquete y sin total.",
      cartTitle: "Ventas cruzadas del carrito de WooCommerce",
      cartNote: "Aquí pueden aparecer los productos que usted vincula manualmente a los artículos de su catálogo.",
      manual: "Vinculado manualmente",
    },
    summary: "Seleccionados: {count}. Total del paquete: {total}.",
    widget: {
      title: "Comprados juntos con frecuencia",
      subtitle: "Los clientes suelen comprar estos productos juntos.",
      bundleTotal: "Total del paquete",
      addToCart: "Añadir al carrito",
      poweredBy: "Con tecnología de",
      addOne: "Añadir 1 producto al carrito",
      addMany: "Añadir {count} productos al carrito",
      added: "Añadido al carrito",
      selectAtLeastOne: "Selecciona al menos un producto",
      noteAdd: "No se añade nada: es una ilustración.",
      addFew: "Añadir {count} productos al carrito",
    },
    mode: {
      legend: "Comparar",
      without: "Productos relacionados de WooCommerce",
      withoutCart: "Ventas cruzadas manuales de WooCommerce",
      with: "Con AICC",
      captionWithout: "Productos relacionados de WooCommerce: misma categoría, no a partir de pedidos.",
      captionWith: "Con AICC: primero los productos comprados juntos.",
      withoutCaption: "Los productos relacionados de WooCommerce salen de la misma categoría o de las mismas etiquetas. No se basan en lo que los compradores compran juntos.",
      withCaption: "AICC lista primero los productos que aparecen en los mismos pedidos. Cuando el historial de pedidos es escaso, mantiene la lista útil con productos relevantes y con stock de su catálogo, y los acompañantes realmente comprados juntos ocupan su lugar a medida que llegan pedidos.",
    },
    surface: { legend: "Dónde lo ven los compradores", page: "Página de producto", cart: "Carrito" },
    view: {
      legend: "Vista",
      shopper: "Lo que ven los compradores",
      merchant: "Lo que ve y controla usted",
      cue: "Cambie a «Lo que ve y controla usted» para ver el mismo paquete desde su lado.",
    },
    products: {
      kit: "Juego de café de filtro",
      filters: "Filtros de papel, paquete de 100",
      grinder: "Molinillo manual",
      mug: "Taza de cerámica",
      towel: "Paño de cocina de lino",
      scale: "Taza de viaje",
    },
    anchorTag: "Viendo este producto",
    store: {
      addToCart: "Añadir al carrito",
      cartTitle: "Su carrito",
      cols: { product: "Producto", price: "Precio", quantity: "Cantidad", subtotal: "Subtotal" },
      totals: "Totales del carrito",
      subtotal: "Subtotal",
      shipping: "Envío",
      shippingNote: "Se calcula al pagar",
      total: "Total",
      checkout: "Finalizar compra",
    },
    merchant: {
      heading: "Cómo se ordenó cada producto",
      intro: "Un ejemplo con el estilo del panel de AICC, cuyas etiquetas están en inglés; las reglas se configuran en el formulario Merchant Controls. Los productos y las cantidades son inventados.",
      sameBundle: "El mismo paquete que en la vista del comprador",
      forProduct: "Recomendaciones para",
      insightHeading: "Una observación sobre este paquete",
      insightTitle: "Strong Bundle Opportunity",
      insightBody: "«Juego de café de filtro» y «{product}» suelen comprarse juntos.",
      insightNone: "En la lista actual no queda ningún paquete fuerte.",
      insightMetric: "Times bought together",
      askHeading: "Ask Reco",
      askLabel: "Respuesta de ejemplo",
      askQuestion: "¿Cuál es mi mayor oportunidad?",
      askAnswer: "{product} es su paquete más fuerte con el juego de café de filtro en este ejemplo: comprados juntos {n} veces. Abra Recommendation Preview para ver los acompañantes y los recuentos de cualquier producto.",
      askNone: "En esta lista de ejemplo no queda ningún acompañante comprado junto. Abra Recommendation Preview para ver los acompañantes de cualquier producto.",
      colProduct: "Producto",
      colWhy: "Base (ilustración)",
      colRule: "Su regla",
      position: "Puesto {n}",
      boughtTogether: "Bought together {n} times",
      fallback: "Sin recuento: completado con su catálogo",
      fallbackNewest: "Sin recuento: uno de sus productos con stock más recientes",
      byRule: { pin: "Fijado por usted", prefer: "Preferido por usted", deprioritize: "Con menos prioridad, por usted", exclude: "Excluido por usted" },
      inBundle: "Marcado en la vista del comprador",
      evidenceHeading: "Cómo se construye la lista (ilustración).",
      evidenceOrder: "AICC construye la lista en este orden: primero los productos comprados juntos en sus pedidos. Cuando el historial es escaso, completa los puestos restantes con productos relevantes y con stock de su catálogo (primero los relacionados y después los más recientes). Sus reglas se aplican al final. En su panel, un acompañante aprendido (comprado junto en sus pedidos) muestra un recuento; una alternativa (completada con su catálogo) o un producto fijado muestra solo un precio.",
      previewNote: "En su panel de AICC, Recommendation Preview le permite elegir cualquier producto y ver su propia lista.",
      shopperNow: "El comprador ve ahora:",
      ruleLabel: "Regla para {product}",
      rules: { none: "Sin regla", pin: "Pin", prefer: "Prefer", deprioritize: "Deprioritize", exclude: "Exclude" },
      excluded: "Excluido: nunca se muestra a los compradores.",
      ruleNote: "Las reglas se aplican después de la ordenación. Exclude gana a cualquier otra regla; Prefer y Deprioritize mueven un solo puesto.",
      tilesHeading: "Lo que registra su panel",
      tiles: { views: "Recommendation Views", clicks: "Recommendation Clicks", adds: "Bundle Add-To-Carts" },
      tileNote: "Cifras de ejemplo. Añada el paquete al carrito en la vista del comprador y Bundle Add-To-Carts sube una unidad.",
      tileAdded: "+1 por el añadido al carrito que acaba de hacer",
      announceRule: "{product}: {rule}. La lista del comprador es ahora: {list}.",
      announceNone: "{product}: sin regla. La lista del comprador es ahora: {list}.",
      listEmpty: "nada",
    },
    why: {
      heading: "Por qué este producto (ilustración)",
      recoIntro: "Conozca a Reco, la guía integrada de AICC en el panel de WordPress.",
      none: "Marque un producto para ver en qué se basa su puesto en este ejemplo.",
      filters: "Filtros de papel: comprados juntos con el juego de café de filtro más veces que cualquier otro producto de este ejemplo.",
      grinder: "Molinillo manual: comprado junto con el juego de café de filtro menos veces que los filtros, así que se lista a continuación.",
      mug: "Taza de cerámica: no hay historial de compras de este par en el ejemplo, así que AICC completa este puesto con un producto relacionado de su catálogo.",
      towel: "Paño de cocina de lino: completado con sus productos con stock más recientes, después de los acompañantes comprados juntos y de los productos relacionados.",
      without: "Los productos relacionados de WooCommerce salen de la misma categoría, que es como funcionan por defecto. Nada de ello procede de lo que compran juntos sus compradores.",
      withoutCart: "Las ventas cruzadas del carrito de WooCommerce son productos que el comerciante vincula a mano a los artículos; una tienda que no ha configurado ninguna no muestra ninguna. WooCommerce no las aprende de lo que compran juntos sus compradores.",
      merchant: "Un ejemplo de cómo se construye la lista: cuántas veces se compró cada producto junto con el juego de café de filtro y qué puestos se completan con su catálogo.",
    },
    reco: {
      preview: "Reco: para ver los acompañantes y los recuentos reales de cualquier producto, abra Recommendation Preview en su panel.",
    },
    keyboardHint: "Use Tab y la barra espaciadora para marcar productos. Las teclas de flecha permiten pasar de uno a otro.",
    plainHint: "Este es el bloque de productos relacionados de WooCommerce: nada que marcar y sin total del paquete.",
    plainHintCart: "WooCommerce no aprende esto de lo que los compradores compran juntos: el comerciante elige las ventas cruzadas manualmente.",
    sample: "Ejemplo",
  },

  // Kit module: rules-demo.js. The rule names are the admin's own English labels; the help text glosses them in Spanish.
  rules: {
    label: "Datos de ejemplo: no son de una tienda real",
    heading: "Lo que mostraría el widget",
    productLabel: "Producto al que aplicar una regla",
    actionLabel: "Regla",
    actions: { pin: "Pin", prefer: "Prefer", deprioritize: "Deprioritize", exclude: "Exclude" },
    help: {
      none: "Elija un producto y una regla. Si elige otra vez la misma regla, se quita.",
      pin: "Pin (fijar): mantiene este producto cerca de la parte superior.",
      exclude: "Exclude (excluir): nunca muestra este producto.",
      prefer: "Prefer (preferir): da a este producto un poco más de prioridad.",
      deprioritize: "Deprioritize (restar prioridad): baja la prioridad de este producto sin quitarlo del todo.",
    },
    effect: {
      none: "Sin regla en este producto.",
      pin: "Pin: el producto pasa al primer puesto.",
      exclude: "Exclude: el producto se quita de la lista. Exclude siempre gana.",
      prefer: "Prefer: el producto sube un puesto.",
      deprioritize: "Deprioritize: el producto baja un puesto.",
      stays: "Esta vez no se mueve: Prefer y Deprioritize mueven un solo puesto, nunca entre grupos y nunca por delante de un producto con el mismo tipo de regla.",
      outOfStock: "Los productos agotados siguen fuera, aunque estén fijados con Pin.",
    },
    products: {
      filters: "Filtros de papel, paquete de 100",
      grinder: "Molinillo manual",
      kettle: "Hervidor de cuello de cisne",
      mug: "Taza de cerámica",
      towel: "Paño de cocina de lino",
      travel: "Taza de viaje",
    },
    evidence: { learned: "Comprados juntos {n} veces", fallback: "Producto relevante con stock de su catálogo", outOfStock: "Agotado" },
    tags: { pin: "Fijado", prefer: "Preferido", deprioritize: "Con menos prioridad", exclude: "Excluido" },
    place: "Puesto {n}",
    hiddenHeading: "No se muestra a los compradores",
    hiddenNone: "No se oculta nada.",
    reset: "Restablecer",
    activeHeading: "Reglas aplicadas",
    activeNone: "Aún no hay reglas.",
    announceList: "Lista del widget: {list}.",
    announceHidden: "No se muestra: {list}.",
    announceReset: "Se han quitado todas las reglas. La lista vuelve al orden propio de AICC.",
    smallprint: "Ilustración con productos de ejemplo.",
  },

  // Kit module: dash-preview.js. A replica of the real (English-only) dashboard blocks: tile names, insight titles and metrics, Recommendation Preview
  // and "Last 30 days" stay English; the "Shopper sees" panel uses the Spanish widget strings; sentences are Spanish.
  dash: {
    label: "Datos de ejemplo: no son de una tienda real",
    shopperTitle: "Lo que ve el comprador",
    youTitle: "Lo que ve usted",
    widgetTitle: "Comprados juntos con frecuencia",
    widgetSubtitle: "Los clientes suelen comprar estos productos juntos.",
    widgetAdd: "Añadir 3 productos al carrito",
    widgetTotal: "Total del paquete",
    products: { kit: "Juego de café de filtro", filters: "Filtros de papel, paquete de 100", grinder: "Molinillo manual", mug: "Taza de cerámica" },
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
    associationNote: "Los pedidos y los ingresos están asociados al widget; no prueban que los causara.",
    insightsHeading: "Merchant Insights",
    insightTitle: "Strong Bundle Opportunity",
    insightBody: "«Juego de café de filtro» y «Filtros de papel, paquete de 100» suelen comprarse juntos.",
    insightMetric: "Times bought together",
    insightGate: "Las observaciones aparecen cuando hay al menos 10 pedidos en el periodo; cada tipo necesita además datos suficientes propios.",
    insightsLead: "Observaciones en lenguaje sencillo a partir de reglas fijas, no escritas por una IA. Estos son los cuatro tipos que AICC puede mostrar.",
    insightsBanner: "Top Recommendation",
    insightKinds: {
      hot: { title: "Top Performing Product", body: "«Filtros de papel, paquete de 100» es uno de sus productos más vendidos en este periodo.", metric: "Share of store purchases", value: "24%" },
      bundle: { title: "Strong Bundle Opportunity", body: "«Juego de café de filtro» y «Filtros de papel, paquete de 100» suelen comprarse juntos.", metric: "Times bought together", value: "9" },
      interest: { title: "High Interest, Low Conversion", body: "«Hervidor de cuello de cisne» se añade a menudo a los carritos, pero se compra menos.", metric: "Add-to-cart count", value: "22" },
      winner: { title: "Recommendation Winner", body: "«Molinillo manual» recibe una gran parte de los clics en los productos recomendados.", metric: "Recommendation clicks", value: "41" },
    },
    previewHeading: "Recommendation Preview",
    previewFor: "Recomendaciones para",
    previewLearned: "Bought together {n} times",
    callouts: {
      a: "Actividad de las recomendaciones de los últimos 30 días.",
      b: "Pedidos e ingresos asociados al widget en las 24 horas posteriores a añadir un paquete.",
      c: "Observaciones en lenguaje sencillo a partir de reglas fijas, no de una IA.",
      d: "Vea qué recomienda AICC para cualquier producto.",
    },
  },

  // Kit module: reco-ask.js. In the plugin Reco answers in English and Hebrew only, so the footnote says the sample conversation is shown translated.
  // "Go to Order History" is the real link label in the admin and stays English.
  ask: {
    label: "Conversación de ejemplo",
    title: "Ask Reco",
    suggestionsLabel: "Elija una pregunta para Reco",
    answerLabel: "Respuesta de ejemplo",
    footnote: "Las respuestas salen de los datos de su propio panel. Reco ofrece información y enlaces; nunca cambia sus ajustes. En su administración también puede escribir una pregunta breve, y Reco la asocia con los temas que conoce. Reco responde en inglés y en hebreo; aquí la conversación aparece traducida.",
    qa: {
      focus: {
        q: "¿En qué debería centrarme hoy?",
        a: "Paso siguiente opcional: importar hasta 24 meses de su historial de pedidos de WooCommerce para que AICC aprenda qué productos compran ya juntos sus clientes. Los pedidos anteriores nunca se importan si usted no lo decide; sin la importación, AICC empieza con alternativas del catálogo y aprende de los pedidos nuevos.",
        link: "Go to Order History",
      },
      opportunity: {
        q: "¿Cuál es mi mayor oportunidad?",
        a: "«Juego de café de filtro» y «Filtros de papel, paquete de 100» se compran juntos 9 veces, su paquete más fuerte en este ejemplo. Abra Merchant Insights para ver las demás observaciones.",
        link: "Open Merchant Insights",
      },
      win: {
        q: "Deme una mejora rápida.",
        a: "Elija uno de sus productos más vendidos en Recommendation Preview y compruebe que sus acompañantes tienen buen aspecto. Fije un producto con Pin para mantenerlo cerca de la parte superior, o excluya con Exclude uno que no quiera mostrar.",
        link: "Open Recommendation Preview",
      },
      help: {
        q: "¿En qué puede ayudarme?",
        a: "Puedo revisar su configuración y sus datos, ayudarle a leer las cifras de su panel, señalar oportunidades de paquetes y el estado del catálogo, y llevarle a la pantalla adecuada. No cambio ajustes ni respondo preguntas abiertas.",
        link: "",
      },
    },
  },

  loop: {
    label: "Cómo funciona AICC, paso a paso",
    title: "Cómo funciona, paso a paso",
    steps: ["Sus pedidos", "Pares encontrados", "Mostrados a los compradores", "Clics y carritos contados", "Observaciones", "Sus reglas", "Aprende de los pedidos nuevos"],
  },

  faqSearch: {
    label: "Buscar en las preguntas",
    placeholder: "Pruebe con «reembolso», «pago» o «tiendas»",
    hint: "Busca en las preguntas y respuestas de esta página. Su búsqueda se queda en su navegador.",
    clear: "Borrar",
    results: { one: "1 pregunta coincide con «{q}».", other: "{n} preguntas coinciden con «{q}»." },
    empty: "Ninguna pregunta coincide con «{q}». Pruebe con menos palabras o explore por tema.",
  },

  flows: {
    order: {
      title: "Cuando se hace un pedido",
      steps: ["Pedido realizado", "Datos en cola en su tienda", "Enviados a AICC en segundo plano"],
      note: "Hacer un pedido nunca espera a AICC.",
    },
    down: {
      title: "Si AICC o sus servidores van lentos o no funcionan",
      steps: ["AICC no disponible", "El widget se oculta", "Vuelven los productos relacionados de WooCommerce"],
      note: "Con el ajuste por defecto, cuando se ejecuta el JavaScript de la página.",
    },
    inactive: {
      title: "Si su plan no está activo",
      steps: ["Plan no activo", "Sin widget, sin script, sin cookies nuevas", "WooCommerce funciona como siempre"],
      note: "Nada de AICC aparece en su tienda online.",
    },
  },

  home: {
    connectorNote: "Un panel de ejemplo con el estilo de la administración de AICC",
    hero: {
      eyebrow: "Disponible para WooCommerce",
      titleLead: "Venda más",
      titleAccent: "con cada visita",
      lead: "Automatice su merchandising y descubra ingresos ocultos con un copiloto de IA que usted controla por completo.",
      ctaDemo: "Pruebe la demo en vivo",
      ctaPlans: "Ver precios",
    },

    pillars: {
      label: "Lo que le ofrece AI Commerce Copilot",
      a: { title: "Ayude a los compradores a descubrir más", body: "Ponga productos relevantes delante de los compradores mientras todavía están decidiendo qué comprar.", link: "Ver dónde aparecen" },
      b: { title: "Menos merchandising manual", body: "Deje que los datos de su tienda se ocupen del trabajo repetitivo de recomendar, e intervenga usted donde importa.", link: "Ver los controles" },
      c: { title: "Mantenga el control", body: "Vea por qué se recomiendan los productos, entienda qué hacen los compradores con ellos y cambie lo que aparece cuando quiera.", link: "Ver la evidencia" },
    },

    demo: {
      title: "Vea en qué se basa cada recomendación.",
      lead: "Los compradores ven un paquete breve y relevante. Usted ve la evidencia que hay detrás y los controles que le dan forma. Pruebe los dos lados a continuación.",
      versusLabel: "Los dos lados de cada recomendación",
      shopper: { title: "Lo que ven los compradores", body: "Recomendaciones útiles en un paquete breve que pueden añadir al carrito en un solo paso." },
      merchant: { title: "Lo que ve y controla usted", body: "Por qué está cada producto, qué hacen los compradores con él y las reglas que cambian lo que aparece." },
    },

    how: {
      title: "Conectar, aprender, recomendar.",
      lead: "Usted da el primer paso. AICC hace el resto en segundo plano.",
      steps: {
        connect: {
          title: "Conectar",
          body: "Cree su cuenta de AICC y elija un plan, instale y active el plugin de AICC en su tienda WooCommerce y conecte su tienda desde la pantalla de AICC. Normalmente no hay clave de licencia que pegar ni código que escribir.",
        },
        learn: {
          title: "Aprender",
          body: "AICC prepara su catálogo en segundo plano. Cuando su tienda está lista, las recomendaciones empiezan con productos relevantes con stock de su catálogo, y pasan a pares realmente comprados juntos a medida que se cuentan los pedidos. Importe sus pedidos anteriores (opcional) para empezar con pares ya aprendidos.",
        },
        recommend: {
          title: "Recomendar",
          body: "En las páginas de producto y de carrito, el widget «Comprados juntos con frecuencia» muestra lo que sus clientes compraron juntos. Los pedidos nuevos siguen enseñando a AICC, y sus reglas ajustan el resultado.",
        },
      },
    },
    why: {
      title: "Los productos relacionados se eligen por categoría. AICC parte de la cesta de compra.",
      lead: "Los productos relacionados de WooCommerce son una opción por defecto razonable: emparejan productos por categoría y etiquetas. No pueden decirle qué productos compra la gente junta de verdad.",
      points: {
        intent: {
          title: "La misma categoría no es la misma intención.",
          body: "Un molinillo y un paquete de granos de café pueden estar en categorías distintas y acabar en la misma cesta. La coincidencia por categoría no lo ve. Sus pedidos, sí.",
        },
        evidence: {
          title: "Sus pedidos son la evidencia.",
          body: "AICC cuenta qué productos aparecen juntos en sus pedidos completados y en proceso, y lista primero los acompañantes más frecuentes.",
        },
        fallback: {
          title: "Un historial escaso sigue recibiendo recomendaciones relevantes.",
          body: "Cuando un producto tiene pocas compras conjuntas, AICC sigue completando el widget con señales de su catálogo más allá de las compras anteriores: primero productos relevantes con stock y después sus productos con stock más recientes. No se inventa nada, y los pares reales comprados juntos toman el relevo a medida que se cuentan los pedidos. Mientras el historial es escaso, las primeras alternativas salen de la misma categoría, de forma parecida a los productos relacionados de WooCommerce; la lista se vuelve específica de su tienda a medida que se acumulan sus pedidos. Los acompañantes aprendidos (productos que sus pedidos muestran comprados juntos) y las alternativas comparten hoy el título del widget; la vista previa de su panel muestra cuál es cuál.",
        },
      },
      link: "Vea cómo se decide una recomendación",
    },
    workspace: {
      title: "Las recomendaciones son solo el escaparate.",
      lead: "Detrás de ellas, AI Commerce Copilot da a los comerciantes la información, los controles y la orientación para entender qué se recomienda, dar forma a lo que ven los compradores y mejorar las decisiones de merchandising.",
      connectorLink: "Volver a la demostración",
      tabsLabel: "Lo que le ofrece el espacio de trabajo de AI Commerce Copilot",
      understand: {
        tab: "Entender",
        title: "Vea qué hacen sus recomendaciones.",
        lead: "Vea qué hacen los compradores con sus recomendaciones: vistas, clics y paquetes añadidos al carrito de los últimos 30 días, y los pedidos y los ingresos asociados al widget. Previsualice qué recomienda AICC para cualquier producto, con las veces que se compró junto cada acompañante.",
        note: "Los pedidos y los ingresos se muestran como asociación, no como prueba de causa. Un pedido asociado cuenta por el total completo del pedido.",
      },
      control: {
        tab: "Controlar",
        title: "Quédese con la última palabra.",
        lead: "Con Pin, Prefer, Deprioritize o Exclude (fijar, preferir, restar prioridad o excluir) puede actuar sobre cualquier producto y ver cómo responde la lista. Exclude siempre gana.",
        note: "Las reglas pueden dirigirse a un par de productos o a un producto en todas partes, y pueden caducar. Los productos agotados y los eliminados siguen fuera aunque estén fijados.",
        link: "Cómo funcionan las reglas, en detalle",
      },
      insights: {
        tab: "Oportunidades",
        title: "Detecte lo que merece una acción.",
        lead: "Observaciones en lenguaje sencillo a partir de sus propios datos: productos más vendidos, paquetes sólidos, productos que se añaden a menudo al carrito pero se compran menos, y qué productos recomendados reciben los clics.",
        note: "Proceden de reglas fijas, no de un modelo generativo.",
      },
      ask: {
        tab: "Ask Reco",
        title: "Sepa en qué trabajar a continuación.",
        lead: "Ask Reco convierte los datos de su propia tienda en respuestas claras sobre oportunidades, rendimiento y próximos pasos.",
        detail: "Reco vive en su administración de WordPress y responde preguntas habituales sobre su configuración, su rendimiento y los siguientes pasos a partir de los datos de su propio panel, con enlaces a la pantalla adecuada.",
        note: "Reco sigue reglas fijas y no IA generativa, así que no improvisa. Responde en inglés y en hebreo, ofrece información y enlaces, nunca cambia sus ajustes, y los compradores nunca lo ven.",
        link: "Qué puede y qué no puede hacer Ask Reco",
      },
    },
    safety: {
      title: "Una herramienta de recomendaciones nunca debería depender del proceso de pago.",
      lead: "AICC está construido para que, si algo sale mal, WooCommerce siga vendiendo.",
      points: {
        a: "Hacer un pedido nunca espera a AICC. Los datos del pedido se ponen en cola y se envían en segundo plano.",
        b: "Si AICC o sus servidores van lentos o no funcionan, el widget se oculta tras una breve espera.",
        c: "Vuelven los productos relacionados y las ventas cruzadas propios de WooCommerce.",
        d: "Si su plan no está activo, nada de AICC aparece en su tienda online: ni widget, ni script, ni cookies nuevas.",
      },
      supporting: "AICC no edita sus productos, precios ni plantillas. Si lo desactiva, vuelven las recomendaciones nativas. Probado con Storefront y con un tema de bloques.",
      link: "Cómo se tratan sus datos",
      more: "Qué ocurre si AICC no está disponible",
    },
    pricing: {
      confidence: {
        price: "Planes desde {priceSolo} al año",
        guarantee: "Garantía de devolución del dinero de 14 días en la compra inicial de su plan",
        renewal: "Renovación manual, sin cobros automáticos",
      },
      title: "Un producto completo. El precio depende de cuántas tiendas.",
      lead: "Todos los planes incluyen las recomendaciones en la tienda online, el panel y las observaciones, sus reglas, Ask Reco y una importación opcional de pedidos anteriores. Usted solo elige cuántas tiendas conectar. Usted mantiene el control: AICC nunca renueva su plan automáticamente.",
      link: "Vea qué incluye cada plan",
    },
    questions: {
      title: "Preguntas que los comerciantes hacen antes de comprar.",
      lead: "Primero, respuestas breves. La lista completa cubre planes, datos y qué ocurre cuando vuelve.",
    },
    final: {
      title: "Empiece con su propia tienda.",
      body: "Cree su cuenta, elija un plan y conecte su primera tienda.",
      guarantee: "La compra inicial de su plan incluye una garantía de devolución del dinero de 14 días. Los 14 días empiezan cuando se recibe el pago y se emite su plan. Consulte la [política de reembolso](route:refund-policy) para ver las condiciones completas.",
    },
  },

  product: {
    hero: {
      title: "Recomendaciones que su tienda puede explicar.",
      lead: "AICC convierte los datos de su tienda en las recomendaciones que ven los compradores, además del panel, las observaciones y las reglas que usted usa para entender y orientar cada una. Fije, excluya o desplace cualquier producto desde WordPress.",
    },
    toc: {
      shopper: "Experiencia del comprador",
      learn: "Cómo aprende",
      sparse: "Historial escaso",
      dash: "Su panel",
      control: "Sus controles",
      ask: "Ask Reco",
      measure: "Medición",
      safety: "Si AICC no funciona",
      history: "Pedidos anteriores",
      stores: "Tiendas",
      compare: "Frente a los relacionados",
      limits: "Alcance actual",
    },
    shopper: {
      title: "Qué ven los compradores",
      lead: "Hoy, las recomendaciones de AICC llegan a los compradores como un paquete «Comprados juntos con frecuencia» en sus páginas de producto y en la página del carrito.",
      page: {
        title: "En una página de producto",
        body: "El producto que se está viendo aparece ya marcado. Los compradores marcan los demás y añaden el paquete al carrito en un solo paso.",
      },
      cart: {
        title: "En la página del carrito",
        body: "El primer artículo del carrito es el punto de partida. Los compradores añaden el paquete de la misma forma.",
      },
      fit: {
        title: "En cualquier pantalla",
        body: "El widget se adapta al ancho del espacio donde está, del móvil al escritorio, y sigue la dirección de su tema, así que las tiendas de derecha a izquierda se muestran de derecha a izquierda. Muestra hasta cinco filas: en una página de producto, el producto visto más hasta cuatro recomendaciones; en la página del carrito, hasta cinco, sin contar los productos que ya están en el carrito.",
      },
      only: "Aparece únicamente en las páginas de producto y en la del carrito. No hay widget en la página de inicio, en las categorías ni en el proceso de pago. En un tema inusual donde AICC no encuentra un lugar seguro, se oculta en lugar de adivinar.",
    },
    learnPlain: "Cada recomendación se puede explicar: sale de contar sus propios pedidos, de su catálogo (productos relevantes con stock, productos más recientes) o de una regla que usted fija, no de un modelo generativo ni de un perfil del comprador. Los mismos datos dan el mismo resultado.",
    learn: {
      title: "Cómo decide AICC qué recomendar.",
      lead: "Una lista breve y fija, recorrida en este orden, con sus reglas aplicadas al final.",
      steps: {
        learned: {
          title: "Aprendido de sus pedidos",
          body: "AICC examina sus pedidos completados y en proceso. Cuando los clientes compran el producto A, ¿qué otros productos van en el mismo pedido? Esos recuentos, de mayor a menor, son las recomendaciones.",
        },
        category: {
          title: "Relevantes en su catálogo",
          body: "Si un producto tiene muy poco historial de compras para llenar el widget, los puestos restantes se completan con productos con stock de su catálogo que sean relevantes para él. Salen del catálogo, no de un recuento de compras.",
        },
        newest: {
          title: "Más recientes con stock",
          body: "Si todavía quedan puestos libres, AICC añade sus productos con stock más recientes.",
        },
        rules: {
          title: "Sus reglas",
          body: "Pin, Exclude, Prefer y Deprioritize se aplican después. Los productos agotados y los eliminados siguen fuera.",
        },
      },
    },
    sparse: {
      title: "¿Poco historial? Sigue habiendo recomendaciones relevantes.",
      lead: "AICC usa señales de su catálogo más allá de las compras anteriores, para que el widget no se quede vacío.",
      p1: "Los puestos que el historial de compras no puede llenar se completan con productos con stock de su catálogo, primero de la misma categoría (de forma parecida a los productos relacionados de WooCommerce) y después con sus productos con stock más recientes. Salen del catálogo, no de las compras. A medida que llegan pedidos, las compras conjuntas reales sustituyen a las alternativas.",
      p2: "Puede importar hasta 24 meses de pedidos anteriores (opcional), para que AICC parta de su historial y no de cero.",
      limitTitle: "En el widget",
      limit: "El título del widget es el mismo para todos los elementos. En Recommendation Preview, en su panel, los acompañantes aprendidos muestran cuántas veces se compraron juntos y los productos alternativos solo muestran un precio, así que siempre puede distinguirlos.",
      slots: {
        caption: "Ilustración con cifras de ejemplo: las cuatro recomendaciones junto al producto visto en una página de producto, con dos acompañantes aprendidos.",
        learned: "Comprados juntos {n} veces",
        category: "Relevante en su catálogo",
        newest: "Más reciente con stock",
        slot: "Puesto {n}",
      },
    },
    dash: {
      title: "Vea qué hizo el widget.",
      lead: "Un ejemplo con el estilo del panel de AICC en su administración de WordPress, cuyas etiquetas están en inglés. Las cifras son inventadas.",
      readiness: "La preparación mide si la configuración está lista: conexión, seguimiento, productos y widget. No es una medida de ventas.",
      items: {
        a: { title: "Actividad de las recomendaciones", body: "Vistas, clics y tasa de clics de las recomendaciones, y paquetes añadidos al carrito, de los últimos 30 días." },
        b: { title: "Pedidos e ingresos asociados", body: "Pedidos en los que un comprador añadió un paquete desde el widget y compró uno de esos productos en las 24 horas siguientes. Asociación, no prueba de causa." },
        c: { title: "Merchant Insights", body: "Observaciones en lenguaje sencillo a partir de reglas fijas, no escritas por una IA: productos más vendidos, paquetes sólidos, productos que se añaden a menudo al carrito pero se compran menos, y qué productos recomendados reciben los clics." },
        d: { title: "Recommendation Preview", body: "Elija cualquier producto y vea qué recomienda AICC para él. Los acompañantes aprendidos muestran cuántas veces se compraron juntos; los productos alternativos solo muestran un precio." },
      },
      gate: "Las observaciones aparecen cuando hay al menos 10 pedidos en el periodo; cada tipo necesita además datos suficientes propios.",
      export: "Puede exportar el rendimiento de los productos a CSV para 7, 30 o 90 días. Todo procede de los datos de su tienda; AICC no proyecta resultados.",
    },
    control: {
      title: "Usted tiene la última palabra.",
      lead: "Añada una regla a un producto y vea cómo responde la lista. AICC hace el trabajo pesado; usted decide dónde no debe hacerlo.",
      tableCaption: "Qué hace cada regla",
      colRule: "Regla",
      colDoes: "Qué hace",
      rows: {
        pin: "Fijar: mantiene el producto cerca de la parte superior. Si fija varios, el que se configuró más recientemente va primero.",
        exclude: "Excluir: nunca se muestra. Siempre gana a cualquier otra regla.",
        prefer: "Preferir: sube el producto un puesto.",
        deprioritize: "Restar prioridad: baja el producto un puesto, sin quitarlo del todo.",
      },
      scopeTitle: "Dónde se aplica una regla",
      scope: "Una regla puede dirigirse a un par de productos (cuando los compradores ven el producto A, el producto B recibe la acción) o a un producto en todas partes (recibe la acción en la lista de cualquier producto). Las reglas pueden tener una fecha de caducidad opcional y una nota interna. No hay reglas por categoría.",
      guardTitle: "Lo que una regla no puede anular",
      guard: "Los productos agotados y los eliminados siguen fuera, aunque estén fijados. Prefer y Deprioritize nunca mueven un producto por delante de uno de otro grupo (acompañantes aprendidos, productos relevantes del catálogo, productos más recientes). Únicamente Pin fuerza una posición. El widget muestra pocos productos, así que un producto con Deprioritize en el último puesto visible puede quedar fuera de la vista.",
    },
    ask: {
      title: "Lo que aporta Ask Reco.",
      lead: "Reco vive en su administración de WordPress y le ayuda a entender los datos de su tienda. Hágale una pregunta habitual y responde a partir de los datos de su propio panel, con enlaces a las pantallas adecuadas.",
      canTitle: "Qué puede hacer",
      can: {
        a: "Decirle si su tienda está lista y qué corregir primero.",
        b: "Explicar por qué no aparecen las recomendaciones.",
        c: "Ayudarle a leer vistas, clics, paquetes añadidos al carrito y pedidos asociados.",
        d: "Señalar oportunidades de paquetes y el estado del catálogo.",
        e: "Sugerir un siguiente paso y llevarle a la pantalla adecuada.",
      },
      cannotTitle: "Qué no puede hacer",
      cannot: {
        a: "Responder preguntas abiertas ni redactar textos: está construido con reglas fijas, no con un modelo generativo.",
        b: "Cambiar sus ajustes. Solo ofrece información y enlaces.",
        c: "Aparecer ante los compradores. Es para comerciantes, en la administración.",
        d: "Funcionar todavía en otros idiomas: responde en inglés y en hebreo.",
      },
      note: "Sus preguntas se responden en su administración de WordPress y no se envían a AICC.",
    },
    measure: {
      title: "Cómo se mide el rendimiento.",
      lead: "Vea qué ocurre después de que los compradores se encuentran con el widget: vistas, clics, paquetes añadidos al carrito y los pedidos que siguen.",
      flow: {
        title: "Cuándo un pedido cuenta como asociado",
        steps: ["El comprador añade un paquete desde el widget", "Compra uno de esos productos en 24 horas", "El pedido se muestra como asociado, por su total completo"],
      },
      association: "AICC informa de los pedidos y los ingresos asociados al widget y le deja la conclusión a usted. La asociación indica dónde mirar; no prueba que el widget causara la venta, y AICC no ejecuta un grupo de control. Un pedido asociado cuenta por el total completo del pedido.",
      consent: "Además necesita que la herramienta de consentimiento de cookies de su tienda permita las estadísticas, mediante un plugin de consentimiento compatible con la WP Consent API. Si no hay ninguno instalado, no hay cookies y no se puede asociar ningún pedido, aunque los datos de los pedidos se siguen enviando porque así se aprenden las recomendaciones.",
      notTitle: "Lo que no se mide",
      not: {
        a: "El aumento frente a un grupo de control.",
        b: "Las vistas sin clic (view-through) ni los clics que nunca llegaron a ser un paquete añadido al carrito.",
        c: "Pedidos de visitantes que no han dado su consentimiento a las estadísticas.",
        d: "Pedidos anteriores a su conexión.",
        e: "Recorridos que continúan en otro dispositivo.",
      },
    },
    safety: {
      title: "Aunque AICC no esté disponible, su tienda sigue vendiendo.",
      lead: "Hacer un pedido nunca espera a AICC, y el widget se aparta si no se puede contactar con AICC.",
      conditions: "Esto se aplica con el ajuste por defecto, en el que el widget de AICC sustituye a los productos relacionados de WooCommerce, y cuando se ejecuta el JavaScript de la página.",
      limit: "Los fallos que detienen PHP en sí, como un servidor que se queda sin memoria, quedan fuera de lo que cualquier plugin puede interceptar. Probado con Storefront, un tema de bloques y plugins habituales.",
      requirements: "Mínimos declarados: WordPress 6.0, WooCommerce 7.0 y PHP 7.4. Compatible con el almacenamiento de pedidos de alto rendimiento (HPOS) de WooCommerce.",
      light: "AICC no edita sus productos, precios ni plantillas. Si lo desactiva, vuelven las recomendaciones nativas. Desconecte antes la tienda para liberar su cupo.",
      link: "Qué datos se envían y cuáles no",
    },
    history: {
      title: "Sus pedidos anteriores pueden dar a AICC una ventaja inicial.",
      lead: "Cuando su tienda está conectada, AICC le ofrece importar hasta 24 meses de pedidos anteriores, para que las recomendaciones aprendan de su historial existente. Es opcional: usted decide.",
      p1: "Si lo omite, AICC sigue recomendando desde su catálogo (productos con stock elegidos de forma parecida a los productos relacionados de WooCommerce, primero de la misma categoría, y después los más recientes) y aprende de los pedidos nuevos. AICC no importa sus pedidos anteriores hasta que usted lo decida. Los pedidos hechos antes de conectar no se envían a menos que los importe; los hechos después de conectar se envían al crearse o actualizarse.",
      p2: "Puede iniciar la importación más tarde desde el panel. Lee sus pedidos y envía datos de los pedidos a AICC sin cambiarlos en WooCommerce, los pedidos ya importados no se duplican y puede cancelar una importación desde el panel. El tiempo varía según el tamaño del catálogo y las tareas programadas de su sitio.",
      p3: "¿Vuelve tras una pausa? AICC puede conservar el historial de su tienda cuando se pausa el acceso, para que los comerciantes que regresan continúen en lugar de empezar desde cero. Si importó su historial, AICC se pone al día con su historial real de WooCommerce; una tienda que declinó la oferta de importación nunca se importa sin preguntar. Nunca inventa impresiones, clics ni ingresos del tiempo en que no estuvo funcionando.",
      link: "Conservación exacta, hoy y como objetivo",
      flowTitle: "Si decide importar",
      flow: ["Pedidos anteriores de los últimos 24 meses, si lo decide", "Importados en segundo plano", "Relaciones aprendidas"],
    },
    stores: {
      title: "Más de una tienda.",
      lead: "Todos los planes tienen todas las funciones. La única diferencia es cuántas tiendas conecta: 1, hasta 3 o hasta 10.",
      solo: "Solo",
      studio: "Studio",
      agency: "Agency",
      slots: "{n} cupos de tienda",
      slotsOne: "1 cupo de tienda",
      p1: "Cada dirección de sitio web que conecta usa un cupo, y la tienda de pruebas y la de producción cuentan como tiendas distintas. Desconectar una tienda libera su cupo al instante.",
      link: "Vea los planes Solo, Studio y Agency",
    },
    compare: {
      title: "¿Por qué AICC y no otro plugin de productos relacionados?",
      lead: "Los productos relacionados son una buena opción por defecto y siempre están ahí. AICC añade lo que ellos no intentan hacer.",
      caption: "Productos relacionados de WooCommerce frente a AICC",
      colTopic: "Qué se compara",
      colWoo: "Productos relacionados de WooCommerce",
      colAicc: "AICC",
      rows: {
        chosen: { topic: "Cómo se eligen los productos", woo: "Categoría y etiquetas compartidas (más las ventas dirigidas y las ventas cruzadas elegidas a mano)", aicc: "Lo que los clientes de su tienda compraron junto; señales del catálogo (productos relevantes y los más recientes con stock) cuando el historial es escaso" },
        see: { topic: "Qué puede ver", woo: "El propio bloque", aicc: "Un panel: vistas, clics, paquetes añadidos al carrito, pedidos asociados, observaciones" },
        control: { topic: "Control", woo: "Ventas dirigidas y ventas cruzadas elegidas a mano; los productos relacionados en sí son automáticos", aicc: "Reglas (Pin, Exclude, Prefer, Deprioritize), para un par de productos o en todas partes" },
        explain: { topic: "Capacidad de explicación", woo: "Sencilla: categoría o etiqueta compartida", aicc: "Un recuento que puede inspeccionar en Recommendation Preview" },
        guide: { topic: "Orientación", woo: "Ninguna", aicc: "Ask Reco en su administración" },
        history: { topic: "Historial", woo: "No se usa", aicc: "Importación opcional de hasta 24 meses de pedidos anteriores" },
        fail: { topic: "Si algo falla", woo: "Bloque nativo", aicc: "El widget se oculta tras una breve espera; vuelve el bloque nativo" },
      },
    },
    limits: {
      title: "En qué se centra AICC hoy.",
      lead: "Límites claros, para que sepa qué esperar.",
      items: {
        a: "Las recomendaciones siguen al producto, no al comprador: no hay personalización por comprador.",
        b: "AICC recomienda productos complementarios a partir de sus propios pedidos y de su catálogo. No es un motor de ventas dirigidas (upsell).",
        c: "El widget aparece en las páginas de producto y de carrito, no en la página de inicio, en las páginas de categoría ni en el proceso de pago.",
        d: "Ask Reco es para comerciantes y está construido con reglas fijas. Responde en inglés y en hebreo.",
        e: "El título del widget es el mismo para los productos alternativos que para los aprendidos.",
        f: "Los productos que requieren elegir una opción, como la talla o el color, muestran un enlace «Seleccionar opciones» en lugar de añadirse al paquete, así que un paquete nunca afirma más de lo que contiene el carrito.",
        g: "La administración del plugin está en inglés y en hebreo.",
      },
    },
    languages: {
      title: "Idiomas.",
      lead: "Qué hay disponible en cada idioma.",
      caption: "Idiomas por parte de AICC",
      colPart: "Parte de AICC",
      colLangs: "Idiomas",
      rows: {
        site: { part: "Este sitio web y su área de cuenta", langs: "Inglés, hebreo (de derecha a izquierda), español y ruso" },
        admin: { part: "La administración de AICC en WordPress", langs: "Inglés y hebreo" },
        reco: { part: "Ask Reco", langs: "Inglés y hebreo" },
        widget: { part: "El widget de la tienda online", langs: "Inglés y hebreo completos, además de las etiquetas principales en español, ruso, francés, alemán y árabe; un idioma por tienda, elegido en los ajustes del plugin" },
      },
    },
    questions: { title: "Preguntas habituales sobre cómo funciona." },
    safetyCta: { title: "Véalo en su propia tienda.", body: "Cree su cuenta, elija un plan y conecte su primera tienda." },
    cta: { title: "¿Listo para verlo en su tienda?", body: "Cree su cuenta, elija un plan y conecte su primera tienda." },
  },

  pricing: {
    hero: {
      title: "Un producto completo. Elija cuántas tiendas.",
      lead: "Plan Solo {priceSolo}, Studio {priceStudio} o Agency {priceAgency} al año. Todos los planes incluyen todo lo que hace AICC; la única diferencia es cuántas tiendas puede conectar.",
    },
    plans: {
      solo: {
        name: "Solo",
        fit: "Una tienda en producción. Una tienda de pruebas cuenta como segunda tienda.",
      },
      studio: {
        name: "Studio",
        fit: "Una tienda más su tienda de pruebas, o unas pocas tiendas de clientes.",
      },
      agency: {
        name: "Agency",
        fit: "Una cartera de tiendas de clientes.",
      },
    },
    included: {
      title: "Todos los planes incluyen el producto AICC completo.",
      lead: "Antes de mirar los precios, esto es lo que compra.",
      items: {
        a: "Recomendaciones aprendidas de sus propios pedidos",
        b: "Recomendaciones en la tienda online, en las páginas de producto y de carrito (el paquete «Comprados juntos con frecuencia»)",
        c: "Un panel con vistas, clics, paquetes añadidos al carrito y pedidos asociados",
        d: "Reglas para fijar, excluir, preferir o restar prioridad a productos",
        e: "Observaciones en lenguaje sencillo a partir de los datos de su tienda",
        f: "Ask Reco, su guía en WordPress",
        g: "Importación opcional de hasta 24 meses de pedidos anteriores, para que AICC pueda empezar con pares ya aprendidos",
        h: "Sitio web y área de cuenta en inglés, hebreo, español y ruso",
        i: "Su tienda sigue funcionando aunque AICC no lo haga",
      },
      outro: "Los planes se diferencian únicamente por la capacidad de tiendas.",
    },
    plansSection: {
      title: "Tres planes, con precio según la capacidad de tiendas.",
      note: "Todos los precios están en dólares estadounidenses (USD). Usted confirma su plan en su cuenta de AICC.",
    },
    slots: {
      title: "Cómo funcionan los cupos de tienda",
      p1: "Cada plan tiene un número de cupos de tienda: 1, 3 o 10. Conectar una tienda usa un cupo; desconectarla libera el cupo al instante.",
      p2: "La tienda de pruebas y la de producción cuentan como tiendas distintas. También las variantes con www y sin www de una dirección, y http y https.",
      p3: "Para pasar su plan de una tienda a otra: desconecte la tienda antigua y conecte la nueva. No hay comisión de traslado.",
      p4: "Si todos los cupos están en uso, desconecte una tienda que ya no necesite o compre un plan mayor. No se puede ampliar un plan existente: un plan mayor es una compra aparte, con sus propios 365 días de duración y sus propios cupos de tienda, y no se descuenta del precio ni sustituye su plan actual.",
    },
    which: {
      title: "¿Qué plan elegir?",
      lead: "Cuente las tiendas que quiere conectar.",
      items: {
        solo: "1 tienda",
        studio: "Hasta 3 tiendas",
        agency: "Hasta 10 tiendas",
      },
      outro: "Las funciones son idénticas, así que solo elige capacidad. ¿Más de 10 tiendas? Contacte con soporte; todavía no existe un plan mayor. Dirección de soporte: {supportEmail}",
    },
    finder: {
      label: "¿Cuántas tiendas va a conectar?",
      hint: "¿En cuántos sitios web se ejecutará AICC? La tienda de pruebas cuenta como una.",
      error: "Introduzca un número entero del 1 al 10.",
      many: "¿Más de 10 tiendas? Contacte con soporte; todavía no existe un plan mayor.",
      resultSolo: "El plan Solo cubre 1 tienda en un solo plan.",
      resultStudio: "El plan Studio cubre hasta 3 tiendas en un solo plan.",
      resultAgency: "El plan Agency cubre hasta 10 tiendas en un solo plan.",
      empty: "Su sugerencia aparecerá aquí.",
      suggestion: "El plan más pequeño que encaja",
    },
    terms: {
      title: "Duración, renovación y reembolsos",
      try: {
        title: "Garantía de devolución del dinero",
        body: "La compra inicial de su plan incluye una garantía de devolución del dinero de 14 días. Los 14 días empiezan cuando se recibe el pago y se emite su plan. Importe sus pedidos anteriores (opcional) desde el primer día para ver antes los acompañantes aprendidos. Consulte la [política de reembolso](route:refund-policy) para ver las condiciones completas.",
      },
      renewal: {
        title: "Renovación",
        body: "Usted mantiene el control: AICC nunca renueva su plan automáticamente. Un plan dura 365 días fijos desde la compra. Para renovar, lo compra desde Planes y tiendas en su cuenta y se suman 365 días a la más tardía de estas dos fechas: hoy o su fecha de fin actual, así que renovar antes conserva su tiempo sin usar. No se guarda ninguna autorización de cobro para cargos futuros.",
      },
      back: {
        title: "Si vuelve",
        body: "AICC puede conservar el historial de su tienda cuando se pausa el acceso, para que los comerciantes que regresan continúen en lugar de empezar desde cero. Si su plan venció, renueve el mismo plan y sus tiendas vuelven sin reconectar. Si se reembolsó, el plan antiguo sigue revocado: compre un plan nuevo y conecte la misma tienda. AICC puede reconocerla si la tienda conservó su conexión.",
        link: "Conservación exacta, hoy y como objetivo",
      },
      account: "Necesita una cuenta de AICC para comprar. Normalmente no hay clave de licencia que pegar: usted conecta cada tienda desde su propia pantalla de AICC.",
    },
    questions: {
      title: "Preguntas sobre planes y reembolsos",
    },
    cta: {
      title: "Elija su plan",
      body: "Confirmará su plan en su cuenta de AICC.",
    },
    teaser: {
      text: "¿Quiere ver cómo decide el widget? Pruébelo con productos de ejemplo.",
      link: "Abrir la demostración interactiva",
    },
    final: {
      title: "Empiece con una tienda.",
      body: "Cree su cuenta, elija un plan y conecte su primera tienda.",
    },
  },

  questionsPage: {
    hero: {
      title: "Preguntas, con respuestas claras.",
      lead: "Respuestas directas, agrupadas según lo que está intentando decidir. Si algo no está aquí, pregunte a soporte. Dirección de soporte: {supportEmail}",
    },
    top: {
      title: "Lo más preguntado antes de comprar",
      lead: "Las preguntas que los comerciantes leen primero. Respuestas breves, con un enlace al detalle.",
    },
    search: {
      title: "Encuentre una respuesta",
    },
    browse: {
      title: "Explore las preguntas por tema",
    },
    nav: {
      label: "Ir a un tema",
      backToTop: "Volver a los temas",
    },
  },
  legal: {
    privacy: {
      title: "Política de privacidad",
      intro: "Cómo trata AICC la información sobre los visitantes de este sitio web, sobre las personas que compran y gestionan planes, y sobre las tiendas que conectan.",
      s: {
        who: {
          h: "A quién cubre esta política",
          a: "Esta política cubre tres cosas: este sitio web, su cuenta de AICC y sus compras, y los datos de las tiendas que conecta. Datos de la empresa: {companyDetails}",
          b: "AICC está pensado para empresas. Cuando un comerciante conecta una tienda, la información sobre los compradores de esa tienda pasa por AICC como se describe a continuación.",
        },
        website: {
          h: "Este sitio web",
          a: "Este sitio web no usa analítica, publicidad ni scripts de seguimiento, y no llama a servicios de terceros cuando lo visita. Guarda sus elecciones en su propio navegador: su idioma (una cookie llamada aicc_lang, conservada 1 año, y una entrada equivalente en el almacenamiento local), una entrada de almacenamiento local llamada aicc_lang_dismissed que recuerda que cerró una sugerencia de idioma, y sus ajustes de accesibilidad (almacenamiento local). Permanecen en su dispositivo y se usan solo para mostrar el sitio como usted eligió.",
          b: "La cookie de idioma se envía al servidor del sitio web con las solicitudes de página, como cualquier cookie. Nuestro proveedor de alojamiento puede conservar registros de servidor habituales, como la página solicitada y la dirección IP.",
        },
        account: {
          h: "Su cuenta y sus compras",
          a: "Cuando compra o gestiona un plan, tratamos los datos necesarios para ello: su nombre, sus datos de facturación, su dirección de correo y el historial de pedidos de sus planes. Los usamos para vender y administrar planes, conectar sus tiendas y dar soporte.",
          b: "Los pagos los gestiona un procesador de pagos externo, y AICC no recibe los datos de pago de sus compradores. Procesador de pagos: {paymentProcessor}",
        },
        storeData: {
          h: "Datos de las tiendas que conecta",
          a: "Una vez conectada una tienda, AICC recibe lo siguiente para generar recomendaciones, medir el widget y mostrar su panel:",
          b: [
            "Catálogo: nombres de producto, precios, SKU, categorías, estado del stock, un enlace a cada página de producto y un enlace a la imagen de cada producto (no el archivo de imagen en sí). Los datos de catálogo no incluyen información de clientes ni de pedidos.",
            "Pedidos: los productos (incluidos sus nombres) y cantidades, los totales, la moneda, el país de facturación, los ID de visitante y de sesión cuando existen y, en el caso de compradores con sesión iniciada, el ID de cliente de WooCommerce.",
            "Un identificador de correo seudonimizado (con hash), generado en su tienda a partir del ID de la tienda y del correo del comprador. AICC nunca recibe el correo en claro, el nombre, el número de teléfono ni la dirección.",
            "Nunca datos de pago de ningún tipo.",
          ],
          c: "Los datos de los pedidos se envían desde su tienda en segundo plano a medida que los pedidos se crean o cambian. Se envían tanto si un comprador dio su consentimiento para las estadísticas como si no, porque así es como se aprenden las recomendaciones. Importar los pedidos anteriores es opcional y solo empieza cuando usted lo decide. Si decide importarlos, se envían los pedidos de hasta los últimos 24 meses, únicamente como datos del pedido. Los pedidos hechos antes de conectar no se envían a menos que decida importarlos; los pedidos hechos después de conectar se envían a medida que se crean o se actualizan.",
          d: [
            "Con consentimiento para las estadísticas, AICC también recibe: vistas de producto, de categoría y de páginas de búsqueda, incluidas las palabras escritas en el buscador del sitio; acciones de añadir al carrito; el inicio del proceso de pago; impresiones, clics y adiciones de paquetes del widget.",
            "Con ese consentimiento también recibe los ID de visitante y de sesión, el ID de usuario de WordPress de los compradores con sesión iniciada, un tipo aproximado de dispositivo y navegador, y la dirección de la página de origen.",
          ],
          e: "Las direcciones IP de los compradores se procesan en su sitio y no se envían a AICC. Los hashes que se usan para limitar solicitudes o como identificadores son seudonimizados, no irreversibles.",
        },
        cookies: {
          h: "Cookies en su tienda",
          a: "AICC puede establecer dos cookies propias en su tienda online para medir el widget.",
          b: [
            "Un ID de visitante, conservado 1 año.",
            "Un ID de sesión, conservado 30 minutos.",
            "Ambas necesitan un plan activo, el ajuste de seguimiento de su tienda activado y un plugin de consentimiento compatible con la WP Consent API que conceda las estadísticas. Si no hay ninguno instalado, AICC considera que el consentimiento no se ha dado: ni cookies, ni seguimiento de visitantes, y no se pueden asociar pedidos al widget.",
          ],
          c: "Estos identificadores son seudonimizados, no anónimos. No contienen el nombre ni los datos de contacto de un comprador, pero pueden vincularse entre visitas y pueden considerarse datos personales en el lugar donde usted vive.",
        },
        use: {
          h: "Para qué los usamos",
          a: [
            "Generar recomendaciones a partir de los pedidos de su tienda.",
            "Mostrar su panel, las observaciones y las respuestas de Ask Reco.",
            "Medir el widget: impresiones, clics, adiciones de paquetes y pedidos asociados.",
            "Operar, proteger y dar soporte al servicio.",
          ],
        },
        separate: {
          h: "Las tiendas se mantienen separadas",
          a: "Todo lo que AICC almacena está limitado a la única tienda a la que pertenece. Ninguna tienda puede ver los datos de otra, y los datos no se comparten entre sus tiendas.",
        },
        retention: {
          h: "Cuánto tiempo pueden conservarse los datos",
          a: "Los datos operativos (estado derivado del catálogo, historial de pedidos importado, configuración, sus reglas y lo que han aprendido las recomendaciones) se rigen por dos afirmaciones. **Nuestro objetivo de conservación (hasta 12 meses).** Pueden conservarse hasta 12 meses después de que termine el acceso a AICC, para que un comerciante que regresa pueda continuar en lugar de empezar desde cero.",
          b: "**Lo que ocurre hoy (no se elimina nada automáticamente).** Todavía no existe la eliminación automática, así que los datos operativos pueden conservarse más de 12 meses hasta que se eliminen a petición.",
          c: "Los registros de cuenta, compra, licencia, reembolso y auditoría siguen una conservación distinta, por motivos contables, legales y de seguridad. No forman parte de la cifra de 12 meses.",
          d: "Si vuelve, AICC puede reconocer su tienda si todavía conserva su conexión con AICC; una reinstalación que haya perdido la conexión comienza como una tienda nueva. Cuando se reconoce una tienda que regresa, su historial vuelve a estar disponible y AICC actualiza su copia del catálogo. Si usted decidió importar su historial de pedidos, también se pone al día con los pedidos del intervalo transcurrido; si no lo hizo, no importa nada sin preguntar.",
        },
        requests: {
          h: "Solicitudes de eliminación y exportación",
          a: "Contacte con soporte desde el correo de su cuenta para solicitar la eliminación o la exportación de sus datos. Estas solicitudes se gestionan a mano: no hay un botón de autoservicio. La eliminación borra eventos, impresiones, clics y conversiones y anonimiza los pedidos. El registro de la tienda, la configuración, los datos derivados del catálogo y los registros de licencia y de auditoría siguen su propia conservación, y WooCommerce puede exigir que se conserven algunos registros. Las exportaciones se preparan manualmente. Le indicamos qué registros se conservan. Dirección de soporte: {supportEmail}",
        },
        security: {
          h: "Seguridad",
          a: "Las conexiones entre su tienda, AICC y el sitio de la cuenta usan HTTPS. Las claves de licencia y las credenciales de las tiendas se almacenan con hash. Ninguna medida de seguridad es perfecta, y no prometemos que AICC sea invulnerable.",
        },
        transfers: {
          h: "Dónde se procesan los datos",
          a: "Todavía no indicamos una región de alojamiento ni un mecanismo de transferencia, y no afirmamos ofrecer una ubicación de datos seleccionable. Región de alojamiento: {hostingRegion}",
        },
        rights: {
          h: "Sus derechos",
          a: "Según el lugar donde viva, puede tener derechos sobre su información, como acceso, rectificación, eliminación y exportación. Consulte a soporte. Nada de lo aquí dicho limita los derechos que tenga según la ley del lugar donde vive. Dirección de soporte: {supportEmail}",
        },
        changes: {
          h: "Cambios y contacto",
          a: "Cuando esta política cambie, la actualizaremos junto con la fecha que aparece en la parte superior de la página.",
          b: "¿Preguntas? Dirección de soporte: {supportEmail}",
        },
      },
    },
    terms: {
      title: "Términos del servicio",
      intro: "Los términos para usar los planes de AICC y conectar tiendas. Están escritos en lenguaje sencillo a partir de cómo funciona AICC en realidad.",
      s: {
        agreement: {
          h: "Entre quiénes se establecen estos términos",
          a: "Estos términos se establecen entre usted y la empresa que opera AICC. Al comprar un plan o conectar una tienda, los acepta. Datos de la empresa: {companyDetails}",
          b: "AICC es para uso empresarial. Si lo usa para una empresa o un cliente, confirma que puede aceptar estos términos en su nombre.",
        },
        service: {
          h: "Qué es AICC",
          a: "AICC es un copiloto de recomendaciones y merchandising para el comercio electrónico, disponible para WooCommerce como plugin con un servicio alojado. Añade recomendaciones de producto aprendidas de los pedidos de su tienda (que los compradores ven como un paquete «Comprados juntos con frecuencia»), un panel, observaciones basadas en reglas, controles para el comerciante y Ask Reco.",
          b: "AICC no sustituye a WooCommerce. Sus productos, carrito, proceso de pago y pedidos siguen en WooCommerce.",
        },
        account: {
          h: "Su cuenta",
          a: "Necesita una cuenta de AICC para comprar un plan. Guarde con seguridad sus datos de acceso; usted es responsable de lo que ocurra en su cuenta.",
        },
        plans: {
          h: "Planes, tiendas y duración",
          a: "Un plan dura 365 días desde la compra. Cada plan le permite conectar un número de tiendas:",
          b: [
            "Plan Solo: 1 tienda, {priceSolo} al año.",
            "Plan Studio: hasta 3 tiendas, {priceStudio} al año.",
            "Plan Agency: hasta 10 tiendas, {priceAgency} al año.",
          ],
          c: "Todos los planes tienen todas las funciones. La tienda de pruebas y la de producción cuentan como tiendas distintas. Puede desconectar una tienda para liberar su cupo y conectar otra. No se puede ampliar un plan existente: un plan mayor es una compra aparte, con sus propios 365 días de duración y sus propios cupos de tienda; no se descuenta del precio ni sustituye su plan actual.",
        },
        fees: {
          h: "Precios y renovación",
          a: "Los precios están en dólares estadounidenses, por plan, por año. Los pagos los procesa un procesador de pagos externo. Procesador de pagos: {paymentProcessor}",
          b: "La renovación es manual. No se cobra nada automáticamente y no se guarda ninguna autorización de cobro. Una renovación que usted compre suma 365 días a la más tardía de estas dos fechas: hoy o su fecha de fin actual.",
        },
        refunds: {
          h: "Reembolsos",
          a: "La garantía de devolución del dinero de 14 días en una compra inicial se describe en la [política de reembolso](route:refund-policy), junto con sus excepciones.",
        },
        yourStore: {
          h: "Su tienda y sus compradores",
          a: "Usted es responsable de contar con la autorización necesaria para conectar su tienda y de informar a sus compradores sobre los datos que recoge su tienda, incluido cualquier aviso de cookies y configuración de consentimiento que exija la ley.",
          b: "Los datos de pedidos y de catálogo que envía se usan para operar AICC para usted, como se describe en la [política de privacidad](route:privacy).",
        },
        outcomes: {
          h: "Sin resultados garantizados",
          a: "Las recomendaciones son una ayuda. No prometemos ningún resultado de ventas, ingresos o conversión. El panel muestra los pedidos asociados al widget; eso es asociación, no una prueba de que el widget los causara.",
        },
        availability: {
          h: "Disponibilidad",
          a: "Hacer un pedido nunca espera a AICC: los datos del pedido se ponen en cola y se envían a AICC en segundo plano. AICC está construido para fallar de forma controlada: si AICC o su backend van lentos o no están disponibles, los widgets de recomendaciones simplemente se ocultan y WooCommerce sigue funcionando. No prometemos que el servicio esté siempre disponible ni libre de errores.",
          b: "AICC puede no estar disponible por mantenimiento o por motivos ajenos a nuestro control.",
        },
        inactive: {
          h: "Cuando un plan no está activo",
          a: "Cuando un plan vence, se revoca o se suspende, o se desconecta una tienda, AICC deja de funcionar en la tienda online afectada y la tienda deja de enviar datos de negocio. WooCommerce sigue funcionando como antes.",
          b: "Tras un reembolso completo, el plan se revoca de forma permanente y no se reactiva; puede comprar un plan nuevo.",
        },
        changes: {
          h: "Cambios",
          a: "Podemos modificar AICC o estos términos. Actualizaremos la fecha de esta página. Si no está de acuerdo con un cambio, puede dejar de usar AICC.",
        },
        liability: {
          h: "Garantías y responsabilidad",
          a: "AICC se ofrece tal cual, en la medida en que la ley lo permita. Los límites de nuestra responsabilidad se están ultimando con la revisión legal.",
          b: "Nada de lo aquí dicho limita los derechos que tenga según la ley del lugar donde vive y que no puedan limitarse.",
        },
        law: {
          h: "Ley aplicable",
          a: "Ley aplicable y tribunales: {governingLaw}",
        },
        contact: {
          h: "Contacto",
          a: "¿Preguntas sobre estos términos? Dirección de soporte: {supportEmail}",
        },
      },
    },
    refund: {
      title: "Política de reembolso",
      intro: "Una garantía de devolución del dinero de 14 días en la compra inicial de un plan. Así funciona exactamente.",
      s: {
        guarantee: {
          h: "La garantía",
          a: "Si AICC no es lo que necesita, puede pedir que le devolvamos el dinero dentro de los 14 días siguientes a la compra inicial de un plan.",
          b: "La garantía es una promesa nuestra. No sustituye ningún derecho que tenga por ley.",
        },
        start: {
          h: "Cuándo empiezan los 14 días",
          a: "Los 14 días empiezan cuando se recibe el pago y se emite su plan, no cuando se creó el pedido por primera vez.",
        },
        renewals: {
          h: "Renovaciones",
          a: "La garantía cubre la compra inicial. Las renovaciones manuales posteriores no están cubiertas automáticamente.",
        },
        duplicate: {
          h: "Una compra realizada dos veces por error",
          a: "Una compra realizada dos veces por error puede reembolsarse previa solicitud. Por ejemplo, dos planes adquiridos para la misma tienda en la misma ventana de transacción: una vez identificado el duplicado, da derecho a un reembolso incluso pasados los 14 días. Esto es independiente de la garantía de 14 días y no es una excepción a ella.",
        },
        how: {
          h: "Cómo solicitarlo",
          a: "Escriba a soporte desde el correo de su cuenta dentro de los 14 días e indique el pedido. Dirección de soporte: {supportEmail}",
          b: "Procuramos responder en un día hábil y resolver con prontitud las solicitudes sencillas después. Es un objetivo de servicio, no un plazo contractual. Un reembolso aprobado se hace al método de pago original cuando el procesador de pagos lo permite.",
        },
        exceptions: {
          h: "Excepciones",
          a: [
            "Abuso: ciclos repetidos de compra y reembolso que parecen buscar un uso sin pagar.",
            "Contracargos: iniciar un contracargo con la tarjeta en lugar de contactar con nosotros puede suspender el plan mientras se resuelve.",
            "Límites del procesador de pagos y de los impuestos sobre el importe o el método de un reembolso.",
          ],
        },
        after: {
          h: "Después de un reembolso completo",
          a: "El plan se revoca y AICC deja de funcionar en sus tiendas conectadas. Su tienda WooCommerce sigue vendiendo: productos, pedidos, clientes y proceso de pago no se ven afectados.",
          b: "Un plan revocado nunca se reactiva. Si vuelve, compra un plan nuevo.",
        },
        data: {
          h: "Sus datos después de un reembolso",
          a: "Los datos que AICC conserva sobre sus tiendas siguen la conservación descrita en la [política de privacidad](route:privacy).",
          b: "**Nuestro objetivo de conservación (hasta 12 meses).** Los datos operativos pueden conservarse hasta 12 meses después de que termine el acceso.",
          c: "**Lo que ocurre hoy (no se elimina nada automáticamente).** Todavía no existe la eliminación automática, así que los datos pueden conservarse más de 12 meses hasta que se eliminen a petición.",
          d: "Los registros de cuenta y de compra siguen su propia conservación.",
        },
        nothingElse: {
          h: "Planes y renovación",
          a: "No se puede ampliar un plan existente: un plan mayor es una compra aparte, con su propio plazo de 365 días y sus propios cupos de tienda; no se descuenta del precio ni sustituye su plan actual.",
          b: "AICC nunca renueva un plan automáticamente y no conserva ninguna autorización para volver a cobrarle, así que no hay nada que cancelar.",
        },
        rights: {
          h: "Sus derechos",
          a: "Nada en esta política limita los derechos que tenga según la ley del lugar donde vive. Procesador de pagos: {paymentProcessor}",
        },
      },
    },
    dataTrust: {
      title: "Datos y confianza",
      intro: "AICC nunca recibe los nombres, los correos electrónicos en claro, los números de teléfono, las direcciones postales ni los datos de pago de sus compradores. Aquí se explica exactamente qué lee y qué no lee nunca. La [política de privacidad](route:privacy) es el texto completo.",
      short: {
        h: "La versión corta",
        needsTitle: "AICC necesita",
        needs: [
          "Su catálogo de productos",
          "Las relaciones entre pedidos: qué productos estaban en qué pedidos, con totales, moneda, país de facturación, el ID de cliente de los clientes con sesión iniciada y un identificador de correo con hash",
          "Actividad opcional de los compradores, solo si su herramienta de consentimiento de cookies permite las estadísticas",
        ],
        neverTitle: "AICC no recibe",
        never: [
          "Correos electrónicos en claro",
          "Nombres",
          "Números de teléfono",
          "Direcciones postales",
          "Datos de pago",
          "Direcciones IP de los compradores (se procesan en su sitio, no se envían)",
        ],
        receives: "Sí recibe identificadores seudonimizados (un correo con hash, ID de cliente y de visitante), el país de facturación y el contenido de los pedidos.",
        note: "Llamamos a estos identificadores seudonimizados, no anónimos. Las secciones siguientes explican exactamente qué se envía, qué cookies pueden establecerse y cuánto tiempo pueden conservarse los datos.",
      },
      s: {
        reads: {
          h: "Qué lee AICC de su tienda",
          a: "Cuando conecta una tienda, AICC recibe lo que necesita para saber qué productos se compran juntos:",
          b: [
            "Catálogo: nombres, precios, categorías, imágenes, SKU, enlaces de producto y estado del stock.",
            "Pedidos: productos y nombres de producto, cantidades, totales, moneda, país de facturación, los ID de visitante y de sesión cuando existen, el ID de cliente de WooCommerce de los clientes con sesión iniciada y un identificador de correo seudonimizado (con hash). Se envían los pedidos de todos los estados; solo los pedidos completados y en proceso se cuentan para las recomendaciones.",
            "Pedidos anteriores de hasta los últimos 24 meses, solo si decide importarlos. AICC no importa sus pedidos anteriores hasta que usted lo decida: los pedidos hechos antes de conectar no se envían a menos que los importe, y los hechos después de conectar se envían al crearse o actualizarse.",
          ],
        },
        never: {
          h: "Qué no recibe nunca AICC",
          a: [
            "El correo en claro, el nombre, el número de teléfono ni la dirección postal de un comprador.",
            "Datos de pago de ningún tipo.",
            "Las direcciones IP de los compradores: se procesan en su sitio y no se envían a AICC. Los hashes son seudonimizados, no irreversibles.",
            "No llamamos anónimos a estos datos. Los identificadores seudonimizados aun así pueden considerarse datos personales, por eso decimos qué se envía.",
          ],
        },
        cookies: {
          h: "Cookies y consentimiento",
          a: "Las cookies y los eventos a nivel de visitante necesitan un plan activo, el seguimiento activado en su tienda y un plugin de consentimiento compatible con la WP Consent API que conceda las estadísticas. Entonces AICC establece dos cookies propias en su tienda online para medir el widget.",
          b: [
            "Un ID de visitante, conservado 1 año.",
            "Un ID de sesión, conservado 30 minutos.",
          ],
          c: "Sin ese plugin de consentimiento no hay cookies ni seguimiento de visitantes, y no se pueden asociar pedidos al widget. Los datos de los pedidos se envían igualmente, porque así es como se aprenden las recomendaciones.",
          d: [
            "Con consentimiento para las estadísticas, AICC también recibe: vistas de producto, de categoría y de páginas de búsqueda, incluidas las palabras escritas en el buscador del sitio; acciones de añadir al carrito; el inicio del proceso de pago; impresiones, clics y adiciones de paquetes del widget.",
            "Con ese consentimiento también recibe los ID de visitante y de sesión, el ID de usuario de WordPress de los compradores con sesión iniciada, un tipo aproximado de dispositivo y navegador, y la dirección de la página de origen.",
          ],
        },
        apart: {
          h: "Las tiendas se mantienen separadas",
          a: "Los datos de cada tienda se mantienen separados. Una tienda no puede ver los datos de otra, y los datos no se comparten entre sus tiendas.",
        },
        woo: {
          h: "Qué cambia AICC en WooCommerce",
          a: "AICC no edita los productos, precios ni plantillas de WooCommerce. Añade unos pocos campos privados a los pedidos (ID de visitante y de sesión, solo con consentimiento de cookies) y, por defecto, oculta el bloque de productos relacionados de WooCommerce mientras se muestra su widget. Si lo desactiva, vuelven las recomendaciones nativas.",
        },
        outage: {
          h: "Si AICC o su plan no están disponibles",
          a: "AICC puede fallar; WooCommerce debe seguir funcionando.",
          b: [
            "Si AICC va lento o no está disponible, el widget se oculta y vuelven los productos relacionados de WooCommerce.",
            "Si su plan no está activo, nada de AICC aparece en su tienda online: ni widget, ni script, ni cookies nuevas. Las cookies que ya están en los navegadores se quedan allí, y nada las lee.",
            "Si una tienda se desconecta, no se envían datos de la tienda. Sigue ejecutándose una comprobación técnica de registro.",
          ],
        },
        retention: {
          h: "Su historial puede conservarse cuando el acceso se pausa",
          a: "**Nuestro objetivo de conservación:** los datos operativos (el estado derivado del catálogo, el historial de pedidos importado, sus reglas y lo que AICC aprendió) pueden conservarse hasta 12 meses después de que termine el acceso, para que un comerciante que regresa continúe en lugar de empezar desde cero.",
          b: "**Lo que ocurre hoy:** no se elimina nada automáticamente, así que los datos pueden conservarse más tiempo hasta que se eliminen a petición. Los registros de cuenta, compra, licencia, reembolso y auditoría siguen una conservación distinta.",
          c: "Cuando vuelve, AICC actualiza su copia del catálogo. Si eligió importar su historial de pedidos, también se pone al día con los pedidos del periodo de pausa; si no lo hizo, no importa nada sin preguntar. Nunca inventa historial de recomendaciones del tiempo en que no estuvo funcionando.",
        },
        requests: {
          h: "Pídanos que eliminemos o exportemos",
          a: "Escriba a soporte desde el correo de su cuenta. Estas solicitudes se gestionan a mano. La eliminación borra eventos, impresiones, clics y conversiones y anonimiza los pedidos; el registro de la tienda, la configuración, los datos derivados del catálogo y los registros de licencia y de auditoría siguen su propia conservación, y WooCommerce puede exigir que se conserven algunos registros. Las exportaciones se preparan manualmente. Dirección de soporte: {supportEmail}",
        },
        pending: {
          h: "Lo que aún no hemos definido",
          a: "Algunos detalles aún no son definitivos: los datos de la empresa, la dirección de soporte, la ley aplicable, el procesador de pagos y la región de alojamiento. Se confirmarán antes de que se abran las compras.",
        },
      },
    },
    accessibility: {
      title: "Declaración de accesibilidad",
      intro: "Queremos que todas las personas que visitan este sitio puedan usarlo, incluidas las que usan teclado, lector de pantalla, zoom o alto contraste.",
      s: {
        commitment: {
          h: "Nuestro compromiso",
          a: "Queremos que todas las personas puedan usar este sitio web. Trabajamos la accesibilidad como parte de cómo se construye el sitio, no como un añadido.",
        },
        target: {
          h: "A qué aspiramos",
          a: "Aspiramos al nivel AA de WCAG 2.2. No afirmamos que este sitio web cumpla ni esté certificado: lo probamos, corregimos lo que encontramos y le decimos lo que sabemos que sigue mal.",
        },
        done: {
          h: "Lo que hemos hecho",
          a: [
            "Puntos de referencia semánticos, un solo encabezado principal por página y un orden de encabezados secuencial.",
            "Un enlace para saltar al contenido. Los recorridos principales se pueden usar con teclado: pruebas automáticas cubren la cabecera, los menús, el cuadro de accesibilidad, el selector de idioma, las preguntas y la demostración interactiva, y continúan las pruebas manuales de los recorridos completos.",
            "Un anillo de foco visible en cada control, con contraste suficiente sobre fondos claros y oscuros.",
            "Los colores del texto y de la interfaz se comprueban con un script frente a las relaciones de contraste de WCAG. Nuestros objetivos son al menos 44 píxeles para botones y controles y al menos 24 píxeles para los enlaces dentro del texto.",
            "Se respeta la reducción de movimiento según el ajuste de su sistema y según nuestro propio control, incluido el desplazamiento suave.",
            "Diseño de derecha a izquierda para el hebreo, construido con propiedades lógicas, y con el texto de dirección mixta, como los precios y los nombres de marca, mantenido en orden.",
            "Sin superposición de accesibilidad de terceros. El video en bucle de la parte superior de la página de inicio no tiene sonido, se reproduce solo mientras está en pantalla, se puede pausar y no se reproduce si reduce el movimiento. La demostración del producto es un video aparte con narración: solo empieza cuando pulsa su botón, se abre en un cuadro de diálogo con controles de reproducción y tiene subtítulos en inglés. Los ajustes de accesibilidad (reducir movimiento, mayor contraste, texto más grande) se guardan solo en su navegador.",
          ],
        },
        limits: {
          h: "Limitaciones conocidas",
          a: [
            "Las páginas de inicio de sesión, de cuenta y de pago están en un sitio aparte, y los pagos los gestiona un procesador de pagos externo. No podemos prometer que esas páginas cumplan el mismo estándar.",
            "Los textos en hebreo, español y ruso aún no han sido revisados por hablantes nativos, tampoco en cuanto a accesibilidad.",
            "Las comprobaciones automáticas y manuales no pueden confirmarlo todo, por ejemplo si el texto alternativo es la mejor descripción o si el orden de lectura resulta natural con cada lector de pantalla. No hemos probado con un lector de pantalla ni con todas las combinaciones de navegador y tecnología de asistencia.",
            "Las ilustraciones de Reco contienen palabras cortas dentro de las imágenes. Son decorativas y la misma información está en el texto de la página.",
            "La narración de la demostración del producto y sus subtítulos están en inglés en todas las versiones de idioma del sitio. Los subtítulos contienen toda la narración, así que hacen de transcripción; no hay una página de transcripción aparte. El video no tiene audiodescripción, y el texto que aparece dentro de la imagen del video forma parte del video, no es texto vivo de la página.",
          ],
        },
        report: {
          h: "Informar de una barrera",
          a: "Si algo de este sitio web resulta difícil de usar, escriba a soporte. Indíquenos la página, lo que intentó y la tecnología de asistencia que usa, si se siente cómodo compartiéndola. Aspiramos a responder con prontitud y a corregir las barreras reales. Dirección de soporte: {supportEmail}",
        },
        review: {
          h: "Última revisión",
          a: "Esta declaración se revisó por última vez el {date}, tras comprobaciones automáticas de accesibilidad en todas las páginas en los cuatro idiomas con un ancho de móvil y otro de escritorio, en las cinco páginas principales con cinco anchos, y con mayor contraste y reducción de movimiento activados, además de pruebas automáticas de teclado de los controles principales.",
        },
        jurisdiction: {
          h: "Marcos legales",
          a: "La legislación sobre accesibilidad varía según el país. No hemos hecho ninguna declaración de conformidad según una ley nacional concreta, y esta sección necesita revisión legal antes de que lo hagamos.",
        },
      },
    },
  },
};
