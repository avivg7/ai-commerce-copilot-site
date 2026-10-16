import type { Dictionary } from "./en";

/**
 * Spanish (es) dictionary. Same shape as en.ts. Register: usted throughout (except the widget strings that mirror the
 * real storefront widget). Legal text (legal.*) is a draft translation pending native legal review.
 */
export const es: Dictionary = {
  meta: {
    siteName: "AI Commerce Copilot",
    ogImageAlt: "AICC: «Comprados juntos con frecuencia», aprendido de los pedidos de su propia tienda. Con Reco, la guía de AICC.",
    pages: {
      home: {
        title: "AICC: «Comprados juntos con frecuencia», aprendido de sus propios pedidos",
        description:
          "AICC añade a su WooCommerce un widget de «Comprados juntos con frecuencia», aprendido de los pedidos de su tienda. Planes desde {priceSolo} al año.",
      },
      product: {
        title: "Cómo funciona AICC en tiendas WooCommerce",
        description:
          "Qué ven los compradores, qué controla usted, cómo decide AICC qué recomendar, qué datos usa y qué todavía no hace.",
      },
      pricing: {
        title: "Precios: planes Solo, Studio y Agency",
        description:
          "Plan Solo {priceSolo}, Studio {priceStudio}, Agency {priceAgency} al año. Mismas funciones; solo varía el número de tiendas. Renovación manual y garantía de devolución del dinero.",
      },
      dataTrust: {
        title: "Datos y confianza: qué lee AICC y qué no",
        description:
          "Los datos de tienda y de pedidos que usa AICC, las cookies que puede establecer, cómo se mantienen separadas las tiendas y cuánto tiempo pueden conservarse los datos.",
      },
      privacy: {
        title: "Política de privacidad (borrador)",
        description: "Cómo trata AICC la información del sitio web, de las cuentas y de las tiendas conectadas. Borrador pendiente de revisión legal.",
      },
      terms: {
        title: "Términos del servicio (borrador)",
        description: "Los términos para usar los planes de AICC y conectar tiendas. Borrador pendiente de revisión legal.",
      },
      refund: {
        title: "Política de reembolso: garantía de devolución del dinero de 14 días",
        description:
          "Una garantía de devolución del dinero de 14 días en su compra inicial de un plan, cuándo empieza y qué ocurre después de un reembolso.",
      },
      accessibility: {
        title: "Declaración de accesibilidad",
        description:
          "Cómo aspiramos a cumplir el nivel AA de WCAG 2.2 en este sitio web, qué hemos hecho, las limitaciones conocidas y cómo informar de una barrera.",
      },
      questions: {
        title: "Preguntas que recibimos, respondidas con honestidad",
        description:
          "Las 40 preguntas sobre qué hace AICC, planes y tiendas, renovación, reembolsos, datos y qué ocurre cuando el acceso se pausa.",
      },
      notFound: {
        title: "Página no encontrada",
        description: "Esta página no existe.",
      },
    },
  },

  // Shown (one muted plain line, no pills) in place of owner values that are not supplied yet.
  pending: {
    line: "Los datos de soporte se publicarán antes del lanzamiento.",
    detail: "Este dato se publicará antes del lanzamiento.",
  },

  common: {
    skip: "Saltar al contenido principal",
    nav: {
      label: "Principal",
      product: "Producto",
      pricing: "Precios",
      dataTrust: "Datos y confianza",
      questions: "Preguntas",
      menu: "Menú",
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
    },
    getStarted: "Empezar",
    seeHow: "Ver cómo funciona",
    seePricing: "Ver precios",
    seeAllQuestions: "Ver las 40 preguntas",
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
      tagline: "Un widget de «Comprados juntos con frecuencia» para WooCommerce, aprendido de sus propios pedidos.",
      productHeading: "AICC",
      trustHeading: "Confianza y legal",
      languageHeading: "Idioma",
      copyright: "© {year} {name}",
      note: "AICC es un plugin de WooCommerce. WooCommerce y WordPress son marcas de sus respectivos propietarios.",
    },
    breadcrumbs: { label: "Ruta de navegación" },
    draft: {
      badge: "Borrador: pendiente de revisión legal",
      text: "Este texto es un borrador. No lo ha revisado un abogado ni una persona con autoridad legal, y puede cambiar antes de ser definitivo.",
      translation:
        "Los textos en hebreo, español y ruso aún no han sido revisados por hablantes nativos. Esta traducción es un borrador y además necesita un revisor legal nativo. Si difiere del texto en inglés, prevalece el texto en inglés.",
    },
    plan: {
      perYear: "al año",
      oneStore: "1 tienda",
      upToStores: "Hasta {n} tiendas",
      choose: "Elegir {plan}",
      recommended: "Recomendado para 2 o 3 tiendas",
      sameFeatures: "Todas las funciones, en todos los planes",
      countHelper: "Cuente las tiendas que quiere conectar: 1 tienda es el plan Solo, de 2 a 3 es Studio, de 4 a 10 es Agency.",
      term: "365 días desde la compra",
      renewal: "Renovación manual: sin cobros automáticos",
      guarantee: "Garantía de devolución del dinero de 14 días en su primera compra",
      usd: "Todos los precios están en dólares estadounidenses (USD).",
    },
    toc: "En esta página",
    lastReviewed: "Última revisión",
    draftUpdated: "Borrador actualizado por última vez",
    version: "Estado",
    versionDraft: "Borrador",
  },

  notFound: {
    heading: "No encontramos esa página.",
    body: "Puede que el enlace sea antiguo o esté mal escrito. Su tienda no se ha visto afectada.",
    home: "Ir a la página de inicio",
    questions: "Leer las preguntas",
  },

  // Strings mirror the real storefront widget (get_widget_strings() in the ai-commerce-copilot plugin repo) where one exists.
  demo: {
    label: "Demo ilustrativa: no son datos de una tienda",
    heading: "Pruebe el widget",
    groupLabel: "Productos de este paquete",
    intro:
      "Marque los productos y observe cómo cambia el total del paquete. Los productos, los precios y la fuerza de las relaciones de abajo son inventados, así que aquí no se muestran datos ni resultados de ninguna tienda.",
    nudge: "Empiece con «Sin AICC» y después cambie a «Con AICC».",
    summary: "Seleccionados: {count}. Total del paquete: {total}.",
    dashboard: {
      heading: "Lo que vería en su panel de AICC (ilustración)",
      explain: "Una relación fuerte significa que los dos productos estuvieron en los mismos pedidos con más frecuencia. Son datos de ejemplo, no un resultado.",
    },
    widget: {
      title: "Comprados juntos con frecuencia",
      subtitle: "Los clientes suelen comprar estos productos juntos.",
      bundleTotal: "Total del paquete",
      addOne: "Añadir 1 producto al carrito",
      addMany: "Añadir {count} productos al carrito",
      added: "Añadido al carrito",
      selectAtLeastOne: "Selecciona al menos un producto",
      noteAdd: "No se añade nada a ningún sitio: es una ilustración.",
      addFew: "Añadir {count} productos al carrito",
    },
    mode: {
      legend: "Lo que ve el comprador",
      without: "Sin AICC",
      with: "Con AICC",
      captionWithout: "Reco: misma categoría, no por pedidos.",
      captionWith: "Reco: lo que más se compra junto.",
      withoutCaption:
        "Los productos relacionados de WooCommerce salen de la misma categoría o de las mismas etiquetas. No se basan en lo que los compradores compran juntos.",
      withCaption: "AICC muestra los productos que aparecen en los mismos pedidos que el producto que se está viendo.",
    },
    products: {
      kit: "Juego de café de filtro",
      filters: "Filtros de papel, paquete de 100",
      grinder: "Molinillo manual",
      kettle: "Hervidor de cuello de cisne",
      mug: "Taza de cerámica",
      towel: "Paño de cocina de lino",
      scale: "Taza de viaje",
    },
    anchorTag: "Viendo este producto",
    strength: {
      label: "Relación con el producto que se está viendo",
      strong: "Relación fuerte",
      medium: "Relación media",
      light: "Relación leve",
      none: "Únicamente la misma categoría",
    },
    why: {
      heading: "Por qué estos",
      none: "Marque un producto para ver por qué AICC lo asocia con el juego de café de filtro.",
      filters:
        "En los pedidos de esta tienda de ejemplo, los filtros de papel aparecen con el juego de café de filtro más que cualquier otro producto. Se gastan con cada preparación, así que los compradores vuelven por ellos.",
      grinder:
        "Aquí un molinillo manual es una relación media: quienes montan su rutina de café de filtro suelen añadir uno, pero no siempre.",
      kettle:
        "Un hervidor es una relación leve. Aparece en algunos pedidos con el juego de café de filtro, así que AICC lo muestra después de los acompañantes más fuertes.",
      without:
        "Sin AICC, estos son simplemente productos de la misma categoría. Nada de ellos procede de lo que sus compradores compran juntos.",
    },
    reco: {
      intro: "Reco: marque un producto y le diré con qué fuerza está unido al juego de café de filtro.",
      strong: "Reco: los filtros de papel se gastan con cada preparación, así que van primero.",
      medium: "Reco: un molinillo es una relación media. Muchos pedidos incluyen ambos, pero no la mayoría.",
      light: "Reco: un hervidor es una relación leve. AICC lo mostraría después de acompañantes más fuertes.",
      without: "Reco: estos salen de la categoría, no de los pedidos.",
    },
    keyboardHint: "Use Tab y la barra espaciadora para marcar productos. Las teclas de flecha permiten pasar de uno a otro.",
    sample: "Ejemplo",
  },

  home: {
    hero: {
      title: "Muestre a sus compradores lo que sus propios clientes compran juntos.",
      lead:
        "AICC añade un widget de «Comprados juntos con frecuencia» a las páginas de producto y de carrito de su WooCommerce. Aprende de los pedidos de su propia tienda, así que lo que ven los compradores sale de su catálogo y de sus clientes, no de una lista genérica. Cuando un producto tiene poco historial, AICC completa los huecos con productos de la misma categoría y con sus productos más nuevos, y se lo dice.",
      facts: {
        price: "Planes desde {priceSolo} al año",
        guarantee: "Garantía de devolución del dinero de 14 días en su primera compra",
        noCharge: "Nunca se cobra nada automáticamente",
      },
      cardLabel: "Widget ilustrativo",
      cardTitle: "Comprados juntos con frecuencia",
    },
    demo: {
      title: "«Comprados juntos con frecuencia», aprendido de verdad.",
      lead: "La mayoría de los «productos relacionados» son la misma categoría con otra etiqueta. AICC mira qué ponen sus clientes en el mismo pedido y después completa los huecos de una forma que se lo explica.",
    },
    how: {
      title: "Cómo funciona",
      lead: "Tres pasos. Usted hace el primero; AICC hace el resto en segundo plano.",
      steps: {
        connect: {
          title: "Conectar",
          body: "Inicie sesión en su cuenta de AICC y conecte la tienda desde su propia pantalla de AICC en WordPress. Normalmente no hay clave de licencia que pegar ni código que escribir.",
        },
        learn: {
          title: "Aprender",
          body: "AICC prepara su tienda en segundo plano: sincroniza su catálogo, importa hasta los últimos 24 meses de pedidos anteriores y comprueba que el widget esté listo. Esto empieza cuando abre el panel de AICC en WordPress o cuando se ejecutan las tareas programadas de WordPress, por eso no prometemos un número de minutos.",
        },
        recommend: {
          title: "Recomendar",
          body: "En las páginas de producto y de carrito, el widget muestra lo que sus clientes compraron juntos. Los pedidos nuevos siguen enseñando a AICC, y sus propias reglas ajustan el resultado.",
        },
      },
    },
    control: {
      title: "Usted decide, y WooCommerce sigue funcionando.",
      lead: "AICC es un plugin de WooCommerce. No sustituye a WooCommerce: sus productos, carrito, proceso de pago y pedidos siguen donde están.",
      items: {
        rules: {
          title: "Reglas que controla usted",
          body: "Fije un producto, prefiéralo, baje su prioridad o exclúyalo. Las reglas se aplican después del algoritmo y excluir siempre gana. Los productos agotados o eliminados quedan fuera sea cual sea la regla.",
        },
        dashboard: {
          title: "Un panel que se mantiene honesto",
          body: "Preparación, vistas y clics del widget, y los pedidos asociados al widget. Las observaciones en lenguaje sencillo, basadas en sus propios datos, aparecen cuando hay al menos 10 compras en el periodo mostrado.",
        },
        checkout: {
          title: "Fuera de su proceso de pago",
          body: "El proceso de pago no espera a AICC: AICC no hace ninguna llamada de red a sus servidores mientras un cliente paga. Los datos del pedido se ponen en cola y se envían en segundo plano.",
        },
        failSoft: {
          title: "Si AICC no está disponible",
          body: "El widget se oculta y vuelven los productos relacionados y las ventas cruzadas de WooCommerce. Está construido para fallar sin causar problemas y probado, pero no es una garantía frente a todos los fallos del alojamiento.",
        },
        dormant: {
          title: "Si su plan no está activo",
          body: "Nada de AICC aparece en su tienda online: ni widget, ni script, ni cookies nuevas. Las cookies que ya están en los navegadores se quedan allí, y nada las lee.",
        },
        remove: {
          title: "Poca intervención en WooCommerce",
          body: "AICC no edita los productos, precios ni plantillas de WooCommerce. Añade unos pocos campos privados a los pedidos (ID de visitante y de sesión, solo con consentimiento de cookies) y, por defecto, oculta el bloque de productos relacionados de WooCommerce mientras se muestra su widget. Si lo desactiva, vuelven las recomendaciones nativas.",
        },
      },
      caveat: "Probamos con Storefront y un tema de bloques, y no podemos prometer que funcione con todos los temas ni alojamientos.",
      history: "Su historial puede conservarse cuando el acceso se pausa.",
    },
    reco: {
      title: "Conozca a Reco, la guía dentro de AICC.",
      lead: "Reco aparece donde ayuda: explica cómo funcionan las recomendaciones, responde preguntas en su administración y le acompaña mientras se prepara su tienda.",
      points: {
        one: "Ask Reco responde en inglés y hebreo.",
        two: "Trabaja con los datos de su propio panel. No es un chatbot general.",
        three: "Da información y enlaces. Nunca cambia sus ajustes.",
        four: "Solo para comerciantes: los compradores nunca lo ven.",
      },
    },
    pricing: {
      title: "Planes anuales sencillos.",
      lead: "Los precios son por plan, por año, en dólares estadounidenses. Todos los planes tienen todas las funciones; solo cambia el número de tiendas. La renovación es manual y no se cobra nada automáticamente.",
      link: "Compare los planes y lea los detalles",
    },
    questions: {
      title: "Preguntas que recibimos, respondidas con honestidad.",
      lead: "Una selección breve. La lista completa tiene las 40.",
    },
    final: {
      title: "Listo cuando lo esté su tienda.",
      body: "Cree su cuenta, elija un plan y conecte su primera tienda. La garantía de devolución del dinero de 14 días cubre su compra inicial.",
    },
  },

  product: {
    hero: {
      title: "Cómo funciona AICC, con más detalle.",
      lead: "Qué ven los compradores, qué controla usted, cómo se decide una recomendación y dónde están los límites. Escrito para el dueño de una tienda, no para un ingeniero.",
    },
    toc: {
      shopper: "Qué ven los compradores",
      merchant: "Qué ve y controla usted",
      decide: "Cómo se decide una recomendación",
      data: "Qué datos usa AICC",
      measure: "Medir el widget",
      import: "Importar su historial",
      multi: "Más de una tienda",
      safe: "Cuando algo sale mal",
      returning: "Volver más adelante",
      languages: "Idiomas",
      notYet: "Lo que AICC todavía no hace",
    },
    shopper: {
      title: "Qué ven los compradores",
      p1: "Un widget de «Comprados juntos con frecuencia» en sus páginas de producto y en la página del carrito. En una página de producto, el producto que se está viendo aparece ya marcado y los compradores pueden marcar los demás y añadir el paquete al carrito en un solo paso. En la página del carrito, el punto de partida es el primer artículo del carrito y los productos que ya están en él se dejan fuera.",
      p2: "El widget se adapta al ancho del espacio donde se encuentra, tanto en móviles como en ordenadores. Sigue la dirección de su tema, así que las tiendas de derecha a izquierda se muestran de derecha a izquierda.",
      p3: "Aparece solo en las páginas de producto y en la del carrito. No hay widget en la página de inicio, en las categorías ni en el proceso de pago.",
    },
    merchant: {
      title: "Qué ve y controla usted",
      p1: "En la administración de WordPress hay un panel con la preparación técnica, las vistas del widget, los clics y las adiciones de paquetes, y los pedidos e ingresos asociados al widget. Las observaciones son frases sencillas basadas en reglas, sacadas de sus propios datos (productos principales, paquetes fuertes, productos con mucho interés y pocas compras, rendimiento del widget), y se muestran cuando hay al menos 10 compras en el periodo mostrado. Son deterministas. No las escribe una IA.",
      p2: "Puede fijar, preferir, bajar la prioridad o excluir un producto, para una pareja concreta o en todas partes. Las reglas se aplican después del algoritmo; excluir siempre gana; los productos agotados y eliminados quedan fuera sea cual sea la regla.",
      p3: "Ask Reco responde preguntas habituales sobre la configuración, el rendimiento y los siguientes pasos a partir de los datos de su panel. Funciona para comerciantes en la administración, no puede cambiar ajustes y no se muestra a los compradores.",
    },
    decide: {
      title: "Cómo se decide una recomendación",
      lead: "En este orden, con sus reglas aplicadas al final:",
      steps: {
        learned: {
          title: "Aprendido de sus pedidos",
          body: "AICC examina sus pedidos completados y en proceso. Cuando los clientes compran el producto A, ¿qué otros productos van en el mismo pedido? Esos recuentos, de mayor a menor, son las recomendaciones. Es un simple recuento en el backend de AICC: sin IA generativa y sin perfil por comprador.",
        },
        category: {
          title: "Misma categoría",
          body: "Si un producto tiene muy poco historial de compras para llenar el widget, los cupos restantes se completan con otros productos de la misma categoría.",
        },
        newest: {
          title: "Lo más nuevo en stock",
          body: "Si todavía quedan cupos libres, AICC añade sus productos más nuevos que estén en stock.",
        },
        rules: {
          title: "Sus reglas",
          body: "Fijar, preferir, bajar la prioridad y excluir se aplican al final. Los productos agotados y eliminados se filtran.",
        },
      },
      honest:
        "Algo que conviene saber: hoy el encabezado del widget es el mismo para todos estos casos. Por eso un producto con poco historial puede mostrar productos de la misma categoría o los más nuevos bajo «Comprados juntos con frecuencia». Se lo decimos en lugar de dar a entender que cada artículo es una compra conjunta comprobada.",
    },
    data: {
      title: "Qué datos usa AICC",
      p1: "Su catálogo (nombres, precios, categorías, imágenes, estado del stock) y datos de los pedidos (productos y nombres de producto, cantidades, totales, moneda, país de facturación, ID de visitante y de sesión cuando existen, y un identificador de correo seudonimizado con hash). Nunca recibe el correo en claro, el nombre, el teléfono ni la dirección, ni ningún dato de pago. Con el consentimiento de cookies para estadísticas, también recibe la actividad de compra, como se describe en la [página de datos y confianza](route:data-and-trust).",
      p2: "Los datos de cada tienda se mantienen separados de los de cualquier otra tienda. La página de datos y confianza enumera qué se envía y qué no.",
    },
    measure: {
      title: "Medir el widget",
      p1: "El panel muestra las impresiones del widget, los clics y las adiciones de paquetes, además de los pedidos e ingresos asociados al widget. Un pedido solo se cuenta cuando un comprador añadió un paquete desde el widget y compró alguno de esos productos en un plazo de 24 horas. Se cuenta el total completo del pedido.",
      p2: "Eso es asociación, no causalidad: no dice que el widget causara la venta. Además, requiere que el consentimiento de cookies de su tienda permita las estadísticas, mediante un plugin de consentimiento compatible con la WP Consent API. Si no hay ninguno instalado, no hay cookies y no se pueden asociar pedidos al widget. Los datos de los pedidos se envían igualmente a AICC, porque así es como se aprenden las recomendaciones.",
    },
    import: {
      title: "Importar su historial",
      p1: "Después de conectar, AICC importa en segundo plano hasta los últimos 24 meses de sus pedidos anteriores, para que las recomendaciones puedan aprender desde el primer día. Los pedidos anteriores se importan como pedidos. Nunca se muestran como historial de recomendaciones, y no se crean impresiones, clics ni ingresos atribuidos para un periodo en que AICC no estaba conectado.",
      p2: "No es instantáneo: empieza cuando abre el panel de AICC en WordPress o cuando se ejecutan las tareas programadas de WordPress, y el tiempo depende del tamaño de su tienda. Puede cancelar una importación desde el panel de AICC; una importación cancelada se vuelve a iniciar cuando se pone al día una tienda que regresa. El widget no necesita la importación para aparecer; sin ella, AICC parte de la misma categoría y de los productos más nuevos como alternativa y aprende de los pedidos nuevos.",
    },
    multi: {
      title: "Más de una tienda",
      p1: "El plan Solo conecta 1 tienda, Studio hasta 3 y Agency hasta 10. La tienda de pruebas y la de producción son tiendas distintas, y también lo son las variantes con www y sin www, o con http y https, de la misma dirección. Al desconectar una tienda, su cupo queda libre de inmediato.",
      p2: "Consulte los [precios](route:pricing) para saber cómo funcionan los cupos y qué ocurre si necesita un plan mayor.",
    },
    safe: {
      title: "Cuando algo sale mal",
      p1: "El proceso de pago no espera a AICC: AICC no hace ninguna llamada de red a sus servidores mientras un cliente paga. Los datos del pedido se ponen en cola y se envían en segundo plano. Si AICC o su backend va lento o no está disponible, el widget se oculta y vuelven los productos relacionados y las ventas cruzadas de WooCommerce. Está construido para fallar sin causar problemas y probado, pero no es una garantía frente a todos los posibles fallos del alojamiento, como un servidor que se queda sin memoria.",
      p2: "En un tema poco habitual donde AICC no encuentra un lugar seguro para el widget, se oculta en lugar de adivinar. En ese caso, un desarrollador puede ayudar. AICC no edita los productos, precios ni plantillas de WooCommerce; si lo desactiva, vuelven las recomendaciones nativas.",
    },
    returning: {
      title: "Volver más adelante",
      p1: "Renueve el mismo plan y sus tiendas vuelven sin necesidad de reconectar. Si un plan fue reembolsado, compre un plan nuevo y conecte la misma tienda: AICC puede reconocerla si la tienda todavía conserva su conexión con AICC, y su historial puede volver a estar disponible, porque los datos operativos pueden conservarse hasta 12 meses. Hoy no se elimina nada automáticamente, así que los datos pueden conservarse más tiempo hasta que se eliminen a petición. Una reinstalación que perdió la conexión se trata como una tienda nueva. Un plan reembolsado nunca se reactiva.",
    },
    languages: {
      title: "Idiomas",
      p1: "Este sitio web y su área de cuenta: inglés, hebreo (de derecha a izquierda), español y ruso. La administración de AICC en WordPress: inglés y hebreo. El widget de la tienda online: inglés y hebreo completos, además de las etiquetas principales (encabezado, botones, mensajes) en español, ruso, francés, alemán y árabe.",
    },
    notYet: {
      title: "Lo que AICC todavía no hace",
      items: {
        a: "Recomendaciones personalizadas para cada comprador. Las recomendaciones se basan en el producto, no en la persona.",
        b: "Venta de productos de mayor precio. AICC recomienda productos comprados juntos; no sugiere alternativas más caras.",
        c: "Un widget en la página de inicio, en las páginas de categoría o en el proceso de pago.",
        d: "Un asistente de cara al comprador. Ask Reco es solo para comerciantes.",
        e: "Un encabezado de widget distinto para las alternativas de la misma categoría y de los productos más nuevos.",
        f: "Un ajuste para desactivar la importación automática antes de que empiece.",
      },
      outro: "Preferimos enumerarlo antes que dejar que lo descubra más tarde.",
    },
    demoHeading: "Véalo en acción",
  },

  pricing: {
    hero: {
      title: "Tres planes. Una diferencia.",
      lead: "Todos los planes tienen todas las funciones. La única diferencia es cuántas tiendas puede conectar.",
    },
    plans: {
      solo: { name: "Solo", fit: "Una tienda." },
      studio: { name: "Studio", fit: "Una tienda más su copia de pruebas, o unas pocas tiendas de clientes." },
      agency: { name: "Agency", fit: "Una cartera de tiendas de clientes." },
    },
    included: {
      title: "Qué incluye cada plan",
      items: {
        a: "El widget de «Comprados juntos con frecuencia» en las páginas de producto y de carrito",
        b: "Panel, observaciones basadas en reglas y la exportación en CSV del rendimiento de los productos",
        c: "Reglas de fijar, preferir, bajar la prioridad y excluir",
        d: "Ask Reco en su administración de WordPress",
        e: "Importación de hasta 24 meses de pedidos anteriores",
        f: "Sitio web y área de cuenta en inglés, hebreo, español y ruso",
      },
    },
    slots: {
      title: "Cómo funcionan los cupos de tienda",
      p1: "Cada plan tiene un número de cupos de tienda: 1, 3 o 10. Conectar una tienda usa un cupo; desconectarla libera el cupo al instante.",
      p2: "La tienda de pruebas y la de producción cuentan como tiendas distintas. También las variantes con www y sin www de una dirección, y http y https.",
      p3: "Para pasar su plan de una tienda a otra: desconecte la tienda anterior y conecte la nueva. No hay límite de traslados ni coste adicional.",
      p4: "Si todos los cupos están en uso, desconecte una tienda que ya no necesite o compre un plan mayor. No se puede ampliar un plan existente: un plan mayor es una compra aparte, con sus propios 365 días de duración y sus propios cupos de tienda, y no abona ni sustituye su plan actual.",
    },
    which: {
      title: "¿Qué plan elegir?",
      lead: "Cuente las tiendas que quiere conectar.",
      items: {
        solo: "1 tienda",
        studio: "2 a 3 tiendas",
        agency: "4 a 10 tiendas",
      },
      outro: "Las funciones son idénticas, así que solo elige capacidad. ¿Más de 10 tiendas? Contacte con soporte; todavía no existe un plan mayor. Dirección de soporte: {supportEmail}",
    },
    finder: {
      label: "¿Cuántas tiendas va a conectar?",
      hint: "Introduzca un número entero del 1 al 10.",
      error: "Introduzca un número entero del 1 al 10.",
      resultSolo: "El plan Solo cubre 1 tienda.",
      resultStudio: "El plan Studio cubre hasta 3 tiendas.",
      resultAgency: "El plan Agency cubre hasta 10 tiendas.",
      empty: "Su sugerencia aparecerá aquí.",
      suggestion: "Plan sugerido",
    },
    terms: {
      title: "Duración, renovación y reembolsos",
      items: {
        term: "Un plan dura 365 días desde la compra.",
        renewal: "La renovación es manual. Se compra desde Planes y tiendas en su cuenta y suma 365 días a la más tardía de estas dos fechas: hoy o su fecha de fin actual, así que renovar antes de tiempo conserva el tiempo que no ha usado.",
        billing: "No hay facturación recurrente y no se guarda ninguna autorización de cobro. Nunca se cobra nada automáticamente.",
        guarantee: "Una garantía de devolución del dinero de 14 días cubre su compra inicial. Los 14 días empiezan cuando se recibe el pago y se emite el plan. No cubre automáticamente las renovaciones posteriores. La política de reembolso enumera las excepciones (abuso, compras duplicadas, contracargos y límites del procesador de pagos y de los impuestos).",
        account: "Necesita una cuenta de AICC para comprar. Normalmente no hay clave de licencia que pegar: se conecta cada tienda desde su propia pantalla de AICC.",
      },
      policy: "Leer la política de reembolso",
    },
    refunds: {
      p1: "Tras un reembolso completo, el plan se revoca y AICC deja de funcionar en sus tiendas. WooCommerce no se ve afectado.",
    },
    questions: {
      title: "Preguntas sobre planes y reembolsos",
    },
    cta: {
      title: "Elija su plan",
      body: "Confirmará su plan en su cuenta de AICC.",
    },
  },



  questionsPage: {
    hero: {
      title: "Preguntas que recibimos, respondidas con honestidad.",
      lead: "Las 40, agrupadas por tema. Si algo no está aquí, pregunte a soporte. Dirección de soporte: {supportEmail}",
    },
    topics: {
      basics: "Qué hace AICC",
      plans: "Planes y tiendas",
      billing: "Renovación y facturación",
      refunds: "Reembolsos",
      pause: "Cuando el acceso se pausa, y volver",
      data: "Datos y privacidad",
      reliability: "Fiabilidad y seguridad",
      languages: "Idiomas, móvil y compatibilidad",
    },
  },

  faq: {
    items: {
      q01: {
        q: "¿Qué hace exactamente AICC?",
        a: "Añade a sus páginas de producto y de carrito un widget de recomendaciones «Comprados juntos con frecuencia», aprendido de los pedidos de su propia tienda, y le da un panel, observaciones basadas en reglas, controles de producto y un asistente (Ask Reco) en la administración de WordPress. No sustituye a WooCommerce.",
      },
      q02: {
        q: "¿Cómo decide AICC qué recomendar?",
        a: "Examina los pedidos de su tienda y cuenta qué productos se compran juntos. Cuando un producto tiene poco historial, completa los cupos restantes con productos de la misma categoría y después con sus productos más nuevos en stock. Sus propias reglas (fijar, preferir, bajar la prioridad, excluir) se aplican después. En esta decisión no interviene ninguna IA generativa.",
      },
      q03: {
        q: "¿AICC sustituye a WooCommerce?",
        a: "No. Es un plugin de WooCommerce. Sus productos, carrito, proceso de pago y pedidos siguen en WooCommerce.",
      },
      q04: {
        q: "¿Qué pasa si AICC no está disponible?",
        a: "El widget se oculta y vuelven los productos relacionados de WooCommerce. Su tienda sigue vendiendo.",
      },
      q05: {
        q: "¿Mi proceso de pago llegará a depender de AICC?",
        a: "No. El proceso de pago no espera a AICC: AICC no hace ninguna llamada de red a sus servidores mientras un cliente paga. Los datos del pedido se ponen en cola y se envían en segundo plano. Está construido para fallar sin causar problemas y probado; no es una garantía frente a todos los fallos del alojamiento.",
      },
      q06: {
        q: "¿Necesito un desarrollador?",
        a: "No hay código ni asistente de configuración. AICC coloca el widget en las ubicaciones estándar de WooCommerce. Si en un tema poco habitual no encuentra un lugar seguro, se oculta en lugar de adivinar; en ese caso, un desarrollador puede ayudar.",
      },
      q07: {
        q: "¿Cuánto tarda la configuración?",
        a: "Usted conecta la tienda y AICC la prepara en segundo plano: catálogo, pedidos anteriores y una comprobación de preparación. Esto empieza cuando abre el panel de AICC en WordPress o cuando se ejecutan las tareas programadas de WordPress, y cuánto tarda depende del tamaño de su catálogo, por eso no prometemos una cifra.",
      },
      q08: {
        q: "¿Tengo que pegar una clave de licencia?",
        a: "Normalmente no. Inicie sesión en su cuenta de AICC y conecte cada tienda desde su propia pantalla de AICC.",
      },
      q09: {
        q: "¿Cuál es la diferencia entre Solo, Studio y Agency?",
        a: "Solo varía cuántas tiendas puede conectar: 1, 3 o 10. Todo lo demás es idéntico.",
      },
      q10: {
        q: "¿Los planes tienen funciones distintas?",
        a: "No. Todos los planes incluyen todas las funciones.",
      },
      q11: {
        q: "¿Cómo conecto una segunda o tercera tienda?",
        a: "Abra AICC en la administración de WordPress de la otra tienda, inicie sesión en la misma cuenta de AICC y elija el plan. Usa un cupo libre de su plan.",
      },
      q12: {
        q: "¿Qué pasa cuando todos los cupos de mis tiendas están en uso?",
        a: "Puede desconectar una tienda que ya no necesite o comprar un plan mayor. Un plan mayor es una compra aparte, con sus propios 365 días de duración y sus propios cupos de tienda; no abona ni sustituye su plan actual. Planes y tiendas muestra lo que hay disponible.",
      },
      q13: {
        q: "¿Puedo desconectar una tienda y conectar otra?",
        a: "Sí. Al desconectar, el cupo queda libre de inmediato.",
      },
      q14: {
        q: "¿Puedo reconectar una tienda más adelante?",
        a: "Sí, siempre que su plan esté activo y tenga un cupo libre. No tiene que volver a comprar ni necesita una clave.",
      },
      q15: {
        q: "¿Qué pasa con la tienda desconectada?",
        a: "AICC deja de funcionar en ella: ni widget en la tienda online ni datos de la tienda enviados (sigue ejecutándose una comprobación técnica de registro). WooCommerce funciona con normalidad. El historial de AICC de la tienda puede conservarse hasta 12 meses, pero hoy no se elimina nada automáticamente, así que los datos pueden conservarse más tiempo hasta que se eliminen a petición. Al reconectar, puede continuar donde lo dejó.",
      },
      q16: {
        q: "¿Qué pasa con el widget de recomendaciones cuando mi plan no está activo?",
        a: "AICC no muestra ningún widget, no carga ningún script y no establece cookies nuevas en la tienda online, y en su lugar se muestran las recomendaciones nativas de WooCommerce. Las cookies que ya están en los navegadores se quedan allí, y nada las lee.",
      },
      q17: {
        q: "¿Qué pasa si mi licencia vence?",
        a: "Pasados 365 días, el plan termina. AICC deja de funcionar en sus tiendas hasta que renueve; WooCommerce no se ve afectado.",
      },
      q18: {
        q: "¿La renovación es automática?",
        a: "No. Usted renueva a mano, cuando decide hacerlo.",
      },
      q19: {
        q: "¿Se me cobrará automáticamente?",
        a: "No. No hay facturación recurrente y no se guarda ninguna autorización de cobro.",
      },
      q20: {
        q: "¿Cómo renuevo?",
        a: "Desde Planes y tiendas en su cuenta. Renovar antes de tiempo conserva el tiempo que no ha usado.",
      },
      q21: {
        q: "¿Qué pasa con mis datos si mi plan vence?",
        a: "Los datos operativos pueden conservarse hasta 12 meses después de que termine el acceso, pero hoy no se elimina nada automáticamente, así que los datos pueden conservarse más tiempo hasta que se eliminen a petición. Los registros de cuenta y de compra siguen reglas distintas.",
      },
      q22: {
        q: "¿Qué pasa si vuelvo más adelante?",
        a: "Renueve el mismo plan y sus tiendas vuelven sin necesidad de reconectar. Si su plan fue reembolsado, compre un plan nuevo y conecte la misma tienda: AICC puede reconocerla si la tienda todavía conserva su conexión con AICC, y su historial puede volver a estar disponible. Una reinstalación que perdió la conexión se trata como una tienda nueva. Un plan reembolsado nunca se reactiva.",
      },
      q23: {
        q: "¿Se conserva el historial anterior de mi tienda?",
        a: "Posiblemente. Los datos operativos pueden conservarse hasta 12 meses después de que termine el acceso, pero hoy no se elimina nada automáticamente, así que los datos pueden conservarse más tiempo hasta que se eliminen a petición.",
      },
      q24: {
        q: "¿Qué pasa con los productos y pedidos creados mientras AICC estuvo inactivo?",
        a: "Cuando vuelve, AICC actualiza su copia de su catálogo (incluidos los productos que eliminó) e importa los pedidos del periodo intermedio mediante la misma importación de historial que se usa en la primera conexión.",
      },
      q25: {
        q: "¿Se inventa historial de recomendaciones para el periodo inactivo?",
        a: "Nunca. Los pedidos anteriores se importan como pedidos. No se crean impresiones, clics ni ingresos atribuidos para un periodo en que AICC no estaba funcionando.",
      },
      q26: {
        q: "¿Cuál es la política de reembolso de 14 días?",
        a: "Una garantía de devolución del dinero de 14 días en la compra inicial de un plan. La [política de reembolso](route:refund-policy) completa enumera las excepciones (abuso, compras duplicadas, contracargos y límites del procesador de pagos y de los impuestos). El reembolso se hace al método de pago original cuando el procesador lo permite.",
      },
      q27: {
        q: "¿Cuándo empiezan los 14 días?",
        a: "Cuando se recibe el pago y se emite su plan.",
      },
      q28: {
        q: "¿La garantía de 14 días se aplica a las renovaciones?",
        a: "La garantía cubre la compra inicial. Las renovaciones manuales posteriores no están cubiertas automáticamente.",
      },
      q29: {
        q: "¿Qué pasa después de un reembolso completo?",
        a: "El plan se revoca y AICC deja de funcionar en sus tiendas. Su tienda WooCommerce no se ve afectada.",
      },
      q30: {
        q: "¿Un reembolso afecta a mi tienda WooCommerce?",
        a: "No. Los productos, pedidos, clientes y el proceso de pago siguen como estaban.",
      },
      q31: {
        q: "¿Es obligatoria la importación de pedidos históricos?",
        a: "Empieza automáticamente después de conectar, porque es lo que permite que las recomendaciones aprendan desde el primer día, y cubre hasta los últimos 24 meses. No es obligatoria para que el widget aparezca; sin ella, AICC parte de la misma categoría y de los productos más nuevos como alternativa y aprende de los pedidos nuevos.",
      },
      q32: {
        q: "¿Puedo elegir no importar los pedidos históricos?",
        a: "Puede cancelar una importación desde el panel de AICC; una importación cancelada se vuelve a iniciar cuando se pone al día una tienda que regresa. No hay ningún ajuste para desactivar la importación automática antes de que empiece.",
      },
      q33: {
        q: "¿Qué datos de compradores y de la tienda procesa AICC?",
        a: "Su catálogo (nombres, precios, categorías, imágenes, estado del stock) y datos de los pedidos (productos y nombres de producto, cantidades, totales, moneda, país de facturación, ID de visitante y de sesión cuando existen, y un identificador de correo seudonimizado con hash; nunca el correo en claro, el nombre, el teléfono ni la dirección, ni datos de pago). Si el consentimiento de cookies de su tienda permite las estadísticas mediante un plugin de consentimiento compatible con la WP Consent API, AICC también recibe la actividad de compra (vistas de producto, de categoría y de páginas de búsqueda, incluidas las palabras escritas en el buscador del sitio, acciones de añadir al carrito, el inicio del proceso de pago, impresiones, clics y adiciones de paquetes del widget, el ID de usuario de WordPress de los compradores con sesión iniciada, un tipo aproximado de dispositivo y navegador, y la dirección de la página de origen) y establece dos cookies propias: un ID de visitante (1 año) y un ID de sesión (30 minutos). Sin ese plugin de consentimiento no hay cookies ni seguimiento de visitantes. Los datos de los pedidos se envían en cualquier caso.",
      },
      q34: {
        q: "¿Se comparten datos entre mis distintas tiendas?",
        a: "No. Los datos de cada tienda se mantienen separados.",
      },
      q35: {
        q: "¿Una tienda puede ver los datos de otra?",
        a: "No. Todo lo que AICC almacena está limitado a la única tienda a la que pertenece.",
      },
      q36: {
        q: "¿Cómo puedo solicitar la eliminación o la exportación de mis datos?",
        a: "Contacte con soporte desde el correo de su cuenta. Dirección de soporte: {supportEmail} Gestionamos estas solicitudes a mano: la eliminación borra eventos, impresiones, clics y conversiones y anonimiza los pedidos; el registro de la tienda, la configuración, los datos derivados del catálogo y los registros de licencia y de auditoría siguen su propia conservación, y WooCommerce puede exigir que se conserven algunos registros. Las exportaciones se preparan manualmente, y le avisamos si un registro debe conservarse.",
      },
      q37: {
        q: "¿Qué idiomas se admiten?",
        a: "Este sitio web y el área de cuenta: inglés, hebreo, español y ruso. La administración de AICC en WordPress: inglés y hebreo. El widget de la tienda online: inglés y hebreo completos, además de las etiquetas principales en español, ruso, francés, alemán y árabe.",
      },
      q38: {
        q: "¿AICC funciona en el móvil?",
        a: "El widget se adapta al ancho del espacio donde se encuentra, tanto en móviles como en ordenadores. Este sitio web y su área de cuenta están diseñados pensando primero en los móviles.",
      },
      q39: {
        q: "¿Qué pasa si cambio de tema?",
        a: "AICC encuentra su lugar mediante los hooks estándar de WooCommerce, no editando el tema, así que normalmente sigue funcionando tras un cambio de tema. En un tema donde no puede colocarse con seguridad, se oculta en lugar de adivinar. Probamos con Storefront y un tema de bloques, y no podemos prometer que funcione con todos los temas.",
      },
      q40: {
        q: "¿Puedo quitar AICC sin dañar WooCommerce?",
        a: "Sí. AICC no edita los productos, precios ni plantillas de WooCommerce. Añade unos pocos campos privados a los pedidos (ID de visitante y de sesión, solo con consentimiento de cookies) y, por defecto, oculta el bloque de productos relacionados de WooCommerce mientras se muestra su widget. Desconecte primero la tienda en Planes y tiendas para liberar su cupo, y después desactive AICC: vuelven las recomendaciones nativas.",
      },
    },
  },

  // Legal and trust documents. Structure and review flags live in src/data/legal.ts.
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
            "Catálogo: nombres de producto, precios, categorías, imágenes y estado del stock.",
            "Pedidos: los productos (incluidos sus nombres) y cantidades, los totales, la moneda, el país de facturación, los ID de visitante y de sesión cuando existen y, en el caso de compradores con sesión iniciada, el ID de cliente de WooCommerce.",
            "Un identificador de correo seudonimizado (con hash), generado en su tienda a partir del ID de la tienda y del correo del comprador. AICC nunca recibe el correo en claro, el nombre, el número de teléfono ni la dirección.",
            "Nunca datos de pago de ningún tipo.",
          ],
          c: "Al conectar se importan los pedidos anteriores de hasta los últimos 24 meses, solo como pedidos. Los datos de los pedidos se envían tanto si un comprador dio su consentimiento para las estadísticas como si no, porque así es como se aprenden las recomendaciones.",
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
          a: "Los datos operativos (el estado derivado del catálogo, el historial de pedidos importado, la configuración, sus reglas y el aprendizaje de recomendaciones) pueden conservarse hasta 12 meses después de que termine el acceso a AICC, para que un comerciante que vuelve pueda continuar su trabajo. Hoy no se elimina nada automáticamente, así que los datos pueden conservarse más tiempo hasta que se eliminen a petición.",
          b: "Los registros de cuenta, compra, licencia, reembolso y auditoría siguen una conservación distinta, por motivos contables, legales y de seguridad. No forman parte de la cifra de 12 meses.",
          c: "Si vuelve, AICC puede reconocer su tienda si todavía conserva su conexión con AICC, y su historial puede volver a estar disponible. Una reinstalación que perdió la conexión se trata como una tienda nueva.",
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
          a: "AICC es un plugin de WooCommerce con un servicio alojado. Añade un widget de «Comprados juntos con frecuencia» aprendido de los pedidos de su tienda, un panel, observaciones basadas en reglas, controles para el comerciante y Ask Reco.",
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
          c: "Todos los planes tienen todas las funciones. La tienda de pruebas y la de producción cuentan como tiendas distintas. Puede desconectar una tienda para liberar su cupo y conectar otra. Un plan mayor es una compra aparte, con sus propios 365 días de duración y sus propios cupos de tienda; no abona ni sustituye su plan actual.",
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
          a: "AICC está construido para fallar sin causar problemas, de modo que WooCommerce siga funcionando si AICC o su backend va lento o no está disponible. No prometemos que el servicio esté siempre disponible ni libre de errores.",
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
        how: {
          h: "Cómo solicitarlo",
          a: "Escriba a soporte desde el correo de su cuenta dentro de los 14 días e indique el pedido. Dirección de soporte: {supportEmail}",
          b: "Gestionamos las solicitudes de reembolso personalmente y solemos responder en un día hábil; es una expectativa, no una garantía. Un reembolso aprobado se hace al método de pago original cuando el procesador de pagos lo permite.",
        },
        exceptions: {
          h: "Excepciones",
          a: [
            "Abuso: ciclos repetidos de compra y reembolso que parecen buscar un uso sin pagar.",
            "Compras duplicadas: una compra hecha dos veces por error puede reembolsarse si lo solicita.",
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
          a: "Los datos operativos pueden conservarse hasta 12 meses, pero hoy no se elimina nada automáticamente, así que los datos pueden conservarse más tiempo hasta que se eliminen a petición; consulte la [política de privacidad](route:privacy). Los registros de cuenta y de compra siguen su propia conservación.",
        },
        nothingElse: {
          h: "Nada más que cancelar",
          a: "No hay facturación recurrente, así que no hay nada más que cancelar después de un reembolso.",
        },
        rights: {
          h: "Sus derechos",
          a: "Nada en esta política limita los derechos que tenga según la ley del lugar donde vive. Procesador de pagos: {paymentProcessor}",
        },
      },
    },

    dataTrust: {
      title: "Datos y confianza",
      intro: "Un resumen en lenguaje sencillo. La [política de privacidad](route:privacy) es el texto completo.",
      s: {
        reads: {
          h: "Qué lee AICC de su tienda",
          a: "Cuando conecta una tienda, AICC recibe lo que necesita para saber qué productos se compran juntos:",
          b: [
            "Catálogo: nombres, precios, categorías, imágenes y estado del stock.",
            "Pedidos: productos y nombres de producto, cantidades, totales, moneda, país de facturación, ID de visitante y de sesión cuando existen, y un identificador de correo seudonimizado (con hash).",
            "Pedidos anteriores de hasta los últimos 24 meses, importados como pedidos.",
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
          a: "Los datos operativos (el estado derivado del catálogo, el historial de pedidos importado, sus reglas y lo que AICC aprendió) pueden conservarse hasta 12 meses después de que termine el acceso, pero hoy no se elimina nada automáticamente, así que los datos pueden conservarse más tiempo hasta que se eliminen a petición.",
          b: "Los registros de cuenta, compra, licencia, reembolso y auditoría siguen una conservación distinta.",
          c: "Cuando vuelve, AICC actualiza su copia de su catálogo e importa los pedidos del periodo intermedio. Nunca inventa un historial de recomendaciones para el tiempo en que no estuvo funcionando.",
        },
        requests: {
          h: "Pídanos que eliminemos o exportemos",
          a: "Escriba a soporte desde el correo de su cuenta. Estas solicitudes se gestionan a mano. La eliminación borra eventos, impresiones, clics y conversiones y anonimiza los pedidos; el registro de la tienda, la configuración, los datos derivados del catálogo y los registros de licencia y de auditoría siguen su propia conservación, y WooCommerce puede exigir que se conserven algunos registros. Las exportaciones se preparan manualmente. Dirección de soporte: {supportEmail}",
        },
        pending: {
          h: "Lo que aún no hemos ultimado",
          a: "Algunos detalles todavía no se han publicado: los datos de la empresa, la dirección de soporte, la ley aplicable, el procesador de pagos y la región de alojamiento. Se publicarán antes del lanzamiento.",
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
            "Regiones semánticas, un solo encabezado principal por página y un orden secuencial de encabezados.",
            "Un enlace para saltar al contenido. Los recorridos principales se pueden usar con teclado: las pruebas automáticas cubren la cabecera, los menús, el diálogo de accesibilidad, el selector de idioma, las preguntas y la demo interactiva, y las pruebas manuales de los recorridos completos continúan.",
            "Foco visible en cada control, con un contraste suficiente sobre fondos claros y oscuros.",
            "Contraste del texto y de la interfaz comprobado con las proporciones de WCAG mediante un script. Los botones y controles miden al menos 44 píxeles de alto, y los enlaces dentro del texto al menos 24 píxeles.",
            "Se respeta la reducción de movimiento, tanto desde el ajuste de su sistema como desde nuestro propio control, incluido el desplazamiento suave.",
            "Diseño de derecha a izquierda para el hebreo, construido con propiedades lógicas, y con el texto de dirección mixta, como precios y nombres de marca, mantenido en orden.",
            "Sin audio, sin vídeo de reproducción automática y sin ninguna superposición de accesibilidad de terceros. Sus ajustes de accesibilidad se guardan solo en su navegador.",
          ],
        },
        limits: {
          h: "Limitaciones conocidas",
          a: [
            "Las páginas de inicio de sesión, de cuenta y de pago están en un sitio aparte, y los pagos los gestiona un procesador de pagos externo. No podemos prometer que esas páginas cumplan el mismo estándar.",
            "Los textos en hebreo, español y ruso aún no han sido revisados por hablantes nativos, tampoco en cuanto a accesibilidad.",
            "Las comprobaciones automáticas y manuales no pueden confirmarlo todo, por ejemplo si el texto alternativo es la mejor descripción o si el orden de lectura resulta natural con cada lector de pantalla. No hemos probado con un lector de pantalla ni con todas las combinaciones de navegador y tecnología de asistencia.",
            "Las ilustraciones de Reco contienen palabras cortas dentro de las imágenes. Son decorativas y la misma información está en el texto de la página.",
          ],
        },
        report: {
          h: "Informar de una barrera",
          a: "Si algo de este sitio web resulta difícil de usar, escriba a soporte. Indíquenos la página, lo que intentó y la tecnología de asistencia que usa, si se siente cómodo compartiéndola. Aspiramos a responder con prontitud y a corregir las barreras reales. Dirección de soporte: {supportEmail}",
        },
        review: {
          h: "Última revisión",
          a: "Esta declaración se revisó por última vez el {date}, tras comprobaciones automáticas en todas las páginas en los cuatro idiomas, con anchos de móvil y de escritorio, y pruebas automáticas de teclado de los controles principales.",
        },
        jurisdiction: {
          h: "Marcos legales",
          a: "La legislación sobre accesibilidad varía según el país. No hemos hecho ninguna declaración de conformidad según una ley nacional concreta, y esta sección necesita revisión legal antes de que lo hagamos.",
        },
      },
    },
  },
};
