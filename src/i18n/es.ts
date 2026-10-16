import type { Dictionary } from "./en";

/**
 * Spanish (es) dictionary. Same shape as en.ts. Legal text (legal.*) is a draft translation pending native legal review.
 */
export const es: Dictionary = {
  meta: {
    siteName: "AI Commerce Copilot",
    ogImageAlt: "AICC: Comprados juntos con frecuencia, aprendido de los pedidos de tu propia tienda. Con Reco, la guía de AICC.",
    pages: {
      home: {
        title: "AICC: Comprados juntos con frecuencia, según tus pedidos",
        description:
          "AICC añade un widget de Comprados juntos con frecuencia a las páginas de producto y de carrito de tu WooCommerce, aprendido de los pedidos de tu propia tienda. Planes desde {priceSolo} al año.",
      },
      product: {
        title: "Cómo funciona AICC en tiendas WooCommerce",
        description:
          "Qué ven los compradores, qué controlas tú, cómo decide AICC qué recomendar, qué datos usa y qué todavía no hace.",
      },
      pricing: {
        title: "Precios: planes Solo, Studio y Agency",
        description:
          "Solo {priceSolo}, Studio {priceStudio} y Agency {priceAgency} al año. Las mismas funciones en todos los planes; solo cambia el número de tiendas. Renovación manual y garantía de devolución del dinero de 14 días.",
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
        title: "Política de reembolso: garantía de 14 días",
        description:
          "Una garantía de devolución del dinero de 14 días en tu compra inicial de un plan, cuándo empieza y qué ocurre después de un reembolso.",
      },
      accessibility: {
        title: "Declaración de accesibilidad",
        description:
          "Cómo aspiramos a cumplir el nivel AA de WCAG 2.2 en este sitio web, qué hemos hecho, las limitaciones conocidas y cómo informar de una barrera.",
      },
      questions: {
        title: "Preguntas frecuentes, respondidas con honestidad",
        description:
          "Las 40 preguntas sobre qué hace AICC, planes y tiendas, renovación, reembolsos, datos y qué ocurre cuando el acceso se pausa.",
      },
      notFound: {
        title: "Página no encontrada",
        description: "Esta página no existe.",
      },
    },
  },

  pending: {
    legalName: "razón social de la empresa",
    address: "dirección de la empresa",
    supportEmail: "correo de soporte",
    governingLaw: "ley aplicable",
    paymentProcessor: "procesador de pagos",
    hostingRegion: "región de alojamiento",
    suffix: "pendiente",
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
    learnMoreProduct: "Cómo funciona AICC",
    home: "Inicio de AICC",
    language: {
      label: "Idioma",
      choose: "Elegir idioma",
      current: "actual",
    },
    langSuggest: {
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
    },
    footer: {
      tagline: "Un widget de Comprados juntos con frecuencia para WooCommerce, aprendido de tus propios pedidos.",
      productHeading: "AICC",
      trustHeading: "Confianza y legal",
      languageHeading: "Idioma",
      copyright: "© {year} {legalName}",
      note: "AICC es un plugin de WooCommerce. WooCommerce y WordPress son marcas de sus respectivos propietarios.",
    },
    breadcrumbs: { label: "Ruta de navegación" },
    draft: {
      badge: "Borrador: pendiente de revisión legal",
      text: "Este texto es un borrador. No lo ha revisado una persona con autoridad legal y puede cambiar antes de ser definitivo.",
      translation:
        "Esta traducción es un borrador. Necesita un revisor legal nativo antes de ser definitiva. Si difiere del texto en inglés, prevalece el texto en inglés.",
    },
    plan: {
      perYear: "al año",
      oneStore: "1 tienda",
      upToStores: "Hasta {n} tiendas",
      choose: "Elegir {plan}",
      recommended: "Recomendado para 2 o 3 tiendas",
      sameFeatures: "Todas las funciones, en todos los planes",
      term: "365 días desde la compra",
      renewal: "Renovación manual: sin cobros automáticos",
      guarantee: "Garantía de devolución del dinero de 14 días en tu primera compra",
    },
    toc: "En esta página",
    lastReviewed: "Última revisión",
    version: "Estado",
    versionDraft: "Borrador",
  },

  notFound: {
    heading: "No encontramos esa página.",
    body: "Puede que el enlace sea antiguo o esté mal escrito. Tu tienda no se ha visto afectada.",
    home: "Ir a la página de inicio",
    questions: "Leer las preguntas",
  },

  // Strings mirror the real storefront widget (get_widget_strings in class-aicc-widget.php) where one exists.
  demo: {
    label: "Demo ilustrativa: no son datos de una tienda",
    heading: "Prueba el widget",
    groupLabel: "Productos de este paquete",
    intro:
      "Marca los productos y observa cómo cambia el total del paquete. Los productos, precios y enlaces de abajo son artículos de ejemplo inventados, así que aquí no se muestran datos ni resultados de ninguna tienda.",
    widget: {
      title: "Comprados juntos con frecuencia",
      subtitle: "Los clientes suelen comprar estos productos juntos.",
      bundleTotal: "Total del paquete",
      addOne: "Añadir 1 producto al carrito",
      addMany: "Añadir {count} productos al carrito",
      added: "Añadido al carrito",
      selectAtLeastOne: "Selecciona al menos un producto",
      noteAdd: "No se añade nada a ningún sitio: es una ilustración.",
    },
    mode: {
      legend: "Lo que ve el comprador",
      without: "Sin AICC",
      with: "Con AICC",
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
      none: "Solo la misma categoría",
    },
    why: {
      heading: "Por qué estos",
      none: "Marca un producto para ver por qué AICC lo asocia con el juego de café de filtro.",
      filters:
        "En los pedidos de esta tienda de ejemplo, los filtros de papel aparecen con el juego de café de filtro más que cualquier otro producto. Se gastan con cada preparación, así que los compradores vuelven por ellos.",
      grinder:
        "Aquí un molinillo manual es una relación media: quienes montan su rutina de café de filtro suelen añadir uno, pero no siempre.",
      kettle:
        "Un hervidor es una relación leve. Aparece en algunos pedidos con el juego de café de filtro, así que AICC lo muestra después de los acompañantes más fuertes.",
      without:
        "Sin AICC, estos son simplemente productos de la misma categoría. Nada de ellos procede de lo que tus compradores compran juntos.",
    },
    reco: {
      intro: "Reco: marca un producto y te diré con cuánta fuerza está unido al juego de café de filtro.",
      strong: "Reco: esa es la relación más fuerte de este ejemplo.",
      medium: "Reco: una relación media. Muchos pedidos incluyen ambos, pero no la mayoría.",
      light: "Reco: una relación leve. AICC la mostraría después de acompañantes más fuertes.",
      without: "Reco: estos salen de la categoría, no de los pedidos.",
    },
    keyboardHint: "Usa Tab y la barra espaciadora para marcar productos. Las teclas de flecha te mueven entre ellos.",
    sample: "Ejemplo",
  },

  home: {
    hero: {
      title: "Muestra a tus compradores lo que tus propios clientes realmente compran juntos.",
      lead:
        "AICC añade un widget de Comprados juntos con frecuencia a las páginas de producto y de carrito de tu WooCommerce. Aprende de los pedidos de tu propia tienda, así que lo que ven los compradores sale de tu catálogo y de tus clientes, no de una lista genérica.",
      facts: {
        price: "Planes desde {priceSolo} al año",
        guarantee: "Garantía de devolución del dinero de 14 días en tu primera compra",
        noCharge: "Nunca se cobra nada automáticamente",
      },
      cardLabel: "Widget ilustrativo",
      cardTitle: "Comprados juntos con frecuencia",
    },
    what: {
      title: "Qué hace AICC, sin rodeos.",
      lead: "AICC es un plugin de WooCommerce. No sustituye a WooCommerce: tus productos, carrito, proceso de pago y pedidos siguen exactamente donde están.",
      items: {
        widget: {
          title: "Un widget aprendido de tus pedidos",
          body: "Comprados juntos con frecuencia en las páginas de producto y de carrito. AICC cuenta qué productos aparecen en los mismos pedidos de tu tienda. En esa decisión no interviene ninguna IA generativa.",
        },
        dashboard: {
          title: "Un panel que se mantiene honesto",
          body: "Preparación, vistas y clics del widget, y los pedidos asociados al widget. Las observaciones en lenguaje sencillo, basadas en tus propios datos, aparecen cuando tienes al menos 10 compras.",
        },
        rules: {
          title: "Reglas que controlas tú",
          body: "Fija, prefiere, resta prioridad o excluye cualquier producto en las recomendaciones. Tus reglas se aplican después del algoritmo, y excluir siempre gana.",
        },
        reco: {
          title: "Ask Reco",
          body: "Un asistente solo para comerciantes dentro de la administración de WordPress. Responde preguntas habituales sobre la configuración, el rendimiento y los siguientes pasos a partir de los datos de tu propio panel.",
        },
      },
    },
    demo: {
      title: "Comprados juntos con frecuencia, aprendido de verdad.",
      lead: "La mayoría de los «productos relacionados» son la misma categoría con otra etiqueta. AICC mira qué ponen tus clientes en el mismo pedido y después rellena los huecos de una forma que te explica.",
    },
    how: {
      title: "Cómo funciona",
      lead: "Cuatro pasos. Tú haces el primero; AICC hace el resto en segundo plano.",
      steps: {
        connect: {
          title: "Conectar",
          body: "Inicia sesión en tu cuenta de AICC y conecta la tienda desde su propia pantalla de AICC en WordPress. No hay clave de licencia que pegar ni código que escribir.",
        },
        learn: {
          title: "Aprender",
          body: "AICC prepara tu tienda en segundo plano: sincroniza tu catálogo, importa hasta los últimos 24 meses de pedidos anteriores y comprueba que el widget esté listo. Cuánto tarda depende de tu tienda y de las tareas en segundo plano de WordPress, por eso no prometemos una cifra.",
        },
        recommend: {
          title: "Recomendar",
          body: "En las páginas de producto y de carrito, el widget muestra lo que tus clientes compraron juntos. Cuando un producto tiene poco historial, los lugares restantes se completan con productos de la misma categoría y después con tus productos más nuevos en stock.",
        },
        improve: {
          title: "Mejorar",
          body: "Los pedidos nuevos siguen enseñando a AICC. Tus reglas de fijar, preferir, restar prioridad y excluir ajustan el resultado, y el panel muestra cómo se usa el widget.",
        },
      },
    },
    reco: {
      title: "Conoce a Reco, la guía dentro de AICC.",
      lead: "Reco aparece donde ayuda: explica cómo funcionan las recomendaciones, responde preguntas en tu administración y te acompaña mientras se prepara tu tienda.",
      points: {
        one: "Responde en inglés y hebreo.",
        two: "Trabaja con los datos de tu propio panel. No es un chatbot general.",
        three: "Da información y enlaces. Nunca cambia tus ajustes.",
        four: "Solo para comerciantes: los compradores nunca lo ven.",
      },
    },
    control: {
      title: "Tú decides qué se muestra.",
      lead: "Cuatro reglas, aplicadas después de que el algoritmo haya hecho su recuento.",
      items: {
        pin: { title: "Fijar", body: "Pon un producto al principio de la lista." },
        prefer: { title: "Preferir", body: "Sube un producto, sin obligarlo a ir en primer lugar." },
        deprioritise: { title: "Restar prioridad", body: "Baja un producto. Sigue siendo elegible." },
        exclude: { title: "Excluir", body: "No lo recomienda nunca. Excluir siempre gana." },
      },
      note: "Los productos agotados o eliminados se dejan fuera igualmente, diga lo que diga la regla.",
    },
    safe: {
      title: "Hecho para que WooCommerce siga funcionando.",
      lead: "AICC puede fallar; WooCommerce debe seguir funcionando. Cada punto de integración está construido así y probado para ello.",
      items: {
        checkout: {
          title: "Fuera de tu proceso de pago",
          body: "El proceso de pago nunca espera a AICC. Los datos del pedido se envían a AICC en segundo plano.",
        },
        failSoft: {
          title: "Si AICC no está disponible",
          body: "El widget se oculta y vuelven los productos relacionados y las ventas cruzadas de WooCommerce. Tu tienda sigue vendiendo.",
        },
        dormant: {
          title: "Si tu plan no está activo",
          body: "Nada de AICC aparece en tu tienda online: ni widget, ni script, ni cookies.",
        },
        remove: {
          title: "Sin cambios en WooCommerce",
          body: "AICC no altera los datos ni las plantillas de WooCommerce. Desactívalo y tu tienda vuelve a las recomendaciones nativas de WooCommerce.",
        },
      },
      caveat: "Probamos con Storefront y un tema de bloques, y no podemos prometer que funcione con todos los temas ni alojamientos.",
    },
    multi: {
      title: "Un plan, una tienda o varias.",
      lead: "Todos los planes tienen todas las funciones. La única diferencia es cuántas tiendas puedes conectar.",
      items: {
        solo: "Para una sola tienda.",
        studio: "Para una tienda más su copia de pruebas, o unas pocas tiendas de clientes.",
        agency: "Para la cartera de una agencia.",
      },
      note: "La tienda de pruebas y la de producción cuentan como tiendas distintas. Para mover un plan, desconecta la tienda anterior y conecta la nueva; no hay coste de traslado.",
    },
    returning: {
      title: "Tu historial no desaparece cuando el acceso se pausa.",
      body: "Si tu plan termina o desconectas una tienda, AICC deja de funcionar en tu tienda online. Los datos operativos (el estado derivado del catálogo, el historial de pedidos importado, tus reglas y lo que AICC aprendió) pueden conservarse hasta 12 meses, de modo que, si vuelves, continúas donde lo dejaste. Los registros de cuenta y de compra siguen reglas distintas.",
      gap: "Cuando vuelves, AICC actualiza su copia de tu catálogo e importa los pedidos del periodo intermedio. Nunca inventa un historial de recomendaciones para el tiempo en que no estuvo funcionando.",
      link: "Leer la página de datos y confianza",
    },
    pricing: {
      title: "Planes anuales sencillos.",
      lead: "Los precios son por plan, por año, en dólares estadounidenses. La renovación es manual y no se cobra nada automáticamente.",
      link: "Comparar planes y leer los detalles",
    },
    questions: {
      title: "Preguntas frecuentes, respondidas con honestidad.",
      lead: "Una selección breve. La lista completa tiene las 40.",
    },
    final: {
      title: "Listo cuando lo esté tu tienda.",
      body: "Crea tu cuenta, elige un plan y conecta tu primera tienda. La garantía de devolución del dinero de 14 días cubre tu compra inicial.",
    },
  },

  product: {
    hero: {
      title: "Cómo funciona AICC, con más detalle.",
      lead: "Qué ven los compradores, qué controlas tú, cómo se decide una recomendación y dónde están los límites. Escrito para el dueño de una tienda, no para un ingeniero.",
    },
    toc: {
      shopper: "Qué ven los compradores",
      merchant: "Qué ves y controlas",
      decide: "Cómo se decide una recomendación",
      data: "Qué datos usa AICC",
      measure: "Medir el widget",
      import: "Importar tu historial",
      multi: "Más de una tienda",
      safe: "Cuando algo sale mal",
      returning: "Volver más adelante",
      languages: "Idiomas",
      notYet: "Lo que AICC todavía no hace",
    },
    shopper: {
      title: "Qué ven los compradores",
      p1: "Un widget de Comprados juntos con frecuencia en tus páginas de producto y en la página del carrito. En una página de producto, el producto que se está viendo aparece ya marcado y los compradores pueden marcar los demás y añadir el paquete al carrito en un solo paso. En la página del carrito, el punto de partida es el primer artículo del carrito y los productos que ya están en él se dejan fuera.",
      p2: "El widget se adapta al ancho del espacio donde se encuentra, tanto en móviles como en ordenadores. Sigue la dirección de tu tema, así que las tiendas de derecha a izquierda se muestran de derecha a izquierda.",
      p3: "Aparece solo en las páginas de producto y en la del carrito. No hay widget en la página de inicio, en las categorías ni en el proceso de pago.",
    },
    merchant: {
      title: "Qué ves y controlas",
      p1: "En la administración de WordPress hay un panel con la preparación técnica, las vistas del widget, los clics y las adiciones de paquetes, y los pedidos e ingresos asociados al widget. Las observaciones son frases sencillas basadas en reglas, sacadas de tus propios datos (productos principales, paquetes fuertes, productos con mucho interés y pocas compras, rendimiento del widget), y se muestran cuando hay al menos 10 compras. Son deterministas. No las escribe una IA.",
      p2: "Puedes fijar, preferir, restar prioridad o excluir un producto, para una pareja concreta o en todas partes. Las reglas se aplican después del algoritmo; excluir siempre gana; los productos agotados y eliminados quedan fuera sea cual sea la regla.",
      p3: "Ask Reco responde preguntas habituales sobre la configuración, el rendimiento y los siguientes pasos a partir de los datos de tu panel. Funciona para comerciantes en la administración, no puede cambiar ajustes y no se muestra a los compradores.",
    },
    decide: {
      title: "Cómo se decide una recomendación",
      lead: "En este orden, con tus reglas aplicadas al final:",
      steps: {
        learned: {
          title: "Aprendido de tus pedidos",
          body: "AICC examina tus pedidos completados y en proceso. Cuando los clientes compran el producto A, ¿qué otros productos van en el mismo pedido? Esos recuentos, de mayor a menor, son las recomendaciones. Es un simple recuento en el backend de AICC: sin IA generativa y sin perfil por comprador.",
        },
        category: {
          title: "Misma categoría",
          body: "Si un producto tiene muy poco historial de compras para llenar el widget, los lugares restantes se completan con otros productos de la misma categoría.",
        },
        newest: {
          title: "Lo más nuevo en stock",
          body: "Si todavía quedan lugares libres, AICC añade tus productos más nuevos que estén en stock.",
        },
        rules: {
          title: "Tus reglas",
          body: "Fijar, preferir, restar prioridad y excluir se aplican al final. Los productos agotados y eliminados se filtran.",
        },
      },
      honest:
        "Algo que conviene saber: hoy el encabezado del widget es el mismo para todos estos casos. Por eso un producto con poco historial puede mostrar productos de la misma categoría o los más nuevos bajo «Comprados juntos con frecuencia». Te lo decimos en lugar de dar a entender que cada artículo es una compra conjunta comprobada.",
    },
    data: {
      title: "Qué datos usa AICC",
      p1: "Tu catálogo (nombres, precios, categorías, imágenes, estado del stock) y datos de los pedidos (productos, cantidades, totales, país de facturación y un hash unidireccional del correo). Nunca recibe el correo en claro, el nombre, el teléfono ni la dirección, ni ningún dato de pago.",
      p2: "Los datos de cada tienda se mantienen separados de los de cualquier otra tienda. La [página de datos y confianza](route:data-and-trust) enumera exactamente qué se lee y qué no.",
    },
    measure: {
      title: "Medir el widget",
      p1: "El panel muestra las impresiones del widget, los clics y las adiciones de paquetes, además de los pedidos e ingresos asociados al widget. Un pedido solo se cuenta cuando un comprador usó el propio botón de añadir al carrito del widget y compró alguno de esos productos en un plazo de 24 horas. Se atribuye el total completo del pedido.",
      p2: "Eso es asociación, no causalidad: no dice que el widget causara la venta. Además, requiere que la configuración de consentimiento de cookies de tu tienda permita el seguimiento estadístico; sin consentimiento, no se rastrea nada.",
    },
    import: {
      title: "Importar tu historial",
      p1: "Después de conectar, AICC importa en segundo plano hasta los últimos 24 meses de tus pedidos anteriores, para que las recomendaciones puedan aprender desde el primer día. Los pedidos anteriores se importan como pedidos. Nunca se muestran como historial de recomendaciones, y no se crean impresiones, clics ni ingresos atribuidos para un periodo en que AICC no estaba conectado.",
      p2: "No es instantáneo: el tiempo depende del tamaño de tu tienda y del programador de tareas en segundo plano de WordPress. Puedes cancelar una importación desde el panel de AICC. El widget no necesita la importación para aparecer; sin ella, AICC empieza con la categoría y los productos más nuevos como alternativa y aprende de los pedidos nuevos.",
    },
    multi: {
      title: "Más de una tienda",
      p1: "Solo conecta 1 tienda, Studio hasta 3 y Agency hasta 10. La tienda de pruebas y la de producción son tiendas distintas, y también lo son las variantes con www y sin www, o con http y https, de la misma dirección. Al desconectar una tienda, su cupo queda libre de inmediato.",
      p2: "Consulta los [precios](route:pricing) para saber cómo funcionan los cupos.",
    },
    safe: {
      title: "Cuando algo sale mal",
      p1: "AICC no está en tu proceso de pago. Si AICC o su backend va lento o no está disponible, el widget se oculta y vuelven los productos relacionados y las ventas cruzadas de WooCommerce. Está construido y probado así, pero no es una garantía frente a todos los posibles fallos del alojamiento, como un servidor que se queda sin memoria.",
      p2: "En un tema poco habitual donde AICC no encuentra un lugar seguro para el widget, se oculta en lugar de adivinar. En ese caso, un desarrollador puede ayudar.",
    },
    returning: {
      title: "Volver más adelante",
      p1: "Renueva el mismo plan y tus tiendas vuelven sin necesidad de reconectar. Si un plan fue reembolsado, compra un plan nuevo y conecta la misma tienda: AICC la reconoce y tu historial puede volver a estar disponible, porque los datos operativos pueden conservarse hasta 12 meses. Un plan reembolsado nunca se reactiva.",
    },
    languages: {
      title: "Idiomas",
      p1: "Este sitio web y tu área de cuenta: inglés, hebreo (de derecha a izquierda), español y ruso. La administración de AICC en WordPress: inglés y hebreo. El widget de la tienda online: inglés y hebreo completos, además de las etiquetas principales (encabezado, botones, mensajes) en español, ruso, francés, alemán y árabe.",
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
      outro: "Preferimos enumerarlo antes que dejar que lo descubras más tarde.",
    },
    demoHeading: "Míralo en acción",
  },

  pricing: {
    hero: {
      title: "Precios que caben en una pantalla.",
      lead: "Tres planes, un producto. Todos los planes tienen todas las funciones; la única diferencia es cuántas tiendas puedes conectar.",
    },
    plans: {
      solo: { name: "Solo", fit: "Una tienda." },
      studio: { name: "Studio", fit: "Una tienda más su copia de pruebas, o unas pocas tiendas de clientes." },
      agency: { name: "Agency", fit: "Una cartera de tiendas de clientes." },
    },
    included: {
      title: "Qué incluye cada plan",
      items: {
        a: "El widget de Comprados juntos con frecuencia en las páginas de producto y de carrito",
        b: "Panel, observaciones basadas en reglas y la exportación en CSV del rendimiento de los productos",
        c: "Reglas de fijar, preferir, restar prioridad y excluir",
        d: "Ask Reco en la administración de WordPress",
        e: "Importación de hasta 24 meses de pedidos anteriores",
        f: "Sitio web y área de cuenta en inglés, hebreo, español y ruso",
      },
    },
    slots: {
      title: "Cómo funcionan los cupos de tiendas",
      p1: "Cada plan tiene un número de cupos de tienda: 1, 3 o 10. Conectar una tienda usa un cupo; desconectarla libera el cupo al instante.",
      p2: "La tienda de pruebas y la de producción cuentan como tiendas distintas. También las variantes con www y sin www de una dirección, y http y https.",
      p3: "Para pasar tu plan de una tienda a otra: desconecta la tienda anterior y conecta la nueva. No hay límite de traslados ni coste adicional.",
      p4: "Si todos los cupos están en uso, desconecta una tienda que ya no necesites o pasa a un plan mayor. Un plan mayor es la única mejora que se ofrece.",
    },
    which: {
      title: "¿Qué plan elegir?",
      lead: "Cuenta las tiendas que quieres conectar.",
      items: {
        solo: "Una tienda: Solo.",
        studio: "Dos o tres tiendas, como una tienda y su copia de pruebas, o unas pocas tiendas de clientes: Studio.",
        agency: "De cuatro a diez tiendas, como la cartera de una agencia: Agency.",
      },
      outro: "Las funciones son idénticas, así que solo eliges capacidad. ¿Necesitas más de 10? Pregunta a soporte en {supportEmail}.",
    },
    finder: {
      label: "¿Cuántas tiendas vas a conectar?",
      hint: "Introduce un número entero del 1 al 10.",
      error: "Introduce un número entero del 1 al 10.",
      resultSolo: "Solo cubre 1 tienda.",
      resultStudio: "Studio cubre hasta 3 tiendas.",
      resultAgency: "Agency cubre hasta 10 tiendas.",
      empty: "Tu sugerencia aparecerá aquí.",
      suggestion: "Plan sugerido",
    },
    terms: {
      title: "Duración, renovación y reembolsos",
      items: {
        term: "Un plan dura 365 días desde la compra.",
        renewal: "La renovación es manual. La compras desde Planes y tiendas en tu cuenta, y suma 365 días a la más tardía de estas dos fechas: hoy o la fecha de fin actual, así que renovar antes de tiempo conserva el tiempo que no has usado.",
        billing: "No hay facturación recurrente ni autorización de pago almacenada. Nunca se cobra nada automáticamente.",
        guarantee: "Una garantía de devolución del dinero de 14 días cubre tu compra inicial. Los 14 días empiezan cuando se completa la compra y se emite el plan. No cubre automáticamente las renovaciones posteriores.",
        account: "Necesitas una cuenta de AICC para comprar. No hay clave de licencia que pegar: conectas cada tienda desde su propia pantalla de AICC.",
      },
      policy: "Leer la política de reembolso",
    },
    refunds: {
      p1: "Tras un reembolso completo, el plan se revoca y AICC deja de funcionar en tus tiendas. WooCommerce no se ve afectado.",
    },
    questions: {
      title: "Preguntas sobre planes y reembolsos",
    },
    cta: {
      title: "Elige tu plan",
      body: "Continuarás en la página de tu cuenta de AICC.",
    },
  },



  questionsPage: {
    hero: {
      title: "Preguntas frecuentes, respondidas con honestidad.",
      lead: "Las 40, agrupadas por tema. Si algo no está aquí, pregunta a soporte en {supportEmail}.",
    },
    topics: {
      basics: "Qué hace AICC",
      plans: "Planes y tiendas",
      billing: "Renovación y facturación",
      refunds: "Reembolsos",
      pause: "Cuando el acceso se pausa, y volver",
      data: "Datos y privacidad",
      reliability: "Fiabilidad y seguridad",
    },
  },

  faq: {
    items: {
      q01: {
        q: "¿Qué hace exactamente AICC?",
        a: "Añade a tus páginas de producto y de carrito un widget de recomendaciones de Comprados juntos con frecuencia, aprendido de los pedidos de tu propia tienda, y te da un panel, observaciones basadas en reglas, controles de producto y un asistente (Ask Reco) en la administración de WordPress. No sustituye a WooCommerce.",
      },
      q02: {
        q: "¿Cómo decide AICC qué recomendar?",
        a: "Examina los pedidos de tu tienda y cuenta qué productos se compran juntos. Cuando un producto tiene poco historial, completa los lugares restantes con productos de la misma categoría y después con tus productos más nuevos en stock. Tus propias reglas (fijar, preferir, restar prioridad, excluir) se aplican después. En esta decisión no interviene ninguna IA generativa.",
      },
      q03: {
        q: "¿AICC sustituye a WooCommerce?",
        a: "No. Es un plugin de WooCommerce. Tus productos, carrito, proceso de pago y pedidos siguen en WooCommerce.",
      },
      q04: {
        q: "¿Qué pasa si AICC no está disponible?",
        a: "El widget se oculta y vuelven los productos relacionados de WooCommerce. Tu tienda sigue vendiendo.",
      },
      q05: {
        q: "¿Mi proceso de pago llegará a depender de AICC?",
        a: "No. El proceso de pago no espera a AICC; la información del pedido se envía a AICC en segundo plano.",
      },
      q06: {
        q: "¿Necesito un desarrollador?",
        a: "No hay código ni asistente de configuración. AICC coloca el widget en las ubicaciones estándar de WooCommerce. Si en un tema poco habitual no encuentra un lugar seguro, se oculta en lugar de adivinar; en ese caso, un desarrollador puede ayudar.",
      },
      q07: {
        q: "¿Cuánto tarda la configuración?",
        a: "Tú conectas la tienda y AICC la prepara en segundo plano: catálogo, pedidos anteriores y una comprobación de preparación. Cuánto tarda depende del tamaño de tu catálogo y de las tareas en segundo plano de tu sitio, por eso no prometemos una cifra.",
      },
      q08: {
        q: "¿Tengo que pegar una clave de licencia?",
        a: "No. Inicias sesión en tu cuenta de AICC y conectas cada tienda desde su propia pantalla de AICC.",
      },
      q09: {
        q: "¿Cuál es la diferencia entre Solo, Studio y Agency?",
        a: "Solo cuántas tiendas puedes conectar: 1, 3 o 10. Todo lo demás es idéntico.",
      },
      q10: {
        q: "¿Los planes tienen funciones distintas?",
        a: "No. Todos los planes incluyen todas las funciones.",
      },
      q11: {
        q: "¿Cómo conecto una segunda o tercera tienda?",
        a: "Abre AICC en la administración de WordPress de la otra tienda, inicia sesión en la misma cuenta de AICC y elige el plan. Usa un cupo libre de tu plan.",
      },
      q12: {
        q: "¿Qué pasa cuando todos los cupos de mis tiendas están en uso?",
        a: "Puedes desconectar una tienda que ya no necesites o pasar a un plan mayor. Planes y tiendas muestra lo que hay disponible.",
      },
      q13: {
        q: "¿Puedo desconectar una tienda y conectar otra?",
        a: "Sí. Al desconectar, el cupo queda libre de inmediato.",
      },
      q14: {
        q: "¿Puedo reconectar una tienda más adelante?",
        a: "Sí, siempre que tu plan esté activo y tenga un cupo libre. No tienes que volver a comprar ni necesitas una clave.",
      },
      q15: {
        q: "¿Qué pasa con la tienda desconectada?",
        a: "AICC deja de funcionar en ella: ni widget en la tienda online, ni datos enviados. WooCommerce funciona con normalidad. El historial de AICC de la tienda puede conservarse hasta 12 meses, de modo que, al reconectar, puede continuar donde lo dejó.",
      },
      q16: {
        q: "¿Qué pasa con el widget de recomendaciones cuando mi plan no está activo?",
        a: "Está completamente ausente de la tienda online y en su lugar se muestran las recomendaciones nativas de WooCommerce.",
      },
      q17: {
        q: "¿Qué pasa si mi licencia vence?",
        a: "Pasados 365 días, el plan termina. AICC deja de funcionar en tus tiendas hasta que renueves; WooCommerce no se ve afectado.",
      },
      q18: {
        q: "¿La renovación es automática?",
        a: "No. Renuevas a mano cuando tú decides.",
      },
      q19: {
        q: "¿Se me cobrará automáticamente?",
        a: "No. No hay facturación recurrente ni autorización de pago almacenada.",
      },
      q20: {
        q: "¿Cómo renuevo?",
        a: "Desde Planes y tiendas en tu cuenta. Renovar antes de tiempo conserva el tiempo que no has usado.",
      },
      q21: {
        q: "¿Qué pasa con mis datos si mi plan vence?",
        a: "No se eliminan cuando termina el acceso. Los datos operativos pueden conservarse hasta 12 meses para que volver sea sencillo; los registros de cuenta y de compra siguen reglas distintas.",
      },
      q22: {
        q: "¿Qué pasa si vuelvo más adelante?",
        a: "Renueva el mismo plan y tus tiendas vuelven sin necesidad de reconectar. Si tu plan fue reembolsado, compra un plan nuevo y conecta la misma tienda: AICC la reconoce y tu historial vuelve a estar disponible. Un plan reembolsado nunca se reactiva.",
      },
      q23: {
        q: "¿Se conserva el historial anterior de mi tienda?",
        a: "Dentro del periodo de conservación, sí: los datos operativos pueden conservarse hasta 12 meses después de que termine el acceso.",
      },
      q24: {
        q: "¿Qué pasa con los productos y pedidos creados mientras AICC estuvo inactivo?",
        a: "Cuando vuelves, AICC actualiza su copia de tu catálogo (incluidos los productos que eliminaste) e importa los pedidos del periodo intermedio mediante la misma importación de historial que se usa en la primera conexión.",
      },
      q25: {
        q: "¿Se inventa historial de recomendaciones para el periodo inactivo?",
        a: "Nunca. Los pedidos anteriores se importan como pedidos. No se crean impresiones, clics ni ingresos atribuidos para un periodo en que AICC no estaba funcionando.",
      },
      q26: {
        q: "¿Cuál es la política de reembolso de 14 días?",
        a: "Una garantía de devolución del dinero de 14 días en tu compra inicial. Consulta la [política de reembolso](route:refund-policy) para ver los detalles.",
      },
      q27: {
        q: "¿Cuándo empiezan los 14 días?",
        a: "Cuando se completa la compra y se emite tu plan.",
      },
      q28: {
        q: "¿La garantía de 14 días se aplica a las renovaciones?",
        a: "La garantía cubre la compra inicial. Las renovaciones manuales posteriores no están cubiertas automáticamente.",
      },
      q29: {
        q: "¿Qué pasa después de un reembolso completo?",
        a: "El plan se revoca y AICC deja de funcionar en tus tiendas. Tu tienda WooCommerce no se ve afectada.",
      },
      q30: {
        q: "¿Un reembolso afecta a mi tienda WooCommerce?",
        a: "No. Los productos, pedidos, clientes y el proceso de pago siguen como estaban.",
      },
      q31: {
        q: "¿Es obligatoria la importación de pedidos históricos?",
        a: "Empieza automáticamente después de conectar, porque es lo que permite que las recomendaciones aprendan desde el primer día, y cubre hasta los últimos 24 meses. No es obligatoria para que el widget aparezca; sin ella, AICC empieza con la categoría y los productos más nuevos como alternativa y aprende de los pedidos nuevos.",
      },
      q32: {
        q: "¿Puedo elegir no importar los pedidos históricos?",
        a: "Puedes cancelar una importación desde el panel de AICC. No hay ningún ajuste para desactivar la importación automática antes de que empiece.",
      },
      q33: {
        q: "¿Qué datos de compradores y de la tienda procesa AICC?",
        a: "Tu catálogo (nombres, precios, categorías, imágenes, estado del stock) y datos de los pedidos (productos, cantidades, totales, país de facturación, un hash unidireccional del correo, y nunca el correo en claro, el nombre, el teléfono ni la dirección, ni datos de pago). Si el consentimiento de cookies de tu tienda permite las estadísticas, AICC también usa dos cookies propias para medir el widget: un ID de visitante (1 año) y un ID de sesión (30 minutos). Sin consentimiento, no hay cookies ni seguimiento de visitantes.",
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
        a: "Escribe a soporte desde el correo de tu cuenta, en {supportEmail}. Gestionamos estas solicitudes personalmente y te avisamos si un registro debe conservarse por motivos legales o contables.",
      },
      q37: {
        q: "¿Qué idiomas se admiten?",
        a: "Este sitio web y el área de cuenta: inglés, hebreo, español y ruso. La administración de AICC en WordPress: inglés y hebreo. El widget de la tienda online: inglés y hebreo completos, además de las etiquetas principales en español, ruso, francés, alemán y árabe.",
      },
      q38: {
        q: "¿AICC funciona en el móvil?",
        a: "El widget se adapta al ancho del espacio donde se encuentra, tanto en móviles como en ordenadores. Este sitio web y tu área de cuenta están diseñados pensando primero en los móviles.",
      },
      q39: {
        q: "¿Qué pasa si cambio de tema?",
        a: "AICC encuentra su lugar mediante los hooks estándar de WooCommerce, no editando el tema, así que acompaña a la mayoría de los cambios de tema. En un tema donde no puede colocarse con seguridad, se oculta en lugar de adivinar. Probamos con Storefront y un tema de bloques, y no podemos prometer que funcione con todos los temas.",
      },
      q40: {
        q: "¿Puedo quitar AICC sin dañar WooCommerce?",
        a: "Sí. AICC no hace cambios en los datos ni en las plantillas propias de WooCommerce; al desactivarlo, tu tienda vuelve a las recomendaciones nativas de WooCommerce.",
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
          a: "{legalName} opera AICC. Esta política cubre tres cosas: este sitio web, tu cuenta de AICC y tus compras, y los datos de las tiendas que conectas. Dirección de contacto: {address}.",
          b: "AICC está pensado para empresas. Cuando un comerciante conecta una tienda, la información sobre los compradores de esa tienda pasa por AICC como se describe a continuación.",
        },
        website: {
          h: "Este sitio web",
          a: "Este sitio web no usa analítica, publicidad ni scripts de seguimiento, y no llama a servicios de terceros cuando lo visitas. Guarda tus elecciones en tu propio navegador: tu idioma (una cookie llamada aicc_lang y una entrada equivalente en el almacenamiento local) y tus ajustes de accesibilidad (almacenamiento local). Permanecen en tu dispositivo y se usan solo para mostrar el sitio como elegiste.",
          b: "La cookie de idioma se envía al servidor del sitio web con las solicitudes de página, como cualquier cookie. Nuestro proveedor de alojamiento puede conservar registros de servidor habituales, como la página solicitada y la dirección IP.",
        },
        account: {
          h: "Tu cuenta y tus compras",
          a: "Cuando compras o gestionas un plan, tratamos los datos necesarios para ello: tu nombre, tus datos de facturación, tu dirección de correo y el historial de pedidos de tus planes. Los usamos para vender y administrar planes, conectar tus tiendas y dar soporte.",
          b: "Los pagos los gestiona {paymentProcessor}. AICC no recibe los datos de pago de tus compradores.",
        },
        storeData: {
          h: "Datos de las tiendas que conectas",
          a: "Una vez conectada una tienda, AICC recibe lo siguiente para generar recomendaciones, medir el widget y mostrar tu panel:",
          b: [
            "Catálogo: nombres de producto, precios, categorías, imágenes y estado del stock.",
            "Pedidos: los productos y cantidades, los totales, el país de facturación y, en el caso de compradores con sesión iniciada, el ID de cliente de WooCommerce.",
            "Un hash unidireccional del correo del comprador, generado en tu tienda. AICC nunca recibe el correo en claro, el nombre, el número de teléfono ni la dirección.",
            "Nunca datos de pago de ningún tipo.",
          ],
          c: "Al conectar se importan los pedidos anteriores de hasta los últimos 24 meses, solo como pedidos.",
        },
        cookies: {
          h: "Cookies en tu tienda",
          a: "AICC puede establecer dos cookies propias en tu tienda online para medir el widget.",
          b: [
            "Un ID de visitante, conservado 1 año.",
            "Un ID de sesión, conservado 30 minutos.",
            "Ambas se establecen solo si el ajuste de seguimiento de tu tienda está activado y la configuración de consentimiento de cookies de tu tienda permite las estadísticas. Sin una configuración de consentimiento que lo conceda, AICC considera que el consentimiento no se ha dado: ni cookies ni seguimiento de visitantes.",
          ],
          c: "Estos identificadores son seudónimos, no anónimos. No contienen el nombre ni los datos de contacto de un comprador, pero pueden vincularse entre visitas y pueden considerarse datos personales en el lugar donde vives.",
        },
        use: {
          h: "Para qué los usamos",
          a: [
            "Generar recomendaciones a partir de los pedidos de tu tienda.",
            "Mostrar tu panel, las observaciones y las respuestas de Ask Reco.",
            "Medir el widget: impresiones, clics, adiciones de paquetes y pedidos asociados.",
            "Operar, proteger y dar soporte al servicio.",
          ],
        },
        separate: {
          h: "Las tiendas se mantienen separadas",
          a: "Todo lo que AICC almacena está limitado a la única tienda a la que pertenece. Ninguna tienda puede ver los datos de otra, y los datos no se comparten entre tus tiendas.",
        },
        retention: {
          h: "Cuánto tiempo pueden conservarse los datos",
          a: "Los datos operativos (el estado derivado del catálogo, el historial de pedidos importado, la configuración, tus reglas y el aprendizaje de recomendaciones) pueden conservarse hasta 12 meses después de que termine el acceso a AICC, para que un comerciante que vuelve continúe en lugar de empezar de cero. Hoy no se elimina nada automáticamente.",
          b: "Los registros de cuenta, compra, licencia, reembolso y auditoría siguen una conservación distinta, por motivos contables, legales y de seguridad. No forman parte de la ventana de 12 meses.",
          c: "Si vuelves dentro de la ventana, tu tienda se reconoce y tu historial vuelve a estar disponible. Si vuelves después, empiezas de cero.",
        },
        requests: {
          h: "Solicitudes de eliminación y exportación",
          a: "Escribe a soporte desde el correo de tu cuenta, en {supportEmail}, para solicitar la eliminación o la exportación de tus datos. Soporte gestiona estas solicitudes personalmente; no hay un botón de autoservicio. Conservamos los registros que debamos conservar por motivos legales o contables, y te indicamos cuáles.",
        },
        security: {
          h: "Seguridad",
          a: "Las conexiones entre tu tienda, AICC y el sitio de la cuenta usan HTTPS. Las claves de licencia y las credenciales de las tiendas se almacenan con hash. Ninguna medida de seguridad es perfecta, y no prometemos que AICC sea invulnerable.",
        },
        transfers: {
          h: "Dónde se procesan los datos",
          a: "Región de alojamiento: {hostingRegion}. Todavía no indicamos una región ni un mecanismo de transferencia, y no afirmamos ofrecer una ubicación de datos seleccionable.",
        },
        rights: {
          h: "Tus derechos",
          a: "Según el lugar donde vivas, puedes tener derechos sobre tu información, como acceso, rectificación, eliminación y exportación. Solicítalos en {supportEmail}. Nada de lo aquí dicho limita los derechos que tengas según la ley del lugar donde vives.",
        },
        changes: {
          h: "Cambios y contacto",
          a: "Cuando esta política cambie, la actualizaremos junto con la fecha que aparece en la parte superior de la página.",
          b: "Preguntas: {supportEmail}.",
        },
      },
    },

    terms: {
      title: "Términos del servicio",
      intro: "Los términos para usar los planes de AICC y conectar tiendas. Están escritos en lenguaje sencillo a partir de cómo funciona AICC en realidad.",
      s: {
        agreement: {
          h: "Entre quiénes se establecen estos términos",
          a: "Estos términos se establecen entre tú y {legalName}. Al comprar un plan o conectar una tienda, los aceptas.",
          b: "AICC es para uso empresarial. Si lo usas para una empresa o un cliente, confirmas que puedes aceptar estos términos en su nombre.",
        },
        service: {
          h: "Qué es AICC",
          a: "AICC es un plugin de WooCommerce con un servicio alojado. Añade un widget de Comprados juntos con frecuencia aprendido de los pedidos de tu tienda, un panel, observaciones basadas en reglas, controles para el comerciante y Ask Reco.",
          b: "AICC no sustituye a WooCommerce. Tus productos, carrito, proceso de pago y pedidos siguen en WooCommerce.",
        },
        account: {
          h: "Tu cuenta",
          a: "Necesitas una cuenta de AICC para comprar un plan. Guarda con seguridad tus datos de acceso; eres responsable de lo que ocurra en tu cuenta.",
        },
        plans: {
          h: "Planes, tiendas y duración",
          a: "Un plan dura 365 días desde la compra. Cada plan te permite conectar un número de tiendas:",
          b: [
            "Solo: 1 tienda, {priceSolo} al año.",
            "Studio: hasta 3 tiendas, {priceStudio} al año.",
            "Agency: hasta 10 tiendas, {priceAgency} al año.",
          ],
          c: "Todos los planes tienen todas las funciones. La tienda de pruebas y la de producción cuentan como tiendas distintas. Puedes desconectar una tienda para liberar su cupo y conectar otra.",
        },
        fees: {
          h: "Precios y renovación",
          a: "Los precios son en dólares estadounidenses, por plan, por año. Los pagos se procesan a través de {paymentProcessor}.",
          b: "La renovación es manual. No se cobra nada automáticamente y no se almacena ninguna autorización de pago. Una renovación que compres suma 365 días a la más tardía de estas dos fechas: hoy o tu fecha de fin actual.",
        },
        refunds: {
          h: "Reembolsos",
          a: "La garantía de devolución del dinero de 14 días en una compra inicial se describe en la [política de reembolso](route:refund-policy).",
        },
        yourStore: {
          h: "Tu tienda y tus compradores",
          a: "Eres responsable de tener derecho a conectar tu tienda y de informar a tus compradores sobre los datos que recoge tu tienda, incluido cualquier aviso de cookies y configuración de consentimiento que exija tu ley.",
          b: "Los datos de pedidos y de catálogo que envías se usan para operar AICC para ti, como se describe en la [política de privacidad](route:privacy).",
        },
        outcomes: {
          h: "Sin resultados garantizados",
          a: "Las recomendaciones son una ayuda. No prometemos ningún resultado de ventas, ingresos o conversión. El panel muestra los pedidos asociados al widget; eso es asociación, no una prueba de que el widget los causara.",
        },
        availability: {
          h: "Disponibilidad",
          a: "AICC está construido para que WooCommerce siga funcionando si AICC o su backend va lento o no está disponible. No prometemos que el servicio esté siempre disponible ni libre de errores.",
          b: "AICC puede no estar disponible por mantenimiento o por motivos ajenos a nuestro control.",
        },
        inactive: {
          h: "Cuando un plan no está activo",
          a: "Cuando un plan vence, se revoca o se suspende, o se desconecta una tienda, AICC deja de funcionar en la tienda online afectada y la tienda deja de enviar datos de negocio. WooCommerce sigue funcionando como antes.",
          b: "Tras un reembolso completo, el plan se revoca de forma permanente y no se reactiva; puedes comprar un plan nuevo.",
        },
        changes: {
          h: "Cambios",
          a: "Podemos modificar AICC o estos términos. Actualizaremos la fecha de esta página. Si no estás de acuerdo con un cambio, puedes dejar de usar AICC.",
        },
        liability: {
          h: "Garantías y responsabilidad",
          a: "AICC se ofrece tal cual, en la medida en que la ley lo permita. Los límites de nuestra responsabilidad se están ultimando con la revisión legal.",
          b: "Nada de lo aquí dicho limita los derechos que tengas según la ley del lugar donde vives y que no puedan limitarse.",
        },
        law: {
          h: "Ley aplicable",
          a: "Ley aplicable y tribunales: {governingLaw}.",
        },
        contact: {
          h: "Contacto",
          a: "Preguntas sobre estos términos: {supportEmail}.",
        },
      },
    },

    refund: {
      title: "Política de reembolso",
      intro: "Una garantía de devolución del dinero de 14 días en tu compra inicial de un plan. Así funciona exactamente.",
      s: {
        guarantee: {
          h: "La garantía",
          a: "Si AICC no es lo que necesitas, puedes pedir que te devolvamos el dinero dentro de los 14 días siguientes a tu compra inicial de un plan.",
          b: "La garantía es una promesa nuestra. No sustituye ningún derecho que tengas por ley.",
        },
        start: {
          h: "Cuándo empiezan los 14 días",
          a: "Los 14 días empiezan cuando se completa la compra y se emite tu plan, no cuando se creó el pedido por primera vez.",
        },
        renewals: {
          h: "Renovaciones",
          a: "La garantía cubre la compra inicial. Las renovaciones manuales posteriores no están cubiertas automáticamente.",
        },
        how: {
          h: "Cómo solicitarlo",
          a: "Escribe a soporte desde el correo de tu cuenta, en {supportEmail}, dentro de los 14 días e indica el pedido.",
          b: "Gestionamos las solicitudes de reembolso personalmente.",
        },
        after: {
          h: "Después de un reembolso completo",
          a: "El plan se revoca y AICC deja de funcionar en tus tiendas conectadas. Tu tienda WooCommerce sigue vendiendo: productos, pedidos, clientes y proceso de pago no se ven afectados.",
          b: "Un plan revocado nunca se reactiva. Si vuelves, compras un plan nuevo.",
        },
        data: {
          h: "Tus datos después de un reembolso",
          a: "Los datos de la tienda siguen la conservación descrita en la [política de privacidad](route:privacy): pueden conservarse hasta 12 meses. Los registros de cuenta y de compra siguen su propia conservación.",
        },
        nothingElse: {
          h: "Nada más que cancelar",
          a: "No hay facturación recurrente, así que no hay nada más que cancelar después de un reembolso.",
        },
        rights: {
          h: "Tus derechos",
          a: "Nada en esta política limita los derechos que tengas según la ley del lugar donde vives. Los pagos y reembolsos se procesan a través de {paymentProcessor}.",
        },
      },
    },

    dataTrust: {
      title: "Datos y confianza",
      intro: "Un resumen en lenguaje sencillo. La [política de privacidad](route:privacy) es el texto completo.",
      s: {
        reads: {
          h: "Qué lee AICC de tu tienda",
          a: "Cuando conectas una tienda, AICC recibe lo que necesita para saber qué productos se compran juntos:",
          b: [
            "Catálogo: nombres, precios, categorías, imágenes y estado del stock.",
            "Pedidos: productos, cantidades, totales, país de facturación y un hash unidireccional del correo.",
            "Pedidos anteriores de hasta los últimos 24 meses, importados como pedidos.",
          ],
        },
        never: {
          h: "Qué no recibe nunca AICC",
          a: [
            "El correo en claro, el nombre, el número de teléfono ni la dirección postal de un comprador.",
            "Datos de pago de ningún tipo.",
            "No llamamos anónimos a estos datos. Los identificadores seudónimos aun así pueden considerarse datos personales, por eso enumeramos exactamente qué se envía.",
          ],
        },
        cookies: {
          h: "Cookies y consentimiento",
          a: "Si el consentimiento de cookies de tu tienda permite las estadísticas, AICC establece dos cookies propias en tu tienda online para medir el widget.",
          b: [
            "Un ID de visitante, conservado 1 año.",
            "Un ID de sesión, conservado 30 minutos.",
          ],
          c: "Sin consentimiento no hay cookies ni seguimiento de visitantes. La medición queda entonces vacía, y es así por diseño.",
        },
        apart: {
          h: "Las tiendas se mantienen separadas",
          a: "Los datos de cada tienda se mantienen separados. Una tienda no puede ver los datos de otra, y los datos no se comparten entre tus tiendas.",
        },
        outage: {
          h: "Si AICC o tu plan no están disponibles",
          a: "AICC puede fallar; WooCommerce debe seguir funcionando.",
          b: [
            "Si AICC va lento o no está disponible, el widget se oculta y vuelven los productos relacionados de WooCommerce.",
            "Si tu plan no está activo, nada de AICC aparece en tu tienda online: ni widget, ni script, ni cookies. La tienda deja de enviar datos de negocio.",
          ],
        },
        retention: {
          h: "Cuánto tiempo pueden conservarse los datos",
          a: "Los datos operativos pueden conservarse hasta 12 meses después de que termine el acceso, para que volver sea sencillo. Hoy no se elimina nada automáticamente.",
          b: "Los registros de cuenta, compra, licencia, reembolso y auditoría siguen una conservación distinta.",
        },
        requests: {
          h: "Pídenos que eliminemos o exportemos",
          a: "Escribe a soporte desde el correo de tu cuenta, en {supportEmail}. Gestionamos estas solicitudes personalmente y te avisamos si un registro debe conservarse por motivos legales o contables.",
        },
        pending: {
          h: "Lo que aún no hemos ultimado",
          a: "Algunos detalles todavía no están publicados y aparecen como «pendiente»: razón social de la empresa, dirección, correo de soporte, ley aplicable, procesador de pagos y región de alojamiento. Preferimos mostrar un hueco antes que inventar un valor.",
        },
      },
    },

    accessibility: {
      title: "Declaración de accesibilidad",
      intro: "Última revisión: {date}.",
      s: {
        commitment: {
          h: "Nuestro compromiso",
          a: "Queremos que todas las personas puedan usar este sitio web. Trabajamos la accesibilidad como parte de cómo se construye el sitio, no como un añadido.",
        },
        target: {
          h: "A qué aspiramos",
          a: "Aspiramos al nivel AA de WCAG 2.2. No afirmamos que este sitio web cumpla ni esté certificado: lo probamos, corregimos lo que encontramos y te decimos lo que sabemos que sigue mal.",
        },
        done: {
          h: "Lo que hemos hecho",
          a: [
            "Regiones semánticas, un solo encabezado principal por página y un orden secuencial de encabezados.",
            "Un enlace para saltar al contenido y uso completo con teclado, incluidos los menús, los ajustes de accesibilidad y la demo interactiva.",
            "Foco visible en cada control, con un anillo de contraste suficiente sobre fondos claros y oscuros.",
            "Contraste del texto y de la interfaz comprobado con las proporciones de WCAG, y áreas táctiles de al menos 44 píxeles.",
            "Se respeta la reducción de movimiento, tanto desde el ajuste de tu sistema como desde nuestro propio control.",
            "Diseño de derecha a izquierda para el hebreo, construido con propiedades lógicas, y con el texto de dirección mixta, como precios y nombres de marca, mantenido en orden.",
            "Sin audio, sin vídeo de reproducción automática y sin producto de superposición de accesibilidad.",
          ],
        },
        limits: {
          h: "Limitaciones conocidas",
          a: [
            "Las páginas de inicio de sesión, de cuenta y de pago están en un sitio aparte, y los pagos los gestiona un procesador de pagos externo. No podemos prometer que esas páginas cumplan el mismo estándar.",
            "El texto en español y en ruso todavía no ha sido revisado por revisores nativos de accesibilidad y legales.",
            "Las comprobaciones automáticas y manuales no pueden confirmarlo todo, por ejemplo si el texto alternativo es la mejor descripción o si el orden de lectura resulta natural con cada lector de pantalla. No hemos probado todas las combinaciones de navegador y tecnología de asistencia.",
            "Las ilustraciones de Reco contienen palabras cortas dentro de las imágenes. Son decorativas y la misma información está en el texto de la página.",
          ],
        },
        report: {
          h: "Informar de una barrera",
          a: "Si algo de este sitio web resulta difícil de usar, escribe a {supportEmail}. Indícanos la página, lo que intentaste y la tecnología de asistencia que usas, si te sientes cómodo compartiéndola. Aspiramos a responder con prontitud y a corregir las barreras reales.",
        },
        review: {
          h: "Última revisión",
          a: "Esta declaración se revisó por última vez el {date}, tras comprobaciones automáticas en todas las páginas en los cuatro idiomas, con anchos de móvil y de escritorio, y un recorrido solo con teclado por los controles principales.",
        },
        jurisdiction: {
          h: "Marcos legales",
          a: "La legislación sobre accesibilidad varía según el país. No hemos hecho ninguna declaración de conformidad según una ley nacional concreta, y esta sección necesita revisión legal antes de que lo hagamos.",
        },
      },
    },
  },
};
