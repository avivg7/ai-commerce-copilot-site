import type { EaDict } from "./en";
import type { DeepPartial } from "../merge";

/**
 * Early Access campaign copy, Spanish (neutral international Spanish, formal "usted"). Machine draft of the same standing as the rest of es.ts: not reviewed by native speakers (see common.draft.translation).
 * Dates are written as Spanish writes them and are legal facts, checked by scripts/lib/early-access-truth.mjs: 31 de diciembre de 2026 (last free day), 1 de enero de 2027 (access ends).
 * The time zone is always stated as "hora de Israel" (Israel time) and the UTC instant as "22:00 UTC".
 * Terms reused from the existing pack: tienda, escaparate, proceso de pago, Datos y confianza, conservación, plan, pedidos, plugin, garantía de devolución del dinero de 14 días.
 * Banned here as in the English file: trial, subscription, automatic renewal wording, urgency, discount and percentage wording.
 * Production 21: the dates are TOKENS ({lastDay}, {lastDayShort}, {endDate}, {firstLastDay}) resolved per extension step from src/i18n/eaTokens.ts.
 */
export const eaEs: DeepPartial<EaDict> = {
  bar: {
    label: "Anuncio de Acceso anticipado",
    live: "Acceso anticipado: AICC es gratis para tiendas aprobadas hasta el {lastDay}, hora de Israel.",
    announce: "El Acceso anticipado llega pronto: AICC será gratis para tiendas aprobadas hasta el {lastDay}, hora de Israel.",
    link: "Cómo funciona",
  },
  extended: {
    bar: "El Acceso anticipado se ha ampliado para todas las tiendas: gratis hasta el {lastDay}, hora de Israel.",
    note: "El Acceso anticipado se anunció al principio para terminar el {firstLastDay}. Lo ampliamos para todas las tiendas del Acceso anticipado. Nada más ha cambiado: no se toma ningún pago y nada se convierte ni se cobra automáticamente.",
  },
  after: {
    title: "El Acceso anticipado ha terminado.",
    body: "El Acceso anticipado terminó el {endDate} a las 00:00, hora de Israel. Para seguir usando AICC, usted elige un plan cuando se abran las compras. No se cobra nada automáticamente.",
    cta: "Ver planes",
  },
  hero: {
    ctaOpen: "Solicitar Acceso anticipado gratis",
    ctaAnnounce: "Cómo funciona el Acceso anticipado",
    note: "No hace falta tarjeta de crédito. El acceso termina el {endDate} a las 00:00, hora de Israel, y no se cobra nada automáticamente.",
  },
  header: { cta: "Solicitar acceso" },
  plan: {
    free: "Gratis hasta el {lastDay}",
    regular: "Precio regular, no se cobra durante el Acceso anticipado:",
    planned: "Precio previsto cuando se abran las compras:",
    regularPer: "al año",
    noCard: "No hace falta tarjeta de crédito",
    term: "Duración del Acceso anticipado: hasta el {lastDay}, hora de Israel",
    ends: "El acceso termina el {endDate} a las 00:00, hora de Israel (22:00 UTC del {lastDayShort}). Un plan de pago empieza solo si usted decide comprarlo.",
    ctaOpen: "Solicitar Acceso anticipado gratis",
    ctaAnnounce: "El Acceso anticipado abre pronto",
  },
  section: {
    title: "Acceso anticipado: gratis hasta el {lastDay}",
    lead: "Use el producto completo en su tienda WooCommerce sin coste hasta el {lastDay}. El acceso termina el {endDate} a las 00:00, hora de Israel (22:00 UTC del {lastDay}). Si quiere continuar, elige un plan de pago. No se cobra nada automáticamente.",
    homeLead: "Durante el Acceso anticipado, todos los planes son gratis para tiendas aprobadas hasta el {lastDay}, hora de Israel. El acceso termina el {endDate}, y un plan de pago empieza solo si usted decide comprarlo.",
    link: "Cómo funciona el Acceso anticipado",
    stepsLabel: "Cómo funciona el Acceso anticipado",
    steps: {
      request: { title: "Solicite el acceso", body: "Pida el Acceso anticipado para su tienda WooCommerce. No hace falta tarjeta de crédito. Revisamos cada solicitud." },
      use: { title: "Use todo", body: "Conecte su tienda y use el producto completo hasta el {lastDay}." },
      decide: { title: "Decida al final", body: "El {endDate} a las 00:00, hora de Israel, el acceso termina y su tienda sigue vendiendo como siempre. Para continuar, compra el plan que su tienda tenga en ese momento, cuando se abran las compras; si no lo hace, no se cobra nada." },
    },
    whoTitle: "Para quién es",
    who: {
      a: "Tiendas WooCommerce que pueden conectarse a AICC (WordPress 6.0, WooCommerce 7.0 y PHP 7.4 o posterior).",
      b: "Todas las tiendas aprobadas terminan en el mismo momento, a las 00:00 del {endDate}, hora de Israel, sea cual sea el día en que empezaron.",
      c: "Un Acceso anticipado por cuenta, y comprobamos que una tienda no lo reciba dos veces. El número de tiendas depende del plan que solicite: Solo 1 tienda, Studio hasta 3, Agency hasta 10. Pida el plan que querría conservar: continuar es más sencillo con el plan que su tienda tenga al final, y antes del final puede pedirnos que lo cambiemos (vea las preguntas más abajo).",
      d: "Revisamos cada solicitud y no todas se aprobarán. El Acceso anticipado puede cerrarse a nuevas solicitudes en cualquier momento, y no se concede en las últimas 24 horas antes de que termine.",
    },
    endTitle: "Qué ocurre el {endDate}",
    end: {
      a: "AICC deja de mostrarse en el escaparate de su tienda. Su tienda, sus pedidos y su proceso de pago siguen como siempre.",
      b: "Sus datos de AICC se conservan según las reglas de conservación de la página Datos y confianza, y no se eliminan ese día.",
      c: "Cuando se abran las compras, para continuar compra el plan que su tienda tenga en ese momento, y su tienda conectada recibe la nueva fecha de fin. Le explicamos los pasos antes de comprar. No hay conversión automática ni cobro automático.",
    },
    terms: "El Acceso anticipado es el mismo producto que los planes de pago. La fecha de fin, la ausencia de cobros automáticos y el tratamiento de los datos descritos en esta página forman parte de esta oferta; las páginas de términos, privacidad y reembolso describen el resto. ¿Preguntas? Escriba a {contactEmail}.",
    reservation: "Si ampliamos el Acceso anticipado, lo hacemos para todas las tiendas del Acceso anticipado a la vez y lo anunciamos en esta página antes de la fecha de fin; cuando podemos, también se lo comunicamos por correo electrónico. Una ampliación nunca inicia un cobro. No podemos ampliar el acceso de una sola tienda.",
    faqTitle: "Preguntas sobre el Acceso anticipado",
    faq: {
      free: { q: "¿El Acceso anticipado es realmente gratis?", a: "Sí, para tiendas aprobadas hasta el {lastDay}. No pedimos datos de pago y no se cobra nada." },
      end: { q: "¿Qué ocurre el {endDate}?", a: "El acceso termina para todas las tiendas del Acceso anticipado en el mismo momento, a las 00:00 hora de Israel. AICC deja de mostrarse en el escaparate de su tienda y esta sigue funcionando como siempre. Para continuar, usted compra un plan cuando se abran las compras." },
      auto: { q: "¿Se me cobrará automáticamente?", a: "No. No hay tarjeta guardada, nada se renueva por sí solo y no hay cambio automático a un plan de pago." },
      continue: { q: "¿Cómo continúo después del Acceso anticipado?", a: "Compra el plan que su tienda tenga en ese momento, cuando las compras estén abiertas. Su tienda conectada recibe la nueva fecha de fin. Para tener un plan distinto, pídanoslo antes de que termine el Acceso anticipado (vea \"¿Puedo cambiar mi plan?\")." },
      change: { q: "¿Puedo cambiar mi plan?", a: "Sí, antes de que termine el Acceso anticipado. Escriba a {contactEmail} desde la dirección de correo de su cuenta y cambiamos el plan de su tienda del Acceso anticipado sin ningún coste. La fecha de fin no cambia. El número de tiendas depende del plan, así que un plan más pequeño admite menos tiendas conectadas. Para continuar después del Acceso anticipado, compra el plan que su tienda tenga en ese momento, cuando se abran las compras." },
      extension: { q: "¿Podría ampliarse el Acceso anticipado?", a: "Si ampliamos el Acceso anticipado, lo hacemos para todas las tiendas del Acceso anticipado a la vez y lo anunciamos en esta página antes de la fecha de fin; cuando podemos, también se lo comunicamos por correo electrónico. Una ampliación nunca inicia un cobro. No podemos ampliar el acceso de una sola tienda." },
      guarantee: { q: "¿La garantía de devolución del dinero se aplica al Acceso anticipado?", a: "No. La garantía de devolución del dinero de 14 días se aplica a las compras de pago que cumplan los requisitos, según la [Política de reembolso](route:refund-policy), y no al Acceso anticipado gratuito. No se cobra ningún pago durante el Acceso anticipado, así que no hay nada que reembolsar. Cuando se abran las compras, la [Política de reembolso](route:refund-policy) se aplica a las compras de pago que cumplan los requisitos." },
      plugin: { q: "¿Qué verá en el plugin cuando termine el Acceso anticipado?", a: "A las 00:00 del {endDate} (hora de Israel) el plugin indica que su plan ha caducado, con un botón para renovar el plan, y AICC deja de mostrarse en el escaparate de su tienda. Su tienda sigue vendiendo como siempre. El plugin no avisa de antemano, así que anote la fecha; la página de su cuenta también la muestra." },
    },
  },
};
