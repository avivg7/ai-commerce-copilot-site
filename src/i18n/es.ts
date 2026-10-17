import type { Dictionary } from "./en";
import type { DeepPartial } from "./merge";

/**
 * Spanish dictionary: a PARTIAL dictionary (same shape as en.ts). It holds only strings whose English meaning is unchanged since they
 * were translated; every other unit falls back to English at load time (shown lang="en" dir="ltr"), see merge.ts. Stage 2 translates the rest.
 * Texts have not yet been reviewed by native speakers (see common.draft.translation). Legal text under `legal.*` is a draft translation
 * pending native legal review. FAQ translations live in brand/content/faq.es.json.
 */
export const es: DeepPartial<Dictionary> = {
  meta: {
    siteName: "AI Commerce Copilot",
    ogImageAlt: "AICC: «Comprados juntos con frecuencia», aprendido de los pedidos de su propia tienda. Con Reco, la guía de AICC.",
    pages: {
      dataTrust: {
        title: "Datos y confianza: qué lee AICC y qué no",
        description: "Los datos de tienda y de pedidos que usa AICC, las cookies que puede establecer, cómo se mantienen separadas las tiendas y cuánto tiempo pueden conservarse los datos.",
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
        description: "Una garantía de devolución del dinero de 14 días en su compra inicial de un plan, cuándo empieza y qué ocurre después de un reembolso.",
      },
      accessibility: {
        title: "Declaración de accesibilidad",
        description: "Cómo aspiramos a cumplir el nivel AA de WCAG 2.2 en este sitio web, qué hemos hecho, las limitaciones conocidas y cómo informar de una barrera.",
      },
      notFound: {
        title: "Página no encontrada",
        description: "Esta página no existe.",
      },
    },
  },
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
    },
    getStarted: "Empezar",
    seeHow: "Ver cómo funciona",
    seePricing: "Ver precios",
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
      productHeading: "AICC",
      trustHeading: "Confianza y legal",
      languageHeading: "Idioma",
      copyright: "© {year} {name}",
      note: "AICC es un plugin de WooCommerce. WooCommerce y WordPress son marcas de sus respectivos propietarios.",
    },
    breadcrumbs: {
      label: "Ruta de navegación",
    },
    draft: {
      badge: "Borrador: pendiente de revisión legal",
      text: "Este texto es un borrador. No lo ha revisado un abogado ni una persona con autoridad legal, y puede cambiar antes de ser definitivo.",
      translation: "Los textos en hebreo, español y ruso aún no han sido revisados por hablantes nativos. Esta traducción es un borrador y además necesita un revisor legal nativo. Si difiere del texto en inglés, prevalece el texto en inglés.",
    },
    plan: {
      perYear: "al año",
      oneStore: "1 tienda",
      upToStores: "Hasta {n} tiendas",
      choose: "Elegir {plan}",
      recommended: "Recomendado para 2 o 3 tiendas",
      sameFeatures: "Todas las funciones, en todos los planes",
      countHelper: "Cuente las tiendas que quiere conectar: 1 tienda es el plan Solo, de 2 a 3 es Studio, de 4 a 10 es Agency.",
      guarantee: "Garantía de devolución del dinero de 14 días en su primera compra",
      usd: "Todos los precios están en dólares estadounidenses (USD).",
    },
    toc: "En esta página",
    lastReviewed: "Última revisión",
    draftUpdated: "Borrador actualizado por última vez",
    version: "Estado",
    versionDraft: "Borrador",
  },
  brand: {
    watchDemo: "Ver demostración",
    signIn: "Iniciar sesión",
    chips: {
      orders: "Historial de pedidos",
      clicks: "Tasa de clics",
      recs: "Recomendaciones",
      insights: "Información útil",
      bundles: "Paquetes",
    },
    modal: {
      title: "Demostración del producto",
      close: "Cerrar",
      placeholder: "El vídeo de demostración del producto aparecerá aquí.",
      placeholderBadge: "marcador de posición",
      captionsLabel: "Subtítulos",
    },
  },
  notFound: {
    heading: "No encontramos esa página.",
    body: "Puede que el enlace sea antiguo o esté mal escrito. Su tienda no se ha visto afectada.",
    home: "Ir a la página de inicio",
    questions: "Leer las preguntas",
  },
  demo: {
    heading: "Pruebe el widget",
    groupLabel: "Productos de este paquete",
    summary: "Seleccionados: {count}. Total del paquete: {total}.",
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
      without: "Sin AICC",
      with: "Con AICC",
      captionWithout: "Reco: misma categoría, no por pedidos.",
      captionWith: "Reco: lo que más se compra junto.",
      withoutCaption: "Los productos relacionados de WooCommerce salen de la misma categoría o de las mismas etiquetas. No se basan en lo que los compradores compran juntos.",
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
    why: {
      heading: "Por qué estos",
      without: "Sin AICC, estos son simplemente productos de la misma categoría. Nada de ellos procede de lo que sus compradores compran juntos.",
    },
    reco: {
      without: "Reco: estos salen de la categoría, no de los pedidos.",
    },
    keyboardHint: "Use Tab y la barra espaciadora para marcar productos. Las teclas de flecha permiten pasar de uno a otro.",
    sample: "Ejemplo",
  },
  home: {
    hero: {
      eyebrow: "Comprados juntos con frecuencia para WooCommerce",
      titleLead: "Muestre a sus compradores lo que sus propios clientes",
      titleAccent: "compran juntos.",
    },
    demo: {
      title: "«Comprados juntos con frecuencia», aprendido de verdad.",
    },
    how: {
      steps: {
        connect: {
          title: "Conectar",
        },
        learn: {
          title: "Aprender",
        },
        recommend: {
          title: "Recomendar",
        },
      },
    },
    pricing: {
      link: "Compare los planes y lea los detalles",
    },
    final: {
      title: "Listo cuando lo esté su tienda.",
    },
  },
  product: {
    shopper: {
      title: "Qué ven los compradores",
    },
  },
  pricing: {
    plans: {
      solo: {
        name: "Solo",
        fit: "Una tienda.",
      },
      studio: {
        name: "Studio",
        fit: "Una tienda más su copia de pruebas, o unas pocas tiendas de clientes.",
      },
      agency: {
        name: "Agency",
        fit: "Una cartera de tiendas de clientes.",
      },
    },
    slots: {
      title: "Cómo funcionan los cupos de tienda",
      p1: "Cada plan tiene un número de cupos de tienda: 1, 3 o 10. Conectar una tienda usa un cupo; desconectarla libera el cupo al instante.",
      p2: "La tienda de pruebas y la de producción cuentan como tiendas distintas. También las variantes con www y sin www de una dirección, y http y https.",
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
